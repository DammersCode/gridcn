"use client";

import { useMemo, useState } from "react";
import { clampPage, DEFAULT_PAGE_SIZES, pageCount, pageRange } from "./pagination-math";

/** What `<DataGridPaginationBar {...pager} />` spreads.  */
export type DataGridPaginationControls = {
  page: number;
  /** Pages the user can reach. With an unknown `totalRowCount` it is `page`, plus 1 while `hasMore`. */
  pageCount: number;
  pageSize: number;
  pageSizeOptions: readonly number[];
  /** Row count across all pages; `null` when the server sends no count. */
  totalRowCount: number | null;
  /** True when a page after the current one exists. */
  hasMore: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
};

/** Options of {@link useDataGridPagination}. */
export type UseDataGridPaginationClientOptions<TData> = {
  data: readonly TData[];
  /** First page size while `pageSize` is not controlled. Default: the first of `pageSizeOptions`. */
  defaultPageSize?: number;
  /** Controls the page size; pair it with `onPageSizeChange`. */
  pageSize?: number;
  pageSizeOptions?: readonly number[];
  /** First page while `page` is not controlled. Default 1. */
  defaultPage?: number;
  /** Controls the current page; pair it with `onPageChange`. */
  page?: number;
  onPageChange?: (page: number) => void;
  /** Fires after a page-size change with the new size. */
  onPageSizeChange?: (pageSize: number) => void;
};

/**
 * Options of {@link useDataGridServerPager} (`UseDataGridServerPagerOptions`): you own `page` and `pageSize` and fetch each page's rows. The hook computes the page window
 * and the pager. `totalRowCount` is `null` when the server does not count rows; `hasMore` then says whether another page exists.
 * A `page` outside `[1, pageCount]` calls `onPageChange` once with the clamped page, never while `totalRowCount` is 0.
 * With a `null` count only a page below 1 is lifted. For a source that fetches, sorts, and filters for you, use `useDataGridServerRows`.
 */
export type UseDataGridPaginationServerOptions = {
  page: number;
  pageSize: number;
  totalRowCount: number | null;
  /** Read only when `totalRowCount` is `null`. Default `false`. */
  hasMore?: boolean;
  onPageChange: (page: number) => void;
  pageSizeOptions?: readonly number[];
  onPageSizeChange?: (pageSize: number) => void;
};

export type UseDataGridPaginationResult<TData> = {
  /** The current page's slice of `data`. */
  pageData: readonly TData[];
  pager: DataGridPaginationControls;
};

/**
 * Slices a dataset into pages and builds the pager, for a list that lives outside the grid. Page and page size are uncontrolled
 * unless you pass `page` or `pageSize` with their change callbacks.
 *
 * To page the rows of a grid, set `pageSize` on `DataGridProvider` instead and read the pager with `useDataGridPager`: the grid
 * then sorts, filters, and totals all of `data` and shows one page of the result.
 */
export function useDataGridPagination<TData>(options: UseDataGridPaginationClientOptions<TData>): UseDataGridPaginationResult<TData> {
  return useClientPagination<TData>(options);
}

function useClientPagination<TData>(options: UseDataGridPaginationClientOptions<TData>): UseDataGridPaginationResult<TData> {
  const { data, pageSizeOptions = DEFAULT_PAGE_SIZES, onPageChange: onPageChangeProp, onPageSizeChange: onPageSizeChangeProp } = options;
  const [internalPageSize, setInternalPageSize] = useState(options.defaultPageSize ?? pageSizeOptions[0] ?? DEFAULT_PAGE_SIZES[0]);
  const [internalPage, setInternalPage] = useState(options.defaultPage ?? 1);

  const pageSize = options.pageSize ?? internalPageSize;
  const controlledPage = options.page;
  const controlled = controlledPage !== undefined;
  const rawPage = controlled ? controlledPage : internalPage;
  const page = clampPage(rawPage, data.length, pageSize);

  const setPage = (next: number, sizeForClamp: number = pageSize) => {
    const clamped = clampPage(next, data.length, sizeForClamp);
    if (!controlled) setInternalPage(clamped);
    onPageChangeProp?.(clamped);
  };

  const pageData = useMemo(() => {
    const { start, end } = pageRange(page, pageSize, data.length);
    return data.slice(start, end);
  }, [data, page, pageSize]);

  const pager: DataGridPaginationControls = {
    page,
    pageCount: pageCount(data.length, pageSize),
    pageSize,
    pageSizeOptions,
    totalRowCount: data.length,
    hasMore: page < pageCount(data.length, pageSize),
    onPageChange: setPage,
    onPageSizeChange: (nextSize) => {
      setInternalPageSize(nextSize);
      onPageSizeChangeProp?.(nextSize);
      // keep the same first-visible row across a page-size change
      const firstRow = (page - 1) * pageSize;
      setPage(Math.floor(firstRow / nextSize) + 1, nextSize);
    },
  };

  return { pageData, pager };
}
