# Rayfin — Builder Feedback, Gaps & Limitations

> **Purpose.** A living log of our experience building **Governance OneLens** on Rayfin
> (Fabric Data Apps / BaaS), for the hackathon submission criterion *"Feedback on experience
> using Rayfin, gaps or limitations you may have encountered."* Every item below was hit and
> verified in-session — errors, versions, and file/line evidence are included so the Rayfin
> team can act on them. Severity: 🔴 blocker · 🟠 friction · 🟡 papercut · 🟢 worked well.

_Last updated: 2026-07-09 · Rayfin CLI `1.33.2` (preview `1.34.0-beta.0`) · packages `@microsoft/rayfin-*@1.33.2`._

---

## Summary

| # | Area | Limitation | Severity | Workaround we used |
|---|---|---|---|---|
| 1 | Functions | Rayfin Functions tooling is **TypeScript-only**; Fabric UDF backend is **Python-only** — can't deploy | 🔴 | Kept a Spark Job Definition scanner instead |
| 2 | Functions | No **timer/cron trigger** in the Functions SDK (invocation/RPC only) | 🟠 | External scheduler required |
| 3 | Functions | `functions` not in `rayfin init --services`; no Functions guide in installed docs | 🟡 | Discovered via `rayfin functions init` + `npm pack` |
| 4 | Data API | `.execute()` silently returns **only the first page** (DAB default 100) | 🟠 | Built a `fetchAll()` cursor drainer |
| 5 | Data API | No `count()` on the fluent client | 🟡 | `select` minimal + `results.length` |
| 6 | Data API | Writes only via GraphQL as an authed user → no clean **service-principal bulk upsert** path | 🟠 | Direct-SQL `MERGE` (JDBC/pyodbc) out-of-band |
| 7 | Data model | `@text()` without `max` → `NVARCHAR(MAX)` → GraphQL schema build fails at runtime | 🟡 | `@text({ max: N })` on every string field |
| 8 | Data model | No many-to-many; composite field constraints unsupported | 🟡 | Explicit join entity / per-field constraints |
| 9 | Deploy/CLI | Enabling a module + `rayfin up` redeploys the **whole app**; a failed module reports mixed success | 🟡 | Revert config + redeploy clean |
| 10 | Maturity | `@microsoft/rayfin-functions` marked **experimental** ("may change substantially") | 🟠 | Deferred to product roadmap |
| 11 | Lifecycle | No **server-side entity hooks / actions** (on create/update) → onboarding a connector registers as data but can't *actuate* (provision a secret, create a connection, trigger the collector) | 🟠 | Register-now, collect-on-cycle; actuation left to the collection tier |
| 12 | Data model | `role()`/`@authenticated()` only accept the literal role name `'authenticated'` — no distinct named roles (Admin/Steward/Viewer); tiering must be hand-rolled via a `check` claims predicate | 🟡 | Single `authenticated('read')` tier everywhere; audience tiering not yet built |
| 13 | Docs/naming | `@microsoft/rayfin-mcp` is a **developer-documentation** MCP server (wraps `rayfin docs`), not an end-user "query my app's data" agent — our own architecture doc mis-described it | 🟡 | Corrected the doc; installed + pinned the package for reliable dev tooling |

Adjacent Fabric-platform gaps (not Rayfin itself, but hit while building the connector) are logged in the last section.

---

## Detailed findings

### 1. 🔴 Rayfin Functions can't deploy — TypeScript tooling vs Python-only Fabric UDF backend
**What we wanted.** Move our scheduled governance scan onto **Rayfin Functions** to drop the
Spark Job Definition + lakehouse (a big simplification) and run ingest natively.

