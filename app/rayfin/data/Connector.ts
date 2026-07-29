import { entity, authenticated, uuid, text, int, date } from '@microsoft/rayfin-core';

import { governanceReaderPolicy } from './access.js';

/**
 * Connector — the registry row that makes a governance source pluggable.
 *
 * Per the Connector SDK ([knowledge-base/10-connector-sdk.md]) a source is added
 * as **data, not code**: install the connector package + insert one row here. The
 * scheduler enumerates enabled rows and runs the matching connector, which maps
 * its source into the shared canonical entities (Item / RoleAssignment / … all
 * `source`-tagged). This entity is the single source of truth the Connectors
 * gallery renders and the runner drives.
 */
@entity()
@authenticated('read', { policy: (claims) => governanceReaderPolicy(claims) })
export class Connector {
  @uuid() id!: string;

  /** Stable key: `connector:${source}`. */
  @text({ max: 200, unique: true }) canonicalId!: string;

  /** Connector id / originating source: `fabric`, `purview`, `informatica`, … */
  @text({ max: 64 }) source!: string;

  /** Skill kind: `platform` (setup) | `collection` (ingest) | `analysis` (answers). */
  @text({ max: 32 }) kind!: string;

  @text({ max: 200 }) displayName!: string;

  @text({ max: 2000, optional: true }) description?: string;

  /** `connected` | `available` | `planned` | `error`. Drives the gallery state. */
  @text({ max: 32 }) status!: string;

  /** Source endpoint (host / workspace / account URL). */
  @text({ max: 400, optional: true }) endpoint?: string;

  /** Key Vault / Fabric connection reference — NEVER a raw secret. */
  @text({ max: 400, optional: true }) credentialRef?: string;

  /** JSON scope, e.g. `{ "catalogs": ["main"] }`. */
  @text({ max: 2000, optional: true }) scope?: string;

  /** Cron schedule string. */
  @text({ max: 128, optional: true }) schedule?: string;

  /** Opaque incremental cursor persisted after each successful run. */
  @text({ max: 900, optional: true }) cursor?: string;

  /** JSON array of declared capabilities (`items`, `lineage`, `roles`, …). */
  @text({ max: 500, optional: true }) capabilities?: string;

  /** Count of canonical entities this connector currently contributes. */
  @int({ optional: true }) itemCount?: number;

  /** First registration time. */
  @date() firstSeen!: Date;

  /** Last successful run / registration time. */
  @date() lastSeen!: Date;
}
