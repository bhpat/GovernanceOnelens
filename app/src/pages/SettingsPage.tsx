import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  makeStyles,
  tokens,
  Text,
  Badge,
  Card,
  Button,
  Divider,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
} from '@fluentui/react-components';
import {
  ArrowClockwise20Regular,
  Key20Regular,
  Database20Regular,
  Server20Regular,
  BranchFork20Regular,
  Clock20Regular,
  Person20Regular,
  Building20Regular,
  Flash20Regular,
  Settings24Regular,
} from '@fluentui/react-icons';

import { getConnectors, type ConnectorRow } from '@/services/connectors';
import { getScanRuns, requestScan, deriveServiceConfig, type ScanRunRow, type ServiceConfig } from '@/services/scans';
import { useAuth } from '@/hooks/useAuth';
import { sourceIconUrl } from '@/lib/itemIcons';
import { relTime } from '@/lib/utils';
import { PageHeader } from '@/components/PageHeader';
import { PageLoadingSkeleton } from '@/components/Skeletons';

const useStyles = makeStyles({
  root: { height: '100%', overflowY: 'auto' },
  header: { padding: '20px 32px', backgroundColor: tokens.colorNeutralBackground1, borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
  content: { maxWidth: '1200px', margin: '0 auto', padding: '24px 32px', display: 'flex', flexDirection: 'column', gap: '24px' },
  statusGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' },
  statCard: { padding: '16px', display: 'flex', flexDirection: 'column', gap: '6px' },
  statTop: { display: 'flex', alignItems: 'center', gap: '8px', color: tokens.colorNeutralForeground3 },
  statValue: { fontSize: '22px', fontWeight: 700, lineHeight: 1.1 },
  statSub: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  section: { display: 'flex', flexDirection: 'column', gap: '12px' },
  sectionTitle: { fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' },
  card: { padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px', border: `1px solid ${tokens.colorNeutralStroke2}` },
  refreshRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' },
  refreshCopy: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '260px', flex: 1 },
  cfgHead: { display: 'flex', alignItems: 'center', gap: '10px' },
  cfgIcon: { width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: tokens.borderRadiusMedium, backgroundColor: tokens.colorNeutralBackground3 },
  defList: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '2px 24px' },
  defRow: { display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 0', borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
  defIcon: { color: tokens.colorNeutralForeground3, flexShrink: 0 },
  defLabel: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200, width: '116px', flexShrink: 0 },
  defValue: { fontSize: tokens.fontSizeBase300, fontWeight: 600, wordBreak: 'break-word' },
  table: { display: 'flex', flexDirection: 'column' },
  thead: { display: 'grid', gridTemplateColumns: '150px 90px 110px 80px 1fr', gap: '12px', padding: '8px 4px', color: tokens.colorNeutralForeground3, fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: `1px solid ${tokens.colorNeutralStroke1}` },
  trow: { display: 'grid', gridTemplateColumns: '150px 90px 110px 80px 1fr', gap: '12px', padding: '10px 4px', alignItems: 'center', borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, fontSize: tokens.fontSizeBase200 },
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: '12px', color: tokens.colorNeutralForeground2 },
  center: { padding: '40px', textAlign: 'center', color: tokens.colorNeutralForeground3 },
  muted: { color: tokens.colorNeutralForeground3 },
});

const RUN_STATUS: Record<string, { label: string; color: 'success' | 'informative' | 'warning' | 'danger' | 'subtle' }> = {
  succeeded: { label: 'Succeeded', color: 'success' },
  running: { label: 'Running', color: 'informative' },
  requested: { label: 'Queued', color: 'warning' },
  failed: { label: 'Failed', color: 'danger' },
};

