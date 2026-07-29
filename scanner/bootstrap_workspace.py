"""Bootstrap a Fabric workspace + Lakehouse + Spark Job Definition item from
scratch — the pieces every other scanner deployment script (`deploy_sjd.py`,
`create_semantic_views.py`, `create_semantic_model.py`, ...) assumes ALREADY
exist via required `ONELENS_WORKSPACE_ID`/`ONELENS_SJD_ID` env vars.

This closes the one real "brand new environment" gap found in the 2026-07-23
architecture audit: nothing else in this repo creates the initial Fabric
workspace/lakehouse/SJD item — everything else only uploads code/config INTO
ones that already exist. Without this script, standing up a fresh deployment
meant manually clicking through the Fabric portal to create these three items
before any of the documented `scanner/README.md` steps could even start.

Idempotent — safe to re-run against a workspace that already has some or all
of these pieces (looks each up by display name before creating anything).

Usage (brand-new workspace):
    python scanner/bootstrap_workspace.py --workspace-name "My-Governance-Workspace" --capacity-name "Fabric capacity"

Usage (add the lakehouse/SJD to an EXISTING workspace):
    python scanner/bootstrap_workspace.py --workspace-id <existing-workspace-guid>

Prints the resulting ONELENS_WORKSPACE_ID / ONELENS_SJD_ID values. Set those
(plus ONELENS_SQL_SERVER/ONELENS_SQL_DB from the Rayfin-generated SQL database —
see README.md) before running `deploy_sjd.py`, which uploads the real scanner
code, wires the runtime config, and triggers the first scan. This script
deliberately stops at "empty shell exists" rather than reimplementing that
already-battle-tested upload/config logic.
"""

import argparse
import base64
import json
import shutil
import subprocess
import sys

import requests

from fabric_lro import poll_lro

_AZ = shutil.which("az") or "az"
API = "https://api.fabric.microsoft.com"

DEFAULT_LAKEHOUSE_NAME = "onelens_scan_lh"
DEFAULT_SJD_NAME = "governance-onelens-scan"
# A syntactically-valid, deliberately inert placeholder definition — SJD items
# require SOME definition to be created at all, but the real executableFile
# path needs this item's own (not-yet-known) id, so it's filled in via a
# separate updateDefinition call once the item exists (see ensure_sjd_shell).
_PLACEHOLDER_SJD_JSON = (
    b'{"executableFile":"","defaultLakehouseArtifactId":"","mainClass":"",'
    b'"additionalLakehouseIds":[],"retryPolicy":null,"commandLineArguments":"",'
    b'"additionalLibraryUris":[],"language":"Python","environmentArtifactId":null}'
)


