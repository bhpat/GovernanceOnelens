"""
governance-onelens scan — Spark Job Definition entrypoint (production runtime).

Replaces the fragile scheduled Notebook. Runs headless on Fabric Spark as the
least-privilege scan service principal. One pass does EVERYTHING the local
`scanner/fabric_inventory.py` + `scanner/derive_metrics.py` do:

  1. Fabric admin inventory  (workspaces / items / domains)   → owner+tags from payload
  2. Power BI scanner getInfo (sensitivity / endorsement / lineage, PBI artifacts)
  3. Derive coverage + posture metrics  (computed in-memory, no DB round-trip)
  4. Single JDBC transaction: MERGE all six tables + fill-only enrichment UPDATE

Uses ONLY runtime built-ins (`requests`, `notebookutils`, `spark`) — no
`%pip install`, no `azure-identity`. Auth is SECRETLESS: the Fabric token
library (`notebookutils.credentials.getToken`) mints delegated tokens for the
identity that runs the job (its submitter / schedule owner), so there is no
service-principal secret and no Key Vault dependency. The run identity must be a
Fabric admin (tenant-admin read on the Fabric + Power BI admin APIs).

Scheduled by a Fabric Data Pipeline (retry / timeout / alert / run history).
"""

import datetime
import json
import os
import sys
import time
import base64
import traceback

import requests
import notebookutils  # noqa: F401  (Fabric runtime built-in)
from pyspark.sql import SparkSession

# deploy_sjd.py passes the runtime config (SQL server/db, workspace ids, etc.)
# as a single base64-encoded JSON command-line argument rather than a sibling
# file — additionalLibraryUris can only carry .py files for a Python SJD
# (confirmed via a real Fabric 400: SparkJobDefinitionPropertiesAdditionalLibrary-
# UrisNotConsistentWithSelectedLanguage), and plain file uploads to the same
# OneLake "Main/" folder are NOT reliably staged next to this script at runtime
# either. A command-line argument has no such ambiguity: it always arrives via
# sys.argv regardless of where anything gets staged on disk. Populate
# os.environ from it BEFORE importing onelens_config so its own
# os.environ-first configured()/required() calls pick these values up directly.
if len(sys.argv) > 1 and sys.argv[1]:
    for _key, _value in json.loads(base64.urlsafe_b64decode(sys.argv[1].encode("ascii"))).items():
        os.environ.setdefault(_key, str(_value))

from fabric_metadata import extract_size_bytes, normalize_role_assignments
from onelens_config import configured, required, required_uuid

# In a headless Spark Job Definition `spark` is NOT a predefined global (unlike
# notebooks) — create/get the session explicitly so `spark._sc._jvm` works.
spark = SparkSession.builder.getOrCreate()

# --------------------------------------------------------------------------- #
# Config (non-secret). `deploy_sjd.py` uploads these values beside this file in
# `onelens_runtime_config.json`; process environment variables override the file.
# Deployment targets remain required so a fork cannot silently scan or write to
# another environment.
# --------------------------------------------------------------------------- #
SQL_SRV = required("ONELENS_SQL_SERVER")
SQL_DB = required("ONELENS_SQL_DB")
PORTAL = configured("ONELENS_PORTAL", "app.fabric.microsoft.com")

# Non-secret presentation metadata — published into the Connector `scope` JSON so
# the app's Settings page can render the service plumbing without any Fabric calls.
WS_NAME = configured("ONELENS_WORKSPACE_NAME", "OneLens-Workspace")
LAKEHOUSE_NAME = configured("ONELENS_LAKEHOUSE_NAME", "onelens_scan_lh")
SPARKJOB_NAME = configured("ONELENS_SPARKJOB_NAME", "governance-onelens-scan")
CAPACITY_NAME = configured("ONELENS_CAPACITY_NAME", "Fabric capacity")

# The "Ask OneLens" analysis skill lives in its own workspace/agent, deployed by
# scanner/create_data_agent.py (not by this scan). Re-verified every scan run
# below so the connector:onelens row self-heals the same way connector:fabric
# does — connected while the Data Agent exists, reverts to planned if it's ever
# deleted from the tenant.
ONELENS_ANALYSIS_WORKSPACE_ID = required_uuid("ONELENS_ANALYSIS_WORKSPACE_ID")
ONELENS_AGENT_NAME = configured("ONELENS_AGENT_NAME", "Ask OneLens")

FABRIC_API = "https://api.fabric.microsoft.com"
FABRIC_SCOPE = "https://api.fabric.microsoft.com/.default"
PBI_API = "https://api.powerbi.com/v1.0/myorg"
PBI_SCOPE = "https://analysis.windows.net/powerbi/api/.default"
SQL_SCOPE = "https://database.windows.net/.default"

LINEAGE_TYPES = {"Report", "SemanticModel", "Dataflow", "Datamart", "PaginatedReport"}

# Secretless auth: the Fabric token library mints a delegated token for the
# identity that runs this job (its submitter / schedule owner) — no Key Vault, no
# client secret, no client-credentials POST. The scan therefore runs as a Fabric
# admin identity (which holds tenant-admin read on the Fabric + Power BI admin
# APIs). getToken takes a resource URL or a known alias (e.g. `pbi`, `storage`).
_AUDIENCE = {
    FABRIC_SCOPE: "https://api.fabric.microsoft.com",
    PBI_SCOPE: "pbi",
    SQL_SCOPE: "https://database.windows.net",
    "https://graph.microsoft.com/.default": "https://graph.microsoft.com",
}


def sp_token(scope: str) -> str:
    return notebookutils.credentials.getToken(_AUDIENCE.get(scope, scope))



# --------------------------------------------------------------------------- #
# Canonical helpers + paginated admin GET
# --------------------------------------------------------------------------- #
def canonical(kind: str, sid: str) -> str:
    return f"fabric:{kind}:{sid}"


def portal_path(t):
    return {"Report": "reports", "SemanticModel": "datasets", "Dashboard": "dashboards",
            "Lakehouse": "lakehouses", "Notebook": "synapsenotebooks",
            "Warehouse": "datawarehouses"}.get(t or "", "items")


def get_paginated(sess, url, keys):
    nxt = url
    while nxt:
        r = sess.get(nxt, timeout=60)
        if r.status_code == 429:
            time.sleep(int(r.headers.get("Retry-After", "20")))
            continue
        r.raise_for_status()
        body = r.json()
        for k in keys:
            if isinstance(body.get(k), list):
                yield from body[k]
                break
        tok, cu = body.get("continuationToken"), body.get("continuationUri")
        nxt = cu if cu else (f"{url}{'&' if '?' in url else '?'}continuationToken={tok}" if tok else None)


