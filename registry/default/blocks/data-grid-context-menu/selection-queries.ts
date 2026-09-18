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

/**
 * Every view row index covered by `selection` (primary range, range stack, and the whole-row
 * channel), deduped and ascending — the row set the cell menu's row-op items (Delete/Duplicate
 * row(s)) act on. Built from `GridSelection`'s public shape only (no internal selection helpers).
 */
export function selectedViewRows(selection: GridSelection): number[] {
  const rows = new Set<number>();
  if (selection.current) {
    const rects = [selection.current.range, ...selection.current.rangeStack];
    for (const rect of rects) {
      for (let row = rect.y; row < rect.y + rect.height; row++) rows.add(row);
    }
  }
  for (const row of selection.rows.toArray()) rows.add(row);
  return Array.from(rows).sort((a, b) => a - b);
}
