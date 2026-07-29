import { getRayfinClient, isLocalBackend, fetchAll } from './rayfinClient';
import { cachedQuery } from './queryCache';

/** A derived coverage metric (the "coverage" lens). */
export interface CoverageMetric {
  id: string;
  metric: string;
  scopeType: string;
  numerator: number;
  denominator: number;
  percent: number;
}

/** A derived posture signal (the "posture" lens). */
export interface PostureSignal {
  id: string;
  signal: string;
  scopeType: string;
  value: number;
  status?: string;
}

export async function getCoverage(): Promise<CoverageMetric[]> {
  if (isLocalBackend()) return [];
  return cachedQuery('observability:coverage', async () => {
    const client = getRayfinClient();
    const rows = await fetchAll(client.data.CoverageMetric.select([
      'id',
      'metric',
      'scopeType',
      'numerator',
      'denominator',
      'percent',
    ])
      .where({ scopeType: { eq: 'tenant' } }));
    return rows as CoverageMetric[];
  });
}

export async function getPosture(): Promise<PostureSignal[]> {
  if (isLocalBackend()) return [];
  return cachedQuery('observability:posture', async () => {
    const client = getRayfinClient();
    const rows = await fetchAll(client.data.PostureSnapshot.select([
      'id',
      'signal',
      'scopeType',
      'value',
      'status',
    ])
      .where({ scopeType: { eq: 'tenant' } }));
    return rows as PostureSignal[];
  });
}

/** One append-only trend point (tenant scope). */
export interface HistoryPoint {
  capturedAt: string;
  value: number;
}

/**
 * Tenant-scope metric history keyed by `${kind}:${metric}` (e.g. `coverage:owned`,
 * `posture:itemCount`), oldest→newest. Powers trend deltas + sparklines.
 */
export async function getMetricHistory(): Promise<Record<string, HistoryPoint[]>> {
  if (isLocalBackend()) return {};
  return cachedQuery('observability:history', async () => {
    const client = getRayfinClient();
    const rows = (await fetchAll(client.data.MetricSnapshot.select(['kind', 'metric', 'value', 'capturedAt'])
      .where({ scopeType: { eq: 'tenant' } })
      .orderBy({ capturedAt: 'asc' }))) as unknown as { kind: string; metric: string; value: number; capturedAt: string }[];
    const out: Record<string, HistoryPoint[]> = {};
    for (const r of rows) {
      const key = `${r.kind}:${r.metric}`;
      (out[key] ??= []).push({ capturedAt: String(r.capturedAt), value: Number(r.value) });
    }
    return out;
  });
}

/** Latest value + delta vs the previous point for a series. */
export function trendOf(points?: HistoryPoint[]): { latest?: number; delta?: number } {
  if (!points || points.length === 0) return {};
  const latest = points[points.length - 1].value;
  if (points.length < 2) return { latest };
  return { latest, delta: latest - points[points.length - 2].value };
}

/** Human-friendly labels for known coverage metrics. */
export const COVERAGE_LABELS: Record<string, string> = {
  sensitivityLabeled: 'Sensitivity labeled',
  endorsed: 'Endorsed (promoted/certified)',
  described: 'Has description',
  owned: 'Has owner',
  domainAssigned: 'Workspaces in a domain',
  lineageComplete: 'Lineage captured',
};

export const POSTURE_LABELS: Record<string, string> = {
  itemCount: 'Governed items',
  workspaceCount: 'Workspaces',
  domainCount: 'Domains',
  itemTypeCount: 'Item types',
  lineageEdges: 'Lineage edges',
  lineageGaps: 'Lineage permission gaps',
  staleItems: 'Stale items (90+ days)',
  accessAssignments: 'Access assignments',
  accessPrincipals: 'Principals with access',
  groupAccessAssignments: 'Group access grants',
};
