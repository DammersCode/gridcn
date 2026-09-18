import type { GridRect, GridSelection } from "../types";

/** Direction for shift+arrow selection growth. */
export type ExtendDirection = "up" | "down" | "left" | "right";

/** Options for extendSelection. */
export type ExtendSelectionOptions = {
  /** Grow all the way to the grid edge instead of by one cell. */
  toEdge?: boolean;
  rowCount: number;
  colCount: number;
};

/**
 * Shift+arrow growth: extends the edge of the range away from the anchor, or
 * shrinks the edge nearest the anchor when that edge has moved past it
 * (Excel-correct contraction back toward a 1x1 selection at the anchor).
 */
export function extendSelection(
  selection: GridSelection,
  direction: ExtendDirection,
  opts: ExtendSelectionOptions,
): GridSelection {
  if (!selection.current) return selection;
  const { cell, range, rangeStack } = selection.current;
  const maxCol = opts.colCount - 1;
  const maxRow = opts.rowCount - 1;

  // The range corner opposite the anchor is the one that moves.
  let left = range.x;
  let right = range.x + range.width - 1;
  let top = range.y;
  let bottom = range.y + range.height - 1;

  // Each direction either grows the far edge (anchor sits on the opposite edge)
  // or shrinks the near edge back toward the anchor (anchor sits on this edge already).
  // toEdge is unconditional on both edges (glide/Excel: the moving end jumps to the
  // boundary, crossing the anchor, rather than only collapsing the near edge).
  switch (direction) {
    case "up": {
      if (opts.toEdge) {
        top = 0;
        bottom = cell.row;
      } else if (cell.row >= bottom) {
        top = Math.max(0, top - 1);
      } else {
        bottom = Math.max(cell.row, bottom - 1);
      }
      break;
    }
    case "down": {
      if (opts.toEdge) {
        bottom = maxRow;
        top = cell.row;
      } else if (cell.row <= top) {
        bottom = Math.min(maxRow, bottom + 1);
      } else {
        top = Math.min(cell.row, top + 1);
      }
      break;
    }
    case "left": {
      if (opts.toEdge) {
        left = 0;
        right = cell.col;
      } else if (cell.col >= right) {
        left = Math.max(0, left - 1);
      } else {
        right = Math.max(cell.col, right - 1);
      }
      break;
    }
    case "right": {
      if (opts.toEdge) {
        right = maxCol;
        left = cell.col;
      } else if (cell.col <= left) {
        right = Math.min(maxCol, right + 1);
      } else {
        left = Math.min(cell.col, left + 1);
      }
      break;
    }
  }

  const newRange: GridRect = { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
  return {
    current: { cell, range: newRange, rangeStack },
    rows: selection.rows,
    columns: selection.columns,
  };
}
