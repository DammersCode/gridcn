import { type ColumnPin, type ViewCoord } from "../types";
import { applyInlineScrollDelta, inlineStartX, normalizeScrollLeft, type GridDirection } from "../virtualization/direction";

/** Column/row layout the interaction hook needs to translate pointer px <-> view coords and to scroll a cell into view. */
export type InteractionLayout = {
  /** Cumulative left edge (px) of each visible column's track, data-space index. */
  trackLefts: readonly number[];
  /** Cumulative right edge (px) of each visible column's track, data-space index. */
  trackRights: readonly number[];
  rowHeight: number;
  /** Offset (px) from the scroll element's top to where data row 0 starts: the sticky header track PLUS any pinned-top row band. NOT the header track alone (that's the root context's `headerHeight`). */
  dataRowTop: number;
  /** Pinned-bottom row band height (px) — the effective viewport bottom is `clientHeight - pinnedBottomHeight`. 0 when there's no pinned-bottom band. */
  pinnedBottomHeight: number;
  /** Total pinned-left band width in px (cells must stay clear of this on the left). */
  pinnedLeftWidth: number;
  /** Total pinned-right band width in px (cells must stay clear of this on the right). */
  pinnedRightWidth: number;
  /** Per-column pin state, same order/index as trackLefts/trackRights — lets pointer math hit-test the static pinned bands instead of the scrolled content space. */
  pins: readonly (ColumnPin | undefined)[];
  /**
   * Layout direction of the grid. Every physical pointer coordinate is converted to the
   * inline-start-relative axis this layout's offsets are expressed in before any hit-test runs, so
   * the math below is direction-agnostic. Defaults to `"ltr"` when a caller omits it.
   */
  direction?: GridDirection;
};

/**
 * Resolves the view-index column index under `inlineX` — the pointer's distance from the viewport's
 * INLINE-START edge (the left edge in LTR, the right edge in RTL), not a physical screen x. Pinned
 * columns render at a fixed inline offset independent of scrollLeft (see pinnedInsetStyle), so
 * they're hit-tested directly in that space; only the unpinned middle band needs the content-space
 * (scrollLeft-adjusted) `contentX`.
 *
 * Because both inputs are already inline-start-relative and every offset this compares against
 * (trackLefts/trackRights/pin widths) is too, this function has no direction awareness of its own —
 * pointerToCoord normalizes at the seam and everything here is shared by both directions.
 *
 * All interval tests are half-open (`>= start && < end`) so a pointer exactly on the boundary two
 * cells share always resolves to the later one, in both directions. RTL's fractional layout can
 * land a point precisely on such an edge where LTR would not, so this is what keeps the resolution
 * deterministic rather than a coin flip on sub-pixel rounding.
 */
function columnAtX(
  inlineX: number,
  contentX: number,
  trackLefts: readonly number[],
  trackRights: readonly number[],
  pins: readonly (ColumnPin | undefined)[],
  pinnedLeftWidth: number,
  viewportWidth: number,
  pinnedRightWidth: number,
): number {
  if (inlineX < pinnedLeftWidth) {
    // pinned-left band: inline-start offset equals the cumulative pinned-left width prefix,
    // which is numerically the same as trackLefts/trackRights restricted to that prefix.
    // trackLefts/trackRights/pins are same-length parallel arrays (built together by the caller)
    for (let i = 0; i < trackLefts.length; i++) {
      if (pins[i] === "start" && inlineX >= trackLefts[i]! && inlineX < trackRights[i]!) return i;
    }
  } else if (inlineX >= viewportWidth - pinnedRightWidth) {
    // pinned-right band: mirror the same static-position reasoning from the inline-END edge.
    const fromRight = viewportWidth - inlineX;
    let acc = 0;
    for (let i = trackLefts.length - 1; i >= 0; i--) {
      if (pins[i] !== "end") continue;
      const width = trackRights[i]! - trackLefts[i]!;
      if (fromRight >= acc && fromRight < acc + width) return i;
      acc += width;
    }
  }
  for (let i = 0; i < trackLefts.length; i++) {
    if (pins[i]) continue;
    if (contentX >= trackLefts[i]! && contentX < trackRights[i]!) return i;
  }
  if (trackLefts.length === 0) return 0;
  return contentX < trackLefts[0]! ? 0 : trackLefts.length - 1;
}

