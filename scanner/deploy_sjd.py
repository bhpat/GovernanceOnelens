"""Deploy the local scanner into the Fabric Spark Job Definition + trigger a run.

Uses the interactive `az` login (workspace member) — no service-principal secret.
The SJD's executable lives in OneLake (not inline in the item definition), so we
upload it via the ADLS Gen2 DFS API (create → append → flush), then POST an
on-demand job instance. Idempotent + reusable.

Usage (from repo root):
    .venv/Scripts/python.exe scanner/deploy_sjd.py
"""

import base64
import functools
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

import requests

from fabric_lro import poll_lro
from onelens_config import RUNTIME_CONFIG_FILE, configured, positive_int, required, required_uuid

# This script prints Unicode arrows/box-drawing progress markers (→, etc.). A
# plain Windows console/redirected-file stream defaults to the OS ANSI code
# page (cp1252), which can't encode those characters and crashes with
# UnicodeEncodeError mid-deploy — hit for real running this from a fresh
# PowerShell session with output redirected to a file. Force UTF-8 on both
# streams so this script is portable regardless of the caller's console code
# page; safe no-op if the streams don't support reconfigure (e.g. captured by
# a test runner).
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

# On Windows the az CLI is az.cmd — subprocess.run(['az', ...]) without shell=True
# fails with FileNotFoundError because CreateProcess doesn't consult PATHEXT the
# way cmd.exe/PowerShell do. shutil.which resolves the real executable on every OS.
_AZ = shutil.which("az") or "az"

WORKSPACE = required_uuid("ONELENS_WORKSPACE_ID")
SJD_ID = required_uuid("ONELENS_SJD_ID")
MAIN_FILE = "Main/sjd_governance_scan.py"
LOCAL_FILES = {
    Path(__file__).with_name("sjd_governance_scan.py"): MAIN_FILE,
    Path(__file__).with_name("fabric_metadata.py"): "Main/fabric_metadata.py",
    Path(__file__).with_name("onelens_config.py"): "Main/onelens_config.py",
}
API = "https://api.fabric.microsoft.com"
DFS = "https://onelake.dfs.fabric.microsoft.com"


@functools.lru_cache(maxsize=1)
def _resolve_sensitivity_labels() -> str | None:
    """Best-effort: resolve the tenant's REAL sensitivity-label taxonomy (GUID
    -> friendly name) via Microsoft Graph, using the SAME interactive `az`
    login this script already uses for everything else — no new credential,
    no Key Vault, no service-principal secret introduced.

    This exists because the identical Graph call made FROM INSIDE the Fabric
    Spark job (`sjd_governance_scan.py`'s own `resolve_label_names()`, via
    `notebookutils.credentials.getToken`) reliably returns zero labels — a
    confirmed Fabric Spark network-egress limitation, not a permissions bug
    (the same call with the scan SP's own credentials succeeds from a normal,
    non-Spark network). Running the SAME resolution here at deploy time —
    where a normal outbound HTTPS call to graph.microsoft.com works — and
    feeding the result through the EXISTING `ONELENS_LABEL_MAP` mechanism
    means the taxonomy is refreshed automatically on every deploy, with zero
    manual step, instead of requiring someone to hand-maintain a GUID->name
    map (the previous, since-removed approach hardcoded exactly two GUIDs from
    one tenant directly in the frontend — not a source of truth, and useless
    for any other deployment).

    Best-effort by design: if Graph is unreachable/unauthorized from wherever
    `deploy_sjd.py` happens to run (corporate proxy, no tenant consent yet,
    etc.), this returns None and the scanner falls back to storing the raw
    GUID, exactly as it does today — this can never fail the deployment.

    Memoized: `runtime_config()` is called twice per deploy (once for the
    uploaded json file, once for commandLineArguments) — cache so the live
    Graph round trip only happens once per run.
    """
    try:
        out = subprocess.run(
            [_AZ, "account", "get-access-token", "--resource", "https://graph.microsoft.com",
             "--query", "accessToken", "-o", "tsv"],
            capture_output=True, text=True, timeout=30,
        )
        if out.returncode != 0:
            print(f"      (sensitivity labels: no Graph token available — {out.stderr.strip()[:200]})")
            return None
        tok = out.stdout.strip()
    except (OSError, subprocess.SubprocessError) as exc:
        print(f"      (sensitivity labels: az token lookup failed — {exc})")
        return None

    names: dict[str, str] = {}
    for url in ("https://graph.microsoft.com/v1.0/security/informationProtection/sensitivityLabels",
                "https://graph.microsoft.com/beta/security/informationProtection/sensitivityLabels"):
        try:
            r = requests.get(url, headers={"Authorization": f"Bearer {tok}"}, timeout=30)
            if r.ok:
                for lab in (r.json().get("value") or []):
                    lid, nm = lab.get("id"), (lab.get("name") or lab.get("displayName"))
                    if lid and nm:
                        names[str(lid).lower()] = nm
                if names:
                    break
        except (requests.RequestException, ValueError):
            continue

    if not names:
        print("      (sensitivity labels: Graph taxonomy unavailable from this network — "
              "scanner will keep storing raw label GUIDs; set ONELENS_LABEL_MAP to override)")
        return None
    print(f"      sensitivity labels: resolved {len(names)} from Graph taxonomy")
    return json.dumps(names)


