"use client";

import { useCallback, useEffect, useRef } from "react";
import { useQueryState } from "nuqs";
import {
  useDataGridActions,
  useDataGridAllColumns,
  useDataGridFilterState,
  useDataGridSearchText,
  useDataGridSortState,
} from "@/registry/default/blocks/data-grid/data-grid";
import { MAX_SPEC_SEARCH_LENGTH, isDev, isFilterGroup, pruneFilterSpecs, resolveCustomFilterOperators, setFilterValuesOf, useDataGridSelector, useDataGridStoreApi } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import type { ColumnLayout, FilterOperatorInput } from "@/registry/default/blocks/data-grid/data-grid";
import { serializeSortState, parseSortState } from "./sort-param";
import { parseLayoutPart, serializeLayoutPart, type UrlLayoutPart } from "./layout-param";
import { serializeFilterState, parseFilterState } from "./filter-param";
import { parseLegacyJoin } from "./join-param";
import { prefixedKey, useWarnSharedPrefix } from "./prefixed-key";

/** Smallest `isAnyOf` / `isNoneOf` list bound for a column with choices, so a link written before a choice was removed still parses. */
const MIN_CHOICE_BOUND = 64;


type UrlSpecPart = "sort" | "filter" | "search";

type UrlParams = Record<"sort" | "filter" | "join" | "q" | UrlLayoutPart, string>;

// Filter values and search text can hold personal data; a URL leaks them into history, logs, and Referer, so they sync only on request.
const DEFAULT_SPEC_PARTS: readonly UrlSpecPart[] = ["sort"];

function choiceBoundsOf(columns: readonly { id: string; options?: unknown }[]): Map<string, number | undefined> {
  return new Map(
    columns.map((c) => {
      const choices = (c.options as { choices?: unknown } | undefined)?.choices;
      return [c.id, Array.isArray(choices) && choices.length > 0 ? Math.max(choices.length, MIN_CHOICE_BOUND) : undefined];
    }),
  );
}

const DEFAULT_LAYOUT_PARTS: readonly UrlLayoutPart[] = ["order", "hidden"];

const LAYOUT_KEYS: Record<UrlLayoutPart, string> = { order: "cols", hidden: "hide", widths: "widths", pins: "pins" };

function readUrlParams(prefix: string | undefined): UrlParams {
  const query = new URLSearchParams(window.location.search);
  const read = (key: string) => query.get(prefixedKey(prefix, key)) ?? "";
  return { sort: read("sort"), filter: read("filter"), join: read("join"), q: read("q"), order: read(LAYOUT_KEYS.order), hidden: read(LAYOUT_KEYS.hidden), widths: read(LAYOUT_KEYS.widths), pins: read(LAYOUT_KEYS.pins) };
}

function countUnknownLayoutIds(part: Partial<ColumnLayout>, known: ReadonlySet<string>): number {
  const ids = part.order ?? part.hidden ?? Object.keys(part.widths ?? part.pins ?? {});
  return ids.filter((id) => !known.has(id)).length;
}

/** Dev-only warning, core's `warnDev` pattern with this add-on's own prefix (import-boundary rule: add-ons import only from core's block-root barrel). */
function warnDev(message: string): void {
  if (isDev()) console.warn(`[data-grid-url-state] ${message}`);
}

/** Options for {@link useDataGridUrlState}. */
export type UseDataGridUrlStateOptions = {
  /** Namespaces the `sort`/`filter`/`join`/`q` URL keys and the layout keys (`cols`, `hide`, `widths`, `pins`) as `<prefix>_<key>`, so multiple grids can coexist on one page. */
  prefix?: string;
  /**
   * View-spec parts synced to the URL: `sort` (`sort`), `filter` (`filter` and the legacy `join`), and `search` (`q`).
   * `[]` turns spec sync off. Default `["sort"]`: filter values and search text reach the URL, browser history, server logs, and `Referer` only when you list `"filter"` and `"search"`.
   */
  spec?: readonly UrlSpecPart[];
  /**
   * Layout parts synced to the URL under `cols` (`order`), `hide` (`hidden`), `widths`, and `pins`.
   * A part is written only while it differs from the layout the grid started with. `[]` turns
   * layout sync off. Default `["order", "hidden"]`.
   */
  layout?: readonly UrlLayoutPart[];
  /**
   * Applies the URL to the grid when the user navigates back or forward (`popstate`), as `applyFromUrl()` does.
   * Set `false` to apply the URL yourself. Default `true`.
   */
  enableNavigationSync?: boolean;
};