def collect(sess):
    ws, items, doms = [], [], []
    # Domains first — domain membership is not on the admin/workspaces payload;
    # build workspaceId -> domainCanonicalId so workspaces AND items inherit it.
    ws_domain = {}
    for d in get_paginated(sess, f"{FABRIC_API}/v1/admin/domains", ["domains", "value"]):
        if not d.get("id"):
            continue
        dcid = canonical("domain", d["id"])
        doms.append({"canonicalId": dcid, "sourceId": d["id"],
                     "name": d.get("displayName") or d.get("name") or d["id"], "description": d.get("description"),
                     "parentDomainCanonicalId": canonical("domain", d["parentDomainId"]) if d.get("parentDomainId") else None})
        for w in get_paginated(sess, f"{FABRIC_API}/v1/admin/domains/{d['id']}/workspaces", ["value", "workspaces"]):
            if w.get("id"):
                ws_domain[w["id"]] = dcid
    for w in get_paginated(sess, f"{FABRIC_API}/v1/admin/workspaces?type=Workspace", ["workspaces", "value"]):
        if not w.get("id"):
            continue
        ws.append({"canonicalId": canonical("workspace", w["id"]), "sourceId": w["id"],
                   "name": w.get("name") or w.get("displayName") or w["id"], "type": w.get("type"),
                   "state": w.get("state"), "capacityId": w.get("capacityId"),
                   "domainCanonicalId": ws_domain.get(w["id"]) or (canonical("domain", w["domainId"]) if w.get("domainId") else None)})
    for it in get_paginated(sess, f"{FABRIC_API}/v1/admin/items", ["itemEntities", "items", "value"]):
        if not it.get("id"):
            continue
        wid = it.get("workspaceId")
        cp = it.get("creatorPrincipal") or {}
        owner = cp.get("displayName") or (cp.get("userDetails") or {}).get("userPrincipalName")
        tag_names = [t.get("displayName") for t in (it.get("tags") or []) if isinstance(t, dict) and t.get("displayName")]
        items.append({"canonicalId": canonical("item", it["id"]), "sourceId": it["id"],
                      "name": it.get("name") or it.get("displayName") or it["id"], "itemType": it.get("type") or "Unknown",
                      "workspaceCanonicalId": canonical("workspace", wid) if wid else None,
                      "domainCanonicalId": ws_domain.get(wid) if wid else None, "description": it.get("description"),
                      "owner": owner, "tags": json.dumps(tag_names) if tag_names else None,
                      "sizeBytes": extract_size_bytes(it),
                      "deepLink": f"https://{PORTAL}/groups/{wid}/{portal_path(it.get('type'))}/{it['id']}" if wid else None})

    # Drop items whose workspace didn't independently validate via
    # /v1/admin/workspaces?type=Workspace this same run. Confirmed live: Fabric's
    # own admin/items API keeps re-surfacing a "OneLake catalog governance report
    # (automatically generated)" Report+SemanticModel pair tied to a workspace id
    # that /v1/admin/workspaces never returns (not Personal — genuinely absent
    # from the tenant's real workspace list) — a Fabric-platform data-quality
    # quirk, not something this scanner caused. An item can't legitimately belong
    # to a workspace that doesn't exist, so exclude it here rather than let it
    # masquerade as a real governed asset with a raw-GUID "workspace" the UI has
    # to invent a fallback display for. Items with NO workspace at all pass
    # through unaffected (rare, not the failure mode seen). Because excluded
    # items are simply absent from THIS run's `items`, the existing lastSeen-
    # based tombstone sweep removes them automatically on the very next run —
    # no separate cleanup path needed.
    known_ws_ids = {w["canonicalId"] for w in ws}
    items = [i for i in items if not i.get("workspaceCanonicalId") or i["workspaceCanonicalId"] in known_ws_ids]
    return ws, items, doms


# --------------------------------------------------------------------------- #
# lineage-capture — Power BI metadata scanner (getInfo → scanStatus → scanResult)
# --------------------------------------------------------------------------- #
def scanner_enrich(pbi_sess, workspace_ids):
    enrich, edges, role_assignments = {}, [], []
    ids = [w for w in workspace_ids if w]
    for start in range(0, len(ids), 100):
        batch = ids[start:start + 100]
        try:
            r = pbi_sess.post(f"{PBI_API}/admin/workspaces/getInfo",
                              params={"lineage": "true", "datasourceDetails": "true",
                                      "datasetSchema": "true", "datasetExpressions": "true",
                                      "getArtifactUsers": "true"},
                              json={"workspaces": batch}, timeout=60)
            r.raise_for_status()
            scan_id = (r.json() or {}).get("id")
            if not scan_id:
                raise RuntimeError("Power BI metadata scanner returned no scan id")
            for _ in range(120):
                s = pbi_sess.get(f"{PBI_API}/admin/workspaces/scanStatus/{scan_id}", timeout=60)
                s.raise_for_status()
                st = (s.json() or {}).get("status")
                if st == "Succeeded":
                    break
                if st == "Failed":
                    raise RuntimeError(f"scan {scan_id} Failed")
                time.sleep(3)
            else:
                raise TimeoutError(f"scan {scan_id} did not finish before the polling limit")
            res = pbi_sess.get(f"{PBI_API}/admin/workspaces/scanResult/{scan_id}", timeout=180)
            res.raise_for_status()
            _parse_scan(res.json() or {}, enrich, edges, role_assignments)
        except Exception as exc:  # noqa: BLE001 — preserve the last complete governance snapshot
            raise RuntimeError(f"Power BI metadata scan batch {start // 100} failed") from exc
    uniq = {e["canonicalId"]: e for e in edges}
    unique_roles = {row["canonicalId"]: row for row in role_assignments}
    return enrich, list(uniq.values()), list(unique_roles.values())


def _artifact_owner(art):
    for key in ("configuredBy", "modifiedBy", "createdBy"):
        v = art.get(key)
        if isinstance(v, list) and v:
            return v[0]
        if isinstance(v, str) and v:
            return v
    for u in art.get("users", []) or []:
        right = u.get("datasetUserAccessRight") or u.get("reportUserAccessRight") or u.get("dataflowUserAccessRight")
        if right == "Owner" and u.get("identifier"):
            return u["identifier"]
    return None


def _parse_scan(result, enrich, edges, role_assignments):
    ds_map = {}
    for ds in result.get("datasourceInstances", []) or []:
        dsid = ds.get("datasourceInstanceId") or ds.get("datasourceId")
        if dsid:
            cd = ds.get("connectionDetails") or {}
            name = cd.get("server") or cd.get("path") or cd.get("url") or ds.get("datasourceType") or dsid
            ds_map[dsid] = (name, ds.get("datasourceType") or "DataSource")

    def enrich_from(art):
        aid = art.get("id")
        if not aid:
            return
        e = enrich.setdefault(canonical("item", aid), {})
        role_assignments.extend(normalize_role_assignments("Item", aid, art.get("users")))
        end = (art.get("endorsementDetails") or {}).get("endorsement")
        if end and end != "None":
            e["endorsement"] = end
        sl = art.get("sensitivityLabel") or {}
        lid = sl.get("labelId") or sl.get("name")
        if lid:
            e["sensitivityLabel"] = lid
        owner = _artifact_owner(art)
        if owner:
            e["owner"] = owner
        # operational health — best-effort, key names vary by artifact type
        created = art.get("createdDate") or art.get("createdDateTime")
        if created:
            e["createdDate"] = str(created)[:40]
        modified = (art.get("modifiedDateTime") or art.get("modifiedDate")
                    or art.get("lastUpdate") or art.get("lastUpdatedDate"))
        if modified:
            e["modifiedDate"] = str(modified)[:40]
        mb = art.get("modifiedBy") or art.get("modifiedById")
        if mb:
            e["modifiedBy"] = str(mb)[:400]
        size_bytes = extract_size_bytes(art)
        if size_bytes is not None:
            e["sizeBytes"] = size_bytes

    def add_edge(frm, to, rel, fn=None, tn=None, ft=None, tt=None):
        if not frm or not to or frm == to:
            return
        edges.append({"canonicalId": f"fabric:edge:{frm}->{to}:{rel}"[:900],
                      "fromCanonicalId": frm, "toCanonicalId": to, "relationship": rel,
                      "fromName": fn, "toName": tn, "fromType": ft, "toType": tt})

    for ws in result.get("workspaces", []) or []:
        role_assignments.extend(normalize_role_assignments("Workspace", ws.get("id"), ws.get("users")))
        names = {}
        for arts, typ in ((ws.get("reports"), "Report"), (ws.get("datasets"), "SemanticModel"),
                          (ws.get("dataflows"), "Dataflow"), (ws.get("dashboards"), "Dashboard"),
                          (ws.get("datamarts"), "Datamart")):
            for a in arts or []:
                if a.get("id"):
                    names[a["id"]] = (a.get("name") or a["id"], typ)

        for ds in ws.get("datasets", []) or []:
            enrich_from(ds)
            did = ds.get("id")
            to_cid = canonical("item", did) if did else None
            to_nm = names.get(did, (did, "SemanticModel"))[0]
            # dataset schema (datasetSchema=true) — table/column breadth = the
            # column-level foundation the coarse admin/items API never returns.
            tables = ds.get("tables") or []
            if tables and to_cid:
                se = enrich.setdefault(to_cid, {})
                se["tableCount"] = len(tables)
                se["columnCount"] = sum(len(t.get("columns") or []) for t in tables)
            for up in ds.get("upstreamDatasets", []) or []:
                tgt = up.get("targetDatasetId") or up.get("targetDatasetObjectId")
                if tgt:
                    add_edge(canonical("item", tgt), to_cid, "Upstream",
                             names.get(tgt, (tgt, "SemanticModel"))[0], to_nm, "SemanticModel", "SemanticModel")
            for up in ds.get("upstreamDataflows", []) or []:
                tgt = up.get("targetDataflowId")
                if tgt:
                    add_edge(canonical("item", tgt), to_cid, "Upstream",
                             names.get(tgt, (tgt, "Dataflow"))[0], to_nm, "Dataflow", "SemanticModel")
            for du in ds.get("datasourceUsages", []) or []:
                dsid = du.get("datasourceInstanceId")
                if dsid:
                    nm, typ = ds_map.get(dsid, (dsid, "DataSource"))
                    add_edge(canonical("datasource", dsid), to_cid, "DataSource", nm, to_nm, typ, "SemanticModel")

        for rep in ws.get("reports", []) or []:
            enrich_from(rep)
            rid, dsid = rep.get("id"), rep.get("datasetId")
            if rid and dsid:
                add_edge(canonical("item", dsid), canonical("item", rid), "DependsOn",
                         names.get(dsid, (dsid, "SemanticModel"))[0], names.get(rid, (rid, "Report"))[0],
                         "SemanticModel", "Report")

        # dataflows — enrich + cross-system datasource edges (external sources
        # like SQL / ADLS / Web that the dataset loop alone would miss).
        for df in ws.get("dataflows", []) or []:
            enrich_from(df)
            dfid = df.get("objectId") or df.get("id")
            df_cid = canonical("item", dfid) if dfid else None
            df_nm = names.get(dfid, (dfid, "Dataflow"))[0] if dfid else None
            for du in df.get("datasourceUsages", []) or []:
                dsid = du.get("datasourceInstanceId")
                if dsid and df_cid:
                    nm, typ = ds_map.get(dsid, (dsid, "DataSource"))
                    add_edge(canonical("datasource", dsid), df_cid, "DataSource", nm, df_nm, typ, "Dataflow")

        # dashboards — enrich + tile→dataset edges (dashboards consume the
        # semantic models behind each tile; model → dashboard DependsOn).
        for dash in ws.get("dashboards", []) or []:
            enrich_from(dash)
            dash_id = dash.get("id")
            dash_cid = canonical("item", dash_id) if dash_id else None
            dash_nm = names.get(dash_id, (dash_id, "Dashboard"))[0] if dash_id else None
            seen = set()
            for tile in dash.get("tiles", []) or []:
                dsid = tile.get("datasetId")
                if dsid and dash_cid and dsid not in seen:
                    seen.add(dsid)
                    add_edge(canonical("item", dsid), dash_cid, "DependsOn",
                             names.get(dsid, (dsid, "SemanticModel"))[0], dash_nm,
                             "SemanticModel", "Dashboard")

        for a in ws.get("datamarts", []) or []:
            enrich_from(a)

        # Everything else the scanner returns (Lakehouse/Notebook/DataAgent/
        # Eventhouse/KQLDatabase/SQLDatabase/DataPipeline/Ontology/GraphModel/
        # warehouses/AppBackend/OrgApp/... — Microsoft keeps adding new
        # per-type arrays to this response). Every entry shares the exact
        # same shape as reports/datasets/etc. (endorsementDetails/
        # sensitivityLabel/createdDate/modifiedBy/users), so `enrich_from`
        # already handles it correctly with ZERO changes — the only gap was
        # that this code never iterated these arrays at all. Confirmed live:
        # a real "Reactor Data Agent" item's Promoted endorsement sat right
        # here in `ws["DataAgent"]`, invisible to the app purely because
        # nothing ever read that key. Generic (iterate any list-valued key
        # not already special-cased above) rather than a hardcoded type
        # name list, so this keeps working as Microsoft adds more item types
        # to the scanner without needing another code change every time.
        _SPECIAL_CASED_ARRAYS = {"reports", "datasets", "dataflows", "dashboards", "datamarts"}
        _NON_ITEM_ARRAYS = {"users", "folders", "tags"}
        for key, value in ws.items():
            if key in _SPECIAL_CASED_ARRAYS or key in _NON_ITEM_ARRAYS or not isinstance(value, list):
                continue
            for a in value:
                if isinstance(a, dict):
                    enrich_from(a)


