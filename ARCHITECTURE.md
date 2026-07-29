# Governance OneLens — Architecture

**Governance OneLens** is a zero-per-workspace-install Fabric app that provides governance observability across a Microsoft Fabric tenant. Built on [microsoft/rayfin](https://github.com/microsoft/rayfin) (Fabric Apps), it discovers every workspace, item, and their governance posture (ownership, sensitivity labels, endorsement, lineage) and surfaces that data through a web app and natural-language query interface.

**Key design principles:**
- **Secretless collection** — Uses Fabric token library; no service-principal secret or Key Vault
- **Zero per-workspace install** — One workspace, tenant-wide via admin APIs
- **Fail-closed access control** — Server-side GraphQL allowlist; no client-side filters
- **Locked write path** — App reads only; SQL MERGE is the sole write path into the database

---

## Architecture Overview

The system flows through six stages:

```
┌────────────────────────────────────────────────────────────────────┐
│ MICROSOFT FABRIC WORKSPACE BOUNDARY                                │
│                                                                    │
│  [01 Sources]                                                      │
│      ↓ Fabric tenant catalog API                                   │
│  [02 Ingestion]                                                    │
│      ↓ sjd_governance_scan.py (nightly Spark Job)                  │
│  [03 Transform]                                                    │
│      ↓ App-derived scoring → SQL MERGE + hard-delete tombstone     │
│  [04 Storage]                                                      │
│      ↓ Fabric SQL Database                                         │
│  [05 Hosting]                                                      │
│      ↓ Rayfin GraphQL API + DirectQuery Semantic Model             │
│  [06 Consumption]                                                  │
│      ├─ Governance OneLens web app (React)                         │
│      └─ Ask OneLens (Fabric Data Agent)                            │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

---

## Stage 1: Sources — Fabric Tenant Discovery

**What flows in:** Fabric admin and Power BI REST APIs

**Components:**
- **Tenant Catalog** — Every workspace, domain, item, report, pipeline, notebook discovered via Fabric admin APIs and Power BI scanner
- **Item Definitions** — CopyJob, DataPipeline, Eventstream, Reflex, Ontology definitions parsed to extract real Reads/Writes/Shortcut lineage edges (not just declared dependencies)
- **Governance Metadata** — Sensitivity labels, endorsement tiers, RBAC role assignments per item and workspace

**Discovery scope:** every workspace, domain, item (Lakehouse, Warehouse, Notebook, Report,
Dataflow, Pipeline, Eventhouse, and 30+ other Fabric item types), lineage edge, and role
assignment the scan identity's admin scopes can see — tenant-wide, with no per-workspace
install. Actual counts scale with the size of the tenant being scanned.

**Key decision:** Admin APIs are read-only to the discovery process; no Fabric items are modified during collection.

---

## Stage 2: Ingestion — Secretless Scanner

**What flows in:** API responses → Spark Job

**Component:** `sjd_governance_scan.py` (Spark Job Definition)

**Execution:**
- **Trigger:** Nightly schedule + on-demand via Jobs API
- **Authentication:** Fabric token library (`notebookutils.credentials.getToken()`)
  - No service-principal secret stored
  - No Key Vault rotation needed
  - Fully RBAC-driven via Spark Compute's managed identity
- **Runtime:** 5–15 minutes depending on tenant size

**Process:**
1. Authenticate to Fabric admin and Power BI APIs using the notebook's managed identity
2. Call discovery APIs: workspaces, items, lineage, roles, sensitivity labels, endorsement
3. Stream raw API responses into ephemeral DataFrames
4. Output to a staging layer for metrics derivation

**Error handling:**
- API rate-limit backoff
- Partial failures don't block; incomplete items are logged and retried next run
- No secrets exposed in logs (Fabric logs are audit-recorded)

---

## Stage 3: Transform — Metric Derivation & Idempotent Write

**What flows in:** Raw API scan DataFrames → Scored metrics

**Components:**

### 3a. Scoring (derived app-side, not scanner-side)

The scanner (`sjd_governance_scan.py`) only collects and upserts the raw catalog (`Item`,
`Workspace`, `Domain`, `LineageEdge`, `RoleAssignment`). Governance scores are computed
separately as **derived entities** (`source: 'derived'`) — `CoverageMetric`, `PostureSnapshot`,
and the append-only `MetricSnapshot` history — across **four governance lenses:**

1. **Ownership** — does the item have an owner assigned?
2. **Documentation** — does the item have a description?
3. **Sensitivity labeling** — is the item labeled (confidential, internal, public, etc.)?
4. **Endorsement** — is the item promoted or certified?

**Outputs:**
- `CoverageMetric` — the latest numerator/denominator/percent per metric, scoped to
  `tenant` / `workspace` / `domain` / `itemType` (MERGE-overwritten each run).
- `PostureSnapshot` — point-in-time health signals (item/workspace counts, orphaned items, etc.), same scoping.
- `MetricSnapshot` — an append-only time-series point per run, so the UI can render trend
  deltas and sparklines without re-deriving history.

**Calculation:** an item's overall governance score is the average of the four lens
percentages (owned / described / sensitivity-labeled / endorsed) — see `app/src/lib/health.ts`,
the single shared implementation every page uses so the number can never disagree
between screens.

### 3b. Idempotent Write (SQL MERGE) + hard-delete tombstoning

**Pattern:** upsert into the Fabric SQL Database using SQL `MERGE`, keyed on each entity's
stable `canonicalId` (`${source}:${type}:${sourceId}`) — safe to re-run, never creates
duplicates.

**Tombstone strategy (real mechanism — a genuine hard delete, not a soft-delete flag):**
- Before writing, the scanner captures a `run_start` watermark (`SYSUTCDATETIME()`).
- Every row touched this run gets `lastSeen` bumped to "now".
- After the run, anything **not** touched (`lastSeen < run_start`) is a real `DELETE FROM`
  — items, lineage edges, workspaces, domains, and role assignments that no longer exist
  in Fabric are removed outright, not flagged.
- **Guarded against partial scans:** the sweep only runs if the collected row count is at
  least half the previous count (a pre-count guard) — so a transient API failure can't
  mass-delete real data. A guard failure logs and skips the sweep instead of deleting.

**Locked write path:**
- The web app **never writes** governance data — it only reads via GraphQL.
- The **only** exception is `ScanRun`: a signed-in governance reader can create a
  `requested` row (the "Run scan now" button), which the next scheduled scan honors and
  fulfills. Every other entity is scanner-write-only.
- A SQL application lock (`sp_getapplock`) prevents an on-demand and a scheduled run from
  interleaving their MERGE + tombstone statements against the same tables.

---

## Stage 4: Storage — Fabric SQL Database

**What flows in:** Scored metrics from Stage 3

**Entities** (defined as TypeScript classes in `app/rayfin/data/`, one file per entity — Rayfin
generates the SQL schema, migrations, and GraphQL API from these):

| Entity | Written by | Purpose |
|-------|------|---------|
| `Workspace` | Scanner (collected) | A container of items — Fabric workspace, or the equivalent in another connector. |
| `Domain` | Scanner (collected) | A logical grouping of workspaces. |
| `Item` | Scanner (collected) | Any governed asset — name, type, owner, description, sensitivity label, endorsement, deep-link. |
| `LineageEdge` | Scanner (collected) | A directional data-flow relationship between two assets (`fromCanonicalId` → `toCanonicalId`). |
| `RoleAssignment` | Scanner (collected) | A principal's role on a scope — the raw material for access/oversharing analysis. |
| `CoverageMetric` | App-derived | Latest numerator/denominator/percent for one governance lens, at one scope. |
| `PostureSnapshot` | App-derived | Latest point-in-time health signal at one scope. |
| `MetricSnapshot` | App-derived | Append-only time-series point per scan run, for trend charts. |
| `Connector` | Scanner + app | The pluggable-source registry row the Connectors gallery renders. |
| `ScanRun` | Scanner + app | The run ledger — one row per execution, plus app-created "run scan now" requests. |

**Shared conventions across every entity:**
- `canonicalId` — a stable, unique business key (`${source}:${type}:${sourceId}` for collected
  entities, `derived:${kind}:...` for computed ones) — this is what MERGE upserts on.
- `source` — the originating connector (`fabric`, `databricks`, `purview`, `informatica`, …) or
  `derived` for app-computed rows — every entity is source-tagged so new connectors are additive.
- `firstSeen` / `lastSeen` — timestamps used for auditability and the tombstone sweep
  described in Stage 3 (no separate `IsDeleted` column — a swept row is genuinely deleted).

**Why SQL Database (not Lakehouse):**
- Rayfin generates a typed, read-only GraphQL API directly from these entity definitions.
- Access control (see *Security & Governance* below) is enforced as a server-side policy on
  every read — never a client-side filter.
- DirectQuery semantic-model queries execute live SQL — no duplicated/stale data.

---

## Stage 5: Hosting — Rayfin & Semantic Model

**What flows in:** SQL Database queries

### 5a. GraphQL API (Auto-generated by Rayfin)

**Exposure:** a read-only GraphQL endpoint, generated directly from the entity classes in
`app/rayfin/data/`.

**Access control — fail-closed allowlist (see *Security & Governance* below for the full
model):**
- Every entity's read policy calls the same `governanceReaderPolicy()` — a server-side
  allowlist of explicitly configured reader emails/subjects.
- Configuration generation itself **fails hard** if no reader is configured — a fresh
  deploy cannot accidentally expose data to everyone.
- **No client-side filtering** — access is enforced before any row leaves the server.

**Query example** (real field names from the `Item` entity):
```graphql
query {
  Item(orderBy: [{ name: Asc }]) {
    canonicalId
    name
    itemType
    owner
    sensitivityLabel
    endorsement
    description
  }
}
```

### 5b. DirectQuery Semantic Model

**Purpose:** AI grounding for natural-language queries (Ask OneLens) and Power BI reporting.

**Configuration:**
- **Storage mode:** DirectQuery — deliberately not Direct Lake, since the source is a Fabric
  SQL Database rather than a Lakehouse/Warehouse SQL analytics endpoint.
- **Data source:** the same Fabric SQL Database, queried live (no import, no refresh schedule).
- **Tables:** `Item`, `Workspace`, `Domain`, `LineageEdge`, `RoleAssignment`, `CoverageMetric`,
  `PostureSnapshot`, `MetricSnapshot` (an 8-table fact constellation).
- **Measures:** governance measures live on the `CoverageMetric`/`PostureSnapshot` tables
  (e.g. average coverage percent, count of items missing a given attribute) — not bolted
  onto `Item` directly, since coverage is a derived, scoped aggregate, not a per-item column.

**Why DirectQuery:**
- Always-fresh governance data, no refresh schedule to manage.
- No duplicated storage.
- Every table here is backed by a plain SQL view, so DirectQuery has no performance
  disadvantage versus Direct Lake for this shape of data.

---

## Stage 6: Consumption — User Experiences

**What flows in:** App requests → Database/Semantic Model responses

### 6a. Governance OneLens Web App

**Stack:** React + Fluent UI, Fabric SSO, Rayfin REST/GraphQL layer

**Features:**
- **Catalog** — Search and filter items by type, owner, label, endorsement, workspace
- **Observability (4 lenses)** — Drill into ownership, documentation, sensitivity, endorsement coverage
- **Lineage Explorer** — Visualize read/write/shortcut relationships between items
- **Access & RBAC** — View workspace and item permissions per principal (user, group, service principal)
- **Connectors** — Registry of data connectors used, with usage counts
- **Settings** — Scan schedule, retention policy, export configurations

**Authentication:**
- Fabric SSO (Entra/Microsoft Entra ID)
- App is registered as a Fabric App (not a standalone app registration)
- User identity flows to SQL via connection context

### 6b. Ask OneLens — Fabric Data Agent

**Stack:** Fabric Data Agent (no Azure AI Foundry resource needed), powered by Copilot in Fabric

**Grounding:**
- Semantic model (DirectQuery) as the data source
- Natural-language intents translated to DAX queries

**Example queries:**
- "Which items are missing sensitivity labels?"
- "Show me the top 10 workspaces by governance coverage"
- "Which users have admin access to production lakehouses?"
- "What items were created in the last 30 days?"

**Flow:**
1. User types natural-language question in Ask OneLens
2. Copilot parses intent and generates DAX query (using semantic model schema as context)
3. DAX query executes against DirectQuery semantic model
4. Results are fetched live from SQL Database
5. Copilot summarizes the answer in natural language

---

## Data Flow Summary

```
Fabric Tenant APIs
       ↓
sjd_governance_scan.py (Spark Job Definition, nightly + on-demand)
       ↓ raw catalog: Item / Workspace / Domain / LineageEdge / RoleAssignment
SQL MERGE (upsert on canonicalId) + tombstone sweep (hard delete on lastSeen watermark)
       ↓
Fabric SQL Database
   ├─→ App-derived scoring (CoverageMetric / PostureSnapshot / MetricSnapshot)
   ├─→ GraphQL API (Rayfin, fail-closed allowlist)
   │   └─→ Web App (React)
   └─→ Semantic Model (DirectQuery)
       └─→ Ask OneLens (Fabric Data Agent, native MCP endpoint)
```

---

## Security & Governance

### Authentication
- **Scanner:** the Fabric token library (`notebookutils.credentials.getToken`) — no
  service-principal secret, no Key Vault dependency to operate or rotate.
- **Web app:** Fabric SSO (the user's own Entra identity via the Rayfin auth broker).
- **Ask OneLens:** a separate delegated MSAL flow acquiring a Fabric-scoped token in the
  browser, calling the Data Agent's native MCP endpoint directly — no Azure AI Foundry
  resource, no server-side token relay.

### Data Access Control — a deliberate, tenant-wide allowlist (not per-item RBAC)

This is the one design decision worth being explicit about: **every entity is gated by the
same all-or-nothing `governanceReaderPolicy()` check, not by trimming rows to what each
viewer could already see in Fabric.**

- `governanceReaderPolicy()` (in `app/rayfin/data/access.ts`) evaluates the signed-in user's
  claims against an explicit allowlist — `ONELENS_GOVERNANCE_READER_EMAILS` and/or
  `ONELENS_GOVERNANCE_READER_SUBJECTS`. If you're on it, you can read every entity, tenant-wide.
  If you're not, every read is denied.
- **Fail-closed by construction:** generating the Rayfin data configuration throws if
  *neither* env var is set — a fresh deploy cannot accidentally ship with an open catalog.
- **Why not per-item Fabric RBAC?** This is a governance-observability tool: the people on
  the reader allowlist are governance staff who legitimately need the *whole* tenant picture
  (that's the product), not a per-user reflection of their own item-level Fabric permissions.
  Restricting *who* can open the app is the real control; once admitted, the catalog is
  intentionally not further row-filtered per viewer.
- **Practical implication for anyone extending this:** narrow the reader allowlist to your
  actual governance/steward group, and treat every entity's read policy as the one place
  this is enforced — there is no separate client-side filter to keep in sync.

### Write Path (Locked)
- Only the scanner (`sjd_governance_scan.py`) writes collected entities, via SQL `MERGE`
  keyed on `canonicalId`.
- The web app's **only** write is creating a `ScanRun` row with `status: 'requested'` (the
  "Run scan now" button) — every other entity is read-only from the app's perspective.
- A SQL application lock (`sp_getapplock`) serializes concurrent scan attempts so an
  on-demand run can't interleave with the nightly schedule.

### Audit trail
- `firstSeen` / `lastSeen` on every collected row give a simple, queryable audit trail.
- `ScanRun` records one row per execution (status, trigger, items written, timestamps) —
  a full run history, not just a "last successful scan" pointer.
- No secrets appear in scanner logs (the token library never surfaces raw credentials).

---

## Operational Considerations

### Refresh schedule
- **Default:** nightly, plus an on-demand "Run scan now" request queue (fulfilled by the
  next scheduled or manually triggered run).
- **Duration:** a few minutes, scaling with tenant size and the number of admin API calls needed.

### Failure handling
- **Partial-scan protection:** the tombstone sweep is guarded — it only deletes stale rows
  if the newly collected count is within a safe range of the previous count, so a transient
  API failure can't be misread as "everything was deleted" and wipe real data.
- **Best-effort enrichment:** optional enrichment (e.g. resolving a sensitivity-label GUID to
  its display name via Microsoft Graph) degrades gracefully and never fails the whole scan
  if it's unavailable from the running environment.

### Extensibility
- Every entity is `source`-tagged, so a new connector (Databricks, Purview, Informatica, …)
  is additive: install the connector, register a `Connector` row, and it starts writing the
  same shared entities — no schema or app change required for a new source.

---

## Key Decisions & Trade-offs

| Decision | Rationale |
|----------|-----------|
| **Secretless scanner** | Reduced operational burden; no Key Vault; Fabric token library instead |
| **One workspace only** | Simpler ops; tenant-wide discovery via admin APIs (not per-workspace apps) |
| **SQL Database (not Lakehouse)** | Rayfin generates GraphQL directly from it; a clean base for DirectQuery |
| **DirectQuery semantic model** | Always-fresh data; no duplication; source is a SQL Database, not a Lakehouse/Warehouse |
| **Locked write path** | Guarantees data consistency; no race conditions; easier to audit |
| **Allowlist gate, not per-item RBAC** | The product needs governance staff to see the whole tenant; access is controlled by *who* can open the app, not by row-filtering per viewer |
| **Hard-delete tombstoning (watermark-guarded)** | Deleted Fabric items disappear from the catalog like they should, without a stale scan being able to mass-delete real data |
| **Soft deletes (tombstone)** | Preserves historical data; enables "items deleted in last 30 days" queries |
| **GraphQL (not REST)** | Auto-generated from Rayfin; reduces hand-coded endpoints |
| **Fail-closed RBAC** | Default-deny; explicit allowlist; safer than default-allow |

---

## Next Steps / Future Enhancements

- **Real-time lineage** — Webhook-driven updates when items are created/modified (instead of nightly)
- **Predictive governance** — ML model to flag at-risk items (e.g., unendorsed high-value tables)
- **Multi-tenant** — Support for multiple isolated Fabric tenants in a single deployment
- **Custom policies** — User-defined governance rules with auto-remediation (e.g., auto-label unowned items)
- **Change audit** — Track who changed a governance attribute (owner, label, endorsement) and when

