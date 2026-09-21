"use client";

import { useCallback, useMemo, type CSSProperties, type ReactNode } from "react";
import { useDataGridRootContext } from "./layout-context";
import {
  useDataGridActions,
  useDataGridColumnFeatureFlags,
  useDataGridHeaderClickBehavior,
  useDataGridRowMarkers,
  useDataGridSortState,
} from "./store";
import { DataGridMarkerHeader } from "./rows/marker-header";
import { DataGridHeaderCell } from "./header-cell";
import { useColumnReorder } from "./columns/use-column-reorder";
import { pinnedInsetStyle } from "./columns/pinned-inset-style";
import { GRID_LAYER } from "./layers";
import { isInlineStartHalf } from "./windowing/direction";

/**
 * Header layer: absolutely positioned inside the sticky Viewport, counter-translated
 * horizontally by the live scroll var so it tracks the canvas 1:1 without ever moving via native
 * scroll. Renders only the windowed column set (same window the body consumes).
 *
 * Data-column grid placement is `index + markerColOffset` (1-based `gridColumnStart`): the marker
 * column (when present) occupies track 1, so every data column shifts one track right. `index`
 * itself, `aria-colindex`, and `aria-colcount` (set on the grid root) are all untouched by this —
 * the marker carries no `aria-colindex` at all and sits outside the data header's a11y column
 * count (chosen over shifting every data cell's aria-colindex by one).
 */
export function DataGridHeader(): ReactNode {
  const { scrollRef, windowedColumns, template, layout, headerHeight, interaction, direction, renderHeaderMenu } = useDataGridRootContext();
  const rowMarkers = useDataGridRowMarkers();
  const actions = useDataGridActions();
  const sortState = useDataGridSortState();
  const headerClickBehavior = useDataGridHeaderClickBehavior();
  const { enableColumnResize, enableColumnReorder } = useDataGridColumnFeatureFlags();
  const markerColOffset = layout.markerWidth > 0 ? 2 : 1;

  /** Resolves the header cell (and before/after half) under a client point, for the reorder drag's live drop target. */
  const hitTestHeader = useCallback(
    (clientX: number, clientY: number) => {
      const el = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[role='columnheader'][data-column-id]");
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      // guaranteed present: the closest() selector above only matches elements with [data-column-id]
      const columnId = el.dataset["columnId"]!;
      // "before"/"after" stay logical (reading order): the inline-START half is "before" in both
      // directions, which under RTL is the header's physical RIGHT half.
      const position: "before" | "after" = isInlineStartHalf(clientX, rect, direction) ? "before" : "after";
      return { columnId, position };
    },
    [direction],
  );

  const isColumnReorderable = useCallback(
    (columnId: string) => windowedColumns.some(({ column }) => column.id === columnId && column.reorderable !== false),
    [windowedColumns],
  );

  const { onHeaderDragPointerDown, dragState } = useColumnReorder({
    enabled: enableColumnReorder,
    isColumnReorderable,
    hitTestHeader,
    onReorder: actions.setColumnOrder,
    onArm: interaction.cancelColumnSelectDrag,
  });

  /**
   * Single drop-indicator line at the reorder drag's current boundary. Grid-placed on the boundary
   * column's own track: an unpinned column gets raw track coords (the header layer already
   * translates by -scrollLeft), a pinned boundary column reuses the exact pinned-cell offset,
   * so the line lands at the cell's rendered edge either way.
   */
  const dropIndicator = useMemo<{ index: number; style: CSSProperties } | null>(() => {
    if (!dragState?.overId) return null;
    const over = windowedColumns.find(({ column }) => column.id === dragState.overId);
    if (!over) return null;
    const { column, index } = over;
    const width = layout.widths[index];
    const pinStyle = pinnedInsetStyle(column.pin, index);
    // unpinned: the div is grid-placed on the boundary column's own track (raw track coords, like
    // any other header cell), so its local left edge is 0 — "after" just adds the column's width.
    // pinned: pinnedInsetStyle's insetInlineStart already lands this div at the pinned cell's own
    // rendered left edge (same track, same formula) — "after" shifts that by the column's width too.
    const insetInlineStart =
      dragState.position === "before"
        ? (pinStyle.insetInlineStart ?? 0)
        : pinStyle.insetInlineStart
          ? `calc(${pinStyle.insetInlineStart} + ${width}px)`
          : width;
    const style: CSSProperties = {
      gridRowStart: 1,
      gridColumnStart: index + markerColOffset,
      position: "relative",
      insetBlockStart: 0,
      insetInlineStart,
      height: "100%",
      width: 2,
      zIndex: GRID_LAYER.header,
      pointerEvents: "none",
      backgroundColor: "var(--color-primary)",
    };
    return { index, style };
  }, [dragState, windowedColumns, layout.widths, markerColOffset]);

  const layerStyle: CSSProperties = {
    position: "absolute",
    insetBlockStart: 0,
    insetInlineStart: 0,
    display: "grid",
    gridTemplateColumns: template,
    gridAutoRows: headerHeight,
    // stacking context (transform) painted after the rows canvas in DOM order; without an explicit
    // z-index the canvas's own stacking context wins paint order and buries the header on scroll.
    zIndex: GRID_LAYER.pinnedHeader,
    // header never moves vertically — only the canvas does — so only the horizontal term applies here.
    // --grid-dir signs it for RTL (see body.tsx's canvas transform for the full reasoning).
    transform: "translate3d(calc(var(--grid-dir, -1) * var(--grid-scroll-left, 0px)), 0, 0)",
  };
  return (
    <div role="row" style={layerStyle} data-grid-header-layer="">
      {layout.markerWidth > 0 && <DataGridMarkerHeader mode={rowMarkers} headerHeight={headerHeight} />}
      {windowedColumns.map(({ column, index }) => (
        <DataGridHeaderCell
          key={column.id}
          column={column}
          index={index}
          width={layout.widths[index]!} // index is a real index into columns; layout.widths is columns.map(...), same length
          gridColOffset={markerColOffset}
          headerClickBehavior={headerClickBehavior}
          sortState={sortState}
          resize={{
            enabled: enableColumnResize,
            scrollRootRef: scrollRef,
            setColumnWidth: actions.setColumnWidth,
            commitColumnWidth: actions.commitColumnWidth,
            direction,
          }}
          reorder={{
            enabled: enableColumnReorder,
            state: dragState,
            onPointerDown: onHeaderDragPointerDown,
          }}
          onSelect={interaction.onHeaderPointerDown}
          onSort={actions.toggleSort}
          renderHeaderMenu={renderHeaderMenu}
        />
      ))}
      {dragState && dropIndicator && <div data-grid-drop-indicator="" aria-hidden="true" style={dropIndicator.style} />}
    </div>
  );
}
