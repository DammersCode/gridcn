import { useEffect, type RefObject } from "react";
import { GRID_ATTR, gridAttrSelector } from "../data-attributes";
import { getElementStore } from "./use-scroll-snapshot";

const ROW_SELECTOR = `[role="row"]${gridAttrSelector("rowIndex")}`;

/**
 * Marks the body row under the pointer with `data-hovered`. A CSS `:hover` rule on rows makes Chrome
 * restyle the rows that move under a resting pointer on every scroll tick; an attribute that only
 * moves between scroll bursts costs nothing per tick.
 */
export function useRowHover(scrollRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;
    const store = getElementStore(scrollElement);
    let hovered: HTMLElement | null = null;
    let pointer: { x: number; y: number } | null = null;
    let wasScrolling = false;

    const rowOf = (target: Element | null) => {
      const row = target?.closest<HTMLElement>(ROW_SELECTOR) ?? null;
      return row !== null && row.closest('[role="grid"]') === scrollElement ? row : null;
    };

    const setHovered = (row: HTMLElement | null) => {
      if (row === hovered) return;
      hovered?.removeAttribute(GRID_ATTR.hovered);
      row?.setAttribute(GRID_ATTR.hovered, "");
      hovered = row;
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

    const onSnapshot = () => {
      const { isScrolling } = store.getSnapshot();
      const settled = wasScrolling && !isScrolling;
      wasScrolling = isScrolling;
      if (settled && pointer) setHovered(rowOf(document.elementFromPoint(pointer.x, pointer.y)));
    };

    scrollElement.addEventListener("pointermove", onPointerMove, { passive: true });
    scrollElement.addEventListener("pointerleave", onPointerLeave, { passive: true });
    const unsubscribe = store.subscribe(onSnapshot);
    return () => {
      scrollElement.removeEventListener("pointermove", onPointerMove);
      scrollElement.removeEventListener("pointerleave", onPointerLeave);
      unsubscribe();
      setHovered(null);
    };
  }, [scrollRef]);
}
