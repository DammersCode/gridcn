"use client";

import { useEffect, useState } from "react";
import {
  getCellValue,
  useDataGridCellTypes,
  useDataGridSelection,
  useDataGridViewIndex,
  useDataGridVisibleColumns,
  type AnyColumnDef,
} from "@/registry/default/blocks/data-grid/data-grid";
import { selectionRects, useDataGridSelector } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { computeSelectionStats, EMPTY_SELECTION_STATS, type SelectionStats } from "./compute-selection-stats";

/** Total rect area up to which the walk runs at once; above it, the settle timer defers it. */
export const IMMEDIATE_SELECTION_CELL_LIMIT = 5_000;
/** Trailing delay in ms before a large selection's walk runs, after the last selection change. */
export const SELECTION_STATS_SETTLE_MS = 150;

/**
 * Aggregates (count, sum, avg, min, max) over the selected cells, recomputed after the selection
 * settles: at once for up to {@link IMMEDIATE_SELECTION_CELL_LIMIT} cells, else on a
 * {@link SELECTION_STATS_SETTLE_MS} ms trailing timer. Stops at `MAX_STATUS_CELLS` and flags
 * `approximate`. See {@link computeSelectionStats} for the field semantics.
 */
export function useDataGridSelectionStats(): SelectionStats {
  const selection = useDataGridSelection();
  const viewIndex = useDataGridViewIndex();
  const visibleColumns = useDataGridVisibleColumns();
  const cellTypes = useDataGridCellTypes();
  const data = useDataGridSelector((s) => s.data);
  const [stats, setStats] = useState(EMPTY_SELECTION_STATS);

  useEffect(() => {
    const columns = visibleColumns as readonly AnyColumnDef[];
    const rects = selectionRects(selection, viewIndex.length, columns.length);
    let area = 0;
    for (const rect of rects) area += rect.width * rect.height;
    if (area === 0) {
      setStats(EMPTY_SELECTION_STATS);
      return;
    }
    const compute = () => {
      setStats(
        computeSelectionStats({
          rects,
          rowCount: viewIndex.length,
          colCount: columns.length,
          valueAt: (viewRow, viewCol) => {
            const dataRow = viewIndex[viewRow];
            const row = dataRow === undefined ? undefined : data[dataRow];
            if (row === undefined) return undefined;
            return getCellValue<unknown, AnyColumnDef>(row, columns[viewCol]!);
          },
          isEmptyAt: (viewCol, value) => {
            const column = columns[viewCol]!;
            const cellType = cellTypes[column.type ?? "text"] ?? cellTypes["text"]!;
            return cellType.isEmpty(value);
          },
          columnIdAt: (viewCol) => columns[viewCol]!.id,
        }),
      );
    };
    // ponytail: rect area is an upper bound on the union, so overlapping selections can defer to
    // the timer with a small real walk; an exact union count would cost the walk itself.
    if (area <= IMMEDIATE_SELECTION_CELL_LIMIT) {
      compute();
      return;
    }
    const timer = window.setTimeout(compute, SELECTION_STATS_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [selection, viewIndex, visibleColumns, cellTypes, data]);

  return stats;
}