def structural_edges(items):
    """Deterministic Fabric-native lineage that the Power BI scanner never returns.

    A Lakehouse / Warehouse / MirroredDatabase / SQLDatabase and its
    auto-provisioned SQL analytics endpoint share a name within the same
    workspace, so we can pair them without any extra API call. Same story for
    an Eventhouse and its auto-provisioned default KQL database. This lights up
    the data-store estate (lakehouses, warehouses, SQL/KQL databases, endpoints)
    that would otherwise show no lineage at all.
    """
    parents = {}
    for i in items:
        if i["itemType"] in ("Lakehouse", "Warehouse", "MirroredDatabase", "SQLDatabase", "Eventhouse"):
            parents[(i.get("workspaceCanonicalId"), i["name"])] = i
    out = []
    for i in items:
        if i["itemType"] in ("SQLEndpoint", "SQLAnalyticsEndpoint", "KQLDatabase"):
            p = parents.get((i.get("workspaceCanonicalId"), i["name"]))
            if p:
                out.append({
                    "canonicalId": f"fabric:edge:{p['canonicalId']}->{i['canonicalId']}:Provides"[:900],
                    "fromCanonicalId": p["canonicalId"], "toCanonicalId": i["canonicalId"],
                    "relationship": "Provides", "fromName": p["name"], "toName": i["name"],
                    "fromType": p["itemType"], "toType": i["itemType"],
                })
    return out


def collect_shortcuts(sess, items):
    """OneLake shortcuts inside lakehouses → cross-workspace lineage edges.

    A shortcut makes another item's data appear inside a host lakehouse, so data
    flows target → host. Internal (oneLake) targets become item→item edges that
    frequently cross workspace boundaries — the tenant-wide signal the Power BI
    scanner can't see. Best-effort per lakehouse.
    """
    out = []
    skipped = 0
    by_id = {i["sourceId"]: i for i in items}
    for host in items:
        if host["itemType"] != "Lakehouse" or not host.get("workspaceCanonicalId"):
            continue
        wid = host["workspaceCanonicalId"].replace("fabric:workspace:", "")
        hid = host["sourceId"]
        try:
            for sc in get_paginated(sess, f"{FABRIC_API}/v1/workspaces/{wid}/items/{hid}/shortcuts", ["value"]):
                tgt = (sc.get("target") or {}).get("oneLake") or {}
                tid = tgt.get("itemId")
                if not tid or tid == hid:
                    continue
                tcid = canonical("item", tid)
                out.append({
                    "canonicalId": f"fabric:edge:{tcid}->{host['canonicalId']}:Shortcut"[:900],
                    "fromCanonicalId": tcid, "toCanonicalId": host["canonicalId"],
                    "relationship": "Shortcut",
                    "fromName": (by_id.get(tid) or {}).get("name") or sc.get("name") or tgt.get("path"),
                    "toName": host["name"],
                    "fromType": (by_id.get(tid) or {}).get("itemType") or "Lakehouse", "toType": "Lakehouse",
                })
        except requests.HTTPError:
            skipped += 1
    return out, skipped


# --------------------------------------------------------------------------- #
# transformation lineage — process nodes (CopyJob / DataPipeline / Eventstream /
# Reflex) move or watch data between stores. Parses item DEFINITIONS
# (getDefinition) to emit dataset→job→dataset edges (the OpenLineage process
# pattern). The job is already an Item.
# --------------------------------------------------------------------------- #
def _edge(frm, to, rel, fn=None, tn=None, ft=None, tt=None):
    return {"canonicalId": f"fabric:edge:{frm}->{to}:{rel}"[:900],
            "fromCanonicalId": frm, "toCanonicalId": to, "relationship": rel,
            "fromName": fn, "toName": tn, "fromType": ft, "toType": tt}


def _get_definition(sess, wid, iid):
    """getDefinition with long-running-operation polling. Returns the JSON or None."""
    r = sess.post(f"{FABRIC_API}/v1/workspaces/{wid}/items/{iid}/getDefinition", json={}, timeout=60)
    if r.status_code == 202:
        loc = r.headers.get("Location")
        if not loc:
            return None
        for _ in range(40):
            time.sleep(3)
            op = sess.get(loc, timeout=60)
            stx = (op.json() or {}).get("status")
            if stx == "Succeeded":
                break
            if stx == "Failed":
                return None
        rr = sess.get(loc.rstrip("/") + "/result", timeout=60)
        rr.raise_for_status()
        return rr.json()
    r.raise_for_status()
    return r.json()


def _part(defn, suffix):
    for p in ((defn or {}).get("definition") or {}).get("parts", []) or []:
        if str(p.get("path", "")).endswith(suffix) and p.get("payloadType") == "InlineBase64":
            try:
                return json.loads(base64.b64decode(p["payload"]).decode("utf-8"))
            except (ValueError, TypeError):
                return None
    return None


