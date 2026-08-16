export const NO_NEXT_PAGE = 0;

export function nextPageAfter(current: number, totalPages: number): number {
  return current < totalPages ? current + 1 : NO_NEXT_PAGE;
}
