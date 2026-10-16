import type { ViewCoord, GridSelection, GridRect } from "../types";
import { CompactSelection } from "./compact-selection";
import { rectFromCorners, rectsEqual } from "./rects";

/** The selection with nothing selected. */
export function emptySelection(): GridSelection {
  return { current: null, rows: CompactSelection.empty(), columns: CompactSelection.empty() };
}

/** True when all three selection channels (current range, rows, columns) are empty. */
export function isSelectionEmpty(selection: GridSelection): boolean {
  return selection.rows.length === 0 && selection.columns.length === 0 && !selection.current;
}

/** A fresh 1x1 selection anchored at `coord`, clearing row/column channels. */
export function selectCell(coord: ViewCoord): GridSelection {
  return {
    current: { cell: coord, range: { x: coord.col, y: coord.row, width: 1, height: 1 }, rangeStack: [] },
    rows: CompactSelection.empty(),
    columns: CompactSelection.empty(),
  };
}

/** Shift-click/shift-arrow: extends the primary range from the existing anchor to `coord`; anchor is unchanged. Returns the input itself when the result equals the current range (a stationary drag re-fires the same coord; stable identity keeps selection observers quiet). */
export function extendTo(selection: GridSelection, coord: ViewCoord): GridSelection {
  if (!selection.current) return selectCell(coord);
  const { cell, rangeStack } = selection.current;
  const range = rectFromCorners(cell, coord);
  if (rectsEqual(range, selection.current.range)) return selection;
  return {
    current: { cell, range, rangeStack },
    rows: selection.rows,
    columns: selection.columns,
  };
}

/** True when `row` is covered by the rows channel or any cell range — the state a marker checkbox shows. */
export function isRowChecked(selection: GridSelection, row: number): boolean {
  const { current } = selection;
  const covers = (r: GridRect) => row >= r.y && row < r.y + r.height;
  return selection.rows.hasIndex(row) || (!!current && (covers(current.range) || current.rangeStack.some(covers)));
}

/** Removes `row` from the rows channel and from every cell range, splitting a range that spans it; the piece holding the anchor stays primary. `selection` itself comes back when the row is in neither channel. */
export function removeRowFromSelection(selection: GridSelection, row: number, options: { multiRange?: boolean } = {}): GridSelection {
  const { multiRange = true } = options;
  const rows = selection.rows.hasIndex(row) ? CompactSelection.adopt(selection.rows).remove(row) : selection.rows;
  const current = selection.current;
  const covers = (r: GridRect) => row >= r.y && row < r.y + r.height;
  if (!current || (!covers(current.range) && !current.rangeStack.some(covers))) {
    return rows === selection.rows ? selection : { ...selection, rows };
  }
  const without = (r: GridRect): GridRect[] => {
    if (!covers(r)) return [r];
    const above = row - r.y;
    const below = r.y + r.height - row - 1;
    return [
      ...(above > 0 ? [{ ...r, height: above }] : []),
      ...(below > 0 ? [{ ...r, y: row + 1, height: below }] : []),
    ];
  };
  const { cell } = current;
  const holdsCell = (r: GridRect) => cell.col >= r.x && cell.col < r.x + r.width && cell.row >= r.y && cell.row < r.y + r.height;
  const primaryPieces = without(current.range);
  const stackPieces = multiRange ? current.rangeStack.flatMap(without) : [];
  const range = primaryPieces.find(holdsCell) ?? primaryPieces.at(-1) ?? stackPieces.at(-1);
  if (!range) return { ...selection, current: null, rows };
  const anchor =
    primaryPieces.length === 0
      ? { col: range.x, row: range.y }
      : { col: cell.col, row: Math.min(Math.max(cell.row, range.y), range.y + range.height - 1) };
  const rangeStack = multiRange ? [...stackPieces, ...primaryPieces].filter((piece) => piece !== range) : [];
  return { ...selection, rows, current: { cell: anchor, range, rangeStack } };
}

/** Ctrl-click: pushes the current primary range onto the stack and starts a new 1x1 range at `coord`. */
export function pushRange(selection: GridSelection, coord: ViewCoord): GridSelection {
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
