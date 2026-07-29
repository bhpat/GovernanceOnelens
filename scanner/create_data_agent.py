"""Create (or update) the "Ask OneLens" Fabric Data Agent, grounded on the
Governance OneLens Model semantic model, and publish it.

Once published, Fabric auto-exposes a native MCP endpoint at:
  https://api.fabric.microsoft.com/v1/mcp/workspaces/{WorkspaceId}/dataagents/{DataAgentId}/agent
No Azure AI Foundry project needed - this is the "skip Foundry" path decided earlier.

Uses the interactive `az` login (workspace member) - no service-principal secret.

Usage (from repo root):
    .venv/Scripts/python.exe scanner/create_data_agent.py
"""

import base64
import json
import shutil
import struct
import subprocess
import sys

import pyodbc
import requests

from fabric_lro import poll_lro
from onelens_config import required, required_uuid

# On Windows the az CLI is az.cmd — subprocess.run(['az', ...]) without shell=True
# fails with FileNotFoundError because CreateProcess doesn't consult PATHEXT the
# way cmd.exe/PowerShell do. shutil.which resolves the real executable on every OS.
_AZ = shutil.which("az") or "az"

WORKSPACE = required_uuid("ONELENS_ANALYSIS_WORKSPACE_ID")
SEMANTIC_MODEL_ID = required_uuid("ONELENS_SEMANTIC_MODEL_ID")
SEMANTIC_MODEL_NAME = "Governance OneLens Model"
AGENT_NAME = "Ask OneLens"
AGENT_DESC = "Ask natural-language questions about your Fabric governance catalog - coverage, lineage, posture, and more."
API = "https://api.fabric.microsoft.com/v1"

SQL_SRV = required("ONELENS_SQL_SERVER")
SQL_DB = required("ONELENS_SQL_DB")

AI_INSTRUCTIONS = """You are Ask OneLens, a governance analyst assistant for the Governance OneLens data catalog. You answer questions about the organization's Microsoft Fabric tenant: workspaces, items (reports, lakehouses, notebooks, pipelines, semantic models, etc.), domains, lineage, and governance health.

Your only data source is the "Governance OneLens Model" semantic model, which contains:
- Item: every catalog asset (workspace, type, owner, description, tags, sensitivity label, endorsement, created/modified/refresh dates, refresh status, size, semantic-model table count, and column count). Governance flags are precomputed per item.
- Workspace: workspace metadata (type, state, domain).
- Domain: governance domain hierarchy.
- Lineage Edges: relationships between items (From Item / To Item), categorized as "movement" (data physically moves, e.g. Shortcut/DataSource) or "dependency" (one item depends on or orchestrates another, e.g. DependsOn/Orchestrates/Provides/Then).
- Coverage: point-in-time governance coverage percentages by metric (ownership, documentation, sensitivity, endorsement) and scope (tenant-wide or per-workspace).
- Posture: point-in-time governance posture/health signals by scope.
- Metric History: a time series of coverage/posture values captured on every scan - use this for "how has X changed" or trend questions.
- Role Assignments: captured workspace and item access grants, including principal type, role, scope, and scope name.

Guidance:
- For "how many / what percent are governed" questions, prefer the Item table's measures (Ownership Coverage (%), Documentation Coverage (%), Sensitivity Coverage (%), Endorsement Coverage (%), Fully Governed (%)). Coverage values are stored on a 0-to-100 scale; Average Coverage (%) intentionally returns blank until exactly one Metric is selected.
- For "what feeds into X" or "what does X depend on" questions, use Lineage Edges, filtering by From Item / To Item and using Relationship Category (movement vs dependency) to distinguish physical data flow from process dependencies.
- For "which items haven't been touched recently" or "stale" questions, use Item's Is Stale flag or the # Stale Items measure (items not modified in over 90 days).
- For trend questions ("how has coverage changed over the last month"), use Metric History, filtering by Kind (coverage or posture) and Metric, ordered by Captured At.
- For size and schema-breadth questions, use Total Size (Bytes), # Tables, and # Columns. Missing size or schema values mean the source API did not report them; do not treat missing values as zero.
- Tags contains source tag names serialized as a JSON array. Treat each quoted array value as one tag and do not infer tags from item names or descriptions.
- Posture and Metric History can contain values with different units. Filter to exactly one Signal, or one Kind and Metric, before using their average measures.
- For access questions, use Role Assignments. Prefer aggregate measures (# Role Assignments, # Access Principals, # Group Assignments); only return principal-level rows when the user explicitly asks for them.
- Always express coverage/percentage answers as percentages, not raw fractions.
- If a question can't be answered from this data (e.g., about data outside the Fabric tenant, or literal file contents), say so rather than guessing."""

