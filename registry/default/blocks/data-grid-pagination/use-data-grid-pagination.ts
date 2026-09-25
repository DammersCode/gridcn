"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { isDev } from "@/registry/default/blocks/data-grid/data-grid";
import { clampPage, pageCount, pageRange } from "./pagination-math";

/** Default page-size choices offered by `<DataGridPaginationBar />`'s select, and the initial `pageSize` when none is given. */
/** Page sizes the footer select offers when `pageSizeOptions` is not given. */
export const DEFAULT_PAGE_SIZES = [10, 25, 50, 100] as const;

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
  /** Fires after a page-size change with the new size — `pageSize` itself is a one-time seed. */
  onPageSizeChange?: (pageSize: number) => void;
};

/** Server-mode options: consumer owns `page`/`pageSize`/`total` and fetches `pageData` itself — this hook is just the windowing math + controls shape. */
export type UseDataGridPaginationServerOptions = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  pageSizeOptions?: readonly number[];
  onPageSizeChange?: (pageSize: number) => void;
  /**
   * Fires your `onPageChange` with the clamped page exactly once when `page` falls outside
   * `[1, pageCount]` (e.g. `total` shrank). The hook never sets your page state. Default `false`.
   */
  reconcilePage?: boolean;
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
 * Pagination math + controls for `DataGrid`: purely additive,
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

/** Inert server options fed to `useServerPagination` while in client mode (hooks must run unconditionally). */
const INERT_SERVER_OPTIONS: UseDataGridPaginationServerOptions = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZES[0],
  total: 0,
  onPageChange: () => {},
};

// Fires at most once per app, dev-only: the page-size select changed but server mode has no onPageSizeChange to apply it.
let warnedServerPageSizeNoop = false;

function warnServerPageSizeNoop(): void {
  if (warnedServerPageSizeNoop || !isDev()) return;
  warnedServerPageSizeNoop = true;
  console.warn(
    "[data-grid-pagination] server mode: a page-size change was dropped because no onPageSizeChange was provided; pass one to apply the new size",
  );
}

export function useDataGridPagination<TData>(
  options: UseDataGridPaginationClientOptions<TData> | UseDataGridPaginationServerOptions,
): UseDataGridPaginationResult<TData> {
  const server = isServerOptions(options);
  // Client hooks must run unconditionally (rules-of-hooks) — server mode feeds them inert inputs.
  const clientResult = useClientPagination<TData>(server ? { data: EMPTY_CLIENT_DATA } : options);
  const serverControls = useServerPagination(server ? options : INERT_SERVER_OPTIONS);
  if (server) {
    return { pageData: undefined, controls: serverControls };
  }

  return clientResult;
}

function useServerPagination(options: UseDataGridPaginationServerOptions): DataGridPaginationControls {
  const { page, pageSize, total, onPageChange, pageSizeOptions = DEFAULT_PAGE_SIZES, onPageSizeChange, reconcilePage } = options;
  const clampedPage = clampPage(page, total, pageSize);

  // The ref keeps the reconcile fire to one per (page, clamped) pair — no re-fire when the consumer
  // ignores the callback or passes an unstable onPageChange.
  const firedRef = useRef<{ page: number; clamped: number } | null>(null);
  useEffect(() => {
    if (!reconcilePage) return;
    const clamped = clampPage(page, total, pageSize);
    if (clamped === page) {
      firedRef.current = null;
      return;
    }
    const fired = firedRef.current;
    if (fired && fired.page === page && fired.clamped === clamped) return;
    firedRef.current = { page, clamped };
    onPageChange(clamped);
  }, [reconcilePage, page, total, pageSize, onPageChange]);

  return {
    page: clampedPage,
    pageCount: pageCount(total, pageSize),
    pageSize,
    pageSizeOptions,
    total,
    onPageChange,
    onPageSizeChange: onPageSizeChange ?? (() => warnServerPageSizeNoop()),
  };
}

function useClientPagination<TData>(options: UseDataGridPaginationClientOptions<TData>): UseDataGridPaginationResult<TData> {
  const { data, pageSizeOptions = DEFAULT_PAGE_SIZES, onPageChange: onPageChangeProp, onPageSizeChange: onPageSizeChangeProp } = options;
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
      onPageSizeChangeProp?.(nextSize);
      // keep the same first-visible row across a page-size change, per spec's "clamping on page-size change" test.
      const firstRow = (page - 1) * pageSize;
      setPage(Math.floor(firstRow / nextSize) + 1, nextSize);
    },
  };

  return { pageData, controls };
}
