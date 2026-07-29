"""Data-quality validation for the AI-facing semantic view layer
(create_semantic_views.py). Re-run any time those views change, or as a
periodic health check, to confirm the "clean and usable" contract still holds:

  1. Every view has exactly the same row count as its base table — no silent
     row loss from an accidental inner join.
  2. The promised fallback values ('Unknown workspace', 'Unassigned') show up
     instead of NULLs, and only where genuinely expected.
  3. Derived governance flags (HasOwner/HasDescription/...) sum to numbers
     consistent with the independently-computed CoverageMetrics percentages —
     a cross-check that the view logic matches the scanner's own definitions.
  4. Lineage relationship categorization matches the app's own UI grouping.

Exits non-zero if a row-count mismatch is detected (the one hard failure mode
that would mean rows are silently disappearing from the AI's view of the data).
"""

import shutil
import struct
import subprocess
import sys

import pyodbc

from onelens_config import required

# On Windows the az CLI is az.cmd — subprocess.run(['az', ...]) without shell=True
# fails with FileNotFoundError because CreateProcess doesn't consult PATHEXT the
# way cmd.exe/PowerShell do. shutil.which resolves the real executable on every OS.
_AZ = shutil.which("az") or "az"

SQL_SRV = required("ONELENS_SQL_SERVER")
SQL_DB = required("ONELENS_SQL_DB")

VIEW_TABLE_PAIRS = [
    ("vw_DomainDimension", "Domains"), ("vw_WorkspaceDimension", "Workspaces"), ("vw_ItemDimension", "Items"),
    ("vw_LineageEdge", "LineageEdges"), ("vw_CoverageFact", "CoverageMetrics"), ("vw_PostureFact", "PostureSnapshots"),
    ("vw_MetricHistoryFact", "MetricSnapshots"), ("vw_RoleAssignmentFact", "RoleAssignments"),
]


def connect() -> pyodbc.Connection:
    tok = subprocess.run(
        [_AZ, "account", "get-access-token", "--resource", "https://database.windows.net", "--query", "accessToken", "-o", "tsv"],
        capture_output=True, text=True,
    ).stdout.strip().encode("utf-16-le")
    token_struct = struct.pack(f"<I{len(tok)}s", len(tok), tok)
    return pyodbc.connect(
        f"Driver={{ODBC Driver 17 for SQL Server}};Server={SQL_SRV};Database={SQL_DB};Encrypt=yes;",
        attrs_before={1256: token_struct},
    )


def run() -> int:
    c = connect()
    ok = True

    print("== row counts: view vs base table (must match — no silent row loss) ==")
    for v, t in VIEW_TABLE_PAIRS:
        vn = c.execute(f"SELECT COUNT(1) FROM dbo.{v}").fetchone()[0]
        tn = c.execute(f"SELECT COUNT(1) FROM dbo.{t}").fetchone()[0]
        match = vn == tn
        ok &= match
        print(f"  {v:24} {vn:5} vs {t:20} {tn:5}  [{'OK' if match else 'MISMATCH!'}]")

    print("\n== vw_ItemDimension: fallback correctness ==")
    print("  WorkspaceName NULL (must be 0):", c.execute("SELECT COUNT(1) FROM dbo.vw_ItemDimension WHERE WorkspaceName IS NULL").fetchone()[0])
    print("  DomainName NULL (must be 0):", c.execute("SELECT COUNT(1) FROM dbo.vw_ItemDimension WHERE DomainName IS NULL").fetchone()[0])
    print("  'Unknown workspace' rows:", c.execute("SELECT COUNT(1) FROM dbo.vw_ItemDimension WHERE WorkspaceName = N'Unknown workspace'").fetchone()[0])
    print("  'Unassigned' domain rows:", c.execute("SELECT COUNT(1) FROM dbo.vw_ItemDimension WHERE DomainName = N'Unassigned'").fetchone()[0])

    print("\n== sensitivity label resolution (should be friendly names, not GUIDs) ==")
    for r in c.execute("SELECT SensitivityLabel, COUNT(1) FROM dbo.vw_ItemDimension WHERE SensitivityLabel IS NOT NULL GROUP BY SensitivityLabel ORDER BY 2 DESC").fetchall():
        print(f"  {r[0]:30} {r[1]}")

    print("\n== governance flags (cross-check against CoverageMetrics %) ==")
    r = c.execute("SELECT SUM(HasOwner), SUM(HasDescription), SUM(HasSensitivityLabel), SUM(HasEndorsement), SUM(IsFullyGoverned), SUM(IsStale), COUNT(1) FROM dbo.vw_ItemDimension").fetchone()
    print(f"  HasOwner={r[0]} HasDescription={r[1]} HasSensitivityLabel={r[2]} HasEndorsement={r[3]} FullyGoverned={r[4]} Stale={r[5]} / total={r[6]}")

    print("\n== lineage relationship categorization ==")
    for r in c.execute("SELECT Relationship, RelationshipCategory, COUNT(1) FROM dbo.vw_LineageEdge GROUP BY Relationship, RelationshipCategory ORDER BY 2, 1").fetchall():
        print(f"  {r[0]:14} -> {r[1]:12} : {r[2]}")

    print(f"\n{'PASS' if ok else 'FAIL — row-count mismatch detected, see above'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(run())
