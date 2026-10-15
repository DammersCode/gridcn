import type { GridRect } from "@/registry/default/blocks/data-grid/data-grid";

/** Walk cap for one status-bar aggregation, in visited cells (same cap as the clipboard's `MAX_COPY_CELLS`). */
export const MAX_STATUS_CELLS = 200_000;

export type SelectionStats = {
  /** Selected cells with a value, each counted once across overlapping rects. */
  cells: number;
  /** Cells whose column's cell type `isEmpty` is false. */
  count: number;
  /** Cells whose raw value is a finite number. */
  numeric: number;
  /** Neumaier-compensated sum of the numeric values; `null` when `numeric === 0`. */
  sum: number | null;
  avg: number | null;
  min: number | null;
  max: number | null;
  /** The single column id all numeric cells came from; `null` when they span several columns. */
  numericColumnId: string | null;
  /** The walk stopped at `maxCells` before seeing the whole selection. */
  approximate: boolean;
};

/** All-zero stats: nothing selected (also the hook's initial state). */
export const EMPTY_SELECTION_STATS: SelectionStats = {
  cells: 0,
  count: 0,
  numeric: 0,
  sum: null,
  avg: null,
  min: null,
  max: null,
  numericColumnId: null,
  approximate: false,
};

export type SelectionStatsInput = {
  /** The selection regions in apply order; a cell in two rects counts once. */
  rects: readonly GridRect[];
  /** Visible rows the rects index into (`viewIndex.length`). */
  rowCount: number;
  /** Visible columns the rects index into. */
  colCount: number;
  /** The cell value at a view position; `undefined` for an unloaded (lazy) hole. */
  valueAt: (viewRow: number, viewCol: number) => unknown;
  /** Whether `value` is empty for the column at `viewCol` (that column's cell type `isEmpty`). */
  isEmptyAt: (viewCol: number, value: unknown) => boolean;
  /** The id of the visible column at `viewCol`. */
  columnIdAt: (viewCol: number) => string;
  /** Stop the walk once this many cells were visited, lazy holes included (default {@link MAX_STATUS_CELLS}). */
  maxCells?: number;
};

export function computeSelectionStats(input: SelectionStatsInput): SelectionStats {
  const { rects, rowCount, colCount, valueAt, isEmptyAt, columnIdAt } = input;
  const maxCells = input.maxCells ?? MAX_STATUS_CELLS;
  const seen = rects.length > 1 ? new Set<number>() : null;
  let visited = 0;
  let cells = 0;
  let count = 0;
  let numeric = 0;
  let sum = 0;
  // Neumaier compensation term; the plain sum alone loses 0.1 + 0.2 = 0.30000000000000004.
  let compensation = 0;
  let min = Infinity;
  let max = -Infinity;
  let numericColumnId: string | null = null;
  let mixedColumns = false;
  let approximate = false;
  let stopped = false;

  for (const rect of rects) {
    if (stopped) break;
    const x1 = Math.min(rect.x + rect.width, colCount);
    const y1 = Math.min(rect.y + rect.height, rowCount);
    for (let y = Math.max(rect.y, 0); y < y1 && !stopped; y++) {
      for (let x = Math.max(rect.x, 0); x < x1; x++) {
        const key = y * colCount + x;
        if (seen?.has(key)) continue;
        if (visited === maxCells) {
          // cap reached: the first `maxCells` visited cells (holes included) are in, the rest is not read
          approximate = true;
          stopped = true;
          break;
        }
        seen?.add(key);
        visited += 1;
        const value = valueAt(y, x);
        if (value === undefined) continue;
        cells += 1;
        if (!isEmptyAt(x, value)) count += 1;
        if (typeof value === "number" && Number.isFinite(value)) {
          numeric += 1;
          const t = sum + value;
          compensation += Math.abs(sum) >= Math.abs(value) ? (sum - t) + value : (value - t) + sum;
          sum = t;
          if (value < min) min = value;
          if (value > max) max = value;
          const id = columnIdAt(x);
          if (numericColumnId === null) numericColumnId = id;
          else if (numericColumnId !== id) mixedColumns = true;
        }
      }
    }
  }

  const total = Number.isFinite(sum) ? sum + compensation : sum;
  return {
    cells,
    count,
    numeric,
    sum: numeric > 0 ? total : null,
    avg: numeric > 0 && Number.isFinite(total) ? total / numeric : null,
    min: numeric > 0 ? min : null,
    max: numeric > 0 ? max : null,
    numericColumnId: numeric > 0 && !mixedColumns ? numericColumnId : null,
    approximate,
  };
}
