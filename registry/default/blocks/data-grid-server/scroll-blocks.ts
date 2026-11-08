"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { serverSpecKey, type DataChange, type DataGridPlugin, type FilterNode, type RowRange, type ServerSpec, type SortSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { applyChangeWith, holeRowId, isDev } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { readAnswer, type ReadAnswer, type ServerRowsAnswer, type ServerRowsRequest, type WithRowId } from "./read-answer";
import { GUARD_MISSING_MESSAGE, pruneIds, stashGuardedRows, trackDeletes, unionIds, useRefreshGuard, writeBlocks, type GuardedBlock, type ProtectedRows } from "./refresh-guard";
import { cursorKey, MAX_SEEN_CURSORS, needsNextBlock, skeletonCount, startsSequence, stepSequence } from "./scroll-sequence";
import { chunkAligned, chunkRange, expandRange, mergeRanges, rangeSize, subtractRanges, sumRangeSizes } from "./range-math";
import { DEFAULT_MAX_LOADED_ROWS, MAX_SEQUENTIAL_REVALIDATE_BLOCKS, distanceToCentre, dueWanted, keepRange, pickEvictions, pruneViewed, rangesIntersect, readFetchLimits, trackWanted, unloadRangesOf, type FetchLimits, type Wanted } from "./fetch-hygiene";
import { useSaveRefresh, type SaveRefreshOptions, type SaveRefreshPolicy } from "./save-refresh";
import { isolate, scheduleFrame, useReshape, useRevalidation, useServerSpec } from "./server-state";
import type { UseDataGridServerRowsRootProps } from "./use-data-grid-server-rows";

const DEFAULT_OVERSCAN = 30;
const DEFAULT_BLOCK_SIZE = 50;

/** Options of `useDataGridServerRows` in scroll mode. */
export type UseDataGridServerRowsScrollOptions<TData, TCursor = never> = {
  /** `"scroll"` fetches fixed-size blocks as the rendered rows move. Fixed for the life of the hook. */
  mode: "scroll";
  /** Identifies a row. Default: the row's `id` field (a string or number), the same default as `DataGridProvider`. */
  getRowId?: (row: TData, index: number) => string;
  /**
   * How the source is fetched. `"random"` fetches any block by position and needs a `totalRowCount` in every answer (a development
   * warning names an answer without one). `"sequential"` fetches the blocks in order, with a cursor or with offsets and `hasMore`. Default: the first answer picks it, by the rule of `fetchRows`.
   */
  source?: "random" | "sequential";
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
  /**
   * Milliseconds a block stays in the wanted range before its request starts. A fast scroll starts no request until it rests.
   * Block 0, `refresh()`, `retry()`, and the refetch after the first answer or a count change skip it. Default 100, at most 2,000; `0` starts at once.
   */
  loadDelayMs?: number;
  /** Most block requests in flight at once on a random access source. Default 3, at most 16. */
  maxConcurrentFetches?: number;
  /**
   * Most rows kept loaded on a random access source. When more are loaded, the least recently viewed blocks outside the rendered rows
   * plus overscan plus one block unload. Rows with an open edit, a pending save, or an unsaved change, and the row under the active cell, stay in `data`
   * but stop counting as loaded, so the next window fetches their block whole.
   * `Infinity` keeps every row. Default 10,000; a value below `blockSize` counts as `blockSize`.
   */
  maxLoadedRows?: number;
  /**
   * Milliseconds between `refresh()` calls the hook runs itself while the page is visible. A tick waits for a request in flight,
   * and every refresh restarts the clock. A sequential source skips a tick while the rendered rows end beyond 10 blocks.
   * At least 1000. Off by default.
   */
  revalidateIntervalMs?: number;
  /**
   * Milliseconds to wait after a push marked a row stale before the hook runs a `refresh()` (a reshape) so the server places the
   * rows again. The first push starts the wait and later pushes join it, so a steady feed reshapes at most once per delay. A
   * reshape that falls due during a request, or while the page is hidden, waits and runs once; a sequential source skips it while the
   * rendered rows end beyond 10 blocks. At least 250. Off by default: a stale row then waits for `reshape()`, `refresh()`, or a spec change.
   */
  reshapeDelayMs?: number;
  /** Fires after a request fails. */
  onError?: (error: unknown) => void;
  /** Fires after the rows of a block land, with the range they cover. The grid shows them on the next frame. */
  onLoaded?: (range: RowRange) => void;
  /** Fires after the hook merged an edit, insert, delete, or revert. Put your handler here; a spread override drops the merge. */
  onDataChange?: (next: readonly TData[], change: DataChange<TData>) => void;
  /** Saves a change; spread to the provider through `gridProps.onSave`, where it behaves as the `DataGridProvider` prop of the same name. The hook refreshes after saves settle by `refreshAfterSave`. */
  onSave?: SaveRefreshOptions<TData>["onSave"];
  /** When the hook calls `refresh()` after `onSave` settles: `"settled"` once after every save in flight (default), `"each"` after every save, `false` never, or a function that gets the counts and returns whether to refresh. */
  refreshAfterSave?: SaveRefreshPolicy;
};

