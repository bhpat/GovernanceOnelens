"""
four-lens-scorecard (derivation) — Governance OneLens analysis skill (Phase 2).

Reads the catalog (Items / Workspaces / Domains) and computes DERIVED
governance metrics for two of the four lenses:

  - Coverage lens  -> CoverageMetric  (% labeled / endorsed / described / …)
  - Posture  lens  -> PostureSnapshot (item/workspace counts, orphans, …)

Metrics are computed with SQL aggregates and upserted via the same locked
direct-SQL MERGE path used by the scanner. Run after `fabric_inventory`.

Production note: the scheduled `sjd_governance_scan.py` Spark Job Definition
derives the *same* coverage + posture metrics in one pass (from the freshly
written rows) — keep the metric set/names/status thresholds here in sync with it.

A 0% coverage number is a legitimate governance finding (a gap), not an error —
OneLens surfaces the gap so stewards can close it.

Env: ONELENS_SQL_SERVER, ONELENS_SQL_DB (auth via Azure CLI locally, or SP env
vars ONELENS_TENANT_ID / ONELENS_SCAN_CLIENT_ID / ONELENS_SCAN_SECRET).
"""

from __future__ import annotations

import os
import struct
from datetime import datetime, timezone

import pyodbc
from azure.identity import AzureCliCredential, ClientSecretCredential

SQL_SCOPE = "https://database.windows.net/.default"
SQL_COPT_SS_ACCESS_TOKEN = 1256


def _credential():
    t, c, s = (os.environ.get(k) for k in ("ONELENS_TENANT_ID", "ONELENS_SCAN_CLIENT_ID", "ONELENS_SCAN_SECRET"))
    return ClientSecretCredential(t, c, s) if (t and c and s) else AzureCliCredential()


def _connect(cred) -> pyodbc.Connection:
    tok = cred.get_token(SQL_SCOPE).token.encode("utf-16-le")
    ts = struct.pack(f"<I{len(tok)}s", len(tok), tok)
    driver = next((d for d in ("ODBC Driver 18 for SQL Server", "ODBC Driver 17 for SQL Server") if d in pyodbc.drivers()), "ODBC Driver 17 for SQL Server")
    return pyodbc.connect(
        f"Driver={{{driver}}};Server={os.environ['ONELENS_SQL_SERVER']};Database={os.environ['ONELENS_SQL_DB']};Encrypt=yes;",
        attrs_before={SQL_COPT_SS_ACCESS_TOKEN: ts},
    )


def _pct(num: int, den: int) -> float:
    return round(100.0 * num / den, 1) if den else 0.0


def _coverage_status(pct: float) -> str:
    return "ok" if pct >= 95 else "warn" if pct >= 50 else "critical"