**What happened.** The preview is enabled on our capacity and the deploy *reaches* the Fabric
User Data Functions backend, but is rejected:
```
FUNCSET_DEPLOY_FAILED (400): Unsupported Argument: Runtime.
Value: TYPESCRIPT is unsupported. Supported values are: PYTHON
```
**Root cause (verified in the CLI).** `@microsoft/rayfin-cli` `dist/utils/functions-metadata-generator.js`:
- globs **`**/*.ts` only** and errors on "No TypeScript source files",
- parses handlers with the **TypeScript compiler AST**, and
- returns a **hard-coded** `runtime: 'TypeScript'`, which `dist/services/fabric/udf.js` sends as the UDF `language`.

The Fabric UDF runtime accepts **Python only**, so the two layers can't meet. Confirmed identical
in both `1.33.2` (latest) and `1.34.0-beta.0` (preview) — a `grep` for `PYTHON`/`.py`/`'Python'`
across the preview CLI `dist/**` returns **zero** matches. There is **no Python authoring path** and
no config/flag to change the emitted runtime.

**Impact.** The single most impactful simplification (native serverless ingest, remove Spark/SJD/lakehouse)
is blocked. We kept the SJD.

**Ask.** Add a **Python authoring path** to `rayfin-functions` (emit/parse `function_app.py`, set
`runtime: 'Python'`), **or** enable **TypeScript** in the Fabric UDF runtime — and document which
lands first.

### 2. 🟠 No native schedule/timer trigger for Functions
The Functions client surface is **invocation only** (`client.functions.<name>.invoke(...)`). We found
no built-in **timer/cron** trigger, so even once Functions work, a scheduled scan still needs an external
caller (a pipeline or cron). A first-class **timer-triggered function** (or a `schedule:` field on the
function) would make Functions a complete replacement for scheduled Spark jobs.

### 3. 🟡 Functions discoverability
`functions` is **not** in `rayfin init --services` (only `auth,data,storage`), there is **no Functions
guide** in the installed `rayfin docs` corpus, and `rayfin docs discover "functions"` returns nothing —
yet `@microsoft/rayfin-functions` **is** in the package catalog and a `functions:` key exists in
`rayfin.yml`. We only learned the authoring model (`host.json`, `src/function_app.ts`, `udf.func(...)`,
bundled `microsoft-fabric-user-data-functions` tarball) by running `rayfin functions init` and unpacking
the tarball. A short "Functions (preview)" guide + a `--services functions` option would close the gap.

### 4. 🟠 `.execute()` silently truncates to the first page (100 rows)
The fluent client's `.execute()` returns only the first DAB page (default 100). Our catalog has 152 items,
so the UI silently showed **100** until we noticed. We built a `fetchAll()` helper that loops
`executePaginated()` on `endCursor` until `hasNextPage` is false. **Ask:** make the cap obvious (warn/throw
on truncation) or offer a first-class "drain all" read.

### 5. 🟡 No `count()` on the fluent client
Documented in Known Limitations. We compute `results.length` after selecting minimal fields, which forces
fetching rows just to count. A server-side `count()` / aggregate would help dashboards.

### 6. 🟠 No batch/bulk upsert via the data API — only per-record mutations
**(2026-07-09 correction — verified against the installed `@microsoft/rayfin-data@1.33.2` type
declarations.)** Our original claim that the data API has **no** service-identity write path was
imprecise. It does: `RayfinServerClient` (`@microsoft/rayfin-client`) accepts a supplied/rotatable
`accessToken` (no interactive auth needed) and exposes the **same** typed `dataApi.<Entity>` surface,
including **`create()`, `update()`, `delete()`, and `upsert(where, create, update)`** mutations
(`GraphQLEntityClient` in `graphql/GraphQLEntityClient.d.ts`). So a non-interactive caller genuinely
can write through the generated GraphQL API today.

The real, narrower gap: **every mutation is single-record.** There is no `createMany`/batch-upsert
method anywhere in the typed surface (`graphql/types.d.ts` has no array-input mutation type). A scan
writing ~155 `Item` rows + ~50 `LineageEdge` rows would mean ~200+ individual HTTP/GraphQL round-trips
instead of one SQL `MERGE` statement — workable if parallelized in small batches, but a meaningfully
different cost/latency profile, and still requires opening `create`/`update` on entities that are
today deliberately read-only for all authenticated users. We kept the **locked direct-SQL `MERGE`**
(JDBC/pyodbc) for this reason.

