"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { AUTO_SCROLL_STEP, AUTO_SCROLL_ZONE } from "../windowing/direction";

/** px of vertical pointer movement off the origin row before a marker press commits to a reorder drag. */
const REORDER_THRESHOLD = 5;

/**
 * Final landing view index (arrayMove semantics) for moving the row at view index `from` to the
 * boundary half of view index `over`: dragging down, "before over" lands on `over - 1`; dragging
 * up, "after over" lands on `over + 1`. A boundary on the origin row itself lands on `from` (no-op).
 */
export function predictReorderTarget(from: number, over: number, position: "before" | "after"): number {
  if (from === over) return from;
  return position === "before" ? (from < over ? over - 1 : over) : from < over ? over : over + 1;
}

/** Live reorder-drag UI state: the dragged row and where the drop indicator should render. */
export type RowReorderState = {
  draggingRow: number;
  /** View row index the drop indicator renders next to, or null before the pointer has crossed into another row. */
  overRow: number | null;
  /** Drop indicator renders above/below `overRow`. */
  position: "before" | "after";
};

/** Per-marker pointerdown handler + the shared drag state, one instance per `<DataGridBody>`. */
export type RowReorderHandlers = {
  /** Attach to every marker cell's pointerdown (never the checkbox glyph's own press). */
  onMarkerDragPointerDown: (viewRowIndex: number, event: ReactPointerEvent<HTMLElement>) => void;
  dragState: RowReorderState | null;
};

/**
 * Drag-to-reorder rows. MUST coexist with the marker row-select range-drag
 * from the interaction layer: both start from a press on the marker cell. The disambiguation rule
 * (documented here as the single source of truth, mirrors {@link import("../columns/use-column-reorder").useColumnReorder}):
 * **a vertical drag that leaves the origin row becomes a reorder drag** whenever `enabled` is on;
 * **Shift+drag is always the row-select drag**, so shift-extending a row selection never
 * accidentally reorders. A plain press+drag that never leaves the origin row (or moves before
 * `REORDER_THRESHOLD`) resolves as a click (row selection), matching the existing 5px-jitter rule.
 *
 * While armed, the hook auto-scrolls the grid's scroll element (same zone/step as the interaction
 * layer's select-drag) when the pointer sits beyond a viewport edge, and re-resolves the drop
 * boundary after each scrolled frame so a stationary pointer keeps tracking the scrolling content
 * — rows outside the rendered window stay reachable through that auto-scroll. <kbd>Escape</kbd>
 * cancels the gesture in flight.
 */
