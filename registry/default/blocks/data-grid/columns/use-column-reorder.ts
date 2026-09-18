"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

/** px of pointer movement (in the drag-start direction, off the origin header) before a header press commits to reorder-drag. */
const REORDER_THRESHOLD = 5;

/** Live reorder-drag UI state: the dragged column and where the drop indicator should render. */
export type ColumnReorderState = {
  draggingId: string;
  /** Column id the drop indicator renders next to, or null before the pointer has crossed into another header. */
  overId: string | null;
  /** Drop indicator renders before/after `overId`. */
  position: "before" | "after";
};

/** Per-header pointerdown handler + the shared drag state, one instance per `<DataGridHeader>`. */
export type ColumnReorderHandlers = {
  /** Attach to each header's label-zone pointerdown (never the resize-handle zone). */
  onHeaderDragPointerDown: (columnId: string, event: ReactPointerEvent<HTMLElement>) => void;
  dragState: ColumnReorderState | null;
};

/**
 * Drag-to-reorder columns (PLAN §3 item 2). MUST coexist with the header multi-column select-drag
 * from the interaction layer: both start from a press on the header. The disambiguation rule
 * (documented here as the single source of truth, tested by both the reorder and the select-drag
 * suites): **a horizontal drag that leaves the origin header becomes a reorder drag** whenever
 * `enableColumnReorder` is on and the pressed column is `reorderable`; **Shift+drag is always a
 * select-drag**, regardless of movement, so shift-extending a multi-column selection never
 * accidentally reorders. A plain press+drag that never leaves the origin header (or moves before
 * `REORDER_THRESHOLD`) resolves as a click (selection/sort), matching the existing 5px-jitter rule
 * used elsewhere in the interaction layer.
 */
export function useColumnReorder(args: {
  enabled: boolean;
  isColumnReorderable: (columnId: string) => boolean;
  /** Resolves the header element at a client point to a column id + before/after half, or null off any header. */
  hitTestHeader: (clientX: number, clientY: number) => { columnId: string; position: "before" | "after" } | null;
  onReorder: (id: string, targetId: string, position: "before" | "after") => void;
  /** Called the instant a press arms into a reorder drag — the caller cancels the sibling header column-select drag that started from the same press (see the JSDoc rule above). */
  onArm?: () => void;
}): ColumnReorderHandlers {
  const { enabled, isColumnReorderable } = args;
  const argsRef = useRef(args);
  argsRef.current = args;

  const [dragState, setDragState] = useState<ColumnReorderState | null>(null);
  // mirrors dragState synchronously — the document pointermove listener closes over stale React
  // state otherwise (it's attached once per gesture, not re-subscribed on every setDragState).
  const dragStateRef = useRef<ColumnReorderState | null>(null);
  const pendingRef = useRef<{ columnId: string; startX: number; startY: number; pointerId: number } | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const setDrag = useCallback((next: ColumnReorderState | null) => {
    dragStateRef.current = next;
    setDragState(next);
  }, []);

  const teardown = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    pendingRef.current = null;
    setDrag(null);
  }, [setDrag]);

  const onHeaderDragPointerDown = useCallback(
    (columnId: string, event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      // Shift+drag is always select-drag (disambiguation rule above) — never arm the reorder path.
      if (event.shiftKey) return;
      if (!enabled || !isColumnReorderable(columnId)) return;

      pendingRef.current = { columnId, startX: event.clientX, startY: event.clientY, pointerId: event.pointerId };

      const handleMove = (e: PointerEvent) => {
        const pending = pendingRef.current;
        if (!pending || e.pointerId !== pending.pointerId) return;

        if (!dragStateRef.current) {
          // not yet armed: only commit to reorder once the horizontal move exceeds the threshold
          // AND has left the origin header (hitTest resolves to a different column).
          const dx = Math.abs(e.clientX - pending.startX);
          if (dx < REORDER_THRESHOLD) return;
          const hit = argsRef.current.hitTestHeader(e.clientX, e.clientY);
          if (!hit || hit.columnId === pending.columnId) return;
          argsRef.current.onArm?.();
          setDrag({ draggingId: pending.columnId, overId: hit.columnId, position: hit.position });
          return;
        }

        const hit = argsRef.current.hitTestHeader(e.clientX, e.clientY);
        const prev = dragStateRef.current;
        setDrag({ ...prev, overId: hit?.columnId ?? null, position: hit?.position ?? prev.position });
      };

      const handleUp = (e: PointerEvent) => {
        const pending = pendingRef.current;
        if (!pending || e.pointerId !== pending.pointerId) return;
        const finalState = dragStateRef.current;
        if (finalState && finalState.overId) {
          argsRef.current.onReorder(finalState.draggingId, finalState.overId, finalState.position);
        }
        teardown();
      };

      document.addEventListener("pointermove", handleMove);
      document.addEventListener("pointerup", handleUp);
      document.addEventListener("pointercancel", handleUp);
      cleanupRef.current = () => {
        document.removeEventListener("pointermove", handleMove);
        document.removeEventListener("pointerup", handleUp);
        document.removeEventListener("pointercancel", handleUp);
      };
    },
    [enabled, isColumnReorderable, setDrag, teardown],
  );

  useEffect(() => teardown, [teardown]);

  return { onHeaderDragPointerDown, dragState };
}
