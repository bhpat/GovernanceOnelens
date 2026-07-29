"""Creates the AI-facing "semantic data foundation" — a set of read-only SQL
views over the Rayfin-managed governance tables, designed to ground a DirectQuery
semantic model + Fabric Data Agent cleanly.

Why views, not the raw tables:
  - Raw entities use denormalized canonicalId string references (no real FKs),
    which a semantic model / NL2SQL agent traverses poorly. These views resolve
    them into plain, readable dimension names.
  - Raw entities will keep gaining columns over time (this project already has,
    repeatedly). Views use EXPLICIT column lists — never SELECT * — so the
    AI-facing contract only changes when we deliberately touch this file, not
    whenever the scanner schema evolves. This is the "won't break" boundary.
  - Two real data-quality issues were found while designing this and are
    handled deliberately rather than silently:
      1. Some Items reference a workspaceCanonicalId with no matching
         Workspace row (e.g., 4 of 155 today) — LEFT JOINed with an explicit
         'Unknown workspace' fallback, never dropped via an inner join.
      2. Most Items/Workspaces have no assigned Domain (real governance
         posture, not a bug) — surfaced as 'Unassigned' rather than nulled out
         or silently excluded.
  - The `Users` table (Rayfin's own auth/session data) and `Connectors`/
    `ScanRuns` (this app's own operational metadata) are deliberately EXCLUDED
    from the AI-facing surface — they aren't governance data about the
    customer's Fabric estate.

Idempotent: every view is dropped and recreated, safe to re-run any time this
file changes. Never touches or risks the underlying tables/data.
"""

import shutil
import struct
import subprocess

import pyodbc

from onelens_config import required

# On Windows the az CLI is az.cmd — subprocess.run(['az', ...]) without shell=True
# fails with FileNotFoundError because CreateProcess doesn't consult PATHEXT the
# way cmd.exe/PowerShell do. shutil.which resolves the real executable on every OS.
_AZ = shutil.which("az") or "az"

SQL_SRV = required("ONELENS_SQL_SERVER")
SQL_DB = required("ONELENS_SQL_DB")

# Same categorization as app/src/pages/LineageExplorerPage.tsx (MOVEMENT_RELS)
# — data-movement relationships vs. process/orchestration relationships — kept
# consistent so the AI's view of lineage matches what a human sees in the app.
MOVEMENT_RELS = ("Shortcut", "Reads", "Writes", "DataSource")


def sql_token() -> str:
    out = subprocess.run(
        [_AZ, "account", "get-access-token", "--resource", "https://database.windows.net", "--query", "accessToken", "-o", "tsv"],
        capture_output=True, text=True,
    )
    if out.returncode:
        raise SystemExit(out.stderr)
    return out.stdout.strip()


def connect() -> pyodbc.Connection:
    tok = sql_token().encode("utf-16-le")
    token_struct = struct.pack(f"<I{len(tok)}s", len(tok), tok)
    return pyodbc.connect(
        f"Driver={{ODBC Driver 17 for SQL Server}};Server={SQL_SRV};Database={SQL_DB};Encrypt=yes;",
        attrs_before={1256: token_struct},
    )


VIEWS: dict[str, str] = {}

VIEWS["vw_DomainDimension"] = f"""
CREATE VIEW dbo.vw_DomainDimension AS
SELECT
    d.canonicalId                              AS DomainId,
    d.name                                      AS DomainName,
    d.description                               AS DomainDescription,
    d.parentDomainCanonicalId                   AS ParentDomainId,
    pd.name                                      AS ParentDomainName
FROM dbo.Domains d
LEFT JOIN dbo.Domains pd ON pd.canonicalId = d.parentDomainCanonicalId
"""

VIEWS["vw_WorkspaceDimension"] = f"""
CREATE VIEW dbo.vw_WorkspaceDimension AS
SELECT
    w.canonicalId                               AS WorkspaceId,
    w.name                                       AS WorkspaceName,
    w.type                                        AS WorkspaceType,
    w.state                                       AS WorkspaceState,
    w.capacityId                                  AS CapacityId,
    w.domainCanonicalId                           AS DomainId,
    COALESCE(d.name, N'Unassigned')                AS DomainName
FROM dbo.Workspaces w
LEFT JOIN dbo.Domains d ON d.canonicalId = w.domainCanonicalId
"""

