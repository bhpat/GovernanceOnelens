"""
fabric-inventory — Governance OneLens collection skill (Phase 1).

Discovers Fabric workspaces, items, and domains tenant-wide via the Fabric
**admin** REST APIs, maps them to the canonical `source="fabric"` entity model,
and upserts them into the Rayfin-managed Fabric SQL database via the **locked
direct-SQL MERGE write path** (idempotent on `canonicalId`).

This file is the local diagnostic collector, run with
`python scanner/fabric_inventory.py` using Azure CLI credentials unless an SP
secret is provided via environment variables. The production-authoritative path
is `scanner/sjd_governance_scan.py`; it additionally handles complete
enrichment, access capture, derived metrics, tombstones, locking, and run history.

Config comes from environment variables — never hard-code secrets:
  ONELENS_TENANT_ID        Entra tenant id
  ONELENS_SCAN_CLIENT_ID   scan SP app (client) id           (optional locally)
  ONELENS_SCAN_SECRET      scan SP client secret VALUE       (optional locally)
  ONELENS_SQL_SERVER       Fabric SQL server FQDN,1433
  ONELENS_SQL_DB           Fabric SQL database name
  ONELENS_PORTAL           portal base (default app.fabric.microsoft.com)

Guardrails: reads tenant-wide (auto-discovery); trimming is enforced at READ
time by the app's authenticated data policies — never by restricting this scan.
"""

from __future__ import annotations

import json
import os
import struct
import time
from dataclasses import dataclass, field
from typing import Any, Iterable

import pyodbc
import requests
from azure.identity import AzureCliCredential, ClientSecretCredential

FABRIC_API = "https://api.fabric.microsoft.com"
FABRIC_SCOPE = "https://api.fabric.microsoft.com/.default"
# The metadata **scanner API** (getInfo/scanStatus/scanResult) lives on the
# Power BI admin surface and needs a Power BI-scoped token — not the Fabric one.
PBI_API = "https://api.powerbi.com/v1.0/myorg"
PBI_SCOPE = "https://analysis.windows.net/powerbi/api/.default"
SQL_SCOPE = "https://database.windows.net/.default"
SQL_COPT_SS_ACCESS_TOKEN = 1256  # pyodbc: pass an Entra access token


# --------------------------------------------------------------------------- #
# Auth
# --------------------------------------------------------------------------- #
def get_credential():
    """SP client-credentials in production; Azure CLI identity for local dev."""
    tenant = os.environ.get("ONELENS_TENANT_ID")
    client_id = os.environ.get("ONELENS_SCAN_CLIENT_ID")
    secret = os.environ.get("ONELENS_SCAN_SECRET")
    if tenant and client_id and secret:
        return ClientSecretCredential(tenant, client_id, secret)
    return AzureCliCredential()


# --------------------------------------------------------------------------- #
# Fabric admin API (paginated GET with 429 back-off)
# --------------------------------------------------------------------------- #
def _get_paginated(session: requests.Session, url: str, list_keys: list[str]) -> Iterable[dict]:
    """Yield rows across continuation pages; honor Retry-After on 429."""
    next_url: str | None = url
    while next_url:
        resp = session.get(next_url, timeout=60)
        if resp.status_code == 429:
            wait = int(resp.headers.get("Retry-After", "20"))
            time.sleep(wait)
            continue
        resp.raise_for_status()
        body = resp.json()
        for key in list_keys:
            if key in body and isinstance(body[key], list):
                yield from body[key]
                break
        token = body.get("continuationToken")
        cont_uri = body.get("continuationUri")
        if cont_uri:
            next_url = cont_uri
        elif token:
            sep = "&" if "?" in url else "?"
            next_url = f"{url}{sep}continuationToken={token}"
        else:
            next_url = None


# --------------------------------------------------------------------------- #
# Canonical mapping (source="fabric")
# --------------------------------------------------------------------------- #
def canonical(kind: str, source_id: str) -> str:
    return f"fabric:{kind}:{source_id}"


