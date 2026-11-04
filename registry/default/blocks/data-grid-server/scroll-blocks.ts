"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { applyChange, serverSpecKey, type DataChange, type DataGridPlugin, type FilterNode, type RowRange, type ServerSpec, type SortSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { holeRowId, isDev } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { readAnswer, type ReadAnswer, type ServerRowsAnswer, type ServerRowsRequest } from "./read-answer";
import { GUARD_MISSING_MESSAGE, pruneIds, stashGuardedRows, trackDeletes, unionIds, useRefreshGuard, writeBlocks, type GuardedBlock, type ProtectedRows } from "./refresh-guard";
import { cursorKey, MAX_SEEN_CURSORS, needsNextBlock, skeletonCount, startsSequence, stepSequence } from "./scroll-sequence";
import { chunkRange, expandRange, mergeRanges, rangeSize, subtractRanges, sumRangeSizes } from "./range-math";
import { isolate, useServerSpec } from "./server-state";
import type { UseDataGridServerRowsRootProps } from "./use-data-grid-server-rows";

const DEFAULT_OVERSCAN = 30;
const DEFAULT_BLOCK_SIZE = 50;

/** Options of `useDataGridServerRows` in scroll mode. */
export type UseDataGridServerRowsScrollOptions<TData, TCursor = never> = {
  /** `"scroll"` fetches fixed-size blocks as the rendered rows move. Fixed for the life of the hook. */
  mode: "scroll";
  getRowId: (row: TData, index: number) => string;
  /**
   * Resolves rows `[start, end)` of the result. The first answer picks the fetch order:
   * - `totalRowCount` and no `nextCursor`: random access. The grid sizes its rows from the count, and a changed count starts the blocks over.
   * - `nextCursor` (with or without a count), or neither: sequential. The grid shows the loaded rows plus one block of skeletons, and
   *   the next block starts when the rendered rows come near the end. `nextCursor` comes back as `cursor`; `nextCursor: null`,
   *   `hasMore: false`, or an empty block ends the source. Without a cursor, `hasMore` defaults to a full block.
   */
  fetchRows: (request: ServerRowsRequest<TCursor>) => Promise<ServerRowsAnswer<TData, TCursor>>;
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
  /** The row count of the result; `null` until the first block lands, and for a sequential source until it ends or the server sends one. */
  totalRowCount: number | null;
  keepCheckedRows: true;
  /** Mounts the guard that keeps a refresh from overwriting a row with a pending save or an open edit. Put your own plugins after it. */
  plugins: readonly DataGridPlugin<unknown>[];
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
  /** The row count of the result; `null` until the first block lands, and for a sequential source until it ends or the server sends one. */
  totalRowCount: number | null;
  /** `"error"` wins over `"loading"`. */
  status: "loading" | "error" | "ready";
  /** A request of the current spec is in flight. */
  loading: boolean;
  /** The latest failure of the current spec that no landed block has replaced, or `null`. */
  error: unknown;
  /** Repeats the blocks that failed. Does nothing without an error. */
  retry: () => void;
  /**
   * Fetches the rendered rows again and keeps them on screen until the answers land. Drops every other loaded row. A sequential
   * source refetches from the first block up to the rendered rows. A block that lands (refresh, retry or window load) replaces every row it carries, except a row that has a pending cell edit or a save that was in flight at any moment since the request was sent: that row keeps its local value. A row with a pending delete is gone: the answer's copy is dropped and its slot stays empty. A protected row that the answer lacks, such as a pending insert, returns to its own slot when no answer row sits there; otherwise it is hidden, and a counted source refreshes when no pending insert or delete is left, so the server decides. A pages refresh appends such a row at the end of the page, so the page can exceed `pageSize` by pending inserts. A sequential refresh that ends before a pending insert may drop it until its save settles. A block shows each id once (the first row of a repeated id in an answer wins) and leaves no hole in its loaded range; rows that moved on the server can mix with older rows until the next refresh settles.
   * Call it after the `onSave` promise settles to pick up server-computed fields.
   */
  refresh: () => void;
  /** Rows with no data yet; they render as skeletons. A sequential source reports its one block of skeletons. */
  unloadedCount: number;
  /** The loaded ranges, merged and ascending. Not reactive: read it in an effect or a handler. */
  getLoadedRanges: () => readonly RowRange[];
  /** Unloads the rows in `range`; the next rendered window that covers them fetches them again. Does nothing on a sequential source. */
  evict: (range: RowRange) => void;
};

