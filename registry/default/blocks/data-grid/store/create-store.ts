import { createStore, type StoreApi } from "zustand/vanilla";
import type { ViewCoord, CellType, DataOp, FilterSpec } from "../types";
import { BUILTIN_ACTIONS, DEFAULT_KEYMAP } from "../keyboard";
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
  completeColumnOrder,
  computeColumnLayout,
  computeSearchMatches,
  computeVisibleColumns,
  clampCursor,
  computeViewIndex,
  defHiddenColumnIds,
  flashCellKey,
  flashKeyRowId,
  isColumnReadOnly,
  memoizedMergeLabels,
  mergeCellErrors,
  nextDirection,
  pruneCellErrors,
  rectsKeepColumns,
  rectsKeepRecords,
  remapColumnChannel,
  remapRowChannel,
  reorderColumnIds,
  resolveSelectionConfig,
  rowIdAtViewRow,
  toggleSortAdditive,
  visibleColumnsMoved,
  viewRowsMoved,
  withFilterIds,
  EMPTY_CELL_ERRORS,
  EMPTY_FLASHING_CELLS,
  EMPTY_OVERLAY_PLUGINS,
  EMPTY_ROW_BANDS,
} from "./compute";
import { isDev } from "../is-dev";
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
  // `data` wins over `defaultData`, and the decision latches for the store's lifetime, like `<input>` value/defaultValue.
  const dataControlled = init.data !== undefined;
  const initData: readonly unknown[] = init.data ?? init.defaultData ?? [];
  // Seeded at init, so the first real sync has a previous value to compare against.
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
  // The last raw `columns` prop; `s.columns` also carries runtime pin changes that a same-reference re-sync keeps.
  let lastPropsColumns: readonly AnyColumnDef[] = init.columns;
  // The raw `filterState` prop ref last seen by _syncProps — a same-reference re-sync skips withFilterIds, which would churn the sync input.
  let lastPropsFilterState: FilterSpec[] | undefined = init.filterState;
  // A `commands` entry named after a built-in action silently disables the built-in — warn once about it.
  let warnedCommandShadow = false;
  // `rowId -> dataIndex` for updateCells: row moves invalidate it, value patches keep it warm.
  const rowIndexCache = createRowIndexCache();
  /** Per-key auto-clear timers for `flashCells`; a re-flash of a live key clears its old timer so the pulse restarts. */
  const flashTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // The data-write cluster's streaming bookkeeping (see data-write.ts) — the write actions and _syncProps share it by reference.
  const dataWrite = createDataWriteContext(rowIndexCache);

  /**
   * Runs after every viewIndex/visibleColumns rebuild: re-anchor an open edit to the new view
   * position of its rowId/columnId (the draft survives the move), and move `activeCell` and the
   * selection with it when they sat on the edit cell (a multi-cell range collapses to that cell).
   * When the row or column left the view, cancel — the typed value is dropped, never written into
   * a hidden row. Keeps object identity when nothing moved.
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
    const anchor = s.selection.current?.cell;
    const anchoredOnEditCell = onEditCell && anchor !== undefined && anchor.row === editing.coord.row && anchor.col === editing.coord.col;
    if (viewRow === -1 || viewCol === -1) {
      return {
        editing: null,
        editingError: null,
        ...(onEditCell ? { activeCell: null } : {}),
        ...(anchoredOnEditCell ? { selection: { ...s.selection, current: null } } : {}),
      };
    }
    if (viewRow === editing.coord.row && viewCol === editing.coord.col) return {};
    const moved = { col: viewCol, row: viewRow };
    return {
      editing: { ...editing, coord: moved },
      ...(onEditCell ? { activeCell: moved } : {}),
      ...(anchoredOnEditCell ? { selection: { ...selectCellPure(moved), rows: s.selection.rows, columns: s.selection.columns } } : {}),
    };
  };
  /**
   * The active cell's coord in a rebuilt view: it follows its record and its column id. Returns
   * `undefined` when its row or column left the view, so the caller clamps instead.
   */
  const followActiveCell = (
    s: DataGridStoreState,
    viewIndex: readonly number[],
    visibleColumns: readonly AnyColumnDef[],
    toNextDataRow: ((prevDataRow: number) => number | undefined) | undefined,
    sameRecordAt: ((viewRow: number) => boolean) | undefined,
  ): DataGridStoreState["activeCell"] | undefined => {
    const active = s.activeCell;
    if (active === null) return null;
    const prevDataRow = s.viewIndex[active.row];
    const columnId = s.visibleColumns[active.col]?.id;
    if (prevDataRow === undefined || columnId === undefined) return undefined;
    let row = active.row;
    if (sameRecordAt ? !sameRecordAt(active.row) : viewIndex[active.row] !== prevDataRow) {
      const nextDataRow = toNextDataRow ? toNextDataRow(prevDataRow) : prevDataRow;
      row = nextDataRow === undefined ? -1 : viewIndex.indexOf(nextDataRow);
    }
    const col = visibleColumns[active.col]?.id === columnId ? active.col : visibleColumns.findIndex((column) => column.id === columnId);
    if (row === -1 || col === -1) return undefined;
    return row === active.row && col === active.col ? active : { row, col };
  };
  /**
   * The cursor, the open edit, and the selection carried into a rebuilt view. `sameRecords` keeps
   * data indices as identity (no `data` swap, or our own echo); otherwise records map by rowId, and
   * a duplicated rowId resolves to the last row with that id. The active cell follows its record and
   * column and clamps only when one of them left the view. The row channel follows its records, the
   * column channel its column ids. A range that now covers other records or columns collapses onto
   * the followed active cell; a clamp that moves the cursor collapses onto it, and a clamp in place
   * drops the range, so a row op never reaches a record nobody selected.
   */
  const followView = (
    s: DataGridStoreState,
    viewIndex: readonly number[],
    visibleColumns: readonly AnyColumnDef[],
    data: readonly unknown[] = s.data,
    getRowId: (row: unknown, index: number) => string = s.getRowId,
    sameRecords = data === s.data,
  ): Partial<DataGridStoreState> => {
    const toNextDataRow = sameRecords
      ? undefined
      : (prevDataRow: number) => {
          const row = s.data[prevDataRow];
          // An unloaded row has no record yet; a page load fills the same index.
          if (row === undefined) return prevDataRow < data.length ? prevDataRow : undefined;
          return rowIndexCache.resolve(data, getRowId).get(s.getRowId(row, prevDataRow));
        };
    const current = s.selection.current;
    const sameRecordAt = toNextDataRow
      ? (viewRow: number) => {
          const prevDataRow = s.viewIndex[viewRow];
          const nextDataRow = viewIndex[viewRow];
          if (prevDataRow === undefined || nextDataRow === undefined) return false;
          const prevRow = s.data[prevDataRow];
          const nextRow = data[nextDataRow];
          return prevRow !== undefined && nextRow !== undefined && s.getRowId(prevRow, prevDataRow) === getRowId(nextRow, nextDataRow);
        }
      : undefined;
    const followed = followActiveCell(s, viewIndex, visibleColumns, toNextDataRow, sameRecordAt);
    const clamped = followed === undefined ? clampCursor(s, viewIndex.length, visibleColumns.length) : undefined;
    const clampedSelection = clamped?.selection;
    const editRemap = remapEditing(s, viewIndex, visibleColumns, data, getRowId);
    let base: DataGridStoreState["selection"] = editRemap.selection ?? clampedSelection ?? s.selection;
    const rects = current ? [current.range, ...current.rangeStack] : [];
    if (!editRemap.selection && !clampedSelection && current) {
      const rangeKept =
        rectsKeepRecords(rects, s.viewIndex, viewIndex, toNextDataRow, sameRecordAt) && rectsKeepColumns(rects, s.visibleColumns, visibleColumns);
      const anchorOnCursor = s.activeCell !== null && current.cell.row === s.activeCell.row && current.cell.col === s.activeCell.col;
      if (!rangeKept) {
        base = followed ? { ...selectCellPure(followed), rows: base.rows, columns: base.columns } : { ...base, current: null };
      } else if (followed && followed !== s.activeCell && anchorOnCursor) {
        base = { ...base, current: { ...current, cell: followed } };
      }
    }
    const rows = remapRowChannel(base.rows, s.viewIndex, viewIndex, toNextDataRow);
    const columns = remapColumnChannel(base.columns, s.visibleColumns, visibleColumns);
    const selection = rows === base.rows && columns === base.columns ? base : { ...base, rows, columns };
    return { ...(clamped ?? { activeCell: followed ?? null }), ...editRemap, ...(selection === s.selection ? {} : { selection }) };
  };
  // cellErrors keys of each row's last validateRow verdict, so a re-run clears only its own messages.
  const rowValidationKeys = new Map<string, string[]>();
  // An unpruned entry for a deleted rowId lets the next validateRow wipe a reused row's consumer errors.
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
  // A row or column move strands view-space presence entries; `moved` runs only in development.
  let warnedPresenceReorder = false;
  const warnViewSpacePresenceStale = (s: DataGridStoreState, moved?: () => boolean) => {
    if (warnedPresenceReorder || !isDev() || !s.presenceViewSpaceActive?.()) return;
    if (moved && !moved()) return;
    warnedPresenceReorder = true;
    warnDev("rows or columns moved while a view-space presence entry is active — its highlight position is now stale; use rowId-native presence entries for a live feed");
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
  // Widths as of the last onColumnLayoutChange; a drag writes columnWidths per frame, so the commit compares against this.
  let committedWidths: Record<string, number> = seeded.columnWidths;
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
    focusImpl: null,
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
        // Bounded by the view row count, so growth stays inside the filtered display order.
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
        // Without multi-range or range selection, ctrl-click and shift-click toggle only this row.
        const additive = opts.additive && enableMultiRange;
        const extendFromLast = opts.extendFromLast && enableRangeSelection;
        const replaceFromLast = opts.replaceFromLast && enableRangeSelection;
        const next = selectRowPure(selection, index, {
          additive,
          extendFromLast,
          replaceFromLast,
          from: opts.from ?? lastHighlightedRow ?? undefined,
        });
        // A stationary marker drag re-fires the same span; compare content so onSelectionChange stays quiet.
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
        // The stage carries over only while the last selectAll's selection and activeCell are still in the store.
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
        if (!column) return;
        const next = clampColumnWidth(column, width);
        set((s) => ({ columnWidths: { ...s.columnWidths, [id]: next } }));
        get().onColumnResizing?.(id, next);
      },
      commitColumnWidth(id, width) {
        const s = get();
        const column = s.columns.find((c) => c.id === id);
        if (!column) return;
        const next = clampColumnWidth(column, width);
        const columnWidths = { ...s.columnWidths, [id]: next };
        set({ columnWidths });
        if (committedWidths[id] === next) return;
        committedWidths = { ...committedWidths, [id]: next };
        s.onColumnLayoutChange?.(computeColumnLayout(s.columns, s.columnOrder, columnWidths, s.hiddenColumns));
      },
      resetColumnWidth(id) {
        const s = get();
        if (s.columnWidths[id] === undefined) return;
        const { [id]: _dropped, ...columnWidths } = s.columnWidths;
        const { [id]: _committed, ...nextCommitted } = committedWidths;
        committedWidths = nextCommitted;
        set({ columnWidths });
        s.onColumnLayoutChange?.(computeColumnLayout(s.columns, s.columnOrder, columnWidths, s.hiddenColumns));
      },
      setColumnOrder(id, targetId, position) {
        const s = get();
        if (!s.enableColumnReorder) return;
        const byId = new Map(s.columns.map((c) => [c.id, c] as const));
        const column = byId.get(id);
        const target = byId.get(targetId);
        if (!column || !target || !columnFlag(column, "reorderable") || !columnFlag(target, "reorderable")) return;
        const currentIds = completeColumnOrder(s.columns, s.columnOrder);
        const nextIds = reorderColumnIds(currentIds, s.columns, id, targetId, position);
        if (nextIds.length === currentIds.length && nextIds.every((columnId, index) => columnId === currentIds[index])) return;
        const nextVisibleColumns = computeVisibleColumns(s.columns, nextIds, s.hiddenColumns);
        warnViewSpacePresenceStale(s, () => visibleColumnsMoved(s.visibleColumns, nextVisibleColumns));
        set({ columnOrder: nextIds, visibleColumns: nextVisibleColumns, ...followView(s, s.viewIndex, nextVisibleColumns) });
        s.onColumnLayoutChange?.(computeColumnLayout(s.columns, nextIds, s.columnWidths, s.hiddenColumns));
      },
      setColumnPin(id, pin) {
        const s = get();
        if (!s.enableColumnPinning) return;
        const column = s.columns.find((c) => c.id === id);
        if (!column || !columnFlag(column, "pinnable") || (column.pin ?? null) === pin) return;
        const nextColumns = s.columns.map((c) => (c.id === id ? { ...c, pin: pin ?? undefined } : c));
        const nextVisibleColumns = computeVisibleColumns(nextColumns, s.columnOrder, s.hiddenColumns);
        warnViewSpacePresenceStale(s, () => visibleColumnsMoved(s.visibleColumns, nextVisibleColumns));
        set({
          columns: nextColumns,
          visibleColumns: nextVisibleColumns,
          ...followView(s, s.viewIndex, nextVisibleColumns),
        });
        s.onColumnLayoutChange?.(computeColumnLayout(nextColumns, s.columnOrder, s.columnWidths, s.hiddenColumns));
      },
      setColumnHidden(id, hidden) {
        const s = get();
        if (!s.columns.some((c) => c.id === id) || s.hiddenColumns.includes(id) === hidden) return;
        const current = new Set(s.hiddenColumns);
        if (hidden) current.add(id);
        else current.delete(id);
        const nextHidden = Array.from(current);
        const nextVisibleColumns = computeVisibleColumns(s.columns, s.columnOrder, nextHidden);
        warnViewSpacePresenceStale(s, () => visibleColumnsMoved(s.visibleColumns, nextVisibleColumns));
        const viewIndex = computeViewIndex(s.data, s.columns, s.sortState, s.filterState, s.joinOperator, s.viewIndex, s.cellTypes);
        resetDeferredRows(dataWrite);
        set({
          hiddenColumns: nextHidden,
          visibleColumns: nextVisibleColumns,
          viewIndex,
          viewStale: false,
          ...followView(s, viewIndex, nextVisibleColumns),
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
        // Controlled: _syncProps writes the consumer's next `sortState` prop.
        if (s.sortControlled) return;
        set((s2) => {
          const viewIndex = computeViewIndex(s2.data, s2.columns, sorts, s2.filterState, s2.joinOperator, s2.viewIndex, s2.cellTypes);
          if (viewIndex !== s2.viewIndex) warnViewSpacePresenceStale(s2);
          resetDeferredRows(dataWrite);
          return {
            sortState: sorts,
            viewIndex,
            viewStale: false,
            ...followView(s2, viewIndex, s2.visibleColumns),
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
          if (viewIndex !== s2.viewIndex) warnViewSpacePresenceStale(s2);
          resetDeferredRows(dataWrite);
          return {
            sortState: sorts,
            viewIndex,
            viewStale: false,
            ...followView(s2, viewIndex, s2.visibleColumns),
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
          if (viewIndex !== s2.viewIndex) warnViewSpacePresenceStale(s2);
          resetDeferredRows(dataWrite);
          return {
            filterState: withIds,
            viewIndex,
            viewStale: false,
            ...followView(s2, viewIndex, s2.visibleColumns),
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
          if (viewIndex !== s2.viewIndex) warnViewSpacePresenceStale(s2);
          resetDeferredRows(dataWrite);
          return {
            joinOperator,
            viewIndex,
            viewStale: false,
            ...followView(s2, viewIndex, s2.visibleColumns),
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
        if (s.onEditStart?.({ rowId: s.getRowId(target.row, target.dataRowIndex), columnId: target.column.id, viewRowIndex: coord.row, viewColumnIndex: coord.col }) === false) return;
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
        s.onEditEnd?.({ rowId: s.editing.rowId, columnId: s.editing.columnId, viewRowIndex: s.editing.coord.row, viewColumnIndex: s.editing.coord.col, result: "cancel" });
      },
      // The data-write cluster (see data-write.ts): the edit commits, the bulk writers, and the row ops.
      ...createDataWriteActions(set, get, {
        ctx: dataWrite,
        applyRowValidation,
        pruneRowValidationKeys,
        warnViewSpacePresenceStale,
        followView,
        endEditSession,
      }),
      setEditingError(message) {
        const s = get();
        if (!s.editing) return;
        set({ editingError: message, editingRejectionCount: s.editingRejectionCount + 1 });
        s.onEditEnd?.({ rowId: s.editing.rowId, columnId: s.editing.columnId, viewRowIndex: s.editing.coord.row, viewColumnIndex: s.editing.coord.col, result: "rejected" });
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
      flashCells(cells, durationMs = 1400) {
        if (cells.length === 0) return;
        const next = new Set(get().flashingCells);
        for (const { rowId, columnId } of cells) {
          const key = flashCellKey(rowId, columnId);
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
        const keptRowIds = new Set<string>();
        for (const viewRow of keptViewRows) {
          const rowId = rowIdAtViewRow(s, viewRow);
          if (rowId !== undefined) keptRowIds.add(rowId);
        }
        const next = new Set(s.flashingCells);
        for (const key of next) {
          if (!keptRowIds.has(flashKeyRowId(key))) next.delete(key);
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
          // Grow from the anchor's far edge; the anchor stays put for the whole extend gesture.
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
        if (props.commands && !warnedCommandShadow && isDev()) {
          // BUILTIN_ACTIONS includes editReplace, which has no default binding.
          const shadowed = Object.keys(props.commands).filter((name) =>
            (BUILTIN_ACTIONS as readonly string[]).includes(name),
          );
          if (shadowed.length > 0) {
            warnedCommandShadow = true;
            warnDev(`commands shadows built-in action(s) ${shadowed.join(", ")}; the command wins and the built-in no longer dispatches`);
          }
        }
        set((s) => {
          // A defined controlled prop is the source of truth; otherwise the store keeps its own state.
          const nextSortState = props.sortState ?? s.sortState;
          // A controlled filterState may omit filterId; the same prop reference reuses s.filterState.
          const propsFilterStateChanged = props.filterState !== lastPropsFilterState;
          lastPropsFilterState = props.filterState;
          const nextFilterState =
            props.filterState === undefined || !propsFilterStateChanged ? s.filterState : withFilterIds(props.filterState);
          const nextJoinOperator = props.joinOperator ?? s.joinOperator;
          const nextSearchText = props.searchText ?? s.searchText;
          // Controlled data mirrors the prop; uncontrolled keeps the store's array, and `defaultData` is init-only.
          const nextData = s.dataControlled && props.data !== undefined ? props.data : s.data;
          // Our own onDataChange array fed back is an echo; skipping its view rebuild saves ~56 ms at 100k sorted rows.
          // A foreign sync in between replaced s.data, so a late-adopted emitted array is foreign too.
          const isEcho = nextData === dataWrite.lastEmittedData && nextData === s.data;
          const foreignData = nextData !== s.data;
          // A foreign array may move or drop rows, so prune errors and rebuild the id map; our own echo keeps both.
          const nextCellErrors = foreignData ? pruneCellErrors(s.cellErrors, nextData, props.getRowId) : s.cellErrors;
          if (foreignData) {
            rowIndexCache.invalidate();
            forgetDeferredRows(dataWrite);
            pruneRowValidationKeys(nextData, props.getRowId);
          }
          // Only a new `columns` reference replaces `s.columns`, so runtime pin changes survive re-renders.
          const propsColumnsChanged = props.columns !== lastPropsColumns;
          lastPropsColumns = props.columns;
          const nextColumns = propsColumnsChanged ? props.columns : s.columns;
          // A new `columns` array re-asserts def-level hidden flags; a re-render keeps a column the user re-showed.
          const reseededHidden = propsColumnsChanged
            ? defHiddenColumnIds(props.columns).filter((id) => !s.hiddenColumns.includes(id))
            : [];
          const nextHiddenColumns = reseededHidden.length > 0 ? [...s.hiddenColumns, ...reseededHidden] : s.hiddenColumns;
          // Widens each typed CellType to the untyped registry shape.
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
          // An echo skips the recompute only when `data` is the only input that moved.
          const echoOnly =
            isEcho && syncInputsEqual({ ...nextSyncInputs, data: lastSyncInputs.data }, lastSyncInputs);
          const unchanged = syncInputsEqual(nextSyncInputs, lastSyncInputs) || echoOnly;
          lastSyncInputs = nextSyncInputs;

          const nextVisibleColumns = unchanged ? s.visibleColumns : computeVisibleColumns(nextColumns, s.columnOrder, nextHiddenColumns);
          const nextViewIndex = unchanged
            ? s.viewIndex
            : computeViewIndex(nextData, nextColumns, nextSortState, nextFilterState, nextJoinOperator, s.viewIndex, nextCellTypes);
          if (nextViewIndex !== s.viewIndex || foreignData || nextVisibleColumns !== s.visibleColumns) {
            warnViewSpacePresenceStale(
              s,
              () => viewRowsMoved(s, nextViewIndex, nextData, props.getRowId) || visibleColumnsMoved(s.visibleColumns, nextVisibleColumns),
            );
          }
          // A full rebuild leaves nothing pending for the incremental path to replay.
          if (!unchanged) resetDeferredRows(dataWrite);
          const followed = unchanged
            ? {}
            : followView(s, nextViewIndex, nextVisibleColumns, nextData, props.getRowId, !foreignData);
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
            commands: props.commands ?? null,
            // A real recompute reconciles a deferred updateCells; an echo or unchanged sync keeps the flag.
            viewStale: unchanged ? s.viewStale : false,
            // Rows move only on a foreign data replacement, never on our own echo.
            rowIdentityVersion: foreignData ? s.rowIdentityVersion + 1 : s.rowIdentityVersion,
            ...followed,
            ...(unchanged
              ? { searchMatches: s.searchMatches, searchMatchSet: s.searchMatchSet, searchMatchRows: s.searchMatchRows, searchMatchesCapped: s.searchMatchesCapped }
              : computeSearchMatches(nextData, nextColumns, nextViewIndex, nextVisibleColumns, nextSearchText, nextCellTypes)),
          };
        });
      },
      _subscribeEditEnd() {
        return api.subscribe((state, prev) => {
          if (prev.editing === null || state.editing !== null || prev.editing === selfReportedSession) return;
          state.onEditEnd?.({ rowId: prev.editing.rowId, columnId: prev.editing.columnId, viewRowIndex: prev.editing.coord.row, viewColumnIndex: prev.editing.coord.col, result: "cancel" });
        });
      },
      _registerScrollToCell(impl) {
        set({ scrollToCellImpl: impl });
      },
      _registerFocus(impl) {
        set({ focusImpl: impl });
      },
      _registerReadOnly(readOnly) {
        set({ readOnly });
        if (readOnly && get().editing) get().actions.cancelEditing();
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
