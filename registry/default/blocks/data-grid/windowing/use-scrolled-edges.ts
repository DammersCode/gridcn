"use client";

import { useEffect, type RefObject } from "react";
import { getElementStore } from "./use-scroll-snapshot";
import { normalizeScrollLeft } from "./direction";
import { GRID_ATTR } from "../data-attributes";

/** 1px slack so float rounding at exactly 0 / max doesn't flicker the shadow on/off. */
const EDGE_EPSILON = 1;

/**
 * Writes `data-scrolled-left`/`data-scrolled-right`/`data-scrolled-top`/`data-scrolled-bottom`
 * directly onto `viewportRef`'s element on every scroll tick — imperative DOM writes, no React
 * state, no per-tick re-render (PLAN §6 pinned-edge shadow spec: "no React per tick", matching the
 * existing `--grid-scroll-*` var writer in use-row-window.ts). CSS reads these attributes to
 * show/hide a pinned boundary's shadow only when there's actually content scrolled beneath it on
 * that side — `data-scrolled-top`/`-bottom` back the pinned ROW band shadow (PLAN §3), the "content
 * actually scrolled beneath" gate this hook already established for pinned columns, reused verbatim
 * on the vertical axis.
 */
export function useScrolledEdges(
  scrollRef: RefObject<HTMLElement | null>,
  viewportRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const scrollElement = scrollRef.current;
    const viewport = viewportRef.current;
    if (!scrollElement || !viewport) return;
    const store = getElementStore(scrollElement);

    const write = () => {
      const snapshot = store.getSnapshot();
      const { scrollTop, clientWidth, clientHeight } = snapshot;
      // Normalized once, here, onto the positive inline-start axis — after which "> 0" means
      // "scrolled away from the inline start" in BOTH directions and nothing re-branches on
      // direction. The two attributes stay named left/right because the CSS selectors that read
      // them sit on elements already positioned with inset-inline-*, which mirror themselves.
      const scrollLeft = normalizeScrollLeft(snapshot.scrollLeft);
      // Read off the snapshot, not the element — the element's geometry was already read once (and
      // possibly dirtied by a same-tick style write) upstream in commit(); a second direct read here
      // would force a redundant reflow (2026-08-02 optimization audit, confirmed medium).
      const maxLeft = snapshot.scrollWidth - clientWidth;
      const maxTop = snapshot.scrollHeight - clientHeight;
      if (scrollLeft > EDGE_EPSILON) viewport.setAttribute(GRID_ATTR.scrolledLeft, "");
      else viewport.removeAttribute(GRID_ATTR.scrolledLeft);
      if (scrollLeft < maxLeft - EDGE_EPSILON) viewport.setAttribute(GRID_ATTR.scrolledRight, "");
      else viewport.removeAttribute(GRID_ATTR.scrolledRight);
      if (scrollTop > EDGE_EPSILON) viewport.setAttribute(GRID_ATTR.scrolledTop, "");
      else viewport.removeAttribute(GRID_ATTR.scrolledTop);
      if (scrollTop < maxTop - EDGE_EPSILON) viewport.setAttribute(GRID_ATTR.scrolledBottom, "");
      else viewport.removeAttribute(GRID_ATTR.scrolledBottom);
    };

    write();
    return store.subscribe(write);
    // scrollRef/viewportRef are ref objects; re-subscribing is driven by their .current changing, not identity.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRef.current, viewportRef.current]);
}
