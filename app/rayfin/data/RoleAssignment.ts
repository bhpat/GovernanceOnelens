import { entity, authenticated, uuid, text, date } from '@microsoft/rayfin-core';

import { governanceReaderPolicy } from './access.js';

/**
 * RoleAssignment — a principal's role on a scope (workspace/item/domain/tenant).
 * The raw material for effective-access and oversharing analysis. Source-tagged
 * canonical entity.
 *
 * Populated by scanners via the locked direct-SQL bulk-upsert (MERGE on
 * `canonicalId`) write path. The generated GraphQL API is read-only and limited
 * to the configured governance-reader subjects.
 */
@entity()
@authenticated('read', { policy: (claims) => governanceReaderPolicy(claims) })
export class RoleAssignment {
  @uuid() id!: string;

  /** Stable business key: `${source}:roleassignment:${sourceId}`. */
  @text({ max: 400, unique: true }) canonicalId!: string;

  /** Originating connector: `fabric`, `databricks`, `purview`, `informatica`, … */
  @text({ max: 64 }) source!: string;

  /** Native identifier of the assignment in the source system. */
  @text({ max: 400 }) sourceId!: string;

  /** Entra (or source) object id of the principal. */
  @text({ max: 400 }) principalId!: string;

  /** `User`, `Group`, or `ServicePrincipal`. */
  @text({ max: 64 }) principalType!: string;

  @text({ max: 400, optional: true }) principalDisplayName?: string;

  /** Role granted, e.g. `Admin`, `Member`, `Contributor`, `Viewer`. */
  @text({ max: 128 }) role!: string;

  /** Scope kind the role applies to: `Workspace`, `Item`, `Domain`, `Tenant`. */
  @text({ max: 64 }) scopeType!: string;

  /** Canonical id of the scoped entity (Workspace/Item/Domain). */
  @text({ max: 400 }) scopeCanonicalId!: string;

  @date() firstSeen!: Date;
  @date() lastSeen!: Date;
}
