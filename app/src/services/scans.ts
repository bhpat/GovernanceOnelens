import { getRayfinClient, isLocalBackend } from './rayfinClient';
import type { ConnectorRow } from './connectors';

/** A row from the collection-tier run ledger / request queue (see ScanRun entity). */
export interface ScanRunRow {
  id: string;
  canonicalId: string;
  source: string;
  status: string;
  trigger: string;
  requestedBy?: string;
  message?: string;
  itemsWritten?: number;
  requestedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  firstSeen?: string;
  lastSeen?: string;
}

const SCANRUN_FIELDS = [
  'id',
  'canonicalId',
  'source',
  'status',
  'trigger',
  'requestedBy',
  'message',
  'itemsWritten',
  'requestedAt',
  'startedAt',
  'finishedAt',
  'firstSeen',
  'lastSeen',
] as const;

/**
 * Read a bounded slice of the run ledger, newest first. Local development has
 * no scanner ledger; production failures are allowed to surface to the page.
 */
export async function getScanRuns(limit = 25): Promise<ScanRunRow[]> {
  if (isLocalBackend()) return [];
  const pageSize = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const client = getRayfinClient();
  const rows = (await client.data.ScanRun
    .select([...SCANRUN_FIELDS])
    .orderBy({ firstSeen: 'desc' })
    .first(pageSize)
    .execute()) as unknown as ScanRunRow[];
  return rows.sort((a, b) => tsOf(b) - tsOf(a));
}

function tsOf(r: ScanRunRow): number {
  const v = r.finishedAt ?? r.startedAt ?? r.requestedAt ?? r.firstSeen;
  return v ? new Date(v).getTime() : 0;
}

/**
 * Queue a manual refresh. The only client write in the schema: creates a
 * `requested` ScanRun that the next collection cycle fulfills. Returns the new row.
 */
export async function requestScan(requestedBy: string): Promise<ScanRunRow> {
  const client = getRayfinClient();
  const now = new Date();
  const created = await client.data.ScanRun.create({
    canonicalId: `scanrun:request:${now.getTime()}`,
    source: 'fabric',
    status: 'requested',
    trigger: 'manual',
    requestedBy,
    requestedAt: now,
    firstSeen: now,
    lastSeen: now,
  });
  return created as unknown as ScanRunRow;
}

/** The operational configuration behind a collection connector (rendered on Settings). */
export interface ServiceConfig {
  source: string;
  displayName: string;
  workspace?: string;
  authMode?: string;
  runsAs?: string;
  keyVault?: string;
  secretName?: string;
  servicePrincipal?: string;
  lakehouse?: string;
  sparkJob?: string;
  capacity?: string;
  schedule?: string;
  status: string;
  itemCount?: number;
  lastSeen?: string;
}

/**
 * Derive the service config for a collection connector. Non-secret plumbing
 * (SP, Key Vault, lakehouse, Spark Job, capacity) is published by the scanner
 * into the connector's `scope` JSON on each run; the KV + workspace come from the
 * `credentialRef` / `endpoint` fields. Nothing here is a secret.
 */
export function deriveServiceConfig(c: ConnectorRow): ServiceConfig {
  let scope: Record<string, unknown> = {};
  if (c.scope) {
    try {
      const v = JSON.parse(c.scope);
      if (v && typeof v === 'object') scope = v as Record<string, unknown>;
    } catch {
      /* scope may be a plain string on older rows */
    }
  }
  const [kv, secret] = (c.credentialRef ?? '').split('/');
  const s = (k: string): string | undefined => {
    const v = scope[k];
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  };
  return {
    source: c.source,
    displayName: c.displayName,
    workspace: s('workspace') ?? c.endpoint,
    authMode: s('authMode'),
    runsAs: s('runsAs'),
    keyVault: s('keyVault') ?? (kv || undefined),
    secretName: s('secretName') ?? (secret || undefined),
    servicePrincipal: s('servicePrincipal'),
    lakehouse: s('lakehouse'),
    sparkJob: s('sparkJob'),
    capacity: s('capacity'),
    schedule: c.schedule,
    status: c.status,
    itemCount: c.itemCount,
    lastSeen: c.lastSeen,
  };
}
