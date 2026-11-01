"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { serverSpecKey, type FilterNode, type ServerSpec, type SortSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { isDev } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { DEFAULT_PAGE_SIZES, useDataGridPagination, type DataGridPaginationControls } from "@/registry/default/blocks/data-grid-pagination/data-grid-pagination";

/** What `fetchRows` of {@link useDataGridServerRows} receives. */
export type ServerRowsFetchContext = {
  /** The sort, filter, and search of this request. */
  spec: ServerSpec;
  /** 1-based page. */
  page: number;
  pageSize: number;
  /** Aborted when a newer request replaces this one, and on unmount. */
  signal: AbortSignal;
};

/** What `fetchRows` of {@link useDataGridServerRows} resolves with. */
export type ServerRowsPage<TData> = {
  /** At most `pageSize` rows; the hook drops the rest with a development warning. */
  rows: TData[];
  /** The number of rows that match the spec, across all pages. */
  total?: number;
  /** Whether a page after this one exists. Used when the server sends no `total`; defaults to a full page. */
  hasNextPage?: boolean;
};

/** Options for {@link useDataGridServerRows}. */
export type UseDataGridServerRowsOptions<TData> = {
  getRowId: (row: TData, index: number) => string;
  fetchRows: (ctx: ServerRowsFetchContext) => Promise<ServerRowsPage<TData>>;
  /** Rows per page at mount. Default: the first of `pageSizeOptions`. */
  defaultPageSize?: number;
  /** Page sizes the footer offers. Default 10, 25, 50, 100. */
  pageSizeOptions?: readonly number[];
  /** The sort, filter, and search at mount. */
  defaultSpec?: Partial<ServerSpec>;
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
  /** The error of the current request, or `null`. It clears when a new request starts. */
  error: unknown;
  status: "loading" | "error" | "ready";
  /** Repeats the request that failed. Does nothing without an error. */
  retry: () => void;
  /** Fetches the current page again. */
  refresh: () => void;
};

/** Props of {@link UseDataGridServerRowsResult.gridProps} that belong to `DataGridProvider`. */
export type UseDataGridServerRowsProviderProps<TData> = {
    data: readonly TData[];
    getRowId: (row: TData, index: number) => string;
    /** Keeps the rows in step with edits, inserts, deletes, and reverts of a refused save. Send changes to your API from `onSave`. */
    onDataChange: (next: readonly TData[]) => void;
    sortMode: "server";
    filterMode: "server";
    headerClickBehavior: "sort";
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

type Settled<TData> = { key: string; rows: TData[]; totalRowCount: number | null; hasNextPage: boolean; error: unknown };

const EMPTY_SPEC: ServerSpec = { sorts: [], filters: [], searchText: "" };

/**
 * One server data source for the grid: it owns the sort, filter, search, page, and page size, fetches one page per
 * state, aborts the request a newer state replaces, goes back to page 1 when the spec or the page size changes, and
 * keeps the last good rows on screen while the next page loads or after an error. The state is the grid's controlled
 * state, so it works outside the provider and needs no bridge component.
 */
export function useDataGridServerRows<TData>(options: UseDataGridServerRowsOptions<TData>): UseDataGridServerRowsResult<TData> {
  const { getRowId, fetchRows, pageSizeOptions = DEFAULT_PAGE_SIZES } = options;
  const [sorts, setSorts] = useState<SortSpec[]>(() => [...(options.defaultSpec?.sorts ?? EMPTY_SPEC.sorts)]);
  const [filters, setFilters] = useState<FilterNode[]>(() => [...(options.defaultSpec?.filters ?? EMPTY_SPEC.filters)]);
  const [search, setSearch] = useState(options.defaultSpec?.searchText ?? EMPTY_SPEC.searchText);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(options.defaultPageSize ?? pageSizeOptions[0] ?? DEFAULT_PAGE_SIZES[0]);
  const [tick, setTick] = useState(0);
  const [settled, setSettled] = useState<Settled<TData>>({ key: "", rows: [], totalRowCount: null, hasNextPage: false, error: null });

  const spec = useMemo<ServerSpec>(() => ({ sorts, filters, searchText: search }), [sorts, filters, search]);
  const key = `${serverSpecKey(spec)}|${page}|${pageSize}|${tick}`;

  const fetchRef = useRef(fetchRows);
  useEffect(() => {
    fetchRef.current = fetchRows;
  });
  const warnedLongAnswer = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    Promise.resolve()
      .then(() => fetchRef.current({ spec, page, pageSize, signal: controller.signal }))
      .then((answer) => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(answer?.rows)) throw new TypeError("fetchRows of useDataGridServerRows must resolve with { rows: TData[] }");
        if (answer.rows.length > pageSize && !warnedLongAnswer.current && isDev()) {
          warnedLongAnswer.current = true;
          console.warn(`[data-grid-server] fetchRows returned ${answer.rows.length} rows for a page size of ${pageSize}; only the first ${pageSize} are shown`);
        }
        const rows = answer.rows.length > pageSize ? answer.rows.slice(0, pageSize) : answer.rows;
        const totalRowCount = typeof answer.total === "number" && Number.isFinite(answer.total) && answer.total >= 0 ? answer.total : null;
        setSettled({ key, rows, totalRowCount, hasNextPage: answer.hasNextPage ?? rows.length === pageSize, error: null });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setSettled((prev) => ({ ...prev, key, error: error ?? new Error("fetchRows rejected") }));
      });
    return () => controller.abort();
    // `key` stands for spec, page, pageSize, and tick.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const loading = settled.key !== key;
  const error = settled.key === key ? settled.error : null;
  const status = loading ? "loading" : error !== null ? "error" : "ready";

  const retry = () => {
    if (error !== null) setTick((n) => n + 1);
  };
  const refresh = () => setTick((n) => n + 1);

  const common = { page, pageSize, pageSizeOptions, onPageChange: setPage, reconcilePage: true };
  const onPageSizeChange = (next: number) => {
    setPageSize(next);
    setPage(1);
  };
  const pagerResult = useDataGridPagination(
    settled.totalRowCount === null
      ? { ...common, hasNextPage: settled.hasNextPage, onPageSizeChange }
      : { ...common, total: settled.totalRowCount, onPageSizeChange },
  );

  const providerProps: UseDataGridServerRowsProviderProps<TData> = {
      data: settled.rows,
      getRowId,
      onDataChange: (next) => setSettled((prev) => ({ ...prev, rows: next as TData[] })),
      sortMode: "server",
      filterMode: "server",
      headerClickBehavior: "sort",
      sortState: sorts,
      onSortChange: (next) => {
        setSorts(next);
        setPage(1);
      },
      filterState: filters,
      onFilterChange: (next) => {
        setFilters(next);
        setPage(1);
      },
      searchText: search,
      onSearchTextChange: (next) => {
        setSearch(next);
        setPage(1);
      },
      totalRowCount: settled.totalRowCount,
      keepCheckedRows: true,
  };
  const rootProps: UseDataGridServerRowsRootProps = { loading, error, onRetry: retry };

  return {
    gridProps: { ...providerProps, ...rootProps },
    providerProps,
    rootProps,
    pager: pagerResult.controls,
    error,
    status,
    retry,
    refresh,
  };
}
