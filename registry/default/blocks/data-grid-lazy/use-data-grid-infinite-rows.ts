"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { applyChange, serverSpecKey, type DataChange, type RowRange, type ServerSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { EMPTY_SERVER_SPEC, holeRowId, isDev } from "@/registry/default/blocks/data-grid/data-grid-sdk";

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_OVERSCAN = 30;

/** What `fetchRows` of {@link useDataGridInfiniteRows} receives. */
export type InfiniteFetchContext<TCursor> = {
  /** The `nextCursor` of the previous page; `undefined` for the first page. */
  cursor: TCursor | undefined;
  /** Position of the first requested row in the grid (the number of rows loaded so far). */
  start: number;
  /** Rows to ask for: `pageSize`, capped by `maxFetchRows`. The server may return fewer or more. */
  limit: number;
  signal: AbortSignal;
  /** The sort, filter, and search that were current when the request started. */
  spec: ServerSpec;
};

/** What `fetchRows` of {@link useDataGridInfiniteRows} resolves with. */
export type InfiniteFetchResult<TData, TCursor> = {
  rows: TData[];
  /** `null` ends the source. Any other value, including `0`, means more rows exist and is passed back as `cursor`. */
  nextCursor: TCursor | null;
};

/** Options for {@link useDataGridInfiniteRows}. */
export type UseDataGridInfiniteRowsOptions<TData, TCursor = unknown> = {
  /** Fetches the page after `cursor`. A rejection or a non-array `rows` calls `onError` and stops the chain until the window next reports. */
  fetchRows: (ctx: InfiniteFetchContext<TCursor>) => Promise<InfiniteFetchResult<TData, TCursor>>;
  getRowId: (row: TData, index: number) => string;
  /** The sort, filter, and search of your request, handed back to `fetchRows`. A change of its content resets the hook like `reset()`. */
  spec?: ServerSpec;
  /** Rows requested per fetch, and skeleton rows shown below the loaded rows while more exist. Default 50. */
  pageSize?: number;
  /** A fetch starts when the rendered window comes within this many rows of the loaded end. Default 30. */
  overscan?: number;
  /** Caps `limit` per fetch. Values below 1 are treated as 1. Default: no cap. */
  maxFetchRows?: number;
  /** Fired when a fetch fails. */
  onError?: (error: unknown) => void;
  /** Fired after a page is merged, with the range it filled. */
  onLoaded?: (range: RowRange) => void;
};

/** Return value of {@link useDataGridInfiniteRows}. */
export type UseDataGridInfiniteRowsResult<TData> = {
  /** Spread onto `<DataGrid />`. `data` is sparse: the last `pageSize` rows are holes while `hasNextPage`. */
  gridProps: {
    data: readonly TData[];
    getRowId: (row: TData, index: number) => string;
    onRenderedRowsChange: (range: RowRange) => void;
    /** The final count once the source ended, else `null`, so the provider needs no second count. */
    totalRowCount: number | null;
    keepCheckedRows: true;
  };
  /** Pass as `onDataChange`. Edits, inserts, and deletes of loaded rows merge into the loaded rows. */
  onDataChange: (next: readonly TData[], change: DataChange<TData>) => void;
  /** `undefined` while `hasNextPage`, then the final row count. */
  total: number | undefined;
  /** True until `fetchRows` returns a `null` or missing cursor (or an empty page). */
  hasNextPage: boolean;
  /** Skeleton rows below the loaded rows: `pageSize` while `hasNextPage`, else 0. */
  unloadedCount: number;
  isLoading: boolean;
  /** Aborts the fetch, drops every row and the cursor, and requests the first page again. Call it when sort, filter, or search changes. */
  reset: () => void;
  /** Repeats the fetch that failed. Stable across renders. */
  retry: () => void;
};

type Loaded<TData> = { rows: TData[]; hasNextPage: boolean };

function guardCallback(fn: () => void): void {
  try {
    fn();
  } catch (error) {
    console.error("[data-grid-lazy] an infinite-rows callback threw:", error);
  }
}

/**
 * Lazy rows for a source with no known total, such as a keyset or "has more" API. Pages load one
 * after the other, each with the cursor of the one before. The grid gets the loaded rows plus one
 * page of skeleton rows, so the scroll height grows in steps and ends exactly at the last row.
 * Sort, filter, and search live in the consumer's request; call `reset()` when they change.
 * The hook keeps every loaded row, so cap the source if it can grow without bound.
 */
