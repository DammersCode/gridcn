import {
  clampIndex,
  clearErrorsForOps,
  computeSearchMatches,
  computeViewIndex,
  incrementalViewIndex,
  mergeCellErrors,
  pruneCellErrors,
  sameElements,
} from "./compute";
import {
  computeCellPatchBatch,
  computeCommit,
  computeDeleteBatch,
  computeDuplicateBatch,
  computeInsertRowsBatch,
  computeRowEditsBatch,
  patchesNeedAsyncCheck,
  prevalidatePatches,
  type PrevalidatedPatches,
  warnDev,
} from "./commit";
import { INCREMENTAL_PATCH_LIMIT } from "../sort-filter";
import { resolveCellRef, resolveReorder, touchesViewInputs, type RowIndexCache } from "./row-index";
import {
  emptySelection,
  offsetSelectionForRows,
  rectFromCorners,
  reorderSelectionForRow,
  rowReorderMap,
  selectCell as selectCellPure,
  selectionRects,
} from "../selection";
import type { CellRef, DataOp, ViewCoord } from "../types";
import type { AnyColumnDef, CellPatch, DataGridActions, DataGridStoreState, UpdateCellsVerdict } from "./types";

/**
 * The data-write cluster's streaming bookkeeping: the mutable `let` state shared by the write
 * actions and by `_syncProps` (the echo check reads `lastEmittedData`, every view rebuild resets
 * the deferred rows). Passed around BY REFERENCE — a copy would silently break the echo
 * detection and the generation guard.
 */
export type DataWriteContext = {
  /**
   * Generation counter for a HELD async `updateCells` batch — the streaming surface's counterpart to
   * the per-hook `useBulkGeneration` the paste/fill/import surfaces use. Bumped by every path that
   * replaces rows or writes values outside the held batch, so a verdict that resolves against a grid
   * that has moved on is dropped instead of landing late on top of newer data.
   */
  streamGeneration: number;
  /**
   * Data indices whose values changed since `viewIndex` was last rebuilt, so `reconcileView` and the
   * next `"immediate"` batch can take the same incremental path instead of a full re-sort. `null`
   * means "no longer trackable" — the limit was passed, or a path that moves rows (insert/delete/
   * duplicate/a consumer `data` replacement) or writes values outside `updateCells` ran — and the
   * caller falls back to the full rebuild.
   */
  deferredRows: Set<number> | null;
  /** `rowId -> dataIndex` map for `updateCells`; every row-moving path invalidates it, a value patch rebases it. */
  rowIndexCache: RowIndexCache;
  /**
   * The last `data` array this store handed to `onDataChange`. A controlled consumer that stores it
   * and re-renders feeds that same array back through `_syncProps`; recognizing it as our own echo
   * is what keeps `computeViewIndex` off the controlled streaming path (design spec §3.3 — without
   * this the 56 ms cliff returns for every controlled consumer).
   */
  lastEmittedData: readonly unknown[] | null;
  /** Dev-warns at most once per grid that a {@link CellRef} failed to resolve (stale row or hidden column). */
  warnedStaleCellRef: boolean;
};

export function createDataWriteContext(rowIndexCache: RowIndexCache): DataWriteContext {
  return { streamGeneration: 0, deferredRows: new Set(), rowIndexCache, lastEmittedData: null, warnedStaleCellRef: false };
}

/** {@link resolveCellRef} plus the once-per-grid dev-warn for a ref that no longer resolves. */
export function resolveRefOrWarn(ctx: DataWriteContext, s: DataGridStoreState, ref: CellRef): ViewCoord | null {
  const coord = resolveCellRef(s, ctx.rowIndexCache, ref);
  if (!coord && !ctx.warnedStaleCellRef) {
    ctx.warnedStaleCellRef = true;
    warnDev(`CellRef { rowId: ${ref.rowId}, columnId: ${ref.columnId} } does not resolve in the current view (row no longer in data, or column hidden); the action is a no-op`);
  }
  return coord;
}

/** Any path that writes values or moves rows outside a held batch: give up tracking and drop the token. */
export function forgetDeferredRows(ctx: DataWriteContext): void {
  ctx.streamGeneration += 1;
  ctx.deferredRows = null;
}

