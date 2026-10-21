import { useEffect, useRef, type RefObject } from "react";
import { GRID_ATTR, gridAttrSelector } from "../data-attributes";
import { useDataGridStoreApi } from "../store";
import { getElementStore } from "./use-scroll-snapshot";

const ROW_SELECTOR = `[role="row"]:is(${gridAttrSelector("rowIndex")}, ${gridAttrSelector("pinnedRowIndex")})`;

/**
 * Marks the body row under the pointer with `data-hovered`. A CSS `:hover` rule on rows makes Chrome
 * restyle the rows that move under a resting pointer on every scroll tick; an attribute that only
 * moves between scroll bursts costs nothing per tick. A `viewIndex` or `rowHeight` change moves the rows under a
 * resting pointer (sort, filter, data, row height); the tint is then re-read from the pointer position. The store
 * subscription detects the change without a React render.
 */
export function useRowHover(scrollRef: RefObject<HTMLElement | null>, rowHeight: number): void {
  const storeApi = useDataGridStoreApi();
  const reevaluateRef = useRef<(() => void) | null>(null);
  const hoveredRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let frame = 0;
    let previousViewIndex = storeApi.getState().viewIndex;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => reevaluateRef.current?.());
    };
    schedule();
    const unsubscribe = storeApi.subscribe(() => {
      const { viewIndex } = storeApi.getState();
      const hoveredDetached = hoveredRef.current !== null && !hoveredRef.current.isConnected;
      if (viewIndex === previousViewIndex && !hoveredDetached) return;
      previousViewIndex = viewIndex;
      schedule();
    });
    return () => {
      unsubscribe();
      cancelAnimationFrame(frame);
    };
  }, [storeApi, rowHeight]);

  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;
    const store = getElementStore(scrollElement);
    let pointer: { x: number; y: number } | null = null;
    let wasScrolling = false;

    const rowOf = (target: Element | null) => {
      const row = target?.closest<HTMLElement>(ROW_SELECTOR) ?? null;
      return row !== null && row.closest('[role="grid"]') === scrollElement ? row : null;
    };

    const setHovered = (row: HTMLElement | null) => {
      if (row === hoveredRef.current) return;
      hoveredRef.current?.removeAttribute(GRID_ATTR.hovered);
      row?.setAttribute(GRID_ATTR.hovered, "");
      hoveredRef.current = row;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      pointer = { x: event.clientX, y: event.clientY };
      if (!store.getSnapshot().isScrolling) setHovered(rowOf(event.target as Element | null));
    };

    const onPointerLeave = () => {
      pointer = null;
      setHovered(null);
    };

    const reevaluate = () => {
      if (hoveredRef.current && !hoveredRef.current.isConnected) hoveredRef.current = null;
      if (pointer && !store.getSnapshot().isScrolling) setHovered(rowOf(document.elementFromPoint(pointer.x, pointer.y)));
    };
    reevaluateRef.current = reevaluate;

    const onSnapshot = () => {
      const { isScrolling } = store.getSnapshot();
      if (isScrolling === wasScrolling) return;
      wasScrolling = isScrolling;
      if (!isScrolling) reevaluate();
    };

    scrollElement.addEventListener("pointermove", onPointerMove, { passive: true });
    scrollElement.addEventListener("pointerleave", onPointerLeave, { passive: true });
    const unsubscribe = store.subscribe(onSnapshot);
    return () => {
      scrollElement.removeEventListener("pointermove", onPointerMove);
      scrollElement.removeEventListener("pointerleave", onPointerLeave);
      unsubscribe();
      reevaluateRef.current = null;
      setHovered(null);
    };
  }, [scrollRef]);
}
