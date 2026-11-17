import { createStore, type StoreApi } from "zustand/vanilla";
import {
  viewIndex,
  type CellRef,
  type ColumnLayout,
  type CompactSelectionLike,
  type GridRect,
  type GridSelection,
  type SelectionState,
  type ViewCoord,
  type FilterNode,
  type SortSpec,
} from "../types";
import { validateKeymap, validateSharedBindings } from "../keyboard";
import { readColumnPin } from "../columns/column-pin";
import { CompactSelection } from "../selection/compact-selection";
import { applyRowRange, isRowRangeLive, type RowRangeGesture } from "../selection/row-range-gesture";
import { getCellValue } from "../columns/column-helpers";
import { buildColumnGroupModel, type ColumnGroupModel } from "../columns/column-groups";
import { clampColumnWidth, resolveColumnWidth, savedColumnWidth } from "../columns/resolve-column-width";
import { computeAutosizeWidths } from "../columns/autosize-columns";
import {
  emptySelection,
  extendTo,
  extendSelection,
  isSelectionEmpty,
  pushRange,
  removeRowFromSelection,
  selectAllProgression,
  selectCell as selectCellPure,
  selectColumn as selectColumnPure,
  selectRow as selectRowPure,
  type ExtendDirection,
} from "../selection";
import {
  applyDefaultColumnLayout as applyDefaultColumnLayoutBase,
  isColumnLayoutObject,
  cellErrorKey,
  clampIndex,
  type ColumnLayoutParts,
  columnFlag,
  completeColumnOrder as completeColumnOrderBase,
  computeColumnLayout as computeColumnLayoutBase,
  computeSearchMatches,
  DEFAULT_SEARCH_OPTIONS,
  computeVisibleColumns as computeVisibleColumnsBase,
  clampCursor,
  computeViewIndex,
  viewSorts,
  viewFilters,
  pinsOf,
  defHiddenColumnIds,
  DEFAULT_LOCALE,
  withGridLocale,
  flashCellKey,
  flashKeyRowId,
  isColumnReadOnly,
  layoutSnapshotsEqual,
  makeSelectionChangeDetails,
  memoizedMergeLabels,
  mergeCellErrors,
  nextDirection,
  normalizeColumnLayout as normalizeColumnLayoutBase,
  rectsKeepColumns,
  rectsKeepRecords,
  remapColumnChannel,
  remapRowChannel,
  sanitizeColumnLayout,
  holeSafeRowId,
  resolveSortMode,
  resolveFilterMode,
  selectCellOf,
  viewWindowOf,
  windowView,
  effectivePage,
  fullViewOf,
  rowIdAtViewRow,
  toggleSortAdditive,
  withFilterIds,
  EMPTY_CELL_ERRORS,
  EMPTY_FLASHING_CELLS,
} from "./compute";
import { resolveSelectionConfig } from "./selection-config";
import { withMatchCase } from "./filter-match-case";
import { toSafeText } from "../cell-types/safe-text";
import { createWarnOnce, isDev, warnDev } from "../is-dev";
import {
  MAX_HIDDEN_CHECKED_ROWS,
  NO_HIDDEN_CHECKED_ROWS,
  NO_REMEMBERED_ROWS,
  keepsCheckedRows,
  windowModeActive,
  carryCheckedRows,
  hiddenCheckedRowsActive,
} from "./hidden-checked-rows";
import { resolveEditTarget } from "./commit";
import { apiHandleOf } from "./api";
import { isThenable } from "./async-gate";
import { createRowValidation } from "./row-validation";
import {
  createSyncPhase,
  endAllMatching,
  filterSpecKey,
  resolveCellTypes,
  resolveSortLocale,
  sortSpecKey,
  type ProvidedCellTypes,
  type SyncMemory,
} from "./sync-props";
import { createGateTracker, EMPTY_GATES_PENDING, type GateRun } from "./gate-signal";
import { EMPTY_SAVE_STATUS } from "./write-ack";
import {
  createDataWriteActions,
  createDataWriteContext,
  emitAfterWrites,
  emitFromListener,
  resetDeferredRows,
  resolveRefOrWarn,
  warnViewIndexIds,
} from "./data-write";
import { NO_STALE_ROWS, clearStaleRows } from "./server-stale";
import { registerInternalActions } from "./internal-actions";
import { claimPluginAttachments, mergePluginCommands, mergePluginKeymaps, pluginsListEqual, resolvePluginsList } from "./plugins";
import { createRowIndexCache, resolveCellRef, viewRowOfDataIndex } from "./row-index";
import {
  EMPTY_SELECTION_STATE,
  cellRefAtViewCoord,
  deriveColumnIds,
  deriveRowIds,
  resolveSelectionState,
  selectionStatesEqual,
  type ResolveWarnFlag,
} from "./selection-state";
import type { AnyColumnDef, CellPatch, DataGridInternalActions, DataGridStoreState, InternalSyncProps, SyncInputs, UpdateCellsOptions } from "./types";
import { createStreamQueue } from "./stream-queue";
import { planColumnOrder } from "./column-order";
import { plainSeed } from "./function-seed";
import { warnUnhandledServerSpec } from "./server-spec-warning";
import { keepKnownFilters, keepKnownSorts } from "./known-columns";
import { groupAnnouncementLabel, loadedRowCount, newlyFailedGroup, nextAnnouncement } from "./announcements";
import { allMatchingCheckedCount } from "./selected-rows";
import { dataIndexAt, dataIndexOf, groupLayoutOfView, recordKeyAt, viewRowOfGroupId } from "./view-rows";
import { createGroupActions } from "./group-actions";
import { EXPANDED_CUT_MESSAGE, initGroupMemory, initialExpanded, initialGroupBy } from "./group-sync";
import { groupModeOf, groupingOf, withGroupLayout } from "./group-view";
import { leafViewOf } from "./group-readers";
import { pageUnitsOf } from "./group-pages";
import { matchingRowTotal } from "./matching-total";

const EMPTY_ROW_IDS: readonly string[] = [];

type CheckedState = Pick<DataGridStoreState, "selection" | "hiddenCheckedRowIds" | "allMatching" | "data" | "viewIndex" | "totalRowCount" | "groupLayout"> & Partial<Pick<DataGridStoreState, "groupMode">>;

/** The checked total: the rows channel plus the hidden checked rows, or the "all matching" count (`null` for a result of unknown size). */
function checkedTotal(s: CheckedState, resolveRowIds: () => ReadonlyMap<string, number>): number | null {
  return s.allMatching ? allMatchingCheckedCount(s, resolveRowIds) : s.selection.rows.length + s.hiddenCheckedRowIds.size;
}

/** The announcement for a selection change, or nothing when the checked total stays equal or is unknown. */
function checkedChange(
  s: DataGridStoreState,
  next: Pick<DataGridStoreState, "selection"> & Partial<Pick<DataGridStoreState, "hiddenCheckedRowIds" | "allMatching">>,
  resolveRowIds: () => ReadonlyMap<string, number>,
): Pick<DataGridStoreState, "liveAnnouncement"> | Record<string, never> {
  const after = checkedTotal({ ...s, ...next }, resolveRowIds);
  if (after === null || after === checkedTotal(s, resolveRowIds)) return {};
  return { liveAnnouncement: nextAnnouncement(s.liveAnnouncement, "rowsChecked", after) };
}

/** Longest wait between two "view stale" announcements of one grid. */
const VIEW_STALE_ANNOUNCEMENT_INTERVAL_MS = 30_000;

function viewHoldsUnloadedRows(s: Pick<DataGridStoreState, "viewIndex" | "data">): boolean {
  return s.viewIndex.some((dataIndex) => dataIndex >= 0 && s.data[dataIndex] === undefined);
}

const UNKNOWN_COLUMN_MESSAGE = "a sort or filter names an unknown column (its id is not in `columns`), so the grid ignores it";

/**
 * Creates one grid's vanilla store instance. Module-private: never export this
 * factory's result or a bound hook from this module — only the hooks below.
 */
