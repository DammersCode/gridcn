"use client";

import { Fragment, type CSSProperties, type ReactNode } from "react";
import { GRID_LAYER, type GridRect, type OverlayPluginCtx } from "@/registry/default/blocks/data-grid/data-grid";
import { isRowIdPresenceHighlight, type PresenceHighlight, type PresenceHighlightEntry, type RowIdPresenceHighlight } from "./presence-store";

/** One remote user's selection-range fill + border, grid-line placed like core's own RangeOverlay; color comes from the highlight itself via `--presence-color`, not a shadcn token. */
function PresenceHighlightOverlay({
  rect,
  color,
  windowStart,
  colOffset,
  pinStyle,
}: {
  rect: GridRect;
  color: string;
  windowStart: number;
  colOffset: number;
  pinStyle?: CSSProperties;
}) {
  return (
    <div
      data-grid-presence-overlay=""
      data-pinned={pinStyle ? "" : undefined}
      aria-hidden="true"
      className="pointer-events-none border border-[color-mix(in_oklch,var(--presence-color)_100%,transparent)] bg-[color-mix(in_oklch,var(--presence-color)_12%,transparent)]"
      style={{
        // positioned: cells are position:relative since #80, so a static overlay paints BELOW them
        position: "relative",
        "--presence-color": color,
        gridColumnStart: rect.x + colOffset,
        gridColumnEnd: rect.x + rect.width + colOffset,
        gridRowStart: rect.y - windowStart + 1,
        gridRowEnd: rect.y + rect.height - windowStart + 1,
        ...pinStyle,
        ...(pinStyle ? { zIndex: GRID_LAYER.pinnedOverlaySegment } : {}),
      } as CSSProperties}
    />
  );
}

/** The remote user's name chip, anchored at a highlight range's top-left VISIBLE corner — only rendered by the caller when that corner survives the window clamp. */
function PresenceLabelChip({
  rect,
  color,
  label,
  windowStart,
  colOffset,
  pinStyle,
}: {
  rect: GridRect;
  color: string;
  label: string;
  windowStart: number;
  colOffset: number;
  pinStyle?: CSSProperties;
}) {
  return (
    <div
      data-grid-presence-label=""
      data-pinned={pinStyle ? "" : undefined}
      aria-hidden="true"
      className="pointer-events-none z-20 flex items-start justify-start"
      style={{
        gridColumnStart: rect.x + colOffset,
        gridColumnEnd: rect.x + colOffset + 1,
        gridRowStart: rect.y - windowStart + 1,
        gridRowEnd: rect.y - windowStart + 2,
        ...pinStyle,
      }}
    >
      <span
        className="-translate-y-1/2 rounded-sm px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-white shadow-sm"
        style={{ backgroundColor: color }}
      >
        {label}
      </span>
    </div>
  );
}

/**
 * Resolves every rowId-native entry to a view-space {@link PresenceHighlight}
 * (2026-08-02 optimization audit, "rowId-native presence adapter") using a `rowId -> view row` map
 * the caller already built via `useDataGridRowIdToViewRow()` — the same O(1)-after-build map core's
 * own presence docs now point consumers at instead of the DIY `useShallow`-over-`useDataGridRowIds`
 * pattern. An entry whose `rowId` isn't in the current view (filtered out) is dropped silently,
 * matching the manual mapping's documented contract. Column resolution is a plain linear scan over
 * `visibleColumns` — presence highlight counts are small (a handful of remote cursors, not a
 * per-row structure), so this never needs a Map. Pure (no hooks) so it can be called from either
 * the plugin closure or a test, independent of React's rules-of-hooks call-site constraints.
 *
 * Drops: a rowId that fell out of the current view (filtered out) is dropped SILENTLY — that's the
 * documented rowId-native contract. A `columnId` that resolves to no visible column (hidden or
 * unknown) is dropped with a dev warning via `onDroppedColumn` (the plugin passes a per-instance
 * once-wrapped callback, so a persistently hidden column doesn't re-warn on every overlay render).
 */
