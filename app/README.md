# Governance OneLens — App

The Rayfin (Fabric Apps) frontend for **Governance OneLens** — a Fabric-native governance
catalog and observability app. React + Vite + Fluent UI, a Rayfin data model (`rayfin/data`),
and a Fabric-authenticated GraphQL API. See the [repo root README](../README.md) for the
project overview and [knowledge-base/](../knowledge-base/) for the full design record.

## Getting started

```bash
# Deploy the backend and start the local dev server
npm install
npm run dev

# As needed, apply database migrations (after any change to rayfin/data/*.ts)
npm run rayfin:db
```

Open [http://localhost:5173](http://localhost:5173) to view the app.

To deploy to Fabric (static hosting + backend services):

Add the deployment-specific values to the ignored `rayfin/.env` file first:

```dotenv
ONELENS_GOVERNANCE_READER_EMAILS=admin@contoso.com,steward@contoso.com
RAYFIN_PUBLIC_FABRIC_SPA_CLIENT_ID=<entra-spa-client-id>
RAYFIN_PUBLIC_ASKONELENS_WORKSPACE_ID=<analysis-workspace-id>
RAYFIN_PUBLIC_ASKONELENS_AGENT_ID=<data-agent-id>
```

```powershell
npx rayfin up --workspace-id <fabric-workspace-id> --tenant <tenant-id>
```

The reader list is mandatory and compiled into every Rayfin entity's server-side
data policy. Use the exact email values returned by Fabric authentication. For
advanced identity providers, `ONELENS_GOVERNANCE_READER_SUBJECTS` accepts exact JWT
`sub` values; managed Fabric subjects are hierarchical Rayfin paths, not bare Entra
object IDs. Deployment fails closed when both settings are empty.

Rayfin maps user-defined `RAYFIN_PUBLIC_*` values to `VITE_RAYFIN_*` and
regenerates `.env.local` before every deployment. Keep the source values in
`rayfin/.env`; direct edits to `.env.local` are intentionally overwritten.

`rayfin up` adds the deployment's generated hosting origin to
`services.auth.allowedRedirectUris`; only the local origin is committed so forks do
not inherit another tenant's callback URL.

## Project structure

```text
├── rayfin/
│   ├── rayfin.yml            # Fabric service configuration (auth, data, static hosting)
│   └── data/                 # Governance entities (Item, Workspace, Domain, LineageEdge, …)
│       └── schema.ts         # Schema export consumed by the typed client
├── src/
│   ├── main.tsx               # Entry point + Rayfin client bootstrap
│   ├── App.tsx                 # Routes and auth gate
│   ├── hooks/
│   │   └── AuthContext.tsx     # React context wrapping the auth helpers
│   ├── components/             # Shell, shared dialogs, icon rendering
│   ├── pages/                   # Catalog/Home, Lineage explorer, Observability, Workspaces,
│   │                             # Connectors, Settings
│   └── services/                 # Rayfin client wiring + typed reads (catalog, lineage,
│                                    # observability, connectors, scans)
└── package.json
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Provision the backend (excluding static hosting) and start the local Vite dev server |
| `npm run build` | Typecheck (`tsc -b`) + production build |
| `npm run build:fabric` | Same production build, used as the static-hosting build command in `rayfin.yml` |
| `npm run lint` | Lint with ESLint |
| `npm run test` | Run unit tests with Vitest |
| `npm run rayfin:db` | Apply database migrations (`rayfin up db apply`) |

Full deploy (backend services + static hosting) is `npx rayfin up --workspace-id <id> --tenant <id>`.

