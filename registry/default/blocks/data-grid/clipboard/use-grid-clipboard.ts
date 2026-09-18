"use client";

import { useCallback, useEffect, type RefObject } from "react";
import type { CellCoord, GridRect } from "../types";
import { getCellValue } from "../columns/column-helpers";
import { isDev } from "../is-dev";
import { serializeCells } from "./serialize-cells";
import { parseClipboard } from "./parse-clipboard";
import { useDataGridActions, useDataGridStoreApi, type DataGridActions, type DataGridStoreState } from "../store";
import { resolveBulkWrites, type BulkCandidate, type BulkWrite } from "../validation/validate-batch";
import { candidateRowIds, reresolveBulkWrites, snapshotBulkBatch, useBulkGeneration, type BulkGeneration } from "../validation/bulk-generation";

/** Options for {@link useGridClipboard}. */
export type UseGridClipboardOptions = {
  rootRef: RefObject<HTMLElement | null>;
  readOnly?: boolean;
};

/**
 * Copy scope per glide-behavior-spec.md §4: the primary range if one exists (ignoring the range
 * stack — multi-rect copy is document-scoped to the primary range only), else the selected rows
 * (full width) or selected columns (full height) as their disjoint member lists — a CompactSelection
 * from Ctrl-click is RLE and may hold non-contiguous members, so this must not collapse to a
 * min..max bounding rect (that would silently include unselected rows/columns in between).
 */
export type CopyScope = { kind: "rect"; rect: GridRect } | { kind: "rows"; rows: number[] } | { kind: "columns"; columns: number[] };

/** Resolves the copy scope; returns null when nothing is selected. Exported for direct unit testing; not part of the public hook surface. */
export function resolveCopyScope(s: DataGridStoreState): CopyScope | null {
  if (s.selection.current) return { kind: "rect", rect: s.selection.current.range };
  const rows = s.selection.rows.toArray();
  if (rows.length > 0) return { kind: "rows", rows };
  const cols = s.selection.columns.toArray();
  if (cols.length > 0) return { kind: "columns", columns: cols };
  return null;
}

/** Serializes one view row's `[colStart, colStart + colCount)` slice via each cell type's `toText`. */
function serializeRowSlice(s: DataGridStoreState, viewRow: number, colStart: number, colCount: number): string[] {
  const dataRowIndex = s.viewIndex[viewRow];
  const row = dataRowIndex === undefined ? undefined : s.data[dataRowIndex];
  const cells: string[] = [];
  for (let col = colStart; col < colStart + colCount; col++) {
    const column = s.visibleColumns[col];
    if (!column || row === undefined) {
      cells.push("");
      continue;
    }
    const cellType = s.cellTypes[column.type ?? "text"];
    // explicit TData=unknown: row's `undefined`-narrowed type ({} | null) would otherwise drive inference instead of column's own already-unknown TData.
    const value = getCellValue<unknown, typeof column>(row, column);
    const text = s.processCellForClipboard
      ? s.processCellForClipboard(value, { row, column })
      : (cellType?.toText(value, column.options) ?? "");
    cells.push(text);
  }
  return cells;
}

/** Serializes `rect` to a 2D string grid via each cell type's `toText`, honoring `processCellForClipboard` when provided. */
export function serializeRect(s: DataGridStoreState, rect: GridRect): string[][] {
  const out: string[][] = [];
  for (let viewRow = rect.y; viewRow < rect.y + rect.height; viewRow++) {
    out.push(serializeRowSlice(s, viewRow, rect.x, rect.width));
  }
  return out;
}

/**
 * A copy above this many cells is truncated to the rows that fit — no spreadsheet accepts a
 * clipboard payload this large anyway, and below this cap output is byte-identical to the
 * uncapped path (2026-08-02 optimization audit, confirmed medium; same precedent as
 * `MAX_SEARCH_MATCHES` in store/compute.ts). 200k cells is generously above any realistic manual
 * copy while still bounding the worst case (a Ctrl+A copy on a 100k-row grid) to a few seconds.
 */
export const MAX_COPY_CELLS = 200_000;

/**
 * Serializes an explicit, disjoint list of view rows against an explicit, disjoint list of view
 * columns — the shared engine for the "rows" (all visible columns) and "columns" (explicit column
 * indices) copy-scope branches. Column + cellType resolution happens once per selected column,
 * hoisted OUTSIDE the row loop, instead of `serializeRowSlice`'s per-(row,col) re-resolution — the
 * columns branch used to call `serializeRowSlice(s, viewRow, col, 1)` once per cell, re-reading
 * `visibleColumns`/`cellTypes` and allocating a throwaway 1-element array every time (2026-08-02
 * optimization audit, confirmed medium). Truncates at {@link MAX_COPY_CELLS}.
 */
