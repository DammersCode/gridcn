"use client";

import { type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { GRID_LAYER } from "./layers";
import type { ViewCoord, CompactSelectionLike, GridRect } from "./types";
import { intersectRect } from "./selection";
import { pinnedInsetStyle } from "./columns/pinned-inset-style";
import {
  useDataGridActiveCell,
  useDataGridEditing,
  useDataGridPluginOverlays,
  useDataGridSelection,
  useDataGridSelectionPointer,
  type AnyColumnDef,
} from "./store";
import type { SelectionPointer } from "./store/types";
import { GRID_ATTR } from "./data-attributes";

/** Per-real-column-index pin/track data an overlay segment needs to reproduce a pinned cell's own offset. */
export type PinTrackData = {
  pins: readonly (AnyColumnDef["pin"] | undefined)[];
  trackLefts: readonly number[];
  trackRights: readonly number[];
  /** Real-index bounds `[start, end)` of the currently rendered UNPINNED column window — pinned zones always render in full (pinned columns are never virtualized out), so only the unpinned middle segment needs this clamp. */
  renderedUnpinnedRange: { start: number; end: number };
};

/**
 * Clamps a data-space rect to the given `[rowStart, rowEnd)` row window and `[0, colCount)`, or
 * null if fully outside it — column clamping to the actually-RENDERED window happens per pin-zone
 * in {@link splitRectByPinZones} when `pinTrack` is supplied. Exported for {@link OverlayPluginCtx}:
 * an overlay plugin (e.g. `data-grid-presence`) needs the same window-clamp math core's own
 * built-in layers use, rather than reimplementing it.
 */
export function clampRectToWindow(
  rect: GridRect,
  rowStart: number,
  rowEnd: number,
  colCount: number,
): GridRect | null {
  return intersectRect(rect, { x: 0, y: rowStart, width: colCount, height: rowEnd - rowStart });
}

/** Contiguous membership runs of `set` within `[start, end)` — O(end - start), window-bounded. */
function membershipRuns(set: CompactSelectionLike, start: number, end: number): Array<{ start: number; length: number }> {
  const runs: Array<{ start: number; length: number }> = [];
  let runStart = -1;
  for (let i = start; i < end; i++) {
    if (set.hasIndex(i)) {
      if (runStart === -1) runStart = i;
    } else if (runStart !== -1) {
      runs.push({ start: runStart, length: i - runStart });
      runStart = -1;
    }
  }
  if (runStart !== -1) runs.push({ start: runStart, length: end - runStart });
  return runs;
}

/** One pin zone's contiguous index range plus (for pinned zones) the offset shared by the whole segment. */
export type RectSegment = {
  rect: GridRect;
  /** Undefined for the unpinned middle segment — no counter-offset, no elevated z-index. */
  pin?: AnyColumnDef["pin"];
  pinStyle?: CSSProperties;
};

/**
  * Splits a data-space rect into up to 3 contiguous sub-rects — pinned-left / unpinned / pinned-right —
  * so each zone can be rendered at its own screen position: overlays live in the rows canvas, which
  * translates by -scrollLeft, so a segment spanning a pinned column would otherwise
 * paint at that column's TRACK position instead of its counter-offset pinned position. Pinned
 * columns are contiguous within their zone (store guarantee, `computeVisibleColumns`), so the
 * whole segment reuses the single offset of its first column.
 */
export function splitRectByPinZones(rect: GridRect, track: PinTrackData): RectSegment[] {
  const { pins, renderedUnpinnedRange } = track;
  let leftEnd = 0;
  while (leftEnd < pins.length && pins[leftEnd] === "left") leftEnd++;
  let rightStart = pins.length;
  while (rightStart > leftEnd && pins[rightStart - 1] === "right") rightStart--;

  const zones: Array<{ start: number; end: number; pin?: AnyColumnDef["pin"] }> = [
    { start: 0, end: leftEnd, pin: "left" },
    // clamped to the rendered unpinned column window: unlike pinned zones (always fully rendered),
    // the unpinned middle is virtualized, so an unclamped segment would place its far edge at an
    // off-screen track position, breaking the "no gaps" visual tiling with the pinned segments.
    { start: Math.max(leftEnd, renderedUnpinnedRange.start), end: Math.min(rightStart, renderedUnpinnedRange.end), pin: undefined },
    { start: rightStart, end: pins.length, pin: "right" },
  ];

  const segments: RectSegment[] = [];
  for (const zone of zones) {
    if (zone.end <= zone.start) continue;
    const clamped = intersectRect(rect, { x: zone.start, y: rect.y, width: zone.end - zone.start, height: rect.height });
    if (!clamped) continue;
    if (!zone.pin) {
      segments.push({ rect: clamped });
      continue;
    }
    const firstCol = clamped.x;
    segments.push({
      rect: clamped,
      pin: zone.pin,
      pinStyle: pinnedInsetStyle(zone.pin, firstCol),
    });
  }
  return segments;
}

/** One selection-range fill overlay, grid-line placed, window-relative; pinned segments add their zone's counter-offset + elevated z-index (above pinned cells). */
function RangeOverlay({ rect, windowStart, colOffset, pinStyle }: { rect: GridRect; windowStart: number; colOffset: number; pinStyle?: CSSProperties }) {
  return (
    <div
      data-grid-selection-overlay=""
      data-pinned={pinStyle ? "" : undefined}
      aria-hidden="true"
      className="pointer-events-none border border-primary/40 bg-primary/10"
      style={{
        // positioned: cells are position:relative, so a static overlay would paint below them
        position: "relative",
        gridColumnStart: rect.x + colOffset,
        gridColumnEnd: rect.x + rect.width + colOffset,
        gridRowStart: rect.y - windowStart + 1,
        gridRowEnd: rect.y + rect.height - windowStart + 1,
        ...pinStyle,
        ...(pinStyle ? { zIndex: GRID_LAYER.pinnedOverlaySegment } : {}),
      }}
    />
  );
}

/** One touch selection handle: a 24 px hit circle on a corner of the primary range; dragging it extends the range from the opposite corner. */
function SelectionHandle({
  corner,
  coord,
  windowStart,
  colOffset,
  pinStyle,
}: {
  corner: "start" | "end";
  coord: ViewCoord;
  windowStart: number;
  colOffset: number;
  pinStyle?: CSSProperties;
}) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none relative"
      style={{
        gridColumnStart: coord.col + colOffset,
        gridColumnEnd: coord.col + colOffset + 1,
        gridRowStart: coord.row - windowStart + 1,
        gridRowEnd: coord.row - windowStart + 2,
        zIndex: pinStyle ? GRID_LAYER.pinnedOverlaySegment : GRID_LAYER.activeCell,
        ...pinStyle,
      }}
    >
      <span
        {...{ [GRID_ATTR.selectionHandle]: corner }}
        className={cn(
          "pointer-events-auto absolute flex size-6 touch-none items-center justify-center",
          corner === "start" ? "start-0 top-0 -ms-3 -mt-3" : "end-0 bottom-0 -me-3 -mb-3",
        )}
      >
        <span className="size-3 rounded-full border-2 border-background bg-primary shadow-sm" />
      </span>
    </div>
  );
}

