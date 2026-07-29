import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Card } from '@tremor/react';
import {
  makeStyles,
  mergeClasses,
  tokens,
  Text,
  Badge,
  Button,
  MessageBar,
  MessageBarBody,
  TabList,
  Tab,
} from '@fluentui/react-components';
import {
  Cube24Regular,
  Grid24Regular,
  Shapes24Regular,
  Folder24Regular,
  ChevronRight16Regular,
  BranchCompare24Regular,
  Clock24Regular,
  Person24Regular,
  Flow24Regular,
  DataTrending24Regular,
  History24Regular,
} from '@fluentui/react-icons';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area,
  LineChart, Line, XAxis, YAxis, Tooltip as RTooltip,
} from 'recharts';

import { ITEM_GAP_FILTERS, getItems, getWorkspaces, getDomains, type CatalogItem, type WorkspaceRef, type DomainRef } from '@/services/catalog';
import { getLineageEdges, type LineageEdge } from '@/services/lineage';
import { workspaceIconUrl, itemIconUrl } from '@/lib/itemIcons';
import { healthColor, type HealthStatus } from '@/lib/health';
import { CATEGORICAL_PALETTE } from '@/lib/sectionTheme';
import { PageHeader } from '@/components/PageHeader';
import { PageLoadingSkeleton } from '@/components/Skeletons';
import { PostureCard } from '@/components/PostureCard';
import {
  LINEAGE_ELIGIBLE_TYPES,
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
  type GovRollup,
} from '@/lib/observabilityAnalysis';
import {
  getCoverage,
  getPosture,
  getMetricHistory,
  COVERAGE_LABELS,
  POSTURE_LABELS,
  type CoverageMetric,
  type PostureSignal,
  type HistoryPoint,
} from '@/services/observability';

const POSTURE_ICONS: Record<string, ReactNode> = {
  itemCount: <Cube24Regular />,
  workspaceCount: <Grid24Regular />,
  itemTypeCount: <Shapes24Regular />,
  domainCount: <Folder24Regular />,
  lineageEdges: <BranchCompare24Regular />,
  lineageGaps: <Flow24Regular />,
  staleItems: <Clock24Regular />,
  accessAssignments: <Grid24Regular />,
  accessPrincipals: <Person24Regular />,
  groupAccessAssignments: <Person24Regular />,
};

/** Drill-through: every posture stat links to the underlying catalog list. */
const POSTURE_LINK: Record<string, string> = {
  itemCount: '/?browse=all',
  itemTypeCount: '/',
  workspaceCount: '/workspaces',
  lineageGaps: '/lineage',
  staleItems: '/?gap=staleItems',
};

/** Coverage metrics whose offenders aren't a simple item-field filter get an explicit target. */
const COVERAGE_DRILL: Record<string, string> = {
  domainAssigned: '/workspaces',
  lineageComplete: '/?gap=lineageComplete',
};

