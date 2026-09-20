"use client";

import { useCallback, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { AnyColumnDef } from "../store";
import { inlineDelta, type GridDirection } from "../windowing/direction";
import { measureColumnAutosizeWidth } from "./measure-column-text";

/** Absolute floor so a runaway drag (or a zero/negative minWidth) never collapses a column to unusable. */
const ABSOLUTE_MIN_WIDTH = 32;

/** Handlers returned by {@link useColumnResize}, wired onto each header cell's resize handle. */
export type ColumnResizeHandlers = {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onDoubleClick: (event: ReactMouseEvent<HTMLElement>) => void;
  /** True while a resize drag is active — drives the handle's `data-resizing` hover-affordance state. */
  isResizing: boolean;
};

/**
 * Pointer-capture column resize: drag the handle to live-update the column's
 * width via `setColumnWidth`, clamped to `[minWidth ?? 32, maxWidth ?? Infinity]`; ends on
 * `lostpointercapture` (not `pointerup` — pointerup can be missed on alt-tab, per the adazzle
 * study). Double-click autosizes: measures the header text + every rendered cell's text in that
 * column via `measure-column-text.ts`'s canvas helper, using `fontSourceRef`'s computed font
 * (an element inside the grid root, since the grid sets its own `text-sm` and may differ from
 * `document.body`).
 */
export function useColumnResize(args: {
  column: AnyColumnDef;
  currentWidth: number;
  setColumnWidth: (id: string, width: number) => void;
  /** Fires once at drag-release/autosize — the `onColumnLayoutChange` commit point (not per drag frame). */
  commitColumnWidth: (id: string, width: number) => void;
  /** Reads the currently-rendered cell text for this column from the DOM (windowed rows only). */
  getRenderedCellTexts: (columnId: string) => string[];
  /** Element whose computed font is used for autosize measurement — must be inside the grid root, not document.body. */
  fontSourceRef: RefObject<Element | null>;
  /**
   * Layout direction. The handle sits at the column's inline-END edge in both directions (the
   * logical `end-0` class places it), so dragging toward the inline end must always widen the
   * column — but `clientX` is physical, so under RTL that is a drag toward the physical LEFT and
   * the raw delta has to be inverted. Defaults to `"ltr"`.
   */
  direction?: GridDirection;
}): ColumnResizeHandlers {
  const { column, getRenderedCellTexts } = args;
  const argsRef = useRef(args);
  argsRef.current = args;
  const [isResizing, setIsResizing] = useState(false);

  const clamp = useCallback((width: number) => {
    const min = Math.max(ABSOLUTE_MIN_WIDTH, column.minWidth ?? 0);
    const max = column.maxWidth ?? Number.POSITIVE_INFINITY;
    return Math.min(Math.max(width, min), max);
  }, [column.minWidth, column.maxWidth]);

  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();
      // React pools synthetic events — event.currentTarget is nulled once this handler returns, so
      // the native listeners below (which outlive it) must close over the real element directly.
      const target = event.currentTarget;
      const pointerId = event.pointerId;
      dragRef.current = { startX: event.clientX, startWidth: argsRef.current.currentWidth };
      target.setPointerCapture?.(pointerId);
      setIsResizing(true);

      // Listeners on `document`, not the handle element (checklist-consistent with use-grid-interaction.ts's
      // drag machinery): pointer capture retargets real hardware pointer events to the captured element, but
      // that retargeting doesn't apply to events dispatched directly on `document` (incl. in tests), so a
      // handle-scoped listener alone would miss every move once the pointer leaves the handle's own bounds.
      let lastWidth = argsRef.current.currentWidth;
      const handleMove = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        const drag = dragRef.current;
        if (!drag) return;
        lastWidth = clamp(drag.startWidth + inlineDelta(e.clientX - drag.startX, argsRef.current.direction ?? "ltr"));
        argsRef.current.setColumnWidth(column.id, lastWidth);
      };
      const handleEnd = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        dragRef.current = null;
        setIsResizing(false);
        document.removeEventListener("pointermove", handleMove);
        document.removeEventListener("pointerup", handleEnd);
        document.removeEventListener("pointercancel", handleEnd);
        target.removeEventListener("lostpointercapture", handleEnd);
        // drag-release commit point for onColumnLayoutChange — fires once here, not per handleMove frame.
        argsRef.current.commitColumnWidth(column.id, lastWidth);
      };
      // lostpointercapture (not pointerup) fires reliably even when the pointerup is missed (alt-tab, etc);
      // pointerup/pointercancel on document are the fallback for environments without real capture semantics.
      document.addEventListener("pointermove", handleMove);
      document.addEventListener("pointerup", handleEnd);
      document.addEventListener("pointercancel", handleEnd);
      target.addEventListener("lostpointercapture", handleEnd);
    },
    [clamp, column.id],
  );

  const onDoubleClick = useCallback(() => {
    const fontSource = argsRef.current.fontSourceRef.current;
    const font = fontSource ? getComputedStyle(fontSource).font : "";
    const headerText = column.headerText ?? (typeof column.header === "string" ? column.header : "");
    const cellTexts = getRenderedCellTexts(column.id);
    const width = measureColumnAutosizeWidth({
      headerText,
      cellTexts,
      font,
      minWidth: Math.max(ABSOLUTE_MIN_WIDTH, column.minWidth ?? 0),
      maxWidth: column.maxWidth,
    });
    argsRef.current.commitColumnWidth(column.id, width);
  }, [column, getRenderedCellTexts]);

  return { onPointerDown, onDoubleClick, isResizing };
}

/** Reads the rendered text of every currently-mounted gridcell for `columnId` from the DOM, scoped to `root`. */
export function readRenderedCellTexts(root: Element | null, columnId: string): string[] {
  if (!root) return [];
  const cells = root.querySelectorAll(`[role="gridcell"][data-column-id="${CSS.escape(columnId)}"]`);
  return Array.from(cells, (cell) => cell.textContent ?? "");
}
