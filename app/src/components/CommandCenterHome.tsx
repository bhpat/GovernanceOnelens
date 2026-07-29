import { useMemo, useState, useEffect, type ReactNode } from 'react';
import { makeStyles, mergeClasses, tokens, Button } from '@fluentui/react-components';
import { Card } from '@tremor/react';
import {
  ArrowRight16Regular,
  Open16Regular,
  Warning16Filled,
  DatabaseStack16Regular,
  Group20Regular,
  ShieldCheckmark20Regular,
  ShieldError16Regular,
  History20Regular,
  Sparkle20Regular,
  Grid20Regular,
  DataBarHorizontal20Regular,
  Trophy16Regular,
} from '@fluentui/react-icons';

import { itemIconUrl } from '@/lib/itemIcons';
import { ITEM_GAP_FILTERS, type CatalogItem, type WorkspaceRef, type DomainRef } from '@/services/catalog';
import { COVERAGE_LABELS } from '@/services/observability';
import { healthColor, HEALTH_HEX, govPillars, governanceScore } from '@/lib/health';
import { SECTION_ACCENTS } from '@/lib/sectionTheme';

const CATALOG_ACCENT = SECTION_ACCENTS['/'].accent;
const WORKSPACES_ACCENT = SECTION_ACCENTS['/workspaces'].accent;

function relTime(iso?: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime(); if (Number.isNaN(then)) return '';
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return 'today'; if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  const m = Math.floor(days / 30); return m < 12 ? `${m}mo ago` : `${Math.floor(m / 12)}y ago`;
}

export interface CommandCenterProps {
  items: CatalogItem[];
  workspaces: WorkspaceRef[];
  domains: DomainRef[];
  favorites: string[];
  recents: string[];
  onSelect: (id: string) => void;
  onBrowseType: (t: string) => void;
  onBrowseAll: () => void;
  onGap: (metric: string) => void;
  onHas: (v: string) => void;
  onWorkspaces: () => void;
  onWorkspaceSelect: (canonicalId: string) => void;
  onOpenObservability: () => void;
}