const useStyles = makeStyles({
  root: { height: '100%', overflowY: 'auto' },
  header: { padding: '20px 32px', backgroundColor: tokens.colorNeutralBackground1, borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
  content: { maxWidth: '1120px', margin: '0 auto', padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: '28px' },
  lensHead: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' },
  lensTitle: { fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' },
  postureGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '16px' },
  twoUp: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', '@media (max-width: 700px)': { gridTemplateColumns: '1fr' } },
  threeUp: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', '@media (max-width: 980px)': { gridTemplateColumns: '1fr' } },
  stub: { padding: '24px', minHeight: '112px', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: tokens.colorNeutralForeground3 },
  legendRow: { display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '6px 4px', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', borderRadius: tokens.borderRadiusSmall, ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover }, ':disabled': { cursor: 'default', ':hover': { backgroundColor: 'transparent' } } },
  legendDot: { width: '10px', height: '10px', borderRadius: '3px', flexShrink: 0 },
  legendLabel: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: tokens.fontSizeBase200 },
  legendVal: { color: tokens.colorNeutralForeground3, fontVariantNumeric: 'tabular-nums', fontSize: tokens.fontSizeBase200 },
  trendWrap: { marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '2px' },
  trendMuted: { fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3, display: 'inline-flex', alignItems: 'center', gap: '3px' },
  spark: { height: '26px', marginTop: '2px' },
  // Rollup breakdown (workspace / domain / type tabs)
  tabsWrap: { marginBottom: '10px' },
  rollupCard: { padding: '4px 8px' },
  rollupRow: {
    display: 'flex', alignItems: 'center', gap: '12px', width: '100%', padding: '10px 8px',
    border: 'none', background: 'none', textAlign: 'left', cursor: 'pointer', borderRadius: tokens.borderRadiusSmall,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover },
    ':disabled': { cursor: 'default', ':hover': { backgroundColor: 'transparent' } },
  },
  rollupIcon: { width: '18px', height: '18px', flexShrink: 0, color: tokens.colorNeutralForeground3 },
  rollupMain: { flex: 1, minWidth: 0 },
  rollupTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' },
  rollupName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: tokens.fontWeightSemibold, fontSize: tokens.fontSizeBase300 },
  rollupScore: { fontWeight: 700, fontSize: tokens.fontSizeBase200, fontVariantNumeric: 'tabular-nums', flexShrink: 0 },
  rollupBarTrack: { height: '5px', borderRadius: '999px', backgroundColor: tokens.colorNeutralBackground4, overflow: 'hidden', marginTop: '5px' },
  rollupBarFill: { height: '100%', borderRadius: '999px' },
  rollupMeta: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200, whiteSpace: 'nowrap', flexShrink: 0 },
  // Freshness histogram
  histWrap: { display: 'flex', flexDirection: 'column', gap: '10px', padding: '18px 16px' },
  histRow: { display: 'flex', alignItems: 'center', gap: '10px' },
  histLabel: { width: '90px', flexShrink: 0, fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 },
  histBarTrack: { flex: 1, height: '16px', borderRadius: tokens.borderRadiusSmall, backgroundColor: tokens.colorNeutralBackground4, overflow: 'hidden' },
  histBarFill: { height: '100%' },
  histCount: { width: '34px', textAlign: 'right', flexShrink: 0, fontSize: tokens.fontSizeBase200, fontVariantNumeric: 'tabular-nums', color: tokens.colorNeutralForeground2 },
  // Trend charts
  trendCard: { padding: '14px 16px' },
  trendCardHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '6px' },
  trendChartWrap: { height: '90px', marginTop: '6px' },
  bigTrendWrap: { height: '220px', padding: '14px 20px 6px' },
  // Drift
  driftRow: {
    display: 'flex', alignItems: 'center', gap: '12px', width: '100%', padding: '11px 12px',
    border: 'none', background: 'none', textAlign: 'left', borderRadius: tokens.borderRadiusSmall,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  driftRowClickable: { cursor: 'pointer', ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover } },
  driftDelta: { fontWeight: 700, fontSize: tokens.fontSizeBase300, fontVariantNumeric: 'tabular-nums', minWidth: '64px', textAlign: 'right' },
  emptyLine: { padding: '18px', color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
});

const PIE_COLORS = CATEGORICAL_PALETTE;

const STATUS_COLOR: Record<HealthStatus, string> = {
  success: tokens.colorStatusSuccessForeground1,
  warning: tokens.colorStatusWarningForeground1,
  error: tokens.colorStatusDangerForeground1,
};

