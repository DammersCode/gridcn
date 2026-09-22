import { createStore, type StoreApi } from "zustand/vanilla";
import type { CellCoord, CellType, DataOp } from "../types";
import { DEFAULT_KEYMAP } from "../keyboard";
import { CompactSelection } from "../selection/compact-selection";
import { getCellValue } from "../columns/column-helpers";
import { cellTypes as defaultCellTypes } from "../cell-types/cell-types";
import {
  emptySelection,
  extendTo,
  extendSelection,
  offsetSelectionForRows,
  pushRange,
  rectFromCorners,
  selectAllProgression,
  selectCell as selectCellPure,
  selectColumn as selectColumnPure,
  selectionRects,
  selectRow as selectRowPure,
  type ExtendDirection,
} from "../selection";
import {
  applyDefaultColumnLayout,
  cellErrorKey,
  clampIndex,
  clearErrorsForOps,
  columnFlag,
  computeColumnLayout,
  computeSearchMatches,
  computeVisibleColumns,
  computeViewIndex,
  defHiddenColumnIds,
  incrementalViewIndex,
  isColumnReadOnly,
  memoizedMergeLabels,
  mergeCellErrors,
  nextDirection,
  pruneCellErrors,
  reorderColumnIds,
  resolveSelectionConfig,
  sameElements,
  toggleSortAdditive,
  withFilterIds,
  EMPTY_CELL_ERRORS,
  EMPTY_OVERLAY_PLUGINS,
  EMPTY_ROW_BANDS,
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
  resolveEditTarget,
  warnDev,
} from "./commit";
import { INCREMENTAL_PATCH_LIMIT } from "../sort-filter";
import { createRowIndexCache, resolveReorder, touchesViewInputs } from "./row-index";
import type { AnyColumnDef, CellPatch, DataGridStoreState, InternalSyncProps, SyncInputs } from "./types";
import { syncInputsEqual } from "./types";

/**
 * Creates one grid's vanilla store instance. Module-private: never export this
 * factory's result or a bound hook from this module — only the hooks below.
 */
