"use client";

import type { CSSProperties, ReactNode } from "react";
import { GRID_LAYER, type GridRect, type OverlayPluginCtx } from "@/registry/default/blocks/data-grid/data-grid";
import type { FillHandleHandlers } from "./use-fill-handle";

/** The dashed fill-drag preview rect, window-relative, grid-line placed like core's own RangeOverlay; pinned segments add their zone's counter-offset + z-index 2 (above pinned cells' z1). */
function FillPreviewOverlay({ rect, windowStart, colOffset, pinStyle }: { rect: GridRect; windowStart: number; colOffset: number; pinStyle?: CSSProperties }) {
  return (
    <div
      data-grid-fill-preview=""
      data-pinned={pinStyle ? "" : undefined}
      aria-hidden="true"
      className="pointer-events-none border border-dashed border-primary bg-primary/5"
      style={{
        // positioned: cells are position:relative since #80, so a static overlay paints BELOW them
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

/** The small draggable square at a range's bottom-right corner that starts a fill drag; adds the corner column's pin offset when it falls in a pinned zone. */
function FillHandle({
  rect,
  windowStart,
  colOffset,
  pinStyle,
  onPointerDown,
}: {
  rect: GridRect;
  windowStart: number;
  colOffset: number;
  pinStyle?: CSSProperties;
  onPointerDown: FillHandleHandlers["onPointerDown"];
}) {
  return (
    <div
      data-grid-fill-handle=""
      // mouse-only drag affordance (Ctrl+D/Ctrl+R cover the keyboard-equivalent fill actions) — not
      // focusable/operable via keyboard or AT, so it's hidden from the accessibility tree entirely.
      aria-hidden="true"
      // grid-placed on the cell holding the range's bottom-right corner, self-aligned into that
      // cell's own corner so it reads as sitting "on" the selection edge rather than centered in it.
      className="pointer-events-auto z-20 size-2 place-self-end cursor-crosshair border border-background bg-primary"
      style={{
        gridColumnStart: rect.x + rect.width + colOffset - 1,
        gridColumnEnd: rect.x + rect.width + colOffset,
        gridRowStart: rect.y + rect.height - windowStart,
        gridRowEnd: rect.y + rect.height - windowStart + 1,
        ...pinStyle,
      }}
      onPointerDown={onPointerDown}
    />
  );
}

/**
 * Everything {@link renderFillOverlay} needs beyond the plugin `ctx` — the live selection/editing
 * state and drag preview the built-in overlay layer used to read directly from core's own store,
 * plus `onPointerDown` itself (sourced from the add-on's `fillStore`, since the real handler is
 * produced by `FillHandleTracker`, which renders in a different part of the tree than this plugin
 * — see fill-store.ts's doc comment on `onPointerDown`).
 */
export type FillOverlayState = {
  fillPreview: GridRect | null;
  /** Primary selection range (view-space), or `null` when there's no current range (row/column-channel-only selection, or a clear). */
  primaryRange: GridRect | null;
  /** True while a cell is being edited — hides the handle, matching pre-extraction behavior. */
  editing: boolean;
  /** Fill is disabled (grid readOnly or the add-on's `disabled: true` option), so the handle would be dead UI — hidden. */
  disabled: boolean;
  /** `null` before `FillHandleTracker` mounts (or if it's never rendered) — hides the handle, same as core's pre-extraction `fillHandleHandlers` guard. */
  onPointerDown: FillHandleHandlers["onPointerDown"] | null;
};

/**
 * Renders the fill-preview strip and the fill handle into the overlay layer using the SAME
 * window-clamp + pin-zone segmentation pipeline core's own built-in overlays use (via `ctx`). This
 * is the function registered as `OverlayPlugin`; DOM order matches pre-extraction exactly (preview
 * before the plugin slot, handle after the active-cell ring is core's own concern — see the ctx's
 * doc comment on plugin placement) so the moved browser tests' DOM-order assertions stay valid.
 */
export function renderFillOverlay(state: FillOverlayState, ctx: OverlayPluginCtx): ReactNode {
  const { windowStart, clampRowStart, clampRowEnd, colCount, colOffset, pinTrack, splitRectByPinZones, clampRectToWindow } = ctx;
  const pinned = pinTrack && pinTrack.pins.some((p) => p === "left" || p === "right") ? pinTrack : undefined;
  const segment = (rect: GridRect) => (pinned ? splitRectByPinZones(rect, pinned) : [{ rect, pinStyle: undefined }]);

  const clampedFillPreview = state.fillPreview ? clampRectToWindow(state.fillPreview, clampRowStart, clampRowEnd, colCount) : null;

  // hidden while editing, when disabled (the fill would be dead UI), when selection is
  // rows/columns-channel only (no `current` range), or before FillHandleTracker has registered a
  // handler — same guard core's built-in layer used pre-extraction.
  const onPointerDown = state.onPointerDown;
  const showFillHandle = onPointerDown && !state.editing && state.primaryRange && !state.disabled;
  const clampedPrimary = state.primaryRange ? clampRectToWindow(state.primaryRange, clampRowStart, clampRowEnd, colCount) : null;
  const cornerCol = state.primaryRange ? state.primaryRange.x + state.primaryRange.width - 1 : null;
  const fillHandlePinStyle =
    cornerCol !== null && pinned && pinned.pins[cornerCol] ? segment({ x: cornerCol, y: 0, width: 1, height: 1 })[0]?.pinStyle : undefined;

  return (
    <>
      {clampedFillPreview &&
        segment(clampedFillPreview).map((seg, j) => (
          <FillPreviewOverlay key={`fill-preview-${j}`} rect={seg.rect} windowStart={windowStart} colOffset={colOffset} pinStyle={seg.pinStyle} />
        ))}
      {showFillHandle && clampedPrimary && state.primaryRange &&
        clampedPrimary.y + clampedPrimary.height === state.primaryRange.y + state.primaryRange.height &&
        clampedPrimary.x + clampedPrimary.width === state.primaryRange.x + state.primaryRange.width && (
          <FillHandle
            rect={state.primaryRange}
            windowStart={windowStart}
            colOffset={colOffset}
            pinStyle={fillHandlePinStyle}
            onPointerDown={onPointerDown}
          />
        )}
    </>
  );
}
