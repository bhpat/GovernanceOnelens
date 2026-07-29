import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  MarkerType,
  useReactFlow,
  type Node,
  type Edge,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import {
  makeStyles,
  tokens,
  Text,
  Button,
  Spinner,
  MessageBar,
  MessageBarBody,
  Input,
  Menu,
  MenuTrigger,
  MenuButton,
  MenuPopover,
  MenuList,
  MenuItemCheckbox,
  MenuGroup,
  MenuGroupHeader,
  MenuDivider,
} from '@fluentui/react-components';
import {
  Open16Regular,
  Dismiss16Regular,
  Search20Regular,
  ArrowClockwise16Regular,
  Flow24Regular,
  Filter16Regular,
  Warning16Filled,
  Warning12Filled,
  Copy16Regular,
  Checkmark16Filled,
  ChevronDown16Regular,
  ChevronRight16Regular,
  ChevronLeft16Regular,
  Globe16Regular,
} from '@fluentui/react-icons';

import { getItems, getWorkspaces, type CatalogItem, type WorkspaceRef } from '@/services/catalog';
import { getLineageEdges, type LineageEdge } from '@/services/lineage';
import { itemIconUrl, workspaceIconUrl } from '@/lib/itemIcons';
import { BRAND } from '@/lib/health';
import { CATEGORICAL_PALETTE } from '@/lib/sectionTheme';
import { relTime } from '@/lib/utils';
import { useAppToast } from '@/hooks/useAppToast';

/* ---------------------------------------------------------------- constants */
const EXTERNAL = 'external';
const NO_DOMAIN = '∅'; // sentinel for GItem.domainId when no domain is assigned (kept from buildModel, unused visually now)
const EDGE_GREY = '#b6bcc4';
const WS_COLORS = CATEGORICAL_PALETTE;
const PILL_W = 208;
const PILL_H = 40;
const CARD_W = 276;
const ROW_H = 23;
const CARD_BASE_H = 146; // header + subtitle + divider + toggle + footer + padding, before the per-row detail lines
const HUB_W = 220;
const HUB_H = 76;

const PROCESS_TYPES = new Set(['Notebook', 'CopyJob', 'DataPipeline', 'Dataflow', 'SparkJobDefinition', 'UserDataFunction', 'Eventstream']);

const GOV_OPTIONS: { value: string; label: string }[] = [
  { value: 'owned', label: 'Has owner' },
  { value: 'described', label: 'Has description' },
  { value: 'labeled', label: 'Sensitivity labeled' },
  { value: 'certified', label: 'Endorsed' },
  { value: 'gap', label: 'Has governance gaps' },
];

function govFlags(i?: CatalogItem) {
  return {
    owned: Boolean(i?.owner), described: Boolean(i?.description),
    labeled: Boolean(i?.sensitivityLabel), certified: Boolean(i?.endorsement && i.endorsement !== 'None'),
  };
}

/* ------------------------------------------------------------------- model */
interface GItem { cid: string; name: string; type?: string; source?: string; wsId: string; domainId: string; deepLink?: string; isProcess: boolean; owned: boolean; described: boolean; labeled: boolean; certified: boolean; sensitivityLabel?: string }
interface GLink { from: string; to: string; rel?: string }

function buildModel(items: CatalogItem[], edges: LineageEdge[]) {
  const byCanonical = new Map(items.map((i) => [i.canonicalId, i]));
  const nodeMap = new Map<string, GItem>();
  const ensure = (cid: string, name?: string, type?: string): GItem => {
    let n = nodeMap.get(cid);
    if (!n) {
      const it = byCanonical.get(cid);
      const t = it?.itemType ?? type; const f = govFlags(it);
      n = { cid, name: it?.name ?? name ?? cid, type: t, source: it?.source, wsId: it?.workspaceCanonicalId ?? EXTERNAL, domainId: it?.domainCanonicalId ?? NO_DOMAIN, deepLink: it?.deepLink, isProcess: Boolean(t && PROCESS_TYPES.has(t)), sensitivityLabel: it?.sensitivityLabel, ...f };
      nodeMap.set(cid, n);
    }
    return n;
  };
  const links: GLink[] = [];
  for (const e of edges) {
    if (!e.fromCanonicalId || !e.toCanonicalId || e.fromCanonicalId === e.toCanonicalId) continue;
    ensure(e.fromCanonicalId, e.fromName, e.fromType);
    ensure(e.toCanonicalId, e.toName, e.toType);
    links.push({ from: e.fromCanonicalId, to: e.toCanonicalId, rel: e.relationship });
  }
  const nodeById = new Map([...nodeMap.values()].map((n) => [n.cid, n]));
  const adjUp = new Map<string, string[]>(), adjDown = new Map<string, string[]>();
  for (const l of links) {
    (adjDown.get(l.from) ?? adjDown.set(l.from, []).get(l.from)!).push(l.to);
    (adjUp.get(l.to) ?? adjUp.set(l.to, []).get(l.to)!).push(l.from);
  }
  return { nodeById, links, adjUp, adjDown };
}
type Model = ReturnType<typeof buildModel>;

function walk(start: string, adj: Map<string, string[]>): Set<string> {
  const seen = new Set<string>(); const st = [start];
  while (st.length) { const c = st.pop()!; for (const nx of adj.get(c) ?? []) if (!seen.has(nx)) { seen.add(nx); st.push(nx); } }
  return seen;
}

/* -------------------------------------------------------------- flat layout */
interface Placed { x: number; y: number; w: number; h: number }

/**
 * Plain left-to-right dagre layout over every item node — no nested domain/
 * workspace containers. Edges connect node-to-node directly, so React Flow's
 * built-in bezier edges route themselves; no bend-point routing is needed.
 * When `restrictTo` is set, only those node ids (and edges between them) are
 * laid out at all — used to hide everything outside an active workspace scope.
 *
 * `hubIds`, when given, adds one workspace-hub pseudo-node PER distinct
 * workspace touched by the visible set, plus a "belongs-to" edge from each
 * hub to its own items — laid out in the SAME dagre graph as the real
 * lineage edges. This is what keeps the workspace -> item chain visible
 * once you're scoped into a workspace: dagre naturally ranks a hub just
 * before its own items (an edge with only outgoing links settles at the
 * earliest consistent rank), so "Workspace A -> its items -> (real lineage
 * edge) -> Workspace B's items -> Workspace B hub" all lay out as one
 * continuous, readable graph instead of the hub disappearing entirely.
 */
function layoutFlat(model: Model, sizeOf: (cid: string) => { w: number; h: number }, restrictTo: Set<string> | null, hubIds: string[] = []): Map<string, Placed> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 24, ranksep: 120, marginx: 40, marginy: 40, ranker: 'network-simplex' });
  g.setDefaultEdgeLabel(() => ({}));
  for (const id of hubIds) g.setNode(id, { width: HUB_W, height: HUB_H });
  for (const n of model.nodeById.values()) {
    if (restrictTo && !restrictTo.has(n.cid)) continue;
    const { w, h } = sizeOf(n.cid);
    g.setNode(n.cid, { width: w, height: h });
  }
  for (const l of model.links) {
    if (l.from === l.to) continue;
    if (restrictTo && (!restrictTo.has(l.from) || !restrictTo.has(l.to))) continue;
    g.setEdge(l.from, l.to);
  }
  if (hubIds.length) {
    const hubSet = new Set(hubIds);
    for (const n of model.nodeById.values()) {
      if (restrictTo && !restrictTo.has(n.cid)) continue;
      if (hubSet.has(n.wsId)) g.setEdge(n.wsId, n.cid);
    }
  }
  dagre.layout(g);
  const placed = new Map<string, Placed>();
  for (const id of hubIds) {
    const gn = g.node(id);
    if (gn) placed.set(id, { x: gn.x - gn.width / 2, y: gn.y - gn.height / 2, w: gn.width, h: gn.height });
  }
  for (const n of model.nodeById.values()) {
    const gn = g.node(n.cid);
    if (gn) placed.set(n.cid, { x: gn.x - gn.width / 2, y: gn.y - gn.height / 2, w: gn.width, h: gn.height });
  }
  return placed;
}

