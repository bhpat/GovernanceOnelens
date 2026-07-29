import type { CatalogItem, DomainRef, WorkspaceRef } from '@/services/catalog';
import { daysSince } from '@/services/catalog';
import type { LineageEdge } from '@/services/lineage';
import type { HistoryPoint } from '@/services/observability';
import { govPillars } from '@/lib/health';

/**
 * Deep-dive governance analysis over the already-fetched catalog (items,
 * workspaces, domains, lineage edges, metric history) — no scanner/backend
 * changes required. Pulled out of ObservabilityPage.tsx as pure, independently
 * testable functions so the underlying math for each new lens is verified,
 * not just visually plausible.
 */

/** Item types the enrichment scan can produce lineage for and that the
 * `lineageComplete` coverage metric counts (matches the scanner's own
 * `LINEAGE_TYPES` set in sjd_governance_scan.py). Shared by HomePage's gap
 * filter and Observability's lineage-depth breakdown so both agree. */
export const LINEAGE_ELIGIBLE_TYPES = new Set<string>(['Report', 'SemanticModel', 'Dataflow', 'Datamart', 'PaginatedReport']);

export interface GovRollup {
  key: string;
  name: string;
  itemCount: number;
  owned: number;
  described: number;
  labeled: number;
  endorsed: number;
  /** Average governance score across the group, 0-100. */
  score: number;
}

function rollupOf(key: string, name: string, items: CatalogItem[]): GovRollup {
  const n = items.length;
  return {
    key,
    name,
    itemCount: n,
    owned: items.filter((i) => i.owner).length,
    described: items.filter((i) => i.description).length,
    labeled: items.filter((i) => i.sensitivityLabel).length,
    endorsed: items.filter((i) => i.endorsement && i.endorsement !== 'None').length,
    score: n ? Math.round((items.reduce((s, i) => s + govPillars(i), 0) / (n * 4)) * 100) : 0,
  };
}

/** Governance rollup per workspace, worst-covered first. Only workspaces that
 * actually contain items are returned (empty workspaces add no signal here). */
export function workspaceGovRollup(items: CatalogItem[], workspaces: WorkspaceRef[]): GovRollup[] {
  const byWs = new Map<string, CatalogItem[]>();
  for (const i of items) {
    if (!i.workspaceCanonicalId) continue;
    const list = byWs.get(i.workspaceCanonicalId);
    if (list) list.push(i);
    else byWs.set(i.workspaceCanonicalId, [i]);
  }
  return workspaces
    .map((w) => rollupOf(w.canonicalId, w.name, byWs.get(w.canonicalId) ?? []))
    .filter((r) => r.itemCount > 0)
    .sort((a, b) => a.score - b.score);
}

/** Governance rollup per domain. Domain is a workspace attribute in Fabric —
 * an item's domain is its own `domainCanonicalId` if set, else its
 * workspace's. Items whose resolved domain isn't a known domain (or has
 * none) are grouped under a synthetic "No domain" row instead of being
 * silently dropped. */
export function domainGovRollup(items: CatalogItem[], domains: DomainRef[], workspaces: WorkspaceRef[]): GovRollup[] {
  const wsDomain = new Map(workspaces.map((w) => [w.canonicalId, w.domainCanonicalId]));
  const domainOf = (i: CatalogItem): string | undefined =>
    i.domainCanonicalId ?? (i.workspaceCanonicalId ? wsDomain.get(i.workspaceCanonicalId) : undefined);

  const known = new Set(domains.map((d) => d.canonicalId));
  const byDomain = new Map<string, CatalogItem[]>();
  const unassigned: CatalogItem[] = [];
  for (const i of items) {
    const d = domainOf(i);
    if (!d || !known.has(d)) {
      unassigned.push(i);
      continue;
    }
    const list = byDomain.get(d);
    if (list) list.push(i);
    else byDomain.set(d, [i]);
  }

  const rows = domains
    .map((d) => rollupOf(d.canonicalId, d.name, byDomain.get(d.canonicalId) ?? []))
    .filter((r) => r.itemCount > 0);
  if (unassigned.length > 0) rows.push(rollupOf('__unassigned', 'No domain', unassigned));
  return rows.sort((a, b) => a.score - b.score);
}

/** Governance rollup per item type, largest population first. */
export function typeGovRollup(items: CatalogItem[]): GovRollup[] {
  const byType = new Map<string, CatalogItem[]>();
  for (const i of items) {
    const list = byType.get(i.itemType);
    if (list) list.push(i);
    else byType.set(i.itemType, [i]);
  }
  return [...byType.entries()]
    .map(([type, its]) => rollupOf(type, type, its))
    .sort((a, b) => b.itemCount - a.itemCount);
}

export interface Bucket {
  label: string;
  count: number;
}

const STALE_BUCKETS: [number, number, string][] = [
  [0, 30, '0–30 days'],
  [31, 90, '31–90 days'],
  [91, 180, '91–180 days'],
  [181, Infinity, '180+ days'],
];

/** Distribution of "days since last modified" — deeper than a single
 * `staleItems` count, shows WHERE the estate sits on the freshness spectrum. */
export function stalenessHistogram(items: CatalogItem[]): Bucket[] {
  const buckets: Bucket[] = STALE_BUCKETS.map(([, , label]) => ({ label, count: 0 }));
  let unknown = 0;
  for (const i of items) {
    const d = daysSince(i.modifiedDate);
    if (d === undefined) {
      unknown += 1;
      continue;
    }
    const idx = STALE_BUCKETS.findIndex(([lo, hi]) => d >= lo && d <= hi);
    if (idx >= 0) buckets[idx].count += 1;
  }
  if (unknown > 0) buckets.push({ label: 'Unknown', count: unknown });
  return buckets;
}

