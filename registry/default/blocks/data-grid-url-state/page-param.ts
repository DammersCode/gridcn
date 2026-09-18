/** Default `pageSize` when {@link UseDataGridUrlPaginationOptions.defaultPageSize} is not given. */
export const DEFAULT_URL_PAGE_SIZE = 25;

/**
 * URL encoding for the 1-based `page` number: the plain decimal string, omitted entirely when
 * `page` is 1 (the default), matching `join`'s omit-at-default convention.
 *
 * @example serializePage(1) // => "" (the default; omitted from the URL)
 * @example serializePage(3) // => "3"
 */
export function serializePage(page: number): string {
  return page <= 1 ? "" : String(page);
}

/**
 * Inverse of {@link serializePage}. Anything that isn't a positive integer (absent, empty,
 * negative, fractional, hand-edited garbage) parses as `1` — never throws.
 *
 * @example parsePage("3") // => 3
 * @example parsePage("") // => 1
 * @example parsePage("garbage") // => 1
 */
export function parsePage(raw: string): number {
  const n = Number(raw);
  return raw !== "" && Number.isInteger(n) && n >= 1 ? n : 1;
}

/**
 * URL encoding for `pageSize`: the plain decimal string, omitted when it equals `defaultPageSize`.
 *
 * @example serializePageSize(25, 25) // => "" (matches the default; omitted from the URL)
 * @example serializePageSize(50, 25) // => "50"
 */
export function serializePageSize(pageSize: number, defaultPageSize: number): string {
  return pageSize === defaultPageSize ? "" : String(pageSize);
}

/**
 * Inverse of {@link serializePageSize}. Falls back to `defaultPageSize` for anything that isn't a
 * positive integer. When `allowedSizes` is given, a parsed value outside that list also falls back
 * to `defaultPageSize` — the URL cannot force a page size the consumer didn't offer.
 *
 * @example parsePageSize("50", 25) // => 50
 * @example parsePageSize("", 25) // => 25
 * @example parsePageSize("999", 25, [10, 25, 50]) // => 25 (not in the allowed list)
 */
export function parsePageSize(raw: string, defaultPageSize: number, allowedSizes?: readonly number[]): number {
  const n = Number(raw);
  if (raw === "" || !Number.isInteger(n) || n < 1) return defaultPageSize;
  if (allowedSizes && !allowedSizes.includes(n)) return defaultPageSize;
  return n;
}
