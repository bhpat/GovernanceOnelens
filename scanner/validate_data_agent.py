"""Validate the Ask OneLens Fabric Data Agent's native MCP endpoint.

Exercises the standard MCP handshake: initialize -> tools/list -> tools/call,
using a plain bearer token (Fabric audience) - no Azure AI Foundry involved.

Usage (from repo root):
    .venv/Scripts/python.exe scanner/validate_data_agent.py "How many items are fully governed?"
"""

import json
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
AGENT_ID = required_uuid("ONELENS_DATA_AGENT_ID")
MCP_URL = f"https://api.fabric.microsoft.com/v1/mcp/workspaces/{WORKSPACE}/dataagents/{AGENT_ID}/agent"


def token(resource: str) -> str:
    out = subprocess.run(
        [_AZ, "account", "get-access-token", "--resource", resource, "--query", "accessToken", "-o", "tsv"],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        sys.exit(f"az token ({resource}) failed: {out.stderr}")
    return out.stdout.strip()


def parse_response(resp: requests.Response) -> dict:
    ctype = resp.headers.get("Content-Type", "")
    if "text/event-stream" in ctype:
        # SSE: find the last "data: {...}" line
        data_lines = [line[len("data: "):] for line in resp.text.splitlines() if line.startswith("data: ")]
        if not data_lines:
            sys.exit(f"no data lines in SSE response: {resp.text[:500]}")
        return json.loads(data_lines[-1])
    return resp.json()


def rpc(sess: requests.Session, method: str, params: dict, req_id: int) -> dict:
    body = {"jsonrpc": "2.0", "id": req_id, "method": method, "params": params}
    resp = sess.post(MCP_URL, json=body, timeout=60)
    if resp.status_code >= 400:
        sys.exit(f"{method} failed {resp.status_code}: {resp.text[:800]}")
    session_id = resp.headers.get("Mcp-Session-Id")
    if session_id:
        sess.headers["Mcp-Session-Id"] = session_id
    return parse_response(resp)


def main():
    question = sys.argv[1] if len(sys.argv) > 1 else "How many items are fully governed, and what is the ownership coverage percentage?"

    sess = requests.Session()
    sess.headers["Authorization"] = f"Bearer {token('https://api.fabric.microsoft.com')}"
    sess.headers["Content-Type"] = "application/json"
    sess.headers["Accept"] = "application/json, text/event-stream"

    print("[1/3] initialize …")
    init = rpc(sess, "initialize", {
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {"name": "onelens-smoke-test", "version": "1.0"},
    }, 1)
    print(f"      {json.dumps(init.get('result', init), indent=2)[:500]}")

    print("[2/3] tools/list …")
    tools = rpc(sess, "tools/list", {}, 2)
    tool_list = tools.get("result", {}).get("tools", [])
    print(f"      {len(tool_list)} tool(s): {[t['name'] for t in tool_list]}")
    print(json.dumps(tool_list, indent=2))
    if not tool_list:
        sys.exit("no tools exposed - agent may not be fully published yet")

    tool_name = tool_list[0]["name"]
    print(f"[3/3] tools/call ({tool_name}) with question: {question!r}")
    result = rpc(sess, "tools/call", {"name": tool_name, "arguments": {"userQuestion": question}}, 3)
    print(json.dumps(result.get("result", result), indent=2))


if __name__ == "__main__":
    main()
