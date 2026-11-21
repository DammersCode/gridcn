"use client";

import { memo, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { cn } from "@/lib/utils";
import { COLUMN_BORDER } from "../columns/column-border";
import { columnLabelText } from "../columns/column-format-helpers";
import { pinnedInsetStyle } from "../columns/pinned-inset-style";
import { keepsFocusOutsideGrid, SEARCH_MATCH_PAINT } from "../cell";
import { GRID_ATTR, GRID_ROLE_SELECTOR } from "../data-attributes";
import type { GroupLabelCtx, GroupNode } from "../group-types";
import { cellLayer } from "../layers";
import { useDataGridRootContext, type GridColumnLayout, type GroupLabelRenderer, type RenderedColumn } from "../layout-context";
import { colRangesContain } from "../selection/selected-col-ranges-for-row";
import {
  useDataGridCellTypes,
  useDataGridGroupRow,
  useDataGridLabels,
  useDataGridRowCellState,
  useDataGridSelector,
  useDataGridVisibleColumns,
  type AnyColumnDef,
} from "../store";
import { aggregateText, isPivotColumn, pivotCellOf } from "../store/pivot-view";
import type { RowMarkersMode } from "../types";
import { DataGridGroupToggle } from "./group-toggle";
import { DataGridGroupMarkerCell } from "./marker-cell";

/** Props for {@link DataGridGroupRow}. */
export type DataGridGroupRowProps = {
  viewRowIndex: number;
  renderedColumns: readonly RenderedColumn[];
  layout: GridColumnLayout;
  rowMarkers: RowMarkersMode;
  /** Forwarded to the row's own root div; body.tsx writes `gridRowStart` through it. */
  rowRef: Ref<HTMLDivElement>;
  getGridLine: (viewRowIndex: number) => number;
  /** Rows above the data rows beyond the first header row; shifts `aria-rowindex`. */
  ariaRowIndexOffset: number;
  /** Replaces the default label content. */
  renderGroupLabel?: GroupLabelRenderer;
};


/** How many visible columns the label covers: up to the first `aggregate` column, at least one. */
export function groupLabelSpan(columns: readonly Pick<AnyColumnDef, "aggregate">[]): number {
  const firstAggregate = columns.findIndex((column) => column.aggregate !== undefined);
  return Math.max(1, firstAggregate === -1 ? columns.length : firstAggregate);
}

// srgb mixes composite exactly like the translucent row tint and selection overlay they stand in for.
const GROUP_TINT = "bg-[color-mix(in_srgb,var(--color-muted)_40%,var(--color-background))] group-data-hovered/row:bg-[color-mix(in_srgb,var(--color-muted)_60%,var(--color-background))]";
// An unpinned label sits above the selection overlay, so it paints the overlay's tint itself.
const GROUP_LABEL_SELECTED_TINT =
  "data-[selected]:bg-[color-mix(in_srgb,var(--color-primary)_10%,color-mix(in_srgb,var(--color-muted)_40%,var(--color-background)))] group-data-hovered/row:data-[selected]:bg-[color-mix(in_srgb,var(--color-primary)_10%,color-mix(in_srgb,var(--color-muted)_60%,var(--color-background)))]";

const aggregateOf = (node: GroupNode, column: AnyColumnDef): unknown => (isPivotColumn(column) ? pivotCellOf(node, column) : node.aggregates[column.id]);

type GroupCellProps = {
  viewRowIndex: number;
  col: number;
  columnId: string;
  startTrack: number;
  span?: number;
  isActive: boolean;
  isSelected: boolean;
  isSearchMatch?: boolean;
  pin?: AnyColumnDef["pin"];
  className?: string;
  children?: ReactNode;
};

/** A group row cell: navigable and selectable, never editable. */
function GroupCell({ viewRowIndex, col, columnId, startTrack, span, isActive, isSelected, isSearchMatch, pin, className, children }: GroupCellProps): ReactNode {
  const { interaction } = useDataGridRootContext();
  const ref = useRef<HTMLDivElement>(null);
  const coord = useMemo(() => ({ col, row: viewRowIndex }), [col, viewRowIndex]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!isActive || !el) return;
    if (el.closest(GRID_ROLE_SELECTOR)?.hasAttribute(GRID_ATTR.settled) === false) return;
    if (!keepsFocusOutsideGrid(el.ownerDocument)) el.focus({ preventScroll: true });
  }, [isActive]);
  const style: CSSProperties = {
    gridColumn: span === undefined ? startTrack : `${startTrack} / span ${span}`,
    zIndex: span === undefined ? cellLayer(pin !== undefined, isActive) : cellLayer(true, isActive),
    ...pinnedInsetStyle(pin, col),
  };
  return (
    <div
      ref={ref}
      role="gridcell"
      aria-colindex={col + 1}
      aria-colspan={span}
      aria-readonly="true"
      aria-selected={isSelected || undefined}
      tabIndex={isActive ? 0 : -1}
      data-column-id={columnId}
      data-pinned={pin}
      data-active={isActive || undefined}
      data-search-match={isSearchMatch || undefined}
      data-readonly=""
      className={cn("relative flex items-center border-b border-border px-2 outline-none", COLUMN_BORDER, span === undefined && "overflow-hidden", className)}
      style={style}
      onPointerDown={(event) => interaction.onCellPointerDown(coord, event)}
      onClick={(event) => interaction.onCellClick(coord, event)}
    >
      {children}
    </div>
  );
}

