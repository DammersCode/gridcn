import type { FilterJoinOperator, FilterSpec, SortSpec } from "../types";
import { isEmptyCell, makeFilterTest, type CellAccessor, type ViewIndexOptions } from "./build-view-index";
import { defaultCompareText } from "./default-compare-text";

/**
 * Above this many touched rows, {@link updateViewIndex} refuses the incremental path and the caller
 * rebuilds. Each touched row costs one splice-out plus one splice-in against the index array, so the
 * cost is linear in k while the rebuild is a flat O(n log n) — the two cross where k × per-row cost
 * meets the rebuild.
 *
 * Measured (prod build, 100k rows, one sort column, paired in one launch): the rebuild is ~415 ms
 * flat; the incremental path is 0.3 / 0.9 / 7.6 / 28.5 / 137 ms at k = 1 / 20 / 256 / 1000 / 5000,
 * a slope near 0.027 ms per touched row. The curves therefore meet around k ≈ 15,000. 256 sits ~58x
 * inside that, so no machine, dataset, or collator can land a batch on the wrong side of it — and a
 * batch that big is a bulk import, which the rebuild serves better anyway.
 */
export const INCREMENTAL_PATCH_LIMIT = 256;

/**
 * Why {@link updateViewIndex} declined the incremental path — `null` means it ran. See each valve's
 * own guard. `"custom-comparator"` is retained for callers that switch on it, but no longer fires:
 * a resolved `accessor.compare` rides the incremental path (see {@link makeViewComparator}).
 */
export type IncrementalBailReason = "too-many-rows" | "custom-comparator" | "search-active";

export type IncrementalViewIndexResult =
  | { viewIndex: number[]; bail: null }
  | { viewIndex: null; bail: IncrementalBailReason };

/**
 * A row's total-order position under one sort column, resolved once per row per call.
 * Empty sorts last in BOTH directions, so the direction multiplier applies only when neither
 * side is empty — {@link buildViewIndex}'s own rule, replicated here rather than shared, because the
 * rebuild stays the untouched reference implementation. `custom` is the column's resolved
 * `accessor.compare` when it has one; otherwise the text keys drive `defaultCompareText`.
 */
function compareOnColumn(
  accessor: CellAccessor,
  columnId: string,
  dir: 1 | -1,
  custom: ((a: number, b: number) => number) | undefined,
  a: number,
  b: number,
): number {
  if (custom) {
    const emptyA = isEmptyCell(accessor, a, columnId);
    const emptyB = isEmptyCell(accessor, b, columnId);
    if (emptyA && emptyB) return 0;
    if (emptyA) return 1;
    if (emptyB) return -1;
    return dir * custom(a, b);
  }
  const textA = accessor.getText(a, columnId);
  const textB = accessor.getText(b, columnId);
  if (textA === "" || textB === "") return defaultCompareText(textA, textB);
  return dir * defaultCompareText(textA, textB);
}

/**
 * The comparator chain {@link buildViewIndex} sorts by, expressed over data indices.
 *
 * Tiebreak equivalence: the rebuild decorates each row with its POSITION in the filtered index array
 * and breaks ties on that position. `indices` starts as `[0..n)` and every filter pass preserves
 * relative order, so position is strictly increasing in data index — `positionA - positionB` and
 * `a - b` always agree in sign. Comparing data indices directly is therefore the identical tiebreak,
 * and it makes the order TOTAL (no two rows ever compare equal), which is what lets a binary search
 * find one uniquely-correct insertion point.
 */
export function makeViewComparator(accessor: CellAccessor, sorts: readonly SortSpec[]): (a: number, b: number) => number {
  // Resolved ONCE per column here, not per comparison — mirrors the rebuild's per-sort resolution.
  const columns = sorts.map((sort) => ({
    columnId: sort.columnId,
    dir: (sort.direction === "asc" ? 1 : -1) as 1 | -1,
    custom: accessor.compare?.(sort.columnId),
  }));
  return (a, b) => {
    for (const { columnId, dir, custom } of columns) {
      const result = compareOnColumn(accessor, columnId, dir, custom, a, b);
      if (result !== 0) return result;
    }
    return a - b;
  };
}

