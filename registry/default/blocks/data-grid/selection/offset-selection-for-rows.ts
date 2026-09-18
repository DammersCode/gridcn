import { CompactSelection } from "./compact-selection";
import type { CellCoord, GridRect, GridSelection } from "../types";

/** Shifts the row selection channel and any range rects to follow a row insert/delete at `atIndex`. */
export function offsetSelectionForRows(selection: GridSelection, atIndex: number, delta: number): GridSelection {
  const shiftRect = (rect: GridRect): GridRect => {
    if (rect.y >= atIndex) {
      // A delete span starting at/before the rect's first row removes rows from inside it too.
      const deletedSpanEnd = atIndex - delta;
      const overlap = delta < 0 ? Math.max(0, Math.min(rect.y + rect.height, deletedSpanEnd) - rect.y) : 0;
      return { ...rect, y: Math.max(atIndex, rect.y + delta), height: Math.max(0, rect.height - overlap) };
    }
    if (rect.y + rect.height > atIndex) return { ...rect, height: Math.max(0, rect.height + delta) };
    return rect;
  };
  const shiftCell = (cell: CellCoord): CellCoord =>
    cell.row >= atIndex ? { ...cell, row: Math.max(atIndex, cell.row + delta) } : cell;

  // Only members at/after atIndex move; earlier members are untouched.
  const before = selection.rows.toArray().filter((r) => r < atIndex);
  const afterShifted = selection.rows
    .toArray()
    .filter((r) => r >= atIndex)
    .map((r) => Math.max(atIndex, r + delta))
    .filter((r) => r >= 0);
  const rows = CompactSelection.fromArray([...before, ...afterShifted]);

  return {
    current: selection.current
      ? {
          cell: shiftCell(selection.current.cell),
          range: shiftRect(selection.current.range),
          rangeStack: selection.current.rangeStack.map(shiftRect),
        }
      : null,
    rows,
    columns: selection.columns,
  };
}
