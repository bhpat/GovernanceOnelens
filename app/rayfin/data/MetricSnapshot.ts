import { entity, authenticated, uuid, text, int, decimal, date } from '@microsoft/rayfin-core';

import { governanceReaderPolicy } from './access.js';

/**
 * MetricSnapshot — an APPEND-ONLY time-series point for a derived coverage or
 * posture metric. Unlike CoverageMetric/PostureSnapshot (which hold only the
 * latest value, MERGE-overwritten each run), each scan run writes a new snapshot
 * keyed by run timestamp, so the app can render trend deltas + sparklines.
 *
 * canonicalId = `derived:history:${kind}:${metric}:${scopeType}:${scope}:${runTs}`.
 */
@entity()
@authenticated('read', { policy: (claims) => governanceReaderPolicy(claims) })
export class MetricSnapshot {
  @uuid() id!: string;

  @text({ max: 500, unique: true }) canonicalId!: string;

  /** Always `derived`. */
  @text({ max: 64 }) source!: string;

  /** `coverage` | `posture`. */
  @text({ max: 32 }) kind!: string;

  /** The coverage metric or posture signal name. */
  @text({ max: 128 }) metric!: string;

  /** `tenant` | `workspace` | `domain` | `itemType`. */
  @text({ max: 64 }) scopeType!: string;

  @text({ max: 400, optional: true }) scopeCanonicalId?: string;

  /** Coverage → percent; posture → value. */
  @decimal() value!: number;

  @int({ optional: true }) numerator?: number;
  @int({ optional: true }) denominator?: number;

  /** When this point was measured (the scan run time). */
  @date() capturedAt!: Date;
}