# Every table in the semantic model, exposed to the agent (schema/columns/measures
# are discovered live via the agent's own Read permission on the model - we only
# need to mark which tables are in scope).
TABLES = ["Item", "Workspace", "Domain", "Lineage Edges", "Coverage", "Posture", "Metric History", "Role Assignments"]


def token(resource: str) -> str:
    out = subprocess.run(
        [_AZ, "account", "get-access-token", "--resource", resource, "--query", "accessToken", "-o", "tsv"],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        sys.exit(f"az token ({resource}) failed: {out.stderr}")
    return out.stdout.strip()


def b64(obj: dict) -> str:
    return base64.b64encode(json.dumps(obj, indent=2).encode("utf-8")).decode("ascii")


def build_definition() -> dict:
    datasource = {
        "$schema": "1.0.0",
        "artifactId": SEMANTIC_MODEL_ID,
        "workspaceId": WORKSPACE,
        "displayName": SEMANTIC_MODEL_NAME,
        "type": "semantic_model",
        "userDescription": "The governance catalog semantic model - Item/Workspace/Domain dimensions plus Lineage/Coverage/Posture/Metric History/Role Assignment facts.",
        "dataSourceInstructions": "Use this for all governance, coverage, lineage, and posture questions about the Fabric tenant.",
        "elements": [
            {"id": f"00000000-0000-0000-0000-{i:012d}", "display_name": t, "type": "semantic_model.table", "is_selected": True}
            for i, t in enumerate(TABLES, start=1)
        ],
    }
    stage_config = {"$schema": "1.0.0", "aiInstructions": AI_INSTRUCTIONS}
    data_agent = {"$schema": "2.1.0"}

    parts = [
        {"path": "Files/Config/data_agent.json", "payload": b64(data_agent), "payloadType": "InlineBase64"},
        {"path": "Files/Config/draft/stage_config.json", "payload": b64(stage_config), "payloadType": "InlineBase64"},
        {"path": "Files/Config/draft/semantic_model-GovernanceOneLensModel/datasource.json",
         "payload": b64(datasource), "payloadType": "InlineBase64"},
    ]
    return {"parts": parts}


def find_existing(sess: requests.Session) -> str | None:
    r = sess.get(f"{API}/workspaces/{WORKSPACE}/dataAgents", timeout=60)
    r.raise_for_status()
    for item in r.json().get("value", []):
        if item.get("displayName") == AGENT_NAME:
            return item["id"]
    return None


# Same self-registering-connector contract collection sources use (see
# fabric_inventory.py / sjd_governance_scan.py's `connector:fabric` row) applied
# to the analysis tier: the script that deploys a capability upserts its own
# Connector row on success, so the Connectors page reflects reality instead of
# a stale aspirational "planned" seed row. The nightly scan re-verifies this
# row's liveness on every run too (see sjd_governance_scan.py's
# `check_analysis_skills`), so a deleted Data Agent would be caught even if
# this script is never run again.
CONNECTOR_COLS = [
    "kind", "displayName", "description", "status", "endpoint", "credentialRef",
    "scope", "schedule", "capabilities", "itemCount",
]


def register_connector(agent_id: str) -> None:
    tok = token("https://database.windows.net").encode("utf-16-le")
    token_struct = struct.pack(f"<I{len(tok)}s", len(tok), tok)
    conn = pyodbc.connect(
        f"Driver={{ODBC Driver 17 for SQL Server}};Server={SQL_SRV};Database={SQL_DB};Encrypt=yes;",
        attrs_before={1256: token_struct},
    )
    row = {
        "kind": "analysis",
        "displayName": AGENT_NAME,
        "description": AGENT_DESC,
        "status": "connected",
        "endpoint": f"Fabric Data Agent \u00b7 native MCP endpoint (workspace {WORKSPACE})",
        "credentialRef": "Delegated per-user sign-in (Entra, MSAL popup)",
        "scope": json.dumps({"semanticModel": SEMANTIC_MODEL_NAME, "dataAgentId": agent_id, "tables": TABLES}),
        "schedule": "Re-verified every scan run",
        "capabilities": json.dumps(["nlQuery"]),
        "itemCount": len(TABLES),
    }
    set_clause = ", ".join(f"t.[{c}] = ?" for c in CONNECTOR_COLS)
    insert_cols = ["id", "canonicalId", "source", *CONNECTOR_COLS, "firstSeen", "lastSeen"]
    insert_vals = ["NEWID()", "?", "'onelens'", *(["?"] * len(CONNECTOR_COLS)), "SYSUTCDATETIME()", "SYSUTCDATETIME()"]
    sql = (
        "MERGE dbo.Connectors AS t USING (SELECT ? AS canonicalId) AS s ON t.[canonicalId] = s.[canonicalId] "
        f"WHEN MATCHED THEN UPDATE SET {set_clause}, t.[lastSeen] = SYSUTCDATETIME() "
        f"WHEN NOT MATCHED THEN INSERT ({', '.join('[' + c + ']' for c in insert_cols)}) VALUES ({', '.join(insert_vals)});"
    )
    params = ["connector:onelens", *[row[c] for c in CONNECTOR_COLS], "connector:onelens", *[row[c] for c in CONNECTOR_COLS]]
    cur = conn.cursor()
    cur.execute(sql, params)
    conn.commit()
    conn.close()
    print("[connector] connector:onelens \u2192 connected")


def main():
    sess = requests.Session()
    sess.headers["Authorization"] = f"Bearer {token('https://api.fabric.microsoft.com')}"
    sess.headers["Content-Type"] = "application/json"

    definition = build_definition()
    existing_id = find_existing(sess)

    if existing_id:
        print(f"[1/2] existing agent found ({existing_id}) → updateDefinition …")
        resp = sess.post(f"{API}/workspaces/{WORKSPACE}/dataAgents/{existing_id}/updateDefinition",
                          json={"definition": definition}, timeout=60)
        poll_lro(sess, resp)
        agent_id = existing_id
    else:
        print("[1/2] no existing agent → create …")
        resp = sess.post(
            f"{API}/workspaces/{WORKSPACE}/dataAgents",
            json={"displayName": AGENT_NAME, "description": AGENT_DESC, "definition": definition},
            timeout=60,
        )
        result = poll_lro(sess, resp, fetch_result=True)
        agent_id = result.get("id") or find_existing(sess)

    if not agent_id:
        raise RuntimeError("Data Agent creation succeeded without returning or discovering an item id.")

    print(f"[2/2] publishing …")
    resp = sess.post(f"{API}/workspaces/{WORKSPACE}/dataAgents/{agent_id}/staging/publish",
                      json={"publishedDescription": AGENT_DESC}, timeout=60)
    poll_lro(sess, resp)
    print("      published.")

    print(f"\nDone. Data Agent id = {agent_id}")
    print(f"MCP endpoint: https://api.fabric.microsoft.com/v1/mcp/workspaces/{WORKSPACE}/dataagents/{agent_id}/agent")
    print(f"Portal: https://app.fabric.microsoft.com/groups/{WORKSPACE}/dataagents/{agent_id}")

    register_connector(agent_id)


if __name__ == "__main__":
    main()
