import { describe, expect, it } from 'vitest';

import {
  workspaceGovRollup,
  domainGovRollup,
  typeGovRollup,
  stalenessHistogram,
  ownerConcentration,
  sensitivityBreakdown,
  endorsementBreakdown,
  lineageCompletenessByType,
  detectDrift,
  seriesFor,
  recentlyDiscovered,
} from '@/lib/observabilityAnalysis';
import type { CatalogItem } from '@/services/catalog';
import type { LineageEdge } from '@/services/lineage';
import type { HistoryPoint } from '@/services/observability';

function mkItem(overrides: Partial<CatalogItem> & { id: string; canonicalId: string }): CatalogItem {
  return { source: 'fabric', name: overrides.id, itemType: 'Report', ...overrides };
}

describe('workspaceGovRollup', () => {
  it('computes per-workspace governance score and sorts worst-first', () => {
    const items: CatalogItem[] = [
      mkItem({ id: 'a', canonicalId: 'a', workspaceCanonicalId: 'ws1', owner: 'x', description: 'd', sensitivityLabel: 'l', endorsement: 'Certified' }),
      mkItem({ id: 'b', canonicalId: 'b', workspaceCanonicalId: 'ws2' }), // fully ungoverned
    ];
    const workspaces = [
      { canonicalId: 'ws1', name: 'Alpha' },
      { canonicalId: 'ws2', name: 'Beta' },
      { canonicalId: 'ws3', name: 'Empty (no items)' },
    ];
    const rows = workspaceGovRollup(items, workspaces);
    expect(rows.map((r) => r.name)).toEqual(['Beta', 'Alpha']); // worst (0%) first
    expect(rows[1].score).toBe(100);
    expect(rows.find((r) => r.name.startsWith('Empty'))).toBeUndefined(); // no items -> excluded
  });
});

describe('domainGovRollup', () => {
  it('resolves domain via the item workspace and groups unresolvable items under "No domain"', () => {
    const items: CatalogItem[] = [
      mkItem({ id: 'a', canonicalId: 'a', workspaceCanonicalId: 'ws1', owner: 'x' }),
      mkItem({ id: 'b', canonicalId: 'b' }), // no workspace at all
    ];
    const workspaces = [{ canonicalId: 'ws1', name: 'Alpha', domainCanonicalId: 'dom1' }];
    const domains = [{ canonicalId: 'dom1', name: 'Finance' }];
    const rows = domainGovRollup(items, domains, workspaces);
    const finance = rows.find((r) => r.name === 'Finance');
    const noDomain = rows.find((r) => r.name === 'No domain');
    expect(finance?.itemCount).toBe(1);
    expect(noDomain?.itemCount).toBe(1);
  });
});

describe('typeGovRollup', () => {
  it('groups by item type, largest population first', () => {
    const items: CatalogItem[] = [
      mkItem({ id: 'a', canonicalId: 'a', itemType: 'Report' }),
      mkItem({ id: 'b', canonicalId: 'b', itemType: 'Report' }),
      mkItem({ id: 'c', canonicalId: 'c', itemType: 'Lakehouse' }),
    ];
    const rows = typeGovRollup(items);
    expect(rows[0]).toMatchObject({ key: 'Report', itemCount: 2 });
    expect(rows[1]).toMatchObject({ key: 'Lakehouse', itemCount: 1 });
  });
});

describe('stalenessHistogram', () => {
  it('buckets items by days-since-modified and tracks unknowns separately', () => {
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
    const items: CatalogItem[] = [
      mkItem({ id: 'a', canonicalId: 'a', modifiedDate: daysAgo(5) }),
      mkItem({ id: 'b', canonicalId: 'b', modifiedDate: daysAgo(200) }),
      mkItem({ id: 'c', canonicalId: 'c' }), // no modifiedDate
    ];
    const buckets = stalenessHistogram(items);
    expect(buckets.find((b) => b.label === '0–30 days')?.count).toBe(1);
    expect(buckets.find((b) => b.label === '180+ days')?.count).toBe(1);
    expect(buckets.find((b) => b.label === 'Unknown')?.count).toBe(1);
  });
});

describe('ownerConcentration', () => {
  it('ranks owners by asset count and computes each owner\'s governance score', () => {
    const items: CatalogItem[] = [
      mkItem({ id: 'a', canonicalId: 'a', owner: 'Alice', sensitivityLabel: 'l', description: 'd', endorsement: 'Promoted' }),
      mkItem({ id: 'b', canonicalId: 'b', owner: 'Alice' }),
      mkItem({ id: 'c', canonicalId: 'c', owner: 'Bob' }),
    ];
    const rows = ownerConcentration(items);
    expect(rows[0]).toMatchObject({ owner: 'Alice', itemCount: 2, sensitiveCount: 1 });
    expect(rows[0].score).toBeGreaterThan(0);
  });
});

