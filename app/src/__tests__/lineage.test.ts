import { describe, expect, it } from 'vitest';

import { downstreamImpact, neighborsOf, type LineageEdge } from '@/services/lineage';
import type { CatalogItem } from '@/services/catalog';

function mkItem(canonicalId: string, name: string): CatalogItem {
  return { id: canonicalId, canonicalId, source: 'fabric', name, itemType: 'Report' };
}

function mkEdge(from: string, to: string, relationship = 'DependsOn'): LineageEdge {
  return { canonicalId: `${from}->${to}`, fromCanonicalId: from, toCanonicalId: to, relationship };
}

describe('neighborsOf', () => {
  it('resolves direct upstream and downstream neighbours', () => {
    // A -> B -> C
    const edges = [mkEdge('A', 'B'), mkEdge('B', 'C')];
    const byCanonical = new Map([
      ['A', mkItem('A', 'Alpha')],
      ['B', mkItem('B', 'Beta')],
      ['C', mkItem('C', 'Gamma')],
    ]);

    const { upstream, downstream } = neighborsOf(edges, 'B', byCanonical);

    expect(upstream.map((n) => n.name)).toEqual(['Alpha']);
    expect(downstream.map((n) => n.name)).toEqual(['Gamma']);
  });

  it('returns no neighbours for an isolated node', () => {
    const { upstream, downstream } = neighborsOf([], 'Z', new Map());
    expect(upstream).toEqual([]);
    expect(downstream).toEqual([]);
  });
});

describe('downstreamImpact', () => {
  it('walks the full transitive downstream set', () => {
    // A -> B -> C, A -> D
    const edges = [mkEdge('A', 'B'), mkEdge('B', 'C'), mkEdge('A', 'D')];
    const byCanonical = new Map([
      ['A', mkItem('A', 'Alpha')],
      ['B', mkItem('B', 'Beta')],
      ['C', mkItem('C', 'Gamma')],
      ['D', mkItem('D', 'Delta')],
    ]);

    const impact = downstreamImpact(edges, 'A', byCanonical);
    expect(new Set(impact.map((n) => n.canonicalId))).toEqual(new Set(['B', 'C', 'D']));
  });

  it('terminates and de-duplicates on a cyclic graph instead of looping forever', () => {
    // A -> B -> C -> A (cycle)
    const edges = [mkEdge('A', 'B'), mkEdge('B', 'C'), mkEdge('C', 'A')];
    const byCanonical = new Map([
      ['A', mkItem('A', 'Alpha')],
      ['B', mkItem('B', 'Beta')],
      ['C', mkItem('C', 'Gamma')],
    ]);

    const impact = downstreamImpact(edges, 'A', byCanonical);
    // Must include B and C exactly once each, and never re-include the start node A.
    expect(impact.map((n) => n.canonicalId).sort()).toEqual(['B', 'C']);
  });
});
