"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { applyChangeWith, defaultGetRowId, isDev } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { serverSpecKey, type DataChange, type DataGridPlugin, type FilterNode, type RowRange, type ServerSpec, type SortSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridServerPager, type DataGridPaginationControls } from "@/registry/default/blocks/data-grid-pagination/data-grid-pagination";
import { DEFAULT_PAGE_SIZES } from "@/registry/default/blocks/data-grid-pagination/pagination-math";
import { readRevalidateInterval } from "./fetch-hygiene";
import { MAX_ROW_COUNT, readAnswer, type ReadAnswer, type ServerRowsAnswer, type ServerRowsPageRequest, type WithRowId } from "./read-answer";
import { useScrollBlocks, type UseDataGridServerRowsScrollOptions, type UseDataGridServerRowsScrollResult } from "./scroll-blocks";
import { GUARD_MISSING_MESSAGE, keepProtectedRows, pruneIds, trackDeletes, unionIds, useRefreshGuard, type GuardHandlers, type ProtectedRows } from "./refresh-guard";
import { useSaveRefresh, type SaveRefreshOptions, type SaveRefreshPolicy } from "./save-refresh";
import { isolate, scheduleFrame, useControlled, useMountedPlugins, useReshape, useRevalidation, useServerSpec } from "./server-state";

export type { DataSourceState } from "./server-state";
export type { ServerRowsAnswer, ServerRowsPageRequest, ServerRowsRequest } from "./read-answer";
export type { UseDataGridServerRowsScrollOptions, UseDataGridServerRowsScrollProviderProps, UseDataGridServerRowsScrollResult } from "./scroll-blocks";

