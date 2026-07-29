interface QueryCacheEntry<T> {
  expiresAt: number;
  value?: T;
  promise?: Promise<T>;
}

const DEFAULT_TTL_MS = 30_000;
const entries = new Map<string, QueryCacheEntry<unknown>>();

/** Share concurrent reads and briefly reuse successful governance snapshots. */
export function cachedQuery<T>(key: string, load: () => Promise<T>, ttlMs = DEFAULT_TTL_MS): Promise<T> {
  const now = Date.now();
  const existing = entries.get(key) as QueryCacheEntry<T> | undefined;
  if (existing?.promise) return existing.promise;
  if (existing?.value !== undefined && existing.expiresAt > now) return Promise.resolve(existing.value);

  const promise = load().then(
    (value) => {
      entries.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    },
    (error: unknown) => {
      if ((entries.get(key) as QueryCacheEntry<T> | undefined)?.promise === promise) entries.delete(key);
      throw error;
    },
  );
  entries.set(key, { promise, expiresAt: now + ttlMs });
  return promise;
}

/** Prevent governance data from surviving an authenticated-user transition. */
export function clearQueryCache(): void {
  entries.clear();
}