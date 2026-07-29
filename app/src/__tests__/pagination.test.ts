import { describe, expect, it } from 'vitest';

import { paginate } from '@/lib/pagination';

describe('paginate', () => {
  it('returns a bounded window and display bounds', () => {
    const result = paginate(Array.from({ length: 225 }, (_, index) => index), 1, 100);
    expect(result).toMatchObject({ page: 1, totalPages: 3, start: 101, end: 200 });
    expect(result.items).toHaveLength(100);
  });

  it('clamps a page after filtering shrinks the result set', () => {
    const result = paginate(['a', 'b'], 9, 100);
    expect(result).toEqual({ items: ['a', 'b'], page: 0, totalPages: 1, start: 1, end: 2 });
  });
});