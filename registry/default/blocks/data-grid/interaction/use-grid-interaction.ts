"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { type ViewCoord, type GridAction } from "../types";
import type { DataGridStoreState, SelectionPointer } from "../store/types";
import { isMacPlatform, isPrintableKey, matchKeymap, type KeymapEvent } from "../keyboard";
import type { Keymap } from "../types";
import { safeSetPointerCapture } from "./safe-set-pointer-capture";
import { useDataGridActions, useDataGridStoreApi } from "../store";
import {
  AUTO_SCROLL_STEP,
  AUTO_SCROLL_ZONE,
  applyInlineScrollDelta,
  inlineAutoScrollStep,
  visualArrowKey,
} from "../virtualization/direction";
import { GRID_ATTR, gridAttrSelector } from "../data-attributes";
import { type RowRangeGesture } from "../selection/row-range-gesture";
import { getInternalActions } from "../store/internal-actions";
import { isComposingKey } from "./is-composing-key";
import { createLongPressTimer, isDoubleTap, isTap, movedBeyondSlop, type TapSample } from "./touch-gestures";
import { dispatchGridAction, hasActivateCell, hasCellSelection } from "./dispatch-grid-action";
import { pointerToCoord, scrollCellIntoView, type InteractionLayout } from "./pointer-geometry";

export { dispatchGridAction, jumpToDataBoundary, type JumpDirection } from "./dispatch-grid-action";
export { pointerToCoord, type InteractionLayout } from "./pointer-geometry";

const MODIFIER_KEYS: ReadonlySet<string> = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph"]);

const isActivationKey = (event: ReactKeyboardEvent<HTMLElement>) =>
  (event.key === "Enter" || event.key === " ") && !event.ctrlKey && !event.metaKey && !event.altKey;

/** A Tab bound to a move at the first or last column leaves the grid, so a remapped Tab never traps the keyboard. */
function leavesGridOnTab(action: GridAction, key: string, state: DataGridStoreState): boolean {
  if (key !== "Tab" || !state.activeCell) return false;
  const col = state.activeCell.col;
  return (action === "moveRight" || action === "moveRightKeepSelection") ? col >= state.visibleColumns.length - 1 : (action === "moveLeft" || action === "moveLeftKeepSelection") && col <= 0;
}

const KEEP_RANGE_SURFACES = (["cellEditor", "headerFilterPopup", "headerMenuPopup", "findReplacePanel", "contextMenu"] as const).map((name) => gridAttrSelector(name)).join(", ");
/** Options for {@link useGridInteraction}. */
export type UseGridInteractionOptions = {
  scrollRef: RefObject<HTMLElement | null>;
  layout: InteractionLayout;
  keymap: Keymap;
};

const TOUCH_CHECKBOX_SLOP_PX = 4;

function pointerHitsCheckboxBox(event: ReactPointerEvent<HTMLElement>): boolean {
  const box = event.currentTarget.querySelector(gridAttrSelector("checkboxBox"))?.getBoundingClientRect();
  if (box === undefined) return false;
  const slop = event.pointerType === "touch" ? TOUCH_CHECKBOX_SLOP_PX : 0;
  return event.clientX >= box.left - slop && event.clientX <= box.right + slop && event.clientY >= box.top - slop && event.clientY <= box.bottom + slop;
}