/** Props for {@link DataGridOverlays}. */
export type DataGridOverlaysProps = {
  /** Data-space row index of the rows canvas's first grid line — overlays place relative to it. Sits at or below `clampRowStart`. */
  windowStart: number;
  /** Number of rows currently in view (post sort/filter). May include a disjoint off-window active row appended past the contiguous span — NOT a safe range-overlay clamp bound on its own, see `clampRowStart`/`clampRowEnd`. */
  rowCount: number;
  /**
   * True contiguous `[start, end)` rendered row span for clamping range/band overlays — distinct
   * from `windowStart`/`rowCount` because body.tsx appends a single off-window active row outside
   * the contiguous window, which would otherwise make `[windowStart, windowStart+rowCount)` either
   * overshoot or undershoot the real rendered bottom. Each bound falls back to `windowStart` and
   * `windowStart + rowCount` when omitted.
   */
  clampRowStart?: number;
  clampRowEnd?: number;
  /** Total number of visible columns (real index space) — NOT the rendered column-window size, so pin-zone segmentation can reach a pinned-right zone far outside the current window. */
  colCount: number;
  /** 1-based grid-column offset added to every data-space rect.x; 2 when a marker column occupies track 1, else 1 (default). */
  colOffset?: number;
  /** Per-column pin + track data (real column-index space) for pin-aware overlay segmentation; omitted (e.g. no pinned columns) skips segmentation entirely. */
  pinTrack?: PinTrackData;
};

