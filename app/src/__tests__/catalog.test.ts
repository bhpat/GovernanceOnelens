import { describe, expect, it } from 'vitest';

import { daysSince, isStale, ITEM_GAP_FILTERS, parseTags } from '@/services/catalog';

describe('parseTags', () => {
  it('parses a JSON array string', () => {
    expect(parseTags('["a","b"]')).toEqual(['a', 'b']);
  });

  it('returns [] for undefined/empty input', () => {
    expect(parseTags(undefined)).toEqual([]);
    expect(parseTags('')).toEqual([]);
  });

  it('falls back to comma-splitting malformed JSON rather than throwing', () => {
    expect(parseTags('a, b, c')).toEqual(['a', 'b', 'c']);
  });

  it('never throws on garbage input', () => {
    expect(() => parseTags('{not json')).not.toThrow();
  });
});

describe('daysSince / isStale', () => {
  it('computes whole days elapsed since an ISO timestamp', () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString();
    expect(daysSince(tenDaysAgo)).toBe(10);
  });

  it('returns undefined for missing/unparseable input', () => {
    expect(daysSince(undefined)).toBeUndefined();
    expect(daysSince('not-a-date')).toBeUndefined();
  });

  it('flags an item unmodified for over 90 days as stale', () => {
    const old = new Date(Date.now() - 91 * 86_400_000).toISOString();
    expect(isStale({ modifiedDate: old } as never)).toBe(true);
  });

  it('does not flag a recently modified item as stale', () => {
    const recent = new Date(Date.now() - 1 * 86_400_000).toISOString();
    expect(isStale({ modifiedDate: recent } as never)).toBe(false);
  });

  it('exposes stale items as a catalog gap filter', () => {
    const old = new Date(Date.now() - 91 * 86_400_000).toISOString();
    expect(ITEM_GAP_FILTERS.staleItems.predicate({ modifiedDate: old } as never)).toBe(true);
  });
});
