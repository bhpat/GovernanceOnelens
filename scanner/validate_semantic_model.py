"""Validate the Governance OneLens semantic model returns correct data.

Runs a handful of DAX queries via the Power BI executeQueries API and cross-checks
row counts / measures against expectations. Exit code 1 on any mismatch, so this can
be re-run after any TMDL change to catch regressions.

Usage (from repo root):
    .venv/Scripts/python.exe scanner/validate_semantic_model.py
"""

import shutil
import subprocess
import sys

import requests

from onelens_config import required_uuid

# On Windows the az CLI is az.cmd — subprocess.run(['az', ...]) without shell=True
# fails with FileNotFoundError because CreateProcess doesn't consult PATHEXT the
# way cmd.exe/PowerShell do. shutil.which resolves the real executable on every OS.
_AZ = shutil.which("az") or "az"

WORKSPACE = required_uuid("ONELENS_ANALYSIS_WORKSPACE_ID")
MODEL_NAME = "Governance OneLens Model"
API_FABRIC = "https://api.fabric.microsoft.com/v1"
API_PBI = "https://api.powerbi.com/v1.0/myorg"


def token(resource: str) -> str:
    out = subprocess.run(
        [_AZ, "account", "get-access-token", "--resource", resource, "--query", "accessToken", "-o", "tsv"],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        sys.exit(f"az token ({resource}) failed: {out.stderr}")
    return out.stdout.strip()


def find_model(sess: requests.Session) -> str:
    r = sess.get(f"{API_FABRIC}/workspaces/{WORKSPACE}/semanticModels",
                 headers={"Authorization": f"Bearer {token('https://api.fabric.microsoft.com')}"}, timeout=60)
    r.raise_for_status()
    for item in r.json().get("value", []):
        if item.get("displayName") == MODEL_NAME:
            return item["id"]
    sys.exit(f"semantic model '{MODEL_NAME}' not found in workspace {WORKSPACE}")


def dax(sess: requests.Session, model_id: str, query: str) -> dict:
    r = sess.post(
        f"{API_PBI}/groups/{WORKSPACE}/datasets/{model_id}/executeQueries",
        json={"queries": [{"query": query}], "serializerSettings": {"includeNulls": True}},
        timeout=60,
    )
    body = r.json()
    if r.status_code >= 400 or body.get("error"):
        sys.exit(f"DAX query failed: {query}\n  {body}")
    return body["results"][0]["tables"][0]["rows"][0]


def main():
    model_id = find_model(requests.Session())
    print(f"[1/3] model = {model_id}")

    sess = requests.Session()
    sess.headers["Authorization"] = f"Bearer {token('https://analysis.windows.net/powerbi/api')}"
    sess.headers["Content-Type"] = "application/json"

    failures = []

    print("[2/3] checking table row counts + governance measures …")
    row = dax(sess, model_id, (
        "EVALUATE ROW("
        '"Items", COUNTROWS(\'Item\'), '
        '"Workspaces", COUNTROWS(\'Workspace\'), '
        '"Domains", COUNTROWS(\'Domain\'), '
        '"Edges", COUNTROWS(\'Lineage Edges\'), '
        '"Ownership", [Ownership Coverage (%)], '
        '"Documentation", [Documentation Coverage (%)], '
        '"Sensitivity", [Sensitivity Coverage (%)], '
        '"Endorsement", [Endorsement Coverage (%)], '
        '"FullyGoverned", [Fully Governed (%)], '
        '"Stale", [# Stale Items], '
        '"RoleAssignments", [# Role Assignments], '
        '"AccessPrincipals", [# Access Principals])'
    ))
    print(f"      {row}")
    if row["[Items]"] <= 0:
        failures.append("Item table returned 0 rows")
    if row["[Workspaces]"] <= 0:
        failures.append("Workspace table returned 0 rows")
    if row["[Edges]"] <= 0:
        failures.append("Lineage Edges table returned 0 rows")
    if not (0 <= row["[Ownership]"] <= 1):
        failures.append(f"Ownership Coverage (%) out of range: {row['[Ownership]']}")

    print("[3/3] checking Item-Workspace relationship (cross-table filter) …")
    top = dax(sess, model_id, (
        "EVALUATE TOPN(3, SUMMARIZECOLUMNS("
        "'Workspace'[Workspace Name], \"Items\", [# Items]), [Items], DESC)"
    ))
    print(f"      {top}")

    if failures:
        print("\nFAILURES:")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)

    print("\nAll checks passed.")


if __name__ == "__main__":
    main()