**Ask:** a first-class **batch upsert** mutation (array input, one round-trip) on the generated GraphQL
API, paired with docs showing the `RayfinServerClient` + role-gated `check` policy pattern as the
supported way to let a scanner/service identity write through Rayfin instead of bypassing it.

### 7. 🟡 `@text()` without `max` breaks the GraphQL schema at runtime
Per Known Limitations, an unbounded `@text()` becomes `NVARCHAR(MAX)`, which the metadata provider can't
build into a GraphQL schema — the deploy *succeeds* but the API throws "Internal server error" at runtime.
We set `@text({ max: N })` on every string field. This is easy to trip on; a **build-time validation error**
would be far better than a runtime 500.

### 8. 🟡 Data-model constraints
No many-to-many (must model an explicit join entity with two `@one()` navigations); `@entity()` doesn't
accept composite field constraints. Both are documented, but worth calling out for anyone modeling a
canonical/graph-shaped domain like governance lineage.

### 9. 🟡 Whole-app deploy + mixed-success reporting
`rayfin up` rebuilds/redeploys static + data + auth on every run, and when we enabled `functions` the
functions step failed while the CLI still printed "Backend services were deployed successfully" and a
"deployed" banner — the failed module isn't cleanly isolated in the exit status/summary. Per-module deploy
(`rayfin up functions deploy` exists) and a clearer aggregate status would reduce confusion.

### 10. 🟠 Preview/experimental churn
`@microsoft/rayfin-functions` is explicitly *"experimental — may change substantially."* Reasonable for a
preview, but it means we can't build the core ingest on it yet. A stability/GA signal per package would help
us decide what to depend on.

### 11. 🟠 No server-side entity lifecycle hooks / actions — onboarding can register but not *actuate*
**What we wanted.** A one-click **"+ Add connector"** onboarding (e.g., Microsoft Purview): the user picks a
source, supplies an endpoint + a *reference* to a secret, and the connector goes live.

**What Rayfin makes easy.** The *registration* half is delightful and pure Rayfin: onboarding writes a
`Connector` row via the generated GraphQL API (`client.data.Connector.create/update`), and the data-driven
gallery immediately reflects it (`planned → connected`). "Register a source as data" is exactly the SDK
contract — no bespoke backend.

**The gap.** The *actuation* half has no home. There is no **lifecycle hook / trigger / server-side action**
that fires when an entity is created or updated, so nothing can (a) provision or bind the Key Vault secret /
Fabric connection referenced by `credentialRef`, (b) validate connectivity, or (c) trigger the first
collection. Combined with the Functions block (#1) and no timer trigger (#2), a newly onboarded connector
can only be picked up on the **next scheduled collection cycle** — "register now, collect later" — rather
than going live on submit. The browser can't close this itself (no secrets client-side; Fabric REST is
CORS-blocked and needs a different token audience).

**Ask.** A **server-side entity lifecycle hook** (e.g., an `onCreate`/`onUpdate` handler, a webhook, or a
Rayfin Function bound to an entity event) would let onboarding *do* something — provision the credential
binding and kick off the first collection — turning "+ Add" into true one-click. This is the single feature
that would make the connector-onboarding UX complete.