def _parts_containing(defn, substr):
    """Like `_part`, but returns EVERY matching part decoded (not just the
    first) — needed for item defs with a variable number of same-shaped parts,
    e.g. an Ontology's `EntityTypes/{id}/DataBindings/{id}.json` files."""
    out = []
    for p in ((defn or {}).get("definition") or {}).get("parts", []) or []:
        if substr in str(p.get("path", "")) and p.get("payloadType") == "InlineBase64":
            try:
                out.append(json.loads(base64.b64decode(p["payload"]).decode("utf-8")))
            except (ValueError, TypeError):
                continue
    return out


def transformation_edges(sess, items):
    """CopyJob source/destination + DataPipeline notebook orchestration +
    Eventstream source/destination + Reflex (Activator) watched-source +
    Ontology entity-type data-binding source → edges.

    Returns (edges, skipped) where `skipped` counts process items whose
    getDefinition was blocked (401/403 permission wall) or malformed — surfaced
    as the `lineageGaps` posture signal so incomplete lineage is visible, not
    silently inflated."""
    out = []
    skipped = 0
    for it in items:
        t = it["itemType"]
        wid = (it.get("workspaceCanonicalId") or "").replace("fabric:workspace:", "")
        iid = it["sourceId"]
        if not wid or t not in ("CopyJob", "DataPipeline", "Eventstream", "Reflex", "Ontology"):
            continue
        try:
            defn = _get_definition(sess, wid, iid)
            if t == "CopyJob":
                d = _part(defn, "copyjob-content.json")
                props = (d or {}).get("properties") or {}
                src = (((props.get("source") or {}).get("connectionSettings") or {}).get("typeProperties") or {}).get("artifactId")
                dst = (((props.get("destination") or {}).get("connectionSettings") or {}).get("typeProperties") or {}).get("artifactId")
                if src:
                    out.append(_edge(canonical("item", src), it["canonicalId"], "Reads", None, it["name"], None, "CopyJob"))
                if dst:
                    out.append(_edge(it["canonicalId"], canonical("item", dst), "Writes", it["name"], None, "CopyJob", None))
            elif t == "DataPipeline":
                d = _part(defn, "pipeline-content.json")
                acts = ((d or {}).get("properties") or {}).get("activities") or []
                act_item = {}
                for a in acts:
                    nbid = (a.get("typeProperties") or {}).get("notebookId")
                    if nbid:
                        cid = canonical("item", nbid)
                        act_item[a.get("name")] = cid
                        out.append(_edge(it["canonicalId"], cid, "Orchestrates", it["name"], None, "DataPipeline", "Notebook"))
                for a in acts:
                    cur = act_item.get(a.get("name"))
                    if not cur:
                        continue
                    for dep in a.get("dependsOn") or []:
                        prev = act_item.get(dep.get("activity"))
                        if prev and prev != cur:
                            out.append(_edge(prev, cur, "Then", None, None, "Notebook", "Notebook"))
            elif t == "Eventstream":
                # eventstream.json sources/destinations carry a Fabric itemId
                # only when they reference a real Fabric item (e.g. Eventhouse/
                # Lakehouse/Activator); synthetic sources like SampleData or a
                # Custom Endpoint have none and are correctly skipped.
                d = _part(defn, "eventstream.json") or {}
                for src in d.get("sources", []) or []:
                    sid = ((src.get("properties") or {}).get("itemId"))
                    if sid:
                        out.append(_edge(canonical("item", sid), it["canonicalId"], "Reads", None, it["name"], None, "Eventstream"))
                for dst in d.get("destinations", []) or []:
                    did = ((dst.get("properties") or {}).get("itemId"))
                    if did:
                        out.append(_edge(it["canonicalId"], canonical("item", did), "Writes", it["name"], None, "Eventstream", None))
            elif t == "Reflex":  # Activator — only kqlSource-v1 entities carry
                # a clean Fabric item reference (the watched Eventhouse/KQL
                # database); rule/action entities target email/Teams recipients,
                # not governance Items, so they are intentionally not edged.
                ents = _part(defn, "ReflexEntities.json") or []
                for ent in ents:
                    if not isinstance(ent, dict) or ent.get("type") != "kqlSource-v1":
                        continue
                    eh = (ent.get("payload") or {}).get("eventhouseItem") or {}
                    ehid = eh.get("itemId")
                    if ehid:
                        out.append(_edge(it["canonicalId"], canonical("item", ehid), "Watches", it["name"], None, "Reflex", None))
            else:  # Ontology — every EntityTypes/{id}/DataBindings/{id}.json
                # part names the real Fabric item (Lakehouse today; Eventhouse/
                # KQL database for timeseries bindings) each entity type is
                # grounded on. One ontology can bind several distinct source
                # items across many entity types — dedupe per source item so a
                # richly-bound ontology doesn't emit a flood of parallel edges.
                seen = set()
                for b in _parts_containing(defn, "/DataBindings/"):
                    stp = ((b or {}).get("dataBindingConfiguration") or {}).get("sourceTableProperties") or {}
                    sid = stp.get("itemId")
                    if sid and sid not in seen:
                        seen.add(sid)
                        out.append(_edge(canonical("item", sid), it["canonicalId"], "Grounds", None, it["name"], None, "Ontology"))
        except (requests.HTTPError, ValueError, KeyError):
            skipped += 1
            continue
    return out, skipped


def refresh_health(pbi_sess, items, enrich):
    """Best-effort last-refresh status for semantic models via the Power BI
    refresh-history endpoint. Guarded + capped so it can never fail the scan;
    silently degrades to null when the scan SP lacks workspace membership
    (401/403). Populates refreshStatus + lastRefresh in `enrich`."""
    n = 0
    for it in items:
        if it["itemType"] != "SemanticModel":
            continue
        wid = (it.get("workspaceCanonicalId") or "").replace("fabric:workspace:", "")
        did = it["sourceId"]
        if not wid:
            continue
        try:
            r = pbi_sess.get(f"{PBI_API}/groups/{wid}/datasets/{did}/refreshes",
                             params={"$top": "1"}, timeout=30)
            if not r.ok:
                continue
            hist = (r.json() or {}).get("value") or []
            if not hist:
                continue
            h0 = hist[0]
            e = enrich.setdefault(it["canonicalId"], {})
            e["refreshStatus"] = (h0.get("status") or "")[:40] or None
            e["lastRefresh"] = str(h0.get("endTime") or h0.get("startTime") or "")[:40] or None
            n += 1
        except (requests.RequestException, ValueError):
            continue
    return n


