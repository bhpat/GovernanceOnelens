import { useCallback, useEffect, useMemo, useState, Fragment, type ReactNode, type SVGProps, type Dispatch, type SetStateAction } from 'react';
import {
  makeStyles,
  mergeClasses,
  tokens,
  Text,
  Badge,
  Button,
  Spinner,
  SearchBox,
  Dropdown,
  Option,
  TabList,
  Tab,
  MessageBar,
  MessageBarBody,
  Divider,
  Table,
  TableHeader,
  TableRow,
  TableHeaderCell,
  TableBody,
  TableCell,
  TableCellLayout,
  Avatar,
  Tooltip,
  Checkbox,
  ToggleButton,
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuItemCheckbox,
  MenuItemRadio,
  MenuButton,
} from '@fluentui/react-components';
import {
  Open16Regular,
  Warning16Filled,
  ArrowUp16Regular,
  ArrowDown16Regular,
  ArrowRight16Regular,
  TargetArrow20Regular,
  Flow16Regular,
  Star16Regular,
  Star16Filled,
  Star20Regular,
  Star20Filled,
  Dismiss12Regular,
  ChevronLeft16Regular,
  ChevronRight16Regular,
  Checkmark12Filled,
  Checkmark16Filled,
  ChevronDown16Regular,
  Group20Regular,
  Options16Regular,
  ArrowDownload16Regular,
  Copy16Regular,
  Search20Regular,
  Grid24Regular,
} from '@fluentui/react-icons';
import { useSearchParams, useNavigate } from 'react-router-dom';

import {
  getItems,
  getWorkspaces,
  getDomains,
  parseTags,
  ITEM_GAP_FILTERS,
  daysSince,
  isStale,
  type CatalogItem,
  type WorkspaceRef,
  type DomainRef,
} from '@/services/catalog';
import {
  getLineageEdges,
  neighborsOf,
  downstreamImpact,
  type LineageEdge,
  type LineageNode,
} from '@/services/lineage';
import { getAssetRoleAssignments, type AssetRoleAssignment } from '@/services/roleAssignments';
import { itemIconUrl } from '@/lib/itemIcons';
import { CommandCenterHome } from '@/components/CommandCenterHome';
import { PageHeader } from '@/components/PageHeader';
import { PageLoadingSkeleton } from '@/components/Skeletons';
import { useAppToast } from '@/hooks/useAppToast';
import { useCatalogPrefs } from '@/hooks/useCatalogPrefs';
import { LINEAGE_ELIGIBLE_TYPES } from '@/lib/observabilityAnalysis';
import { govPillars } from '@/lib/health';
import { paginate } from '@/lib/pagination';
import {
  FilterGlyph,
  EndorsementGlyph,
  SensitivityGlyph,
  OwnerGlyph,
  DocumentationGlyph,
  DomainGlyph,
} from '@/components/icons/FacetIcons';

