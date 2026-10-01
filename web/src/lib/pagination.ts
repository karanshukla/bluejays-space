export const NO_NEXT_PAGE = 0;

// null for anything that isn't a page number, including one so large its OFFSET
// would fall outside what Postgres or a JS number can represent exactly.
export function parsePage(raw: string | null, pageSize: number): number | null {
  if (!raw) return 1;
  const page = Number(raw);
  if (!Number.isInteger(page) || page < 1 || !Number.isSafeInteger(page * pageSize)) return null;
  return page;
}

export function nextPageAfter(current: number, totalPages: number): number {
  return current < totalPages ? current + 1 : NO_NEXT_PAGE;
}
