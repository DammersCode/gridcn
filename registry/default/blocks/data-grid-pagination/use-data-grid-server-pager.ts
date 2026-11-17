"use client";

import { useEffect, useMemo, useRef } from "react";
import type { DataGridPlugin } from "@/registry/default/blocks/data-grid/data-grid";
import { usePagerStashPlugin } from "./pager-stash";
import { clampPage, DEFAULT_PAGE_SIZES, pageCount } from "./pagination-math";
import type { DataGridPaginationControls, UseDataGridPaginationServerOptions } from "./use-data-grid-pagination";

export type UseDataGridServerPagerOptions = UseDataGridPaginationServerOptions & {
  /** What a page counts. Default `"rows"`. */
  unit?: "rows" | "groups";
};

const NO_PAGE_SIZE_OPTIONS: readonly number[] = [];
const noop = () => {};

/** Result of {@link useDataGridServerPager}. */
export type UseDataGridServerPagerResult = {
  pager: DataGridPaginationControls;
  /**
   * Spread onto `DataGridProvider`: `totalRowCount` puts sort and filter in server mode, and `plugins` lets a `DataGridPaginationBar` without props
   * read this pager. A `plugins` prop after the spread replaces it; add your plugins to `gridProps.plugins` instead.
   */
  gridProps: { totalRowCount: number | null; plugins: readonly DataGridPlugin[] };
};

/** The pager for rows your own data layer fetches page by page. Spread `pager` onto `DataGridPaginationBar`, or `gridProps` onto `DataGridProvider` for a bar without props. Without `onPageSizeChange` the bar hides the page-size select. */
export function useDataGridServerPager(options: UseDataGridServerPagerOptions): UseDataGridServerPagerResult {
  const { page, pageSize, totalRowCount, onPageChange, pageSizeOptions = DEFAULT_PAGE_SIZES, onPageSizeChange, unit } = options;
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
    ...(unit === "groups" ? { unit } : {}),
    onPageChange,
    onPageSizeChange: onPageSizeChange ?? noop,
  };
  const stash = usePagerStashPlugin(pager);
  const gridProps = useMemo(() => ({ totalRowCount, plugins: [stash] }), [totalRowCount, stash]);
  return { pager, gridProps };
}