function serializeDisjointRows(s: DataGridStoreState, rows: readonly number[], cols: readonly number[]): string[][] {
  const resolved = cols.map((col) => {
    const column = s.visibleColumns[col];
    return column ? { column, cellType: s.cellTypes[column.type ?? "text"] } : null;
  });

  const maxRows = cols.length === 0 ? rows.length : Math.max(1, Math.floor(MAX_COPY_CELLS / cols.length));
  const rowCount = Math.min(rows.length, maxRows);

  const out: string[][] = [];
  for (let r = 0; r < rowCount; r++) {
    const viewRow = rows[r]!; // r < rowCount <= rows.length
    const dataRowIndex = s.viewIndex[viewRow];
    const row = dataRowIndex === undefined ? undefined : s.data[dataRowIndex];
    const cells: string[] = [];
    for (const entry of resolved) {
      if (!entry || row === undefined) {
        cells.push("");
        continue;
      }
      const { column, cellType } = entry;
      // explicit TData=unknown: row's `undefined`-narrowed type ({} | null) would otherwise drive inference instead of column's own already-unknown TData.
      const value = getCellValue<unknown, typeof column>(row, column);
      const text = s.processCellForClipboard
        ? s.processCellForClipboard(value, { row, column })
        : (cellType?.toText(value, column.options) ?? "");
      cells.push(text);
    }
    out.push(cells);
  }
  return out;
}

/** All view-row indices `[0, rowCount)`, as a plain array — the "columns" scope's implicit row list. */
function allViewRows(s: DataGridStoreState): number[] {
  return Array.from({ length: s.viewIndex.length }, (_, i) => i);
}

/**
 * Serializes a copy scope, preserving disjoint row/column membership (a Ctrl-click multi-select
 * copies exactly the selected rows/columns, never the rows/columns in between). All three scopes
 * are capped at {@link MAX_COPY_CELLS}. The rect scope needs the cap too because two-stage Ctrl+A
 * produces a whole-grid rect (selection/select-all-progression.ts), so "visually bounded by what
 * the user dragged" does not bound a select-all copy.
 */
export function serializeCopyScope(s: DataGridStoreState, scope: CopyScope): string[][] {
  if (scope.kind === "rect") {
    const maxRows = Math.max(1, Math.floor(MAX_COPY_CELLS / Math.max(1, scope.rect.width)));
    return serializeRect(s, { ...scope.rect, height: Math.min(scope.rect.height, maxRows) });
  }
  if (scope.kind === "rows") {
    return serializeDisjointRows(
      s,
      scope.rows,
      Array.from({ length: s.visibleColumns.length }, (_, i) => i),
    );
  }
  return serializeDisjointRows(s, allViewRows(s), scope.columns);
}

/** Writes both `text/plain` (TSV) and `text/html` (table) to a clipboard event's DataTransfer. */
function writeClipboardEvent(event: ClipboardEvent, cells: string[][]): void {
  const { text, html } = serializeCells(cells);
  event.clipboardData?.setData("text/plain", text);
  event.clipboardData?.setData("text/html", html);
}

/**
 * Single pasted row tiles down to fill a taller target selection height (react-datasheet-grid
 * nicety, research/react-datasheet-grid-study.md §4); otherwise the parsed grid is used as-is.
 * Exported for direct unit testing; not part of the public hook surface.
 */
export function tileToHeight(cells: string[][], height: number): string[][] {
  if (cells.length !== 1 || height <= 1) return cells;
  const onlyRow = cells[0]!; // cells.length === 1 checked above
  return Array.from({ length: height }, () => onlyRow);
}

/** Max cells a single paste may touch — same rationale/precedent as {@link MAX_COPY_CELLS}. */
export const MAX_PASTE_CELLS = 200_000;

/**
 * Truncates a paste grid to the first rows that fit under `maxCells` (row-summed). The paste anchor
 * is the target's top-left, so the HEAD rows are kept — dropping them would silently skip the rows
 * the user intended to paste first. Below the cap the input is returned unchanged.
 */
export function truncatePasteGrid(cells: string[][], maxCells: number): string[][] {
  let total = 0;
  for (let i = 0; i < cells.length; i++) {
    const row = cells[i]!; // i < cells.length by loop condition
    if (total + row.length > maxCells) return cells.slice(0, i);
    total += row.length;
  }
  return cells;
}