export function ObservabilityPage() {
  const styles = useStyles();
  const navigate = useNavigate();
  const [coverage, setCoverage] = useState<CoverageMetric[]>([]);
  const [posture, setPosture] = useState<PostureSignal[]>([]);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceRef[]>([]);
  const [domains, setDomains] = useState<DomainRef[]>([]);
  const [edges, setEdges] = useState<LineageEdge[]>([]);
  const [history, setHistory] = useState<Record<string, HistoryPoint[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [breakdownTab, setBreakdownTab] = useState<'workspace' | 'domain' | 'type'>('workspace');

  // Only transient failures (network blips, or the cold deep-link 401 noted
  // below) are worth retrying — a deterministic 4xx fails identically every
  // time, so retrying it just burns ~2s before showing the same error.
  const isRetryableError = (err: unknown): boolean => {
    const status = (err as { status?: number; statusCode?: number })?.status
      ?? (err as { status?: number; statusCode?: number })?.statusCode;
    if (status === undefined) return true; // unknown shape — assume network-level
    return status === 401 || status >= 500;
  };

  const load = useCallback(async (cancelledRef: { current: boolean }) => {
    setLoading(true);
    setError(null);
    // On a cold deep-link load the auth token can lag the first requests,
    // surfacing a transient 401/415. Retry with a short backoff before failing.
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const [c, p, it, ws, doms, ed, h] = await Promise.all([
          getCoverage(), getPosture(), getItems(), getWorkspaces(), getDomains(), getLineageEdges(), getMetricHistory(),
        ]);
        if (cancelledRef.current) return;
        setCoverage(c);
        setPosture(p);
        setItems(it);
        setWorkspaces(ws);
        setDomains(doms);
        setEdges(ed);
        setHistory(h);
        setLoading(false);
        return;
      } catch (err) {
        lastErr = err;
        if (cancelledRef.current || !isRetryableError(err) || attempt === 2) break;
        await new Promise((r) => setTimeout(r, 400 + attempt * 500));
      }
    }
    if (!cancelledRef.current) {
      setError(lastErr instanceof Error ? lastErr.message : 'Failed to load metrics.');
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const cancelledRef = { current: false };
    void load(cancelledRef);
    return () => { cancelledRef.current = true; };
  }, [load]);

  /* The single headline "Coverage score" — MUST use the exact same formula
     (and the same live `items` array) as Catalog's hero gauge/KPIs, via the
     shared governanceScore() helper. This used to instead average ALL 6
     backend CoverageMetric rows, two of which (domainAssigned — scoped to
     workspaces, lineageComplete — scoped to a lineage-eligible item subset)
     have different denominators than the other 4 item-level ones, so this
     number could (and did) genuinely disagree with Catalog's "% governed" by
     several points despite both claiming to mean the same thing. Those 2
     metrics are still shown individually in the breakdown list below —
     nothing is hidden, they're just no longer blended into one misleading
     composite. */

  const typeComposition = useMemo<{ name: string; value: number; type?: string }[]>(() => {
    const m = new Map<string, number>();
    for (const i of items) m.set(i.itemType, (m.get(i.itemType) ?? 0) + 1);
    const s = [...m.entries()].sort((a, b) => b[1] - a[1]);
    const top: { name: string; value: number; type?: string }[] = s.slice(0, 8).map(([type, value]) => ({ name: type, value, type }));
    const other = s.slice(8).reduce((n, [, v]) => n + v, 0);
    if (other > 0) top.push({ name: 'Other', value: other });
    return top;
  }, [items]);

  const topWorkspaces = useMemo(() => {
    const wsName = new Map(workspaces.map((w) => [w.canonicalId, w.name]));
    const byWs = new Map<string, number>();
    for (const i of items) {
      if (!i.workspaceCanonicalId) continue;
      const gap = !i.sensitivityLabel || !i.description || !i.owner || !(i.endorsement && i.endorsement !== 'None');
      if (gap) byWs.set(i.workspaceCanonicalId, (byWs.get(i.workspaceCanonicalId) ?? 0) + 1);
    }
    return [...byWs.entries()]
      .map(([canonicalId, gaps]) => ({ canonicalId, name: wsName.get(canonicalId) ?? canonicalId.replace('fabric:workspace:', ''), gaps }))
      .sort((a, b) => b.gaps - a.gaps)
      .slice(0, 6);
  }, [items, workspaces]);
  const orderedPosture = useMemo(
    () => Object.keys(POSTURE_ICONS).map((k) => posture.find((p) => p.signal === k)).filter(Boolean) as PostureSignal[],
    [posture]
  );

  // --- Deep-dive analysis (all derived client-side from the same fetch — no
  // extra scanner/backend work needed; see lib/observabilityAnalysis.ts) ---
  const wsRollup = useMemo(() => workspaceGovRollup(items, workspaces), [items, workspaces]);
  const domainRollup = useMemo(() => domainGovRollup(items, domains, workspaces), [items, domains, workspaces]);
  const typeRollup = useMemo(() => typeGovRollup(items), [items]);
  const staleness = useMemo(() => stalenessHistogram(items), [items]);
  const owners = useMemo(() => ownerConcentration(items), [items]);
  const sensitivity = useMemo(() => sensitivityBreakdown(items), [items]);
  const endorsement = useMemo(() => endorsementBreakdown(items), [items]);
  const lineageByType = useMemo(() => lineageCompletenessByType(items, edges, LINEAGE_ELIGIBLE_TYPES), [items, edges]);
  const coverageDrift = useMemo(() => detectDrift(history, COVERAGE_LABELS, 'coverage'), [history]);
  const postureDrift = useMemo(() => detectDrift(history, POSTURE_LABELS, 'posture'), [history]);
  const driftSignals = useMemo(() => [...coverageDrift, ...postureDrift], [coverageDrift, postureDrift]);
  const estateSeries = useMemo(() => seriesFor(history, 'posture:itemCount'), [history]);
  const discovered = useMemo(() => recentlyDiscovered(items, 8), [items]);
  const staleItems = useMemo(
    () => [...items].filter((i) => i.modifiedDate).sort((a, b) => (a.modifiedDate! < b.modifiedDate! ? -1 : 1)).slice(0, 8),
    [items],
  );
  const maxHistBucket = useMemo(() => Math.max(1, ...staleness.map((b) => b.count)), [staleness]);

  const breakdownRows: GovRollup[] = breakdownTab === 'workspace' ? wsRollup : breakdownTab === 'domain' ? domainRollup : typeRollup;
  const breakdownIcon = useCallback((row: GovRollup): ReactNode => {
    if (breakdownTab === 'workspace') return <img src={workspaceIconUrl} width={18} height={18} alt="" />;
    if (breakdownTab === 'type') return <img src={itemIconUrl(row.key)} width={18} height={18} alt="" />;
    return <Folder24Regular style={{ fontSize: '16px' }} />;
  }, [breakdownTab]);
  const breakdownOpen = useCallback((row: GovRollup) => {
    if (breakdownTab === 'workspace') navigate(`/?workspace=${encodeURIComponent(row.key)}`);
    else if (breakdownTab === 'type') navigate(`/?type=${encodeURIComponent(row.key)}`);
    else if (row.key !== '__unassigned') navigate(`/?domain=${encodeURIComponent(row.key)}`);
  }, [breakdownTab, navigate]);

  return (
    <div className={styles.root}>
      <PageHeader
        icon={<DataTrending24Regular />}
        title="Observability"
        subtitle="Four governance lenses over the Fabric estate. Coverage gaps are findings — click one to see the assets."
      />

      <div className={styles.content}>
        {loading ? (
          <PageLoadingSkeleton cards={6} rows={5} />
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
            {/* Posture */}
            <section>
              <LensHead icon={<Cube24Regular />} title="Posture" subtitle="Estate health at a glance" />
              <div className={styles.postureGrid}>
                {orderedPosture.map((p) => {
                  const warn = p.status === 'warn' || p.status === 'critical';
                  const link = POSTURE_LINK[p.signal];
                  return (
                    <PostureCard
                      key={p.id}
                      posture={p}
                      icon={POSTURE_ICONS[p.signal]}
                      label={POSTURE_LABELS[p.signal] ?? p.signal}
                      points={history[`posture:${p.signal}`]}
                      color={warn ? STATUS_COLOR.warning : tokens.colorBrandForeground1}
                      warn={warn}
                      onDrill={link ? () => navigate(link) : undefined}
                    />
                  );
                })}
              </div>
            </section>

            {/* Trends over time — real multi-scan history, not just a last-scan delta */}
            <section>
              <LensHead icon={<DataTrending24Regular />} title="Trends" subtitle="Full scan history for the estate and every coverage metric" />
              <Card className={styles.bigTrendWrap}>
                <Text size={300} weight="semibold">Estate size over time</Text>
                {estateSeries.length >= 2 ? (
                  <ResponsiveContainer width="100%" height="88%">
                    <AreaChart data={estateSeries} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
                      <XAxis dataKey="x" hide />
                      <YAxis width={40} tick={{ fontSize: 11, fill: tokens.colorNeutralForeground3 }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <RTooltip
                        formatter={(v: number) => [`${v} items`, '']}
                        labelFormatter={(_, p) => (p?.[0]?.payload as { date?: string })?.date ? new Date((p[0].payload as { date: string }).date).toLocaleString() : ''}
                      />
                      <Area type="monotone" dataKey="v" stroke={tokens.colorBrandForeground1} fill={tokens.colorBrandForeground1} fillOpacity={0.12} strokeWidth={2} dot={{ r: 3 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className={styles.emptyLine}>Not enough scan history yet — this fills in after a second scan runs.</div>
                )}
              </Card>

              <div className={styles.threeUp} style={{ marginTop: '16px' }}>
                {coverage.map((c) => {
                  const series = seriesFor(history, `coverage:${c.metric}`);
                  return (
                    <Card key={c.id} className={styles.trendCard}>
                      <div className={styles.trendCardHead}>
                        <Text size={200} weight="semibold">{COVERAGE_LABELS[c.metric] ?? c.metric}</Text>
                        <Text size={300} weight="bold" style={{ color: healthColor(c.percent) }}>{c.percent.toFixed(0)}%</Text>
                      </div>
                      {series.length >= 2 ? (
                        <div className={styles.trendChartWrap}>
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                              <YAxis domain={[0, 100]} hide />
                              <RTooltip formatter={(v: number) => [`${v.toFixed(0)}%`, '']} labelFormatter={() => ''} />
                              <Line type="monotone" dataKey="v" stroke={healthColor(c.percent)} strokeWidth={2} dot={false} isAnimationActive={false} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      ) : (
                        <Text size={200} style={{ color: tokens.colorNeutralForeground3, display: 'block', marginTop: '12px' }}>Baseline — no trend yet.</Text>
                      )}
                    </Card>
                  );
                })}
              </div>
            </section>

            {/* Coverage breakdown — by workspace / domain / type, not just one tenant-wide number */}
            <section>
              <LensHead icon={<Grid24Regular />} title="Coverage breakdown" subtitle="Exactly where governance gaps concentrate" />
              <Card className={styles.rollupCard}>
                <div style={{ padding: '10px 8px 0' }} className={styles.tabsWrap}>
                  <TabList selectedValue={breakdownTab} onTabSelect={(_, d) => setBreakdownTab(d.value as typeof breakdownTab)} size="small">
                    <Tab value="workspace">By workspace ({wsRollup.length})</Tab>
                    <Tab value="domain">By domain ({domainRollup.length})</Tab>
                    <Tab value="type">By type ({typeRollup.length})</Tab>
                  </TabList>
                </div>
                {breakdownRows.length === 0 ? (
                  <div className={styles.emptyLine}>No data yet.</div>
                ) : (
                  breakdownRows.map((row) => {
                    const color = healthColor(row.score);
                    const clickable = !(breakdownTab === 'domain' && row.key === '__unassigned');
                    return (
                      <button key={row.key} type="button" disabled={!clickable} className={styles.rollupRow} onClick={() => breakdownOpen(row)}>
                        <span className={styles.rollupIcon}>{breakdownIcon(row)}</span>
                        <span className={styles.rollupMain}>
                          <span className={styles.rollupTop}>
                            <span className={styles.rollupName}>{row.name}</span>
                            <span className={styles.rollupScore} style={{ color }}>{row.score}%</span>
                          </span>
                          <span className={styles.rollupBarTrack}><span className={styles.rollupBarFill} style={{ width: `${row.score}%`, backgroundColor: color }} /></span>
                        </span>
                        <span className={styles.rollupMeta}>{row.itemCount} {row.itemCount === 1 ? 'asset' : 'assets'}</span>
                        {clickable && <ChevronRight16Regular style={{ color: tokens.colorNeutralForeground4, flexShrink: 0 }} />}
                      </button>
                    );
                  })
                )}
              </Card>
            </section>

            {/* Composition */}
            <section>
              <LensHead icon={<Shapes24Regular />} title="Composition" subtitle="What the estate is made of — and where gaps concentrate" />
              <div className={styles.twoUp}>
                <Card style={{ padding: '16px' }}>
                  <Text weight="semibold" style={{ display: 'block', marginBottom: '10px' }}>Assets by type</Text>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ width: 150, height: 150, flexShrink: 0 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={typeComposition} dataKey="value" nameKey="name" innerRadius={42} outerRadius={68} paddingAngle={2} stroke="none">
                            {typeComposition.map((_, idx) => <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />)}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {typeComposition.map((t, idx) => (
                        <button key={t.name} className={styles.legendRow} disabled={!t.type} onClick={() => t.type && navigate(`/?type=${encodeURIComponent(t.type)}`)}>
                          <span className={styles.legendDot} style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }} />
                          <span className={styles.legendLabel}>{t.name}</span>
                          <span className={styles.legendVal}>{t.value}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </Card>
                <Card style={{ padding: '16px' }}>
                  <Text weight="semibold" style={{ display: 'block', marginBottom: '10px' }}>Workspaces with the most gaps</Text>
                  {topWorkspaces.length === 0 ? (
                    <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>No gaps — every asset is fully governed.</Text>
                  ) : (
                    topWorkspaces.map((w) => (
                      <button key={w.canonicalId} className={styles.legendRow} onClick={() => navigate(`/?workspace=${encodeURIComponent(w.canonicalId)}`)}>
                        <img src={workspaceIconUrl} width={16} height={16} alt="" />
                        <span className={styles.legendLabel}>{w.name}</span>
                        <Badge appearance="tint" color="warning">{w.gaps}</Badge>
                      </button>
                    ))
                  )}
                </Card>
                <Card style={{ padding: '16px' }}>
                  <Text weight="semibold" style={{ display: 'block', marginBottom: '10px' }}>Sensitivity labels in use</Text>
                  {sensitivity.length === 0 ? (
                    <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>No labeled assets yet.</Text>
                  ) : (
                    sensitivity.map((s, idx) => (
                      <button key={s.label} className={styles.legendRow} onClick={() => navigate(`/?q=${encodeURIComponent(s.label)}`)}>
                        <span className={styles.legendDot} style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }} />
                        <span className={styles.legendLabel}>{s.label}</span>
                        <span className={styles.legendVal}>{s.count}</span>
                      </button>
                    ))
                  )}
                </Card>
                <Card style={{ padding: '16px' }}>
                  <Text weight="semibold" style={{ display: 'block', marginBottom: '10px' }}>Endorsement levels</Text>
                  {endorsement.map((e) => (
                    <button key={e.label} className={styles.legendRow} onClick={() => navigate(e.label === 'None' ? '/?gap=endorsed' : `/?q=${encodeURIComponent(e.label)}`)}>
                      <span className={styles.legendDot} style={{ backgroundColor: e.label === 'None' ? tokens.colorNeutralBackground4 : tokens.colorPaletteGreenBackground3 }} />
                      <span className={styles.legendLabel}>{e.label}</span>
                      <span className={styles.legendVal}>{e.count}</span>
                    </button>
                  ))}
                </Card>
              </div>
            </section>

            {/* Freshness */}
            <section>
              <LensHead icon={<Clock24Regular />} title="Freshness" subtitle="How current the estate is, and what's gone stale" />
              <div className={styles.twoUp}>
                <Card>
                  <div className={styles.histWrap}>
                    {staleness.map((b) => (
                      <div key={b.label} className={styles.histRow}>
                        <span className={styles.histLabel}>{b.label}</span>
                        <span className={styles.histBarTrack}>
                          <span
                            className={styles.histBarFill}
                            style={{
                              width: `${Math.round((b.count / maxHistBucket) * 100)}%`,
                              backgroundColor: b.label === 'Unknown' ? tokens.colorNeutralForeground4 : b.label === '180+ days' ? STATUS_COLOR.error : b.label === '91–180 days' ? STATUS_COLOR.warning : STATUS_COLOR.success,
                            }}
                          />
                        </span>
                        <span className={styles.histCount}>{b.count}</span>
                      </div>
                    ))}
                  </div>
                </Card>
                <Card style={{ padding: '4px 8px' }}>
                  <Text weight="semibold" style={{ display: 'block', margin: '10px 8px 4px' }}>Most stale assets</Text>
                  {staleItems.length === 0 ? (
                    <div className={styles.emptyLine}>No modification dates captured yet.</div>
                  ) : (
                    staleItems.map((i) => (
                      <button key={i.id} className={styles.rollupRow} onClick={() => navigate(`/?item=${encodeURIComponent(i.id)}`)}>
                        <img className={styles.rollupIcon} src={itemIconUrl(i.itemType)} alt="" />
                        <span className={styles.rollupMain}>
                          <span className={styles.rollupName} style={{ display: 'block' }}>{i.name}</span>
                        </span>
                        <span className={styles.rollupMeta}>{daysSinceLabel(i.modifiedDate)}</span>
                        <ChevronRight16Regular style={{ color: tokens.colorNeutralForeground4, flexShrink: 0 }} />
                      </button>
                    ))
                  )}
                </Card>
              </div>
            </section>

            {/* Ownership */}
            <section>
              <LensHead icon={<Person24Regular />} title="Ownership" subtitle="Where accountability concentrates across the estate" />
              <Card style={{ padding: '4px 8px' }}>
                {owners.length === 0 ? (
                  <div className={styles.emptyLine}>No owners captured yet.</div>
                ) : (
                  owners.map((o) => {
                    const color = healthColor(o.score);
                    return (
                      <button key={o.owner} className={styles.rollupRow} onClick={() => navigate(`/?q=${encodeURIComponent(o.owner)}`)}>
                        <span className={styles.rollupMain}>
                          <span className={styles.rollupTop}>
                            <span className={styles.rollupName}>{o.owner}</span>
                            <span className={styles.rollupScore} style={{ color }}>{o.score}% governed</span>
                          </span>
                          <span className={styles.rollupBarTrack}><span className={styles.rollupBarFill} style={{ width: `${o.score}%`, backgroundColor: color }} /></span>
                        </span>
                        <span className={styles.rollupMeta}>{o.itemCount} assets{o.sensitiveCount > 0 ? ` · ${o.sensitiveCount} sensitive` : ''}</span>
                        <ChevronRight16Regular style={{ color: tokens.colorNeutralForeground4, flexShrink: 0 }} />
                      </button>
                    );
                  })
                )}
              </Card>
            </section>

            {/* Lineage depth */}
            <section>
              <LensHead icon={<Flow24Regular />} title="Lineage depth" subtitle="Completeness by asset type, not just one tenant-wide number" />
              <Card style={{ padding: '4px 8px' }}>
                {lineageByType.length === 0 ? (
                  <div className={styles.emptyLine}>No lineage-eligible assets yet.</div>
                ) : (
                  lineageByType.map((r) => {
                    const color = healthColor(r.pct);
                    return (
                      <button key={r.type} className={styles.rollupRow} onClick={() => navigate(`/?type=${encodeURIComponent(r.type)}&gap=lineageComplete`)}>
                        <img className={styles.rollupIcon} src={itemIconUrl(r.type)} alt="" />
                        <span className={styles.rollupMain}>
                          <span className={styles.rollupTop}>
                            <span className={styles.rollupName}>{r.type}</span>
                            <span className={styles.rollupScore} style={{ color }}>{r.pct}%</span>
                          </span>
                          <span className={styles.rollupBarTrack}><span className={styles.rollupBarFill} style={{ width: `${r.pct}%`, backgroundColor: color }} /></span>
                        </span>
                        <span className={styles.rollupMeta}>{r.withLineage}/{r.total}</span>
                        <ChevronRight16Regular style={{ color: tokens.colorNeutralForeground4, flexShrink: 0 }} />
                      </button>
                    );
                  })
                )}
              </Card>
            </section>

            {/* Activity + Drift */}
            <div className={styles.twoUp}>
              <section>
                <LensHead icon={<History24Regular />} title="Activity" subtitle="Recently discovered assets" />
                <Card style={{ padding: '4px 8px' }}>
                  {discovered.length === 0 ? (
                    <div className={styles.emptyLine}>No discovery timestamps captured yet.</div>
                  ) : (
                    discovered.map((i) => (
                      <button key={i.id} className={styles.rollupRow} onClick={() => navigate(`/?item=${encodeURIComponent(i.id)}`)}>
                        <img className={styles.rollupIcon} src={itemIconUrl(i.itemType)} alt="" />
                        <span className={styles.rollupMain}>
                          <span className={styles.rollupName} style={{ display: 'block' }}>{i.name}</span>
                        </span>
                        <span className={styles.rollupMeta}>{relTimeLabel(i.firstSeen)}</span>
                        <ChevronRight16Regular style={{ color: tokens.colorNeutralForeground4, flexShrink: 0 }} />
                      </button>
                    ))
                  )}
                </Card>
                <Text size={100} style={{ color: tokens.colorNeutralForeground3, display: 'block', marginTop: '6px' }}>
                  A full change-audit trail needs a dedicated activity-event scanner capture — not built yet. This is the honest proxy available today: what's newly appeared in the catalog.
                </Text>
              </section>
              <section>
                <LensHead icon={<BranchCompare24Regular />} title="Drift" subtitle="Real movement across the full scan history — regressions first" />
                <Card style={{ padding: '4px 8px' }}>
                  {driftSignals.length === 0 ? (
                    <div className={styles.emptyLine}>No metric has moved more than 0.5pp across the captured history yet.</div>
                  ) : (
                    driftSignals.map((s) => {
                      const drillTo = s.kind === 'coverage'
                        ? (ITEM_GAP_FILTERS[s.key] ? `/?gap=${s.key}` : COVERAGE_DRILL[s.key])
                        : POSTURE_LINK[s.key];
                      const clickable = Boolean(drillTo);
                      const color = s.direction === 'down' ? STATUS_COLOR.error : STATUS_COLOR.success;
                      return (
                        <button
                          key={`${s.kind}:${s.key}`}
                          disabled={!clickable}
                          className={mergeClasses(styles.driftRow, clickable && styles.driftRowClickable)}
                          onClick={() => drillTo && navigate(drillTo)}
                        >
                          <span style={{ color }}>{s.direction === 'down' ? '▼' : '▲'}</span>
                          <span className={styles.rollupMain}>
                            <span className={styles.rollupName} style={{ display: 'block' }}>{s.label}</span>
                            <span className={styles.rollupMeta}>{s.kind === 'coverage' ? `now ${s.latest.toFixed(0)}%` : `now ${s.latest}`}</span>
                          </span>
                          <span className={styles.driftDelta} style={{ color }}>{fmtDelta(s.delta)}{s.kind === 'coverage' ? 'pp' : ''}</span>
                        </button>
                      );
                    })
                  )}
                </Card>
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function LensHead({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle: string }) {
  const styles = useStyles();
  return (
    <div className={styles.lensHead}>
      <span style={{ color: tokens.colorNeutralForeground3 }}>{icon}</span>
      <div>
        <div className={styles.lensTitle}>{title}</div>
        <Text block size={200} style={{ color: tokens.colorNeutralForeground3 }}>{subtitle}</Text>
      </div>
    </div>
  );
}

function fmtDelta(d: number): string {
  const v = Number.isInteger(d) ? String(Math.abs(d)) : Math.abs(d).toFixed(1);
  return `${d > 0 ? '\u25B2 +' : '\u25BC \u2212'}${v}`;
}

/** "N days ago" (or the date) for a modifiedDate cell in the freshness list. */
function daysSinceLabel(iso?: string): string {
  if (!iso) return 'unknown';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (Number.isNaN(days)) return 'unknown';
  return `${days}d ago`;
}

/** Compact "time ago" for a firstSeen cell in the activity list. */
function relTimeLabel(iso?: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  const m = Math.floor(days / 30);
  return m < 12 ? `${m}mo ago` : `${Math.floor(m / 12)}y ago`;
}