/** Props of {@link UseDataGridServerRowsScrollResult.gridProps} that belong to `DataGridProvider`. */
export type UseDataGridServerRowsScrollProviderProps<TData> = {
  /** Sparse at runtime: an unloaded row is a hole, typed as `TData` to match `DataGridProps`. */
  data: readonly TData[];
  /** Gives an unloaded row a placeholder id and a loaded row its own. */
  getRowId: (row: TData, index: number) => string;
  /** Keeps the rows in step with edits, inserts, deletes, and reverts of a refused save. Send changes to your API from `onSave`. */
  onDataChange: (next: readonly TData[], change: DataChange<TData>) => void;
  /** Present when the hook got an `onSave`. */
  onSave?: SaveRefreshOptions<TData>["onSave"];
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
  checkedRowsLifetime: "across-filters";
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
   * source refetches from the first block up to the rendered rows. A row with a pending edit, delete, or in-flight save keeps its local state.
   * The hook calls it after saves settle by `refreshAfterSave`; call it yourself with `refreshAfterSave: false` or a void `onSave`.
   */
  refresh: () => void;
  /** Asks the server to place the pushed rows again: one `refresh()` on the next frame, or after `reshapeDelayMs` when it is set. Calls in one frame join. */
  reshape: () => void;
  /** Rows with no data yet; they render as skeletons. A sequential source reports its one block of skeletons. */
  unloadedCount: number;
  /** The loaded ranges, merged and ascending. Not reactive: read it in an effect or a handler. */
  getLoadedRanges: () => readonly RowRange[];
  /**
   * Unloads the rows in `range` and aborts the requests it covers; the next rendered window that covers them fetches them again.
   * Rows with an open edit, a pending save, or an unsaved change, and the row under the active cell, stay in `data` but stop counting as loaded. Does nothing on a sequential source.
   */
  evict: (range: RowRange) => void;
};

type Pending<TData> = GuardedBlock<TData> & { rows: (TData | undefined)[]; mark: number; final?: boolean };
/** `guard` is the set of rows protected when the request started; a retry reuses it. */
type Guard = { ids: ProtectedRows; /** The save count when the request started; later saves are protected too. */ mark: number };
type InFlight = { range: RowRange; controller: AbortController; guard: Guard; /** The answer is being written; the request only waits to settle. */ landed: boolean };
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
  /** Slots where a protected row returned outside any claimed range; they join `stale`, so a count change still finds the row. */
  restored: Set<number>;
  /** Uncovered blocks of the wanted range with the time each entered it; one entry for a sequential source. */
  wanted: Wanted;
  delayTimer: ReturnType<typeof setTimeout> | null;
  /** Blocks of a refresh or retry that wait for a free request slot. */
  owed: RowRange[];
  /** Block index -> stamp of the latest report that had the block in its keep range. */
  viewed: Map<number, number>;
  tick: number;
  /** The keep range of the latest report. */
  keep: RowRange | null;
  /** Blocks an eviction unloaded; the layout effect drops their stamps. */
  evictedBlocks: Set<number>;
  /** Set when rows were unloaded; the layout effect syncs the loaded count. */
  unloaded: boolean;
  /** Set by an eviction; the layout effect reports the rendered rows again, in case a report ran before the rows unloaded. */
  reportAfterUnload: boolean;
  pumping: boolean;
  pumpAgain: boolean;
};

