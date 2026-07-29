import { RayfinClient } from '@microsoft/rayfin-client';

import type { AppSchema } from '../../rayfin/data/schema';

export interface RayfinClientConfig {
  baseUrl: string;
  publishableKey: string;
  /** True when the API URL points at localhost. Exposed via {@link isLocalBackend}. */
  localDev: boolean;
}

let client: RayfinClient<AppSchema> | null = null;
let localDev = false;

export function initRayfinClient(
  config: RayfinClientConfig
): RayfinClient<AppSchema> {
  if (client) {
    throw new Error('Rayfin client is already initialized.');
  }
  client = new RayfinClient<AppSchema>({
    baseUrl: config.baseUrl,
    publishableKey: config.publishableKey,
    useProxy: false,
    authStorage: true,
  });
  localDev = config.localDev;
  return client;
}

export function getRayfinClient(): RayfinClient<AppSchema> {
  if (!client) {
    throw new Error(
      'Rayfin client not initialized. Call bootstrapAuth() first.'
    );
  }
  return client;
}

/** True when the app was bootstrapped against a localhost backend. */
export function isLocalBackend(): boolean {
  return localDev;
}

/**
 * Minimal shape of a Rayfin query builder that supports cursor pagination.
 * `.execute()` returns only the first page (DAB default 100), which silently
 * truncates large collections — always use {@link fetchAll} for list reads.
 */
interface PageBuilder<T> {
  executePaginated(): Promise<{ items: T[]; hasNextPage: boolean; endCursor?: string }>;
  after(cursor: string): PageBuilder<T>;
}

/** Safety net against a stuck/looping cursor (a server-side pagination bug) —
 * a real collection should never come close to this many 100-row pages. Without
 * this, a broken `hasNextPage`/`endCursor` pair would hang the caller forever. */
const MAX_FETCH_ALL_PAGES = 500;

/** Drain every page of a query builder into a single array (no 100-row cap). */
export async function fetchAll<T>(builder: PageBuilder<T>): Promise<T[]> {
  const out: T[] = [];
  const seenCursors = new Set<string>();
  let page = await builder.executePaginated();
  out.push(...page.items);
  let pages = 1;
  while (page.hasNextPage) {
    const cursor = page.endCursor;
    if (!cursor) {
      throw new Error('fetchAll received hasNextPage=true without an endCursor.');
    }
    if (seenCursors.has(cursor)) {
      throw new Error(`fetchAll received a repeated pagination cursor: ${cursor}`);
    }
    seenCursors.add(cursor);
    if (pages >= MAX_FETCH_ALL_PAGES) {
      throw new Error(`fetchAll exceeded ${MAX_FETCH_ALL_PAGES} pages — possible stuck pagination cursor.`);
    }
    pages += 1;
    page = await builder.after(cursor).executePaginated();
    out.push(...page.items);
  }
  return out;
}