/** Governance facet dimensions (computed client-side over the loaded catalog). */
const FACETS = [
  { key: 'endorsement' as const, label: 'Endorsement', Glyph: EndorsementGlyph },
  { key: 'sensitivity' as const, label: 'Sensitivity', Glyph: SensitivityGlyph },
  { key: 'owner' as const, label: 'Owner', Glyph: OwnerGlyph },
  { key: 'documented' as const, label: 'Documentation', Glyph: DocumentationGlyph },
  { key: 'domain' as const, label: 'Domain', Glyph: DomainGlyph },
];
type FacetKey = (typeof FACETS)[number]['key'];
const EMPTY_FACETS: Record<FacetKey, string[]> = { endorsement: [], sensitivity: [], owner: [], documented: [], domain: [] };

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', height: '100%' },
  header: { padding: '20px 32px 0', backgroundColor: tokens.colorNeutralBackground1, borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
  headerTop: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '16px', marginBottom: '16px' },
  toolbar: { display: 'flex', gap: '8px' },
  banner: { marginBottom: '12px' },
  body: { display: 'flex', flex: 1, minHeight: 0 },
  listPane: { width: '46%', minWidth: '380px', overflowY: 'auto', borderRight: `1px solid ${tokens.colorNeutralStroke2}` },
  row: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    width: '100%',
    padding: '12px 24px',
    border: 'none',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    background: 'none',
    textAlign: 'left',
    cursor: 'pointer',
    ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  rowActive: { backgroundColor: tokens.colorBrandBackground2, ':hover': { backgroundColor: tokens.colorBrandBackground2 } },
  rowTop: { display: 'flex', alignItems: 'center', gap: '8px' },
  rowIcon: { width: '18px', height: '18px', flexShrink: 0 },
  rowName: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: tokens.fontWeightSemibold },
  rowMeta: { display: 'flex', alignItems: 'center', gap: '8px', color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  wsChip: { display: 'inline-flex', alignItems: 'center', gap: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  profilePane: { flex: 1, overflowY: 'auto', backgroundColor: tokens.colorNeutralBackground2 },
  profileInner: { maxWidth: '760px', margin: '0 auto', padding: '28px 32px' },
  profileHead: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', marginBottom: '20px' },
  profileTitleWrap: { display: 'flex', gap: '12px', minWidth: 0, alignItems: 'flex-start' },
  profileIcon: { width: '32px', height: '32px', flexShrink: 0, marginTop: '2px' },
  badges: { display: 'flex', gap: '6px', marginBottom: '6px', flexWrap: 'wrap' },
  gapBar: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', padding: '10px 12px', marginBottom: '20px', borderRadius: tokens.borderRadiusMedium, backgroundColor: tokens.colorStatusWarningBackground1, color: tokens.colorStatusWarningForeground1 },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium, overflow: 'hidden' },
  cell: { padding: '12px 16px', borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, backgroundColor: tokens.colorNeutralBackground1 },
  cellLabel: { fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: tokens.colorNeutralForeground3 },
  cellValue: { marginTop: '2px', display: 'flex', alignItems: 'center', gap: '8px' },
  ellipsis: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  linkBtn: { border: 'none', background: 'none', color: tokens.colorBrandForeground1, cursor: 'pointer', fontSize: tokens.fontSizeBase200, fontWeight: 600, padding: 0, ':hover': { textDecoration: 'underline' } },
  section: { marginTop: '20px' },
  sectionLabel: { fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: tokens.colorNeutralForeground3, marginBottom: '6px' },
  impactBar: { display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', marginBottom: '20px', borderRadius: tokens.borderRadiusMedium, backgroundColor: tokens.colorNeutralBackground1, border: `1px solid ${tokens.colorNeutralStroke2}` },
  impactCount: { fontSize: tokens.fontSizeBase600, fontWeight: tokens.fontWeightBold, color: tokens.colorBrandForeground1, lineHeight: 1 },
  lineageCol: { marginTop: '18px' },
  accessSummary: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', color: tokens.colorNeutralForeground3 },
  accessList: { borderTop: `1px solid ${tokens.colorNeutralStroke2}` },
  accessRow: { display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 4px', borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
  accessIdentity: { display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 },
  accessName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: tokens.fontWeightSemibold },
  accessMeta: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  accessBadges: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px', flexWrap: 'wrap' },
  edgeRow: {
    display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
    padding: '10px 12px', border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium, marginBottom: '8px', background: tokens.colorNeutralBackground1,
    textAlign: 'left',
  },
  edgeRowClickable: { cursor: 'pointer', ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover, border: `1px solid ${tokens.colorBrandStroke1}` } },
  edgeMain: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' },
  edgeName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: tokens.fontWeightSemibold, fontSize: tokens.fontSizeBase300 },
  edgeMeta: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  empty: { height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '8px', color: tokens.colorNeutralForeground3 },
  placeholder: { border: `1px dashed ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium, padding: '40px', textAlign: 'center', color: tokens.colorNeutralForeground3 },
  center: { padding: '40px', textAlign: 'center', color: tokens.colorNeutralForeground3 },
  starBtn: { border: 'none', background: 'none', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center', color: tokens.colorNeutralForeground4, flexShrink: 0, ':hover': { color: '#E3A600' } },
  starOn: { color: '#E3A600' },
  profileStar: { border: 'none', background: 'none', cursor: 'pointer', padding: '6px', display: 'flex', color: tokens.colorNeutralForeground3, ':hover': { color: '#E3A600' } },
  // Catalog Home (landing)
  homeRoot: { maxWidth: '1200px', margin: '0 auto', padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: '28px' },
  homeSection: { display: 'flex', flexDirection: 'column', gap: '12px' },
  homeHead: { display: 'flex', alignItems: 'center', gap: '8px' },
  homeTitle: { fontSize: tokens.fontSizeBase400, fontWeight: tokens.fontWeightSemibold },
  homeHint: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  heroCard: { padding: '20px 24px', display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap', border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusXLarge, backgroundColor: tokens.colorNeutralBackground1 },
  heroLeft: { display: 'flex', alignItems: 'center', gap: '14px', border: 'none', background: 'none', padding: '4px 8px', margin: '-4px -8px', cursor: 'pointer', textAlign: 'left', borderRadius: tokens.borderRadiusMedium, ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover } },
  heroScoreLabel: { fontWeight: tokens.fontWeightSemibold, fontSize: tokens.fontSizeBase400 },
  heroScoreSub: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  heroKpis: { display: 'flex', gap: '28px', flexWrap: 'wrap', flex: 1, justifyContent: 'space-around' },
  heroKpi: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '92px' },
  heroKpiClickable: { border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', padding: '4px 8px', margin: '-4px -8px', borderRadius: tokens.borderRadiusMedium, ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover } },
  heroKpiValue: { fontSize: '26px', fontWeight: 700, lineHeight: 1 },
  heroKpiWarn: { color: tokens.colorStatusWarningForeground1 },
  heroKpiLabel: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  ringWrap: { position: 'relative', width: '84px', height: '84px', flexShrink: 0 },
  ringCenter: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  ringPct: { fontSize: '20px', fontWeight: 700 },
  cardGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '10px' },
  assetCard: { display: 'flex', alignItems: 'center', gap: '10px', padding: '12px', border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium, background: tokens.colorNeutralBackground1, cursor: 'pointer', textAlign: 'left', width: '100%', ':hover': { border: `1px solid ${tokens.colorBrandStroke1}`, backgroundColor: tokens.colorNeutralBackground1Hover } },
  assetCardIcon: { width: '24px', height: '24px', flexShrink: 0 },
  assetCardMain: { minWidth: 0, display: 'flex', flexDirection: 'column' },
  assetCardName: { fontWeight: tokens.fontWeightSemibold, fontSize: tokens.fontSizeBase300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  assetCardMeta: { fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  actionCard: { display: 'flex', alignItems: 'center', gap: '12px', padding: '14px', border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium, background: tokens.colorNeutralBackground1, cursor: 'pointer', textAlign: 'left', width: '100%', ':hover': { border: `1px solid ${tokens.colorBrandStroke1}`, backgroundColor: tokens.colorNeutralBackground1Hover } },
  actionCount: { fontSize: tokens.fontSizeBase600, fontWeight: tokens.fontWeightBold, lineHeight: 1, color: tokens.colorStatusWarningForeground1 },
  actionBody: { flex: 1, minWidth: 0 },
  actionLabel: { fontSize: tokens.fontSizeBase300, fontWeight: tokens.fontWeightSemibold },
  actionSub: { fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 },
  chipsWrap: { display: 'flex', flexWrap: 'wrap', gap: '8px' },
  browseChip: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: '999px', background: tokens.colorNeutralBackground1, cursor: 'pointer', fontSize: tokens.fontSizeBase200, ':hover': { border: `1px solid ${tokens.colorBrandStroke1}`, backgroundColor: tokens.colorNeutralBackground1Hover } },
  browseChipIcon: { width: '16px', height: '16px' },
  browseCount: { color: tokens.colorNeutralForeground3, fontWeight: tokens.fontWeightSemibold },
  searchChip: { padding: '6px 12px', border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: '999px', background: 'none', cursor: 'pointer', fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground2, display: 'inline-flex', alignItems: 'center', gap: '6px', ':hover': { border: `1px solid ${tokens.colorBrandStroke1}` } },
  // Faceted filter bar
  facetBar: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', paddingBottom: '12px' },
  facetBarIcon: { color: tokens.colorNeutralForeground3, flexShrink: 0, marginRight: '2px' },
  facetOpt: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', minWidth: '170px' },
  facetOptLabel: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '150px' },
  facetOptCount: { color: tokens.colorNeutralForeground3, fontVariantNumeric: 'tabular-nums' },
  resultCount: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200, whiteSpace: 'nowrap' },
  chipRow: { display: 'flex', flexWrap: 'wrap', gap: '6px', paddingBottom: '12px' },
  filterChip: { display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 4px 2px 10px', borderRadius: '999px', border: `1px solid ${tokens.colorNeutralStroke2}`, backgroundColor: tokens.colorNeutralBackground1, fontSize: tokens.fontSizeBase200 },
  filterChipLabel: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '240px' },
  filterChipX: { border: 'none', background: 'none', cursor: 'pointer', display: 'flex', padding: '3px', borderRadius: '999px', color: tokens.colorNeutralForeground3, ':hover': { backgroundColor: tokens.colorNeutralBackground3, color: tokens.colorNeutralForeground1 } },
  // Full-width mode-based layout (home / results / detail)
  fadeIn: {
    animationDuration: '180ms',
    animationTimingFunction: 'ease-out',
    animationName: {
      from: { opacity: 0, transform: 'translateY(4px)' },
      to: { opacity: 1, transform: 'translateY(0)' },
    },
  },
  homeScroll: { flex: 1, overflowY: 'auto', backgroundColor: tokens.colorNeutralBackground2 },
  detailScroll: { flex: 1, overflowY: 'auto', backgroundColor: tokens.colorNeutralBackground2 },
  crumbBar: { padding: '12px 32px 0' },
  resultsBody: { flex: 1, display: 'flex', minHeight: 0, '@media (max-width: 760px)': { flexDirection: 'column' } },
  facetRail: {
    width: '250px',
    flexShrink: 0,
    overflowY: 'auto',
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    padding: '16px',
    backgroundColor: tokens.colorNeutralBackground1,
    '@media (max-width: 760px)': { width: '100%', maxHeight: '38vh', borderRight: 'none', borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
  },
  facetRailHead: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', fontWeight: tokens.fontWeightSemibold, color: tokens.colorNeutralForeground2 },
  facetGroup: { marginBottom: '16px' },
  facetGroupLabel: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: tokens.colorNeutralForeground3, marginBottom: '4px' },
  facetRow: { display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '5px 6px', border: 'none', background: 'none', cursor: 'pointer', borderRadius: tokens.borderRadiusSmall, textAlign: 'left', ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover } },
  facetCheck: { width: '16px', height: '16px', borderRadius: '3px', border: `1.5px solid ${tokens.colorNeutralStroke1}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: tokens.colorNeutralBackground1 },
  facetCheckOn: { backgroundColor: tokens.colorBrandBackground, border: `1.5px solid ${tokens.colorBrandBackground}` },
  facetRowLabel: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: tokens.fontSizeBase300 },
  facetRowCount: { fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3, fontVariantNumeric: 'tabular-nums' },
  resultsMain: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', backgroundColor: tokens.colorNeutralBackground2 },
  resultsToolbar: { display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 24px', borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, flexWrap: 'wrap' },
  tableWrap: { flex: 1, overflowY: 'auto', padding: '4px 16px 16px' },
  tRow: { cursor: 'pointer' },
  tName: { fontWeight: tokens.fontWeightSemibold, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  nameButton: { minWidth: 0, border: 'none', background: 'none', padding: 0, color: 'inherit', cursor: 'pointer', textAlign: 'left' },
  starCol: { width: '36px' },
  thSticky: { position: 'sticky', top: 0, zIndex: 1, backgroundColor: tokens.colorNeutralBackground1 },
  nameInner: { display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 },
  sigGood: { color: tokens.colorStatusSuccessForeground1, flexShrink: 0 },
  sigWarn: { color: tokens.colorStatusWarningForeground1, flexShrink: 0 },
  sigMuted: { color: tokens.colorNeutralForeground4, flexShrink: 0 },
  ownerCell: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 },
  ownerName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  muted: { color: tokens.colorNeutralForeground4 },
  govWrap: { display: 'flex', alignItems: 'center', gap: '8px' },
  govPips: { display: 'flex', gap: '3px' },
  govPip: { width: '8px', height: '14px', borderRadius: '2px', backgroundColor: tokens.colorNeutralBackground4, border: `1px solid ${tokens.colorNeutralStroke2}` },
  govPipOn: { backgroundColor: tokens.colorBrandBackground, border: `1px solid ${tokens.colorBrandBackground}` },
  govScore: { fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3, fontVariantNumeric: 'tabular-nums' },
  actionCol: { width: '44px', textAlign: 'center' },
  rowAction: { display: 'inline-flex', alignItems: 'center', color: tokens.colorNeutralForeground3, padding: '4px', borderRadius: tokens.borderRadiusSmall, opacity: 0.55, ':hover': { opacity: 1, color: tokens.colorBrandForeground1, backgroundColor: tokens.colorNeutralBackground3 } },
  tableToolbar: { display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, flexWrap: 'wrap' },
  selCol: { width: '40px' },
  expandCol: { width: '32px' },
  iconBtn: { border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '2px', color: tokens.colorNeutralForeground3, borderRadius: tokens.borderRadiusSmall, ':hover': { backgroundColor: tokens.colorNeutralBackground3, color: tokens.colorNeutralForeground1 } },
  selSummary: { fontSize: tokens.fontSizeBase200, fontWeight: tokens.fontWeightSemibold, color: tokens.colorNeutralForeground2 },
  groupRow: { backgroundColor: tokens.colorNeutralBackground2, ':hover': { backgroundColor: tokens.colorNeutralBackground2Hover } },
  groupHead: { display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0' },
  groupButton: { width: '100%', border: 'none', background: 'none', color: 'inherit', cursor: 'pointer', textAlign: 'left' },
  groupName: { fontWeight: tokens.fontWeightSemibold },
  groupCount: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  groupBar: { width: '84px', height: '6px', borderRadius: '999px', backgroundColor: tokens.colorNeutralBackground4, overflow: 'hidden' },
  groupBarFill: { height: '100%', backgroundColor: tokens.colorBrandBackground },
  pagination: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', minHeight: '44px', padding: '6px 16px', borderTop: `1px solid ${tokens.colorNeutralStroke2}`, backgroundColor: tokens.colorNeutralBackground1 },
  pageStatus: { minWidth: '150px', textAlign: 'center', color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200, fontVariantNumeric: 'tabular-nums' },
  accentGood: { boxShadow: `inset 3px 0 0 ${tokens.colorStatusSuccessBackground3}` },
  accentWarn: { boxShadow: `inset 3px 0 0 ${tokens.colorStatusWarningBackground3}` },
  accentBad: { boxShadow: `inset 3px 0 0 ${tokens.colorStatusDangerBackground3}` },
  expandCell: { backgroundColor: tokens.colorNeutralBackground2 },
  expandGrid: { display: 'grid', gridTemplateColumns: '2fr 1fr 1.5fr', gap: '24px', padding: '4px 8px 8px' },
  expandLabel: { fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: tokens.colorNeutralForeground3, marginBottom: '4px' },
  tagWrap: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, wordBreak: 'break-all', color: tokens.colorNeutralForeground2 },
  emptyBig: { padding: '64px', textAlign: 'center', color: tokens.colorNeutralForeground3 },
});

