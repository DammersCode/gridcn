import type { CellCoord, GridRect, GridSelection } from "../types";
import { CompactSelection } from "./compact-selection";
import { rectContains } from "./rects";
import { selectLine, type SelectLineOptions } from "./select-line-options";

/**
 * Whole-row selection channel op (row-marker click). Always clears the primary range/rangeStack;
 * clears the column channel too unless `additive`, `extendFromLast`, or `replaceFromLast` (which preserve it).
 */
export function selectRow(selection: GridSelection, index: number, opts: SelectLineOptions = {}): GridSelection {
  return {
    current: null,
    rows: selectLine(selection.rows, index, opts),
    columns: opts.additive || opts.extendFromLast || opts.replaceFromLast ? selection.columns : CompactSelection.empty(),
  };
}

/**
 * Whole-column selection channel op (header click). Always clears the primary range/rangeStack;
 * clears the row channel too unless `additive`, `extendFromLast`, or `replaceFromLast` (which preserve it).
 */
export function selectColumn(selection: GridSelection, index: number, opts: SelectLineOptions = {}): GridSelection {
  return {
    current: null,
    columns: selectLine(selection.columns, index, opts),
    rows: opts.additive || opts.extendFromLast || opts.replaceFromLast ? selection.rows : CompactSelection.empty(),
  };
}

/**
 * Resolves every selected region to a flat list of rects, in the order operations
 * like delete/copy should apply: primary range, range stack, full-height column
 * selections, then full-width row selections.
 */
export function selectionRects(selection: GridSelection, rowCount: number, colCount: number): GridRect[] {
  const rects: GridRect[] = [];
  if (selection.current) {
    rects.push(selection.current.range);
    for (const rect of selection.current.rangeStack) rects.push(rect);
  }
  for (const col of selection.columns.toArray()) {
    rects.push({ x: col, y: 0, width: 1, height: rowCount });
  }
  for (const row of selection.rows.toArray()) {
    rects.push({ x: 0, y: row, width: colCount, height: 1 });
  }
  return rects;
}

/**
 * Whether `coord` is selected via any channel: primary range, range stack, whole-row, or whole-column.
 * rowCount/colCount are accepted for a stable signature across callers but unused: row/column
 * channels already store data-space indices, and range containment needs no grid bounds.
 */
export function selectionContainsCell(
  selection: GridSelection,
  coord: CellCoord,
  _rowCount: number,
  _colCount: number,
): boolean {
  if (selection.rows.hasIndex(coord.row)) return true;
  if (selection.columns.hasIndex(coord.col)) return true;
  if (selection.current) {
    if (rectContains(selection.current.range, coord)) return true;
    for (const rect of selection.current.rangeStack) {
      if (rectContains(rect, coord)) return true;
    }
  }
  return false;
}
