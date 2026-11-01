"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { isDev } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { serverSpecKey, type DataChange, type FilterNode, type RowRange, type ServerSpec, type SortSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridPagination, type DataGridPaginationControls } from "@/registry/default/blocks/data-grid-pagination/data-grid-pagination";
import { DEFAULT_PAGE_SIZES } from "@/registry/default/blocks/data-grid-pagination/pagination-math";
import { MAX_ROW_COUNT, readAnswer, type ServerRowsAnswer, type ServerRowsPageRequest } from "./read-answer";

export type { ServerRowsAnswer, ServerRowsPageRequest, ServerRowsRequest } from "./read-answer";

/** Options for {@link useDataGridServerRows}. */
export type UseDataGridServerRowsOptions<TData> = {
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
  /** Fetches the current page again and keeps the rows on screen until the answer lands. */
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
};

/** Props of {@link UseDataGridServerRowsResult.gridProps} that belong to `DataGridRoot`. */
export type UseDataGridServerRowsRootProps = {
  loading: boolean;
  error: unknown;
  onRetry: () => void;
};

type Settled<TData> = { key: string; rows: TData[]; totalRowCount: number | null; hasMore: boolean; error: unknown };

const EMPTY_SPEC: ServerSpec = { sorts: [], filters: [], searchText: "" };

function useControlled<T>(controlled: T | undefined, initial: () => T, onChange: ((next: T) => void) | undefined) {
  const [inner, setInner] = useState(initial);
  const latest = useRef({ controlled, onChange });
  useLayoutEffect(() => {
    latest.current = { controlled, onChange };
  });
  const set = useCallback((next: T) => {
    if (latest.current.controlled === undefined) setInner(next);
    latest.current.onChange?.(next);
  }, []);
  return [controlled ?? inner, set] as const;
}

function isolate(label: string, call: () => void) {
  try {
    call();
  } catch (error) {
    console.error(`[data-grid-server] ${label} threw`, error);
  }
}

/**
 * One server data source for the grid: it owns the sort, filter, search, page, and page size unless you control them,
 * fetches one page per state, aborts the request a newer state replaces, goes back to page 1 when the spec or the page
 * size changes, and keeps the last good rows on screen while the next page loads or after an error. The state is the
 * grid's controlled state, so it works outside the provider and needs no bridge component.
 */
export function useDataGridServerRows<TData>(options: UseDataGridServerRowsOptions<TData>): UseDataGridServerRowsResult<TData> {
  const { pageSizeOptions = DEFAULT_PAGE_SIZES } = options;
  const [spec, setSpec] = useControlled<ServerSpec>(
    options.spec,
    () => ({
      sorts: [...(options.defaultSpec?.sorts ?? EMPTY_SPEC.sorts)],
      filters: [...(options.defaultSpec?.filters ?? EMPTY_SPEC.filters)],
      searchText: options.defaultSpec?.searchText ?? EMPTY_SPEC.searchText,
    }),
    options.onSpecChange,
  );
  const [pageSize, setPageSize] = useControlled(options.pageSize, () => options.defaultPageSize ?? pageSizeOptions[0] ?? DEFAULT_PAGE_SIZES[0], options.onPageSizeChange);
  const [rawPage, setPage] = useControlled(options.page, () => options.defaultPage ?? 1, options.onPageChange);
  const maxPage = Math.max(1, Math.ceil(MAX_ROW_COUNT / Math.max(1, pageSize)));
  const page = Number.isSafeInteger(rawPage) && rawPage >= 1 ? Math.min(rawPage, maxPage) : 1;
  const [tick, setTick] = useState(0);
  const [settled, setSettled] = useState<Settled<TData>>({ key: "", rows: [], totalRowCount: null, hasMore: false, error: null });

  const key = `${serverSpecKey(spec)}|${page}|${pageSize}|${tick}`;

  const live = useRef({ options, spec, page, pageSize, settledOnce: false, requested: false, error: null as unknown });
  const warned = useRef(new Set<string>());

  useEffect(() => {
    const controller = new AbortController();
    const { spec: requestSpec, page: requestPage, pageSize: requestSize } = live.current;
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
        return live.current.options.fetchRows({ spec: requestSpec, page: requestPage, pageSize: requestSize, start, end: range.end, cursor: null, signal: controller.signal });
      })
      .then((answer) => {
        if (controller.signal.aborted) return;
        const read = readAnswer<TData>(answer, range, warn);
        live.current.settledOnce = true;
        setSettled((prev) => ({
          key,
          rows: read.rows,
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
    Object.assign(live.current, { options, spec, page, pageSize, error });
  });
  const status = error !== null ? "error" : loading ? "loading" : "ready";

  const retry = useCallback(() => {
    if (live.current.error !== null) setTick((n) => n + 1);
  }, []);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  const changeSpec = useCallback(
    (next: Partial<ServerSpec>) => {
      const merged = { ...live.current.spec, ...next };
      // Two changes in one effect (a URL restore) merge instead of overwriting each other.
      live.current.spec = merged;
      setSpec(merged);
      if (live.current.settledOnce) setPage(1);
    },
    [setSpec, setPage],
  );
  const onSortChange = useCallback((sorts: SortSpec[]) => changeSpec({ sorts }), [changeSpec]);
  const onFilterChange = useCallback((filters: FilterNode[]) => changeSpec({ filters }), [changeSpec]);
  const onSearchTextChange = useCallback((searchText: string) => changeSpec({ searchText }), [changeSpec]);
  const onDataChange = useCallback((next: readonly TData[], change: DataChange<TData>) => {
    setSettled((prev) => ({ ...prev, rows: next as TData[] }));
    live.current.options.onDataChange?.(next, change);
  }, []);
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
    }),
    [settled.rows, settled.totalRowCount, spec, getRowId, onDataChange, onSortChange, onFilterChange, onSearchTextChange],
  );
  const rootProps = useMemo<UseDataGridServerRowsRootProps>(() => ({ loading, error, onRetry: retry }), [loading, error, retry]);
  const gridProps = useMemo(() => ({ ...providerProps, ...rootProps }), [providerProps, rootProps]);

  return { gridProps, providerProps, rootProps, pager, status, loading, error, retry, refresh };
}