def runtime_config() -> dict[str, str]:
    """Build the non-secret config file consumed inside the Fabric Spark job."""
    values = {
        "ONELENS_SQL_SERVER": required("ONELENS_SQL_SERVER"),
        "ONELENS_SQL_DB": required("ONELENS_SQL_DB"),
        "ONELENS_ANALYSIS_WORKSPACE_ID": required_uuid("ONELENS_ANALYSIS_WORKSPACE_ID"),
        "ONELENS_PORTAL": configured("ONELENS_PORTAL", "app.fabric.microsoft.com"),
        "ONELENS_WORKSPACE_NAME": configured("ONELENS_WORKSPACE_NAME", "OneLens-Workspace"),
        "ONELENS_LAKEHOUSE_NAME": configured("ONELENS_LAKEHOUSE_NAME", "onelens_scan_lh"),
        "ONELENS_SPARKJOB_NAME": configured("ONELENS_SPARKJOB_NAME", "governance-onelens-scan"),
        "ONELENS_CAPACITY_NAME": configured("ONELENS_CAPACITY_NAME", "Fabric capacity"),
        "ONELENS_AGENT_NAME": configured("ONELENS_AGENT_NAME", "Ask OneLens"),
    }
    # Manual override always wins (e.g. a tenant where Graph is permanently
    # unreachable can still hand-maintain a map); otherwise resolve it live.
    label_map = configured("ONELENS_LABEL_MAP") or _resolve_sensitivity_labels()
    if label_map:
        values["ONELENS_LABEL_MAP"] = label_map
    return {name: value for name, value in values.items() if value is not None}


def deployment_payloads() -> list[tuple[str, bytes]]:
    payloads = [(target, source.read_bytes()) for source, target in LOCAL_FILES.items()]
    config_bytes = json.dumps(runtime_config(), indent=2, sort_keys=True).encode("utf-8")
    payloads.append((f"Main/{RUNTIME_CONFIG_FILE}", config_bytes))
    return payloads


def _library_uris() -> list[str]:
    """OneLake abfss:// URIs for every uploaded .py file except the main entry
    point — these must be declared on the SJD item itself (additionalLibraryUris)
    or Spark never puts them on sys.path, so `from fabric_metadata import ...`
    raises ModuleNotFoundError even though the file sits right next to the main
    script in the same OneLake folder. Uploading a file is NOT the same as the
    SJD knowing to load it. NOTE: Fabric validates this field strictly against
    the SJD's language — a non-.py entry (e.g. the runtime config json) is
    REJECTED outright with SparkJobDefinitionPropertiesAdditionalLibraryUris-
    NotConsistentWithSelectedLanguage (confirmed via a real 400 response), so
    the runtime config reaches the job via commandLineArguments instead (see
    _command_line_argument() below), not through this list.
    """
    return [
        f"abfss://{WORKSPACE}@onelake.dfs.fabric.microsoft.com/{SJD_ID}/{target}"
        for target in LOCAL_FILES.values()
        if target != MAIN_FILE
    ]


def _command_line_argument() -> str:
    """The runtime config (SQL server/db, workspace ids, ... — identifiers, not
    credentials), base64-encoded as the single argv[1] the job receives.
    Sibling-file staging locations are not reliably predictable across Fabric
    SJD deployment shapes (see _library_uris' docstring for the additional-
    LibraryUris dead end); a command-line argument always arrives via sys.argv
    with no file-path guessing required.
    """
    payload = json.dumps(runtime_config(), sort_keys=True).encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("ascii")


