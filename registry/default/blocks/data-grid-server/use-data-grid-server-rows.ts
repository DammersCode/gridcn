"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { applyChangeWith, defaultGetRowId, isDev, type ExpandedState, type ServerGroupLayout } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { serverSpecKey, type DataChange, type DataGridPlugin, type FilterNode, type RowRange, type ServerSpec, type SortSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridServerPager, type DataGridPaginationControls } from "@/registry/default/blocks/data-grid-pagination/data-grid-pagination";
import { DEFAULT_PAGE_SIZES } from "@/registry/default/blocks/data-grid-pagination/pagination-math";
import { readRevalidateInterval } from "./fetch-hygiene";
import { MAX_ROW_COUNT, readAnswer, type FetchReason, type ReadAnswer, type ServerFetchAnswer, type ServerRowsAnswer, type ServerRowsPageRequest, type WithRowId } from "./read-answer";
import { isGroupsAnswer } from "./group-pages";
import type { ServerGroupsAnswer } from "./read-groups-answer";
import type { UseDataGridServerRowsScrollOptions } from "./scroll-blocks";
import type { UseDataGridServerRowsScrollResult } from "./scroll-types";
import { useScrollRows } from "./use-scroll-rows";
import { groupsEnabled, useGroupBlocks, type UseDataGridServerRowsGroupOptions } from "./use-group-blocks";
import { keepProtectedRows, pruneIds, trackDeletes, unionIds, useRefreshGuard, type ProtectedRows } from "./refresh-guard";
import { useSaveRefresh, type SaveRefreshOptions, type SaveRefreshPolicy } from "./save-refresh";
import { isolate, scheduleFrame, useControlled, useMountedPlugins, useRegisteredWiring, useReshape, useRevalidation, useServerSpec } from "./server-state";

export type { DataSourceState } from "./server-state";
export type { FetchReason, ServerRowsAnswer, ServerRowsPageRequest, ServerRowsRequest } from "./read-answer";
export type { UseDataGridServerRowsScrollOptions, UseDataGridServerRowsScrollProviderProps, UseDataGridServerRowsScrollResult } from "./scroll-blocks";

/** Options of {@link useDataGridServerRows} in pages mode. */
export type UseDataGridServerRowsOptions<TData, TCursor = never> = {
  /** `"pages"` fetches one page per state and drives `pager`. Fixed for the life of the hook. Default `"pages"`. */
  mode?: "pages";
  /** Identifies a row. Default: the row's `id` field (a string or number), the same default as `DataGridProvider`; a row without one throws. */
  getRowId?: (row: TData, index: number) => string;
  fetchRows: (request: ServerRowsPageRequest<TCursor>) => Promise<ServerFetchAnswer<TData, TCursor>>;
  /** Rows per page while `pageSize` is not controlled. Default: the first of `pageSizeOptions`. */
  defaultPageSize?: number;
  /** Controls the page size; pair it with `onPageSizeChange`. */
  pageSize?: number;
  onPageSizeChange?: (pageSize: number) => void;
  /** Page sizes the footer offers. Default 10, 25, 50, 100. */
  pageSizeOptions?: readonly number[];
  /** First page while `page` is not controlled. Default 1. */
  defaultPage?: number;
  /** Controls the current page; pair it with `onPageChange`. A page that is not a whole number of at least 1 reads as page 1. */
  page?: number;
  onPageChange?: (page: number) => void;
  /**
   * The sort, filter, and search while `spec` is not controlled. A function runs once on the client after mount, so it can read
   * `localStorage`; it returns the spec or `undefined`. The first request waits for it. An `initialAnswer` is the answer for the empty spec in that case.
   */
  defaultSpec?: Partial<ServerSpec> | (() => Partial<ServerSpec> | undefined);
  /** Controls the sort, filter, and search; pair it with `onSpecChange`. */
  spec?: ServerSpec;
  onSpecChange?: (spec: ServerSpec) => void;
  /** Fires after a request fails. */
  onError?: (error: unknown) => void;
  /**
   * Milliseconds between `refresh()` calls the hook runs itself while the page is visible. A tick waits for a request in flight,
   * and every refresh restarts the clock. At least 1000. Off by default.
   */
  revalidateIntervalMs?: number;
  /**
   * Milliseconds to wait after a push marked a row stale before the hook runs a `refresh()` (a reshape) so the server places the
   * rows again. The first push starts the wait and later pushes join it, so a steady feed reshapes at most once per delay. A
   * reshape that falls due during a request, or while the page is hidden, waits and runs once. At least 250. Default 1000 while the
   * spec has a sort or a filter, and off otherwise; `false` turns it off, and a stale row then waits for `reshape()`, `refresh()`, or a spec change.
   */
  reshapeDelayMs?: number | false;
  /**
   * Fetches the page after the current one in the background once the current page has landed. The pager shows that page with no
   * request. The prefetch is a plain page request; a failure is silent. A refresh, a revalidation tick, a spec or page size change,
   * a local insert, delete, or move, and the start of a save drop it. A landed page that the pager does not reach within
   * `revalidateIntervalMs` (30 seconds without it) is dropped too. While a save is pending, the prefetch waits. Default `false`.
   */
  prefetchNextPage?: boolean;
  /** Fires after the rows of a request land, with the range they cover. */
  onLoaded?: (range: RowRange) => void;
  /** Fires after the hook keeps an edit, insert, delete, or revert. A provider `onDataChange` after the spread runs next to the merge. */
  onDataChange?: (next: readonly TData[], change: DataChange<TData>) => void;
  /** Saves a change; spread to the provider through `gridProps.onSave`, where it behaves as the `DataGridProvider` prop of the same name. The hook refreshes after saves settle by `refreshAfterSave`. */
  onSave?: SaveRefreshOptions<TData>["onSave"];
  /** When the hook calls `refresh()` after `onSave` settles: `"settled"` once after every save in flight (default), `"each"` after saves settle without waiting for the saves in flight, `false` never, or a function that gets the counts and returns whether to refresh. */
  refreshAfterSave?: SaveRefreshPolicy;
  /** Plugins the hook mounts after its refresh guard, through `gridProps.plugins`. */
  plugins?: readonly DataGridPlugin<unknown>[];
  /**
   * The answer for the first state (`defaultSpec`, `defaultPage`, the first page size), for example from a Server Component.
   * The hook shows it without a request, so the server HTML holds the rows; the next state fetches as usual. It counts as
   * untrusted input like any answer. `onLoaded` does not fire for it.
   */
  initialAnswer?: ServerRowsAnswer<TData, TCursor> | ServerGroupsAnswer;
};

