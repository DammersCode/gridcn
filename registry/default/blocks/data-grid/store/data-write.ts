import {
  cellErrorKey,
  flashCellKey,
  clampIndex,
  clearErrorsForOps,
  computeSearchMatches,
  computeViewIndex,
  incrementalViewIndex,
  mergeCellErrors,
  pruneCellErrors,
  remapRowChannel,
  selectCellOf,
  pageStartOf,
  fullViewOf,
  viewWindowOf,
  windowView,
  sameElements,
  viewSorts,
  viewFilters,
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
  startDuplicateCopies,
  warnFlagsForOps,
  type PatchRejection,
  type PrevalidatedPatches,
  warnDev,
  resolveEditTarget,
} from "./commit";
import { toSafeText } from "../cell-types/safe-text";
import { createWarnOnce, isThenable } from "./async-gate";
import { reportRowActionSkipped } from "./row-action-skip";
import type { GateRun, GateTracker } from "./gate-signal";
import { buildRollback } from "../interaction/rollback";
import { readRejections, refusedOps, type RowSaveStatus, type SaveAck, type SaveRejection, type SaveResolution } from "./write-ack";
import { EMPTY_SAVE_STATUS } from "./write-ack";
import { INCREMENTAL_PATCH_LIMIT } from "../sort-filter";
import { NO_REMEMBERED_ROWS, withoutHiddenCheckedRows } from "./hidden-checked-rows";
import { applyChange } from "../interaction/history";
import { planBlockMove, planShiftMove, type RowMovePlan } from "../rows/plan-row-moves";
import { resolveCellRef, patchesLeaveViewAlone, resolveReorder, viewRowOfDataIndex, touchesViewInputs, type RowIndexCache } from "./row-index";
import {
  emptySelection,
  offsetSelectionForRows,
  rectFromCorners,
  remapSelectionRows,
  selectCell as selectCellPure,
  selectionRects,
} from "../selection";
import { forEachMember } from "../selection/compact-selection";
import { viewIndexes, type CellRef, type CompactSelectionLike, type DataChange, type DataGridApi, type DataOp, type GridBulkValidationError, type GridValidationErrorEvent, type ViewCoord } from "../types";
import { resolveColumnValidate } from "../cell-types/capabilities";
import { runValidateSync } from "../validation/validate-cell";
import { nextAnnouncement } from "./announcements";
import { clearStaleRows, followStaleRows, markStaleRows, pruneStaleRows, requestReshape, staleStateAfterPrune } from "./server-stale";
import type { AnyColumnDef, CellErrorEntry, CellPatch, DataGridActions, DataGridInternalActions, DataGridStoreState, UpdateCellsSkip, RowActionName, RowActionResult, RowActionSkipReason, UpdateCellsVerdict } from "./types";

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
  warnedViewIndexIds: boolean;
  /** Dev-warns at most once per grid that a write reached controlled `data` with no `onDataChange` or `onSave`. */
  warnedUnreceivedWrite: boolean;
  /** `onDataChange` calls waiting for the outermost write to return; see {@link writeThenEmit}. */
  pendingEmits: (() => void)[];
  /** How many {@link writeThenEmit} writes are running, nested through store subscribers. */
  writeDepth: number;
  /** The grid's imperative handle, handed to plugin `onDataChange` observers; set at store creation, before any write can run. */
  pluginApi: DataGridApi<unknown> | null;
  /** Tracks the promise `onSave` returned; set by {@link createDataWriteActions}. */
  trackWrite: ((change: DataChange<unknown>, result: PromiseLike<SaveAck>) => void) | null;
  /** Set while the grid is unmounted: a late ack neither reverts nor calls back. */
  disposed: boolean;
  /** The stale rows with the row object and data index of their latest push; `staleRowIds` in the state is its key set. */
  staleRows: Map<string, { row: unknown; index: number }>;
  /** Asks the mounted `useDataGridServerRows` to refetch the rows; `null` without one. `"urgent"` skips the hook's `reshapeDelayMs`, `"stale"` is a deferred push that marked a row. */
  reshape: ((trigger: "urgent" | "stale") => void) | null;
  warnedReshape: boolean;
  /** Aborts every pending `resolveSaveConflict` call; set by {@link createDataWriteActions}, run when the grid unmounts. */
  abortConflicts: (() => void) | null;
  /** The grid's async-gate tracker: pending state and abort for the row operations' consumer hooks. */
  gates: GateTracker;
};

export function createDataWriteContext(rowIndexCache: RowIndexCache, gates: GateTracker): DataWriteContext {
  return { streamGeneration: 0, deferredRows: new Set(), rowIndexCache, lastEmittedData: null, warnedStaleCellRef: false, warnedViewIndexIds: false, warnedUnreceivedWrite: false, pendingEmits: [], writeDepth: 0, pluginApi: null, trackWrite: null, disposed: false, staleRows: new Map(), reshape: null, warnedReshape: false, abortConflicts: null, gates };
}

/** {@link resolveCellRef} plus the once-per-grid dev-warn for a ref that no longer resolves. */
export function resolveRefOrWarn(ctx: DataWriteContext, s: DataGridStoreState, ref: CellRef): ViewCoord | null {
  const coord = resolveCellRef(s, ctx.rowIndexCache, ref);
  if (!coord && !ctx.warnedStaleCellRef) {
    ctx.warnedStaleCellRef = true;
    warnDev(`CellRef { rowId: ${toSafeText(ref.rowId)}, columnId: ${toSafeText(ref.columnId)} } does not resolve in the current view (row no longer in data, or column hidden); the action is a no-op`);
  }
  return coord;
}

/** Dev-warns once per grid when an id-first row action got a number (the default `getRowId` returns strings): a call from before the `At` suffix. */
export function warnViewIndexIds(ctx: DataWriteContext, rowIds: readonly unknown[], action: string): void {
  if (ctx.warnedViewIndexIds) return;
  if (!rowIds.some((id) => typeof id === "number")) return;
  ctx.warnedViewIndexIds = true;
  warnDev(`${action} takes stable row ids, and a number here is not a row id. To address rows by view index, call ${action}At with viewIndexes([...])`);
}

/**
 * Runs `write` and queues its `onDataChange`. The queue flushes FIFO once the outermost write
 * returns, so a write that a store subscriber makes during `write` emits after it, in gesture order.
 * The consumer's `onDataChange` runs first, then `onSave` (never for a rollback, a stream, or an id swap), then each
 * resolved plugin observer. Each runs isolated: a throw in `onDataChange` is rethrown after the rest ran,
 * a throwing `onSave` refuses the change, and a throwing observer logs.
 */
export function writeThenEmit(
  ctx: DataWriteContext,
  s: DataGridStoreState,
  next: readonly unknown[],
  change: DataChange<unknown>,
  write: () => void,
): void {
  followStaleRows(ctx, change.ops);
  if (s.dataControlled && !s.onDataChange && !s.onSave && change.source !== "rollback" && !ctx.warnedUnreceivedWrite) {
    ctx.warnedUnreceivedWrite = true;
    warnDev("data is controlled and no onDataChange receives this change, so the grid drops it on the next render. Pass onDataChange, use defaultData, or set readOnly.");
  }
  const onDataChange = s.onDataChange;
  const onSave = change.source === "rollback" || change.source === "stream" || change.source === "id-swap" ? undefined : s.onSave;
  const observers = s.plugins.observers;
  const pluginApi = ctx.pluginApi;
  ctx.pendingEmits.push(() => {
    let failure: { error: unknown } | null = null;
    try {
      onDataChange?.(next, change);
    } catch (error) {
      failure = { error };
    }
    if (onSave) {
      try {
        const result = onSave(change);
        if (isThenable(result)) ctx.trackWrite?.(change, result);
      } catch (error) {
        ctx.trackWrite?.(change, Promise.reject(error));
      }
    }
    if (observers.length > 0 && pluginApi) {
      const observerCtx = { api: pluginApi };
      for (const observer of observers) {
        try {
          observer(next, change, observerCtx);
        } catch (error) {
          console.warn("[data-grid] a plugin onDataChange observer threw; the change was applied and the remaining observers still run", error);
        }
      }
    }
    if (failure) throw failure.error;
  });
  ctx.writeDepth += 1;
  try {
    write();
  } finally {
    ctx.writeDepth -= 1;
    if (ctx.writeDepth === 0) flushEmits(ctx);
  }
}

/** Runs a store listener's consumer callback; a throw logs, since a throw inside a store listener skips the store's other listeners. */
export function emitFromListener(label: string, emit: () => void): void {
  try {
    emit();
  } catch (error) {
    console.error(`[data-grid] ${label} threw:`, error);
  }
}

/** Most patches (and, for a delete, row ids) that one `"stream"` call takes. Patches past it skip with reason `"limit"`; delete ids past it drop with a dev warning. */
export const MAX_STREAM_PATCHES = 100_000;

/** Rejected rows up to this count resolve their view row with one `indexOf` each instead of one full pass. */
const STREAM_REJECTION_SCAN_LIMIT = 16;