/** A full view rebuild leaves nothing pending for the incremental path to replay. */
export function resetDeferredRows(ctx: DataWriteContext): void {
  ctx.streamGeneration += 1;
  ctx.deferredRows = new Set();
}

/** Records a non-reordering batch's rows, giving up once the set is bigger than the incremental path serves. */
export function rememberDeferredRows(ctx: DataWriteContext, touchedRows: readonly number[]): void {
  if (!ctx.deferredRows) return;
  for (const row of touchedRows) ctx.deferredRows.add(row);
  if (ctx.deferredRows.size > INCREMENTAL_PATCH_LIMIT) forgetDeferredRows(ctx);
}

/** This batch's touched rows plus anything an earlier batch left unreconciled; `null` when untrackable. */
export function pendingRows(ctx: DataWriteContext, touchedRows: readonly number[]): readonly number[] | null {
  if (!ctx.deferredRows) return null;
  if (ctx.deferredRows.size === 0) return touchedRows;
  const union = new Set(ctx.deferredRows);
  for (const row of touchedRows) union.add(row);
  return Array.from(union);
}

/**
 * The next `viewIndex` for a reorder: incremental when `pending` is known and provably equivalent
 * to the rebuild, the full rebuild otherwise. Returns the PREVIOUS array identity when no row
 * moved, so a tick that changes no position re-renders nothing downstream of `viewIndex`.
 */
export function resolveViewIndex(s: DataGridStoreState, data: readonly unknown[], pending: readonly number[] | null): number[] {
  const incremental = pending
    ? incrementalViewIndex(data, s.columns, s.sortState, s.filterState, s.joinOperator, s.viewIndex, pending, s.cellTypes)
    : null;
  if (incremental) return sameElements(incremental, s.viewIndex) ? s.viewIndex : incremental;
  return computeViewIndex(data, s.columns, s.sortState, s.filterState, s.joinOperator, s.viewIndex, s.cellTypes);
}

/**
 * The view bookkeeping every direct write path (edit/paste/fill/delete) owes after committing
 * `nextData`, mirroring what `updateCells` does for a `"defer"` batch: `viewIndex` deliberately
 * stays put (no auto-resort), but `viewStale` has to flip so the re-sort affordance and
 * `reconcileView()` can recover, and `searchMatches` has no deferred contract at all so it is
 * recomputed in place. Both halves no-op unless a search or a view-feeding column is involved.
 */
export function reconcileAfterWrite(s: DataGridStoreState, nextData: readonly unknown[], ops: readonly DataOp<unknown>[]): Partial<DataGridStoreState> {
  const written: CellPatch[] = [];
  for (const op of ops) {
    if (op.type !== "update" || !op.cells) continue;
    for (const cell of op.cells) written.push({ rowId: op.rowId, columnId: cell.columnId, value: cell.value });
  }
  const viewStale = s.viewStale || touchesViewInputs(written, s.sortState, s.filterState);
  if (s.searchText.trim() === "") return viewStale === s.viewStale ? {} : { viewStale };
  return {
    ...(viewStale === s.viewStale ? {} : { viewStale }),
    ...computeSearchMatches(nextData, s.columns, s.viewIndex, s.visibleColumns, s.searchText, s.cellTypes),
  };
}

/**
 * The view bookkeeping a row-shifting op (`insertRows`/`deleteRows`/`duplicateRows`) owes: the
 * row count changed, so `computeViewIndex` always returns a fresh array (the content-equality
 * reuse cannot apply), `searchMatches` is recomputed against it, and `viewStale` is cleared —
 * the full rebuild reconciles whatever a deferred `updateCells` batch left stale, mirroring
 * `setColumnHidden`. The caller owns `activeCell` (it follows or clears the cursor itself).
 */
export function rebuildRowOpView(s: DataGridStoreState, nextData: readonly unknown[]): Partial<DataGridStoreState> {
  const viewIndex = computeViewIndex(nextData, s.columns, s.sortState, s.filterState, s.joinOperator, s.viewIndex, s.cellTypes);
  return {
    viewIndex,
    viewStale: false,
    ...computeSearchMatches(nextData, s.columns, viewIndex, s.visibleColumns, s.searchText, s.cellTypes),
  };
}

