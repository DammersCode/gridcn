"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  useDataGridActions,
  useDataGridInternalActions,
  useDataGridActiveCell,
  useDataGridReadOnly,
  useDataGridRowCount,
  useDataGridRowIds,
  useDataGridRowMarkers,
  useDataGridRowReorderEnabled,
  useDataGridStoreApi,
  type AnyColumnDef,
} from "./store";
import { useRowWindow } from "./virtualization/use-row-window";
import { useCanvasOffset } from "./virtualization/use-scroll-snapshot";
import { useDataGridRootContext, type RenderedColumn } from "./layout-context";
import { DataGridRow } from "./row";
import { DataGridOverlays } from "./overlays";
import { predictBlockTarget, useRowReorder } from "./rows/use-row-reorder";
import { CompactSelection } from "./selection";
import type { CompactSelectionLike } from "./types";
import { isReorderMarkerMode } from "./rows/marker-width";
import { FLASH_KEYFRAMES } from "./cell";
import { createRowElementRegistry } from "./row-element-registry";
import { GRID_LAYER } from "./layers";
import { gridAttrSelector } from "./data-attributes";
import { isDev } from "./is-dev";
import { LiveRegion } from "./live-region";

/** Real-index `[min, max+1)` bounds of the currently rendered UNPINNED columns.
 * Overlay segmentation clamps its unpinned segment to this, so it never reaches off-screen track
 * positions the virtualized window did not render. An empty window collapses to a zero-width range. */
function unpinnedWindowRange(
  renderedColumns: readonly RenderedColumn[],
  pins: readonly (AnyColumnDef["pin"] | undefined)[],
): { start: number; end: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const { index } of renderedColumns) {
    if (pins[index] !== undefined) continue;
    if (index < min) min = index;
    if (index > max) max = index;
  }
  return Number.isFinite(min) ? { start: min, end: max + 1 } : { start: 0, end: 0 };
}

let warnedRowCountMismatch = false;

/** Dev-only: warn once when the rendered row set is not exactly the virtualized range plus the off-window active row. */
function warnRowCountMismatch(indicesLength: number, expected: number, start: number, end: number, activeRowOffWindow: boolean): void {
  if (indicesLength === expected || warnedRowCountMismatch) return;
  warnedRowCountMismatch = true;
  console.warn(
    `gridcn: rendered row count (${indicesLength}) does not match the expected window size (${expected}) — start=${start} end=${end} activeRowOffWindow=${activeRowOffWindow}.`,
  );
}

// Firefox gives an element taller than about 17.9 million px a height of 0; Chromium clamps at 33.5 million.
const BROWSER_HEIGHT_LIMIT_WARN_PX = 17_800_000;
const CHROMIUM_HEIGHT_LIMIT_PX = 33_554_400;

function warnHeightLimit(rowCount: number, rowHeight: number): void {
  // Two significant digits, so a large row height still names a nonzero row count.
  const roundDown = (px: number) => {
    const rows = Math.floor(px / rowHeight);
    const step = 10 ** Math.max(0, Math.floor(Math.log10(Math.max(rows, 1))) - 1);
    return Math.floor(rows / step) * step;
  };
  const firefoxRows = roundDown(BROWSER_HEIGHT_LIMIT_WARN_PX);
  const chromiumRows = roundDown(CHROMIUM_HEIGHT_LIMIT_PX);
  console.warn(
    `gridcn: ${rowCount} rows at ${rowHeight}px need ${rowCount * rowHeight}px of scroll height, which is above the browser height limit (about 17.9 million px in Firefox, 33.5 million px in Chromium). Firefox shows no scroll range above about ${firefoxRows.toLocaleString("en-US")} rows at this row height. Chromium cannot reach the rows past about ${chromiumRows.toLocaleString("en-US")}. See the virtualization docs page.`,
  );
}

/** First child of the rows canvas: its layout effect runs before the row cells', so child effects and measurements see the canvas at its final offset. */
// The scroll element arrives as a prop: a memoized anchor re-renders when it attaches.
function CanvasOffsetAnchor({ scrollElement, baseOffset }: { scrollElement: HTMLElement | null; baseOffset: number }): ReactNode {
  const anchorRef = useRef<HTMLStyleElement>(null);
  useCanvasOffset(scrollElement, anchorRef, baseOffset);
  return <style ref={anchorRef}>{FLASH_KEYFRAMES}</style>;
}

