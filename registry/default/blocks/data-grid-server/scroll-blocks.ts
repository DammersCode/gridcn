"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { applyChange, serverSpecKey, type DataChange, type FilterNode, type RowRange, type ServerSpec, type SortSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { holeRowId, isDev } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { readAnswer, type ServerRowsAnswer, type ServerRowsRequest } from "./read-answer";
import { chunkRange, expandRange, mergeRanges, rangeSize, subtractRanges, sumRangeSizes } from "./range-math";
import { isolate, useServerSpec } from "./server-state";
import type { UseDataGridServerRowsRootProps } from "./use-data-grid-server-rows";

const DEFAULT_OVERSCAN = 30;
const DEFAULT_BLOCK_SIZE = 50;

/** Options of `useDataGridServerRows` in scroll mode. */
export type UseDataGridServerRowsScrollOptions<TData> = {
  /** `"scroll"` fetches fixed-size blocks as the rendered rows move. Fixed for the life of the hook. */
  mode: "scroll";
  getRowId: (row: TData, index: number) => string;
  /**
   * Resolves rows `[start, end)` of the result. Answer `totalRowCount` with every block: the grid sizes its rows from it,
   * and a changed count starts the blocks over.
   */
  fetchRows: (request: ServerRowsRequest) => Promise<ServerRowsAnswer<TData>>;
  /** The sort, filter, and search while `spec` is not controlled. */
  defaultSpec?: Partial<ServerSpec>;
  /** Controls the sort, filter, and search; pair it with `onSpecChange`. A content change starts the blocks over. */
  spec?: ServerSpec;
  onSpecChange?: (spec: ServerSpec) => void;
  /** Rows per request. Requests align to multiples of it, so small scrolls reuse the same block. Default 50. */
  blockSize?: number;
  /** Rows fetched beyond the rendered rows on each side. Default 30. */
  overscan?: number;
  /** Fires after a request fails. */
  onError?: (error: unknown) => void;
  /** Fires after the rows of a block land, with the range they cover. The grid shows them on the next frame. */
  onLoaded?: (range: RowRange) => void;
  /** Fires after the hook merged an edit, insert, delete, or revert. Put your handler here; a spread override drops the merge. */
  onDataChange?: (next: readonly TData[], change: DataChange<TData>) => void;
};

/** Props of {@link UseDataGridServerRowsScrollResult.gridProps} that belong to `DataGridProvider`. */
export type UseDataGridServerRowsScrollProviderProps<TData> = {
  /** Sparse at runtime: an unloaded row is a hole, typed as `TData` to match `DataGridProps`. */
  data: readonly TData[];
  /** Gives an unloaded row a placeholder id and a loaded row its own. */
  getRowId: (row: TData, index: number) => string;
  /** Keeps the rows in step with edits, inserts, deletes, and reverts of a refused save. Send changes to your API from `onSave`. */
  onDataChange: (next: readonly TData[], change: DataChange<TData>) => void;
  /** Reports the rendered rows so the hook can fetch the blocks they need. */
  onRenderedRowsChange: (range: RowRange) => void;
  sortMode: "server";
  filterMode: "server";
  sortState: SortSpec[];
  onSortChange: (next: SortSpec[]) => void;
  filterState: FilterNode[];
  onFilterChange: (next: FilterNode[]) => void;
  searchText: string;
  onSearchTextChange: (next: string) => void;
  /** The row count of the result; `null` until the first block lands. */
  totalRowCount: number | null;
  keepCheckedRows: true;
};

/** Return value of `useDataGridServerRows` in scroll mode. */
export type UseDataGridServerRowsScrollResult<TData> = {
  /** Spread onto `<DataGrid {...server.gridProps} columns={columns} />`. */
  gridProps: UseDataGridServerRowsScrollProviderProps<TData> & UseDataGridServerRowsRootProps;
  /** The part of `gridProps` for `<DataGridProvider>` in a composed layout. */
  providerProps: UseDataGridServerRowsScrollProviderProps<TData>;
  /** The part of `gridProps` for `<DataGridRoot>` in a composed layout: the loading flag and the error state. */
  rootProps: UseDataGridServerRowsRootProps;
  /** The sort, filter, and search text of the current requests. */
  spec: ServerSpec;
  /** The row count of the result; `null` until the first block lands. */
  totalRowCount: number | null;
  /** `"error"` wins over `"loading"`. */
  status: "loading" | "error" | "ready";
  /** A request of the current spec is in flight. */
  loading: boolean;
  /** The latest failure of the current spec that no landed block has replaced, or `null`. */
  error: unknown;
  /** Repeats the blocks that failed. Does nothing without an error. */
  retry: () => void;
  /** Fetches the rendered blocks again and keeps them on screen until the answers land. Drops every other loaded block. */
  refresh: () => void;
  /** Rows with no data yet; they render as skeletons. */
  unloadedCount: number;
  /** The loaded ranges, merged and ascending. Not reactive: read it in an effect or a handler. */
  getLoadedRanges: () => readonly RowRange[];
  /** Unloads the rows in `range`; the next rendered window that covers them fetches them again. */
  evict: (range: RowRange) => void;
};