function createCore<TData>(): Core<TData> {
  return { count: null, ready: false, loaded: [], kind: "unknown", seq: freshSequence(), inFlight: new Map(), failed: new Map(), pending: [], cancelFrame: null, lastWindow: null, rowsLength: 0, warned: new Set(), displaced: new Map(), absent: new Set(), deleted: new Set(), cancelQueuedRefresh: null, orphans: new Map(), carried: new Set(), empty: [], stale: [], cleared: new Set(), restored: new Set(), wanted: new Map(), delayTimer: null, owed: [], viewed: new Map(), tick: 0, keep: null, evictedBlocks: new Set(), unloaded: false, reportAfterUnload: false, pumping: false, pumpAgain: false };
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

function busy<TData>(core: Core<TData>): boolean {
  return core.inFlight.size > 0 || core.pending.length > 0 || core.owed.length > 0;
}

function resetQueues<TData>(core: Core<TData>) {
  if (core.delayTimer !== null) clearTimeout(core.delayTimer);
  core.delayTimer = null;
  core.wanted.clear();
  core.owed = [];
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
export function useScrollBlocks<TData, TCursor = never>(options: WithRowId<UseDataGridServerRowsScrollOptions<TData, TCursor>, TData>): UseDataGridServerRowsScrollResult<TData> {
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
  const { setSaveCheckListener, plugins, protectedRows, savingRows, guardMissing, markEdited, saveMark, savedSince, pruneSaves, overlayPushed, streamUpdateRow, setSettleListener, setReshapeListener, forgetStructural, evictionProtected, acknowledge, unacknowledgedRows } = useRefreshGuard({ trackUnacknowledged: true });
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
  const limits = useCallback((): FetchLimits => {
    const read = readFetchLimits(blockSize(), live.current.options);
    if (read.maxLoadedRowsInvalid) warn("maxLoadedRows", `maxLoadedRows must be a number of rows or Infinity, so the hook uses ${DEFAULT_MAX_LOADED_ROWS}`);
    return read;
  }, [blockSize, warn]);
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

  const protectedFromEviction = useCallback((): ProtectedRows => {
    const mark = oldestMark(getCore());
    return unionIds(evictionProtected(), mark === null ? null : savedSince(mark));
  }, [getCore, evictionProtected, savedSince]);

  const commit = useCallback(() => {
    const core = getCore();
    const pending = core.pending.splice(0);
    if (pending.length === 0) return;
    const batch = pending.map(({ start, rows, guard, mark }) => ({ start, rows: overlayPushed(rows, mark, start, live.current.options.getRowId as (row: TData | undefined, index: number) => string), guard: unionIds(guard, savedSince(mark)) }));
    const final = pending[pending.length - 1]!.final === true || core.inFlight.size === 0;
    const displaced = core.displaced;
    const memory = { orphans: core.orphans, carried: core.carried };
    const length = core.kind === "sequence" ? core.rowsLength : null;
    const guarded = protectedRows();
    // A sequential refresh shrinks `loaded` at its end, before the commit, so it scans the whole dense array.
    const ranges = core.kind === "sequence" ? [{ start: 0, end: Number.MAX_SAFE_INTEGER }] : core.stale.length > 0 ? mergeRanges([...core.loaded, ...core.stale]) : core.loaded;
    const idOf = live.current.options.getRowId;
    const unacknowledged = unacknowledgedWithoutSave(unacknowledgedRows(), savingRows());
    if (unacknowledged !== null) {
      for (const { start, rows, guard } of batch) {
        const guardedHere = unionIds(guard, guarded);
        rows.forEach((row, index) => {
          if (row === undefined) return;
          const id = idOf(row, start + index);
          if (unacknowledged.has(id) && !guardedHere?.has(id)) acknowledge(id);
        });
      }
    }
    const size = blockSize();
    const cap = limits().maxLoadedRows;
    const loadedNow = core.stale.length > 0 ? mergeRanges([...core.loaded, ...core.stale]) : core.loaded;
    const keep = core.keep;
    const evicting = core.kind === "random" && keep !== null && Number.isFinite(cap) && sumRangeSizes(loadedNow) > cap;
    setRows((prev) => {
      const base = length === null ? prev : Object.assign(prev.slice(), { length });
      const written = writeBlocks(base, batch, guarded, displaced, ranges, idOf, memory, final);
      for (const slot of written.cleared) core.cleared.add(slot);
      for (const slot of written.restored) core.restored.add(slot);
      return evicting ? evictRows(core, written.rows, { loaded: loadedNow, keep, size, cap, protectedIds: protectedFromEviction(), idOf }) : written.rows;
    });
  }, [getCore, protectedRows, savingRows, savedSince, overlayPushed, unacknowledgedRows, acknowledge, blockSize, limits, protectedFromEviction]);

  const unloadSlots = useCallback(
    (ranges: readonly RowRange[], reportAfter = false) => {
      const core = getCore();
      core.empty = core.empty.flatMap((empty) => subtractRanges(empty, ranges));
      const held = mergeRanges([...core.loaded, ...core.stale]);
      const targets = ranges.flatMap((range) => held.map((slice) => ({ start: Math.max(range.start, slice.start), end: Math.min(range.end, slice.end) })).filter((overlap) => overlap.end > overlap.start));
      if (targets.length === 0) return;
      const idOf = live.current.options.getRowId;
      setRows((prev) => {
        const unloaded = unloadRows(prev, targets, protectedFromEviction(), idOf);
        forgetUnloaded(core, unloaded.cleared, unloaded.kept);
        if (reportAfter) core.reportAfterUnload = true;
        return unloaded.rows;
      });
    },
    [getCore, protectedFromEviction],
  );

  // The first landing commits at once; later ones wait for the next frame, so a burst costs one copy of the rows per frame.
  const commitSoon = useCallback(
    () =>
      commitOnFrame(getCore(), commit, () => {
        const core = getCore();
        release(core);
        setLoading(busy(core));
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
      resetQueues(core);
      core.viewed.clear();
      core.keep = null;
      core.evictedBlocks.clear();
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
  const pumpRef = useRef<() => void>(noop);

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
      if (core.kind === "unknown") {
        const declared = live.current.options.source;
        core.kind = declared === "sequential" ? "sequence" : declared === "random" ? "random" : startsSequence(read) ? "sequence" : "random";
        const passed: unknown = live.current.options.maxLoadedRows;
        if (core.kind === "sequence" && typeof passed === "number" && Number.isFinite(passed)) warn("sequential-cap", "maxLoadedRows has no effect on a sequential source: a cursor chain cannot fetch an arbitrary block again, so every loaded row stays");
      }
      if (core.kind === "sequence") {
        landSequence(range, read, sentCursor, guard);
        return;
      }
      if (live.current.options.source === "random" && typeof read.totalRowCount !== "number") {
        warn("random-count", 'source is "random" but fetchRows answered without a totalRowCount; the rows end at this block. Answer the count with every block');
      }
      const first = !core.ready;
      const nextCount = typeof read.totalRowCount === "number" ? read.totalRowCount : (core.count ?? range.start + read.rows.length);
      const refire = first || nextCount !== core.count;
      let keep: { displaced: Map<string, TData>; orphans: Map<string, { row: TData; slot: number }>; guarded: ProtectedRows; ranges: RowRange[] } | null = null;
      if (!first && nextCount !== core.count) {
        abortRequestsExcept(core, range);
        resetQueues(core);
        core.viewed.clear();
        core.keep = null;
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
        stampLanded(core, range.start, written, blockSize(), limits().maxLoadedRows);
        core.pending.push({ start: range.start, rows, guard: guard.ids, mark: guard.mark, final: core.inFlight.size <= 1 });
        commitSoon();
        notifyLoaded(range.start, range.start + written);
      }
      if (refire && core.lastWindow) windowRef.current(core.lastWindow);
    },
    [getCore, warn, commitSoon, landSequence, notifyLoaded, protectedRows, savedSince, forgetStructural, blockSize, limits],
  );

  const runFetch = useCallback(
    (range: RowRange, cursor?: unknown) => {
      const core = getCore();
      const key = rangeKey(range);
      if (core.inFlight.has(key)) return;
      const controller = new AbortController();
      const guard: Guard = { ids: savingRows(), mark: saveMark() };
      core.inFlight.set(key, { range, controller, guard, landed: false });
      setLoading(true);
      const settle = () => {
        if (core.inFlight.get(key)?.controller !== controller) return;
        core.inFlight.delete(key);
        release(core);
        // Rows still waiting for the next frame count as loading, so "ready" means the rows are on screen.
        setLoading(busy(core));
        pumpRef.current();
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
            const entry = core.inFlight.get(key);
            if (entry?.controller === controller) entry.landed = true;
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

  const startDueBlocks = useCallback(() => {
    const core = getCore();
    if (core.delayTimer !== null) clearTimeout(core.delayTimer);
    core.delayTimer = null;
    if (!core.ready) return;
    const size = blockSize();
    const { loadDelayMs, maxConcurrentFetches } = limits();
    const centre = core.lastWindow ? (core.lastWindow.start + core.lastWindow.end) / 2 : 0;
    const armTimer = (nextAt: number | null) => {
      if (nextAt === null) return;
      core.delayTimer = setTimeout(() => {
        core.delayTimer = null;
        pumpRef.current();
      }, Math.max(0, nextAt - Date.now()));
    };
    if (core.kind === "sequence") {
      const { seq } = core;
      if (seq.ended || seq.refresh || core.inFlight.size > 0 || !core.lastWindow || !needsNextBlock(core.lastWindow, seq.length, overscanOf())) {
        core.wanted.clear();
        return;
      }
      const { due, nextAt } = dueWanted(core.wanted, { now: Date.now(), delay: loadDelayMs, centre, limit: 1 });
      if (due.length > 0) {
        core.wanted.clear();
        runFetch({ start: seq.offset, end: seq.offset + size }, seq.cursor);
      } else armTimer(nextAt);
      return;
    }
    if (core.kind !== "random" || core.count === null) return;
    while (core.inFlight.size < maxConcurrentFetches && core.owed.length > 0) {
      let nearest = 0;
      core.owed.forEach((block, index) => {
        if (distanceToCentre(block, centre) < distanceToCentre(core.owed[nearest]!, centre)) nearest = index;
      });
      runFetch(core.owed.splice(nearest, 1)[0]!);
    }
    if (core.owed.length > 0) return;
    const free = maxConcurrentFetches - core.inFlight.size;
    const { due } = dueWanted(core.wanted, { now: Date.now(), delay: loadDelayMs, centre, limit: free });
    for (const block of due) {
      core.wanted.delete(block.start);
      runFetch(block);
    }
    armTimer(dueWanted(core.wanted, { now: Date.now(), delay: loadDelayMs, centre, limit: 0 }).nextAt);
  }, [getCore, blockSize, limits, overscanOf, runFetch]);

  const pump = useCallback(() => runPumps(getCore(), startDueBlocks), [getCore, startDueBlocks]);
  useLayoutEffect(() => {
    pumpRef.current = pump;
  }, [pump]);

  const leaveKeepRange = useCallback(
    (keep: RowRange) => {
      const core = getCore();
      const left: RowRange[] = [];
      for (const [key, entry] of core.inFlight) {
        if (entry.landed || rangesIntersect(entry.range, keep)) continue;
        entry.controller.abort();
        core.inFlight.delete(key);
        left.push(entry.range);
      }
      const owedInside = core.owed.filter((block) => rangesIntersect(block, keep));
      left.push(...core.owed.filter((block) => !owedInside.includes(block)));
      core.owed = owedInside;
      let forgotten = false;
      for (const [key, failure] of core.failed) {
        if (rangesIntersect(failure.range, keep)) continue;
        core.failed.delete(key);
        forgotten = true;
      }
      if (forgotten && core.failed.size === 0) setError(null);
      if (left.length === 0) return;
      setLoading(busy(core));
      unloadSlots(left, true);
    },
    [getCore, unloadSlots],
  );

  // `immediate` skips the load delay: the user did not move for it.
  const reportRange = useCallback(
    (range: RowRange, immediate: boolean) => {
      const core = getCore();
      core.lastWindow = range;
      if (core.ready && core.kind === "sequence") {
        const { seq } = core;
        if (!seq.ended && !seq.refresh && core.inFlight.size === 0 && needsNextBlock(range, seq.length, overscanOf())) {
          const { loadDelayMs } = limits();
          trackWanted(core.wanted, [{ start: seq.offset, end: seq.offset + blockSize() }], immediate ? Date.now() - loadDelayMs : Date.now());
        } else core.wanted.clear();
        pump();
        return;
      }
      if (!core.ready || core.count === null) return;
      const size = blockSize();
      const wantedRange = expandRange(range, { overscan: overscanOf(), blockSize: size, total: core.count });
      if (rangeSize(wantedRange) === 0) return;
      const { loadDelayMs, maxLoadedRows } = limits();
      const keep = keepRange(wantedRange, size, core.count);
      core.keep = keep;
      if (Number.isFinite(maxLoadedRows)) stampViewed(core, keep, size, maxLoadedRows);
      leaveKeepRange(keep);
      const covered = [...core.loaded, ...core.empty, ...Array.from(core.inFlight.values(), (entry) => entry.range), ...core.owed];
      const uncovered = subtractRanges(wantedRange, covered).flatMap((gap) => chunkAligned(gap, size));
      trackWanted(core.wanted, uncovered, immediate ? Date.now() - loadDelayMs : Date.now());
      pump();
    },
    [getCore, overscanOf, blockSize, limits, leaveKeepRange, pump],
  );
  const onRenderedRowsChange = useCallback((range: RowRange) => reportRange(range, false), [reportRange]);
  useLayoutEffect(() => {
    windowRef.current = (range) => reportRange(range, true);
  }, [reportRange]);

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
      resetQueues(core);
      abortRequests();
      core.cancelFrame?.();
      core.cancelFrame = null;
    };
    // `specKey` stands for the spec content.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey]);

  const evictRange = useCallback(
    (range: RowRange) => {
      const core = getCore();
      if (core.kind === "sequence") return;
      const target = { start: Math.max(0, range.start), end: Math.min(core.count ?? 0, range.end) };
      if (target.end <= target.start) return;
      commit();
      let aborted = false;
      for (const [key, entry] of core.inFlight) {
        if (!rangesIntersect(entry.range, target)) continue;
        entry.controller.abort();
        core.inFlight.delete(key);
        aborted = true;
      }
      core.owed = core.owed.filter((block) => !rangesIntersect(block, target));
      if (aborted) {
        setLoading(busy(core));
        pumpRef.current();
      }
      unloadSlots([target]);
    },
    [getCore, commit, unloadSlots],
  );
  const evict = evictRange;

  const retry = useCallback(() => {
    const core = getCore();
    if (core.failed.size === 0) return;
    const failures = Array.from(core.failed.values());
    core.failed.clear();
    setError(null);
    if (core.kind === "random" && core.ready) {
      for (const { range } of failures) if (!core.owed.some((block) => rangeKey(block) === rangeKey(range))) core.owed.push(range);
      setLoading(true);
      pumpRef.current();
      return;
    }
    for (const { range, cursor } of failures) runFetch(range, cursor);
  }, [getCore, runFetch]);

  // A protected row that left its old slot must not leave the slot marked loaded; the next window fetches it again.
  useLayoutEffect(() => {
    const core = getCore();
    if (core.unloaded) {
      core.unloaded = false;
      for (const index of core.evictedBlocks) core.viewed.delete(index);
      core.evictedBlocks.clear();
      setLoadedCount(sumRangeSizes(core.loaded));
      if (core.reportAfterUnload) {
        core.reportAfterUnload = false;
        if (core.lastWindow) windowRef.current(core.lastWindow);
      }
    }
    if (core.restored.size > 0) {
      core.stale = mergeRanges([...core.stale, ...Array.from(core.restored, (slot) => ({ start: slot, end: slot + 1 }))]);
      core.restored.clear();
    }
    if (core.cleared.size === 0) return;
    const slots = Array.from(core.cleared);
    core.cleared.clear();
    if (core.kind === "sequence") return;
    core.loaded = mergeRanges(slots.reduce<RowRange[]>((kept, slot) => kept.flatMap((range) => subtractRanges(range, [{ start: slot, end: slot + 1 }])), core.loaded));
    setLoadedCount(sumRangeSizes(core.loaded));
    if (core.lastWindow) windowRef.current(core.lastWindow);
  }, [rows, getCore]);

  const restartClockRef = useRef<() => void>(noop);
  const refreshRef = useRef<() => void>(noop);
  const canRevalidate = useCallback(() => {
    const core = getCore();
    if (core.kind !== "sequence") return true;
    const size = blockSize();
    return Math.ceil(Math.max(size, (core.lastWindow?.end ?? 0) + overscanOf()) / size) <= MAX_SEQUENTIAL_REVALIDATE_BLOCKS;
  }, [getCore, blockSize, overscanOf]);
  const { request: requestReshape, cancel: cancelReshape } = useReshape({ delay: options.reshapeDelayMs, run: () => refreshRef.current(), busy: loading, canRun: canRevalidate, resetKey: specKey, warn });
  const reshape = useCallback(() => requestReshape("soon"), [requestReshape]);
  useEffect(() => {
    setReshapeListener(requestReshape);
    return () => setReshapeListener(null);
  }, [setReshapeListener, requestReshape]);
  const refresh = useCallback(() => {
    cancelReshape();
    restartClockRef.current();
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
      resetQueues(core);
      core.failed.clear();
      setError(null);
      core.seq.seen = new Set();
      core.seq.refresh = { keepUntil: Math.max(size, (core.lastWindow?.end ?? 0) + overscanOf()), local: 0 };
      runFetch({ start: 0, end: size });
      return;
    }
    const keep = core.lastWindow ? expandRange(core.lastWindow, { overscan: overscanOf(), blockSize: size, total: core.count! }) : { start: 0, end: Math.min(size, core.count!) };
    abortRequests();
    resetQueues(core);
    core.failed.clear();
    core.empty = [];
    setError(null);
    for (const outside of subtractRanges({ start: 0, end: core.count! }, [keep])) evictRange(outside);
    core.owed = chunkRange(keep, size);
    setLoading(core.owed.length > 0);
    pumpRef.current();
  }, [getCore, runFetch, evictRange, abortRequests, blockSize, overscanOf, guardMissing, warn, commit, cancelReshape]);

  useLayoutEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  const restartClock = useRevalidation({ interval: options.revalidateIntervalMs, onTick: () => refreshRef.current(), busy: loading, canTick: canRevalidate, resetKey: specKey });
  useLayoutEffect(() => {
    restartClockRef.current = restartClock;
  }, [restartClock]);

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
        return change.ops.length > 0 ? (applyChangeWith(prev as TData[], change, getRowId, { rowOfUpdate: streamUpdateRow(change) }) as (TData | undefined)[]) : (next.slice() as (TData | undefined)[]);
      });
      if (core.kind === "sequence") followRowOperations(change);
      trackDeletes(core.deleted, change);
      if (core.kind !== "sequence" && core.ready && change.ops.some((op) => op.type !== "update")) {
        // A local insert, delete, or move shifts rows away from the positions the loaded ranges name; the refresh loads the rendered ones again.
        const inserted = change.ops.filter((op) => op.type === "insert").length;
        core.stale = mergeRanges([...core.stale, ...core.loaded].map((range) => ({ start: range.start, end: range.end + inserted })));
        core.loaded = [];
        setLoadedCount(0);
        // A burst of row operations refreshes once, on the next frame. A push goes through the reshape rule instead.
        if (change.source === "stream") requestReshape("soon");
        else if (core.cancelQueuedRefresh === null) {
          core.cancelQueuedRefresh = scheduleFrame(() => {
            core.cancelQueuedRefresh = null;
            refreshRef.current();
          });
        }
      } else if (core.kind === "sequence" && change.source === "stream" && change.ops.some((op) => op.type !== "update")) {
        requestReshape("soon");
      }
      const onDataChange = live.current.options.onDataChange;
      if (onDataChange) isolate("onDataChange", () => onDataChange(next, change));
    },
    [getCore, commit, getRowId, warn, followRowOperations, markEdited, requestReshape, streamUpdateRow],
  );

  const refreshAfterSave = useCallback(() => {
    if (canRevalidate()) refresh();
  }, [canRevalidate, refresh]);
  const onSave = useSaveRefresh(options, refreshAfterSave, setSaveCheckListener);

  const providerProps = useMemo<UseDataGridServerRowsScrollProviderProps<TData>>(
    () => ({
      data: rows as TData[],
      getRowId,
      onDataChange,
      ...(onSave ? { onSave } : {}),
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
      checkedRowsLifetime: "across-filters",
      plugins,
    }),
    [rows, count, spec, getRowId, onDataChange, onSave, onRenderedRowsChange, onSortChange, onFilterChange, onSearchTextChange, plugins],
  );
  const rootProps = useMemo<UseDataGridServerRowsRootProps>(() => ({ loading, error, onRetry: retry }), [loading, error, retry]);
  const gridProps = useMemo(() => ({ ...providerProps, ...rootProps }), [providerProps, rootProps]);

  const status = error !== null ? "error" : loading ? "loading" : "ready";
  const unloadedCount = skeletons ?? (count ?? 0) - loadedCount;
  return { gridProps, providerProps, rootProps, spec, totalRowCount: count, status, loading, error, retry, refresh, reshape, unloadedCount, getLoadedRanges, evict };
}