VIEWS["vw_ItemDimension"] = f"""
CREATE VIEW dbo.vw_ItemDimension AS
SELECT
    i.canonicalId                                AS ItemId,
    i.name                                         AS ItemName,
    i.itemType                                      AS ItemType,
    i.source                                         AS SourceSystem,
    i.description                                     AS Description,
    i.owner                                            AS Owner,
    NULLIF(i.endorsement, N'None')                      AS Endorsement,
    i.sensitivityLabel                                      AS SensitivityLabel,
    i.tags                                                  AS Tags,
    i.deepLink                                            AS DeepLink,
    i.workspaceCanonicalId                                AS WorkspaceId,
    COALESCE(w.WorkspaceName, N'Unknown workspace')        AS WorkspaceName,
    COALESCE(i.domainCanonicalId, w.DomainId)               AS DomainId,
    COALESCE(d.name, w.DomainName, N'Unassigned')            AS DomainName,
    TRY_CONVERT(datetime2(3), i.createdDate)                   AS CreatedDate,
    TRY_CONVERT(datetime2(3), i.modifiedDate)                   AS ModifiedDate,
    i.modifiedBy                                                AS ModifiedBy,
    i.refreshStatus                                              AS RefreshStatus,
    TRY_CONVERT(datetime2(3), i.lastRefresh)                       AS LastRefresh,
    i.sizeBytes                                                    AS SizeBytes,
    i.tableCount                                                    AS TableCount,
    i.columnCount                                                    AS ColumnCount,
    CASE WHEN i.owner IS NOT NULL THEN 1 ELSE 0 END                    AS HasOwner,
    CASE WHEN i.description IS NOT NULL AND i.description <> N'' THEN 1 ELSE 0 END AS HasDescription,
    CASE WHEN i.sensitivityLabel IS NOT NULL THEN 1 ELSE 0 END           AS HasSensitivityLabel,
    CASE WHEN NULLIF(i.endorsement, N'None') IS NOT NULL THEN 1 ELSE 0 END AS HasEndorsement,
    CASE WHEN i.owner IS NOT NULL
          AND i.description IS NOT NULL AND i.description <> N''
          AND i.sensitivityLabel IS NOT NULL
          AND NULLIF(i.endorsement, N'None') IS NOT NULL
         THEN 1 ELSE 0 END                                            AS IsFullyGoverned,
    CASE WHEN TRY_CONVERT(datetime2(3), i.modifiedDate) < DATEADD(day, -90, SYSUTCDATETIME())
         THEN 1 ELSE 0 END                                            AS IsStale,
    i.firstSeen                                                        AS FirstSeen,
    i.lastSeen                                                          AS LastSeen
FROM dbo.Items i
LEFT JOIN dbo.vw_WorkspaceDimension w ON w.WorkspaceId = i.workspaceCanonicalId
LEFT JOIN dbo.Domains d ON d.canonicalId = i.domainCanonicalId
"""

VIEWS["vw_LineageEdge"] = f"""
CREATE VIEW dbo.vw_LineageEdge AS
SELECT
    e.canonicalId                                AS EdgeId,
    e.fromCanonicalId                              AS FromItemId,
    COALESCE(e.fromName, e.fromCanonicalId)          AS FromItemName,
    e.fromType                                        AS FromItemType,
    e.toCanonicalId                                    AS ToItemId,
    COALESCE(e.toName, e.toCanonicalId)                  AS ToItemName,
    e.toType                                              AS ToItemType,
    e.relationship                                         AS Relationship,
    CASE WHEN e.relationship IN {MOVEMENT_RELS} THEN N'movement' ELSE N'dependency' END AS RelationshipCategory,
    e.source                                               AS SourceSystem,
    e.firstSeen                                             AS FirstSeen,
    e.lastSeen                                               AS LastSeen
FROM dbo.LineageEdges e
"""

# CoverageMetric/PostureSnapshot/MetricSnapshot all share the same scope shape
# today (scopeType is 'tenant' or 'workspace' only) — resolve consistently and
# degrade gracefully (raw id passthrough) if a new scopeType appears later.
_SCOPE_NAME_EXPR = """CASE
        WHEN {alias}.scopeType = N'tenant' THEN N'Tenant'
        WHEN {alias}.scopeType = N'workspace' THEN COALESCE(w.WorkspaceName, N'Unknown workspace')
        ELSE {alias}.scopeCanonicalId
    END"""

