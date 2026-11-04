"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { isDev } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { serverSpecKey, type DataChange, type DataGridPlugin, type FilterNode, type RowRange, type ServerSpec, type SortSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridPagination, type DataGridPaginationControls } from "@/registry/default/blocks/data-grid-pagination/data-grid-pagination";
import { DEFAULT_PAGE_SIZES } from "@/registry/default/blocks/data-grid-pagination/pagination-math";
import { MAX_ROW_COUNT, readAnswer, type ServerRowsAnswer, type ServerRowsPageRequest } from "./read-answer";
import { useScrollBlocks, type UseDataGridServerRowsScrollOptions, type UseDataGridServerRowsScrollResult } from "./scroll-blocks";
import { GUARD_MISSING_MESSAGE, keepProtectedRows, pruneIds, trackDeletes, unionIds, useRefreshGuard } from "./refresh-guard";
import { isolate, useControlled, useServerSpec } from "./server-state";

export type { DataSourceState } from "./server-state";
export type { ServerRowsAnswer, ServerRowsPageRequest, ServerRowsRequest } from "./read-answer";
export type { UseDataGridServerRowsScrollOptions, UseDataGridServerRowsScrollProviderProps, UseDataGridServerRowsScrollResult } from "./scroll-blocks";

/** Options of {@link useDataGridServerRows} in pages mode. */
export type UseDataGridServerRowsOptions<TData> = {
  /** `"pages"` fetches one page per state and drives `pager`. Fixed for the life of the hook. Default `"pages"`. */
  mode?: "pages";
  getRowId: (row: TData, index: number) => string;
  fetchRows: (request: ServerRowsPageRequest) => Promise<ServerRowsAnswer<TData>>;
  /** Rows per page while `pageSize` is not controlled. Default: the first of `pageSizeOptions`. */
  defaultPageSize?: number;
  /** Controls the page size; pair it with `onPageSizeChange`. */
  pageSize?: number;
  onPageSizeChange?: (pageSize: number) => void;
  /** Page sizes the footer offers. Default 10, 25, 50, 100. */
  pageSizeOptions?: readonly number[];
  /** First page while `page` is not controlled. Default 1. */
  defaultPage?: number;
  /** Controls the current page; pair it with `onPageChange`. */
  page?: number;
  onPageChange?: (page: number) => void;
  /** The sort, filter, and search while `spec` is not controlled. */
  defaultSpec?: Partial<ServerSpec>;
  /** Controls the sort, filter, and search; pair it with `onSpecChange`. */
  spec?: ServerSpec;
  onSpecChange?: (spec: ServerSpec) => void;
  /** Fires after a request fails. */
  onError?: (error: unknown) => void;
  /** Fires after the rows of a request land, with the range they cover. */
  onLoaded?: (range: RowRange) => void;
  /** Fires after the hook keeps an edit, insert, delete, or revert. Put your handler here; a spread override drops the merge. */
  onDataChange?: (next: readonly TData[], change: DataChange<TData>) => void;
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
  /** Fetches the current page again and keeps the rows on screen until the answer lands. A block that lands (refresh, retry or window load) replaces every row it carries, except a row that has a pending cell edit or a save that was in flight at any moment since the request was sent: that row keeps its local value. A row with a pending delete is gone: the answer's copy is dropped and its slot stays empty. A protected row that the answer lacks, such as a pending insert, returns to its own slot when no answer row sits there; otherwise it is hidden, and a counted source refreshes once when the last pending insert or delete settles, so the server decides. A pages refresh appends such a row at the end of the page, so the page can exceed `pageSize` by pending inserts. A sequential refresh that ends before a pending insert may drop it until its save settles. A block shows each id once (the first row of a repeated id in an answer wins) and leaves no hole in its loaded range; rows that moved on the server can mix with older rows until the next refresh settles. Call it after the `onSave` promise settles to pick up server-computed fields. */
  refresh: () => void;
};

/** Props of {@link UseDataGridServerRowsResult.gridProps} that belong to `DataGridProvider`. */
export type UseDataGridServerRowsProviderProps<TData> = {
  data: readonly TData[];
  getRowId: (row: TData, index: number) => string;
  /** Keeps the rows in step with edits, inserts, deletes, and reverts of a refused save. Send changes to your API from `onSave`. */
  onDataChange: (next: readonly TData[], change: DataChange<TData>) => void;
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
  keepCheckedRows: true;
  /** Mounts the guard that keeps a refresh from overwriting a row with a pending save or an open edit. Put your own plugins after it. */
  plugins: readonly DataGridPlugin<unknown>[];
};

