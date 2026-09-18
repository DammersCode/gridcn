"use client";

import { useLayoutEffect, type RefObject } from "react";
import { inlineDistanceFromEnd, inlineDistanceFromStart, inlineEndEdge, inlineStartEdge, type GridDirection } from "./direction";
import { gridAttrSelector } from "../data-attributes";

/**
 * Measures the ACTUAL rendered edge of the last pinned-left / first pinned-right HEADER cell and
 * writes it as `--grid-pin-shadow-left-x`/`-right-x` on `viewportRef`, instead of trusting a
 * JS-summed column-width total. CSS Grid rounds each track's flow position independently
 * (subpixel snapping), so a pinned cell's real rendered edge can drift a fraction of a px from
 * the sum of its own + preceding columns' declared widths — invisible with whole-px widths, but
 * visible (shadow "a hair off" the cell border) once resizing has produced fractional widths
 * across several pinned columns. Reading `getBoundingClientRect()` sidesteps the divergence
 * entirely: the shadow inherits the SAME rounded geometry the browser already gave the cell.
 * Header cells (not body cells) are the measurement source: they always render regardless of
 * `rowCount`/row virtualization, and are pixel-identical to body cells at the same column (same
 * grid template, same track).
 *
 * Re-measures on mount and on any resize of the boundary header cells (`ResizeObserver`) — a
 * pinned cell's on-screen position is scroll-independent (see pinned-inset-style.ts), so unlike
 * use-scrolled-edges.ts this never needs to run per scroll tick.
 */
export function usePinShadowEdges(
  viewportRef: RefObject<HTMLElement | null>,
  hasPinnedLeft: boolean,
  hasPinnedRight: boolean,
  direction: GridDirection = "ltr",
  /**
   * Serialized layout state: pins, marker width, column widths. `hasPinnedLeft` alone cannot drive
   * the re-measure - with a marker column present the band survives unpinning the last pinned
   * COLUMN, so the flag stays true across the change. The ResizeObserver below cannot cover it
   * either: adding a marker column MOVES the boundary header without resizing it or the viewport,
   * so no entry ever fires. Anything that can shift the boundary edge belongs in this string.
   */
  pinSignature: string = "",
): void {
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || (!hasPinnedLeft && !hasPinnedRight)) return;

    const write = () => {
      const viewportRect = viewport.getBoundingClientRect();
      // Both vars are consumed as inset-inline-start/-end offsets, so both are measured as inline
      // distances. getBoundingClientRect only reports physical edges, so which edge bounds the
      // pinned band inverts with direction: the last pinned-INLINE-START cell is the one furthest
      // from the inline start, i.e. largest `right` in LTR but smallest `left` in RTL.
      if (hasPinnedLeft) {
        const last = furthestFromInlineStart(viewport.querySelectorAll<HTMLElement>(`[role="columnheader"]${gridAttrSelector("pinned", "left")}`), direction);
        if (last) {
          const edge = inlineEndEdge(last.getBoundingClientRect(), direction);
          viewport.style.setProperty("--grid-pin-shadow-left-x", `${inlineDistanceFromStart(edge, viewportRect, direction)}px`);
        } else {
          // No pinned-left COLUMN, but the band still exists when a marker column is on. Leaving
          // a previously-measured value here strands the shadow at the unpinned column's old
          // edge; removing it hands the style back to its marker-width fallback.
          viewport.style.removeProperty("--grid-pin-shadow-left-x");
        }
      }
      if (hasPinnedRight) {
        const first = furthestFromInlineEnd(viewport.querySelectorAll<HTMLElement>(`[role="columnheader"]${gridAttrSelector("pinned", "right")}`), direction);
        if (first) {
          const edge = inlineStartEdge(first.getBoundingClientRect(), direction);
          viewport.style.setProperty("--grid-pin-shadow-right-x", `${inlineDistanceFromEnd(edge, viewportRect, direction)}px`);
        } else {
          viewport.style.removeProperty("--grid-pin-shadow-right-x");
        }
      }
    };

    write();
    // ResizeObserver is absent in jsdom/SSR (matches the same guard in use-row-window.ts) — the
    // mount-time write() above still runs, just without live re-measurement on resize there.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(write);
    observer.observe(viewport);
    // every header cell, not just the boundary ones: a PRECEDING column's resize shifts the
    // boundary cell's position without changing the boundary cell's own size, so its own
    // ResizeObserver entry alone would miss that — the header row as a whole is small (one row).
    for (const el of viewport.querySelectorAll<HTMLElement>('[role="columnheader"]')) observer.observe(el);
    return () => observer.disconnect();
    // viewportRef is a ref object; re-running is driven by .current/hasPinnedLeft/hasPinnedRight changing.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [viewportRef.current, hasPinnedLeft, hasPinnedRight, direction, pinSignature]);
}

/** The pinned-inline-start band's boundary cell: the one whose inline-end edge is furthest along the inline axis. */
function furthestFromInlineStart(cells: NodeListOf<HTMLElement>, direction: GridDirection): HTMLElement | undefined {
  let best: HTMLElement | undefined;
  let bestDistance = -Infinity;
  for (const cell of cells) {
    const rect = cell.getBoundingClientRect();
    // Compared against the cell's own rect, so this is a signed position on the inline axis; only
    // the ordering matters here, not the origin.
    const distance = direction === "rtl" ? -rect.left : rect.right;
    if (distance > bestDistance) {
      bestDistance = distance;
      best = cell;
    }
  }
  return best;
}

/** The pinned-inline-end band's boundary cell: the one whose inline-start edge comes earliest on the inline axis. */
function furthestFromInlineEnd(cells: NodeListOf<HTMLElement>, direction: GridDirection): HTMLElement | undefined {
  let best: HTMLElement | undefined;
  let bestDistance = Infinity;
  for (const cell of cells) {
    const rect = cell.getBoundingClientRect();
    const distance = direction === "rtl" ? -rect.right : rect.left;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = cell;
    }
  }
  return best;
}