/** Return value of {@link useDataGridServerRows}. */
export type UseDataGridServerRowsResult<TData> = {
  /** Spread onto `<DataGrid {...server.gridProps} columns={columns} />`. */
  gridProps: UseDataGridServerRowsProviderProps<TData> & UseDataGridServerRowsRootProps;
  /** The part of `gridProps` for `<DataGridProvider>` in a composed layout. */
  providerProps: UseDataGridServerRowsProviderProps<TData>;
  /** The part of `gridProps` for `<DataGridRoot>` in a composed layout: the loading flag and the error state. */
  rootProps: UseDataGridServerRowsRootProps;
  /** The sort, filter, and search text of the current request. */
  spec: ServerSpec;
  /** The row count of the result; `null` when the server sends none. */
  totalRowCount: number | null;
  /** Spread onto `<DataGridPaginationBar {...server.pager} />`. */
  pager: DataGridPaginationControls;
  /** `"error"` wins over `"loading"`. */
  status: "loading" | "error" | "ready";
  /** A request of the current spec is in flight. */
  loading: boolean;
  /** The failure of the current request, or `null`. It clears when a new request starts. */
  error: unknown;
  /** Repeats the request that failed. Does nothing without an error. */
  retry: () => void;
  /**
   * Fetches the current page again and keeps the rows on screen until the answer lands. A row with a pending edit, delete, or in-flight save keeps its local state.
   * A pending insert stays at the end of the page, so the page can exceed `pageSize` until its save settles; when the last pending insert or delete settles, the hook calls it once, unless `refreshAfterSave` is `false`.
   * The hook also calls it after saves settle by `refreshAfterSave`; call it yourself with `refreshAfterSave: false` or a void `onSave`.
   */
  refresh: () => void;
  /** Asks the server to place the pushed rows again: one `refresh()` on the next frame, or after `reshapeDelayMs` when it is set. Calls in one frame join. */
  reshape: () => void;
};

/** Props of {@link UseDataGridServerRowsResult.gridProps} that belong to `DataGridProvider`. */
export type UseDataGridServerRowsProviderProps<TData> = {
  data: readonly TData[];
  getRowId: (row: TData, index: number) => string;
  /** Keeps the rows in step with edits, inserts, deletes, and reverts of a refused save. Send changes to your API from `onSave`. */
  onDataChange: (next: readonly TData[], change: DataChange<TData>) => void;
  /** Present when the hook got an `onSave`. */
  onSave?: SaveRefreshOptions<TData>["onSave"];
  sortMode: "server";
  filterMode: "server";
  sortState: SortSpec[];
  onSortChange: (next: SortSpec[]) => void;
  filterState: FilterNode[];
  onFilterChange: (next: FilterNode[]) => void;
  filterJoin: "and" | "or";
  onFilterJoinChange: (next: "and" | "or") => void;
  searchText: string;
  onSearchTextChange: (next: string) => void;
  /** The row count of the result; `null` when the server sends none. */
  totalRowCount: number | null;
  /** Keeps checks by row id across pages and server sorts and filters. */
  checkedRowsLifetime: "across-filters";
  /** The refresh guard that keeps a refresh from overwriting a row with a pending save or an open edit, then the `plugins` option. */
  plugins: readonly DataGridPlugin<unknown>[];
  /** Sorts on a header click. Override it after the spread. */
  headerClickBehavior: "sort";
  /** @internal Present while the source groups: reports the rendered rows so the open groups load their rows. */
  onRenderedRowsChange?: (range: RowRange) => void;
  /** Present while the source groups: the group columns, outermost first. */
  groupBy?: readonly string[];
  /** Present while the source groups. */
  onGroupByChange?: (next: readonly string[]) => void;
  /** Present while the source groups: the open groups. */
  expanded?: ExpandedState;
  /** Present while the source groups. */
  onExpandedChange?: (next: ExpandedState) => void;
  /** Present while `groupBy` is not empty. */
  groupMode?: "server";
  /** Present while `groupBy` is not empty. */
  groupLayout?: ServerGroupLayout;
};