/**
 * Context passed to every plugin `Overlay` component: the window-clamp + pin-zone
 * segmentation helpers and layout vars a plugin needs to reproduce the built-in layers'
 * "clamp to rendered window, split by pin zone, place by grid line" pipeline.
 */
export type OverlayPluginCtx = {
  /** Grid line origin of the rows canvas. Place with `rect.y - windowStart + 1`; clamp only with `clampRowStart` and `clampRowEnd`. Trails the first rendered row by up to 288 rows. */
  windowStart: number;
  clampRowStart: number;
  clampRowEnd: number;
  colCount: number;
  colOffset: number;
  pinTrack?: PinTrackData;
  /** The input that wrote the current selection. A touch selection shows selection handles at the range corners. */
  selectionPointer: SelectionPointer;
  splitRectByPinZones: typeof splitRectByPinZones;
  clampRectToWindow: typeof clampRectToWindow;
};

/** True when any column is pinned — segmentation is a no-op (and skippable) otherwise. */
export function hasAnyPin(pinTrack: PinTrackData | undefined): pinTrack is PinTrackData {
  return Boolean(pinTrack && pinTrack.pins.some((p) => p === "left" || p === "right"));
}

/**
 * Selection-range fill + active-cell ring, rendered inside the rows canvas so they translate with
 * scroll content. Placed purely by grid lines (no pixel math), `pointer-events: none` throughout.
 * Subscribes to selection/active-cell via atomic selectors: a change re-renders only this
 * component (never rows). When any column is pinned, every rect splits into pinned-left/unpinned/
 * pinned-right segments so pinned segments paint at their cell's actual screen position, above
 * pinned cells' own z-index. Plugin overlays render after the built-in layers but
 * BEFORE the active-cell ring, so local focus always wins visually over plugin content.
 */
