# Governance OneLens Deployment

The scanner folder owns four connected deployment layers:

1. Fabric Spark Job Definition (tenant inventory and SQL writes)
2. SQL semantic views
3. DirectQuery semantic model
4. Ask OneLens Fabric Data Agent

Use [`.env.example`](.env.example) as the configuration inventory. The examples
below use PowerShell because the supported development environment is Windows.

## Workspace Contract

`ONELENS_WORKSPACE_ID` is the primary workspace containing the Rayfin app and
Spark Job Definition. `ONELENS_ANALYSIS_WORKSPACE_ID` contains the semantic model
and Data Agent. Set both to the same UUID for the normal single-workspace install.

The browser equivalent is generated as `VITE_RAYFIN_ASKONELENS_WORKSPACE_ID`.
When omitted, the app falls back to Rayfin's `VITE_FABRIC_WORKSPACE_ID` for
single-workspace deployments.

## Prerequisites

- Azure CLI is signed in as a workspace member for deployment scripts.
- The Spark job submitter or schedule owner can read the Fabric and Power BI
  tenant admin APIs and can write to the Governance OneLens SQL database.
- Python dependencies from [`requirements.txt`](requirements.txt) are installed
  for local deployment/validation scripts.
- The Rayfin data schema has been applied before the scanner first writes rows.

## Bootstrap (brand-new environment only)

Every step below assumes a workspace, a default Lakehouse, and a Spark Job
Definition item already exist — nothing else in this folder creates them from
scratch. On a fresh Fabric tenant/workspace, run this first:

```powershell
python scanner/bootstrap_workspace.py --workspace-name "My-Governance-Workspace" --capacity-id '<capacity-uuid>'
# or, to add the lakehouse/SJD to a workspace that already exists:
python scanner/bootstrap_workspace.py --workspace-id '<existing-workspace-uuid>'
```

Idempotent — safe to re-run; it looks each piece up by display name before
creating anything. Prints the `ONELENS_WORKSPACE_ID`/`ONELENS_SJD_ID` values to
carry into the **Configure** section below. It deliberately stops at "empty
shell exists, correctly bound to its lakehouse" — `deploy_sjd.py` (step 2)
still owns uploading the real scanner code and wiring the runtime config.

Fabric admin API access (workspace/item creation, tenant-admin scan scopes) and
the Rayfin `AppBackend` + SQL database (created by `rayfin up`, a separate,
platform-owned step) are still one-time manual/tenant-admin prerequisites —
see the repo root README for the frontend deployment side.

## Configure

Set at least these values in the shell that runs deployment commands:

```powershell
$env:ONELENS_WORKSPACE_ID = '<primary-workspace-uuid>'
$env:ONELENS_SJD_ID = '<spark-job-definition-uuid>'
$env:ONELENS_ANALYSIS_WORKSPACE_ID = '<analysis-workspace-uuid>'
$env:ONELENS_SQL_SERVER = '<server>.database.fabric.microsoft.com'
$env:ONELENS_SQL_DB = '<database-name>'
```

All values uploaded to the SJD are non-secret. `deploy_sjd.py` writes
`onelens_runtime_config.json` directly into the SJD's `Main/` folder beside the
entrypoint and helpers. At runtime, process environment variables take precedence
over this file. The generated file contains SQL/workspace identifiers and display
metadata only. It never contains `ONELENS_SCAN_SECRET` or an access token.

## Deploy In Order

From the repository root, using the project's Python environment:

```powershell
# 1. Create/update the stable SQL view contract.
python scanner/create_semantic_views.py
python scanner/validate_semantic_views.py

# 2. Upload scanner code + non-secret runtime config, trigger, and await one run.
python scanner/deploy_sjd.py

# 3. Create/update and validate the semantic model in the analysis workspace.
python scanner/create_semantic_model.py
python scanner/validate_semantic_model.py

# 4. Use the model id printed by step 3, then create/publish the Data Agent.
$env:ONELENS_SEMANTIC_MODEL_ID = '<semantic-model-uuid>'
python scanner/create_data_agent.py

# 5. Use the agent id printed by step 4 for the MCP smoke test.
$env:ONELENS_DATA_AGENT_ID = '<data-agent-uuid>'
python scanner/validate_data_agent.py
```

After first creating the DirectQuery semantic model, configure its SQL data-source
credential once in Fabric/Power BI using interactive OAuth2 sign-in. Fabric manages
that OAuth grant afterward. Workspace Identity is currently rejected for a Fabric
SQL Database endpoint, and a pasted access token is not a durable credential.

## Frontend Values

Copy the analysis outputs into the app's ignored `rayfin/.env` before running
`rayfin up`:

```text
RAYFIN_PUBLIC_ASKONELENS_WORKSPACE_ID = ONELENS_ANALYSIS_WORKSPACE_ID
RAYFIN_PUBLIC_ASKONELENS_AGENT_ID     = ONELENS_DATA_AGENT_ID
```

Also set `RAYFIN_PUBLIC_FABRIC_SPA_CLIENT_ID` to the Entra SPA client id. Rayfin
generates the corresponding `VITE_RAYFIN_*` values in `.env.local` before each
build, so direct `.env.local` edits do not survive `rayfin up`. Register both
local and deployed `/auth-redirect.html` URLs on that SPA registration for the
MSAL popup redirect bridge.

## Scheduled Runs

The nightly schedule executes the already-uploaded `Main/` files, including the
runtime JSON. Re-run `deploy_sjd.py` whenever scanner code or any SJD runtime value
changes. `ONELENS_JOB_TIMEOUT_SECONDS` controls only how long the local deploy helper
waits for the Fabric run; it does not alter Fabric's own Spark execution timeout.

Production execution is secretless through
`notebookutils.credentials.getToken`. The optional tenant/client/secret variables in
`.env.example` are only for the separate local development scanner.