/** Resolves the view-index row index at content-space `y` (already offset by scrollTop, header-relative). */
function rowAtY(y: number, rowHeight: number, rowCount: number): number {
  const row = Math.floor(y / rowHeight);
  return Math.max(0, Math.min(row, Math.max(0, rowCount - 1)));
}

/**
 * Maps a pointer event's viewport-relative position to a view-index cell coord using the current
 * scroll offsets. The SDK exports it for add-on authors.
 */
export function pointerToCoord(
  clientX: number,
  clientY: number,
  scrollElement: HTMLElement,
  layout: InteractionLayout,
  rowCount: number,
): ViewCoord {
  const rect = scrollElement.getBoundingClientRect();
  // The direction seam for all pointer input: past these two lines every x is inline-start-relative
  // and matches the space trackLefts/trackRights/pin widths are already expressed in, so no
  // hit-testing below this point knows or asks about direction.
  const inlineX = inlineStartX(clientX, rect, layout.direction ?? "ltr");
  const contentX = inlineX + normalizeScrollLeft(scrollElement.scrollLeft);
  const y = clientY - rect.top - layout.dataRowTop + scrollElement.scrollTop;
  const col = columnAtX(
    inlineX,
    contentX,
    layout.trackLefts,
    layout.trackRights,
    layout.pins,
    layout.pinnedLeftWidth,
    scrollElement.clientWidth,
    layout.pinnedRightWidth,
  );
  const row = rowAtY(y, layout.rowHeight, rowCount);
  return { col, row };
}

/**
 * Imperatively scrolls the container so `coord` is visible (nearest behavior), honoring the
 * pinned-left/right bands. Never uses `scrollIntoView` — cells live in the transformed
 * sticky-viewport layer, so only direct `scrollTop`/`scrollLeft` writes are architecturally safe.
 */
export function scrollCellIntoView(scrollElement: HTMLElement, coord: ViewCoord, layout: InteractionLayout): void {
  const { trackLefts, trackRights, rowHeight, dataRowTop, pinnedBottomHeight, pinnedLeftWidth, pinnedRightWidth } = layout;
  const cellTop = coord.row * rowHeight;
  const cellBottom = cellTop + rowHeight;
  const viewTop = scrollElement.scrollTop;
  const viewBottom = viewTop + scrollElement.clientHeight - dataRowTop - pinnedBottomHeight;

  let nextScrollTop: number | null = null;
  if (cellTop < viewTop) nextScrollTop = cellTop;
  else if (cellBottom > viewBottom) nextScrollTop = cellBottom - (scrollElement.clientHeight - dataRowTop - pinnedBottomHeight);

  // Inline axis in normalized (positive, inline-start-relative) space, the same space trackLefts
  // and the pin widths live in — so the visibility test itself is shared by both directions.
  const scrollLeft = normalizeScrollLeft(scrollElement.scrollLeft);
  const cellLeft = trackLefts[coord.col] ?? 0;
  const cellRight = trackRights[coord.col] ?? cellLeft;
  const viewLeft = scrollLeft + pinnedLeftWidth;
  const viewRight = scrollLeft + scrollElement.clientWidth - pinnedRightWidth;

  let nextScrollLeft: number | null = null;
  if (cellLeft < viewLeft) nextScrollLeft = cellLeft - pinnedLeftWidth;
  else if (cellRight > viewRight) nextScrollLeft = cellRight - (scrollElement.clientWidth - pinnedRightWidth);

  if (nextScrollTop !== null) scrollElement.scrollTop = Math.max(0, nextScrollTop);
  if (nextScrollLeft !== null) {
    // Applied as a RELATIVE inline delta rather than an absolute write: `scrollLeft` means
    // different things in each direction (RTL runs negative), and a relative move is correct in
    // both without this function ever reconstructing the container's own convention. The
    // Math.max(0, …) floor the absolute write needed would have pinned RTL scrolling to zero.
    applyInlineScrollDelta(scrollElement, Math.max(0, nextScrollLeft) - scrollLeft, layout.direction ?? "ltr");
  }
}