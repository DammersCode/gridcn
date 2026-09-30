import { createStore, type StoreApi } from "zustand/vanilla";
import type { ViewCoord, CellType, DataOp, FilterSpec } from "../types";
import { DEFAULT_KEYMAP } from "../keyboard";
import { CompactSelection } from "../selection/compact-selection";
import { getCellValue } from "../columns/column-helpers";
import { clampColumnWidth } from "../columns/resolve-column-width";
import { cellTypes as defaultCellTypes } from "../cell-types/cell-types";
import {
  emptySelection,
  extendTo,
  extendSelection,
  pushRange,
  selectAllProgression,
  selectCell as selectCellPure,
  selectColumn as selectColumnPure,
  selectRow as selectRowPure,
  type ExtendDirection,
} from "../selection";
import {
  applyDefaultColumnLayout,
  cellErrorKey,
  clampIndex,
  columnFlag,
  computeColumnLayout,
  computeSearchMatches,
  computeVisibleColumns,
  computeViewIndex,
  defHiddenColumnIds,
  isColumnReadOnly,
  memoizedMergeLabels,
  mergeCellErrors,
  nextDirection,
  pruneCellErrors,
  reorderColumnIds,
  resolveSelectionConfig,
  toggleSortAdditive,
  withFilterIds,
  EMPTY_CELL_ERRORS,
  EMPTY_FLASHING_CELLS,
  EMPTY_OVERLAY_PLUGINS,
  EMPTY_ROW_BANDS,
} from "./compute";
import { resolveEditTarget, warnDev } from "./commit";
import { createDataWriteActions, createDataWriteContext, forgetDeferredRows, resetDeferredRows, resolveRefOrWarn } from "./data-write";
import { createRowIndexCache } from "./row-index";
import type { AnyColumnDef, DataGridStoreState, InternalSyncProps, SyncInputs } from "./types";
import { syncInputsEqual } from "./types";

/**
 * Resolves the `cellTypes` prop against the built-ins: entries merge OVER the built-ins, and a
 * `null` entry removes a built-in (or a previously provided type). Built-ins stay available when
 * the consumer provides only custom types.
 */
function resolveCellTypes(provided: Record<string, CellType | null> | undefined): Record<string, CellType> {
  if (provided === undefined) return defaultCellTypes as unknown as Record<string, CellType>;
  const out: Record<string, CellType> = { ...(defaultCellTypes as unknown as Record<string, CellType>) };
  for (const [key, value] of Object.entries(provided)) {
    if (value === null) delete out[key];
    else out[key] = value;
  }
  return out;
}

type ProvidedCellTypes = Record<string, CellType | null> | undefined;

