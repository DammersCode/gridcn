"use client";

import { useMemo, useState } from "react";
import { clampPage, pageCount, pageRange } from "./pagination-math";

/** Default page-size choices offered by `<DataGridPaginationBar />`'s select, and the initial `pageSize` when none is given. */
const DEFAULT_PAGE_SIZES = [10, 25, 50, 100] as const;

/** Controls shared by client and server mode — what `<DataGridPaginationBar {...pager.controls} />` spreads. */
export type DataGridPaginationControls = {
  page: number;
  pageCount: number;
  pageSize: number;
  pageSizeOptions: readonly number[];
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
};

/** Client-mode options: `useDataGridPagination` slices `data` itself. */
export type UseDataGridPaginationClientOptions<TData> = {
  data: readonly TData[];
  pageSize?: number;
  pageSizeOptions?: readonly number[];
  /** Uncontrolled by default (internal `useState`); pass both to control the current page yourself. */
  page?: number;
  onPageChange?: (page: number) => void;
};

/** Server-mode options: consumer owns `page`/`pageSize`/`total` and fetches `pageData` itself — this hook is just the windowing math + controls shape. */
export type UseDataGridPaginationServerOptions = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  pageSizeOptions?: readonly number[];
  onPageSizeChange?: (pageSize: number) => void;
};

export type UseDataGridPaginationResult<TData> = {
  /** The current page's slice — client mode only; server mode returns `undefined` (you already have your own fetched page). */
  pageData: readonly TData[] | undefined;
  controls: DataGridPaginationControls;
};

function isServerOptions<TData>(
  options: UseDataGridPaginationClientOptions<TData> | UseDataGridPaginationServerOptions,
): options is UseDataGridPaginationServerOptions {
  return "total" in options;
}

/**
 * Pagination math + controls for `DataGrid` (pagination design doc, add-on 2): purely additive,
 * zero core changes — pagination slices/labels a dataset the grid already renders in full via
 * virtualization, it doesn't change how the grid renders.
 *
 * Client mode (`{ data, pageSize }`): slices `data` into `pageData` internally, page state is
 * uncontrolled unless you pass `page`/`onPageChange` yourself.
 *
 * Server mode (`{ page, pageSize, total, onPageChange }`): fully controlled — you own the page
 * index and fetch each page's rows yourself; this hook only computes `pageCount`/windowing and
 * hands back the same `controls` shape so `<DataGridPaginationBar />` doesn't need to know which mode
 * it's rendering for.
 */
const EMPTY_CLIENT_DATA: readonly never[] = [];

export function useDataGridPagination<TData>(
  options: UseDataGridPaginationClientOptions<TData> | UseDataGridPaginationServerOptions,
): UseDataGridPaginationResult<TData> {
  const server = isServerOptions(options);
  // Client hooks must run unconditionally (rules-of-hooks) — server mode feeds them inert inputs.
  const clientResult = useClientPagination<TData>(server ? { data: EMPTY_CLIENT_DATA } : options);
  if (server) {
    const { page, pageSize, total, onPageChange, pageSizeOptions = DEFAULT_PAGE_SIZES, onPageSizeChange } = options;
    const clampedPage = clampPage(page, total, pageSize);
    const controls: DataGridPaginationControls = {
      page: clampedPage,
      pageCount: pageCount(total, pageSize),
      pageSize,
      pageSizeOptions,
      total,
      onPageChange,
      onPageSizeChange: onPageSizeChange ?? (() => {}),
    };
    return { pageData: undefined, controls };
  }

  return clientResult;
}

function useClientPagination<TData>(options: UseDataGridPaginationClientOptions<TData>): UseDataGridPaginationResult<TData> {
  const { data, pageSizeOptions = DEFAULT_PAGE_SIZES, onPageChange: onPageChangeProp } = options;
  const [pageSize, setPageSize] = useState(options.pageSize ?? pageSizeOptions[0] ?? DEFAULT_PAGE_SIZES[0]);
  const [internalPage, setInternalPage] = useState(1);

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

  const controls: DataGridPaginationControls = {
    page,
    pageCount: pageCount(data.length, pageSize),
    pageSize,
    pageSizeOptions,
    total: data.length,
    onPageChange: setPage,
    onPageSizeChange: (nextSize) => {
      setPageSize(nextSize);
      // keep the same first-visible row across a page-size change, per spec's "clamping on page-size change" test.
      const firstRow = (page - 1) * pageSize;
      setPage(Math.floor(firstRow / nextSize) + 1, nextSize);
    },
  };

  return { pageData, controls };
}
