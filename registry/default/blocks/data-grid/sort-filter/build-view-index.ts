import type { FilterNode, FilterSpec, SortSpec } from "../types";
import { groupChildren, isFilterGroup } from "./filter-tree";
import { createFilterMatcher } from "./matches-filter";

/**
 * Read-only accessor the view-index builder uses to reach cell data without
 * knowing the row type. `compare` supplies a custom row-index comparator for a
 * column (a column `sortCompare` or its cell type's `compare`). Without one, the
 * full build compares `getText` keys with a shared collator (empty last in both
 * directions); the incremental update uses `defaultCompareText`.
 *
 * A `compare` a caller returns MUST be deterministic and depend only on the two
 * rows' current values — {@link updateViewIndex} reuses the untouched rows'
 * order under it instead of re-deriving it.
 */
export type CellAccessor = {
  /** The raw text the filter matcher, the empty check, and the default sort read. */
  getText(rowIndex: number, columnId: string): string;
  /** The quick-search text; defaults to `getText`. */
  getSearchText?: (rowIndex: number, columnId: string) => string;
  compare?(columnId: string): ((a: number, b: number) => number) | undefined;
  /** Whether a row's cell in `columnId` is empty for sort placement; defaults to `getText() === ""`. */
  isEmpty?(rowIndex: number, columnId: string): boolean;
  /** The column's raw (un-stringified) cell value; only needed by a column's `filterMatch`. */
  getValue?(rowIndex: number, columnId: string): unknown;
  /** The column's `filterMatch` predicate, if the column declares one. */
  filterMatch?(columnId: string): ((value: unknown, filter: FilterSpec) => boolean) | undefined;
};

/**
 * One filter's per-row test: the column's `filterMatch` (raw value) when the accessor provides
 * both the predicate and raw values, else the built-in text matcher. Both the rebuild and the
 * incremental path build through this so a custom predicate can never desync between them.
 */
export function makeFilterTest(accessor: CellAccessor, filter: FilterSpec): (row: number) => boolean {
  const custom = accessor.filterMatch?.(filter.columnId);
  const getValue = accessor.getValue;
  if (custom && getValue) {
    // a thrown predicate fails the row rather than the view build
    return (row: number) => {
      try {
        return custom(getValue(row, filter.columnId), filter);
      } catch {
        return false;
      }
    };
  }
  const test = createFilterMatcher(filter);
  return (row: number) => test(accessor.getText(row, filter.columnId));
}

/**
 * One node's per-row test. A group compiles to one closure over its children's tests: `every` for
 * `"and"`, `some` for `"or"`; any join other than `"or"` evaluates as `"and"`, and an empty group
 * matches every row.
 */
export function makeFilterNodeTest(accessor: CellAccessor, node: FilterNode): (row: number) => boolean {
  if (!isFilterGroup(node)) return makeFilterTest(accessor, node);
  const tests = groupChildren(node).map((child) => makeFilterNodeTest(accessor, child));
  if (tests.length === 0) return () => true;
  if (tests.length === 1) return tests[0]!;
  return node.join === "or" ? (row) => tests.some((test) => test(row)) : (row) => tests.every((test) => test(row));
}

/** The accessor's quick-search reader: `getSearchText` when present, else `getText`. */
export function searchTextReader(accessor: CellAccessor): (rowIndex: number, columnId: string) => string {
  return accessor.getSearchText ?? ((rowIndex, columnId) => accessor.getText(rowIndex, columnId));
}

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
  /** The top level always combines with `"and"`; `"or"` lives inside a {@link FilterGroup}. */
  filters: readonly FilterNode[];
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
    // One test per top-level node, built once outside the per-row loop: a numeric bound is parsed here, not per row.
    // Narrowing node by node keeps a flat list on the short-circuiting path it always had.
    for (const node of opts.filters) {
      const test = makeFilterNodeTest(accessor, node);
      indices = indices.filter((row) => test(row));
    }
  }

  const search = opts.search?.trim();
  if (search && opts.searchColumnIds) {
    const needle = search.toLowerCase();
    const columnIds = opts.searchColumnIds;
    const readSearchText = searchTextReader(accessor);
    indices = indices.filter((row) =>
      columnIds.some((columnId) => readSearchText(row, columnId).toLowerCase().includes(needle)),
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
      const empties = new Uint8Array(rowCount);
      for (const row of indices) empties[row] = isEmptyCell(accessor, row, sort.columnId) ? 1 : 0;
      // Same empty-last-in-both-directions rule as the default path, so a typed column's blanks
      // don't flip sides on a direction change while a text column's stay put.
      return (a: number, b: number) => {
        const emptyA = empties[a] === 1;
        const emptyB = empties[b] === 1;
        if (emptyA && emptyB) return 0;
        if (emptyA) return 1;
        if (emptyB) return -1;
        return dir * custom(a, b);
      };
    }

    // Each row's text key is read once (O(n)) into a dense array, not on every comparison.
    const keys = new Array<string>(rowCount);
    for (const row of indices) keys[row] = accessor.getText(row, sort.columnId);

    // Empty sorts last in both directions; only the non-empty order flips.
    return (a: number, b: number) => {
      const textA = keys[a]!;
      const textB = keys[b]!;
      if (textA === "") return textB === "" ? 0 : 1;
      if (textB === "") return -1;
      return dir * collator.compare(textA, textB);
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
