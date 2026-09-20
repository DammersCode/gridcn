"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isDev, type DataChange } from "@/registry/default/blocks/data-grid/data-grid";
import { expandRange, mergeRanges, rangeSize, subtractRanges, sumRangeSizes, type Range } from "./range-math";

/** Default extra rows fetched per range beyond the visible window — ~1 viewport (spec: "default ~1 viewport of rows"). */
const DEFAULT_OVERSCAN = 30;
/** Default rounding unit for fetch ranges (spec: "round ranges up so tiny scrolls don't spam requests"). */
const DEFAULT_BATCH_SIZE = 50;

/** Options for {@link useDataGridLazyRows}. */
export type UseDataGridLazyRowsOptions<TData> = {
  /** Total row count across the whole dataset, loaded or not — sizes the sparse `data` array. */
  total: number;
  /**
   * Fetches rows `[start, end)` (inclusive-exclusive, matching `onRowWindowChange`'s convention).
   * Must resolve with EXACTLY `end - start` rows, positionally aligned to `[start, end)` (the row
   * at index `start + i` at result index `i`). A short response leaves the unwritten rows unloaded
   * (only actually written rows are marked loaded, so the gap refetches on next visibility); an
   * over-long one has its tail dropped (clamped to `[start, end)`). Either mismatch dev-warns —
   * unclamped, both would poison the range cache permanently.
   */
  fetchRows: (start: number, end: number, signal: AbortSignal) => Promise<TData[]>;
  getRowId: (row: TData, index: number) => string;
  /** Extra rows fetched per range beyond the visible window; default {@link DEFAULT_OVERSCAN}. */
  overscan?: number;
  /** Rounds fetch ranges to this boundary so small scrolls reuse the same batch; default {@link DEFAULT_BATCH_SIZE}. */
  batchSize?: number;
  /** Fired when a range fetch throws/rejects; the range reverts to unloaded and is retried next time it's visible. */
  onError?: (error: unknown, range: Range) => void;
};

/** Return value of {@link useDataGridLazyRows}. */
export type UseDataGridLazyRowsResult<TData> = {
  /**
   * Spread onto `<DataGrid {...lazy.gridProps} columns={columns} />`. `data` is typed
   * `readonly TData[]` to match `DataGridProps` but is genuinely sparse at runtime (holes =
   * unloaded rows) — same convention the core skeleton-row contract itself uses (`useDataGridRow`
   * returns `undefined` for a hole regardless of `TData`'s declared element type).
   */
  gridProps: {
    data: readonly TData[];
    getRowId: (row: TData, index: number) => string;
    onRowWindowChange: (range: Range) => void;
  };
  /**
   * Pass as `DataGrid`'s `onDataChange` to let edits on already-loaded rows flow back into the
   * sparse array normally (see the hook's doc comment for why edits are handled this way).
   */
  onDataChange: (next: readonly TData[], change: DataChange<TData>) => void;
  /** Count of indices with no loaded row yet — mainly for the sort/filter dev-warn guard and diagnostics. */
  unloadedCount: number;
  /** True while any range fetch is in flight. */
  isLoading: boolean;
};

/** Index-derived placeholder id for an unloaded row — unstable across loads, but unloaded rows carry no state (documented: unstable identity for unloaded rows is fine). */
function placeholderId(index: number): string {
  return `__lazy-unloaded-${index}`;
}

/**
 * Virtual data fetching for `DataGrid`: maintains a sparse
 * `data` array (length `total`, holes = unloaded rows) and fetches windows on demand as
 * `onRowWindowChange` reports the rendered range. Loaded rows are addressed by `getRowId`, so an
 * edit/sort of a loaded row behaves exactly like a normal controlled grid; unloaded rows use an
 * index-derived placeholder id purely so React has a key to render a skeleton row under.
 *
 * Editing: consumers pass this hook's `onDataChange` straight to `DataGrid`. It's a plain
 * `(next, change) => void` like core's own prop — this hook doesn't own a data setter itself
 * (no `data`/`onChange` tuple, unlike `useDataGridHistory`) because the sparse array's source of
 * truth is split between "what's loaded" (this hook) and "what the consumer's rows actually
 * contain" (the consumer's own store/cache) — the consumer's `onDataChange` is expected to persist
 * `change` (e.g. to its cache/backend) and this hook merges `next` back into the sparse positions
 * it already had loaded. Edits are only reachable on loaded rows in the first place: core's own
 * skeleton-cell handling blocks entering edit mode on an unloaded row.
 */
