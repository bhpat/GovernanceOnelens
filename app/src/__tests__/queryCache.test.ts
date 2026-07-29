import { beforeEach, describe, expect, it, vi } from 'vitest';

import { cachedQuery, clearQueryCache } from '@/services/queryCache';

beforeEach(() => {
  clearQueryCache();
  vi.useRealTimers();
});

describe('cachedQuery', () => {
  it('shares an in-flight request and reuses its successful value', async () => {
    const load = vi.fn(async () => ['row']);
    const first = cachedQuery('items', load);
    const second = cachedQuery('items', load);

    await expect(Promise.all([first, second])).resolves.toEqual([['row'], ['row']]);
    await expect(cachedQuery('items', load)).resolves.toEqual(['row']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('evicts a rejected request so a retry can run', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce(['recovered']);

    await expect(cachedQuery('items', load)).rejects.toThrow('temporary');
    await expect(cachedQuery('items', load)).resolves.toEqual(['recovered']);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('expires successful values after the configured TTL', async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => Date.now());
    const first = await cachedQuery('items', load, 1000);
    await vi.advanceTimersByTimeAsync(1001);
    const second = await cachedQuery('items', load, 1000);

    expect(second).toBeGreaterThan(first);
    expect(load).toHaveBeenCalledTimes(2);
  });
});