export function createDataGridStore(init: InternalSyncProps): StoreApi<DataGridStoreState> {
  const defHidden = defHiddenColumnIds(init.columns);
  const seeded = applyDefaultColumnLayout(init.columns, defHidden, init.defaultColumnLayout);
  const visibleColumns = computeVisibleColumns(seeded.columns, seeded.columnOrder, seeded.hiddenColumns);
  const mergeLabels = memoizedMergeLabels();
  // `data` wins when both are given (React value/defaultValue precedence; checkDevGuardrails warns).
  // `dataControlled` latches this decision for the store's lifetime — later renders can't flip
  // uncontrolled-to-controlled or back, matching `<input>`'s own value/defaultValue semantics.
  const dataControlled = init.data !== undefined;
  const initData: readonly unknown[] = init.data ?? init.defaultData ?? [];
  // Set on every _syncProps call (including the implicit init-time seed below) so the very first
  // real sync has something to compare against instead of special-casing "no previous sync yet".
  const initFilterState = withFilterIds(init.filterState ?? []);
  const initJoinOperator = init.joinOperator ?? "and";
  // storage widens each per-column CellType<TData, TValue, TOptions> to the untyped registry shape; narrowed back per column at lookup (cell.tsx/store's column-op helpers).
  const initCellTypes =
    (init.cellTypes as unknown as Record<string, CellType> | undefined) ?? (defaultCellTypes as unknown as Record<string, CellType>);
  let lastSyncInputs: SyncInputs = {
    data: initData,
    cellTypes: initCellTypes,
    columns: seeded.columns,
    sortState: init.sortState ?? [],
    filterState: initFilterState,
    joinOperator: initJoinOperator,
    searchText: init.searchText ?? "",
    columnOrder: seeded.columnOrder,
    hiddenColumns: seeded.hiddenColumns,
  };
  // The raw `columns` prop reference last seen by _syncProps — separate from `s.columns`, which may
  // carry runtime column-pin mutations (setColumnPin / the initial-layout seed). Only a genuine
  // change of the consumer's own prop should reset `s.columns`; re-syncing with the SAME prop
  // reference (e.g. an unrelated parent re-render) must not silently discard those pin mutations.
  let lastPropsColumns: readonly AnyColumnDef[] = init.columns;
  // `rowId -> dataIndex` for updateCells. Every path that inserts, deletes, duplicates, or replaces
  // rows invalidates it; a pure value patch never moves a row, so a streaming tick keeps it warm.
  const rowIndexCache = createRowIndexCache();
  /**
   * The last `data` array this store handed to `onDataChange`. A controlled consumer that stores it
   * and re-renders feeds that same array back through `_syncProps`; recognizing it as our own echo
   * is what keeps `computeViewIndex` off the controlled streaming path (design spec §3.3 — without
   * this the 56 ms cliff returns for every controlled consumer).
   */
  let lastEmittedData: readonly unknown[] | null = null;
  /**
   * Data indices whose values changed since `viewIndex` was last rebuilt, so `reconcileView` and the
   * next `"immediate"` batch can take the same incremental path instead of a full re-sort. `null`
   * means "no longer trackable" — the limit was passed, or a path that moves rows (insert/delete/
   * duplicate/a consumer `data` replacement) or writes values outside `updateCells` ran — and the
   * caller falls back to the full rebuild.
   */
  /**
   * Generation counter for a HELD async `updateCells` batch — the streaming surface's counterpart to
   * the per-hook `useBulkGeneration` the paste/fill/import surfaces use. Bumped by every path that
   * replaces rows or writes values outside the held batch, so a verdict that resolves against a grid
   * that has moved on is dropped instead of landing late on top of newer data.
   */
  let streamGeneration = 0;
  let deferredRows: Set<number> | null = new Set();
  const forgetDeferredRows = () => {
    streamGeneration += 1;
    deferredRows = null;
  };
  const resetDeferredRows = () => {
    streamGeneration += 1;
    deferredRows = new Set();
  };
  /** Records a non-reordering batch's rows, giving up once the set is bigger than the incremental path serves. */
  const rememberDeferredRows = (touchedRows: readonly number[]) => {
    if (!deferredRows) return;
    for (const row of touchedRows) deferredRows.add(row);
    if (deferredRows.size > INCREMENTAL_PATCH_LIMIT) forgetDeferredRows();
  };
  /** This batch's touched rows plus anything an earlier batch left unreconciled; `null` when untrackable. */
  const pendingRows = (touchedRows: readonly number[]): readonly number[] | null => {
    if (!deferredRows) return null;
    if (deferredRows.size === 0) return touchedRows;
    const union = new Set(deferredRows);
    for (const row of touchedRows) union.add(row);
    return Array.from(union);
  };
  /**
   * The next `viewIndex` for a reorder: incremental when `pending` is known and provably equivalent
   * to the rebuild, the full rebuild otherwise. Returns the PREVIOUS array identity when no row
   * moved, so a tick that changes no position re-renders nothing downstream of `viewIndex`.
   */
  const resolveViewIndex = (
    s: DataGridStoreState,
    data: readonly unknown[],
    pending: readonly number[] | null,
  ): number[] => {
    const incremental = pending
      ? incrementalViewIndex(data, s.columns, s.sortState, s.filterState, s.joinOperator, s.viewIndex, pending, s.cellTypes)
      : null;
    if (incremental) return sameElements(incremental, s.viewIndex) ? s.viewIndex : incremental;
    return computeViewIndex(data, s.columns, s.sortState, s.filterState, s.joinOperator, s.viewIndex, s.cellTypes);
  };
  /**
   * The view bookkeeping every direct write path (edit/paste/fill/delete) owes after committing
   * `nextData`, mirroring what `updateCells` does for a `"defer"` batch: `viewIndex` deliberately
   * stays put (no auto-resort), but `viewStale` has to flip so the re-sort affordance and
   * `reconcileView()` can recover, and `searchMatches` has no deferred contract at all so it is
   * recomputed in place. Both halves no-op unless a search or a view-feeding column is involved.
   */
  const reconcileAfterWrite = (
    s: DataGridStoreState,
    nextData: readonly unknown[],
    ops: readonly DataOp<unknown>[],
  ): Partial<DataGridStoreState> => {
    const written: CellPatch[] = [];
    for (const op of ops) {
      if (op.type !== "update" || !op.cells) continue;
      for (const cell of op.cells) written.push({ rowId: op.rowId, columnId: cell.columnId, value: cell.value });
    }
    const viewStale = s.viewStale || touchesViewInputs(written, s.sortState, s.filterState);
    if (s.searchText.trim() === "") return viewStale === s.viewStale ? {} : { viewStale };
    return {
      ...(viewStale === s.viewStale ? {} : { viewStale }),
      ...computeSearchMatches(nextData, s.columns, s.viewIndex, s.visibleColumns, s.searchText),
    };
  };
  // cellErrors keys owned by each row's last validateRow verdict, so a re-run clears exactly its
  // own stale messages and never a consumer's setCellErrors entries on other cells of that row.
  // Stale entries for deleted rows are harmless: their keys are already pruned, deleting is a no-op.
  const rowValidationKeys = new Map<string, string[]>();
  /**
   * Runs `validateRow` once per touched row of a committed write gesture, AFTER `clearErrorsForOps`
   * — the row in `nextData` already has every cell of the gesture applied, which is the whole
   * point: the verdict cannot depend on column order inside a paste. Returns the same map identity
   * when the prop is absent or nothing changed.
   */
  const applyRowValidation = (
    s: DataGridStoreState,
    cellErrors: ReadonlyMap<string, string>,
    nextData: readonly unknown[],
    ops: readonly DataOp<unknown>[],
  ): ReadonlyMap<string, string> => {
    const validateRow = s.validateRow;
    if (!validateRow) return cellErrors;
    const touched = new Set<string>();
    for (const op of ops) if (op.type === "update") touched.add(op.rowId);
    if (touched.size === 0) return cellErrors;
    const rowIndex = rowIndexCache.resolve(nextData, s.getRowId);
    let next: Map<string, string> | null = null;
    const ensure = () => next ?? (next = new Map(cellErrors));
    for (const rowId of touched) {
      const dataRowIndex = rowIndex.get(rowId);
      if (dataRowIndex === undefined) continue;
      const verdict = validateRow(nextData[dataRowIndex], rowId);
      const prevKeys = rowValidationKeys.get(rowId);
      if (prevKeys) for (const key of prevKeys) if ((next ?? cellErrors).has(key)) ensure().delete(key);
      const entries = verdict ? Object.entries(verdict) : [];
      if (entries.length === 0) {
        rowValidationKeys.delete(rowId);
        continue;
      }
      const keys: string[] = [];
      for (const [columnId, message] of entries) {
        const key = cellErrorKey(rowId, columnId);
        if ((next ?? cellErrors).get(key) !== message) ensure().set(key, message);
        keys.push(key);
      }
      rowValidationKeys.set(rowId, keys);
    }
    return next ?? cellErrors;
  };
  const initViewIndex = computeViewIndex(initData, seeded.columns, init.sortState ?? [], initFilterState, initJoinOperator, undefined, initCellTypes);
  return createStore<DataGridStoreState>((set, get) => ({
    ...init,
    ...resolveSelectionConfig(init),
    // storage widens each per-column CellType<TData, TValue, TOptions> to the untyped registry shape; narrowed back per column at lookup (cell.tsx/store's column-op helpers).
    cellTypes: initCellTypes,
    columns: seeded.columns,
    data: initData,
    dataControlled,
    activeCell: null,
    selection: emptySelection(),
    selectAllStage: null,
    editing: null,
    editingError: null,
    editingRejectionCount: 0,
    cellErrors: EMPTY_CELL_ERRORS,
    overlayPlugins: init.overlayPlugins ?? EMPTY_OVERLAY_PLUGINS,
    rowBands: init.rowBands ?? EMPTY_ROW_BANDS,
    lastHighlightedRow: null,
    lastHighlightedCol: null,
    columnWidths: seeded.columnWidths,
    columnOrder: seeded.columnOrder,
    hiddenColumns: seeded.hiddenColumns,
    sortState: init.sortState ?? [],
    filterState: initFilterState,
    joinOperator: initJoinOperator,
    searchText: init.searchText ?? "",
    sortControlled: init.sortState !== undefined,
    filterControlled: init.filterState !== undefined,
    joinOperatorControlled: init.joinOperator !== undefined,
    searchControlled: init.searchText !== undefined,
    ...computeSearchMatches(initData, seeded.columns, initViewIndex, visibleColumns, init.searchText ?? ""),
    viewIndex: initViewIndex,
    viewStale: false,
    visibleColumns,
    scrollToCellImpl: null,
    fillHandlers: null,
    readOnly: false,
    keymap: DEFAULT_KEYMAP,
    labels: mergeLabels(init.labels),
    actions: {
      setActiveCell(coord) {
        set({ activeCell: coord });
      },
      selectCell(coord) {
        set({ activeCell: coord, selection: selectCellPure(coord) });
      },
      extendTo(coord) {
        set((s) => {
          // enableRangeSelection: false collapses any drag/shift-extend gesture to single-cell active only.
          if (!s.enableRangeSelection) return { selection: selectCellPure(coord), activeCell: coord };
          const selection = extendTo(s.selection, coord);
          // extendTo falls back to a fresh anchor at `coord` when there was no prior selection.
          const activeCell = s.selection.current ? s.activeCell : coord;
          return { selection, activeCell };
        });
      },
      extendSelection(direction, opts) {
        // rowCount is the VIEW row count (viewIndex.length), not data.length, so growth stays
        // within the visible display order under an active filter.
        const { viewIndex, visibleColumns, selection, enableRangeSelection } = get();
        if (!enableRangeSelection) return;
        set({
          selection: extendSelection(selection, direction, {
            toEdge: opts?.toEdge,
            rowCount: viewIndex.length,
            colCount: visibleColumns.length,
          }),
        });
      },
      pushRange(coord) {
        set((s) => {
          // enableMultiRange: false makes ctrl-click behave as a plain click (no stack push).
          if (!s.enableMultiRange) return { selection: selectCellPure(coord), activeCell: coord };
          // pushRange moves the anchor to `coord`; keep activeCell in sync with it.
          return { selection: pushRange(s.selection, coord), activeCell: coord };
        });
      },
      selectRow(index, opts = {}) {
        const { lastHighlightedRow, selection, enableRowSelection, enableMultiRange, enableRangeSelection } = get();
        if (!enableRowSelection) return;
        // enableMultiRange: false demotes ctrl-click to a plain toggle-select of just this row.
        // enableRangeSelection: false demotes shift-click to a plain toggle-select too (no row range).
        const additive = opts.additive && enableMultiRange;
        const extendFromLast = opts.extendFromLast && enableRangeSelection;
        set({
          selection: selectRowPure(selection, index, { additive, extendFromLast, from: lastHighlightedRow ?? undefined }),
          lastHighlightedRow: index,
        });
      },
      selectColumn(index, opts = {}) {
        const { lastHighlightedCol, selection, enableColumnSelection, enableMultiRange, enableRangeSelection } = get();
        if (!enableColumnSelection) return;
        const additive = opts.additive && enableMultiRange;
        const extendFromLast = opts.extendFromLast && enableRangeSelection;
        set({
          selection: selectColumnPure(selection, index, { additive, extendFromLast, from: lastHighlightedCol ?? undefined }),
          lastHighlightedCol: index,
        });
      },
      selectAll() {
        const s = get();
        if (!s.enableRangeSelection) return;
        const active = s.activeCell ?? { col: 0, row: 0 };
        // stage carries over only if the last selectAll's own output (selection/activeCell identity)
        // is still exactly what's in the store now — any intervening action replaced one of them.
        const priorStage =
          s.selectAllStage &&
          s.selectAllStage.selection === s.selection &&
          s.selectAllStage.activeCell === s.activeCell
            ? s.selectAllStage.stage
            : null;
        const isEmptyAt = (coord: CellCoord): boolean => {
          const column = s.visibleColumns[coord.col];
          if (!column) return true;
          const dataRowIndex = s.viewIndex[coord.row];
          const row = dataRowIndex === undefined ? undefined : s.data[dataRowIndex];
          if (row === undefined) return true;
          const cellType = s.cellTypes[column.type ?? "text"];
          if (!cellType) return true;
          const value = getCellValue<unknown, typeof column>(row, column);
          return cellType.isEmpty(value);
        };
        const result = selectAllProgression(s.selection, s.viewIndex.length, s.visibleColumns.length, active, isEmptyAt, priorStage);
        set({ selection: result.selection, selectAllStage: { stage: result.stage, selection: result.selection, activeCell: active } });
      },
      setRowSelected(index, checked) {
        const { selection, enableRowSelection } = get();
        if (!enableRowSelection) return;
        const current = CompactSelection.fromArray(selection.rows.toArray());
        const rows = checked ? current.add(index) : current.remove(index);
        // additive membership change only — never touches the primary range/rangeStack/column channel.
        set({ selection: { ...selection, rows } });
      },
      armRowDragAnchor(index) {
        if (!get().enableRowSelection) return;
        set({ lastHighlightedRow: index });
      },
      setAllRowsSelected(checked) {
        const { selection, viewIndex, enableRowSelection } = get();
        if (!enableRowSelection) return;
        const rows = checked ? CompactSelection.fromSingleSelection([0, viewIndex.length]) : CompactSelection.empty();
        set({ selection: { ...selection, rows } });
      },
      clearSelection() {
        set({ selection: emptySelection() });
      },
      setColumnWidth(id, width) {
        set((s) => ({ columnWidths: { ...s.columnWidths, [id]: width } }));
        get().onColumnResizing?.(id, width);
      },
      commitColumnWidth(id, width) {
        const s = get();
        const columnWidths = { ...s.columnWidths, [id]: width };
        set({ columnWidths });
        s.onColumnLayoutChange?.(computeColumnLayout(s.columns, s.columnOrder, columnWidths, s.hiddenColumns));
      },
      setColumnOrder(id, targetId, position) {
        const s = get();
        if (!s.enableColumnReorder) return;
        const byId = new Map(s.columns.map((c) => [c.id, c] as const));
        if (!columnFlag(byId.get(id), "reorderable") || !columnFlag(byId.get(targetId), "reorderable")) return;
        const currentIds = s.columnOrder ?? s.columns.map((c) => c.id);
        const nextIds = reorderColumnIds(currentIds, s.columns, id, targetId, position);
        if (nextIds === currentIds) return;
        set({ columnOrder: nextIds, visibleColumns: computeVisibleColumns(s.columns, nextIds, s.hiddenColumns) });
        s.onColumnLayoutChange?.(computeColumnLayout(s.columns, nextIds, s.columnWidths, s.hiddenColumns));
      },
      setColumnPin(id, pin) {
        const s = get();
        if (!s.enableColumnPinning) return;
        const column = s.columns.find((c) => c.id === id);
        if (!column || !columnFlag(column, "pinnable")) return;
        const nextColumns = s.columns.map((c) => (c.id === id ? { ...c, pin: pin ?? undefined } : c));
        set({
          columns: nextColumns,
          visibleColumns: computeVisibleColumns(nextColumns, s.columnOrder, s.hiddenColumns),
        });
        s.onColumnLayoutChange?.(computeColumnLayout(nextColumns, s.columnOrder, s.columnWidths, s.hiddenColumns));
      },
      setColumnHidden(id, hidden) {
        const s = get();
        const current = new Set(s.hiddenColumns);
        if (hidden) current.add(id);
        else current.delete(id);
        const nextHidden = Array.from(current);
        const nextVisibleColumns = computeVisibleColumns(s.columns, s.columnOrder, nextHidden);
        const viewIndex = computeViewIndex(s.data, s.columns, s.sortState, s.filterState, s.joinOperator, s.viewIndex, s.cellTypes);
        resetDeferredRows();
        set({
          hiddenColumns: nextHidden,
          visibleColumns: nextVisibleColumns,
          viewIndex,
          viewStale: false,
          ...computeSearchMatches(s.data, s.columns, viewIndex, nextVisibleColumns, s.searchText),
        });
        s.onColumnLayoutChange?.(computeColumnLayout(s.columns, s.columnOrder, s.columnWidths, nextHidden));
      },
      toggleSort(columnId, additive) {
        const s = get();
        const existing = s.sortState.find((sort) => sort.columnId === columnId);
        const direction = nextDirection(existing?.direction);
        const sorts = additive
          ? toggleSortAdditive(s.sortState, columnId, direction)
          : direction === null
            ? []
            : [{ columnId, direction }];
        s.onSortChange?.(sorts);
        // controlled: `sortState` prop is the source of truth — _syncProps writes it once the
        // consumer's prop actually changes; a callback-ignoring consumer's grid stays fixed.
        if (s.sortControlled) return;
        set((s2) => {
          const viewIndex = computeViewIndex(s2.data, s2.columns, sorts, s2.filterState, s2.joinOperator, s2.viewIndex, s2.cellTypes);
          resetDeferredRows();
          return {
            sortState: sorts,
            viewIndex,
            viewStale: false,
            ...computeSearchMatches(s2.data, s2.columns, viewIndex, s2.visibleColumns, s2.searchText),
          };
        });
      },
      setSorts(sorts) {
        const s = get();
        s.onSortChange?.(sorts);
        if (s.sortControlled) return;
        set((s2) => {
          const viewIndex = computeViewIndex(s2.data, s2.columns, sorts, s2.filterState, s2.joinOperator, s2.viewIndex, s2.cellTypes);
          resetDeferredRows();
          return {
            sortState: sorts,
            viewIndex,
            viewStale: false,
            ...computeSearchMatches(s2.data, s2.columns, viewIndex, s2.visibleColumns, s2.searchText),
          };
        });
      },
      setFilters(filters) {
        const s = get();
        // backfills a filterId for any row the caller added without one (e.g. hand-built controlled updates).
        const withIds = withFilterIds(filters);
        s.onFilterChange?.(withIds);
        if (s.filterControlled) return;
        set((s2) => {
          const viewIndex = computeViewIndex(s2.data, s2.columns, s2.sortState, withIds, s2.joinOperator, s2.viewIndex, s2.cellTypes);
          resetDeferredRows();
          return {
            filterState: withIds,
            viewIndex,
            viewStale: false,
            ...computeSearchMatches(s2.data, s2.columns, viewIndex, s2.visibleColumns, s2.searchText),
          };
        });
      },
      setJoinOperator(joinOperator) {
        const s = get();
        s.onJoinOperatorChange?.(joinOperator);
        if (s.joinOperatorControlled) return;
        set((s2) => {
          const viewIndex = computeViewIndex(s2.data, s2.columns, s2.sortState, s2.filterState, joinOperator, s2.viewIndex, s2.cellTypes);
          resetDeferredRows();
          return {
            joinOperator,
            viewIndex,
            viewStale: false,
            ...computeSearchMatches(s2.data, s2.columns, viewIndex, s2.visibleColumns, s2.searchText),
          };
        });
      },
      setSearch(text) {
        const s = get();
        s.onSearchTextChange?.(text);
        if (s.searchControlled) return;
        // viewIndex is untouched: quick-search highlights + navigates, it never filters.
        set((s2) => ({ searchText: text, ...computeSearchMatches(s2.data, s2.columns, s2.viewIndex, s2.visibleColumns, text) }));
      },
      startEditing(coord, initialText) {
        const s = get();
        const target = resolveEditTarget(s, coord);
        if (!target || isColumnReadOnly(target.column, target.row)) return;
        set({ editing: { coord, initialText }, editingError: null, editingRejectionCount: 0, activeCell: coord });
      },
      cancelEditing() {
        set({ editing: null, editingError: null });
      },
      commitCellEdit(value, movement, rejection) {
        const s = get();
        const editing = s.editing;
        if (!editing) return;
        const maxRow = Math.max(0, s.viewIndex.length - 1);
        const maxCol = Math.max(0, s.visibleColumns.length - 1);
        const nextActiveCell = movement
          ? {
              col: clampIndex(editing.coord.col + movement.dx, maxCol),
              row: clampIndex(editing.coord.row + movement.dy, maxRow),
            }
          : editing.coord;

        const result = computeCommit(s, editing.coord, value, rejection);
        if ("error" in result) {
          set({ editingError: result.error, editingRejectionCount: s.editingRejectionCount + 1 });
          return;
        }
        if ("noop" in result) {
          set({
            editing: null,
            editingError: null,
            activeCell: nextActiveCell,
            selection: selectCellPure(nextActiveCell),
            // an `onInvalid: "warn"` re-commit of the same value still lands its flag
            ...(result.warnings ? { cellErrors: mergeCellErrors(s.cellErrors, result.warnings) } : {}),
          });
          return;
        }
        rowIndexCache.rebase(result.data);
        forgetDeferredRows();
        lastEmittedData = result.data;
        s.onDataChange?.(result.data, result.change);
        const cellErrors = applyRowValidation(s, clearErrorsForOps(s.cellErrors, result.change.ops), result.data, result.change.ops);
        set({
          data: result.data,
          editing: null,
          editingError: null,
          // warn rejections commit AND flag — merged after the auto-clear + validateRow verdict so the freshest signal wins
          cellErrors: result.warnings ? mergeCellErrors(cellErrors, result.warnings) : cellErrors,
          activeCell: nextActiveCell,
          selection: selectCellPure(nextActiveCell),
          ...reconcileAfterWrite(s, result.data, result.change.ops),
        });
      },
      commitCellValue(coord, value) {
        const s = get();
        const result = computeCommit(s, coord, value);
        if ("error" in result) return;
        if ("noop" in result) {
          if (result.warnings) set({ cellErrors: mergeCellErrors(s.cellErrors, result.warnings) });
          return;
        }
        rowIndexCache.rebase(result.data);
        forgetDeferredRows();
        lastEmittedData = result.data;
        s.onDataChange?.(result.data, result.change);
        const cellErrors = applyRowValidation(s, clearErrorsForOps(s.cellErrors, result.change.ops), result.data, result.change.ops);
        set({
          data: result.data,
          cellErrors: result.warnings ? mergeCellErrors(cellErrors, result.warnings) : cellErrors,
          ...reconcileAfterWrite(s, result.data, result.change.ops),
        });
      },
      setEditingError(message) {
        const s = get();
        if (!s.editing) return;
        set({ editingError: message, editingRejectionCount: s.editingRejectionCount + 1 });
      },
      setCellErrors(errors) {
        if (errors.length === 0) return;
        set({ cellErrors: mergeCellErrors(get().cellErrors, errors) });
      },
      clearCellErrors(targets) {
        const s = get();
        if (s.cellErrors.size === 0) return;
        if (!targets) {
          set({ cellErrors: EMPTY_CELL_ERRORS });
          return;
        }
        if (targets.length === 0) return;
        const next = new Map(s.cellErrors);
        let changed = false;
        for (const target of targets) {
          if (next.delete(cellErrorKey(target.rowId, target.columnId))) changed = true;
        }
        if (changed) set({ cellErrors: next });
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
        const writes: { viewRow: number; columnId: string; value: unknown }[] = [];
        for (const rect of rects) {
          for (let viewRow = rect.y; viewRow < rect.y + rect.height; viewRow++) {
            for (let col = rect.x; col < rect.x + rect.width; col++) {
              const resolved = resolvedCols[col];
              if (!resolved) continue;
              writes.push({ viewRow, columnId: resolved.columnId, value: resolved.value });
            }
          }
        }

        const batch = computeRowEditsBatch(s, writes);
        if (!batch) return;
        rowIndexCache.rebase(batch.nextData);
        forgetDeferredRows();
        lastEmittedData = batch.nextData;
        s.onDataChange?.(batch.nextData, { source: "delete", ops: batch.ops });
        set({
          data: batch.nextData,
          cellErrors: applyRowValidation(s, clearErrorsForOps(s.cellErrors, batch.ops), batch.nextData, batch.ops),
          ...reconcileAfterWrite(s, batch.nextData, batch.ops),
        });
      },
      applyCellUpdates(updates, source) {
        const s = get();
        if (s.readOnly || updates.length === 0) return;
        const batch = computeRowEditsBatch(s, updates);
        if (!batch) return;
        rowIndexCache.rebase(batch.nextData);
        forgetDeferredRows();
        lastEmittedData = batch.nextData;
        s.onDataChange?.(batch.nextData, { source, ops: batch.ops });
        const cellErrors = applyRowValidation(s, clearErrorsForOps(s.cellErrors, batch.ops), batch.nextData, batch.ops);

        // move selection to cover the touched view rect (paste's anchored-expand result).
        let minRow = Infinity, maxRow = -Infinity, minCol = Infinity, maxCol = -Infinity;
        const idByCol = new Map(s.visibleColumns.map((c, i) => [c.id, i] as const));
        for (const u of updates) {
          const col = idByCol.get(u.columnId);
          if (col === undefined) continue;
          minRow = Math.min(minRow, u.viewRow);
          maxRow = Math.max(maxRow, u.viewRow);
          minCol = Math.min(minCol, col);
          maxCol = Math.max(maxCol, col);
        }
        if (minRow === Infinity) {
          set({ data: batch.nextData, cellErrors, ...reconcileAfterWrite(s, batch.nextData, batch.ops) });
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
      },
      updateCells(patches, options) {
        const s = get();
        if (s.readOnly || patches.length === 0) return;
        const skipValidation = options?.skipValidation ?? false;

        // Re-enters with skipValidation once accepted, so the incremental view path only ever sees validated values.
        if (!skipValidation && patchesNeedAsyncCheck(s, patches)) {
          const rowIndex = rowIndexCache.resolve(s.data, s.getRowId);
          const validated = prevalidatePatches(s, patches, rowIndex);
          const apply = (accepted: CellPatch[]) => {
            if (accepted.length === 0) return;
            get().actions.updateCells(accepted, { ...options, skipValidation: true });
          };
          if (validated instanceof Promise) {
            const token = ++streamGeneration;
            void validated.then((accepted) => {
              // A newer updateCells, or any path that moved rows, supersedes this batch silently.
              if (streamGeneration !== token) return;
              apply(accepted);
            });
          } else {
            apply(validated);
          }
          return;
        }

        const rowIndex = rowIndexCache.resolve(s.data, s.getRowId);
        const batch = computeCellPatchBatch(s, patches, rowIndex, skipValidation);
        if (!batch) return;

        const reorder = resolveReorder(options?.reorder, patches, s.sortState, s.filterState);
        rowIndexCache.rebase(batch.nextData);
        lastEmittedData = batch.nextData;
        s.onDataChange?.(batch.nextData, { source: options?.source ?? "stream", ops: batch.ops });
        // clearErrorsForOps returns the SAME map identity when `s.cellErrors` is empty (the common
        // streaming case), so this costs nothing extra on the hot path this action exists for.
        const cellErrors = applyRowValidation(s, clearErrorsForOps(s.cellErrors, batch.ops), batch.nextData, batch.ops);

        // The fast path, and the whole point of the action: one set() writing `data` alone. Row
        // identities changed only for touched rows, so their per-row subscriptions re-render and
        // every other row's memo holds. viewIndex/searchMatches/visibleColumns keep their identity,
        // so no comparator downstream of them re-runs.
        if (reorder !== "immediate") {
          // Recorded for `"never"` too: that mode is a caller ASSERTION that no touched column feeds
          // the view, and a later reconcile has to stay correct even when the assertion was wrong.
          rememberDeferredRows(batch.touchedRows);
          set(
            reorder === "defer" && !s.viewStale
              ? { data: batch.nextData, viewStale: true, cellErrors }
              : { data: batch.nextData, cellErrors },
          );
          return;
        }
        // Incremental maintenance: a full rebuild re-sorts all n rows every tick, and a patch of a
        // few rows can only move those rows. Rows an earlier non-reordering batch left unreconciled
        // move in this pass too, since the rest of the order is what the binary search trusts.
        const viewIndex = resolveViewIndex(s, batch.nextData, pendingRows(batch.touchedRows));
        resetDeferredRows();
        set({
          data: batch.nextData,
          cellErrors,
          viewIndex,
          viewStale: false,
          ...computeSearchMatches(batch.nextData, s.columns, viewIndex, s.visibleColumns, s.searchText),
        });
      },
      updateRows(updates, options) {
        if (updates.length === 0) return;
        const patches: CellPatch[] = [];
        for (const update of updates) {
          for (const columnId of Object.keys(update.changes)) {
            patches.push({ rowId: update.rowId, columnId, value: update.changes[columnId] });
          }
        }
        get().actions.updateCells(patches, options);
      },
      reconcileView() {
        const s = get();
        if (!s.viewStale) return;
        // Same incremental path an `"immediate"` batch takes, over whatever the deferred batches touched.
        const viewIndex = resolveViewIndex(s, s.data, pendingRows([]));
        resetDeferredRows();
        set({
          viewIndex,
          viewStale: false,
          ...computeSearchMatches(s.data, s.columns, viewIndex, s.visibleColumns, s.searchText),
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
        rowIndexCache.invalidate();
        forgetDeferredRows();
        lastEmittedData = batch.nextData;
        s.onDataChange?.(batch.nextData, { source: "row-op", ops: batch.ops });
        // the new rows land at this view index (absent a resort); shift selection/activeCell to follow them.
        const viewInsertAt = position === "above" ? viewRowIndex : viewRowIndex + 1;
        set({
          data: batch.nextData,
          cellErrors: pruneCellErrors(s.cellErrors, batch.nextData, s.getRowId),
          selection: offsetSelectionForRows(s.selection, viewInsertAt, count),
          activeCell: s.activeCell && s.activeCell.row >= viewInsertAt
            ? { ...s.activeCell, row: s.activeCell.row + count }
            : s.activeCell,
        });
      },
      deleteRows(viewRowIndexes) {
        const s = get();
        if (s.readOnly) return;
        const dataRowIndexes = viewRowIndexes.map((viewRow) => s.viewIndex[viewRow]).filter((i): i is number => i !== undefined);
        const batch = computeDeleteBatch(s, dataRowIndexes);
        if (!batch) return;
        rowIndexCache.invalidate();
        forgetDeferredRows();
        lastEmittedData = batch.nextData;
        s.onDataChange?.(batch.nextData, { source: "row-op", ops: batch.ops });
        set({
          data: batch.nextData,
          cellErrors: pruneCellErrors(s.cellErrors, batch.nextData, s.getRowId),
          selection: emptySelection(),
          activeCell: null,
        });
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
        rowIndexCache.invalidate();
        forgetDeferredRows();
        lastEmittedData = batch.nextData;
        s.onDataChange?.(batch.nextData, { source: "row-op", ops: batch.ops });
        // each duplicate lands directly after its source view row (absent a resort); fold one
        // offset per source, ascending, so earlier insertions shift later sources' view indices too.
        const uniqueAscendingViewRows = Array.from(new Set(viewRowIndexes)).sort((a, b) => a - b);
        let selection = s.selection;
        let activeCell = s.activeCell;
        uniqueAscendingViewRows.forEach((viewRow, i) => {
          const insertAt = viewRow + 1 + i;
          selection = offsetSelectionForRows(selection, insertAt, 1);
          if (activeCell && activeCell.row >= insertAt) activeCell = { ...activeCell, row: activeCell.row + 1 };
        });
        set({ data: batch.nextData, cellErrors: pruneCellErrors(s.cellErrors, batch.nextData, s.getRowId), selection, activeCell });
      },
      _moveActiveCell(d, opts) {
        const s = get();
        const active = s.activeCell ?? { col: 0, row: 0 };
        const maxRow = Math.max(0, s.viewIndex.length - 1);
        const maxCol = Math.max(0, s.visibleColumns.length - 1);
        if (opts?.extend && s.enableRangeSelection) {
          // Grow from the anchor's far edge (Excel-correct contraction), never re-deriving
          // `next` from activeCell — the anchor stays put for the whole extend gesture.
          const direction: ExtendDirection = d.dy < 0 ? "up" : d.dy > 0 ? "down" : d.dx < 0 ? "left" : "right";
          const selection = extendSelection(s.selection.current ? s.selection : selectCellPure(active), direction, {
            rowCount: s.viewIndex.length,
            colCount: s.visibleColumns.length,
          });
          const edge = selection.current?.range;
          set({
            selection,
            lastHighlightedRow: edge ? (d.dy < 0 ? edge.y : edge.y + edge.height - 1) : active.row,
            lastHighlightedCol: edge ? (d.dx < 0 ? edge.x : edge.x + edge.width - 1) : active.col,
          });
        } else {
          const next = { col: clampIndex(active.col + d.dx, maxCol), row: clampIndex(active.row + d.dy, maxRow) };
          if (opts?.retain) {
            set({ activeCell: next, lastHighlightedRow: next.row, lastHighlightedCol: next.col });
          } else {
            set({ activeCell: next, selection: selectCellPure(next), lastHighlightedRow: next.row, lastHighlightedCol: next.col });
          }
        }
      },
      _syncProps(props) {
        set((s) => {
          // controlled sort/filter/join/search: the prop (when defined) is the source of truth this
          // sync writes into the store; uncontrolled: keep whatever the store's own actions last set.
          const nextSortState = props.sortState ?? s.sortState;
          // backfill: a controlled filterState prop may omit filterId (backward-compat input boundary).
          const nextFilterState = props.filterState ? withFilterIds(props.filterState) : s.filterState;
          const nextJoinOperator = props.joinOperator ?? s.joinOperator;
          const nextSearchText = props.searchText ?? s.searchText;
          // data: controlled (props.data defined) mirrors the prop every sync, byte-identical to
          // pre-defaultData behavior; uncontrolled keeps the store's own array — every commit action
          // (edit/paste/fill/delete/row-ops) already wrote it there directly, and `defaultData` itself
          // is init-only (never re-read past store creation, matching `<input defaultValue>`).
          const nextData = s.dataControlled && props.data !== undefined ? props.data : s.data;
          // Echo detection: a controlled consumer that stores what onDataChange handed it and
          // re-renders feeds that exact array back here. `data` then differs from the last sync by
          // identity, so syncInputsEqual fails and computeViewIndex runs — the ~56 ms cliff at 100k
          // rows with a sort active. Recognizing our own array skips it, which is what makes
          // updateCells fast for controlled consumers too (design spec §3.3). A consumer who maps,
          // filters, or otherwise rebuilds the array before storing it falls back to the slow path.
          const isEcho = nextData === lastEmittedData;
          // A `data` array we did not produce reordered or replaced rows as far as this store knows,
          // so the id map must be rebuilt. Our own echo never moved a row (updateCells patches
          // values in place), so it keeps the map — rebuilding it per tick is the O(n) cost the API
          // exists to remove.
          // A genuine consumer-driven replacement (not our own echo) may have dropped rows (e.g. an
          // import replacing the whole array) — prune any cellErrors entry whose rowId no longer
          // exists, same discipline as the rowId-index cache invalidation right below.
          const nextCellErrors =
            nextData !== s.data && !isEcho ? pruneCellErrors(s.cellErrors, nextData, s.getRowId) : s.cellErrors;
          if (nextData !== s.data && !isEcho) {
            rowIndexCache.invalidate();
            forgetDeferredRows();
          }
          // A genuine consumer-driven `columns` prop change replaces `s.columns` outright; syncing
          // again with the SAME prop reference (any unrelated re-render) keeps `s.columns` as-is so
          // runtime column-pin mutations (setColumnPin / the initial-layout seed) survive it.
          const propsColumnsChanged = props.columns !== lastPropsColumns;
          lastPropsColumns = props.columns;
          const nextColumns = propsColumnsChanged ? props.columns : s.columns;
          // same registry-widening cast as createDataGridStore's init — see that comment.
          const nextCellTypes =
            (props.cellTypes as unknown as Record<string, CellType> | undefined) ?? (defaultCellTypes as unknown as Record<string, CellType>);
          const nextSyncInputs: SyncInputs = {
            data: nextData,
            cellTypes: nextCellTypes,
            columns: nextColumns,
            sortState: nextSortState,
            filterState: nextFilterState,
            joinOperator: nextJoinOperator,
            searchText: nextSearchText,
            columnOrder: s.columnOrder,
            hiddenColumns: s.hiddenColumns,
          };
          // An echo only licenses skipping the recompute when `data` is the ONLY input that moved —
          // a sync that also changed sort/filter/search/columns still has to rebuild for those.
          const echoOnly =
            isEcho && syncInputsEqual({ ...nextSyncInputs, data: lastSyncInputs.data }, lastSyncInputs);
          const unchanged = syncInputsEqual(nextSyncInputs, lastSyncInputs) || echoOnly;
          lastSyncInputs = nextSyncInputs;

          const nextVisibleColumns = unchanged ? s.visibleColumns : computeVisibleColumns(nextColumns, s.columnOrder, s.hiddenColumns);
          const nextViewIndex = unchanged
            ? s.viewIndex
            : computeViewIndex(nextData, nextColumns, nextSortState, nextFilterState, nextJoinOperator, s.viewIndex, nextCellTypes);
          // A full rebuild leaves nothing pending for the incremental path to replay.
          if (!unchanged) resetDeferredRows();
          // If viewIndex is unchanged (same reference either from the guard above or from
          // computeViewIndex's own content-equality reuse), no row fell out of view, so this
          // clamp is a no-op — filtering against nextViewIndex.length still runs but keeps every row.
          const rows = s.selection.rows.length === 0
            ? s.selection.rows
            : CompactSelection.fromArray(s.selection.rows.toArray().filter((row) => row < nextViewIndex.length));
          return {
            ...props,
            ...resolveSelectionConfig(props),
            data: nextData,
            cellErrors: nextCellErrors,
            columns: nextColumns,
            cellTypes: nextCellTypes,
            labels: mergeLabels(props.labels),
            overlayPlugins: props.overlayPlugins ?? EMPTY_OVERLAY_PLUGINS,
            rowBands: props.rowBands ?? EMPTY_ROW_BANDS,
            visibleColumns: nextVisibleColumns,
            sortState: nextSortState,
            filterState: nextFilterState,
            joinOperator: nextJoinOperator,
            searchText: nextSearchText,
            sortControlled: props.sortState !== undefined,
            filterControlled: props.filterState !== undefined,
            joinOperatorControlled: props.joinOperator !== undefined,
            searchControlled: props.searchText !== undefined,
            viewIndex: nextViewIndex,
            // A real recompute reconciles whatever a deferred updateCells left stale; an echo or an
            // unchanged sync recomputed nothing, so the flag has to survive it.
            viewStale: unchanged ? s.viewStale : false,
            ...(unchanged
              ? { searchMatches: s.searchMatches, searchMatchSet: s.searchMatchSet, searchMatchRows: s.searchMatchRows, searchMatchesCapped: s.searchMatchesCapped }
              : computeSearchMatches(nextData, nextColumns, nextViewIndex, nextVisibleColumns, nextSearchText)),
            selection: rows === s.selection.rows ? s.selection : { ...s.selection, rows },
          };
        });
      },
      _registerScrollToCell(impl) {
        set({ scrollToCellImpl: impl });
      },
      _registerReadOnly(readOnly) {
        set({ readOnly });
      },
      _registerKeymap(keymap) {
        set({ keymap });
      },
      _registerFillHandlers(handlers) {
        set({ fillHandlers: handlers });
      },
    },
  }));
}