@dataclass
class Scan:
    portal: str
    workspaces: list[dict] = field(default_factory=list)
    items: list[dict] = field(default_factory=list)
    domains: list[dict] = field(default_factory=list)

    def collect(self, session: requests.Session) -> "Scan":
        # Domains first — domain membership is NOT on the admin/workspaces payload;
        # it comes from the domains API. Build workspaceId -> domainCanonicalId so
        # both workspaces AND their items can inherit the domain.
        ws_domain: dict[str, str] = {}
        for d in _get_paginated(session, f"{FABRIC_API}/v1/admin/domains", ["domains", "value"]):
            did = d.get("id")
            if not did:
                continue
            dcid = canonical("domain", did)
            self.domains.append(
                {
                    "canonicalId": dcid,
                    "sourceId": did,
                    "name": d.get("displayName") or d.get("name") or did,
                    "description": d.get("description"),
                    "parentDomainCanonicalId": canonical("domain", d["parentDomainId"])
                    if d.get("parentDomainId")
                    else None,
                }
            )
            for w in _get_paginated(
                session, f"{FABRIC_API}/v1/admin/domains/{did}/workspaces", ["value", "workspaces"]
            ):
                wid = w.get("id")
                if wid:
                    ws_domain[wid] = dcid

        # Workspaces (tenant-wide)
        for w in _get_paginated(
            session, f"{FABRIC_API}/v1/admin/workspaces?type=Workspace", ["workspaces", "value"]
        ):
            wid = w.get("id")
            if not wid:
                continue
            self.workspaces.append(
                {
                    "canonicalId": canonical("workspace", wid),
                    "sourceId": wid,
                    "name": w.get("name") or w.get("displayName") or wid,
                    "type": w.get("type"),
                    "state": w.get("state"),
                    "capacityId": w.get("capacityId"),
                    "domainCanonicalId": ws_domain.get(wid)
                    or (canonical("domain", w["domainId"]) if w.get("domainId") else None),
                }
            )
        # Items (tenant-wide) — inherit the domain from the item's workspace
        for it in _get_paginated(
            session, f"{FABRIC_API}/v1/admin/items", ["itemEntities", "items", "value"]
        ):
            iid = it.get("id")
            if not iid:
                continue
            wid = it.get("workspaceId")
            cp = it.get("creatorPrincipal") or {}
            owner = cp.get("displayName") or (cp.get("userDetails") or {}).get("userPrincipalName")
            tag_names = [t.get("displayName") for t in (it.get("tags") or []) if isinstance(t, dict) and t.get("displayName")]
            self.items.append(
                {
                    "canonicalId": canonical("item", iid),
                    "sourceId": iid,
                    "name": it.get("name") or it.get("displayName") or iid,
                    "itemType": it.get("type") or "Unknown",
                    "workspaceCanonicalId": canonical("workspace", wid) if wid else None,
                    "domainCanonicalId": ws_domain.get(wid) if wid else None,
                    "description": it.get("description"),
                    "owner": owner,
                    "tags": json.dumps(tag_names) if tag_names else None,
                    "deepLink": f"https://{self.portal}/groups/{wid}/{_portal_path(it.get('type'))}/{iid}"
                    if wid
                    else None,
                }
            )

        # Drop items whose workspace didn't independently validate via
        # /v1/admin/workspaces?type=Workspace this same run — see the matching
        # comment in sjd_governance_scan.py's collect() for the full rationale
        # (a real "OneLake catalog governance report" ghost-workspace item was
        # confirmed live). Items with no workspace at all pass through.
        known_ws_ids = {w["canonicalId"] for w in self.workspaces}
        self.items = [i for i in self.items if not i.get("workspaceCanonicalId") or i["workspaceCanonicalId"] in known_ws_ids]
        return self


def _portal_path(item_type: str | None) -> str:
    """Best-effort Fabric portal path segment for a deep-link by item type."""
    mapping = {
        "Report": "reports",
        "SemanticModel": "datasets",
        "Dashboard": "dashboards",
        "Lakehouse": "lakehouses",
        "Notebook": "synapsenotebooks",
        "Warehouse": "datawarehouses",
    }
    return mapping.get(item_type or "", "items")