/** Queues `emits` behind the pending emits; runs the queue at once when no store write is in progress. */
export function emitAfterWrites(ctx: DataWriteContext, ...emits: (() => void)[]): void {
  ctx.pendingEmits.push(...emits);
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
  const prevFull = fullViewOf(s.viewIndex);
  const incremental = pending
    ? incrementalViewIndex(data, s.columns, viewSorts(s.sortMode, s.sortState), viewFilters(s.filterMode, s.filterState), prevFull, pending, s.cellTypes, s.sortLocale)
    : null;
  if (incremental) return windowView(sameElements(incremental, prevFull) ? prevFull : incremental, viewWindowOf(s), s.viewIndex);
  return computeViewIndex(data, s.columns, viewSorts(s.sortMode, s.sortState), viewFilters(s.filterMode, s.filterState), s.viewIndex, s.cellTypes, viewWindowOf(s), s.sortLocale);
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
  const viewStale = s.viewStale || touchesViewInputs(written, viewSorts(s.sortMode, s.sortState), viewFilters(s.filterMode, s.filterState));
  if (s.searchText.trim() === "") return viewStale === s.viewStale ? {} : { viewStale };
  return {
    ...(viewStale === s.viewStale ? {} : { viewStale }),
    ...computeSearchMatches(nextData, s.columns, s.viewIndex, s.visibleColumns, s.searchText, s.cellTypes, s.searchOptions),
  };
}

/**
 * The view bookkeeping a row write owes (`insertRows`/`deleteRows`/`duplicateRows` and `commitChange`):
 * the view index is rebuilt over `nextData`, `searchMatches` is recomputed against it, and `viewStale`
 * stays `true` only while pushed stale rows remain, mirroring `setColumnHidden`. The caller owns
 * `activeCell` (it follows or clears the cursor itself).
 */
export function rebuildRowOpView(s: DataGridStoreState, nextData: readonly unknown[]): Partial<DataGridStoreState> {
  const viewIndex = computeViewIndex(nextData, s.columns, viewSorts(s.sortMode, s.sortState), viewFilters(s.filterMode, s.filterState), s.viewIndex, s.cellTypes, viewWindowOf(s), s.sortLocale);
  const staleRowIds = s.dataWrite.staleRows.size > 0 ? staleStateAfterPrune(s.dataWrite, s.staleRowIds, pruneStaleRows(s.dataWrite, nextData, s.getRowId)) : s.staleRowIds;
  return {
    viewIndex,
    viewStale: staleRowIds.size > 0,
    ...(staleRowIds === s.staleRowIds ? {} : { staleRowIds }),
    ...computeSearchMatches(nextData, s.columns, viewIndex, s.visibleColumns, s.searchText, s.cellTypes, s.searchOptions),
  };
}

/**
 * After a write that moves rows (an insert or duplicate under a sort, a filter, or paging, and every
 * row-moving `commitChange`), follow the active row by identity and collapse the range onto it; the
 * cursor clears when its row is gone. The row channel follows its records.
 */
export function followActiveRow(s: DataGridStoreState, nextData: readonly unknown[], viewIndex: readonly number[]): Pick<DataGridStoreState, "selection" | "activeCell"> {
  const checked = s.selection.rows;
  let rows = emptySelection().rows;
  if (checked.length > 0) {
    const records = new Set<unknown>();
    forEachMember(checked.runs(), (viewRow) => {
      const record = s.data[s.viewIndex[viewRow] ?? -1];
      if (record !== undefined) records.add(record);
    });
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

/** `remap` with its selection's row channel replaced by `rows`; the remap holds the pre-write channel. */
function keepRows(remap: Partial<DataGridStoreState>, rows: CompactSelectionLike): Partial<DataGridStoreState> {
  const selection = remap.selection;
  return selection && selection.rows !== rows ? { ...remap, selection: { ...selection, rows } } : remap;
}

/** The rows `ops` inserts or updates, as the `update` entries that `validateRow` runs for. */
function rowsToValidate(ops: readonly DataOp<unknown>[]): DataOp<unknown>[] {
  const rows: DataOp<unknown>[] = [];
  for (const op of ops) {
    if (op.type === "update") rows.push(op);
    else if (op.type === "insert") rows.push({ type: "update", rowId: op.rowId, row: op.row, prev: op.row });
  }
  return rows;
}

/** A `"stream"` change carries a server push, which `updateCells` validates with its own rules; every other `commitChange` source goes through `validateRow`. */
const UNVALIDATED_SOURCE: DataChange<unknown>["source"] = "stream";

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
  ) => { rows: CompactSelectionLike; hiddenCheckedRowIds: ReadonlySet<string>; allMatching: boolean };
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
  /** Moves the store's row-id keyed bookkeeping (row validation keys, in-flight verdicts, flash timers) from `oldId` to `newId`. */
  renameRowKeys: (oldId: string, newId: string) => void;
};

/** Every data-writing action of the store, extracted as one cluster: the edit commits, the bulk writers, and the row operations; `_deleteCellsById` is the internal clipboard seam, split out by the store factory. */
export type DataWriteActions = Pick<
  DataGridActions,
  | "commitCellValue"
  | "commitCellValueAt"
  | "deleteSelection"
  | "applyCellUpdates"
  | "updateCells"
  | "updateRows"
  | "editRows"
  | "reconcileView"
  | "insertRow"
  | "insertRows"
  | "deleteRows"
  | "deleteRowsAt"
  | "duplicateRows"
  | "duplicateRowsAt"
  | "reorderRows"
  | "moveRowsBy"
  | "commitChange"
  | "clearSaveStatus"
  | "replaceRowId"
  | "replaceRowIds"
> & {
  /** Clears every `rowIds` x `columnIds` cell still in view, as one `delete` batch (the cut-capture seam). */
  _deleteCellsById(rowIds: readonly string[], columnIds: readonly string[]): void;
  _commitCellEdit: DataGridInternalActions["_commitCellEdit"];
  _commitChange: DataGridInternalActions["_commitChange"];
  _skipRowAction: DataGridInternalActions["_skipRowAction"];
  /** Commits an `activate` result like `commitCellValueAt`, and reports a validator rejection through `onValidationError`. */
  _commitActivation: (coord: ViewCoord, value: unknown) => void;
};