export function HomePage() {
  const styles = useStyles();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceRef[]>([]);
  const [domains, setDomains] = useState<DomainRef[]>([]);
  const [edges, setEdges] = useState<LineageEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('item') || null);
  const { favorites, toggleFavorite, isFavorite, recents, recordView, recordSearch } = useCatalogPrefs();
  const [facets, setFacets] = useState<Record<FacetKey, string[]>>(EMPTY_FACETS);

  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const type = params.get('type') ?? '';
  const gap = params.get('gap') ?? '';
  const workspace = params.get('workspace') ?? '';
  const browse = params.get('browse') ?? '';
  const has = params.get('has') ?? '';
  const source = params.get('source') ?? '';
  const domain = params.get('domain') ?? '';
  const itemParam = params.get('item') ?? '';
  const navigate = useNavigate();

  const setParam = useCallback(
    (patch: Record<string, string | null>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v) next.set(k, v);
            else next.delete(k);
          }
          return next;
        },
        { replace: true }
      );
    },
    [setParams]
  );

  // Local search draft, debounced before it's committed to the URL — typing
  // used to rewrite URLSearchParams (and re-run the full filter/facet pass)
  // on every keystroke. `draftQ` absorbs keystrokes; only the settled value
  // reaches `setParam`.
  const [draftQ, setDraftQ] = useState(q);
  useEffect(() => setDraftQ(q), [q]);
  useEffect(() => {
    if (draftQ === q) return;
    const t = setTimeout(() => setParam({ q: draftQ || null }), 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftQ]);

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
      if (!cancelledRef.current) setError(err instanceof Error ? err.message : 'Failed to load catalog.');
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const cancelledRef = { current: false };
    void load(cancelledRef);
    return () => { cancelledRef.current = true; };
  }, [load]);

  const wsName = useMemo(() => {
    const m = new Map(workspaces.map((w) => [w.canonicalId, w.name]));
    return (id?: string) => (id ? m.get(id) ?? id.replace('fabric:workspace:', '') : undefined);
  }, [workspaces]);
  const domName = useMemo(() => {
    const m = new Map(domains.map((d) => [d.canonicalId, d.name]));
    return (id?: string) => (id ? m.get(id) ?? id.replace('fabric:domain:', '') : undefined);
  }, [domains]);
  // Domain is a workspace attribute in Fabric — items inherit it through their
  // workspace, so resolve the domain via the item's workspace.
  const wsDomain = useMemo(
    () => new Map(workspaces.map((w) => [w.canonicalId, w.domainCanonicalId])),
    [workspaces],
  );
  const domainOf = useCallback(
    (i: { domainCanonicalId?: string; workspaceCanonicalId?: string }) =>
      i.domainCanonicalId ?? (i.workspaceCanonicalId ? wsDomain.get(i.workspaceCanonicalId) : undefined),
    [wsDomain],
  );

  const types = useMemo(() => Array.from(new Set(items.map((i) => i.itemType))).sort(), [items]);
  const gapDef = gap ? ITEM_GAP_FILTERS[gap] : undefined;
  const byCanonical = useMemo(() => new Map(items.map((i) => [i.canonicalId, i])), [items]);
  const lineageSet = useMemo(() => {
    const s = new Set<string>();
    for (const e of edges) { s.add(e.fromCanonicalId); s.add(e.toCanonicalId); }
    return s;
  }, [edges]);
  const selectAsset = useCallback((id: string) => {
    setSelectedId(id);
    recordView(id);
    setParam({ item: id });
  }, [recordView, setParam]);

  // Keep selection in sync with the `item` URL param in both directions —
  // makes an asset's detail view a real, shareable, bookmarkable, back-button-
  // aware location (previously pure component state with no URL trace), and
  // lets Ask OneLens deep-link straight to an asset from any other page.
  useEffect(() => {
    if (itemParam !== (selectedId ?? '')) setSelectedId(itemParam || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemParam]);

  const baseFiltered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return items.filter((i) => {
      if (type && i.itemType !== type) return false;
      if (workspace && i.workspaceCanonicalId !== workspace) return false;
      if (gapDef && !gapDef.predicate(i)) return false;
      if (source && i.source !== source) return false;
      if (domain && domainOf(i) !== domain) return false;
      if (has === 'sensitivity' && !i.sensitivityLabel) return false;
      if (has === 'governed' && govPillars(i) !== 4) return false;
      if (has === 'stale' && !isStale(i)) return false;
      if (gap === 'lineageComplete' && !(LINEAGE_ELIGIBLE_TYPES.has(i.itemType) && !lineageSet.has(i.canonicalId))) return false;
      if (!query) return true;
      return (
        i.name.toLowerCase().includes(query) ||
        (i.description?.toLowerCase().includes(query) ?? false) ||
        (i.owner?.toLowerCase().includes(query) ?? false)
      );
    });
  }, [items, q, type, workspace, gapDef, gap, has, source, domain, domainOf, lineageSet]);

  const facetValue = useCallback((i: CatalogItem, key: FacetKey): string => {
    switch (key) {
      case 'endorsement': return i.endorsement && i.endorsement !== 'None' ? i.endorsement : 'None';
      case 'sensitivity': return i.sensitivityLabel || 'Unlabeled';
      case 'owner': return i.owner || 'No owner';
      case 'documented': return i.description ? 'Documented' : 'Undocumented';
      case 'domain': return domName(domainOf(i)) || 'No domain';
    }
  }, [domName, domainOf]);

  const filtered = useMemo(
    () => baseFiltered.filter((i) => FACETS.every(({ key }) => facets[key].length === 0 || facets[key].includes(facetValue(i, key)))),
    [baseFiltered, facets, facetValue],
  );

  const facetOptions = useMemo(() => {
    const out = {} as Record<FacetKey, { value: string; count: number }[]>;
    for (const { key } of FACETS) {
      const counts = new Map<string, number>();
      for (const i of baseFiltered) {
        const passesOthers = FACETS.every(({ key: k }) => k === key || facets[k].length === 0 || facets[k].includes(facetValue(i, k)));
        if (!passesOthers) continue;
        const v = facetValue(i, key);
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      out[key] = [...counts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    }
    return out;
  }, [baseFiltered, facets, facetValue]);

  const activeFacetCount = FACETS.reduce((n, { key }) => n + facets[key].length, 0);
  const clearFacets = useCallback(() => setFacets(EMPTY_FACETS), []);

  const selected = useMemo(() => items.find((i) => i.id === selectedId) ?? null, [items, selectedId]);
  const resultsActive = Boolean(q.trim() || type || workspace || gap || browse || has || source || domain || activeFacetCount > 0);
  const mode: 'home' | 'results' | 'detail' = selected ? 'detail' : resultsActive ? 'results' : 'home';
  const resetAll = useCallback(() => { clearFacets(); setParams(new URLSearchParams(), { replace: true }); }, [clearFacets, setParams]);

  return (
    <div className={styles.root}>
      <PageHeader
        icon={<Grid24Regular />}
        title="Catalog"
        subtitle={`${items.length} governed assets across ${workspaces.length} workspaces`}
        actions={(
          <div className={styles.toolbar}>
            <SearchBox
              value={draftQ}
              onChange={(_, data) => setDraftQ(data.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && draftQ.trim()) recordSearch(draftQ); }}
              placeholder="Search name, description, owner…"
              style={{ width: '280px' }}
            />
            <Dropdown
              placeholder="All types"
              value={type || 'All types'}
              selectedOptions={type ? [type] : ['__all']}
              onOptionSelect={(_, data) =>
                setParam({ type: data.optionValue === '__all' ? null : (data.optionValue ?? null) })
              }
              style={{ minWidth: '160px' }}
            >
              <Option value="__all">All types</Option>
              {types.map((t) => (
                <Option key={t} value={t} text={t}>
                  <img src={itemIconUrl(t)} alt="" width={16} height={16} style={{ marginRight: '8px', verticalAlign: '-3px' }} />
                  {t}
                </Option>
              ))}
            </Dropdown>
          </div>
        )}
      />

      {loading ? (
        <div style={{ padding: '24px 32px' }}><PageLoadingSkeleton cards={4} rows={8} /></div>
      ) : error ? (
        <div style={{ padding: '24px' }}>
          <MessageBar intent="error">
            <MessageBarBody>
              {error}
              <Button size="small" appearance="transparent" onClick={() => void load({ current: false })} style={{ marginLeft: '8px' }}>
                Retry
              </Button>
            </MessageBarBody>
          </MessageBar>
        </div>
      ) : mode === 'detail' && selected ? (
        <div className={mergeClasses(styles.detailScroll, styles.fadeIn)}>
          <div className={styles.crumbBar}>
            <Button appearance="subtle" size="small" icon={<ChevronLeft16Regular />} onClick={() => { setSelectedId(null); setParam({ item: null }); }}>
              Back to {resultsActive ? 'results' : 'catalog'}
            </Button>
          </div>
          <AssetProfile
            item={selected}
            workspaceName={wsName(selected.workspaceCanonicalId)}
            domainName={domName(domainOf(selected))}
            edges={edges}
            byCanonical={byCanonical}
            onNavigate={selectAsset}
            isFavorite={isFavorite(selected.id)}
            onToggleFavorite={() => toggleFavorite(selected.id)}
            onOpenWorkspace={() =>
              selected.workspaceCanonicalId && setParam({ workspace: selected.workspaceCanonicalId, gap: null })
            }
          />
        </div>
      ) : mode === 'results' ? (
        <div className={mergeClasses(styles.resultsBody, styles.fadeIn)}>
          <FacetRail
            facets={facets}
            facetOptions={facetOptions}
            setFacets={setFacets}
            clearFacets={clearFacets}
            activeFacetCount={activeFacetCount}
          />
          <div className={styles.resultsMain}>
            <div className={styles.resultsToolbar}>
              <Text weight="semibold">{filtered.length} {filtered.length === 1 ? 'result' : 'results'}</Text>
              {gapDef && <Badge appearance="tint" color="warning">{gapDef.label}</Badge>}
              {gap === 'lineageComplete' && <Badge appearance="tint" color="warning">Missing lineage</Badge>}
              {workspace && <Badge appearance="tint" color="informative">Workspace: {wsName(workspace)}</Badge>}
              {type && <Badge appearance="tint" color="informative">{type}</Badge>}
              {q.trim() && <Badge appearance="tint" color="brand">“{q.trim()}”</Badge>}
              {browse && !gapDef && !workspace && !type && !q.trim() && <Badge appearance="tint" color="informative">All governed assets</Badge>}
              {has === 'sensitivity' && <Badge appearance="tint" color="informative">Sensitivity labeled</Badge>}
              {has === 'governed' && <Badge appearance="tint" color="success">Fully governed</Badge>}
              {has === 'stale' && <Badge appearance="tint" color="warning">Stale (90+ days)</Badge>}
              {source && <Badge appearance="tint" color="brand">Source: {source}</Badge>}
              {domain && <Badge appearance="tint" color="informative">Domain: {domName(domain)}</Badge>}
              <span style={{ flex: 1 }} />
              <Button size="small" appearance="subtle" onClick={resetAll}>Reset all</Button>
            </div>
            {activeFacetCount > 0 && (
              <div className={styles.chipRow} style={{ padding: '10px 24px' }}>
                {FACETS.flatMap(({ key, label }) =>
                  facets[key].map((value) => (
                    <span key={`${key}:${value}`} className={styles.filterChip}>
                      <span className={styles.filterChipLabel} title={`${label}: ${value}`}>{label}: {value}</span>
                      <button
                        type="button"
                        className={styles.filterChipX}
                        aria-label={`Remove ${label} ${value}`}
                        onClick={() => setFacets((f) => ({ ...f, [key]: f[key].filter((v) => v !== value) }))}
                      >
                        <Dismiss12Regular />
                      </button>
                    </span>
                  )),
                )}
              </div>
            )}
            {filtered.length === 0 ? (
              <div className={styles.emptyBig}>
                <Search20Regular style={{ fontSize: '32px', color: tokens.colorNeutralForeground4 }} />
                <Text as="p" block weight="semibold" style={{ marginTop: '12px' }}>No assets match these filters.</Text>
                <Text as="p" block size={200} style={{ color: tokens.colorNeutralForeground3, marginTop: '4px', marginBottom: '16px' }}>
                  Try clearing a filter or broadening your search.
                </Text>
                <Button appearance="secondary" size="small" onClick={resetAll}>Reset all filters</Button>
              </div>
            ) : (
              <ResultsTable
                items={filtered}
                selectedId={selectedId}
                onSelect={selectAsset}
                wsName={wsName}
                isFavorite={isFavorite}
                toggleFavorite={toggleFavorite}
                lineageSet={lineageSet}
              />
            )}
          </div>
        </div>
      ) : (
        <div className={mergeClasses(styles.homeScroll, styles.fadeIn)}>
          <CommandCenterHome
            items={items}
            workspaces={workspaces}
            domains={domains}
            favorites={favorites}
            recents={recents}
            onSelect={selectAsset}
            onBrowseType={(t) => setParam({ type: t })}
            onBrowseAll={() => setParam({ browse: 'all' })}
            onGap={(m) => setParam({ gap: m })}
            onHas={(v) => setParam({ has: v, browse: null, gap: null, type: null, workspace: null })}
            onWorkspaces={() => navigate('/workspaces')}
            onWorkspaceSelect={(id) => setParam({ workspace: id, browse: null, gap: null, type: null, has: null })}
            onOpenObservability={() => navigate('/observability')}
          />
        </div>
      )}
    </div>
  );
}