/** Result of {@link useDataGridUrlState}. */
export type UseDataGridUrlStateResult = {
  /**
   * Re-applies the current URL params to the store, including the dropped-column warning. Unlike
   * the mount apply, a param missing from the URL clears its sort, filter, or search, and a
   * missing layout param resets that synced layout part to the layout the grid started with. Call
   * it when the URL changed outside the grid's own writes —
   * back/forward, a framework `setSearchParams`, or a query-only route change — since mount
   * applies exactly once and the store is the source of truth afterwards. Back and forward call it
   * already unless `enableNavigationSync` is `false`.
   */
  applyFromUrl: () => void;
};

/**
 * Syncs the grid store's `sortState`/`filterState`/`searchText` with the URL via
 * nuqs: applies any URL params to the store once on mount, then writes store changes back to the
 * URL (replacing, never pushing, history entries). Requires a `NuqsAdapter` (or the testing
 * adapter) above it in the tree — nuqs itself is router-agnostic. Writes are not delayed: the search
 * input debounces typing and nuqs coalesces the `history.replaceState` calls. A filter group lives inside the `filter` param. A legacy
 * `join=or` param is read once (it wraps a flat filter list in one `or` group) and every filter
 * write removes it.
 *
 * The URL→store direction runs on mount and on back/forward (`enableNavigationSync`); otherwise the store
 * wins. `applyFromUrl()` re-runs the apply when the URL changed outside the grid's own writes.
 */
