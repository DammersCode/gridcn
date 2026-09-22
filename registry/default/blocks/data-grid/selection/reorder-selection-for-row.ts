import { CompactSelection } from "./compact-selection";
import type { CellCoord, GridRect, GridSelection } from "../types";

/** View-space index remap for a single-row reorder: row `from` lands at `to`, every row between the two shifts one slot toward `from`. */
export function rowReorderMap(from: number, to: number): (index: number) => number {
  if (to > from) return (i) => (i === from ? to : i > from && i <= to ? i - 1 : i);
  if (to < from) return (i) => (i === from ? to : i >= to && i < from ? i + 1 : i);
  return (i) => i;
}

/**
 * Re-anchors a selection after the row at view index `from` moves to `to` (view indices; the data
 * move is already applied by the caller). The row channel and the active cell follow the rows they
 * belong to; each rect follows its own top/bottom rows, so a rect containing the moved row spans
 * the moved row's new slot to the remapped edge (approximation, only reachable by dragging a row
 * out of the interior of its own range).
 */
export function reorderSelectionForRow(selection: GridSelection, from: number, to: number): GridSelection {
  if (from === to) return selection;
  const f = rowReorderMap(from, to);
  const rows = CompactSelection.fromArray(selection.rows.toArray().map(f).sort((a, b) => a - b));
  const mapRect = (rect: GridRect): GridRect => {
    const top = f(rect.y);
    const bottom = f(rect.y + rect.height - 1);
    return { ...rect, y: Math.min(top, bottom), height: Math.abs(bottom - top) + 1 };
  };
  const shiftCell = (cell: CellCoord): CellCoord => ({ ...cell, row: f(cell.row) });
  return {
    current: selection.current
      ? {
          cell: shiftCell(selection.current.cell),
          range: mapRect(selection.current.range),
          rangeStack: selection.current.rangeStack.map(mapRect),
        }
      : null,
    rows,
    columns: selection.columns,
  };
}
