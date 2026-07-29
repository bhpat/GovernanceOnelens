---
name: fabric-app-security-review
description: Review this Fabric app (Governance OneLens) for sensitive-data exposure, Rayfin GraphQL/semantic-model over-fetching, connector and scanner credential risks, client-side-only filtering, and hardcoded environment configuration. Run before deployment, before a PR that touches app/src/services or app/rayfin/data, or after adding a new page/service/scanner script.
---

# Fabric App Security Review — Governance OneLens

When invoked, perform a security review of this repository. Focus on whether the app
exposes more data to the browser than the UI needs, logs or renders sensitive
information, over-fetches from the Rayfin GraphQL API / Fabric SQL views, or hardcodes
environment-specific identifiers in code that ships to the client. This mirrors the
generic "fabric-app-security-review" pattern but is tailored to this codebase's actual
structure below.

## Where to look in this repo
- `app/src/services/*.ts` — Rayfin GraphQL reads (`catalog.ts`, `lineage.ts`,
  `observability.ts`, `connectors.ts`, `scans.ts`) and the Ask OneLens MCP client
  (`askOneLens.ts`) — the client-side data-access boundary. `fetchAll()` in
  `rayfinClient.ts` is the one chokepoint every list read goes through.
- `app/src/pages/*.tsx`, `app/src/components/*.tsx` — where fetched data is rendered,
  filtered, exported (CSV), or passed through props.
- `app/rayfin/data/*.ts` — entity definitions and `@authenticated`/`policy` access
  control. Every entity's read/write scope is decided here, not in the UI.
- `scanner/*.py` — the SP/delegated-identity scanners that write to the Fabric SQL
  database, plus the SQL views (`create_semantic_views.py`) that ground the semantic
  model + the "Ask OneLens" Fabric Data Agent.
- `app/.env*`, `app/vite.config.ts`, `rayfin.yml`, `app/manifest.json` — configuration
  surfaces reachable from (or shipped into) the client bundle.

## Review Steps
1. **Semantic model / GraphQL over-fetching** — check whether `app/src/services/*.ts`
   selects only the fields a page actually renders (`ITEM_FIELDS`-style
   `.select([...])` lists), or pulls full rows/tables when a page needs only a rollup.
   Check `scanner/create_semantic_views.py` view definitions for columns not used by
   the semantic model or the Ask OneLens `aiInstructions`.
2. **Client-side filtering** — check whether `getItems()` / `getWorkspaces()` / etc.
   fetch the FULL tenant catalog to the browser and then filter/facet/search
   client-side (`HomePage.tsx`, `ObservabilityPage.tsx`, `LineageExplorerPage.tsx`),
   when a role/scope-based server-side filter would leak less to any signed-in user.
3. **PII in the UI, exports, or logs** — owner display names/UPNs, `modifiedBy`,
   sensitivity labels, and descriptions are real tenant PII/business data. Check they
   only render where the product needs them, that CSV/JSON exports don't leak more
   than the on-screen table, and that no `console.log`/`console.error`/network
   response ever surfaces a raw token, secret, or unnecessary personal field.
4. **Hardcoded configuration in shipped client code** — grep `app/src` for literal
   GUIDs/hostnames used as fallback values (tenant id, client id, workspace id, agent
   id, SQL server FQDNs) — anything baked into `import.meta.env.X || '<literal>'`
   ships in the JS bundle for anyone to read via browser devtools, regardless of
   whether the repo is public. Compare against `scanner/*.py`'s
   `os.environ.get(KEY, <default>)` pattern, which is server-side only and lower risk
   but still worth flagging (especially for an eventual OSS fork).
5. **Debug artifacts** — `console.log`/`console.debug`/verbose `catch` blocks that
   print raw error objects, and dev-only files (`preview.tsx`/`preview.html`) that
   must never ship in `vite build`'s `dist/`.
6. **Connector / Fabric item / SQL permission scope** — `@authenticated(...)` policies
   in `app/rayfin/data/*.ts` (does the grant match what the UI actually needs — `read`
   vs `create`/`update`/`delete`, and is there a `policy` restricting WHO), scan
   SP/delegated-identity scopes in `scanner/*.py`, and `credentialRef`/`scope` fields
   that must never hold a raw secret (only a Key Vault/connection reference).

## Focus Areas
- PII exposure: names, emails/UPNs, owner/modifiedBy fields, sensitivity labels,
  descriptions — anything that identifies a person or classifies tenant data.
- Excessive data access: `fetchAll()`/`.select([...])` pulling more columns or rows
  than a view actually renders; SQL views selecting columns the semantic model/Ask
  OneLens never uses.
- Hardcoded identifiers: tenant/workspace/item/agent GUIDs or hostnames present as
  literal fallback values in files under `app/src` (ships in the client bundle) — a
  different, higher severity than the same pattern in `scanner/*.py` (server-side).
- Client-side-only filtering: fetching the unfiltered tenant catalog and relying on
  the browser to hide rows, instead of a `@role`/policy-scoped read.
- Debug artifacts: `console.*` calls left in shipped code, raw error objects rendered
  to the UI, a dev-only preview harness leaking into a production build.

## Output Format
Return findings grouped by Critical, High, Medium, and Low severity. For each finding
include: location (file + line), issue, why it matters, evidence (the actual code), a
recommended fix, and a suggested prompt to remediate it.

## Remediation Guidance
Do not only describe the problem — fix Critical and High findings directly. Prefer:
narrowing `.select([...])` field lists, moving a filter into a `policy`/server-side
clause instead of client-side hiding, replacing a hardcoded fallback GUID with a
required env var (fail fast if missing, rather than silently defaulting to a real
tenant's id), removing/guarding logs, and preserving existing app behavior. After
making changes, re-run this repo's own gate — `npx tsc -b`, `npx eslint .`,
`npx vitest run`, `npx vite build` (app/), and `python -m py_compile scanner/*.py` —
matching `.github/workflows/ci.yml`, and summarize what changed plus anything that
still needs human review (e.g. rotating an id that was already shipped historically).
