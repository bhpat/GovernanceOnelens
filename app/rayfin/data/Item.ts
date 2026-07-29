import { entity, authenticated, uuid, text, int, date } from '@microsoft/rayfin-core';

import { governanceReaderPolicy } from './access.js';

/**
 * Item — any governed asset (Fabric item such as Lakehouse/Report/SemanticModel/
 * Notebook, a Databricks table, a Purview asset, …). Source-tagged canonical entity.
 *
 * Populated by scanners via the locked direct-SQL bulk-upsert (MERGE on
 * `canonicalId`) write path. The app reads only.
 */
@entity()
@authenticated('read', { policy: (claims) => governanceReaderPolicy(claims) })
export class Item {
  @uuid() id!: string;

  /** Stable business key for idempotent upsert: `${source}:item:${sourceId}`. */
  @text({ max: 400, unique: true }) canonicalId!: string;

  /** Originating connector: `fabric`, `databricks`, `purview`, `informatica`, … */
  @text({ max: 64 }) source!: string;

  /** Native identifier of the item in the source system. */
  @text({ max: 400 }) sourceId!: string;

  @text({ max: 400 }) name!: string;

  /** e.g. `Lakehouse`, `Report`, `SemanticModel`, `Notebook`, `Table`. */
  @text({ max: 128 }) itemType!: string;

  /** Canonical id of the owning Workspace. */
  @text({ max: 400, optional: true }) workspaceCanonicalId?: string;

  /** Canonical id of the owning Domain, when assigned. */
  @text({ max: 400, optional: true }) domainCanonicalId?: string;

  @text({ max: 2000, optional: true }) description?: string;

  /** Display name / UPN of the owner, when known. */
  @text({ max: 400, optional: true }) owner?: string;

  /** Endorsement level: `None`, `Promoted`, or `Certified`. */
  @text({ max: 32, optional: true }) endorsement?: string;

  /** Free-form tags, stored as a JSON array string for MSSQL/GraphQL simplicity. */
  @text({ max: 2000, optional: true }) tags?: string;

  /** Effective sensitivity/classification label, when known. */
  @text({ max: 200, optional: true }) sensitivityLabel?: string;

  /** Deep-link back to the item in the Fabric portal ("Open in Fabric"). */
  @text({ max: 1000, optional: true }) deepLink?: string;

  /** ISO timestamp the item was created in the source (best-effort, PBI artifacts). */
  @text({ max: 40, optional: true }) createdDate?: string;

  /** ISO timestamp the item was last modified (best-effort). */
  @text({ max: 40, optional: true }) modifiedDate?: string;

  /** UPN / display name of the last modifier (best-effort). */
  @text({ max: 400, optional: true }) modifiedBy?: string;

  /** Last refresh outcome for refreshable items: `Completed`, `Failed`, `Unknown`. */
  @text({ max: 40, optional: true }) refreshStatus?: string;

  /** ISO timestamp of the last (attempted) refresh. */
  @text({ max: 40, optional: true }) lastRefresh?: string;

  /** Approximate size in bytes, when the source exposes it. */
  @int({ optional: true }) sizeBytes?: number;

  /** Number of tables in a semantic model / tabular item (schema breadth). */
  @int({ optional: true }) tableCount?: number;

  /** Number of columns across all tables (column-level breadth). */
  @int({ optional: true }) columnCount?: number;

  @date() firstSeen!: Date;
  @date() lastSeen!: Date;
}