function absTime(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function SettingsPage() {
  const styles = useStyles();
  const { user } = useAuth();
  const [connectors, setConnectors] = useState<ConnectorRow[]>([]);
  const [runs, setRuns] = useState<ScanRunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState<ScanRunRow | null>(null);

  const load = useCallback(async (cancelledRef: { current: boolean }) => {
    setLoading(true);
    setError(null);
    try {
      const [c, r] = await Promise.all([getConnectors(), getScanRuns()]);
      if (cancelledRef.current) return;
      setConnectors(c);
      setRuns(r);
    } catch (err) {
      if (!cancelledRef.current) setError(err instanceof Error ? err.message : 'Failed to load settings.');
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const cancelledRef = { current: false };
    void load(cancelledRef);
    return () => { cancelledRef.current = true; };
  }, [load]);

  const collectors = useMemo(
    () => connectors.filter((c) => c.kind === 'collection' && c.status === 'connected').map(deriveServiceConfig),
    [connectors],
  );
  const primary = collectors[0];
  const lastRun = useMemo(() => runs.find((r) => r.status === 'succeeded' || r.status === 'failed'), [runs]);
  const pending = useMemo(() => runs.find((r) => r.status === 'requested' || r.status === 'running') ?? queued, [runs, queued]);
  const lastSeen = primary?.lastSeen ?? lastRun?.finishedAt;

  const onRunNow = useCallback(async () => {
    if (!primary) return;
    setBusy(true);
    setError(null);
    try {
      if (!user?.email) throw new Error('An authenticated user is required to request a scan.');
      const row = await requestScan(user.email);
      setQueued(row);
      await load({ current: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not queue a refresh.');
    } finally {
      setBusy(false);
    }
  }, [primary, user?.email, load]);

  return (
    <div className={styles.root}>
      <PageHeader
        icon={<Settings24Regular />}
        title="Settings"
        subtitle="The plumbing behind the catalog — the collection service, its identity and schedule, and the run ledger. Everything shown here is non-secret and read-only."
      />

      <div className={styles.content}>
        {loading ? (
          <PageLoadingSkeleton cards={4} rows={3} />
        ) : error && connectors.length === 0 ? (
          <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>
        ) : !primary ? (
          <div className={styles.center}>No collection connector is registered yet.</div>
        ) : (
          <>
            {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}

            {/* Collection status */}
            <div className={styles.statusGrid}>
              <Stat
                icon={<Clock20Regular />}
                label="Last scan"
                value={relTime(lastSeen)}
                sub={lastRun ? RUN_STATUS[lastRun.status]?.label : absTime(lastSeen)}
              />
              <Stat icon={<Database20Regular />} label="Assets ingested" value={String(primary.itemCount ?? 0)} sub="canonical items" />
              <Stat icon={<Clock20Regular />} label="Schedule" value={primary.schedule ?? 'On demand'} sub="collection cadence" />
              <Stat
                icon={<Flash20Regular />}
                label="Next run"
                value={pending ? 'Queued' : 'Scheduled'}
                sub={pending ? `by ${pending.requestedBy ?? 'operator'}` : 'awaiting cadence'}
              />
            </div>

            {/* Manual refresh */}
            <section className={styles.section}>
              <span className={styles.sectionTitle}>Manual refresh</span>
              <Card className={styles.card}>
                <div className={styles.refreshRow}>
                  <div className={styles.refreshCopy}>
                    <Text weight="semibold" size={400}>Run scan now</Text>
                    <Text size={200} className={styles.muted}>
                      Queues a collection request for <strong>{primary.displayName}</strong>. The scan runs headless on
                      Fabric Spark as the service principal and refreshes every catalog metric on completion.
                    </Text>
                  </div>
                  <Button
                    appearance="primary"
                    icon={<ArrowClockwise20Regular />}
                    disabled={busy || Boolean(pending)}
                    onClick={() => void onRunNow()}
                  >
                    {busy ? 'Queuing…' : pending ? 'Refresh queued' : 'Run scan now'}
                  </Button>
                </div>
                {pending && (
                  <MessageBar intent="info">
                    <MessageBarBody>
                      <MessageBarTitle>Refresh queued.</MessageBarTitle>
                      Recorded in the run ledger below. The collection tier picks it up on the next cycle
                      ({primary.schedule ?? 'scheduled'}); an operator can trigger the Spark Job for an immediate run.
                    </MessageBarBody>
                  </MessageBar>
                )}
              </Card>
            </section>

            {/* Service configuration */}
            <section className={styles.section}>
              <span className={styles.sectionTitle}>Service configuration</span>
              {collectors.map((cfg) => <ConfigCard key={cfg.source} cfg={cfg} />)}
            </section>

            {/* Run history */}
            <section className={styles.section}>
              <span className={styles.sectionTitle}>Run history</span>
              <Card className={styles.card}>
                {runs.length === 0 ? (
                  <Text size={200} className={styles.muted}>
                    No runs recorded yet. The ledger fills once the collection tier writes its next run.
                  </Text>
                ) : (
                  <div className={styles.table}>
                    <div className={styles.thead}>
                      <span>When</span><span>Trigger</span><span>Status</span><span>Assets</span><span>Detail</span>
                    </div>
                    {runs.map((r) => <RunRow key={r.id || r.canonicalId} r={r} />)}
                  </div>
                )}
              </Card>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  const styles = useStyles();
  return (
    <Card className={styles.statCard}>
      <div className={styles.statTop}>{icon}<Text size={200}>{label}</Text></div>
      <div className={styles.statValue}>{value}</div>
      {sub && <Text className={styles.statSub}>{sub}</Text>}
    </Card>
  );
}

function ConfigCard({ cfg }: { cfg: ServiceConfig }) {
  const styles = useStyles();
  const url = sourceIconUrl(cfg.source);
  const rows: Array<{ icon: React.ReactNode; label: string; value?: string }> = [
    // Secretless (delegated-identity) connectors publish authMode/runsAs; legacy
    // SP+Key Vault connectors publish servicePrincipal/keyVault instead.
    cfg.authMode
      ? { icon: <Key20Regular />, label: 'Authentication', value: cfg.authMode }
      : { icon: <Person20Regular />, label: 'Service principal', value: cfg.servicePrincipal },
    cfg.runsAs
      ? { icon: <Person20Regular />, label: 'Runs as', value: cfg.runsAs }
      : { icon: <Key20Regular />, label: 'Key Vault', value: cfg.keyVault && cfg.secretName ? `${cfg.keyVault} / ${cfg.secretName}` : cfg.keyVault },
    { icon: <Database20Regular />, label: 'Lakehouse', value: cfg.lakehouse },
    { icon: <Server20Regular />, label: 'Spark Job', value: cfg.sparkJob },
    { icon: <Flash20Regular />, label: 'Capacity', value: cfg.capacity },
    { icon: <Building20Regular />, label: 'Workspace', value: cfg.workspace },
    { icon: <Clock20Regular />, label: 'Schedule', value: cfg.schedule },
  ];
  return (
    <Card className={styles.card}>
      <div className={styles.cfgHead}>
        <span className={styles.cfgIcon}>{url ? <img src={url} width={22} height={22} alt="" /> : <BranchFork20Regular />}</span>
        <div>
          <Text weight="semibold" size={400}>{cfg.displayName}</Text>
          <div><Badge appearance="tint" color="success">Connected</Badge></div>
        </div>
      </div>
      <Divider />
      <div className={styles.defList}>
        {rows.map((row) => (
          <div key={row.label} className={styles.defRow}>
            <span className={styles.defIcon}>{row.icon}</span>
            <span className={styles.defLabel}>{row.label}</span>
            <span className={styles.defValue}>{row.value ?? <span className={styles.muted}>—</span>}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function RunRow({ r }: { r: ScanRunRow }) {
  const styles = useStyles();
  const st = RUN_STATUS[r.status] ?? RUN_STATUS.requested;
  const when = r.finishedAt ?? r.startedAt ?? r.requestedAt ?? r.firstSeen;
  let detail = r.message ?? '';
  if (r.message) {
    try {
      const parsed = JSON.parse(r.message);
      if (parsed && typeof parsed === 'object') {
        detail = Object.entries(parsed).map(([k, v]) => `${k} ${v}`).join(' · ');
      }
    } catch {
      /* plain message */
    }
  }
  return (
    <div className={styles.trow}>
      <span title={absTime(when)}>{absTime(when)}</span>
      <span style={{ textTransform: 'capitalize' }}>{r.trigger}</span>
      <span><Badge appearance="tint" color={st.color}>{st.label}</Badge></span>
      <span>{r.itemsWritten ?? '—'}</span>
      <span className={styles.mono}>{detail || (r.requestedBy ? `requested by ${r.requestedBy}` : '—')}</span>
    </div>
  );
}