function AssetProfile({
  item,
  workspaceName,
  domainName,
  edges,
  byCanonical,
  onNavigate,
  isFavorite,
  onToggleFavorite,
  onOpenWorkspace,
}: {
  item: CatalogItem;
  workspaceName?: string;
  domainName?: string;
  edges: LineageEdge[];
  byCanonical: Map<string, CatalogItem>;
  onNavigate: (itemId: string) => void;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onOpenWorkspace: () => void;
}) {
  const styles = useStyles();
  const [tab, setTab] = useState('overview');
  const tags = parseTags(item.tags);
  const gaps = Object.entries(ITEM_GAP_FILTERS).filter(([, g]) => g.predicate(item));

  const { upstream, downstream } = useMemo(
    () => neighborsOf(edges, item.canonicalId, byCanonical),
    [edges, item.canonicalId, byCanonical],
  );
  const impact = useMemo(
    () => downstreamImpact(edges, item.canonicalId, byCanonical),
    [edges, item.canonicalId, byCanonical],
  );
  const hasLineage = upstream.length > 0 || downstream.length > 0;
  useEffect(() => setTab('overview'), [item.canonicalId]);

  return (
    <div className={styles.profileInner}>
      <div className={styles.profileHead}>
        <div className={styles.profileTitleWrap}>
          <img className={styles.profileIcon} src={itemIconUrl(item.itemType)} alt="" draggable={false} />
          <div style={{ minWidth: 0 }}>
            <div className={styles.badges}>
              <Badge appearance="outline" color="informative">{item.itemType}</Badge>
              {item.endorsement && item.endorsement !== 'None' && (
                <Badge appearance="tint" color="success">{item.endorsement}</Badge>
              )}
              {item.sensitivityLabel && <Badge appearance="tint" color="warning">{item.sensitivityLabel}</Badge>}
            </div>
            <Text as="h2" block size={700} weight="semibold" className={styles.ellipsis}>{item.name}</Text>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          <button
            type="button"
            className={styles.profileStar}
            onClick={onToggleFavorite}
            aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            {isFavorite ? <Star20Filled className={styles.starOn} /> : <Star20Regular />}
          </button>
          {item.deepLink && (
            <Button as="a" href={item.deepLink} target="_blank" rel="noopener noreferrer" appearance="primary" icon={<Open16Regular />} iconPosition="after">
              Open in Fabric
            </Button>
          )}
        </div>
      </div>

      {gaps.length > 0 && (
        <div className={styles.gapBar}>
          <Warning16Filled />
          <Text size={200} weight="semibold">Governance gaps:</Text>
          {gaps.map(([k, g]) => (
            <Badge key={k} appearance="tint" color="warning">{g.label}</Badge>
          ))}
        </div>
      )}

      <TabList selectedValue={tab} onTabSelect={(_, d) => setTab(d.value as string)}>
        <Tab value="overview">Overview</Tab>
        <Tab value="lineage">Lineage{hasLineage ? ` (${upstream.length + downstream.length})` : ''}</Tab>
        <Tab value="access">Access</Tab>
        <Tab value="activity">Activity</Tab>
      </TabList>
      <Divider style={{ marginBottom: '16px' }} />

      {tab === 'overview' && (
        <>
          <div className={styles.grid}>
            <Cell label="Source" value={item.source} />
            <Cell label="Type" value={item.itemType} />
            <Cell label="Owner" value={item.owner} />
            <Cell label="Endorsement" value={item.endorsement ?? 'None'} />
            <Cell label="Sensitivity" value={item.sensitivityLabel} />
            <Cell label="Domain" value={domainName} />
            <Cell label="Workspace" value={workspaceName} onAction={workspaceName ? onOpenWorkspace : undefined} actionLabel="View workspace" />
            <Cell label="Canonical id" value={item.canonicalId} mono copyable />
          </div>
          {item.description && (
            <div className={styles.section}>
              <div className={styles.sectionLabel}>Description</div>
              <Text size={300}>{item.description}</Text>
            </div>
          )}
          {tags.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionLabel}>Tags</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {tags.map((t) => (<Badge key={t} appearance="tint" color="subtle">{t}</Badge>))}
              </div>
            </div>
          )}
        </>
      )}
      {tab === 'lineage' && (
        hasLineage ? (
          <>
            <div className={styles.impactBar}>
              <TargetArrow20Regular style={{ color: tokens.colorBrandForeground1 }} />
              <div style={{ flex: 1 }}>
                <Text block weight="semibold">Impact analysis</Text>
                <Text block size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                  {impact.length === 0
                    ? 'Nothing downstream depends on this asset.'
                    : `Changing this asset could affect ${impact.length} downstream ${impact.length === 1 ? 'asset' : 'assets'}.`}
                </Text>
              </div>
              <span className={styles.impactCount}>{impact.length}</span>
            </div>

            <div className={styles.lineageCol}>
              <div className={styles.sectionLabel}>
                <ArrowUp16Regular style={{ verticalAlign: '-2px', marginRight: '4px' }} />
                Upstream — feeds this asset ({upstream.length})
              </div>
              {upstream.length === 0 ? (
                <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>No upstream sources captured.</Text>
              ) : (
                upstream.map((n) => <EdgeRow key={`u-${n.canonicalId}`} node={n} onNavigate={onNavigate} />)
              )}
            </div>

            <div className={styles.lineageCol}>
              <div className={styles.sectionLabel}>
                <ArrowDown16Regular style={{ verticalAlign: '-2px', marginRight: '4px' }} />
                Downstream — depends on this asset ({downstream.length})
              </div>
              {downstream.length === 0 ? (
                <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>Nothing consumes this asset directly.</Text>
              ) : (
                downstream.map((n) => <EdgeRow key={`d-${n.canonicalId}`} node={n} onNavigate={onNavigate} />)
              )}
            </div>
          </>
        ) : (
          <div className={styles.placeholder}>
            <Flow16Regular style={{ marginBottom: '8px' }} />
            {LINEAGE_CAPTURED_TYPES.has(item.itemType) ? (
              <>
                <div>No lineage captured for this asset yet.</div>
                <Text size={200}>Lineage for Power BI artifacts and data stores is captured during the nightly enrichment scan; this asset has no upstream or downstream links yet.</Text>
              </>
            ) : (
              <>
                <div>Lineage isn’t available for this item type.</div>
                <Text size={200}>The scan captures lineage for Power BI artifacts (reports, semantic models, dataflows), data stores (lakehouses, warehouses, SQL/KQL databases and their endpoints), process items (CopyJob, DataPipeline, Eventstream, Activator), and Ontology entity bindings. {item.itemType} lineage isn’t exposed by the Fabric APIs yet.</Text>
              </>
            )}
          </div>
        )
      )}
      {tab === 'access' && (
        <AssetAccessTab
          itemCanonicalId={item.canonicalId}
          workspaceCanonicalId={item.workspaceCanonicalId}
        />
      )}
      {tab === 'activity' && (() => {
        const created = fmtWhen(item.createdDate);
        const modified = fmtWhen(item.modifiedDate);
        const refreshed = fmtWhen(item.lastRefresh);
        const size = fmtBytes(item.sizeBytes);
        const hasSchema = item.tableCount != null || item.columnCount != null;
        const hasOps = Boolean(created || modified || item.modifiedBy || refreshed || item.refreshStatus || size || hasSchema);
        if (!hasOps) {
          return (
            <div className={styles.placeholder}>
              No operational-health signals captured for this asset yet. Created/modified dates,
              refresh status and schema breadth are collected for Power BI artifacts during the nightly scan.
            </div>
          );
        }
        return (
          <>
            {isStale(item) && (
              <div className={styles.gapBar}>
                <Warning16Filled />
                <Text size={200} weight="semibold">Stale — not modified in over 90 days.</Text>
              </div>
            )}
            <div className={styles.grid}>
              <Cell label="Created" value={created} />
              <Cell label="Last modified" value={modified} />
              <Cell label="Modified by" value={item.modifiedBy} />
              <Cell label="Last refresh" value={refreshed} />
              <Cell label="Refresh status" value={item.refreshStatus} />
              <Cell label="Size" value={size} />
              <Cell label="Tables" value={item.tableCount != null ? String(item.tableCount) : undefined} />
              <Cell label="Columns" value={item.columnCount != null ? String(item.columnCount) : undefined} />
            </div>
          </>
        );
      })()}
    </div>
  );
}

