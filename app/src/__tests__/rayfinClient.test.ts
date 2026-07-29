import { describe, expect, it, vi } from 'vitest';

import { fetchAll } from '@/services/rayfinClient';

interface TestRow {
  id: string;
}

function pagedBuilder(...pages: Array<{ items: TestRow[]; hasNextPage: boolean; endCursor?: string }>) {
  const executePaginated = vi.fn();
  for (const page of pages) executePaginated.mockResolvedValueOnce(page);

  const after = vi.fn();
  const builder = { executePaginated, after };
  after.mockReturnValue(builder);
  return builder;
}

describe('fetchAll', () => {
  it('drains every page in order', async () => {
    const builder = pagedBuilder(
      { items: [{ id: 'a' }], hasNextPage: true, endCursor: 'cursor-1' },
      { items: [{ id: 'b' }], hasNextPage: false },
    );

    await expect(fetchAll(builder)).resolves.toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(builder.after).toHaveBeenCalledWith('cursor-1');
  });

  it('rejects a next page without an end cursor', async () => {
    const builder = pagedBuilder({ items: [{ id: 'a' }], hasNextPage: true });

    await expect(fetchAll(builder)).rejects.toThrow('without an endCursor');
    expect(builder.after).not.toHaveBeenCalled();
  });

  it('rejects a repeated cursor before requesting another page', async () => {
    const builder = pagedBuilder(
      { items: [{ id: 'a' }], hasNextPage: true, endCursor: 'cursor-1' },
      { items: [{ id: 'b' }], hasNextPage: true, endCursor: 'cursor-1' },
    );

    await expect(fetchAll(builder)).rejects.toThrow('repeated pagination cursor');
    expect(builder.after).toHaveBeenCalledTimes(1);
  });
});