function noop() {}

/** Unacknowledged rows that no save is pending for: a landed block replaces them, while a saving row keeps its local value. */
function unacknowledgedWithoutSave(unacknowledged: ReadonlySet<string> | null, saving: ProtectedRows): ReadonlySet<string> | null {
  if (unacknowledged === null || saving === null) return unacknowledged;
  const rest = new Set<string>();
  for (const id of unacknowledged) if (!saving.has(id)) rest.add(id);
  return rest.size > 0 ? rest : null;
}

/** Runs `step` until no call asked for another pass; a call from inside `step` only asks. */
function runPumps<TData>(core: Core<TData>, step: () => void) {
  if (core.pumping) {
    core.pumpAgain = true;
    return;
  }
  core.pumping = true;
  try {
    do {
      core.pumpAgain = false;
      step();
    } while (core.pumpAgain);
  } finally {
    core.pumping = false;
  }
}

function stampViewed<TData>(core: Core<TData>, keep: RowRange, size: number, cap: number) {
  const stamp = ++core.tick;
  for (let index = Math.floor(keep.start / size); index * size < keep.end; index++) core.viewed.set(index, stamp);
  if (core.viewed.size > Math.ceil(cap / size) * 2 + 256) pruneViewed(core.viewed, core.loaded, keep, size);
}

