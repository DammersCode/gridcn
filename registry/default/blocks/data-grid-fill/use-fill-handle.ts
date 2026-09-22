"use client";

import { useCallback, useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import {
  applyInlineScrollDelta,
  combineRects,
  getCellValue,
  inlineAutoScrollStep,
  candidateRowIds,
  pointerToCoord,
  flashCellKey,
  resolveBulkWrites,
  snapshotBulkBatch,
  useBulkGeneration,
  useDataGridActions,
  useDataGridStoreApi,
  type BulkCandidate,
  type BulkWrite,
  type DataGridStoreState,
  type GridRect,
  type InteractionLayout,
} from "@/registry/default/blocks/data-grid/data-grid";
import { computeFillTarget, fillDirection, generateFill, rectRelativeTo } from "./fill";
import type { FillStoreApi } from "./fill-store";

/** rAF-throttled auto-scroll step (px), matching `useGridInteraction`'s drag auto-scroll. */
const AUTO_SCROLL_STEP = 16;
/** Distance (px) from a viewport edge at which drag auto-scroll kicks in. */
const AUTO_SCROLL_ZONE = 24;

/** Args passed to the `onFill` consumer hook. */
export type FillArgs = {
  source: GridRect;
  target: GridRect;
  values: string[][];
  /** Call to veto the fill entirely — nothing is applied and the selection doesn't expand. */
  preventDefault: () => void;
};

/** Options for {@link useFillHandle}. */
export type UseFillHandleOptions = {
  scrollRef: RefObject<HTMLElement | null>;
  layout: InteractionLayout;
  /** Turns the whole fill feature off (handle hidden, `fillDown`/`fillRight` no-op). Default `false`; a read-only grid disables fill regardless of this option. */
  disabled?: boolean;
  onFill?: (args: FillArgs) => void;
  /** This add-on's local fill-preview store — owns the in-progress drag rect (kept out of core). */
  fillStore: FillStoreApi;
};

/** Reads one cell's text value via its column's cell type `toText`, for use as a fill source. */
function cellText(s: DataGridStoreState, viewRow: number, colIndex: number): string {
  const column = s.visibleColumns[colIndex];
  if (!column) return "";
  const dataRowIndex = s.viewIndex[viewRow];
  const row = dataRowIndex === undefined ? undefined : s.data[dataRowIndex];
  if (row === undefined) return "";
  const cellType = s.cellTypes[column.type ?? "text"];
  if (!cellType) return "";
  // explicit TData=unknown: row's `undefined`-narrowed type ({} | null) would otherwise drive inference instead of column's own already-unknown TData.
  const value = getCellValue<unknown, typeof column>(row, column);
  return cellType.toText(value, column.options);
}

/** Reads `rect` as a 2D string grid via each cell type's `toText` — the fill algorithm's raw input. */
export function readRectAsText(s: DataGridStoreState, rect: GridRect): string[][] {
  const out: string[][] = [];
  for (let row = rect.y; row < rect.y + rect.height; row++) {
    const line: string[] = [];
    for (let col = rect.x; col < rect.x + rect.width; col++) line.push(cellText(s, row, col));
    out.push(line);
  }
  return out;
}

/**
 * Builds the unvalidated candidate cells for filling `strip` (the new cells only, absolute view
 * coords) by extending `source`: reads source text, runs `generateFill`, then converts each
 * destination value back through its own column's `fromText`, skipping readOnly columns and rows
 * that don't resolve. Also returns `filled`, `generateFill`'s raw text grid, which `onFill`
 * needs BEFORE any validation runs (it can veto the fill outright). Exported for direct unit
 * testing; not part of the public hook surface.
 */
export function buildFillCandidates(
  s: DataGridStoreState,
  source: GridRect,
  strip: GridRect,
  opts: { forceCopy?: boolean } = {},
): { candidates: BulkCandidate[]; filled: string[][] } {
  const sourceValues = readRectAsText(s, source);
  const direction = fillDirection(source, strip);
  const relativeStrip = rectRelativeTo(strip, source);
  const filled = generateFill(sourceValues, relativeStrip, direction, opts);

  const candidates: BulkCandidate[] = [];
  for (let row = 0; row < strip.height; row++) {
    const viewRow = strip.y + row;
    const dataRowIndex = s.viewIndex[viewRow];
    if (dataRowIndex === undefined) continue;
    const dataRow = s.data[dataRowIndex];
    if (dataRow === undefined) continue;
    const rowId = s.getRowId(dataRow, dataRowIndex);

    for (let col = 0; col < strip.width; col++) {
      const colIndex = strip.x + col;
      const column = s.visibleColumns[colIndex];
      if (!column) continue;
      if (typeof column.readOnly === "function" ? column.readOnly(dataRow) : Boolean(column.readOnly)) continue;

      const cellType = s.cellTypes[column.type ?? "text"];
      if (!cellType) continue;

      // filled is generateFill's strip.height x strip.width output; row/col loop bounds match exactly
      const value = cellType.fromText(filled[row]![col]!, column.options);
      candidates.push({ viewRow, columnId: column.id, value, validate: column.validate, row: dataRow, rowId });
    }
  }
  return { candidates, filled };
}

/**
 * The fill write list plus `generateFill`'s raw text grid. `writes` is a Promise when a filled
 * column's schema validates asynchronously — the hook holds the batch until it resolves, then
 * applies the passing cells as one `applyCellUpdates`.
 */
export function buildFillWrites(
  s: DataGridStoreState,
  source: GridRect,
  strip: GridRect,
  opts: { forceCopy?: boolean } = {},
): { writes: BulkWrite[] | Promise<BulkWrite[]>; filled: string[][] } {
  const { candidates, filled } = buildFillCandidates(s, source, strip, opts);
  return { writes: resolveBulkWrites(candidates), filled };
}

/** Handlers for the fill-handle drag gesture (see fill-overlay.tsx's handle square) and the fillDown/fillRight shortcuts. */
export type FillHandleHandlers = {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  /** mod+D: fills the selection's top row downward across the rest of the range (no-op when height <= 1). */
  fillDown: () => void;
  /** mod+R: fills the selection's left column rightward across the rest of the range (no-op when width <= 1). */
  fillRight: () => void;
  /** Escape: discards an in-progress drag without applying any writes; no-op when no drag is active. */
  cancelFillDrag: () => void;
};

/**
 * Drives the fill-handle drag: pointerdown on the handle starts a document-level drag (capture +
 * rAF-throttled move + auto-scroll, mirroring `useGridInteraction`'s range drag), live-updates
 * the add-on's local `fillStore` via `computeFillTarget` (orthogonal axis snap), and on release
 * runs the shared fill pipeline (`buildFillWrites`) as one `applyCellUpdates` batch, expanding the
 * selection to `combineRects(source, strip)`. Alt held at release forces plain-copy tiling over
 * series inference.
 */
export function useFillHandle(options: UseFillHandleOptions): FillHandleHandlers {
  const { scrollRef, layout, onFill, fillStore } = options;
  const disabled = options.disabled === true;
  const actions = useDataGridActions();
  const storeApi = useDataGridStoreApi();
  // One counter for this add-on's fill surface: a newer fill supersedes a still-validating one.
  const guard = useBulkGeneration();

  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const dragRef = useRef<{ pointerId: number; source: GridRect } | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastPointerRef = useRef<{ clientX: number; clientY: number; altKey: boolean } | null>(null);
  const captureElementRef = useRef<Element | null>(null);
  const documentListenersRef = useRef<(() => void) | null>(null);

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const runFrame = useCallback(() => {
    const scrollElement = scrollRef.current;
    const pointer = lastPointerRef.current;
    const drag = dragRef.current;
    if (!scrollElement || !pointer || !drag) {
      rafRef.current = null;
      return;
    }
    const rect = scrollElement.getBoundingClientRect();

    if (pointer.clientY < rect.top + AUTO_SCROLL_ZONE) scrollElement.scrollTop -= AUTO_SCROLL_STEP;
    else if (pointer.clientY > rect.bottom - AUTO_SCROLL_ZONE) scrollElement.scrollTop += AUTO_SCROLL_STEP;
    // Inline-axis edge test + step, mirroring core's own drag auto-scroll (use-grid-interaction.ts).
    const direction = layoutRef.current.direction ?? "ltr";
    const inlineStep = inlineAutoScrollStep(pointer.clientX, rect, AUTO_SCROLL_ZONE, direction);
    if (inlineStep !== 0) applyInlineScrollDelta(scrollElement, inlineStep * AUTO_SCROLL_STEP, direction);

    const s = storeApi.getState();
    const rowCount = s.viewIndex.length;
    const colCount = s.visibleColumns.length;
    const coord = pointerToCoord(pointer.clientX, pointer.clientY, scrollElement, layoutRef.current, rowCount);

    const strip = computeFillTarget(drag.source, coord, { allowedDirections: "orthogonal", rowCount, colCount });
    fillStore.getState().setFillPreview(strip);

    rafRef.current = requestAnimationFrame(runFrame);
  }, [fillStore, scrollRef, storeApi]);

  /**
    * Runs the shared fill pipeline: builds candidates for `strip` (extending `source`), fires
    * `onFill` (which can veto), validates, applies one `applyCellUpdates` batch, and expands
   * the selection to `combineRects(source, strip)`.
   *
   * With an async schema on a filled column the write batch is HELD: the selection still expands
   * right away (the gesture's own feedback, unrelated to validation), and the cells commit in one
   * batch once every validator resolves. `guard` drops that resolution when a newer fill has started
   * or the rows it targeted are gone.
   */
  const runFill = useCallback(
    (source: GridRect, strip: GridRect, opts: { forceCopy?: boolean } = {}) => {
      const s = storeApi.getState();
      const { candidates, filled } = buildFillCandidates(s, source, strip, opts);

      let prevented = false;
      onFill?.({ source, target: strip, values: filled, preventDefault: () => (prevented = true) });
      if (prevented) return;

      const writes = resolveBulkWrites(candidates);
      if (writes instanceof Promise) {
        const token = guard.begin();
        const snapshot = snapshotBulkBatch(s, candidateRowIds(s, candidates));
        void writes.then((resolved) => {
          const current = storeApi.getState();
          if (!guard.isCurrent(token, current, snapshot)) return;
          const applied = guard.reresolve(current, resolved);
          actions.applyCellUpdates(applied, "fill");
          // Pulse the cells that actually landed — the re-resolved batch, not the held one.
          actions.flashCells(applied.map((w) => flashCellKey(w.viewRow, w.columnId)));
        });
      } else {
        actions.applyCellUpdates(writes, "fill");
        actions.flashCells(writes.map((w) => flashCellKey(w.viewRow, w.columnId)));
      }

      // expand selection to combineRects(source, strip): re-derive via the plain selectCell/extendTo
      // primitives (anchor at source's top-left corner, extend to the combined rect's far corner).
      const combined = combineRects(source, strip);
      actions.selectCell({ col: combined.x, row: combined.y });
      actions.extendTo({ col: combined.x + combined.width - 1, row: combined.y + combined.height - 1 });
    },
    [actions, guard, onFill, storeApi],
  );

  /** Releases pointer capture and clears all drag refs/listeners/rAF loop; returns the drag that was active, if any. */
  const teardownDrag = useCallback(() => {
    const drag = dragRef.current;
    const pointerId = drag?.pointerId;
    const captureEl = captureElementRef.current as (Element & { hasPointerCapture?: (id: number) => boolean; releasePointerCapture?: (id: number) => void }) | null;
    if (captureEl && pointerId !== undefined && captureEl.hasPointerCapture?.(pointerId)) {
      captureEl.releasePointerCapture?.(pointerId);
    }
    captureElementRef.current = null;
    dragRef.current = null;
    lastPointerRef.current = null;
    stopLoop();
    documentListenersRef.current?.();
    documentListenersRef.current = null;
    return drag;
  }, [stopLoop]);

  const endDrag = useCallback(() => {
    const pointer = lastPointerRef.current;
    const drag = teardownDrag();
    if (!drag) return;
    const strip = fillStore.getState().fillPreview;
    fillStore.getState().setFillPreview(null);
    if (!strip) return;

    runFill(drag.source, strip, { forceCopy: pointer?.altKey === true });
  }, [fillStore, runFill, teardownDrag]);

  /** Escape mid-drag: tears down the drag and clears the preview without applying any writes. */
  const cancelFillDrag = useCallback(() => {
    const drag = teardownDrag();
    if (!drag) return;
    fillStore.getState().setFillPreview(null);
  }, [fillStore, teardownDrag]);

  const beginDrag = useCallback(
    (source: GridRect, pointerId: number, captureElement?: Element) => {
      dragRef.current = { pointerId, source };
      captureElementRef.current = captureElement ?? null;
      if (rafRef.current === null) rafRef.current = requestAnimationFrame(runFrame);

      if (!documentListenersRef.current) {
        const onMove = (event: PointerEvent) => {
          if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
          lastPointerRef.current = { clientX: event.clientX, clientY: event.clientY, altKey: event.altKey };
        };
        const onUp = (event: PointerEvent) => {
          if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
          if (lastPointerRef.current) lastPointerRef.current.altKey = event.altKey;
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
    [runFrame, endDrag],
  );

  useEffect(() => () => documentListenersRef.current?.(), []);
  useEffect(() => stopLoop, [stopLoop]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 || disabled) return;
      const s = storeApi.getState();
      if (!s.selection.current) return;
      event.preventDefault();
      event.stopPropagation();
      lastPointerRef.current = { clientX: event.clientX, clientY: event.clientY, altKey: event.altKey };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      beginDrag(s.selection.current.range, event.pointerId, event.currentTarget);
    },
    [beginDrag, disabled, storeApi],
  );

  const fillDown = useCallback(() => {
    if (disabled) return;
    const range = storeApi.getState().selection.current?.range;
    if (!range || range.height <= 1) return;
    const source: GridRect = { x: range.x, y: range.y, width: range.width, height: 1 };
    const strip: GridRect = { x: range.x, y: range.y + 1, width: range.width, height: range.height - 1 };
    runFill(source, strip);
  }, [disabled, runFill, storeApi]);

  const fillRight = useCallback(() => {
    if (disabled) return;
    const range = storeApi.getState().selection.current?.range;
    if (!range || range.width <= 1) return;
    const source: GridRect = { x: range.x, y: range.y, width: 1, height: range.height };
    const strip: GridRect = { x: range.x + 1, y: range.y, width: range.width - 1, height: range.height };
    runFill(source, strip);
  }, [disabled, runFill, storeApi]);

  // Stable object identity when none of the four callbacks changed — the add-on's own plugin
  // closure and DataGridRoot's context value depend on this reference, so a fresh literal here
  // would defeat that memo on every render.
  return useMemo(
    () => ({ onPointerDown, fillDown, fillRight, cancelFillDrag }),
    [onPointerDown, fillDown, fillRight, cancelFillDrag],
  );
}