# --------------------------------------------------------------------------- #
# lineage-capture — Fabric metadata scanner (getInfo → scanStatus → scanResult)
# Enriches items with owner / endorsement / sensitivity label and captures
# source→target LineageEdge relationships. Best-effort: any failure is logged
# and skipped so the core inventory upsert still succeeds.
# --------------------------------------------------------------------------- #
def scanner_enrich(session: requests.Session, workspace_ids: list[str]) -> tuple[dict[str, dict], list[dict]]:
    enrich: dict[str, dict] = {}
    edges: list[dict] = []
    batch_size = 100
    ids = [w for w in workspace_ids if w]
    for start in range(0, len(ids), batch_size):
        batch = ids[start : start + batch_size]
        try:
            r = session.post(
                f"{PBI_API}/admin/workspaces/getInfo",
                params={"lineage": "true", "datasourceDetails": "true", "getArtifactUsers": "true"},
                json={"workspaces": batch},
                timeout=60,
            )
            r.raise_for_status()
            scan_id = (r.json() or {}).get("id")
            if not scan_id:
                continue
            for _ in range(120):
                s = session.get(f"{PBI_API}/admin/workspaces/scanStatus/{scan_id}", timeout=60)
                s.raise_for_status()
                status = (s.json() or {}).get("status")
                if status == "Succeeded":
                    break
                if status == "Failed":
                    raise RuntimeError(f"scan {scan_id} reported Failed")
                time.sleep(3)
            res = session.get(f"{PBI_API}/admin/workspaces/scanResult/{scan_id}", timeout=180)
            res.raise_for_status()
            _parse_scan(res.json() or {}, enrich, edges)
        except (requests.HTTPError, RuntimeError) as exc:
            print(f"[lineage-capture] scan batch {start // batch_size} skipped: {exc}")
    uniq = {e["canonicalId"]: e for e in edges}
    return enrich, list(uniq.values())


def _artifact_owner(art: dict) -> str | None:
    for key in ("configuredBy", "modifiedBy", "createdBy"):
        v = art.get(key)
        if isinstance(v, list) and v:
            return v[0]
        if isinstance(v, str) and v:
            return v
    for u in art.get("users", []) or []:
        right = (
            u.get("datasetUserAccessRight")
            or u.get("reportUserAccessRight")
            or u.get("dataflowUserAccessRight")
        )
        if right == "Owner" and u.get("identifier"):
            return u["identifier"]
    return None


def _parse_scan(result: dict, enrich: dict[str, dict], edges: list[dict]) -> None:
    ds_map: dict[str, tuple[str, str]] = {}
    for ds in result.get("datasourceInstances", []) or []:
        dsid = ds.get("datasourceInstanceId") or ds.get("datasourceId")
        if dsid:
            cd = ds.get("connectionDetails") or {}
            name = cd.get("server") or cd.get("path") or cd.get("url") or ds.get("datasourceType") or dsid
            ds_map[dsid] = (name, ds.get("datasourceType") or "DataSource")

    def enrich_from(art: dict) -> None:
        aid = art.get("id")
        if not aid:
            return
        e = enrich.setdefault(canonical("item", aid), {})
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

    def add_edge(frm: str | None, to: str | None, rel: str, fn=None, tn=None, ft=None, tt=None) -> None:
        if not frm or not to or frm == to:
            return
        edges.append({
            "canonicalId": f"fabric:edge:{frm}->{to}:{rel}"[:900],
            "fromCanonicalId": frm, "toCanonicalId": to, "relationship": rel,
            "fromName": fn, "toName": tn, "fromType": ft, "toType": tt,
        })

    for ws in result.get("workspaces", []) or []:
        names: dict[str, tuple[str, str]] = {}
        for arts, typ in (
            (ws.get("reports"), "Report"),
            (ws.get("datasets"), "SemanticModel"),
            (ws.get("dataflows"), "Dataflow"),
            (ws.get("dashboards"), "Dashboard"),
            (ws.get("datamarts"), "Datamart"),
        ):
            for a in arts or []:
                if a.get("id"):
                    names[a["id"]] = (a.get("name") or a["id"], typ)

        for ds in ws.get("datasets", []) or []:
            enrich_from(ds)
            did = ds.get("id")
            to_cid = canonical("item", did) if did else None
            to_nm = names.get(did, (did, "SemanticModel"))[0]
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

        for coll in ("dataflows", "dashboards", "datamarts"):
            for a in ws.get(coll, []) or []:
                enrich_from(a)

        # Everything else the scanner returns (Lakehouse/Notebook/DataAgent/
        # Eventhouse/KQLDatabase/SQLDatabase/DataPipeline/Ontology/GraphModel/
        # warehouses/AppBackend/OrgApp/...) — see sjd_governance_scan.py's
        # matching comment for the full rationale (a real "Reactor Data
        # Agent" endorsement sat unread in ws["DataAgent"] before this fix).
        _special = {"reports", "datasets", "dataflows", "dashboards", "datamarts"}
        _skip = {"users", "folders", "tags"}
        for key, value in ws.items():
            if key in _special or key in _skip or not isinstance(value, list):
                continue
            for a in value:
                if isinstance(a, dict):
                    enrich_from(a)