type Pending<TData> = GuardedBlock<TData> & { rows: (TData | undefined)[]; mark: number; final?: boolean };
/** `guard` is the set of rows protected when the request started; a retry reuses it. */
type Guard = { ids: ProtectedRows; /** The save count when the request started; later saves are protected too. */ mark: number };
type InFlight = { range: RowRange; controller: AbortController; guard: Guard };
type Failed = { range: RowRange; cursor: unknown; error: unknown };

type Sequence = {
  /** The cursor the next block sends. */
  cursor: unknown;
  ended: boolean;
  /** Rows loaded, without the skeleton rows below them. */
  length: number;
  /** Where the next request starts: the rows the server answered, which exceed `length` by the protected rows dropped from appended blocks. */
  offset: number;
  /** The count the server sent, if any. */
  sentCount: number | null;
  /** A refresh rewrites the rows in place from the first block until the chain passes `keepUntil`. */
  refresh: { keepUntil: number; local: number } | null;
  /** Keys of the cursors the chain returned so far. */
  seen: Set<string>;
};

const freshSequence = (): Sequence => ({ cursor: undefined, ended: false, length: 0, offset: 0, sentCount: null, refresh: null, seen: new Set() });

type Core<TData> = {
  count: number | null;
  /** The first block of the current spec landed. */
  ready: boolean;
  loaded: RowRange[];
  /** Decided by the first answer of the current spec. */
  kind: "unknown" | "random" | "sequence";
  seq: Sequence;
  inFlight: Map<string, InFlight>;
  failed: Map<string, Failed>;
  pending: Pending<TData>[];
  cancelFrame: (() => void) | null;
  lastWindow: RowRange | null;
  rowsLength: number;
  warned: Set<string>;
  /** Guarded rows an earlier block overwrote, for the block that brings their id back; empty when no request is pending. */
  displaced: Map<string, TData>;
  /** Protected rows that are not loaded (dropped by a spec change or deleted locally); a block that carries one keeps its incoming copy. */
  absent: Set<string>;
  /** Ranges whose rows a local row operation moved: not loaded, but a protected row may still sit there. A landing block or an eviction removes them. */
  stale: RowRange[];
  /** Protected rows that a block overwrote, and the ids the landed blocks carried; both are emptied when no request is pending. */
  orphans: Map<string, { row: TData; slot: number }>;
  carried: Set<string>;
  /** Cancels the refresh that a burst of local row operations queued for the next frame. */
  cancelQueuedRefresh: (() => void) | null;
  /** Rows with a delete still saving: an answer that carries one drops it. */
  deleted: Set<string>;
  /** Slots an answer left empty on purpose (a repeated or deleted row): answered, never refetched, never claimed as loaded. */
  empty: RowRange[];
  /** Slots a protected row moved away from; `core.loaded` stops claiming them. */
  cleared: Set<number>;
};

function createCore<TData>(): Core<TData> {
  return { count: null, ready: false, loaded: [], kind: "unknown", seq: freshSequence(), inFlight: new Map(), failed: new Map(), pending: [], cancelFrame: null, lastWindow: null, rowsLength: 0, warned: new Set(), displaced: new Map(), absent: new Set(), deleted: new Set(), cancelQueuedRefresh: null, orphans: new Map(), carried: new Set(), empty: [], stale: [], cleared: new Set() };
}

