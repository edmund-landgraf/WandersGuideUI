// Fetch small, monotonically ordered catalog pages with the caller's existing
// authorization. Do not retain Postgres search vectors in the rules package.
export const SLIM_CATALOG_PAGE_SIZE = 200;

export async function collectSlimCatalogPages<T extends { id: number; search_tsv?: unknown }>(
  readPage: (afterId: number | null, limit: number) => Promise<T[]>,
  pageSize = SLIM_CATALOG_PAGE_SIZE,
): Promise<T[]> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) throw new Error('Invalid catalog page size');
  const rows: T[] = [];
  let cursor: number | null = null;
  for (;;) {
    const page = await readPage(cursor, pageSize);
    if (!Array.isArray(page) || page.length > pageSize) throw new Error('Invalid slim catalog page');
    if (!page.length) return rows;
    for (const row of page) {
      if (!Number.isSafeInteger(row.id) || (cursor !== null && row.id <= cursor)) {
        throw new Error('Catalog pagination did not advance by id');
      }
      cursor = row.id;
      // This is a fresh database response owned by this request, not shared cache data.
      delete row.search_tsv;
      rows.push(row);
    }
    // Keep going until an empty page: a server-side row cap can be below our limit.
  }
}