# --------------------------------------------------------------------------- #
# four-lens-scorecard — derive coverage + posture IN-MEMORY (no DB round-trip)
# --------------------------------------------------------------------------- #
def derive(items, ws, doms, enrich, edges, role_assignments, lineage_gaps=0):
    def pct(n, d):
        return round(100.0 * n / d, 1) if d else 0.0

    def cov_status(p):
        return "ok" if p >= 95 else "warn" if p >= 50 else "critical"

    total = len(items)
    owned = sum(1 for i in items if i.get("owner") or enrich.get(i["canonicalId"], {}).get("owner"))
    described = sum(1 for i in items if i.get("description"))
    labeled = sum(1 for i in items if enrich.get(i["canonicalId"], {}).get("sensitivityLabel"))
    endorsed = sum(1 for i in items if enrich.get(i["canonicalId"], {}).get("endorsement"))
    ws_total = len(ws)
    ws_domain = sum(1 for w in ws if w.get("domainCanonicalId"))
    dom_total = len(doms)
    type_count = len({i["itemType"] for i in items})
    principal_count = len({r["principalId"] for r in role_assignments})
    group_assignments = sum(1 for r in role_assignments if r["principalType"].lower() == "group")

    edge_cids = {e["fromCanonicalId"] for e in edges} | {e["toCanonicalId"] for e in edges}
    eligible = [i for i in items if i["itemType"] in LINEAGE_TYPES]
    connected = sum(1 for i in eligible if i["canonicalId"] in edge_cids)

    # staleItems — not modified in >90 days (ISO dates compare lexicographically).
    cutoff = (datetime.datetime.utcnow() - datetime.timedelta(days=90)).strftime("%Y-%m-%d")
    def _mod(i):
        return (enrich.get(i["canonicalId"], {}).get("modifiedDate") or "")[:10]
    stale = sum(1 for i in items if _mod(i) and _mod(i) < cutoff)

    cov = []
    for metric, num, den in (("sensitivityLabeled", labeled, total), ("endorsed", endorsed, total),
                             ("described", described, total), ("owned", owned, total),
                             ("domainAssigned", ws_domain, ws_total),
                             ("lineageComplete", connected, len(eligible))):
        cov.append({"canonicalId": f"derived:coverage:{metric}:tenant", "metric": metric, "scopeType": "tenant",
                    "numerator": num, "denominator": den, "percent": pct(num, den)})

    pos = []
    for signal, value, status in (("itemCount", total, "ok"), ("workspaceCount", ws_total, "ok"),
                                  ("domainCount", dom_total, "ok" if dom_total else "warn"),
                                  ("itemTypeCount", type_count, "ok"),
                                  ("lineageEdges", len(edges), "ok" if edges else "warn"),
                                  ("lineageGaps", lineage_gaps, "ok" if lineage_gaps == 0 else "warn"),
                                  ("staleItems", stale, "ok" if stale == 0 else "warn"),
                                  ("accessAssignments", len(role_assignments), "ok"),
                                  ("accessPrincipals", principal_count, "ok"),
                                  ("groupAccessAssignments", group_assignments, "ok")):
        pos.append({"canonicalId": f"derived:posture:{signal}:tenant", "signal": signal, "scopeType": "tenant",
                    "value": float(value), "status": status})

    # Per-workspace rollups (no native workspace label — aggregate item signals).
    ws_items: dict[str, list] = {}
    for i in items:
        wcid = i.get("workspaceCanonicalId")
        if wcid:
            ws_items.setdefault(wcid, []).append(i)
    for ws_cid, its in ws_items.items():
        wtot = len(its)
        wlab = sum(1 for i in its if enrich.get(i["canonicalId"], {}).get("sensitivityLabel"))
        wend = sum(1 for i in its if enrich.get(i["canonicalId"], {}).get("endorsement"))
        wdesc = sum(1 for i in its if i.get("description"))
        wown = sum(1 for i in its if i.get("owner") or enrich.get(i["canonicalId"], {}).get("owner"))
        wdistinct = len({enrich[i["canonicalId"]]["sensitivityLabel"] for i in its if enrich.get(i["canonicalId"], {}).get("sensitivityLabel")})
        for metric, num in (("sensitivityLabeled", wlab), ("endorsed", wend), ("described", wdesc), ("owned", wown)):
            cov.append({"canonicalId": f"derived:coverage:{metric}:workspace:{ws_cid}", "metric": metric,
                        "scopeType": "workspace", "scopeCanonicalId": ws_cid,
                        "numerator": num, "denominator": wtot, "percent": pct(num, wtot)})
        for signal, val, status in (("itemCount", wtot, "ok"), ("sensitiveItemCount", wlab, "ok" if wlab > 0 else "warn"), ("distinctLabelCount", wdistinct, "ok")):
            pos.append({"canonicalId": f"derived:posture:{signal}:workspace:{ws_cid}", "signal": signal,
                        "scopeType": "workspace", "scopeCanonicalId": ws_cid, "value": float(val), "status": status})
    return cov, pos


# --------------------------------------------------------------------------- #
# Direct-SQL write via the built-in Spark JDBC driver (MERGE upsert)
# --------------------------------------------------------------------------- #
def _jdbc_conn():
    jvm = spark._sc._jvm  # noqa: F821  (Fabric Spark session global)
    jvm.java.lang.Class.forName("com.microsoft.sqlserver.jdbc.SQLServerDriver")
    props = jvm.java.util.Properties()
    props.setProperty("accessToken", sp_token(SQL_SCOPE))
    url = f"jdbc:sqlserver://{SQL_SRV};database={SQL_DB};encrypt=true;trustServerCertificate=false;"
    return jvm.java.sql.DriverManager.getConnection(url, props)


def _bind(pstmt, idx, value):
    """Bind a Python value onto a JDBC PreparedStatement parameter (NULL-safe,
    always as a string \u2014 SQL Server implicitly converts to the destination
    column's real type on INSERT/UPDATE, the same conversion the old
    string-literal SQL relied on; this just does it via a bound parameter
    instead of splicing the value into the SQL text).

    Values here originate from the Fabric tenant (item/workspace names,
    descriptions, tags, owner display names) \u2014 i.e. anything any user with
    rename/edit rights on a workspace or item can influence \u2014 so they must
    never be interpolated directly into SQL text (OWASP A03:2021 Injection).
    """
    if value is None:
        pstmt.setNull(idx, 12)  # java.sql.Types.VARCHAR
    else:
        pstmt.setString(idx, str(value))


def _merge(conn, table, cols, rows, source="fabric"):
    """Idempotent upsert on canonicalId via a batched JDBC PreparedStatement
    (bound parameters throughout \u2014 no string-built SQL)."""
    if not rows:
        return 0
    other_cols = [c for c in cols if c != "canonicalId"]
    setc = ", ".join(f"t.[{c}]=s.[{c}]" for c in other_cols)
    ins = ["id", "canonicalId", "source", *other_cols, "firstSeen", "lastSeen"]
    src_cols = ", ".join(f"? AS [{c}]" for c in cols)
    vals = ["NEWID()", "s.[canonicalId]", "?", *[f"s.[{c}]" for c in other_cols], "SYSUTCDATETIME()", "SYSUTCDATETIME()"]
    sql = (
        f"MERGE dbo.[{table}] AS t USING (SELECT {src_cols}) AS s ON t.[canonicalId]=s.[canonicalId] "
        f"WHEN MATCHED THEN UPDATE SET {setc}, t.[lastSeen]=SYSUTCDATETIME() "
        f"WHEN NOT MATCHED THEN INSERT ({', '.join('[' + c + ']' for c in ins)}) VALUES ({', '.join(vals)});"
    )
    pstmt = conn.prepareStatement(sql)
    try:
        for r in rows:
            idx = 1
            for c in cols:
                _bind(pstmt, idx, r.get(c))
                idx += 1
            _bind(pstmt, idx, source)
            pstmt.addBatch()
        pstmt.executeBatch()
    finally:
        pstmt.close()
    return len(rows)


def _merge_derived(conn, table, cols, rows):
    """Derived metrics carry no firstSeen/lastSeen and source='derived'."""
    if not rows:
        return 0
    other_cols = [c for c in cols if c != "canonicalId"]
    setc = ", ".join(f"t.[{c}]=s.[{c}]" for c in other_cols)
    ins = ["id", "canonicalId", "source", *other_cols, "computedAt"]
    src_cols = ", ".join(f"? AS [{c}]" for c in cols)
    vals = ["NEWID()", "s.[canonicalId]", "N'derived'", *[f"s.[{c}]" for c in other_cols], "SYSUTCDATETIME()"]
    sql = (
        f"MERGE dbo.[{table}] AS t USING (SELECT {src_cols}) AS s ON t.[canonicalId]=s.[canonicalId] "
        f"WHEN MATCHED THEN UPDATE SET {setc}, t.[computedAt]=SYSUTCDATETIME() "
        f"WHEN NOT MATCHED THEN INSERT ({', '.join('[' + c + ']' for c in ins)}) VALUES ({', '.join(vals)});"
    )
    pstmt = conn.prepareStatement(sql)
    try:
        for r in rows:
            idx = 1
            for c in cols:
                _bind(pstmt, idx, r.get(c))
                idx += 1
            pstmt.addBatch()
        pstmt.executeBatch()
    finally:
        pstmt.close()
    return len(rows)


def _history_rows(cov, pos, run_ts):
    rows = []
    for c in cov:
        scope = c.get("scopeCanonicalId") or "tenant"
        rows.append({"canonicalId": f"derived:history:coverage:{c['metric']}:{c['scopeType']}:{scope}:{run_ts}",
                     "kind": "coverage", "metric": c["metric"], "scopeType": c["scopeType"],
                     "scopeCanonicalId": c.get("scopeCanonicalId"), "value": c["percent"],
                     "numerator": c["numerator"], "denominator": c["denominator"]})
    for p in pos:
        scope = p.get("scopeCanonicalId") or "tenant"
        rows.append({"canonicalId": f"derived:history:posture:{p['signal']}:{p['scopeType']}:{scope}:{run_ts}",
                     "kind": "posture", "metric": p["signal"], "scopeType": p["scopeType"],
                     "scopeCanonicalId": p.get("scopeCanonicalId"), "value": p["value"],
                     "numerator": None, "denominator": None})
    return rows