export function useDataGridInfiniteRows<TData, TCursor = unknown>(
  options: UseDataGridInfiniteRowsOptions<TData, TCursor>,
): UseDataGridInfiniteRowsResult<TData> {
  const { getRowId, overscan = DEFAULT_OVERSCAN, maxFetchRows } = options;
  const pageSize = Number.isFinite(options.pageSize) && options.pageSize! >= 1 ? Math.floor(options.pageSize!) : DEFAULT_PAGE_SIZE;
  const [loaded, setLoaded] = useState<Loaded<TData>>({ rows: [], hasNextPage: true });
  const [isLoading, setIsLoading] = useState(false);

  // Written by every state transition below, so a handler reads the latest rows without waiting for a commit.
  const loadedRef = useRef(loaded);
  const cursorRef = useRef<TCursor | undefined>(undefined);
  const controllerRef = useRef<AbortController | null>(null);
  const lastWindowRef = useRef<RowRange | null>(null);
  const pendingWindowRef = useRef(false);
  const emptyPageWarnedRef = useRef(false);
  const cutWarnedRef = useRef(false);
  const cursorWarnedRef = useRef(false);
  const optionsRef = useRef(options);
  // A layout effect runs before the grid's passive effect that reports the first window, so a reset reads the new `fetchRows`.
  useLayoutEffect(() => {
    optionsRef.current = options;
  });

  const limit = Math.max(1, Math.min(pageSize, maxFetchRows === undefined ? Infinity : Math.floor(maxFetchRows)));

  const fetchNext = useCallback(() => {
    const { rows, hasNextPage } = loadedRef.current;
    if (!hasNextPage || controllerRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setIsLoading(true);
    const start = rows.length;
    const spec = optionsRef.current.spec ?? EMPTY_SERVER_SPEC;

    const settle = () => {
      if (controllerRef.current !== controller) return;
      controllerRef.current = null;
      setIsLoading(false);
    };
    const fulfilled = (result: InfiniteFetchResult<TData, TCursor>) => {
      if (controller.signal.aborted) return;
      if (!Array.isArray(result?.rows)) {
        rejected(new TypeError("fetchRows of useDataGridInfiniteRows must resolve with { rows: TData[], nextCursor }"));
        return;
      }
      const answered = result.rows.length > limit ? result.rows.slice(0, limit) : result.rows;
      if (answered !== result.rows && !cutWarnedRef.current && isDev()) {
        cutWarnedRef.current = true;
        console.warn(`[data-grid-lazy] fetchRows returned ${result.rows.length} rows for a limit of ${limit}; only the first ${limit} are kept`);
      }
      if (result.nextCursor === undefined && !cursorWarnedRef.current && isDev()) {
        cursorWarnedRef.current = true;
        console.warn("[data-grid-lazy] fetchRows resolved without nextCursor; resolve nextCursor: null to end the source");
      }
      const nextCursor = result.nextCursor ?? null;
      const ended = nextCursor === null || answered.length === 0;
      if (answered.length === 0 && nextCursor !== null && !emptyPageWarnedRef.current && isDev()) {
        emptyPageWarnedRef.current = true;
        console.warn("[data-grid-lazy] fetchRows returned an empty page with a next cursor; an empty page ends the source, so return rows or a null cursor");
      }
      cursorRef.current = nextCursor ?? undefined;
      const next = { rows: [...loadedRef.current.rows, ...answered], hasNextPage: !ended };
      loadedRef.current = next;
      setLoaded(next);
      pendingWindowRef.current = true;
      if (answered.length > 0) guardCallback(() => optionsRef.current.onLoaded?.({ start, end: start + answered.length }));
    };
    const rejected = (error: unknown) => {
      if (controller.signal.aborted) return;
      guardCallback(() => optionsRef.current.onError?.(error));
    };

    try {
      optionsRef.current.fetchRows({ cursor: cursorRef.current, start, limit, signal: controller.signal, spec }).then(fulfilled, rejected).finally(settle);
    } catch (error) {
      rejected(error);
      settle();
    }
  }, [limit]);

  const onRenderedRowsChange = useCallback(
    (range: RowRange) => {
      lastWindowRef.current = range;
      if (range.end + overscan >= loadedRef.current.rows.length) fetchNext();
    },
    [overscan, fetchNext],
  );

  // No deps: a landed page re-checks the last window on the next commit, and the flag makes repeats a no-op.
  useEffect(() => {
    if (!pendingWindowRef.current) return;
    pendingWindowRef.current = false;
    if (lastWindowRef.current) onRenderedRowsChange(lastWindowRef.current);
  });

  useEffect(
    () => () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    },
    [],
  );

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    cursorRef.current = undefined;
    const fresh = { rows: [], hasNextPage: true };
    loadedRef.current = fresh;
    setLoaded(fresh);
    setIsLoading(false);
    pendingWindowRef.current = lastWindowRef.current !== null;
  }, []);

  const specKey = serverSpecKey(options.spec ?? EMPTY_SERVER_SPEC);
  const specKeyRef = useRef(specKey);
  useLayoutEffect(() => {
    if (specKeyRef.current === specKey) return;
    specKeyRef.current = specKey;
    reset();
  }, [specKey, reset]);

  const retry = useCallback(() => {
    const last = lastWindowRef.current;
    if (last) onRenderedRowsChange(last);
  }, [onRenderedRowsChange]);

  const gridGetRowId = useCallback((row: TData, index: number) => (row === undefined ? holeRowId(index) : getRowId(row, index)), [getRowId]);

  const onDataChange = useCallback(
    (next: readonly TData[], change: DataChange<TData>) => {
      const prev = loadedRef.current;
      const skeletons = prev.hasNextPage ? pageSize : 0;
      const rows =
        change.ops.length > 0
          ? (applyChange(prev.rows, change, gridGetRowId) as TData[])
          : (next.slice(0, Math.max(0, next.length - skeletons)) as TData[]);
      const merged = { rows, hasNextPage: prev.hasNextPage };
      loadedRef.current = merged;
      setLoaded(merged);
    },
    [gridGetRowId, pageSize],
  );

  const data = useMemo(() => {
    if (!loaded.hasNextPage) return loaded.rows;
    const padded = loaded.rows.slice();
    padded.length = loaded.rows.length + pageSize;
    return padded;
  }, [loaded, pageSize]);

  const totalRowCount = loaded.hasNextPage ? null : loaded.rows.length;
  const gridProps = useMemo(() => ({ data, getRowId: gridGetRowId, onRenderedRowsChange, totalRowCount, keepCheckedRows: true as const }), [data, gridGetRowId, onRenderedRowsChange, totalRowCount]);

  return {
    gridProps,
    onDataChange,
    total: loaded.hasNextPage ? undefined : loaded.rows.length,
    hasNextPage: loaded.hasNextPage,
    unloadedCount: loaded.hasNextPage ? pageSize : 0,
    isLoading,
    reset,
    retry,
  };
}