/** Props of {@link UseDataGridServerRowsResult.gridProps} that belong to `DataGridRoot`. */
export type UseDataGridServerRowsRootProps = {
  loading: boolean;
  error: unknown;
  onRetry: () => void;
};

type Settled<TData> = { key: string; view: string; rows: TData[]; totalRowCount: number | null; hasMore: boolean; error: unknown };

/**
 * One server data source for the grid. It owns the sort, filter, and search unless you control them, aborts the request a
 * newer state replaces, and keeps the last good rows on screen while the next request runs or after an error. The state is
 * the grid's controlled state, so it works outside the provider and needs no bridge component.
 *
 * `mode: "pages"` (default) fetches one page per state and goes back to page 1 when the spec or the page size changes.
 * `mode: "scroll"` fetches fixed-size blocks as the rendered rows move. An answer with `totalRowCount` makes it random access;
 * an answer with `nextCursor`, or with neither, makes it sequential: the loaded rows plus one block of skeletons.
 * The mode is fixed for the life of the hook.
 */
export function useDataGridServerRows<TData, TCursor = never>(options: UseDataGridServerRowsScrollOptions<TData, TCursor>): UseDataGridServerRowsScrollResult<TData>;
export function useDataGridServerRows<TData>(options: UseDataGridServerRowsOptions<TData>): UseDataGridServerRowsResult<TData>;
export function useDataGridServerRows<TData, TCursor = never>(options: UseDataGridServerRowsOptions<TData> | UseDataGridServerRowsScrollOptions<TData, TCursor>) {
  const firstMode = useRef({ mode: options.mode ?? "pages", warned: false });
  if (isDev() && !firstMode.current.warned && (options.mode ?? "pages") !== firstMode.current.mode) {
    firstMode.current.warned = true;
    console.warn(`[data-grid-server] mode changed from "${firstMode.current.mode}" to "${options.mode ?? "pages"}"; the mode is fixed for the life of the hook, so remount it with a key`);
  }
  // The mode never changes for a mounted hook, so each render calls the same hooks in the same order.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  // oxlint-disable-next-line react-hooks/rules-of-hooks
  return options.mode === "scroll" ? useScrollBlocks(options) : usePagesRows(options);
}