def compute(cur) -> tuple[list[dict], list[dict]]:
    now = datetime.now(timezone.utc)
    cov, pos = [], []

    def cov_row(metric, num, den):
        cov.append({
            "canonicalId": f"derived:coverage:{metric}:tenant",
            "metric": metric, "scopeType": "tenant",
            "numerator": int(num), "denominator": int(den),
            "percent": _pct(num, den), "computedAt": now,
        })

    def pos_row(signal, value, status):
        pos.append({
            "canonicalId": f"derived:posture:{signal}:tenant",
            "signal": signal, "scopeType": "tenant",
            "value": float(value), "status": status, "computedAt": now,
        })

    # --- Item coverage (tenant) ---
    cur.execute("""
        SELECT COUNT(*) total,
          SUM(CASE WHEN description IS NOT NULL AND description<>'' THEN 1 ELSE 0 END) described,
          SUM(CASE WHEN sensitivityLabel IS NOT NULL THEN 1 ELSE 0 END) labeled,
          SUM(CASE WHEN endorsement IS NOT NULL AND endorsement<>'None' THEN 1 ELSE 0 END) endorsed,
          SUM(CASE WHEN owner IS NOT NULL THEN 1 ELSE 0 END) owned
        FROM dbo.Items""")
    r = cur.fetchone()
    total, described, labeled, endorsed, owned = (r[0] or 0, r[1] or 0, r[2] or 0, r[3] or 0, r[4] or 0)
    cov_row("sensitivityLabeled", labeled, total)
    cov_row("endorsed", endorsed, total)
    cov_row("described", described, total)
    cov_row("owned", owned, total)

    # --- Workspace domain coverage ---
    cur.execute("SELECT COUNT(*) total, SUM(CASE WHEN domainCanonicalId IS NOT NULL THEN 1 ELSE 0 END) inDomain FROM dbo.Workspaces")
    w = cur.fetchone()
    ws_total, ws_domain = (w[0] or 0, w[1] or 0)
    cov.append({
        "canonicalId": "derived:coverage:domainAssigned:tenant", "metric": "domainAssigned",
        "scopeType": "tenant", "numerator": int(ws_domain), "denominator": int(ws_total),
        "percent": _pct(ws_domain, ws_total), "computedAt": now,
    })

    cur.execute("SELECT COUNT(*) FROM dbo.Domains")
    dom_total = cur.fetchone()[0] or 0
    cur.execute("SELECT COUNT(DISTINCT itemType) FROM dbo.Items")
    type_count = cur.fetchone()[0] or 0

    # --- Lineage completeness (coverage lens): eligible assets with >=1 edge ---
    lineage_types = "'Report','SemanticModel','Dataflow','Datamart','PaginatedReport'"
    edge_total = 0
    try:
        cur.execute(f"""
            SELECT
              (SELECT COUNT(*) FROM dbo.Items WHERE itemType IN ({lineage_types})) AS eligible,
              (SELECT COUNT(DISTINCT i.canonicalId)
                 FROM dbo.Items i
                 JOIN (SELECT fromCanonicalId AS cid FROM dbo.LineageEdges
                       UNION SELECT toCanonicalId FROM dbo.LineageEdges) e
                   ON e.cid = i.canonicalId
                WHERE i.itemType IN ({lineage_types})) AS connected,
              (SELECT COUNT(*) FROM dbo.LineageEdges) AS edges""")
        lr = cur.fetchone()
        lineage_eligible, lineage_connected, edge_total = (lr[0] or 0, lr[1] or 0, lr[2] or 0)
        cov.append({
            "canonicalId": "derived:coverage:lineageComplete:tenant", "metric": "lineageComplete",
            "scopeType": "tenant", "numerator": int(lineage_connected), "denominator": int(lineage_eligible),
            "percent": _pct(lineage_connected, lineage_eligible), "computedAt": now,
        })
    except pyodbc.Error:
        pass  # LineageEdges table not yet provisioned

    # --- Posture (tenant) ---
    pos_row("itemCount", total, "ok")
    pos_row("workspaceCount", ws_total, "ok")
    pos_row("domainCount", dom_total, "ok" if dom_total > 0 else "warn")
    pos_row("itemTypeCount", type_count, "ok")
    pos_row("lineageEdges", edge_total, "ok" if edge_total > 0 else "warn")

    # --- Per-workspace rollups (scopeType='workspace') ---
    # No native workspace sensitivity label exists in Fabric — a workspace's
    # governance is the aggregate of its items' signals (labeled/endorsed/…) plus
    # its sensitive-item count and distinct-label count.
    cur.execute("""
        SELECT workspaceCanonicalId,
          COUNT(*) total,
          SUM(CASE WHEN description IS NOT NULL AND description<>'' THEN 1 ELSE 0 END) described,
          SUM(CASE WHEN sensitivityLabel IS NOT NULL THEN 1 ELSE 0 END) labeled,
          SUM(CASE WHEN endorsement IS NOT NULL AND endorsement<>'None' THEN 1 ELSE 0 END) endorsed,
          SUM(CASE WHEN owner IS NOT NULL THEN 1 ELSE 0 END) owned,
          COUNT(DISTINCT sensitivityLabel) distinctLabels
        FROM dbo.Items WHERE workspaceCanonicalId IS NOT NULL
        GROUP BY workspaceCanonicalId""")
    for row in cur.fetchall():
        ws_cid = row[0]
        wtot, wdesc, wlab, wend, wown, wdistinct = (row[1] or 0, row[2] or 0, row[3] or 0, row[4] or 0, row[5] or 0, row[6] or 0)
        for metric, num in (("sensitivityLabeled", wlab), ("endorsed", wend), ("described", wdesc), ("owned", wown)):
            cov.append({
                "canonicalId": f"derived:coverage:{metric}:workspace:{ws_cid}", "metric": metric,
                "scopeType": "workspace", "scopeCanonicalId": ws_cid,
                "numerator": int(num), "denominator": int(wtot), "percent": _pct(num, wtot), "computedAt": now,
            })
        for signal, val, status in (("itemCount", wtot, "ok"), ("sensitiveItemCount", wlab, "ok" if wlab > 0 else "warn"), ("distinctLabelCount", wdistinct, "ok")):
            pos.append({
                "canonicalId": f"derived:posture:{signal}:workspace:{ws_cid}", "signal": signal,
                "scopeType": "workspace", "scopeCanonicalId": ws_cid,
                "value": float(val), "status": status, "computedAt": now,
            })
    return cov, pos