function stampLanded<TData>(core: Core<TData>, start: number, length: number, size: number, cap: number) {
  if (!Number.isFinite(cap)) return;
  for (let index = Math.floor(start / size); index * size < start + length; index++) if (!core.viewed.has(index)) core.viewed.set(index, core.tick);
}

/** Unloads the target slots of `prev` except protected rows; `cleared` lists the slots that were unloaded. Pure. */
function unloadRows<TData>(prev: readonly (TData | undefined)[], targets: readonly RowRange[], protectedIds: ProtectedRows, idOf: (row: TData, index: number) => string): { rows: (TData | undefined)[]; cleared: RowRange[]; kept: RowRange[] } {
  let next: (TData | undefined)[] | null = null;
  const kept: RowRange[] = [];
  for (const { start, end } of targets) {
    for (let index = start; index < Math.min(end, prev.length); index++) {
      const row = prev[index];
      if (row === undefined) continue;
      if (protectedIds?.has(idOf(row, index))) kept.push({ start: index, end: index + 1 });
      else (next ??= prev.slice())[index] = undefined;
    }
  }
  return { rows: next ?? (prev as (TData | undefined)[]), cleared: kept.length === 0 ? targets.slice() : targets.flatMap((target) => subtractRanges(target, kept)), kept };
}

