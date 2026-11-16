"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { AnyColumnDef } from "../store";
import type { AutosizeOptions } from "../types";
import { inlineDelta, type GridDirection } from "../virtualization/direction";
import { clampColumnWidth } from "./resolve-column-width";
import { safeSetPointerCapture } from "../interaction/safe-set-pointer-capture";

/** Handlers returned by {@link useColumnResize}, wired onto each header cell's resize handle. */
export type ColumnResizeHandlers = {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onDoubleClick: (event: ReactMouseEvent<HTMLElement>) => void;
  /** True while a resize drag is active — drives the handle's `data-resizing` hover-affordance state. */
  isResizing: boolean;
};

/**
 * Pointer-capture column resize: drag the handle to live-update the column's
 * width via `previewColumnWidth`, clamped to `[max(32, minWidth), maxWidth ?? Infinity]`; commits on
 * `pointerup`, and `pointercancel`, `lostpointercapture`, or a window blur end the drag, restore the
 * width the drag started at, and commit nothing. Double-click sizes this column to its content through the store's `autosizeColumns`
 * action, which samples the view (one commit, one `onColumnLayoutChange`).
 */
export function useColumnResize(args: {
  column: AnyColumnDef;
  currentWidth: number;
  previewColumnWidth: (id: string, width: number) => void;
  /** Fires once at drag release — the `onColumnLayoutChange` commit point (not per drag frame). */
  setColumnWidth: (id: string, width: number) => void;
  /** The store's `autosizeColumns` action; double-click calls it for this column. */
  autosizeColumns: (options?: AutosizeOptions) => void;
  /**
   * Layout direction. The handle sits at the column's inline-END edge in both directions (the
   * logical `end-0` class places it), so dragging toward the inline end must always widen the
   * column — but `clientX` is physical, so under RTL that is a drag toward the physical LEFT and
   * the raw delta has to be inverted. Defaults to `"ltr"`.
   */
  direction?: GridDirection;
}): ColumnResizeHandlers {
  const { column } = args;
  const argsRef = useRef(args);
  argsRef.current = args;
  const [isResizing, setIsResizing] = useState(false);

  const clamp = useCallback((width: number) => clampColumnWidth(column, width), [column]);

  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();
      // a second pointer must not arm a second listener set (the first would outlive its release and leak)
      if (dragRef.current) return;
      // React nulls event.currentTarget when this handler returns; the document listeners below outlive it
      const target = event.currentTarget;
      const pointerId = event.pointerId;
      dragRef.current = { startX: event.clientX, startWidth: argsRef.current.currentWidth };
      safeSetPointerCapture(target, pointerId);
      setIsResizing(true);

      // document-level listeners: pointer capture retargets hardware events to the handle, not events dispatched on document (tests)
      let lastWidth = argsRef.current.currentWidth;
      const handleMove = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        const drag = dragRef.current;
        if (!drag) return;
        lastWidth = clamp(drag.startWidth + inlineDelta(e.clientX - drag.startX, argsRef.current.direction ?? "ltr"));
        argsRef.current.previewColumnWidth(column.id, lastWidth);
      };
      const cleanup = () => {
        document.removeEventListener("pointermove", handleMove);
        document.removeEventListener("pointerup", handleEnd);
        document.removeEventListener("pointercancel", handleEnd);
        target.removeEventListener("lostpointercapture", handleEnd);
        window.removeEventListener("blur", cancelDrag);
        cleanupRef.current = null;
      };
      const cancelDrag = () => {
        const drag = dragRef.current;
        dragRef.current = null;
        setIsResizing(false);
        cleanup();
        if (drag && lastWidth !== drag.startWidth) argsRef.current.previewColumnWidth(column.id, drag.startWidth);
      };
      const handleEnd = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        if (e.type !== "pointerup") {
          cancelDrag();
          return;
        }
        dragRef.current = null;
        setIsResizing(false);
        cleanup();
        // drag-release commit point for onColumnLayoutChange — fires once here, not per handleMove frame.
        argsRef.current.setColumnWidth(column.id, lastWidth);
      };
      // lostpointercapture fires even when pointerup is missed (alt-tab); the document fallbacks cover environments without capture semantics
      document.addEventListener("pointermove", handleMove);
      document.addEventListener("pointerup", handleEnd);
      document.addEventListener("pointercancel", handleEnd);
      target.addEventListener("lostpointercapture", handleEnd);
      window.addEventListener("blur", cancelDrag);
      cleanupRef.current = cleanup;
    },
    [clamp, column.id],
  );

  // an unmount mid-drag (handle gone, capture lost with it) must drop the document listeners
  useEffect(
    () => () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
      dragRef.current = null;
    },
    [],
  );

  const onDoubleClick = useCallback(
    () => {
      argsRef.current.autosizeColumns({ columnIds: [column.id] });
    },
    [column.id],
  );

  return { onPointerDown, onDoubleClick, isResizing };
}