# --------------------------------------------------------------------------- #
# Sensitivity label taxonomy (GUID -> friendly name)
# The scanner API returns only the label GUID (labelId). Resolve names at ingest
# so the catalog stores human-readable labels. Sources merge (env wins):
#   1) Microsoft Graph taxonomy — needs `InformationProtectionPolicy.Read.All`
#      on the scan SP (best-effort; auto-updates as labels change).
#   2) ONELENS_LABEL_MAP env (JSON {guid: name}) — explicit override / offline.
# Unresolved GUIDs pass through unchanged (still a valid, if opaque, value).
# --------------------------------------------------------------------------- #
GRAPH_SCOPE = "https://graph.microsoft.com/.default"


def resolve_label_names(credential) -> dict[str, str]:
    names: dict[str, str] = {}
    try:
        tok = credential.get_token(GRAPH_SCOPE).token
        for url in (
            "https://graph.microsoft.com/v1.0/security/informationProtection/sensitivityLabels",
            "https://graph.microsoft.com/beta/security/informationProtection/sensitivityLabels",
        ):
            try:
                r = requests.get(url, headers={"Authorization": f"Bearer {tok}"}, timeout=30)
                if r.ok:
                    for lab in (r.json().get("value") or []):
                        lid = lab.get("id")
                        nm = lab.get("name") or lab.get("displayName")
                        if lid and nm:
                            names[str(lid).lower()] = nm
                    if names:
                        break
            except requests.RequestException:
                continue
    except Exception as exc:  # noqa: BLE001 - credential/permission issue is non-fatal
        print(f"[labels] graph taxonomy skipped: {exc}")
    raw = os.environ.get("ONELENS_LABEL_MAP")
    if raw:
        try:
            names.update({str(k).lower(): v for k, v in json.loads(raw).items()})
        except (ValueError, TypeError) as exc:
            print(f"[labels] ONELENS_LABEL_MAP ignored: {exc}")
    return names


def apply_label_names(enrich: dict[str, dict], names: dict[str, str]) -> int:
    """Rewrite enrich sensitivityLabel GUIDs to friendly names in place."""
    if not names:
        return 0
    n = 0
    for e in enrich.values():
        raw = e.get("sensitivityLabel")
        if raw and str(raw).lower() in names:
            e["sensitivityLabel"] = names[str(raw).lower()]
            n += 1
    return n


# --------------------------------------------------------------------------- #
# Direct-SQL MERGE (the locked write path)
# --------------------------------------------------------------------------- #
def sql_connect(credential) -> pyodbc.Connection:
    server = os.environ["ONELENS_SQL_SERVER"]
    database = os.environ["ONELENS_SQL_DB"]
    token = credential.get_token(SQL_SCOPE).token.encode("utf-16-le")
    token_struct = struct.pack(f"<I{len(token)}s", len(token), token)
    conn = pyodbc.connect(
        f"Driver={{ODBC Driver 17 for SQL Server}};Server={server};Database={database};Encrypt=yes;",
        attrs_before={SQL_COPT_SS_ACCESS_TOKEN: token_struct},
    )
    conn.autocommit = False
    return conn


def _merge(cur: pyodbc.Cursor, table: str, cols: list[str], rows: list[dict]) -> int:
    """Idempotent upsert on canonicalId. Sets firstSeen once, lastSeen every run."""
    if not rows:
        return 0
    set_clause = ", ".join(f"t.[{c}] = s.[{c}]" for c in cols if c != "canonicalId")
    insert_cols = ["id", "canonicalId", "source", *[c for c in cols if c != "canonicalId"], "firstSeen", "lastSeen"]
    insert_vals = ["NEWID()", "s.[canonicalId]", "'fabric'", *[f"s.[{c}]" for c in cols if c != "canonicalId"], "SYSUTCDATETIME()", "SYSUTCDATETIME()"]
    src_cols = ", ".join(f"? AS [{c}]" for c in cols)
    sql = (
        f"MERGE dbo.[{table}] AS t "
        f"USING (SELECT {src_cols}) AS s ON t.[canonicalId] = s.[canonicalId] "
        f"WHEN MATCHED THEN UPDATE SET {set_clause}, t.[lastSeen] = SYSUTCDATETIME() "
        f"WHEN NOT MATCHED THEN INSERT ({', '.join('[' + c + ']' for c in insert_cols)}) "
        f"VALUES ({', '.join(insert_vals)});"
    )
    cur.fast_executemany = True
    cur.executemany(sql, [tuple(r.get(c) for c in cols) for r in rows])
    return len(rows)


