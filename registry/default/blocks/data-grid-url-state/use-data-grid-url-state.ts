"use client";

import { useEffect, useRef } from "react";
import { useQueryState } from "nuqs";
import {
  isDev,
  useDataGridActions,
  useDataGridAllColumns,
  useDataGridFilterState,
  useDataGridJoinOperator,
  useDataGridSearchText,
  useDataGridSortState,
} from "@/registry/default/blocks/data-grid/data-grid";
import { serializeSortState, parseSortState } from "./sort-param";
import { serializeFilterState, parseFilterState } from "./filter-param";
import { serializeJoinOperator, parseJoinOperator } from "./join-param";
import { prefixedKey } from "./prefixed-key";

/** Debounce (ms) between typing in the quick-search box and writing `searchText` to the URL. */
const SEARCH_WRITE_DEBOUNCE_MS = 300;

/** Dev-only warning, core's `warnDev` pattern with this add-on's own prefix (import-boundary rule: add-ons import only from core's block-root barrel). */
function warnDev(message: string): void {
  if (isDev()) console.warn(`[data-grid-url-state] ${message}`);
}

/** Options for {@link useDataGridUrlState}. */
export type UseDataGridUrlStateOptions = {
  /** Namespaces the `sort`/`filter`/`join`/`q` URL keys so multiple grids can coexist on one page. */
  prefix?: string;
};

/**
 * Syncs the grid store's `sortState`/`filterState`/`joinOperator`/`searchText` with the URL via
 * nuqs: applies any URL params to the store once on mount, then writes store changes back to the
 * URL (replacing, never pushing, history entries). Requires a `NuqsAdapter` (or the testing
 * adapter) above it in the tree — nuqs itself is router-agnostic. Search writes are debounced so
 * typing doesn't spam `history.replaceState`; sort/filter/join writes (menu-driven, not
 * keystroke-driven) are immediate. `joinOperator` gets its own `join` param rather than folding
 * into `filter` so a URL generated before this feature existed keeps parsing identically.
 */
export function useDataGridUrlState(options: UseDataGridUrlStateOptions = {}): void {
  const { prefix } = options;
  const actions = useDataGridActions();
  const allColumns = useDataGridAllColumns();
  const sortState = useDataGridSortState();
  const filterState = useDataGridFilterState();
  const joinOperator = useDataGridJoinOperator();
  const searchText = useDataGridSearchText();

  const [sortParam, setSortParam] = useQueryState(prefixedKey(prefix, "sort"), {
    defaultValue: "",
    parse: (v) => v,
    serialize: (v) => v,
    history: "replace",
  });
  const [filterParam, setFilterParam] = useQueryState(prefixedKey(prefix, "filter"), {
    defaultValue: "",
    parse: (v) => v,
    serialize: (v) => v,
    history: "replace",
  });
  const [joinParam, setJoinParam] = useQueryState(prefixedKey(prefix, "join"), {
    defaultValue: "",
    parse: (v) => v,
    serialize: (v) => v,
    history: "replace",
  });
  const [searchParam, setSearchParam] = useQueryState(prefixedKey(prefix, "q"), {
    defaultValue: "",
    parse: (v) => v,
    serialize: (v) => v,
    history: "replace",
  });

  // apply URL -> store exactly once on mount; afterwards the store is the source of truth and
  // this effect's own writes below must not be re-read back as if they were external URL edits.
  const appliedRef = useRef(false);
  useEffect(() => {
    if (appliedRef.current) return;
    appliedRef.current = true;
    // Drop specs referencing a column no longer in the grid (a shared link outlived a removal) and dev-warn each one.
    const liveColumnIds = new Set(allColumns.map((c) => c.id));
    const parsedSorts = parseSortState(sortParam);
    const sorts = parsedSorts.filter((spec) => {
      if (liveColumnIds.has(spec.columnId)) return true;
      warnDev(`dropped URL sort spec for removed column "${spec.columnId}"`);
      return false;
    });
    const parsedFilters = parseFilterState(filterParam);
    const filters = parsedFilters.filter((spec) => {
      if (liveColumnIds.has(spec.columnId)) return true;
      warnDev(`dropped URL filter spec for removed column "${spec.columnId}"`);
      return false;
    });
    const join = parseJoinOperator(joinParam);
    if (sorts.length > 0) actions.setSorts(sorts);
    if (filters.length > 0) actions.setFilters(filters);
    if (join !== "and") actions.setJoinOperator(join);
    if (searchParam) actions.setSearch(searchParam);
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!appliedRef.current) return;
    void setSortParam(serializeSortState(sortState) || null);
  }, [sortState, setSortParam]);

  useEffect(() => {
    if (!appliedRef.current) return;
    void setFilterParam(serializeFilterState(filterState) || null);
  }, [filterState, setFilterParam]);

  useEffect(() => {
    if (!appliedRef.current) return;
    void setJoinParam(serializeJoinOperator(joinOperator) || null);
  }, [joinOperator, setJoinParam]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!appliedRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void setSearchParam(searchText || null);
    }, SEARCH_WRITE_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);
}
