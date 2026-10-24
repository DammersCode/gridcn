import {
  clampIndex,
  clearErrorsForOps,
  computeSearchMatches,
  computeViewIndex,
  incrementalViewIndex,
  mergeCellErrors,
  pruneCellErrors,
  remapRowChannel,
  selectCellOf,
  sameElements,
  viewSorts,
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
  type PatchRejection,
  type PrevalidatedPatches,
  warnDev,
} from "./commit";
import { INCREMENTAL_PATCH_LIMIT } from "../sort-filter";
import { withoutHiddenCheckedRows } from "./hidden-checked-rows";
import { applyChange } from "../interaction/history";
import { planBlockMove, planShiftMove, type RowMovePlan } from "../rows/plan-row-moves";
import { resolveCellRef, resolveReorder, touchesViewInputs, type RowIndexCache } from "./row-index";
import {
  emptySelection,
  offsetSelectionForRows,
  rectFromCorners,
  remapSelectionRows,
  selectCell as selectCellPure,
  selectionRects,
} from "../selection";
import type { CellRef, CompactSelectionLike, DataChange, DataGridApi, DataOp, GridBulkValidationError, GridValidationErrorEvent, ViewCoord } from "../types";
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
   * is what keeps `computeViewIndex` off the controlled streaming path (without
   * this the 56 ms cliff returns for every controlled consumer).
   */
  lastEmittedData: readonly unknown[] | null;
  /** Dev-warns at most once per grid that a {@link CellRef} failed to resolve (stale row or hidden column). */
  warnedStaleCellRef: boolean;
  /** `onDataChange` calls waiting for the outermost write to return; see {@link writeThenEmit}. */
  pendingEmits: (() => void)[];
  /** How many {@link writeThenEmit} writes are running, nested through store subscribers. */
  writeDepth: number;
  /** The grid's imperative handle, handed to plugin `onDataChange` observers; set at store creation, before any write can run. */
  pluginApi: DataGridApi<unknown> | null;
};

