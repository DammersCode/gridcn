"use client";

import { memo, useLayoutEffect, useMemo, type ComponentType, type CSSProperties, type ReactNode } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { useDataGridVisibleColumns, type OverlayPluginCtx } from "@/registry/default/blocks/data-grid/data-grid";
import { rowIdAtViewRow, useDataGridSelector } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { cellComments } from "./comment-state";
import type { CommentEngine } from "./comment-engine";
import type { UseDataGridCommentsOptions } from "./types";

export const MAX_MARKERS = 2048;

type Marker = { key: string; rowId: string; columnId: string; viewRow: number; col: number; unresolved: boolean };

type MarkerProps = {
  marker: Marker;
  windowStart: number;
  colOffset: number;
  pinStyle: CSSProperties | undefined;
  onOpen: (rowId: string, columnId: string) => void;
};

const CommentMarker = memo(function CommentMarker({ marker, windowStart, colOffset, pinStyle, onOpen }: MarkerProps) {
  return (
    <div
      data-grid-comment-marker-cell=""
      data-pinned={pinStyle ? "" : undefined}
      className="pointer-events-none relative z-[15]"
      style={{
        gridColumnStart: marker.col + colOffset,
        gridColumnEnd: marker.col + colOffset + 1,
        gridRowStart: marker.viewRow - windowStart + 1,
        gridRowEnd: marker.viewRow - windowStart + 2,
        ...pinStyle,
      }}
    >
      <span
        aria-hidden="true"
        data-grid-comment-marker=""
        data-unresolved={marker.unresolved ? "" : undefined}
        className="pointer-events-auto absolute end-0 top-0 block size-2 cursor-pointer pointer-coarse:size-6"
        onClick={(event) => {
          event.stopPropagation();
          onOpen(marker.rowId, marker.columnId);
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <span
          className={`pointer-events-none absolute end-0 top-0 block size-2 ${
            marker.unresolved
              ? "bg-primary [clip-path:polygon(0_0,100%_0,100%_100%)] rtl:[clip-path:polygon(0_0,100%_0,0_100%)] forced-colors:bg-[Highlight]"
              : "rounded-full border border-primary forced-colors:border-[CanvasText]"
          }`}
        />
      </span>
    </div>
  );
});

/** Walks the rendered rows once; only rows with comments read their cells. `revision` keys the memo on the mutable add-on state. */
function computeMarkers(
  core: CommentEngine["store"]["core"],
  rowIds: readonly (string | undefined)[],
  columnIndex: ReadonlyMap<string, number>,
  hideResolved: boolean,
  firstViewRow: number,
  revision: number,
): Marker[] {
  const list: Marker[] = [];
  if (revision < 0) return list;
  for (let i = 0; i < rowIds.length && list.length < MAX_MARKERS; i += 1) {
    const rowId = rowIds[i];
    if (rowId === undefined) continue;
    const columns = core.index.get(rowId);
    if (!columns) continue;
    for (const columnId of columns.keys()) {
      const col = columnIndex.get(columnId);
      if (col === undefined) continue;
      const entries = cellComments(core, rowId, columnId);
      if (entries.length === 0) continue;
      const unresolved = entries.some((e) => !e.comment.resolved);
      if (!unresolved && hideResolved) continue;
      list.push({ key: `${rowId}\u0001${columnId}`, rowId, columnId, viewRow: firstViewRow + i, col, unresolved });
      if (list.length >= MAX_MARKERS) break;
    }
  }
  return list;
}

/** The Overlay component of the plugin, closed over the engine. */
export function createCommentsOverlay(engine: CommentEngine, getOptions: () => UseDataGridCommentsOptions): ComponentType<OverlayPluginCtx> {
  function CommentsOverlay(ctx: OverlayPluginCtx): ReactNode {
    const { windowStart, clampRowStart, clampRowEnd, colOffset, pinTrack, splitRectByPinZones } = ctx;
    const revision = useStore(engine.store.ui, (s) => s.revision);
    const visibleColumns = useDataGridVisibleColumns();
    const rowIds = useDataGridSelector<unknown, readonly (string | undefined)[]>(
      useShallow((s) => {
        const ids: (string | undefined)[] = [];
        for (let viewRow = clampRowStart; viewRow < clampRowEnd; viewRow += 1) ids.push(rowIdAtViewRow(s, viewRow));
        return ids;
      }),
    );
    useLayoutEffect(() => {
      engine.noteRowsRendered(rowIds.filter((id): id is string => id !== undefined));
    }, [rowIds]);

    const hideResolved = getOptions().hideResolved === true;
    const columnIndex = useMemo(() => new Map(visibleColumns.map((c, i) => [c.id, i])), [visibleColumns]);

    const markers = useMemo(
      () => computeMarkers(engine.store.core, rowIds, columnIndex, hideResolved, clampRowStart, revision),
      [rowIds, columnIndex, hideResolved, clampRowStart, revision],
    );

    const onOpen = useMemo(() => (rowId: string, columnId: string) => void engine.openComments({ rowId, columnId }, "pointer"), []);

    return (
      <>
        {markers.map((marker) => {
          const segments = pinTrack ? splitRectByPinZones({ x: marker.col, y: marker.viewRow, width: 1, height: 1 }, pinTrack) : [{ rect: { x: marker.col, y: marker.viewRow, width: 1, height: 1 }, pinStyle: undefined }];
          const segment = segments[0];
          if (!segment) return null;
          return (
            <CommentMarker
              key={marker.key}
              marker={marker}
              windowStart={windowStart}
              colOffset={colOffset}
              pinStyle={"pinStyle" in segment ? segment.pinStyle : undefined}
              onOpen={onOpen}
            />
          );
        })}
      </>
    );
  }
  return CommentsOverlay;
}