### 12. 🟡 `role()`/`@authenticated()` hard-code the role name to `'authenticated'` — no named-role tiers
**(2026-07-09, verified against `@microsoft/rayfin-core@1.33.2`.)** `decorators/decorators.d.ts` types
`role(roleName: 'authenticated', actions, options?)` — the **role name itself is a literal type of
exactly one value**. There is no `'admin'`/`'steward'`/`'viewer'` role to declare; the only way to
differentiate audiences is the `check: (claims, item) => PolicyExpression` predicate inside that single
role, comparing `claims.sub` / `claims.email` / `claims.role` against item fields. That's a real and
fairly expressive row-level DSL (`ClaimRef`/`FieldRef` with `.eq()`/`.neq()`/`.and()`/`.or()`), but it's
a materially different mental model than "named roles," and every entity in this project
(`Item`, `Workspace`, `Domain`, `LineageEdge`, `CoverageMetric`, `PostureSnapshot`, `MetricSnapshot`,
`RoleAssignment`) currently uses a bare `@authenticated('read')` with **no** `check` — i.e., we have
not yet exercised the row-level policy DSL at all, despite our own architecture doc describing
`@role`-trimmed access as a core design principle. **Ask:** document the claims-predicate pattern as
*the* way to build audience tiers (the docs read as if named roles exist), and consider adding a
`claims.role.in([...])` operator to make multi-tier checks less verbose than chained `.or()`.

### 13. 🟡 `@microsoft/rayfin-mcp` is a developer-docs MCP server, not an end-user data agent
**(2026-07-09.)** [06 - Reference Architecture](06-rayfin-architecture.md) originally described
`@microsoft/rayfin-mcp` as the way to "expose governance data to Copilot / agents (NL Q&A)" —
that description was **wrong**, corrected after actually installing and inspecting it. Its own
`README.md` and compiled `dist/mcp.d.ts` (`createServer(options?: { modules?: DocModule[] })`,
importing only from `@microsoft/rayfin-docs`) show it is a **documentation MCP server**: it exposes
`search_docs`/`get_doc`/`list_docs`/`discover_packages` (matching `AGENTS.md`'s tool list) so a
*coding agent* can query Rayfin's own docs — the same content `npx rayfin docs search` serves —
not a way to let an *end user* ask natural-language questions over the app's own entities
(`Item`/`LineageEdge`/etc.). We'd already scaffolded a correct `.mcp.json` for it
(`npx -y @microsoft/rayfin-mcp start`) but had never installed the package itself, so every
invocation was an **un-pinned, ad-hoc `npx` fetch** — on our corporate registry that failed with
`E401` (the same proxy gap as other third-party packages this session) until we installed it
explicitly via `--registry https://registry.npmjs.org`.

**Ask:** fix the architecture guidance/marketing language around `rayfin-mcp` so builders don't
assume it's an end-user NL data-agent SDK, and consider shipping it pre-installed (not just
pre-configured in `.mcp.json`) by project templates so the ad-hoc-`npx`-on-first-use gap doesn't
recur. A genuine "expose *my app's* entities to Copilot" story would need a **separate** package
(or documented recipe) that wraps the generated GraphQL API as MCP tools — that does not exist today.

---

## What worked well 🟢
Balanced feedback — Rayfin got a lot right:
- **Canonical, `source`-tagged data model + generated GraphQL API** made a multi-connector governance schema
  natural; the app is genuinely data-driven.