export function createDataWriteContext(rowIndexCache: RowIndexCache): DataWriteContext {
  return { streamGeneration: 0, deferredRows: new Set(), rowIndexCache, lastEmittedData: null, warnedStaleCellRef: false, pendingEmits: [], writeDepth: 0, pluginApi: null };
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

/**
 * Runs `write` and queues its `onDataChange`. The queue flushes FIFO once the outermost write
 * returns, so a write that a store subscriber makes during `write` emits after it, in gesture order.
 * The consumer's `onDataChange` runs first, then each resolved plugin observer — one try/catch
 * per observer, so a throwing observer logs and the rest still run.
 */
export function writeThenEmit(
  ctx: DataWriteContext,
  s: DataGridStoreState,
  next: readonly unknown[],
  change: DataChange<unknown>,
  write: () => void,
): void {
  const onDataChange = s.onDataChange;
  const observers = s.plugins.observers;
  const pluginApi = ctx.pluginApi;
  ctx.pendingEmits.push(() => {
    if (onDataChange) onDataChange(next, change);
    if (observers.length === 0 || !pluginApi) return;
    const observerCtx = { api: pluginApi };
    for (const observer of observers) {
      try {
        observer(next, change, observerCtx);
      } catch (error) {
        console.warn("[data-grid] a plugin onDataChange observer threw; the change was applied and the remaining observers still run", error);
      }
    }
  });
  ctx.writeDepth += 1;
  try {
    write();
  } finally {
    ctx.writeDepth -= 1;
    if (ctx.writeDepth === 0) flushEmits(ctx);
  }
}

/** Rejected rows up to this count resolve their view row with one `indexOf` each instead of one full pass. */
const STREAM_REJECTION_SCAN_LIMIT = 16;

/** Queues `emit` behind the pending `onDataChange` emits; runs the queue at once when no store write is in progress. */
function emitAfterWrites(ctx: DataWriteContext, emit: () => void): void {
  ctx.pendingEmits.push(emit);
  if (ctx.writeDepth === 0) flushEmits(ctx);
}

/** Delivers every queued emit even when one throws, then rethrows the first error. */
function flushEmits(ctx: DataWriteContext): void {
  let failure: { error: unknown } | null = null;
  for (let emit = ctx.pendingEmits.shift(); emit; emit = ctx.pendingEmits.shift()) {
    try {
      emit();
    } catch (error) {
      failure ??= { error };
    }
  }
  if (failure) throw failure.error;
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
    ? incrementalViewIndex(data, s.columns, viewSorts(s.sortMode, s.sortState), s.filterState, s.joinOperator, s.viewIndex, pending, s.cellTypes)
    : null;
  if (incremental) return sameElements(incremental, s.viewIndex) ? s.viewIndex : incremental;
  return computeViewIndex(data, s.columns, viewSorts(s.sortMode, s.sortState), s.filterState, s.joinOperator, s.viewIndex, s.cellTypes);
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
  const viewStale = s.viewStale || touchesViewInputs(written, viewSorts(s.sortMode, s.sortState), s.filterState);
  if (s.searchText.trim() === "") return viewStale === s.viewStale ? {} : { viewStale };
  return {
    ...(viewStale === s.viewStale ? {} : { viewStale }),
    ...computeSearchMatches(nextData, s.columns, s.viewIndex, s.visibleColumns, s.searchText, s.cellTypes, s.searchOptions),
  };
}

/**
 * The view bookkeeping a row-shifting operation (`insertRows`/`deleteRows`/`duplicateRows`) owes: the
 * row count changed, so `computeViewIndex` always returns a fresh array (the content-equality
 * reuse cannot apply), `searchMatches` is recomputed against it, and `viewStale` is cleared —
 * the full rebuild reconciles whatever a deferred `updateCells` batch left stale, mirroring
 * `setColumnHidden`. The caller owns `activeCell` (it follows or clears the cursor itself).
 */
export function rebuildRowOpView(s: DataGridStoreState, nextData: readonly unknown[]): Partial<DataGridStoreState> {
  const viewIndex = computeViewIndex(nextData, s.columns, viewSorts(s.sortMode, s.sortState), s.filterState, s.joinOperator, s.viewIndex, s.cellTypes);
  return {
    viewIndex,
    viewStale: false,
    ...computeSearchMatches(nextData, s.columns, viewIndex, s.visibleColumns, s.searchText, s.cellTypes, s.searchOptions),
  };
}

/**
 * With a sort or filter active, inserted rows land anywhere: follow the active row by identity and
 * collapse the range onto it; the row channel follows its records.
 */
export function followActiveRow(s: DataGridStoreState, nextData: readonly unknown[], viewIndex: readonly number[]): Pick<DataGridStoreState, "selection" | "activeCell"> {
  const checked = s.selection.rows;
  let rows = emptySelection().rows;
  if (checked.length > 0) {
    const records = new Set<unknown>();
    for (const viewRow of checked.toArray()) {
      const record = s.data[s.viewIndex[viewRow] ?? -1];
      if (record !== undefined) records.add(record);
    }
    const nextIndexOf = new Map<unknown, number>();
    nextData.forEach((record, index) => {
      if (records.has(record)) nextIndexOf.set(record, index);
    });
    rows = remapRowChannel(checked, s.viewIndex, viewIndex, (prevDataRow) => nextIndexOf.get(s.data[prevDataRow]));
  }
  const dataRow = s.activeCell ? s.viewIndex[s.activeCell.row] : undefined;
  const row = dataRow === undefined || s.data[dataRow] === undefined ? -1 : viewIndex.indexOf(nextData.indexOf(s.data[dataRow]));
  if (!s.activeCell || row === -1) return { selection: { ...emptySelection(), rows }, activeCell: null };
  const cell = { col: s.activeCell.col, row };
  return { selection: { ...emptySelection(), rows, current: { cell, range: rectFromCorners(cell, cell), rangeStack: [] } }, activeCell: cell };
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
  /** The cursor, the open edit, and the row channel carried into a rebuilt view. */
  followView: (
    s: DataGridStoreState,
    viewIndex: readonly number[],
    visibleColumns: readonly AnyColumnDef[],
    data?: readonly unknown[],
    getRowId?: (row: unknown, index: number) => string,
    sameRecords?: boolean,
  ) => Partial<DataGridStoreState>;
  /** The row channel and the hidden checked rows carried into a rebuilt view; `visibleOnly` yields the channel when hidden checks are off. */
  carryRows: (
    s: DataGridStoreState,
    rows: CompactSelectionLike,
    viewIndex: readonly number[],
    data: readonly unknown[],
    getRowId: (row: unknown, index: number) => string,
    sameRecords: boolean,
    visibleOnly: () => CompactSelectionLike,
  ) => { rows: CompactSelectionLike; hiddenCheckedRowIds: ReadonlySet<string> };
  /** Re-anchors an open edit to the new view position of its rowId/columnId (or cancels it when the row left the view); `data` must be the array `viewIndex` indexes. */
  remapEditing: (
    s: DataGridStoreState,
    viewIndex: readonly number[],
    visibleColumns: readonly AnyColumnDef[],
    data?: readonly unknown[],
    getRowId?: (row: unknown, index: number) => string,
  ) => Partial<DataGridStoreState>;
  /** Runs `write`, which ends `session`, without the `cancel` report: the caller reports its own `onEditEnd` result. */
  endEditSession: (session: NonNullable<DataGridStoreState["editing"]>, write: () => void) => void;
};

/** Every data-writing action of the store, extracted as one cluster: the edit commits, the bulk writers, and the row operations; `_deleteCellsById` is the internal clipboard seam, split out by the store factory. */
export type DataWriteActions = Pick<
  DataGridActions,
  | "commitCellEdit"
  | "commitCellValue"
  | "commitCellValueAt"
  | "deleteSelection"
  | "applyCellUpdates"
  | "updateCells"
  | "updateRows"
  | "reconcileView"
  | "insertRow"
  | "insertRows"
  | "deleteRows"
  | "deleteRowsById"
  | "duplicateRows"
  | "reorderRows"
  | "moveRowsBy"
  | "commitChange"
> & {
  /** Clears every `rowIds` x `columnIds` cell still in view, as one `delete` batch (the cut-capture seam). */
  _deleteCellsById(rowIds: readonly string[], columnIds: readonly string[]): void;
};

export function createDataWriteActions(set: SetState, get: GetState, deps: DataWriteDeps): DataWriteActions {
  const { ctx, applyRowValidation, pruneRowValidationKeys, followView, carryRows, remapEditing, endEditSession } = deps;

  /** Reports the patches a validator refused through `onValidationError`; a row outside the view reports `viewRowIndex: -1`. */
  const emitStreamRejections = (patches: readonly CellPatch[], rejected: readonly PatchRejection[], batchSource?: DataChange<unknown>["source"]): void => {
    const s = get();
    const onValidationError = s.onValidationError;
    if (rejected.length === 0 || !onValidationError || s.readOnly) return;
    const rowIndex = ctx.rowIndexCache.resolve(s.data, s.getRowId);
    const dataRows = new Set<number>();
    for (const { patchIndex } of rejected) {
      const dataRowIndex = rowIndex.get(patches[patchIndex]!.rowId);
      if (dataRowIndex !== undefined) dataRows.add(dataRowIndex);
    }
    const viewRowOf = new Map<number, number>();
    // A few rows scan the view once each; many rows share one pass over it.
    if (dataRows.size <= STREAM_REJECTION_SCAN_LIMIT) {
      for (const dataRowIndex of dataRows) viewRowOf.set(dataRowIndex, s.viewIndex.indexOf(dataRowIndex));
    } else {
      s.viewIndex.forEach((dataRowIndex, viewRowIndex) => {
        if (dataRows.has(dataRowIndex)) viewRowOf.set(dataRowIndex, viewRowIndex);
      });
    }
    const event: GridValidationErrorEvent = {
      source: batchSource === "replace" ? "replace" : "stream",
      rejected: rejected.map(({ patchIndex, message }) => {
        const { rowId, columnId, value } = patches[patchIndex]!;
        const dataRowIndex = rowIndex.get(rowId);
        const viewRowIndex = dataRowIndex === undefined ? undefined : viewRowOf.get(dataRowIndex);
        return { rowId, columnId, viewRowIndex: viewRowIndex ?? -1, value, message };
      }),
    };
    emitAfterWrites(ctx, () => onValidationError(event));
  };

  /** Reports the cells a caller's validator refused through `onValidationError`, queued behind the write's `onDataChange`. */
  const emitBulkRejections = (source: DataChange<unknown>["source"], rejected: readonly GridBulkValidationError[]): void => {
    if (rejected.length === 0) return;
    const s = get();
    const onValidationError = s.onValidationError;
    if (!onValidationError || s.readOnly) return;
    emitAfterWrites(ctx, () => onValidationError({ source: source as GridValidationErrorEvent["source"], rejected: [...rejected] }));
  };

  /** Commits clear-to-clearValue() `writes` as one `delete` batch; shared by both delete actions. */
  const commitClearWrites = (s: DataGridStoreState, writes: { viewRowIndex: number; columnId: string; value: unknown }[]): void => {
    const batch = computeRowEditsBatch(s, writes);
    if (!batch) return;
    ctx.rowIndexCache.rebase(batch.nextData);
    forgetDeferredRows(ctx);
    ctx.lastEmittedData = batch.nextData;
    const cellErrors = applyRowValidation(s, clearErrorsForOps(s.cellErrors, batch.ops), batch.nextData, batch.ops);
    writeThenEmit(ctx, s, batch.nextData, { source: "delete", ops: batch.ops }, () =>
      set({
        data: batch.nextData,
        cellErrors,
        ...reconcileAfterWrite(s, batch.nextData, batch.ops),
      }),
    );
  };

  const hiddenAfterDelete = (s: DataGridStoreState, ops: readonly DataOp<unknown>[]): Partial<DataGridStoreState> => {
    const hiddenCheckedRowIds = withoutHiddenCheckedRows(s.hiddenCheckedRowIds, ops.flatMap((op) => (op.type === "delete" ? [op.rowId] : [])));
    return hiddenCheckedRowIds === s.hiddenCheckedRowIds ? {} : { hiddenCheckedRowIds };
  };

  const deleteDataRows = (dataRowIndexes: number[]) => {
    const s = get();
    if (s.readOnly) return;
    const batch = computeDeleteBatch(s, dataRowIndexes);
    if (!batch) return;
    ctx.rowIndexCache.invalidate();
    forgetDeferredRows(ctx);
    ctx.lastEmittedData = batch.nextData;
    pruneRowValidationKeys(batch.nextData, s.getRowId);
    const view = rebuildRowOpView(s, batch.nextData);
    const editRemap = remapEditing(s, view.viewIndex!, s.visibleColumns, batch.nextData, s.getRowId);
    const survivingEdit = "editing" in editRemap ? editRemap.editing : s.editing;
    const cursor = survivingEdit
      ? { selection: selectCellPure(survivingEdit.coord), activeCell: survivingEdit.coord }
      : { selection: emptySelection(), activeCell: null };
    writeThenEmit(ctx, s, batch.nextData, { source: "row-operation", ops: batch.ops }, () =>
      set({
        data: batch.nextData,
        rowIdentityVersion: s.rowIdentityVersion + 1,
        cellErrors: pruneCellErrors(s.cellErrors, batch.nextData, s.getRowId),
        ...cursor,
        ...view,
        ...editRemap,
        ...hiddenAfterDelete(s, batch.ops),
      }),
    );
  };

  let deleteConfirmPending = false;
  const warnedDeleteConfirm = new Set<string>();
  const warnDeleteConfirmOnce = (key: string, message: string): void => {
    if (warnedDeleteConfirm.has(key)) return;
    warnedDeleteConfirm.add(key);
    warnDev(message);
  };
  const requestDelete = (dataRowIndexes: number[]) => {
    const s = get();
    if (s.readOnly) return;
    const confirm = s.onBeforeDeleteRows;
    if (!confirm) {
      deleteDataRows(dataRowIndexes);
      return;
    }
    const rowIds = [...new Set(dataRowIndexes.flatMap((i) => (s.data[i] === undefined ? [] : [s.getRowId(s.data[i], i)])))];
    if (rowIds.length === 0) return;
    if (deleteConfirmPending) {
      warnDeleteConfirmOnce("pending", "a row delete was requested while the promise of onBeforeDeleteRows is still pending, so it is ignored; the promise must settle");
      return;
    }
    const hiddenCount = s.hiddenCheckedRowIds.size - rowIds.filter((id) => s.hiddenCheckedRowIds.has(id)).length;
    let verdict: boolean | Promise<boolean>;
    try {
      verdict = confirm({ rowIds, hiddenCount });
    } catch (error) {
      warnDeleteConfirmOnce("threw", `onBeforeDeleteRows threw, so the delete is cancelled: ${String(error)}`);
      return;
    }
    if (typeof verdict === "boolean") {
      if (verdict) deleteDataRows(dataRowIndexes);
      return;
    }
    deleteConfirmPending = true;
    const asked = { rowIdentityVersion: s.rowIdentityVersion, checked: s.selection.rows, hidden: s.hiddenCheckedRowIds };
    Promise.resolve(verdict).then(
      (confirmed) => {
        deleteConfirmPending = false;
        const now = get();
        const unchanged =
          !now.readOnly && now.rowIdentityVersion === asked.rowIdentityVersion && now.selection.rows === asked.checked && now.hiddenCheckedRowIds === asked.hidden;
        if (confirmed === true && unchanged) deleteDataRows(dataRowIndexes);
      },
      (error: unknown) => {
        deleteConfirmPending = false;
        warnDeleteConfirmOnce("rejected", `onBeforeDeleteRows rejected, so the delete is cancelled: ${String(error)}`);
      },
    );
  };

  const canMoveRows = (s: DataGridStoreState): boolean => {
    if (!s.enableRowReorder || s.readOnly) return false;
    if (viewSorts(s.sortMode, s.sortState).length > 0 || s.filterState.length > 0) {
      warnDev("reorderRows is a no-op while a sort or filter is active (the view order is owned by the sort/filter)");
      return false;
    }
    return true;
  };

  const announceRowMove = (s: DataGridStoreState, plan: RowMovePlan): string => {
    const { markers } = s.labels;
    const total = s.data.length;
    return plan.sources.length === 1
      ? markers.reorderAnnouncement(plan.sources[0]! + 1, plan.targets[0]! + 1, total)
      : markers.reorderRowsAnnouncement(plan.sources.length, plan.targets[0]! + 1, total);
  };

  /** Applies a plan as one write: one `move` operation per moved row, one emit, one permutation for the selection. Unsorted and unfiltered, view and data indices coincide. */
  const applyRowMoves = (s: DataGridStoreState, plan: RowMovePlan | null): boolean => {
    if (!plan) return false;
    const { data, getRowId } = s;
    const { newIndexOf } = plan;
    for (let i = 0; i < data.length; i++) {
      // Indexed access sees sparse holes; a reorder would shift the lazy add-on's in-flight index bookkeeping.
      if (data[i] === undefined) {
        warnDev("reorderRows is a no-op while rows are still unloaded (useDataGridLazyRows): load the range first");
        return false;
      }
    }
    const nextData = new Array<unknown>(data.length);
    for (let i = 0; i < data.length; i++) nextData[newIndexOf[i]!] = data[i];
    const ops = plan.sources.map<DataOp<unknown>>((from, i) => ({ type: "move", rowId: getRowId(data[from]!, from), row: data[from]!, from, to: plan.targets[i]! }));
    ctx.rowIndexCache.invalidate();
    forgetDeferredRows(ctx);
    ctx.lastEmittedData = nextData;
    const editRemap = remapEditing(s, s.viewIndex, s.visibleColumns, nextData, getRowId);
    const follow = (row: number) => newIndexOf[row] ?? row;
    writeThenEmit(ctx, s, nextData, { source: "row-operation", ops }, () =>
      set({
        data: nextData,
        rowIdentityVersion: s.rowIdentityVersion + 1,
        selection: remapSelectionRows(s.selection, newIndexOf),
        activeCell: s.activeCell ? { ...s.activeCell, row: follow(s.activeCell.row) } : null,
        lastHighlightedRow: s.lastHighlightedRow === null ? null : follow(s.lastHighlightedRow),
        rowMoveAnnouncement: announceRowMove(s, plan),
        ...editRemap,
      }),
    );
    return true;
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
      const restoreSelection = stale ? {} : { activeCell: nextActiveCell, selection: selectCellOf(s, nextActiveCell) };
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
      writeThenEmit(ctx, s, result.data, result.change, () =>
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
        ),
      );
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
      writeThenEmit(ctx, s, result.data, result.change, () =>
        set({
          data: result.data,
          cellErrors: result.warnings ? mergeCellErrors(cellErrors, result.warnings) : cellErrors,
          ...reconcileAfterWrite(s, result.data, result.change.ops),
        }),
      );
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
    applyCellUpdates(updates, source, rejected) {
      const s = get();
      if (s.readOnly) return;
      if (updates.length === 0) {
        // every cell rejected: the write is a no-op, but the consumer still gets the rejection report
        if (rejected) emitBulkRejections(source, rejected);
        return;
      }
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
      const range = rectFromCorners({ col: minCol, row: minRow }, { col: maxCol, row: maxRow });
      writeThenEmit(ctx, s, batch.nextData, { source, ops: batch.ops }, () =>
        set({
          data: batch.nextData,
          cellErrors,
          selection: { ...emptySelection(), current: { cell: { col: minCol, row: minRow }, range, rangeStack: [] } },
          activeCell: { col: minCol, row: minRow },
          ...reconcileAfterWrite(s, batch.nextData, batch.ops),
        }),
      );
      if (rejected) emitBulkRejections(source, rejected);
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
        const apply = ({ accepted, acceptedIndexes, rejected }: PrevalidatedPatches): UpdateCellsVerdict => {
          const invalid = rejected.map(({ patchIndex }) => ({ patchIndex, reason: "invalid" as const }));
          const verdict = accepted.length === 0 ? null : get().actions.updateCells(accepted, { ...options, skipValidation: true });
          emitStreamRejections(patches, rejected, options?.source);
          if (!verdict) return { applied: 0, skipped: invalid, pending: false };
          const remapped = verdict.skipped.map((skip) => ({ ...skip, patchIndex: acceptedIndexes[skip.patchIndex]! }));
          return { ...verdict, skipped: [...invalid, ...remapped].sort((a, b) => a.patchIndex - b.patchIndex) };
        };
        if (validated instanceof Promise) {
          const token = ++ctx.streamGeneration;
          const dropped: UpdateCellsVerdict = { applied: 0, skipped: [], pending: false };
          const settled = validated.then((accepted) => (ctx.streamGeneration !== token ? dropped : apply(accepted)));
          void settled.catch(() => {});
          return { applied: 0, skipped: [], pending: true, settled };
        }
        return apply(validated);
      }

      const rowIndex = ctx.rowIndexCache.resolve(s.data, s.getRowId);
      const batch = computeCellPatchBatch(s, patches, rowIndex, skipValidation);
      const nextData = batch.nextData;
      if (nextData === null) {
        emitStreamRejections(patches, batch.rejected, options?.source);
        return { applied: 0, skipped: batch.skipped, pending: false };
      }
      const applied = batch.ops.reduce((n, op) => (op.type === "update" ? n + (op.cells?.length ?? 0) : n), 0);

      const reorder = resolveReorder(options?.reorder, patches, viewSorts(s.sortMode, s.sortState), s.filterState);
      ctx.rowIndexCache.rebase(nextData);
      ctx.lastEmittedData = nextData;
      const change = { source: options?.source ?? "stream", ops: batch.ops };
      // With no cell errors, clearErrorsForOps returns the same map, so the streaming hot path pays nothing.
      const cellErrors = applyRowValidation(s, clearErrorsForOps(s.cellErrors, batch.ops), nextData, batch.ops);

      // Fast path: one set() writing `data` alone, so only touched rows re-render and view-derived state keeps its identity.
      if (reorder !== "immediate") {
        // Recorded for `"never"` too, so a later reconcile stays correct when the caller's assertion was wrong.
        rememberDeferredRows(ctx, batch.touchedRows);
        writeThenEmit(ctx, s, nextData, change, () =>
          set(
            reorder === "defer" && !s.viewStale
              ? { data: nextData, viewStale: true, cellErrors }
              : { data: nextData, cellErrors },
          ),
        );
        emitStreamRejections(patches, batch.rejected, options?.source);
        return { applied, skipped: batch.skipped, pending: false };
      }
      // Re-place only touched and earlier deferred rows; the binary search trusts the rest of the order.
      const viewIndex = resolveViewIndex(s, nextData, pendingRows(ctx, batch.touchedRows));
      resetDeferredRows(ctx);
      writeThenEmit(ctx, s, nextData, change, () =>
        set({
          data: nextData,
          cellErrors,
          viewIndex,
          viewStale: false,
          ...followView(s, viewIndex, s.visibleColumns, nextData, s.getRowId, true),
          ...computeSearchMatches(nextData, s.columns, viewIndex, s.visibleColumns, s.searchText, s.cellTypes, s.searchOptions),
        }),
      );
      emitStreamRejections(patches, batch.rejected, options?.source);
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
        ...computeSearchMatches(s.data, s.columns, viewIndex, s.visibleColumns, s.searchText, s.cellTypes, s.searchOptions),
      });
    },
    insertRow(viewRowIndex, position) {
      // single implementation path: the 1-row case of the batch action (same one undo step).
      get().actions.insertRows(viewRowIndex, 1, position);
    },
    insertRows(viewRowIndex, count, position = "below") {
      const s = get();
      if (s.readOnly) return;
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
      ctx.rowIndexCache.invalidate();
      forgetDeferredRows(ctx);
      ctx.lastEmittedData = batch.nextData;
      const view = rebuildRowOpView(s, batch.nextData);
      const editRemap = remapEditing(s, view.viewIndex!, s.visibleColumns, batch.nextData, s.getRowId);
      if (viewSorts(s.sortMode, s.sortState).length > 0 || s.filterState.length > 0) {
        pruneRowValidationKeys(batch.nextData, s.getRowId);
        writeThenEmit(ctx, s, batch.nextData, { source: "row-operation", ops: batch.ops }, () =>
          set({ data: batch.nextData, rowIdentityVersion: s.rowIdentityVersion + 1, cellErrors: pruneCellErrors(s.cellErrors, batch.nextData, s.getRowId), ...followActiveRow(s, batch.nextData, view.viewIndex!), ...view, ...editRemap }),
        );
        return;
      }
      // unsorted and unfiltered, the new rows land at this view index; shift selection/activeCell to follow them.
      const viewInsertAt = position === "above" ? viewRowIndex : viewRowIndex + 1;
      pruneRowValidationKeys(batch.nextData, s.getRowId);
      writeThenEmit(ctx, s, batch.nextData, { source: "row-operation", ops: batch.ops }, () =>
        set({
          data: batch.nextData,
          rowIdentityVersion: s.rowIdentityVersion + 1,
          cellErrors: pruneCellErrors(s.cellErrors, batch.nextData, s.getRowId),
          selection: offsetSelectionForRows(s.selection, viewInsertAt, count),
          activeCell: s.activeCell && s.activeCell.row >= viewInsertAt
            ? { ...s.activeCell, row: s.activeCell.row + count }
            : s.activeCell,
          ...view,
          ...editRemap,
        }),
      );
    },
    deleteRows(viewRowIndexes) {
      const s = get();
      requestDelete(viewRowIndexes.map((viewRow) => s.viewIndex[viewRow]).filter((i): i is number => i !== undefined));
    },
    deleteRowsById(rowIds) {
      const s = get();
      const dataRowIndexByRowId = ctx.rowIndexCache.resolve(s.data, s.getRowId);
      requestDelete(rowIds.map((rowId) => dataRowIndexByRowId.get(rowId)).filter((i): i is number => i !== undefined));
    },
    duplicateRows(viewRowIndexes) {
      const s = get();
      if (s.readOnly) return;
      if (!s.duplicateRow) {
        warnDev("duplicateRows is a no-op because no `duplicateRow` prop was provided");
        return;
      }
      const dataRowIndexes = viewRowIndexes.map((viewRow) => s.viewIndex[viewRow]).filter((i): i is number => i !== undefined);
      const batch = computeDuplicateBatch(s, dataRowIndexes);
      if (!batch) return;
      ctx.rowIndexCache.invalidate();
      forgetDeferredRows(ctx);
      ctx.lastEmittedData = batch.nextData;
      const view = rebuildRowOpView(s, batch.nextData);
      const editRemap = remapEditing(s, view.viewIndex!, s.visibleColumns, batch.nextData, s.getRowId);
      if (viewSorts(s.sortMode, s.sortState).length > 0 || s.filterState.length > 0) {
        pruneRowValidationKeys(batch.nextData, s.getRowId);
        writeThenEmit(ctx, s, batch.nextData, { source: "row-operation", ops: batch.ops }, () =>
          set({ data: batch.nextData, rowIdentityVersion: s.rowIdentityVersion + 1, cellErrors: pruneCellErrors(s.cellErrors, batch.nextData, s.getRowId), ...followActiveRow(s, batch.nextData, view.viewIndex!), ...view, ...editRemap }),
        );
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
      writeThenEmit(ctx, s, batch.nextData, { source: "row-operation", ops: batch.ops }, () =>
        set({
          data: batch.nextData,
          rowIdentityVersion: s.rowIdentityVersion + 1,
          cellErrors: pruneCellErrors(s.cellErrors, batch.nextData, s.getRowId),
          selection,
          activeCell,
          ...view,
          ...editRemap,
        }),
      );
    },
    reorderRows(rows, to) {
      const s = get();
      if (!canMoveRows(s)) return false;
      return applyRowMoves(s, planBlockMove(s.data.length, typeof rows === "number" ? [rows] : rows, to));
    },
    moveRowsBy(rows, delta) {
      const s = get();
      if (!canMoveRows(s)) return false;
      return applyRowMoves(s, planShiftMove(s.data.length, rows, delta));
    },
    commitChange(change) {
      const s = get();
      if (s.readOnly) return;
      if (change.ops.length === 0) return;
      const nextData = applyChange(s.data, change, s.getRowId);
      // applyChange keeps row references for untouched rows, so an all-skipped batch comes back element-identical.
      let applied = nextData.length !== s.data.length;
      if (!applied) {
        for (let i = 0; i < nextData.length; i++) {
          if (nextData[i] !== s.data[i]) {
            applied = true;
            break;
          }
        }
      }
      if (!applied) return;
      const movesRows = change.ops.some((op) => op.type !== "update");
      ctx.rowIndexCache.invalidate();
      forgetDeferredRows(ctx);
      ctx.lastEmittedData = nextData;
      pruneRowValidationKeys(nextData, s.getRowId);
      const cellErrors = pruneCellErrors(clearErrorsForOps(s.cellErrors, change.ops), nextData, s.getRowId);
      const view = rebuildRowOpView(s, nextData);
      if (!movesRows) {
        writeThenEmit(ctx, s, nextData, change, () =>
          set({ data: nextData, cellErrors, ...view, ...followView(s, view.viewIndex!, s.visibleColumns, nextData, s.getRowId, true) }),
        );
        return;
      }
      const editRemap = remapEditing(s, view.viewIndex!, s.visibleColumns, nextData, s.getRowId);
      const followed = followActiveRow(s, nextData, view.viewIndex!);
      const carried = carryRows(s, s.selection.rows, view.viewIndex!, nextData, s.getRowId, false, () => followed.selection.rows);
      writeThenEmit(ctx, s, nextData, change, () =>
        set({
          data: nextData,
          rowIdentityVersion: s.rowIdentityVersion + 1,
          cellErrors,
          ...followed,
          selection: carried.rows === followed.selection.rows ? followed.selection : { ...followed.selection, rows: carried.rows },
          hiddenCheckedRowIds: carried.hiddenCheckedRowIds,
          ...view,
          ...editRemap,
        }),
      );
    },
  };
}
