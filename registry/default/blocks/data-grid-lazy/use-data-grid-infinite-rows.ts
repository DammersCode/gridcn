"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { applyChange, type DataChange } from "@/registry/default/blocks/data-grid/data-grid";
import { holeRowId, isDev } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import type { Range } from "./range-math";

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
  /** Rows requested per fetch, and skeleton rows shown below the loaded rows while more exist. Default 50. */
  pageSize?: number;
  /** A fetch starts when the rendered window comes within this many rows of the loaded end. Default 30. */
  overscan?: number;
  /** Caps `limit` per fetch. Values below 1 are treated as 1. Default: no cap. */
  maxFetchRows?: number;
  /** Fired when a fetch fails. */
  onError?: (error: unknown) => void;
  /** Fired after a page is merged, with the range it filled. */
  onLoaded?: (range: Range) => void;
};

/** Return value of {@link useDataGridInfiniteRows}. */
export type UseDataGridInfiniteRowsResult<TData> = {
  /** Spread onto `<DataGrid />`. `data` is sparse: the last `pageSize` rows are holes while `hasMore`. */
  gridProps: {
    data: readonly TData[];
    getRowId: (row: TData, index: number) => string;
    onRenderedRowsChange: (range: Range) => void;
  };
  /** Pass as `onDataChange`. Edits, inserts, and deletes of loaded rows merge into the loaded rows. */
  onDataChange: (next: readonly TData[], change: DataChange<TData>) => void;
  /** `undefined` while `hasMore`, then the final row count. */
  total: number | undefined;
  /** True until `fetchRows` returns a `null` cursor (or an empty page). */
  hasMore: boolean;
  /** Skeleton rows below the loaded rows: `pageSize` while `hasMore`, else 0. */
  unloadedCount: number;
  isLoading: boolean;
  /** Aborts the fetch, drops every row and the cursor, and requests the first page again. Call it when sort, filter, or search changes. */
  reset: () => void;
};

type Loaded<TData> = { rows: TData[]; hasMore: boolean };

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
  const [loaded, setLoaded] = useState<Loaded<TData>>({ rows: [], hasMore: true });
  const [isLoading, setIsLoading] = useState(false);

  // Written by every state transition below, so a handler reads the latest rows without waiting for a commit.
  const loadedRef = useRef(loaded);
  const cursorRef = useRef<TCursor | undefined>(undefined);
  const controllerRef = useRef<AbortController | null>(null);
  const lastWindowRef = useRef<Range | null>(null);
  const pendingWindowRef = useRef(false);
  const emptyPageWarnedRef = useRef(false);
  const optionsRef = useRef(options);
  // A layout effect runs before the grid's passive effect that reports the first window, so a reset reads the new `fetchRows`.
  useLayoutEffect(() => {
    optionsRef.current = options;
  });

  const limit = Math.max(1, Math.min(pageSize, maxFetchRows === undefined ? Infinity : Math.floor(maxFetchRows)));

  const fetchNext = useCallback(() => {
    const { rows, hasMore } = loadedRef.current;
    if (!hasMore || controllerRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setIsLoading(true);
    const start = rows.length;

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
      const ended = result.nextCursor === null || result.rows.length === 0;
      if (result.rows.length === 0 && result.nextCursor !== null && !emptyPageWarnedRef.current && isDev()) {
        emptyPageWarnedRef.current = true;
        console.warn("[data-grid-lazy] fetchRows returned an empty page with a next cursor; an empty page ends the source, so return rows or a null cursor");
      }
      cursorRef.current = result.nextCursor ?? undefined;
      const next = { rows: [...loadedRef.current.rows, ...result.rows], hasMore: !ended };
      loadedRef.current = next;
      setLoaded(next);
      pendingWindowRef.current = true;
      if (result.rows.length > 0) guardCallback(() => optionsRef.current.onLoaded?.({ start, end: start + result.rows.length }));
    };
    const rejected = (error: unknown) => {
      if (controller.signal.aborted) return;
      guardCallback(() => optionsRef.current.onError?.(error));
    };

    try {
      optionsRef.current.fetchRows({ cursor: cursorRef.current, start, limit, signal: controller.signal }).then(fulfilled, rejected).finally(settle);
    } catch (error) {
      rejected(error);
      settle();
    }
  }, [limit]);

  const onRenderedRowsChange = useCallback(
    (range: Range) => {
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
    const fresh = { rows: [], hasMore: true };
    loadedRef.current = fresh;
    setLoaded(fresh);
    setIsLoading(false);
    pendingWindowRef.current = lastWindowRef.current !== null;
  }, []);

  const gridGetRowId = useCallback((row: TData, index: number) => (row === undefined ? holeRowId(index) : getRowId(row, index)), [getRowId]);

  const onDataChange = useCallback(
    (next: readonly TData[], change: DataChange<TData>) => {
      const prev = loadedRef.current;
      const skeletons = prev.hasMore ? pageSize : 0;
      const rows =
        change.ops.length > 0
          ? (applyChange(prev.rows, change, gridGetRowId) as TData[])
          : (next.slice(0, Math.max(0, next.length - skeletons)) as TData[]);
      const merged = { rows, hasMore: prev.hasMore };
      loadedRef.current = merged;
      setLoaded(merged);
    },
    [gridGetRowId, pageSize],
  );

  const data = useMemo(() => {
    if (!loaded.hasMore) return loaded.rows;
    const padded = loaded.rows.slice();
    padded.length = loaded.rows.length + pageSize;
    return padded;
  }, [loaded, pageSize]);

  const gridProps = useMemo(() => ({ data, getRowId: gridGetRowId, onRenderedRowsChange }), [data, gridGetRowId, onRenderedRowsChange]);

  return {
    gridProps,
    onDataChange,
    total: loaded.hasMore ? undefined : loaded.rows.length,
    hasMore: loaded.hasMore,
    unloadedCount: loaded.hasMore ? pageSize : 0,
    isLoading,
    reset,
  };
}
