import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  makeStyles,
  mergeClasses,
  tokens,
  Text,
  Badge,
  Card,
  Button,
  MessageBar,
  MessageBarBody,
} from '@fluentui/react-components';
import {
  PlugConnected24Regular,
  Settings24Regular,
  Sparkle24Regular,
  ShieldKeyhole24Regular,
  CheckmarkCircle16Filled,
  ChevronRight16Regular,
} from '@fluentui/react-icons';
import { useNavigate } from 'react-router-dom';

import { getConnectors, parseCapabilities, CAPABILITY_LABELS, KIND_LABELS, type ConnectorRow } from '@/services/connectors';
import { sourceIconUrl } from '@/lib/itemIcons';
import { relTime } from '@/lib/utils';
import { PageHeader } from '@/components/PageHeader';
import { PageLoadingSkeleton } from '@/components/Skeletons';

const useStyles = makeStyles({
  root: { height: '100%', overflowY: 'auto' },
  header: { padding: '20px 32px', backgroundColor: tokens.colorNeutralBackground1, borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
  headerRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px' },
  content: { maxWidth: '1200px', margin: '0 auto', padding: '24px 32px', display: 'flex', flexDirection: 'column', gap: '28px' },
  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' },
  kpiCard: { padding: '16px' },
  kpiValue: { fontSize: '28px', fontWeight: 700, lineHeight: 1 },
  kpiLabel: { marginTop: '4px', color: tokens.colorNeutralForeground3 },
  section: { display: 'flex', flexDirection: 'column', gap: '12px' },
  sectionHead: { display: 'flex', alignItems: 'baseline', gap: '8px' },
  sectionTitle: { fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' },
  sectionHint: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' },
  card: { padding: '18px', display: 'flex', flexDirection: 'column', gap: '12px', border: `1px solid ${tokens.colorNeutralStroke2}` },
  cardClickable: { cursor: 'pointer', ':hover': { boxShadow: tokens.shadow8, border: `1px solid ${tokens.colorBrandStroke1}` } },
  cardTop: { display: 'flex', alignItems: 'flex-start', gap: '12px' },
  iconBox: { width: '40px', height: '40px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: tokens.borderRadiusMedium, backgroundColor: tokens.colorNeutralBackground3 },
  titleWrap: { flex: 1, minWidth: 0 },
  title: { fontSize: tokens.fontSizeBase400, fontWeight: tokens.fontWeightSemibold, display: 'flex', alignItems: 'center', gap: '8px' },
  sub: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  desc: { color: tokens.colorNeutralForeground2, fontSize: tokens.fontSizeBase200, lineHeight: '18px', minHeight: '36px' },
  caps: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
  cap: { display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: '999px', border: `1px solid ${tokens.colorNeutralStroke2}`, fontSize: '11px', color: tokens.colorNeutralForeground2 },
  footer: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', borderTop: `1px solid ${tokens.colorNeutralStroke2}`, paddingTop: '10px', marginTop: '2px' },
  footMeta: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  drill: { display: 'inline-flex', alignItems: 'center', gap: '2px', color: tokens.colorBrandForeground1, fontSize: tokens.fontSizeBase200, fontWeight: 600 },
  ghost: { display: 'inline-flex', alignItems: 'center', gap: '4px', color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200, fontWeight: 600 },
  center: { padding: '48px', textAlign: 'center', color: tokens.colorNeutralForeground3 },
});

const STATUS: Record<string, { label: string; color: 'success' | 'informative' | 'subtle' | 'danger' }> = {
  connected: { label: 'Connected', color: 'success' },
  available: { label: 'Available', color: 'informative' },
  planned: { label: 'Planned', color: 'subtle' },
  error: { label: 'Error', color: 'danger' },
};

function SourceIcon({ c }: { c: ConnectorRow }) {
  const url = sourceIconUrl(c.source);
  if (url) return <img src={url} width={28} height={28} alt="" />;
  if (c.source === 'security') return <ShieldKeyhole24Regular />;
  if (c.kind === 'platform') return <Settings24Regular />;
  if (c.kind === 'analysis') return <Sparkle24Regular />;
  return <PlugConnected24Regular />;
}

export function ConnectorsPage() {
  const styles = useStyles();
  const navigate = useNavigate();
  const [connectors, setConnectors] = useState<ConnectorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (cancelledRef: { current: boolean }) => {
    setLoading(true);
    setError(null);
    try {
      const rows = await getConnectors();
      if (!cancelledRef.current) setConnectors(rows);
    } catch (err) {
      if (!cancelledRef.current) setError(err instanceof Error ? err.message : 'Failed to load connectors.');
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const cancelledRef = { current: false };
    void load(cancelledRef);
    return () => { cancelledRef.current = true; };
  }, [load]);

  const connected = useMemo(() => connectors.filter((c) => c.status === 'connected'), [connectors]);
  const rest = useMemo(() => connectors.filter((c) => c.status !== 'connected'), [connectors]);
  const kpis = useMemo(() => {
    // Analysis-kind connectors (e.g. Ask OneLens) query already-canonicalized
    // data rather than ingesting new assets — their itemCount reflects grounded
    // tables, not tenant assets, so they're excluded from this ingestion total.
    const assets = connected.filter((c) => c.kind !== 'analysis').reduce((n, c) => n + (c.itemCount ?? 0), 0);
    const caps = new Set<string>();
    for (const c of connected) parseCapabilities(c.capabilities).forEach((k) => caps.add(k));
    return { connected: connected.length, available: rest.length, assets, caps: caps.size };
  }, [connected, rest]);

  return (
    <div className={styles.root}>
      <PageHeader
        icon={<PlugConnected24Regular />}
        title="Connectors"
        subtitle="Pluggable governance sources. Each connector maps its system into the same canonical model — a drop-in package plus one config row, no schema or app change. See the connector SDK guide to build one."
      />

      <div className={styles.content}>
        {loading ? (
          <PageLoadingSkeleton cards={4} rows={4} />
        ) : error ? (
          <MessageBar intent="error">
            <MessageBarBody>
              {error}
              <Button size="small" appearance="transparent" onClick={() => void load({ current: false })} style={{ marginLeft: '8px' }}>
                Retry
              </Button>
            </MessageBarBody>
          </MessageBar>
        ) : connectors.length === 0 ? (
          <div className={styles.center}>No connectors registered yet.</div>
        ) : (
          <>
            <div className={styles.kpiGrid}>
              <Kpi value={kpis.connected} label="Connected sources" />
              <Kpi value={kpis.assets} label="Assets ingested" />
              <Kpi value={kpis.caps} label="Capabilities covered" />
              <Kpi value={kpis.available} label="On the roadmap" />
            </div>

            <ConnectorSection
              title="Connected"
              hint="Live sources contributing canonical entities"
              connectors={connected}
              onOpen={(c) => navigate(c.kind === 'analysis' ? '/ask' : `/?source=${encodeURIComponent(c.source)}`)}
            />
            {rest.length > 0 && (
              <ConnectorSection
                title="On the roadmap"
                hint="Mapped into the same canonical model — no live collector yet"
                connectors={rest}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Kpi({ value, label }: { value: number; label: string }) {
  const styles = useStyles();
  return (
    <Card className={styles.kpiCard}>
      <div className={styles.kpiValue}>{value}</div>
      <Text as="p" size={200} className={styles.kpiLabel}>{label}</Text>
    </Card>
  );
}

function ConnectorSection({ title, hint, connectors, onOpen }: {
  title: string;
  hint: string;
  connectors: ConnectorRow[];
  onOpen?: (c: ConnectorRow) => void;
}) {
  const styles = useStyles();
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>{title}</span>
        <span className={styles.sectionHint}>{hint}</span>
      </div>
      <div className={styles.grid}>
        {connectors.map((c) => (
          <ConnectorCard key={c.canonicalId} c={c} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

function ConnectorCard({ c, onOpen }: { c: ConnectorRow; onOpen?: (c: ConnectorRow) => void }): ReactNode {
  const styles = useStyles();
  const st = STATUS[c.status] ?? STATUS.available;
  const caps = parseCapabilities(c.capabilities);
  const isConnected = c.status === 'connected';
  const clickable = isConnected && Boolean(onOpen);
  const onClick = clickable ? () => onOpen!(c) : undefined;
  return (
    <Card
      className={mergeClasses(styles.card, clickable && styles.cardClickable)}
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable && onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      <div className={styles.cardTop}>
        <span className={styles.iconBox}><SourceIcon c={c} /></span>
        <div className={styles.titleWrap}>
          <div className={styles.title}>
            {c.displayName}
            {c.status === 'connected' && <CheckmarkCircle16Filled style={{ color: tokens.colorStatusSuccessForeground1 }} />}
          </div>
          <div className={styles.sub}>{KIND_LABELS[c.kind] ?? c.kind} · {c.source}</div>
        </div>
        <Badge appearance="tint" color={st.color}>{st.label}</Badge>
      </div>

      <div className={styles.desc}>{c.description}</div>

      {caps.length > 0 && (
        <div className={styles.caps}>
          {caps.map((k) => <span key={k} className={styles.cap}>{CAPABILITY_LABELS[k] ?? k}</span>)}
        </div>
      )}

      <div className={styles.footer}>
        <span className={styles.footMeta}>
          {isConnected
            ? c.kind === 'analysis'
              ? `Grounded on ${c.itemCount ?? 0} views · deployed ${relTime(c.lastSeen)}`
              : `${c.itemCount ?? 0} assets · scanned ${relTime(c.lastSeen)}`
            : 'No live collector yet'}
        </span>
        {isConnected && <span className={styles.drill}>View assets <ChevronRight16Regular /></span>}
      </div>
    </Card>
  );
}
