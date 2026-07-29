import { getRayfinClient, isLocalBackend, fetchAll } from './rayfinClient';
import { cachedQuery } from './queryCache';

/** A governed asset surfaced in the catalog (the discovery view of Item). */
export interface CatalogItem {
  id: string;
  canonicalId: string;
  source: string;
  name: string;
  itemType: string;
  workspaceCanonicalId?: string;
  domainCanonicalId?: string;
  description?: string;
  owner?: string;
  endorsement?: string;
  /** JSON array string of tags. */
  tags?: string;
  sensitivityLabel?: string;
  deepLink?: string;
  firstSeen?: string;
  createdDate?: string;
  modifiedDate?: string;
  modifiedBy?: string;
  refreshStatus?: string;
  lastRefresh?: string;
  sizeBytes?: number;
  tableCount?: number;
  columnCount?: number;
}

const ITEM_FIELDS = [
  'id',
  'canonicalId',
  'source',
  'name',
  'itemType',
  'workspaceCanonicalId',
  'domainCanonicalId',
  'description',
  'owner',
  'endorsement',
  'tags',
  'sensitivityLabel',
  'deepLink',
  'firstSeen',
  'createdDate',
  'modifiedDate',
  'modifiedBy',
  'refreshStatus',
  'lastRefresh',
  'sizeBytes',
  'tableCount',
  'columnCount',
] as const;

/**
 * Reads the governance catalog via the policy-gated generated GraphQL API.
 *
 * Scanners populate Items through the locked direct-SQL MERGE path; the app is
 * read-only. Phase 1 filters client-side over the fetched set (hundreds of
 * items); server-side search is a later optimization. In local-dev mode this
 * returns an empty catalog until a scan has run.
 */
export async function getItems(): Promise<CatalogItem[]> {
  if (isLocalBackend()) {
    return [];
  }

  return cachedQuery('catalog:items', async () => {
    const client = getRayfinClient();
    const results = await fetchAll(client.data.Item.select([...ITEM_FIELDS]).orderBy({ name: 'asc' }));

  // GraphQL serializes date fields (firstSeen) as ISO strings at runtime, though
  // the generated entity type declares them as Date. Normalize explicitly here
  // instead of trusting a blind cast, so a future shape change is a visible
  // string coercion rather than a silently reintroduced Date-vs-string bug.
    const items = (results as unknown as Record<string, unknown>[]).map((r) => ({
      ...r,
      firstSeen: r.firstSeen != null ? String(r.firstSeen) : undefined,
    })) as CatalogItem[];
    return items;
  });
}

/** Minimal workspace reference for name lookups + domain linking. */
export interface WorkspaceRef {
  canonicalId: string;
  name: string;
  type?: string;
  state?: string;
  domainCanonicalId?: string;
}

export async function getWorkspaces(): Promise<WorkspaceRef[]> {
  if (isLocalBackend()) return [];
  return cachedQuery('catalog:workspaces', async () => {
    const client = getRayfinClient();
    const rows = await fetchAll(client.data.Workspace.select([
      'canonicalId',
      'name',
      'type',
      'state',
      'domainCanonicalId',
    ]));
    return rows as WorkspaceRef[];
  });
}

/** Minimal domain reference for name lookups. */
export interface DomainRef {
  canonicalId: string;
  name: string;
}

export async function getDomains(): Promise<DomainRef[]> {
  if (isLocalBackend()) return [];
  return cachedQuery('catalog:domains', async () => {
    const client = getRayfinClient();
    const rows = await fetchAll(client.data.Domain.select(['canonicalId', 'name']));
    return rows as DomainRef[];
  });
}

/**
 * Item-level coverage gaps — the bridge that lets a coverage metric on the
 * Observability page drill into the exact offending items in the Catalog.
 */
export const ITEM_GAP_FILTERS: Record<
  string,
  { label: string; predicate: (i: CatalogItem) => boolean }
> = {
  sensitivityLabeled: {
    label: 'Missing a sensitivity label',
    predicate: (i) => !i.sensitivityLabel,
  },
  endorsed: {
    label: 'Not endorsed',
    predicate: (i) => !i.endorsement || i.endorsement === 'None',
  },
  described: {
    label: 'Missing a description',
    predicate: (i) => !i.description,
  },
  owned: {
    label: 'Missing an owner',
    predicate: (i) => !i.owner,
  },
  staleItems: {
    label: 'Not modified in over 90 days',
    predicate: (i) => isStale(i),
  },
};

/** Days since an ISO timestamp, or undefined when unparseable/absent. */
export function daysSince(iso?: string): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return undefined;
  return Math.floor((Date.now() - t) / 86_400_000);
}

/** An item is "stale" when it hasn't been modified in over 90 days. */
export function isStale(i: CatalogItem): boolean {
  const d = daysSince(i.modifiedDate);
  return d !== undefined && d > 90;
}

/** Parse the stored tags JSON array string into a string[] (best-effort). */
export function parseTags(tags?: string): string[] {
  if (!tags) return [];
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }
}