/** Props of {@link UseDataGridServerRowsResult.gridProps} that belong to `DataGridRoot`. */
export type UseDataGridServerRowsRootProps = {
  loading: boolean;
  error: unknown;
  onRetry: () => void;
};

type CursorChain<TCursor> = { key: string; cursors: Map<number, TCursor | undefined> };

const furthestPage = (cursors: ReadonlyMap<number, unknown>) => [...cursors.keys()].reduce((a, b) => Math.max(a, b), 1);

function resetChain<TCursor>(chain: CursorChain<TCursor>, key: string) {
  if (chain.key === key) return;
  chain.key = key;
  chain.cursors.clear();
  chain.cursors.set(1, undefined);
}

/** Stores the cursor of the page after `page`, and drops the cursors that hung off the old one. */
function recordCursor<TCursor>(cursors: Map<number, TCursor | undefined>, page: number, nextCursor: TCursor | null) {
  if (!cursors.has(page) || Object.is(cursors.get(page + 1), nextCursor)) return;
  for (const known of cursors.keys()) if (known > page) cursors.delete(known);
  if (nextCursor !== null) cursors.set(page + 1, nextCursor);
}

type Settled<TData> = { key: string; view: string; rows: TData[]; totalRowCount: number | null; hasMore: boolean; error: unknown; chainKey: string; furthestPage: number; cursorSource: boolean };

const PREFETCH_MAX_AGE = 30_000;

/** A landed prefetch waiting for the pager to reach its page. */
type Landed<TData, TCursor> = { view: string; rows: TData[]; read: ReadAnswer<TData, TCursor>; guard: ProtectedRows; mark: number };

/** The page request after the current page. `adopted` is set when the user reached the page while the request ran. */
type PrefetchEntry = {
  view: string;
  controller: AbortController;
  guard: ProtectedRows;
  mark: number;
  landed: boolean;
  expiry: ReturnType<typeof setTimeout> | null;
  adopted: { key: string } | null;
};

/**
 * One server data source for the grid. It owns the sort, filter, and search unless you control them, aborts the request a
 * newer state replaces, and keeps the last good rows on screen while the next request runs or after an error. The state is
 * the grid's controlled state, so it works outside the provider and needs no bridge component.
 *
 * `mode: "pages"` (default) fetches one page per state and goes back to page 1 when the spec or the page size changes.
 * An answer with `nextCursor` makes pages a cursor source: the hook keeps the cursor of every page it reached, sends it back
 * as `cursor`, and drops the chain when the spec or the page size changes. Such a pager has no count and no jump past the chain.
 * `mode: "scroll"` fetches fixed-size blocks as the rendered rows move. An answer with `totalRowCount` makes it random access;
 * an answer with `nextCursor`, or with neither, makes it sequential: the loaded rows plus one block of skeletons.
 * The mode is fixed for the life of the hook.
 */
export function useDataGridServerRows<TData, TCursor = never>(options: UseDataGridServerRowsScrollOptions<TData, TCursor> & UseDataGridServerRowsGroupOptions): UseDataGridServerRowsScrollResult<TData>;
export function useDataGridServerRows<TData, TCursor = never>(options: UseDataGridServerRowsOptions<TData, TCursor> & UseDataGridServerRowsGroupOptions): UseDataGridServerRowsResult<TData>;
export function useDataGridServerRows<TData, TCursor = never>(options: (UseDataGridServerRowsOptions<TData, TCursor> & UseDataGridServerRowsGroupOptions) | (UseDataGridServerRowsScrollOptions<TData, TCursor> & UseDataGridServerRowsGroupOptions)) {
  const firstMode = useRef({ mode: options.mode ?? "pages", warned: false });
  if (isDev() && !firstMode.current.warned && (options.mode ?? "pages") !== firstMode.current.mode) {
    firstMode.current.warned = true;
    console.warn(`[data-grid-server] mode changed from "${firstMode.current.mode}" to "${options.mode ?? "pages"}"; the mode is fixed for the life of the hook, so remount it with a key`);
  }
  // The mode never changes for a mounted hook, so each render calls the same hooks in the same order.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  // oxlint-disable-next-line react-hooks/rules-of-hooks
  const [pagerWatch] = useState(() => new PagerWatch());
  const resolved = options.getRowId ? options : { ...options, getRowId: defaultGetRowId };
  return resolved.mode === "scroll" ? useScrollRows(resolved as WithRowId<UseDataGridServerRowsScrollOptions<TData, TCursor> & UseDataGridServerRowsGroupOptions, TData>) : pagerWatch.attach(usePagesRows(resolved as WithRowId<UseDataGridServerRowsOptions<TData, TCursor> & UseDataGridServerRowsGroupOptions, TData>, pagerWatch));
}