/** Options of {@link useDataGridServerRows} in pages mode. */
export type UseDataGridServerRowsOptions<TData, TCursor = never> = {
  /** `"pages"` fetches one page per state and drives `pager`. Fixed for the life of the hook. Default `"pages"`. */
  mode?: "pages";
  /** Identifies a row. Default: the row's `id` field (a string or number), the same default as `DataGridProvider`; a row without one throws. */
  getRowId?: (row: TData, index: number) => string;
  fetchRows: (request: ServerRowsPageRequest<TCursor>) => Promise<ServerRowsAnswer<TData, TCursor>>;
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
  /** The sort, filter, and search while `spec` is not controlled. */
  defaultSpec?: Partial<ServerSpec>;
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
   * reshape that falls due during a request, or while the page is hidden, waits and runs once. At least 250. Off by default:
   * a stale row then waits for `reshape()`, `refresh()`, or a spec change.
   */
  reshapeDelayMs?: number;
  /**
   * Fetches the page after the current one in the background once the current page has landed. The pager shows that page with no
   * request. The prefetch is a plain page request; a failure is silent. A refresh, a revalidation tick, a spec or page size change,
   * a local insert, delete, or move, and the start of a save drop it. A landed page that the pager does not reach within
   * `revalidateIntervalMs` (30 seconds without it) is dropped too. While a save is pending, the prefetch waits. Default `false`.
   */
  prefetchNextPage?: boolean;
  /** Fires after the rows of a request land, with the range they cover. */
  onLoaded?: (range: RowRange) => void;
  /** Fires after the hook keeps an edit, insert, delete, or revert. Put your handler here; a spread override drops the merge. */
  onDataChange?: (next: readonly TData[], change: DataChange<TData>) => void;
  /** Saves a change; spread to the provider through `gridProps.onSave`, where it behaves as the `DataGridProvider` prop of the same name. The hook refreshes after saves settle by `refreshAfterSave`. */
  onSave?: SaveRefreshOptions<TData>["onSave"];
  /** When the hook calls `refresh()` after `onSave` settles: `"settled"` once after every save in flight (default), `"each"` after saves settle without waiting for the saves in flight, `false` never, or a function that gets the counts and returns whether to refresh. */
  refreshAfterSave?: SaveRefreshPolicy;
  /** Plugins the hook mounts after its refresh guard, through `gridProps.plugins`. */
  plugins?: readonly DataGridPlugin<unknown>[];
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
   * A pending insert stays at the end of the page, so the page can exceed `pageSize` until its save settles; when the last pending insert or delete settles, the hook calls it once, whatever `refreshAfterSave` says.
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
export function useDataGridServerRows<TData, TCursor = never>(options: UseDataGridServerRowsScrollOptions<TData, TCursor>): UseDataGridServerRowsScrollResult<TData>;
export function useDataGridServerRows<TData, TCursor = never>(options: UseDataGridServerRowsOptions<TData, TCursor>): UseDataGridServerRowsResult<TData>;
export function useDataGridServerRows<TData, TCursor = never>(options: UseDataGridServerRowsOptions<TData, TCursor> | UseDataGridServerRowsScrollOptions<TData, TCursor>) {
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
  return resolved.mode === "scroll" ? useScrollBlocks(resolved as WithRowId<UseDataGridServerRowsScrollOptions<TData, TCursor>, TData>) : pagerWatch.attach(usePagesRows(resolved as WithRowId<UseDataGridServerRowsOptions<TData, TCursor>, TData>, pagerWatch));
}

function usePagesRows<TData, TCursor>(options: WithRowId<UseDataGridServerRowsOptions<TData, TCursor>, TData>, pagerWatch: PagerWatch): UseDataGridServerRowsResult<TData> {
  const { pageSizeOptions = DEFAULT_PAGE_SIZES } = options;
  const [pageSize, setPageSize] = useControlled(options.pageSize, () => options.defaultPageSize ?? pageSizeOptions[0] ?? DEFAULT_PAGE_SIZES[0], options.onPageSizeChange);
  const [rawPage, setPage] = useControlled(options.page, () => options.defaultPage ?? 1, options.onPageChange);
  const maxPage = Math.max(1, Math.ceil(MAX_ROW_COUNT / Math.max(1, pageSize)));
  const wantedPage = Number.isSafeInteger(rawPage) && rawPage >= 1 ? Math.min(rawPage, maxPage) : 1;
  const live = useRef({ options, spec: EMPTY_LIVE_SPEC, page: wantedPage, pageSize, settledOnce: false, requested: false, error: null as unknown });
  const { spec, onSortChange, onFilterChange, onSearchTextChange } = useServerSpec(options, () => {
    if (live.current.settledOnce) setPage(1);
  });
  const chainKey = `${serverSpecKey(spec)}|${pageSize}`;
  const chain = useRef<CursorChain<TCursor>>({ key: chainKey, cursors: new Map([[1, undefined]]) });
  const [settled, setSettled] = useState<Settled<TData>>({ key: "", view: "", rows: [], totalRowCount: null, hasMore: false, error: null, chainKey: "", furthestPage: 1, cursorSource: false });
  const cursorSource = settled.chainKey === chainKey && settled.cursorSource;
  const awaitingChain = !cursorSource && settled.cursorSource;
  const page = cursorSource ? Math.min(wantedPage, settled.furthestPage) : awaitingChain ? 1 : wantedPage;
  const [tick, setTick] = useState(0);
  const { setHandlers, setSaveCheckListener, plugins: guardPlugins, protectedRows, guardMissing, markEdited, saveMark, savedSince, pruneSaves, overlayPushed, streamUpdateRow, savingRows, setSaveStartListener, setSavesSettledListener, setReshapeListener, setSettleListener } = useRefreshGuard();
  const [landed, setLanded] = useState<Landed<TData, TCursor> | null>(null);

  const specKey = serverSpecKey(spec);
  const view = `${specKey}|${page}|${pageSize}`;
  const key = `${view}|${tick}`;
  const deleted = useRef(new Set<string>());
  const prefetch = useRef<PrefetchEntry | null>(null);
  const openMarks = useRef<{ main: number | null; prefetch: number | null }>({ main: null, prefetch: null });
  const adoptedKey = useRef<string | null>(null);

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
    const adoptedRequest = adoptedKey.current === key;
    adoptedKey.current = null;
    if (adoptedRequest) return;
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
        return live.current.options.fetchRows({ spec: requestSpec, page: requestPage, pageSize: requestSize, start, end: range.end, cursor: chain.current.cursors.get(requestPage), signal: controller.signal });
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

  const prefetchOn = options.prefetchNextPage === true;
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
    new Promise<ServerRowsAnswer<TData, TCursor>>((resolve) => resolve(live.current.options.fetchRows({ spec: currentSpec, page: current + 1, pageSize: size, start, end: range.end, cursor: chain.current.cursors.get(current + 1), signal: controller.signal })))
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
    if (live.current.error !== null) setTick((n) => n + 1);
  }, []);
  const restartClockRef = useRef<() => void>(() => {});
  const refreshRef = useRef<() => void>(() => {});
  const { request: requestReshape, cancel: cancelReshape } = useReshape({ delay: options.reshapeDelayMs, run: () => refreshRef.current(), busy: loading, resetKey: view, warn });
  const reshape = useCallback(() => requestReshape("soon"), [requestReshape]);
  useEffect(() => {
    setReshapeListener(requestReshape);
    return () => setReshapeListener(null);
  }, [setReshapeListener, requestReshape]);
  const refresh = useCallback(() => {
    cancelReshape();
    restartClockRef.current();
    if (live.current.settledOnce && guardMissing()) warn("guard", GUARD_MISSING_MESSAGE);
    setTick((n) => n + 1);
  }, [guardMissing, warn, cancelReshape]);
  useLayoutEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);
  const keyRef = useRef(key);
  useLayoutEffect(() => {
    keyRef.current = key;
  }, [key]);
  // A settled insert or delete moves rows between pages; one frame later the page loads again, unless a request of its own already ran.
  useEffect(() => {
    let cancel: (() => void) | null = null;
    setSettleListener(() => {
      if (cancel !== null) return;
      const keyAtSettle = keyRef.current;
      cancel = scheduleFrame(() => {
        cancel = null;
        if (keyRef.current === keyAtSettle) refreshRef.current();
      });
    });
    return () => {
      setSettleListener(null);
      cancel?.();
    };
  }, [setSettleListener]);
  const restartClock = useRevalidation({ interval: options.revalidateIntervalMs, onTick: () => refreshRef.current(), busy: loading, resetKey: specKey });
  useLayoutEffect(() => {
    restartClockRef.current = restartClock;
  }, [restartClock]);

  const onDataChange = useCallback(
    (next: readonly TData[], change: DataChange<TData>) => {
      markEdited();
      trackDeletes(deleted.current, change);
      if (((change.ops as typeof change.ops | undefined) ?? []).some((op) => op.type !== "update")) dropPrefetch();
      // `next` is the grid's snapshot and can predate a page that landed since; replaying the operations on the latest rows keeps it.
      setSettled((prev) => ({ ...prev, rows: (change.ops as typeof change.ops | undefined)?.length ? applyChangeWith(prev.rows, change, live.current.options.getRowId, { rowOfUpdate: streamUpdateRow(change) }) : (next as TData[]) }));
      if (change.source === "stream" && ((change.ops as typeof change.ops | undefined) ?? []).some((op) => op.type === "delete")) requestReshape("soon");
      live.current.options.onDataChange?.(next, change);
    },
    [markEdited, dropPrefetch, requestReshape, streamUpdateRow],
  );
  const getRowId = useCallback((row: TData, index: number) => live.current.options.getRowId(row, index), []);

  const onPageSizeChange = useCallback(
    (next: number) => {
      setPageSize(next);
      setPage(1);
    },
    [setPageSize, setPage],
  );
  const { pager } = useDataGridServerPager({
    page,
    pageSize,
    pageSizeOptions,
    totalRowCount: cursorSource ? null : shown.totalRowCount,
    hasMore: shown.hasMore && !awaitingChain,
    onPageChange: setPage,
    onPageSizeChange,
  });

  const onSave = useSaveRefresh(options, refresh, setSaveCheckListener);

  const plugins = useMountedPlugins(guardPlugins, options.plugins);
  useLayoutEffect(() => setHandlers({ onDataChange: onDataChange as GuardHandlers["onDataChange"] }));

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
      searchText: spec.searchText,
      onSearchTextChange,
      totalRowCount: shown.totalRowCount,
      checkedRowsLifetime: "across-filters",
      headerClickBehavior: "sort",
      plugins,
    }),
    [shown.rows, shown.totalRowCount, spec, getRowId, onDataChange, onSave, onSortChange, onFilterChange, onSearchTextChange, plugins],
  );
  const rootProps = useMemo<UseDataGridServerRowsRootProps>(() => ({ loading, error, onRetry: retry }), [loading, error, retry]);
  const gridProps = useMemo(() => ({ ...providerProps, ...rootProps }), [providerProps, rootProps]);

  return { gridProps, providerProps, rootProps, spec, totalRowCount: shown.totalRowCount, pager, status, loading, error, retry, refresh, reshape };
}

/** Records whether the consumer read `pager`, so the hook can warn about a pager that nothing reads. */
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
