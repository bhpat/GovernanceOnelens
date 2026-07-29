import { entity, authenticated, uuid, text, date } from '@microsoft/rayfin-core';

import { governanceReaderPolicy } from './access.js';

/**
 * Domain — a governance domain / data-domain grouping (Fabric domains, Purview
 * collections, Databricks catalogs, …). Source-tagged canonical entity.
 *
 * Populated by scanners via the locked direct-SQL bulk-upsert (MERGE on
 * `canonicalId`) write path. The app reads only; row-level RBAC trimming
 * (Admin/Steward/Viewer via `claims.role`) is layered in Phase 3.
 */
@entity()
@authenticated('read', { policy: (claims) => governanceReaderPolicy(claims) })
export class Domain {
  @uuid() id!: string;

  /** Stable business key for idempotent upsert: `${source}:domain:${sourceId}`. */
  @text({ max: 400, unique: true }) canonicalId!: string;

  /** Originating connector: `fabric`, `databricks`, `purview`, `informatica`, … */
  @text({ max: 64 }) source!: string;

  /** Native identifier of the domain in the source system. */
  @text({ max: 400 }) sourceId!: string;

  @text({ max: 400 }) name!: string;

  @text({ max: 2000, optional: true }) description?: string;

  /** Canonical id of the parent domain, when the source models a hierarchy. */
  @text({ max: 400, optional: true }) parentDomainCanonicalId?: string;

  @date() firstSeen!: Date;
  @date() lastSeen!: Date;
}