- **`rayfin up`** one-command deploy (static + data + auth + hosting) is smooth and idempotent; redeploys are fast.
- **Fabric auth** (`auth.fabric`) worked out of the box with the SSO handoff.
- **`rayfin docs`** (search/get/discover/catalog) in the CLI is a great in-loop reference.
- **Decorator-based entities** (`@entity`, `@authenticated`, `@text`, `@uuid`, `@date`) are clean and readable.
- **`rayfin up --dry-run`** ("no API calls") was perfect for safely probing config changes.
- **Adding a new entity was frictionless** — dropping a `@entity() Connector` class + one `schema.ts` line, then `rayfin up` + `rayfin up db apply`, evolved the schema to **DAB v31**, generated the SQL table *and* the typed GraphQL surface (`client.data.Connector`) with zero hand-written SQL or API code. This is exactly what made the connector-registry ("register a source as data") pattern cheap to build.
- **Client writes gated by decorator policy** — flipping `Connector` to `@authenticated(['read','create','update'])` and adding a create-only `ScanRun` (`['read','create']`) let the UI onboard connectors and queue a manual refresh through the generated GraphQL mutations, with per-action authorization declared in one line and no endpoint code. Data-driven onboarding fell out of the model naturally.
- **Stacked `@authenticated()` decorators are additive, not overriding** — confirmed by reading the compiled `decorators.js` (`config.roles.push(roleDeclaration)`): a bare `@authenticated('read')` plus a second `@authenticated(['create','update','delete'], { policy: ... })` on the same entity produce two independent DAB role entries, so a row-level write policy can be layered on **without touching the existing read grant**. This let us add scan-identity-scoped write access to `RoleAssignment` with zero risk to the read path already serving the live catalog. (One documentation nit hit along the way: the `authenticated()`/`role()` JSDoc example shows `{ check: (claims, item) => ... }`, but the real, currently-shipped option key is `policy`, per `RoleDeclarationOptions` in `options.d.ts` and the compiled decorator body — `check` silently does nothing since it isn't a recognized option and would need to be caught by TypeScript's excess-property check.)

---

## Adjacent Fabric-platform gaps (hit while building the connector)
Not Rayfin itself, but part of the end-to-end experience:
- **Sensitivity labels return GUIDs**, not names. The scanner APIs only emit the MIP `labelId`. Resolving
  the taxonomy needs Graph `InformationProtectionPolicy.Read.All`; the Azure CLI first-party app can't even
  request a token for it (`AADSTS65002`). We granted the scan SP the app permission and confirmed the
  `beta/security/informationProtection/sensitivityLabels` endpoint returns the full taxonomy **from outside**
  — but the identical call returns **empty from inside Fabric Spark** (egress / token-library interception),
  so the SJD still can't resolve names. We resolve the GUIDs out-of-band and map them at render time
  (`SENSITIVITY_LABELS` in the app), which is resilient regardless of what the collector writes.
- **Domain membership isn't on the `admin/workspaces` payload** — only `/admin/domains/{id}/workspaces` — so
  items don't inherit a domain without a second call.
- **Metadata scanner is a Power BI admin API** (`api.powerbi.com/.../admin/workspaces/getInfo`); the Fabric
  equivalent 405s and needs a separate PBI-scoped token.
- **Fabric Job Scheduler API** takes `jobType` as a **path segment** (`/jobs/{jobType}/schedules`), not a query
  param — the query-param form returns a misleading `EntityNotFound`.
- **A Spark Job Definition hard-requires a default lakehouse** — deleting the bound lakehouse makes every run
  fail instantly with `SparkJobDefinitionInvalid: 'DefaultLakehouseArtifactId' is required`; the lakehouse must
  be recreated and re-bound via `updateDefinition` even though our scanner writes only to SQL, not the lakehouse.