describe('sensitivityBreakdown / endorsementBreakdown', () => {
  it('counts distinct sensitivity labels', () => {
    const items: CatalogItem[] = [
      mkItem({ id: 'a', canonicalId: 'a', sensitivityLabel: 'Confidential' }),
      mkItem({ id: 'b', canonicalId: 'b', sensitivityLabel: 'Confidential' }),
      mkItem({ id: 'c', canonicalId: 'c' }),
    ];
    expect(sensitivityBreakdown(items)).toEqual([{ label: 'Confidential', count: 2 }]);
  });

  it('groups missing/"None" endorsement together', () => {
    const items: CatalogItem[] = [
      mkItem({ id: 'a', canonicalId: 'a', endorsement: 'Certified' }),
      mkItem({ id: 'b', canonicalId: 'b', endorsement: 'None' }),
      mkItem({ id: 'c', canonicalId: 'c' }),
    ];
    const rows = endorsementBreakdown(items);
    expect(rows.find((r) => r.label === 'None')?.count).toBe(2);
    expect(rows.find((r) => r.label === 'Certified')?.count).toBe(1);
  });
});

describe('lineageCompletenessByType', () => {
  it('computes per-type % of items touched by at least one edge', () => {
    const items: CatalogItem[] = [
      mkItem({ id: 'a', canonicalId: 'a', itemType: 'Report' }),
      mkItem({ id: 'b', canonicalId: 'b', itemType: 'Report' }),
      mkItem({ id: 'c', canonicalId: 'c', itemType: 'SemanticModel' }),
    ];
    const edges: LineageEdge[] = [
      { canonicalId: 'e1', fromCanonicalId: 'c', toCanonicalId: 'a', relationship: 'DependsOn' },
    ];
    const rows = lineageCompletenessByType(items, edges, new Set(['Report', 'SemanticModel']));
    expect(rows.find((r) => r.type === 'Report')).toMatchObject({ total: 2, withLineage: 1, pct: 50 });
    expect(rows.find((r) => r.type === 'SemanticModel')).toMatchObject({ total: 1, withLineage: 1, pct: 100 });
  });
});

describe('detectDrift', () => {
  it('flags a metric whose first-vs-latest movement exceeds the noise floor', () => {
    const history: Record<string, HistoryPoint[]> = {
      'coverage:owned': [{ capturedAt: '2026-01-01', value: 90 }, { capturedAt: '2026-01-02', value: 80 }],
      'coverage:described': [{ capturedAt: '2026-01-01', value: 50 }, { capturedAt: '2026-01-02', value: 50.1 }],
    };
    const signals = detectDrift(history, { owned: 'Ownership', described: 'Documentation' }, 'coverage');
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ key: 'owned', direction: 'down', delta: -10 });
  });

  it('sorts regressions (most negative) before improvements', () => {
    const history: Record<string, HistoryPoint[]> = {
      'posture:itemCount': [{ capturedAt: '2026-01-01', value: 100 }, { capturedAt: '2026-01-02', value: 150 }],
      'posture:orphanedItems': [{ capturedAt: '2026-01-01', value: 10 }, { capturedAt: '2026-01-02', value: 2 }],
    };
    const signals = detectDrift(history, {}, 'posture');
    expect(signals[0].key).toBe('orphanedItems');
    expect(signals[1].key).toBe('itemCount');
  });
});

describe('seriesFor', () => {
  it('maps history points to indexed chart points', () => {
    const history: Record<string, HistoryPoint[]> = {
      'posture:itemCount': [{ capturedAt: '2026-01-01', value: 10 }, { capturedAt: '2026-01-02', value: 12 }],
    };
    expect(seriesFor(history, 'posture:itemCount')).toEqual([
      { x: 0, v: 10, date: '2026-01-01' },
      { x: 1, v: 12, date: '2026-01-02' },
    ]);
  });

  it('returns [] for an unknown key', () => {
    expect(seriesFor({}, 'posture:missing')).toEqual([]);
  });
});

describe('recentlyDiscovered', () => {
  it('sorts by firstSeen descending and ignores items with no firstSeen', () => {
    const items: CatalogItem[] = [
      mkItem({ id: 'a', canonicalId: 'a', firstSeen: '2026-01-01T00:00:00Z' }),
      mkItem({ id: 'b', canonicalId: 'b', firstSeen: '2026-03-01T00:00:00Z' }),
      mkItem({ id: 'c', canonicalId: 'c' }),
    ];
    expect(recentlyDiscovered(items).map((i) => i.id)).toEqual(['b', 'a']);
  });
});