/** With a sort or filter active, inserted rows land anywhere: follow the active row by identity and collapse the selection onto it. */
export function followActiveRow(s: DataGridStoreState, nextData: readonly unknown[], viewIndex: readonly number[]): Pick<DataGridStoreState, "selection" | "activeCell"> {
  const dataRow = s.activeCell ? s.viewIndex[s.activeCell.row] : undefined;
  const row = dataRow === undefined || s.data[dataRow] === undefined ? -1 : viewIndex.indexOf(nextData.indexOf(s.data[dataRow]));
  if (!s.activeCell || row === -1) return { selection: emptySelection(), activeCell: null };
  const cell = { col: s.activeCell.col, row };
  return { selection: { ...emptySelection(), current: { cell, range: rectFromCorners(cell, cell), rangeStack: [] } }, activeCell: cell };
}

type SetState = (partial: Partial<DataGridStoreState>) => void;
type GetState = () => DataGridStoreState;

/** The closures the cluster reads from the store factory: row-validation bookkeeping and the open-edit remap. */
export type DataWriteDeps = {
  ctx: DataWriteContext;
  applyRowValidation: (
    s: DataGridStoreState,
    cellErrors: ReadonlyMap<string, string>,
    nextData: readonly unknown[],
    ops: readonly DataOp<unknown>[],
  ) => ReadonlyMap<string, string>;
  pruneRowValidationKeys: (data: readonly unknown[], getRowId: (row: unknown, index: number) => string) => void;
  warnViewSpacePresenceStale: (s: DataGridStoreState) => void;
  /** The cursor, the open edit, and the row channel carried into a rebuilt view. */
  followView: (
    s: DataGridStoreState,
    viewIndex: readonly number[],
    visibleColumns: readonly AnyColumnDef[],
    data?: readonly unknown[],
    getRowId?: (row: unknown, index: number) => string,
    sameRecords?: boolean,
  ) => Partial<DataGridStoreState>;
  /** Runs `write`, which ends `session`, without the `cancel` report: the caller reports its own `onEditEnd` result. */
  endEditSession: (session: NonNullable<DataGridStoreState["editing"]>, write: () => void) => void;
};

/** Every data-writing action of the store, extracted as one cluster: the edit commits, the bulk writers, and the row ops. */
export type DataWriteActions = Pick<
  DataGridActions,
  | "commitCellEdit"
  | "commitCellValue"
  | "commitCellValueAt"
  | "deleteSelection"
  | "_deleteCellsById"
  | "applyCellUpdates"
  | "updateCells"
  | "updateRows"
  | "reconcileView"
  | "insertRow"
  | "insertRows"
  | "deleteRows"
  | "duplicateRows"
  | "reorderRows"
>;

