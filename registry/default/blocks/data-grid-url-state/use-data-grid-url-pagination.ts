"use client";

import { useCallback, useMemo } from "react";
import { useQueryState } from "nuqs";
import { parsePage, parsePageSize, serializePage, serializePageSize, DEFAULT_URL_PAGE_SIZE } from "./page-param";
import { prefixedKey } from "./prefixed-key";

/** Options for {@link useDataGridUrlPagination}. */
export type UseDataGridUrlPaginationOptions = {
  /** Namespaces the `page`/`pageSize` URL keys so multiple grids can coexist on one page. */
  prefix?: string;
  /** `pageSize` this many is omitted from the URL. Also the fallback for an invalid URL value. Default 25. */
  defaultPageSize?: number;
  /** When given, a `pageSize` URL value outside this list falls back to `defaultPageSize` instead of being trusted. */
  pageSizeOptions?: readonly number[];
};

/** Controlled pair spread straight into `useDataGridPagination`'s server mode. */
export type UseDataGridUrlPaginationResult = {
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
};

/**
 * Syncs `page`/`pageSize` with the URL via nuqs, no dependency on `data-grid-pagination` or the
 * grid's store — pagination has no store slot, so this hook just owns two URL-backed numbers and
 * hands back the controlled pair `useDataGridPagination` already accepts in server mode:
 *
 * @example
 * const url = useDataGridUrlPagination();
 * const pager = useDataGridPagination({ total: rows.length, ...url });
 *
 * `page` is 1-based and omitted from the URL at 1; `pageSize` is omitted when it equals
 * `defaultPageSize`. Both writes use `history: "replace"`, matching this add-on's sort/filter/
 * search params — paging through results never pollutes back/forward history. Invalid or
 * out-of-range URL values (negative, fractional, a `pageSize` outside `pageSizeOptions`) clamp to
 * the default rather than throwing, the same posture as this add-on's other parsers.
 */
export function useDataGridUrlPagination(options: UseDataGridUrlPaginationOptions = {}): UseDataGridUrlPaginationResult {
  const { prefix, defaultPageSize = DEFAULT_URL_PAGE_SIZE, pageSizeOptions } = options;

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

  const page = parsePage(pageParam);
  const pageSize = parsePageSize(pageSizeParam, defaultPageSize, pageSizeOptions);

  const onPageChange = useCallback(
    (next: number) => {
      void setPageParam(serializePage(next) || null);
    },
    [setPageParam],
  );

  const onPageSizeChange = useCallback(
    (next: number) => {
      void setPageSizeParam(serializePageSize(next, defaultPageSize) || null);
      // A page number is only valid for the size it was chosen at: a page-size change resets the page to 1 (the URL composition's contract).
      void setPageParam(null);
    },
    [setPageSizeParam, setPageParam, defaultPageSize],
  );

  return useMemo(
    () => ({ page, pageSize, onPageChange, onPageSizeChange }),
    [page, pageSize, onPageChange, onPageSizeChange],
  );
}
