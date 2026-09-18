import type { CellCoord, GridSelection } from "../types";
import { CompactSelection } from "./compact-selection";
import { rectFromCorners } from "./rects";

/** The selection with nothing selected. */
export function emptySelection(): GridSelection {
  return { current: null, rows: CompactSelection.empty(), columns: CompactSelection.empty() };
}

/** True when all three selection channels (current range, rows, columns) are empty. */
export function isSelectionEmpty(selection: GridSelection): boolean {
  return selection.rows.length === 0 && selection.columns.length === 0 && !selection.current;
}

/** A fresh 1x1 selection anchored at `coord`, clearing row/column channels. */
export function selectCell(coord: CellCoord): GridSelection {
  return {
    current: { cell: coord, range: { x: coord.col, y: coord.row, width: 1, height: 1 }, rangeStack: [] },
    rows: CompactSelection.empty(),
    columns: CompactSelection.empty(),
  };
}

/** Shift-click/shift-arrow: extends the primary range from the existing anchor to `coord`; anchor is unchanged. */
export function extendTo(selection: GridSelection, coord: CellCoord): GridSelection {
  if (!selection.current) return selectCell(coord);
  const { cell, rangeStack } = selection.current;
  return {
    current: { cell, range: rectFromCorners(cell, coord), rangeStack },
    rows: selection.rows,
    columns: selection.columns,
  };
}

/** Ctrl-click: pushes the current primary range onto the stack and starts a new 1x1 range at `coord`. */
export function pushRange(selection: GridSelection, coord: CellCoord): GridSelection {
  if (!selection.current) return selectCell(coord);
  const { range, rangeStack } = selection.current;
  return {
    current: {
      cell: coord,
      range: { x: coord.col, y: coord.row, width: 1, height: 1 },
      rangeStack: [...rangeStack, range],
    },
    rows: selection.rows,
    columns: selection.columns,
  };
}
