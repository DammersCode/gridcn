"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { DataGridCell, useDataGridSelector, type DataGridStoreState } from "@/registry/default/blocks/data-grid/data-grid";
import type { GridColumnLayout, WindowedColumn } from "@/registry/default/blocks/data-grid/data-grid-sdk";

export type DataGridPinnedRowProps = {
  /** The band this row belongs to; part of the fallback row id. */
  position: "top" | "bottom";
  /** The consumer-supplied pinned row object (from `useDataGridPinnedRows`'s `topRows`/`bottomRows` options — never a member of `data`). */
  row: unknown;
  /** Position within its own band, 0-based — the `data-grid-pinned-row-index` marker and the `getRowId` index argument of the row's resolved id; never `ViewCoord`/`aria-colindex` (pinned rows aren't in the data index space). */
  bandIndex: number;
  windowedColumns: readonly WindowedColumn[];
  layout: GridColumnLayout;
  gridRowStart: number;
  /** Root's aria index layout: header=1, pinned-top next, then data rows, pinned-bottom last. */
  ariaRowIndex: number;
  className?: string;
};

function resolvePinnedRowId(getRowId: DataGridStoreState["getRowId"], row: unknown, bandIndex: number, position: "top" | "bottom"): string {
  let id: unknown;
  try {
    id = getRowId(row, bandIndex);
  } catch {
    id = undefined;
  }
  return typeof id === "string" && id !== "" ? id : `__pinned-${position}-${bandIndex}`;
}

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
  const { position, row, bandIndex, windowedColumns, layout, gridRowStart, ariaRowIndex, className } = props;
  const getRowId = useDataGridSelector((s) => s.getRowId);
  // Pinned rows such as aggregates often carry no id, so a throwing or empty getRowId falls back to a band id.
  const rowId = resolvePinnedRowId(getRowId, row, bandIndex, position);
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
          rowId={rowId}
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