/**
 * Resolves the paste target per glide-behavior-spec.md §4: top-left of `current.range`, else the
 * lowest selected column at row 0, else the lowest selected row at col 0. `activeCell` alone isn't
 * enough — selectRow/selectColumn (row-marker/header click) never set it, so a column- or
 * row-only selection needs its own fallback here rather than silently no-op'ing the paste.
 */
export function resolvePasteTarget(s: DataGridStoreState): CellCoord | null {
  if (s.selection.current) return { col: s.selection.current.range.x, row: s.selection.current.range.y };
  const cols = s.selection.columns.toArray();
  if (cols.length > 0) return { col: Math.min(...cols), row: 0 };
  const rows = s.selection.rows.toArray();
  if (rows.length > 0) return { col: 0, row: Math.min(...rows) };
  return s.activeCell;
}

/** Height (in view rows) of the paste target: current range's height if >1 row, else 1 (anchored expand). */
export function targetHeight(s: DataGridStoreState): number {
  const range = s.selection.current?.range;
  return range && range.height > 1 ? range.height : 1;
}

/**
 * Builds the unvalidated candidate cells for an anchored-expand paste: `cells` written at `target`
 * top-left, clipped at grid bounds, skipping readOnly columns and rows that don't resolve. Values are
 * parsed via `processCellFromClipboard` when provided, else the cell type's `fromText`. Validation is
 * the caller's next step ({@link buildPasteWrites} for the sync answer, `resolveBulkWrites` when a
 * column's schema is async). Exported for direct unit testing; not part of the public hook surface.
 */
export function buildPasteCandidates(s: DataGridStoreState, cells: string[][], target: CellCoord): BulkCandidate[] {
  const candidates: BulkCandidate[] = [];
  const rowCount = s.viewIndex.length;
  const colCount = s.visibleColumns.length;

  for (let r = 0; r < cells.length; r++) {
    const viewRow = target.row + r;
    if (viewRow >= rowCount) break;
    const dataRowIndex = s.viewIndex[viewRow];
    if (dataRowIndex === undefined) continue;
    const row = s.data[dataRowIndex];
    if (row === undefined) continue;
    const rowId = s.getRowId(row, dataRowIndex);

    const sourceRow = cells[r]!; // r < cells.length by loop condition
    for (let c = 0; c < sourceRow.length; c++) {
      const col = target.col + c;
      if (col >= colCount) break;
      const column = s.visibleColumns[col];
      if (!column) continue;
      if (typeof column.readOnly === "function" ? column.readOnly(row) : Boolean(column.readOnly)) continue;

      const cellType = s.cellTypes[column.type ?? "text"];
      if (!cellType) continue;

      const text = sourceRow[c]!; // c < sourceRow.length by loop condition
      const value = s.processCellFromClipboard
        ? s.processCellFromClipboard(text, { row, column })
        : cellType.fromText(text, column.options);

      candidates.push({ viewRow, columnId: column.id, value, validate: column.validate, row, rowId });
    }
  }
  return candidates;
}

/**
 * The paste-write list: {@link buildPasteCandidates} validated through {@link resolveBulkWrites}, so
 * an array when every touched column validates synchronously and a Promise for it when one does not.
 * Kept as a named export for consumers and tests that want the pure answer without the store.
 */
export function buildPasteWrites(
  s: DataGridStoreState,
  cells: string[][],
  target: CellCoord,
): BulkWrite[] | Promise<BulkWrite[]> {
  return resolveBulkWrites(buildPasteCandidates(s, cells, target));
}

/**
 * The paste application core (parse -> tile -> processPaste -> writes -> applyCellUpdates),
 * shared by the native `paste` event handler and {@link pasteText} (PLAN §8 extension point b) so
 * both funnel through one pipeline. `cells` is already parsed (HTML-table or TSV); returns `false`
 * when there was nothing to paste (empty parse, no target, or `processPaste` vetoed it) so callers
 * can distinguish "nothing happened" from a successful write.
 *
 * A touched column with an ASYNC schema makes the write list a Promise: the batch is held, and the
 * single `applyCellUpdates` runs on resolution — still one commit, one DataChange, still dropping
 * failing cells silently. `guard` then decides whether that resolution may land at all; without one
 * (a direct call in a test) a resolved batch always applies. `true` here means "a paste started",
 * which for an async batch is not yet "cells changed".
 */