/** Whether `row` survives the active filters — the same matchers, join semantics, and text source the rebuild uses. */
export function makeFilterPredicate(
  accessor: CellAccessor,
  filters: readonly FilterSpec[],
  joinOperator: FilterJoinOperator | undefined,
): (row: number) => boolean {
  if (filters.length === 0) return () => true;
  const matchers = filters.map((filter) => makeFilterTest(accessor, filter));
  if (joinOperator === "or") return (row) => matchers.some((test) => test(row));
  return (row) => matchers.every((test) => test(row));
}

/** Index in `view` where `row` belongs under `compare`; `view` must already be sorted by it. */
export function lowerBound(view: readonly number[], row: number, compare: (a: number, b: number) => number): number {
  let lo = 0;
  let hi = view.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (compare(view[mid]!, row) < 0) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Rebuilds `prevViewIndex` for a value patch that touched `touchedRows` (data indices), instead of
 * re-sorting all `n` rows. Per touched row: remove it from the order, re-test filter membership
 * against the NEW values, and binary-search it back in under the identical comparator chain — so a
 * value change may also add a row to, or drop it from, the filtered set.
 *
 * `touchedRows` must name EVERY row whose values changed since `prevViewIndex` was built (a caller
 * holding deferred batches has to pass their rows too) — every other row's key is assumed unchanged,
 * which is what makes the remaining order a valid binary-search invariant.
 *
 * Returns `{viewIndex: null, bail}` whenever the incremental path cannot prove it reproduces
 * {@link buildViewIndex} exactly; the caller must then run the full rebuild. Correctness beats
 * cleverness: every valve below is a case where equivalence is not provable, not a case where it is
 * merely slower.
 *
 * A column with an `accessor.compare` needs NO valve: both paths now resolve the same comparator
 * under the same empty-last rule, and the accessor contract makes it a deterministic function of the
 * two rows' values — so an untouched row's key is unchanged and the remaining order stays a valid
 * binary-search invariant, exactly as for the default text comparator.
 */
export function updateViewIndex(
  prevViewIndex: readonly number[],
  touchedRows: readonly number[],
  accessor: CellAccessor,
  opts: ViewIndexOptions,
): IncrementalViewIndexResult {
  if (touchedRows.length > INCREMENTAL_PATCH_LIMIT) return { viewIndex: null, bail: "too-many-rows" };
  // buildViewIndex narrows by `search` before sorting; this path only knows sort + filter membership.
  if (opts.search?.trim() && opts.searchColumnIds) return { viewIndex: null, bail: "search-active" };
  const touched = new Set(touchedRows);
  const survives = makeFilterPredicate(accessor, opts.filters, opts.joinOperator);
  // With no sort columns the comparator degenerates to the data-index tiebreak alone, which is
  // exactly the order the rebuild leaves an unsorted filtered view in.
  const compare = makeViewComparator(accessor, opts.sorts);

  // `indexOf` and `splice` are native memmoves over the index array, so 2k of them stay far cheaper
  // than any JS-level pass over all n. Measured at 100k rows / one sort column: this path costs
  // 0.47 / 0.91 / 1.57 ms at k = 5 / 20 / 50, against a uniform 3.7-4.1 ms for a single
  // filter-and-merge pass — the JS-loop alternative loses at every k, so there is only one path.
  const next = prevViewIndex.slice();
  for (const row of touched) {
    const position = next.indexOf(row);
    if (position !== -1) next.splice(position, 1);
  }
  for (const row of touched) {
    if (!survives(row)) continue;
    next.splice(lowerBound(next, row, compare), 0, row);
  }
  return { viewIndex: next, bail: null };
}