export function useDataGridUrlState(options: UseDataGridUrlStateOptions = {}): UseDataGridUrlStateResult {
  const { prefix, layout = DEFAULT_LAYOUT_PARTS, spec: specParts = DEFAULT_SPEC_PARTS, enableNavigationSync = true } = options;
  const syncSort = specParts.includes("sort");
  const syncFilter = specParts.includes("filter");
  const syncSearch = specParts.includes("search");
  useWarnSharedPrefix("useDataGridUrlState", prefix);
  const layoutParts = layout.join(",");
  const actions = useDataGridActions();
  const storeApi = useDataGridStoreApi();
  const allColumns = useDataGridAllColumns();
  const warnedChoiceColumns = useRef(new Set<string>());
  const operatorInput = useCallback(
    (columnId: string, operator: string): FilterOperatorInput | undefined => {
      const column = allColumns.find((c) => c.id === columnId);
      if (!column) return undefined;
      const custom = resolveCustomFilterOperators(column, column.type ? storeApi.getState().cellTypes[column.type] : undefined).get(operator);
      return custom && (custom.input ?? "single");
    },
    [allColumns, storeApi],
  );
  const sortState = useDataGridSortState();
  const filterState = useDataGridFilterState();
  const searchText = useDataGridSearchText();
  const columnLayout = useDataGridSelector((s) => s.columnLayout);

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
  const layoutQueryOptions = { defaultValue: "", parse: (v: string) => v, serialize: (v: string) => v, history: "replace" } as const;
  const [orderParam, setOrderParam] = useQueryState(prefixedKey(prefix, LAYOUT_KEYS.order), layoutQueryOptions);
  const [hiddenParam, setHiddenParam] = useQueryState(prefixedKey(prefix, LAYOUT_KEYS.hidden), layoutQueryOptions);
  const [widthsParam, setWidthsParam] = useQueryState(prefixedKey(prefix, LAYOUT_KEYS.widths), layoutQueryOptions);
  const [pinsParam, setPinsParam] = useQueryState(prefixedKey(prefix, LAYOUT_KEYS.pins), layoutQueryOptions);
  const currentParams: UrlParams = { sort: sortParam, filter: filterParam, join: joinParam, q: searchParam, order: orderParam, hidden: hiddenParam, widths: widthsParam, pins: pinsParam };

  // The nuqs setters are NOT stable across external URL changes (back/forward, setSearchParams,
  // the testing adapter's searchParams prop) — the adapter re-renders and the query hook rebuilds
  // its updater. They must stay out of the write-back effects' dep lists, or an external URL change
  // re-triggers the write-back and stomps the new URL value before applyFromUrl can read it. The
  // refs keep a live handle to the latest setter so the effects only re-run when the STORE state
  // (the actual source of truth) changes.
  const setSortParamRef = useRef(setSortParam);
  setSortParamRef.current = setSortParam;
  const setFilterParamRef = useRef(setFilterParam);
  setFilterParamRef.current = setFilterParam;
  const setJoinParamRef = useRef(setJoinParam);
  setJoinParamRef.current = setJoinParam;
  const setSearchParamRef = useRef(setSearchParam);
  setSearchParamRef.current = setSearchParam;
  const layoutSettersRef = useRef({ order: setOrderParam, hidden: setHiddenParam, widths: setWidthsParam, pins: setPinsParam });
  layoutSettersRef.current = { order: setOrderParam, hidden: setHiddenParam, widths: setWidthsParam, pins: setPinsParam };

  // Reads the current URL params and applies them to the store. Runs once on mount (via the
  // appliedRef guard below) and is exposed as applyFromUrl so a consumer can re-apply after an
  // external URL change (back/forward, setSearchParams, query-only route change).
  const applyUrl = useCallback((keepMountDefaults: boolean, params: UrlParams) => {
    const initialLayout = storeApi.getInitialState().columnLayout;
    const knownIds = new Set(allColumns.map((c) => c.id));
    const layoutPatch: Partial<ColumnLayout> = {};
    let unknownLayoutIds = 0;
    for (const part of layoutParts ? (layoutParts.split(",") as UrlLayoutPart[]) : []) {
      const parsed = parseLayoutPart(part, params[part]);
      if (parsed[part] !== undefined) {
        unknownLayoutIds += countUnknownLayoutIds(parsed, knownIds);
        Object.assign(layoutPatch, parsed);
      } else if (!keepMountDefaults) {
        Object.assign(layoutPatch, { [part]: initialLayout[part] });
      }
    }
    if (unknownLayoutIds > 0) warnDev(`dropped ${unknownLayoutIds} URL layout entries for removed columns`);
    // Drop specs a shared link must not apply: a removed column, or one the integrator excluded from sorting/filtering or currently hides. Each drop dev-warns.
    const hidden = new Set(layoutPatch.hidden ?? storeApi.getState().hiddenColumns);
    const usable = (c: (typeof allColumns)[number]) => !hidden.has(c.id);
    const sortableIds = new Set(allColumns.filter((c) => usable(c) && c.sortable !== false).map((c) => c.id));
    const filterableIds = new Set(allColumns.filter((c) => usable(c) && c.filterable !== false).map((c) => c.id));
    const parsedSorts = parseSortState(params.sort);
    const sorts = parsedSorts.filter((spec) => {
      if (sortableIds.has(spec.columnId)) return true;
      warnDev(`dropped URL sort spec for removed, hidden, or unsortable column "${spec.columnId}"`);
      return false;
    });
    const choiceBounds = choiceBoundsOf(allColumns);
    const unknownChoices = new Map<string, number>();
    const parsedFilters = parseFilterState(params.filter, {
      maxChoices: (columnId) => choiceBounds.get(columnId),
      operatorInput,
      choiceValues: setFilterValuesOf(storeApi.getState()),
      onUnknownChoices: (columnId, count) => unknownChoices.set(columnId, (unknownChoices.get(columnId) ?? 0) + count),
    });
    for (const [columnId, count] of unknownChoices) {
      if (warnedChoiceColumns.current.has(columnId)) continue;
      warnedChoiceColumns.current.add(columnId);
      warnDev(`dropped ${count} URL filter values outside the column choices and data values of "${columnId}"`);
    }
    const legacyOr = parsedFilters.length > 0 && parseLegacyJoin(params.join) === "or" && !parsedFilters.some(isFilterGroup);
    const filters = pruneFilterSpecs(legacyOr ? [{ join: "or", filters: parsedFilters }] : parsedFilters, (spec) => {
      if (filterableIds.has(spec.columnId)) return true;
      warnDev(`dropped URL filter spec for removed, hidden, or unfilterable column "${spec.columnId}"`);
      return false;
    });
    // On mount an absent param keeps the grid's initial state; a re-apply mirrors the URL, so a removed param clears its state.
    if (syncSort && (sorts.length > 0 || !keepMountDefaults)) actions.setSorts(sorts);
    if (syncFilter && (filters.length > 0 || !keepMountDefaults)) actions.setFilters(filters);
    if (syncSearch && (params.q || !keepMountDefaults)) actions.setSearch(params.q.slice(0, MAX_SPEC_SEARCH_LENGTH));

    if (Object.keys(layoutPatch).length > 0) actions.setColumnLayout(layoutPatch);
  }, [actions, allColumns, operatorInput, storeApi, syncSort, syncFilter, syncSearch, layoutParts]);
  const applyUrlRef = useRef(applyUrl);
  applyUrlRef.current = applyUrl;
  const currentParamsRef = useRef(currentParams);
  currentParamsRef.current = currentParams;
  const applyFromUrl = useCallback(() => applyUrlRef.current(false, currentParamsRef.current), []);

  // apply URL -> store exactly once on mount; afterwards the store is the source of truth and
  // this effect's own writes below must not be re-read back as if they were external URL edits.
  const appliedRef = useRef(false);
  useEffect(() => {
    if (appliedRef.current) return;
    appliedRef.current = true;
    applyUrl(true, currentParams);
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!enableNavigationSync) return;
    const onPopState = () => applyUrlRef.current(false, readUrlParams(prefix));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [enableNavigationSync, prefix]);

  useEffect(() => {
    if (!appliedRef.current || !syncSort) return;
    void setSortParamRef.current(serializeSortState(sortState) || null);
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [sortState]);

  useEffect(() => {
    if (!appliedRef.current || !syncFilter) return;
    const choiceBounds = choiceBoundsOf(allColumns);
    void setFilterParamRef.current(serializeFilterState(filterState, { operatorInput, maxChoices: (columnId) => choiceBounds.get(columnId) }) || null);
    void setJoinParamRef.current(null);
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [filterState]);

  const lastWrittenLayoutRef = useRef<Partial<Record<UrlLayoutPart, string>> | null>(null);
  useEffect(() => {
    if (!appliedRef.current) return;
    const initialLayout = storeApi.getInitialState().columnLayout;
    const previous = lastWrittenLayoutRef.current;
    const next: Partial<Record<UrlLayoutPart, string>> = {};
    for (const part of layoutParts ? (layoutParts.split(",") as UrlLayoutPart[]) : []) {
      const value = serializeLayoutPart(part, columnLayout);
      next[part] = value === serializeLayoutPart(part, initialLayout) ? "" : value;
      if (previous && part in previous && previous[part] !== next[part]) void layoutSettersRef.current[part](next[part] || null);
    }
    lastWrittenLayoutRef.current = next;
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [columnLayout, layoutParts]);

  // The search text is already debounced by the input; the adapter coalesces the writes, so none is waited for here.
  useEffect(() => {
    if (!appliedRef.current || !syncSearch) return;
    void setSearchParamRef.current(searchText.slice(0, MAX_SPEC_SEARCH_LENGTH) || null);
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

  return { applyFromUrl };
}
