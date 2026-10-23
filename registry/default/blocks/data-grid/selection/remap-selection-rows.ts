import { CompactSelection } from "./compact-selection";
import { rectFromCorners } from "./rects";
import type { GridRect, GridSelection } from "../types";

/**
 * Re-anchors a selection after the view rows permute (`newIndexOf[before] === after`). The row
 * channel and the cursor follow their rows. A range stays only when its rows land contiguous,
 * else it collapses onto the cursor. O(r log r + h) for r checked rows and ranges of h rows.
 */
export function remapSelectionRows(selection: GridSelection, newIndexOf: ArrayLike<number>): GridSelection {
  const after = (row: number) => newIndexOf[row] ?? row;
  const rows = CompactSelection.fromArray(selection.rows.toArray().map(after).sort((a, b) => a - b));
  const current = selection.current;
  if (!current) return { current: null, rows, columns: selection.columns };

  const cell = { ...current.cell, row: after(current.cell.row) };
  const mapRect = (rect: GridRect): GridRect | null => {
    let top = Infinity;
    let bottom = -Infinity;
    for (let row = rect.y; row < rect.y + rect.height; row++) {
      const moved = after(row);
      if (moved < top) top = moved;
      if (moved > bottom) bottom = moved;
    }
    return bottom - top + 1 === rect.height ? { ...rect, y: top } : null;
  };
  const range = mapRect(current.range);
  return {
    current: {
      cell,
      range: range ?? rectFromCorners(cell, cell),
      rangeStack: range ? current.rangeStack.flatMap((rect) => mapRect(rect) ?? []) : [],
    },
    rows,
    columns: selection.columns,
  };
}
