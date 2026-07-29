import { entity, authenticated, uuid, text, date } from '@microsoft/rayfin-core';

import { governanceReaderPolicy } from './access.js';

/**
 * Workspace — a container of items (Fabric workspace, Databricks workspace,
 * Purview collection scope, …). Source-tagged canonical entity.
 *
 * Populated by scanners via the locked direct-SQL bulk-upsert (MERGE on
 * `canonicalId`) write path. The app reads only.
 */
@entity()
@authenticated('read', { policy: (claims) => governanceReaderPolicy(claims) })
export class Workspace {
  @uuid() id!: string;

  /** Stable business key for idempotent upsert: `${source}:workspace:${sourceId}`. */
  @text({ max: 400, unique: true }) canonicalId!: string;

  /** Originating connector: `fabric`, `databricks`, `purview`, `informatica`, … */
  @text({ max: 64 }) source!: string;

  /** Native identifier of the workspace in the source system. */
  @text({ max: 400 }) sourceId!: string;

  @text({ max: 400 }) name!: string;

  /** e.g. `Workspace`, `Personal`, `AdminWorkspace`. */
  @text({ max: 64, optional: true }) type?: string;

  /** e.g. `Active`, `Deleted`, `Orphaned`. */
  @text({ max: 64, optional: true }) state?: string;

  /** Capacity backing the workspace, when applicable. */
  @text({ max: 400, optional: true }) capacityId?: string;

  /** Canonical id of the owning Domain, when assigned. */
  @text({ max: 400, optional: true }) domainCanonicalId?: string;

  @date() firstSeen!: Date;
  @date() lastSeen!: Date;
}
