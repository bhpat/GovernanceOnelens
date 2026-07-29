import { entity, authenticated, uuid, text, int, decimal, date } from '@microsoft/rayfin-core';

import { governanceReaderPolicy } from './access.js';

/**
 * CoverageMetric — a DERIVED governance-coverage measure (the "coverage" lens):
 * what fraction of in-scope assets carry a given governance attribute
 * (sensitivity label, endorsement, description, domain, owner). Computed by the
 * `four-lens-scorecard` analysis skill from the catalog, not by a connector.
 */
@entity()
@authenticated('read', { policy: (claims) => governanceReaderPolicy(claims) })
export class CoverageMetric {
  @uuid() id!: string;

  /** `derived:coverage:${metric}:${scopeType}:${scope}`. */
  @text({ max: 400, unique: true }) canonicalId!: string;

  /** Always `derived` (app-computed, not a connector source). */
  @text({ max: 64 }) source!: string;

  /** e.g. `sensitivityLabeled`, `endorsed`, `described`, `domainAssigned`, `owned`. */
  @text({ max: 128 }) metric!: string;

  /** `tenant` | `workspace` | `domain` | `itemType`. */
  @text({ max: 64 }) scopeType!: string;

  @text({ max: 400, optional: true }) scopeCanonicalId?: string;

  @int() numerator!: number;
  @int() denominator!: number;
  @decimal() percent!: number;

  @date() computedAt!: Date;
}