def token(resource: str) -> str:
    out = subprocess.run(
        [_AZ, "account", "get-access-token", "--resource", resource, "--query", "accessToken", "-o", "tsv"],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        sys.exit(f"az token ({resource}) failed: {out.stderr}")
    return out.stdout.strip()


def _session() -> requests.Session:
    sess = requests.Session()
    sess.headers["Authorization"] = f"Bearer {token(API)}"
    return sess


def find_capacity_id(fab: requests.Session, capacity_name: str) -> str:
    r = fab.get(f"{API}/v1/capacities", timeout=60)
    r.raise_for_status()
    for c in r.json().get("value", []):
        if c.get("displayName") == capacity_name:
            return c["id"]
    sys.exit(f"No capacity named '{capacity_name}' visible to this identity. "
              f"Pass --capacity-id directly, or check the name/your permissions on it.")


def find_workspace(fab: requests.Session, name: str) -> dict | None:
    for w in _paginated(fab, f"{API}/v1/workspaces"):
        if w.get("displayName") == name:
            return w
    return None


def _paginated(fab: requests.Session, url: str):
    nxt = url
    while nxt:
        r = fab.get(nxt, timeout=60)
        r.raise_for_status()
        body = r.json()
        yield from body.get("value", [])
        token_ = body.get("continuationToken")
        nxt = f"{url}{'&' if '?' in url else '?'}continuationToken={token_}" if token_ else None


def ensure_workspace(fab: requests.Session, name: str, capacity_id: str | None) -> str:
    existing = find_workspace(fab, name)
    if existing:
        print(f"  workspace '{name}' already exists: {existing['id']}")
        return existing["id"]
    body: dict = {"displayName": name}
    if capacity_id:
        body["capacityId"] = capacity_id
    r = fab.post(f"{API}/v1/workspaces", json=body, timeout=60)
    if r.status_code == 202:
        result = poll_lro(fab, r, fetch_result=True)
    elif r.status_code in (200, 201):
        result = r.json()
    else:
        sys.exit(f"Workspace create failed {r.status_code}: {r.text[:400]}")
    wsid = result.get("id")
    if not wsid:
        sys.exit(f"Workspace create returned no id: {result}")
    print(f"  created workspace '{name}': {wsid}")
    return wsid


def ensure_lakehouse(fab: requests.Session, workspace_id: str, name: str) -> str:
    for it in _paginated(fab, f"{API}/v1/workspaces/{workspace_id}/items?type=Lakehouse"):
        if it.get("displayName") == name:
            print(f"  lakehouse '{name}' already exists: {it['id']}")
            return it["id"]
    r = fab.post(f"{API}/v1/workspaces/{workspace_id}/lakehouses", json={"displayName": name}, timeout=60)
    result = poll_lro(fab, r, fetch_result=True) if r.status_code == 202 else r.json()
    lhid = result.get("id")
    if not lhid:
        sys.exit(f"Lakehouse create returned no id: {r.status_code} {r.text[:400]}")
    print(f"  created lakehouse '{name}': {lhid}")
    return lhid


def ensure_sjd_shell(fab: requests.Session, workspace_id: str, name: str, lakehouse_id: str) -> str:
    """Create the SJD item if it doesn't exist, then point its definition at
    the real lakehouse binding + this item's own executableFile path (only
    knowable after the item exists). Returns the item id either way."""
    for it in _paginated(fab, f"{API}/v1/workspaces/{workspace_id}/items?type=SparkJobDefinition"):
        if it.get("displayName") == name:
            print(f"  Spark Job Definition '{name}' already exists: {it['id']}")
            return it["id"]

    body = {
        "displayName": name,
        "definition": {"parts": [{
            "path": "SparkJobDefinitionV1.json",
            "payload": base64.b64encode(_PLACEHOLDER_SJD_JSON).decode("ascii"),
            "payloadType": "InlineBase64",
        }]},
    }
    r = fab.post(f"{API}/v1/workspaces/{workspace_id}/sparkJobDefinitions", json=body, timeout=60)
    if r.status_code == 202:
        result = poll_lro(fab, r, fetch_result=True)
        sjd_id = result.get("id")
        if not sjd_id:
            # Some Fabric item-creation LROs return no body; the item still
            # exists — look it up by name to recover its id.
            match = next((it for it in _paginated(fab, f"{API}/v1/workspaces/{workspace_id}/items?type=SparkJobDefinition")
                          if it.get("displayName") == name), None)
            sjd_id = match["id"] if match else None
    elif r.status_code in (200, 201):
        sjd_id = r.json().get("id")
    else:
        sys.exit(f"Spark Job Definition create failed {r.status_code}: {r.text[:400]}")
    if not sjd_id:
        sys.exit("Spark Job Definition create succeeded but no item id could be resolved.")
    print(f"  created Spark Job Definition '{name}': {sjd_id}")

    # Now that the item id is known, wire the REAL executableFile path + the
    # default lakehouse binding (Fabric hard-requires this for the job to ever
    # run — a lesson learned the hard way earlier in this project's history).
    sjd_json = {
        "executableFile": f"abfss://{workspace_id}@onelake.dfs.fabric.microsoft.com/{sjd_id}/Main/sjd_governance_scan.py",
        "defaultLakehouseArtifactId": lakehouse_id,
        "mainClass": "",
        "additionalLakehouseIds": [],
        "retryPolicy": None,
        "commandLineArguments": "",
        "additionalLibraryUris": [],
        "language": "Python",
        "environmentArtifactId": None,
    }
    upd = fab.post(
        f"{API}/v1/workspaces/{workspace_id}/items/{sjd_id}/updateDefinition",
        json={"definition": {"parts": [{
            "path": "SparkJobDefinitionV1.json",
            "payload": base64.b64encode(json.dumps(sjd_json).encode("utf-8")).decode("ascii"),
            "payloadType": "InlineBase64",
        }]}},
        timeout=60,
    )
    poll_lro(fab, upd)
    print(f"  bound '{name}' to lakehouse {lakehouse_id} and set its executableFile path")
    return sjd_id


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace-id", help="Use an existing workspace instead of creating one.")
    parser.add_argument("--workspace-name", help="Display name for a new workspace (ignored if --workspace-id is set).")
    parser.add_argument("--capacity-id", help="Capacity to assign a NEW workspace to.")
    parser.add_argument("--capacity-name", help="Look up --capacity-id by capacity display name instead.")
    parser.add_argument("--lakehouse-name", default=DEFAULT_LAKEHOUSE_NAME)
    parser.add_argument("--sjd-name", default=DEFAULT_SJD_NAME)
    args = parser.parse_args()

    if not args.workspace_id and not args.workspace_name:
        sys.exit("Pass either --workspace-id (existing workspace) or --workspace-name (create new).")

    fab = _session()

    capacity_id = args.capacity_id
    if not capacity_id and args.capacity_name:
        capacity_id = find_capacity_id(fab, args.capacity_name)

    print("[1/3] workspace …")
    workspace_id = args.workspace_id or ensure_workspace(fab, args.workspace_name, capacity_id)

    print("[2/3] lakehouse …")
    lakehouse_id = ensure_lakehouse(fab, workspace_id, args.lakehouse_name)

    print("[3/3] Spark Job Definition shell …")
    sjd_id = ensure_sjd_shell(fab, workspace_id, args.sjd_name, lakehouse_id)

    print("\nDone. Set these before running deploy_sjd.py (see scanner/README.md 'Deploy In Order'):\n")
    print(f"  $env:ONELENS_WORKSPACE_ID = '{workspace_id}'")
    print(f"  $env:ONELENS_SJD_ID = '{sjd_id}'")
    print(f"  $env:ONELENS_ANALYSIS_WORKSPACE_ID = '{workspace_id}'  # or a separate analysis workspace id")
    print("  $env:ONELENS_SQL_SERVER = '<from the Rayfin-generated SQL database item>'")
    print("  $env:ONELENS_SQL_DB = '<from the Rayfin-generated SQL database item>'")


if __name__ == "__main__":
    main()