def _merge_history(conn, rows):
    """Append-only time-series points into MetricSnapshots (capturedAt=run time)."""
    if not rows:
        return 0
    cols = ["canonicalId", "kind", "metric", "scopeType", "scopeCanonicalId", "value", "numerator", "denominator"]
    other_cols = [c for c in cols if c != "canonicalId"]
    setc = ", ".join(f"t.[{c}]=s.[{c}]" for c in other_cols)
    ins = ["id", "canonicalId", "source", *other_cols, "capturedAt"]
    src_cols = ", ".join(f"? AS [{c}]" for c in cols)
    vals = ["NEWID()", "s.[canonicalId]", "N'derived'", *[f"s.[{c}]" for c in other_cols], "SYSUTCDATETIME()"]
    sql = (
        f"MERGE dbo.[MetricSnapshots] AS t USING (SELECT {src_cols}) AS s ON t.[canonicalId]=s.[canonicalId] "
        f"WHEN MATCHED THEN UPDATE SET {setc}, t.[capturedAt]=SYSUTCDATETIME() "
        f"WHEN NOT MATCHED THEN INSERT ({', '.join('[' + c + ']' for c in ins)}) VALUES ({', '.join(vals)});"
    )
    pstmt = conn.prepareStatement(sql)
    try:
        for r in rows:
            idx = 1
            for c in cols:
                _bind(pstmt, idx, r.get(c))
                idx += 1
            pstmt.addBatch()
        pstmt.executeBatch()
    finally:
        pstmt.close()
    return len(rows)


_ENRICH_COLS = ["owner", "endorsement", "sensitivityLabel", "createdDate", "modifiedDate",
                "modifiedBy", "refreshStatus", "lastRefresh", "tableCount", "columnCount", "sizeBytes"]


def _update_enrichment(conn, enrich):
    """Fill-only enrichment UPDATE, one shared PreparedStatement batched across
    every item (previously a brand-new string-built SQL statement per item)."""
    rows = [(cid, e) for cid, e in enrich.items() if e]
    if not rows:
        return 0
    # owner is fill-only in the OTHER direction (never overwrite an existing
    # owner with an enrichment-derived one); every other field fills only when
    # the column is still empty.
    setc = "[owner]=COALESCE([owner], ?), " + ", ".join(f"[{c}]=COALESCE(?, [{c}])" for c in _ENRICH_COLS[1:])
    sql = f"UPDATE dbo.Items SET {setc}, [lastSeen]=SYSUTCDATETIME() WHERE [canonicalId]=?;"
    pstmt = conn.prepareStatement(sql)
    try:
        for cid, e in rows:
            idx = 1
            for c in _ENRICH_COLS:
                _bind(pstmt, idx, e.get(c))
                idx += 1
            _bind(pstmt, idx, cid)
            pstmt.addBatch()
        pstmt.executeBatch()
    finally:
        pstmt.close()
    return len(rows)


def _fulfill_requests(conn, source, items_written, summary):
    """Mark queued MANUAL refresh requests for THIS source as fulfilled by this
    run. Filtering on both `source` and `trigger='manual'` matters once more
    than one collection connector exists: without the source filter, a pending
    request for a DIFFERENT connector (e.g. a future Databricks connector)
    would get incorrectly stamped 'succeeded' by whichever scan happens to
    finish next; without the trigger filter, a stray scheduled-trigger row
    would get mislabeled manual."""
    pstmt = conn.prepareStatement(
        "UPDATE dbo.[ScanRuns] SET [status]=N'succeeded', "
        "[startedAt]=COALESCE([startedAt], SYSUTCDATETIME()), [finishedAt]=SYSUTCDATETIME(), "
        "[itemsWritten]=?, [message]=?, [lastSeen]=SYSUTCDATETIME() "
        "WHERE [status] IN (N'requested', N'running') AND [source]=? AND [trigger]=N'manual';"
    )
    try:
        pstmt.setInt(1, int(items_written))
        _bind(pstmt, 2, summary)
        _bind(pstmt, 3, source)
        pstmt.executeUpdate()
    finally:
        pstmt.close()


def _write_scanrun(conn, run_ts, items_written, summary, status="succeeded", trigger="scheduled"):
    """Append one row to the run ledger for this execution."""
    cid = f"scanrun:fabric:{run_ts}"
    pstmt = conn.prepareStatement(
        "INSERT INTO dbo.[ScanRuns] ([id],[canonicalId],[source],[status],[trigger],"
        "[message],[itemsWritten],[startedAt],[finishedAt],[firstSeen],[lastSeen]) "
        "VALUES (NEWID(), ?, N'fabric', ?, ?, ?, ?, SYSUTCDATETIME(), SYSUTCDATETIME(), "
        "SYSUTCDATETIME(), SYSUTCDATETIME());"
    )
    try:
        _bind(pstmt, 1, cid)
        _bind(pstmt, 2, status)
        _bind(pstmt, 3, trigger)
        _bind(pstmt, 4, summary)
        pstmt.setInt(5, int(items_written))
        pstmt.executeUpdate()
    finally:
        pstmt.close()


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #
def resolve_label_names(token_fn):
    """Sensitivity label GUID->name. Graph taxonomy (needs InformationProtection
    Policy.Read.All on the scan SP) + ONELENS_LABEL_MAP env override. Best-effort.

    `token_fn` is a zero-arg CALLABLE (not a pre-fetched token) — token
    acquisition itself is guarded here, not just the subsequent HTTP calls.
    This matters because `notebookutils.credentials.getToken` for the Graph
    audience can raise from inside Fabric Spark (a confirmed, documented
    network-egress limitation, not a permissions bug) — if that raise
    happened at the CALL SITE (`resolve_label_names(sp_token(...))`, token
    fetched as an argument before this function ever runs), this function's
    own ONELENS_LABEL_MAP fallback below was never reached either, silently
    defeating the one override mechanism that's supposed to work regardless
    of Graph reachability. Fixed by moving token acquisition inside, so a
    token failure only skips the LIVE lookup, never the manual override."""
    names = {}
    try:
        token = token_fn()
    except Exception:  # noqa: BLE001 — token fetch itself can fail from Spark
        token = None
    if token:
        for url in ("https://graph.microsoft.com/v1.0/security/informationProtection/sensitivityLabels",
                    "https://graph.microsoft.com/beta/security/informationProtection/sensitivityLabels"):
            try:
                r = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=30)
                if r.ok:
                    for lab in (r.json().get("value") or []):
                        lid, nm = lab.get("id"), (lab.get("name") or lab.get("displayName"))
                        if lid and nm:
                            names[str(lid).lower()] = nm
                    if names:
                        break
            except requests.RequestException:
                continue
    raw = configured("ONELENS_LABEL_MAP")
    if raw:
        try:
            names.update({str(k).lower(): v for k, v in json.loads(raw).items()})
        except (ValueError, TypeError):
            pass
    return names


def apply_label_names(enrich, names):
    if not names:
        return 0
    n = 0
    for e in enrich.values():
        raw = e.get("sensitivityLabel")
        if raw and str(raw).lower() in names:
            e["sensitivityLabel"] = names[str(raw).lower()]
            n += 1
    return n


def check_analysis_skills(sess: requests.Session) -> list[dict]:
    """Re-verify the "Ask OneLens" Fabric Data Agent still exists, and produce
    its Connector row accordingly — the analysis-tier equivalent of the
    collection connector's self-registration (connector:fabric above). Never
    raises: a transient Fabric REST hiccup shouldn't flip a healthy connector
    to a false "planned" state, so on error this just returns [] and the
    existing row is left untouched."""
    try:
        r = sess.get(f"{FABRIC_API}/v1/workspaces/{ONELENS_ANALYSIS_WORKSPACE_ID}/dataAgents", timeout=30)
        r.raise_for_status()
        found = next((a for a in r.json().get("value", []) if a.get("displayName") == ONELENS_AGENT_NAME), None)
    except Exception as err:  # noqa: BLE001
        print(f"[connector:onelens] health check skipped (Fabric REST unavailable): {err}")
        return []
    status = "connected" if found else "planned"
    print(f"[connector:onelens] Data Agent {'found' if found else 'NOT found'} \u2192 status={status}")
    return [{
        "canonicalId": "connector:onelens", "kind": "analysis", "displayName": ONELENS_AGENT_NAME,
        "description": "Natural-language Q&A over the governance catalog via a Fabric Data Agent grounded on the Governance OneLens semantic model.",
        "status": status,
        "endpoint": f"Fabric Data Agent \u00b7 native MCP endpoint (workspace {ONELENS_ANALYSIS_WORKSPACE_ID})" if found else None,
        "credentialRef": "Delegated per-user sign-in (Entra, MSAL popup)" if found else None,
        "scope": json.dumps({"dataAgentId": found["id"]}) if found else None,
        "schedule": "Re-verified every scan run",
        "capabilities": json.dumps(["nlQuery"]),
        "itemCount": 8 if found else 0,
    }]