function AssetAccessTab({
  itemCanonicalId,
  workspaceCanonicalId,
}: {
  itemCanonicalId: string;
  workspaceCanonicalId?: string;
}) {
  const styles = useStyles();
  const [assignments, setAssignments] = useState<AssetRoleAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    void getAssetRoleAssignments(itemCanonicalId, workspaceCanonicalId)
      .then((rows) => {
        if (!cancelled) setAssignments(rows);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, itemCanonicalId, workspaceCanonicalId]);

  if (loading) {
    return <div className={styles.center}><Spinner size="tiny" label="Loading access assignments" /></div>;
  }
  if (failed) {
    return (
      <MessageBar intent="error">
        <MessageBarBody>
          Access assignments could not be loaded.{' '}
          <Button appearance="transparent" size="small" onClick={() => setAttempt((value) => value + 1)}>Retry</Button>
        </MessageBarBody>
      </MessageBar>
    );
  }
  if (assignments.length === 0) {
    return (
      <div className={styles.placeholder}>
        No direct item or inherited workspace role assignments were captured for this asset.
      </div>
    );
  }

  const direct = assignments.filter((assignment) => assignment.scope === 'item').length;
  const inherited = assignments.length - direct;
  return (
    <>
      <div className={styles.accessSummary}>
        <Text size={200}>{direct} direct · {inherited} inherited from workspace</Text>
      </div>
      <div className={styles.accessList}>
        {assignments.map((assignment) => {
          const name = assignment.principalDisplayName || `Unnamed ${assignment.principalType.toLowerCase()}`;
          return (
            <div key={`${assignment.scope}:${assignment.canonicalId}`} className={styles.accessRow}>
              <div className={styles.accessIdentity}>
                <Avatar name={name} size={32} color="colorful" />
                <div style={{ minWidth: 0 }}>
                  <div className={styles.accessName} title={name}>{name}</div>
                  <div className={styles.accessMeta}>{assignment.principalType}</div>
                </div>
              </div>
              <div className={styles.accessBadges}>
                <Badge appearance="tint" color="informative">{assignment.role}</Badge>
                <Badge appearance="outline">{assignment.scope === 'item' ? 'Direct item' : 'Workspace'}</Badge>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** Format an ISO timestamp as "Mar 3, 2025 · 12 days ago" (best-effort). */
function fmtWhen(iso?: string): string | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return undefined;
  const abs = new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const d = daysSince(iso);
  if (d === undefined) return abs;
  const ago = d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
  return `${abs} · ${ago}`;
}

/** Human-readable byte size, or undefined when absent/zero. */
function fmtBytes(n?: number): string | undefined {
  if (n == null || n <= 0) return undefined;
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

function EdgeRow({ node, onNavigate }: { node: LineageNode; onNavigate: (itemId: string) => void }) {
  const styles = useStyles();
  const clickable = Boolean(node.itemId);
  const rel = node.relationship === 'DataSource' ? 'Data source' : node.relationship;
  return (
    <button
      type="button"
      disabled={!clickable}
      className={mergeClasses(styles.edgeRow, clickable && styles.edgeRowClickable)}
      onClick={() => node.itemId && onNavigate(node.itemId)}
      title={clickable ? `Go to ${node.name}` : node.name}
    >
      <img src={itemIconUrl(node.type)} alt="" width={18} height={18} style={{ flexShrink: 0 }} draggable={false} />
      <span className={styles.edgeMain}>
        <span className={styles.edgeName}>{node.name}</span>
        <span className={styles.edgeMeta}>{[node.type, rel].filter(Boolean).join(' · ')}</span>
      </span>
      {clickable && <ArrowRight16Regular style={{ color: tokens.colorBrandForeground1, flexShrink: 0 }} />}
    </button>
  );
}

function Cell({
  label,
  value,
  mono,
  onAction,
  actionLabel,
  copyable,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
  onAction?: () => void;
  actionLabel?: string;
  copyable?: boolean;
}) {
  const styles = useStyles();
  const notify = useAppToast();
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(() => {
    if (!value) return;
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      notify('Copied to clipboard', { body: value });
      setTimeout(() => setCopied(false), 1500);
    });
  }, [value, notify]);
  return (
    <div className={styles.cell}>
      <div className={styles.cellLabel}>{label}</div>
      <div className={styles.cellValue}>
        <Text
          size={mono ? 200 : 300}
          className={styles.ellipsis}
          style={{ fontFamily: mono ? tokens.fontFamilyMonospace : undefined, color: value ? undefined : tokens.colorNeutralForeground4 }}
          title={value ?? undefined}
        >
          {value || '—'}
        </Text>
        {onAction && value && (
          <button className={styles.linkBtn} onClick={onAction}>{actionLabel}</button>
        )}
        {copyable && value && (
          <Tooltip content={copied ? 'Copied!' : 'Copy to clipboard'} relationship="label">
            <button type="button" className={styles.linkBtn} onClick={onCopy} aria-label="Copy to clipboard">
              {copied ? <Checkmark16Filled /> : <Copy16Regular />}
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Catalog Home — the landing experience (recents, favorites, browse, fix-its)
// --------------------------------------------------------------------------- //




// --------------------------------------------------------------------------- //
// Results — left facet rail + sortable table (Databricks/Purview browse pattern)
// --------------------------------------------------------------------------- //
function FacetRail({ facets, facetOptions, setFacets, clearFacets, activeFacetCount }: {
  facets: Record<FacetKey, string[]>;
  facetOptions: Record<FacetKey, { value: string; count: number }[]>;
  setFacets: Dispatch<SetStateAction<Record<FacetKey, string[]>>>;
  clearFacets: () => void;
  activeFacetCount: number;
}) {
  const styles = useStyles();
  const toggle = (key: FacetKey, value: string) =>
    setFacets((f) => ({ ...f, [key]: f[key].includes(value) ? f[key].filter((v) => v !== value) : [...f[key], value] }));
  return (
    <aside className={styles.facetRail}>
      <div className={styles.facetRailHead}>
        <FilterGlyph />
        <span>Filters</span>
        <span style={{ flex: 1 }} />
        {activeFacetCount > 0 && <button className={styles.linkBtn} onClick={clearFacets}>Clear</button>}
      </div>
      {FACETS.map(({ key, label, Glyph }) => (
        <FacetGroup key={key} label={label} Glyph={Glyph} options={facetOptions[key]} selected={facets[key]} onToggle={(v) => toggle(key, v)} />
      ))}
    </aside>
  );
}

function FacetGroup({ label, Glyph, options, selected, onToggle }: {
  label: string;
  Glyph: (p: SVGProps<SVGSVGElement>) => ReactNode;
  options: { value: string; count: number }[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  const styles = useStyles();
  const [expanded, setExpanded] = useState(false);
  if (options.length === 0) return null;
  const shown = expanded ? options : options.slice(0, 6);
  return (
    <div className={styles.facetGroup}>
      <div className={styles.facetGroupLabel}><Glyph /> {label}</div>
      {shown.map((o) => {
        const on = selected.includes(o.value);
        return (
          <button key={o.value} type="button" className={styles.facetRow} onClick={() => onToggle(o.value)}>
            <span className={mergeClasses(styles.facetCheck, on && styles.facetCheckOn)}>{on && <Checkmark12Filled />}</span>
            <span className={styles.facetRowLabel} title={o.value}>{o.value}</span>
            <span className={styles.facetRowCount}>{o.count}</span>
          </button>
        );
      })}
      {options.length > 6 && (
        <button className={styles.linkBtn} style={{ marginTop: '2px' }} onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Show less' : `Show ${options.length - 6} more`}
        </button>
      )}
    </div>
  );
}

interface ColDef {
  key: string;
  label: string;
  get: (i: CatalogItem) => string | number;
  render: (i: CatalogItem) => ReactNode;
  csv: (i: CatalogItem) => string;
}

const GROUP_OPTS = [
  { key: 'none', label: 'No grouping' },
  { key: 'workspace', label: 'Workspace' },
  { key: 'itemType', label: 'Type' },
];
const CATALOG_PAGE_SIZE = 100;

/** Item types the enrichment scan can produce lineage for (PBI artifacts, data
 * stores + their endpoints, and process items whose definition is parsed for
 * source/destination references). */
const LINEAGE_CAPTURED_TYPES = new Set<string>([
  'Report', 'SemanticModel', 'Dataflow', 'Datamart', 'PaginatedReport', 'Dashboard',
  'Lakehouse', 'Warehouse', 'MirroredDatabase', 'SQLDatabase', 'SQLEndpoint', 'SQLAnalyticsEndpoint',
  'Eventhouse', 'KQLDatabase', 'CopyJob', 'DataPipeline', 'Notebook', 'Eventstream', 'Reflex', 'Ontology',
]);

function ResultsTable({ items, selectedId, onSelect, wsName, isFavorite, toggleFavorite, lineageSet }: {
  items: CatalogItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  wsName: (id?: string) => string | undefined;
  isFavorite: (id: string) => boolean;
  toggleFavorite: (id: string) => void;
  lineageSet: Set<string>;
}) {
  const styles = useStyles();
  const notify = useAppToast();
  const [sort, setSort] = useState<{ col: string; dir: 'asc' | 'desc' }>({ col: 'name', dir: 'asc' });
  const [groupBy, setGroupBy] = useState('none');
  const [compact, setCompact] = useState(false);
  const [hidden, setHidden] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);

  const allCols = useMemo<ColDef[]>(() => ([
    { key: 'itemType', label: 'Type', get: (i) => i.itemType.toLowerCase(), render: (i) => i.itemType, csv: (i) => i.itemType },
    {
      key: 'owner', label: 'Owner', get: (i) => (i.owner ?? '').toLowerCase(),
      render: (i) => i.owner
        ? <div className={styles.ownerCell}><Avatar name={i.owner} size={20} color="colorful" /><span className={styles.ownerName}>{i.owner}</span></div>
        : <span className={styles.muted}>—</span>,
      csv: (i) => i.owner ?? '',
    },
    {
      key: 'workspace', label: 'Workspace', get: (i) => (wsName(i.workspaceCanonicalId) ?? '').toLowerCase(),
      render: (i) => wsName(i.workspaceCanonicalId) ?? <span className={styles.muted}>—</span>,
      csv: (i) => wsName(i.workspaceCanonicalId) ?? '',
    },
    { key: 'governance', label: 'Governance', get: (i) => govPillars(i), render: (i) => <GovernanceCell item={i} />, csv: (i) => `${govPillars(i)}/4` },
  ]), [wsName, styles]);
  const cols = allCols.filter((c) => !hidden.includes(c.key));

  const getSort = useCallback((i: CatalogItem, key: string): string | number =>
    key === 'name' ? i.name.toLowerCase() : (allCols.find((c) => c.key === key)?.get(i) ?? ''), [allCols]);
  const sorted = useMemo(() => {
    const s = [...items].sort((a, b) => {
      const av = getSort(a, sort.col); const bv = getSort(b, sort.col);
      return typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' });
    });
    return sort.dir === 'desc' ? s.reverse() : s;
  }, [items, sort, getSort]);
  const onSort = (key: string) => setSort((s) => (s.col === key ? { col: key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col: key, dir: key === 'governance' ? 'desc' : 'asc' }));

  const pageSlice = useMemo(() => paginate(sorted, page, CATALOG_PAGE_SIZE), [sorted, page]);
  const groups = useMemo(() => {
    if (groupBy === 'none') return [{ key: '__all', label: '', items: pageSlice.items, totalCount: sorted.length }];
    const m = new Map<string, CatalogItem[]>();
    for (const i of sorted) {
      const k = groupBy === 'workspace' ? (wsName(i.workspaceCanonicalId) ?? 'No workspace') : i.itemType;
      const arr = m.get(k);
      if (arr) arr.push(i); else m.set(k, [i]);
    }
    const visibleIds = new Set(pageSlice.items.map((item) => item.id));
    return [...m.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([label, groupItems]) => ({
        key: label,
        label,
        totalCount: groupItems.length,
        items: groupItems.filter((item) => visibleIds.has(item.id)),
      }))
      .filter((group) => group.items.length > 0);
  }, [sorted, groupBy, wsName, pageSlice.items]);

  useEffect(() => setPage(0), [items, sort.col, sort.dir, groupBy]);

  const allIds = sorted.map((i) => i.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const someSelected = selected.size > 0 && !allSelected;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(allIds));
  const toggleOne = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleExpand = (id: string) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleGroup = (k: string) => setCollapsedGroups((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const exportCsv = () => {
    const rows = selected.size > 0 ? sorted.filter((i) => selected.has(i.id)) : sorted;
    // Neutralize CSV/formula injection (CWE-1236): a cell value starting with
    // =, +, -, or @ is interpreted as a live formula by Excel/Sheets on open.
    // Item fields (name/owner/tags) come from the Fabric tenant, not from us,
    // so anyone with rename/edit rights on an item could otherwise smuggle a
    // formula into every export.
    const sanitizeCell = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
    const line = (arr: (string | number)[]) =>
      arr.map((v) => `"${sanitizeCell(String(v ?? '')).replace(/"/g, '""')}"`).join(',');
    const header = line(['Name', 'Canonical id', ...cols.map((c) => c.label)]);
    const body = rows.map((i) => line([i.name, i.canonicalId, ...cols.map((c) => c.csv(i))]));
    const blob = new Blob([[header, ...body].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `onelens-catalog-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    notify('Export complete', { body: `${rows.length} ${rows.length === 1 ? 'row' : 'rows'} exported to CSV.` });
  };

  const span = 5 + cols.length; // select + expand + star + name + cols + action

  return (
    <div className={styles.tableWrap} style={{ padding: 0 }}>
      <div className={styles.tableToolbar}>
        {selected.size > 0 ? (
          <>
            <span className={styles.selSummary}>{selected.size} selected</span>
            <Button size="small" appearance="primary" icon={<ArrowDownload16Regular />} onClick={exportCsv}>Export selected</Button>
            <Button size="small" appearance="subtle" onClick={() => setSelected(new Set())}>Clear</Button>
          </>
        ) : (
          <>
            <Menu checkedValues={{ group: [groupBy] }} onCheckedValueChange={(_, d) => setGroupBy(d.checkedItems[0] ?? 'none')}>
              <MenuTrigger disableButtonEnhancement>
                <MenuButton size="small" appearance="subtle" icon={<Group20Regular />}>Group: {GROUP_OPTS.find((g) => g.key === groupBy)?.label}</MenuButton>
              </MenuTrigger>
              <MenuPopover><MenuList>{GROUP_OPTS.map((g) => <MenuItemRadio key={g.key} name="group" value={g.key}>{g.label}</MenuItemRadio>)}</MenuList></MenuPopover>
            </Menu>
            <Menu checkedValues={{ cols: cols.map((c) => c.key) }} onCheckedValueChange={(_, d) => setHidden(allCols.map((c) => c.key).filter((k) => !d.checkedItems.includes(k)))}>
              <MenuTrigger disableButtonEnhancement>
                <MenuButton size="small" appearance="subtle" icon={<Options16Regular />}>Columns</MenuButton>
              </MenuTrigger>
              <MenuPopover><MenuList>{allCols.map((c) => <MenuItemCheckbox key={c.key} name="cols" value={c.key}>{c.label}</MenuItemCheckbox>)}</MenuList></MenuPopover>
            </Menu>
            <ToggleButton size="small" appearance="subtle" checked={compact} onClick={() => setCompact((v) => !v)}>{compact ? 'Compact' : 'Comfortable'}</ToggleButton>
            <span style={{ flex: 1 }} />
            <Button size="small" appearance="subtle" icon={<ArrowDownload16Regular />} onClick={exportCsv}>Export CSV</Button>
          </>
        )}
      </div>
      <Table size={compact ? 'extra-small' : 'small'} aria-label="Catalog assets">
        <TableHeader>
          <TableRow>
            <TableHeaderCell className={mergeClasses(styles.selCol, styles.thSticky)}>
              <Checkbox checked={allSelected ? true : someSelected ? 'mixed' : false} onChange={toggleAll} aria-label="Select all" />
            </TableHeaderCell>
            <TableHeaderCell className={mergeClasses(styles.expandCol, styles.thSticky)} />
            <TableHeaderCell className={mergeClasses(styles.starCol, styles.thSticky)} />
            <TableHeaderCell
              className={styles.thSticky}
              sortDirection={sort.col === 'name' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
              onClick={() => onSort('name')}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort('name'); } }}
              style={{ cursor: 'pointer' }}
            >
              Name
            </TableHeaderCell>
            {cols.map((c) => (
              <TableHeaderCell
                key={c.key}
                className={styles.thSticky}
                sortDirection={sort.col === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                onClick={() => onSort(c.key)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort(c.key); } }}
                style={{ cursor: 'pointer' }}
              >
                {c.label}
              </TableHeaderCell>
            ))}
            <TableHeaderCell className={mergeClasses(styles.actionCol, styles.thSticky)} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((group) => (
            <Fragment key={group.key}>
              {groupBy !== 'none' && (
                <TableRow className={styles.groupRow}>
                  <TableCell colSpan={span}>
                    <button
                      type="button"
                      className={mergeClasses(styles.groupHead, styles.groupButton)}
                      aria-expanded={!collapsedGroups.has(group.key)}
                      onClick={() => toggleGroup(group.key)}
                    >
                      {collapsedGroups.has(group.key) ? <ChevronRight16Regular /> : <ChevronDown16Regular />}
                      <span className={styles.groupName}>{group.label}</span>
                      <span className={styles.groupCount}>{group.totalCount}</span>
                      <span style={{ flex: 1 }} />
                      <GroupGov items={group.items} />
                    </button>
                  </TableCell>
                </TableRow>
              )}
              {!collapsedGroups.has(group.key) && group.items.map((item) => {
                const score = govPillars(item);
                const accent = score >= 4 ? styles.accentGood : score >= 2 ? styles.accentWarn : styles.accentBad;
                return (
                  <Fragment key={item.id}>
                    <TableRow className={mergeClasses(styles.tRow, item.id === selectedId && styles.rowActive)} onClick={() => onSelect(item.id)}>
                      <TableCell className={mergeClasses(styles.selCol, accent)} onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={selected.has(item.id)} onChange={() => toggleOne(item.id)} aria-label={`Select ${item.name}`} />
                      </TableCell>
                      <TableCell className={styles.expandCol}>
                        <button type="button" className={styles.iconBtn} aria-label="Expand row" onClick={(e) => { e.stopPropagation(); toggleExpand(item.id); }}>
                          {expanded.has(item.id) ? <ChevronDown16Regular /> : <ChevronRight16Regular />}
                        </button>
                      </TableCell>
                      <TableCell className={styles.starCol}>
                        <button type="button" className={styles.starBtn} aria-label={isFavorite(item.id) ? 'Remove from favorites' : 'Add to favorites'} onClick={(e) => { e.stopPropagation(); toggleFavorite(item.id); }}>
                          {isFavorite(item.id) ? <Star16Filled className={styles.starOn} /> : <Star16Regular />}
                        </button>
                      </TableCell>
                      <TableCell>
                        <TableCellLayout media={<img src={itemIconUrl(item.itemType)} width={18} height={18} alt="" draggable={false} />} truncate>
                          <button
                            type="button"
                            className={mergeClasses(styles.nameInner, styles.nameButton)}
                            onClick={(event) => { event.stopPropagation(); onSelect(item.id); }}
                          >
                            <span className={styles.tName}>{item.name}</span>
                            {item.endorsement && item.endorsement !== 'None' && <EndorsementGlyph width={13} height={13} className={styles.sigGood} />}
                            {item.sensitivityLabel && <SensitivityGlyph width={13} height={13} className={styles.sigWarn} />}
                            {lineageSet.has(item.canonicalId) && <Flow16Regular className={styles.sigMuted} />}
                          </button>
                        </TableCellLayout>
                      </TableCell>
                      {cols.map((c) => <TableCell key={c.key}>{c.render(item)}</TableCell>)}
                      <TableCell className={styles.actionCol}>
                        {item.deepLink && (
                          <a className={styles.rowAction} href={item.deepLink} target="_blank" rel="noreferrer" title="Open in Fabric" onClick={(e) => e.stopPropagation()}>
                            <Open16Regular />
                          </a>
                        )}
                      </TableCell>
                    </TableRow>
                    {expanded.has(item.id) && (
                      <TableRow>
                        <TableCell colSpan={span} className={styles.expandCell}>
                          <ExpandedDetail item={item} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </Fragment>
          ))}
        </TableBody>
      </Table>
      {pageSlice.totalPages > 1 && (
        <nav className={styles.pagination} aria-label="Catalog result pages">
          <Button
            appearance="subtle"
            size="small"
            icon={<ChevronLeft16Regular />}
            aria-label="Previous page"
            disabled={pageSlice.page === 0}
            onClick={() => setPage(pageSlice.page - 1)}
          />
          <span className={styles.pageStatus}>
            {pageSlice.start}–{pageSlice.end} of {sorted.length}
          </span>
          <Button
            appearance="subtle"
            size="small"
            icon={<ChevronRight16Regular />}
            aria-label="Next page"
            disabled={pageSlice.page >= pageSlice.totalPages - 1}
            onClick={() => setPage(pageSlice.page + 1)}
          />
        </nav>
      )}
    </div>
  );
}

function GovernanceCell({ item }: { item: CatalogItem }) {
  const styles = useStyles();
  const attrs: [string, boolean][] = [
    ['Sensitivity label', Boolean(item.sensitivityLabel)],
    ['Description', Boolean(item.description)],
    ['Owner', Boolean(item.owner)],
    ['Endorsement', Boolean(item.endorsement && item.endorsement !== 'None')],
  ];
  const score = govPillars(item);
  const missing = attrs.filter(([, on]) => !on).map(([k]) => k);
  const tip = missing.length ? `Missing: ${missing.join(', ')}` : 'Fully governed';
  return (
    <Tooltip content={tip} relationship="description" withArrow>
      <div className={styles.govWrap}>
        <div className={styles.govPips}>
          {attrs.map(([k, on]) => <span key={k} className={mergeClasses(styles.govPip, on && styles.govPipOn)} />)}
        </div>
        <span className={styles.govScore}>{score}/4</span>
      </div>
    </Tooltip>
  );
}

function GroupGov({ items }: { items: CatalogItem[] }) {
  const styles = useStyles();
  const avg = items.length ? items.reduce((n, i) => n + govPillars(i), 0) / (items.length * 4) : 0;
  return (
    <Tooltip content={`Avg governance ${Math.round(avg * 100)}%`} relationship="description">
      <div className={styles.groupBar}><div className={styles.groupBarFill} style={{ width: `${Math.round(avg * 100)}%` }} /></div>
    </Tooltip>
  );
}

function ExpandedDetail({ item }: { item: CatalogItem }) {
  const styles = useStyles();
  const tags = parseTags(item.tags);
  return (
    <div className={styles.expandGrid}>
      <div>
        <div className={styles.expandLabel}>Description</div>
        <div>{item.description || <span className={styles.muted}>No description</span>}</div>
      </div>
      <div>
        <div className={styles.expandLabel}>Tags</div>
        {tags.length ? <div className={styles.tagWrap}>{tags.map((t) => <Badge key={t} appearance="tint" color="subtle">{t}</Badge>)}</div> : <span className={styles.muted}>None</span>}
      </div>
      <div>
        <div className={styles.expandLabel}>Canonical id</div>
        <div className={styles.mono}>{item.canonicalId}</div>
      </div>
    </div>
  );
}
