import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  makeStyles,
  mergeClasses,
  tokens,
  Text,
  Card,
  Button,
  MessageBar,
  MessageBarBody,
} from '@fluentui/react-components';
import {
  ShieldKeyhole24Regular,
  Group24Regular,
  Folder24Regular,
  DocumentText24Regular,
  Flow20Regular,
  ChevronRight16Regular,
  CheckmarkCircle16Filled,
} from '@fluentui/react-icons';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { getItems, getWorkspaces, getDomains, type CatalogItem, type WorkspaceRef, type DomainRef } from '@/services/catalog';
import { getLineageEdges, type LineageEdge } from '@/services/lineage';
import { workspaceIconUrl } from '@/lib/itemIcons';
import { PageHeader } from '@/components/PageHeader';
import { PageLoadingSkeleton } from '@/components/Skeletons';

interface WsRollup {
  canonicalId: string;
  name: string;
  type?: string;
  domainName?: string;
  itemCount: number;
  labeled: number;
  endorsed: number;
  described: number;
  owned: number;
  distinctLabels: number;
  connectedWorkspaces: number;
}

type KpiFilter = 'all' | 'cross' | 'sensitive' | 'domain' | 'documented';

function normalizeKpiFilter(value: string | null): KpiFilter {
  if (value === 'cross' || value === 'sensitive' || value === 'domain' || value === 'documented') {
    return value;
  }
  return 'all';
}

