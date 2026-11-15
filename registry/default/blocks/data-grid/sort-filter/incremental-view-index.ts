import type { FilterNode, SortSpec } from "../types";
import { isEmptyCell, makeFilterNodeTest, type CellAccessor, type ViewIndexOptions } from "./build-view-index";
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
 * own guard.
 */
export type IncrementalBailReason = "too-many-rows" | "search-active";

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

/** Whether `row` survives the active filters — the same tests, group semantics, and text source the rebuild uses. */
export function makeFilterPredicate(accessor: CellAccessor, filters: readonly FilterNode[]): (row: number) => boolean {
  if (filters.length === 0) return () => true;
  const tests = filters.map((node) => makeFilterNodeTest(accessor, node));
  return (row) => tests.every((test) => test(row));
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
  const rows = Array.from(new Set(touchedRows));
  const survives = makeFilterPredicate(accessor, opts.filters);
  // With no sort columns the comparator degenerates to the data-index tiebreak alone, which is
  // exactly the order the rebuild leaves an unsorted filtered view in.
  const compare = makeViewComparator(accessor, opts.sorts);
  const positions = locateRows(prevViewIndex, rows);

  if (everyRowStaysPut(prevViewIndex, rows, positions, survives, compare)) return { viewIndex: prevViewIndex as number[], bail: null };
  if (rows.length === 1 && positions[0] !== -1 && survives(rows[0]!)) {
    return { viewIndex: moveRow(prevViewIndex, positions[0]!, compare), bail: null };
  }
  if (rows.length <= SPLICE_ROW_LIMIT) return { viewIndex: spliceRows(prevViewIndex, rows, survives, compare), bail: null };
  return { viewIndex: mergeRows(prevViewIndex, rows, survives, compare), bail: null };
}

/** At or below this many touched rows, `indexOf` plus `splice` beat the one-pass merge. */
const SPLICE_ROW_LIMIT = 4;

/** The index of each of `rows` in `view`, or -1 when absent: `indexOf` for a few rows, one scan otherwise. */
function locateRows(view: readonly number[], rows: readonly number[]): number[] {
  if (rows.length <= SPLICE_ROW_LIMIT) return rows.map((row) => view.indexOf(row));
  const slotOf = new Map<number, number>();
  rows.forEach((row, slot) => slotOf.set(row, slot));
  const mark = markRows(rows);
  const positions = new Array<number>(rows.length).fill(-1);
  for (let i = 0; i < view.length; i++) {
    const row = view[i]!;
    if (row < mark.length && mark[row] === 1) positions[slotOf.get(row)!] = i;
  }
  return positions;
}

function markRows(rows: readonly number[]): Uint8Array {
  let max = 0;
  for (const row of rows) if (row > max) max = row;
  const mark = new Uint8Array(max + 1);
  for (const row of rows) mark[row] = 1;
  return mark;
}

/**
 * Whether the view is still sorted and filtered without moving anything: every touched row keeps its
 * filter verdict and sorts strictly between its neighbours under the current values. Adjacent pairs in
 * order make the whole view in order, so the caller can keep the previous array.
 */
function everyRowStaysPut(
  view: readonly number[],
  rows: readonly number[],
  positions: readonly number[],
  survives: (row: number) => boolean,
  compare: (a: number, b: number) => number,
): boolean {
  for (let slot = 0; slot < rows.length; slot++) {
    const row = rows[slot]!;
    const position = positions[slot]!;
    if (position === -1 || !survives(row)) return false;
    if (position > 0 && compare(view[position - 1]!, row) >= 0) return false;
    if (position < view.length - 1 && compare(row, view[position + 1]!) >= 0) return false;
  }
  return true;
}

/** Moves the row at `position` to its sorted place: one copy of the view plus a shift of the rows it passes. */
function moveRow(view: readonly number[], position: number, compare: (a: number, b: number) => number): number[] {
  const next = view.slice();
  const row = next[position]!;
  let low = 0;
  let high = next.length - 1;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (compare(next[mid < position ? mid : mid + 1]!, row) < 0) low = mid + 1;
    else high = mid;
  }
  // `copyWithin` runs about 80x slower than a plain loop on a number[] in V8.
  for (let i = position; i < low; i++) next[i] = next[i + 1]!;
  for (let i = position; i > low; i--) next[i] = next[i - 1]!;
  next[low] = row;
  return next;
}

/** Pulls each touched row out and binary-searches the surviving ones back in, one `splice` pair per row. */
function spliceRows(
  view: readonly number[],
  rows: readonly number[],
  survives: (row: number) => boolean,
  compare: (a: number, b: number) => number,
): number[] {
  const next = view.slice();
  for (const row of rows) {
    const position = next.indexOf(row);
    if (position !== -1) next.splice(position, 1);
  }
  for (const row of rows) {
    if (!survives(row)) continue;
    next.splice(lowerBound(next, row, compare), 0, row);
  }
  return next;
}

/** One pass that drops the touched rows, then stitches the surviving ones back in at their sorted places. */
function mergeRows(
  view: readonly number[],
  rows: readonly number[],
  survives: (row: number) => boolean,
  compare: (a: number, b: number) => number,
): number[] {
  const mark = markRows(rows);
  const rest: number[] = [];
  for (let i = 0; i < view.length; i++) {
    const row = view[i]!;
    if (row >= mark.length || mark[row] !== 1) rest.push(row);
  }
  const inserts = rows.filter(survives).sort(compare);
  const parts: number[][] = [];
  let from = 0;
  for (const row of inserts) {
    const at = lowerBound(rest, row, compare);
    parts.push(rest.slice(from, at), [row]);
    from = at;
  }
  parts.push(rest.slice(from));
  return ([] as number[]).concat(...parts);
}