export function useDataGridLazyRows<TData>(options: UseDataGridLazyRowsOptions<TData>): UseDataGridLazyRowsResult<TData> {
  const { total, fetchRows, getRowId, overscan = DEFAULT_OVERSCAN, batchSize = DEFAULT_BATCH_SIZE, onError } = options;

  const [rows, setRows] = useState<(TData | undefined)[]>(() => Array<TData | undefined>(total));

  // Loaded + in-flight ranges, kept OUTSIDE React state: consulted synchronously inside the
  // onRowWindowChange handler (dedup must see the effect of the fetch it just started, same tick,
  // not next render) and mutated from fetch completion callbacks that must not themselves trigger
  // extra renders beyond the one `setRows` already causes.
  const loadedRangesRef = useRef<Range[]>([]);
  const inFlightRef = useRef<Map<string, { range: Range; controller: AbortController }>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  // per-instance once-flag: a persistently broken fetchRows must not re-warn on every fetch
  const lengthMismatchWarnedRef = useRef(false);

  // Reset everything whenever total changes (a fresh dataset): holes everywhere again, and
  // any fetch still in flight for the old dataset is aborted so its eventual resolution can't
  // write stale rows into the new array.
  const totalRef = useRef(total);
  if (totalRef.current !== total) {
    totalRef.current = total;
    for (const { controller } of inFlightRef.current.values()) controller.abort();
    inFlightRef.current.clear();
    loadedRangesRef.current = [];
    setRows(new Array(total));
    setIsLoading(false);
  }

  const fetchRowsRef = useRef(fetchRows);
  fetchRowsRef.current = fetchRows;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // Aborts every in-flight fetch on unmount — the spec's "abort-on-unmount via AbortSignal".
  useEffect(() => {
    const inFlight = inFlightRef.current;
    return () => {
      for (const { controller } of inFlight.values()) controller.abort();
      inFlight.clear();
    };
  }, []);

  const runFetch = useCallback((range: Range) => {
    const key = `${range.start}:${range.end}`;
    if (inFlightRef.current.has(key)) return;
    const controller = new AbortController();
    inFlightRef.current.set(key, { range, controller });
    setIsLoading(true);

    const handleSettled = () => {
      inFlightRef.current.delete(key);
      if (inFlightRef.current.size === 0) setIsLoading(false);
    };
    const handleFulfilled = (fetched: TData[]) => {
      if (controller.signal.aborted) return;
      const expected = range.end - range.start;
      const written = Math.min(fetched.length, expected);
      if (fetched.length !== expected) {
        if (!lengthMismatchWarnedRef.current && isDev()) {
          lengthMismatchWarnedRef.current = true;
          console.warn(
            `[data-grid-lazy] fetchRows for rows [${range.start}, ${range.end}) resolved with ${fetched.length} rows, expected exactly ${expected} (it must return exactly end - start rows, positionally aligned to [start, end)); writes are clamped to the requested range and only the ${written} written rows are marked loaded`,
          );
        }
      }
      loadedRangesRef.current = mergeRanges([...loadedRangesRef.current, { start: range.start, end: range.start + written }]);
      setRows((prev) => {
        const next = prev.slice();
        for (let i = 0; i < written; i++) {
          next[range.start + i] = fetched[i];
        }
        return next;
      });
    };
    const handleRejected = (error: unknown) => {
      if (controller.signal.aborted) return;
      // failed ranges revert to unloaded (never entered loadedRangesRef) so the next
      // onRowWindowChange covering them naturally retries — "refetch on next visibility".
      onErrorRef.current?.(error, range);
    };

    // try/catch guards a `fetchRows` that throws synchronously instead of returning a rejected
    // promise — inFlightRef is already set above, so without this a sync throw would leave the
    // range stuck "in flight" forever, permanently blocking any future refetch of it.
    try {
      fetchRowsRef.current(range.start, range.end, controller.signal).then(handleFulfilled, handleRejected).finally(handleSettled);
    } catch (error) {
      handleRejected(error);
      handleSettled();
    }
  }, []);

  const onRowWindowChange = useCallback(
    (range: Range) => {
      const expanded = expandRange(range, { overscan, batchSize, total: totalRef.current });
      if (rangeSize(expanded) === 0) return;
      const covered = [...loadedRangesRef.current, ...Array.from(inFlightRef.current.values(), (v) => v.range)];
      const gaps = subtractRanges(expanded, covered);
      for (const gap of gaps) runFetch(gap);
    },
    [overscan, batchSize, runFetch],
  );

  const onDataChange = useCallback((next: readonly TData[], _change: DataChange<TData>) => {
    // `next` is DataGrid's own post-edit array, itself sparse at runtime (see gridProps.data's doc).
    setRows(next.slice() as (TData | undefined)[]);
  }, []);

  const gridGetRowId = useCallback(
    (row: TData, index: number) => (row === undefined ? placeholderId(index) : getRowId(row, index)),
    [getRowId],
  );

  const gridProps = useMemo(
    () => ({
      data: rows as TData[],
      getRowId: gridGetRowId,
      onRowWindowChange,
    }),
    [rows, gridGetRowId, onRowWindowChange],
  );

  // Derived from the loaded-ranges bookkeeping, not a rows.reduce scan: `rows` is a genuinely
  // sparse array (new Array(total) leaves true holes), and Array#reduce SKIPS holes entirely
  // rather than visiting them as `undefined`, so a scan would undercount every unloaded slot.
  const unloadedCount = totalRef.current - sumRangeSizes(loadedRangesRef.current);

  return { gridProps, onDataChange, unloadedCount, isLoading };
}