function cardHeight(rowCount: number): number {
  return CARD_BASE_H + rowCount * ROW_H;
}

/**
 * Aggregate item-level edges down to workspace-to-workspace links (deduped,
 * with a count and the set of distinct relationship types crossing that
 * pair) — this is what makes a cross-workspace shortcut/read/write visible
 * at the workspace-map zoom level instead of getting lost among 150+ items.
 */
interface WsEdgeAgg { from: string; to: string; count: number; rels: string[] }
function buildWsEdges(model: Model): WsEdgeAgg[] {
  const agg = new Map<string, { from: string; to: string; count: number; rels: Set<string> }>();
  for (const l of model.links) {
    const a = model.nodeById.get(l.from)?.wsId, b = model.nodeById.get(l.to)?.wsId;
    if (!a || !b || a === b) continue;
    const key = `${a}\u0001${b}`;
    const e = agg.get(key) ?? { from: a, to: b, count: 0, rels: new Set<string>() };
    e.count += 1; if (l.rel) e.rels.add(l.rel);
    agg.set(key, e);
  }
  return [...agg.values()].map((e) => ({ from: e.from, to: e.to, count: e.count, rels: [...e.rels] }));
}

/** Simple flat dagre layout over the (small) set of workspace-hub nodes. */
function layoutWorkspaceMap(ids: string[], links: { from: string; to: string }[]): Map<string, Placed> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 44, ranksep: 160, marginx: 60, marginy: 60, ranker: 'network-simplex' });
  g.setDefaultEdgeLabel(() => ({}));
  for (const id of ids) g.setNode(id, { width: HUB_W, height: HUB_H });
  for (const l of links) if (l.from !== l.to) g.setEdge(l.from, l.to);
  dagre.layout(g);
  const placed = new Map<string, Placed>();
  for (const id of ids) { const gn = g.node(id); if (gn) placed.set(id, { x: gn.x - HUB_W / 2, y: gn.y - HUB_H / 2, w: HUB_W, h: HUB_H }); }
  return placed;
}

/* -------------------------------------------------------- workspace metadata */
interface WsMeta { id: string; name: string; color: string; count: number }
function buildWsMeta(items: CatalogItem[], workspaces: WorkspaceRef[], model: Model): WsMeta[] {
  const wsName = new Map(workspaces.map((w) => [w.canonicalId, w.name]));
  const present = new Set<string>();
  for (const n of model.nodeById.values()) present.add(n.wsId);
  for (const i of items) if (i.workspaceCanonicalId) present.add(i.workspaceCanonicalId);
  const counts = new Map<string, number>();
  for (const n of model.nodeById.values()) counts.set(n.wsId, (counts.get(n.wsId) ?? 0) + 1);
  const ids = [...present].filter((id) => id !== EXTERNAL).sort();
  return ids.map((id, idx) => ({ id, name: wsName.get(id) ?? id, color: WS_COLORS[idx % WS_COLORS.length], count: counts.get(id) ?? 0 }));
}

type NodeState = 'base' | 'dim' | 'lit' | 'sel';

/** A sensitivity-propagation risk finding for one item: either it's missing
 * a label entirely, or it carries a label that disagrees with an upstream
 * labeled source it's downstream of. */
interface RiskInfo { kind: 'missing' | 'mismatch'; sourceName: string; sourceLabel: string; ownLabel?: string }

/** Human-readable explanation of a risk finding — used everywhere a warning
 * renders (pill/card tooltips, the card's own detail row) so the warning
 * always says WHAT the issue is, not just that one exists. */
function riskTooltip(r: RiskInfo): string {
  return r.kind === 'missing'
    ? `Missing a sensitivity label — upstream "${r.sourceName}" is labeled "${r.sourceLabel}"`
    : `Labeled "${r.ownLabel}", but upstream "${r.sourceName}" is labeled "${r.sourceLabel}" — possible classification drift`;
}

/* --------------------------------------------------------- node: compact pill */
interface PillData { name: string; type?: string; wsName: string; state: NodeState; isProcess: boolean; risk?: RiskInfo; external?: boolean; [k: string]: unknown }

const usePillStyles = makeStyles({
  wrap: { position: 'relative' },
  pill: {
    width: `${PILL_W}px`, height: `${PILL_H}px`, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: '8px',
    padding: '0 10px', backgroundColor: tokens.colorNeutralBackground1, borderRadius: '8px', border: `1px solid ${tokens.colorNeutralStroke2}`,
    boxShadow: tokens.shadow2, cursor: 'pointer', overflow: 'hidden', transition: 'opacity 140ms, box-shadow 140ms, border-color 140ms',
  },
  external: { border: `1px dashed ${tokens.colorNeutralStroke2}`, backgroundColor: tokens.colorNeutralBackground2 },
  icon: { width: '18px', height: '18px', flexShrink: 0 },
  name: { fontSize: tokens.fontSizeBase200, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 },
  risk: { color: '#ca5010', flexShrink: 0 },
  dim: { opacity: 0.42 },
  lit: { border: `1px solid ${BRAND}`, boxShadow: `0 0 0 1px ${BRAND}55` },
  handle: { opacity: 0, width: '1px', height: '1px', minWidth: 0, minHeight: 0, border: 'none' },
});

function PillNode({ data }: NodeProps) {
  const s = usePillStyles();
  const d = data as PillData;
  const cls = [s.pill, d.external ? s.external : '', d.state === 'dim' ? s.dim : '', d.state === 'lit' ? s.lit : ''].filter(Boolean).join(' ');
  return (
    <div className={s.wrap}>
      <Handle type="target" position={Position.Left} className={s.handle} isConnectable={false} />
      <div className={cls} title={`${d.name} · ${d.wsName}`}>
        {d.external && <Globe16Regular style={{ color: tokens.colorNeutralForeground3, flexShrink: 0 }} />}
        <img className={s.icon} src={itemIconUrl(d.type ?? 'Unknown')} alt="" draggable={false} />
        <span className={s.name}>{d.name}</span>
        {d.risk && <Warning12Filled className={s.risk} title={riskTooltip(d.risk)} />}
      </div>
      <Handle type="source" position={Position.Right} className={s.handle} isConnectable={false} />
    </div>
  );
}

/* ------------------------------------------------------- node: expanded card */
interface CardRow { label: string; value: string }
interface CardData {
  cid: string; name: string; type?: string; wsName: string; source?: string; deepLink?: string;
  rows: CardRow[]; isProcess: boolean; risk?: RiskInfo; state: NodeState; external?: boolean; [k: string]: unknown;
}

