"use client";

import { useCallback, useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { getCellValue, useDataGridActions, type CellRef, type GridRect } from "@/registry/default/blocks/data-grid/data-grid";
import {
  applyInlineScrollDelta,
  combineRects,
  isColumnReadOnly,
  isDev,
  isThenable,
  toSafeText,
  inlineAutoScrollStep,
  candidateRowIds,
  gridAttrSelector,
  pointerToCoord,
  dataIndexAt,
  rowAtViewRow,
  rowIdAtViewRow,
  safeSetPointerCapture,
  resolveBulkWrites,
  resolveColumnValidate,
  safeFromText,
  isRejectedText,
  isUnparseable,
  type ParsedCellText,
  snapshotBulkBatch,
  useBulkGeneration,
  useDataGridStoreApi,
  useDataGridGateTracker,
  type BulkCandidate,
  type GateRun,
  type BulkResolution,
  type InteractionLayout,
  type DataGridReadState,
  GRID_ROLE_SELECTOR,
} from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { computeFillTarget, fillDirection, generateFill, rectRelativeTo, type FillDirection, type SeriesDescriptor } from "./fill";
import type { FillStoreApi } from "./fill-store";

const rowsOf = (rect: GridRect) => Array.from({ length: rect.height }, (_, i) => ({ viewRowIndex: rect.y + i }));

/** Cells a fill is about to write, resolved before the write so a re-sort cannot shift them. */
function flashCellsFor(s: DataGridReadState, writes: readonly { viewRowIndex: number; columnId: string }[]): CellRef[] {
  return writes.flatMap((w) => {
    const rowId = rowIdAtViewRow(s, w.viewRowIndex);
    return rowId === undefined ? [] : [{ rowId, columnId: w.columnId }];
  });
}

/** rAF-throttled auto-scroll step (px), matching `useGridInteraction`'s drag auto-scroll. */
const AUTO_SCROLL_STEP = 16;
/** Distance (px) from a viewport edge at which drag auto-scroll kicks in. */
const AUTO_SCROLL_ZONE = 24;

/** The context `processFill` receives. */
export type ProcessFillContext = {
  /** The cells the fill extends. For Ctrl/Cmd+D it is the top row, for Ctrl/Cmd+R the left column. */
  source: GridRect;
  /** The new cells the fill writes. */
  target: GridRect;
  /** The fill text for `target`, before parsing and validation. */
  cells: string[][];
  /** Aborts when a newer fill supersedes this one, the grid turns read-only, or the grid unmounts. Pass it to the request an async `processFill` makes. */
  signal: AbortSignal;
};

/** Options for {@link useFillHandle}. */
export type UseFillHandleOptions = {
  scrollRef: RefObject<HTMLElement | null>;
  layout: InteractionLayout;
  /** Turns the whole fill feature off (handle hidden, `fillDown`/`fillRight` no-op). Default `false`; a read-only grid disables fill regardless of this option. */
  disabled?: boolean;
  /**
   * Runs before a fill writes (drag release, fill down, fill right). Return the text grid to write, which goes through each column's `fromText` and `validate` like a paste, or `false` to veto the
   * fill: nothing is written and the selection does not expand. A promise holds the fill as the `processFill` gate
   * (`useDataGridGatePending`, `gateTimeoutMs`); the selection expands and the cells write once it resolves.
   */
  processFill?: (ctx: ProcessFillContext) => string[][] | false | Promise<string[][] | false>;
  /** Replaces the built-in series detector (`detectSeries`) â€” the add-on's default remains the built-in one. */
  detectSeries?: (values: readonly string[]) => SeriesDescriptor | null;
  /** This add-on's local fill-preview store â€” owns the in-progress drag rect (kept out of core). */
  fillStore: FillStoreApi;
};

/** Reads one cell's text value via its column's cell type `toText`, for use as a fill source. */
function cellText(s: DataGridReadState, viewRow: number, colIndex: number): string {
  const column = s.visibleColumns[colIndex];
  if (!column) return "";
  const row = rowAtViewRow(s, viewRow);
  if (row === undefined) return "";
  const cellType = s.cellTypes[column.type ?? "text"];
  if (!cellType) return "";
  // explicit TData=unknown: row's `undefined`-narrowed type ({} | null) would otherwise drive inference instead of column's own already-unknown TData.
  const value = getCellValue<unknown, typeof column>(row, column);
  return cellType.toText(value, column.options);
}

/** The source cell the plain copy puts at strip cell (`row`, `col`): its column and stored value. */
function tiledSourceCell(
  s: DataGridReadState,
  source: GridRect,
  relativeStrip: GridRect,
  direction: FillDirection,
  row: number,
  col: number,
): { columnId: string; value: unknown } | undefined {
  const wrap = (index: number, size: number) => ((index % size) + size) % size;
  const vertical = direction === "up" || direction === "down";
  const sourceRow = vertical ? wrap(relativeStrip.y + row, source.height) : relativeStrip.y + row;
  const sourceCol = vertical ? relativeStrip.x + col : wrap(relativeStrip.x + col, source.width);
  const column = s.visibleColumns[source.x + sourceCol];
  const dataRow = rowAtViewRow(s, source.y + sourceRow);
  if (!column || dataRow === undefined) return undefined;
  return { columnId: column.id, value: getCellValue<unknown, typeof column>(dataRow, column) };
}

/** Reads `rect` as a 2D string grid via each cell type's `toText` â€” the fill algorithm's raw input. */
export function readRectAsText(s: DataGridReadState, rect: GridRect): string[][] {
  const out: string[][] = [];
  for (let row = rect.y; row < rect.y + rect.height; row++) {
    const line: string[] = [];
    for (let col = rect.x; col < rect.x + rect.width; col++) line.push(cellText(s, row, col));
    out.push(line);
  }
  return out;
}

/**
 * Generates the fill text for `strip` (the new cells only, absolute view coords) by extending
 * `source`: reads source text and runs `generateFill`. `processFill` sees this grid before any
 * parsing or validation. Exported for direct unit testing; not part of the public hook surface.
 */
export function generateFillText(
  s: DataGridReadState,
  source: GridRect,
  strip: GridRect,
  opts: { forceCopy?: boolean; detect?: (values: readonly string[]) => SeriesDescriptor | null } = {},
): string[][] {
  const sourceValues = readRectAsText(s, source);
  return generateFill(sourceValues, rectRelativeTo(strip, source), fillDirection(source, strip), opts);
}

/** The plain-copy tiling of a fill: the strip as it reads when no series continues, and where each tile comes from. */
export type PlainFill = { source: GridRect; relativeStrip: GridRect; direction: FillDirection; tiled: string[][] };

export function plainFillOf(
  s: DataGridReadState,
  source: GridRect,
  strip: GridRect,
  opts: { detect?: (values: readonly string[]) => SeriesDescriptor | null } = {},
): PlainFill {
  const direction = fillDirection(source, strip);
  const relativeStrip = rectRelativeTo(strip, source);
  return { source, relativeStrip, direction, tiled: generateFill(readRectAsText(s, source), relativeStrip, direction, { ...opts, forceCopy: true }) };
}

/**
 * Builds the unvalidated candidate cells for `strip` from its fill text: converts each text back
 * through its own column's `fromText`, skipping readOnly columns, rows that don't resolve, and
 * cells the text grid does not cover. With `plain`, a run that continues no series, or whose
 * column rejects a generated text, copies the stored source values instead of their text.
 * Exported for direct unit testing; not part of the public hook surface.
 */
export function buildFillCandidatesFromText(s: DataGridReadState, strip: GridRect, filled: readonly (readonly string[])[], plain?: PlainFill): BulkCandidate[] {
  const vertical = plain?.direction === "up" || plain?.direction === "down";
  // a run is the strip column of a vertical fill and the strip row of a horizontal one
  const runOf = (row: number, col: number) => (vertical ? col : row);
  const seriesRuns = new Set<number>();
  const rejectedRuns = new Set<number>();
  const entries: { row: number; col: number; viewRow: number; column: (typeof s.visibleColumns)[number]; cellType: NonNullable<(typeof s.cellTypes)[string]>; dataRow: Exclude<(typeof s.data)[number], undefined>; rowId: string; parsed: ParsedCellText }[] = [];
  let skippedHoleRows = 0;
  for (let row = 0; row < strip.height; row++) {
    const viewRow = strip.y + row;
    const dataRowIndex = dataIndexAt(s, viewRow);
    if (dataRowIndex === undefined) continue;
    const dataRow = s.data[dataRowIndex];
    if (dataRow === undefined) {
      // an unloaded hole of a lazy grid: the row is real (in viewIndex) but has no row object
      skippedHoleRows++;
      continue;
    }
    const rowId = s.getRowId(dataRow, dataRowIndex);

    for (let col = 0; col < strip.width; col++) {
      const colIndex = strip.x + col;
      const column = s.visibleColumns[colIndex];
      if (!column) continue;
      if (isColumnReadOnly(column, dataRow)) continue;

      const cellType = s.cellTypes[column.type ?? "text"];
      if (!cellType) continue;

      const text = filled[row]?.[col];
      if (text === undefined) continue;
      const parsed = safeFromText(cellType, text, column.options, resolveColumnValidate(column, cellType));
      if (plain && text !== plain.tiled[row]?.[col]) seriesRuns.add(runOf(row, col));
      if (plain && text !== "" && (isRejectedText(parsed) || (!isUnparseable(parsed) && cellType.isEmpty(parsed.value)))) rejectedRuns.add(runOf(row, col));
      entries.push({ row, col, viewRow, column, cellType, dataRow, rowId, parsed });
    }
  }

  const candidates: BulkCandidate[] = entries.map((entry) => {
    let { value, validate } = entry.parsed;
    if (plain) {
      const run = runOf(entry.row, entry.col);
      const rejected = rejectedRuns.has(run);
      if (rejected || !seriesRuns.has(run)) {
        const sourceCell = tiledSourceCell(s, plain.source, plain.relativeStrip, plain.direction, entry.row, entry.col);
        if (sourceCell?.columnId === entry.column.id) {
          value = sourceCell.value;
          validate = resolveColumnValidate(entry.column, entry.cellType);
        } else if (rejected) {
          ({ value, validate } = safeFromText(entry.cellType, plain.tiled[entry.row]![entry.col]!, entry.column.options, resolveColumnValidate(entry.column, entry.cellType)));
        }
      }
    }
    return { viewRowIndex: entry.viewRow, columnId: entry.column.id, value, validate, row: entry.dataRow, rowId: entry.rowId, warn: entry.column.validationMode === "warn" };
  });
  if (skippedHoleRows > 0 && isDev()) {
    console.warn(
      `[data-grid-fill] the fill target skipped ${skippedHoleRows} unloaded row(s) (lazy grid): unloaded cells are never filled and the selection still expands over them. Fill over a lazy grid covers loaded rows only.`,
    );
  }
  return candidates;
}

/** The candidates and the fill text for `strip`; the composition of {@link generateFillText} and {@link buildFillCandidatesFromText}. */
export function buildFillCandidates(
  s: DataGridReadState,
  source: GridRect,
  strip: GridRect,
  opts: { forceCopy?: boolean; detect?: (values: readonly string[]) => SeriesDescriptor | null } = {},
): { candidates: BulkCandidate[]; filled: string[][] } {
  const filled = generateFillText(s, source, strip, opts);
  return { candidates: buildFillCandidatesFromText(s, strip, filled, plainFillOf(s, source, strip, opts)), filled };
}

/**
 * The fill resolution (accepted writes plus rejected cells) plus `generateFill`'s raw text grid.
 * `resolution` is a Promise when a filled column's schema validates asynchronously â€” the hook holds
 * the batch until it resolves, then applies the passing cells as one `applyCellUpdates`.
 */
export function buildFillWrites(
  s: DataGridReadState,
  source: GridRect,
  strip: GridRect,
  opts: { forceCopy?: boolean; detect?: (values: readonly string[]) => SeriesDescriptor | null } = {},
): { resolution: BulkResolution | Promise<BulkResolution>; filled: string[][] } {
  const { candidates, filled } = buildFillCandidates(s, source, strip, opts);
  return { resolution: resolveBulkWrites(candidates, s), filled };
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
 * rAF-throttled move + auto-scroll), live-updates
 * the add-on's local `fillStore` via `computeFillTarget` (orthogonal axis snap), and on release
 * runs the shared fill pipeline (`buildFillWrites`) as one `applyCellUpdates` batch, expanding the
 * selection to `combineRects(source, strip)`. Alt held at release forces plain-copy tiling over
 * series inference.
 */
export function useFillHandle(options: UseFillHandleOptions): FillHandleHandlers {
  const { scrollRef, layout, processFill, detectSeries, fillStore } = options;
  const disabled = options.disabled === true;
  const actions = useDataGridActions();
  const storeApi = useDataGridStoreApi();
  // One counter for this add-on's fill surface: a newer fill supersedes a still-validating one.
  const guard = useBulkGeneration();
  const gates = useDataGridGateTracker();
  const heldRun = useRef<GateRun | null>(null);

  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const callbacksRef = useRef({ processFill, detectSeries });
  callbacksRef.current = { processFill, detectSeries };

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

  const finishFill = useCallback(
    (s: ReturnType<typeof storeApi.getState>, source: GridRect, strip: GridRect, processed: string[][]) => {
      const { detectSeries } = callbacksRef.current;
      const candidates = buildFillCandidatesFromText(s, strip, processed, plainFillOf(s, source, strip, { detect: detectSeries }));

      const resolution = resolveBulkWrites(candidates, s);
      if (resolution instanceof Promise) {
        const token = guard.begin();
        const snapshot = snapshotBulkBatch(s, candidateRowIds(s, candidates));
        if (heldRun.current && !heldRun.current.aborted) gates.abortRun(heldRun.current, "superseded");
        const run = (heldRun.current = gates.begin("validate", (now) => now.readOnly));
        gates.hold(run);
        const settle = () => {
          gates.settle(run);
          if (heldRun.current === run) heldRun.current = null;
          return !run.aborted;
        };
        void resolution.then((resolved) => {
          const current = storeApi.getState();
          if (!settle() || current.readOnly || !guard.isCurrent(token, current, snapshot)) return;
          const applied = guard.reresolve(current, resolved.writes);
          const flashed = flashCellsFor(current, applied);
          // rejected cells are reported by the write itself (same source, after the write's emit)
          actions.applyCellUpdates(applied, "fill", resolved.rejected, resolved.warnings);
          // Pulse the cells that actually landed — the re-resolved batch, not the held one.
          actions.flashCells(flashed);
        }, settle);
      } else {
        const flashed = flashCellsFor(storeApi.getState(), resolution.writes);
        actions.applyCellUpdates(resolution.writes, "fill", resolution.rejected, resolution.warnings);
        actions.flashCells(flashed);
      }

      // expand selection to combineRects(source, strip): re-derive via the plain selectCell/extendTo
      // primitives (anchor at source's top-left corner, extend to the combined rect's far corner).
      const combined = combineRects(source, strip);
      actions.selectCellAt({ col: combined.x, row: combined.y });
      actions.extendToAt({ col: combined.x + combined.width - 1, row: combined.y + combined.height - 1 });
    },
    [actions, gates, guard, storeApi],
  );

  /**
   * Runs the shared fill pipeline: generates the fill text for `strip` (extending `source`), runs
   * `processFill` (which can rewrite or veto, and may answer with a promise), parses, validates, applies one `applyCellUpdates` batch, and expands
   * the selection to `combineRects(source, strip)`.
   *
   * With an async schema on a filled column the write batch is HELD: the selection still expands
   * right away (the gesture's own feedback, unrelated to validation), and the cells commit in one
   * batch once every validator resolves. `guard` drops that resolution when a newer fill has started
   * or the rows it targeted are gone. An async `processFill` holds the whole fill, selection included, under the same rules.
   */
  const runFill = useCallback(
    (source: GridRect, strip: GridRect, opts: { forceCopy?: boolean } = {}) => {
      const s = storeApi.getState();
      const { processFill, detectSeries } = callbacksRef.current;
      const filled = generateFillText(s, source, strip, { ...opts, detect: detectSeries });
      if (heldRun.current && !heldRun.current.aborted) gates.abortRun(heldRun.current, "superseded");
      const run = gates.begin("processFill", (now) => now.readOnly);
      const processed = processFill ? processFill({ source, target: strip, cells: filled, signal: run.signal }) : filled;
      if (!isThenable<string[][] | false>(processed)) {
        if (processed !== false) finishFill(s, source, strip, processed);
        return;
      }

      heldRun.current = run;
      gates.hold(run);
      const token = guard.begin();
      const snapshot = snapshotBulkBatch(s, candidateRowIds(s, [...rowsOf(source), ...rowsOf(strip)]));
      const settle = () => {
        gates.settle(run);
        if (heldRun.current === run) heldRun.current = null;
        return !run.aborted;
      };
      void processed.then(
        (final) => {
          const current = storeApi.getState();
          if (!settle() || final === false || current.readOnly || !guard.isCurrent(token, current, snapshot)) return;
          finishFill(current, source, strip, final);
        },
        (error: unknown) => {
          if (settle() && isDev()) console.warn(`[data-grid] processFill rejected, so the fill is cancelled: ${toSafeText(error)}`);
        },
      );
    },
    [finishFill, gates, guard, storeApi],
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
        const onCancel = (event: PointerEvent) => {
          if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
          cancelFillDrag();
        };
        const onLostCapture = (event: PointerEvent) => {
          if (event.target === captureElementRef.current) onCancel(event);
        };
        const onBlur = () => cancelFillDrag();
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
        document.addEventListener("pointercancel", onCancel);
        document.addEventListener("lostpointercapture", onLostCapture);
        window.addEventListener("blur", onBlur);
        documentListenersRef.current = () => {
          document.removeEventListener("pointermove", onMove);
          document.removeEventListener("pointerup", onUp);
          document.removeEventListener("pointercancel", onCancel);
          document.removeEventListener("lostpointercapture", onLostCapture);
          window.removeEventListener("blur", onBlur);
        };
      }
    },
    [runFrame, endDrag, cancelFillDrag],
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
      // preventDefault above stops the native focus move, so undo shortcuts would miss the grid
      const grid = scrollRef.current;
      const active = grid && [...grid.querySelectorAll<HTMLElement>(gridAttrSelector("active"))].find((cell) => cell.closest(GRID_ROLE_SELECTOR) === grid);
      (active ?? grid)?.focus({ preventScroll: true });
      lastPointerRef.current = { clientX: event.clientX, clientY: event.clientY, altKey: event.altKey };
      // the handle unmounts when auto-scroll moves the source out of the window; the scroll element's capture outlives it
      const captureElement = scrollRef.current ?? event.currentTarget;
      safeSetPointerCapture(captureElement, event.pointerId);
      beginDrag(s.selection.current.range, event.pointerId, captureElement);
    },
    [beginDrag, disabled, scrollRef, storeApi],
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

  // Stable object identity when none of the four callbacks changed â€” the add-on's own plugin
  // closure and DataGridRoot's context value depend on this reference, so a fresh literal here
  // would defeat that memo on every render.
  return useMemo(
    () => ({ onPointerDown, fillDown, fillRight, cancelFillDrag }),
    [onPointerDown, fillDown, fillRight, cancelFillDrag],
  );
}
