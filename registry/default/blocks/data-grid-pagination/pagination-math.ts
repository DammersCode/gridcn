/** Total pages for `total` rows at `pageSize` per page — at least 1 even when `total` is 0 (an empty grid still shows "page 1"). */
export function pageCount(total: number, pageSize: number): number {
  if (pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Clamps `page` (1-based) into `[1, pageCount(total, pageSize)]` — the fallback when data shrinks or pageSize changes out from under the current page. */
export function clampPage(page: number, total: number, pageSize: number): number {
  return Math.min(Math.max(1, Math.floor(page)), pageCount(total, pageSize));
}

/** Half-open `[start, end)` row range for `page` (1-based) at `pageSize`, clamped to `total`. */
export function pageRange(page: number, pageSize: number, total: number): { start: number; end: number } {
  const start = Math.min((page - 1) * pageSize, total);
  const end = Math.min(start + pageSize, total);
  return { start, end };
}

/**
 * Windowed page numbers for the footer, e.g. page 7 of 20 with windowSize 5 -> [5,6,7,8,9].
 * The window slides to stay centered on `page` but clamps at both ends so it never runs past
 * `[1, pageCount]` or shows fewer than `windowSize` numbers when there's room for that many.
 */
export function pageWindow(page: number, pageCount: number, windowSize: number): number[] {
  if (pageCount <= 0) return [];
  const size = Math.max(1, Math.min(windowSize, pageCount));
  let start = page - Math.floor(size / 2);
  start = Math.max(1, Math.min(start, pageCount - size + 1));
  return Array.from({ length: size }, (_, i) => start + i);
}
