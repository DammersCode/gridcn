"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import type { CellCoord } from "../types";
import { isPrintableKey, matchKeymap, type KeymapEvent } from "../keyboard";
import type { Keymap } from "../types";
import { getCellValue } from "../columns/column-helpers";
import {
  getFocusCell,
  useDataGridActions,
  useDataGridStoreApi,
  type DataGridStoreState,
} from "../store";
import {
  AUTO_SCROLL_STEP,
  AUTO_SCROLL_ZONE,
  applyInlineScrollDelta,
  inlineAutoScrollStep,
  inlineStartX,
  normalizeScrollLeft,
  visualArrowKey,
  type GridDirection,
} from "../windowing/direction";
import { gridAttrSelector } from "../data-attributes";
import { isSelectionEmpty } from "../selection";

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
  pins: readonly (("left" | "right") | undefined)[];
  /**
   * Layout direction of the grid. Every physical pointer coordinate is converted to the
   * inline-start-relative axis this layout's offsets are expressed in before any hit-test runs, so
   * the math below is direction-agnostic. Defaults to `"ltr"` when a caller omits it.
   */
  direction?: GridDirection;
};

/** Options for {@link useGridInteraction}. */
export type UseGridInteractionOptions = {
  scrollRef: RefObject<HTMLElement | null>;
  layout: InteractionLayout;
  keymap: Keymap;
  readOnly?: boolean;
  /** mod+D — wired to the `data-grid-fill` add-on's fillDown; absent (add-on not installed) it's a no-op. */
  fillDown?: () => void;
  /** mod+R — wired to the `data-grid-fill` add-on's fillRight; absent it's a no-op. */
  fillRight?: () => void;
  /** Escape — wired to the `data-grid-fill` add-on's cancelDrag, so it aborts an in-progress fill drag too; absent it's a no-op. */
  cancelFillDrag?: () => void;
};

function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  // userAgentData is the modern replacement for the deprecated `platform`; both are checked for jsdom/older browsers.
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const platform = uaData?.platform ?? navigator.platform ?? "";
  return /mac/i.test(platform);
}

/**
 * Resolves the view-space column index under `inlineX` — the pointer's distance from the viewport's
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
  pins: readonly (("left" | "right") | undefined)[],
  pinnedLeftWidth: number,
  viewportWidth: number,
  pinnedRightWidth: number,
): number {
  if (inlineX < pinnedLeftWidth) {
    // pinned-left band: inline-start offset equals the cumulative pinned-left width prefix,
    // which is numerically the same as trackLefts/trackRights restricted to that prefix.
    // trackLefts/trackRights/pins are same-length parallel arrays (built together by the caller)
    for (let i = 0; i < trackLefts.length; i++) {
      if (pins[i] === "left" && inlineX >= trackLefts[i]! && inlineX < trackRights[i]!) return i;
    }
  } else if (inlineX >= viewportWidth - pinnedRightWidth) {
    // pinned-right band: mirror the same static-position reasoning from the inline-END edge.
    const fromRight = viewportWidth - inlineX;
    let acc = 0;
    for (let i = trackLefts.length - 1; i >= 0; i--) {
      if (pins[i] !== "right") continue;
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

/** Resolves the view-space row index at content-space `y` (already offset by scrollTop, header-relative). */
function rowAtY(y: number, rowHeight: number, rowCount: number): number {
  const row = Math.floor(y / rowHeight);
  return Math.max(0, Math.min(row, Math.max(0, rowCount - 1)));
}

/**
 * Maps a pointer event's viewport-relative position to a view-space cell coord using the current
 * scroll offsets. Exported for direct unit testing of the pinned-column hit-testing math; not part
 * of the public hook surface.
 */