export function createDataGridStore(rawInit: InternalSyncProps): StoreApi<DataGridStoreState> {
  const init = { ...rawInit, getRowId: holeSafeRowId(rawInit.getRowId) };
  const initLocale = init.locale ?? DEFAULT_LOCALE;
  const warnStoreOnce = createWarnOnce();
  const initColumns = withGridLocale(init.columns, initLocale, warnStoreOnce);
  const resizeStartWidths = new Map<string, number | undefined>();
  const memory = { groupModel: buildColumnGroupModel(init.columnGroups, init.columns.map((c) => c.id)) } as SyncMemory;
  const warnedGroupIssues = new Set<string>();
  const warnGroupIssues = (model: ColumnGroupModel | null): void => {
    if (!model || !isDev()) return;
    for (const issue of model.issues) {
      if (warnedGroupIssues.has(issue)) continue;
      warnedGroupIssues.add(issue);
      warnDev(issue);
    }
  };
  warnGroupIssues(memory.groupModel);
  const applyDefaultColumnLayout = (columns: readonly AnyColumnDef[], hidden: string[], layout: Partial<ColumnLayout> | undefined) =>
    applyDefaultColumnLayoutBase(columns, hidden, layout, memory.groupModel);
  const completeColumnOrder = (columns: readonly AnyColumnDef[], order: readonly string[] | null) => completeColumnOrderBase(columns, order, memory.groupModel);
  const computeColumnLayout = (columns: readonly AnyColumnDef[], order: string[] | null, widths: Record<string, number>, hidden: readonly string[]) =>
    computeColumnLayoutBase(columns, order, widths, hidden, memory.groupModel);
  const computeVisibleColumns = (columns: readonly AnyColumnDef[], order: string[] | null, hidden: readonly string[]) =>
    computeVisibleColumnsBase(columns, order, hidden, memory.groupModel);
  const normalizeColumnLayout = (columns: readonly AnyColumnDef[], parts: ColumnLayoutParts, hidden: string[]) => normalizeColumnLayoutBase(columns, parts, hidden, memory.groupModel, warnStoreOnce);
  const defHidden = defHiddenColumnIds(initColumns);
  const seeded = applyDefaultColumnLayout(initColumns, defHidden, plainSeed(init.defaultColumnLayout));
  // `columnLayout` wins over `defaultColumnLayout`, and both resolve here (not in the provider),
  // so the server render and the first client paint already show the controlled layout. Omitted
  // parts fall back to the seeded values (there is no store state yet).
  const seededPins = pinsOf(seeded.columns);
  const initLayout = isColumnLayoutObject(init.columnLayout) ? sanitizeColumnLayout(init.columnLayout) : null;
  const effectiveLayout =
    initLayout
      ? normalizeColumnLayout(
          initColumns,
          {
            widths: initLayout.widths ?? seeded.columnWidths,
            order: initLayout.order !== undefined ? initLayout.order : seeded.columnOrder,
            pins: initLayout.pins ?? seededPins,
            hidden: initLayout.hidden ?? seeded.hiddenColumns,
          },
          defHidden,
        )
      : seeded;
  const visibleColumns = computeVisibleColumns(effectiveLayout.columns, effectiveLayout.columnOrder, effectiveLayout.hiddenColumns);
  const mergeLabels = memoizedMergeLabels();
  // `data` wins over `defaultData`, and the decision latches for the store's lifetime, like `<input>` value/defaultValue.
  const dataControlled = init.data !== undefined;
  const initData: readonly unknown[] = init.data ?? init.defaultData ?? [];
  // Seeded at init, so the first real sync has a previous value to compare against.
  const dropUnknownSorts = (sorts: SortSpec[], columns: readonly AnyColumnDef[]): SortSpec[] => {
    const kept = keepKnownSorts(sorts, columns);
    if (kept !== sorts) warnStoreOnce("unknown column", UNKNOWN_COLUMN_MESSAGE);
    return kept;
  };
  const dropUnknownFilters = (nodes: FilterNode[], columns: readonly AnyColumnDef[]): FilterNode[] => {
    const kept = keepKnownFilters(nodes, columns);
    if (kept !== nodes) warnStoreOnce("unknown column", UNKNOWN_COLUMN_MESSAGE);
    return kept;
  };
  const initSortState = init.sortState ?? dropUnknownSorts(plainSeed(init.defaultSortState) ?? [], init.columns);
  const initSortMode = resolveSortMode(init);
  const initSortLocale = resolveSortLocale(init);
  const initFilterMode = resolveFilterMode(init);
  const initPageSize = init.pageSize !== undefined ? init.pageSize : (init.defaultPageSize ?? null);
  const initPage = init.page ?? init.defaultPage ?? 1;
  const warnsUnhandledSpecAtMount = init.totalRowCount !== undefined && init.sortMode === undefined && init.filterMode === undefined && init.onSortChange === undefined && init.onFilterChange === undefined && init.sortState === undefined && init.filterState === undefined;
  if (warnsUnhandledSpecAtMount) {
    queueMicrotask(() => warnDev('totalRowCount makes sorting and filtering server-side by default, and nothing here handles onSortChange or onFilterChange, so the grid will not reorder or narrow its rows. Fetch rows for the spec, or set sortMode="client" and filterMode="client" to work on the loaded rows'));
  }
  const initGroupBy = initialGroupBy(init, effectiveLayout.columns);
  const initGroupMode = groupModeOf(init);
  const initExpanded = initialExpanded(init, () => warnStoreOnce("expanded cut", EXPANDED_CUT_MESSAGE));
  const initSearchText = init.searchText ?? plainSeed(init.defaultSearchText) ?? "";
  const initSearchOptions = DEFAULT_SEARCH_OPTIONS;
  // storage widens each per-column CellType<TData, TValue, TOptions> to the untyped registry shape; narrowed back per column at lookup (cell.tsx/store's column-op helpers).
  const initCellTypes = resolveCellTypes(init.cellTypes as unknown as ProvidedCellTypes);
  const initFilterState = withMatchCase(withFilterIds(init.filterState ?? dropUnknownFilters(plainSeed(init.defaultFilterState) ?? [], init.columns)), init.columns, initCellTypes);
  Object.assign(memory, {
    lastPropsCellTypes: init.cellTypes as unknown as ProvidedCellTypes,
    lastSyncInputs: {
      data: initData,
      cellTypes: initCellTypes,
      columns: effectiveLayout.columns,
      sortState: viewSorts(initSortMode, initSortState),
      filterState: viewFilters(initFilterMode, initFilterState),
      searchText: initSearchText,
      columnOrder: effectiveLayout.columnOrder,
      hiddenColumns: effectiveLayout.hiddenColumns,
      columnGroupModel: memory.groupModel,
      pageKey: `${initPage}|${initPageSize}`,
      sortLocale: initSortLocale,
      groupBy: initGroupBy,
      expanded: initExpanded,
      groupMode: initGroupMode,
      serverGroupLayout: init.groupLayout ?? null,
    } satisfies SyncInputs,
    group: initGroupMemory(init),
    lastPropsColumnGroups: init.columnGroups,
    lastPropsColumns: init.columns,
    lastColumnsLocale: initLocale,
    lastKeymapProp: init.keymap,
    lastCommandsProp: init.commands,
    lastPluginsProp: init.plugins,
    lastPropsFilterState: init.filterState,
    warnedCommandShadow: false,
    warnedMovedCommands: false,
    claimedPlugins: undefined,
    releasePluginClaims: null,
    warnedGetRowIdSwap: false,
    warnedSeedChange: false,
  } satisfies Partial<SyncMemory>);
  // Plugin-conflict dev warnings, once per key per store (resolution re-runs on list changes; a static conflict must not re-warn).
  const pluginWarnedKeys = new Set<string>();
  const pluginWarnOnce = (key: string, message: string): void => {
    if (pluginWarnedKeys.has(key)) return;
    pluginWarnedKeys.add(key);
    warnDev(message);
  };
  let warnedHiddenCheckedIgnored = false;
  let warnedHiddenCheckedCap = false;
  const warnHiddenCheckedIgnored = (reason: string): void => {
    if (warnedHiddenCheckedIgnored) return;
    warnedHiddenCheckedIgnored = true;
    warnDev(`checkedRowsLifetime="across-filters" falls back to "until-cleared" ${reason}`);
  };
  // `rowId -> dataIndex` for updateCells: row moves invalidate it, value patches keep it warm.
  const rowIndexCache = createRowIndexCache();
  const announceChecked = (s: DataGridStoreState, next: Parameters<typeof checkedChange>[1]) =>
    checkedChange(s, next, () => rowIndexCache.resolve(s.data, s.getRowId));
  /** Per-key auto-clear timers for `flashCells`; a re-flash of a live key clears its old timer so the pulse restarts. */
  const flashTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // The data-write cluster's streaming bookkeeping (see data-write.ts) — the write actions and _syncProps share it by reference.
  const gates = createGateTracker({
    timeoutMs: (name) => {
      const wanted = store.getState().gateTimeoutMs;
      return typeof wanted === "object" ? (wanted as Partial<Record<typeof name, number>>)[name] : wanted;
    },
    aborted: (gate, reason) => {
      const onGateAborted = store.getState().onGateAborted;
      if (onGateAborted) {
        try {
          onGateAborted({ gate, reason });
        } catch (error) {
          console.error("[data-grid] onGateAborted threw:", error);
        }
      }
    },
    stuck: (name) => warnStoreOnce(`stuck gate ${name}`, `${name} has not settled after 30 seconds and gateTimeoutMs is not set, so the grid keeps waiting; settle the promise on every path, or set gateTimeoutMs`),
    publish: (gatesPending) => store.setState({ gatesPending }),
    subscribe: (listener) => store.subscribe(listener),
  });
  const dataWrite = createDataWriteContext(rowIndexCache, gates);
  const streamQueue = createStreamQueue((patches, options) => void store.getState().actions.updateCells(patches, options));

  const rebuildPageView = (s2: DataGridStoreState, page: number, pageSize: number | null): Partial<DataGridStoreState> => {
    const window = pageSize === null ? null : { page, pageSize };
    const viewIndex = s2.viewStale
      ? computeViewIndex(s2.data, s2.columns, viewSorts(s2.sortMode, s2.sortState), viewFilters(s2.filterMode, s2.filterState), s2.viewIndex, s2.cellTypes, window, s2.sortLocale, groupingOf(s2))
      : windowView(fullViewOf(s2.viewIndex), window, s2.viewIndex);
    resetDeferredRows(dataWrite);
    return {
      page,
      pageSize,
      viewIndex,
      ...clearStaleRows(dataWrite),
      ...followView(s2, viewIndex, s2.visibleColumns),
      ...(page !== s2.page || pageSize !== s2.pageSize ? { activeCell: null } : {}),
      ...computeSearchMatches(s2.data, s2.columns, viewIndex, s2.visibleColumns, s2.searchText, s2.cellTypes, s2.searchOptions),
    };
  };

  const rowGestureAt = (
    s: DataGridStoreState,
    selection: GridSelection,
    anchor: number,
    base: CompactSelection,
    checked: boolean,
  ): RowRangeGesture => ({ anchor, edge: anchor, anchorRowId: rowIdAtViewRow(s, anchor), base, checked, rows: selection.rows, current: selection.current, viewIndex: s.viewIndex });

  /** Anchor for a Shift step without a live gesture: the former anchor row, else the active row, else the target. */
  const restartRowGesture = (s: DataGridStoreState, target: number): RowRangeGesture => {
    const previous = s.rowRangeGesture;
    const base = CompactSelection.adopt(s.selection.rows);
    if (previous?.anchorRowId !== undefined) {
      const dataRowIndex = rowIndexCache.resolveOne(s.data, s.getRowId, previous.anchorRowId);
      const anchor = dataRowIndex === undefined ? -1 : viewRowOfDataIndex(s.viewIndex, dataRowIndex);
      if (anchor >= 0) return rowGestureAt(s, s.selection, anchor, base, previous.checked);
    }
    return rowGestureAt(s, s.selection, Math.min(s.activeCell?.row ?? target, s.viewIndex.length - 1), base, true);
  };

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
    const dataRowIndex = rowIndexCache.resolveOne(data, getRowId, editing.rowId);
    const viewRow = dataRowIndex === undefined ? -1 : viewRowOfDataIndex(viewIndex, dataRowIndex);
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
    const prevRecord = recordKeyAt(s.viewIndex, active.row);
    const columnId = s.visibleColumns[active.col]?.id;
    if (prevRecord === undefined || columnId === undefined) return undefined;
    let row = active.row;
    if (typeof prevRecord === "string") {
      row = viewRowOfGroupId(viewIndex, prevRecord);
    } else if (sameRecordAt ? !sameRecordAt(active.row) : dataIndexOf(viewIndex, active.row) !== prevRecord) {
      const nextDataRow = toNextDataRow ? toNextDataRow(prevRecord) : prevRecord;
      row = nextDataRow === undefined ? -1 : viewRowOfDataIndex(viewIndex, nextDataRow);
    }
    const col = visibleColumns[active.col]?.id === columnId ? active.col : visibleColumns.findIndex((column) => column.id === columnId);
    if (row === -1 || col === -1) return undefined;
    return row === active.row && col === active.col ? active : { row, col };
  };
  /** The row channel and the hidden set carried into a rebuilt view; `visibleOnly` computes the channel when the hidden set is off. */
  const carryRows = (
    s: DataGridStoreState,
    rows: CompactSelectionLike,
    viewIndex: readonly number[],
    data: readonly unknown[],
    getRowId: (row: unknown, index: number) => string,
    sameRecords: boolean,
    visibleOnly: () => CompactSelectionLike,
  ): { rows: CompactSelectionLike; hiddenCheckedRowIds: ReadonlySet<string>; allMatching: boolean } => {
    if (!hiddenCheckedRowsActive(s)) return { rows: visibleOnly(), hiddenCheckedRowIds: s.hiddenCheckedRowIds, allMatching: s.allMatching };
    const carried = carryCheckedRows({
      rows,
      hidden: s.hiddenCheckedRowIds,
      prevData: s.data,
      prevViewIndex: s.viewIndex,
      prevGetRowId: s.getRowId,
      nextData: data,
      nextGetRowId: getRowId,
      nextViewIndex: viewIndex,
      resolveNextRowIds: () => rowIndexCache.resolve(data, getRowId),
      sameRecords,
      windowMode: windowModeActive(s),
      allMatching: s.allMatching,
    });
    if (carried.lazy) warnHiddenCheckedIgnored("while the grid holds unloaded rows (a lazy source)");
    if (carried.capped && !warnedHiddenCheckedCap) {
      warnedHiddenCheckedCap = true;
      warnDev(
        s.allMatching && !carried.allMatching
          ? `select all matching is cleared: more than ${MAX_HIDDEN_CHECKED_ROWS} rows were excluded`
          : `remembered checked rows are capped at ${MAX_HIDDEN_CHECKED_ROWS}; the rest are dropped`,
      );
    }
    return { rows: carried.lazy ? visibleOnly() : carried.rows, hiddenCheckedRowIds: carried.hidden, allMatching: carried.allMatching };
  };
  /**
   * The cursor, the open edit, and the selection carried into a rebuilt view. `sameRecords` keeps
   * data indices as identity (no `data` swap, or our own echo); otherwise records map by rowId, and
   * a duplicated rowId resolves to the first row with that id. The active cell follows its record and
   * column and clamps only when one of them left the view. The row channel follows its records, the
   * column channel its column ids. A range that now covers other records or columns collapses onto
   * the followed active cell; a clamp that moves the cursor collapses onto it, and a clamp in place
   * drops the range, so a row operation never reaches a record nobody selected.
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
          const prevDataRow = dataIndexAt(s, viewRow);
          const nextDataRow = dataIndexOf(viewIndex, viewRow);
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
    const carried = carryRows(s, base.rows, viewIndex, data, getRowId, sameRecords, () => remapRowChannel(base.rows, s.viewIndex, viewIndex, toNextDataRow));
    const { rows, hiddenCheckedRowIds, allMatching } = carried;
    const columns = remapColumnChannel(base.columns, s.visibleColumns, visibleColumns);
    const selection = rows === base.rows && columns === base.columns ? base : { ...base, rows, columns };
    return {
      ...(clamped ?? { activeCell: followed ?? null }),
      ...editRemap,
      ...(selection === s.selection ? {} : { selection }),
      ...(hiddenCheckedRowIds === s.hiddenCheckedRowIds ? {} : { hiddenCheckedRowIds }),
      ...(allMatching === s.allMatching ? {} : { allMatching }),
    };
  };
  const warnGateOnce = createWarnOnce();
  const rowValidation = createRowValidation({ getStore: () => store, rowIndexCache, gates, warnOnce: warnGateOnce });
  let editStartRun: GateRun | null = null;
  const cursorLeft = (now: DataGridStoreState, ref: CellRef, askedActive: ViewCoord | null): boolean => {
    if (now.readOnly) return true;
    const active = now.activeCell;
    if (active === askedActive) return false;
    const coord = resolveCellRef(now, rowIndexCache, ref);
    return !coord || !active || active.row !== coord.row || active.col !== coord.col;
  };
  const openEditor = (s: DataGridStoreState, coord: ViewCoord, rowId: string, columnId: string, initialText: string | undefined): void => {
    if (s.editing) store.getState().actions.cancelEditing();
    store.setState({
      editing: { coord, rowId, columnId, initialText, session: ++editSessionCount },
      editingError: null,
      editingRejectionCount: 0,
      activeCell: coord,
    });
  };
  /** Runs `onBeforeEditStart` for a cell, then `proceed` when it allows (at once for a sync verdict, after the promise for an async one). */
  const askEditStart = (s: DataGridStoreState, coord: ViewCoord, rowId: string, columnId: string, activation: boolean, proceed: (now: DataGridStoreState, coord: ViewCoord) => void): void => {
    const gate = s.onBeforeEditStart;
    if (gate) {
      if (editStartRun && !editStartRun.aborted) gates.abortRun(editStartRun, "superseded");
      const ref = { rowId, columnId };
      const run = gates.begin("onBeforeEditStart", (now) => cursorLeft(now, ref, s.activeCell));
      const verdict = gate({ ...ref, viewRowIndex: coord.row, viewColumnIndex: coord.col }, { signal: run.signal });
      if (verdict === false) return;
      if (isThenable<boolean | void>(verdict)) {
        editStartRun = run;
        holdEditStart(s, run, ref, activation, proceed, verdict);
        return;
      }
    }
    proceed(s, coord);
  };
  const holdEditStart = (s: DataGridStoreState, run: GateRun, ref: CellRef, activation: boolean, proceed: (now: DataGridStoreState, coord: ViewCoord) => void, verdict: PromiseLike<boolean | void>): void => {
    gates.hold(run);
    const askedActive = s.activeCell;
    const finish = (): boolean => {
      gates.settle(run);
      if (editStartRun === run) editStartRun = null;
      return !run.aborted;
    };
    verdict.then(
      (allowed) => {
        if (!finish() || allowed === false) return;
        const now = store.getState();
        if (now.readOnly) return;
        const coord = resolveCellRef(now, rowIndexCache, ref);
        if (!coord) return;
        const target = resolveEditTarget(now, coord);
        if (!target || Boolean(target.cellType.activate) !== activation || isColumnReadOnly(target.column, target.row)) return;
        const active = now.activeCell;
        if (active !== askedActive && !(active && active.row === coord.row && active.col === coord.col)) return;
        proceed(now, coord);
      },
      (error: unknown) => {
        if (!finish()) return;
        warnGateOnce("onBeforeEditStart rejected", () => `onBeforeEditStart rejected, so the edit does not start: ${toSafeText(error)}`);
      },
    );
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
  // Controlled selection: the flag mirrors the `selection` prop's presence on the last
  // sync; lastKnownSelection is the last emitted value, or the last applied controlled/default
  // value, in public SelectionState form - the fire guard and the _syncProps structural compare
  // both read it. The queue holds every emitted value no prop has confirmed yet, in emit order,
  // so a consumer lagging several drag steps behind never snaps the selection back.
  memory.selectionControlled = init.selection !== undefined;
  memory.lastKnownSelection = EMPTY_SELECTION_STATE;
  memory.selectionEchoQueue = [];
  memory.selectionPress = null;
  // The resolver's once-per-grid dev-warn flag (the resolveRefOrWarn convention).
  const warnedControlledSelection: ResolveWarnFlag = { value: false };
  // Partial-typed: the echo check is an identity match, and a consumer may feed back either a
  // fired snapshot (full) or its own partial value.
  memory.layoutEchoQueue = [];
  // Derivation is cached per channel identity: a range-drag step re-derives the three corner
  // refs only, and the rowIds/columnIds arrays keep their identity.
  let rowIdsDerivation: { rows: CompactSelectionLike; viewIndex: readonly number[]; data: readonly unknown[]; getRowId: (row: unknown, index: number) => string; rowIds: string[] } | null = null;
  let columnIdsDerivation: { columns: CompactSelectionLike; visibleColumns: readonly AnyColumnDef[]; columnIds: string[] } | null = null;
  if (init.checkedRowsLifetime === "across-filters" && init.totalRowCount === undefined && (initSortMode === "server" || initFilterMode === "server")) {
    warnHiddenCheckedIgnored("with sortMode=\"server\" or filterMode=\"server\" (the grid does not hold every row)");
  }
  const initGrouping = groupingOf({ groupBy: initGroupBy, expanded: initExpanded, groupMode: initGroupMode, serverGroupLayout: init.groupLayout ?? null, totalRowCount: init.totalRowCount, sortMode: initSortMode, dataWrite });
  const initViewIndex = computeViewIndex(initData, effectiveLayout.columns, viewSorts(initSortMode, initSortState), viewFilters(initFilterMode, initFilterState), undefined, initCellTypes, initPageSize === null ? null : { page: initPage, pageSize: initPageSize }, initSortLocale, initGrouping);
  // `selection` wins over `defaultSelection`, and both resolve here (not in the provider), so the
  // server render and the first client paint already show them.
  const initSelectionValue = init.selection ?? init.defaultSelection;
  if (init.selection !== undefined && init.defaultSelection !== undefined) warnDev("both `selection` and `defaultSelection` were provided; `selection` wins (controlled) and `defaultSelection` is ignored");
  let initialSelection = emptySelection();
  let initialActiveCell: ViewCoord | null = null;
  if (initSelectionValue) {
    const resolved = resolveSelectionState(
      { data: initData, getRowId: init.getRowId, viewIndex: initViewIndex, visibleColumns, selection: initialSelection },
      rowIndexCache,
      initSelectionValue,
      warnedControlledSelection,
    );
    initialSelection = resolved.grid;
    initialActiveCell = resolved.activeCell ?? null;
    memory.lastKnownSelection = resolved.selection;
  }
  let resultsAnnouncementArmed = false;
  const store = createStore<DataGridStoreState>((rawSet, get, api) => {
    const set = withGroupLayout(rawSet);
    /**
     * Derives the public SelectionState with per-channel caches (decision 4): a range-drag step
     * re-derives the three corner refs only, and the rowIds/columnIds arrays keep their identity
     * while their channels keep theirs.
     */
    const deriveCurrentSelection = (s: DataGridStoreState): SelectionState => {
      let rowIds: string[];
      const rowCache = rowIdsDerivation;
      if (rowCache && rowCache.rows === s.selection.rows && rowCache.viewIndex === s.viewIndex && rowCache.data === s.data && rowCache.getRowId === s.getRowId) {
        rowIds = rowCache.rowIds;
      } else {
        rowIds = deriveRowIds(s);
        rowIdsDerivation = { rows: s.selection.rows, viewIndex: s.viewIndex, data: s.data, getRowId: s.getRowId, rowIds };
      }
      let columnIds: string[];
      const columnCache = columnIdsDerivation;
      if (columnCache && columnCache.columns === s.selection.columns && columnCache.visibleColumns === s.visibleColumns) {
        columnIds = columnCache.columnIds;
      } else {
        columnIds = deriveColumnIds(s);
        columnIdsDerivation = { columns: s.selection.columns, visibleColumns: s.visibleColumns, columnIds };
      }
      const current = s.selection.current;
      if (!current) return { anchor: null, range: null, rangeStack: [], rowIds, columnIds };
      const refAt = (coord: ViewCoord) => cellRefAtViewCoord(s, coord);
      const rangeRef = (rect: GridRect): { start: { rowId: string; columnId: string }; end: { rowId: string; columnId: string } } => ({
        start: refAt({ row: rect.y, col: rect.x }),
        end: refAt({ row: rect.y + rect.height - 1, col: rect.x + rect.width - 1 }),
      });
      return {
        anchor: refAt(current.cell),
        range: rangeRef(current.range),
        rangeStack: current.rangeStack.map(rangeRef),
        rowIds,
        columnIds,
      };
    };
    /**
     * The one layout write-back point: merges `changedParts` over the current
     * layout, normalizes it, and structurally compares the result with the always-current
     * s.columnLayout snapshot - equal: no set, no event; else one set (pins/widths/order/hidden/
     * visible columns/snapshot) plus one onColumnLayoutChange. Live resize frames never run
     * through here (previewColumnWidth).
     */
    const commitLayout = (given: Partial<ColumnLayout>): void => {
      if (!isColumnLayoutObject(given)) return;
      const changedParts = sanitizeColumnLayout(given);
      const s = get();
      const pins = pinsOf(s.columns);
      const merged: ColumnLayoutParts = {
        widths: changedParts.widths ?? s.columnWidths,
        order: changedParts.order !== undefined ? changedParts.order : s.columnOrder,
        pins: changedParts.pins !== undefined ? changedParts.pins : pins,
        hidden: changedParts.hidden ?? [...s.hiddenColumns],
      };
      const normalized = normalizeColumnLayout(s.columns, merged, defHiddenColumnIds(s.columns));
      const snapshot = computeColumnLayout(normalized.columns, normalized.columnOrder, normalized.columnWidths, normalized.hiddenColumns);
      if (layoutSnapshotsEqual(snapshot, s.columnLayout)) return;
      const nextVisibleColumns = computeVisibleColumns(normalized.columns, normalized.columnOrder, normalized.hiddenColumns);
      const columnsChanged = changedParts.order !== undefined || changedParts.pins !== undefined || changedParts.hidden !== undefined;
      set({
        columns: normalized.columns,
        columnWidths: normalized.columnWidths,
        columnOrder: normalized.columnOrder,
        hiddenColumns: normalized.hiddenColumns,
        visibleColumns: nextVisibleColumns,
        columnLayout: snapshot,
        ...(columnsChanged
          ? {
              // A columns-moving commit re-runs the cursor/selection remap and the search-match
              // row map.
              ...followView(s, s.viewIndex, nextVisibleColumns),
              ...computeSearchMatches(s.data, normalized.columns, s.viewIndex, nextVisibleColumns, s.searchText, s.cellTypes, s.searchOptions),
            }
          : {}),
      });
      // Keep the sync baseline current: the controlled echo re-render that follows the commit
      // must early-return instead of paying a one-time view recompute.
      memory.lastSyncInputs = { ...memory.lastSyncInputs, columns: normalized.columns, columnOrder: normalized.columnOrder, hiddenColumns: normalized.hiddenColumns };
      if (s.onColumnLayoutChange) memory.layoutEchoQueue.push(snapshot);
      emitAfterWrites(dataWrite, () => s.onColumnLayoutChange?.(snapshot));
    };
    const commitSorts = (s: DataGridStoreState, requested: DataGridStoreState["sortState"]): void => {
      const sorts = dropUnknownSorts(requested, s.columns);
      if (!s.viewStale && sortSpecKey(sorts) === sortSpecKey(s.sortState)) return;
      // Controlled: _syncProps writes the consumer's next `sortState` prop.
      if (!s.sortControlled) {
        set((s2) => {
          const viewIndex = computeViewIndex(s2.data, s2.columns, viewSorts(s2.sortMode, sorts), viewFilters(s2.filterMode, s2.filterState), s2.viewIndex, s2.cellTypes, viewWindowOf(s2), s2.sortLocale, groupingOf(s2));
          resetDeferredRows(dataWrite);
          return {
            sortState: sorts,
            viewIndex,
            ...clearStaleRows(dataWrite),
            ...followView(s2, viewIndex, s2.visibleColumns),
            ...computeSearchMatches(s2.data, s2.columns, viewIndex, s2.visibleColumns, s2.searchText, s2.cellTypes, s2.searchOptions),
          };
        });
      }
      emitAfterWrites(dataWrite, () => s.onSortChange?.(sorts));
    };
    // Resolved at creation so the server render has the band heights, `aria-rowcount`, and the
    // merged keymap/commands; the config phase re-resolves on change only.
    const initPlugins = resolvePluginsList(init.plugins, api, pluginWarnOnce);
    const initKeymap = mergePluginKeymaps(initPlugins.list, init.keymap, pluginWarnOnce, init.commands);
    const initCommands = mergePluginCommands(initPlugins.list, init.commands, pluginWarnOnce);
    if (isDev()) {
      validateKeymap(initKeymap);
      validateSharedBindings(initKeymap);
    }
    const syncPhase = createSyncPhase(set, get, api, memory, {
      dataWrite,
      rowIndexCache,
      rowValidation,
      followView,
      announceChecked,
      mergeLabels,
      pluginWarnOnce,
      warnStoreOnce,
      warnHiddenCheckedIgnored,
      warnedControlledSelection,
      warnGroupIssues,
      completeColumnOrder,
      computeColumnLayout,
      computeVisibleColumns,
      normalizeColumnLayout,
    });
    const dataWriteActions = createDataWriteActions(set, get, {
      ctx: dataWrite,
      applyRowValidation: rowValidation.apply,
      pruneRowValidationKeys: rowValidation.prune,
      followView,
      carryRows,
      remapEditing,
      endEditSession,
      renameRowKeys: rowValidation.renameRow,
    });
    const { _deleteCellsById, _commitCellEdit, _commitChange, _skipRowAction, _commitActivation, ...otherWriteActions } = dataWriteActions;
    const publicWriteActions = {
      ...otherWriteActions,
      updateCells: (patches: readonly CellPatch[], options: UpdateCellsOptions) => streamQueue.hold(patches, options, otherWriteActions.updateCells(patches, options)),
      commitCellEdit: (value: unknown, movement?: { dx: number; dy: number }) => _commitCellEdit(value, movement),
    };
    const internal: DataGridInternalActions = {
      _deleteCellsById,
      _skipRowAction,
      _commitCellEdit,
      _commitChange,
      _activateCellAt(coord) {
        const s = get();
        if (s.readOnly) return;
        const target = resolveEditTarget(s, coord);
        const activate = target?.cellType.activate;
        if (!target || !activate || isColumnReadOnly(target.column, target.row)) return;
        askEditStart(s, coord, s.getRowId(target.row, target.dataRowIndex), target.column.id, true, (now, at) => {
          const fresh = resolveEditTarget(now, at);
          if (!fresh) return;
          const value = getCellValue<unknown, typeof fresh.column>(fresh.row, fresh.column);
          const committed = _commitActivation(at, activate(value, fresh.column.options));
          const onEditEnd = now.onEditEnd;
          if (committed === null || !onEditEnd) return;
          const ended = { rowId: now.getRowId(fresh.row, fresh.dataRowIndex), columnId: fresh.column.id, viewRowIndex: at.row, viewColumnIndex: at.col };
          emitAfterWrites(dataWrite, () => onEditEnd({ ...ended, result: committed ? "commit" : "rejected" }));
        });
      },
      _armRowDragAnchor(index) {
        const s = get();
        if (!s.enableRowSelection) return;
        const base = CompactSelection.adopt(s.selection.rows);
        set({ lastHighlightedRow: index, rowRangeGesture: rowGestureAt(s, s.selection, index, base, !base.hasIndex(index)) });
      },
      _setEditingError(message) {
        const s = get();
        if (!s.editing) return;
        const editing = s.editing;
        set({ editingError: message, editingRejectionCount: s.editingRejectionCount + 1 });
        emitAfterWrites(dataWrite, () => s.onEditEnd?.({ rowId: editing.rowId, columnId: editing.columnId, viewRowIndex: editing.coord.row, viewColumnIndex: editing.coord.col, result: "rejected" }));
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
      _armResultsAnnouncement() {
        resultsAnnouncementArmed = true;
      },
      _cancelSelection() {
        const s = get();
        if (editStartRun) gates.abortRun(editStartRun, "cancelled");
        gates.abort(["processPaste", "validate"], "cancelled");
        if (isSelectionEmpty(s.selection) && s.hiddenCheckedRowIds.size === 0 && !s.allMatching) return;
        set({
          selection: emptySelection(),
          ...announceChecked(s, { selection: emptySelection(), ...NO_REMEMBERED_ROWS }),
          ...NO_REMEMBERED_ROWS,
          rowRangeGesture: null,
        });
      },
      _moveActiveCell(d, opts) {
        const s = get();
        const active = s.activeCell ?? { col: 0, row: 0 };
        const maxRow = Math.max(0, s.viewIndex.length - 1);
        const maxCol = Math.max(0, s.visibleColumns.length - 1);
        if (opts?.extend && s.enableRangeSelection) {
          // Grow from the anchor's far edge; the anchor stays put for the whole extend gesture.
          const direction: ExtendDirection = d.dy < 0 ? "up" : d.dy > 0 ? "down" : d.dx < 0 ? "left" : "right";
          const selection = extendSelection(s.selection.current ? s.selection : selectCellOf(s, active), direction, {
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
            set({ activeCell: next, selection: selectCellOf(s, next), lastHighlightedRow: next.row, lastHighlightedCol: next.col });
          }
        }
      },
      _syncConfig: (props) => syncPhase.syncConfig(props),
      _syncProps: (props) => syncPhase.syncProps(props),
      _syncPluginClaims() {
        const list = memory.lastPluginsProp;
        if (memory.releasePluginClaims && pluginsListEqual(list, memory.claimedPlugins)) return;
        memory.releasePluginClaims?.();
        const claim = claimPluginAttachments(list ?? [], api, pluginWarnOnce);
        memory.releasePluginClaims = claim.release;
        memory.claimedPlugins = list;
        const resolved = resolvePluginsList(claim.kept, api, pluginWarnOnce);
        if (pluginsListEqual(resolved.list, get().plugins.list)) return;
        set({
          plugins: resolved,
          keymap: mergePluginKeymaps(resolved.list, memory.lastKeymapProp, pluginWarnOnce, memory.lastCommandsProp),
          commands: mergePluginCommands(resolved.list, memory.lastCommandsProp ?? undefined, pluginWarnOnce),
        });
      },
      _armWrites() {
        dataWrite.disposed = false;
      },
      _disposeWrites() {
        dataWrite.disposed = true;
        dataWrite.frame.cancel();
        dataWrite.abortConflicts?.();
        gates.abort();
      },
      _gates: () => gates,
      _releasePluginClaims() {
        memory.releasePluginClaims?.();
        memory.releasePluginClaims = null;
      },
      _subscribeEditEnd() {
        return api.subscribe((state, prev) => {
          const ended = prev.editing;
          const onEditEnd = state.onEditEnd;
          if (ended === null || state.editing !== null || ended === selfReportedSession || !onEditEnd) return;
          emitFromListener("onEditEnd", () => onEditEnd({ rowId: ended.rowId, columnId: ended.columnId, viewRowIndex: ended.coord.row, viewColumnIndex: ended.coord.col, result: "cancel" }));
        });
      },
      _subscribeSelection() {
        return api.subscribe((state, prev) => {
          if (state.selection === prev.selection) return;
          // Decision 3: derive only when someone reads the value - a callback or the controlled
          // prop (which keeps lastKnownSelection fresh for the _syncProps structural compare).
          if (!state.onSelectionChange && !memory.selectionControlled) return;
          const derived = deriveCurrentSelection(state);
          if (selectionStatesEqual(derived, memory.lastKnownSelection)) return;
          // A group re-layout moves checked rows in and out of the view; the cells and the checked rows stay the same.
          if (state.groupLayout !== prev.groupLayout && selectionStatesEqual({ ...derived, rowIds: EMPTY_ROW_IDS }, { ...memory.lastKnownSelection, rowIds: EMPTY_ROW_IDS })) {
            memory.lastKnownSelection = derived;
            return;
          }
          // Updated BEFORE the callback so a gesture fired from inside onSelectionChange compares
          // against the value it just read, and an applied controlled value re-derives equal and
          // stays silent (decisions 3 and 4).
          memory.lastKnownSelection = derived;
          const onSelectionChange = state.onSelectionChange;
          if (!onSelectionChange) return;
          memory.selectionEchoQueue.push(derived);
          if (memory.selectionEchoQueue.length > 128) memory.selectionEchoQueue.shift();
          // The press's own change is settled unless the pointer moves on; only the later steps report "drag".
          const press = memory.selectionPress;
          const phase = press?.pressed ? "drag" : "end";
          if (press) Object.assign(press, { changed: press.pressed, pressed: true });
          emitFromListener("onSelectionChange", () => onSelectionChange(derived, makeSelectionChangeDetails(() => api.getState(), phase)));
        });
      },
      _setSelectionPress(pressed) {
        const press = memory.selectionPress;
        memory.selectionPress = pressed ? (press ?? { pressed: false, changed: false }) : null;
        const onSelectionChange = get().onSelectionChange;
        if (pressed || !press?.changed || !onSelectionChange) return;
        const settled = memory.lastKnownSelection;
        emitFromListener("onSelectionChange", () => onSelectionChange(settled, makeSelectionChangeDetails(() => api.getState(), "end")));
      },
      _deriveSelection() {
        return deriveCurrentSelection(get());
      },
      _registerScrollToCell(impl) {
        set({ scrollToCellImpl: impl });
      },
      _registerFocus(impl) {
        set({ focusImpl: impl });
      },
      _registerRunShortcut(impl) {
        set({ runShortcutImpl: impl });
      },
      _registerFocusSearch(impl) {
        set({ focusSearchImpl: impl });
        return () => {
          if (get().focusSearchImpl === impl) set({ focusSearchImpl: null });
        };
      },
      _registerMeasureFonts(impl) {
        set({ measureFonts: impl });
      },
    };
    registerInternalActions(api, internal);

    return {
    ...init,
    ...resolveSelectionConfig(init),
    // storage widens each per-column CellType<TData, TValue, TOptions> to the untyped registry shape; narrowed back per column at lookup (cell.tsx/store's column-op helpers).
    cellTypes: initCellTypes,
    columns: effectiveLayout.columns,
    data: initData,
    dataControlled,
    // A resolved `selection`/`defaultSelection` seeds both the selection and the initial cursor.
    activeCell: initialActiveCell,
    selection: initialSelection,
    selectAllStage: null,
    ...NO_REMEMBERED_ROWS,
    saveStatus: EMPTY_SAVE_STATUS,
    pendingSaveCount: 0,
    gatesPending: EMPTY_GATES_PENDING,
    editing: null,
    editingError: null,
    editingRejectionCount: 0,
    cellErrors: EMPTY_CELL_ERRORS,
    flashingCells: EMPTY_FLASHING_CELLS,
    selectionPointer: "keyboard",
    lastHighlightedRow: null,
    rowRangeGesture: null,
    lastHighlightedCol: null,
    columnWidths: effectiveLayout.columnWidths,
    columnOrder: effectiveLayout.columnOrder,
    hiddenColumns: effectiveLayout.hiddenColumns,
    columnLayout: computeColumnLayout(effectiveLayout.columns, effectiveLayout.columnOrder, effectiveLayout.columnWidths, effectiveLayout.hiddenColumns),
    columnGroupModel: memory.groupModel,
    sortState: initSortState,
    sortMode: initSortMode,
    sortLocale: initSortLocale,
    filterMode: initFilterMode,
    filterState: initFilterState,
    searchText: initSearchText,
    searchOptions: initSearchOptions,
    sortControlled: init.sortState !== undefined,
    filterControlled: init.filterState !== undefined,
    groupBy: initGroupBy,
    expanded: initExpanded,
    groupMode: initGroupMode,
    serverGroupLayout: init.groupLayout ?? null,
    groupLayout: groupLayoutOfView(initViewIndex),
    groupingEnabled: init.groupBy !== undefined || init.defaultGroupBy !== undefined || init.onGroupByChange !== undefined,
    groupByControlled: init.groupBy !== undefined,
    expandedControlled: init.expanded !== undefined,
    page: initPage,
    pageSize: initPageSize,
    pageControlled: init.page !== undefined,
    pageSizeControlled: init.pageSize !== undefined,
    onPageChange: init.onPageChange,
    onPageSizeChange: init.onPageSizeChange,
    searchControlled: init.searchText !== undefined,
    ...computeSearchMatches(initData, effectiveLayout.columns, initViewIndex, visibleColumns, initSearchText, initCellTypes, initSearchOptions),
    viewIndex: initViewIndex,
    rowIdentityVersion: 0,
    viewStale: false,
    staleRowIds: NO_STALE_ROWS,
    visibleColumns,
    scrollToCellImpl: null,
    focusImpl: null,
    runShortcutImpl: null,
    focusSearchImpl: null,
    measureFonts: null,
    dataWrite,
    plugins: initPlugins,
    // Seeded from the sync props so SSR and the first client paint already see them.
    readOnly: Boolean(init.readOnly),
    keymap: initKeymap,
    commands: initCommands,
    locale: initLocale,
    labels: mergeLabels(init.labels, initLocale),
    rowMoveAnnouncement: "",
    liveAnnouncement: null,
    announceResults: init.announceResults ?? false,
    actions: {
      ...createGroupActions({ set, get, dataWrite, followView, memory }),
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
        if (coord) set({ activeCell: coord, selection: selectCellOf(get(), coord) });
      },
      selectCellAt(coord) {
        set({ activeCell: coord, selection: selectCellOf(get(), coord) });
      },
      extendTo(ref) {
        const coord = resolveRefOrWarn(dataWrite, get(), ref);
        if (coord) get().actions.extendToAt(coord);
      },
      extendToAt(coord) {
        set((s) => {
          // enableRangeSelection: false collapses any drag/shift-extend gesture to single-cell active only.
          if (!s.enableRangeSelection) return { selection: selectCellOf(s, coord), activeCell: coord };
          const selection = s.selection.current ? extendTo(s.selection, coord) : selectCellOf(s, coord);
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
          if (!s.enableMultiRange) return { selection: selectCellOf(s, coord), activeCell: coord };
          // pushRange moves the anchor to `coord`; keep activeCell in sync with it.
          return { selection: pushRange(s.selection, coord), activeCell: coord };
        });
      },
      selectRow(index, opts = {}) {
        const s = get();
        const { lastHighlightedRow, selection, enableRowSelection, enableMultiRange, enableRangeSelection } = s;
        if (!enableRowSelection) return;
        // Without multi-range or range selection, ctrl-click and shift-click toggle only this row.
        const additive = opts.additive && enableMultiRange;
        const extendFromLast = opts.extendFromLast && enableRangeSelection;
        const next = selectRowPure(selection, index, {
          additive,
          extendFromLast,
          from: opts.from ?? lastHighlightedRow ?? undefined,
        });
        const unchanged = next.rows.equals(selection.rows);
        const rows = unchanged ? selection.rows : next.rows;
        const written = unchanged && next.columns.equals(selection.columns) && next.current === selection.current ? selection : { ...next, rows };
        // A plain number click checks only this row, so it cannot leave every unloaded row selected.
        const endsAllMatching = s.allMatching && !additive && !extendFromLast;
        set({
          selection: written,
          ...announceChecked(s, { selection: written, ...(endsAllMatching ? NO_REMEMBERED_ROWS : {}) }),
          ...(endsAllMatching ? NO_REMEMBERED_ROWS : {}),
          lastHighlightedRow: index,
          rowRangeGesture: extendFromLast
            ? null
            : rowGestureAt(s, written, index, additive ? CompactSelection.adopt(selection.rows) : CompactSelection.empty(), additive ? next.rows.hasIndex(index) : true),
        });
      },
      checkRowRange(target, opts = {}) {
        const s = get();
        const { selection, viewIndex, enableRowSelection, enableRangeSelection } = s;
        if (!enableRowSelection || viewIndex.length === 0) return;
        const clamped = clampIndex(target, viewIndex.length - 1);
        // Without range selection a Shift click only selects the row it hits.
        if (!enableRangeSelection) {
          get().actions.selectRow(clamped);
          return;
        }
        const live = isRowRangeLive(s.rowRangeGesture, selection, viewIndex);
        let gesture = live ? s.rowRangeGesture! : restartRowGesture(s, clamped);
        const channel = selection.rows instanceof CompactSelection ? selection.rows : null;
        if (live && opts.commit && channel) gesture = { ...gesture, base: channel };
        const computed = applyRowRange(gesture, clamped);
        const rows = channel && computed.equals(channel) ? selection.rows : computed;
        const rowRangeGesture = { ...gesture, rows, current: null, edge: clamped };
        if (rows === selection.rows && selection.current === null) {
          if (!live || opts.commit || gesture.edge !== clamped) set({ rowRangeGesture });
          return;
        }
        const nextSelection = { ...selection, current: null, rows };
        set({ selection: nextSelection, ...announceChecked(s, { selection: nextSelection }), rowRangeGesture });
      },
      selectColumn(index, opts = {}) {
        const s = get();
        const { lastHighlightedCol, selection, enableColumnSelection, enableMultiRange, enableRangeSelection } = s;
        if (!enableColumnSelection) return;
        const additive = opts.additive && enableMultiRange;
        const extendFromLast = opts.extendFromLast && enableRangeSelection;
        const picked = selectColumnPure(selection, index, { additive, extendFromLast, from: lastHighlightedCol ?? undefined });
        const next = keepsCheckedRows(s) ? { ...picked, rows: selection.rows } : picked;
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
          const dataRowIndex = dataIndexAt(s, coord.row);
          const row = dataRowIndex === undefined ? undefined : s.data[dataRowIndex];
          if (row === undefined) return true;
          const cellType = s.cellTypes[column.type ?? "text"];
          if (!cellType) return true;
          const value = getCellValue<unknown, typeof column>(row, column);
          return cellType.isEmpty(value);
        };
        const result = selectAllProgression(s.selection, s.viewIndex.length, s.visibleColumns.length, active, isEmptyAt, priorStage);
        set({
          selection: result.selection,
          ...announceChecked(s, { selection: result.selection, ...NO_REMEMBERED_ROWS }),
          ...(s.hiddenCheckedRowIds.size > 0 || s.allMatching ? NO_REMEMBERED_ROWS : {}),
          selectAllStage: { stage: result.stage, selection: result.selection, activeCell: active },
        });
      },
      setRowChecked(rowId, checked) {
        const s = get();
        warnViewIndexIds(dataWrite, [rowId], "setRowChecked");
        const dataRowIndex = rowIndexCache.resolveOne(s.data, s.getRowId, rowId);
        const viewRow = dataRowIndex === undefined ? -1 : viewRowOfDataIndex(s.viewIndex, dataRowIndex);
        if (viewRow >= 0) get().actions.setRowCheckedAt(viewIndex(viewRow), checked);
      },
      setRowCheckedAt(index, checked) {
        const s = get();
        const { selection, enableRowSelection, enableMultiRange } = s;
        if (!enableRowSelection) return;
        const base = CompactSelection.adopt(selection.rows);
        const next = checked ? { ...selection, rows: base.add(index) } : removeRowFromSelection(selection, index, { multiRange: enableMultiRange });
        set({ selection: next, ...announceChecked(s, { selection: next }), rowRangeGesture: rowGestureAt(s, next, index, base, checked) });
      },
      setAllRowsChecked(checked) {
        const s = get();
        const { selection, viewIndex, enableRowSelection } = s;
        if (!enableRowSelection) return;
        if (checked && s.checkedRowsLifetime === "across-filters" && s.totalRowCount !== undefined && viewHoldsUnloadedRows(s)) {
          get().actions.selectAllMatching();
          return;
        }
        const rows = checked ? CompactSelection.fromSingleSelection([0, viewIndex.length]) : CompactSelection.empty();
        const next = { ...selection, rows };
        set({
          selection: next,
          ...announceChecked(s, { selection: next, ...(checked ? {} : NO_REMEMBERED_ROWS) }),
          rowRangeGesture: null,
          ...(checked ? {} : NO_REMEMBERED_ROWS),
        });
      },
      selectAllMatching() {
        const s = get();
        if (!s.enableRowSelection) return { ok: false, reason: "disabled" };
        const total = matchingRowTotal(s);
        if (total === undefined) {
          if (s.sortMode === "server" || s.filterMode === "server" || viewHoldsUnloadedRows(s)) return { ok: false, reason: "needs-total-row-count" };
          get().actions.setAllRowsChecked(true);
          return { ok: true };
        }
        if (s.checkedRowsLifetime !== "across-filters") return { ok: false, reason: "needs-across-filters" };
        const next = { ...s.selection, rows: CompactSelection.fromSingleSelection([0, s.viewIndex.length]) };
        set({
          selection: next,
          liveAnnouncement:
            typeof total === "number"
              ? nextAnnouncement(s.liveAnnouncement, "rowsChecked", total)
              : nextAnnouncement(s.liveAnnouncement, "rowsChecked", s.viewIndex.length, true),
          rowRangeGesture: null,
          hiddenCheckedRowIds: NO_HIDDEN_CHECKED_ROWS,
          allMatching: true,
        });
        return { ok: true };
      },
      clearSelection() {
        const s = get();
        if (isSelectionEmpty(s.selection) && s.hiddenCheckedRowIds.size === 0 && !s.allMatching) return;
        set({ selection: emptySelection(), ...NO_REMEMBERED_ROWS, rowRangeGesture: null });
      },
      clearCellSelection() {
        const { selection } = get();
        if (!selection.current && selection.columns.length === 0) return;
        set({ selection: { ...emptySelection(), rows: selection.rows } });
      },
      setSelection(next) {
        const s = get();
        if (next === null) {
          if (isSelectionEmpty(s.selection) && s.hiddenCheckedRowIds.size === 0 && !s.allMatching) return;
          set({ selection: emptySelection(), ...NO_REMEMBERED_ROWS, rowRangeGesture: null });
          return;
        }
        const resolved = resolveSelectionState(s, rowIndexCache, next, warnedControlledSelection);
        if (resolved.grid === s.selection) return;
        set({
          selection: resolved.grid,
          ...(isSelectionEmpty(resolved.grid) ? NO_REMEMBERED_ROWS : {}),
          ...(resolved.activeCell !== undefined ? { activeCell: resolved.activeCell } : {}),
        });
      },
      previewColumnWidth(id, width) {
        const column = get().columns.find((c) => c.id === id);
        if (!column) return;
        const next = clampColumnWidth(column, width);
        if (!resizeStartWidths.has(id)) resizeStartWidths.set(id, savedColumnWidth(get().columnWidths, id));
        set((s) => ({ columnWidths: { ...s.columnWidths, [id]: next } }));
        const onColumnResizing = get().onColumnResizing;
        if (onColumnResizing) emitAfterWrites(dataWrite, () => onColumnResizing({ columnId: id, width: next }));
      },
      cancelColumnResize(id, renderedWidth) {
        if (!resizeStartWidths.has(id)) return;
        const startWidth = resizeStartWidths.get(id);
        resizeStartWidths.delete(id);
        const { [id]: _preview, ...rest } = get().columnWidths;
        set({ columnWidths: startWidth === undefined ? rest : { ...rest, [id]: startWidth } });
        const onColumnResizing = get().onColumnResizing;
        if (onColumnResizing) emitAfterWrites(dataWrite, () => onColumnResizing({ columnId: id, width: renderedWidth }));
      },
      setColumnWidth(id, width) {
        resizeStartWidths.delete(id);
        const s = get();
        const column = s.columns.find((c) => c.id === id);
        if (!column) return;
        const next = clampColumnWidth(column, width);
        commitLayout({ widths: { ...s.columnWidths, [id]: next } });
      },
      autosizeColumns(options) {
        const s = get();
        const context = s.measureFonts ? s.measureFonts() : null;
        if (!context) return {};
        const measured = computeAutosizeWidths(
          {
            columns: s.columns,
            visibleColumns: s.visibleColumns,
            hiddenColumns: s.hiddenColumns,
            columnWidths: s.columnWidths,
            viewIndex: s.viewIndex,
            data: s.data,
            cellTypes: s.cellTypes,
            sortState: s.sortState,
            enableColumnResize: s.enableColumnResize,
            hasHeaderMenu: context.hasHeaderMenu,
            hasHeaderFilter: context.hasHeaderFilter,
          },
          { cellFont: context.cellFont, headerFont: context.headerFont, cellPadding: context.cellPadding },
          context.window,
          options,
        );
        const changed = Object.entries(measured).filter(([id, width]) => {
          const column = s.columns.find((c) => c.id === id);
          return column !== undefined && resolveColumnWidth(column, savedColumnWidth(s.columnWidths, id)) !== width;
        });
        if (changed.length > 0) {
          commitLayout({ widths: { ...s.columnWidths, ...Object.fromEntries(changed) } });
        }
        return measured;
      },
      resetColumnWidth(id) {
        const s = get();
        if (savedColumnWidth(s.columnWidths, id) === undefined) return;
        const { [id]: _dropped, ...columnWidths } = s.columnWidths;
        commitLayout({ widths: columnWidths });
      },
      setColumnOrder(id, targetId, position) {
        const { result, order } = planColumnOrder(get(), memory.groupModel, id, targetId, position);
        if (order) commitLayout({ order });
        return result;
      },
      canSetColumnOrder(id, targetId, position) {
        return planColumnOrder(get(), memory.groupModel, id, targetId, position).result;
      },
      setColumnPin(id, requestedPin) {
        const s = get();
        if (!s.enableColumnPinning) return;
        const pin = requestedPin === null ? null : (readColumnPin(requestedPin, warnStoreOnce) ?? null);
        const column = s.columns.find((c) => c.id === id);
        if (!column || !columnFlag(column, "pinnable") || (column.pin ?? null) === pin) return;
        const nextColumns = s.columns.map((c) => (c.id === id ? { ...c, pin: pin ?? undefined } : c));
        commitLayout({ pins: pinsOf(nextColumns) });
      },
      setColumnHidden(id, hidden) {
        const s = get();
        if (!s.columns.some((c) => c.id === id) || s.hiddenColumns.includes(id) === hidden) return;
        const current = new Set(s.hiddenColumns);
        if (hidden) current.add(id);
        else current.delete(id);
        const nextHidden = Array.from(current);
        resetDeferredRows(dataWrite);
        commitLayout({ hidden: nextHidden });
      },
      resetColumnLayout() {
        const defs = memory.lastPropsColumns;
        commitLayout({ widths: {}, order: [], pins: pinsOf(defs), hidden: defHiddenColumnIds(defs) });
      },
      setColumnLayout(parts) {
        commitLayout(parts);
      },
      toggleSort(columnId, { additive = false } = {}) {
        const s = get();
        const existing = s.sortState.find((sort) => sort.columnId === columnId);
        const direction = nextDirection(existing?.direction);
        const sorts = additive
          ? toggleSortAdditive(s.sortState, columnId, direction)
          : direction === null
            ? []
            : [{ columnId, direction }];
        commitSorts(s, sorts);
      },
      setPage(page) {
        const s = get();
        if (s.pageSize === null || !Number.isFinite(page)) return;
        const next = Math.max(1, Math.floor(page));
        if (next === s.page) return;
        if (!s.pageControlled) set((s2) => rebuildPageView(s2, next, s2.pageSize));
        emitAfterWrites(dataWrite, () => s.onPageChange?.(next));
      },
      setPageSize(pageSize) {
        const s = get();
        if (pageSize === null) {
          if (s.pageSize === null) return;
          if (!s.pageSizeControlled || !s.pageControlled) {
            set((s2) => rebuildPageView(s2, s2.pageControlled ? s2.page : 1, s2.pageSizeControlled ? s2.pageSize : null));
          }
          emitAfterWrites(dataWrite, () => s.onPageSizeChange?.(null), () => {
            if (s.page !== 1) s.onPageChange?.(1);
          });
          return;
        }
        if (!Number.isFinite(pageSize) || pageSize < 1) return;
        const size = Math.floor(pageSize);
        if (size === s.pageSize) return;
        const firstRow = s.pageSize === null ? 0 : (effectivePage(s.page, pageUnitsOf(fullViewOf(s.viewIndex)), s.pageSize) - 1) * s.pageSize;
        const page = Math.floor(firstRow / size) + 1;
        if (!s.pageSizeControlled || !s.pageControlled) {
          set((s2) => rebuildPageView(s2, s2.pageControlled ? s2.page : page, s2.pageSizeControlled ? s2.pageSize : size));
        }
        emitAfterWrites(dataWrite, () => s.onPageSizeChange?.(size), () => {
          if (page !== s.page) s.onPageChange?.(page);
        });
      },
      setSorts(sorts) {
        commitSorts(get(), sorts);
      },
      setFilters(filters) {
        const s = get();
        // backfills a filterId for any row the caller added without one (e.g. hand-built controlled updates).
        const withIds = withMatchCase(withFilterIds(dropUnknownFilters(filters, s.columns)), s.columns, s.cellTypes);
        if (!s.viewStale && filterSpecKey(withIds) === filterSpecKey(s.filterState)) return;
        const resetPage = s.pageSize !== null && s.page !== 1 && filterSpecKey(withIds) !== filterSpecKey(s.filterState);
        if (!s.filterControlled) {
          set((s2) => {
            const page = resetPage && !s2.pageControlled ? 1 : s2.page;
            const viewIndex = computeViewIndex(s2.data, s2.columns, viewSorts(s2.sortMode, s2.sortState), viewFilters(s2.filterMode, withIds), s2.viewIndex, s2.cellTypes, s2.pageSize === null ? null : { page, pageSize: s2.pageSize }, s2.sortLocale, groupingOf(s2));
            resetDeferredRows(dataWrite);
            return {
              page,
              filterState: withIds,
              viewIndex,
              ...clearStaleRows(dataWrite),
              ...followView(s2, viewIndex, s2.visibleColumns),
              ...computeSearchMatches(s2.data, s2.columns, viewIndex, s2.visibleColumns, s2.searchText, s2.cellTypes, s2.searchOptions),
              ...(s2.allMatching && filterSpecKey(withIds) !== filterSpecKey(s2.filterState) ? endAllMatching(s2.selection) : {}),
            };
          });
        }
        emitAfterWrites(dataWrite, () => s.onFilterChange?.(withIds), () => {
          if (resetPage) s.onPageChange?.(1);
        });
      },
      setSearch(text, options) {
        const s = get();
        const searchOptions = options ? { ...s.searchOptions, ...options } : s.searchOptions;
        const optionsChanged = searchOptions.matchCase !== s.searchOptions.matchCase || searchOptions.wholeCell !== s.searchOptions.wholeCell;
        if (!s.searchControlled || optionsChanged) {
          const nextText = s.searchControlled ? s.searchText : text;
          // viewIndex is untouched: quick-search highlights + navigates, it never filters.
          set((s2) => ({
            searchText: nextText,
            searchOptions,
            ...(nextText !== s2.searchText && dataWrite.staleRows.size > 0 ? clearStaleRows(dataWrite) : {}),
            ...computeSearchMatches(s2.data, s2.columns, s2.viewIndex, s2.visibleColumns, nextText, s2.cellTypes, searchOptions),
            ...(s2.allMatching && nextText !== s2.searchText ? endAllMatching(s2.selection) : {}),
          }));
        }
        if (text !== s.searchText) emitAfterWrites(dataWrite, () => s.onSearchTextChange?.(text));
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
        const rowId = s.getRowId(target.row, target.dataRowIndex);
        askEditStart(s, coord, rowId, target.column.id, false, (now, at) => openEditor(now, at, rowId, target.column.id, initialText));
      },
      cancelEditing() {
        const s = get();
        if (editStartRun) gates.abortRun(editStartRun, "cancelled");
        if (!s.editing) {
          set({ editingError: null });
          return;
        }
        const editing = s.editing;
        endEditSession(editing, () => set({ editing: null, editingError: null }));
        emitAfterWrites(dataWrite, () => s.onEditEnd?.({ rowId: editing.rowId, columnId: editing.columnId, viewRowIndex: editing.coord.row, viewColumnIndex: editing.coord.col, result: "cancel" }));
      },
      // The data-write cluster (see data-write.ts): the edit commits, the bulk writers, and the row operations.
      ...publicWriteActions,
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
    },
    };
  });
  // Handed to the plugin onDataChange observers (writeThenEmit); after creation, so the handle's
  // eager state read resolves.
  dataWrite.pluginApi = apiHandleOf(store);
  // Filter and sort settle the view in the same write as the spec change. Speak only when the rows or the sort order changed.
  const sortKey = (s: DataGridStoreState) => JSON.stringify(s.sortState);
  const sameRows = (a: readonly number[], b: readonly number[]) => a === b || (a.length === b.length && a.every((v, i) => v === b[i]));
  let staleAnnouncedAt = -Infinity;
  store.subscribe((state, prev) => {
    if (state.saveStatus !== prev.saveStatus) streamQueue.release(state.saveStatus);
    if (state.totalRowCount !== undefined && !warnsUnhandledSpecAtMount) warnUnhandledServerSpec(state, prev, warnStoreOnce);
    const failedGroup = newlyFailedGroup(state, prev);
    if (failedGroup) {
      store.setState({ liveAnnouncement: nextAnnouncement(state.liveAnnouncement, "groupFailed", 0, false, groupAnnouncementLabel(state, failedGroup)) });
      return;
    }
    if (state.viewStale && !prev.viewStale && Date.now() - staleAnnouncedAt >= VIEW_STALE_ANNOUNCEMENT_INTERVAL_MS) {
      staleAnnouncedAt = Date.now();
      store.setState({ liveAnnouncement: nextAnnouncement(state.liveAnnouncement, "viewStale", 0) });
      return;
    }
    if (resultsAnnouncementArmed && state.announceResults && typeof state.totalRowCount === "number" && state.totalRowCount !== prev.totalRowCount) {
      store.setState({ liveAnnouncement: nextAnnouncement(state.liveAnnouncement, "results", state.totalRowCount) });
      return;
    }
    if (!resultsAnnouncementArmed || !state.announceResults) return;
    const filterMoved = state.filterMode === "client" && state.filterState !== prev.filterState;
    const sortMoved = state.sortMode === "client" && state.sortState !== prev.sortState;
    if (!filterMoved && !sortMoved) return;
    // A paged grid counts every page, like the footer, so a filter that changes only later pages announces too.
    const view = leafViewOf(state);
    if (sameRows(view, leafViewOf(prev)) && sortKey(state) === sortKey(prev)) return;
    const loaded = loadedRowCount(view, state.data);
    store.setState({ liveAnnouncement: nextAnnouncement(state.liveAnnouncement, "results", loaded, loaded < view.length) });
  });
  return store;
}