const useCardStyles = makeStyles({
  wrap: { position: 'relative' },
  card: {
    width: `${CARD_W}px`, boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
    backgroundColor: tokens.colorNeutralBackground1, borderRadius: '12px', border: `1px solid ${tokens.colorNeutralStroke2}`,
    boxShadow: tokens.shadow8, cursor: 'pointer', overflow: 'hidden', padding: '13px 15px 11px',
    transition: 'box-shadow 140ms, border-color 140ms, opacity 140ms',
  },
  dim: { opacity: 0.45 },
  lit: { border: `1px solid ${BRAND}` },
  sel: { border: `1px solid ${BRAND}`, boxShadow: `0 0 0 2px ${BRAND}33, ${tokens.shadow16}` },
  header: { display: 'flex', alignItems: 'center', gap: '8px' },
  icon: { width: '20px', height: '20px', flexShrink: 0 },
  name: { fontSize: tokens.fontSizeBase300, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 },
  risk: { color: '#ca5010', flexShrink: 0 },
  openLink: { color: tokens.colorNeutralForeground3, display: 'flex', flexShrink: 0, ':hover': { color: BRAND } },
  subtitle: { fontSize: '11px', color: tokens.colorNeutralForeground3, marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  divider: { height: '1px', backgroundColor: tokens.colorNeutralStroke2, margin: '10px 0 8px' },
  rows: { display: 'flex', flexDirection: 'column' },
  row: { display: 'flex', alignItems: 'baseline', gap: '10px', height: `${ROW_H}px` },
  rowLabel: { fontSize: '12px', color: tokens.colorNeutralForeground2, flexShrink: 0 },
  rowValue: { fontSize: '12px', color: tokens.colorNeutralForeground3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right', flex: 1 },
  toggle: { display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px', border: 'none', background: 'none', padding: '4px 0', color: BRAND, fontSize: '12px', fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start' },
  footer: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '9px', paddingTop: '9px', borderTop: `1px solid ${tokens.colorNeutralStroke2}` },
  footerTag: { fontSize: '10.5px', color: tokens.colorNeutralForeground4, textTransform: 'uppercase', letterSpacing: '0.03em' },
  footerIcon: { border: 'none', background: 'none', color: tokens.colorNeutralForeground3, cursor: 'pointer', display: 'flex', padding: '2px', borderRadius: '4px', ':hover': { color: BRAND, backgroundColor: tokens.colorNeutralBackground1Hover } },
  handle: { opacity: 0, width: '1px', height: '1px', minWidth: 0, minHeight: 0, border: 'none' },
});

function CardNode({ data }: NodeProps) {
  const s = useCardStyles();
  const d = data as CardData;
  const notify = useAppToast();
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const cls = [s.card, d.state === 'dim' ? s.dim : '', d.state === 'sel' ? s.sel : d.state === 'lit' ? s.lit : ''].filter(Boolean).join(' ');

  const onCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(d.cid).then(() => {
      setCopied(true);
      notify('Copied canonical id', { body: d.cid });
      setTimeout(() => setCopied(false), 1500);
    });
  }, [d.cid, notify]);

  return (
    <div className={s.wrap}>
      <Handle type="target" position={Position.Left} className={s.handle} isConnectable={false} />
      <div className={cls}>
        <div className={s.header}>
          <img className={s.icon} src={itemIconUrl(d.type ?? 'Unknown')} alt="" draggable={false} />
          <span className={s.name} title={d.name}>{d.name}</span>
          {d.risk && <Warning16Filled className={s.risk} title={riskTooltip(d.risk)} />}
          {d.deepLink && (
            <a className={s.openLink} href={d.deepLink} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title="Open in Fabric">
              <Open16Regular />
            </a>
          )}
        </div>
        <div className={s.subtitle}>{d.type ?? 'Asset'}{d.isProcess ? ' · Process' : ''} · {d.external ? 'External source' : d.wsName}</div>
        {d.rows.length > 0 && (
          <>
            <div className={s.divider} />
            {open && (
              <div className={s.rows}>
                {d.rows.map((r) => (
                  <div key={r.label} className={s.row}>
                    <span className={s.rowLabel}>{r.label}</span>
                    <span className={s.rowValue} title={r.value}>{r.value}</span>
                  </div>
                ))}
              </div>
            )}
            <button type="button" className={s.toggle} onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>
              {open ? <ChevronDown16Regular /> : <ChevronRight16Regular />}
              {open ? 'Hide details' : `Show details (${d.rows.length})`}
            </button>
          </>
        )}
        <div className={s.footer}>
          <span className={s.footerTag}>{d.source ?? 'fabric'}</span>
          <button type="button" className={s.footerIcon} title="Copy canonical id" onClick={onCopy}>
            {copied ? <Checkmark16Filled /> : <Copy16Regular />}
          </button>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className={s.handle} isConnectable={false} />
    </div>
  );
}

const nodeTypes = { pill: PillNode, card: CardNode, hub: HubNode };

/* ------------------------------------------------------- node: workspace hub */
interface HubData { name: string; color: string; count: number; risk: number; riskNames: string[]; onRiskClick?: () => void; state: NodeState; external?: boolean; [k: string]: unknown }

const useHubStyles = makeStyles({
  wrap: { position: 'relative' },
  hub: {
    width: `${HUB_W}px`, height: `${HUB_H}px`, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '6px',
    padding: '12px 16px', backgroundColor: tokens.colorNeutralBackground1, borderRadius: '12px', border: `1px solid ${tokens.colorNeutralStroke2}`,
    boxShadow: tokens.shadow4, cursor: 'pointer', overflow: 'hidden', transition: 'opacity 140ms, box-shadow 140ms, border-color 140ms',
  },
  external: { border: `1px dashed ${tokens.colorNeutralStroke2}`, backgroundColor: tokens.colorNeutralBackground2 },
  top: { display: 'flex', alignItems: 'center', gap: '8px' },
  icon: { width: '16px', height: '16px', flexShrink: 0 },
  name: { fontSize: tokens.fontSizeBase300, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 },
  meta: { fontSize: '11px', color: tokens.colorNeutralForeground3, display: 'flex', alignItems: 'center', gap: '8px' },
  risk: {
    color: '#ca5010', display: 'flex', alignItems: 'center', gap: '3px', fontWeight: 600,
    border: 'none', background: 'none', padding: 0, font: 'inherit', cursor: 'pointer', flexShrink: 0,
    ':hover': { textDecoration: 'underline' },
  },
  dim: { opacity: 0.42 },
  lit: { border: `1px solid ${BRAND}`, boxShadow: `0 0 0 1px ${BRAND}55, ${tokens.shadow8}` },
  handle: { opacity: 0, width: '1px', height: '1px', minWidth: 0, minHeight: 0, border: 'none' },
});

