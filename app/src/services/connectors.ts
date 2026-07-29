import { getRayfinClient, isLocalBackend, fetchAll } from './rayfinClient';
import { cachedQuery } from './queryCache';

/**
 * A registered governance connector (the pluggable-source registry).
 *
 * Rows are written by the scanner/runner (self-registration) via the locked
 * direct-SQL MERGE path; the app reads them to render the Connectors gallery and
 * to drive source-scoped drill-throughs. Adding a source = install a package +
 * insert one row — no schema or app change (see knowledge-base/10-connector-sdk.md).
 */
export interface ConnectorRow {
  id: string;
  canonicalId: string;
  source: string;
  /** `platform` | `collection` | `analysis`. */
  kind: string;
  displayName: string;
  description?: string;
  /** `connected` | `available` | `planned` | `error`. */
  status: string;
  endpoint?: string;
  credentialRef?: string;
  scope?: string;
  schedule?: string;
  cursor?: string;
  /** JSON array string of capability tokens. */
  capabilities?: string;
  itemCount?: number;
  firstSeen?: string;
  lastSeen?: string;
}

const CONNECTOR_FIELDS = [
  'id',
  'canonicalId',
  'source',
  'kind',
  'displayName',
  'description',
  'status',
  'endpoint',
  'credentialRef',
  'scope',
  'schedule',
  'cursor',
  'capabilities',
  'itemCount',
  'firstSeen',
  'lastSeen',
] as const;

export async function getConnectors(): Promise<ConnectorRow[]> {
  if (isLocalBackend()) return [];
  return cachedQuery('operations:connectors', async () => {
    const client = getRayfinClient();
    const rows = await fetchAll(client.data.Connector.select([...CONNECTOR_FIELDS]));
    return rows as unknown as ConnectorRow[];
  });
}

/** Parse the JSON capabilities array; tolerant of null/malformed values. */
export function parseCapabilities(raw?: string): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/** Human labels for the capability tokens a connector can declare. */
export const CAPABILITY_LABELS: Record<string, string> = {
  items: 'Items',
  workspaces: 'Workspaces',
  domains: 'Domains',
  roles: 'Roles',
  lineage: 'Lineage',
  columnLineage: 'Column lineage',
  classifications: 'Classifications',
  activity: 'Activity',
  posture: 'Posture',
  incremental: 'Incremental',
  nlQuery: 'Natural language Q&A',
};

/** Human labels for the skill kinds. */
export const KIND_LABELS: Record<string, string> = {
  platform: 'Platform',
  collection: 'Collection',
  analysis: 'Analysis',
};
