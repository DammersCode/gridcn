"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQueryState } from "nuqs";
import { clampPage, DEFAULT_PAGE_SIZES } from "@/registry/default/blocks/data-grid-pagination/data-grid-pagination";
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
  /** The dataset's row count; when given, an out-of-range deep-linked `page` is clamped to the last page and the clamped value is written back to the URL on mount. */
  total?: number;
};

/** Controlled pair spread straight into `useDataGridPagination`'s server mode. */
export type UseDataGridUrlPaginationResult = {
  page: number;
  pageSize: number;
  /** The `pageSizeOptions` the URL parsing enforces (`pageSizeOptions` or the pager default) — include it so the bar's select and the URL allow-list never diverge. */
  pageSizeOptions: readonly number[];
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
 * const pager = useDataGridPagination({ total: rows.length, pageSizeOptions: url.pageSizeOptions, ...url });
 *
 * Pass `total` so an out-of-range deep-linked `page` clamps to the last page on mount and the
 * clamped value replaces the raw one in the URL.
 *
 * `page` is 1-based and omitted from the URL at 1; `pageSize` is omitted when it equals
 * `defaultPageSize`. Both writes use `history: "replace"`, matching this add-on's sort/filter/
 * search params — paging through results never pollutes back/forward history. Invalid or
 * out-of-range URL values (negative, fractional, a `pageSize` outside `pageSizeOptions`) clamp to
 * the default rather than throwing, the same posture as this add-on's other parsers.
 */
export function useDataGridUrlPagination(options: UseDataGridUrlPaginationOptions = {}): UseDataGridUrlPaginationResult {
  const { prefix, defaultPageSize = DEFAULT_URL_PAGE_SIZE, pageSizeOptions, total } = options;

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

  const rawPage = parsePage(pageParam);
  const pageSize = parsePageSize(pageSizeParam, defaultPageSize, pageSizeOptions);
  const page = total !== undefined ? clampPage(rawPage, total, pageSize) : rawPage;
  const resolvedPageSizeOptions: readonly number[] = pageSizeOptions ?? DEFAULT_PAGE_SIZES;

  // normalize on mount only: a deep-linked ?page=999 stays raw in the URL (shared link disagrees
  // with the rendered view, and "revives" if the dataset grows) unless the clamped value is written back
  const normalizedRef = useRef(false);
  useEffect(() => {
    if (normalizedRef.current) return;
    normalizedRef.current = true;
    if (total === undefined) return;
    const clamped = clampPage(parsePage(pageParam), total, parsePageSize(pageSizeParam, defaultPageSize, pageSizeOptions));
    const serialized = serializePage(clamped) || "";
    if (pageParam !== serialized) void setPageParam(serialized || null);
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    () => ({ page, pageSize, pageSizeOptions: resolvedPageSizeOptions, onPageChange, onPageSizeChange }),
    [page, pageSize, resolvedPageSizeOptions, onPageChange, onPageSizeChange],
  );
}