function applyParsedPaste(
  s: DataGridStoreState,
  actions: DataGridActions,
  cells: string[][],
  guard?: BulkGeneration,
  storeApi?: { getState: () => DataGridStoreState },
): boolean {
  if (cells.length === 0) return false;
  const target = resolvePasteTarget(s);
  if (!target) return false;

  const tiled = tileToHeight(cells, targetHeight(s));
  const finalCells = s.processPaste ? s.processPaste(tiled, target) : tiled;
  if (finalCells === false) return false;

  // Cap AFTER processPaste so a consumer hook cannot re-expand a truncated grid past the bound.
  const cappedCells = truncatePasteGrid(finalCells, MAX_PASTE_CELLS);
  if (cappedCells.length < finalCells.length && isDev()) {
    console.warn(`gridcn: paste truncated to ${cappedCells.length} of ${finalCells.length} rows (MAX_PASTE_CELLS)`);
  }

  const candidates = buildPasteCandidates(s, cappedCells, target);
  const writes = resolveBulkWrites(candidates);
  if (!(writes instanceof Promise)) {
    actions.applyCellUpdates(writes, "paste");
    return true;
  }

  const token = guard?.begin();
  const snapshot = snapshotBulkBatch(s, candidateRowIds(s, candidates));
  void writes.then((resolved) => {
    const current = storeApi?.getState() ?? s;
    if (guard && token !== undefined && !guard.isCurrent(token, current, snapshot)) return;
    actions.applyCellUpdates(reresolveBulkWrites(current, resolved), "paste");
  });
  return true;
}

/**
 * Applies pasted plain text through the same pipeline the native `paste` event uses (parse -> tile
 * -> processPaste -> writes -> applyCellUpdates), for triggers outside a native ClipboardEvent
 * (context-menu Paste, programmatic paste). Text-only — no HTML-table fidelity, since there's no
 * `text/html` payload to prefer; parity with a plain-text native paste. Returns whether a paste
 * started (false when there's no paste target or `processPaste` vetoed it); with an async schema on
 * a touched column the cells commit once it resolves.
 */
export function pasteText(
  s: DataGridStoreState,
  actions: DataGridActions,
  text: string,
  guard?: BulkGeneration,
  storeApi?: { getState: () => DataGridStoreState },
): boolean {
  if (s.editing || s.readOnly) return false;
  return applyParsedPaste(s, actions, parseClipboard({ text }), guard, storeApi);
}

/**
 * Wires native `copy`/`cut`/`paste` events to the grid root so OS-native shortcuts and menu
 * actions work (glide-behavior-spec.md §2, §4). Attached to the root element (not `document`) so
 * multiple grids on one page each own their own clipboard traffic, gated on focus being inside the
 * grid via roving tabindex; inactive while a cell is being edited (the editor owns its own
 * clipboard then).
 */
export function useGridClipboard(options: UseGridClipboardOptions): void {
  const { rootRef, readOnly } = options;
  const actions = useDataGridActions();
  const storeApi = useDataGridStoreApi();
  // One counter for this grid's paste surface: a second paste supersedes a still-validating first.
  const guard = useBulkGeneration();

  const onCopy = useCallback(
    (event: ClipboardEvent) => {
      const s = storeApi.getState();
      if (s.editing) return;
      const scope = resolveCopyScope(s);
      if (!scope) return;
      event.preventDefault();
      writeClipboardEvent(event, serializeCopyScope(s, scope));
    },
    [storeApi],
  );

  const onCut = useCallback(
    (event: ClipboardEvent) => {
      const s = storeApi.getState();
      if (s.editing) return;
      const scope = resolveCopyScope(s);
      if (!scope) return;
      event.preventDefault();
      writeClipboardEvent(event, serializeCopyScope(s, scope));
      if (!readOnly) actions.deleteSelection();
    },
    [storeApi, actions, readOnly],
  );

  const onPaste = useCallback(
    (event: ClipboardEvent) => {
      const s = storeApi.getState();
      if (s.editing || readOnly) return;
      // resolvePasteTarget gates BEFORE parsing/preventDefault, so a no-target paste (nothing
      // selected/active) leaves the native paste behavior (e.g. into an unrelated focused input) intact.
      if (!resolvePasteTarget(s)) return;
      const html = event.clipboardData?.getData("text/html");
      const text = event.clipboardData?.getData("text/plain");
      const parsed = parseClipboard({ html: html || undefined, text });
      if (parsed.length === 0) return;
      event.preventDefault();
      applyParsedPaste(s, actions, parsed, guard, storeApi);
    },
    [storeApi, actions, readOnly, guard],
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.addEventListener("copy", onCopy);
    root.addEventListener("cut", onCut);
    root.addEventListener("paste", onPaste);
    return () => {
      root.removeEventListener("copy", onCopy);
      root.removeEventListener("cut", onCut);
      root.removeEventListener("paste", onPaste);
    };
  }, [rootRef, onCopy, onCut, onPaste]);
}
