"use client";

import { Fragment, memo, type CSSProperties, type ReactNode } from "react";
import { GRID_LAYER, type GridRect, type OverlayPluginCtx } from "@/registry/default/blocks/data-grid/data-grid";
import {
  isRowIdPresenceHighlight,
  isRowIdRangePresenceHighlight,
  type PresenceHighlight,
  type PresenceHighlightEntry,
  type RowIdPresenceHighlight,
  type RowIdRangePresenceHighlight,
} from "./presence-store";

/** Default cap on the rects ONE range entry may paint (per contiguous fragment): a remote selection of scattered rows must not turn the overlay layer into thousands of divs. Override it with `useDataGridPresence({ maxRects })`; excess fragments are dropped and reported via the `onExcessRects` option. */
export const MAX_RESOLVED_RECTS = 1024;

/** One remote user's selection-range fill + border, grid-line placed like core's own RangeOverlay; color comes from the highlight itself via `--presence-color`, not a shadcn token. Memoized: the resolved rects keep identity across overlay renders (see `makePresencePlugin`'s memo), so an unchanged highlight never re-renders its divs on a local keystroke. */
const PresenceHighlightOverlay = memo(function PresenceHighlightOverlay({
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
        // positioned: cells are position:relative, so a static overlay would paint below them
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
});

/** The remote user's name chip, anchored at a highlight range's top-left VISIBLE corner — only rendered by the caller when that corner survives the window clamp. Memoized like the overlay node. */
const PresenceLabelChip = memo(function PresenceLabelChip({
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
});

/**
 * Resolves rowId-native entries to view-space {@link PresenceHighlight}s via the caller's
 * `rowId -> view row` map. A single-cell entry resolves to a 1×1 rect; a range entry paints one
 * rect per contiguous run of resolved rows × resolved columns.
 *
 * A rowId outside the current view is dropped silently (the rowId-native contract). An unresolved
 * column dev-warns once per instance. Column lookup is a linear scan over `visibleColumns`:
 * entry counts are small. A range entry paints at most `maxRects` fragments; the excess is
 * dropped and reported via `onExcessRects`.
 * Pure (no hooks), so tests can call it without React.
 */
export function resolveHighlights(
  entries: readonly PresenceHighlightEntry[],
  rowIdToViewRow: ReadonlyMap<string, number>,
  visibleColumns: readonly { id: string }[],
  onDroppedColumn?: (entry: RowIdPresenceHighlight) => void,
  onUnresolvedColumns?: (entry: RowIdRangePresenceHighlight, unresolvedCount: number) => void,
  onExcessRects?: (entry: RowIdRangePresenceHighlight, kept: number, total: number) => void,
  maxRects: number = MAX_RESOLVED_RECTS,
): PresenceHighlight[] {
  const resolved: PresenceHighlight[] = [];
  for (const entry of entries) {
    if (isRowIdPresenceHighlight(entry)) {
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
      continue;
    }
    if (isRowIdRangePresenceHighlight(entry)) {
      const viewRows = entry.rowIds.map((rowId) => rowIdToViewRow.get(rowId)).filter((v): v is number => v !== undefined);
      const colIndexes = entry.columnIds.map((columnId) => visibleColumns.findIndex((c) => c.id === columnId));
      const viewCols = colIndexes.filter((col) => col !== -1);
      if (viewRows.length === 0 || viewCols.length === 0) continue;
      if (colIndexes.some((col) => col === -1)) {
        onUnresolvedColumns?.(entry, colIndexes.filter((col) => col === -1).length);
      }
      const rowRuns = contiguousRuns(viewRows);
      const colRuns = contiguousRuns(viewCols);
      const total = rowRuns.length * colRuns.length;
      let painted = 0;
      let capped = false;
      for (const rowRun of rowRuns) {
        for (const colRun of colRuns) {
          if (painted === maxRects) {
            capped = true;
            break;
          }
          resolved.push({
            id: entry.id,
            color: entry.color,
            range: { x: colRun.min, y: rowRun.min, width: colRun.length, height: rowRun.length },
            label: entry.label,
          });
          painted += 1;
        }
        if (capped) break;
      }
      if (capped) onExcessRects?.(entry, maxRects, total);
      continue;
    }
    resolved.push(entry);
  }
  return resolved;
}

/** Ascending runs of contiguity in a number list: [0, 1, 3] -> [{ min: 0, length: 2 }, { min: 3, length: 1 }]; duplicates collapse. */
function contiguousRuns(values: number[]): { min: number; length: number }[] {
  const runs: { min: number; length: number }[] = [];
  let start = Number.POSITIVE_INFINITY;
  let prev = Number.NEGATIVE_INFINITY;
  for (const v of [...values].sort((a, b) => a - b)) {
    if (v === prev) continue;
    if (v !== prev + 1) {
      if (start !== Number.POSITIVE_INFINITY) runs.push({ min: start, length: prev - start + 1 });
      start = v;
    }
    prev = v;
  }
  if (start !== Number.POSITIVE_INFINITY) runs.push({ min: start, length: prev - start + 1 });
  return runs;
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