/** Props for {@link DataGridBody}. */
export type DataGridBodyProps = {
  /** Merged onto the rows-canvas element (the transformed canvas holding the virtualized rows and overlays, not the scroll root). */
  className?: string;
};

const GRID_ORIGIN_MARGIN_ROWS = 96;

/** Renders only the virtualized rows for the current scroll position, plus the active row so focus survives scrolling it out of view. */
export function DataGridBody({ className }: DataGridBodyProps): ReactNode {
  const {
    scrollRef,
    renderedColumns,
    rowHeight,
    headerHeight,
    headerRowCount,
    pinnedTopHeight,
    pinnedBottomHeight,
    pinnedTopCount,
    template,
    layout,
    interaction,
    getRowClassName,
    getCellClassName,
    renderMarker,
  } = useDataGridRootContext();
  const readOnly = useDataGridReadOnly();
  const storeApi = useDataGridStoreApi();
  const rowMarkers = useDataGridRowMarkers();
  const rowCount = useDataGridRowCount();
  const activeCell = useDataGridActiveCell();
  // Data row 0 starts below the header AND any pinned-top band (shrunken effective viewport);
  // the pinned-bottom band shrinks the window's bottom edge the same way.
  const effectiveHeaderHeight = headerHeight + pinnedTopHeight;
  const { start, end, windowTop, measured, element: scrollElement } = useRowWindow(scrollRef, {
    rowCount,
    rowHeight,
    dataRowTop: effectiveHeaderHeight,
    bottomInset: pinnedBottomHeight,
  });

  const warnedHeightLimitRef = useRef(false);
  useEffect(() => {
    if (warnedHeightLimitRef.current || !isDev() || rowCount * rowHeight <= BROWSER_HEIGHT_LIMIT_WARN_PX) return;
    warnedHeightLimitRef.current = true;
    warnHeightLimit(rowCount, rowHeight);
  }, [rowCount, rowHeight]);

  // Fires post-commit, never during render — DataGridBody already re-renders every window tick
  // regardless (it calls useRowWindow directly), so this adds no extra subscription and can't
  // affect the single-flushSync-per-tick scroll commit (the effect runs after that commit, on its
  // own microtask-free schedule). Gated on [start, end] identity so it fires once on mount and
  // again only when the committed range actually moved, never on a same-window scroll tick.
  //
  // `!measured` skips the pre-heal render: useRowWindow heals the no-element fallback to the real
  // window in a pre-paint layout-effect flush, so the fixed {0, min(rowCount,30)} fallback and the
  // real window are two distinct committed ranges; without this guard this fired on both on every
  // mount — the fallback is never a range a consumer (e.g. data-grid-lazy's fetch-on-window)
  // should act on in the first place.
  // The callback is read off the store at fire time (not a dep), so an identity change never re-fires it — only a range change does.
  const lastFiredRangeRef = useRef<{ start: number; end: number } | null>(null);
  useEffect(() => {
    if (!measured) return;
    const last = lastFiredRangeRef.current;
    if (last && last.start === start && last.end === end) return;
    lastFiredRangeRef.current = { start, end };
    storeApi.getState().onRenderedRowsChange?.({ start, end });
  }, [start, end, measured, storeApi]);

  // A naive "clear then repopulate" would blank the body for a frame on every window shift.
  // Rows are keyed by getRowId and mapped straight from viewRowIndices, so keyed reconciliation
  // unmounts only the rows that left the range and mounts only the rows that entered it; the
  // rows common to both windows never unmount.
  const viewRowIndices = useMemo(() => {
    const indices: number[] = [];
    for (let i = start; i < end; i++) indices.push(i);
    // the active row always renders, even off-window, so focus survives scroll
    const activeRowOffWindow = activeCell !== null && (activeCell.row < start || activeCell.row >= end) && activeCell.row < rowCount;
    if (activeRowOffWindow) indices.push(activeCell.row);

    // Dev-only invariant: the rendered set must be exactly computeWindow's [start,end) plus the
    // off-window active row, never more/fewer — catches a regression that silently drops or
    // duplicates rows.
    if (isDev()) {
      const expected = end - start + (activeRowOffWindow ? 1 : 0);
      warnRowCountMismatch(indices.length, expected, start, end, activeRowOffWindow);
    }
    return indices;
  }, [start, end, activeCell, rowCount]);

  // Rows are memoized by getRowId, not viewRowIndex, so sort/filter/insert/delete reuses the right DOM row.
  const rowIds = useDataGridRowIds(viewRowIndices);

  // Keyed by getRowId (the row's own React key), so a row kept across a shift is found by
  // identity, not array position. Separate module: the render-time callback lookup reads Maps —
  // a ref read in render bails the React Compiler (see row-element-registry.ts).
  const rowRegistry = useMemo(() => createRowElementRegistry(), []);

  // Rows place at gridRowStart = viewRowIndex - gridOrigin + 1. The origin trails the window and
  // only rebases once the window drifts out of its band, so a small window shift leaves surviving
  // rows untouched (an inline-style write restyles the whole row). The canvas translate absorbs the offset.
  const [originBase, setOriginBase] = useState(0);
  const rebaseOrigin = start < originBase || start - originBase > 2 * GRID_ORIGIN_MARGIN_ROWS;
  const rebasedOrigin = Math.max(0, start - GRID_ORIGIN_MARGIN_ROWS);
  if (rebaseOrigin) setOriginBase(rebasedOrigin);
  const trailingOrigin = rebaseOrigin ? rebasedOrigin : originBase;

  // An active row just above the origin extends the origin down to it; the canvas translate absorbs that.
  const gridOrigin = activeCell ? Math.max(Math.min(trailingOrigin, activeCell.row), trailingOrigin - GRID_ORIGIN_MARGIN_ROWS) : trailingOrigin;
  const effectiveWindowTop = windowTop - (start - gridOrigin) * rowHeight;
  // Firefox clamps grid lines to 10,000, so a far off-window active row parks at an off-screen line
  // at least a margin away from the window instead of its true one.
  const lastGridLine = end - gridOrigin + GRID_ORIGIN_MARGIN_ROWS;
  const gridLine = (viewRowIndex: number) => Math.min(Math.max(viewRowIndex - gridOrigin + 1, 1), lastGridLine);
  rowRegistry.setLineBounds(gridOrigin, lastGridLine);

  // Drag-to-reorder rows: one shared instance for the whole body (one indicator, one gesture),
  // mirroring how DataGridHeader owns useColumnReorder for its headers.
  const actions = useDataGridActions();
  const internalActions = useDataGridInternalActions();
  const rowReorderEnabled = useDataGridRowReorderEnabled();
  // the gesture lives on the marker's reorder family only — plain number/checkbox/both markers
  // stay pure row-select surfaces (see RowMarkersMode), so a selection drag never reorders.
  const rowReorderArmed = rowReorderEnabled && isReorderMarkerMode(rowMarkers);
  /** Resolves the data row (and its above/below half) under a client point, for the reorder drag's live drop target. */
  const hitTestRow = useCallback((clientX: number, clientY: number) => {
    const el = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>(`[role="row"]${gridAttrSelector("rowIndex")}`);
    if (!el) return null;
    const row = Number(el.dataset["gridRowIndex"]);
    if (!Number.isFinite(row)) return null;
    const rect = el.getBoundingClientRect();
    const position: "before" | "after" = clientY < rect.top + rect.height / 2 ? "before" : "after";
    return { row, position };
  }, []);

  const onRowReorder = useCallback(
    (dragged: CompactSelectionLike, over: number, position: "before" | "after") => {
      const rows = dragged.toArray();
      actions.reorderRows(rows, predictBlockTarget(rows, over, position));
    },
    [actions],
  );

  const getDragRows = useCallback(
    (pressedRow: number) => {
      const checked = storeApi.getState().selection.rows;
      return checked.hasIndex(pressedRow) ? checked : CompactSelection.fromSingleSelection(pressedRow);
    },
    [storeApi],
  );

  const rowReorder = useRowReorder({
    enabled: rowReorderArmed,
    hitTestRow,
    onReorder: onRowReorder,
    getDragRows,
    getScrollElement: () => scrollRef.current,
  });

  // The single row-reorder drop-indicator line, grid-placed on the boundary row's track in the
  // canvas (same coordinate math as the rows' own imperative gridRowStart writes).
  const rowDropIndicator = useMemo<CSSProperties | null>(() => {
    const drag = rowReorder.dragState;
    if (!drag || drag.overRow === null) return null;
    const boundary = drag.position === "before" ? drag.overRow : drag.overRow + 1;
    return {
      gridRowStart: boundary - gridOrigin + 1,
      gridColumn: "1 / -1",
      position: "relative",
      alignSelf: "start",
      height: 2,
      zIndex: GRID_LAYER.overlay,
      pointerEvents: "none",
      backgroundColor: "var(--color-primary)",
    };
  }, [rowReorder.dragState, gridOrigin]);

  // Writes gridRowStart straight into each row's DOM node, bypassing React for this value.
  // The body re-renders every window tick anyway, so the write costs nothing extra, and
  // DataGridRow stays memoized without windowStart in its props.
  useLayoutEffect(() => {
    for (let i = 0; i < viewRowIndices.length; i++) {
      // i < viewRowIndices.length by loop condition
      const viewRowIndex = viewRowIndices[i]!;
      const key = rowIds[i] ?? viewRowIndex;
      const el = rowRegistry.elements.get(key);
      const value = String(gridLine(viewRowIndex));
      if (el && el.style.gridRowStart !== value) el.style.gridRowStart = value;
    }
  });

  // Drop flash keys whose rows left the rendered window — a remounted cell would otherwise replay
  // its one-shot pulse on scroll-back while the key is still live (the pulse is viewport-scoped by design).
  useEffect(() => {
    if (!measured) return;
    internalActions._pruneFlashingCells(viewRowIndices);
  }, [measured, viewRowIndices, internalActions]);

  const canvasBaseOffset = effectiveWindowTop + effectiveHeaderHeight;

  const canvasStyle: CSSProperties = {
    position: "absolute",
    insetBlockStart: 0,
    insetInlineStart: 0,
    display: "grid",
    gridTemplateColumns: template,
    gridAutoRows: `${rowHeight}px`,
    // Horizontal only: the vertical offset is the imperative `translate`,
    // because a per-tick change of an inherited custom property restyles every cell.
    translate: `0 ${canvasBaseOffset}px`,
    // --grid-dir signs the X term: transforms are physical while RTL tracks mirror.
    transform: "translate3d(calc(var(--grid-dir, -1) * var(--grid-scroll-left, 0px)), 0, 0)",
  };

  return (
    <>
      <div style={canvasStyle} className={className} data-grid-rows-canvas="" data-grid-window-start={start} data-grid-window-end={end}>
        <CanvasOffsetAnchor scrollElement={scrollElement} baseOffset={canvasBaseOffset} />
        {viewRowIndices.map((viewRowIndex, i) => {
          const key = rowIds[i] ?? viewRowIndex;
          return (
            <DataGridRow
              key={key}
              viewRowIndex={viewRowIndex}
              rowId={rowIds[i]}
              renderedColumns={renderedColumns}
              layout={layout}
              readOnly={readOnly}
              rowMarkers={rowMarkers}
              onMarkerPointerDown={interaction.onMarkerPointerDown}
              onMarkerCheckboxPointerDown={interaction.onMarkerCheckboxPointerDown}
              onMarkerReorderPointerDown={rowReorder.onMarkerDragPointerDown}
              renderMarker={renderMarker}
              isRowReorderDragging={rowReorder.dragState?.rows.hasIndex(viewRowIndex) ?? false}
              rowRef={rowRegistry.getCallback(key)}
              getGridLine={rowRegistry.gridLine}
              ariaRowIndexOffset={pinnedTopCount + headerRowCount - 1}
              getRowClassName={getRowClassName}
              getCellClassName={getCellClassName}
            />
          );
        })}
        <DataGridOverlays
          windowStart={gridOrigin}
          rowCount={viewRowIndices.length}
          // contiguous rendered span for clamping; an appended off-window active row lies outside it
          clampRowStart={start}
          clampRowEnd={end}
          // total visible columns (real index space), not the rendered window size — bands and
          // pin-zone segmentation must span the FULL grid width
          colCount={layout.pins.length}
          colOffset={layout.markerWidth > 0 ? 2 : 1}
          pinTrack={{
            pins: layout.pins,
            trackLefts: layout.trackLefts,
            trackRights: layout.trackRights,
            renderedUnpinnedRange: unpinnedWindowRange(renderedColumns, layout.pins),
          }}
        />
        {rowDropIndicator && <div data-grid-drop-indicator="" aria-hidden="true" style={rowDropIndicator} />}
      </div>
      <LiveRegion />
    </>
  );
}