/** Handlers + drag state wiring for keyboard nav, mouse selection, and editing lifecycle. */
export type GridInteractionHandlers = {
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  /** Attach to each rendered cell's pointerdown. */
  onCellPointerDown: (coord: ViewCoord, event: ReactPointerEvent<HTMLElement>) => void;
  /** Attach to each rendered cell's click — resolves the deferred active-cell click action. */
  onCellClick: (coord: ViewCoord, event: ReactMouseEvent<HTMLElement>) => void;
  /** Attach to each rendered cell's dblclick. */
  onCellDoubleClick: (coord: ViewCoord, event: ReactMouseEvent<HTMLElement>) => void;
  /**
   * Attach to a header cell's pointerdown: resolves the plain/shift/ctrl click-select gesture
   * immediately and starts a column-range drag so a
   * press+drag across headers selects the contiguous range. Entirely a no-op —
   * including no drag/capture — when `enableColumnSelection` is false.
   */
  onHeaderPointerDown: (columnIndex: number, event: ReactPointerEvent<HTMLElement>) => void;
  /**
   * Attach to a group header cell's pointerdown: selects the visible columns `[start, end)` in the
   * column channel (shift extends, ctrl/cmd adds). No drag. No-op when `enableColumnSelection` is false.
   */
  onGroupHeaderPointerDown: (start: number, end: number, event: ReactPointerEvent<HTMLElement>) => void;
  /**
   * Attach to a marker cell's pointerdown: same plain/shift/ctrl resolution + drag-start as
   * {@link onHeaderPointerDown}, on the rows channel.
   * No-op when `enableRowSelection` is false.
   */
   onMarkerPointerDown: (viewRowIndex: number, event: ReactPointerEvent<HTMLElement>) => void;
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
   * Imperatively scrolls the container so `coord` (view-index) is visible, honoring the
   * pinned-left/right bands. Public extension point for add-ons that move the active cell
   * programmatically, e.g. `data-grid-toolbar`'s search next/prev — never `scrollIntoView`
   * (see {@link scrollCellIntoView}'s own doc for why).
   */
  scrollCellIntoView: (coord: ViewCoord) => void;
};

/**
 * Builds every pointer/keyboard handler the grid root and cells wire up, plus the imperative
 * scroll-into-view/drag-autoscroll machinery. One instance per `<DataGridRoot>` mount.
 */
export function useGridInteraction(options: UseGridInteractionOptions): GridInteractionHandlers {
  const { scrollRef, layout, keymap } = options;
  const actions = useDataGridActions();
  const storeApi = useDataGridStoreApi();
  // Event-time values only: both refs are written in a layout effect (render-time ref writes
  // bail the React Compiler) and read exclusively inside the handlers below.
  const isMacRef = useRef(false);
  const layoutRef = useRef(layout);
  useLayoutEffect(() => {
    isMacRef.current = isMacPlatform();
    layoutRef.current = layout;
  }, [layout]);

  // drag state lives in a ref, never React state — a drag never re-renders anything but the
  // overlay/active-cell subscribers that selection changes already touch. `anchor` is the press row
  // of a plain marker or checkbox drag: with `pendingOffAnchor` it holds the drag back until the
  // pointer leaves that row, and it decides whether the click after the drag is swallowed.
  const dragRef = useRef<{ pointerId: number; mode: "range" | "row" | "column"; anchor?: number; pendingOffAnchor?: boolean; leftAnchor?: boolean; swallowClick?: boolean; armed?: { before: RowRangeGesture | null; armed: RowRangeGesture | null } } | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingActionFrameRef = useRef<number | null>(null);
  const lastPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);

  // Active-cell click deferred to native `click` — pointerdown alone can't distinguish it from a drag.
  const pendingActiveClickRef = useRef<ViewCoord | null>(null);
  // Pointer capture retargets the click onto the cell, so the anchor is only known at pointerdown.
  const linkPressRef = useRef<ViewCoord | null>(null);
  // Coord a single click just resolved, so the following dblclick (same gesture) doesn't re-resolve it.
  const resolvedByClickRef = useRef<ViewCoord | null>(null);

  // The element that took setPointerCapture for the active drag; released explicitly on end
  // rather than relying on the browser's implicit release, which some environments (real
  // Chromium via Playwright) don't reliably fire before a later, unrelated click gesture —
  // a stale capture otherwise swallows that next gesture's pointerup/click on its real target
  // (e.g. an option in a portaled Select popup opened right after this cell's click).
  const captureElementRef = useRef<Element | null>(null);

  const stopAutoScrollLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // Self-scheduling rAF re-enters through a ref: a direct self-reference and a hoisted
  // declaration both bail the React Compiler (use-before-declare / PruneHoistedContexts).
  const dragFrameRef = useRef<(() => void) | null>(null);
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
    let scrolled = false;
    if (pointer.clientY < rect.top + AUTO_SCROLL_ZONE) {
      scrollElement.scrollTop -= AUTO_SCROLL_STEP;
      scrolled = true;
    } else if (pointer.clientY > rect.bottom - AUTO_SCROLL_ZONE) {
      scrollElement.scrollTop += AUTO_SCROLL_STEP;
      scrolled = true;
    }
    // Which physical edge means "scroll toward the inline start" depends on direction; the step is
    // then applied in the container's own scrollLeft convention.
    const direction = layoutRef.current.direction ?? "ltr";
    const inlineStep = inlineAutoScrollStep(pointer.clientX, rect, AUTO_SCROLL_ZONE, direction);
    if (inlineStep !== 0) {
      applyInlineScrollDelta(scrollElement, inlineStep * AUTO_SCROLL_STEP, direction);
      scrolled = true;
    }

    // Once edge auto-scroll engages, the pressed element will unmount out of the rendered window;
    // the browser releases the capture on unmount and cancels a touch pointer with it. Hand the
    // capture to the scroll element, which outlives the drag.
    if (scrolled && captureElementRef.current && captureElementRef.current !== scrollElement) {
      safeSetPointerCapture(scrollElement, drag.pointerId);
      captureElementRef.current = scrollElement;
    }

    const state = storeApi.getState();
    const rowCount = state.viewIndex.length;
    const coord = pointerToCoord(pointer.clientX, pointer.clientY, scrollElement, layoutRef.current, rowCount);
    const clamped = {
      col: Math.max(0, Math.min(coord.col, Math.max(0, state.visibleColumns.length - 1))),
      row: Math.max(0, Math.min(coord.row, Math.max(0, rowCount - 1))),
    };

    if (drag.pendingOffAnchor) {
      if (clamped.row === drag.anchor) {
        rafRef.current = requestAnimationFrame(() => dragFrameRef.current?.());
        return;
      }
      drag.pendingOffAnchor = false;
      drag.leftAnchor = true;
    }

    if (drag.mode === "range") actions.extendToAt(clamped);
    else if (drag.mode === "row") {
      if (state.enableRangeSelection) actions.checkRowRange(clamped.row);
    }
    else actions.selectColumn(clamped.col, { extendFromLast: true });

    rafRef.current = requestAnimationFrame(() => dragFrameRef.current?.());
  }, [actions, scrollRef, storeApi]);
  useEffect(() => {
    dragFrameRef.current = runDragFrame;
  }, [runDragFrame]);

  // pointermove/pointerup are attached to `document` only for the lifetime of an active drag —
  // beginDrag attaches them, endDrag tears them down immediately, instead of a permanent
  // always-on subscription.
  const documentListenersRef = useRef<(() => void) | null>(null);

  // Pointer capture retargets the click that follows a drag onto the pressed control; a range drag
  // must not also toggle it.
  const swallowNextClick = useCallback(() => {
    const swallow = (event: MouseEvent) => {
      event.stopPropagation();
      event.preventDefault();
    };
    document.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => document.removeEventListener("click", swallow, true), 0);
  }, []);

  const endDrag = useCallback(() => {
    const pointerId = dragRef.current?.pointerId;
    const captureEl = captureElementRef.current as (Element & { hasPointerCapture?: (id: number) => boolean; releasePointerCapture?: (id: number) => void }) | null;
    if (captureEl && pointerId !== undefined && captureEl.hasPointerCapture?.(pointerId)) {
      captureEl.releasePointerCapture?.(pointerId);
    }
    captureElementRef.current = null;
    dragRef.current = null;
    lastPointerRef.current = null;
    getInternalActions(storeApi)._setSelectionPress(false);
    stopAutoScrollLoop();
    documentListenersRef.current?.();
    documentListenersRef.current = null;
  }, [stopAutoScrollLoop, storeApi]);

  const beginDrag = useCallback(
    (mode: "range" | "row" | "column", pointerId: number, captureElement?: Element, anchor?: number, pendingOffAnchor?: boolean) => {
      dragRef.current = { pointerId, mode, anchor, pendingOffAnchor };
      captureElementRef.current = captureElement ?? null;
      if (rafRef.current === null) rafRef.current = requestAnimationFrame(runDragFrame);

      if (!documentListenersRef.current) {
        // an armed checkbox press that never wrote a row leaves the earlier anchor in place
        const abandonDrag = () => {
          const armed = dragRef.current?.armed;
          if (armed && storeApi.getState().rowRangeGesture === armed.armed) storeApi.setState({ rowRangeGesture: armed.before });
          endDrag();
        };
        const onLostCapture = (event: PointerEvent) => {
          if (dragRef.current?.pointerId === event.pointerId && event.target === captureElementRef.current) abandonDrag();
        };
        const onMove = (event: PointerEvent) => {
          if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
          lastPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
          // Pointer capture still fires `click` on the pressed cell after a drag, even one that ends back there.
          const pending = pendingActiveClickRef.current;
          const linkPress = linkPressRef.current;
          const scrollElement = scrollRef.current;
          if ((pending || linkPress) && scrollElement) {
            const coord = pointerToCoord(event.clientX, event.clientY, scrollElement, layoutRef.current, storeApi.getState().viewIndex.length);
            if (pending && (coord.col !== pending.col || coord.row !== pending.row)) pendingActiveClickRef.current = null;
            if (linkPress && (coord.col !== linkPress.col || coord.row !== linkPress.row)) linkPressRef.current = null;
          }
          // the frame loop kills itself when no move has arrived yet (slow press-then-drag) —
          // restart it here or a drag whose first move lands after frame 1 never paints (user QA).
          if (rafRef.current === null) rafRef.current = requestAnimationFrame(runDragFrame);
        };
        const onUp = (event: PointerEvent) => {
          if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
          // If the capture was handed to the scroll element, the post-drag `click` targets the
          // scroll element and can never reach the pressed cell — the cell's click can't resolve
          // the pending active-cell press anymore, so resolve (or discard) it here, on the true
          // pointerup coordinate. Without the handoff the cell's own `click` resolves it as usual.
          const scrollElement = scrollRef.current;
          if (event.type === "pointercancel" || (scrollElement && captureElementRef.current === scrollElement)) linkPressRef.current = null;
          if (scrollElement && captureElementRef.current === scrollElement) {
            const pending = pendingActiveClickRef.current;
            pendingActiveClickRef.current = null;
            if (event.type !== "pointercancel" && pending && event.detail < 2) {
              const coord = pointerToCoord(event.clientX, event.clientY, scrollElement, layoutRef.current, storeApi.getState().viewIndex.length);
              if (coord.col === pending.col && coord.row === pending.row) {
                const state = storeApi.getState();
                if (!state.readOnly && hasActivateCell(state, pending)) {
                  getInternalActions(storeApi)._activateCellAt(pending);
                  resolvedByClickRef.current = pending;
                }
              }
            }
          }
          const drag = dragRef.current;
          if (event.type === "pointerup" && drag.mode === "row" && drag.swallowClick) swallowNextClick();
          else if (event.type === "pointerup" && drag.mode === "row" && drag.anchor !== undefined && scrollElement) {
            const endRow = pointerToCoord(event.clientX, event.clientY, scrollElement, layoutRef.current, storeApi.getState().viewIndex.length).row;
            if (endRow !== drag.anchor || drag.leftAnchor) swallowNextClick();
          }
          if (event.type === "pointercancel") abandonDrag();
          else endDrag();
        };
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
        document.addEventListener("pointercancel", onUp);
        document.addEventListener("lostpointercapture", onLostCapture);
        window.addEventListener("blur", abandonDrag);
        documentListenersRef.current = () => {
          document.removeEventListener("pointermove", onMove);
          document.removeEventListener("pointerup", onUp);
          document.removeEventListener("pointercancel", onUp);
          document.removeEventListener("lostpointercapture", onLostCapture);
          window.removeEventListener("blur", abandonDrag);
        };
      }
    },
    [actions, runDragFrame, endDrag, scrollRef, storeApi, swallowNextClick],
  );

  // safety net: tear down a still-active drag's listeners/rAF if the component unmounts mid-drag
  useEffect(() => () => documentListenersRef.current?.(), []);
  useEffect(
    () => () => {
      if (pendingActionFrameRef.current !== null) cancelAnimationFrame(pendingActionFrameRef.current);
    },
    [],
  );

  const scrollActiveCellIntoView = useCallback(
    (coord: ViewCoord) => {
      const scrollElement = scrollRef.current;
      if (!scrollElement) return;
      scrollCellIntoView(scrollElement, coord, layoutRef.current);
    },
    [scrollRef],
  );

  const markSelectionPointer = useCallback(
    (pointer: SelectionPointer) => {
      if (storeApi.getState().selectionPointer !== pointer) storeApi.setState({ selectionPointer: pointer });
    },
    [storeApi],
  );

  const lastKeyEvent = useRef<Event | null>(null);
  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (isComposingKey(event)) return;
      if (!MODIFIER_KEYS.has(event.key)) markSelectionPointer("keyboard");
      // Base UI mounts its popup container through a React portal, so React dispatches a popup keydown twice.
      if (lastKeyEvent.current === event.nativeEvent) return;
      lastKeyEvent.current = event.nativeEvent;

      // A key from an editor (inline, or a portaled popup) belongs to that edit even after its own handler ended it; a focused header trigger keeps only Enter and Space for its click.
      const target = event.target as HTMLElement | null;
      const fromEditorInput =
        target !== null &&
        target !== event.currentTarget &&
        (/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName) ||
          target.isContentEditable ||
          target.closest(gridAttrSelector("cellEditor")) !== null ||
          (isActivationKey(event) && target.closest(`${gridAttrSelector("headerMenuTrigger")}, ${gridAttrSelector("headerFilterTrigger")}`) !== null) ||
          !event.currentTarget.contains(target));

      const state = storeApi.getState();
      const editing = state.editing;

      // Arrow keys move VISUALLY: under RTL, ArrowRight goes to the next column on the screen,
      // which is the PREVIOUS column index. Swapping the KEY here — the one place a key becomes
      // an action — is what lets every navigation helper, and any consumer's custom keymap, stay
      // written in logical terms (moveLeft/moveRight/extendLeft/jumpLeft). Tab/Shift+Tab are not
      // swapped: they are already reading-order logical. Home/End need no swap either, since
      // moveRowStart/moveRowEnd are logically named and "row start" is column 0 in both directions.
      const keymapEvent: KeymapEvent = {
        key: visualArrowKey(event.key, layoutRef.current.direction ?? "ltr"),
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        altGraph: event.getModifierState?.("AltGraph"),
      };

      const dispatch = (action: GridAction) =>
        leavesGridOnTab(action, event.key, storeApi.getState()) ||
        dispatchGridAction({
          action,
          actions,
          storeApi,
          scrollRef,
          scrollCellIntoView: scrollActiveCellIntoView,
          rowHeight: layoutRef.current.rowHeight,
          triggerKey: isPrintableKey(keymapEvent, isMacRef.current) ? keymapEvent.key : undefined,
          preventDefault: () => event.preventDefault(),
          headerColumnId: target?.closest<HTMLElement>("[role='columnheader'][data-column-id]")?.dataset["columnId"],
          pendingFrameRef: pendingActionFrameRef,
        });

      // While a session is open the editor owns the built-in keys; only editor-scoped commands dispatch.
      if (editing || fromEditorInput) {
        const commands = state.commands;
        if (editing && commands) {
          const action = matchKeymap(keymapEvent, keymap, isMacRef.current, (a) => {
            const scope = commands[a]?.scope;
            return scope === "editing" || scope === "always";
          });
          if (action !== null) dispatch(action);
        }
        return;
      }

      const commands = state.commands;
      const notEditorOnly = commands ? (a: GridAction) => commands[a]?.scope !== "editing" : undefined;
      // unbound printable key = implicit typeToReplace trigger (Excel behavior); a consumer keymap that DEFINES typeToReplace (even []) takes it over and disables the fallback
      const action =
        matchKeymap(keymapEvent, keymap, isMacRef.current, notEditorOnly) ??
        (isPrintableKey(keymapEvent, isMacRef.current) && keymap.typeToReplace === undefined ? "typeToReplace" : null);

      if (action) dispatch(action);
    },
    [actions, keymap, markSelectionPointer, scrollActiveCellIntoView, scrollRef, storeApi],
  );

  const touchTeardownRef = useRef<(() => void) | null>(null);
  const lastTapRef = useRef<TapSample | null>(null);
  const pressedCoordRef = useRef<ViewCoord | null>(null);

  const endTouchPress = useCallback(() => {
    touchTeardownRef.current?.();
    touchTeardownRef.current = null;
  }, []);
  useEffect(() => endTouchPress, [endTouchPress]);

  // A touch press resolves on release: the document listeners live only for the press, no pointer
  // capture is taken (native pan stays in charge), and a pan, cancel, second finger, or unmount ends it.
  const beginTouchPress = useCallback(
    (event: ReactPointerEvent<HTMLElement>, spec: { tapKey: string; onTap: (doubleTap: boolean) => void; onLongPress?: () => void }) => {
      if (touchTeardownRef.current) {
        endTouchPress();
        lastTapRef.current = null;
        return;
      }
      const { pointerId } = event;
      const start = { x: event.clientX, y: event.clientY, time: event.timeStamp };
      const press = { fired: false };
      const longPress = spec.onLongPress
        ? createLongPressTimer(() => {
            press.fired = true;
            spec.onLongPress?.();
          })
        : null;
      const onMove = (e: PointerEvent) => {
        if (e.pointerId === pointerId && movedBeyondSlop(start, { x: e.clientX, y: e.clientY })) endTouchPress();
      };
      const onLost = (e: PointerEvent) => {
        if (e.pointerId === pointerId) endTouchPress();
      };
      const onEnd = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        endTouchPress();
        // A long press is not a click: the click after its release must not sort, toggle, or select.
        if (press.fired && e.type === "pointerup") swallowNextClick();
        if (press.fired || e.type !== "pointerup") return;
        const end = { x: e.clientX, y: e.clientY, time: e.timeStamp };
        if (isTap(start, end)) {
          const tap: TapSample = { ...end, key: spec.tapKey };
          const doubleTap = isDoubleTap(lastTapRef.current, tap);
          lastTapRef.current = doubleTap ? null : tap;
          spec.onTap(doubleTap);
        }
      };
      const onBlur = () => endTouchPress();
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onEnd);
      document.addEventListener("pointercancel", onEnd);
      document.addEventListener("lostpointercapture", onLost);
      window.addEventListener("blur", onBlur);
      touchTeardownRef.current = () => {
        longPress?.cancel();
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onEnd);
        document.removeEventListener("pointercancel", onEnd);
        document.removeEventListener("lostpointercapture", onLost);
        window.removeEventListener("blur", onBlur);
      };
      longPress?.arm();
    },
    [endTouchPress, swallowNextClick],
  );

  const openContextMenuFromPress = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const target = event.target as Element;
      const { clientX, clientY } = event;
      return () => {
        markSelectionPointer("touch");
        if (target.isConnected) target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX, clientY }));
      };
    },
    [markSelectionPointer],
  );

  const editCellAt = useCallback(
    (coord: ViewCoord) => {
      const state = storeApi.getState();
      if (state.readOnly) return;
      pendingActiveClickRef.current = null;
      actions.selectCellAt(coord);
      // this gesture's first click may have already resolved the action via onCellClick.
      const alreadyResolved = resolvedByClickRef.current?.col === coord.col && resolvedByClickRef.current?.row === coord.row;
      resolvedByClickRef.current = null;
      if (alreadyResolved) return;
      // checkbox has no edit mode; direct-toggle instead of entering edit mode.
      if (hasActivateCell(state, coord)) getInternalActions(storeApi)._activateCellAt(coord);
      else actions.startEditingAt(coord);
    },
    [actions, storeApi],
  );

  const onCellTouchPress = useCallback(
    (coord: ViewCoord, event: ReactPointerEvent<HTMLElement>) => {
      const hitsCheckbox = pointerHitsCheckboxBox(event);
      beginTouchPress(event, {
        tapKey: `${coord.row}:${coord.col}`,
        onTap: (doubleTap) => {
          markSelectionPointer("touch");
          if (doubleTap && !hitsCheckbox) {
            editCellAt(coord);
            resolvedByClickRef.current = coord;
            return;
          }
          actions.selectCellAt(coord);
          const state = storeApi.getState();
          if (hitsCheckbox && !state.readOnly && hasActivateCell(state, coord)) getInternalActions(storeApi)._activateCellAt(coord);
        },
        onLongPress: openContextMenuFromPress(event),
      });
    },
    [actions, beginTouchPress, editCellAt, markSelectionPointer, openContextMenuFromPress, storeApi],
  );

  const onCellPointerDown = useCallback(
    (coord: ViewCoord, event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      // React re-dispatches portaled content's events through the React tree of its logical
      // parent, not the DOM tree — so a press inside a cell's own popup editor (Select/Date,
      // rendered via a portal to document.body) still reaches this handler even though the
      // DOM target is nowhere under this cell. Ignore it; the editor's own handlers own it.
      if ((event.target as HTMLElement | null)?.closest(gridAttrSelector("cellEditor"))) return;
      pressedCoordRef.current = coord;
      if (event.pointerType === "touch") {
        onCellTouchPress(coord, event);
        return;
      }
      markSelectionPointer(event.pointerType === "pen" ? "pen" : "mouse");
      getInternalActions(storeApi)._setSelectionPress(true);
      const state = storeApi.getState();
      const isMultiKey = isMacRef.current ? event.metaKey : event.ctrlKey;
      linkPressRef.current = isMultiKey && (event.target as HTMLElement | null)?.closest("a") ? coord : null;

      // Excel activation model: a click NEVER starts editing — it only
      // selects; dblclick/Enter/F2/typing edit. Only checkbox cells resolve a stationary
      // click into a direct toggle (a control, not an editor).
      const wasActive =
        !event.shiftKey &&
        !isMultiKey &&
        state.activeCell !== null &&
        state.activeCell.col === coord.col &&
        state.activeCell.row === coord.row &&
        !state.editing;

      if (event.shiftKey) {
        actions.extendToAt(coord);
      } else if (isMultiKey) {
        actions.pushRangeAt(coord);
      } else {
        actions.selectCellAt(coord);
      }

      const plainPress = !event.shiftKey && !isMultiKey && !state.editing;
      if ((wasActive || (plainPress && pointerHitsCheckboxBox(event))) && !state.readOnly && hasActivateCell(state, coord)) {
        // Resolved on the cell's native `click` — pointerdown can't yet tell a click from a drag.
        pendingActiveClickRef.current = coord;
      }

      safeSetPointerCapture(event.currentTarget, event.pointerId);
      beginDrag("range", event.pointerId, event.currentTarget);
    },
    [actions, beginDrag, markSelectionPointer, onCellTouchPress, storeApi],
  );

  const onCellClick = useCallback(
    (coord: ViewCoord, event: ReactMouseEvent<HTMLElement>) => {
      const pressed = pressedCoordRef.current;
      pressedCoordRef.current = null;
      if (
        (!pressed || pressed.col !== coord.col || pressed.row !== coord.row) &&
        !storeApi.getState().editing &&
        event.currentTarget.contains(event.target as Node) &&
        !(event.target as HTMLElement).closest(gridAttrSelector("cellEditor"))
      ) {
        actions.selectCellAt(coord);
      }
      const linkPress = linkPressRef.current;
      linkPressRef.current = null;
      const pending = pendingActiveClickRef.current;
      pendingActiveClickRef.current = null;
      const isMultiKey = isMacRef.current ? event.metaKey : event.ctrlKey;
      if (linkPress && isMultiKey && event.detail < 2 && !storeApi.getState().editing) {
        dispatchGridAction({
          action: "openLink",
          actions,
          storeApi,
          scrollRef,
          scrollCellIntoView: scrollActiveCellIntoView,
          rowHeight: layoutRef.current.rowHeight,
          preventDefault: () => event.preventDefault(),
        });
        return;
      }
      if (!pending || pending.col !== coord.col || pending.row !== coord.row) return;
      // detail >= 2 is a dblclick's second click — onCellDoubleClick resolves that case instead.
      if (event.detail >= 2) return;
      const state = storeApi.getState();
      // Excel model: only checkbox cells act on a stationary click; text/number/etc. never edit here.
      if (hasActivateCell(state, coord)) {
        getInternalActions(storeApi)._activateCellAt(coord);
        resolvedByClickRef.current = coord;
      }
    },
    [actions, scrollActiveCellIntoView, scrollRef, storeApi],
  );

  const onCellDoubleClick = useCallback(
    (coord: ViewCoord, event: ReactMouseEvent<HTMLElement>) => {
      // same portal-bubbling concern as onCellPointerDown above.
      if ((event.target as HTMLElement | null)?.closest(gridAttrSelector("cellEditor"))) return;
      editCellAt(coord);
    },
    [editCellAt],
  );

  const onHeaderPointerDown = useCallback(
    (columnIndex: number, event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      const state = storeApi.getState();
      const selects = state.enableColumnSelection && state.headerClickBehavior === "select";
      if (event.pointerType === "touch") {
        // iOS fires no native contextmenu, so the long press opens the header menu in every click behavior.
        beginTouchPress(event, {
          tapKey: `h:${columnIndex}`,
          onTap: () => {
            if (!selects) return;
            markSelectionPointer("touch");
            actions.selectColumn(columnIndex);
          },
          onLongPress: openContextMenuFromPress(event),
        });
        return;
      }
      if (!selects) return;
      getInternalActions(storeApi)._setSelectionPress(true);
      const isMultiKey = isMacRef.current ? event.metaKey : event.ctrlKey;
      if (event.shiftKey) {
        actions.selectColumn(columnIndex, { extendFromLast: true });
      } else if (isMultiKey) {
        actions.selectColumn(columnIndex, { additive: true });
      } else {
        actions.selectColumn(columnIndex);
      }
      safeSetPointerCapture(event.currentTarget, event.pointerId);
      beginDrag("column", event.pointerId, event.currentTarget);
    },
    [actions, beginDrag, beginTouchPress, markSelectionPointer, openContextMenuFromPress, storeApi],
  );

  const onGroupHeaderPointerDown = useCallback(
    (start: number, end: number, event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      const state = storeApi.getState();
      if (!state.enableColumnSelection) return;
      const last = end - 1;
      if (event.pointerType === "touch") {
        beginTouchPress(event, {
          tapKey: `g:${start}:${end}`,
          onTap: () => {
            markSelectionPointer("touch");
            actions.selectColumn(start);
            if (last > start) actions.selectColumn(last, { extendFromLast: true });
          },
        });
        return;
      }
      const isMultiKey = isMacRef.current ? event.metaKey : event.ctrlKey;
      const anchor = state.lastHighlightedCol;
      if (event.shiftKey && anchor !== null) {
        actions.selectColumn(anchor < start ? last : start, { extendFromLast: true });
        return;
      }
      if (isMultiKey) actions.selectColumn(start, { additive: true });
      else actions.selectColumn(start);
      if (last > start) actions.selectColumn(last, { extendFromLast: true });
    },
    [actions, beginTouchPress, markSelectionPointer, storeApi],
  );

  const onMarkerPointerDown = useCallback(
    (viewRowIndex: number, event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      if (!storeApi.getState().enableRowSelection) return;
      if (event.pointerType === "touch") {
        beginTouchPress(event, {
          tapKey: `m:${viewRowIndex}`,
          onTap: () => {
            markSelectionPointer("touch");
            actions.selectRow(viewRowIndex);
          },
        });
        return;
      }
      getInternalActions(storeApi)._setSelectionPress(true);
      const isMultiKey = isMacRef.current ? event.metaKey : event.ctrlKey;
      // only a plain press swallows the click that follows a drag; a modified press keeps its own click handling
      const anchor = isMultiKey || event.shiftKey ? undefined : viewRowIndex;
      if (event.shiftKey) {
        actions.checkRowRange(viewRowIndex, { commit: isMultiKey });
      } else if (isMultiKey) {
        actions.selectRow(viewRowIndex, { additive: true });
      } else {
        actions.selectRow(viewRowIndex);
      }
      safeSetPointerCapture(event.currentTarget, event.pointerId);
      beginDrag("row", event.pointerId, event.currentTarget, anchor, anchor !== undefined);
    },
    [actions, beginDrag, beginTouchPress, markSelectionPointer, storeApi],
  );

  const onMarkerCheckboxPointerDown = useCallback(
    (viewRowIndex: number, event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      if (!storeApi.getState().enableRowSelection || event.pointerType === "touch") return;
      if (event.shiftKey) {
        onMarkerPointerDown(viewRowIndex, event);
        // the checkbox would toggle on the click after the press and undo the range step
        if (dragRef.current) dragRef.current.swallowClick = true;
        return;
      }
      // arms the range gesture without writing `selection.rows` — a stationary press+release
      // still resolves purely via the checkbox's own click->toggle. lastPointerRef stays unseeded,
      // so runDragFrame's first tick is a no-op; only a real pointermove extends from this anchor.
      getInternalActions(storeApi)._setSelectionPress(true);
      const before = storeApi.getState().rowRangeGesture;
      getInternalActions(storeApi)._armRowDragAnchor(viewRowIndex);
      const armed = storeApi.getState().rowRangeGesture;
      safeSetPointerCapture(event.currentTarget, event.pointerId);
      beginDrag("row", event.pointerId, event.currentTarget, viewRowIndex, true);
      if (dragRef.current) dragRef.current.armed = { before, armed };
    },
    [actions, beginDrag, onMarkerPointerDown, storeApi],
  );

  const beginSelectionHandleDrag = useCallback(
    (corner: "start" | "end", event: ReactPointerEvent<HTMLElement>) => {
      const range = storeApi.getState().selection.current?.range;
      const scrollElement = scrollRef.current;
      if (event.button !== 0 || !range || !scrollElement) return;
      const opposite =
        corner === "end"
          ? { col: range.x, row: range.y }
          : { col: range.x + range.width - 1, row: range.y + range.height - 1 };
      markSelectionPointer(event.pointerType === "touch" ? "touch" : event.pointerType === "pen" ? "pen" : "mouse");
      getInternalActions(storeApi)._setSelectionPress(true);
      actions.selectCellAt(opposite);
      safeSetPointerCapture(scrollElement, event.pointerId);
      beginDrag("range", event.pointerId, scrollElement);
    },
    [actions, beginDrag, markSelectionPointer, scrollRef, storeApi],
  );

  const onRootPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const handle = (event.target as HTMLElement).closest<HTMLElement>(gridAttrSelector("selectionHandle"));
      if (handle) {
        beginSelectionHandleDrag(handle.getAttribute(GRID_ATTR.selectionHandle) === "start" ? "start" : "end", event);
        return;
      }
      // only fires when the pointerdown wasn't already handled (and stopped) by a cell/header
      if (event.target !== event.currentTarget) return;
      // a press inside a portaled popover editor (select/date) is not a click-away, even if it
      // somehow bubbles here — data-grid-cell-editor is the marker both editors' content carries.
      const target = event.target as HTMLElement;
      if (target.closest(gridAttrSelector("cellEditor"))) return;
      actions.clearCellSelection();
    },
    [actions, beginSelectionHandleDrag],
  );

  const cancelColumnSelectDrag = useCallback(() => {
    if (dragRef.current?.mode === "column") endDrag();
  }, [endDrag]);

  useEffect(() => stopAutoScrollLoop, [stopAutoScrollLoop]);

  // Click-outside clears the cell range and columns, never the checked rows; attached only while one exists.
  useEffect(() => {
    let attached = false;
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target as Element | null;
      if (!target || !(target instanceof Element)) return;
      if (scrollRef.current?.contains(target)) return;
      if (target.closest(KEEP_RANGE_SURFACES)) return;
      actions.clearCellSelection();
    };
    const setAttached = (attach: boolean) => {
      if (attach === attached) return;
      if (attach) document.addEventListener("pointerdown", onPointerDown, true);
      else document.removeEventListener("pointerdown", onPointerDown, true);
      attached = attach;
    };
    setAttached(hasCellSelection(storeApi.getState().selection));
    const unsubscribe = storeApi.subscribe((state, prevState) => {
      if (state.selection === prevState.selection) return;
      setAttached(hasCellSelection(state.selection));
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
      onGroupHeaderPointerDown,
      onMarkerPointerDown,
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
      onGroupHeaderPointerDown,
      onMarkerPointerDown,
      onMarkerCheckboxPointerDown,
      onRootPointerDown,
      cancelColumnSelectDrag,
      scrollActiveCellIntoView,
    ],
  );
}