/**
 * The view row that heads a row group: toggle, label, and one aggregate cell per column. A direct subgrid child of the canvas, like
 * {@link DataGridRow}; body.tsx writes `gridRowStart` through `rowRef`.
 */
export const DataGridGroupRow = memo(function DataGridGroupRow({
  viewRowIndex,
  renderedColumns,
  layout,
  rowMarkers,
  rowRef,
  getGridLine,
  ariaRowIndexOffset,
  renderGroupLabel,
}: DataGridGroupRowProps): ReactNode {
  const [initialGridLine] = useState(() => getGridLine(viewRowIndex));
  const meta = useDataGridGroupRow(viewRowIndex);
  const cellState = useDataGridRowCellState(viewRowIndex);
  const labels = useDataGridLabels();
  const locale = useDataGridSelector((s) => s.locale);
  const cellTypes = useDataGridCellTypes();
  const visibleColumns = useDataGridVisibleColumns();
  const pivot = useDataGridSelector((s) => s.pivot !== null);
  const columnHeader = useDataGridSelector((s) => {
    const column = s.columns.find((candidate) => candidate.id === meta?.node.columnId);
    return column ? columnLabelText(column) : (meta?.node.columnId ?? "");
  });
  if (!meta) return null;
  const { node, expanded, expandable } = meta;
  const markerColOffset = layout.markerWidth > 0 ? 2 : 1;
  const span = Math.min(groupLabelSpan(visibleColumns), visibleColumns.length);
  const labelText = node.label || labels.grouping.empty;
  const ctx: GroupLabelCtx = { groupId: node.id, columnId: node.columnId, key: node.key, label: labelText, count: node.count, depth: node.depth, expanded };
  const labelActive = cellState.activeCol !== null && cellState.activeCol < span;
  const labelRangeSelected = cellState.selectedColRanges.some(([start]) => start < span);
  const labelSelected = labelActive || labelRangeSelected;
  const labelPinned = visibleColumns[0]?.pin !== undefined;
  return (
    <div
      ref={rowRef}
      role="row"
      aria-rowindex={viewRowIndex + 2 + ariaRowIndexOffset}
      aria-level={meta.level}
      aria-expanded={expandable ? expanded : undefined}
      aria-posinset={meta.posInSet}
      aria-setsize={meta.setSize}
      data-grid-row-index={viewRowIndex}
      data-grid-group-row=""
      data-group-depth={node.depth}
      className="group/row bg-muted/40 font-medium data-hovered:bg-muted/60"
      style={{ display: "grid", gridTemplateColumns: "subgrid", gridColumn: "1 / -1", gridRowStart: initialGridLine }}
    >
      {rowMarkers !== "none" && <DataGridGroupMarkerCell />}
      <GroupCell
        viewRowIndex={viewRowIndex}
        col={0}
        columnId={visibleColumns[0]?.id ?? node.columnId}
        startTrack={markerColOffset}
        span={span}
        isActive={labelActive}
        isSelected={labelSelected}
      >
        <span
          data-grid-group-label=""
          style={{ paddingInlineStart: `calc(var(--grid-group-indent, 1rem) * ${node.depth})`, insetInlineStart: "var(--grid-scroll-left, 0px)" }}
          data-selected={(labelRangeSelected && !labelPinned) || undefined}
          className={cn("relative flex min-w-0 items-center gap-1", GROUP_TINT, GROUP_LABEL_SELECTED_TINT)}
        >
          {expandable && <DataGridGroupToggle groupId={node.id} label={labelText} expanded={expanded} />}
          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
            {renderGroupLabel ? renderGroupLabel(ctx) : labels.grouping.rowLabel(columnHeader, labelText, node.count)}
          </span>
        </span>
      </GroupCell>
      {renderedColumns.map(({ column, index }) => {
        if (index < span) return null;
        const isActive = cellState.activeCol === index;
        const pinned = column.pin !== undefined;
        return (
          <GroupCell
            key={column.id}
            viewRowIndex={viewRowIndex}
            col={index}
            columnId={column.id}
            startTrack={index + markerColOffset}
            isActive={isActive}
            isSelected={isActive || colRangesContain(cellState.selectedColRanges, index)}
            isSearchMatch={pivot && !pinned && (cellState.searchMatchCols?.has(index) ?? false)}
            pin={column.pin}
            className={cn(
              cellTypes[column.type ?? "text"]?.numeric === true && "justify-end tabular-nums",
              pinned ? GROUP_TINT : pivot && SEARCH_MATCH_PAINT,
            )}
          >
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{column.aggregate === undefined ? null : aggregateText(column, aggregateOf(node, column), cellTypes, locale)}</span>
          </GroupCell>
        );
      })}
    </div>
  );
});