type Pending<TData> = { start: number; rows: TData[] };
type InFlight = { range: RowRange; controller: AbortController };
type Failed = { range: RowRange; error: unknown };

type Core<TData> = {
  count: number | null;
  /** The first block of the current spec landed. */
  ready: boolean;
  loaded: RowRange[];
  inFlight: Map<string, InFlight>;
  failed: Map<string, Failed>;
  pending: Pending<TData>[];
  cancelFrame: (() => void) | null;
  lastWindow: RowRange | null;
  rowsLength: number;
  warned: Set<string>;
};

function createCore<TData>(): Core<TData> {
  return { count: null, ready: false, loaded: [], inFlight: new Map(), failed: new Map(), pending: [], cancelFrame: null, lastWindow: null, rowsLength: 0, warned: new Set() };
}

function scheduleFrame(callback: () => void): () => void {
  if (typeof requestAnimationFrame === "function") {
    const id = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(callback, 16);
  return () => clearTimeout(id);
}

function commitOnFrame<TData>(core: Core<TData>, commit: () => void, onIdle: () => void) {
  if (core.cancelFrame !== null) return;
  commit();
  core.cancelFrame = scheduleFrame(() => {
    core.cancelFrame = null;
    if (core.pending.length > 0) commitOnFrame(core, commit, onIdle);
    else onIdle();
  });
}

const rangeKey = (range: RowRange) => `${range.start}:${range.end}`;

function positiveInteger(value: number | undefined, fallback: number, min: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.floor(value)) : fallback;
}

