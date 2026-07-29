import { getRayfinClient, isLocalBackend, fetchAll } from './rayfinClient';
import { cachedQuery } from './queryCache';
import type { CatalogItem } from './catalog';

/** A directional data-flow edge (upstream producer → downstream consumer). */
export interface LineageEdge {
  canonicalId: string;
  fromCanonicalId: string;
  toCanonicalId: string;
  relationship: string;
  fromName?: string;
  toName?: string;
  fromType?: string;
  toType?: string;
}

const EDGE_FIELDS = [
  'canonicalId',
  'fromCanonicalId',
  'toCanonicalId',
  'relationship',
  'fromName',
  'toName',
  'fromType',
  'toType',
] as const;

export async function getLineageEdges(): Promise<LineageEdge[]> {
  if (isLocalBackend()) return [];
  return cachedQuery('catalog:lineage', async () => {
    const client = getRayfinClient();
    const rows = await fetchAll(client.data.LineageEdge.select([...EDGE_FIELDS]));
    return rows as LineageEdge[];
  });
}

/** A resolved lineage neighbour, ready to render (and navigate to, if an Item). */
export interface LineageNode {
  canonicalId: string;
  name: string;
  type?: string;
  relationship: string;
  /** Catalog item id when the endpoint resolves to a governed Item (clickable). */
  itemId?: string;
}

function resolve(
  canonicalId: string,
  fallbackName: string | undefined,
  fallbackType: string | undefined,
  relationship: string,
  byCanonical: Map<string, CatalogItem>,
): LineageNode {
  const it = byCanonical.get(canonicalId);
  return {
    canonicalId,
    name: it?.name ?? fallbackName ?? canonicalId,
    type: it?.itemType ?? fallbackType,
    relationship,
    itemId: it?.id,
  };
}

/** Direct upstream (producers) and downstream (consumers) of an item. */
export function neighborsOf(
  edges: LineageEdge[],
  canonicalId: string,
  byCanonical: Map<string, CatalogItem>,
): { upstream: LineageNode[]; downstream: LineageNode[] } {
  const upstream: LineageNode[] = [];
  const downstream: LineageNode[] = [];
  for (const e of edges) {
    if (e.toCanonicalId === canonicalId) {
      upstream.push(resolve(e.fromCanonicalId, e.fromName, e.fromType, e.relationship, byCanonical));
    }
    if (e.fromCanonicalId === canonicalId) {
      downstream.push(resolve(e.toCanonicalId, e.toName, e.toType, e.relationship, byCanonical));
    }
  }
  return { upstream, downstream };
}

/**
 * Transitive downstream impact set — every asset that would be affected if the
 * given asset changed or broke. Powers the "resources impacted" view. Cycle-safe.
 */
export function downstreamImpact(
  edges: LineageEdge[],
  canonicalId: string,
  byCanonical: Map<string, CatalogItem>,
): LineageNode[] {
  const adjacency = new Map<string, LineageEdge[]>();
  for (const e of edges) {
    const list = adjacency.get(e.fromCanonicalId) ?? [];
    list.push(e);
    adjacency.set(e.fromCanonicalId, list);
  }
  const seen = new Set<string>([canonicalId]);
  const out: LineageNode[] = [];
  const queue = [canonicalId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const e of adjacency.get(cur) ?? []) {
      if (seen.has(e.toCanonicalId)) continue;
      seen.add(e.toCanonicalId);
      out.push(resolve(e.toCanonicalId, e.toName, e.toType, e.relationship, byCanonical));
      queue.push(e.toCanonicalId);
    }
  }
  return out;
}
