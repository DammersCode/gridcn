"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { isDev } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { clampPage, DEFAULT_PAGE_SIZES, pageCount, pageRange } from "./pagination-math";

/** What `<DataGridPaginationBar {...pager} />` spreads. Client and server mode produce the same shape. */
export type DataGridPaginationControls = {
  page: number;
  /** Pages the user can reach. With an unknown `totalRowCount` it is `page`, plus 1 while `hasNextPage`. */
  pageCount: number;
  pageSize: number;
  pageSizeOptions: readonly number[];
  /** Row count across all pages; `null` when the server sends no count. */
  totalRowCount: number | null;
  /** True when a page after the current one exists. */
  hasNextPage: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
};

/** Client-mode options: `useDataGridPagination` slices `data` itself. */
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
 * Server-mode options: you own `page` and `pageSize` and fetch each page's rows. The hook computes the page window and the pager.
 * `totalRowCount` is `null` when the server does not count rows; `hasNextPage` then says whether another page exists.
 * A `page` outside `[1, pageCount]` calls `onPageChange` once with the clamped page, never while `totalRowCount` is 0.
 * With a `null` count only a page below 1 is lifted.
 */
export type UseDataGridPaginationServerOptions = {
  page: number;
  pageSize: number;
  totalRowCount: number | null;
  /** Read only when `totalRowCount` is `null`. Default `false`. */
  hasNextPage?: boolean;
  onPageChange: (page: number) => void;
  pageSizeOptions?: readonly number[];
  onPageSizeChange?: (pageSize: number) => void;
};

export type UseDataGridPaginationResult<TData> = {
  /** The current page's slice in client mode; `undefined` in server mode (you hold the fetched page). */
  pageData: readonly TData[] | undefined;
  pager: DataGridPaginationControls;
};

function isServerOptions<TData>(
  options: UseDataGridPaginationClientOptions<TData> | UseDataGridPaginationServerOptions,
): options is UseDataGridPaginationServerOptions {
  return !("data" in options);
}

const EMPTY_CLIENT_DATA: readonly never[] = [];

/** Inert server options fed to `useServerPagination` while in client mode (hooks must run unconditionally). */
const INERT_SERVER_OPTIONS: UseDataGridPaginationServerOptions = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZES[0],
  totalRowCount: 0,
  onPageChange: () => {},
};

/**
 * Pagination math and the pager for `DataGrid`. It slices or labels a dataset; the grid renders as usual.
 *
 * Client mode (`{ data, defaultPageSize }`) slices `data` into `pageData`. Page and page size are
 * uncontrolled unless you pass `page` or `pageSize` with their change callbacks.
 *
 * Server mode (`{ page, pageSize, totalRowCount, onPageChange }`) is fully controlled: you fetch each page.
 */
export function useDataGridPagination<TData>(
  options: UseDataGridPaginationClientOptions<TData> | UseDataGridPaginationServerOptions,
): UseDataGridPaginationResult<TData> {
  const server = isServerOptions(options);
  // Client hooks must run unconditionally (rules-of-hooks) — server mode feeds them inert inputs.
  const clientResult = useClientPagination<TData>(server ? { data: EMPTY_CLIENT_DATA } : options);
  const serverPager = useServerPagination(server ? options : INERT_SERVER_OPTIONS);
  if (server) {
    return { pageData: undefined, pager: serverPager };
  }

  return clientResult;
}

function useServerPagination(options: UseDataGridPaginationServerOptions): DataGridPaginationControls {
  const { page, pageSize, totalRowCount, onPageChange, pageSizeOptions = DEFAULT_PAGE_SIZES, onPageSizeChange } = options;
  const clampedPage = clampPage(page, totalRowCount, pageSize);
  const lastPage = totalRowCount === null ? null : pageCount(totalRowCount, pageSize);
  const hasNextPage = lastPage === null ? options.hasNextPage === true : clampedPage < lastPage;

  // The ref keeps the reconcile fire to one per (page, clamped) pair — no re-fire when the consumer
  // ignores the callback or passes an unstable onPageChange.
  const firedRef = useRef<{ page: number; clamped: number } | null>(null);
  useEffect(() => {
    if (totalRowCount !== null && totalRowCount <= 0) return;
    const clamped = clampPage(page, totalRowCount, pageSize);
    if (clamped === page) {
      firedRef.current = null;
      return;
    }
    const fired = firedRef.current;
    if (fired && fired.page === page && fired.clamped === clamped) return;
    firedRef.current = { page, clamped };
    onPageChange(clamped);
  }, [page, totalRowCount, pageSize, onPageChange]);

  const warnedDroppedPageSizeRef = useRef(false);
  const dropPageSizeChange = () => {
    if (warnedDroppedPageSizeRef.current || !isDev()) return;
    warnedDroppedPageSizeRef.current = true;
    console.warn(
      "[data-grid-pagination] server mode: a page-size change was dropped because no onPageSizeChange was provided; pass one to apply the new size",
    );
  };

  return {
    page: clampedPage,
    pageCount: lastPage ?? clampedPage + (hasNextPage ? 1 : 0),
    pageSize,
    pageSizeOptions,
    totalRowCount,
    hasNextPage,
    onPageChange,
    onPageSizeChange: onPageSizeChange ?? dropPageSizeChange,
  };
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
    hasNextPage: page < pageCount(data.length, pageSize),
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