/** Scroll mode of `useDataGridServerRows`: random access over a result whose size the answers carry. */
export function useScrollBlocks<TData>(options: UseDataGridServerRowsScrollOptions<TData>): UseDataGridServerRowsScrollResult<TData> {
  const { spec, onSortChange, onFilterChange, onSearchTextChange } = useServerSpec(options, noop);
  const coreRef = useRef<Core<TData> | null>(null);
  const getCore = useCallback((): Core<TData> => {
    if (coreRef.current === null) coreRef.current = createCore<TData>();
    return coreRef.current;
  }, []);
  const [rows, setRows] = useState<(TData | undefined)[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [loadedCount, setLoadedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const live = useRef({ options, spec });
  useLayoutEffect(() => {
    live.current = { options, spec };
  });

  const warn = useCallback(
    (kind: string, message: string) => {
      const core = getCore();
      if (!isDev() || core.warned.has(kind)) return;
      core.warned.add(kind);
      console.warn(`[data-grid-server] ${message}`);
    },
    [getCore],
  );
  const blockSize = useCallback(() => positiveInteger(live.current.options.blockSize, DEFAULT_BLOCK_SIZE, 1), []);
  const overscanOf = useCallback(() => positiveInteger(live.current.options.overscan, DEFAULT_OVERSCAN, 0), []);

  const commit = useCallback(() => {
    const batch = getCore().pending.splice(0);
    if (batch.length === 0) return;
    setRows((prev) => {
      const next = prev.slice();
      for (const write of batch) {
        for (let i = 0; i < write.rows.length && write.start + i < next.length; i++) next[write.start + i] = write.rows[i];
      }
      return next;
    });
  }, [getCore]);

  // The first landing commits at once; later ones wait for the next frame, so a burst costs one copy of the rows per frame.
  const commitSoon = useCallback(
    () => commitOnFrame(getCore(), commit, () => setLoading(getCore().inFlight.size > 0)),
    [getCore, commit],
  );

  const abortRequests = useCallback(() => {
    const core = getCore();
    for (const { controller } of core.inFlight.values()) controller.abort();
    core.inFlight.clear();
  }, [getCore]);

  const dropBlocks = useCallback(
    (size: number) => {
      const core = getCore();
      const hadRows = core.loaded.length > 0 || core.pending.length > 0;
      abortRequests();
      core.loaded = [];
      core.failed.clear();
      core.pending.length = 0;
      core.cancelFrame?.();
      core.cancelFrame = null;
      if (core.rowsLength !== size || hadRows) setRows(new Array<TData | undefined>(size));
      core.rowsLength = size;
      setLoadedCount(0);
    },
    [getCore, abortRequests],
  );

  const windowRef = useRef<(range: RowRange) => void>(noop);

  const land = useCallback(
    (range: RowRange, answer: unknown) => {
      const core = getCore();
      const first = !core.ready;
      const read = readAnswer<TData>(answer, range, warn);
      let nextCount: number;
      if (typeof read.totalRowCount === "number") nextCount = read.totalRowCount;
      else if (core.count !== null) nextCount = core.count;
      else {
        warn("count", "scroll mode needs `totalRowCount` in the answer; without it the source ends at the rows of the first block");
        nextCount = range.start + read.rows.length;
      }
      const refire = first || nextCount !== core.count;
      if (!first && nextCount !== core.count) {
        abortRequestsExcept(core, range);
        core.loaded = [];
        core.failed.clear();
        core.pending.length = 0;
        core.cancelFrame?.();
        core.cancelFrame = null;
      }
      if (first) core.ready = true;
      if (core.rowsLength !== nextCount || (!first && nextCount !== core.count)) {
        setRows(new Array<TData | undefined>(nextCount));
        core.rowsLength = nextCount;
      }
      core.count = nextCount;
      setCount(nextCount);
      if (refire) setLoadedCount(0);

      const expected = Math.min(range.end, nextCount) - range.start;
      const written = Math.max(0, Math.min(read.rows.length, expected));
      if (read.rows.length < expected) {
        warn("short", `fetchRows returned ${read.rows.length} rows for rows [${range.start}, ${Math.min(range.end, nextCount)}); only those rows count as loaded and the rest stay unloaded`);
      }
      for (const [key, failure] of core.failed) {
        if (failure.range.start < range.start + written && range.start < failure.range.end) core.failed.delete(key);
      }
      if (core.failed.size === 0) setError(null);
      if (written > 0) {
        core.loaded = mergeRanges([...core.loaded, { start: range.start, end: range.start + written }]);
        setLoadedCount(sumRangeSizes(core.loaded));
        core.pending.push({ start: range.start, rows: read.rows.slice(0, written) });
        commitSoon();
        const onLoaded = live.current.options.onLoaded;
        if (onLoaded) isolate("onLoaded", () => onLoaded({ start: range.start, end: range.start + written }));
      }
      if (refire && core.lastWindow) windowRef.current(core.lastWindow);
    },
    [getCore, warn, commitSoon],
  );

  const runFetch = useCallback(
    (range: RowRange) => {
      const core = getCore();
      const key = rangeKey(range);
      if (core.inFlight.has(key)) return;
      const controller = new AbortController();
      core.inFlight.set(key, { range, controller });
      setLoading(true);
      const settle = () => {
        if (core.inFlight.get(key)?.controller !== controller) return;
        core.inFlight.delete(key);
        // Rows still waiting for the next frame count as loading, so "ready" means the rows are on screen.
        setLoading(core.inFlight.size > 0 || core.pending.length > 0);
      };
      const fail = (cause: unknown) => {
        if (controller.signal.aborted) return;
        const failure = cause ?? new Error("fetchRows rejected");
        core.failed.set(key, { range, error: failure });
        setError(failure);
        const onError = live.current.options.onError;
        if (onError) isolate("onError", () => onError(failure));
      };
      const request: ServerRowsRequest = { spec: live.current.spec, start: range.start, end: range.end, cursor: undefined, signal: controller.signal };
      try {
        live.current.options
          .fetchRows(request)
          .then((answer) => {
            if (!controller.signal.aborted) land(range, answer);
          })
          .catch(fail)
          .finally(settle);
      } catch (cause) {
        fail(cause);
        settle();
      }
    },
    [getCore, land],
  );

  const onRenderedRowsChange = useCallback(
    (range: RowRange) => {
      const core = getCore();
      core.lastWindow = range;
      if (!core.ready || core.count === null) return;
      const size = blockSize();
      const expanded = expandRange(range, { overscan: overscanOf(), batchSize: size, total: core.count });
      if (rangeSize(expanded) === 0) return;
      const covered = [...core.loaded, ...Array.from(core.inFlight.values(), (entry) => entry.range)];
      for (const gap of subtractRanges(expanded, covered)) {
        for (const block of chunkRange(gap, size)) runFetch(block);
      }
    },
    [getCore, runFetch, blockSize, overscanOf],
  );
  useLayoutEffect(() => {
    windowRef.current = onRenderedRowsChange;
  }, [onRenderedRowsChange]);

  const specKey = serverSpecKey(spec);
  useLayoutEffect(() => {
    const core = getCore();
    dropBlocks(core.count ?? 0);
    core.ready = false;
    setLoading(true);
    setError(null);
    // The first request waits a tick, so a StrictMode remount and a spec restored in a mount effect replace it before it leaves.
    const timer = setTimeout(() => runFetch({ start: 0, end: blockSize() }), 0);
    return () => {
      clearTimeout(timer);
      abortRequests();
      core.cancelFrame?.();
      core.cancelFrame = null;
    };
    // `specKey` stands for the spec content.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey]);

  const retry = useCallback(() => {
    const core = getCore();
    if (core.failed.size === 0) return;
    const ranges = Array.from(core.failed.values(), (failure) => failure.range);
    core.failed.clear();
    setError(null);
    for (const range of ranges) runFetch(range);
  }, [getCore, runFetch]);

  const evict = useCallback(
    (range: RowRange) => {
      const core = getCore();
      const start = Math.max(0, range.start);
      const end = Math.min(core.count ?? 0, range.end);
      if (end <= start) return;
      commit();
      const kept: RowRange[] = [];
      for (const loaded of core.loaded) kept.push(...subtractRanges(loaded, [{ start, end }]));
      core.loaded = mergeRanges(kept);
      setLoadedCount(sumRangeSizes(core.loaded));
      setRows((prev) => {
        const next = prev.slice();
        for (let i = start; i < end; i++) next[i] = undefined;
        return next;
      });
    },
    [getCore, commit],
  );

  const refresh = useCallback(() => {
    const core = getCore();
    if (!core.ready || core.count === null) {
      runFetch({ start: 0, end: blockSize() });
      return;
    }
    const size = blockSize();
    const keep = core.lastWindow ? expandRange(core.lastWindow, { overscan: overscanOf(), batchSize: size, total: core.count }) : { start: 0, end: Math.min(size, core.count) };
    abortRequests();
    core.failed.clear();
    setError(null);
    for (const outside of subtractRanges({ start: 0, end: core.count }, [keep])) evict(outside);
    for (const block of chunkRange(keep, size)) runFetch(block);
  }, [getCore, runFetch, evict, abortRequests, blockSize, overscanOf]);

  const getLoadedRanges = useCallback(() => getCore().loaded.slice(), [getCore]);

  const getRowId = useCallback((row: TData, index: number) => (row === undefined ? holeRowId(index) : live.current.options.getRowId(row, index)), []);

  const onDataChange = useCallback(
    (next: readonly TData[], change: DataChange<TData>) => {
      const core = getCore();
      commit();
      // `next` is the grid's snapshot and can predate rows a landed block wrote; replaying the operations on the latest rows keeps them.
      setRows((prev) => {
        if (isDev() && !core.warned.has("dropped")) warnDroppedEdit(prev, change, live.current.options.getRowId, warn);
        return change.ops.length > 0 ? (applyChange(prev as TData[], change, getRowId) as (TData | undefined)[]) : (next.slice() as (TData | undefined)[]);
      });
      const onDataChange = live.current.options.onDataChange;
      if (onDataChange) isolate("onDataChange", () => onDataChange(next, change));
    },
    [getCore, commit, getRowId, warn],
  );

  const providerProps = useMemo<UseDataGridServerRowsScrollProviderProps<TData>>(
    () => ({
      data: rows as TData[],
      getRowId,
      onDataChange,
      onRenderedRowsChange,
      sortMode: "server",
      filterMode: "server",
      sortState: spec.sorts as SortSpec[],
      onSortChange,
      filterState: spec.filters as FilterNode[],
      onFilterChange,
      searchText: spec.searchText,
      onSearchTextChange,
      totalRowCount: count,
      keepCheckedRows: true,
    }),
    [rows, count, spec, getRowId, onDataChange, onRenderedRowsChange, onSortChange, onFilterChange, onSearchTextChange],
  );
  const rootProps = useMemo<UseDataGridServerRowsRootProps>(() => ({ loading, error, onRetry: retry }), [loading, error, retry]);
  const gridProps = useMemo(() => ({ ...providerProps, ...rootProps }), [providerProps, rootProps]);

  const status = error !== null ? "error" : loading ? "loading" : "ready";
  const unloadedCount = (count ?? 0) - loadedCount;
  return { gridProps, providerProps, rootProps, spec, totalRowCount: count, status, loading, error, retry, refresh, unloadedCount, getLoadedRanges, evict };
}

function noop() {}

function abortRequestsExcept<TData>(core: Core<TData>, keep: RowRange) {
  const keepKey = rangeKey(keep);
  for (const [key, { controller }] of core.inFlight) {
    if (key === keepKey) continue;
    controller.abort();
    core.inFlight.delete(key);
  }
}

function warnDroppedEdit<TData>(prev: readonly (TData | undefined)[], change: DataChange<TData>, getRowId: (row: TData, index: number) => string, warn: (kind: string, message: string) => void) {
  const loadedIds = new Set<string>();
  prev.forEach((row, index) => {
    if (row !== undefined) loadedIds.add(getRowId(row, index));
  });
  const dropped = change.ops.find((op) => op.type !== "insert" && !loadedIds.has(op.rowId));
  if (dropped) warn("dropped", `an edit to row "${dropped.rowId}" was dropped because the row was evicted before the change merged; this hook does not own persistence, so keep the edit in your own cache`);
}
