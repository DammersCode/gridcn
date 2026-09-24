import type { CellCoord, GridSelection } from "@/registry/default/blocks/data-grid/data-grid";

/** Whether `coord` falls inside `selection`'s primary range, any stacked range, or the row/column channels — used to decide the Excel "right-click outside selection selects that cell first" gesture. */
export function isCellInSelection(selection: GridSelection, coord: CellCoord): boolean {
  if (selection.rows.hasIndex(coord.row)) return true;
  if (selection.columns.hasIndex(coord.col)) return true;
  if (!selection.current) return false;
  const inRect = (r: { x: number; y: number; width: number; height: number }) =>
    coord.col >= r.x && coord.col < r.x + r.width && coord.row >= r.y && coord.row < r.y + r.height;
  return inRect(selection.current.range) || selection.current.rangeStack.some(inRect);
}

/** Row-op target set — the core's own derivation of the selected view rows (see `getSelectedViewRows`), re-exported so the cell menu shares one code path with every other consumer. */
export { getSelectedViewRows as selectedViewRows } from "@/registry/default/blocks/data-grid/data-grid";