export function resolveHighlights(
  entries: readonly PresenceHighlightEntry[],
  rowIdToViewRow: ReadonlyMap<string, number>,
  visibleColumns: readonly { id: string }[],
  onDroppedColumn?: (entry: RowIdPresenceHighlight) => void,
): PresenceHighlight[] {
  const resolved: PresenceHighlight[] = [];
  for (const entry of entries) {
    if (!isRowIdPresenceHighlight(entry)) {
      resolved.push(entry);
      continue;
    }
    const viewRow = rowIdToViewRow.get(entry.rowId);
    if (viewRow === undefined) continue;
    const col = visibleColumns.findIndex((c) => c.id === entry.columnId);
    if (col === -1) {
      onDroppedColumn?.(entry);
      continue;
    }
    resolved.push({
      id: entry.id,
      color: entry.color,
      range: { x: col, y: viewRow, width: 1, height: 1 },
      label: entry.label,
    });
  }
  return resolved;
}

/**
 * Renders every active highlight into the overlay layer using the SAME window-clamp + pin-zone
 * segmentation pipeline core's own built-in overlays use (via `ctx`), so a highlight spanning a
 * pinned column splits into pinned/unpinned segments and paints at the pinned cell's actual screen
 * position exactly like a selection range does. This is the function registered as `OverlayPlugin`.
 * `highlights` must already be resolved to view-space (see {@link resolveHighlights}) — the caller
 * (`makePresencePlugin`) does that resolution itself since it's the one already subscribed to core
 * hooks inside `DataGridOverlays`'s render, keeping this function a plain (hook-free) renderer.
 */
export function renderPresenceOverlay(highlights: readonly PresenceHighlight[], ctx: OverlayPluginCtx): ReactNode {
  const { windowStart, clampRowStart, clampRowEnd, colCount, colOffset, pinTrack, splitRectByPinZones, clampRectToWindow } = ctx;
  const pinned = pinTrack && pinTrack.pins.some((p) => p === "left" || p === "right") ? pinTrack : undefined;
  const segment = (rect: GridRect) => (pinned ? splitRectByPinZones(rect, pinned) : [{ rect, pinStyle: undefined }]);

  return (
    <>
      {/* entries are keyed by POSITION, not `id`: the id contract is "unique per entry", but a
          peer sending duplicate ids must not break reconciliation (unsupported duplicate React
          keys) — position is always unique per sibling */}
      {highlights.map((highlight, i) => {
        const clamped = clampRectToWindow(highlight.range, clampRowStart, clampRowEnd, colCount);
        if (!clamped) return null;
        // top-left corner chip only shows while that exact cell survives the clamp (same guard idea as core's own fill-handle corner check).
        const topLeftOnWindow = clamped.x === highlight.range.x && clamped.y === highlight.range.y;
        const topLeftPinStyle = pinned && pinned.pins[highlight.range.x]
          ? segment({ x: highlight.range.x, y: highlight.range.y, width: 1, height: 1 })[0]?.pinStyle
          : undefined;
        return (
          <Fragment key={i}>
            {segment(clamped).map((seg, j) => (
              <PresenceHighlightOverlay
                key={`presence-${i}-${j}`}
                rect={seg.rect}
                color={highlight.color}
                windowStart={windowStart}
                colOffset={colOffset}
                pinStyle={seg.pinStyle}
              />
            ))}
            {topLeftOnWindow && highlight.label && (
              <PresenceLabelChip
                rect={{ x: highlight.range.x, y: highlight.range.y, width: 1, height: 1 }}
                color={highlight.color}
                label={highlight.label}
                windowStart={windowStart}
                colOffset={colOffset}
                pinStyle={topLeftPinStyle}
              />
            )}
          </Fragment>
        );
      })}
    </>
  );
}
