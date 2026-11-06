"use client";

import { useEffect, useRef } from "react";
import { clampPage, DEFAULT_PAGE_SIZES, pageCount } from "./pagination-math";
import type { DataGridPaginationControls, UseDataGridPaginationServerOptions } from "./use-data-grid-pagination";

export type UseDataGridServerPagerOptions = UseDataGridPaginationServerOptions;

const NO_PAGE_SIZE_OPTIONS: readonly number[] = [];
const noop = () => {};

/** The pager for rows your own data layer fetches page by page. Spread `pager` onto `DataGridPaginationBar`. Without `onPageSizeChange` the bar hides the page-size select. */
export function useDataGridServerPager(options: UseDataGridServerPagerOptions): { pager: DataGridPaginationControls } {
  const { page, pageSize, totalRowCount, onPageChange, pageSizeOptions = DEFAULT_PAGE_SIZES, onPageSizeChange } = options;
  const clampedPage = clampPage(page, totalRowCount, pageSize);
  const lastPage = totalRowCount === null ? null : pageCount(totalRowCount, pageSize);
  const hasMore = lastPage === null ? options.hasMore === true : clampedPage < lastPage;

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

  const pager: DataGridPaginationControls = {
    page: clampedPage,
    pageCount: lastPage ?? clampedPage + (hasMore ? 1 : 0),
    pageSize,
    pageSizeOptions: onPageSizeChange ? pageSizeOptions : NO_PAGE_SIZE_OPTIONS,
    totalRowCount,
    hasMore,
    onPageChange,
    onPageSizeChange: onPageSizeChange ?? noop,
  };
  return { pager };
}
