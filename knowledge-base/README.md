# Data Governance Knowledge Base

> Foundation for the **Governance OneLens** project.

This knowledge base is the shared foundation for building **Governance OneLens** —
the front-facing surface for all the rich governance data we collect across everything
touching Microsoft Fabric. The app is built on **[microsoft/rayfin](https://github.com/microsoft/rayfin)**,
a Backend-as-a-Service (auth, data APIs, storage, hosting) that is itself **built on
Microsoft Fabric** — so we showcase how easily Rayfin turns governance data into a real app.

> **Naming:** *Rayfin* = the microsoft/rayfin **BaaS platform**. *Governance OneLens*
> (*OneLens*) = this project — the governance app, built on Rayfin.

**Primary sources**

1. **Governance and compliance in Microsoft Fabric** — Microsoft Learn
2. **A Comprehensive Guide to Data and AI Governance** (eBook) — Databricks
   (<https://www.databricks.com/discover/data-governance>, not bundled in this repo)
3. **OneLake catalog overview** — Microsoft Learn
4. **microsoft/rayfin** — Backend-as-a-Service built on Fabric (<https://github.com/microsoft/rayfin>)

## Contents

**Foundation — concepts & vocabulary**

| Doc | What's inside |
| --- | --- |
| [04 - Glossary & References](04-glossary-and-references.md) | Key terms and source links. |

**Governance OneLens — the design we've scoped**

| Doc | What's inside |
| --- | --- |
| [05 - Governance Observability](05-governance-observability.md) | The four-lens model, per-layer monitoring matrix, telemetry backbone, single-tenant Administrator layer, and stewardship RACI. |
| [06 - Reference Architecture](06-rayfin-architecture.md) | Fabric-native components, tech choices, lineage & NL-Q&A capabilities, and the phased build backlog. |
| [07 - API Surface](07-api-surface.md) | The API-first catalog: every governance API by layer, mapped to the four lenses, plus scan cadence. |
| [08 - Frontend Design & UX](08-frontend-design.md) | How the app looks: best-in-class governance UX patterns mapped screen-by-screen to our entities and the four-lens model. |
| [09 - Phased Delivery Plan](09-phased-plan.md) | Iterative, phase-by-phase build plan (backend + frontend + connectors), with goals, tasks, and exit criteria. |
| [10 - Connector SDK Spec](10-connector-sdk.md) | The plug-in contract: canonical entities, capabilities, cursor/incremental rules, registration, and a Databricks example. |
| [11 - Rayfin Builder Feedback](11-rayfin-feedback.md) | Evidence-backed log of what worked and what didn't building on Rayfin — platform limitations hit, workarounds, and asks for the Rayfin team. |

For the product pitch, feature list, and getting-started steps, see the root
[README.md](../README.md). For the detailed six-stage architecture (data flow, entity schema,
and — importantly — the access-control model), see [../ARCHITECTURE.md](../ARCHITECTURE.md).
The sections below are supporting reference material that doesn't fit neatly into a single
numbered doc.

## Governance capability map (Microsoft Fabric)

The four areas Fabric's own governance surface is organized around — see
"Governance and compliance in Microsoft Fabric" (Microsoft Learn) for the full
breakdown of each:

| Manage your data estate | Secure, protect, and comply | Encourage discovery, trust, and use | Monitor, uncover, and act |
| --- | --- | --- | --- |
| Admin portal | Privacy | OneLake catalog | Monitoring hub |
| Tenant/domain/workspace settings | Data security | Endorsement, trust, and reuse | Capacity metrics |
| Domains | Purview Information Protection* | Tags | OneLake catalog |
| Workspaces | Purview Data Loss Prevention* | Data lineage and impact analysis | Admin monitoring |
| Capacities | Securing items in a workspace | Purview for governance across the org* | |
| Metadata scanning | Securing data in Fabric items | | |
| | Auditing | | |

\* Requires additional Microsoft Purview licensing.

## Guiding invariants

1. **One control plane per tenant** — each deployment is a single-tenant OneLens app (a Rayfin app).
2. **Security-trimmed at presentation** — scans run as the SP; users are trimmed by Fabric brokered auth.
3. **Observability survives lockdown** — signals come from scanner/audit/policy APIs, so it keeps working under Private Link. Compliance frameworks (FedRAMP/ISO/…) are an **overlay**, not the focus.

---

*Last updated: 2026-07-06. Terms and sources: [04 - Glossary & References](04-glossary-and-references.md).*