export function createDataWriteActions(set: SetState, get: GetState, deps: DataWriteDeps): DataWriteActions {
  const { ctx, applyRowValidation, pruneRowValidationKeys, warnViewSpacePresenceStale, followView, endEditSession } = deps;

  /** Commits clear-to-clearValue() `writes` as one `delete` batch; shared by both delete actions. */
  const commitClearWrites = (s: DataGridStoreState, writes: { viewRowIndex: number; columnId: string; value: unknown }[]): void => {
    const batch = computeRowEditsBatch(s, writes);
    if (!batch) return;
    ctx.rowIndexCache.rebase(batch.nextData);
    forgetDeferredRows(ctx);
    ctx.lastEmittedData = batch.nextData;
    set({
      data: batch.nextData,
      cellErrors: applyRowValidation(s, clearErrorsForOps(s.cellErrors, batch.ops), batch.nextData, batch.ops),
      ...reconcileAfterWrite(s, batch.nextData, batch.ops),
    });
    s.onDataChange?.(batch.nextData, { source: "delete", ops: batch.ops });
  };

  return {
    commitCellEdit(value, movement, rejection) {
      const s = get();
      const editing = s.editing;
      if (!editing || s.readOnly) return;
      // Resolve by rowId, so a view rebuild the remap missed discards the draft instead of writing another row.
      const dataRowIndex = ctx.rowIndexCache.resolve(s.data, s.getRowId).get(editing.rowId);
      const anchorStale =
        dataRowIndex === undefined ||
        s.viewIndex[editing.coord.row] !== dataRowIndex ||
        s.visibleColumns[editing.coord.col]?.id !== editing.columnId;
      if (anchorStale) {
        const onEditCell =
          s.activeCell !== null && s.activeCell.row === editing.coord.row && s.activeCell.col === editing.coord.col;
        set({ editing: null, editingError: null, ...(onEditCell ? { activeCell: null } : {}) });
        return;
      }
      const maxRow = Math.max(0, s.viewIndex.length - 1);
      const maxCol = Math.max(0, s.visibleColumns.length - 1);
      const nextActiveCell = movement
        ? {
            col: clampIndex(editing.coord.col + movement.dx, maxCol),
            row: clampIndex(editing.coord.row + movement.dy, maxRow),
          }
        : editing.coord;

      const result = computeCommit(s, editing.coord, value, rejection);
      // The user clicked away while validation was pending: commit the value but leave the cursor where it is.
      const stale =
        s.activeCell !== null && (s.activeCell.row !== editing.coord.row || s.activeCell.col !== editing.coord.col);
      const restoreSelection = stale ? {} : { activeCell: nextActiveCell, selection: selectCellPure(nextActiveCell) };
      if ("error" in result) {
        set({ editingError: result.error, editingRejectionCount: s.editingRejectionCount + 1 });
        s.onEditEnd?.({ rowId: editing.rowId, columnId: editing.columnId, viewRowIndex: editing.coord.row, viewColumnIndex: editing.coord.col, result: "rejected" });
        return;
      }
      if ("noop" in result) {
        endEditSession(editing, () =>
          set({
            editing: null,
            editingError: null,
            ...restoreSelection,
            // an `onInvalid: "warn"` re-commit of the same value still lands its flag
            ...(result.warnings ? { cellErrors: mergeCellErrors(s.cellErrors, result.warnings) } : {}),
          }),
        );
        s.onEditEnd?.({ rowId: editing.rowId, columnId: editing.columnId, viewRowIndex: editing.coord.row, viewColumnIndex: editing.coord.col, result: "commit" });
        return;
      }
      ctx.rowIndexCache.rebase(result.data);
      forgetDeferredRows(ctx);
      ctx.lastEmittedData = result.data;
      const cellErrors = applyRowValidation(s, clearErrorsForOps(s.cellErrors, result.change.ops), result.data, result.change.ops);
      endEditSession(editing, () =>
        set({
          data: result.data,
          editing: null,
          editingError: null,
          // warn rejections commit AND flag — merged after the auto-clear + validateRow verdict so the freshest signal wins
          cellErrors: result.warnings ? mergeCellErrors(cellErrors, result.warnings) : cellErrors,
          ...restoreSelection,
          ...reconcileAfterWrite(s, result.data, result.change.ops),
        }),
      );
      s.onDataChange?.(result.data, result.change);
      s.onEditEnd?.({ rowId: editing.rowId, columnId: editing.columnId, viewRowIndex: editing.coord.row, viewColumnIndex: editing.coord.col, result: "commit" });
    },
    commitCellValue(ref, value) {
      const coord = resolveRefOrWarn(ctx, get(), ref);
      if (coord) get().actions.commitCellValueAt(coord, value);
    },
    commitCellValueAt(coord, value) {
      const s = get();
      if (s.readOnly) return;
      const result = computeCommit(s, coord, value);
      if ("error" in result) return;
      if ("noop" in result) {
        if (result.warnings) set({ cellErrors: mergeCellErrors(s.cellErrors, result.warnings) });
        return;
      }
      ctx.rowIndexCache.rebase(result.data);
      forgetDeferredRows(ctx);
      ctx.lastEmittedData = result.data;
      const cellErrors = applyRowValidation(s, clearErrorsForOps(s.cellErrors, result.change.ops), result.data, result.change.ops);
      set({
        data: result.data,
        cellErrors: result.warnings ? mergeCellErrors(cellErrors, result.warnings) : cellErrors,
        ...reconcileAfterWrite(s, result.data, result.change.ops),
      });
      s.onDataChange?.(result.data, result.change);
    },
    deleteSelection() {
      const s = get();
      if (s.readOnly) return;
      const rects = selectionRects(s.selection, s.viewIndex.length, s.visibleColumns.length);
      if (rects.length === 0) return;

      const resolvedCols = s.visibleColumns.map((column) => {
        const cellType = s.cellTypes[column.type ?? "text"];
        return cellType ? { columnId: column.id, value: cellType.clearValue(column.options) } : null;
      });
      const writes: { viewRowIndex: number; columnId: string; value: unknown }[] = [];
      for (const rect of rects) {
        for (let viewRow = rect.y; viewRow < rect.y + rect.height; viewRow++) {
          for (let col = rect.x; col < rect.x + rect.width; col++) {
            const resolved = resolvedCols[col];
            if (!resolved) continue;
            writes.push({ viewRowIndex: viewRow, columnId: resolved.columnId, value: resolved.value });
          }
        }
      }
      commitClearWrites(s, writes);
    },
    _deleteCellsById(rowIds, columnIds) {
      const s = get();
      if (s.readOnly || rowIds.length === 0 || columnIds.length === 0) return;
      const cleared = columnIds.flatMap((columnId) => {
        const column = s.visibleColumns.find((c) => c.id === columnId);
        const cellType = column ? s.cellTypes[column.type ?? "text"] : undefined;
        return column && cellType ? [{ columnId, value: cellType.clearValue(column.options) }] : [];
      });
      const rowIndex = ctx.rowIndexCache.resolve(s.data, s.getRowId);
      const dataRows = new Set<number>();
      for (const rowId of rowIds) {
        const dataRowIndex = rowIndex.get(rowId);
        if (dataRowIndex !== undefined) dataRows.add(dataRowIndex);
      }
      const writes: { viewRowIndex: number; columnId: string; value: unknown }[] = [];
      // a row or column that left the view since the copy stays untouched, like any hidden cell
      s.viewIndex.forEach((dataRowIndex, viewRowIndex) => {
        if (!dataRows.has(dataRowIndex)) return;
        for (const { columnId, value } of cleared) writes.push({ viewRowIndex, columnId, value });
      });
      commitClearWrites(s, writes);
    },
    applyCellUpdates(updates, source) {
      const s = get();
      if (s.readOnly || updates.length === 0) return;
      const batch = computeRowEditsBatch(s, updates);
      if (!batch) return;
      ctx.rowIndexCache.rebase(batch.nextData);
      forgetDeferredRows(ctx);
      ctx.lastEmittedData = batch.nextData;
      const cellErrors = applyRowValidation(s, clearErrorsForOps(s.cellErrors, batch.ops), batch.nextData, batch.ops);

      // move selection to cover the touched view rect (paste's anchored-expand result).
      let minRow = Infinity, maxRow = -Infinity, minCol = Infinity, maxCol = -Infinity;
      const idByCol = new Map(s.visibleColumns.map((c, i) => [c.id, i] as const));
      for (const u of updates) {
        const col = idByCol.get(u.columnId);
        if (col === undefined) continue;
        minRow = Math.min(minRow, u.viewRowIndex);
        maxRow = Math.max(maxRow, u.viewRowIndex);
        minCol = Math.min(minCol, col);
        maxCol = Math.max(maxCol, col);
      }
      if (minRow === Infinity) {
        set({ data: batch.nextData, cellErrors, ...reconcileAfterWrite(s, batch.nextData, batch.ops) });
        s.onDataChange?.(batch.nextData, { source, ops: batch.ops });
        return;
      }
      const range = rectFromCorners({ col: minCol, row: minRow }, { col: maxCol, row: maxRow });
      set({
        data: batch.nextData,
        cellErrors,
        selection: { ...emptySelection(), current: { cell: { col: minCol, row: minRow }, range, rangeStack: [] } },
        activeCell: { col: minCol, row: minRow },
        ...reconcileAfterWrite(s, batch.nextData, batch.ops),
      });
      s.onDataChange?.(batch.nextData, { source, ops: batch.ops });
    },
    updateCells(patches, options) {
      const s = get();
      if (s.readOnly || patches.length === 0) return { applied: 0, skipped: [], pending: false };
      const skipValidation = options?.skipValidation ?? false;

      // Re-enters with skipValidation once accepted, so the incremental view path only ever sees validated values.
      if (!skipValidation && patchesNeedAsyncCheck(s, patches)) {
        const rowIndex = ctx.rowIndexCache.resolve(s.data, s.getRowId);
        const validated = prevalidatePatches(s, patches, rowIndex);
        // Skips report indexes into the caller's `patches`, not into the accepted subset.
        const apply = ({ accepted, acceptedIndexes, rejectedIndexes }: PrevalidatedPatches): UpdateCellsVerdict => {
          const invalid = rejectedIndexes.map((patchIndex) => ({ patchIndex, reason: "invalid" as const }));
          if (accepted.length === 0) return { applied: 0, skipped: invalid, pending: false };
          const verdict = get().actions.updateCells(accepted, { ...options, skipValidation: true });
          const remapped = verdict.skipped.map((skip) => ({ ...skip, patchIndex: acceptedIndexes[skip.patchIndex]! }));
          return { ...verdict, skipped: [...invalid, ...remapped].sort((a, b) => a.patchIndex - b.patchIndex) };
        };
        if (validated instanceof Promise) {
          const token = ++ctx.streamGeneration;
          void validated.then((accepted) => {
            // A newer updateCells, or any path that moved rows, supersedes this batch silently.
            if (ctx.streamGeneration !== token) return;
            void apply(accepted);
          });
          // the held batch's outcome (accepted, dropped, or superseded) is not reportable here
          return { applied: 0, skipped: [], pending: true };
        }
        return apply(validated);
      }

      const rowIndex = ctx.rowIndexCache.resolve(s.data, s.getRowId);
      const batch = computeCellPatchBatch(s, patches, rowIndex, skipValidation);
      if (batch.nextData === null) return { applied: 0, skipped: batch.skipped, pending: false };
      const applied = batch.ops.reduce((n, op) => (op.type === "update" ? n + (op.cells?.length ?? 0) : n), 0);

      let reorder = resolveReorder(options?.reorder, patches, s.sortState, s.filterState);
      // an open editor pins a view coordinate an immediate re-sort would silently remount, so the batch defers
      if (reorder === "immediate" && s.editing) reorder = "defer";
      ctx.rowIndexCache.rebase(batch.nextData);
      ctx.lastEmittedData = batch.nextData;
      const change = { source: options?.source ?? "stream", ops: batch.ops };
      // With no cell errors, clearErrorsForOps returns the same map, so the streaming hot path pays nothing.
      const cellErrors = applyRowValidation(s, clearErrorsForOps(s.cellErrors, batch.ops), batch.nextData, batch.ops);

      // Fast path: one set() writing `data` alone, so only touched rows re-render and view-derived state keeps its identity.
      if (reorder !== "immediate") {
        // Recorded for `"never"` too, so a later reconcile stays correct when the caller's assertion was wrong.
        rememberDeferredRows(ctx, batch.touchedRows);
        set(
          reorder === "defer" && !s.viewStale
            ? { data: batch.nextData, viewStale: true, cellErrors }
            : { data: batch.nextData, cellErrors },
        );
        s.onDataChange?.(batch.nextData, change);
        return { applied, skipped: batch.skipped, pending: false };
      }
      warnViewSpacePresenceStale(s);
      // Re-place only touched and earlier deferred rows; the binary search trusts the rest of the order.
      const viewIndex = resolveViewIndex(s, batch.nextData, pendingRows(ctx, batch.touchedRows));
      resetDeferredRows(ctx);
      set({
        data: batch.nextData,
        cellErrors,
        viewIndex,
        viewStale: false,
        ...followView(s, viewIndex, s.visibleColumns, batch.nextData, s.getRowId, true),
        ...computeSearchMatches(batch.nextData, s.columns, viewIndex, s.visibleColumns, s.searchText, s.cellTypes),
      });
      s.onDataChange?.(batch.nextData, change);
      return { applied, skipped: batch.skipped, pending: false };
    },
    updateRows(updates, options) {
      if (updates.length === 0) return { applied: 0, skipped: [], pending: false };
      const patches: CellPatch[] = [];
      for (const update of updates) {
        for (const columnId of Object.keys(update.changes)) {
          patches.push({ rowId: update.rowId, columnId, value: update.changes[columnId] });
        }
      }
      return get().actions.updateCells(patches, options);
    },
    reconcileView() {
      const s = get();
      if (!s.viewStale) return;
      // Same incremental path an `"immediate"` batch takes, over whatever the deferred batches touched.
      const viewIndex = resolveViewIndex(s, s.data, pendingRows(ctx, []));
      resetDeferredRows(ctx);
      set({
        viewIndex,
        viewStale: false,
        ...followView(s, viewIndex, s.visibleColumns),
        ...computeSearchMatches(s.data, s.columns, viewIndex, s.visibleColumns, s.searchText, s.cellTypes),
      });
    },
    insertRow(viewRowIndex, position) {
      // single implementation path: the 1-row case of the batch action (same one undo step).
      get().actions.insertRows(viewRowIndex, 1, position);
    },
    insertRows(viewRowIndex, count, position = "below") {
      const s = get();
      if (s.readOnly) return;
      // an open editor pins a view coordinate the shift would silently invalidate
      if (s.editing) {
        warnDev("insertRows is a no-op while an edit session is open");
        return;
      }
      if (!s.createRow) {
        warnDev("row insertion is a no-op because no `createRow` prop was provided");
        return;
      }
      if (count <= 0 || !Number.isInteger(count)) {
        if (count > 0) warnDev(`insertRows: count must be an integer (got ${count})`);
        return;
      }
      const dataRowIndex = clampIndex(
        position === "above" ? (s.viewIndex[viewRowIndex] ?? s.data.length) : (s.viewIndex[viewRowIndex] ?? s.data.length - 1) + 1,
        s.data.length,
      );
      const rows: unknown[] = [];
      for (let i = 0; i < count; i++) rows.push(s.createRow(dataRowIndex + i));
      const batch = computeInsertRowsBatch(s, dataRowIndex, rows);
      warnViewSpacePresenceStale(s);
      ctx.rowIndexCache.invalidate();
      forgetDeferredRows(ctx);
      ctx.lastEmittedData = batch.nextData;
      const view = rebuildRowOpView(s, batch.nextData);
      if (s.sortState.length > 0 || s.filterState.length > 0) {
        pruneRowValidationKeys(batch.nextData, s.getRowId);
        set({ data: batch.nextData, rowIdentityVersion: s.rowIdentityVersion + 1, cellErrors: pruneCellErrors(s.cellErrors, batch.nextData, s.getRowId), ...followActiveRow(s, batch.nextData, view.viewIndex!), ...view });
        s.onDataChange?.(batch.nextData, { source: "row-op", ops: batch.ops });
        return;
      }
      // unsorted and unfiltered, the new rows land at this view index; shift selection/activeCell to follow them.
      const viewInsertAt = position === "above" ? viewRowIndex : viewRowIndex + 1;
      pruneRowValidationKeys(batch.nextData, s.getRowId);
      set({
        data: batch.nextData,
        rowIdentityVersion: s.rowIdentityVersion + 1,
        cellErrors: pruneCellErrors(s.cellErrors, batch.nextData, s.getRowId),
        selection: offsetSelectionForRows(s.selection, viewInsertAt, count),
        activeCell: s.activeCell && s.activeCell.row >= viewInsertAt
          ? { ...s.activeCell, row: s.activeCell.row + count }
          : s.activeCell,
        ...view,
      });
      s.onDataChange?.(batch.nextData, { source: "row-op", ops: batch.ops });
    },
    deleteRows(viewRowIndexes) {
      const s = get();
      if (s.readOnly) return;
      // an open editor pins a view coordinate the shift would silently invalidate
      if (s.editing) {
        warnDev("deleteRows is a no-op while an edit session is open");
        return;
      }
      const dataRowIndexes = viewRowIndexes.map((viewRow) => s.viewIndex[viewRow]).filter((i): i is number => i !== undefined);
      const batch = computeDeleteBatch(s, dataRowIndexes);
      if (!batch) return;
      warnViewSpacePresenceStale(s);
      ctx.rowIndexCache.invalidate();
      forgetDeferredRows(ctx);
      ctx.lastEmittedData = batch.nextData;
      pruneRowValidationKeys(batch.nextData, s.getRowId);
      set({
        data: batch.nextData,
        rowIdentityVersion: s.rowIdentityVersion + 1,
        cellErrors: pruneCellErrors(s.cellErrors, batch.nextData, s.getRowId),
        selection: emptySelection(),
        activeCell: null,
        ...rebuildRowOpView(s, batch.nextData),
      });
      s.onDataChange?.(batch.nextData, { source: "row-op", ops: batch.ops });
    },
    duplicateRows(viewRowIndexes) {
      const s = get();
      if (s.readOnly) return;
      // an open editor pins a view coordinate the shift would silently invalidate
      if (s.editing) {
        warnDev("duplicateRows is a no-op while an edit session is open");
        return;
      }
      if (!s.duplicateRow) {
        warnDev("duplicateRows is a no-op because no `duplicateRow` prop was provided");
        return;
      }
      const dataRowIndexes = viewRowIndexes.map((viewRow) => s.viewIndex[viewRow]).filter((i): i is number => i !== undefined);
      const batch = computeDuplicateBatch(s, dataRowIndexes);
      if (!batch) return;
      warnViewSpacePresenceStale(s);
      ctx.rowIndexCache.invalidate();
      forgetDeferredRows(ctx);
      ctx.lastEmittedData = batch.nextData;
      const view = rebuildRowOpView(s, batch.nextData);
      if (s.sortState.length > 0 || s.filterState.length > 0) {
        pruneRowValidationKeys(batch.nextData, s.getRowId);
        set({ data: batch.nextData, rowIdentityVersion: s.rowIdentityVersion + 1, cellErrors: pruneCellErrors(s.cellErrors, batch.nextData, s.getRowId), ...followActiveRow(s, batch.nextData, view.viewIndex!), ...view });
        s.onDataChange?.(batch.nextData, { source: "row-op", ops: batch.ops });
        return;
      }
      // Each duplicate lands after its source; ascending offsets let earlier insertions shift later sources.
      const uniqueAscendingViewRows = Array.from(new Set(viewRowIndexes)).sort((a, b) => a - b);
      let selection = s.selection;
      let activeCell = s.activeCell;
      uniqueAscendingViewRows.forEach((viewRow, i) => {
        const insertAt = viewRow + 1 + i;
        selection = offsetSelectionForRows(selection, insertAt, 1);
        if (activeCell && activeCell.row >= insertAt) activeCell = { ...activeCell, row: activeCell.row + 1 };
      });
      pruneRowValidationKeys(batch.nextData, s.getRowId);
      set({
        data: batch.nextData,
        rowIdentityVersion: s.rowIdentityVersion + 1,
        cellErrors: pruneCellErrors(s.cellErrors, batch.nextData, s.getRowId),
        selection,
        activeCell,
        ...view,
      });
      s.onDataChange?.(batch.nextData, { source: "row-op", ops: batch.ops });
    },
    reorderRows(from, to) {
      const s = get();
      if (!s.enableRowReorder) return false;
      if (s.readOnly) return false;
      // an open editor pins a view coordinate the move would silently invalidate
      if (s.editing) return false;
      if (s.sortState.length > 0 || s.filterState.length > 0) {
        warnDev("reorderRows is a no-op while a sort or filter is active (the view order is owned by the sort/filter)");
        return false;
      }
      const n = s.data.length;
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= n || to < 0 || to >= n || from === to) return false;
      // viewIndex is the identity permutation here (sort/filter gated above), so view == data indices
      const fromData = s.viewIndex[from]!;
      const toData = s.viewIndex[to]!;
      if (toData === fromData) return false;
      for (let i = 0; i < n; i++) {
        // Indexed access sees sparse holes; a reorder would shift the lazy add-on's in-flight index bookkeeping.
        if (s.data[i] === undefined) {
          warnDev("reorderRows is a no-op while rows are still unloaded (useDataGridLazyRows): load the range first");
          return false;
        }
      }
      const moved = s.data[fromData]!;
      const nextData = s.data.slice();
      nextData.splice(fromData, 1);
      nextData.splice(toData, 0, moved);
      const ops: DataOp<unknown>[] = [{ type: "move", rowId: s.getRowId(moved, fromData), row: moved, from: fromData, to: toData }];
      warnViewSpacePresenceStale(s);
      ctx.rowIndexCache.invalidate();
      forgetDeferredRows(ctx);
      ctx.lastEmittedData = nextData;
      const f = rowReorderMap(from, to);
      set({
        data: nextData,
        rowIdentityVersion: s.rowIdentityVersion + 1,
        selection: reorderSelectionForRow(s.selection, from, to),
        activeCell: s.activeCell ? { ...s.activeCell, row: f(s.activeCell.row) } : null,
        lastHighlightedRow: s.lastHighlightedRow === null ? null : f(s.lastHighlightedRow),
      });
      s.onDataChange?.(nextData, { source: "row-op", ops });
      return true;
    },
  };
}
