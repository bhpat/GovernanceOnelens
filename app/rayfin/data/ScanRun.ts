import { entity, authenticated, uuid, text, int, date } from '@microsoft/rayfin-core';

import { governanceReaderPolicy } from './access.js';

/**
 * ScanRun — the collection-tier run ledger (and manual-refresh request queue).
 *
 * Two producers, one table (Rayfin-native, no server function required):
 *  - the **scanner** (SJD) writes one row per execution via the locked direct-SQL
 *    MERGE path — this is the source of truth for "last ran" / run history; and it
 *    marks any pending `requested` rows as fulfilled when it completes.
 *  - the **app** creates a `requested` row (this is the only client write in the
 *    schema) when a steward clicks "Run scan now". The next collection cycle honors
 *    it. Immediate execution is a collection-tier action (see the Settings page).
 *
 * Reads and request creation are restricted to configured governance operators.
 * The create policy also fixes the only accepted request shape and binds the
 * requester identity to the authenticated email claim.
 */
@entity()
@authenticated('read', { policy: (claims) => governanceReaderPolicy(claims) })
@authenticated('create', {
  policy: (claims, item) => governanceReaderPolicy(claims)
    .and(claims.email.eq(item.requestedBy))
    .and(item.source.eq('fabric'))
    .and(item.status.eq('requested'))
    .and(item.trigger.eq('manual')),
  include: [
    'canonicalId',
    'source',
    'status',
    'trigger',
    'requestedBy',
    'requestedAt',
    'firstSeen',
    'lastSeen',
  ],
})
export class ScanRun {
  @uuid() id!: string;

  /** Stable key: `scanrun:{source}:{ts}` (runs) or `scanrun:request:{ts}` (requests). */
  @text({ max: 200, unique: true }) canonicalId!: string;

  /** Originating source: `fabric`, `purview`, … (matches the Connector row). */
  @text({ max: 64 }) source!: string;

  /** `requested` | `running` | `succeeded` | `failed`. */
  @text({ max: 32 }) status!: string;

  /** `manual` (queued from the UI) | `scheduled` (nightly SJD). */
  @text({ max: 32 }) trigger!: string;

  /** Email of the user who requested a manual run. */
  @text({ max: 200, optional: true }) requestedBy?: string;

  /** Run summary (JSON upsert counts) or failure detail. */
  @text({ max: 2000, optional: true }) message?: string;

  /** Canonical entities written by the run. */
  @int({ optional: true }) itemsWritten?: number;

  /** When a manual refresh was queued. */
  @date({ optional: true }) requestedAt?: Date;

  /** When execution started. */
  @date({ optional: true }) startedAt?: Date;

  /** When execution finished. */
  @date({ optional: true }) finishedAt?: Date;

  @date() firstSeen!: Date;
  @date() lastSeen!: Date;
}