export function pointerToCoord(
  clientX: number,
  clientY: number,
  scrollElement: HTMLElement,
  layout: InteractionLayout,
  rowCount: number,
): CellCoord {
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
function scrollCellIntoView(scrollElement: HTMLElement, coord: CellCoord, layout: InteractionLayout): void {
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

/** True when `coord`'s column is the `checkbox` type — those cells have no edit mode; interactions toggle the value directly instead of calling `startEditing` (diceui-editing-spec.md item 6). */
function isCheckboxCell(state: DataGridStoreState, coord: CellCoord): boolean {
  return state.visibleColumns[coord.col]?.type === "checkbox";
}

/** Toggles a checkbox cell's boolean value in place via the direct-write commit path (no edit session, no move). No-op for a readOnly column, an unresolvable row, or a non-checkbox column. */
function toggleCheckboxCell(state: DataGridStoreState, actions: ReturnType<typeof useDataGridActions>, coord: CellCoord): void {
  const column = state.visibleColumns[coord.col];
  if (!column || column.type !== "checkbox") return;
  const dataRowIndex = state.viewIndex[coord.row];
  const row = dataRowIndex === undefined ? undefined : state.data[dataRowIndex];
  if (row === undefined) return;
  const readOnly = typeof column.readOnly === "function" ? column.readOnly(row) : Boolean(column.readOnly);
  if (readOnly) return;
  // explicit TData=unknown: row's `undefined`-narrowed type ({} | null) would otherwise drive inference instead of column's own already-unknown TData.
  const value = getCellValue<unknown, typeof column>(row, column);
  actions.commitCellValue(coord, !value);
}

/** Direction for a data-boundary (Ctrl/Cmd+Arrow) jump. */
export type JumpDirection = "up" | "down" | "left" | "right";

/**
 * Excel-style Ctrl/Cmd+Arrow "jump to data boundary": from `active`, scans view rows/columns in
 * `direction` using the cell type's `isEmpty`. If the next cell is non-empty, jumps to the last
 * non-empty cell of the contiguous run; if the next cell is empty, jumps to the first non-empty
 * cell found (or the grid edge if none). Clamped at the grid edges either way.
 * Exported for direct unit testing of the boundary-scan math; not part of the public hook surface.
 */
export function jumpToDataBoundary(state: DataGridStoreState, active: CellCoord, direction: JumpDirection): CellCoord {
  const rowCount = state.viewIndex.length;
  const colCount = state.visibleColumns.length;
  const dx = direction === "left" ? -1 : direction === "right" ? 1 : 0;
  const dy = direction === "up" ? -1 : direction === "down" ? 1 : 0;

  const isEmptyAt = (coord: CellCoord): boolean => {
    const column = state.visibleColumns[coord.col];
    if (!column) return true;
    const dataRowIndex = state.viewIndex[coord.row];
    const row = dataRowIndex === undefined ? undefined : state.data[dataRowIndex];
    if (row === undefined) return true;
    const cellType = state.cellTypes[column.type ?? "text"];
    if (!cellType) return true;
    // explicit TData=unknown: row's `undefined`-narrowed type ({} | null) would otherwise drive inference instead of column's own already-unknown TData.
    const value = getCellValue<unknown, typeof column>(row, column);
    return cellType.isEmpty(value);
  };

  const inBounds = (coord: CellCoord): boolean =>
    coord.col >= 0 && coord.col < colCount && coord.row >= 0 && coord.row < rowCount;

  const clampToEdge = (): CellCoord => {
    // no data at all beyond `active` in this direction: land on the grid edge
    let coord = active;
    while (inBounds({ col: coord.col + dx, row: coord.row + dy })) {
      coord = { col: coord.col + dx, row: coord.row + dy };
    }
    return coord;
  };

  const next = { col: active.col + dx, row: active.row + dy };
  if (!inBounds(next)) return active;

  if (!isEmptyAt(next)) {
    // scan the contiguous non-empty run, land on the last non-empty cell before an empty one or the edge
    let coord = next;
    while (true) {
      const after = { col: coord.col + dx, row: coord.row + dy };
      if (!inBounds(after) || isEmptyAt(after)) return coord;
      coord = after;
    }
  }

  // next is empty: scan forward for the first non-empty cell; else land on the grid edge
  let coord = next;
  while (inBounds(coord)) {
    if (!isEmptyAt(coord)) return coord;
    const after = { col: coord.col + dx, row: coord.row + dy };
    if (!inBounds(after)) return clampToEdge();
    coord = after;
  }
  return clampToEdge();
}

/** Move/extend actions that resolve through {@link MOVE_DELTA} — kept as its own union so the map is total (no `!` needed at the call site). */
type MoveAction = "moveUp" | "moveDown" | "moveLeft" | "moveRight" | "retainMoveUp" | "retainMoveDown" | "retainMoveLeft" | "retainMoveRight" | "extendUp" | "extendDown" | "extendLeft" | "extendRight";

/** Jump/extend-jump actions that resolve through {@link JUMP_DIRECTION} — kept as its own union so the map is total (no `!` needed at the call site). */
type JumpAction = "jumpUp" | "jumpDown" | "jumpLeft" | "jumpRight" | "extendJumpUp" | "extendJumpDown" | "extendJumpLeft" | "extendJumpRight";

/** Movement deltas for the plain move* / extend* actions. */
const MOVE_DELTA: Record<MoveAction, { dx: number; dy: number }> = {
  moveUp: { dx: 0, dy: -1 },
  moveDown: { dx: 0, dy: 1 },
  moveLeft: { dx: -1, dy: 0 },
  moveRight: { dx: 1, dy: 0 },
  retainMoveUp: { dx: 0, dy: -1 },
  retainMoveDown: { dx: 0, dy: 1 },
  retainMoveLeft: { dx: -1, dy: 0 },
  retainMoveRight: { dx: 1, dy: 0 },
  extendUp: { dx: 0, dy: -1 },
  extendDown: { dx: 0, dy: 1 },
  extendLeft: { dx: -1, dy: 0 },
  extendRight: { dx: 1, dy: 0 },
};

const JUMP_DIRECTION: Record<JumpAction, JumpDirection> = {
  jumpUp: "up",
  jumpDown: "down",
  jumpLeft: "left",
  jumpRight: "right",
  extendJumpUp: "up",
  extendJumpDown: "down",
  extendJumpLeft: "left",
  extendJumpRight: "right",
};

/** Handlers + drag state wiring for keyboard nav, mouse selection, and editing lifecycle (see research/glide-behavior-spec.md §2-3). */
export type GridInteractionHandlers = {
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  /** Attach to each rendered cell's pointerdown. */
  onCellPointerDown: (coord: CellCoord, event: ReactPointerEvent<HTMLElement>) => void;
  /** Attach to each rendered cell's click — resolves the deferred active-cell click action. */
  onCellClick: (coord: CellCoord, event: ReactMouseEvent<HTMLElement>) => void;
  /** Attach to each rendered cell's dblclick. */
  onCellDoubleClick: (coord: CellCoord, event: ReactMouseEvent<HTMLElement>) => void;
  /**
   * Attach to a header cell's pointerdown: resolves the plain/shift/ctrl click-select gesture
   * immediately (glide-behavior-spec.md §3 "Header clicks") and starts a column-range drag so a
   * press+drag across headers selects the contiguous range (§3 "Drag"). Entirely a no-op —
   * including no drag/capture — when `enableColumnSelection` is false.
   */
  onHeaderPointerDown: (columnIndex: number, event: ReactPointerEvent<HTMLElement>) => void;
  /**
   * Attach to a marker cell's pointerdown: same plain/shift/ctrl resolution + drag-start as
   * {@link onHeaderPointerDown}, on the rows channel (glide-behavior-spec.md §3 "Row-marker clicks").
   * No-op when `enableRowSelection` is false.
   */
   onMarkerPointerDown: (viewRowIndex: number, event: ReactPointerEvent<HTMLElement>) => void;
  /**
   * Attach to the marker's grip pointerdown (the reorder family's reorder zone). Resolves the
   * plain/ctrl click-select immediately (a stationary press selects the row) but NEVER starts
   * the row-range drag — the row-reorder hook owns the pointer movement, so a press that moves
   * reorders and a stationary release leaves exactly this press's selection. A <kbd>Shift</kbd>
   * press takes the full {@link onMarkerPointerDown} gesture instead (shift+drag is always the
   * row-select range). No-op selection-wise when `enableRowSelection` is false.
   */
  onMarkerGripPointerDown: (viewRowIndex: number, event: ReactPointerEvent<HTMLElement>) => void;
  /**
   * Attach to the marker's checkbox pointerdown ('checkbox'/'both' modes). Arms the same row-range
   * drag as {@link onMarkerPointerDown} (anchor + auto-scroll), but never touches the rows channel
   * itself on pointerdown — a stationary press still resolves as the checkbox's own native `click`
   * (Base UI's `onCheckedChange`, an additive membership toggle), while a press that moves extends
   * the row range exactly like a drag started elsewhere on the marker. This is what lets checkbox
   * markers drag-select at all: the checkbox no longer stops the pointerdown from propagating.
   */
  onMarkerCheckboxPointerDown: (viewRowIndex: number, event: ReactPointerEvent<HTMLElement>) => void;
  /** Attach to the root's pointerdown to clear selection on click-outside-cells. */
  onRootPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  /**
   * Ends an in-progress header column-select drag (mode "column") without affecting a cell/row
   * drag. Column reorder (use-column-reorder.ts) calls this the moment it arms, so the two
   * gestures started from the same header press never both apply once a reorder commits — see
   * that hook's JSDoc for the full disambiguation rule.
   */
   cancelColumnSelectDrag: () => void;
  /**
   * Imperatively scrolls the container so `coord` (view-space) is visible, honoring the
   * pinned-left/right bands. Public extension point for add-ons that move the active cell
   * programmatically, e.g. `data-grid-toolbar`'s search next/prev — never `scrollIntoView`
   * (see {@link scrollCellIntoView}'s own doc for why).
   */
  scrollCellIntoView: (coord: CellCoord) => void;
};

/**
 * Builds every pointer/keyboard handler the grid root and cells wire up, plus the imperative
 * scroll-into-view/drag-autoscroll machinery. One instance per `<DataGridRoot>` mount.
 */
export function useGridInteraction(options: UseGridInteractionOptions): GridInteractionHandlers {
  const { scrollRef, layout, keymap, readOnly, fillDown, fillRight, cancelFillDrag } = options;
  const actions = useDataGridActions();
  const storeApi = useDataGridStoreApi();
  const isMacRef = useRef(false);
  isMacRef.current = isMacPlatform();

  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // drag state lives in a ref, never React state — a drag never re-renders anything but the
  // overlay/active-cell subscribers that selection changes already touch. `anchor` is the
  // press-row for the row-marker drag: the pointer is the moving edge, so the range is always
  // exactly anchor..current (it can grow AND shrink as the pointer moves).
  const dragRef = useRef<{ pointerId: number; mode: "range" | "row" | "column"; anchor?: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);

  // Active-cell click deferred to native `click` — pointerdown alone can't distinguish it from a drag.
  const pendingActiveClickRef = useRef<CellCoord | null>(null);
  // Coord a single click just resolved, so the following dblclick (same gesture) doesn't re-resolve it.
  const resolvedByClickRef = useRef<CellCoord | null>(null);

  const stopAutoScrollLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const runDragFrame = useCallback(() => {
    const scrollElement = scrollRef.current;
    const pointer = lastPointerRef.current;
    const drag = dragRef.current;
    if (!scrollElement || !pointer || !drag) {
      rafRef.current = null;
      return;
    }
    const rect = scrollElement.getBoundingClientRect();

    // auto-scroll the container by a fixed step per frame while the pointer sits beyond an edge
    if (pointer.clientY < rect.top + AUTO_SCROLL_ZONE) scrollElement.scrollTop -= AUTO_SCROLL_STEP;
    else if (pointer.clientY > rect.bottom - AUTO_SCROLL_ZONE) scrollElement.scrollTop += AUTO_SCROLL_STEP;
    // Which physical edge means "scroll toward the inline start" depends on direction; the step is
    // then applied in the container's own scrollLeft convention.
    const direction = layoutRef.current.direction ?? "ltr";
    const inlineStep = inlineAutoScrollStep(pointer.clientX, rect, AUTO_SCROLL_ZONE, direction);
    if (inlineStep !== 0) applyInlineScrollDelta(scrollElement, inlineStep * AUTO_SCROLL_STEP, direction);

    const state = storeApi.getState();
    const rowCount = state.viewIndex.length;
    const coord = pointerToCoord(pointer.clientX, pointer.clientY, scrollElement, layoutRef.current, rowCount);
    const clamped = {
      col: Math.max(0, Math.min(coord.col, Math.max(0, state.visibleColumns.length - 1))),
      row: Math.max(0, Math.min(coord.row, Math.max(0, rowCount - 1))),
    };

    if (drag.mode === "range") actions.extendTo(clamped);
    else if (drag.mode === "row") {
      // A plain marker drag (anchor set) replaces the row channel with exactly anchor..current, so
      // dragging back over selected rows shrinks the range; a shift/ctrl press (anchor undefined)
      // keeps the old union-extend, so an additive multi-selection is never clobbered.
      actions.selectRow(clamped.row, drag.anchor !== undefined ? { replaceFromLast: true, from: drag.anchor } : { extendFromLast: true });
    } else actions.selectColumn(clamped.col, { extendFromLast: true });

    rafRef.current = requestAnimationFrame(runDragFrame);
  }, [actions, scrollRef, storeApi]);

  // pointermove/pointerup are attached to `document` only for the lifetime of an active drag —
  // beginDrag attaches them, endDrag tears them down immediately, instead of a permanent
  // always-on subscription.
  const documentListenersRef = useRef<(() => void) | null>(null);

  // The element that took setPointerCapture for the active drag; released explicitly on end
  // rather than relying on the browser's implicit release, which some environments (real
  // Chromium via Playwright) don't reliably fire before a later, unrelated click gesture —
  // a stale capture otherwise swallows that next gesture's pointerup/click on its real target
  // (e.g. an option in a portaled Select popup opened right after this cell's click).
  const captureElementRef = useRef<Element | null>(null);

  const endDrag = useCallback(() => {
    const pointerId = dragRef.current?.pointerId;
    const captureEl = captureElementRef.current as (Element & { hasPointerCapture?: (id: number) => boolean; releasePointerCapture?: (id: number) => void }) | null;
    if (captureEl && pointerId !== undefined && captureEl.hasPointerCapture?.(pointerId)) {
      captureEl.releasePointerCapture?.(pointerId);
    }
    captureElementRef.current = null;
    dragRef.current = null;
    lastPointerRef.current = null;
    stopAutoScrollLoop();
    documentListenersRef.current?.();
    documentListenersRef.current = null;
  }, [stopAutoScrollLoop]);

  const beginDrag = useCallback(
    (mode: "range" | "row" | "column", pointerId: number, captureElement?: Element, anchor?: number) => {
      dragRef.current = { pointerId, mode, anchor };
      captureElementRef.current = captureElement ?? null;
      if (rafRef.current === null) rafRef.current = requestAnimationFrame(runDragFrame);

      if (!documentListenersRef.current) {
        const onMove = (event: PointerEvent) => {
          if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
          lastPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
          // the frame loop kills itself when no move has arrived yet (slow press-then-drag) —
          // restart it here or a drag whose first move lands after frame 1 never paints (user QA).
          if (rafRef.current === null) rafRef.current = requestAnimationFrame(runDragFrame);
        };
        const onUp = (event: PointerEvent) => {
          if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
          endDrag();
        };
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
        document.addEventListener("pointercancel", onUp);
        documentListenersRef.current = () => {
          document.removeEventListener("pointermove", onMove);
          document.removeEventListener("pointerup", onUp);
          document.removeEventListener("pointercancel", onUp);
        };
      }
    },
    [runDragFrame, endDrag],
  );

  // safety net: tear down a still-active drag's listeners/rAF if the component unmounts mid-drag
  useEffect(() => () => documentListenersRef.current?.(), []);

  const scrollActiveCellIntoView = useCallback(
    (coord: CellCoord) => {
      const scrollElement = scrollRef.current;
      if (!scrollElement) return;
      scrollCellIntoView(scrollElement, coord, layoutRef.current);
    },
    [scrollRef],
  );

  const moveAndScroll = useCallback(
    (d: { dx: number; dy: number }, opts?: { extend?: boolean; retain?: boolean }) => {
      actions._moveActiveCell(d, opts);
      // extend keeps activeCell pinned at the anchor — scroll the growing selection's edge instead.
      const next = getFocusCell(storeApi.getState());
      if (next) scrollActiveCellIntoView(next);
    },
    [actions, scrollActiveCellIntoView, storeApi],
  );

  const jumpAndScroll = useCallback(
    (direction: JumpDirection, opts?: { extend?: boolean }) => {
      const state = storeApi.getState();
      const active = state.activeCell ?? { col: 0, row: 0 };
      const target = jumpToDataBoundary(state, active, direction);
      if (opts?.extend) actions.extendTo(target);
      else actions.selectCell(target);
      scrollActiveCellIntoView(target);
    },
    [actions, scrollActiveCellIntoView, storeApi],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.nativeEvent.isComposing) return;

      // A commit/cancel keystroke (e.g. Enter) handled by the editor's own onKeyDown already
      // updated the store (ending edit mode) before this bubbled handler runs on the same
      // native event; re-checking store.editing here would then be stale and re-dispatch the
      // same key against the *new* active cell (e.g. re-opening the editor it just moved to).
      // The editor is the only thing that renders a focusable form control inside a cell, so
      // this key having originated from one means it belongs to that (possibly just-finished) edit.
      const target = event.target as HTMLElement | null;
      if (target && target !== event.currentTarget && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;

      const state = storeApi.getState();
      const editing = state.editing;
      // while editing, the editor owns every key (including its own Tab/Enter commit contract)
      if (editing) return;

      const keymapEvent: KeymapEvent = {
        // Arrow keys move VISUALLY: under RTL, ArrowRight goes to the next column on the screen,
        // which is the PREVIOUS column index. Swapping the KEY here — the one place a key becomes
        // an action — is what lets every navigation helper, and any consumer's custom keymap, stay
        // written in logical terms (moveLeft/moveRight/extendLeft/jumpLeft). Tab/Shift+Tab are not
        // swapped: they are already reading-order logical. Home/End need no swap either, since
        // moveRowStart/moveRowEnd are logically named and "row start" is column 0 in both directions.
        key: visualArrowKey(event.key, layoutRef.current.direction ?? "ltr"),
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
      };

      // unbound printable key = implicit editReplace trigger (Excel behavior); a consumer keymap that DEFINES editReplace (even []) takes it over and disables the fallback
      const action =
        matchKeymap(keymapEvent, keymap, isMacRef.current) ??
        (isPrintableKey(keymapEvent) && keymap.editReplace === undefined ? "editReplace" : null);

      if (!action) return;

      const rowCount = state.viewIndex.length;
      const colCount = state.visibleColumns.length;

      switch (action) {
        case "moveUp":
        case "moveDown":
        case "moveLeft":
        case "moveRight": {
          event.preventDefault();
          moveAndScroll(MOVE_DELTA[action]);
          break;
        }
        case "retainMoveUp":
        case "retainMoveDown":
        case "retainMoveLeft":
        case "retainMoveRight": {
          event.preventDefault();
          moveAndScroll(MOVE_DELTA[action], { retain: true });
          break;
        }
        case "scrollActiveIntoView": {
          event.preventDefault();
          const active = storeApi.getState().activeCell;
          if (active) scrollActiveCellIntoView(active);
          break;
        }
        // Outside an active edit (guarded above), Tab/Shift+Tab behave as plain
        // right/left navigation (glide-behavior-spec.md §2); only the editor's own
        // onKeyDown gives them their commit-and-move contract while editing.
        case "commitRight":
        case "commitLeft": {
          event.preventDefault();
          moveAndScroll({ dx: action === "commitRight" ? 1 : -1, dy: 0 });
          break;
        }
        case "extendUp":
        case "extendDown":
        case "extendLeft":
        case "extendRight": {
          event.preventDefault();
          moveAndScroll(MOVE_DELTA[action], { extend: true });
          break;
        }
        case "jumpUp":
        case "jumpDown":
        case "jumpLeft":
        case "jumpRight": {
          event.preventDefault();
          jumpAndScroll(JUMP_DIRECTION[action]);
          break;
        }
        case "extendJumpUp":
        case "extendJumpDown":
        case "extendJumpLeft":
        case "extendJumpRight": {
          event.preventDefault();
          jumpAndScroll(JUMP_DIRECTION[action], { extend: true });
          break;
        }
        case "moveRowStart": {
          event.preventDefault();
          const active = state.activeCell ?? { col: 0, row: 0 };
          const target = { col: 0, row: active.row };
          actions.selectCell(target);
          scrollActiveCellIntoView(target);
          break;
        }
        case "moveRowEnd": {
          event.preventDefault();
          const active = state.activeCell ?? { col: 0, row: 0 };
          const target = { col: Math.max(0, colCount - 1), row: active.row };
          actions.selectCell(target);
          scrollActiveCellIntoView(target);
          break;
        }
        case "moveFirstCell": {
          event.preventDefault();
          const target = { col: 0, row: 0 };
          actions.selectCell(target);
          scrollActiveCellIntoView(target);
          break;
        }
        case "moveLastCell": {
          event.preventDefault();
          const target = { col: Math.max(0, colCount - 1), row: Math.max(0, rowCount - 1) };
          actions.selectCell(target);
          scrollActiveCellIntoView(target);
          break;
        }
        case "extendFirstCell": {
          event.preventDefault();
          actions.extendTo({ col: 0, row: 0 });
          const focus = getFocusCell(storeApi.getState());
          if (focus) scrollActiveCellIntoView(focus);
          break;
        }
        case "extendLastCell": {
          event.preventDefault();
          actions.extendTo({ col: Math.max(0, colCount - 1), row: Math.max(0, rowCount - 1) });
          const focus = getFocusCell(storeApi.getState());
          if (focus) scrollActiveCellIntoView(focus);
          break;
        }
        case "pageUp":
        case "pageDown": {
          event.preventDefault();
          const scrollElement = scrollRef.current;
          const visibleRows = scrollElement
            ? Math.max(1, Math.floor(scrollElement.clientHeight / layoutRef.current.rowHeight) - 4)
            : 10;
          moveAndScroll({ dx: 0, dy: action === "pageUp" ? -visibleRows : visibleRows });
          break;
        }
        case "selectRow": {
          event.preventDefault();
          const active = state.activeCell;
          if (active) actions.selectRow(active.row, { additive: false });
          break;
        }
        case "selectColumn": {
          event.preventDefault();
          const active = state.activeCell;
          if (active) actions.selectColumn(active.col, { additive: false });
          break;
        }
        case "selectAll": {
          event.preventDefault();
          actions.selectAll();
          break;
        }
        case "edit": {
          event.preventDefault();
          if (readOnly || !state.activeCell) break;
          if (isCheckboxCell(state, state.activeCell)) toggleCheckboxCell(state, actions, state.activeCell);
          else actions.startEditing(state.activeCell);
          break;
        }
        case "editReplace": {
          if (readOnly || !state.activeCell) break;
          event.preventDefault();
          if (isCheckboxCell(state, state.activeCell)) break; // checkbox cells have no edit mode; the edit action toggles them, type-to-replace ignores them
          // printable trigger seeds the typed char (Excel replace mode); a non-printable binding (e.g. F3) starts a plain edit
          actions.startEditing(state.activeCell, isPrintableKey(keymapEvent) ? keymapEvent.key : undefined);
          break;
        }
        case "cancel": {
          event.preventDefault();
          cancelFillDrag?.();
          actions.clearSelection();
          break;
        }
        case "deleteContents": {
          event.preventDefault();
          if (!readOnly) actions.deleteSelection();
          break;
        }
        case "fillDown": {
          event.preventDefault();
          if (!readOnly) fillDown?.();
          break;
        }
        case "fillRight": {
          event.preventDefault();
          if (!readOnly) fillRight?.();
          break;
        }
        case "undo": {
          event.preventDefault();
          state.onUndo?.();
          break;
        }
        case "redo": {
          event.preventDefault();
          state.onRedo?.();
          break;
        }
        case "insertRowBelow": {
          event.preventDefault();
          // mirrors cell-menu-content.tsx's canInsertRow guard: without createRow, insertRow is a
          // dev-warning no-op — skip the call so the shortcut doesn't spam that warning on every press.
          if (!readOnly && state.createRow && state.activeCell) actions.insertRow(state.activeCell.row, "below");
          break;
        }
        case "duplicateRow": {
          event.preventDefault();
          if (!readOnly && state.duplicateRow && state.activeCell) actions.duplicateRows([state.activeCell.row]);
          break;
        }
      }
    },
    [actions, cancelFillDrag, fillDown, fillRight, jumpAndScroll, keymap, moveAndScroll, readOnly, scrollActiveCellIntoView, scrollRef, storeApi],
  );

  const onCellPointerDown = useCallback(
    (coord: CellCoord, event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      // React re-dispatches portaled content's events through the React tree of its logical
      // parent, not the DOM tree — so a press inside a cell's own popup editor (Select/Date,
      // rendered via a portal to document.body) still reaches this handler even though the
      // DOM target is nowhere under this cell. Ignore it; the editor's own handlers own it.
      if ((event.target as HTMLElement | null)?.closest(gridAttrSelector("cellEditor"))) return;
      const state = storeApi.getState();
      const isMultiKey = isMacRef.current ? event.metaKey : event.ctrlKey;

      // Excel activation model: a click NEVER starts editing — it only
      // selects; dblclick/Enter/F2/typing edit. Only checkbox cells resolve a stationary
      // click on the already-active cell into a direct toggle (a control, not an editor).
      const wasActive =
        !event.shiftKey &&
        !isMultiKey &&
        state.activeCell !== null &&
        state.activeCell.col === coord.col &&
        state.activeCell.row === coord.row &&
        !state.editing;

      if (event.shiftKey) {
        actions.extendTo(coord);
      } else if (isMultiKey) {
        actions.pushRange(coord);
      } else {
        actions.selectCell(coord);
      }

      if (wasActive && !readOnly && isCheckboxCell(state, coord)) {
        // Resolved on the cell's native `click` — pointerdown can't yet tell a click from a drag.
        pendingActiveClickRef.current = coord;
      }

      // jsdom (unit tests) doesn't implement the Pointer Events capture methods; guard for it.
      event.currentTarget.setPointerCapture?.(event.pointerId);
      beginDrag("range", event.pointerId, event.currentTarget);
    },
    [actions, beginDrag, readOnly, storeApi],
  );

  const onCellClick = useCallback(
    (coord: CellCoord, event: ReactMouseEvent<HTMLElement>) => {
      const pending = pendingActiveClickRef.current;
      pendingActiveClickRef.current = null;
      // native `click` only fires for a stationary press+release on the same element, never a drag.
      if (!pending || pending.col !== coord.col || pending.row !== coord.row) return;
      // detail >= 2 is a dblclick's second click — onCellDoubleClick resolves that case instead.
      if (event.detail >= 2) return;
      const state = storeApi.getState();
      // Excel model: only checkbox cells act on a stationary click; text/number/etc. never edit here.
      if (isCheckboxCell(state, coord)) {
        toggleCheckboxCell(state, actions, coord);
        resolvedByClickRef.current = coord;
      }
    },
    [actions, storeApi],
  );

  const onCellDoubleClick = useCallback(
    (coord: CellCoord, event: ReactMouseEvent<HTMLElement>) => {
      if (readOnly) return;
      // same portal-bubbling concern as onCellPointerDown above.
      if ((event.target as HTMLElement | null)?.closest(gridAttrSelector("cellEditor"))) return;
      pendingActiveClickRef.current = null;
      const state = storeApi.getState();
      actions.selectCell(coord);
      // this gesture's first click may have already resolved the action via onCellClick.
      const alreadyResolved = resolvedByClickRef.current?.col === coord.col && resolvedByClickRef.current?.row === coord.row;
      resolvedByClickRef.current = null;
      if (alreadyResolved) return;
      // checkbox has no edit mode; direct-toggle instead of entering edit mode.
      if (isCheckboxCell(state, coord)) toggleCheckboxCell(state, actions, coord);
      else actions.startEditing(coord);
    },
    [actions, readOnly, storeApi],
  );

  const onHeaderPointerDown = useCallback(
    (columnIndex: number, event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      if (!storeApi.getState().enableColumnSelection) return;
      const isMultiKey = isMacRef.current ? event.metaKey : event.ctrlKey;
      if (event.shiftKey) {
        actions.selectColumn(columnIndex, { extendFromLast: true });
      } else if (isMultiKey) {
        actions.selectColumn(columnIndex, { additive: true });
      } else {
        actions.selectColumn(columnIndex);
      }
      event.currentTarget.setPointerCapture?.(event.pointerId);
      beginDrag("column", event.pointerId, event.currentTarget);
    },
    [actions, beginDrag, storeApi],
  );

  const onMarkerPointerDown = useCallback(
    (viewRowIndex: number, event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      if (!storeApi.getState().enableRowSelection) return;
      const isMultiKey = isMacRef.current ? event.metaKey : event.ctrlKey;
      // Moving-edge drag (replaceFromLast): a plain press anchors at the press row; a shift press
      // anchors at the PREVIOUS last-highlighted row (read before selectRow below overwrites it)
      // so its extension keeps tracking the pointer. A ctrl press holds an additive multi-selection
      // the replace would clobber, so it keeps the old union-extend drag.
      const anchor = isMultiKey ? undefined : event.shiftKey ? (storeApi.getState().lastHighlightedRow ?? viewRowIndex) : viewRowIndex;
      if (event.shiftKey) {
        actions.selectRow(viewRowIndex, { extendFromLast: true });
      } else if (isMultiKey) {
        actions.selectRow(viewRowIndex, { additive: true });
      } else {
        actions.selectRow(viewRowIndex);
      }
      event.currentTarget.setPointerCapture?.(event.pointerId);
      beginDrag("row", event.pointerId, event.currentTarget, anchor);
    },
    [actions, beginDrag, storeApi],
  );

  const onMarkerGripPointerDown = useCallback(
    (viewRowIndex: number, event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      if (event.shiftKey) {
        // shift+drag from the grip is the row-select range gesture, like any other marker press
        onMarkerPointerDown(viewRowIndex, event);
        return;
      }
      if (!storeApi.getState().enableRowSelection) return;
      const isMultiKey = isMacRef.current ? event.metaKey : event.ctrlKey;
      if (isMultiKey) {
        actions.selectRow(viewRowIndex, { additive: true });
      } else {
        actions.selectRow(viewRowIndex);
      }
      // deliberately NO beginDrag: the row-reorder hook owns the pointer from this press (see the
      // grip zone's JSDoc), so the two gestures can never both apply to one press.
    },
    [actions, isMacRef, onMarkerPointerDown, storeApi],
  );

  const onMarkerCheckboxPointerDown = useCallback(
    (viewRowIndex: number, event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      if (!storeApi.getState().enableRowSelection) return;
      // arms the anchor only (lastHighlightedRow), never `selection.rows` itself — a stationary
      // press+release still resolves purely via the checkbox's own click->toggle. lastPointerRef
      // stays unseeded, so runDragFrame's first tick is a no-op (pointer is null) exactly like the
      // other drag starts; only a real pointermove commits to extending from this anchor.
      actions.armRowDragAnchor(viewRowIndex);
      event.currentTarget.setPointerCapture?.(event.pointerId);
      // the checkbox press is the range gesture's anchor: dragging makes the row channel exactly
      // pressRow..current (grow AND shrink), matching the plain marker drag.
      beginDrag("row", event.pointerId, event.currentTarget, viewRowIndex);
    },
    [actions, beginDrag, storeApi],
  );

  const onRootPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      // only fires when the pointerdown wasn't already handled (and stopped) by a cell/header
      if (event.target !== event.currentTarget) return;
      // a press inside a portaled popover editor (select/date) is not a click-away, even if it
      // somehow bubbles here — data-grid-cell-editor is the marker both editors' content carries.
      const target = event.target as HTMLElement;
      if (target.closest(gridAttrSelector("cellEditor"))) return;
      actions.clearSelection();
    },
    [actions],
  );

  const cancelColumnSelectDrag = useCallback(() => {
    if (dragRef.current?.mode === "column") endDrag();
  }, [endDrag]);

  useEffect(() => stopAutoScrollLoop, [stopAutoScrollLoop]);

  // Page-area click-outside clear (2026-09-03 audit N4): the listener is attached only while a
  // non-empty selection exists, so no document-level listener is present at rest.
  useEffect(() => {
    let attached = false;
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target as Element | null;
      if (!target || !(target instanceof Element)) return;
      if (scrollRef.current?.contains(target)) return;
      if (target.closest(gridAttrSelector("cellEditor"))) return;
      actions.clearSelection();
    };
    const setAttached = (attach: boolean) => {
      if (attach === attached) return;
      if (attach) document.addEventListener("pointerdown", onPointerDown, true);
      else document.removeEventListener("pointerdown", onPointerDown, true);
      attached = attach;
    };
    setAttached(!isSelectionEmpty(storeApi.getState().selection));
    const unsubscribe = storeApi.subscribe((state, prevState) => {
      if (state.selection === prevState.selection) return;
      setAttached(!isSelectionEmpty(state.selection));
    });
    return () => {
      unsubscribe();
      setAttached(false);
    };
  }, [actions, scrollRef, storeApi]);

  return useMemo(
    () => ({
      onKeyDown,
      onCellPointerDown,
      onCellClick,
      onCellDoubleClick,
      onHeaderPointerDown,
      onMarkerPointerDown,
      onMarkerGripPointerDown,
      onMarkerCheckboxPointerDown,
      onRootPointerDown,
      cancelColumnSelectDrag,
      scrollCellIntoView: scrollActiveCellIntoView,
    }),
    [
      onKeyDown,
      onCellPointerDown,
      onCellClick,
      onCellDoubleClick,
      onHeaderPointerDown,
      onMarkerPointerDown,
      onMarkerGripPointerDown,
      onMarkerCheckboxPointerDown,
      onRootPointerDown,
      cancelColumnSelectDrag,
      scrollActiveCellIntoView,
    ],
  );
}
