import { entity, authenticated, uuid, text, date } from '@microsoft/rayfin-core';

import { governanceReaderPolicy } from './access.js';

/**
 * LineageEdge — a directional data-flow relationship between two governed assets
 * (the "lineage" backbone). Data flows FROM the upstream producer TO the
 * downstream consumer, e.g. `datasource → SemanticModel → Report`.
 *
 * Captured by the `lineage-capture` collection skill from the Fabric scanner API
 * (`getInfo` with `lineage=true`) and, where available, Purview Data Map. Names
 * and types are denormalized so edges to non-Item endpoints (raw datasources)
 * still render without a join. Upserted via the locked direct-SQL MERGE path.
 */
@entity()
@authenticated('read', { policy: (claims) => governanceReaderPolicy(claims) })
export class LineageEdge {
  @uuid() id!: string;

  /** Stable business key: `${source}:edge:${fromSourceId}->${toSourceId}:${relationship}`. */
  @text({ max: 900, unique: true }) canonicalId!: string;

  /** Originating connector: `fabric`, `purview`, … */
  @text({ max: 64 }) source!: string;

  /** Canonical id of the upstream producer (an Item, or a datasource pseudo-id). */
  @text({ max: 400 }) fromCanonicalId!: string;

  /** Canonical id of the downstream consumer (an Item). */
  @text({ max: 400 }) toCanonicalId!: string;

  /** Relationship kind: `DependsOn`, `DataSource`, `Upstream`. */
  @text({ max: 64 }) relationship!: string;

  /** Denormalized display name of the upstream endpoint. */
  @text({ max: 400, optional: true }) fromName?: string;

  /** Denormalized display name of the downstream endpoint. */
  @text({ max: 400, optional: true }) toName?: string;

  /** Denormalized type of the upstream endpoint (e.g. `SemanticModel`, `SQL`). */
  @text({ max: 128, optional: true }) fromType?: string;

  /** Denormalized type of the downstream endpoint (e.g. `Report`). */
  @text({ max: 128, optional: true }) toType?: string;

  @date() firstSeen!: Date;
  @date() lastSeen!: Date;
}