VIEWS["vw_CoverageFact"] = f"""
CREATE VIEW dbo.vw_CoverageFact AS
SELECT
    c.canonicalId                                AS FactId,
    c.metric                                       AS Metric,
    c.scopeType                                     AS ScopeType,
    c.scopeCanonicalId                               AS ScopeId,
    {_SCOPE_NAME_EXPR.format(alias='c')}               AS ScopeName,
    c.numerator                                        AS Numerator,
    c.denominator                                       AS Denominator,
    c.[percent]                                           AS [Percent],
    c.computedAt                                          AS ComputedAt
FROM dbo.CoverageMetrics c
LEFT JOIN dbo.vw_WorkspaceDimension w ON c.scopeType = N'workspace' AND w.WorkspaceId = c.scopeCanonicalId
"""

VIEWS["vw_PostureFact"] = f"""
CREATE VIEW dbo.vw_PostureFact AS
SELECT
    p.canonicalId                                AS FactId,
    p.signal                                       AS Signal,
    p.scopeType                                     AS ScopeType,
    p.scopeCanonicalId                               AS ScopeId,
    {_SCOPE_NAME_EXPR.format(alias='p')}               AS ScopeName,
    p.value                                            AS Value,
    p.status                                            AS Status,
    p.computedAt                                         AS ComputedAt
FROM dbo.PostureSnapshots p
LEFT JOIN dbo.vw_WorkspaceDimension w ON p.scopeType = N'workspace' AND w.WorkspaceId = p.scopeCanonicalId
"""

VIEWS["vw_MetricHistoryFact"] = f"""
CREATE VIEW dbo.vw_MetricHistoryFact AS
SELECT
    m.canonicalId                                AS FactId,
    m.kind                                         AS Kind,
    m.metric                                        AS Metric,
    m.scopeType                                      AS ScopeType,
    m.scopeCanonicalId                                AS ScopeId,
    {_SCOPE_NAME_EXPR.format(alias='m')}                AS ScopeName,
    m.value                                             AS Value,
    m.numerator                                          AS Numerator,
    m.denominator                                         AS Denominator,
    m.capturedAt                                           AS CapturedAt
FROM dbo.MetricSnapshots m
LEFT JOIN dbo.vw_WorkspaceDimension w ON m.scopeType = N'workspace' AND w.WorkspaceId = m.scopeCanonicalId
"""

VIEWS["vw_RoleAssignmentFact"] = f"""
CREATE VIEW dbo.vw_RoleAssignmentFact AS
SELECT
    r.canonicalId                                AS FactId,
    r.principalId                                  AS PrincipalId,
    COALESCE(r.principalDisplayName, r.principalId) AS PrincipalName,
    r.principalType                                  AS PrincipalType,
    r.role                                            AS Role,
    r.scopeType                                        AS ScopeType,
    r.scopeCanonicalId                                  AS ScopeId,
    CASE
        WHEN r.scopeType = N'Workspace' THEN COALESCE(w.WorkspaceName, N'Unknown workspace')
        WHEN r.scopeType = N'Item' THEN COALESCE(i.ItemName, N'Unknown item')
        WHEN r.scopeType = N'Domain' THEN COALESCE(d.name, N'Unknown domain')
        ELSE r.scopeCanonicalId
    END                                                   AS ScopeName,
    r.firstSeen                                             AS FirstSeen,
    r.lastSeen                                               AS LastSeen
FROM dbo.RoleAssignments r
LEFT JOIN dbo.vw_WorkspaceDimension w ON r.scopeType = N'Workspace' AND w.WorkspaceId = r.scopeCanonicalId
LEFT JOIN dbo.vw_ItemDimension i ON r.scopeType = N'Item' AND i.ItemId = r.scopeCanonicalId
LEFT JOIN dbo.Domains d ON r.scopeType = N'Domain' AND d.canonicalId = r.scopeCanonicalId
"""

# Dependency order matters for DROP (reverse) and CREATE (forward): Item/Coverage/
# Posture/History/RoleAssignment views reference WorkspaceDimension.
CREATE_ORDER = [
    "vw_DomainDimension",
    "vw_WorkspaceDimension",
    "vw_ItemDimension",
    "vw_LineageEdge",
    "vw_CoverageFact",
    "vw_PostureFact",
    "vw_MetricHistoryFact",
    "vw_RoleAssignmentFact",
]


def run():
    conn = connect()
    conn.autocommit = True
    stmt = conn.cursor()
    for name in reversed(CREATE_ORDER):
        stmt.execute(f"IF OBJECT_ID('dbo.{name}', 'V') IS NOT NULL DROP VIEW dbo.{name};")
    for name in CREATE_ORDER:
        stmt.execute(VIEWS[name])
        print(f"created dbo.{name}")
    stmt.close()
    conn.close()
    print("DONE")


if __name__ == "__main__":
    run()
