import type { RowRange, ServerSpec } from "@/registry/default/blocks/data-grid/data-grid";

/** Largest row count the server contract accepts; a bigger count clamps to it. */
export const MAX_ROW_COUNT = 10_000_000;

/** What `fetchRows` receives in every mode. */
export type ServerRowsRequest<TCursor = never> = {
  /** The sort, filter, and search of this request. */
  spec: ServerSpec;
  /** Index of the first requested row in the result. */
  start: number;
  /** One past the last requested row; `end - start` is the limit. */
  end: number;
  /** Sequential scroll only: the `nextCursor` of the block before; `undefined` for the first block and for every other source. */
  cursor: TCursor | undefined;
  /** Aborted when a newer request replaces this one, on a spec change, and on unmount. */
  signal: AbortSignal;
};

/** Pages mode adds the page address; `start` is `(page - 1) * pageSize`. */
export type ServerRowsPageRequest = ServerRowsRequest & {
  /** 1-based page. */
  page: number;
  pageSize: number;
};

/** What `fetchRows` resolves with in every mode. */
export type ServerRowsAnswer<TData, TCursor = never> = {
  /** At most `end - start` rows, in order from `start`; extra rows are dropped with a development warning. A repeated row id keeps its first row. */
  rows: TData[];
  /** Row count of the result. Omitted keeps the last known count; `null` declares it unknown. */
  totalRowCount?: number | null;
  /** Rows exist after this block. Default: the block came back full. Ignored when a count is known. */
  hasMore?: boolean;
  /** Cursor sources: passed back as `cursor`. `null` ends the source. */
  nextCursor?: TCursor | null;
};

/** An answer after validation. */
export type ReadAnswer<TData, TCursor = never> = {
  rows: TData[];
  /** `undefined` keeps the last known count. */
  totalRowCount: number | null | undefined;
  hasMore: boolean;
  /** The `hasMore` the answer carried, if any. */
  hasMoreSent: boolean | undefined;
  nextCursor: TCursor | null | undefined;
};

/**
 * Validates an untrusted answer: `rows` must be an array and is cut to the requested size, `totalRowCount` must be a
 * non-negative safe integer (else unknown) and clamps to {@link MAX_ROW_COUNT}. Throws when the answer has no rows array.
 */
export function readAnswer<TData, TCursor = never>(
  answer: unknown,
  range: RowRange,
  warn: (kind: string, message: string) => void,
  idOf?: (row: TData, index: number) => string,
): ReadAnswer<TData, TCursor> {
  const raw = answer as Partial<ServerRowsAnswer<TData, TCursor>> | null | undefined;
  if (!Array.isArray(raw?.rows)) throw new TypeError("fetchRows of useDataGridServerRows must resolve with { rows: TData[] }");
  const limit = range.end - range.start;
  let rows = raw.rows;
  if (rows.length > limit) {
    warn("long", `fetchRows returned ${rows.length} rows for a request of ${limit}; only the first ${limit} are used`);
    rows = rows.slice(0, limit);
  }
  const legacy = raw as { total?: unknown; hasNextPage?: unknown };
  if (("total" in legacy && !("totalRowCount" in raw)) || "hasNextPage" in legacy) {
    warn("legacy", "the answer of fetchRows uses `total` or `hasNextPage`; rename them to `totalRowCount` and `hasMore`");
  }
  let totalRowCount: number | null | undefined;
  if (raw.totalRowCount === undefined) totalRowCount = undefined;
  else if (raw.totalRowCount === null) totalRowCount = null;
  else if (typeof raw.totalRowCount === "number" && Number.isSafeInteger(raw.totalRowCount) && raw.totalRowCount >= 0) {
    totalRowCount = Math.min(raw.totalRowCount, MAX_ROW_COUNT);
    if (totalRowCount !== raw.totalRowCount) warn("count", `totalRowCount ${raw.totalRowCount} is above ${MAX_ROW_COUNT}; using ${MAX_ROW_COUNT}`);
  } else {
    totalRowCount = null;
    warn("count", "totalRowCount must be a non-negative integer or null; treating the count as unknown");
  }
  const full = rows.length === limit;
  if (idOf) rows = firstCopies(rows, idOf, range.start, warn);
  return {
    rows,
    totalRowCount,
    hasMore: typeof raw.hasMore === "boolean" ? raw.hasMore : full,
    hasMoreSent: typeof raw.hasMore === "boolean" ? raw.hasMore : undefined,
    nextCursor: raw.nextCursor,
  };
}

/** Keeps the first row of each id, so one answer never puts the same id twice into the grid. */
function firstCopies<TData>(rows: TData[], idOf: (row: TData, index: number) => string, start: number, warn: (kind: string, message: string) => void): TData[] {
  const seen = new Set<string>();
  const kept: TData[] = [];
  rows.forEach((row, index) => {
    const id = idOf(row, start + index);
    if (seen.has(id)) return;
    seen.add(id);
    kept.push(row);
  });
  if (kept.length < rows.length) warn("duplicate", "fetchRows returned a duplicate row id; only the first row of each id is used, so make the sort total (add the row id as a last sort key)");
  return kept;
}