const useStyles = makeStyles({
  root: { maxWidth: '1100px', margin: '0 auto', padding: '24px 32px 40px', display: 'flex', flexDirection: 'column', gap: '18px' },
  /* subtle staggered entrance for each section — CSS keyframes (not a new
     motion-library dependency), mirrors HomePage.tsx's own fadeIn technique.
     Per-section animationDelay is set inline at the render site. */
  reveal: {
    animationDuration: '320ms',
    animationTimingFunction: 'ease-out',
    animationFillMode: 'both',
    animationName: {
      from: { opacity: 0, transform: 'translateY(8px)' },
      to: { opacity: 1, transform: 'translateY(0)' },
    },
  },
  /* hero \u2014 kept intentionally compact: score + headline + CTA only.
     Per-dimension breakdown lives in "Needs attention" below, not duplicated here. */
  hero: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '22px', alignItems: 'center', padding: '18px 24px', borderRadius: tokens.borderRadiusXLarge, background: `linear-gradient(120deg, ${tokens.colorNeutralBackground1} 0%, ${tokens.colorNeutralBackground1} 45%, #EFF6FF 78%, #F0FDFA 100%)`, border: `1px solid ${tokens.colorNeutralStroke2}`, boxShadow: tokens.shadow4 },
  gauge: { position: 'relative', width: '120px', height: '120px', flexShrink: 0, cursor: 'pointer', border: 'none', background: 'none', padding: 0, transition: 'transform 200ms ease-out', ':hover': { transform: 'scale(1.08)' } },
  gaugeCenter: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0px' },
  gaugePct: { fontSize: '28px', fontWeight: 800, lineHeight: 1 },
  gaugeCap: { fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: tokens.colorNeutralForeground3, marginTop: '3px' },
  heroRight: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: '10px' },
  heroHeadline: { fontSize: '19px', fontWeight: 800, lineHeight: 1.25, color: tokens.colorNeutralForeground1 },
  heroHeadlineAccent: { color: CATALOG_ACCENT },
  heroSub: { color: tokens.colorNeutralForeground2, fontSize: tokens.fontSizeBase200 },
  heroCta: { display: 'flex', gap: '10px', flexWrap: 'wrap' },

  /* kpi cards */
  kpiRow: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' },
  kpi: { display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 16px', borderRadius: tokens.borderRadiusLarge, border: `1px solid ${tokens.colorNeutralStroke2}`, background: tokens.colorNeutralBackground1, cursor: 'pointer', textAlign: 'left', width: '100%', transition: 'box-shadow 120ms, transform 120ms', ':hover': { boxShadow: tokens.shadow8, transform: 'translateY(-1px)' } },
  kpiIcon: { width: '38px', height: '38px', borderRadius: tokens.borderRadiusMedium, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  kpiBody: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  kpiValue: { fontSize: '24px', fontWeight: 800, lineHeight: 1 },
  kpiLabel: { fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3, marginTop: '2px' },

  /* two-column action row \u2014 the reason to open this page: what needs fixing */
  cols: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', alignItems: 'start' },
  card: { borderRadius: tokens.borderRadiusLarge, border: `1px solid ${tokens.colorNeutralStroke2}`, background: tokens.colorNeutralBackground1, overflow: 'hidden' },
  cardHead: { display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
  cardTitle: { fontWeight: 700, fontSize: tokens.fontSizeBase300 },
  cardHint: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  cardBody: { padding: '6px 8px' },
  emptyLine: { padding: '18px', color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },

  /* needs attention worklist */
  gapRow: { display: 'flex', alignItems: 'center', gap: '12px', width: '100%', padding: '9px 10px', border: 'none', background: 'none', borderRadius: tokens.borderRadiusMedium, cursor: 'pointer', textAlign: 'left', transition: 'background-color 120ms, transform 120ms', ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover, transform: 'translateX(2px)' } },
  gapCount: { fontSize: '19px', fontWeight: 800, lineHeight: 1, minWidth: '40px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  gapMid: { flex: 1, minWidth: 0 },
  gapLabel: { fontSize: tokens.fontSizeBase300, fontWeight: 600 },
  gapBarTrack: { height: '5px', borderRadius: '999px', backgroundColor: tokens.colorNeutralBackground4, overflow: 'hidden', marginTop: '6px' },
  gapBarFill: { height: '100%', borderRadius: '999px', transition: 'width 500ms ease-out' },
  gapArrow: { color: tokens.colorNeutralForeground4, flexShrink: 0 },

  /* governance breakdown — compact 4-up bullet-style bars (Ownership /
     Documentation / Sensitivity / Endorsement), tenant-wide. Same drill-
     through as "Needs attention" (same 4 metrics, positive framing + a
     lightweight visual so the page isn't pure text/lists). */
  breakdownGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '18px', padding: '14px 16px', '@media (max-width: 760px)': { gridTemplateColumns: 'repeat(2, 1fr)' } },
  pillarCell: { display: 'flex', flexDirection: 'column', gap: '6px', border: 'none', background: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', borderRadius: tokens.borderRadiusMedium, transition: 'transform 120ms', ':hover': { transform: 'translateY(-1px)' } },
  pillarTop: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' },
  pillarLabel: { fontSize: tokens.fontSizeBase200, fontWeight: 600, color: tokens.colorNeutralForeground2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  pillarPct: { fontSize: tokens.fontSizeBase300, fontWeight: 800, fontVariantNumeric: 'tabular-nums', flexShrink: 0 },
  pillarTrack: { height: '6px', borderRadius: '999px', backgroundColor: tokens.colorNeutralBackground4, overflow: 'hidden' },
  pillarFill: { display: 'block', height: '100%', borderRadius: '999px', transition: 'width 500ms ease-out' },

  /* lowest-coverage workspaces — compact top-5 list, NOT a full matrix.
     Full per-workspace detail lives on the dedicated Workspaces page. */
  worstRow: { display: 'flex', alignItems: 'center', gap: '12px', width: '100%', padding: '8px 10px', border: 'none', background: 'none', borderRadius: tokens.borderRadiusMedium, cursor: 'pointer', textAlign: 'left', transition: 'background-color 120ms, transform 120ms', ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover, transform: 'translateX(2px)' } },
  worstMain: { flex: 1, minWidth: 0 },
  worstName: { display: 'block', fontSize: tokens.fontSizeBase300, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  worstTrack: { height: '5px', borderRadius: '999px', backgroundColor: tokens.colorNeutralBackground4, overflow: 'hidden', marginTop: '6px' },
  worstFill: { display: 'block', height: '100%', borderRadius: '999px', transition: 'width 500ms ease-out' },
  worstPct: { fontSize: tokens.fontSizeBase300, fontWeight: 700, fontVariantNumeric: 'tabular-nums', minWidth: '36px', textAlign: 'right' },
  viewAllRow: { padding: '6px 10px 4px' },

  /* browse + strips */
  section: { display: 'flex', flexDirection: 'column', gap: '10px' },
  secHead: { display: 'flex', alignItems: 'center', gap: '8px' },
  secTitle: { fontWeight: 700, fontSize: tokens.fontSizeBase400 },
  secAction: { marginLeft: 'auto' },
  linkBtn: { border: 'none', background: 'none', color: CATALOG_ACCENT, cursor: 'pointer', fontSize: tokens.fontSizeBase200, fontWeight: 600, padding: 0, ':hover': { textDecoration: 'underline' } },
  chips: { display: 'flex', flexWrap: 'wrap', gap: '8px' },
  chip: { display: 'inline-flex', alignItems: 'center', gap: '7px', padding: '7px 13px', border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: '999px', background: tokens.colorNeutralBackground1, cursor: 'pointer', fontSize: tokens.fontSizeBase200, fontWeight: 500, ':hover': { border: `1px solid ${CATALOG_ACCENT}`, backgroundColor: tokens.colorNeutralBackground1Hover } },
  chipImg: { width: '16px', height: '16px' },
  chipCount: { color: tokens.colorNeutralForeground3, fontWeight: 700 },
  cardGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px' },
  asset: { display: 'flex', alignItems: 'center', gap: '10px', padding: '11px 12px', border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium, background: tokens.colorNeutralBackground1, cursor: 'pointer', textAlign: 'left', width: '100%', ':hover': { border: `1px solid ${CATALOG_ACCENT}`, backgroundColor: tokens.colorNeutralBackground1Hover } },
  assetIcon: { width: '24px', height: '24px', flexShrink: 0 },
  assetMain: { minWidth: 0, display: 'flex', flexDirection: 'column' },
  assetName: { fontWeight: 600, fontSize: tokens.fontSizeBase300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  assetMeta: { fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
});

function Gauge({ pct, onClick }: { pct: number; onClick?: () => void }) {
  const s = useStyles();
  const [displayPct, setDisplayPct] = useState(0);
  const [strokeOffset, setStrokeOffset] = useState(1); // 1 = 0%, 0 = 100%
  const r = 48, c = 2 * Math.PI * r, col = healthColor(pct);
  const targetRingRadius = 52;

  // Animate gauge fill and counter number
  useEffect(() => {
    let animationFrame;
    let currentPct = 0;
    const startTime = Date.now();
    const duration = 600; // 600ms animation

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      currentPct = Math.round(progress * pct);
      setDisplayPct(currentPct);
      setStrokeOffset(1 - progress * (pct / 100));
      
      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      }
    };

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [pct]);

  return (
    <button type="button" className={s.gauge} onClick={onClick} title={`${pct}% governed — Click to see trends`}>
      <svg width={120} height={120} viewBox="0 0 120 120">
        {/* Target ring (80% goal) — subtle dashed circle */}
        <circle cx={60} cy={60} r={targetRingRadius} fill="none" stroke={tokens.colorNeutralBackground4} strokeWidth={2} strokeDasharray="4,4" opacity={0.4} />
        
        {/* Background ring */}
        <circle cx={60} cy={60} r={r} fill="none" stroke={tokens.colorNeutralBackground4} strokeWidth={10} />
        
        {/* Animated progress ring with gradient color */}
        <circle 
          cx={60} cy={60} r={r} fill="none" stroke={col} strokeWidth={10} 
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * strokeOffset}
          transform="rotate(-90 60 60)"
          style={{ transition: 'stroke-dashoffset 40ms ease-out' }}
        />
      </svg>
      <div className={s.gaugeCenter}>
        <span className={s.gaugePct} style={{ color: col }}>{displayPct}%</span>
        <span className={s.gaugeCap}>governed</span>
      </div>
    </button>
  );
}

function Kpi({ value, label, icon, tint, warn, onClick }: { value: number; label: string; icon: ReactNode; tint: string; warn?: boolean; onClick: () => void }) {
  return (
    <Card className="p-4 hover:shadow-md hover:border-blue-500 transition-all cursor-pointer" onClick={onClick}>
      <div className="flex items-center gap-4">
        <div className="flex-shrink-0" style={{ color: tint }}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-2xl font-bold" style={warn ? { color: '#ca5010' } : { color: tint }}>
            {value.toLocaleString()}
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">{label}</div>
        </div>
      </div>
    </Card>
  );
}

export function CommandCenterHome(props: CommandCenterProps) {
  const s = useStyles();
  const { items, workspaces, favorites, recents, onSelect, onBrowseType, onBrowseAll, onGap, onHas, onWorkspaces, onWorkspaceSelect, onOpenObservability } = props;
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const total = items.length;
  const score = governanceScore(items);
  const sensitive = items.filter((i) => i.sensitivityLabel).length;
  const fullyGoverned = items.filter((i) => govPillars(i) === 4).length;
  const needAttention = items.filter((i) => govPillars(i) < 4).length;
  const wsCount = workspaces.length || new Set(items.map((i) => i.workspaceCanonicalId).filter(Boolean)).size;

  const gaps = useMemo(
    () => Object.entries(ITEM_GAP_FILTERS)
      .map(([key, g]) => ({ key, label: g.label, count: items.filter(g.predicate).length }))
      .filter((a) => a.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
    [items],
  );

  /** The same 4 governance pillars as "Needs attention", framed positively as
   * a compact 4-up bullet-bar visual (tenant-wide %) instead of a gap count.
   * Same drill-through (onGap) so clicking a bar and clicking its matching
   * gap-row land on the identical filtered list — and the same COVERAGE_LABELS
   * strings Observability uses, so the wording matches across pages too. */
  const pillars = useMemo(() => {
    const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
    return [
      { key: 'owned', label: COVERAGE_LABELS.owned, pct: pct(items.filter((i) => i.owner).length) },
      { key: 'described', label: COVERAGE_LABELS.described, pct: pct(items.filter((i) => i.description).length) },
      { key: 'sensitivityLabeled', label: COVERAGE_LABELS.sensitivityLabeled, pct: pct(items.filter((i) => i.sensitivityLabel).length) },
      { key: 'endorsed', label: COVERAGE_LABELS.endorsed, pct: pct(items.filter((i) => i.endorsement && i.endorsement !== 'None').length) },
    ];
  }, [items, total]);

  /** Per-workspace breakdown across all 4 governance dimensions (not just one
   * composite score) — the data behind the graph-focused "Coverage by
   * workspace" chart. Sorted worst-overall-first so the weakest workspaces
   * lead. */
  const wsData = useMemo(() => {
    const nameOf = new Map(workspaces.map((w) => [w.canonicalId, w.name]));
    const agg = new Map<string, { n: number; owned: number; described: number; sensitivityLabeled: number; endorsed: number }>();
    for (const i of items) {
      if (!i.workspaceCanonicalId) continue;
      const a = agg.get(i.workspaceCanonicalId) ?? { n: 0, owned: 0, described: 0, sensitivityLabeled: 0, endorsed: 0 };
      a.n += 1;
      if (i.owner) a.owned += 1;
      if (i.description) a.described += 1;
      if (i.sensitivityLabel) a.sensitivityLabeled += 1;
      if (i.endorsement && i.endorsement !== 'None') a.endorsed += 1;
      agg.set(i.workspaceCanonicalId, a);
    }
    return [...agg.entries()]
      .map(([id, a]) => ({
        id,
        name: nameOf.get(id) ?? id.replace('fabric:workspace:', ''),
        count: a.n,
        owned: Math.round((a.owned / a.n) * 100),
        described: Math.round((a.described / a.n) * 100),
        sensitivityLabeled: Math.round((a.sensitivityLabeled / a.n) * 100),
        endorsed: Math.round((a.endorsed / a.n) * 100),
        overall: Math.round(((a.owned + a.described + a.sensitivityLabeled + a.endorsed) / (a.n * 4)) * 100),
      }))
      .sort((a, b) => a.overall - b.overall);
  }, [items, workspaces]);

  const typeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) m.set(i.itemType, (m.get(i.itemType) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [items]);

  const recentItems = useMemo(() => recents.map((id) => byId.get(id)).filter(Boolean).slice(0, 4) as CatalogItem[], [recents, byId]);
  const favItems = useMemo(() => favorites.map((id) => byId.get(id)).filter(Boolean).slice(0, 4) as CatalogItem[], [favorites, byId]);
  const discovered = useMemo(() => [...items].filter((i) => i.firstSeen).sort((a, b) => (b.firstSeen! > a.firstSeen! ? 1 : -1)).slice(0, 4), [items]);
  const jumpBack = recentItems.length ? recentItems : favItems.length ? favItems : discovered;
  const jumpTitle = recentItems.length ? 'Jump back in' : favItems.length ? 'Favorites' : 'Recently discovered';
  const jumpIcon = recentItems.length ? <History20Regular /> : favItems.length ? <Sparkle20Regular /> : <Sparkle20Regular />;

  return (
    <div className={s.root}>
      {/* hero — compact: score + one-line headline + CTA only */}
      <div className={mergeClasses(s.hero, s.reveal)}>
        <Gauge pct={score} onClick={onOpenObservability} />
        <div className={s.heroRight}>
          <div>
            <div className={s.heroHeadline}>
              {needAttention > 0
                ? <>Your estate is <span className={s.heroHeadlineAccent}>{score}% governed</span> — {needAttention.toLocaleString()} assets need attention</>
                : <>Your estate is fully governed 🎉</>}
            </div>
            <div className={s.heroSub}>{total.toLocaleString()} catalogued assets across {wsCount} workspaces</div>
          </div>
          <div className={s.heroCta}>
            <Button appearance="primary" size="small" icon={<Warning16Filled />} onClick={() => onGap(gaps[0]?.key ?? 'owned')}>Review governance gaps</Button>
            <Button appearance="secondary" size="small" icon={<Open16Regular />} iconPosition="after" onClick={onOpenObservability}>View trends</Button>
          </div>
        </div>
      </div>

      {/* kpis — wrapped in card container for visual integration */}
      <div className={mergeClasses(s.card, s.reveal)} style={{ animationDelay: '40ms' }}>
        <div className={s.kpiRow} style={{ padding: '14px 16px' }}>
          <Kpi value={total} label="Catalogued assets" icon={<DatabaseStack16Regular />} tint={CATALOG_ACCENT} onClick={onBrowseAll} />
          <Kpi value={wsCount} label="Workspaces" icon={<Group20Regular />} tint={WORKSPACES_ACCENT} onClick={onWorkspaces} />
          <Kpi value={sensitive} label="Sensitive items" icon={<ShieldError16Regular />} tint={HEALTH_HEX.error} warn={sensitive > 0} onClick={() => onHas('sensitivity')} />
          <Kpi value={fullyGoverned} label="Fully governed" icon={<ShieldCheckmark20Regular />} tint={HEALTH_HEX.success} onClick={() => onHas('governed')} />
        </div>
      </div>

      {/* governance breakdown — a compact, always-visible-as-text visual (per
          ui-ux-pro-max's "Performance vs Target (Compact)"/bullet-chart
          guidance) so the landing page isn't pure text/lists. */}
      <div className={mergeClasses(s.card, s.reveal)} style={{ animationDelay: '80ms' }}>
        <div className={s.cardHead}>
          <DataBarHorizontal20Regular style={{ color: CATALOG_ACCENT }} />
          <span className={s.cardTitle}>Governance breakdown</span>
          <span className={s.cardHint}>— coverage across the 4 core pillars</span>
        </div>
        <div className={s.breakdownGrid}>
          {pillars.map((p) => (
            <button key={p.key} type="button" className={s.pillarCell} onClick={() => onGap(p.key)} title={`${p.label}: ${p.pct}%`}>
              <span className={s.pillarTop}>
                <span className={s.pillarLabel}>{p.label}</span>
                <span className={s.pillarPct} style={{ color: healthColor(p.pct) }}>{p.pct}%</span>
              </span>
              <span className={s.pillarTrack}><span className={s.pillarFill} style={{ width: `${p.pct}%`, backgroundColor: healthColor(p.pct) }} /></span>
            </button>
          ))}
        </div>
      </div>

      {/* the action row — what a governance admin lands on this page to do:
          see the biggest gaps and the worst workspaces, then go fix one. */}
      <div className={mergeClasses(s.cols, s.reveal)} style={{ animationDelay: '120ms' }}>
        <div className={s.card}>
          <div className={s.cardHead}>
            <Warning16Filled style={{ color: HEALTH_HEX.error }} />
            <span className={s.cardTitle}>Needs attention</span>
            <span className={s.cardHint}>— close the biggest gaps</span>
          </div>
          <div className={s.cardBody}>
            {gaps.length === 0 ? <div className={s.emptyLine}>No open governance gaps. 🎉</div> : gaps.map((g) => {
              const cov = total ? Math.round(((total - g.count) / total) * 100) : 0;
              return (
                <button key={g.key} type="button" className={s.gapRow} onClick={() => onGap(g.key)}>
                  <span className={s.gapCount} style={{ color: healthColor(cov) }}>{g.count}</span>
                  <span className={s.gapMid}>
                    <span className={s.gapLabel}>{g.label}</span>
                    <span className={s.gapBarTrack}><span className={s.gapBarFill} style={{ width: `${cov}%`, backgroundColor: healthColor(cov) }} /></span>
                  </span>
                  <ArrowRight16Regular className={s.gapArrow} />
                </button>
              );
            })}
          </div>
        </div>

        <div className={s.card}>
          <div className={s.cardHead}>
            <Group20Regular style={{ color: WORKSPACES_ACCENT }} />
            <span className={s.cardTitle}>Workspaces to review</span>
            <span className={s.cardHint}>— lowest overall coverage first</span>
          </div>
          <div className={s.cardBody}>
            {wsData.length === 0 ? <div className={s.emptyLine}>No workspace data.</div> : (
              <>
                {wsData.slice(0, 5).map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    className={s.worstRow}
                    title={`${w.name}: ${w.overall}% overall (ownership ${w.owned}%, documentation ${w.described}%, sensitivity ${w.sensitivityLabeled}%, endorsement ${w.endorsed}%) — ${w.count} assets`}
                    onClick={() => onWorkspaceSelect(w.id)}
                  >
                    <span className={s.worstMain}>
                      <span className={s.worstName}>{w.name}</span>
                      <span className={s.worstTrack}><span className={s.worstFill} style={{ width: `${w.overall}%`, backgroundColor: healthColor(w.overall) }} /></span>
                    </span>
                    <span className={s.worstPct} style={{ color: healthColor(w.overall) }}>{w.overall}%</span>
                  </button>
                ))}
                {wsData.length > 5 && (
                  <div className={s.viewAllRow}>
                    <button type="button" className={s.linkBtn} onClick={onWorkspaces}>View all {wsData.length} workspaces →</button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* browse by type */}
      <div className={mergeClasses(s.section, s.reveal)} style={{ animationDelay: '160ms' }}>
        <div className={s.secHead}>
          <Grid20Regular style={{ color: tokens.colorNeutralForeground2 }} />
          <span className={s.secTitle}>Browse by type</span>
          <span className={s.secAction}><button className={s.linkBtn} onClick={onBrowseAll}>View all {total} →</button></span>
        </div>
        <div className={s.chips}>
          {typeCounts.slice(0, 14).map(([t, n]) => (
            <button key={t} type="button" className={s.chip} onClick={() => onBrowseType(t)}>
              <img className={s.chipImg} src={itemIconUrl(t)} alt="" draggable={false} />
              {t}
              <span className={s.chipCount}>{n}</span>
            </button>
          ))}
        </div>
      </div>

      {/* jump back / discovered */}
      {jumpBack.length > 0 && (
        <div className={mergeClasses(s.section, s.reveal)} style={{ animationDelay: '200ms' }}>
          <div className={s.secHead}>
            {jumpIcon}
            <span className={s.secTitle}>{jumpTitle}</span>
          </div>
          <div className={s.cardGrid}>
            {jumpBack.map((i) => (
              <button key={i.id} type="button" className={s.asset} onClick={() => onSelect(i.id)}>
                <img className={s.assetIcon} src={itemIconUrl(i.itemType)} alt="" draggable={false} />
                <span className={s.assetMain}>
                  <span className={s.assetName} title={i.name}>{i.name}</span>
                  <span className={s.assetMeta}>{jumpTitle === 'Recently discovered' ? relTime(i.firstSeen) : i.itemType}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* top governed shout-out (fills the estate story) */}
      <TopGoverned items={items} onSelect={onSelect} styles={s} />
    </div>
  );
}

function TopGoverned({ items, onSelect, styles: s }: { items: CatalogItem[]; onSelect: (id: string) => void; styles: ReturnType<typeof useStyles> }) {
  const top = useMemo(() => items.filter((i) => govPillars(i) === 4).slice(0, 4), [items]);
  if (top.length === 0) return null;
  return (
    <div className={mergeClasses(s.section, s.reveal)} style={{ animationDelay: '240ms' }}>
      <div className={s.secHead}>
        <Trophy16Regular style={{ color: '#107c41' }} />
        <span className={s.secTitle}>Fully governed — the gold standard</span>
      </div>
      <div className={s.cardGrid}>
        {top.map((i) => (
          <button key={i.id} type="button" className={s.asset} onClick={() => onSelect(i.id)}>
            <img className={s.assetIcon} src={itemIconUrl(i.itemType)} alt="" draggable={false} />
            <span className={s.assetMain}>
              <span className={s.assetName} title={i.name}>{i.name}</span>
              <span className={s.assetMeta}>{i.itemType}{i.owner ? ` · ${i.owner}` : ''}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
