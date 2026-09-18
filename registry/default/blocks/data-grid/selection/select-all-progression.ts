import { CompactSelection } from "./compact-selection";
import type { CellCoord, GridRect, GridSelection } from "../types";

/** Two-stage progression tracked by the caller (interaction layer): which stage the last `selectAllProgression` call produced. */
export type SelectAllStage = "region" | "all" | null;

/** Probes whether the cell at `coord` is empty, via the cell type's `isEmpty` — same contract as `jumpToDataBoundary`'s local helper. */
export type IsEmptyAt = (coord: CellCoord) => boolean;

function wholeGridRect(rowCount: number, colCount: number): GridRect {
  return { x: 0, y: 0, width: colCount, height: rowCount };
}

/**
 * Excel's "current region": the maximal rectangle of contiguous non-empty rows/columns containing
 * `active`, grown one edge at a time (flood-fill by row/column, not per-cell) until every row/column
 * just outside the rect is entirely empty. An empty `active` cell's region is itself (Excel parity).
 * O(perimeter × rows/cols touched) — only called on an explicit Ctrl+A, never a hot path.
 */
export function computeDataRegion(active: CellCoord, rowCount: number, colCount: number, isEmptyAt: IsEmptyAt): GridRect {
  if (isEmptyAt(active)) return { x: active.col, y: active.row, width: 1, height: 1 };

  let left = active.col;
  let right = active.col;
  let top = active.row;
  let bottom = active.row;

  const rowHasData = (row: number, fromCol: number, toCol: number): boolean => {
    for (let col = fromCol; col <= toCol; col++) if (!isEmptyAt({ col, row })) return true;
    return false;
  };
  const colHasData = (col: number, fromRow: number, toRow: number): boolean => {
    for (let row = fromRow; row <= toRow; row++) if (!isEmptyAt({ col, row })) return true;
    return false;
  };

  // grow each edge outward while the next row/column just past it still has data; a pass with no
  // growth on any edge means the rect is stable (Excel's flood-fill-by-line, not per-cell).
  let grew = true;
  while (grew) {
    grew = false;
    if (top > 0 && rowHasData(top - 1, left, right)) {
      top--;
      grew = true;
    }
    if (bottom < rowCount - 1 && rowHasData(bottom + 1, left, right)) {
      bottom++;
      grew = true;
    }
    if (left > 0 && colHasData(left - 1, top, bottom)) {
      left--;
      grew = true;
    }
    if (right < colCount - 1 && colHasData(right + 1, top, bottom)) {
      right++;
      grew = true;
    }
  }

  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

function isRect(rect: GridRect, other: GridRect): boolean {
  return rect.x === other.x && rect.y === other.y && rect.width === other.width && rect.height === other.height;
}

function selectionForRect(rect: GridRect, anchor: CellCoord): GridSelection {
  return {
    current: { cell: anchor, range: rect, rangeStack: [] },
    rows: CompactSelection.empty(),
    columns: CompactSelection.empty(),
  };
}

/**
 * Two-stage Ctrl+A (Excel/Sheets parity, docs/agent-work/specs/2026-07-18-two-stage-select-all-design.md):
 * stage 1 selects the active cell's data region, stage 2 (an immediate repeat, tracked by the
 * caller via `stage`) selects the whole grid. When the region already equals the whole grid
 * (dense data), stage 1 already lands on `"all"` so a repeated press stays a no-op rather than
 * toggling anything — the caller's `stage` never needs a second real transition in that case.
 * Pure: takes the progression stage in, returns the next selection + stage out.
 */
export function selectAllProgression(
  selection: GridSelection,
  rowCount: number,
  colCount: number,
  active: CellCoord,
  isEmptyAt: IsEmptyAt,
  stage: SelectAllStage,
): { selection: GridSelection; stage: "region" | "all" } {
  const wholeGrid = wholeGridRect(rowCount, colCount);

  if (stage === "region") {
    return { selection: selectionForRect(wholeGrid, active), stage: "all" };
  }

  const region = computeDataRegion(active, rowCount, colCount, isEmptyAt);
  if (isRect(region, wholeGrid)) {
    // dense data: region already covers the grid, so this stays a no-op on repeat presses too —
    // only re-derive the selection if it isn't already exactly the whole grid.
    const alreadyWholeGrid =
      selection.current !== null && selection.current.rangeStack.length === 0 && isRect(selection.current.range, wholeGrid);
    return { selection: alreadyWholeGrid ? selection : selectionForRect(wholeGrid, active), stage: "all" };
  }
  return { selection: selectionForRect(region, active), stage: "region" };
}