function usePagesRows<TData, TCursor>(options: WithRowId<UseDataGridServerRowsOptions<TData, TCursor> & UseDataGridServerRowsGroupOptions, TData>, pagerWatch: PagerWatch): UseDataGridServerRowsResult<TData> {
  const { pageSizeOptions = DEFAULT_PAGE_SIZES } = options;
  const [pageSize, setPageSize] = useControlled(options.pageSize, () => options.defaultPageSize ?? pageSizeOptions[0] ?? DEFAULT_PAGE_SIZES[0], options.onPageSizeChange);
  const [rawPage, setPage] = useControlled(options.page, () => options.defaultPage ?? 1, options.onPageChange);
  const maxPage = Math.max(1, Math.ceil(MAX_ROW_COUNT / Math.max(1, pageSize)));
  const wantedPage = Number.isSafeInteger(rawPage) && rawPage >= 1 ? Math.min(rawPage, maxPage) : 1;
  const live = useRef({ options, spec: EMPTY_LIVE_SPEC, page: wantedPage, pageSize, settledOnce: false, requested: false, error: null as unknown, leftInitial: false });
  const [grouping] = useState(() => groupsEnabled(options));
  const specState = useServerSpec(
    options,
    () => {
      if (live.current.settledOnce) setPage(1);
    },
    grouping,
  );
  const { spec, ready: specReady, onSortChange, onFilterChange, onFilterJoinChange, onSearchTextChange } = specState;
  const grouped = grouping && (spec.groupBy?.length ?? 0) > 0;
  const chainKey = `${serverSpecKey(spec)}|${pageSize}`;
  const chain = useRef<CursorChain<TCursor>>({ key: chainKey, cursors: new Map([[1, undefined]]) });
  const [initial] = useState(() => {
    if (options.initialAnswer === undefined || isGroupsAnswer(options.initialAnswer)) return null;
    const start = (wantedPage - 1) * pageSize;
    const read = readAnswer<TData, TCursor>(options.initialAnswer as ServerRowsAnswer<TData, TCursor>, { start, end: start + pageSize }, (_, message) => isDev() && console.warn(`[data-grid-server] ${message}`), options.getRowId);
    const view = `${serverSpecKey(spec)}|${wantedPage}|${pageSize}`;
    return { read, view, key: `${view}|0`, page: wantedPage };
  });
  const [settled, setSettled] = useState<Settled<TData>>(() => {
    const empty: Settled<TData> = { key: "", view: "", rows: [], totalRowCount: null, hasMore: false, error: null, chainKey: "", furthestPage: 1, cursorSource: false };
    if (initial === null) return empty;
    const { read } = initial;
    const cursorAnswer = read.nextCursor !== undefined;
    const rows = read.rows.filter((row) => row !== undefined) as TData[];
    // A fresh chain knows only page 1, so only a first-page cursor answer reaches page 2.
    const furthest = cursorAnswer && initial.page === 1 && read.nextCursor !== null ? 2 : 1;
    return { ...empty, key: initial.key, view: initial.view, rows, totalRowCount: read.totalRowCount ?? null, hasMore: cursorAnswer ? read.nextCursor !== null : read.hasMore, chainKey, furthestPage: furthest, cursorSource: cursorAnswer };
  });
  const cursorSource = settled.chainKey === chainKey && settled.cursorSource;
  const awaitingChain = !cursorSource && settled.cursorSource;
  const page = cursorSource ? Math.min(wantedPage, settled.furthestPage) : awaitingChain ? 1 : wantedPage;
  const [tick, setTick] = useState(0);
  const { plugins: guardPlugins, protectedRows, saveMark, savedSince, pruneSaves, overlayPushed, streamUpdateRow, savingRows, setSaveStartListener, setSavesSettledListener, setReshapeListener, setSettleListener } = useRefreshGuard();
  const [landed, setLanded] = useState<Landed<TData, TCursor> | null>(null);

  const specKey = serverSpecKey(spec);
  const view = `${specKey}|${page}|${pageSize}`;
  const key = `${view}|${tick}${specReady ? "" : "|seeding"}`;
  const deleted = useRef(new Set<string>());
  const prefetch = useRef<PrefetchEntry | null>(null);
  const openMarks = useRef<{ main: number | null; prefetch: number | null }>({ main: null, prefetch: null });
  const adoptedKey = useRef<string | null>(null);
  const nextReason = useRef<FetchReason>("load");

  const warned = useRef(new Set<string>());
  const warn = useCallback((kind: string, message: string) => {
    if (!isDev() || warned.current.has(kind)) return;
    warned.current.add(kind);
    console.warn(`[data-grid-server] ${message}`);
  }, []);

  const releaseMarks = useCallback(() => {
    const { main, prefetch: ahead } = openMarks.current;
    pruneSaves(main === null ? ahead : ahead === null ? main : Math.min(main, ahead));
    if (main === null && ahead === null) pruneIds(deleted.current, savingRows());
  }, [pruneSaves, savingRows]);

  const commitLanding = useCallback(
    (read: ReadAnswer<TData, TCursor>, landing: { key: string; view: string; page: number; start: number; guard: ProtectedRows; mark: number }) => {
      live.current.settledOnce = true;
      const cursorAnswer = read.nextCursor !== undefined;
      if (cursorAnswer) recordCursor(chain.current.cursors, landing.page, read.nextCursor as TCursor | null);
      const furthest = furthestPage(chain.current.cursors);
      const guarded = unionIds(unionIds(landing.guard, savedSince(landing.mark)), protectedRows());
      const gone = deleted.current.size > 0 ? new Set(deleted.current) : deleted.current;
      const answerRows = overlayPushed(read.rows.filter((row) => row !== undefined) as TData[], landing.mark, 0, live.current.options.getRowId);
      setSettled((prev) => ({
        key: landing.key,
        view: landing.view,
        rows: keepProtectedRows(answerRows, prev.rows, guarded, gone, prev.view === landing.view, live.current.options.getRowId),
        totalRowCount: read.totalRowCount === undefined ? prev.totalRowCount : read.totalRowCount,
        hasMore: cursorAnswer ? read.nextCursor !== null : read.hasMore,
        error: null,
        chainKey,
        furthestPage: furthest,
        cursorSource: cursorAnswer,
      }));
      const onLoaded = live.current.options.onLoaded;
      if (onLoaded) isolate("onLoaded", () => onLoaded({ start: landing.start, end: landing.start + read.rows.length }));
    },
    [savedSince, protectedRows, overlayPushed, chainKey],
  );

  const failRequest = useCallback((requestKey: string, error: unknown) => {
    const failure = error ?? new Error("fetchRows rejected");
    live.current.settledOnce = true;
    setSettled((prev) => ({ ...prev, key: requestKey, error: failure }));
    const onError = live.current.options.onError;
    if (onError) isolate("onError", () => onError(failure));
  }, []);

  const dropPrefetch = useCallback(() => {
    const entry = prefetch.current;
    if (entry === null) return;
    prefetch.current = null;
    if (entry.expiry !== null) clearTimeout(entry.expiry);
    if (!entry.landed) entry.controller.abort();
    openMarks.current.prefetch = null;
    releaseMarks();
    setLanded(null);
    if (entry.adopted !== null) setTick((n) => n + 1);
  }, [releaseMarks]);

  // A save can move a row to another page, so a page requested before it is stale.
  useEffect(() => {
    setSaveStartListener(dropPrefetch);
    return () => setSaveStartListener(null);
  }, [setSaveStartListener, dropPrefetch]);

  // The prefetch waits for pending saves; it runs again when the last one settles.
  const [savesSettled, setSavesSettled] = useState(0);
  useEffect(() => {
    setSavesSettledListener(() => setSavesSettled((n) => n + 1));
    return () => setSavesSettledListener(null);
  }, [setSavesSettledListener]);

  useEffect(() => {
    if (!specReady || grouped) return;
    const reason = nextReason.current;
    nextReason.current = "load";
    const adoptedRequest = adoptedKey.current === key;
    adoptedKey.current = null;
    if (adoptedRequest) return;
    if (initial !== null && !live.current.leftInitial && key === initial.key) {
      if (initial.read.nextCursor !== undefined) recordCursor(chain.current.cursors, initial.page, initial.read.nextCursor as TCursor | null);
      live.current.settledOnce = true;
      live.current.requested = true;
      return;
    }
    live.current.leftInitial = true;
    const ahead = prefetch.current;
    if (ahead !== null && ahead.view === view && !ahead.landed) {
      ahead.adopted = { key };
      live.current.requested = true;
      return () => {
        if (prefetch.current !== ahead || ahead.adopted?.key !== key) return;
        ahead.controller.abort();
        prefetch.current = null;
        openMarks.current.prefetch = null;
        releaseMarks();
      };
    }
    if (ahead !== null) dropPrefetch();
    const controller = new AbortController();
    const { page: requestPage, pageSize: requestSize } = live.current;
    const requestSpec = spec;
    resetChain(chain.current, chainKey);
    const protectedAtStart = savingRows();
    const markAtStart = saveMark();
    openMarks.current.main = markAtStart;
    releaseMarks();
    pruneIds(deleted.current, protectedAtStart);
    const start = (requestPage - 1) * requestSize;
    const range: RowRange = { start, end: start + requestSize };
    const settleMountState = live.current.requested ? Promise.resolve() : new Promise<void>((resolve) => setTimeout(resolve, 0));
    live.current.requested = true;
    // A state restored in a mount effect (URL state) replaces this request before it leaves.
    settleMountState
      .then(() => {
        if (controller.signal.aborted) return Promise.reject(controller.signal.reason);
        return live.current.options.fetchRows({ spec: requestSpec, page: requestPage, pageSize: requestSize, start, end: range.end, cursor: chain.current.cursors.get(requestPage), reason, signal: controller.signal });
      })
      .then((answer) => {
        if (controller.signal.aborted) return;
        const read = readAnswer<TData, TCursor>(answer, range, warn, live.current.options.getRowId);
        commitLanding(read, { key, view, page: requestPage, start, guard: protectedAtStart, mark: markAtStart });
        openMarks.current.main = null;
        releaseMarks();
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        openMarks.current.main = null;
        releaseMarks();
        failRequest(key, error);
      });
    return () => controller.abort();
    // `key` stands for spec, page, pageSize, and tick.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const prefetchOn = options.prefetchNextPage === true && !grouped;
  const startPrefetch = useCallback(() => {
    const { page: current, pageSize: size, spec: currentSpec } = live.current;
    const ahead = `${serverSpecKey(currentSpec)}|${current + 1}|${size}`;
    if (prefetch.current?.view === ahead || savingRows() !== null) return;
    dropPrefetch();
    const controller = new AbortController();
    const entry: PrefetchEntry = { view: ahead, controller, guard: savingRows(), mark: saveMark(), landed: false, expiry: null, adopted: null };
    prefetch.current = entry;
    openMarks.current.prefetch = entry.mark;
    const start = current * size;
    const range: RowRange = { start, end: start + size };
    new Promise<ServerFetchAnswer<TData, TCursor>>((resolve) => resolve(live.current.options.fetchRows({ spec: currentSpec, page: current + 1, pageSize: size, start, end: range.end, cursor: chain.current.cursors.get(current + 1), reason: "load", signal: controller.signal })))
      .then((answer) => {
        if (controller.signal.aborted) return;
        const read = readAnswer<TData, TCursor>(answer, range, warn, live.current.options.getRowId);
        entry.landed = true;
        if (entry.adopted !== null) {
          commitLanding(read, { key: entry.adopted.key, view: ahead, page: current + 1, start, guard: entry.guard, mark: entry.mark });
          prefetch.current = null;
          openMarks.current.prefetch = null;
          releaseMarks();
          return;
        }
        const maxAge = readRevalidateInterval(live.current.options.revalidateIntervalMs).interval ?? PREFETCH_MAX_AGE;
        entry.expiry = setTimeout(dropPrefetch, maxAge);
        setLanded({ view: ahead, rows: read.rows.filter((row) => row !== undefined) as TData[], read, guard: entry.guard, mark: entry.mark });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (entry.adopted === null) {
          dropPrefetch();
          return;
        }
        prefetch.current = null;
        openMarks.current.prefetch = null;
        releaseMarks();
        failRequest(entry.adopted.key, error);
      });
  }, [dropPrefetch, savingRows, saveMark, commitLanding, failRequest, releaseMarks, warn]);

  const adoptable = landed !== null && landed.view === view && settled.key !== key ? landed : null;
  const shown: Settled<TData> =
    adoptable === null ? settled : { key, view, rows: adoptable.rows, totalRowCount: adoptable.read.totalRowCount === undefined ? settled.totalRowCount : adoptable.read.totalRowCount, hasMore: adoptable.read.nextCursor !== undefined ? adoptable.read.nextCursor !== null : adoptable.read.hasMore, error: null, chainKey: settled.chainKey, furthestPage: settled.furthestPage, cursorSource: settled.cursorSource };

  const loading = shown.key !== key;
  const error = shown.key === key ? shown.error : null;
  useLayoutEffect(() => {
    Object.assign(live.current, { options, spec, page, pageSize, error });
  });

  // The pager reached the prefetched page: the landing runs without a request.
  useLayoutEffect(() => {
    const entry = prefetch.current;
    if (adoptable === null || entry === null || entry.view !== adoptable.view) return;
    adoptedKey.current = key;
    if (entry.expiry !== null) clearTimeout(entry.expiry);
    prefetch.current = null;
    pruneIds(deleted.current, savingRows());
    const { page: landedPage, pageSize: landedSize } = live.current;
    commitLanding(adoptable.read, { key, view, page: landedPage, start: (landedPage - 1) * landedSize, guard: adoptable.guard, mark: adoptable.mark });
    openMarks.current.prefetch = null;
    releaseMarks();
    setLanded(null);
    // The effect adopts once per landed entry and key.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [adoptable]);

  useEffect(() => {
    if (!prefetchOn || settled.key !== key || settled.error !== null) {
      if (!prefetchOn) dropPrefetch();
      return;
    }
    const hasNext = settled.totalRowCount !== null ? page * pageSize < settled.totalRowCount : settled.hasMore;
    if (!hasNext || page + 1 > maxPage) return;
    const timer = setTimeout(startPrefetch, 0);
    return () => clearTimeout(timer);
    // The effect follows landings, not local edits of the rows.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [prefetchOn, settled.key, settled.error, settled.totalRowCount, settled.hasMore, key, savesSettled]);

  useEffect(
    () => () => {
      const entry = prefetch.current;
      prefetch.current = null;
      if (entry === null) return;
      if (entry.expiry !== null) clearTimeout(entry.expiry);
      entry.controller.abort();
    },
    [],
  );

  const status = error !== null ? "error" : loading ? "loading" : "ready";
  const pagerNeeded = options.page === undefined && settled.key !== "" && (cursorSource ? settled.hasMore : settled.totalRowCount !== null && settled.totalRowCount > pageSize);
  useEffect(() => {
    if (pagerNeeded && !pagerWatch.seen) warn("pager", "pages mode has more rows than one page, but nothing read `pager`; spread `server.pager` onto DataGridPaginationBar or control `page`");
  }, [pagerNeeded, pagerWatch, warn]);
  useEffect(() => {
    if (grouped && options.prefetchNextPage === true) warn("prefetch-grouped", "`prefetchNextPage` has no effect while `groupBy` is set: a grouped page loads when the pager moves to it");
  }, [grouped, options.prefetchNextPage, warn]);
  useLayoutEffect(() => {
    if (page !== wantedPage) setPage(page);
  }, [page, wantedPage, setPage]);

  const seenSpecKey = useRef(specKey);
  const seenPage = useRef(page);
  useLayoutEffect(() => {
    const pageMoved = seenPage.current !== page;
    seenPage.current = page;
    if (seenSpecKey.current === specKey) return;
    seenSpecKey.current = specKey;
    // A spec the consumer changed from outside (browser back) lands here; a grid change already reset the page.
    if (live.current.settledOnce && !pageMoved && page !== 1) setPage(1);
  }, [specKey, page, setPage]);

  const retry = useCallback(() => {
    if (live.current.error === null) return;
    nextReason.current = "retry";
    setTick((n) => n + 1);
  }, []);
  const restartClockRef = useRef<() => void>(() => {});
  const refreshRef = useRef<(reason: FetchReason) => void>(() => {});
  const { request: requestReshape, cancel: cancelReshape } = useReshape({ delay: grouped ? false : options.reshapeDelayMs, ordered: spec.sorts.length + spec.filters.length > 0, run: () => refreshRef.current("refresh"), busy: loading, resetKey: view, warn });
  const reshape = useCallback(() => requestReshape("soon"), [requestReshape]);
  useEffect(() => {
    setReshapeListener(requestReshape);
    return () => setReshapeListener(null);
  }, [setReshapeListener, requestReshape]);
  const refreshFor = useCallback(
    (reason: FetchReason) => {
      cancelReshape();
      restartClockRef.current();
      nextReason.current = reason;
      setTick((n) => n + 1);
    },
    [cancelReshape],
  );
  const refresh = useCallback(() => refreshFor("refresh"), [refreshFor]);
  const refreshAfterSave = useCallback(() => refreshFor("save"), [refreshFor]);
  useLayoutEffect(() => {
    refreshRef.current = refreshFor;
  }, [refreshFor]);
  const keyRef = useRef(key);
  useLayoutEffect(() => {
    keyRef.current = key;
  }, [key]);
  // A settled insert or delete moves rows between pages; one frame later the page loads again, unless a request of its own already ran.
  useEffect(() => {
    let cancel: (() => void) | null = null;
    setSettleListener(() => {
      if (cancel !== null || live.current.options.refreshAfterSave === false) return;
      const keyAtSettle = keyRef.current;
      cancel = scheduleFrame(() => {
        cancel = null;
        if (keyRef.current === keyAtSettle) refreshRef.current("save");
      });
    });
    return () => {
      setSettleListener(null);
      cancel?.();
    };
  }, [setSettleListener]);
  const restartClock = useRevalidation({ interval: grouped ? undefined : options.revalidateIntervalMs, onTick: () => refreshRef.current("refresh"), busy: loading, resetKey: specKey });
  useLayoutEffect(() => {
    restartClockRef.current = restartClock;
  }, [restartClock]);

  const handledChanges = useRef(new WeakSet<object>());
  const onDataChange = useCallback(
    (next: readonly TData[], change: DataChange<TData>) => {
      if (handledChanges.current.has(change)) return;
      handledChanges.current.add(change);
      trackDeletes(deleted.current, change);
      if (((change.ops as typeof change.ops | undefined) ?? []).some((op) => op.type !== "update")) dropPrefetch();
      // `next` is the grid's snapshot and can predate a page that landed since; replaying the operations on the latest rows keeps it.
      setSettled((prev) => ({ ...prev, rows: (change.ops as typeof change.ops | undefined)?.length ? applyChangeWith(prev.rows, change, live.current.options.getRowId, { rowOfUpdate: streamUpdateRow(change) }) : (next as TData[]) }));
      if (change.source === "stream" && ((change.ops as typeof change.ops | undefined) ?? []).some((op) => op.type === "delete")) requestReshape("soon");
      live.current.options.onDataChange?.(next, change);
    },
    [dropPrefetch, requestReshape, streamUpdateRow],
  );
  const getRowId = useCallback((row: TData, index: number) => live.current.options.getRowId(row, index), []);

  const onPageSizeChange = useCallback(
    (next: number) => {
      setPageSize(next);
      setPage(1);
    },
    [setPageSize, setPage],
  );
  const { pager, gridProps: pagerGridProps } = useDataGridServerPager({
    page,
    pageSize,
    pageSizeOptions,
    totalRowCount: grouped || cursorSource ? null : shown.totalRowCount,
    hasMore: shown.hasMore && !awaitingChain,
    onPageChange: setPage,
    onPageSizeChange,
  });

  const { onSave, wrapSave } = useSaveRefresh(options, refreshAfterSave);

  const groupPages = useGroupBlocks(options as unknown as Parameters<typeof useGroupBlocks<TData, TCursor>>[0], specState, grouped, { page, pageSize, pageSizeOptions, onPageChange: setPage, onPageSizeChange });
  useLayoutEffect(() => {
    if (groupPages.groupCount !== null) live.current.settledOnce = true;
  });
  useMemo(() => armPagerRead(groupPages.pagerPlugins, pagerWatch), [groupPages.pagerPlugins, pagerWatch]);

  const pagerGuardPlugins = useMemo(() => {
    // a bare DataGridPaginationBar under this grid reads the pager through the stash plugin
    armPagerRead(pagerGridProps.plugins, pagerWatch);
    return [...guardPlugins, ...pagerGridProps.plugins];
  }, [guardPlugins, pagerGridProps.plugins, pagerWatch]);
  const plugins = useMountedPlugins(pagerGuardPlugins, options.plugins);

  const providerProps = useMemo<UseDataGridServerRowsProviderProps<TData>>(
    () => ({
      data: shown.rows,
      getRowId,
      onDataChange,
      ...(onSave ? { onSave } : {}),
      sortMode: "server",
      filterMode: "server",
      sortState: spec.sorts as SortSpec[],
      onSortChange,
      filterState: spec.filters as FilterNode[],
      onFilterChange,
      filterJoin: spec.filterJoin ?? "and",
      onFilterJoinChange,
      searchText: spec.searchText,
      onSearchTextChange,
      totalRowCount: shown.totalRowCount,
      checkedRowsLifetime: "across-filters",
      headerClickBehavior: "sort",
      plugins,
    }),
    [shown.rows, shown.totalRowCount, spec, getRowId, onDataChange, onSave, onSortChange, onFilterChange, onFilterJoinChange, onSearchTextChange, plugins],
  );
  useRegisteredWiring(providerProps, wrapSave);
  const rootProps = useMemo<UseDataGridServerRowsRootProps>(() => ({ loading, error, onRetry: retry }), [loading, error, retry]);
  const gridProps = useMemo(() => ({ ...providerProps, ...rootProps }), [providerProps, rootProps]);

  // Across a hand-off between the flat and the group engine, the engine on screen stays until the other one has answered.
  // Both report loading meanwhile: the flat key carries `groupBy`, and the group engine holds its view.
  const [shownGrouped, setShownGrouped] = useState(grouped);
  const arrived = grouped ? groupPages.answered || groupPages.result.error !== null : !loading || error !== null;
  useLayoutEffect(() => {
    if (shownGrouped !== grouped && arrived) setShownGrouped(grouped);
  }, [shownGrouped, grouped, arrived]);
  if (shownGrouped !== grouped && !arrived ? shownGrouped : grouped) {
    const { gridProps: groupedGrid, providerProps: groupedProvider, rootProps: groupedRoot, totalRowCount, status: groupedStatus, loading: groupedLoading, error: groupedError, retry: groupedRetry, refresh: groupedRefresh, reshape: groupedReshape } = groupPages.result;
    return { gridProps: groupedGrid, providerProps: groupedProvider, rootProps: groupedRoot, spec, totalRowCount, pager: groupPages.pager, status: groupedStatus, loading: groupedLoading, error: groupedError, retry: groupedRetry, refresh: groupedRefresh, reshape: groupedReshape } as UseDataGridServerRowsResult<TData>;
  }
  return { gridProps, providerProps, rootProps, spec, totalRowCount: shown.totalRowCount, pager, status, loading, error, retry, refresh, reshape };
}

/** Records whether the consumer read `pager`, so the hook can warn about a pager that nothing reads. */
const PAGER_READ = Symbol.for("gridcn.pager-read");

function armPagerRead(plugins: readonly object[], watch: PagerWatch) {
  for (const plugin of plugins) Object.assign(plugin, { [PAGER_READ]: () => void (watch.seen = true) });
}

class PagerWatch {
  seen = false;

  attach<T extends { pager: DataGridPaginationControls }>(result: T): T {
    const { pager } = result;
    const markSeen = () => {
      this.seen = true;
    };
    return {
      ...result,
      get pager() {
        markSeen();
        return pager;
      },
    };
  }
}

const EMPTY_LIVE_SPEC: ServerSpec = { sorts: [], filters: [], searchText: "" };
