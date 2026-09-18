import type { CSSProperties } from "react";
import type { AnyColumnDef } from "../store";

/** Pinned-cell inset style: position:relative works under a transformed ancestor, `position:sticky` doesn't (checklist step 5). */
export function pinnedInsetStyle(
  pinned: AnyColumnDef["pin"] | undefined,
  index: number,
): CSSProperties {
  if (!pinned) return {};
  if (pinned === "left") {
    // Cell's flow position is trackLeft, then the ancestor canvas applies -scrollLeft; to land the
    // cell at the static offset regardless of scroll, add scrollLeft back and cancel trackLeft.
    return {
      position: "relative",
      insetInlineStart: `calc(var(--grid-scroll-left, 0px) + var(--grid-pin-left-${index}) - var(--grid-track-left-${index}))`,
    };
  }
  // Pin-right: the cell's right edge must sit `staticRightOffset` from the viewport's right edge,
  // but only floats to that edge once content actually overflows it — diceui's rule — via
  // min(viewportWidth, contentWidth), else it hugs the content's own right edge (no dead gap).
  // rendered_left = trackLeft - scrollLeft + insetInlineStart (canvas transform + this cell's own inset).
  // Solve rendered_left = min(viewportWidth, contentWidth) - staticRightOffset - cellWidth for
  // insetInlineStart, and simplify trackLeft + cellWidth = trackRight:
  //   insetInlineStart = scrollLeft + min(viewportWidth, contentWidth) - staticRightOffset - trackRight
  return {
    position: "relative",
    insetInlineStart: `calc(var(--grid-scroll-left, 0px) + min(var(--grid-viewport-width), var(--grid-content-width)) - var(--grid-pin-right-${index}) - var(--grid-track-right-${index}))`,
  };
}