export function useRowReorder(args: {
  enabled: boolean;
  /** Resolves the row element at a client point to a view row index + above/below half, or null off any row. */
  hitTestRow: (clientX: number, clientY: number) => { row: number; position: "before" | "after" } | null;
  onReorder: (from: number, over: number, position: "before" | "after") => void;
  /** The grid's scroll element, for edge auto-scroll; null before the root mounts. */
  getScrollElement: () => HTMLElement | null;
  /** Called the instant a press arms into a reorder drag — the caller cancels the sibling row-select drag that started from the same press (see the JSDoc rule above). */
  onArm?: () => void;
}): RowReorderHandlers {
  const { enabled } = args;
  const argsRef = useRef(args);
  argsRef.current = args;

  const [dragState, setDragState] = useState<RowReorderState | null>(null);
  // mirrors dragState synchronously — the document pointermove listener closes over stale React
  // state otherwise (it's attached once per gesture, not re-subscribed on every setDragState).
  const dragStateRef = useRef<RowReorderState | null>(null);
  const pendingRef = useRef<{ row: number; startX: number; startY: number; pointerId: number } | null>(null);
  const pointerPointRef = useRef<{ x: number; y: number } | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const rafRef = useRef<number | null>(null);

  const setDrag = useCallback((next: RowReorderState | null) => {
    dragStateRef.current = next;
    setDragState(next);
  }, []);

  // Edge auto-scroll while armed: one rAF per frame scrolls a fixed step while the pointer sits in
  // an edge zone, then re-runs the hit test at the (stationary) pointer so the indicator tracks the
  // content scrolling underneath it. Mirrors the interaction layer's select-drag auto-scroll.
  const runFrame = useCallback(() => {
    const drag = dragStateRef.current;
    const point = pointerPointRef.current;
    if (!drag || !point) {
      rafRef.current = null;
      return;
    }
    const el = argsRef.current.getScrollElement();
    if (el) {
      const rect = el.getBoundingClientRect();
      const before = el.scrollTop;
      if (point.y < rect.top + AUTO_SCROLL_ZONE) el.scrollTop -= AUTO_SCROLL_STEP;
      else if (point.y > rect.bottom - AUTO_SCROLL_ZONE) el.scrollTop += AUTO_SCROLL_STEP;
      if (el.scrollTop !== before) {
        const hit = argsRef.current.hitTestRow(point.x, point.y);
        const overRow = hit?.row ?? null;
        const position = hit?.position ?? drag.position;
        if (overRow !== drag.overRow || position !== drag.position) {
          setDrag({ draggingRow: drag.draggingRow, overRow, position });
        }
      }
    }
    rafRef.current = requestAnimationFrame(runFrame);
  }, [setDrag]);

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const teardown = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    pendingRef.current = null;
    pointerPointRef.current = null;
    stopLoop();
    setDrag(null);
  }, [setDrag, stopLoop]);

  const onMarkerDragPointerDown = useCallback(
    (viewRowIndex: number, event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      // Shift+drag is always row-select (disambiguation rule above) — never arm the reorder path.
      if (event.shiftKey) return;
      if (!enabled) return;

      pendingRef.current = { row: viewRowIndex, startX: event.clientX, startY: event.clientY, pointerId: event.pointerId };
      pointerPointRef.current = { x: event.clientX, y: event.clientY };

      const handleMove = (e: PointerEvent) => {
        const pending = pendingRef.current;
        if (!pending || e.pointerId !== pending.pointerId) return;
        pointerPointRef.current = { x: e.clientX, y: e.clientY };

        if (!dragStateRef.current) {
          // not yet armed: only commit to reorder once the vertical move exceeds the threshold
          // AND has left the origin row (hitTest resolves to a different row).
          const dy = Math.abs(e.clientY - pending.startY);
          if (dy < REORDER_THRESHOLD) return;
          const hit = argsRef.current.hitTestRow(e.clientX, e.clientY);
          if (!hit || hit.row === pending.row) return;
          argsRef.current.onArm?.();
          setDrag({ draggingRow: pending.row, overRow: hit.row, position: hit.position });
          if (rafRef.current === null) rafRef.current = requestAnimationFrame(runFrame);
          return;
        }

        const hit = argsRef.current.hitTestRow(e.clientX, e.clientY);
        const prev = dragStateRef.current;
        setDrag({ ...prev, overRow: hit?.row ?? null, position: hit?.position ?? prev.position });
      };

      const handleUp = (e: PointerEvent) => {
        const pending = pendingRef.current;
        if (!pending || e.pointerId !== pending.pointerId) return;
        const finalState = dragStateRef.current;
        if (finalState && finalState.overRow !== null) {
          argsRef.current.onReorder(finalState.draggingRow, finalState.overRow, finalState.position);
        }
        teardown();
      };

      // Escape cancels the gesture in flight (no reorder, no selection side effects).
      const handleKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") teardown();
      };

      document.addEventListener("pointermove", handleMove);
      document.addEventListener("pointerup", handleUp);
      document.addEventListener("pointercancel", handleUp);
      document.addEventListener("keydown", handleKey);
      cleanupRef.current = () => {
        document.removeEventListener("pointermove", handleMove);
        document.removeEventListener("pointerup", handleUp);
        document.removeEventListener("pointercancel", handleUp);
        document.removeEventListener("keydown", handleKey);
      };
    },
    [enabled, runFrame, setDrag, teardown],
  );

  useEffect(() => teardown, [teardown]);

  return { onMarkerDragPointerDown, dragState };
}
