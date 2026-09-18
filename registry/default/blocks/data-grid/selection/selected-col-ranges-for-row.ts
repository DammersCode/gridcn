import type { GridRect, GridSelection } from "../types";

/** Half-open column range `[start, end)`, merged/sorted, describing which columns of one row are selected. */
export type ColRange = readonly [start: number, end: number];

/** True when `viewRow` falls inside `rect`'s row span. */
function rectCoversRow(rect: GridRect, viewRow: number): boolean {
  return viewRow >= rect.y && viewRow < rect.y + rect.height;
}

/** Inserts `[start, end)` into `ranges` (sorted, non-overlapping), merging any overlap/adjacency. */
function mergeRange(ranges: ColRange[], start: number, end: number): void {
  if (start >= end) return;
  let i = 0;
  // hot path (per-row selector): ranges[i]! guarded by i < ranges.length in the loop condition
  while (i < ranges.length && ranges[i]![1] < start) i++;
  let mergedStart = start;
  let mergedEnd = end;
  while (i < ranges.length && ranges[i]![0] <= mergedEnd) {
    mergedStart = Math.min(mergedStart, ranges[i]![0]);
    mergedEnd = Math.max(mergedEnd, ranges[i]![1]);
    ranges.splice(i, 1);
  }
  ranges.splice(i, 0, [mergedStart, mergedEnd]);
}

/**
 * The selected column ranges for one view row — a row is a rectangle's-worth of columns, not
 * individual cells, so this collapses to a handful of `[start, end)` tuples (usually 0 or 1) instead
 * of a per-column boolean/Set. Used by {@link useDataGridRowCellState} so a row's selector output
 * stays cheap to compute and cheap to compare (small array, content-equal across unrelated updates).
 */
export function selectedColRangesForRow(selection: GridSelection, viewRow: number, colCount: number): ColRange[] {
  const ranges: ColRange[] = [];
  if (selection.rows.hasIndex(viewRow)) mergeRange(ranges, 0, colCount);
  if (selection.columns.length > 0) {
    for (const col of selection.columns.toArray()) mergeRange(ranges, col, col + 1);
  }
  if (selection.current) {
    if (rectCoversRow(selection.current.range, viewRow)) {
      mergeRange(ranges, selection.current.range.x, selection.current.range.x + selection.current.range.width);
    }
    for (const rect of selection.current.rangeStack) {
      if (rectCoversRow(rect, viewRow)) mergeRange(ranges, rect.x, rect.x + rect.width);
    }
  }
  return ranges;
}

/** Whether `col` falls inside any of `ranges` — the per-cell membership check row.tsx/cell.tsx derive `isSelected` from. */
export function colRangesContain(ranges: readonly ColRange[], col: number): boolean {
  for (const [start, end] of ranges) {
    if (col >= start && col < end) return true;
  }
  return false;
}

/** Content equality for two `ColRange[]` — same length, same tuples in the same order (both are built sorted/merged, so order is deterministic). */
export function colRangesEqual(a: readonly ColRange[], b: readonly ColRange[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ra = a[i]!; // i < a.length by loop condition, same length as b (checked above)
    const rb = b[i]!;
    if (ra[0] !== rb[0] || ra[1] !== rb[1]) return false;
  }
  return true;
}