export function createDataWriteActions(set: SetState, get: GetState, deps: DataWriteDeps): DataWriteActions {
  const { ctx, applyRowValidation, pruneRowValidationKeys, followView, carryRows, remapEditing, endEditSession, renameRowKeys } = deps;

  const pendingByRow = new Map<string, number>();
  const latestWriteOfRow = new Map<string, number>();
  const failedRows = new Set<string>();
  let writeSeq = 0;
  let pendingSaves = 0;
  let warnedReadOnlyRevert = false;
  // Refused cell value -> the value it replaced, so a second refusal on the same cell reverts past the first refused value.
  const refusedPrev = new Map<string, Map<string, Map<unknown, unknown>>>();
  const MAX_FAILED_ROWS = 10_000;
  const MAX_CHAINED_ROWS = 10_000;
  const dropChains = (rowId: string): void => {
    refusedPrev.delete(rowId);
  };
  const chainRefusedPrev = (ops: DataOp<unknown>[]): DataOp<unknown>[] =>
    ops.map((op) => {
      if (op.type !== "update" || !op.cells) return op;
      const cells = op.cells.map((cell) => {
        const byColumn = refusedPrev.get(op.rowId) ?? new Map<string, Map<unknown, unknown>>();
        const chain = byColumn.get(cell.columnId) ?? new Map<unknown, unknown>();
        const prev = chain.has(cell.prev) ? chain.get(cell.prev) : cell.prev;
        chain.set(cell.value, prev);
        byColumn.set(cell.columnId, chain);
        refusedPrev.set(op.rowId, byColumn);
        return { ...cell, prev };
      });
      return { ...op, cells };
    });
  let warnedCurrentRowId = false;
  /** The `current` rows of the rejections that may replace a row: its id matches, the change holds no insert of it, and no newer write is pending. */
  const usableCurrentRows = (
    s: DataGridStoreState,
    change: DataChange<unknown>,
    rejected: readonly SaveRejection[],
    seq: number,
    deleteOps: ReadonlyMap<string, { index: number }>,
  ): Map<string, unknown> => {
    const usable = new Map<string, unknown>();
    const inserted = new Set(change.ops.flatMap((op) => (op.type === "insert" ? [op.rowId] : [])));
    for (const { rowId, current } of rejected) {
      // A newer write to the row, pending or already accepted, makes the server's row older than the grid's.
      if (current === undefined || inserted.has(rowId) || pendingByRow.has(rowId) || latestWriteOfRow.get(rowId) !== seq) continue;
      const index = deleteOps.get(rowId)?.index ?? 0;
      let currentId: string | undefined;
      try {
        currentId = s.getRowId(current, index);
      } catch {
        currentId = undefined;
      }
      if (currentId !== rowId) {
        if (!warnedCurrentRowId) {
          warnedCurrentRowId = true;
          warnDev(`SaveRejection.current for row "${rowId}" has another id, so it was ignored and the change was reverted in place`);
        }
        continue;
      }
      usable.set(rowId, current);
    }
    return usable;
  };
  /** One `change.ops` entry per `current` row: replace the row in the data, or re-insert a deleted row as the server holds it. */
  const currentRowOps = (s: DataGridStoreState, currentRows: ReadonlyMap<string, unknown>, deleteOps: ReadonlyMap<string, { index: number }>): DataOp<unknown>[] => {
    if (currentRows.size === 0) return [];
    const dataIndexById = ctx.rowIndexCache.resolve(s.data, s.getRowId);
    const ops: DataOp<unknown>[] = [];
    for (const [rowId, current] of currentRows) {
      const index = dataIndexById.get(rowId);
      if (index !== undefined) {
        ops.push({ type: "update", rowId, row: current, prev: s.data[index] });
        continue;
      }
      const deleted = deleteOps.get(rowId);
      if (deleted) ops.push({ type: "insert", rowId, row: current, index: deleted.index });
    }
    return ops;
  };
  /** The `"merge"` updates for rows whose resolver kept the user's intent (`"mine"` or a merged row) on top of the server's row. */
  const mergeOpsOf = (s: DataGridStoreState, currentRows: ReadonlyMap<string, unknown>, answers: ReadonlyMap<string, SaveResolution<unknown>>): DataOp<unknown>[] => {
    const ops: DataOp<unknown>[] = [];
    if (answers.size === 0 || currentRows.size === 0) return ops;
    const dataIndexById = ctx.rowIndexCache.resolve(s.data, s.getRowId);
    for (const [rowId, theirs] of currentRows) {
      const answer = answers.get(rowId);
      if (answer === undefined || answer === "theirs") continue;
      const index = dataIndexById.get(rowId);
      if (index === undefined) continue;
      let target: unknown = s.data[index];
      if (answer !== "mine") {
        const merged = (answer as { row: unknown }).row;
        let mergedId: string | undefined;
        try {
          mergedId = merged === undefined || merged === null ? undefined : s.getRowId(merged, index);
        } catch {
          mergedId = undefined;
        }
        if (mergedId !== rowId) {
          warnGateOnce("merged row id", `resolveSaveConflict returned a row that does not have the id "${rowId}", so the server's row is taken`);
          continue;
        }
        target = merged;
      }
      ops.push({ type: "update", rowId, row: target, prev: theirs });
    }
    return ops;
  };
  /** An acknowledged write in flight; `alias` maps the row ids it was tracked under to the ids a swap gave them since. */
  type LiveWrite = { rowIds: Set<string>; alias: Map<string, string>; origin: Map<string, string> };
  const liveWrites = new Set<LiveWrite>();
  const retargetLiveWrites = (oldId: string, newId: string): void => {
    for (const write of liveWrites) {
      const origin = write.origin.get(oldId) ?? (write.rowIds.has(oldId) && !write.alias.has(oldId) ? oldId : undefined);
      if (origin === undefined) continue;
      write.alias.set(origin, newId);
      write.origin.delete(oldId);
      write.origin.set(newId, origin);
    }
  };
  const resolvingRows = new Map<string, number>();
  const conflictAborts = new Map<string, AbortController>();
  ctx.abortConflicts = () => {
    for (const controller of conflictAborts.values()) controller.abort();
    conflictAborts.clear();
  };
  const publishSaveStatus = (): void => {
    const status = new Map<string, RowSaveStatus>();
    for (const rowId of failedRows) status.set(rowId, "failed");
    for (const rowId of pendingByRow.keys()) status.set(rowId, "saving");
    for (const rowId of resolvingRows.keys()) status.set(rowId, "saving");
    for (const rowId of latestWriteOfRow.keys()) if (!status.has(rowId)) latestWriteOfRow.delete(rowId);
    set({ saveStatus: status.size === 0 ? EMPTY_SAVE_STATUS : status, pendingSaveCount: pendingSaves });
  };
  const normalizeResolution = (answer: unknown): SaveResolution<unknown> => {
    if (answer === "mine") return "mine";
    if (typeof answer === "object" && answer !== null && (answer as { row?: unknown }).row != null) return answer as { row: unknown };
    return "theirs";
  };
  ctx.trackWrite = (change, result) => {
    const rowIds = [...new Set(change.ops.map((op) => op.rowId))];
    const write: LiveWrite = { rowIds: new Set(rowIds), alias: new Map(), origin: new Map() };
    const liveId = (rowId: string): string => write.alias.get(rowId) ?? rowId;
    liveWrites.add(write);
    const seq = ++writeSeq;
    for (const rowId of rowIds) {
      pendingByRow.set(rowId, (pendingByRow.get(rowId) ?? 0) + 1);
      latestWriteOfRow.set(rowId, seq);
      failedRows.delete(rowId);
      conflictAborts.get(rowId)?.abort();
      conflictAborts.delete(rowId);
    }
    pendingSaves += 1;
    publishSaveStatus();
    const settle = (ack: SaveAck, error: unknown, failed: boolean): void => {
      if (ctx.disposed) return;
      const ids = rowIds.map(liveId);
      for (const rowId of ids) {
        const left = (pendingByRow.get(rowId) ?? 1) - 1;
        if (left > 0) pendingByRow.set(rowId, left);
        else pendingByRow.delete(rowId);
      }
      pendingSaves -= 1;
      const rejectedAtSettle = readRejections(change, ack, error, failed);
      const refusedAtSettle = new Set(rejectedAtSettle.map((entry) => liveId(entry.rowId)));
      // A chain only bridges writes that overlap in flight; an accepted write or an idle row ends it.
      for (const rowId of ids) if (!refusedAtSettle.has(rowId) && !pendingByRow.has(rowId)) dropChains(rowId);
      if (rejectedAtSettle.length === 0) {
        liveWrites.delete(write);
        publishSaveStatus();
        return;
      }
      const originOf = new Map(ids.map((id, i) => [id, rowIds[i]!] as const));
      const view = () => {
        const retarget = write.alias.size > 0;
        const rejected = retarget ? rejectedAtSettle.map((entry) => ({ ...entry, rowId: liveId(entry.rowId) })) : rejectedAtSettle;
        const aliased = retarget ? { ...change, ops: change.ops.map((op) => (write.alias.has(op.rowId) ? { ...op, rowId: liveId(op.rowId) } : op)) } : change;
        const deleteOps = new Map(aliased.ops.flatMap((op) => (op.type === "delete" ? [[op.rowId, op] as const] : [])));
        return { rejected, aliased, deleteOps, refusedRows: new Set(rejected.map((entry) => entry.rowId)) };
      };
      const asked = new Map<string, { controller: AbortController; answer?: SaveResolution<unknown> }>();
      const waiting: PromiseLike<void>[] = [];
      const first = get();
      const resolver = first.readOnly ? undefined : first.resolveSaveConflict;
      const start = view();
      if (resolver) {
        const dataIndexById = ctx.rowIndexCache.resolve(first.data, first.getRowId);
        const messageById = new Map<string, string>();
        for (const entry of start.rejected) if (entry.message !== undefined && !messageById.has(entry.rowId)) messageById.set(entry.rowId, entry.message);
        for (const [rowId, theirs] of usableCurrentRows(first, start.aliased, start.rejected, seq, start.deleteOps)) {
          const index = dataIndexById.get(rowId);
          if (index === undefined) continue;
          const controller = new AbortController();
          conflictAborts.set(rowId, controller);
          const entry: { controller: AbortController; answer?: SaveResolution<unknown> } = { controller };
          asked.set(originOf.get(rowId) ?? rowId, entry);
          const message = messageById.get(rowId);
          let answer: SaveResolution<unknown> | PromiseLike<SaveResolution<unknown>>;
          try {
            answer = resolver({ rowId, mine: first.data[index], theirs, change: start.aliased, ...(message === undefined ? {} : { message }), signal: controller.signal });
          } catch (callbackError) {
            console.error("[data-grid] resolveSaveConflict threw, so the server's row is taken:", callbackError);
            continue;
          }
          if (!isThenable<SaveResolution<unknown>>(answer)) {
            entry.answer = normalizeResolution(answer);
            continue;
          }
          const aborted = new Promise<void>((resolve) => {
            if (controller.signal.aborted) resolve();
            else controller.signal.addEventListener("abort", () => resolve(), { once: true });
          });
          waiting.push(
            Promise.race([
              aborted,
              Promise.resolve(answer).then(
                (resolved) => void (entry.answer = normalizeResolution(resolved)),
                (callbackError: unknown) => void console.error("[data-grid] resolveSaveConflict rejected, so the server's row is taken:", callbackError),
              ),
            ]),
          );
        }
      }
      const finish = (): void => {
        const { rejected, aliased, deleteOps, refusedRows } = view();
        const s = get();
        if (s.readOnly) {
          if (!warnedReadOnlyRevert) {
            warnedReadOnlyRevert = true;
            warnDev("a write was refused while the grid is readOnly, so it was not reverted; the data keeps the refused value");
          }
        } else {
          try {
          if (refusedPrev.size > MAX_CHAINED_ROWS) refusedPrev.clear();
          const currentRows = usableCurrentRows(s, aliased, rejected, seq, deleteOps);
          const answers = new Map<string, SaveResolution<unknown>>();
          for (const [origin, entry] of asked) {
            const id = liveId(origin);
            if (entry.controller.signal.aborted) currentRows.delete(id);
            else if (entry.answer !== undefined) answers.set(id, entry.answer);
          }
          const mergeOps = mergeOpsOf(s, currentRows, answers);
          // A row with a usable `current` gets its content from it; only a move of it reverts in place.
          const plainOps = refusedOps(aliased, rejected).filter((op) => !(currentRows.has(op.rowId) && (op.type === "update" || op.type === "delete")));
          const revert = buildRollback({ ops: chainRefusedPrev(plainOps), source: "rollback" }, s);
          const ops = [...revert.ops, ...currentRowOps(s, currentRows, deleteOps)];
          const serverRowIds = [...currentRows.keys()];
          try {
            if (ops.length > 0) s.actions.commitChange({ ...revert, ops, reverts: change, ...(serverRowIds.length > 0 ? { serverRowIds } : {}) });
          } catch (error) {
            console.error("[data-grid] the revert of a refused save threw in a callback:", error);
          }
          try {
            if (mergeOps.length > 0) s.actions.commitChange({ source: "merge", ops: mergeOps, reverts: change, serverRowIds: mergeOps.map((op) => op.rowId) });
          } catch (error) {
            console.error("[data-grid] the merge of a save conflict threw in a callback:", error);
          }
          } catch (error) {
            console.error("[data-grid] the revert of a refused save failed:", error);
          }
        }
        for (const [origin, entry] of asked) if (conflictAborts.get(liveId(origin)) === entry.controller) conflictAborts.delete(liveId(origin));
        for (const rowId of refusedRows) if (!pendingByRow.has(rowId)) dropChains(rowId);
        for (const { rowId } of rejected) {
          if (latestWriteOfRow.get(rowId) !== seq) continue;
          if (failedRows.size >= MAX_FAILED_ROWS) failedRows.delete(failedRows.values().next().value!);
          failedRows.add(rowId);
        }
        const liveIds = new Set(rowIds.map(liveId));
        const refusedInChange = [...refusedRows].filter((rowId) => liveIds.has(rowId)).length;
        set({ liveAnnouncement: nextAnnouncement(get().liveAnnouncement, "saveRejected", refusedInChange) });
        liveWrites.delete(write);
        publishSaveStatus();
        const onSaveRejected = get().onSaveRejected;
        if (!onSaveRejected) return;
        try {
          onSaveRejected({ change, rejected, error: failed ? error : null });
        } catch (callbackError) {
          console.error("[data-grid] onSaveRejected threw:", callbackError);
        }
      };
      if (waiting.length === 0) {
        finish();
        return;
      }
      const held = [...start.refusedRows].filter((id) => originOf.has(id)).map((id) => originOf.get(id)!);
      for (const rowId of held) resolvingRows.set(rowId, (resolvingRows.get(rowId) ?? 0) + 1);
      publishSaveStatus();
      void Promise.all(waiting).then(() => {
        for (const origin of held) {
          const rowId = liveId(origin);
          const left = (resolvingRows.get(rowId) ?? 1) - 1;
          if (left > 0) resolvingRows.set(rowId, left);
          else resolvingRows.delete(rowId);
        }
        if (ctx.disposed) return;
        finish();
      });
    };
    Promise.resolve(result).then(
      (ack) => settle(ack, undefined, false),
      (error: unknown) => settle(undefined, error, true),
    );
  };

  /** Reports the patches a validator refused through `onValidationError`; a row outside the view reports `viewRowIndex: -1`. */
  const emitStreamRejections = (patches: readonly CellPatch[], rejected: readonly PatchRejection[], batchSource?: DataChange<unknown>["source"]): void => {
    const s = get();
    const onValidationError = s.onValidationError;
    if (rejected.length === 0 || !onValidationError || (s.readOnly && (batchSource ?? "stream") !== "stream")) return;
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
  /** Runs each column's sync `validate` on the cleared value: a rejected cell stays, except in a `validationMode: "warn"` column, which clears and flags it. */
  const validateClearWrites = (s: DataGridStoreState, writes: { viewRowIndex: number; columnId: string; value: unknown }[]) => {
    const columns = new Map(s.columns.map((c) => [c.id, c] as const));
    const accepted: typeof writes = [];
    const rejected: GridBulkValidationError[] = [];
    const warnings: CellErrorEntry[] = [];
    for (const write of writes) {
      const column = columns.get(write.columnId);
      const dataRowIndex = s.viewIndex[write.viewRowIndex];
      const row = dataRowIndex === undefined ? undefined : s.data[dataRowIndex];
      const validate = column && resolveColumnValidate(column, s.cellTypes[column.type ?? "text"]);
      if (!validate || row === undefined) {
        accepted.push(write);
        continue;
      }
      const result = runValidateSync(validate, write.value, row);
      const rowId = s.getRowId(row, dataRowIndex!);
      if (!("error" in result)) accepted.push({ ...write, value: result.value });
      else if (column.validationMode === "warn" && !result.thrown) {
        warnings.push({ rowId, columnId: write.columnId, message: result.error });
        accepted.push(write);
      } else rejected.push({ rowId, columnId: write.columnId, viewRowIndex: write.viewRowIndex, value: write.value, message: result.error });
    }
    return { accepted, rejected, warnings };
  };

  const commitClearWrites = (s: DataGridStoreState, requested: { viewRowIndex: number; columnId: string; value: unknown }[]): void => {
    const { accepted, rejected, warnings } = validateClearWrites(s, requested);
    const batch = computeRowEditsBatch(s, accepted);
    if (batch) {
      ctx.rowIndexCache.rebase(batch.nextData);
      forgetDeferredRows(ctx);
      ctx.lastEmittedData = batch.nextData;
      const validated = applyRowValidation(s, clearErrorsForOps(s.cellErrors, batch.ops), batch.nextData, batch.ops);
      const cellErrors = mergeCellErrors(validated, warnings);
      writeThenEmit(ctx, s, batch.nextData, { source: "delete", ops: batch.ops }, () =>
        set({
          data: batch.nextData,
          cellErrors,
          ...reconcileAfterWrite(s, batch.nextData, batch.ops),
        }),
      );
    }
    emitBulkRejections("delete", rejected);
  };

  const hiddenAfterDelete = (s: DataGridStoreState, ops: readonly DataOp<unknown>[]): Partial<DataGridStoreState> => {
    if (s.hiddenCheckedRowIds.size === 0) return {};
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
        ...(s.allMatching ? NO_REMEMBERED_ROWS : {}),
      }),
    );
  };

  let deleteRun: GateRun | null = null;
  const warnGateOnce = createWarnOnce();
  const touchesUnloadedRow = (s: DataGridStoreState, dataRowIndexes: readonly number[], operation: string): boolean => {
    if (!dataRowIndexes.some((i) => s.data[i] === undefined && i >= 0 && i < s.data.length)) return false;
    warnGateOnce("unloaded rows", `${operation} is a no-op while its target rows are still unloaded (scroll mode): load the range first, or delete known ids with deleteRows`);
    return true;
  };
  const OK: RowActionResult = { ok: true };
  const skippedBy = (action: RowActionName, reason: RowActionSkipReason): RowActionResult => reportRowActionSkipped(get(), action, reason);
  const requestDelete = (dataRowIndexes: number[]): RowActionResult => {
    const s = get();
    if (s.readOnly) return skippedBy("deleteRows", "readOnly");
    if (touchesUnloadedRow(s, dataRowIndexes, "deleteRows")) return skippedBy("deleteRows", "unloaded-rows");
    if (!dataRowIndexes.some((i) => s.data[i] !== undefined)) return skippedBy("deleteRows", "nothing-to-do");
    const confirm = s.onBeforeDeleteRows;
    if (!confirm) {
      deleteDataRows(dataRowIndexes);
      return OK;
    }
    const rowIds = [...new Set(dataRowIndexes.flatMap((i) => (s.data[i] === undefined ? [] : [s.getRowId(s.data[i], i)])))];
    if (deleteRun && !deleteRun.aborted) {
      warnGateOnce("pending", "a row delete was requested while the promise of onBeforeDeleteRows is still pending, so it is ignored; the promise must settle");
      return skippedBy("deleteRows", "gate-pending");
    }
    // In "all matching" mode the set holds exclusions, and the delete ends the mode, so no hidden check stays.
    const hiddenCount = s.allMatching ? 0 : s.hiddenCheckedRowIds.size - rowIds.filter((id) => s.hiddenCheckedRowIds.has(id)).length;
    const run = ctx.gates.begin("onBeforeDeleteRows");
    let verdict: boolean | Promise<boolean>;
    try {
      verdict = confirm({ rowIds, hiddenCount, signal: run.signal });
    } catch (error) {
      warnGateOnce("threw", () => `onBeforeDeleteRows threw, so the delete is cancelled: ${toSafeText(error)}`);
      return skippedBy("deleteRows", "gate-threw");
    }
    if (typeof verdict === "boolean") {
      if (!verdict) return skippedBy("deleteRows", "gate-declined");
      deleteDataRows(dataRowIndexes);
      return OK;
    }
    deleteRun = run;
    const asked = { rowIdentityVersion: s.rowIdentityVersion, checked: s.selection.rows, hidden: s.hiddenCheckedRowIds };
    const changed = (now: DataGridStoreState): boolean =>
      now.readOnly || now.rowIdentityVersion !== asked.rowIdentityVersion || now.selection.rows !== asked.checked || now.hiddenCheckedRowIds !== asked.hidden;
    run.watch = changed;
    ctx.gates.hold(run);
    const finish = (): boolean => {
      ctx.gates.settle(run);
      if (deleteRun === run) deleteRun = null;
      return !run.aborted;
    };
    Promise.resolve(verdict).then(
      (confirmed) => {
        if (!finish()) return;
        if (confirmed === true && !changed(get())) deleteDataRows(dataRowIndexes);
      },
      (error: unknown) => {
        if (finish()) warnGateOnce("rejected", () => `onBeforeDeleteRows rejected, so the delete is cancelled: ${toSafeText(error)}`);
      },
    );
    return OK;
  };

  const insertDataIndex = (s: DataGridStoreState, viewRowIndex: number, position: "above" | "below"): number =>
    clampIndex(position === "above" ? (s.viewIndex[viewRowIndex] ?? s.data.length) : (s.viewIndex[viewRowIndex] ?? s.data.length - 1) + 1, s.data.length);
  const commitInsertedRows = (
    s: DataGridStoreState,
    viewRowIndex: number,
    count: number,
    position: "above" | "below",
    dataRowIndex: number,
    rows: unknown[],
  ): void => {
    const batch = computeInsertRowsBatch(s, dataRowIndex, rows);
    ctx.rowIndexCache.invalidate();
    forgetDeferredRows(ctx);
    ctx.lastEmittedData = batch.nextData;
    const view = rebuildRowOpView(s, batch.nextData);
    const editRemap = remapEditing(s, view.viewIndex!, s.visibleColumns, batch.nextData, s.getRowId);
    if (s.pageSize !== null || viewSorts(s.sortMode, s.sortState).length > 0 || viewFilters(s.filterMode, s.filterState).length > 0) {
      const followed = followActiveRow(s, batch.nextData, view.viewIndex!);
      pruneRowValidationKeys(batch.nextData, s.getRowId);
      writeThenEmit(ctx, s, batch.nextData, { source: "row-operation", ops: batch.ops }, () =>
        set({ data: batch.nextData, rowIdentityVersion: s.rowIdentityVersion + 1, cellErrors: pruneCellErrors(s.cellErrors, batch.nextData, s.getRowId), ...followed, ...view, ...keepRows(editRemap, followed.selection.rows) }),
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
  };
  const finishDuplicate = (s: DataGridStoreState, viewRowIndexes: readonly number[], copies: ReadonlyMap<number, unknown>): void => {
    const dataRowIndexes = viewRowIndexes.map((viewRow) => s.viewIndex[viewRow]).filter((i): i is number => i !== undefined);
    const batch = computeDuplicateBatch(s, dataRowIndexes, copies);
    if (!batch) return;
    ctx.rowIndexCache.invalidate();
    forgetDeferredRows(ctx);
    ctx.lastEmittedData = batch.nextData;
    const view = rebuildRowOpView(s, batch.nextData);
    const editRemap = remapEditing(s, view.viewIndex!, s.visibleColumns, batch.nextData, s.getRowId);
    if (s.pageSize !== null || viewSorts(s.sortMode, s.sortState).length > 0 || viewFilters(s.filterMode, s.filterState).length > 0) {
      const followed = followActiveRow(s, batch.nextData, view.viewIndex!);
      pruneRowValidationKeys(batch.nextData, s.getRowId);
      writeThenEmit(ctx, s, batch.nextData, { source: "row-operation", ops: batch.ops }, () =>
        set({ data: batch.nextData, rowIdentityVersion: s.rowIdentityVersion + 1, cellErrors: pruneCellErrors(s.cellErrors, batch.nextData, s.getRowId), ...followed, ...view, ...keepRows(editRemap, followed.selection.rows) }),
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
  };
  let createRun: GateRun | null = null;
  let duplicateRun: GateRun | null = null;
  const holdInsertedRows = (s: DataGridStoreState, run: GateRun, viewRowIndex: number, position: "above" | "below", rows: unknown[]): void => {
    createRun = run;
    const anchorDataIndex = s.viewIndex[viewRowIndex];
    const anchorRowId = anchorDataIndex === undefined ? null : s.getRowId(s.data[anchorDataIndex], anchorDataIndex);
    run.watch = (now, prev) =>
      now.readOnly || (anchorRowId !== null && now.data !== prev.data && ctx.rowIndexCache.resolveOne(now.data, now.getRowId, anchorRowId) === undefined);
    ctx.gates.hold(run);
    const finish = (): boolean => {
      ctx.gates.settle(run);
      if (createRun === run) createRun = null;
      return !run.aborted;
    };
    Promise.all(rows).then(
      (resolved) => {
        if (!finish()) return;
        const now = get();
        if (now.readOnly) return;
        let anchorViewRow = viewRowIndex;
        if (anchorRowId !== null) {
          const dataIndex = ctx.rowIndexCache.resolveOne(now.data, now.getRowId, anchorRowId);
          anchorViewRow = dataIndex === undefined ? -1 : viewRowOfDataIndex(now.viewIndex, dataIndex);
          if (anchorViewRow < 0) return;
        }
        commitInsertedRows(now, anchorViewRow, resolved.length, position, insertDataIndex(now, anchorViewRow, position), resolved);
      },
      (error: unknown) => {
        if (!finish()) return;
        warnGateOnce("createRow rejected", () => `createRow rejected, so the insert is cancelled: ${toSafeText(error)}`);
      },
    );
  };
  const holdDuplicateCopies = (s: DataGridStoreState, run: GateRun, copies: ReadonlyMap<number, unknown>): void => {
    duplicateRun = run;
    const sourceIds = Array.from(copies.keys(), (dataIndex) => s.getRowId(s.data[dataIndex], dataIndex));
    run.watch = (now, prev) => {
      if (now.readOnly) return true;
      if (now.data === prev.data) return false;
      const rowIndex = ctx.rowIndexCache.resolve(now.data, now.getRowId);
      return sourceIds.every((rowId) => !rowIndex.has(rowId));
    };
    ctx.gates.hold(run);
    const finish = (): boolean => {
      ctx.gates.settle(run);
      if (duplicateRun === run) duplicateRun = null;
      return !run.aborted;
    };
    Promise.all(copies.values()).then(
      (resolved) => {
        if (!finish()) return;
        const now = get();
        if (now.readOnly) return;
        const rowIndex = ctx.rowIndexCache.resolve(now.data, now.getRowId);
        const settled = new Map<number, unknown>();
        const viewRows: number[] = [];
        sourceIds.forEach((rowId, i) => {
          const dataIndex = rowIndex.get(rowId);
          const viewRow = dataIndex === undefined ? -1 : viewRowOfDataIndex(now.viewIndex, dataIndex);
          if (dataIndex === undefined || viewRow < 0) return;
          settled.set(dataIndex, resolved[i]);
          viewRows.push(viewRow);
        });
        if (viewRows.length > 0) finishDuplicate(now, viewRows, settled);
      },
      (error: unknown) => {
        if (!finish()) return;
        warnGateOnce("duplicateRow rejected", () => `duplicateRow rejected, so the duplicate is cancelled: ${toSafeText(error)}`);
      },
    );
  };
  const moveBlockedReason = (s: DataGridStoreState): RowActionSkipReason | null => {
    if (s.readOnly) return "readOnly";
    if (viewSorts(s.sortMode, s.sortState).length > 0 || viewFilters(s.filterMode, s.filterState).length > 0) {
      warnDev("reorderRows is a no-op while a sort or filter is active (the view order is owned by them)");
      return "view-ordered";
    }
    return null;
  };

  /** Positions count the rows a move plans over, like the row numbers on screen: page rows on a paged grid. */
  const announceRowMove = (s: DataGridStoreState, plan: RowMovePlan): string => {
    const { markers } = s.labels;
    const total = movableRowCount(s);
    return plan.sources.length === 1
      ? markers.reorderAnnouncement(plan.sources[0]! + 1, plan.targets[0]! + 1, total)
      : markers.reorderRowsAnnouncement(plan.sources.length, plan.targets[0]! + 1, total);
  };

  /** The rows a move plans over: the shown page on a paged grid, else every data row. */
  const movableRowCount = (s: DataGridStoreState): number => (s.pageSize === null ? s.data.length : s.viewIndex.length);

  const toDataPlan = (viewPlan: RowMovePlan, pageStart: number, count: number): RowMovePlan => {
    if (pageStart === 0 && viewPlan.newIndexOf.length === count) return viewPlan;
    const newIndexOf = new Int32Array(count);
    for (let i = 0; i < count; i++) newIndexOf[i] = i;
    viewPlan.newIndexOf.forEach((after, before) => {
      newIndexOf[before + pageStart] = after + pageStart;
    });
    const offset = (row: number) => row + pageStart;
    return { sources: viewPlan.sources.map(offset), targets: viewPlan.targets.map(offset), newIndexOf };
  };

  /** Applies a plan over view rows as one write: one `move` operation per moved row, one emit, one permutation for the selection. Unsorted and unfiltered, view rows equal data indices offset by the page start. */
  const applyRowMoves = (s: DataGridStoreState, viewPlan: RowMovePlan | null): boolean => {
    if (!viewPlan) return skippedBy("moveRows", "nothing-to-do").ok;
    const { data, getRowId } = s;
    const pageStart = pageStartOf(s.viewIndex);
    const plan = toDataPlan(viewPlan, pageStart, data.length);
    const { newIndexOf } = plan;
    for (let i = 0; i < data.length; i++) {
      // Indexed access sees sparse holes; a reorder would shift scroll mode's in-flight block bookkeeping.
      if (data[i] === undefined) {
        warnDev("reorderRows is a no-op while rows are still unloaded (scroll mode): load the range first");
        return skippedBy("moveRows", "unloaded-rows").ok;
      }
    }
    const nextData = new Array<unknown>(data.length);
    for (let i = 0; i < data.length; i++) nextData[newIndexOf[i]!] = data[i];
    const neighborId = (index: number): string | undefined => (nextData[index] === undefined ? undefined : getRowId(nextData[index], index));
    const ops = plan.sources.map<DataOp<unknown>>((from, i) => {
      const to = plan.targets[i]!;
      const beforeRowId = neighborId(to + 1);
      const afterRowId = neighborId(to - 1);
      return {
        type: "move",
        rowId: getRowId(data[from]!, from),
        row: data[from]!,
        from,
        to,
        ...(beforeRowId !== undefined && { beforeRowId }),
        ...(afterRowId !== undefined && { afterRowId }),
      };
    });
    ctx.rowIndexCache.invalidate();
    forgetDeferredRows(ctx);
    ctx.lastEmittedData = nextData;
    const editRemap = remapEditing(s, s.viewIndex, s.visibleColumns, nextData, getRowId);
    const follow = (row: number) => viewPlan.newIndexOf[row] ?? row;
    const announcement = announceRowMove(s, viewPlan);
    const movedCount = plan.sources.length;
    writeThenEmit(ctx, s, nextData, { source: "row-operation", ops }, () =>
      set({
        data: nextData,
        rowIdentityVersion: s.rowIdentityVersion + 1,
        selection: remapSelectionRows(s.selection, viewPlan.newIndexOf),
        activeCell: s.activeCell ? { ...s.activeCell, row: follow(s.activeCell.row) } : null,
        lastHighlightedRow: s.lastHighlightedRow === null ? null : follow(s.lastHighlightedRow),
        rowMoveAnnouncement: announcement,
        liveAnnouncement: nextAnnouncement(s.liveAnnouncement, "rowMove", movedCount),
        ...editRemap,
      }),
    );
    return true;
  };

  const flashApplied = (patches: readonly CellPatch[], verdict: UpdateCellsVerdict): void => {
    if (verdict.applied === 0) return;
    const state = get();
    const skipped = new Set(verdict.skipped.map((skip) => skip.patchIndex));
    const visible = new Set(state.visibleColumns.map((column) => column.id));
    const cells: CellRef[] = [];
    patches.forEach((patch, patchIndex) => {
      if (!skipped.has(patchIndex) && visible.has(patch.columnId)) cells.push({ rowId: patch.rowId, columnId: patch.columnId });
    });
    state.actions.flashCells(cells);
  };

  const updateCellsCore = (patches: Parameters<DataWriteActions["updateCells"]>[0], options?: Parameters<DataWriteActions["updateCells"]>[1], prevalidatedWarnings?: readonly CellErrorEntry[]): UpdateCellsVerdict => {
    const s = get();
    if (patches.length === 0 || (s.readOnly && (options?.source ?? "stream") !== "stream")) return { applied: 0, skipped: [], pending: false };
    if (s.readOnly && options?.source === undefined) {
      warnGateOnce("readOnly stream write", 'the grid is readOnly and this call has no source, so it defaults to source "stream" and writes anyway. Pass source: "edit" to keep the readOnly check');
    }
    if (patches.length > MAX_STREAM_PATCHES && (options?.source ?? "stream") === "stream") {
      warnGateOnce("stream patch limit", `a "stream" call takes at most ${MAX_STREAM_PATCHES} patches; the ${patches.length - MAX_STREAM_PATCHES} after them skip with reason "limit". Send smaller batches`);
      const beyond: UpdateCellsSkip[] = [];
      for (let patchIndex = MAX_STREAM_PATCHES; patchIndex < patches.length; patchIndex++) beyond.push({ patchIndex, reason: "limit" });
      const verdict = updateCellsCore(patches.slice(0, MAX_STREAM_PATCHES), options, prevalidatedWarnings);
      const withBeyond = (v: UpdateCellsVerdict): UpdateCellsVerdict => ({ ...v, skipped: [...v.skipped, ...beyond] });
      return verdict.settled ? { ...verdict, settled: verdict.settled.then(withBeyond) } : withBeyond(verdict);
    }
    const skipValidation = options?.skipValidation ?? false;

    // Re-enters with skipValidation once accepted, so the incremental view path only ever sees validated values.
    if (!skipValidation && patchesNeedAsyncCheck(s, patches)) {
      const rowIndex = ctx.rowIndexCache.resolve(s.data, s.getRowId);
      const validated = prevalidatePatches(s, patches, rowIndex);
      // Skips report indexes into the caller's `patches`, not into the accepted subset.
      const apply = ({ accepted, acceptedIndexes, rejected, warnings }: PrevalidatedPatches): UpdateCellsVerdict => {
        const invalid = rejected.map(({ patchIndex }) => ({ patchIndex, reason: "invalid" as const }));
        const verdict = accepted.length === 0 ? null : updateCellsCore(accepted, { ...options, skipValidation: true }, warnings);
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
    const batch = computeCellPatchBatch(s, patches, rowIndex, skipValidation, options?.source);
    const nextData = batch.nextData;
    if (nextData === null) {
      emitStreamRejections(patches, batch.rejected, options?.source);
      return { applied: 0, skipped: batch.skipped, pending: false };
    }
    const applied = batch.ops.reduce((n, op) => (op.type === "update" ? n + (op.cells?.length ?? 0) : n), 0);

    const reorder = resolveReorder(options?.reorder, patches, viewSorts(s.sortMode, s.sortState), viewFilters(s.filterMode, s.filterState));
    ctx.rowIndexCache.rebase(nextData);
    ctx.lastEmittedData = nextData;
    const marks = markStaleRows(ctx, s, batch.ops, batch.touchedRows, (options?.reorder ?? "defer") !== "never");
    const stale = marks.state;
    const change = { source: options?.source ?? "stream", ops: batch.ops };
    // With no cell errors, clearErrorsForOps returns the same map, so the streaming hot path pays nothing.
    const validated = applyRowValidation(s, clearErrorsForOps(s.cellErrors, batch.ops), nextData, batch.ops);
    let writtenWarnings: readonly CellErrorEntry[] = [];
    if (prevalidatedWarnings?.length) {
      const written = new Set<string>();
      for (const op of batch.ops) if (op.type === "update") for (const cell of op.cells ?? []) written.add(cellErrorKey(op.rowId, cell.columnId));
      writtenWarnings = prevalidatedWarnings.filter(({ rowId, columnId }) => written.has(cellErrorKey(rowId, columnId)));
    }
    const allWarnings = writtenWarnings.length > 0 ? [...batch.warnings, ...writtenWarnings] : batch.warnings;
    const cellErrors = allWarnings.length > 0 ? mergeCellErrors(validated, allWarnings) : validated;

    // Fast path: one set() writing `data` alone, so only touched rows re-render and view-derived state keeps its identity.
    if (reorder !== "immediate") {
      // Recorded for `"never"` too, so a later reconcile stays correct when the caller's assertion was wrong.
      rememberDeferredRows(ctx, batch.touchedRows);
      writeThenEmit(ctx, s, nextData, change, () =>
        set(
          reorder === "defer" && !s.viewStale
            ? { data: nextData, viewStale: true, cellErrors, ...stale }
            : { data: nextData, cellErrors, ...stale },
        ),
      );
      if (marks.touched && options?.reorder !== "never") ctx.reshape?.("stale");
      emitStreamRejections(patches, batch.rejected, options?.source);
      return { applied, skipped: batch.skipped, pending: false };
    }
    // A tick that cannot touch a sort or filter input leaves a settled, search-free view where it is.
    const settled = !s.viewStale && ctx.deferredRows?.size === 0 && s.searchText.trim() === "";
    if (settled && !marks.touched && patchesLeaveViewAlone(s.columns, patches, viewSorts(s.sortMode, s.sortState), viewFilters(s.filterMode, s.filterState))) {
      writeThenEmit(ctx, s, nextData, change, () => set({ data: nextData, cellErrors }));
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
        viewStale: s.staleRowIds.size > 0,
        ...stale,
        ...followView(s, viewIndex, s.visibleColumns, nextData, s.getRowId, true),
        ...computeSearchMatches(nextData, s.columns, viewIndex, s.visibleColumns, s.searchText, s.cellTypes, s.searchOptions),
      }),
    );
    if (marks.touched) requestReshape(ctx, warnDev);
    emitStreamRejections(patches, batch.rejected, options?.source);
    return { applied, skipped: batch.skipped, pending: false };
};

  const commitChangeCore = (change: DataChange<unknown>, flags?: readonly CellErrorEntry[]): void => {
    const s = get();
    if (s.readOnly && change.source !== "stream") return;
    if (change.ops.length === 0) return;
    const nextData = applyChange(s.data, change, s.getRowId);
    followStaleRows(ctx, change.ops);
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
    const cleared = clearErrorsForOps(s.cellErrors, change.ops);
    const opFlags = change.source !== UNVALIDATED_SOURCE ? warnFlagsForOps(s, change.ops) : [];
    const allFlags = flags ? [...opFlags, ...flags] : opFlags;
    const pruned = pruneCellErrors(allFlags.length > 0 ? mergeCellErrors(cleared, allFlags) : cleared, nextData, s.getRowId);
    const cellErrors = change.source !== UNVALIDATED_SOURCE ? applyRowValidation(s, pruned, nextData, rowsToValidate(change.ops)) : pruned;
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
    const base = editRemap.selection ?? followed.selection;
    writeThenEmit(ctx, s, nextData, change, () =>
      set({
        data: nextData,
        rowIdentityVersion: s.rowIdentityVersion + 1,
        cellErrors,
        ...followed,
        ...view,
        ...editRemap,
        selection: carried.rows === base.rows ? base : { ...base, rows: carried.rows },
        hiddenCheckedRowIds: withoutHiddenCheckedRows(
          carried.hiddenCheckedRowIds,
          change.ops.flatMap((op) => (op.type === "delete" ? [op.rowId] : [])),
        ),
        allMatching: carried.allMatching,
      }),
    );
  };

  const commitValueAt = (coord: ViewCoord, value: unknown, reportRejection: boolean): void => {
    const s = get();
    if (s.readOnly) return;
    const result = computeCommit(s, coord, value);
    if ("error" in result) {
      const target = reportRejection ? resolveEditTarget(s, coord) : undefined;
      if (target) emitBulkRejections("edit", [{ rowId: s.getRowId(target.row, target.dataRowIndex), columnId: target.column.id, viewRowIndex: coord.row, value, message: result.error }]);
      return;
    }
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

  };

  return {
    _commitCellEdit(value, movement, rejection) {
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
        emitAfterWrites(ctx, () => s.onEditEnd?.({ rowId: editing.rowId, columnId: editing.columnId, viewRowIndex: editing.coord.row, viewColumnIndex: editing.coord.col, result: "rejected" }));
        return;
      }
      if ("noop" in result) {
        endEditSession(editing, () =>
          set({
            editing: null,
            editingError: null,
            ...restoreSelection,
            // an `validationMode: "warn"` re-commit of the same value still lands its flag
            ...(result.warnings ? { cellErrors: mergeCellErrors(s.cellErrors, result.warnings) } : {}),
          }),
        );
        emitAfterWrites(ctx, () => s.onEditEnd?.({ rowId: editing.rowId, columnId: editing.columnId, viewRowIndex: editing.coord.row, viewColumnIndex: editing.coord.col, result: "commit" }));
        return;
      }
      ctx.rowIndexCache.rebase(result.data);
      forgetDeferredRows(ctx);
      ctx.lastEmittedData = result.data;
      const cellErrors = applyRowValidation(s, clearErrorsForOps(s.cellErrors, result.change.ops), result.data, result.change.ops);
      writeThenEmit(ctx, s, result.data, result.change, () => {
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
        // Queued inside the write, so a throwing onDataChange cannot drop it.
        emitAfterWrites(ctx, () => s.onEditEnd?.({ rowId: editing.rowId, columnId: editing.columnId, viewRowIndex: editing.coord.row, viewColumnIndex: editing.coord.col, result: "commit" }));
      });
    },
    commitCellValue(ref, value) {
      const coord = resolveRefOrWarn(ctx, get(), ref);
      if (coord) get().actions.commitCellValueAt(coord, value);
    },
    commitCellValueAt(coord, value) {
      commitValueAt(coord, value, false);
    },
    _commitActivation(coord, value) {
      commitValueAt(coord, value, true);
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
    _skipRowAction(action, reason) {
      skippedBy(action, reason);
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
    applyCellUpdates(updates, source, rejected, warnings) {
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
      const validated = applyRowValidation(s, clearErrorsForOps(s.cellErrors, batch.ops), batch.nextData, batch.ops);
      const cellErrors = warnings ? mergeCellErrors(validated, warnings) : validated;

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
      const verdict = updateCellsCore(patches, options);
      if (options?.flash) {
        if (verdict.settled) void verdict.settled.then((settled) => flashApplied(patches, settled), () => {});
        else flashApplied(patches, verdict);
      }
      return verdict;
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
    editRows(updates, options) {
      return get().actions.updateRows(updates, { ...options, source: "edit", reorder: "immediate" });
    },
    reconcileView() {
      const s = get();
      if (!s.viewStale) return;
      let stale: Pick<DataGridStoreState, "staleRowIds"> = s;
      if (s.staleRowIds.size > 0) {
        if (ctx.reshape) ctx.reshape("urgent");
        else stale = clearStaleRows(ctx);
      }
      if (s.pageSize === null && viewSorts(s.sortMode, s.sortState).length === 0 && viewFilters(s.filterMode, s.filterState).length === 0) {
        resetDeferredRows(ctx);
        set({ viewStale: stale.staleRowIds.size > 0, staleRowIds: stale.staleRowIds });
        return;
      }
      // Same incremental path an `"immediate"` batch takes, over whatever the deferred batches touched.
      const viewIndex = resolveViewIndex(s, s.data, pendingRows(ctx, []));
      resetDeferredRows(ctx);
      set({
        viewIndex,
        staleRowIds: stale.staleRowIds,
        viewStale: stale.staleRowIds.size > 0,
        ...followView(s, viewIndex, s.visibleColumns),
        ...computeSearchMatches(s.data, s.columns, viewIndex, s.visibleColumns, s.searchText, s.cellTypes, s.searchOptions),
      });
    },
    insertRow(viewRowIndex, position) {
      // single implementation path: the 1-row case of the batch action (same one undo step).
      return get().actions.insertRows(viewRowIndex, 1, position);
    },
    insertRows(viewRowIndex, count, position = "below") {
      const s = get();
      if (s.readOnly) return skippedBy("insertRows", "readOnly");
      if (!s.createRow) {
        warnGateOnce("no createRow", "row insertion is a no-op because no `createRow` prop was provided");
        return skippedBy("insertRows", "no-factory");
      }
      if (count <= 0 || !Number.isInteger(count)) {
        if (count > 0) warnGateOnce("insertRows count", `insertRows: count must be an integer (got ${count})`);
        return skippedBy("insertRows", "nothing-to-do");
      }
      if (createRun && !createRun.aborted) {
        warnGateOnce("createRow pending", "a row insert was requested while the promise of createRow is still pending, so it is ignored; the promise must settle");
        return skippedBy("insertRows", "gate-pending");
      }
      const anchor = s.viewIndex[viewRowIndex];
      if (anchor !== undefined && touchesUnloadedRow(s, [anchor], "insertRows")) return skippedBy("insertRows", "unloaded-rows");
      const dataRowIndex = insertDataIndex(s, viewRowIndex, position);
      const rows: unknown[] = [];
      const run = ctx.gates.begin("createRow");
      const gateCtx = { signal: run.signal };
      for (let i = 0; i < count; i++) rows.push(s.createRow(dataRowIndex + i, gateCtx));
      if (rows.some((row) => isThenable(row))) {
        holdInsertedRows(s, run, viewRowIndex, position, rows);
        return OK;
      }
      commitInsertedRows(s, viewRowIndex, count, position, dataRowIndex, rows);
      return OK;
    },
    deleteRowsAt(viewRowIndexes) {
      const s = get();
      return requestDelete(viewRowIndexes.map((viewRow) => s.viewIndex[viewRow]).filter((i): i is number => i !== undefined));
    },
    deleteRows(rowIds, options) {
      const s = get();
      warnViewIndexIds(ctx, rowIds, "deleteRows");
      const dataRowIndexByRowId = ctx.rowIndexCache.resolve(s.data, s.getRowId);
      if (options?.source === "stream") {
        if (rowIds.length > MAX_STREAM_PATCHES) {
          warnGateOnce("stream delete limit", `a "stream" call takes at most ${MAX_STREAM_PATCHES} patches or row ids; the ${rowIds.length - MAX_STREAM_PATCHES} after them are skipped. Send smaller batches`);
        }
        const ops: DataOp<unknown>[] = [];
        const seen = new Set<string>();
        for (let i = 0; i < Math.min(rowIds.length, MAX_STREAM_PATCHES); i++) {
          const rowId = rowIds[i]!;
          const index = dataRowIndexByRowId.get(rowId);
          const row = index === undefined ? undefined : s.data[index];
          if (index === undefined || row === undefined || seen.has(rowId)) continue;
          seen.add(rowId);
          ops.push({ type: "delete", rowId, row, index });
        }
        get().actions.commitChange({ source: "stream", ops });
        return OK;
      }
      return requestDelete(rowIds.map((rowId) => dataRowIndexByRowId.get(rowId)).filter((i): i is number => i !== undefined));
    },
    duplicateRows(rowIds) {
      const s = get();
      warnViewIndexIds(ctx, rowIds, "duplicateRows");
      const dataRowIndexByRowId = ctx.rowIndexCache.resolve(s.data, s.getRowId);
      const viewRows: number[] = [];
      for (const rowId of rowIds) {
        const dataRowIndex = dataRowIndexByRowId.get(rowId);
        const viewRow = dataRowIndex === undefined ? -1 : viewRowOfDataIndex(s.viewIndex, dataRowIndex);
        if (viewRow >= 0) viewRows.push(viewRow);
      }
      return get().actions.duplicateRowsAt(viewIndexes(viewRows));
    },
    duplicateRowsAt(viewRowIndexes) {
      const s = get();
      if (s.readOnly) return skippedBy("duplicateRows", "readOnly");
      if (!s.duplicateRow) {
        warnGateOnce("no duplicateRow", "duplicateRows is a no-op because no `duplicateRow` prop was provided");
        return skippedBy("duplicateRows", "no-factory");
      }
      if (duplicateRun && !duplicateRun.aborted) {
        warnGateOnce("duplicateRow pending", "a row duplicate was requested while the promise of duplicateRow is still pending, so it is ignored; the promise must settle");
        return skippedBy("duplicateRows", "gate-pending");
      }
      const dataRowIndexes = viewRowIndexes.map((viewRow) => s.viewIndex[viewRow]).filter((i): i is number => i !== undefined);
      if (touchesUnloadedRow(s, dataRowIndexes, "duplicateRows")) return skippedBy("duplicateRows", "unloaded-rows");
      const run = ctx.gates.begin("duplicateRow");
      const copies = startDuplicateCopies(s, dataRowIndexes, { signal: run.signal });
      if (!copies) return skippedBy("duplicateRows", "nothing-to-do");
      if (Array.from(copies.values()).some((copy) => isThenable(copy))) {
        holdDuplicateCopies(s, run, copies);
        return OK;
      }
      finishDuplicate(s, viewRowIndexes, copies);
      return OK;
    },
    reorderRows(rows, to) {
      const s = get();
      const blocked = moveBlockedReason(s);
      if (blocked) return skippedBy("moveRows", blocked).ok;
      return applyRowMoves(s, planBlockMove(movableRowCount(s), typeof rows === "number" ? [rows] : rows, to));
    },
    moveRowsBy(rows, delta) {
      const s = get();
      const blocked = moveBlockedReason(s);
      if (blocked) return skippedBy("moveRows", blocked).ok;
      return applyRowMoves(s, planShiftMove(movableRowCount(s), rows, delta));
    },
    replaceRowId(oldId, row) {
      get().actions.replaceRowIds([{ oldId, row }]);
    },
    replaceRowIds(swaps) {
      const s = get();
      if (s.readOnly || swaps.length === 0) return;
      const indexById = ctx.rowIndexCache.resolve(s.data, s.getRowId);
      const claimed = new Set<string>();
      const swappedOld = new Set<string>();
      const plan: { oldId: string; newId: string; index: number; row: unknown }[] = [];
      for (const { oldId, row } of swaps) {
        const index = indexById.get(oldId);
        if (index === undefined || swappedOld.has(oldId)) {
          warnGateOnce("replaceRowId unknown", `replaceRowId: no row has the id "${oldId}", or it is swapped twice, so that swap was skipped`);
          continue;
        }
        let newId: string;
        try {
          newId = s.getRowId(row, index);
        } catch {
          warnGateOnce("replaceRowId getRowId", "replaceRowId: getRowId threw for the new row, so that swap was skipped");
          continue;
        }
        if (newId !== oldId && (indexById.has(newId) || claimed.has(newId))) {
          warnGateOnce("replaceRowId taken", `replaceRowId: another row already has the id "${newId}", so that swap was skipped`);
          continue;
        }
        swappedOld.add(oldId);
        claimed.add(newId);
        plan.push({ oldId, newId, index, row });
      }
      if (plan.length === 0) return;
      const nextData = s.data.slice();
      for (const { index, row } of plan) nextData[index] = row;
      const renamed = plan.filter((entry) => entry.newId !== entry.oldId);
      const columnIds = s.columns.map((column) => column.id);
      let cellErrors = s.cellErrors;
      let flashingCells = s.flashingCells;
      let hiddenCheckedRowIds = s.hiddenCheckedRowIds;
      for (const { oldId, newId } of renamed) {
        for (const map of [pendingByRow, latestWriteOfRow, resolvingRows, conflictAborts] as Map<string, unknown>[]) {
          if (!map.has(oldId)) continue;
          map.set(newId, map.get(oldId));
          map.delete(oldId);
        }
        if (failedRows.delete(oldId)) failedRows.add(newId);
        const chains = refusedPrev.get(oldId);
        if (chains) {
          refusedPrev.set(newId, chains);
          refusedPrev.delete(oldId);
        }
        retargetLiveWrites(oldId, newId);
        renameRowKeys(oldId, newId);
        for (const columnId of columnIds) {
          const key = cellErrorKey(oldId, columnId);
          const message = cellErrors.get(key);
          if (message !== undefined) {
            if (cellErrors === s.cellErrors) cellErrors = new Map(cellErrors);
            (cellErrors as Map<string, string>).delete(key);
            (cellErrors as Map<string, string>).set(cellErrorKey(newId, columnId), message);
          }
          const flashKey = flashCellKey(oldId, columnId);
          if (flashingCells.has(flashKey)) {
            if (flashingCells === s.flashingCells) flashingCells = new Set(flashingCells);
            (flashingCells as Set<string>).delete(flashKey);
          }
        }
        if (hiddenCheckedRowIds.has(oldId)) {
          if (hiddenCheckedRowIds === s.hiddenCheckedRowIds) hiddenCheckedRowIds = new Set(hiddenCheckedRowIds);
          (hiddenCheckedRowIds as Set<string>).delete(oldId);
          (hiddenCheckedRowIds as Set<string>).add(newId);
        }
      }
      const editingSwap = s.editing ? renamed.find((entry) => entry.oldId === s.editing!.rowId) : undefined;
      const editing = editingSwap && s.editing ? { ...s.editing, rowId: editingSwap.newId } : s.editing;
      const change: DataChange<unknown> = { source: "id-swap", ops: plan.map(({ oldId, row, index }) => ({ type: "update" as const, rowId: oldId, row, prev: s.data[index] })) };
      ctx.rowIndexCache.invalidate();
      rememberDeferredRows(ctx, plan.map((entry) => entry.index));
      ctx.lastEmittedData = nextData;
      const swapped = plan.map(({ newId, row, index }): DataOp<unknown> => ({ type: "update", rowId: newId, row, prev: s.data[index] }));
      cellErrors = applyRowValidation(s, cellErrors, nextData, swapped);
      const touched: DataOp<unknown> = { ...swapped[0]!, cells: columnIds.map((columnId) => ({ columnId, value: undefined, prev: undefined })) } as DataOp<unknown>;
      writeThenEmit(ctx, s, nextData, change, () =>
        set({
          data: nextData,
          ...(renamed.length > 0 ? { rowIdentityVersion: s.rowIdentityVersion + 1 } : {}),
          cellErrors,
          flashingCells,
          hiddenCheckedRowIds,
          editing,
          ...reconcileAfterWrite(s, nextData, [touched]),
        }),
      );
      publishSaveStatus();
    },
    clearSaveStatus() {
      if (failedRows.size === 0) return;
      failedRows.clear();
      publishSaveStatus();
    },
    commitChange(change) {
      commitChangeCore(change);
    },
    _commitChange: commitChangeCore,
  };
}
