"use client";

import { useEffect, useMemo } from "react";
import { useDataGridApi } from "@/registry/default/blocks/data-grid/data-grid";
import { fullViewOf, effectivePage, useDataGridSelector } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { DEFAULT_PAGE_SIZES, pageCount } from "./pagination-math";
import type { DataGridPaginationControls } from "./use-data-grid-pagination";

/** Options of {@link useDataGridPager}. */
export type UseDataGridPagerOptions = {
  /** Page sizes the footer offers. Default: the provider's `pageSizeOptions`, else 10, 25, 50, 100. */
  pageSizeOptions?: readonly number[];
};

/**
 * The pager of a grid that pages its view, as `{ pager }` like `useDataGridServerPager` (`pageSize` on `DataGridProvider`). Call it under the provider and spread the result onto
 * `DataGridPaginationBar`, or build your own controls from it. The total counts every row the sort and filter leave, not one page.
 * A grid without `pageSize` reads as one page that holds every row.
 */
export function useDataGridPager(options: UseDataGridPagerOptions = {}): { pager: DataGridPaginationControls } {
  const providerSizes = useDataGridSelector<unknown, readonly number[] | undefined>((s) => s.pageSizeOptions);
  const pageSizeOptions = options.pageSizeOptions ?? providerSizes ?? DEFAULT_PAGE_SIZES;
  const { actions } = useDataGridApi();
  const requestedPage = useDataGridSelector<unknown, number>((s) => s.page);
  const configuredSize = useDataGridSelector<unknown, number | null>((s) => s.pageSize);
  const total = useDataGridSelector<unknown, number>((s) => fullViewOf(s.viewIndex).length);
  const pageSize = configuredSize ?? Math.max(1, total);
  const page = effectivePage(requestedPage, total, pageSize);

  useEffect(() => {
    if (configuredSize !== null && total > 0 && page !== requestedPage) actions.setPage(page);
  }, [actions, configuredSize, page, requestedPage]);

  const pager = useMemo<DataGridPaginationControls>(() => {
    const lastPage = pageCount(total, pageSize);
    return {
      page,
      pageCount: lastPage,
      pageSize,
      pageSizeOptions,
      totalRowCount: total,
      hasMore: page < lastPage,
      onPageChange: (next) => actions.setPage(next),
      onPageSizeChange: (next) => actions.setPageSize(next),
    };
  }, [actions, page, pageSize, pageSizeOptions, total]);
  return { pager };
}