function HubNode({ data }: NodeProps) {
  const s = useHubStyles();
  const d = data as HubData;
  const cls = [s.hub, d.external ? s.external : '', d.state === 'dim' ? s.dim : '', d.state === 'lit' ? s.lit : ''].filter(Boolean).join(' ');
  return (
    <div className={s.wrap}>
      <Handle type="target" position={Position.Left} className={s.handle} isConnectable={false} />
      <div className={cls} title={d.name}>
        <div className={s.top}>
          {d.external ? <Globe16Regular style={{ color: tokens.colorNeutralForeground3, flexShrink: 0 }} /> : <img className={s.icon} src={workspaceIconUrl} alt="" />}
          <span className={s.name}>{d.name}</span>
        </div>
        <div className={s.meta}>
          <span>{d.count} asset{d.count === 1 ? '' : 's'}</span>
          {d.risk > 0 && (
            <button
              type="button" className={s.risk}
              title={`${d.riskNames.join(', ')}${d.risk > d.riskNames.length ? `, +${d.risk - d.riskNames.length} more` : ''} — click to review`}
              onClick={(e) => { e.stopPropagation(); d.onRiskClick?.(); }}
            >
              <Warning12Filled /> {d.risk} flagged
            </button>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className={s.handle} isConnectable={false} />
    </div>
  );
}

/* ------------------------------------------------------------------ styles */
const useStyles = makeStyles({
  page: { height: '100%', display: 'flex', overflow: 'hidden' },
  root: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', backgroundColor: tokens.colorNeutralBackground2 },
  toolbar: { padding: '16px 24px', backgroundColor: tokens.colorNeutralBackground1, borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' },
  titleWrap: { minWidth: 0 },
  title: { fontWeight: 700, fontSize: tokens.fontSizeBase500, lineHeight: 1.2 },
  subtitle: { fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3, marginTop: '2px' },
  spacer: { flex: 1 },
  toolbarActions: { display: 'flex', alignItems: 'center', gap: '8px' },
  matchNote: { fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 },
  flow: { flex: 1, position: 'relative', minHeight: 0 },
  center: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '10px', color: tokens.colorNeutralForeground3 },
  sidebar: { width: '272px', flexShrink: 0, display: 'flex', flexDirection: 'column', backgroundColor: tokens.colorNeutralBackground1, borderRight: `1px solid ${tokens.colorNeutralStroke2}`, overflow: 'hidden' },
  sidebarHeader: { padding: '14px 14px 4px', display: 'flex', alignItems: 'center', minHeight: '20px' },
  sidebarHeaderTitle: { fontWeight: 600, fontSize: tokens.fontSizeBase300 },
  sidebarBack: { display: 'flex', alignItems: 'center', gap: '2px', border: 'none', background: 'none', cursor: 'pointer', fontWeight: 600, fontSize: tokens.fontSizeBase300, color: tokens.colorNeutralForeground1, padding: '2px', borderRadius: tokens.borderRadiusMedium, ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover } },
  sidebarSearch: { margin: '10px 14px' },
  sidebarSectionLabel: { padding: '8px 14px 4px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: tokens.colorNeutralForeground4 },
  sidebarList: { flex: 1, overflowY: 'auto', padding: '0 8px 12px' },
  sidebarRow: { display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '7px 8px', border: 'none', background: 'none', textAlign: 'left', cursor: 'pointer', borderRadius: tokens.borderRadiusMedium, color: 'inherit', fontSize: tokens.fontSizeBase200, ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover } },
  sidebarRowActive: { backgroundColor: tokens.colorBrandBackground2 },
  sidebarIcon: { width: '18px', height: '18px', flexShrink: 0 },
  sidebarRowName: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 },
  sidebarRowMeta: { fontSize: '10.5px', color: tokens.colorNeutralForeground3, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '84px' },
  sidebarRowCount: { fontSize: '11px', color: tokens.colorNeutralForeground3, flexShrink: 0 },
  sidebarEmpty: { padding: '8px 14px', fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground4 },
});