def ensure_sjd_definition(fab: requests.Session):
    """Make sure the SJD's own item definition has the additionalLibraryUris
    (sibling .py modules) and commandLineArguments (runtime config) it needs to
    actually run. Idempotent — only calls updateDefinition when something
    actually needs to change."""
    defn = fab.post(f"{API}/v1/workspaces/{WORKSPACE}/items/{SJD_ID}/getDefinition", json={}, timeout=60)
    current = poll_lro(fab, defn, fetch_result=True)
    parts = current.get("definition", {}).get("parts", [])
    sjd_part = next(p for p in parts if p["path"] == "SparkJobDefinitionV1.json")
    sjd_json = json.loads(base64.b64decode(sjd_part["payload"]).decode("utf-8"))

    wanted_uris = _library_uris()
    wanted_args = _command_line_argument()
    changed = []
    if sorted(sjd_json.get("additionalLibraryUris") or []) != sorted(wanted_uris):
        sjd_json["additionalLibraryUris"] = wanted_uris
        changed.append(f"additionalLibraryUris ({len(wanted_uris)} module(s))")
    if sjd_json.get("commandLineArguments") != wanted_args:
        sjd_json["commandLineArguments"] = wanted_args
        changed.append("commandLineArguments")

    if not changed:
        return

    print(f"      updating: {', '.join(changed)} …")
    sjd_part["payload"] = base64.b64encode(json.dumps(sjd_json).encode("utf-8")).decode("ascii")
    sjd_part["payloadType"] = "InlineBase64"

    upd = fab.post(
        f"{API}/v1/workspaces/{WORKSPACE}/items/{SJD_ID}/updateDefinition",
        json={"definition": {"parts": parts}}, timeout=60,
    )
    poll_lro(fab, upd)
    print("      definition updated.")


def token(resource: str) -> str:
    out = subprocess.run(
        [_AZ, "account", "get-access-token", "--resource", resource, "--query", "accessToken", "-o", "tsv"],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        sys.exit(f"az token ({resource}) failed: {out.stderr}")
    return out.stdout.strip()


def upload_onelake(data: bytes, onelake_file: str):
    """Overwrite a OneLake file via the ADLS Gen2 DFS API (create/append/flush)."""
    sess = requests.Session()
    sess.headers["Authorization"] = f"Bearer {token('https://storage.azure.com')}"
    base = f"{DFS}/{WORKSPACE}/{SJD_ID}/{onelake_file}"

    r = sess.put(f"{base}?resource=file", timeout=60)
    if r.status_code not in (201, 202):
        sys.exit(f"create failed {r.status_code}: {r.text[:400]}")

    r = sess.patch(f"{base}?action=append&position=0",
                   data=data, headers={"Content-Type": "application/octet-stream"}, timeout=120)
    if r.status_code not in (200, 202):
        sys.exit(f"append failed {r.status_code}: {r.text[:400]}")

    r = sess.patch(f"{base}?action=flush&position={len(data)}", timeout=60)
    if r.status_code not in (200, 202):
        sys.exit(f"flush failed {r.status_code}: {r.text[:400]}")


def main():
    payloads = deployment_payloads()
    print(f"[1/4] upload {len(payloads)} scanner files …")
    for onelake_file, data in payloads:
        print(f"      {Path(onelake_file).name} ({len(data)} bytes) → OneLake {onelake_file}")
        upload_onelake(data, onelake_file)
    print("      uploaded.")

    fab = requests.Session()
    fab.headers["Authorization"] = f"Bearer {token(API)}"

    print("[2/4] verify SJD definition (additionalLibraryUris + commandLineArguments) …")
    ensure_sjd_definition(fab)

    print("[3/4] trigger on-demand run …")
    run = fab.post(f"{API}/v1/workspaces/{WORKSPACE}/items/{SJD_ID}/jobs/instances?jobType=sparkjob",
                   json={}, timeout=60)
    if run.status_code not in (200, 201, 202):
        sys.exit(f"job start failed {run.status_code}: {run.text[:500]}")
    inst = run.headers.get("Location", "")
    print(f"      run accepted ({run.status_code}); instance: {inst.split('/')[-1] or 'n/a'}")

    print("[4/4] poll run status …")
    if not inst:
        raise RuntimeError("Fabric accepted the Spark job without a Location header.")

    timeout = positive_int("ONELENS_JOB_TIMEOUT_SECONDS", 900)
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        time.sleep(min(10, max(0.1, deadline - time.monotonic())))
        js = fab.get(inst, timeout=60)
        if js.status_code >= 400:
            raise RuntimeError(f"job status failed {js.status_code}: {js.text[:600]}")
        st = (js.json() or {}).get("status")
        print(f"      status={st or 'unknown'}")
        if st in ("Completed", "Deduped"):
            print("DONE")
            return
        if st in ("Failed", "Cancelled", "Canceled"):
            raise RuntimeError(f"Spark job ended with status {st}: {js.text[:600]}")
    raise TimeoutError(f"Spark job did not complete within {timeout} seconds: {inst}")


if __name__ == "__main__":
    main()