/**
 * Removes unloaded slots from the ranges the hook claims. A kept slot (a protected row that stays) moves from `loaded` to `stale`,
 * so the next window fetches its block whole and the answer replaces or moves the row. Idempotent: a StrictMode updater may run twice.
 */
function forgetUnloaded<TData>(core: Core<TData>, cleared: readonly RowRange[], kept: readonly RowRange[] = []) {
  if (cleared.length === 0 && kept.length === 0) return;
  core.loaded = mergeRanges(core.loaded.flatMap((range) => subtractRanges(range, [...cleared, ...kept])));
  core.stale = mergeRanges([...core.stale.flatMap((range) => subtractRanges(range, cleared)), ...kept]);
  core.empty = core.empty.flatMap((range) => subtractRanges(range, cleared));
  core.unloaded = true;
}

type EvictInput<TData> = { loaded: readonly RowRange[]; keep: RowRange; size: number; cap: number; protectedIds: ProtectedRows; idOf: (row: TData, index: number) => string };

/** Unloads the least recently viewed blocks outside the keep range until the loaded rows fit the cap. Pure in `rows`; the core updates are idempotent. */
function evictRows<TData>(core: Core<TData>, rows: (TData | undefined)[], { loaded, keep, size, cap, protectedIds, idOf }: EvictInput<TData>): (TData | undefined)[] {
  const protectedSlots = protectedIds === null ? undefined : (block: RowRange) => protectedSlotsIn(rows, block, protectedIds, idOf);
  const picks = pickEvictions({ loaded, viewed: core.viewed, keep, blockSize: size, cap, protectedSlots });
  if (picks.length === 0) return rows;
  const ranges = picks.flatMap(unloadRangesOf);
  // `rows` is the fresh copy that `writeBlocks` returned, so the slots are written in place.
  for (const { start, end } of ranges) rows.fill(undefined, start, Math.min(end, rows.length));
  forgetUnloaded(core, ranges, picks.flatMap((pick) => pick.kept.map((slot) => ({ start: slot, end: slot + 1 }))));
  core.reportAfterUnload = true;
  for (const pick of picks) if (pick.kept.length === 0) core.evictedBlocks.add(pick.block.start / size);
  return rows;
}

function protectedSlotsIn<TData>(rows: readonly (TData | undefined)[], block: RowRange, protectedIds: ReadonlySet<string>, idOf: (row: TData, index: number) => string): number[] {
  const slots: number[] = [];
  for (let index = block.start; index < Math.min(block.end, rows.length); index++) {
    const row = rows[index];
    if (row !== undefined && protectedIds.has(idOf(row, index))) slots.push(index);
  }
  return slots;
}

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