def _run_impl():
    sess = requests.Session()
    sess.headers["Authorization"] = f"Bearer {sp_token(FABRIC_SCOPE)}"
    ws, items, doms = collect(sess)
    print(f"[fabric-inventory] discovered: {len(ws)} workspaces, {len(items)} items, {len(doms)} domains")

    pbi = requests.Session()
    pbi.headers["Authorization"] = f"Bearer {sp_token(PBI_SCOPE)}"
    enrich, edges, role_assignments = scanner_enrich(pbi, [w["sourceId"] for w in ws])
    print(f"[lineage-capture] enriched {len(enrich)} items, {len(edges)} lineage edges, {len(role_assignments)} role assignments")

    edges += structural_edges(items)
    edges = list({e["canonicalId"]: e for e in edges}.values())
    print(f"[structural-lineage] {len(edges)} total edges (incl. store\u2194endpoint pairs)")

    shortcut_edges, shortcut_gaps = collect_shortcuts(sess, items)
    edges += shortcut_edges
    edges = list({e["canonicalId"]: e for e in edges}.values())
    print(f"[shortcuts] {len(edges)} total edges (incl. cross-workspace OneLake shortcuts); {shortcut_gaps} permission/API gaps")

    tedges, transformation_gaps = transformation_edges(sess, items)
    edges += tedges
    edges = list({e["canonicalId"]: e for e in edges}.values())
    lineage_gaps = shortcut_gaps + transformation_gaps
    print(f"[transformation] {len(edges)} total edges (incl. CopyJob/DataPipeline/Eventstream/Reflex/Ontology process lineage); {lineage_gaps} total lineage gaps")

    rh = refresh_health(pbi, items, enrich)
    print(f"[operational-health] refresh status on {rh} semantic models")

    # Sensitivity-label taxonomy is best-effort: the Graph token/egress is
    # unreliable from Spark (getToken can 500), so production deployments can
    # supply ONELENS_LABEL_MAP in the protected SJD runtime config. Never let a
    # taxonomy lookup failure fail the scan; unresolved source GUIDs remain valid.
    # Passing a callable (not a pre-fetched token) so a getToken() failure is
    # caught INSIDE resolve_label_names, where the ONELENS_LABEL_MAP override
    # can still run — see that function's docstring for why this matters.
    try:
        labels = resolve_label_names(lambda: sp_token("https://graph.microsoft.com/.default"))
        lr = apply_label_names(enrich, labels)
        print(f"[labels] taxonomy={len(labels)} resolved sensitivity labels on {lr} items")
    except Exception as label_err:  # noqa: BLE001
        print(f"[labels] skipped (Graph token/egress unavailable): {label_err}")

    cov, pos = derive(items, ws, doms, enrich, edges, role_assignments, lineage_gaps)

    conn = _jdbc_conn()
    conn.setAutoCommit(False)
    stmt = conn.createStatement()
    try:
        # Concurrency guard: a manual "Run scan now" (operator-triggered
        # deploy_sjd.py) could overlap the 02:00 UTC scheduled run. Without a
        # lock, two runs would interleave MERGE statements and the tombstone
        # sweep's pre-count/run_start watermark against the same tables,
        # risking duplicate-key races or one run's sweep deleting rows the
        # other is mid-upsert on. @LockOwner='Session' (not the default
        # 'Transaction') so the lock survives this function's many
        # intermediate commits and is only released at session end / explicit
        # release. @LockTimeout=0 fails fast instead of queueing a second scan
        # behind the first.
        stmt.execute(
            "DECLARE @lockResult INT; "
            "EXEC @lockResult = sp_getapplock @Resource='onelens-scan-lock', "
            "@LockMode='Exclusive', @LockOwner='Session', @LockTimeout=0; "
            "IF @lockResult < 0 THROW 50001, 'onelens-scan-lock not acquired \u2014 another scan run is already in progress.', 1;"
        )
        # Watermark BEFORE the merges: everything upserted this run gets a fresh
        # lastSeen; anything left older is absent from a full scan = deleted in Fabric.
        rsq = stmt.executeQuery("SELECT COUNT(*) FROM dbo.Items")
        rsq.next(); pre_count = int(rsq.getInt(1)); rsq.close()
        rsq = stmt.executeQuery("SELECT COUNT(*) FROM dbo.Workspaces")
        rsq.next(); pre_ws_count = int(rsq.getInt(1)); rsq.close()
        rsq = stmt.executeQuery("SELECT COUNT(*) FROM dbo.Domains")
        rsq.next(); pre_dom_count = int(rsq.getInt(1)); rsq.close()
        rsq = stmt.executeQuery("SELECT COUNT(*) FROM dbo.RoleAssignments")
        rsq.next(); pre_role_count = int(rsq.getInt(1)); rsq.close()
        rsq = stmt.executeQuery("SELECT CONVERT(varchar(30), SYSUTCDATETIME(), 121)")
        rsq.next(); run_start = rsq.getString(1); rsq.close()
        counts = {
            "Domains": _merge(conn, "Domains", ["canonicalId", "sourceId", "name", "description", "parentDomainCanonicalId"], doms),
            "Workspaces": _merge(conn, "Workspaces", ["canonicalId", "sourceId", "name", "type", "state", "capacityId", "domainCanonicalId"], ws),
            "Items": _merge(conn, "Items", ["canonicalId", "sourceId", "name", "itemType", "workspaceCanonicalId", "domainCanonicalId", "description", "owner", "tags", "deepLink", "sizeBytes"], items),
            "RoleAssignments": _merge(conn, "RoleAssignments", ["canonicalId", "sourceId", "principalId", "principalType", "principalDisplayName", "role", "scopeType", "scopeCanonicalId"], role_assignments),
        }
        counts["Connectors"] = _merge(conn, "Connectors", ["canonicalId", "kind", "displayName", "description", "status", "endpoint", "credentialRef", "scope", "schedule", "capabilities", "itemCount"], [{
            "canonicalId": "connector:fabric", "kind": "collection", "displayName": "Microsoft Fabric",
            "description": "Discovers workspaces, items, domains, owners, endorsement, sensitivity labels and lineage across the Fabric tenant via the admin + Power BI scanner APIs.",
            "status": "connected", "endpoint": f"{WS_NAME} (tenant-wide)",
            "credentialRef": "Fabric delegated identity (secretless)",
            "scope": json.dumps({
                "authMode": "Delegated identity via Fabric token library (no secret, no Key Vault)",
                "runsAs": "Job submitter / schedule owner (Fabric admin identity)",
                "lakehouse": LAKEHOUSE_NAME, "sparkJob": SPARKJOB_NAME,
                "capacity": CAPACITY_NAME, "workspace": WS_NAME,
            }),
            "schedule": "Daily 02:00 UTC",
            "capabilities": json.dumps(["items", "workspaces", "domains", "lineage", "accessAssignments", "posture", "incremental"]),
            "itemCount": len(items),
        }])
        counts["Connectors"] += _merge(
            conn, "Connectors",
            ["canonicalId", "kind", "displayName", "description", "status", "endpoint", "credentialRef", "scope", "schedule", "capabilities", "itemCount"],
            check_analysis_skills(sess), source="onelens",
        )
        counts["ItemsEnriched"] = _update_enrichment(conn, enrich)
        counts["LineageEdges"] = _merge(conn, "LineageEdges",
                                        ["canonicalId", "fromCanonicalId", "toCanonicalId", "relationship", "fromName", "toName", "fromType", "toType"], edges)
        counts["CoverageMetrics"] = _merge_derived(conn, "CoverageMetrics",
                                                   ["canonicalId", "metric", "scopeType", "scopeCanonicalId", "numerator", "denominator", "percent"], cov)
        counts["PostureSnapshots"] = _merge_derived(conn, "PostureSnapshots",
                                                    ["canonicalId", "signal", "scopeType", "scopeCanonicalId", "value", "status"], pos)
        counts["MetricSnapshots"] = _merge_history(conn, _history_rows(cov, pos, time.strftime("%Y%m%dT%H%M%S", time.gmtime())))
        conn.commit()
        print(f"[governance-scan] upserted: {counts}")
        # Run ledger (best-effort — never fail the scan if ScanRuns isn't migrated yet).
        try:
            summary = json.dumps({k: counts[k] for k in ("Workspaces", "Items", "LineageEdges") if k in counts})
            items_written = counts.get("Items", 0)
            _fulfill_requests(conn, "fabric", items_written, summary)
            _write_scanrun(conn, time.strftime("%Y%m%dT%H%M%S", time.gmtime()), items_written, summary)
            conn.commit()
            print("[run-ledger] recorded run + fulfilled pending requests")
        except Exception as ledger_err:  # noqa: BLE001
            conn.rollback()
            print(f"[run-ledger] skipped (ScanRuns not migrated yet?): {ledger_err}")
        # Tombstone sweep — a full tenant scan, so items not refreshed this run were
        # deleted in Fabric. Guarded so a partial/failed collection can't mass-delete.
        try:
            guard = max(10, int(0.5 * pre_count)) if pre_count else 10
            if len(items) >= guard:
                if lineage_gaps == 0:
                    del_edges = conn.prepareStatement(
                        "DELETE FROM dbo.LineageEdges WHERE source='fabric' AND lastSeen < ?")
                else:
                    del_edges = conn.prepareStatement(
                        "DELETE FROM dbo.LineageEdges WHERE fromCanonicalId IN "
                        "(SELECT canonicalId FROM dbo.Items WHERE lastSeen < ?) "
                        "OR toCanonicalId IN (SELECT canonicalId FROM dbo.Items WHERE lastSeen < ?)")
                try:
                    del_edges.setString(1, run_start)
                    if lineage_gaps:
                        del_edges.setString(2, run_start)
                    swept_edges = del_edges.executeUpdate()
                finally:
                    del_edges.close()
                del_items = conn.prepareStatement("DELETE FROM dbo.Items WHERE lastSeen < ?")
                try:
                    del_items.setString(1, run_start)
                    swept = del_items.executeUpdate()
                finally:
                    del_items.close()
                conn.commit()
                edge_scope = "stale" if lineage_gaps == 0 else "orphaned"
                print(f"[tombstone] swept {swept} stale items + {swept_edges} {edge_scope} edges (run_start={run_start})")
            else:
                conn.rollback()
                msg = f"Tombstone sweep skipped: collected {len(items)} < guard {guard} (possible partial scan). Stale items retained."
                print(f"[tombstone] SKIPPED — {msg}")
                try:
                    _write_scanrun(conn, time.strftime("%Y%m%dT%H%M%S", time.gmtime()) + "-partial",
                                   len(items), json.dumps({"warning": msg}), status="partial")
                    conn.commit()
                except Exception as pe:  # noqa: BLE001
                    conn.rollback()
                    print(f"[tombstone] partial-status record skipped: {pe}")
        except Exception as sweep_err:  # noqa: BLE001
            conn.rollback()
            print(f"[tombstone] skipped: {sweep_err}")
        # Same watermark + guard pattern for Workspaces and Domains — collect() does
        # a full, unfiltered tenant enumeration of both every run (not incremental),
        # so anything not refreshed this run was deleted in Fabric, same as Items.
        try:
            ws_guard = max(3, int(0.5 * pre_ws_count)) if pre_ws_count else 3
            if len(ws) >= ws_guard:
                del_ws = conn.prepareStatement("DELETE FROM dbo.Workspaces WHERE lastSeen < ?")
                try:
                    del_ws.setString(1, run_start)
                    swept_ws = del_ws.executeUpdate()
                finally:
                    del_ws.close()
                conn.commit()
                print(f"[tombstone] swept {swept_ws} stale workspaces (absent since run_start={run_start})")
            else:
                conn.rollback()
                print(f"[tombstone] workspace sweep SKIPPED — collected {len(ws)} < guard {ws_guard} (possible partial scan)")
        except Exception as sweep_err:  # noqa: BLE001
            conn.rollback()
            print(f"[tombstone] workspace sweep skipped: {sweep_err}")
        try:
            dom_guard = max(1, int(0.5 * pre_dom_count)) if pre_dom_count else 1
            if len(doms) >= dom_guard:
                del_dom = conn.prepareStatement("DELETE FROM dbo.Domains WHERE lastSeen < ?")
                try:
                    del_dom.setString(1, run_start)
                    swept_dom = del_dom.executeUpdate()
                finally:
                    del_dom.close()
                conn.commit()
                print(f"[tombstone] swept {swept_dom} stale domains (absent since run_start={run_start})")
            else:
                conn.rollback()
                print(f"[tombstone] domain sweep SKIPPED — collected {len(doms)} < guard {dom_guard} (possible partial scan)")
        except Exception as sweep_err:  # noqa: BLE001
            conn.rollback()
            print(f"[tombstone] domain sweep skipped: {sweep_err}")
        try:
            role_guard = max(1, int(0.5 * pre_role_count)) if pre_role_count else 1
            if len(role_assignments) >= role_guard:
                del_roles = conn.prepareStatement("DELETE FROM dbo.RoleAssignments WHERE lastSeen < ?")
                try:
                    del_roles.setString(1, run_start)
                    swept_roles = del_roles.executeUpdate()
                finally:
                    del_roles.close()
                conn.commit()
                print(f"[tombstone] swept {swept_roles} stale role assignments (absent since run_start={run_start})")
            elif pre_role_count:
                conn.rollback()
                print(f"[tombstone] role-assignment sweep SKIPPED — collected {len(role_assignments)} < guard {role_guard} (possible partial scan)")
        except Exception as sweep_err:  # noqa: BLE001
            conn.rollback()
            print(f"[tombstone] role-assignment sweep skipped: {sweep_err}")
        # Orphan cleanup: derived Coverage/Posture rows scoped to a workspace that no
        # longer exists (post-sweep) would otherwise linger forever with a frozen,
        # never-updated value. Tenant-scoped rows (scopeCanonicalId IS NULL) are unaffected.
        try:
            orphan_cov = stmt.executeUpdate(
                "DELETE FROM dbo.CoverageMetrics WHERE scopeType='workspace' AND scopeCanonicalId IS NOT NULL "
                "AND scopeCanonicalId NOT IN (SELECT canonicalId FROM dbo.Workspaces)")
            orphan_pos = stmt.executeUpdate(
                "DELETE FROM dbo.PostureSnapshots WHERE scopeType='workspace' AND scopeCanonicalId IS NOT NULL "
                "AND scopeCanonicalId NOT IN (SELECT canonicalId FROM dbo.Workspaces)")
            conn.commit()
            if orphan_cov or orphan_pos:
                print(f"[tombstone] swept {orphan_cov} orphaned coverage + {orphan_pos} orphaned posture rows (deleted workspace scope)")
        except Exception as sweep_err:  # noqa: BLE001
            conn.rollback()
            print(f"[tombstone] orphan coverage/posture sweep skipped: {sweep_err}")
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            stmt.execute("EXEC sp_releaseapplock @Resource='onelens-scan-lock', @LockOwner='Session';")
        except Exception:  # noqa: BLE001 — lock may never have been acquired; connection close releases it regardless
            pass
        stmt.close()
        conn.close()


def run():
    """Top-level entry: run the scan; on any failure, print the full traceback
    (driver stdout) and record a `failed` row in the ScanRuns ledger so the exact
    error is visible in-app instead of the opaque `state=[dead]`. Re-raises so the
    Fabric job still reports failure."""
    try:
        _run_impl()
    except Exception:
        tb = traceback.format_exc()
        print("[FATAL] scan crashed:\n" + tb)
        try:
            conn = _jdbc_conn()
            conn.setAutoCommit(True)
            _write_scanrun(conn, time.strftime("%Y%m%dT%H%M%S", time.gmtime()) + "-error", 0,
                           json.dumps({"error": tb[-1600:]}), status="failed")
            conn.close()
            print("[FATAL] recorded failure in ScanRuns ledger")
        except Exception as e2:  # noqa: BLE001
            print(f"[FATAL] could not record failure (SQL/token unreachable → likely Key Vault/auth): {e2}")
        raise


run()
