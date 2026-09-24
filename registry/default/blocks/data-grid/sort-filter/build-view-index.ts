import type { FilterJoinOperator, FilterSpec, SortSpec } from "../types";
import { defaultCompareText } from "./default-compare-text";
import { createFilterMatcher } from "./matches-filter";

/**
 * Read-only accessor the view-index builder uses to reach cell data without
 * knowing the row type. `compare` supplies a custom row-index comparator for a
 * column (a column `sortCompare` or its cell type's `compare`; absent comparators
 * fall back to `defaultCompareText` on `getText`).
 *
 * A `compare` a caller returns MUST be deterministic and depend only on the two
 * rows' current values — {@link updateViewIndex} reuses the untouched rows'
 * order under it instead of re-deriving it.
 */
export type CellAccessor = {
  getText(rowIndex: number, columnId: string): string;
  compare?(columnId: string): ((a: number, b: number) => number) | undefined;
  /** Whether a row's cell in `columnId` is empty for sort placement; defaults to `getText() === ""`. */
  isEmpty?(rowIndex: number, columnId: string): boolean;
};

/** Whether `row`'s cell in `columnId` counts as empty for sort placement — empty sorts last in BOTH directions. */
export function isEmptyCell(accessor: CellAccessor, rowIndex: number, columnId: string): boolean {
  return accessor.isEmpty ? accessor.isEmpty(rowIndex, columnId) : accessor.getText(rowIndex, columnId) === "";
}

/**
 * Options for {@link buildViewIndex}. `searchColumnIds` is only consulted
 * when `search` is set; if omitted in that case, the search filter is
 * skipped (no rows are excluded) rather than matching against zero columns.
 */
export type ViewIndexOptions = {
  sorts: SortSpec[];
  filters: FilterSpec[];
  /** How `filters` combine; default `"and"` (every filter must match). */
  joinOperator?: FilterJoinOperator;
  search?: string;
  searchColumnIds?: string[];
};

/**
 * Computes the row-index view: filter, then search, then a stable
 * multi-column sort. `sorts[0]` is primary; each subsequent sort only
 * breaks ties left by the ones before it. No sorts leaves filtered/searched
 * rows in their original order.
 */
export function buildViewIndex(
  rowCount: number,
  accessor: CellAccessor,
  opts: ViewIndexOptions,
): number[] {
  let indices: number[] = [];
  for (let i = 0; i < rowCount; i++) indices.push(i);

  if (opts.filters.length > 0) {
    // One matcher per filter, built once outside the per-row loop: any numeric bound in
    // gt/gte/lt/lte/isBetween is the same string for every row, so parsing it here instead of on
    // every `matchesFilter` call turns an O(n) redundant re-parse into O(1) setup per filter.
    const matchers = opts.filters.map((filter) => ({ columnId: filter.columnId, test: createFilterMatcher(filter) }));

    if (opts.joinOperator === "or") {
      // OR: a row survives if ANY filter matches — one pass, no per-filter re-scan of `indices`.
      indices = indices.filter((row) => matchers.some((m) => m.test(accessor.getText(row, m.columnId))));
    } else {
      // AND (default): short-circuits per row via the existing filter-per-filter narrowing, same
      // hot path as before this feature — untouched perf for the common (and only, pre-OR) case.
      for (const m of matchers) {
        indices = indices.filter((row) => m.test(accessor.getText(row, m.columnId)));
      }
    }
  }

  const search = opts.search?.trim();
  if (search && opts.searchColumnIds) {
    const needle = search.toLowerCase();
    const columnIds = opts.searchColumnIds;
    indices = indices.filter((row) =>
      columnIds.some((columnId) => accessor.getText(row, columnId).toLowerCase().includes(needle)),
    );
  }

  if (opts.sorts.length === 0) return indices;

  // One collator amortized across every default-compare column and every pairwise
  // comparison in this call, instead of a fresh Intl.Collator per `localeCompare`.
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

  const comparators = opts.sorts.map((sort) => {
    const custom = accessor.compare?.(sort.columnId);
    const dir = sort.direction === "asc" ? 1 : -1;

    if (custom) {
      // Decorate emptiness once per row, same O(n) discipline as the text keys below.
      const empties = new Map<number, boolean>();
      for (const row of indices) empties.set(row, isEmptyCell(accessor, row, sort.columnId));
      // Same empty-last-in-both-directions rule as the default path, so a typed column's blanks
      // don't flip sides on a direction change while a text column's stay put.
      return (a: number, b: number) => {
        const emptyA = empties.get(a) ?? false;
        const emptyB = empties.get(b) ?? false;
        if (emptyA && emptyB) return 0;
        if (emptyA) return 1;
        if (emptyB) return -1;
        return dir * custom(a, b);
      };
    }

    // Decorate-sort-once: fetch each row's text key for this column exactly once (O(n))
    // instead of on every pairwise comparison (O(n log n) getText calls).
    const keys = new Map<number, string>();
    for (const row of indices) keys.set(row, accessor.getText(row, sort.columnId));

    // Empty must sort last for both directions, so only the non-empty ordering flips.
    return (a: number, b: number) => {
      const textA = keys.get(a) ?? "";
      const textB = keys.get(b) ?? "";
      if (textA === "" || textB === "") return defaultCompareText(textA, textB, collator);
      return dir * defaultCompareText(textA, textB, collator);
    };
  });

  // Decorate-sort-undecorate keeps the sort stable across the composed comparators.
  const decorated = indices.map((row, position) => ({ row, position }));
  decorated.sort((a, b) => {
    for (const cmp of comparators) {
      const result = cmp(a.row, b.row);
      if (result !== 0) return result;
    }
    return a.position - b.position;
  });

  return decorated.map((d) => d.row);
}
