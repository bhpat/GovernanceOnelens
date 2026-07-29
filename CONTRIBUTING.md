# Contributing to Governance OneLens

Thanks for your interest in contributing! This is a template project — most people will fork
or clone it to stand up their own governance catalog rather than contribute back, and that's
a completely valid way to use it. This guide is for anyone who wants to fix a bug, add a
connector, or improve the app itself.

## Before you start

- Read the root [README.md](README.md) for what the app does and how it's deployed.
- Read [ARCHITECTURE.md](ARCHITECTURE.md) for the six-stage data flow, the entity schema, and
  — importantly — the access-control model (a fail-closed allowlist, not per-item RBAC).
- Skim [knowledge-base/](knowledge-base/) for the deeper design record, especially
  [06 - Reference Architecture](knowledge-base/06-rayfin-architecture.md) and
  [10 - Connector SDK Spec](knowledge-base/10-connector-sdk.md) if you're adding a new source.

## Project layout

| Folder | What lives here |
| --- | --- |
| `app/` | React + Vite + Fluent UI frontend, and the Rayfin data model (`app/rayfin/data/`) |
| `scanner/` | The Fabric-native collector (`sjd_governance_scan.py`), semantic-model/Data-Agent deploy scripts, and the Python test suite |
| `knowledge-base/` | Design record — architecture, API surface, frontend design, connector SDK |
| `docs/` | Screenshots and supporting assets referenced from the README |

## Development setup

```bash
cd app
npm install
npm run dev          # local dev server against a Rayfin backend
```

You'll need a Fabric capacity with the Fabric Apps (preview) workload enabled, and a scan
service principal — see the root README's **Getting started** section and
[`scanner/README.md`](scanner/README.md) for the full deploy runbook.

## Before opening a pull request

This repo's CI (`.github/workflows/ci.yml`) runs two jobs on every PR — make sure both pass
locally first:

```bash
# Frontend (from app/)
npm run lint          # ESLint
npx tsc -b             # TypeScript project build (typecheck)
npm test               # vitest
npm run build          # production build

# Scanner (from the repo root)
python -m py_compile scanner/*.py
```

If your change touches `app/src/services`, `app/rayfin/data`, or `scanner/*.py`, or if it's
heading toward a deployment, also run the
[`fabric-app-security-review`](.github/skills/fabric-app-security-review/SKILL.md) checklist
(sensitive-data exposure, over-fetching, client-side-only filtering, hardcoded config, debug
artifacts, connector credential scope) and fix any Critical/High findings before opening the PR.

## Conventions worth knowing

- **Entities are source-tagged.** Every entity in `app/rayfin/data/` carries a `source` field
  and a stable `canonicalId` (`${source}:${type}:${sourceId}`). New collection sources should
  follow the same pattern — see [10 - Connector SDK Spec](knowledge-base/10-connector-sdk.md).
- **The write path is locked.** Only the scanner writes collected entities (via SQL `MERGE`
  keyed on `canonicalId`); the app only reads, except for creating a `ScanRun` "run scan now"
  request. Don't add a new client-side write without updating both the entity's `@authenticated`
  policy and this contract.
- **Access control is one shared policy.** Every entity's read policy calls the same
  `governanceReaderPolicy()` in `app/rayfin/data/access.ts`. Don't introduce a second,
  divergent access check.
- **Styling is Fluent UI v9 (Griffel `makeStyles`) plus Tremor for chart-style cards.** Border
  rules must use the full shorthand (`border: '1px solid X'`) — mixing shorthand and longhand
  (e.g. `borderColor` alone) fails to type-check.
- **Every drill-down stat should be clickable** through to the underlying list of items it
  summarizes — this repo treats "dead-end stats" as a UX bug, not a nice-to-have.

## Reporting bugs / requesting features

Open a GitHub issue with a clear description, repro steps if applicable, and — for bugs —
what you expected versus what happened. For security vulnerabilities, see
[SECURITY.md](SECURITY.md) instead of opening a public issue.

## Code of Conduct

This project has adopted the [Microsoft Open Source Code of Conduct](CODE_OF_CONDUCT.md).
