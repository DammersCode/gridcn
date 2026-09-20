"use client";

import { memo, type PointerEvent as ReactPointerEvent, type Ref } from "react";
import { cn } from "@/lib/utils";
import { useDataGridRow, useDataGridRowCellState } from "./store";
import { colRangesContain } from "./selection/selected-col-ranges-for-row";
import { DataGridCell } from "./cell";
import { DataGridMarkerCell } from "./rows/marker-cell";
import type { ColumnLayout, WindowedColumn } from "./layout-context";
import type { GetCellClassName, GetRowClassName, OnCellClick, OnRowClick, RowMarkersMode } from "./types";

export type DataGridRowProps = {
  viewRowIndex: number;
  windowedColumns: readonly WindowedColumn[];
  layout: ColumnLayout;
  readOnly?: boolean;
  /** 'none' renders no marker cell for this row. */
  rowMarkers: RowMarkersMode;
  onMarkerPointerDown: (viewRowIndex: number, event: ReactPointerEvent<HTMLElement>) => void;
  /** Attach to the marker's checkbox pointerdown ('checkbox'/'both' modes) — see use-grid-interaction.ts' onMarkerCheckboxPointerDown. */
  onMarkerCheckboxPointerDown: (viewRowIndex: number, event: ReactPointerEvent<HTMLElement>) => void;
  /** Forwarded to the row's own root div — body.tsx uses it to write `gridRowStart` imperatively (see below). */
  rowRef: Ref<HTMLDivElement>;
  /** Pinned-top row count (a11y index layout: header=1, pinned-top next, then data, pinned-bottom last) — shifts `aria-rowindex` past the pinned-top band; 0 when there is none. */
  ariaRowIndexOffset: number;
  /** Row class hook; stable identity (root's dev guardrail) so this memoized row's props stay shallow-equal across ticks. */
  getRowClassName?: GetRowClassName<unknown>;
  /** Forwarded to each cell; see {@link DataGridRowProps.getRowClassName}. */
  getCellClassName?: GetCellClassName<unknown>;
  /** Forwarded to each cell's click handler; stable identity, same guidance as `getCellClassName`. */
  onCellClick?: OnCellClick<unknown>;
  /** Forwarded to each cell; fired alongside `onCellClick` once per click. */
  onRowClick?: OnRowClick<unknown>;
};

/**
 * A window shift moves EVERY surviving row's canvas slot by the shift amount — gridRowStart
 * (viewRowIndex - windowStart + 1) changes for all mounted rows, not just the ones that
 * entered/left — so `windowStart` was never a prop this component could shallow-compare away no
 * matter what body.tsx precomputed; it's a genuine per-tick input to every row's position.
 * Subgrid (`gridTemplateColumns: "subgrid"`, rows as direct grid children) also rules out
 * absolute-positioning — a positioning wrapper around the row breaks the subgrid column tracks.
 *
 * Fix: `windowStart` doesn't reach this component at all anymore. It never renders `gridRowStart`
 * itself — body.tsx (which already re-renders every window tick regardless) collects each row's DOM
 * node via `rowRef` and writes `gridRowStart` straight into `style.gridRowStart` in a `useLayoutEffect`
 * that runs after every body render, entirely outside React's props/state for this component. That
 * keeps `DataGridRow`'s memo props limited to things that only change when the row's actual content
 * should re-render (viewRowIndex swap on identity reuse, column window, readOnly, etc).
 */
export const DataGridRow = memo(function DataGridRow({
  viewRowIndex,
  windowedColumns,
  layout,
  readOnly,
  rowMarkers,
  onMarkerPointerDown,
  onMarkerCheckboxPointerDown,
  rowRef,
  ariaRowIndexOffset,
  getRowClassName,
  getCellClassName,
  onCellClick,
  onRowClick,
}: DataGridRowProps) {
  const row = useDataGridRow(viewRowIndex);
  // ONE subscription for the whole row's interactive cell state (not one per cell). Referentially
  // stable across ticks that don't touch this row (see useDataGridRowCellState's comparator), so
  // this memoized row only re-renders when its own active/editing/search/selection state changed.
  const cellState = useDataGridRowCellState(viewRowIndex);
  // marker column occupies grid track 1 when present, so every data column shifts one track right
  const markerColOffset = layout.markerWidth > 0 ? 2 : 1;
  // A hole in `data` (lazy loading): row.tsx renders skeleton cells instead of empty ones.
  // `row` flipping undefined->defined is an ordinary content change under the row's
  // existing memo/subscription contract (useDataGridRow re-renders on that identity change like
  // any other row edit) — no extra state or subscription needed for the transition itself.
  const isSkeleton = row === undefined;
  return (
    <div
      ref={rowRef}
      role="row"
      aria-rowindex={viewRowIndex + 2 + ariaRowIndexOffset}
      data-grid-row-index={viewRowIndex}
      aria-busy={isSkeleton || undefined}
      // named group so row hover reveals a bg tint on its cells via CSS only — never React state.
      className={cn("group/row", getRowClassName?.(row, viewRowIndex))}
      style={{
        display: "grid",
        gridTemplateColumns: "subgrid",
        gridColumn: "1 / -1",
        // gridRowStart is intentionally absent here — body.tsx writes it imperatively (see doc
        // comment above) so a window shift never touches this component's render inputs.
      }}
    >
      {rowMarkers !== "none" && (
        // marker column still shows the row number for a skeleton row — it's index-derived, not read from `row`.
        <DataGridMarkerCell
          mode={rowMarkers}
          viewRowIndex={viewRowIndex}
          onPointerDown={onMarkerPointerDown}
          onCheckboxPointerDown={onMarkerCheckboxPointerDown}
        />
      )}
      {windowedColumns.map(({ column, index }) => {
        const isActive = cellState.activeCol === index;
        const isEditing = cellState.editingCol === index;
        return (
          <DataGridCell
            key={column.id}
            row={row}
            rowIndex={viewRowIndex}
            column={column}
            columnIndex={index}
            gridColOffset={markerColOffset}
            gridReadOnly={readOnly}
            getCellClassName={getCellClassName}
            onCellClick={onCellClick}
            onRowClick={onRowClick}
            isActive={isActive}
            isEditing={isEditing}
            initialText={isEditing ? cellState.editingInitialText : undefined}
            isSearchMatch={cellState.searchMatchCols?.has(index) ?? false}
            isSelected={isActive || colRangesContain(cellState.selectedColRanges, index)}
            isSkeleton={isSkeleton}
            cellError={cellState.errorCols?.get(index) ?? null}
          />
        );
      })}
    </div>
  );
});
