"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { DataGridCell, type GridColumnLayout, type WindowedColumn } from "@/registry/default/blocks/data-grid/data-grid";

export type DataGridPinnedRowProps = {
  /** The consumer-supplied pinned row object (from `useDataGridPinnedRows`'s `topRows`/`bottomRows` options — never a member of `data`). */
  row: unknown;
  /** Position within its own band, 0-based — used only for the `data-grid-pinned-row-index` marker, never `CellCoord`/`aria-colindex` (pinned rows aren't in the data index space). */
  bandIndex: number;
  windowedColumns: readonly WindowedColumn[];
  layout: GridColumnLayout;
  gridRowStart: number;
  /** Root's aria index layout: header=1, pinned-top next, then data rows, pinned-bottom last. */
  ariaRowIndex: number;
  className?: string;
};

/**
 * A pinned top/bottom band row: reuses
  * `DataGridCell` in its `pinnedRow` mode for identical cell-type rendering/alignment/column tracks as
 * data rows, but bypasses `DataGridRow`'s `useDataGridRow(viewRowIndex)` store lookup entirely —
 * pinned rows are a separate array the consumer supplies to `useDataGridPinnedRows`, not indices
 * into `data`/`viewIndex`, so they never sort, filter, or participate in range selection or the
 * rows-channel (documented v1 scope). Not memoized like `DataGridRow`: pinned bands are always
 * fully rendered (never windowed/virtualized — a handful of totals/frozen rows, not tens of
 * thousands), so there's no window-shift-driven re-render pressure to protect against.
 */
export function DataGridPinnedRow(props: DataGridPinnedRowProps): ReactNode {
  const { row, bandIndex, windowedColumns, layout, gridRowStart, ariaRowIndex, className } = props;
  const markerColOffset = layout.markerWidth > 0 ? 2 : 1;
  return (
    <div
      role="row"
      aria-rowindex={ariaRowIndex}
      data-grid-pinned-row-index={bandIndex}
      className={cn("group/row", className)}
      style={{
        display: "grid",
        gridTemplateColumns: "subgrid",
        gridColumn: "1 / -1",
        gridRowStart,
      }}
    >
      {windowedColumns.map(({ column, index }) => (
        <DataGridCell
          key={column.id}
          row={row}
          rowIndex={bandIndex}
          column={column}
          columnIndex={index}
          gridColOffset={markerColOffset}
          pinnedRow
        />
      ))}
    </div>
  );
}