function scheduleFrame(callback: () => void): () => void {
  if (typeof requestAnimationFrame === "function") {
    const id = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(callback, 16);
  return () => clearTimeout(id);
}

function oldestMark<TData>(core: Core<TData>): number | null {
  let oldest: number | null = null;
  const note = (mark: number) => {
    if (oldest === null || mark < oldest) oldest = mark;
  };
  for (const { guard } of core.inFlight.values()) note(guard.mark);
  for (const { mark } of core.pending) note(mark);
  return oldest;
}

/** Keeps the entries of rows that are still protected: a queued commit may still read or fill the map. */
function forgetDisplacedWhenIdle<TData>(core: Core<TData>, stillProtected: ProtectedRows) {
  if (oldestMark(core) !== null) return;
  for (const id of core.displaced.keys()) if (!stillProtected?.has(id)) core.displaced.delete(id);
  core.orphans = new Map();
  core.carried = new Set();
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

/** Scroll mode of `useDataGridServerRows`: random access over a counted result, or a sequential chain of blocks. */
export function useScrollBlocks<TData, TCursor = never>(options: UseDataGridServerRowsScrollOptions<TData, TCursor>): UseDataGridServerRowsScrollResult<TData> {
  const { spec, onSortChange, onFilterChange, onSearchTextChange } = useServerSpec(options, noop);
  const coreRef = useRef<Core<TData> | null>(null);
  const getCore = useCallback((): Core<TData> => {
    if (coreRef.current === null) coreRef.current = createCore<TData>();
    return coreRef.current;
  }, []);
  const [rows, setRows] = useState<(TData | undefined)[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [loadedCount, setLoadedCount] = useState(0);
  const [skeletons, setSkeletons] = useState<number | null>(null);
  const { plugins, protectedRows, savingRows, guardMissing, markEdited, saveMark, savedSince, pruneSaves, setSettleListener, forgetStructural } = useRefreshGuard();
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
  const notifyLoaded = useCallback((start: number, end: number) => {
    const onLoaded = live.current.options.onLoaded;
    if (end > start && onLoaded) isolate("onLoaded", () => onLoaded({ start, end }));
  }, []);

  const release = useCallback(
    (core: Core<TData>) => {
      forgetDisplacedWhenIdle(core, protectedRows());
      pruneSaves(oldestMark(core));
      if (oldestMark(core) === null) {
        pruneIds(core.deleted, savingRows());
        pruneIds(core.absent, savingRows());
      }
    },
    [pruneSaves, protectedRows, savingRows],
  );

  const commit = useCallback(() => {
    const core = getCore();
    const pending = core.pending.splice(0);
    if (pending.length === 0) return;
    const batch = pending.map(({ start, rows, guard, mark }) => ({ start, rows, guard: unionIds(guard, savedSince(mark)) }));
    const final = pending[pending.length - 1]!.final === true || core.inFlight.size === 0;
    const displaced = core.displaced;
    const memory = { orphans: core.orphans, carried: core.carried };
    const length = core.kind === "sequence" ? core.rowsLength : null;
    const guarded = protectedRows();
    // A sequential refresh shrinks `loaded` at its end, before the commit, so it scans the whole dense array.
    const ranges = core.kind === "sequence" ? [{ start: 0, end: Number.MAX_SAFE_INTEGER }] : core.stale.length > 0 ? mergeRanges([...core.loaded, ...core.stale]) : core.loaded;
    const idOf = live.current.options.getRowId;
    setRows((prev) => {
      const base = length === null ? prev : Object.assign(prev.slice(), { length });
      const written = writeBlocks(base, batch, guarded, displaced, ranges, idOf, memory, final);
      for (const slot of written.cleared) core.cleared.add(slot);
      return written.rows;
    });
  }, [getCore, protectedRows, savedSince]);

  // The first landing commits at once; later ones wait for the next frame, so a burst costs one copy of the rows per frame.
  const commitSoon = useCallback(
    () =>
      commitOnFrame(getCore(), commit, () => {
        const core = getCore();
        release(core);
        setLoading(core.inFlight.size > 0);
      }),
    [getCore, commit, release],
  );

  const abortRequests = useCallback(() => {
    const core = getCore();
    for (const { controller } of core.inFlight.values()) controller.abort();
    core.inFlight.clear();
  }, [getCore]);

  const dropBlocks = useCallback(
    (size: number) => {
      const core = getCore();
      const hadRows = core.loaded.length > 0 || core.stale.length > 0 || core.pending.length > 0;
      abortRequests();
      core.kind = "unknown";
      core.seq = freshSequence();
      setSkeletons(null);
      core.loaded = [];
      core.failed.clear();
      core.pending.length = 0;
      pruneSaves(null);
      forgetStructural();
      core.cancelQueuedRefresh?.();
      core.cancelQueuedRefresh = null;
      core.displaced = new Map();
      core.stale = [];
      core.empty = [];
      core.absent = new Set(savingRows() ?? []);
      core.cleared.clear();
      core.cancelFrame?.();
      core.cancelFrame = null;
      if (core.rowsLength !== size || hadRows) setRows(new Array<TData | undefined>(size));
      core.rowsLength = size;
      setLoadedCount(0);
    },
    [getCore, abortRequests, pruneSaves, savingRows, forgetStructural],
  );

  const windowRef = useRef<(range: RowRange) => void>(noop);

  const runFetchRef = useRef<(range: RowRange, cursor?: unknown) => void>(noop);

  const landSequence = useCallback(
    (range: RowRange, read: ReadAnswer<TData, unknown>, sentCursor: unknown, guard: Guard) => {
      const core = getCore();
      const seq = core.seq;
      const size = blockSize();
      core.ready = true;
      core.kind = "sequence";
      if (typeof read.totalRowCount === "number") seq.sentCount = read.totalRowCount;
      else if (read.totalRowCount === null) seq.sentCount = null;
      const refresh = seq.refresh;
      const at = refresh ? refresh.local : seq.length;
      const idOf = live.current.options.getRowId;
      const serverLength = Math.min(read.rows.length, range.end - range.start);
      const guarded = refresh ? null : unionIds(unionIds(guard.ids, savedSince(guard.mark)), protectedRows());
      const incoming: TData[] = [];
      read.rows.slice(0, serverLength).forEach((row, index) => {
        if (row === undefined) return;
        const id = idOf(row, range.start + index);
        if (core.deleted.has(id)) return;
        if (guarded !== null && guarded.has(id) && !core.absent.has(id) && !core.displaced.has(id)) return;
        incoming.push(row);
      });
      if (core.absent.size > 0) read.rows.forEach((row, index) => row !== undefined && core.absent.delete(idOf(row, range.start + index)));
      const written = incoming.length;
      const position = at + written;
      const serverPosition = range.start + serverLength;
      const step = stepSequence({ read, sentCursor, loaded: serverPosition, count: seq.sentCount, seenCursors: seq.seen });
      if (step.warning) warn(step.warning.kind, step.warning.message);
      for (const [key, failure] of core.failed) {
        if (failure.range.start === range.start) core.failed.delete(key);
      }
      if (core.failed.size === 0) setError(null);
      seq.cursor = step.cursor;
      const returned = cursorKey(step.cursor);
      if (returned !== null && seq.seen.size < MAX_SEEN_CURSORS) seq.seen.add(returned);
      core.pending.push({ start: at, rows: incoming, guard: guard.ids, mark: guard.mark });
      if (refresh && !step.ended && position < refresh.keepUntil) {
        core.rowsLength = Math.max(core.rowsLength, position);
        commitSoon();
        notifyLoaded(at, position);
        refresh.local = position;
        runFetchRef.current({ start: serverPosition, end: serverPosition + size }, step.cursor);
        return;
      }
      seq.refresh = null;
      seq.ended = step.ended;
      seq.length = position;
      seq.offset = serverPosition;
      core.loaded = position > 0 ? [{ start: 0, end: position }] : [];
      const tail = skeletonCount({ loaded: serverPosition, blockSize: size, count: seq.sentCount, ended: step.ended });
      if (refresh) core.pending.push({ start: position, rows: new Array<TData | undefined>(tail).fill(undefined), guard: null, mark: guard.mark });
      core.rowsLength = position + tail;
      setLoadedCount(position);
      setSkeletons(tail);
      setCount(seq.sentCount ?? (step.ended ? position : null));
      commitSoon();
      notifyLoaded(at, position);
    },
    [getCore, warn, commitSoon, blockSize, notifyLoaded, protectedRows, savedSince],
  );

  const land = useCallback(
    (range: RowRange, answer: unknown, sentCursor: unknown, guard: Guard) => {
      const core = getCore();
      const read = readAnswer<TData, unknown>(answer, range, warn, live.current.options.getRowId);
      if (core.kind === "unknown") core.kind = startsSequence(read) ? "sequence" : "random";
      if (core.kind === "sequence") {
        landSequence(range, read, sentCursor, guard);
        return;
      }
      const first = !core.ready;
      const nextCount = typeof read.totalRowCount === "number" ? read.totalRowCount : (core.count ?? range.start + read.rows.length);
      const refire = first || nextCount !== core.count;
      let keep: { displaced: Map<string, TData>; orphans: Map<string, { row: TData; slot: number }>; guarded: ProtectedRows; ranges: RowRange[] } | null = null;
      if (!first && nextCount !== core.count) {
        abortRequestsExcept(core, range);
        keep = { displaced: new Map(), orphans: core.orphans, guarded: unionIds(unionIds(guard.ids, savedSince(guard.mark)), protectedRows()), ranges: mergeRanges([...core.loaded, ...core.stale]) };
        core.loaded = [];
        core.failed.clear();
        core.pending.length = 0;
        forgetStructural();
        core.cancelQueuedRefresh?.();
        core.cancelQueuedRefresh = null;
        core.displaced = keep.displaced;
        core.stale = [];
        core.empty = [];
        core.cleared.clear();
        core.cancelFrame?.();
        core.cancelFrame = null;
      }
      if (first) core.ready = true;
      if (core.rowsLength !== nextCount || (!first && nextCount !== core.count)) {
        const idOf = live.current.options.getRowId;
        setRows((prev) => {
          if (keep !== null && keep.guarded !== null) stashGuardedRows(prev, keep.ranges, keep.guarded, keep.displaced, idOf, keep.orphans);
          return new Array<TData | undefined>(nextCount);
        });
        core.rowsLength = nextCount;
      } else {
        setRows((prev) => (prev.length === nextCount ? prev : Object.assign(prev.slice(0, nextCount), { length: nextCount })));
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
        const idOf = live.current.options.getRowId;
        const blank: RowRange[] = [];
        const rows = read.rows.slice(0, written).map((row, index) => {
          if (row !== undefined && !core.deleted.has(idOf(row, range.start + index))) return row;
          blank.push({ start: range.start + index, end: range.start + index + 1 });
          return undefined;
        });
        const answered = { start: range.start, end: range.start + written };
        core.loaded = mergeRanges([...core.loaded, ...subtractRanges(answered, blank)]);
        core.empty = mergeRanges([...core.empty.flatMap((empty) => subtractRanges(empty, [answered])), ...blank]);
        core.stale = core.stale.flatMap((stale) => subtractRanges(stale, [answered]));
        setLoadedCount(sumRangeSizes(core.loaded));
        core.pending.push({ start: range.start, rows, guard: guard.ids, mark: guard.mark, final: core.inFlight.size <= 1 });
        commitSoon();
        notifyLoaded(range.start, range.start + written);
      }
      if (refire && core.lastWindow) windowRef.current(core.lastWindow);
    },
    [getCore, warn, commitSoon, landSequence, notifyLoaded, protectedRows, savedSince, forgetStructural],
  );

  const runFetch = useCallback(
    (range: RowRange, cursor?: unknown) => {
      const core = getCore();
      const key = rangeKey(range);
      if (core.inFlight.has(key)) return;
      const controller = new AbortController();
      const guard: Guard = { ids: savingRows(), mark: saveMark() };
      core.inFlight.set(key, { range, controller, guard });
      setLoading(true);
      const settle = () => {
        if (core.inFlight.get(key)?.controller !== controller) return;
        core.inFlight.delete(key);
        release(core);
        // Rows still waiting for the next frame count as loading, so "ready" means the rows are on screen.
        setLoading(core.inFlight.size > 0 || core.pending.length > 0);
      };
      const fail = (cause: unknown) => {
        if (controller.signal.aborted) return;
        const failure = cause ?? new Error("fetchRows rejected");
        core.failed.set(key, { range, cursor, error: failure });
        setError(failure);
        const onError = live.current.options.onError;
        if (onError) isolate("onError", () => onError(failure));
      };
      const request = { spec: live.current.spec, start: range.start, end: range.end, cursor, signal: controller.signal } as ServerRowsRequest<TCursor>;
      let landed = false;
      // A landed sequential block re-checks the rendered window once its request has settled, so the chain goes on while the window stays near the end.
      const afterSettle = () => {
        settle();
        if (landed && !controller.signal.aborted && core.kind === "sequence" && core.lastWindow) windowRef.current(core.lastWindow);
      };
      try {
        live.current.options
          .fetchRows(request)
          .then((answer) => {
            if (controller.signal.aborted) return;
            land(range, answer, cursor, guard);
            landed = true;
          })
          .catch(fail)
          .finally(afterSettle);
      } catch (cause) {
        fail(cause);
        settle();
      }
    },
    [getCore, land, savingRows, saveMark, release],
  );
  useLayoutEffect(() => {
    runFetchRef.current = runFetch;
  }, [runFetch]);

  const onRenderedRowsChange = useCallback(
    (range: RowRange) => {
      const core = getCore();
      core.lastWindow = range;
      if (core.ready && core.kind === "sequence") {
        const { seq } = core;
        if (seq.ended || seq.refresh || core.inFlight.size > 0 || !needsNextBlock(range, seq.length, overscanOf())) return;
        runFetch({ start: seq.offset, end: seq.offset + blockSize() }, seq.cursor);
        return;
      }
      if (!core.ready || core.count === null) return;
      const size = blockSize();
      const expanded = expandRange(range, { overscan: overscanOf(), blockSize: size, total: core.count });
      if (rangeSize(expanded) === 0) return;
      const covered = [...core.loaded, ...core.empty, ...Array.from(core.inFlight.values(), (entry) => entry.range)];
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
    const wasSequence = core.kind === "sequence";
    dropBlocks(wasSequence ? 0 : (core.count ?? 0));
    if (wasSequence) {
      core.count = null;
      setCount(null);
    }
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

  const evict = useCallback(
    (range: RowRange) => {
      const core = getCore();
      if (core.kind === "sequence") return;
      const start = Math.max(0, range.start);
      const end = Math.min(core.count ?? 0, range.end);
      if (end <= start) return;
      commit();
      const kept: RowRange[] = [];
      const cleared: RowRange[] = [];
      for (const loaded of mergeRanges([...core.loaded, ...core.stale])) {
        const overlap = { start: Math.max(start, loaded.start), end: Math.min(end, loaded.end) };
        if (overlap.end > overlap.start) cleared.push(overlap);
      }
      for (const loaded of core.loaded) kept.push(...subtractRanges(loaded, [{ start, end }]));
      core.stale = core.stale.flatMap((stale) => subtractRanges(stale, [{ start, end }]));
      core.empty = core.empty.flatMap((empty) => subtractRanges(empty, [{ start, end }]));
      core.loaded = mergeRanges(kept);
      setLoadedCount(sumRangeSizes(core.loaded));
      if (cleared.length === 0) return;
      setRows((prev) => {
        const next = prev.slice();
        for (const { start: from, end: to } of cleared) next.fill(undefined, from, to);
        return next;
      });
    },
    [getCore, commit],
  );

  const retry = useCallback(() => {
    const core = getCore();
    if (core.failed.size === 0) return;
    const failures = Array.from(core.failed.values());
    core.failed.clear();
    setError(null);
    for (const { range, cursor } of failures) runFetch(range, cursor);
  }, [getCore, runFetch]);

  // A protected row that left its old slot must not leave the slot marked loaded; the next window fetches it again.
  useLayoutEffect(() => {
    const core = getCore();
    if (core.cleared.size === 0) return;
    const slots = Array.from(core.cleared);
    core.cleared.clear();
    if (core.kind === "sequence") return;
    core.loaded = mergeRanges(slots.reduce<RowRange[]>((kept, slot) => kept.flatMap((range) => subtractRanges(range, [{ start: slot, end: slot + 1 }])), core.loaded));
    setLoadedCount(sumRangeSizes(core.loaded));
    if (core.lastWindow) windowRef.current(core.lastWindow);
  }, [rows, getCore]);

  const refresh = useCallback(() => {
    const core = getCore();
    if (!core.ready || (core.kind !== "sequence" && core.count === null)) {
      runFetch({ start: 0, end: blockSize() });
      return;
    }
    if (guardMissing()) warn("guard", GUARD_MISSING_MESSAGE);
    commit();
    const size = blockSize();
    if (core.kind === "sequence") {
      abortRequests();
      core.failed.clear();
      setError(null);
      core.seq.seen = new Set();
      core.seq.refresh = { keepUntil: Math.max(size, (core.lastWindow?.end ?? 0) + overscanOf()), local: 0 };
      runFetch({ start: 0, end: size });
      return;
    }
    const keep = core.lastWindow ? expandRange(core.lastWindow, { overscan: overscanOf(), blockSize: size, total: core.count! }) : { start: 0, end: Math.min(size, core.count!) };
    abortRequests();
    core.failed.clear();
    core.empty = [];
    setError(null);
    for (const outside of subtractRanges({ start: 0, end: core.count! }, [keep])) evict(outside);
    for (const block of chunkRange(keep, size)) runFetch(block);
  }, [getCore, runFetch, evict, abortRequests, blockSize, overscanOf, guardMissing, warn, commit]);

  const refreshRef = useRef<() => void>(noop);
  useLayoutEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    const core = getCore();
    setSettleListener(() => {
      if (core.kind !== "sequence") refreshRef.current();
    });
    return () => {
      setSettleListener(null);
      core.cancelQueuedRefresh?.();
      core.cancelQueuedRefresh = null;
    };
  }, [getCore, setSettleListener]);

  const getLoadedRanges = useCallback(() => getCore().loaded.slice(), [getCore]);

  const getRowId = useCallback((row: TData, index: number) => (row === undefined ? holeRowId(index) : live.current.options.getRowId(row, index)), []);

  // An insert or delete moves the end of the loaded rows; the next block starts after it.
  const followRowOperations = useCallback(
    (change: DataChange<TData>) => {
      const core = getCore();
      const { seq } = core;
      let delta = 0;
      for (const op of change.ops) delta += op.type === "insert" ? 1 : op.type === "delete" ? -1 : 0;
      if (delta === 0) return;
      seq.length = Math.max(0, seq.length + delta);
      seq.offset = Math.max(0, seq.offset + delta);
      core.rowsLength = Math.max(0, core.rowsLength + delta);
      core.loaded = seq.length > 0 ? [{ start: 0, end: seq.length }] : [];
      setLoadedCount(seq.length);
      if (seq.ended && seq.sentCount === null) setCount(seq.length);
    },
    [getCore],
  );

  const onDataChange = useCallback(
    (next: readonly TData[], change: DataChange<TData>) => {
      const core = getCore();
      markEdited();
      commit();
      // `next` is the grid's snapshot and can predate rows a landed block wrote; replaying the operations on the latest rows keeps them.
      setRows((prev) => {
        if (isDev() && !core.warned.has("dropped")) warnDroppedEdit(prev, change, live.current.options.getRowId, warn);
        return change.ops.length > 0 ? (applyChange(prev as TData[], change, getRowId) as (TData | undefined)[]) : (next.slice() as (TData | undefined)[]);
      });
      if (core.kind === "sequence") followRowOperations(change);
      trackDeletes(core.deleted, change);
      if (core.kind !== "sequence" && core.ready && change.ops.some((op) => op.type !== "update")) {
        // A local insert, delete, or move shifts rows away from the positions the loaded ranges name; the refresh loads the rendered ones again.
        const inserted = change.ops.filter((op) => op.type === "insert").length;
        core.stale = mergeRanges([...core.stale, ...core.loaded].map((range) => ({ start: range.start, end: range.end + inserted })));
        core.loaded = [];
        setLoadedCount(0);
        // A burst of row operations refreshes once, on the next frame.
        if (core.cancelQueuedRefresh === null) {
          core.cancelQueuedRefresh = scheduleFrame(() => {
            core.cancelQueuedRefresh = null;
            refreshRef.current();
          });
        }
      }
      const onDataChange = live.current.options.onDataChange;
      if (onDataChange) isolate("onDataChange", () => onDataChange(next, change));
    },
    [getCore, commit, getRowId, warn, followRowOperations, markEdited],
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
      plugins,
    }),
    [rows, count, spec, getRowId, onDataChange, onRenderedRowsChange, onSortChange, onFilterChange, onSearchTextChange, plugins],
  );
  const rootProps = useMemo<UseDataGridServerRowsRootProps>(() => ({ loading, error, onRetry: retry }), [loading, error, retry]);
  const gridProps = useMemo(() => ({ ...providerProps, ...rootProps }), [providerProps, rootProps]);

  const status = error !== null ? "error" : loading ? "loading" : "ready";
  const unloadedCount = skeletons ?? (count ?? 0) - loadedCount;
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
  const missing = new Map<string, string>();
  for (const op of change.ops) if (op.type !== "insert") missing.set(op.rowId, op.rowId);
  if (missing.size === 0) return;
  // `some` skips holes and stops once every edited row is found, so a normal edit scans only up to its rows.
  prev.some((row, index) => {
    if (row !== undefined) missing.delete(getRowId(row, index));
    return missing.size === 0;
  });
  const dropped = missing.values().next();
  if (!dropped.done) warn("dropped", `an edit to row "${dropped.value}" was dropped because the row was evicted before the change merged; this hook does not own persistence, so keep the edit in your own cache`);
}
