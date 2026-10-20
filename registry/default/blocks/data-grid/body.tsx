"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  useDataGridActions,
  useDataGridInternalActions,
  useDataGridActiveCell,
  useDataGridLabels,
  useDataGridReadOnly,
  useDataGridRowCount,
  useDataGridRowIds,
  useDataGridRowMarkers,
  useDataGridRowReorderEnabled,
  useDataGridStoreApi,
  type AnyColumnDef,
} from "./store";
import { useRowWindow } from "./virtualization/use-row-window";
import { useDataGridRootContext, type RenderedColumn } from "./layout-context";
import { DataGridRow } from "./row";
import { DataGridOverlays } from "./overlays";
import { predictReorderTarget, useRowReorder } from "./rows/use-row-reorder";
import { isReorderMarkerMode } from "./rows/marker-width";
import { FLASH_KEYFRAMES } from "./cell";
import { createRowElementRegistry } from "./row-element-registry";
import { GRID_LAYER } from "./layers";
import { gridAttrSelector } from "./data-attributes";
import { isDev } from "./is-dev";

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

/** Props for {@link DataGridBody}. */
export type DataGridBodyProps = {
  /** Merged onto the rows-canvas element (the transformed canvas holding the virtualized rows and overlays, not the scroll root). */
  className?: string;
};