def upsert_all(conn: pyodbc.Connection, scan: Scan, enrich: dict[str, dict] | None = None, edges: list[dict] | None = None) -> dict[str, int]:
    counts: dict[str, int] = {}
    cur = conn.cursor()
    counts["Domains"] = _merge(cur, "Domains", ["canonicalId", "sourceId", "name", "description", "parentDomainCanonicalId"], scan.domains)
    counts["Workspaces"] = _merge(cur, "Workspaces", ["canonicalId", "sourceId", "name", "type", "state", "capacityId", "domainCanonicalId"], scan.workspaces)
    counts["Items"] = _merge(cur, "Items", ["canonicalId", "sourceId", "name", "itemType", "workspaceCanonicalId", "domainCanonicalId", "description", "owner", "tags", "deepLink"], scan.items)
    # Self-register this connector in the pluggable-source registry.
    connector = [{
        "canonicalId": "connector:fabric", "kind": "collection", "displayName": "Microsoft Fabric",
        "description": "Discovers workspaces, items, domains, owners, endorsement, sensitivity labels and lineage across the Fabric tenant via the admin + Power BI scanner APIs.",
        "status": "connected",
        "endpoint": f"{os.environ.get('ONELENS_WORKSPACE_NAME', 'Fabric governance workspace')} (tenant-wide)",
        "credentialRef": "Process identity (secret not stored)", "scope": None, "schedule": "Daily 02:00 UTC",
        "capabilities": json.dumps(["items", "workspaces", "domains", "lineage", "posture", "incremental"]),
        "itemCount": len(scan.items),
    }]
    counts["Connectors"] = _merge(cur, "Connectors", ["canonicalId", "kind", "displayName", "description", "status", "endpoint", "credentialRef", "scope", "schedule", "capabilities", "itemCount"], connector)
    if enrich:
        counts["ItemsEnriched"] = _update_items_enrichment(cur, enrich)
    if edges:
        counts["LineageEdges"] = _merge(
            cur, "LineageEdges",
            ["canonicalId", "fromCanonicalId", "toCanonicalId", "relationship", "fromName", "toName", "fromType", "toType"],
            edges,
        )
    conn.commit()
    return counts


def _update_items_enrichment(cur: pyodbc.Cursor, enrich: dict[str, dict]) -> int:
    """Patch owner / endorsement / sensitivity onto existing items (never inserts)."""
    rows = [(e.get("owner"), e.get("endorsement"), e.get("sensitivityLabel"), cid) for cid, e in enrich.items() if e]
    if not rows:
        return 0
    cur.fast_executemany = True
    cur.executemany(
        "UPDATE dbo.Items SET [owner]=COALESCE([owner], ?), [endorsement]=COALESCE(?, [endorsement]), "
        "[sensitivityLabel]=COALESCE(?, [sensitivityLabel]), [lastSeen]=SYSUTCDATETIME() WHERE [canonicalId]=?",
        rows,
    )
    return len(rows)


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #
def run() -> dict[str, int]:
    portal = os.environ.get("ONELENS_PORTAL", "app.fabric.microsoft.com")
    cred = get_credential()

    api_token = cred.get_token(FABRIC_SCOPE).token
    session = requests.Session()
    session.headers["Authorization"] = f"Bearer {api_token}"

    scan = Scan(portal=portal).collect(session)
    print(f"[fabric-inventory] discovered: {len(scan.workspaces)} workspaces, "
          f"{len(scan.items)} items, {len(scan.domains)} domains")

    pbi_session = requests.Session()
    pbi_session.headers["Authorization"] = f"Bearer {cred.get_token(PBI_SCOPE).token}"
    enrich, edges = scanner_enrich(pbi_session, [w["sourceId"] for w in scan.workspaces])
    print(f"[lineage-capture] enriched {len(enrich)} items, {len(edges)} lineage edges")

    label_names = resolve_label_names(cred)
    resolved = apply_label_names(enrich, label_names)
    print(f"[labels] taxonomy={len(label_names)} resolved sensitivity labels on {resolved} items")

    conn = sql_connect(cred)
    try:
        counts = upsert_all(conn, scan, enrich, edges)
    finally:
        conn.close()
    print(f"[fabric-inventory] upserted: {counts}")
    return counts


if __name__ == "__main__":
    run()