const useStyles = makeStyles({
  root: { height: '100%', overflowY: 'auto' },
  content: { maxWidth: '1400px', margin: '0 auto', padding: '24px 32px', display: 'flex', flexDirection: 'column', gap: '24px' },
  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' },
  kpiCard: {
    padding: '16px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '8px',
    backgroundColor: tokens.colorNeutralBackground1,
    cursor: 'pointer',
    ':hover': {
      border: `1px solid ${tokens.colorBrandStroke1}`,
      boxShadow: tokens.shadow8,
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  kpiCardActive: {
    border: `2px solid ${tokens.colorBrandStroke1}`,
    boxShadow: tokens.shadow8,
    backgroundColor: tokens.colorNeutralBackground1Hover,
  },
  kpiLink: {
    marginTop: '8px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '2px',
    color: tokens.colorBrandForeground1,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
  },
  kpiLinkActive: {
    color: tokens.colorPaletteGreenForeground1,
  },
  listToolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    padding: '0 2px',
  },
  listToolbarMeta: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  listContainer: { border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: '8px', backgroundColor: tokens.colorNeutralBackground1, overflow: 'hidden' },
  listHeader: { display: 'grid', gridTemplateColumns: '2fr 1.5fr 1.2fr 1.2fr 1.2fr 120px', gap: '12px', padding: '12px 16px', backgroundColor: tokens.colorNeutralBackground2, borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, fontSize: tokens.fontSizeBase200, fontWeight: tokens.fontWeightSemibold, color: tokens.colorNeutralForeground2 },
  listRow: { display: 'grid', gridTemplateColumns: '2fr 1.5fr 1.2fr 1.2fr 1.2fr 120px', gap: '12px', padding: '12px 16px', alignItems: 'center', borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, fontSize: tokens.fontSizeBase200, cursor: 'pointer', transition: 'background-color 0.15s ease', ':hover': { backgroundColor: tokens.colorNeutralBackground2 }, ':last-child': { borderBottom: 'none' } },
  wsInfo: { display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 },
  wsIcon: { flexShrink: 0, width: '20px', height: '20px' },
  wsTitle: { flex: 1, minWidth: 0 },
  wsName: { fontSize: tokens.fontSizeBase200, fontWeight: tokens.fontWeightSemibold, color: tokens.colorNeutralForeground1, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' },
  wsDomain: { fontSize: '12px', color: tokens.colorNeutralForeground4, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' },
  healthBadge: { padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: tokens.fontWeightSemibold, textAlign: 'center' },
  healthGood: { backgroundColor: 'rgba(107, 174, 95, 0.15)', color: '#6bae5f' },
  healthWarning: { backgroundColor: 'rgba(202, 80, 16, 0.15)', color: '#ca5010' },
  metricCell: { fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground1 },
  metricLabel: { fontSize: '11px', color: tokens.colorNeutralForeground3, marginTop: '2px' },
  actions: { display: 'flex', gap: '6px' },
  actionBtn: { padding: '4px 8px', fontSize: '11px' },
  center: { padding: '48px', textAlign: 'center', color: tokens.colorNeutralForeground3 },
});

function pct(n: number, d: number): number {
  return d ? Math.round((100 * n) / d) : 0;
}
export function WorkspacesPage() {
  const styles = useStyles();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceRef[]>([]);
  const [domains, setDomains] = useState<DomainRef[]>([]);
  const [edges, setEdges] = useState<LineageEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const activeFilter = useMemo(() => normalizeKpiFilter(searchParams.get('kpi')), [searchParams]);

  const setKpiFilter = useCallback((next: KpiFilter) => {
    const updated = new URLSearchParams(searchParams);
    if (next === 'all') updated.delete('kpi');
    else updated.set('kpi', next);
    setSearchParams(updated, { replace: true });
  }, [searchParams, setSearchParams]);

  const load = useCallback(async (cancelledRef: { current: boolean }) => {
    setLoading(true);
    setError(null);
    try {
      const [i, w, d, e] = await Promise.all([getItems(), getWorkspaces(), getDomains(), getLineageEdges()]);
      if (cancelledRef.current) return;
      setItems(i);
      setWorkspaces(w);
      setDomains(d);
      setEdges(e);
    } catch (err) {
      if (!cancelledRef.current) setError(err instanceof Error ? err.message : 'Failed to load workspaces.');
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const cancelledRef = { current: false };
    void load(cancelledRef);
    return () => { cancelledRef.current = true; };
  }, [load]);

  const domName = useMemo(() => {
    const m = new Map(domains.map((d) => [d.canonicalId, d.name]));
    return (id?: string) => (id ? m.get(id) ?? id.replace('fabric:domain:', '') : undefined);
  }, [domains]);

  // Which other workspaces does each workspace have real lineage connections
  // to (shortcuts, reads/writes, dependsOn, …) — cross-workspace links are a
  // governance-relevant fact (data leaving its home workspace) that belongs on
  // this page, not just buried in the Lineage explorer.
  const crossWsByWorkspace = useMemo(() => {
    const wsOf = new Map(items.map((i) => [i.canonicalId, i.workspaceCanonicalId]));
    const m = new Map<string, Set<string>>();
    for (const e of edges) {
      const a = wsOf.get(e.fromCanonicalId), b = wsOf.get(e.toCanonicalId);
      if (!a || !b || a === b) continue;
      (m.get(a) ?? m.set(a, new Set()).get(a)!).add(b);
      (m.get(b) ?? m.set(b, new Set()).get(b)!).add(a);
    }
    return m;
  }, [items, edges]);

  const rollups = useMemo<WsRollup[]>(() => {
    const byWs = new Map<string, CatalogItem[]>();
    for (const i of items) {
      if (!i.workspaceCanonicalId) continue;
      const list = byWs.get(i.workspaceCanonicalId) ?? [];
      list.push(i);
      byWs.set(i.workspaceCanonicalId, list);
    }
    return workspaces.map((w) => {
      const its = byWs.get(w.canonicalId) ?? [];
      const labels = new Set(its.filter((i) => i.sensitivityLabel).map((i) => i.sensitivityLabel));
      return {
        canonicalId: w.canonicalId,
        name: w.name,
        type: w.type,
        domainName: domName(w.domainCanonicalId),
        itemCount: its.length,
        labeled: its.filter((i) => i.sensitivityLabel).length,
        endorsed: its.filter((i) => i.endorsement && i.endorsement !== 'None').length,
        described: its.filter((i) => i.description).length,
        owned: its.filter((i) => i.owner).length,
        distinctLabels: labels.size,
        connectedWorkspaces: crossWsByWorkspace.get(w.canonicalId)?.size ?? 0,
      };
    });
  }, [items, workspaces, domName, crossWsByWorkspace]);

  const kpis = useMemo(() => {
    const total = rollups.length;
    const withSensitive = rollups.filter((r) => r.labeled > 0).length;
    const inDomain = rollups.filter((r) => r.domainName).length;
    const totalItems = rollups.reduce((n, r) => n + r.itemCount, 0);
    const describedItems = rollups.reduce((n, r) => n + r.described, 0);
    const interconnected = rollups.filter((r) => r.connectedWorkspaces > 0).length;
    return { total, withSensitive, inDomain, avgDescribed: pct(describedItems, totalItems), interconnected };
  }, [rollups]);

  // Sort workspaces by coverage health (best first) as default
  const sorted = useMemo(() => {
    return [...rollups].sort((a, b) => getCoverageHealth(b) - getCoverageHealth(a));
  }, [rollups]);

  const filtered = useMemo(() => {
    switch (activeFilter) {
      case 'cross':
        return sorted.filter((r) => r.connectedWorkspaces > 0);
      case 'sensitive':
        return sorted.filter((r) => r.labeled > 0);
      case 'domain':
        return sorted.filter((r) => Boolean(r.domainName));
      case 'documented':
        return sorted.filter((r) => pct(r.described, r.itemCount) > 0);
      case 'all':
      default:
        return sorted;
    }
  }, [sorted, activeFilter]);

  return (
    <div className={styles.root}>
      <PageHeader
        icon={<Group24Regular />}
        title="Workspaces"
        subtitle="Governance posture rolled up per workspace — sensitivity, endorsement, documentation and ownership across its items."
      />

      <div className={styles.content}>
        {loading ? (
          <PageLoadingSkeleton cards={4} rows={6} />
        ) : error ? (
          <MessageBar intent="error">
            <MessageBarBody>
              {error}
              <Button size="small" appearance="transparent" onClick={() => void load({ current: false })} style={{ marginLeft: '8px' }}>
                Retry
              </Button>
            </MessageBarBody>
          </MessageBar>
        ) : (
          <>
            {/* KPI Summary Cards */}
            <div className={styles.kpiGrid}>
              <Card
                className={mergeClasses(styles.kpiCard, activeFilter === 'all' && styles.kpiCardActive)}
                role="button"
                tabIndex={0}
                onClick={() => setKpiFilter('all')}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setKpiFilter('all'); } }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                  <Group24Regular style={{ color: tokens.colorBrandForeground1 }} />
                </div>
                <div style={{ fontSize: tokens.fontSizeBase500, fontWeight: tokens.fontWeightSemibold }}>{kpis.total}</div>
                <div style={{ fontSize: '12px', color: tokens.colorNeutralForeground3, marginTop: '4px' }}>Total Workspaces</div>
                <span className={mergeClasses(styles.kpiLink, activeFilter === 'all' && styles.kpiLinkActive)}>
                  {activeFilter === 'all' ? <><CheckmarkCircle16Filled /> Showing all</> : <>View list <ChevronRight16Regular /></>}
                </span>
              </Card>
              <Card
                className={mergeClasses(styles.kpiCard, activeFilter === 'cross' && styles.kpiCardActive)}
                role="button"
                tabIndex={0}
                onClick={() => setKpiFilter('cross')}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setKpiFilter('cross'); } }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                  <Flow20Regular style={{ color: tokens.colorBrandForeground1 }} />
                </div>
                <div style={{ fontSize: tokens.fontSizeBase500, fontWeight: tokens.fontWeightSemibold }}>{kpis.interconnected}</div>
                <div style={{ fontSize: '12px', color: tokens.colorNeutralForeground3, marginTop: '4px' }}>Cross-workspace Links</div>
                <span className={mergeClasses(styles.kpiLink, activeFilter === 'cross' && styles.kpiLinkActive)}>
                  {activeFilter === 'cross' ? <><CheckmarkCircle16Filled /> Filtered</> : <>View list <ChevronRight16Regular /></>}
                </span>
              </Card>
              <Card
                className={mergeClasses(styles.kpiCard, activeFilter === 'sensitive' && styles.kpiCardActive)}
                role="button"
                tabIndex={0}
                onClick={() => setKpiFilter('sensitive')}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setKpiFilter('sensitive'); } }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                  <ShieldKeyhole24Regular style={{ color: kpis.withSensitive > 0 ? '#ca5010' : tokens.colorBrandForeground1 }} />
                </div>
                <div style={{ fontSize: tokens.fontSizeBase500, fontWeight: tokens.fontWeightSemibold }}>{kpis.withSensitive}</div>
                <div style={{ fontSize: '12px', color: tokens.colorNeutralForeground3, marginTop: '4px' }}>With Sensitive Data</div>
                <span className={mergeClasses(styles.kpiLink, activeFilter === 'sensitive' && styles.kpiLinkActive)}>
                  {activeFilter === 'sensitive' ? <><CheckmarkCircle16Filled /> Filtered</> : <>View list <ChevronRight16Regular /></>}
                </span>
              </Card>
              <Card
                className={mergeClasses(styles.kpiCard, activeFilter === 'domain' && styles.kpiCardActive)}
                role="button"
                tabIndex={0}
                onClick={() => setKpiFilter('domain')}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setKpiFilter('domain'); } }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                  <Folder24Regular style={{ color: tokens.colorBrandForeground1 }} />
                </div>
                <div style={{ fontSize: tokens.fontSizeBase500, fontWeight: tokens.fontWeightSemibold }}>{kpis.inDomain}/{kpis.total}</div>
                <div style={{ fontSize: '12px', color: tokens.colorNeutralForeground3, marginTop: '4px' }}>In a Domain</div>
                <span className={mergeClasses(styles.kpiLink, activeFilter === 'domain' && styles.kpiLinkActive)}>
                  {activeFilter === 'domain' ? <><CheckmarkCircle16Filled /> Filtered</> : <>View list <ChevronRight16Regular /></>}
                </span>
              </Card>
              <Card
                className={mergeClasses(styles.kpiCard, activeFilter === 'documented' && styles.kpiCardActive)}
                role="button"
                tabIndex={0}
                onClick={() => setKpiFilter('documented')}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setKpiFilter('documented'); } }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                  <DocumentText24Regular style={{ color: tokens.colorBrandForeground1 }} />
                </div>
                <div style={{ fontSize: tokens.fontSizeBase500, fontWeight: tokens.fontWeightSemibold }}>{kpis.avgDescribed}%</div>
                <div style={{ fontSize: '12px', color: tokens.colorNeutralForeground3, marginTop: '4px' }}>Items Documented</div>
                <span className={mergeClasses(styles.kpiLink, activeFilter === 'documented' && styles.kpiLinkActive)}>
                  {activeFilter === 'documented' ? <><CheckmarkCircle16Filled /> Filtered</> : <>View list <ChevronRight16Regular /></>}
                </span>
              </Card>
            </div>

            {/* Workspace List */}
            {filtered.length === 0 ? (
              <div className={styles.center}>
                <Text>No workspaces found.</Text>
              </div>
            ) : (
              <>
                <div className={styles.listToolbar}>
                  <Text className={styles.listToolbarMeta}>
                    Showing {filtered.length} of {sorted.length} workspaces
                  </Text>
                  {activeFilter !== 'all' && (
                    <Button size="small" appearance="subtle" onClick={() => setKpiFilter('all')}>
                      Clear filter
                    </Button>
                  )}
                </div>

                <div className={styles.listContainer}>
                <div className={styles.listHeader}>
                  <div>Workspace</div>
                  <div>Domain</div>
                  <div>Items</div>
                  <div>Sensitive</div>
                  <div>Health</div>
                  <div></div>
                </div>
                {filtered.map((r) => (
                  <div
                    key={r.canonicalId}
                    className={styles.listRow}
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`/?workspace=${encodeURIComponent(r.canonicalId)}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        navigate(`/?workspace=${encodeURIComponent(r.canonicalId)}`);
                      }
                    }}
                    title="View this workspace's items in the Catalog"
                  >
                    {/* Workspace Name & Domain */}
                    <div className={styles.wsInfo}>
                      <img src={workspaceIconUrl} width={18} height={18} alt="" draggable={false} />
                      <div className={styles.wsTitle}>
                        <div className={styles.wsName}>{r.name}</div>
                        <div className={styles.wsDomain}>{r.domainName || '—'}</div>
                      </div>
                    </div>

                    {/* Domain */}
                    <div style={{ fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground2 }}>
                      {r.domainName || '—'}
                    </div>

                    {/* Items Count */}
                    <div>
                      <div className={styles.metricCell}>{r.itemCount}</div>
                    </div>

                    {/* Sensitive/Labeled */}
                    <div>
                      <div className={styles.metricCell} style={{ color: r.labeled > 0 ? '#ca5010' : tokens.colorNeutralForeground2 }}>
                        {r.labeled}
                      </div>
                    </div>

                    {/* Health Badge */}
                    <div>
                      <div className={mergeClasses(styles.healthBadge, getCoverageHealth(r) >= 75 ? styles.healthGood : styles.healthWarning)}>
                        {getCoverageHealth(r)}%
                      </div>
                    </div>

                    {/* Actions */}
                    <div className={styles.actions}>
                      {r.connectedWorkspaces > 0 && (
                        <Button
                          appearance="subtle"
                          size="small"
                          className={styles.actionBtn}
                          onClick={(e) => { e.stopPropagation(); navigate(`/lineage?workspace=${encodeURIComponent(r.canonicalId)}`); }}
                          icon={<Flow20Regular />}
                          title="View lineage"
                        >
                        </Button>
                      )}
                      <ChevronRight16Regular style={{ color: tokens.colorNeutralForeground4, flexShrink: 0 }} />
                    </div>
                  </div>
                ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Helper: Calculate average coverage for health indicator
function getCoverageHealth(r: WsRollup): number {
  if (r.itemCount === 0) return 100;
  const metrics = [
    pct(r.described, r.itemCount),
    pct(r.owned, r.itemCount),
    pct(r.endorsed, r.itemCount),
  ];
  return Math.round(metrics.reduce((a, b) => a + b, 0) / metrics.length);
}