function usePagesRows<TData>(options: UseDataGridServerRowsOptions<TData>): UseDataGridServerRowsResult<TData> {
  const { pageSizeOptions = DEFAULT_PAGE_SIZES } = options;
  const [pageSize, setPageSize] = useControlled(options.pageSize, () => options.defaultPageSize ?? pageSizeOptions[0] ?? DEFAULT_PAGE_SIZES[0], options.onPageSizeChange);
  const [rawPage, setPage] = useControlled(options.page, () => options.defaultPage ?? 1, options.onPageChange);
  const maxPage = Math.max(1, Math.ceil(MAX_ROW_COUNT / Math.max(1, pageSize)));
  const page = Number.isSafeInteger(rawPage) && rawPage >= 1 ? Math.min(rawPage, maxPage) : 1;
  const live = useRef({ options, page, pageSize, settledOnce: false, requested: false, error: null as unknown });
  const { spec, onSortChange, onFilterChange, onSearchTextChange } = useServerSpec(options, () => {
    if (live.current.settledOnce) setPage(1);
  });
  const [tick, setTick] = useState(0);
  const { plugins, protectedRows, guardMissing, markEdited, saveMark, savedSince, pruneSaves, savingRows } = useRefreshGuard();
  const [settled, setSettled] = useState<Settled<TData>>({ key: "", view: "", rows: [], totalRowCount: null, hasMore: false, error: null });

  const view = `${serverSpecKey(spec)}|${page}|${pageSize}`;
  const key = `${view}|${tick}`;
  const deleted = useRef(new Set<string>());

  const warned = useRef(new Set<string>());

  useEffect(() => {
    const controller = new AbortController();
    const { page: requestPage, pageSize: requestSize } = live.current;
    const requestSpec = spec;
    const protectedAtStart = savingRows();
    const markAtStart = saveMark();
    pruneSaves(markAtStart);
    pruneIds(deleted.current, protectedAtStart);
    const start = (requestPage - 1) * requestSize;
    const range: RowRange = { start, end: start + requestSize };
    const warn = (kind: string, message: string) => {
      if (!isDev() || warned.current.has(kind)) return;
      warned.current.add(kind);
      console.warn(`[data-grid-server] ${message}`);
    };
    const settleMountState = live.current.requested ? Promise.resolve() : new Promise<void>((resolve) => setTimeout(resolve, 0));
    live.current.requested = true;
    // A state restored in a mount effect (URL state) replaces this request before it leaves.
    settleMountState
      .then(() => {
        if (controller.signal.aborted) return Promise.reject(controller.signal.reason);
        return live.current.options.fetchRows({ spec: requestSpec, page: requestPage, pageSize: requestSize, start, end: range.end, cursor: undefined, signal: controller.signal });
      })
      .then((answer) => {
        if (controller.signal.aborted) return;
        const read = readAnswer<TData>(answer, range, warn, live.current.options.getRowId);
        live.current.settledOnce = true;
        const guarded = unionIds(unionIds(protectedAtStart, savedSince(markAtStart)), protectedRows());
        pruneSaves(null);
        setSettled((prev) => ({
          key,
          view,
          rows: keepProtectedRows(read.rows.filter((row) => row !== undefined) as TData[], prev.rows, guarded, deleted.current, prev.view === view, live.current.options.getRowId),
          totalRowCount: read.totalRowCount === undefined ? prev.totalRowCount : read.totalRowCount,
          hasMore: read.hasMore,
          error: null,
        }));
        const onLoaded = live.current.options.onLoaded;
        if (onLoaded) isolate("onLoaded", () => onLoaded({ start, end: start + read.rows.length }));
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const failure = error ?? new Error("fetchRows rejected");
        live.current.settledOnce = true;
        pruneSaves(null);
        setSettled((prev) => ({ ...prev, key, error: failure }));
        const onError = live.current.options.onError;
        if (onError) isolate("onError", () => onError(failure));
      });
    return () => controller.abort();
    // `key` stands for spec, page, pageSize, and tick.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const loading = settled.key !== key;
  const error = settled.key === key ? settled.error : null;
  useLayoutEffect(() => {
    Object.assign(live.current, { options, page, pageSize, error });
  });
  const status = error !== null ? "error" : loading ? "loading" : "ready";

  const specKey = serverSpecKey(spec);
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
  const refresh = useCallback(() => {
    if (isDev() && live.current.settledOnce && guardMissing() && !warned.current.has("guard")) {
      warned.current.add("guard");
      console.warn(`[data-grid-server] ${GUARD_MISSING_MESSAGE}`);
    }
    setTick((n) => n + 1);
  }, [guardMissing]);

  const onDataChange = useCallback((next: readonly TData[], change: DataChange<TData>) => {
    markEdited();
    trackDeletes(deleted.current, change);
    setSettled((prev) => ({ ...prev, rows: next as TData[] }));
    live.current.options.onDataChange?.(next, change);
  }, [markEdited]);
  const getRowId = useCallback((row: TData, index: number) => live.current.options.getRowId(row, index), []);

  const onPageSizeChange = useCallback(
    (next: number) => {
      setPageSize(next);
      setPage(1);
    },
    [setPageSize, setPage],
  );
  const { pager } = useDataGridPagination({
    page,
    pageSize,
    pageSizeOptions,
    totalRowCount: settled.totalRowCount,
    hasNextPage: settled.hasMore,
    onPageChange: setPage,
    onPageSizeChange,
  });

  const providerProps = useMemo<UseDataGridServerRowsProviderProps<TData>>(
    () => ({
      data: settled.rows,
      getRowId,
      onDataChange,
      sortMode: "server",
      filterMode: "server",
      sortState: spec.sorts as SortSpec[],
      onSortChange,
      filterState: spec.filters as FilterNode[],
      onFilterChange,
      searchText: spec.searchText,
      onSearchTextChange,
      totalRowCount: settled.totalRowCount,
      keepCheckedRows: true,
      plugins,
    }),
    [settled.rows, settled.totalRowCount, spec, getRowId, onDataChange, onSortChange, onFilterChange, onSearchTextChange, plugins],
  );
  const rootProps = useMemo<UseDataGridServerRowsRootProps>(() => ({ loading, error, onRetry: retry }), [loading, error, retry]);
  const gridProps = useMemo(() => ({ ...providerProps, ...rootProps }), [providerProps, rootProps]);

  return { gridProps, providerProps, rootProps, spec, totalRowCount: settled.totalRowCount, pager, status, loading, error, retry, refresh };
}