export function DataGridOverlays(props: DataGridOverlaysProps): ReactNode {
  const { windowStart, rowCount, clampRowStart, clampRowEnd, colCount, colOffset = 1, pinTrack } = props;
  // The compiler can't lower a binary expression as a destructure default; resolve the defaults here.
  const clampedRowStart = clampRowStart ?? windowStart;
  const clampedRowEnd = clampRowEnd ?? windowStart + rowCount;
  const selection = useDataGridSelection();
  const activeCell = useDataGridActiveCell();
  const overlays = useDataGridPluginOverlays();
  const selectionPointer = useDataGridSelectionPointer();
  const editing = useDataGridEditing();
  const pinned = hasAnyPin(pinTrack) ? pinTrack : undefined;

  /** Splits into pin-zone segments when the grid has pinned columns, else the rect as a single "segment". */
  const segment = (rect: GridRect): RectSegment[] => (pinned ? splitRectByPinZones(rect, pinned) : [{ rect }]);

  const rangeRects: GridRect[] = [];
  if (selection.current) {
    rangeRects.push(selection.current.range);
    for (const rect of selection.current.rangeStack) rangeRects.push(rect);
  }

  // rows/columns channels (header/marker selection) render as full-band highlights — Excel-style
  // visible feedback (user QA 2026-07-03); runs computed only inside the contiguous rendered span
  // (clampRowStart/End, not windowStart/rowCount) so a disjoint off-window active row can't stretch
  // or shift these bands past the real rendered bottom.
  const columnBands: GridRect[] = membershipRuns(selection.columns, 0, colCount).map((run) => ({
    x: run.start,
    y: clampedRowStart,
    width: run.length,
    height: clampedRowEnd - clampedRowStart,
  }));
  const rowBands: GridRect[] = membershipRuns(selection.rows, clampedRowStart, clampedRowEnd).map((run) => ({
    x: 0,
    y: run.start,
    width: colCount,
    height: run.length,
  }));

  const handleRange = selectionPointer === "touch" && !editing && selection.current ? selection.current.range : null;
  const handleCorners: Array<{ corner: "start" | "end"; coord: ViewCoord }> = [];
  if (handleRange) {
    handleCorners.push({ corner: "start", coord: { col: handleRange.x, row: handleRange.y } });
    handleCorners.push({ corner: "end", coord: { col: handleRange.x + handleRange.width - 1, row: handleRange.y + handleRange.height - 1 } });
  }

  const activeInWindow: ViewCoord | null =
    activeCell && activeCell.row >= windowStart && activeCell.row < clampedRowEnd ? activeCell : null;
  const activePinStyle = activeInWindow && pinned ? pinned.pins[activeInWindow.col] && pinnedInsetStyle(
    pinned.pins[activeInWindow.col],
    activeInWindow.col,
  ) : undefined;

  return (
    <>
      {rangeRects.map((rect, i) => {
        const clamped = clampRectToWindow(rect, clampedRowStart, clampedRowEnd, colCount);
        if (!clamped) return null;
        return segment(clamped).map((seg, j) => (
          <RangeOverlay key={`${i}-${j}`} rect={seg.rect} windowStart={windowStart} colOffset={colOffset} pinStyle={seg.pinStyle} />
        ));
      })}
      {columnBands.map((rect, i) =>
        segment(rect).map((seg, j) => (
          <RangeOverlay key={`col-band-${i}-${j}`} rect={seg.rect} windowStart={windowStart} colOffset={colOffset} pinStyle={seg.pinStyle} />
        )),
      )}
      {rowBands.map((rect, i) =>
        segment(rect).map((seg, j) => (
          <RangeOverlay key={`row-band-${i}-${j}`} rect={seg.rect} windowStart={windowStart} colOffset={colOffset} pinStyle={seg.pinStyle} />
        )),
      )}
      {overlays.length > 0 &&
        overlays.map(({ name, Overlay }) => (
          // rendered here (after range/band layers, BEFORE the active-cell ring) so a plugin like
          // data-grid-fill's fill-preview/handle or presence keeps painting below local focus —
          // the ring must always win visually.
          <Overlay
            key={name}
            windowStart={windowStart}
            clampRowStart={clampedRowStart}
            clampRowEnd={clampedRowEnd}
            colCount={colCount}
            colOffset={colOffset}
            pinTrack={pinTrack}
            selectionPointer={selectionPointer}
            splitRectByPinZones={splitRectByPinZones}
            clampRectToWindow={clampRectToWindow}
          />
        ))}
      {handleCorners.map(({ corner, coord }) => {
        if (!clampRectToWindow({ x: coord.col, y: coord.row, width: 1, height: 1 }, clampedRowStart, clampedRowEnd, colCount)) return null;
        const pin = pinned?.pins[coord.col];
        return (
          <SelectionHandle
            key={corner}
            corner={corner}
            coord={coord}
            windowStart={windowStart}
            colOffset={colOffset}
            pinStyle={pin ? pinnedInsetStyle(pin, coord.col) : undefined}
          />
        );
      })}
      {activeInWindow && (
        <div
          data-grid-active-cell-overlay=""
          data-pinned={activePinStyle ? "" : undefined}
          aria-hidden="true"
          className={cn("pointer-events-none ring-2 ring-inset ring-primary")}
          style={{
            gridColumnStart: activeInWindow.col + colOffset,
            gridColumnEnd: activeInWindow.col + colOffset + 1,
            gridRowStart: activeInWindow.row - windowStart + 1,
            gridRowEnd: activeInWindow.row - windowStart + 2,
            // The ring ranks with the cell it decorates (same DOM-later sibling wins ties): an
            // unpinned ring must lose to any pinned cell that scrolls over it, a pinned ring must
            // beat its own cell's opaque background. A fixed rank floats the former over the pin
            // band and buries the latter under its own cell.
            zIndex: activePinStyle ? GRID_LAYER.activePinnedCell : GRID_LAYER.activeCell,
            ...activePinStyle,
          }}
        />
      )}
    </>
  );
}