/** Renders only the virtualized rows for the current scroll position, plus the active row so focus survives scrolling it out of view. */
export function DataGridBody({ className }: DataGridBodyProps): ReactNode {
  const {
    scrollRef,
    renderedColumns,
    rowHeight,
    headerHeight,
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
  const { start, end, windowTop, measured } = useRowWindow(scrollRef, {
    rowCount,
    rowHeight,
    dataRowTop: effectiveHeaderHeight,
    bottomInset: pinnedBottomHeight,
  });

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

  // When the active row sits ABOVE the window, gridRowStart (viewRowIndex - windowStart + 1) would
  // be <= 0 — an invalid <integer> (dropped, falls back to auto placement) or a negative index
  // (counts from the end of the explicit grid) — either way it corrupts canvas layout. Extend the
  // effective window start down to the active row and shift the canvas transform by the same
  // amount, so every rendered row keeps a valid (>=1) gridRowStart with no visual change.
  const effectiveStart = activeCell ? Math.min(start, activeCell.row) : start;
  const effectiveWindowTop = windowTop - (start - effectiveStart) * rowHeight;

  // Drag-to-reorder rows: one shared instance for the whole body (one indicator, one gesture),
  // mirroring how DataGridHeader owns useColumnReorder for its headers.
  const actions = useDataGridActions();
  const internalActions = useDataGridInternalActions();
  const labels = useDataGridLabels();
  const rowReorderEnabled = useDataGridRowReorderEnabled();
  // the gesture lives on the marker's reorder family only — plain number/checkbox/both markers
  // stay pure row-select surfaces (see RowMarkersMode), so a selection drag never reorders.
  const rowReorderArmed = rowReorderEnabled && isReorderMarkerMode(rowMarkers);
  const [reorderAnnouncement, setReorderAnnouncement] = useState("");
  // A `role="status"` region may not live inside role="grid" (only row/rowgroup are allowed
  // children — axe's aria-required-children), so the announcement portals to <body> after mount;
  // the gate keeps SSR output free of the portal node.
  const [announcementTarget, setAnnouncementTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setAnnouncementTarget(document.body);
  }, []);

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
    (from: number, over: number, position: "before" | "after") => {
      const to = predictReorderTarget(from, over, position);
      if (!actions.reorderRows(from, to)) return;
      setReorderAnnouncement(labels.markers.reorderAnnouncement(from + 1, to + 1, rowCount));
    },
    [actions, labels, rowCount],
  );

  const rowReorder = useRowReorder({
    enabled: rowReorderArmed,
    hitTestRow,
    onReorder: onRowReorder,
    getScrollElement: () => scrollRef.current,
  });

  // The single row-reorder drop-indicator line, grid-placed on the boundary row's track in the
  // canvas (same coordinate math as the rows' own imperative gridRowStart writes).
  const rowDropIndicator = useMemo<CSSProperties | null>(() => {
    const drag = rowReorder.dragState;
    if (!drag || drag.overRow === null) return null;
    const boundary = drag.position === "before" ? drag.overRow : drag.overRow + 1;
    return {
      gridRowStart: boundary - effectiveStart + 1,
      gridColumn: "1 / -1",
      position: "relative",
      alignSelf: "start",
      height: 2,
      zIndex: GRID_LAYER.overlay,
      pointerEvents: "none",
      backgroundColor: "var(--color-primary)",
    };
  }, [rowReorder.dragState, effectiveStart]);

  // Writes gridRowStart straight into each row's DOM node, bypassing React for this value.
  // The body re-renders every window tick anyway, so the write costs nothing extra, and
  // DataGridRow stays memoized without windowStart in its props.
  useLayoutEffect(() => {
    for (let i = 0; i < viewRowIndices.length; i++) {
      // i < viewRowIndices.length by loop condition
      const viewRowIndex = viewRowIndices[i]!;
      const key = rowIds[i] ?? viewRowIndex;
      const el = rowRegistry.elements.get(key);
      if (el) el.style.gridRowStart = String(viewRowIndex - effectiveStart + 1);
    }
  });

  // Drop flash keys whose rows left the rendered window — a remounted cell would otherwise replay
  // its one-shot pulse on scroll-back while the key is still live (the pulse is viewport-scoped by design).
  useEffect(() => {
    if (!measured) return;
    internalActions._pruneFlashingCells(viewRowIndices);
  }, [measured, viewRowIndices, internalActions]);

  const canvasStyle: CSSProperties & Record<string, string | number> = {
    position: "absolute",
    insetBlockStart: 0,
    insetInlineStart: 0,
    display: "grid",
    gridTemplateColumns: template,
    gridAutoRows: `${rowHeight}px`,
    "--grid-window-top": `${effectiveWindowTop}px`,
    // X: cancel native scroll like the header. Y: place the canvas at effectiveHeaderHeight +
    // windowTop (below the header AND any pinned-top band), then cancel native scroll's vertical
    // component too — one transform, both axes, every tick.
    // --grid-dir (-1 in LTR, 1 in RTL) signs the horizontal term: transforms are always physical
    // while the grid tracks under them mirror themselves, so the sign is the only difference.
    transform: `translate3d(calc(var(--grid-dir, -1) * var(--grid-scroll-left, 0px)), calc(var(--grid-window-top) - var(--grid-scroll-top, 0px) + ${effectiveHeaderHeight}px), 0)`,
  };

  return (
    <>
      <div style={canvasStyle} className={className} data-grid-rows-canvas="" data-grid-window-start={start} data-grid-window-end={end}>
        {/* self-scoped keyframes for the flashCells write-pulse (loading-skeleton's own <style> pattern — registry item, no global.css edit) */}
        <style>{FLASH_KEYFRAMES}</style>
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
              isRowReorderDragging={rowReorder.dragState?.draggingRow === viewRowIndex}
              rowRef={rowRegistry.getCallback(key)}
              ariaRowIndexOffset={pinnedTopCount}
              getRowClassName={getRowClassName}
              getCellClassName={getCellClassName}
            />
          );
        })}
        <DataGridOverlays
          windowStart={effectiveStart}
          rowCount={viewRowIndices.length}
          // contiguous rendered span for clamping: [effectiveStart, effectiveStart + length) is
          // disjoint whenever the active row was appended off-window
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
      {announcementTarget &&
        createPortal(
          <div aria-live="polite" role="status" className="sr-only">
            {reorderAnnouncement}
          </div>,
          announcementTarget,
        )}
    </>
  );
}