/** True when both `cellTypes` props hold the same keys with `===` entries (an inline literal re-created per render). */
function sameCellTypeEntries(a: ProvidedCellTypes, b: ProvidedCellTypes): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => key in b && a[key] === b[key]);
}

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
  const initCellTypes = resolveCellTypes(init.cellTypes as unknown as ProvidedCellTypes);
  // A new registry identity is a sync-input change: reuse the resolved one while the prop's entries are unchanged.
  let lastPropsCellTypes = init.cellTypes as unknown as ProvidedCellTypes;
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
  // The raw `filterState` prop reference last seen by _syncProps — a same-reference re-sync reuses the
  // store's already-backfilled array instead of re-running withFilterIds (which would mint fresh ids
  // for id-less filters and churn the sync input every render). Mirrors lastPropsColumns.
  let lastPropsFilterState: FilterSpec[] | undefined = init.filterState;
  // A `commands` entry named after a built-in action silently disables the built-in — warn once about it.
  let warnedCommandShadow = false;
  // `rowId -> dataIndex` for updateCells. Every path that inserts, deletes, duplicates, or replaces
  // rows invalidates it; a pure value patch never moves a row, so a streaming tick keeps it warm.
  const rowIndexCache = createRowIndexCache();
  /** Per-key auto-clear timers for `flashCells`; a re-flash of a live key clears its old timer so the pulse restarts. */
  const flashTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // The data-write cluster's streaming bookkeeping (see data-write.ts) — the write actions and _syncProps share it by reference.
  const dataWrite = createDataWriteContext(rowIndexCache);

  /**
   * Owe after every viewIndex/visibleColumns rebuild: re-anchor an open edit to the new view
   * position of its rowId/columnId (the draft survives the move), and move `activeCell` with it
   * when it sat on the edit cell. When the row or column left the view, cancel — the typed value
   * is dropped, never written into a hidden row. Keeps object identity when nothing moved.
   * `data` must be the array `viewIndex` indexes; a consumer swap passes the incoming array.
   */
  const remapEditing = (
    s: DataGridStoreState,
    viewIndex: readonly number[],
    visibleColumns: readonly AnyColumnDef[],
    data: readonly unknown[] = s.data,
    getRowId: (row: unknown, index: number) => string = s.getRowId,
  ): Partial<DataGridStoreState> => {
    const editing = s.editing;
    if (!editing) return {};
    const dataRowIndex = rowIndexCache.resolve(data, getRowId).get(editing.rowId);
    const viewRow = dataRowIndex === undefined ? -1 : viewIndex.indexOf(dataRowIndex);
    const viewCol = visibleColumns.findIndex((column) => column.id === editing.columnId);
    const onEditCell =
      s.activeCell !== null && s.activeCell.row === editing.coord.row && s.activeCell.col === editing.coord.col;
    if (viewRow === -1 || viewCol === -1) {
      return {
        editing: null,
        editingError: null,
        ...(onEditCell ? { activeCell: null } : {}),
      };
    }
    if (viewRow === editing.coord.row && viewCol === editing.coord.col) return {};
    return {
      editing: { ...editing, coord: { col: viewCol, row: viewRow } },
      ...(onEditCell ? { activeCell: { col: viewCol, row: viewRow } } : {}),
    };
  };
  // cellErrors keys owned by each row's last validateRow verdict, so a re-run clears exactly its
  // own stale messages and never a consumer's setCellErrors entries on other cells of that row.
  // Stale entries for deleted rows are harmless: their keys are already pruned, deleting is a no-op.
  const rowValidationKeys = new Map<string, string[]>();
  // Pruned wherever cellErrors is pruned: an unpruned entry for a deleted rowId lets the next
  // validateRow wipe a reused row's consumer setCellErrors entries.
  const pruneRowValidationKeys = (data: readonly unknown[], getRowId: (row: unknown, index: number) => string): void => {
    if (rowValidationKeys.size === 0) return;
    const live = new Set<string>();
    for (let i = 0; i < data.length; i++) live.add(getRowId(data[i], i));
    for (const rowId of rowValidationKeys.keys()) if (!live.has(rowId)) rowValidationKeys.delete(rowId);
  };
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
  // View-space presence entries pin to a display position a row move invalidates (rowId-native
  // entries track their rows and never trip this): warn once when a row-moving op runs while one
  // is active. The predicate is registered by the `data-grid-presence` add-on; null when absent.
  let warnedPresenceReorder = false;
  const warnViewSpacePresenceStale = (s: DataGridStoreState) => {
    if (warnedPresenceReorder || !s.presenceViewSpaceActive?.()) return;
    warnedPresenceReorder = true;
    warnDev("rows moved while a view-space presence entry is active — its highlight position is now stale; use rowId-native presence entries for a live feed");
  };
  // The session whose end commit/cancel report themselves; the edit-end subscription skips it.
  let selfReportedSession: DataGridStoreState["editing"] = null;
  let editSessionCount = 0;
  const endEditSession = (session: NonNullable<DataGridStoreState["editing"]>, write: () => void): void => {
    selfReportedSession = session;
    try {
      write();
    } finally {
      selfReportedSession = null;
    }
  };
  const initViewIndex = computeViewIndex(initData, seeded.columns, init.sortState ?? [], initFilterState, initJoinOperator, undefined, initCellTypes);
  return createStore<DataGridStoreState>((set, get, api) => ({
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
    flashingCells: EMPTY_FLASHING_CELLS,
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
    ...computeSearchMatches(initData, seeded.columns, initViewIndex, visibleColumns, init.searchText ?? "", initCellTypes),
    viewIndex: initViewIndex,
    rowIdentityVersion: 0,
    viewStale: false,
    visibleColumns,
    scrollToCellImpl: null,
    dataWrite,
    fillHandlers: null,
    presenceViewSpaceActive: null,
    readOnly: false,
    keymap: DEFAULT_KEYMAP,
    commands: init.commands ?? null,
    labels: mergeLabels(init.labels),
    actions: {
      setActiveCell(ref) {
        if (ref === null) {
          set({ activeCell: null });
          return;
        }
        const coord = resolveRefOrWarn(dataWrite, get(), ref);
        if (coord) set({ activeCell: coord });
      },
      setActiveCellAt(coord) {
        set({ activeCell: coord });
      },
      selectCell(ref) {
        const coord = resolveRefOrWarn(dataWrite, get(), ref);
        if (coord) set({ activeCell: coord, selection: selectCellPure(coord) });
      },
      selectCellAt(coord) {
        set({ activeCell: coord, selection: selectCellPure(coord) });
      },
      extendTo(ref) {
        const coord = resolveRefOrWarn(dataWrite, get(), ref);
        if (coord) get().actions.extendToAt(coord);
      },
      extendToAt(coord) {
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
      pushRange(ref) {
        const coord = resolveRefOrWarn(dataWrite, get(), ref);
        if (coord) get().actions.pushRangeAt(coord);
      },
      pushRangeAt(coord) {
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
        const replaceFromLast = opts.replaceFromLast && enableRangeSelection;
        const next = selectRowPure(selection, index, {
          additive,
          extendFromLast,
          replaceFromLast,
          from: opts.from ?? lastHighlightedRow ?? undefined,
        });
        // a stationary marker drag re-fires the same span: skip the set so selection identity
        // (and onSelectionChange) stays quiet — line-ops always build new channel objects, so
        // content equality is the check, not identity.
        if (
          next.rows.equals(selection.rows) &&
          next.columns.equals(selection.columns) &&
          next.current === selection.current &&
          lastHighlightedRow === index
        )
          return;
        set({ selection: next, lastHighlightedRow: index });
      },
      selectColumn(index, opts = {}) {
        const { lastHighlightedCol, selection, enableColumnSelection, enableMultiRange, enableRangeSelection } = get();
        if (!enableColumnSelection) return;
        const additive = opts.additive && enableMultiRange;
        const extendFromLast = opts.extendFromLast && enableRangeSelection;
        const next = selectColumnPure(selection, index, { additive, extendFromLast, from: lastHighlightedCol ?? undefined });
        if (
          next.columns.equals(selection.columns) &&
          next.rows.equals(selection.rows) &&
          next.current === selection.current &&
          lastHighlightedCol === index
        )
          return;
        set({ selection: next, lastHighlightedCol: index });
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
        const isEmptyAt = (coord: ViewCoord): boolean => {
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
        const column = get().columns.find((c) => c.id === id);
        const next = column ? clampColumnWidth(column, width) : width;
        set((s) => ({ columnWidths: { ...s.columnWidths, [id]: next } }));
        get().onColumnResizing?.(id, next);
      },
      commitColumnWidth(id, width) {
        const s = get();
        const column = s.columns.find((c) => c.id === id);
        const next = column ? clampColumnWidth(column, width) : width;
        const columnWidths = { ...s.columnWidths, [id]: next };
        set({ columnWidths });
        s.onColumnLayoutChange?.(computeColumnLayout(s.columns, s.columnOrder, columnWidths, s.hiddenColumns));
      },
      resetColumnWidth(id) {
        const s = get();
        if (s.columnWidths[id] === undefined) return;
        const { [id]: _dropped, ...columnWidths } = s.columnWidths;
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
        const nextVisibleColumns = computeVisibleColumns(s.columns, nextIds, s.hiddenColumns);
        set({ columnOrder: nextIds, visibleColumns: nextVisibleColumns, ...remapEditing(s, s.viewIndex, nextVisibleColumns) });
        s.onColumnLayoutChange?.(computeColumnLayout(s.columns, nextIds, s.columnWidths, s.hiddenColumns));
      },
      setColumnPin(id, pin) {
        const s = get();
        if (!s.enableColumnPinning) return;
        const column = s.columns.find((c) => c.id === id);
        if (!column || !columnFlag(column, "pinnable")) return;
        const nextColumns = s.columns.map((c) => (c.id === id ? { ...c, pin: pin ?? undefined } : c));
        const nextVisibleColumns = computeVisibleColumns(nextColumns, s.columnOrder, s.hiddenColumns);
        set({
          columns: nextColumns,
          visibleColumns: nextVisibleColumns,
          ...remapEditing(s, s.viewIndex, nextVisibleColumns),
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
        resetDeferredRows(dataWrite);
        set({
          hiddenColumns: nextHidden,
          visibleColumns: nextVisibleColumns,
          viewIndex,
          viewStale: false,
          ...remapEditing(s, viewIndex, nextVisibleColumns),
          ...computeSearchMatches(s.data, s.columns, viewIndex, nextVisibleColumns, s.searchText, s.cellTypes),
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
          resetDeferredRows(dataWrite);
          return {
            sortState: sorts,
            viewIndex,
            viewStale: false,
            ...remapEditing(s2, viewIndex, s2.visibleColumns),
            ...computeSearchMatches(s2.data, s2.columns, viewIndex, s2.visibleColumns, s2.searchText, s2.cellTypes),
          };
        });
      },
      setSorts(sorts) {
        const s = get();
        s.onSortChange?.(sorts);
        if (s.sortControlled) return;
        set((s2) => {
          const viewIndex = computeViewIndex(s2.data, s2.columns, sorts, s2.filterState, s2.joinOperator, s2.viewIndex, s2.cellTypes);
          resetDeferredRows(dataWrite);
          return {
            sortState: sorts,
            viewIndex,
            viewStale: false,
            ...remapEditing(s2, viewIndex, s2.visibleColumns),
            ...computeSearchMatches(s2.data, s2.columns, viewIndex, s2.visibleColumns, s2.searchText, s2.cellTypes),
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
          resetDeferredRows(dataWrite);
          return {
            filterState: withIds,
            viewIndex,
            viewStale: false,
            ...remapEditing(s2, viewIndex, s2.visibleColumns),
            ...computeSearchMatches(s2.data, s2.columns, viewIndex, s2.visibleColumns, s2.searchText, s2.cellTypes),
          };
        });
      },
      setJoinOperator(joinOperator) {
        const s = get();
        s.onJoinOperatorChange?.(joinOperator);
        if (s.joinOperatorControlled) return;
        set((s2) => {
          const viewIndex = computeViewIndex(s2.data, s2.columns, s2.sortState, s2.filterState, joinOperator, s2.viewIndex, s2.cellTypes);
          resetDeferredRows(dataWrite);
          return {
            joinOperator,
            viewIndex,
            viewStale: false,
            ...remapEditing(s2, viewIndex, s2.visibleColumns),
            ...computeSearchMatches(s2.data, s2.columns, viewIndex, s2.visibleColumns, s2.searchText, s2.cellTypes),
          };
        });
      },
      setSearch(text) {
        const s = get();
        s.onSearchTextChange?.(text);
        if (s.searchControlled) return;
        // viewIndex is untouched: quick-search highlights + navigates, it never filters.
        set((s2) => ({ searchText: text, ...computeSearchMatches(s2.data, s2.columns, s2.viewIndex, s2.visibleColumns, text, s2.cellTypes) }));
      },
      startEditing(ref, initialText) {
        const coord = resolveRefOrWarn(dataWrite, get(), ref);
        if (coord) get().actions.startEditingAt(coord, initialText);
      },
      startEditingAt(coord, initialText) {
        const s = get();
        if (s.readOnly) return;
        const target = resolveEditTarget(s, coord);
        if (!target || target.cellType.activate || isColumnReadOnly(target.column, target.row)) return;
        if (s.onEditStart?.(coord) === false) return;
        if (s.editing) get().actions.cancelEditing();
        set({
          editing: { coord, rowId: s.getRowId(target.row, target.dataRowIndex), columnId: target.column.id, initialText, session: ++editSessionCount },
          editingError: null,
          editingRejectionCount: 0,
          activeCell: coord,
        });
      },
      cancelEditing() {
        const s = get();
        if (!s.editing) {
          set({ editingError: null });
          return;
        }
        endEditSession(s.editing, () => set({ editing: null, editingError: null }));
        s.onEditEnd?.({ coord: s.editing.coord, result: "cancel" });
      },
      // The data-write cluster (see data-write.ts): the edit commits, the bulk writers, and the row ops.
      ...createDataWriteActions(set, get, {
        ctx: dataWrite,
        applyRowValidation,
        pruneRowValidationKeys,
        warnViewSpacePresenceStale,
        remapEditing,
        endEditSession,
      }),
      setEditingError(message) {
        const s = get();
        if (!s.editing) return;
        set({ editingError: message, editingRejectionCount: s.editingRejectionCount + 1 });
        s.onEditEnd?.({ coord: s.editing.coord, result: "rejected" });
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
      flashCells(keys, durationMs = 1400) {
        if (keys.length === 0) return;
        const next = new Set(get().flashingCells);
        for (const key of keys) {
          next.add(key);
          const existing = flashTimers.get(key);
          if (existing !== undefined) clearTimeout(existing);
          flashTimers.set(
            key,
            setTimeout(() => {
              flashTimers.delete(key);
              const current = get();
              if (!current.flashingCells.has(key)) return;
              const lifted = new Set(current.flashingCells);
              lifted.delete(key);
              set({ flashingCells: lifted });
            }, durationMs),
          );
        }
        set({ flashingCells: next });
      },
      _pruneFlashingCells(keptViewRows) {
        const s = get();
        if (s.flashingCells.size === 0) return;
        const kept = new Set(keptViewRows);
        const next = new Set(s.flashingCells);
        for (const key of next) {
          // flashCellKey is `${viewRow}:${columnId}` — the view row is always a plain integer up to the first colon.
          const viewRow = Number(key.slice(0, key.indexOf(":")));
          if (kept.has(viewRow)) continue;
          next.delete(key);
        }
        if (next.size === s.flashingCells.size) return;
        set({ flashingCells: next });
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
        if (props.commands && !warnedCommandShadow) {
          const shadowed = Object.keys(props.commands).filter((name) => name in DEFAULT_KEYMAP);
          if (shadowed.length > 0) {
            warnedCommandShadow = true;
            warnDev(`commands shadows built-in action(s) ${shadowed.join(", ")}; the command wins and the built-in no longer dispatches`);
          }
        }
        set((s) => {
          // controlled sort/filter/join/search: the prop (when defined) is the source of truth this
          // sync writes into the store; uncontrolled: keep whatever the store's own actions last set.
          const nextSortState = props.sortState ?? s.sortState;
          // backfill: a controlled filterState prop may omit filterId (backward-compat input boundary);
          // a same-reference re-sync reuses s.filterState (see lastPropsFilterState).
          const propsFilterStateChanged = props.filterState !== lastPropsFilterState;
          lastPropsFilterState = props.filterState;
          const nextFilterState =
            props.filterState === undefined || !propsFilterStateChanged ? s.filterState : withFilterIds(props.filterState);
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
          const isEcho = nextData === dataWrite.lastEmittedData;
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
            forgetDeferredRows(dataWrite);
            pruneRowValidationKeys(nextData, s.getRowId);
          }
          // A genuine consumer-driven `columns` prop change replaces `s.columns` outright; syncing
          // again with the SAME prop reference (any unrelated re-render) keeps `s.columns` as-is so
          // runtime column-pin mutations (setColumnPin / the initial-layout seed) survive it.
          const propsColumnsChanged = props.columns !== lastPropsColumns;
          lastPropsColumns = props.columns;
          const nextColumns = propsColumnsChanged ? props.columns : s.columns;
          // A replaced `columns` array re-asserts its def-level hidden flags into `hiddenColumns`;
          // a same-reference re-render must not re-hide a column the user re-showed via
          // `setColumnHidden` (user intent wins over the def until the def itself changes).
          const reseededHidden = propsColumnsChanged
            ? defHiddenColumnIds(props.columns).filter((id) => !s.hiddenColumns.includes(id))
            : [];
          const nextHiddenColumns = reseededHidden.length > 0 ? [...s.hiddenColumns, ...reseededHidden] : s.hiddenColumns;
          // same registry-widening cast as createDataGridStore's init — see that comment.
          const propsCellTypes = props.cellTypes as unknown as ProvidedCellTypes;
          const nextCellTypes = sameCellTypeEntries(propsCellTypes, lastPropsCellTypes) ? s.cellTypes : resolveCellTypes(propsCellTypes);
          lastPropsCellTypes = propsCellTypes;
          const nextSyncInputs: SyncInputs = {
            data: nextData,
            cellTypes: nextCellTypes,
            columns: nextColumns,
            sortState: nextSortState,
            filterState: nextFilterState,
            joinOperator: nextJoinOperator,
            searchText: nextSearchText,
            columnOrder: s.columnOrder,
            hiddenColumns: nextHiddenColumns,
          };
          // An echo only licenses skipping the recompute when `data` is the ONLY input that moved —
          // a sync that also changed sort/filter/search/columns still has to rebuild for those.
          const echoOnly =
            isEcho && syncInputsEqual({ ...nextSyncInputs, data: lastSyncInputs.data }, lastSyncInputs);
          const unchanged = syncInputsEqual(nextSyncInputs, lastSyncInputs) || echoOnly;
          lastSyncInputs = nextSyncInputs;

          const nextVisibleColumns = unchanged ? s.visibleColumns : computeVisibleColumns(nextColumns, s.columnOrder, nextHiddenColumns);
          const nextViewIndex = unchanged
            ? s.viewIndex
            : computeViewIndex(nextData, nextColumns, nextSortState, nextFilterState, nextJoinOperator, s.viewIndex, nextCellTypes);
          // A full rebuild leaves nothing pending for the incremental path to replay.
          if (!unchanged) resetDeferredRows(dataWrite);
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
            hiddenColumns: nextHiddenColumns,
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
            commands: props.commands ?? null,
            viewStale: unchanged ? s.viewStale : false,
            // rows moved only when a genuine consumer data replacement invalidated the id cache
            // (our own echo never moves a row — updateCells patches values in place)
            rowIdentityVersion: nextData !== s.data && !isEcho ? s.rowIdentityVersion + 1 : s.rowIdentityVersion,
            ...(!unchanged ? remapEditing(s, nextViewIndex, nextVisibleColumns, nextData, props.getRowId) : {}),
            ...(unchanged
              ? { searchMatches: s.searchMatches, searchMatchSet: s.searchMatchSet, searchMatchRows: s.searchMatchRows, searchMatchesCapped: s.searchMatchesCapped }
              : computeSearchMatches(nextData, nextColumns, nextViewIndex, nextVisibleColumns, nextSearchText, nextCellTypes)),
            selection: rows === s.selection.rows ? s.selection : { ...s.selection, rows },
          };
        });
      },
      _subscribeEditEnd() {
        return api.subscribe((state, prev) => {
          if (prev.editing === null || state.editing !== null || prev.editing === selfReportedSession) return;
          state.onEditEnd?.({ coord: prev.editing.coord, result: "cancel" });
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
      _registerPresenceViewSpaceActive(impl) {
        set({ presenceViewSpaceActive: impl });
      },
    },
  }));
}
