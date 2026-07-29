"""Create (or update) the Governance OneLens semantic model in Fabric.

DirectQuery over the 8 governance SQL views (live data, no refresh needed to see new
scans). Uses the interactive `az` login (workspace member) — no service-principal
secret. Walks the local TMDL definition under scanner/semantic_model/, base64-encodes
every part, and either creates a new SemanticModel item or (if one with the same
display name already exists) calls updateDefinition so this script is safely
re-runnable while the model is being iterated on.

Note: this started as a Direct Lake (on SQL) model but Fabric's Direct Lake import
validation ("DatamartInvalidData") rejected it — likely because Direct Lake is
scoped to lakehouse/warehouse SQL analytics endpoints, not a Fabric SQL Database's
primary connection. Since 100% of our tables are views (which always fall back to
DirectQuery under Direct Lake anyway), a plain DirectQuery model is functionally
identical with none of that friction. See /memories/repo/governance-foundation.md
for the full incident history.

Usage (from repo root):
    .venv/Scripts/python.exe scanner/create_semantic_model.py
"""

import base64
import shutil
import subprocess
import sys
from pathlib import Path

import requests

from fabric_lro import poll_lro
from onelens_config import required, required_uuid

# On Windows the az CLI is az.cmd — subprocess.run(['az', ...]) without shell=True
# fails with FileNotFoundError because CreateProcess doesn't consult PATHEXT the
# way cmd.exe/PowerShell do. shutil.which resolves the real executable on every OS.
_AZ = shutil.which("az") or "az"

WORKSPACE = required_uuid("ONELENS_ANALYSIS_WORKSPACE_ID")
SQL_SERVER = required("ONELENS_SQL_SERVER")
SQL_DATABASE = required("ONELENS_SQL_DB")
MODEL_NAME = "Governance OneLens Model"
MODEL_DESC = "DirectQuery semantic model over the governance catalog views (live data) — grounds Ask OneLens."
DEFINITION_ROOT = Path(__file__).parent / "semantic_model"
API = "https://api.fabric.microsoft.com/v1"
SERVER_PLACEHOLDER = "__ONELENS_SQL_SERVER__"
DATABASE_PLACEHOLDER = "__ONELENS_SQL_DB__"


def token(resource: str) -> str:
    out = subprocess.run(
        [_AZ, "account", "get-access-token", "--resource", resource, "--query", "accessToken", "-o", "tsv"],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        sys.exit(f"az token ({resource}) failed: {out.stderr}")
    return out.stdout.strip()


def _m_string(value: str) -> str:
    return value.replace('"', '""')


def build_parts() -> list[dict]:
    parts = []
    for file in sorted(DEFINITION_ROOT.rglob("*")):
        if file.is_dir():
            continue
        rel = file.relative_to(DEFINITION_ROOT).as_posix()
        data = file.read_bytes()
        if rel == "definition/expressions.tmdl":
            text = data.decode("utf-8")
            if text.count(SERVER_PLACEHOLDER) != 1 or text.count(DATABASE_PLACEHOLDER) != 1:
                raise RuntimeError("expressions.tmdl must contain exactly one SQL server and database placeholder.")
            text = text.replace(SERVER_PLACEHOLDER, _m_string(SQL_SERVER))
            text = text.replace(DATABASE_PLACEHOLDER, _m_string(SQL_DATABASE))
            data = text.encode("utf-8")
        payload = base64.b64encode(data).decode("ascii")
        parts.append({"path": rel, "payload": payload, "payloadType": "InlineBase64"})
    return parts


def find_existing(sess: requests.Session) -> str | None:
    r = sess.get(f"{API}/workspaces/{WORKSPACE}/semanticModels", timeout=60)
    r.raise_for_status()
    for item in r.json().get("value", []):
        if item.get("displayName") == MODEL_NAME:
            return item["id"]
    return None


def main():
    parts = build_parts()
    print(f"[1/3] built {len(parts)} definition parts from {DEFINITION_ROOT}")
    for p in parts:
        print(f"      - {p['path']}")

    sess = requests.Session()
    sess.headers["Authorization"] = f"Bearer {token('https://api.fabric.microsoft.com')}"
    sess.headers["Content-Type"] = "application/json"

    existing_id = find_existing(sess)
    definition = {"format": "TMDL", "parts": parts}

    if existing_id:
        print(f"[2/3] existing model found ({existing_id}) → updateDefinition …")
        resp = sess.post(
            f"{API}/workspaces/{WORKSPACE}/semanticModels/{existing_id}/updateDefinition",
            json={"definition": definition}, timeout=60,
        )
        poll_lro(sess, resp, fetch_result=False)
        model_id = existing_id
    else:
        print("[2/3] no existing model → create …")
        resp = sess.post(
            f"{API}/workspaces/{WORKSPACE}/semanticModels",
            json={"displayName": MODEL_NAME, "definition": definition},
            timeout=60,
        )
        result = poll_lro(sess, resp, fetch_result=True)
        model_id = result.get("id") or find_existing(sess)

    if not model_id:
        raise RuntimeError("Semantic model creation succeeded without returning or discovering an item id.")

    description = sess.patch(f"{API}/workspaces/{WORKSPACE}/items/{model_id}",
                             json={"description": MODEL_DESC}, timeout=60)
    description.raise_for_status()

    print(f"[3/3] done. Semantic model id = {model_id}")
    print(f"      https://app.fabric.microsoft.com/groups/{WORKSPACE}/semanticmodels/{model_id}")


if __name__ == "__main__":
    main()