- **Fabric Spark → Key Vault needs explicit network reachability** — with the vault's public network access
  disabled (and no private endpoint), `notebookutils.credentials.getSecret` fails at runtime with a generic
  `Spark_User_TL_UnknownException … state=[dead]`; only the driver stderr reveals the real `403 ForbiddenByConnection`.
  The fix is a reachable path (public access or a Fabric managed private endpoint) — worth surfacing earlier than the driver log.
  **(2026-07-09 update, escalated to 🔴.)** On a vault governed by an Azure Policy that hard-locks
  `publicNetworkAccess` to `Disabled` — `az keyvault update --public-network-access Enabled` (and the
  `networkAcls`-only "selected networks" variant) both **silently revert** the property in the same response
  while sibling ACL fields (`defaultAction`, `bypass`) do stick — there is **no public-access path at all**, only
  a managed private endpoint. Worse, we could not get to the driver stderr the original finding relies on: every
  candidate log endpoint we tried (`sparkJobDefinitions/{id}/livySessions/{id}/logs`, `.../driverlog`,
  `spark/applications/{id}/logs?type=driver`) returned `404 EntityNotFound`, and the job-instance failure payload
  never varied beyond `Spark_User_TL_Unknownexception … state=[dead]` — identical whether the true cause was a
  network-blocked `getSecret` or (as we later proved) an unrelated code bug. **Ask: a structured `failureReason`
  that distinguishes "library/runtime init failed" from "user code raised," and a reachable driver-log API for
  Spark Job Definitions** (Livy log APIs exist for notebook sessions but 404'd for every SJD path we tried).
- **Secretless collection via the Fabric token library works — and should be the documented default.**
  **(2026-07-09, 🟢 finding + ask.)** Replacing the client-credentials + Key Vault pattern with
  `notebookutils.credentials.getToken(<audience>)` inside the Spark Job Definition removed the Key Vault
  dependency, the client secret, and the whole failure class above — **with zero code beyond swapping the token
  fetch**. Verified end-to-end: `getToken` accepted for `https://api.fabric.microsoft.com` (`admin/workspaces` →
  200), the Power BI admin scope via the `pbi` alias (`admin/workspaces/getInfo` → 202), and
  `https://database.windows.net` (JDBC `MERGE` succeeded) — for **both an on-demand run and, critically, the
  unattended scheduled run** (`invokeType=Scheduled`, fired by the Fabric scheduler with no interactive session,
  completed cleanly). One gap: the `https://graph.microsoft.com` audience returned a hard
  `Spark_System_TM_InternalError` on every attempt — harmless here (we resolve sensitivity-label names
  out-of-band), but worth root-causing since Graph is otherwise a normal `getToken` audience. **Important
  nuance for the docs:** `getToken` does **not** return the *workspace identity* — it returns a **delegated
  token for the identity that submitted or owns the schedule of the job** (`idtyp=user`,
  `scp=user_impersonation`). That's an excellent, low-friction pattern for a tenant-admin-scoped scanner (the job
  simply must be owned/run by an identity with the needed admin scopes) but it is a materially different trust
  model than "workspace identity," and we could not find this documented anywhere in the installed `rayfin docs`
  or Fabric Spark docs. **Ask:** document `getToken`'s actual identity semantics (delegated submitter/owner, not
  workspace identity) and promote the secretless pattern as the recommended default over Key Vault + a
  service-principal secret for Fabric-native collectors.
- **Admin-API metadata enrichment is gated by two tenant settings with no in-response signal.** The Power BI
  scanner's `getInfo` silently omits `tables` (schema/column breadth) and expression-level detail unless the
  tenant settings **`AdminApisIncludeDetailedMetadata`** and **`AdminApisIncludeExpressions`** are enabled —
  there is no partial-result flag, warning, or error indicating richer data exists but is turned off. We only
  found this by noticing `tableCount`/`columnCount` were unconditionally empty and cross-checking
  `admin/tenantsettings`. **Ask:** have `getInfo` note in the response when a requested enrichment
  (`datasetSchema`/`datasetExpressions`) was suppressed by tenant policy, rather than returning as if the field
  doesn't exist.
- **Deep item-content APIs need workspace membership, not tenant-admin** — a least-privilege scanner SP with
  tenant-admin *read* (Tenant.Read.All + "SPs can call admin APIs") enumerates every workspace/item via the admin
  APIs, but the per-item content APIs — `getDefinition` (returns **401**) and OneLake `shortcuts` (returns **403**)
  — require the SP to be an actual **member** of each workspace. So **transformation lineage** (parsing
  CopyJob/DataPipeline definitions for source→job→sink) and **shortcut lineage** (cross-workspace OneLake shortcuts)
  can't be captured tenant-wide without adding the SP to every workspace — which breaks the "one governance
  workspace, nothing per-workspace" model. There's **no admin-scoped `getDefinition`/shortcuts**. A read-only admin
  equivalent would close this. (We granted the SP Contributor on two demo workspaces to prove the capture works.)

---

_This document is maintained as we continue building (connector-SDK rework). New limitations are appended with date + evidence._