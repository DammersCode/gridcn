"use client";

import { useCallback, useMemo } from "react";
import { useQueryState } from "nuqs";
import { DEFAULT_PAGE_SIZES } from "@/registry/default/blocks/data-grid-pagination/pagination-math";
import { parsePage, parsePageSize, serializePage, serializePageSize } from "./page-param";
import { prefixedKey } from "./prefixed-key";

/** Options for {@link useDataGridUrlPagination}. */
export type UseDataGridUrlPaginationOptions = {
  /** Namespaces the `page`/`pageSize` URL keys as `<prefix>_<key>`, so multiple grids can coexist on one page. */
  prefix?: string;
  /** `pageSize` this many is omitted from the URL. Also the fallback for an invalid URL value. Default: the first of `pageSizeOptions` (10 with the default list). */
  defaultPageSize?: number;
  /** A `pageSize` URL value outside this list (default: the pager sizes 10, 25, 50, 100) falls back to `defaultPageSize`. */
  pageSizeOptions?: readonly number[];
};

/** The controlled pair: spread it onto `DataGridProvider` (a grid that pages its view) or into `useDataGridServerPager`. */
export type UseDataGridUrlPaginationResult = {
  page: number;
  pageSize: number;
  /** The `pageSizeOptions` the URL parsing enforces (`pageSizeOptions` or the pager default) — include it so the bar's select and the URL allow-list never diverge. */
  pageSizeOptions: readonly number[];
  onPageChange: (page: number) => void;
  /** `null` (a grid that turns paging off) returns the URL to `defaultPageSize`; the URL has no "every row" size. */
  onPageSizeChange: (pageSize: number | null) => void;
};

/**
 * Syncs `page`/`pageSize` with the URL via nuqs, with no dependency on the grid's store (it
 * reads only the page math of `data-grid-pagination`) — it owns two URL-backed numbers and hands back the controlled pair that
 * `DataGridProvider` and `useDataGridServerPager` both accept.
 *
 * The hook bounds the URL values but not the page range: the pager that knows the row count clamps an
 * out-of-range `page` and reports it through `onPageChange`.
 *
 * `page` is 1-based and omitted from the URL at 1; `pageSize` is omitted when it equals
 * `defaultPageSize`. Both writes use `history: "replace"`, matching this add-on's sort/filter/
 * search params — paging through results never pollutes back/forward history. Invalid or
 * out-of-range URL values (negative, fractional, a `pageSize` outside `pageSizeOptions`) clamp to
 * the default rather than throwing, the same posture as this add-on's other parsers.
 *
 * @example
 * const url = useDataGridUrlPagination();
 * <DataGridProvider data={rows} {...url}><DataGridPaginationBar pageSizeOptions={url.pageSizeOptions} /></DataGridProvider>
 */
export function useDataGridUrlPagination(options: UseDataGridUrlPaginationOptions = {}): UseDataGridUrlPaginationResult {
  const { prefix, pageSizeOptions } = options;
  const resolvedPageSizeOptions: readonly number[] = pageSizeOptions ?? DEFAULT_PAGE_SIZES;
  const defaultPageSize = options.defaultPageSize ?? resolvedPageSizeOptions[0]!;

  const [pageParam, setPageParam] = useQueryState(prefixedKey(prefix, "page"), {
    defaultValue: "",
    parse: (v) => v,
    serialize: (v) => v,
    history: "replace",
  });
  const [pageSizeParam, setPageSizeParam] = useQueryState(prefixedKey(prefix, "pageSize"), {
    defaultValue: "",
    parse: (v) => v,
    serialize: (v) => v,
    history: "replace",
  });

  // the URL value is always gated by a size list, so ?pageSize=100000000 can never force an unbounded fetch
  const page = parsePage(pageParam);
  const pageSize = parsePageSize(pageSizeParam, defaultPageSize, resolvedPageSizeOptions);
  const onPageChange = useCallback(
    (next: number) => {
      void setPageParam(serializePage(next) || null);
    },
    [setPageParam],
  );

  const onPageSizeChange = useCallback(
    (next: number | null) => {
      void setPageSizeParam(next === null ? null : serializePageSize(next, defaultPageSize) || null);
      // A page number is only valid for the size it was chosen at: a page-size change resets the page to 1 (the URL composition's contract).
      void setPageParam(null);
    },
    [setPageSizeParam, setPageParam, defaultPageSize],
  );

  return useMemo(
    () => ({ page, pageSize, pageSizeOptions: resolvedPageSizeOptions, onPageChange, onPageSizeChange }),
    [page, pageSize, resolvedPageSizeOptions, onPageChange, onPageSizeChange],
  );
}
