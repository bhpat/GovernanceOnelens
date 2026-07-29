export interface PageSlice<T> {
  items: T[];
  page: number;
  totalPages: number;
  start: number;
  end: number;
}

/** Return a clamped zero-based page and its one-based display bounds. */
export function paginate<T>(items: T[], requestedPage: number, pageSize: number): PageSlice<T> {
  const safePageSize = Math.max(1, Math.trunc(pageSize));
  const totalPages = Math.max(1, Math.ceil(items.length / safePageSize));
  const page = Math.min(Math.max(0, Math.trunc(requestedPage)), totalPages - 1);
  const offset = page * safePageSize;
  const pageItems = items.slice(offset, offset + safePageSize);
  return {
    items: pageItems,
    page,
    totalPages,
    start: items.length === 0 ? 0 : offset + 1,
    end: offset + pageItems.length,
  };
}