export interface OwnerRow {
  owner: string;
  itemCount: number;
  sensitiveCount: number;
  score: number;
}

/** Top owners by asset count — surfaces ownership concentration risk (a
 * single person owning a large slice of the estate, especially sensitive
 * assets, is itself a governance/succession risk worth seeing at a glance). */
export function ownerConcentration(items: CatalogItem[], top = 8): OwnerRow[] {
  const byOwner = new Map<string, CatalogItem[]>();
  for (const i of items) {
    if (!i.owner) continue;
    const list = byOwner.get(i.owner);
    if (list) list.push(i);
    else byOwner.set(i.owner, [i]);
  }
  return [...byOwner.entries()]
    .map(([owner, its]) => ({
      owner,
      itemCount: its.length,
      sensitiveCount: its.filter((i) => i.sensitivityLabel).length,
      score: Math.round((its.reduce((s, i) => s + govPillars(i), 0) / (its.length * 4)) * 100),
    }))
    .sort((a, b) => b.itemCount - a.itemCount)
    .slice(0, top);
}

export interface LabelRow {
  label: string;
  count: number;
}

/** Distribution across the sensitivity labels actually in use (not just the
 * binary "labeled vs. not" coverage percentage). */
export function sensitivityBreakdown(items: CatalogItem[]): LabelRow[] {
  const m = new Map<string, number>();
  for (const i of items) if (i.sensitivityLabel) m.set(i.sensitivityLabel, (m.get(i.sensitivityLabel) ?? 0) + 1);
  return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

/** Distribution across endorsement levels (None / Promoted / Certified / …). */
export function endorsementBreakdown(items: CatalogItem[]): LabelRow[] {
  const m = new Map<string, number>();
  for (const i of items) {
    const label = i.endorsement && i.endorsement !== 'None' ? i.endorsement : 'None';
    m.set(label, (m.get(label) ?? 0) + 1);
  }
  return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

export interface LineageTypeRow {
  type: string;
  total: number;
  withLineage: number;
  pct: number;
}

/** Lineage completeness broken down BY TYPE, instead of one tenant-wide
 * percentage — shows exactly which asset types are dragging coverage down. */
export function lineageCompletenessByType(
  items: CatalogItem[],
  edges: LineageEdge[],
  eligibleTypes: Set<string>,
): LineageTypeRow[] {
  const connected = new Set<string>();
  for (const e of edges) {
    connected.add(e.fromCanonicalId);
    connected.add(e.toCanonicalId);
  }
  const byType = new Map<string, CatalogItem[]>();
  for (const i of items) {
    if (!eligibleTypes.has(i.itemType)) continue;
    const list = byType.get(i.itemType);
    if (list) list.push(i);
    else byType.set(i.itemType, [i]);
  }
  return [...byType.entries()]
    .map(([type, its]) => {
      const withLineage = its.filter((i) => connected.has(i.canonicalId)).length;
      return { type, total: its.length, withLineage, pct: its.length ? Math.round((withLineage / its.length) * 100) : 0 };
    })
    .sort((a, b) => a.pct - b.pct);
}

export interface DriftSignal {
  key: string;
  label: string;
  kind: 'coverage' | 'posture';
  latest: number;
  delta: number;
  direction: 'up' | 'down';
}

/**
 * Detect real movement — regressions AND improvements — across every tracked
 * metric's full captured history (first scan vs. latest scan). This is the
 * most honest "drift" signal available without a dedicated Baseline/
 * DriftEvent entity (no scanner captures one yet): it's real historical data,
 * not a placeholder. A metric only surfaces once its total movement clears a
 * noise floor, so single-scan jitter doesn't spam the list.
 */
export function detectDrift(
  history: Record<string, HistoryPoint[]>,
  labels: Record<string, string>,
  kind: 'coverage' | 'posture',
  noiseFloor = 0.5,
): DriftSignal[] {
  const prefix = `${kind}:`;
  const out: DriftSignal[] = [];
  for (const [key, points] of Object.entries(history)) {
    if (!key.startsWith(prefix) || points.length < 2) continue;
    const metric = key.slice(prefix.length);
    const first = points[0].value;
    const latest = points[points.length - 1].value;
    const delta = latest - first;
    if (Math.abs(delta) < noiseFloor) continue;
    out.push({ key: metric, label: labels[metric] ?? metric, kind, latest, delta, direction: delta > 0 ? 'up' : 'down' });
  }
  return out.sort((a, b) => a.delta - b.delta);
}

export interface SeriesPoint {
  x: number;
  v: number;
  date: string;
}

/** Full historical series for one `${kind}:${metric}` history key, ready for
 * a line chart (x = scan index, so points space evenly regardless of the
 * actual gaps between scan timestamps). */
export function seriesFor(history: Record<string, HistoryPoint[]>, key: string): SeriesPoint[] {
  return (history[key] ?? []).map((p, i) => ({ x: i, v: p.value, date: p.capturedAt }));
}

/** Most recently discovered items (by `firstSeen`), newest first — the
 * closest honest "recent activity" proxy available without a dedicated
 * ActivityEvent entity (no scanner captures a real audit trail yet). */
export function recentlyDiscovered(items: CatalogItem[], top = 10): CatalogItem[] {
  return [...items]
    .filter((i) => i.firstSeen)
    .sort((a, b) => (b.firstSeen! > a.firstSeen! ? 1 : b.firstSeen! < a.firstSeen! ? -1 : 0))
    .slice(0, top);
}