/* --------------------------------------------------------------- data page */
export function LineageExplorerPage() {
  const styles = useStyles();
  const [searchParams] = useSearchParams();
  const initialWsScope = searchParams.get('workspace');
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [edges, setEdges] = useState<LineageEdge[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true); setError(null);
      try {
        const [i, e, w] = await Promise.all([getItems(), getLineageEdges(), getWorkspaces()]);
        setItems(i); setEdges(e); setWorkspaces(w);
      } catch (err) { setError(err instanceof Error ? err.message : 'Failed to load lineage.'); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className={styles.root}><div className={styles.center}><Spinner size="tiny" label="Building lineage…" /></div></div>;
  if (error) return <div className={styles.root}><div className={styles.center}><MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar></div></div>;
  return <LineageGraph items={items} edges={edges} workspaces={workspaces} initialWsScope={initialWsScope ?? undefined} />;
}

/* ------------------------------------------------------ presentational graph */
export function LineageGraph({ items, edges, workspaces, initialWsScope }: { items: CatalogItem[]; edges: LineageEdge[]; workspaces: WorkspaceRef[]; initialWsScope?: string }) {
  const styles = useStyles();
  const model = useMemo(() => buildModel(items, edges), [items, edges]);
  const itemByCid = useMemo(() => new Map(items.map((i) => [i.canonicalId, i])), [items]);
  const wsMeta = useMemo(() => buildWsMeta(items, workspaces, model), [items, workspaces, model]);
  const wsById = useMemo(() => new Map(wsMeta.map((w) => [w.id, w])), [wsMeta]);
  const colorByWs = useMemo(() => new Map<string, string>([...wsMeta.map((w) => [w.id, w.color] as const), [EXTERNAL, '#8a8886']]), [wsMeta]);
  const nameByWs = useMemo(() => new Map<string, string>([...wsMeta.map((w) => [w.id, w.name] as const), [EXTERNAL, 'External source']]), [wsMeta]);

  const typeOptions = useMemo(() => [...new Set([...model.nodeById.values()].map((n) => n.type).filter(Boolean) as string[])].sort().map((t) => ({ value: t, label: t })), [model]);
  const relOptions = useMemo(() => [...new Set(model.links.map((l) => l.rel).filter(Boolean) as string[])].sort().map((r) => ({ value: r, label: r })), [model]);

  // Sensitivity-propagation risk: for every downstream asset reachable from a
  // labeled source, flag it if it's missing a label entirely OR carries a
  // DIFFERENT label than that upstream source — either is a classification
  // gap or a silent, unreviewed change in sensitivity as data flows. A
  // governance leak generic lineage tools don't surface. Keeps the SPECIFIC
  // reason (which upstream source, which labels) per item, not just a
  // boolean, so every warning can explain itself instead of being a bare icon.
  const sensitivityRisk = useMemo(() => {
    const risk = new Map<string, RiskInfo>();
    for (const n of model.nodeById.values()) {
      if (!n.labeled || !n.sensitivityLabel) continue;
      for (const c of walk(n.cid, model.adjDown)) {
        const cn = model.nodeById.get(c);
        if (!cn || cn.isProcess) continue;
        if (!cn.labeled) {
          if (!risk.has(c)) risk.set(c, { kind: 'missing', sourceName: n.name, sourceLabel: n.sensitivityLabel });
        } else if (cn.sensitivityLabel !== n.sensitivityLabel) {
          // an explicit mismatch is more specific/actionable than a "missing
          // label" finding reached from a different source, so it always wins
          risk.set(c, { kind: 'mismatch', sourceName: n.name, sourceLabel: n.sensitivityLabel, ownLabel: cn.sensitivityLabel });
        }
      }
    }
    return risk;
  }, [model]);

  const [selected, setSelected] = useState<string | null>(null);
  const [wsScope, setWsScope] = useState<string | null>(initialWsScope ?? null);
  const [search, setSearch] = useState('');
  const [fType, setFType] = useState<Set<string>>(new Set());
  const [fRel, setFRel] = useState<Set<string>>(new Set());
  const [fGov, setFGov] = useState<Set<string>>(new Set());
  const [riskOnly, setRiskOnly] = useState(false);

  const relActive = fRel.size > 0;
  const nodeFacetActive = Boolean(search.trim()) || fType.size > 0 || fGov.size > 0 || riskOnly;
  const filtersActive = nodeFacetActive || relActive;

  const relOk = useCallback((l: GLink) => !relActive || (l.rel != null && fRel.has(l.rel)), [relActive, fRel]);
  const otherOk = useCallback((n: GItem) => {
    const q = search.trim().toLowerCase();
    if (q && !(n.name.toLowerCase().includes(q) || (n.type ?? '').toLowerCase().includes(q))) return false;
    if (fType.size && !(n.type && fType.has(n.type))) return false;
    if (fGov.size) {
      if (fGov.has('owned') && !n.owned) return false;
      if (fGov.has('described') && !n.described) return false;
      if (fGov.has('labeled') && !n.labeled) return false;
      if (fGov.has('certified') && !n.certified) return false;
      if (fGov.has('gap') && !(!n.owned || !n.described || !n.labeled)) return false;
    }
    if (riskOnly && !sensitivityRisk.has(n.cid)) return false;
    return true;
  }, [search, fType, fGov, riskOnly, sensitivityRisk]);

  // focus set: a node selection traces its full upstream/downstream path;
  // otherwise active filters drive it.
  const focus = useMemo<Set<string> | null>(() => {
    if (selected) {
      const out = new Set<string>([selected]);
      for (const u of walk(selected, model.adjUp)) out.add(u);
      for (const d of walk(selected, model.adjDown)) out.add(d);
      return out;
    }
    if (!filtersActive) return null;
    const base = new Set<string>();
    for (const n of model.nodeById.values()) if (otherOk(n)) base.add(n.cid);
    if (!relActive) return base;
    const relSet = new Set<string>();
    for (const l of model.links) if (relOk(l) && base.has(l.from) && base.has(l.to)) { relSet.add(l.from); relSet.add(l.to); }
    return relSet;
  }, [selected, filtersActive, relActive, model, otherOk, relOk]);

  // the selected asset and its direct (1-hop) neighbours render as rich detail
  // cards; everything else in the focus set stays a compact, lit-up pill.
  const cardIds = useMemo(() => {
    if (!selected) return new Set<string>();
    const s = new Set<string>([selected]);
    for (const nb of model.adjUp.get(selected) ?? []) s.add(nb);
    for (const nb of model.adjDown.get(selected) ?? []) s.add(nb);
    return s;
  }, [selected, model]);

  const impact = useMemo(() => {
    if (!selected) return null;
    const down = walk(selected, model.adjDown), up = walk(selected, model.adjUp);
    const downWs = new Set<string>(); for (const c of down) { const n = model.nodeById.get(c); if (n) downWs.add(n.wsId); }
    let upRoots = 0; for (const c of up) { const upstreamOf = model.adjUp.get(c); if (!upstreamOf || upstreamOf.length === 0) upRoots++; }
    return { down: down.size, downWs: downWs.size, up: up.size, upRoots };
  }, [selected, model]);

  const rowsByCid = useMemo(() => {
    const m = new Map<string, CardRow[]>();
    for (const cid of cardIds) {
      const item = itemByCid.get(cid);
      const rows: CardRow[] = [];
      if (cid === selected && impact) {
        rows.push({ label: 'Downstream', value: `${impact.down} asset${impact.down === 1 ? '' : 's'} · ${impact.downWs} workspace${impact.downWs === 1 ? '' : 's'}` });
        rows.push({ label: 'Upstream', value: `${impact.up} asset${impact.up === 1 ? '' : 's'} · ${impact.upRoots} source${impact.upRoots === 1 ? '' : 's'}` });
      }
      const risk = sensitivityRisk.get(cid);
      if (risk) rows.push({ label: 'Sensitivity risk', value: riskTooltip(risk) });
      if (item?.tableCount != null) rows.push({ label: 'Tables', value: String(item.tableCount) });
      if (item?.columnCount != null) rows.push({ label: 'Columns', value: String(item.columnCount) });
      if (item?.owner) rows.push({ label: 'Owner', value: item.owner });
      if (item?.sensitivityLabel) rows.push({ label: 'Sensitivity', value: item.sensitivityLabel });
      if (item?.endorsement && item.endorsement !== 'None') rows.push({ label: 'Endorsement', value: item.endorsement });
      if (item?.modifiedDate) rows.push({ label: 'Last modified', value: relTime(item.modifiedDate) });
      if (item?.refreshStatus) rows.push({ label: 'Last refresh', value: item.refreshStatus });
      if (rows.length === 0) rows.push({ label: 'Source', value: item?.source ?? 'fabric' });
      m.set(cid, rows.slice(0, 6));
    }
    return m;
  }, [cardIds, itemByCid, selected, impact, sensitivityRisk]);

  // Workspace scope: picking a workspace (from the sidebar) is the FIRST
  // lineage entry point — it hides every asset that isn't reachable from that
  // workspace (rather than just dimming), and highlights the workspace's own
  // items as the "home" set the rest visibly spans out from.
  const scope = useMemo(() => {
    if (!wsScope) return null;
    const home = new Set<string>();
    for (const n of model.nodeById.values()) if (n.wsId === wsScope) home.add(n.cid);
    const reach = new Set(home);
    for (const cid of home) { for (const u of walk(cid, model.adjUp)) reach.add(u); for (const d of walk(cid, model.adjDown)) reach.add(d); }
    return { home, reach };
  }, [wsScope, model]);

  const sizeOf = useCallback(
    (cid: string) => (cardIds.has(cid) ? { w: CARD_W, h: cardHeight(rowsByCid.get(cid)?.length ?? 0) } : { w: PILL_W, h: PILL_H }),
    [cardIds, rowsByCid],
  );
  // Every distinct workspace touched by the current scope (the home
  // workspace itself, plus any OTHER workspace reached via a cross-workspace
  // lineage edge) — one hub node gets rendered per id so the workspace level
  // of the chain stays visible inside the item-level view, not just at the
  // tenant-wide map.
  const scopeWsIds = useMemo(() => {
    if (!scope) return [];
    const s = new Set<string>();
    for (const cid of scope.reach) { const n = model.nodeById.get(cid); if (n) s.add(n.wsId); }
    return [...s];
  }, [scope, model]);
  // Item-level layout is only needed once a workspace is scoped (it's the
  // expensive one, up to the whole tenant) — the default view is the cheap
  // workspace map instead, so skip this entirely until it's actually shown.
  const layout = useMemo(() => (wsScope ? layoutFlat(model, sizeOf, scope?.reach ?? null, scopeWsIds) : new Map<string, Placed>()), [wsScope, model, sizeOf, scope, scopeWsIds]);

  // Workspace map: the default landing view. One node per workspace (+ one
  // for external sources, if any) instead of every item — stays readable at
  // any tenant size — connected by aggregated cross-workspace edges labeled
  // with their relationship type and count (e.g. "3 Shortcut"), so a shortcut
  // from one workspace into another is the FIRST thing you see, not buried.
  const wsEdges = useMemo(() => buildWsEdges(model), [model]);
  const riskByWs = useMemo(() => {
    const m = new Map<string, { count: number; names: string[] }>();
    for (const cid of sensitivityRisk.keys()) {
      const n = model.nodeById.get(cid); if (!n) continue;
      const e = m.get(n.wsId) ?? { count: 0, names: [] };
      e.count += 1;
      if (e.names.length < 5) e.names.push(n.name);
      m.set(n.wsId, e);
    }
    return m;
  }, [sensitivityRisk, model]);
  const mapIds = useMemo(() => {
    const ids = wsMeta.map((w) => w.id);
    return [...model.nodeById.values()].some((n) => n.wsId === EXTERNAL) ? [...ids, EXTERNAL] : ids;
  }, [wsMeta, model]);
  const mapLayout = useMemo(() => (wsScope ? new Map<string, Placed>() : layoutWorkspaceMap(mapIds, wsEdges)), [wsScope, mapIds, wsEdges]);
  // which workspaces contain a filter/search match, for map-mode lit/dim (map
  // mode never has its own "selected", so this only reflects active filters).
  const focusWs = useMemo(() => {
    if (!focus || wsScope) return null;
    const s = new Set<string>();
    for (const cid of focus) { const n = model.nodeById.get(cid); if (n) s.add(n.wsId); }
    return s;
  }, [focus, wsScope, model]);

  // selecting an asset always anchors its own workspace as the active scope —
  // workspace is always "the first lineage point" for whatever you're viewing.
  const selectAsset = useCallback((cid: string | null) => {
    setSelected(cid);
    setSearch('');
    if (cid) { const n = model.nodeById.get(cid); if (n) setWsScope(n.wsId); }
  }, [model]);
  const selectWorkspace = useCallback((id: string) => { setWsScope(id); setSelected(null); setSearch(''); }, []);
  // same as selectWorkspace, but also switches on the sensitivity-risk filter —
  // this is what a workspace hub's risk badge triggers, so clicking it jumps
  // straight to "this workspace, only the flagged items lit up" in one step.
  const selectWorkspaceRisk = useCallback((id: string) => { setWsScope(id); setSelected(null); setSearch(''); setRiskOnly(true); }, []);
  const backToWorkspaces = useCallback(() => { setWsScope(null); setSelected(null); setSearch(''); }, []);

  const clearAll = useCallback(() => { setSelected(null); setWsScope(null); setSearch(''); setFType(new Set()); setFRel(new Set()); setFGov(new Set()); setRiskOnly(false); }, []);
  const matchCount = focus && !selected ? focus.size : null;
  const selNode = selected ? model.nodeById.get(selected) : undefined;
  const scopeName = wsScope ? (wsScope === EXTERNAL ? 'External sources' : (wsById.get(wsScope)?.name ?? wsScope)) : null;
  const activeFilterCount = fType.size + fRel.size + fGov.size + (riskOnly ? 1 : 0);

  // sidebar data: workspace list (searchable) at the top level; once inside a
  // workspace, its own assets (also searchable). A tenant-wide asset search is
  // offered at the top level too, so a known asset name always finds its home
  // workspace directly without browsing.
  const q = search.trim().toLowerCase();
  const searchActive = q.length > 0;
  const wsList = useMemo(() => (searchActive ? wsMeta.filter((w) => w.name.toLowerCase().includes(q)) : wsMeta), [wsMeta, q, searchActive]);
  const searchedAssets = useMemo(() => {
    if (!searchActive || wsScope) return [];
    return [...model.nodeById.values()].filter((n) => n.name.toLowerCase().includes(q) || (n.type ?? '').toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 40);
  }, [model, q, searchActive, wsScope]);
  const scopedAssets = useMemo(() => {
    if (!wsScope) return [];
    const list = [...model.nodeById.values()].filter((n) => n.wsId === wsScope);
    const filtered = searchActive ? list.filter((n) => n.name.toLowerCase().includes(q) || (n.type ?? '').toLowerCase().includes(q)) : list;
    return filtered.sort((a, b) => a.name.localeCompare(b.name));
  }, [wsScope, model, q, searchActive]);

  return (
    <div className={styles.page}>
      <Sidebar
        styles={styles} wsScope={wsScope} scopeName={scopeName} wsList={wsList} searchedAssets={searchedAssets} scopedAssets={scopedAssets}
        search={search} onSearch={setSearch} selected={selected} colorByWs={colorByWs}
        onSelectWorkspace={selectWorkspace} onSelectAsset={selectAsset} onBack={backToWorkspaces}
      />
      <div className={styles.root}>
        <div className={styles.toolbar}>
          <div className={styles.titleWrap}>
            <div className={styles.title}>Lineage</div>
            <div className={styles.subtitle}>
              {selNode
                ? <>Exploring lineage upstream and downstream of <strong>{selNode.name}</strong>.</>
                : scopeName
                  ? <>Showing <strong>{scopeName}</strong> and everything connected to it.</>
                  : 'Pick a workspace or search for an asset to explore its lineage.'}
            </div>
          </div>
          <div className={styles.spacer} />
          <div className={styles.toolbarActions}>
            {matchCount != null && <span className={styles.matchNote}>{matchCount} match{matchCount === 1 ? '' : 'es'}</span>}
            <FiltersPopover
              typeOptions={typeOptions} relOptions={relOptions}
              fType={fType} fRel={fRel} fGov={fGov} riskOnly={riskOnly} riskCount={sensitivityRisk.size}
              onType={(s) => setFType(s)} onRel={(s) => setFRel(s)} onGov={(s) => setFGov(s)} onRiskOnly={setRiskOnly}
              active={activeFilterCount}
            />
            {(filtersActive || selected || wsScope) && <Button size="small" appearance="subtle" icon={<ArrowClockwise16Regular />} onClick={clearAll}>Reset</Button>}
          </div>
        </div>

        {model.nodeById.size === 0 ? (
          <div className={styles.center}><Flow24Regular /><Text>No lineage relationships captured yet.</Text></div>
        ) : (
          <div className={styles.flow}>
            <ReactFlowProvider>
              {wsScope ? (
                <ItemCanvas model={model} layout={layout} colorByWs={colorByWs} nameByWs={nameByWs} rowsByCid={rowsByCid}
                  cardIds={cardIds} focus={focus} selected={selected} onSelect={selectAsset} sensitivityRisk={sensitivityRisk}
                  scope={scope} hubIds={scopeWsIds} wsScope={wsScope} wsById={wsById} riskByWs={riskByWs} onSelectWorkspace={selectWorkspace}
                  onSelectWorkspaceRisk={selectWorkspaceRisk} />
              ) : (
                <MapCanvas wsMeta={wsMeta} wsEdges={wsEdges} layout={mapLayout} riskByWs={riskByWs} focusWs={focusWs}
                  onSelectWorkspace={selectWorkspace} onSelectWorkspaceRisk={selectWorkspaceRisk} />
              )}
            </ReactFlowProvider>
          </div>
        )}
      </div>
    </div>
  );
}

function Sidebar({ styles, wsScope, scopeName, wsList, searchedAssets, scopedAssets, search, onSearch, selected, colorByWs, onSelectWorkspace, onSelectAsset, onBack }: {
  styles: ReturnType<typeof useStyles>; wsScope: string | null; scopeName: string | null; wsList: WsMeta[]; searchedAssets: GItem[]; scopedAssets: GItem[];
  search: string; onSearch: (s: string) => void; selected: string | null; colorByWs: Map<string, string>;
  onSelectWorkspace: (id: string) => void; onSelectAsset: (cid: string) => void; onBack: () => void;
}) {
  return (
    <div className={styles.sidebar}>
      <div className={styles.sidebarHeader}>
        {wsScope ? (
          <button type="button" className={styles.sidebarBack} onClick={onBack} title="Back to all workspaces">
            <ChevronLeft16Regular /> {scopeName}
          </button>
        ) : (
          <span className={styles.sidebarHeaderTitle}>Workspaces</span>
        )}
      </div>
      <Input size="small" className={styles.sidebarSearch} placeholder={wsScope ? `Search ${scopeName}…` : 'Search workspaces or assets…'}
        value={search} contentBefore={<Search20Regular />} onChange={(_, v) => onSearch(v.value)}
        contentAfter={search ? <Dismiss16Regular style={{ cursor: 'pointer' }} onClick={() => onSearch('')} /> : undefined} />
      <div className={styles.sidebarList}>
        {!wsScope && (
          <>
            {wsList.map((w) => (
              <button key={w.id} type="button" className={styles.sidebarRow} onClick={() => onSelectWorkspace(w.id)}>
                <img className={styles.sidebarIcon} src={workspaceIconUrl} alt="" />
                <span className={styles.sidebarRowName}>{w.name}</span>
                <span className={styles.sidebarRowCount}>{w.count}</span>
              </button>
            ))}
            {wsList.length === 0 && <div className={styles.sidebarEmpty}>No workspaces match.</div>}
            {searchedAssets.length > 0 && (
              <>
                <div className={styles.sidebarSectionLabel}>Assets</div>
                {searchedAssets.map((n) => (
                  <button key={n.cid} type="button" className={[styles.sidebarRow, selected === n.cid ? styles.sidebarRowActive : ''].join(' ')} onClick={() => onSelectAsset(n.cid)}>
                    <img className={styles.sidebarIcon} src={itemIconUrl(n.type ?? 'Unknown')} alt="" />
                    <span className={styles.sidebarRowName}>{n.name}</span>
                    <span className={styles.sidebarRowMeta}>{colorByWs.has(n.wsId) ? n.type : 'External'}</span>
                  </button>
                ))}
              </>
            )}
          </>
        )}
        {wsScope && (
          <>
            {scopedAssets.map((n) => (
              <button key={n.cid} type="button" className={[styles.sidebarRow, selected === n.cid ? styles.sidebarRowActive : ''].join(' ')} onClick={() => onSelectAsset(n.cid)}>
                <img className={styles.sidebarIcon} src={itemIconUrl(n.type ?? 'Unknown')} alt="" />
                <span className={styles.sidebarRowName}>{n.name}</span>
              </button>
            ))}
            {scopedAssets.length === 0 && <div className={styles.sidebarEmpty}>No assets match.</div>}
          </>
        )}
      </div>
    </div>
  );
}

function FiltersPopover({ typeOptions, relOptions, fType, fRel, fGov, riskOnly, riskCount, onType, onRel, onGov, onRiskOnly, active }: {
  typeOptions: { value: string; label: string }[]; relOptions: { value: string; label: string }[];
  fType: Set<string>; fRel: Set<string>; fGov: Set<string>; riskOnly: boolean; riskCount: number;
  onType: (s: Set<string>) => void; onRel: (s: Set<string>) => void; onGov: (s: Set<string>) => void; onRiskOnly: (v: boolean) => void;
  active: number;
}) {
  return (
    <Menu
      checkedValues={{ type: [...fType], relationship: [...fRel], governance: [...fGov], risk: riskOnly ? ['on'] : [] }}
      onCheckedValueChange={(_, data) => {
        const set = new Set(data.checkedItems);
        if (data.name === 'type') onType(set);
        else if (data.name === 'relationship') onRel(set);
        else if (data.name === 'governance') onGov(set);
        else if (data.name === 'risk') onRiskOnly(set.has('on'));
      }}
    >
      <MenuTrigger disableButtonEnhancement>
        <MenuButton size="small" icon={<Filter16Regular />} appearance={active ? 'primary' : 'secondary'}>
          Filters{active ? ` · ${active}` : ''}
        </MenuButton>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          {typeOptions.length > 0 && (
            <MenuGroup>
              <MenuGroupHeader>Type</MenuGroupHeader>
              {typeOptions.map((o) => <MenuItemCheckbox key={o.value} name="type" value={o.value}>{o.label}</MenuItemCheckbox>)}
            </MenuGroup>
          )}
          <MenuDivider />
          {relOptions.length > 0 && (
            <MenuGroup>
              <MenuGroupHeader>Relationship</MenuGroupHeader>
              {relOptions.map((o) => <MenuItemCheckbox key={o.value} name="relationship" value={o.value}>{o.label}</MenuItemCheckbox>)}
            </MenuGroup>
          )}
          <MenuDivider />
          <MenuGroup>
            <MenuGroupHeader>Governance</MenuGroupHeader>
            {GOV_OPTIONS.map((o) => <MenuItemCheckbox key={o.value} name="governance" value={o.value}>{o.label}</MenuItemCheckbox>)}
            {riskCount > 0 && <MenuItemCheckbox name="risk" value="on">Sensitivity risks only ({riskCount})</MenuItemCheckbox>}
          </MenuGroup>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}

/* ------------------------------------------------------------------ canvas */
function ItemCanvas({ model, layout, colorByWs, nameByWs, rowsByCid, cardIds, focus, selected, onSelect, sensitivityRisk, scope, hubIds, wsScope, wsById, riskByWs, onSelectWorkspace, onSelectWorkspaceRisk }: {
  model: Model; layout: Map<string, Placed>; colorByWs: Map<string, string>; nameByWs: Map<string, string>; rowsByCid: Map<string, CardRow[]>;
  cardIds: Set<string>; focus: Set<string> | null; selected: string | null; onSelect: (id: string | null) => void; sensitivityRisk: Map<string, RiskInfo>;
  scope: { home: Set<string>; reach: Set<string> } | null; hubIds: string[]; wsScope: string; wsById: Map<string, WsMeta>; riskByWs: Map<string, { count: number; names: string[] }>;
  onSelectWorkspace: (id: string) => void; onSelectWorkspaceRisk: (id: string) => void;
}) {
  const rf = useReactFlow();

  const nodes: Node[] = useMemo(() => {
    const out: Node[] = [];
    // Workspace hubs — one per distinct workspace touched by the current
    // scope (the home workspace + any other reached via cross-workspace
    // lineage), reusing the exact same HubNode the tenant-wide map uses so
    // the visual language matches. The home workspace renders "lit" (you are
    // here); every other reached workspace renders "base" (fully visible,
    // never dimmed — a cross-workspace connection is real, relevant lineage).
    for (const wsId of hubIds) {
      const p = layout.get(wsId); if (!p) continue;
      const external = wsId === EXTERNAL;
      const state: NodeState = wsId === wsScope ? 'lit' : 'base';
      const wsRisk = riskByWs.get(wsId);
      out.push({
        id: wsId, type: 'hub', position: { x: p.x, y: p.y }, draggable: true, zIndex: 1,
        data: {
          name: nameByWs.get(wsId) ?? wsId, color: colorByWs.get(wsId) ?? '#8a8886', count: wsById.get(wsId)?.count ?? 0,
          risk: wsRisk?.count ?? 0, riskNames: wsRisk?.names ?? [], onRiskClick: () => onSelectWorkspaceRisk(wsId), state, external,
        } as HubData,
      });
    }
    for (const n of model.nodeById.values()) {
      if (scope && !scope.reach.has(n.cid)) continue; // hidden entirely — unrelated to the scoped workspace
      const p = layout.get(n.cid); if (!p) continue;
      const state: NodeState = selected === n.cid ? 'sel'
        : focus !== null ? (focus.has(n.cid) ? 'lit' : 'dim')
        : scope ? (scope.home.has(n.cid) ? 'lit' : 'base') // cross-workspace connections (incl. shortcuts) are real, relevant lineage — never dimmed just for being outside the home workspace
        : 'base';
      const wsName = nameByWs.get(n.wsId) ?? 'External source';
      const external = n.wsId === EXTERNAL;
      if (cardIds.has(n.cid)) {
        out.push({
          id: n.cid, type: 'card', position: { x: p.x, y: p.y }, draggable: true, zIndex: 3,
          data: { cid: n.cid, name: n.name, type: n.type, wsName, source: n.source, deepLink: n.deepLink, rows: rowsByCid.get(n.cid) ?? [], isProcess: n.isProcess, risk: sensitivityRisk.get(n.cid), state, external } as CardData,
        });
      } else {
        out.push({
          id: n.cid, type: 'pill', position: { x: p.x, y: p.y }, draggable: true, zIndex: 2,
          data: { name: n.name, type: n.type, wsName, state, isProcess: n.isProcess, risk: sensitivityRisk.get(n.cid), external } as PillData,
        });
      }
    }
    return out;
  }, [model, layout, colorByWs, nameByWs, rowsByCid, cardIds, focus, selected, sensitivityRisk, scope, hubIds, wsScope, wsById, riskByWs, onSelectWorkspaceRisk]);

  // Membership edges: hub -> each of its own items. Deliberately subordinate
  // to real lineage edges (thin, dashed, muted, no label, no arrowhead) so
  // they read as "belongs to" rather than "data flows to" — the actual
  // lineage edges below stay the visually dominant relationship.
  const membershipEdges: Edge[] = useMemo(() => {
    if (!hubIds.length) return [];
    const hubSet = new Set(hubIds);
    const out: Edge[] = [];
    for (const n of model.nodeById.values()) {
      if (scope && !scope.reach.has(n.cid)) continue;
      if (!hubSet.has(n.wsId)) continue;
      out.push({
        id: `m:${n.wsId}->${n.cid}`, source: n.wsId, target: n.cid, zIndex: 0, selectable: false,
        style: { stroke: tokens.colorNeutralStroke2, strokeWidth: 1, strokeDasharray: '2 3', opacity: 0.6 },
      });
    }
    return out;
  }, [model, scope, hubIds]);

  const lineageEdges: Edge[] = useMemo(() => model.links
    .filter((l) => !scope || (scope.reach.has(l.from) && scope.reach.has(l.to)))
    .map((l, i) => {
      const strong = focus !== null && focus.has(l.from) && focus.has(l.to);
      const dim = focus !== null && !strong;
      // cross-workspace edges get a small relationship-type label (e.g.
      // "Shortcut") — same-workspace edges stay unlabeled to avoid clutter,
      // since crossing a workspace boundary is exactly the "richness" a plain
      // grey line loses.
      const fromWs = model.nodeById.get(l.from)?.wsId, toWs = model.nodeById.get(l.to)?.wsId;
      const crossWs = fromWs != null && toWs != null && fromWs !== toWs;
      return {
        id: `e${i}:${l.from}->${l.to}`, source: l.from, target: l.to, animated: strong,
        label: crossWs && l.rel ? l.rel : undefined,
        labelStyle: { fontSize: 9.5, fontWeight: 600, fill: strong ? BRAND : tokens.colorNeutralForeground3 },
        labelBgStyle: { fill: tokens.colorNeutralBackground1, fillOpacity: 0.92 },
        labelBgPadding: [4, 2] as [number, number], labelBgBorderRadius: 4,
        style: { stroke: strong ? BRAND : EDGE_GREY, strokeWidth: strong ? 2 : 1.4, opacity: dim ? 0.35 : 1 },
        markerEnd: { type: MarkerType.ArrowClosed, color: strong ? BRAND : EDGE_GREY, width: 12, height: 12 },
      };
    }), [model, focus, scope]);
  const edges: Edge[] = useMemo(() => [...membershipEdges, ...lineageEdges], [membershipEdges, lineageEdges]);

  // fit: a selection zooms to fit the WHOLE traced chain (every up/downstream
  // hop, not just the 1-hop card cluster) so the full end-to-end lineage is
  // always in view, not cropped off-screen; a workspace scope with no
  // selection zooms to the reachable subgraph; otherwise the full estate.
  useEffect(() => {
    const t = setTimeout(() => {
      if (selected && focus) rf.fitView({ padding: 0.22, duration: 400, maxZoom: 1.05, nodes: [...focus].map((id) => ({ id })) });
      else if (scope) rf.fitView({ padding: 0.16, duration: 400, maxZoom: 1.2, nodes: [...scope.reach, ...hubIds].map((id) => ({ id })) });
      else rf.fitView({ padding: 0.12, duration: 400, maxZoom: 1 });
    }, 60);
    return () => clearTimeout(t);
  }, [selected, focus, cardIds, scope, hubIds, rf]);

  const onNodeClick = useCallback((_: unknown, node: Node) => {
    if (node.type === 'hub') { onSelectWorkspace(node.id); return; }
    onSelect(node.id === selected ? null : node.id);
  }, [onSelect, selected, onSelectWorkspace]);

  return (
    <ReactFlow
      nodes={nodes} edges={edges} nodeTypes={nodeTypes}
      fitView fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
      onNodeClick={onNodeClick}
      onPaneClick={() => onSelect(null)}
      minZoom={0.15} maxZoom={2} nodesConnectable={false} elementsSelectable proOptions={{ hideAttribution: true }}>
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color={tokens.colorNeutralStroke2} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

/* -------------------------------------------------------------- map canvas */
function MapCanvas({ wsMeta, wsEdges, layout, riskByWs, focusWs, onSelectWorkspace, onSelectWorkspaceRisk }: {
  wsMeta: WsMeta[]; wsEdges: WsEdgeAgg[]; layout: Map<string, Placed>; riskByWs: Map<string, { count: number; names: string[] }>;
  focusWs: Set<string> | null; onSelectWorkspace: (id: string) => void; onSelectWorkspaceRisk: (id: string) => void;
}) {
  const rf = useReactFlow();

  const nodes: Node[] = useMemo(() => {
    const out: Node[] = [];
    for (const w of wsMeta) {
      const p = layout.get(w.id); if (!p) continue;
      const state: NodeState = focusWs === null ? 'base' : focusWs.has(w.id) ? 'lit' : 'dim';
      const wsRisk = riskByWs.get(w.id);
      out.push({
        id: w.id, type: 'hub', position: { x: p.x, y: p.y }, draggable: true, zIndex: 2,
        data: { name: w.name, color: w.color, count: w.count, risk: wsRisk?.count ?? 0, riskNames: wsRisk?.names ?? [], onRiskClick: () => onSelectWorkspaceRisk(w.id), state, external: false } as HubData,
      });
    }
    const extP = layout.get(EXTERNAL);
    if (extP) {
      const state: NodeState = focusWs === null ? 'base' : focusWs.has(EXTERNAL) ? 'lit' : 'dim';
      out.push({ id: EXTERNAL, type: 'hub', position: { x: extP.x, y: extP.y }, draggable: true, zIndex: 2, data: { name: 'External sources', color: '#8a8886', count: 0, risk: 0, riskNames: [], state, external: true } as HubData });
    }
    return out;
  }, [wsMeta, layout, focusWs, riskByWs, onSelectWorkspaceRisk]);

  const edges: Edge[] = useMemo(() => wsEdges.map((e, i) => {
    const strong = focusWs !== null && focusWs.has(e.from) && focusWs.has(e.to);
    const dim = focusWs !== null && !strong;
    const label = e.rels.length === 1 ? `${e.count} ${e.rels[0]}` : `${e.count} links`;
    return {
      id: `we${i}`, source: e.from, target: e.to, animated: strong, label,
      labelStyle: { fontSize: 11, fontWeight: 600, fill: strong ? BRAND : tokens.colorNeutralForeground2 },
      labelBgStyle: { fill: tokens.colorNeutralBackground1, fillOpacity: 0.95 },
      labelBgPadding: [5, 3] as [number, number], labelBgBorderRadius: 5,
      style: { stroke: strong ? BRAND : EDGE_GREY, strokeWidth: Math.min(4, 1.5 + e.count * 0.3), opacity: dim ? 0.35 : 1 },
      markerEnd: { type: MarkerType.ArrowClosed, color: strong ? BRAND : EDGE_GREY, width: 12, height: 12 },
    };
  }), [wsEdges, focusWs]);

  useEffect(() => {
    const t = setTimeout(() => rf.fitView({ padding: 0.18, duration: 400, maxZoom: 1.2 }), 60);
    return () => clearTimeout(t);
  }, [nodes.length, rf]);

  const onNodeClick = useCallback((_: unknown, node: Node) => onSelectWorkspace(node.id), [onSelectWorkspace]);

  return (
    <ReactFlow
      nodes={nodes} edges={edges} nodeTypes={nodeTypes}
      fitView fitViewOptions={{ padding: 0.18, maxZoom: 1.2 }}
      onNodeClick={onNodeClick}
      minZoom={0.2} maxZoom={2} nodesConnectable={false} elementsSelectable proOptions={{ hideAttribution: true }}>
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color={tokens.colorNeutralStroke2} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