def _merge(cur, table, cols, rows):
    if not rows:
        return 0
    setc = ", ".join(f"t.[{c}]=s.[{c}]" for c in cols if c != "canonicalId")
    ins = ["id", "canonicalId", "source", *[c for c in cols if c != "canonicalId"]]
    vals = ["NEWID()", "s.[canonicalId]", "'derived'", *[f"s.[{c}]" for c in cols if c != "canonicalId"]]
    src = ", ".join(f"? AS [{c}]" for c in cols)
    sql = (f"MERGE dbo.[{table}] AS t USING (SELECT {src}) AS s ON t.[canonicalId]=s.[canonicalId] "
           f"WHEN MATCHED THEN UPDATE SET {setc} "
           f"WHEN NOT MATCHED THEN INSERT ({', '.join('['+c+']' for c in ins)}) VALUES ({', '.join(vals)});")
    cur.fast_executemany = True
    cur.executemany(sql, [tuple(r.get(c) for c in cols) for r in rows])
    return len(rows)


def _history_rows(cov, pos):
    """One append-only time-series point per metric per run (keyed by run ts)."""
    rows = []
    for c in cov:
        ts = c["computedAt"].strftime("%Y%m%dT%H%M%S")
        scope = c.get("scopeCanonicalId") or "tenant"
        rows.append({
            "canonicalId": f"derived:history:coverage:{c['metric']}:{c['scopeType']}:{scope}:{ts}",
            "kind": "coverage", "metric": c["metric"], "scopeType": c["scopeType"],
            "scopeCanonicalId": c.get("scopeCanonicalId"), "value": c["percent"],
            "numerator": c["numerator"], "denominator": c["denominator"], "capturedAt": c["computedAt"],
        })
    for p in pos:
        ts = p["computedAt"].strftime("%Y%m%dT%H%M%S")
        scope = p.get("scopeCanonicalId") or "tenant"
        rows.append({
            "canonicalId": f"derived:history:posture:{p['signal']}:{p['scopeType']}:{scope}:{ts}",
            "kind": "posture", "metric": p["signal"], "scopeType": p["scopeType"],
            "scopeCanonicalId": p.get("scopeCanonicalId"), "value": p["value"],
            "numerator": None, "denominator": None, "capturedAt": p["computedAt"],
        })
    return rows


def run() -> dict[str, int]:
    cred = _credential()
    conn = _connect(cred)
    conn.autocommit = False
    cur = conn.cursor()
    try:
        cov, pos = compute(cur)
        n_c = _merge(cur, "CoverageMetrics", ["canonicalId", "metric", "scopeType", "scopeCanonicalId", "numerator", "denominator", "percent", "computedAt"], cov)
        n_p = _merge(cur, "PostureSnapshots", ["canonicalId", "signal", "scopeType", "scopeCanonicalId", "value", "status", "computedAt"], pos)
        n_h = _merge(cur, "MetricSnapshots", ["canonicalId", "kind", "metric", "scopeType", "scopeCanonicalId", "value", "numerator", "denominator", "capturedAt"], _history_rows(cov, pos))
        conn.commit()
    finally:
        conn.close()
    print(f"[four-lens-scorecard] upserted: CoverageMetric={n_c}, PostureSnapshot={n_p}, MetricSnapshot={n_h}")
    return {"CoverageMetric": n_c, "PostureSnapshot": n_p, "MetricSnapshot": n_h}


if __name__ == "__main__":
    run()
