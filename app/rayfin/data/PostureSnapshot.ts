import { entity, authenticated, uuid, text, decimal, date } from '@microsoft/rayfin-core';

import { governanceReaderPolicy } from './access.js';

/**
 * PostureSnapshot — a DERIVED posture signal (the "posture" lens): a point-in-time
 * governance-health value for a scope (e.g. orphaned items, item/workspace counts,
 * personal-workspace assets). Computed by the `four-lens-scorecard` analysis skill.
 */
@entity()
@authenticated('read', { policy: (claims) => governanceReaderPolicy(claims) })
export class PostureSnapshot {
  @uuid() id!: string;

  /** `derived:posture:${signal}:${scopeType}:${scope}`. */
  @text({ max: 400, unique: true }) canonicalId!: string;

  /** Always `derived`. */
  @text({ max: 64 }) source!: string;

  /** e.g. `itemCount`, `workspaceCount`, `orphanedItems`, `personalWorkspaceItems`. */
  @text({ max: 128 }) signal!: string;

  /** `tenant` | `workspace` | `domain` | `itemType`. */
  @text({ max: 64 }) scopeType!: string;

  @text({ max: 400, optional: true }) scopeCanonicalId?: string;

  @decimal() value!: number;

  /** `ok` | `warn` | `critical` — drives the scorecard color. */
  @text({ max: 32, optional: true }) status?: string;

  @date() computedAt!: Date;
}
