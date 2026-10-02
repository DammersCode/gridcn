"use client";

import { useImperativeHandle, useMemo, type ReactNode, type Ref } from "react";
import type { StoreApi } from "zustand/vanilla";
import type {
  DataGridApi,
  ViewCoord,
  ColumnLayout,
  DataChange,
  DensityMode,
  FilterJoinOperator,
  FilterSpec,
  GetCellClassName,
  GetRowClassName,
  GridCommand,
  GridEditEndEvent,
  GridSelection,
  GridValidationErrorEvent,
  HeaderClickBehavior,
  Keymap,
  OnCellClick,
  OnCellContextMenu,
  OnCellDoubleClick,
  OnRowClick,
  RowMarkersMode,
  SortSpec,
  ViewCellRef,
} from "./types";
import {
  DataGridProvider,
  useDataGridActions,
  useDataGridStoreApi,
  type DataGridStoreState,
  type SelectionChangeDetails,
} from "./store";
import { buildApiHandle } from "./store/api";
import type { GridDirection } from "./windowing/direction";
import { DataGridRoot } from "./root";
import type { EmptyStateRenderer, LoadingStateRenderer } from "./root";
import { useDataGridContainer } from "./interaction/use-data-grid-container";
import { DataGridHeader } from "./header";
import { DataGridBody } from "./body";
import type { OverlayPlugin } from "./overlays";
import type { HeaderMenuRenderer, MarkerCellRenderer, MarkerHeaderRenderer, RowBandsSpec } from "./layout-context";
import type { DeepPartialLabels } from "./labels";

/** Public entry point — the only module consumers/docs should import from. */
export { DataGridRoot, type DataGridRootProps, type EmptyStateReason, type EmptyStateRenderer, type LoadingStateReason, type LoadingStateRenderer } from "./root";
export { DataGridHeader, type DataGridHeaderProps, type HeaderCellRenderCtx, type HeaderCellRenderer } from "./header";
export { DataGridBody, type DataGridBodyProps } from "./body";
/** The per-cell renderer — `data-grid-pinned-rows`'s `DataGridPinnedRow` reuses this in `pinned` mode for identical cell-type rendering/alignment as data rows. */
export { DataGridCell, type DataGridCellProps } from "./cell";
export {
  DataGridOverlays,
  type DataGridOverlaysProps,
  type OverlayPlugin,
  type OverlayPluginCtx,
  type PinTrackData,
  type RectSegment,
} from "./overlays";
/** Custom cell-type editors: the same focus/commit primitives the built-in editors use — seed the input's focus with the caret at the end, and guard a one-shot commit against Enter-then-blur double-commits. `useCellEditor` bundles both plus the draft state and the Enter/Escape/blur bindings a text-input editor needs. */
export { useSeedFocus } from "./interaction/use-seed-focus";
export { useCommitGuard } from "./interaction/use-commit-guard";
export { useCellEditor, type CellEditorCodec } from "./interaction/use-cell-editor";
/** The `direction` prop's value space (add-ons' direction math lives in `./data-grid-sdk`). */
export type { GridDirection } from "./windowing/direction";
/** The provider-level row-bands seam — `data-grid-pinned-rows`'s `useDataGridPinnedRows()` returns a `RowBandsSpec` to pass into `rowBands`. */
export { type RowBandsSpec, type RowBandRenderCtx } from "./layout-context";
/** The custom row-marker render slots (`DataGridRootProps.renderMarker`/`renderMarkerHeader`) and their ctx types. */
export { type HeaderMenuRenderer, type MarkerCellRenderCtx, type MarkerHeaderRenderCtx, type MarkerCellRenderer, type MarkerHeaderRenderer } from "./layout-context";

export {
  cellErrorKey,
  DataGridProvider,
  useDataGridStoreApi,
  useDataGridStoreProps,
  useDataGridActions,
  useDataGridScrollToCell,
  useDataGridScrollToCellAt,
  useDataGridReadOnly,
  useDataGridKeymap,
  useDataGridCommands,
  useDataGridLabels,
  useDataGridActiveCell,
  useDataGridActiveColumn,
  useDataGridCellTypes,
  useDataGridHasActiveCell,
  useDataGridSelection,
  useDataGridGetSelectionValues,
  useDataGridEditing,
  useDataGridEditingError,
  useDataGridCellErrors,
  useDataGridRowHasError,
  useDataGridViewIndex,
  useDataGridViewStale,
  useDataGridVisibleColumns,
  useDataGridAllColumns,
  useDataGridIsColumnHidden,
  useDataGridColumnWidth,
  useDataGridColumnWidths,
  useDataGridSortState,
  useDataGridFilterState,
  useDataGridJoinOperator,
  useDataGridSearchText,
  useDataGridSearchMatches,
  useDataGridSearchCapped,
  useDataGridIsSearchMatch,
  useDataGridRow,
  useDataGridRowId,
  useDataGridRowIds,
  useDataGridRowIdToViewRow,
  useDataGridRowCount,
  useDataGridIsRowSelected,
  useDataGridIsRowChannelSelected,
  useDataGridIsRowCellSelected,
  useDataGridIsCellActive,
  useDataGridIsCellEditing,
  useDataGridCellInitialText,
  useDataGridCellEditingError,
  useDataGridCellState,
  type DataGridCellState,
  useDataGridRowCellState,
  type DataGridRowCellState,
  useDataGridRowMarkers,
  useDataGridSelectionConfig,
  useDataGridAllRowsSelected,
  useDataGridHeaderClickBehavior,
  useDataGridColumnFeatureFlags,
  type DataGridSyncProps,
  type SelectionChangeDetails,
  type SelectLineActionOptions,
  type CellPatch,
  type RowPatch,
  type UpdateCellsOptions,
  type UpdateCellsReorder,
  type UpdateCellsSkip,
  type UpdateCellsVerdict,
  type CellErrorTarget,
  type CellErrorEntry,
  type DataGridStoreState,
  type DataGridStoreStateOf,
  type DataGridActions,
  type DataGridStore,
  type DataGridProviderProps,
  type AnyColumnDef,
  createDataGridSelector,
  useDataGridSelector,
} from "./store";
export type { AnyCellType, ColumnDefOf, ClipboardProcessCtx } from "./store";
import type { AnyCellType, ColumnDefOf, ClipboardProcessCtx } from "./store";

export { useDataGridClipboard, type UseDataGridClipboardResult, type PasteFromClipboardResult } from "./clipboard/use-data-grid-clipboard";
export { sanitizeFormulaCell } from "./clipboard/serialize-cells";
export { DataGridGlobalShortcuts, type DataGridGlobalShortcutsProps } from "./keyboard/use-data-grid-global-shortcuts";
export {
  type GlobalShortcutAction,
  type GlobalShortcutsConfig,
  type DataGridGlobalShortcutActions,
} from "./keyboard/global-shortcuts";
export { isMacPlatform, formatShortcut } from "./keyboard";

export {
  cellTypes,
  defineCellType,
  textCellType,
  numberCellType,
  checkboxCellType,
  selectCellType,
  dateCellType,
} from "./cell-types/cell-types";
export { displayText } from "./cell-types/display-text";
export { CellSpan } from "./cell-types/cell-span";
export { COMPARISON_FILTER_OPERATORS, TEXT_FILTER_OPERATORS } from "./cell-types/capabilities";

export { CompactSelection } from "./selection/compact-selection";
export { defineColumns, getCellValue, setCellValue } from "./columns/column-helpers";
export type { KeysMatching, TypedColumnDef, TypedTextColumnDef, AnyTypedColumn, AccessorLike, InferredValue } from "./columns/column-helpers";
/** A column's sort-direction arrow + multi-sort priority number — string headers get it automatically in `sort` mode; embed it inside a custom (ReactNode) header when you want it there. */
export { DataGridSortIndicator, type DataGridSortIndicatorProps } from "./columns/sort-indicator";

export { DEFAULT_KEYMAP } from "./keyboard";

export { createHistory, applyChange, invertChange, type History, type HistoryOptions } from "./interaction/history";

export {
  DEFAULT_LABELS,
  deepMergeLabels,
  type DataGridLabels,
  type DeepPartialLabels,
  type DataGridToolbarLabels,
  type DataGridFilterOperatorLabels,
  type DataGridContextMenuLabels,
  type DataGridKeybindingsLabels,
  type DataGridMarkerLabels,
  type DataGridGridLabels,
  type DataGridIOLabels,
  type DataGridPaginationLabels,
} from "./labels";

export { GRID_ATTR, gridAttrSelector, type GridAttrName, type GridAttr, type GridAttrValue } from "./data-attributes";

export type {
  CellRef,
  DataGridApi,
  ViewCellRef,
  ViewCoord,
  GridRect,
  GridSelection,
  CompactSelectionLike,
  DataOp,
  DataChange,
  CellRenderProps,
  CellEditorProps,
  CellType,
  CellTypeValueInput,
  CellTypeFilter,
  ColumnDef,
  SortSpec,
  FilterOperator,
  FilterSpec,
  FilterJoinOperator,
  GridActions,
  GridAction,
  CommandGroup,
  GridCommand,
  GridCommandCtx,
  KeyBinding,
  Keymap,
  GridCellTypes,
  CellTypeKey,
  CellValueOf,
  CellOptionsOf,
  RowMarkersContent,
  RowMarkersMode,
  SelectionConfig,
  DensityMode,
  HeaderClickBehavior,
  ColumnLayout,
  GetRowClassName,
  GetCellClassName,
  CellClassNameCtx,
  OnCellClick,
  OnRowClick,
  OnCellDoubleClick,
  OnCellContextMenu,
  CellClickCtx,
  RowClickCtx,
  GridEditEndEvent,
  GridBulkValidationError,
  GridValidationErrorEvent,
} from "./types";
export { measureTextWidths } from "./columns/measure-column-text";
export { createFilterMatcher, type SearchMatch } from "./sort-filter";

/** Props for {@link DataGrid}. */
export type DataGridProps<TData> = {
  /**
   * Controlled row array (React `value` semantics) — the app owns it; every mutation only reaches
   * it through `onDataChange`. Mutually exclusive with `defaultData` (which wins is `data`'s doc
   * below); omit `data` and pass `defaultData` for the uncontrolled quick-start instead.
   */
  data?: readonly TData[];
  /**
   * Uncontrolled row array (React `defaultValue` semantics) — seeds the grid once and it then owns
   * the array internally (edit/paste/fill/delete/row-ops all apply in place, no app state needed);
   * `onDataChange` still fires as an optional notification. Ignored on later renders. If both `data`
   * and `defaultData` are given, `data` wins (controlled) and dev mode warns once.
   */
  defaultData?: readonly TData[];
  columns: readonly ColumnDefOf<TData>[];
  getRowId: (row: TData, index: number) => string;
  /**
   * A consumer-created store (from `useDataGridStoreProps`) to serve the grid instead of
   * self-creating one — see `DataGridProviderProps.store` for the shell semantics.
   */
  store?: StoreApi<DataGridStoreState>;
  className?: string;
  /** Row height in px; also exposed as the `--grid-row-height` CSS var. */
  rowHeight?: number;
  /** Fired once per user gesture (edit, delete, paste, fill) with the next data array and an id-keyed delta batch. */
  onDataChange?: (next: readonly TData[], change: DataChange<TData>) => void;
  /** Row-level cross-field validation, once per touched row after a write gesture commits; `columnId -> message` into `cellErrors`, values still commit. See {@link DataGridSyncProps.validateRow}. */
  validateRow?: (row: TData, rowId: string) => Record<string, string> | null;
  /** Undo keymap action (mod+Z), skipped in a read-only grid; the `data-grid-history` add-on plugs its `undo()` in here. */
  onUndo?: () => void;
  /** Redo keymap action (mod+Y / mod+shift+Z), skipped in a read-only grid; the `data-grid-history` add-on plugs its `redo()` in here. */
  onRedo?: () => void;
  /**
   * Custom cell types keyed by `ColumnDef.type`, merged OVER the built-in registry — built-ins
   * you do not name keep working. A `null` entry removes a built-in (or a previously provided
   * type). See {@link DataGridSyncProps.cellTypes}.
   */
  cellTypes?: Record<string, AnyCellType | null>;
  /** Overrides a cell's clipboard-copy text; falls back to the cell type's `toText`. */
  processCellForClipboard?: (value: unknown, ctx: ClipboardProcessCtx<TData>) => string;
  /** Overrides parsing pasted text into a cell value; falls back to the cell type's `fromText`. */
  processCellFromClipboard?: (text: string, ctx: ClipboardProcessCtx<TData>) => unknown;
  /** Runs on the parsed paste grid before it's applied; returning `false` vetoes the paste entirely. */
  processPaste?: (cells: string[][], target: ViewCoord) => string[][] | false;
  /** Prefixes formula-like copied cells with `'` in the clipboard text and HTML. See {@link DataGridSyncProps.sanitizeClipboardFormulas}. */
  sanitizeClipboardFormulas?: boolean;
  /** Merged over `DEFAULT_KEYMAP`; per-action bindings here take precedence. */
  keymap?: Keymap;
  /** Layout direction; omitted, it follows the page's own direction. See {@link DataGridRootProps.direction}. */
  direction?: GridDirection;
  /** Disables editing and delete grid-wide, independent of any per-column `readOnly`. */
  readOnly?: boolean;
  /** Marker column mode: a pinned-left column rendered before all data columns; default 'none'. */
  rowMarkers?: RowMarkersMode;
  /**
   * Per-column header menu slot, forwarded to `DataGridRoot`: rendered inline-end in each header
   * cell as a ghost chevron trigger, only when provided. The context-menu add-on's
   * `DataGridHeaderDropdown` is the intended renderer. See {@link DataGridRootProps.renderHeaderMenu}.
   */
  renderHeaderMenu?: HeaderMenuRenderer;
  /**
   * Custom row-marker cell renderer: replaces the built-in row number/checkbox content inside the
   * marker column. Requires a non-`'none'` `rowMarkers` mode (the mode still drives the track width,
   * and the cell's own press/drag row-selection gesture stays on the wrapper); an interactive element
   * inside the rendered node owns its own events. See {@link MarkerCellRenderer}. Pass a stable identity.
   */
  renderMarker?: MarkerCellRenderer;
  /** Custom marker-header renderer: replaces the built-in select-all checkbox; same track and width. See {@link MarkerHeaderRenderer}. Pass a stable identity. */
  renderMarkerHeader?: MarkerHeaderRenderer;
  /** Whole-row selection channel gestures (marker click, Shift+Space); default true. */
  enableRowSelection?: boolean;
  /** Whole-column selection channel gestures (header click); default true. */
  enableColumnSelection?: boolean;
  /** Multi-cell rectangular range gestures (shift-click/drag, shift+arrow); false collapses to single-cell active only. Default true. */
  enableRangeSelection?: boolean;
  /** Ctrl/Cmd-click multi-range (rangeStack); false makes it behave as a plain click. Default true. */
  enableMultiRange?: boolean;
  /** Enables the header resize handle grid-wide; default true. Per-column `resizable: false` still wins. */
  enableColumnResize?: boolean;
  /** Enables drag-to-reorder columns grid-wide; default true. Per-column `reorderable: false` still wins. */
  enableColumnReorder?: boolean;
  /** Enables drag-to-reorder rows grid-wide (marker gesture); default true. See the `enableRowReorder` doc in the store's sync props. */
  enableRowReorder?: boolean;
  /** Enables pin/unpin actions grid-wide; default true. Per-column `pinnable: false` still wins. */
  enableColumnPinning?: boolean;
  /** How a plain header click behaves; default 'select'. See {@link HeaderClickBehavior}. */
  headerClickBehavior?: HeaderClickBehavior;
  /** Partial i18n override, deep-merged over `DEFAULT_LABELS`; see {@link useDataGridLabels}. */
  labels?: DeepPartialLabels;
  /** Builds a new row for `insertRow`; absent makes `insertRow` a dev-warning no-op. */
  createRow?: (index: number) => TData;
  /**
   * Builds a duplicated row's identity for `duplicateRows`: given the source row and its new data
   * index, returns the row to insert (with a distinct id). Absent makes `duplicateRows` a
   * dev-warning no-op — mirrors `createRow`/`insertRow`.
   */
  duplicateRow?: (row: TData, index: number) => TData;
  /**
   * Custom keyboard commands keyed by name — the dispatch target of `keymap` bindings that name
   * no built-in action (a `commands` entry named after a built-in action shadows it, dev-warned
   * once). See {@link GridCommand} for the members (`run`, `when`, `scope`, `label`, `group`).
   * Pass a stable reference.
   */
  commands?: Record<string, GridCommand<TData>>;
  /** Controlled multi-sort spec (server escape hatch); omit for uncontrolled (store-owned) sort state. */
  sortState?: SortSpec[];
  /** Fires whenever the sort would change, controlled or not. */
  onSortChange?: (next: SortSpec[]) => void;
  /** Controlled filter spec; same controlled/uncontrolled semantics as `sortState`. */
  filterState?: FilterSpec[];
  /** Fires whenever the filters would change, controlled or not. */
  onFilterChange?: (next: FilterSpec[]) => void;
  /** Controlled join operator combining `filterState`'s rows; same controlled/uncontrolled semantics as `sortState`. Default `"and"`. */
  joinOperator?: FilterJoinOperator;
  /** Fires whenever the join operator would change, controlled or not. */
  onJoinOperatorChange?: (next: FilterJoinOperator) => void;
  /** Controlled quick-search text; same controlled/uncontrolled semantics as `sortState`. */
  searchText?: string;
  /** Fires whenever the search text would change, controlled or not. */
  onSearchTextChange?: (next: string) => void;
  /** Overlay-plugin registration — see `DataGridSyncProps.overlayPlugins` for the full contract; `data-grid-presence` is the motivating consumer. Pass a stable array reference. */
  overlayPlugins?: readonly OverlayPlugin[];
  /** Row-bands registration — see `DataGridSyncProps.rowBands` for the full contract; `data-grid-pinned-rows`'s `useDataGridPinnedRows()` is the motivating (and so far only) producer. Pass a stable reference. */
  rowBands?: RowBandsSpec;
  /** Seeds column widths/order/pins/hidden once at mount, over the `columns` prop's own defaults; NOT controlled — later changes are ignored. Pair with `onColumnLayoutChange` to persist a user's layout. */
  defaultColumnLayout?: ColumnLayout;
  /** Fires once per committed column-layout change (resize commit, reorder drop, pin/hide/autosize) with the full current snapshot. */
  onColumnLayoutChange?: (next: ColumnLayout) => void;
  /** Fires on every live width write during a resize drag (per drag frame) — the in-progress counterpart to `onColumnLayoutChange`. */
  onColumnResizing?: (columnId: string, width: number) => void;
  /** Fires on every committed selection change (click, extend step, row/column/all selection, clear) with a lazy `details.getValues()` accessor; drag-extend fires once per step. */
  onSelectionChange?: (next: GridSelection, details: SelectionChangeDetails) => void;
   /** Fires exactly once when the selection transitions from non-empty to empty, from any clear path. */
   onSelectionCleared?: () => void;
   /** Fires when the active cell changes to a different cell, when another record moves under the cursor, or when it is cleared (`null`) — see {@link DataGridSyncProps.onActiveCellChange}. */
   onActiveCellChange?: (next: ViewCellRef | null) => void;
   /** Fired when an edit session is about to start; return `false` to veto the edit. See {@link DataGridSyncProps.onEditStart}. */
   onEditStart?: (cell: ViewCellRef) => boolean | void;
   /** Fired when an edit session ends or a commit attempt is refused (`commit`/`cancel`/`rejected`). See {@link GridEditEndEvent}. */
   onEditEnd?: (event: GridEditEndEvent) => void;
   /** Fires after a bulk paste or fill settles, only when at least one cell was rejected by validation. See {@link GridValidationErrorEvent}. */
   onValidationError?: (event: GridValidationErrorEvent) => void;
   /** Fired on a double-click on any non-pinned, non-skeleton cell — pure notification, no veto. See {@link OnCellDoubleClick}. */
   onCellDoubleClick?: OnCellDoubleClick<TData>;
   /** Fired when the user right-clicks any non-pinned, non-skeleton cell — pure notification. See {@link OnCellContextMenu}. */
   onCellContextMenu?: OnCellContextMenu<TData>;
   /** Row-height preset: compact 28 / default 36 / comfortable 44. Ignored when `rowHeight` is set. */
  density?: DensityMode;
  /** Sticky header track height (px); `density` and `rowHeight` affect data rows only. Default 36. */
  headerHeight?: number;
  /** Extra unpinned columns rendered beyond the visible viewport on each side. Default 1. */
  columnOverscan?: number;
  /** Row class hook, merged via `cn()` after the built-in row classes. Pass a stable identity. */
  getRowClassName?: GetRowClassName<TData>;
  /** Cell class hook, merged via `cn()` after the built-in cell classes. Pass a stable identity. */
  getCellClassName?: GetCellClassName<TData>;
  /** Fired on a plain click on any cell — see {@link OnCellClick}. Attached to the cell's own existing click handler, no new subscription. Pass a stable identity. */
  onCellClick?: OnCellClick<TData>;
  /** Fired alongside `onCellClick` once per click regardless of column — see {@link OnRowClick}. */
  onRowClick?: OnRowClick<TData>;
  /** Rendered centered in place of the body when there are zero rows in view. Accepts a node or a function receiving `{ reason }` — `"no-data"` when the data array is empty, `"filtered"` when rows exist but none are in view. See {@link DataGridRootProps.emptyState}. */
  emptyState?: ReactNode | EmptyStateRenderer;
  /** Presentational loading flag: zero rows renders a viewport-filling skeleton instead of the empty state; rows present adds a slim indeterminate bar under the header. Default `false`. See {@link DataGridRootProps.loading}. */
  loading?: boolean;
  /** Replaces the built-in loading presentation while `loading` is true. See {@link DataGridRootProps.loadingState}. */
  loadingState?: ReactNode | LoadingStateRenderer;
  /** Fired after a row-window commit with the rendered data-row range; see {@link DataGridRootProps.onRowWindowChange}. */
  onRowWindowChange?: (range: { start: number; end: number }) => void;
  /**
   * Imperative handle (React 19 ref-as-prop): assigned with this grid's {@link DataGridApi} once
   * mounted; stable for the grid's lifetime. Manual composition gets the same handle from
   * {@link useDataGridApi}, called under `DataGridRoot`.
   */
  ref?: Ref<DataGridApi<TData>>;
  /** Composition escape hatch; defaults to header + body when omitted. */
  children?: ReactNode;
};

/**
 * The imperative API of one grid — see {@link DataGridApi}. Call it under `DataGridRoot`
 * (its `focus()` needs the root's scroll container). Pass a `ref` to hand the handle out; the
 * returned object is stable for the grid's lifetime, safe to close over.
 */
export function useDataGridApi<TData = unknown>(ref?: Ref<DataGridApi<TData>>): DataGridApi<TData> {
  const storeApi = useDataGridStoreApi();
  const actions = useDataGridActions();
  const containerRef = useDataGridContainer();
  const api = useMemo(
    () => buildApiHandle<TData>({ actions, storeApi, containerRef }),
    [actions, storeApi, containerRef],
  );
  useImperativeHandle(ref, () => api, [api]);
  return api;
}

/** Renders nothing; runs {@link useDataGridApi} inside `DataGridRoot` so `<DataGrid ref>` reaches the scroll container for `focus()`. */
function DataGridApiCapture<TData>(props: { ref?: Ref<DataGridApi<TData>> }) {
  useDataGridApi<TData>(props.ref);
  return null;
}

/**
 * Convenience wrapper: provider + scroll root + header + body. Compose the
 * parts directly (`DataGridProvider`/`DataGridRoot`/`DataGridHeader`/`DataGridBody`)
 * for custom layouts (toolbar, overlays, context menu).
 */
export function DataGrid<TData>(props: DataGridProps<TData>): ReactNode {
  const {
    data,
    defaultData,
    columns,
    getRowId,
    store,
    className,
    rowHeight,
    onDataChange,
    validateRow,
    onUndo,
    onRedo,
    cellTypes,
    processCellForClipboard,
    processCellFromClipboard,
    processPaste,
    sanitizeClipboardFormulas,
    keymap,
    direction,
    readOnly,
    rowMarkers,
    renderHeaderMenu,
    renderMarker,
    renderMarkerHeader,
    enableRowSelection,
    enableColumnSelection,
    enableRangeSelection,
    enableMultiRange,
    enableColumnResize,
    enableColumnReorder,
    enableRowReorder,
    enableColumnPinning,
    headerClickBehavior,
    labels,
    createRow,
    duplicateRow,
    commands,
    sortState,
    onSortChange,
    filterState,
    onFilterChange,
    joinOperator,
    onJoinOperatorChange,
    searchText,
    onSearchTextChange,
    overlayPlugins,
    rowBands,
    defaultColumnLayout,
    onColumnLayoutChange,
    onColumnResizing,
    onSelectionChange,
    onSelectionCleared,
    onActiveCellChange,
    onEditStart,
    onEditEnd,
    onValidationError,
    onCellDoubleClick,
    onCellContextMenu,
    density,
    headerHeight,
    columnOverscan,
    getRowClassName,
    getCellClassName,
    onCellClick,
    onRowClick,
    emptyState,
    loading,
    loadingState,
    onRowWindowChange,
    children,
    ref,
  } = props;

  // erasure boundary for the root-level callbacks: TData narrows to the root's unknown — safe for
  // the same reason as toInternalSyncProps (store.tsx): every row these callbacks ever receive
  // originated from this DataGrid's own TData-typed `data`.
  const erasedRowClassName = getRowClassName as GetRowClassName<unknown> | undefined;
  const erasedCellClassName = getCellClassName as GetCellClassName<unknown> | undefined;
  const erasedOnCellClick = onCellClick as OnCellClick<unknown> | undefined;
  const erasedOnRowClick = onRowClick as OnRowClick<unknown> | undefined;

  return (
      <DataGridProvider
        commands={commands}
        data={data}
      defaultData={defaultData}
      columns={columns}
      getRowId={getRowId}
      store={store}
      onDataChange={onDataChange}
      validateRow={validateRow}
      onUndo={onUndo}
      onRedo={onRedo}
      cellTypes={cellTypes}
      processCellForClipboard={processCellForClipboard}
      processCellFromClipboard={processCellFromClipboard}
      processPaste={processPaste}
      sanitizeClipboardFormulas={sanitizeClipboardFormulas}
      rowMarkers={rowMarkers}
      enableRowSelection={enableRowSelection}
      enableColumnSelection={enableColumnSelection}
      enableRangeSelection={enableRangeSelection}
      enableMultiRange={enableMultiRange}
      enableColumnResize={enableColumnResize}
      enableColumnReorder={enableColumnReorder}
      enableRowReorder={enableRowReorder}
      enableColumnPinning={enableColumnPinning}
      headerClickBehavior={headerClickBehavior}
      labels={labels}
      createRow={createRow}
      duplicateRow={duplicateRow}
      sortState={sortState}
      onSortChange={onSortChange}
      filterState={filterState}
      onFilterChange={onFilterChange}
      joinOperator={joinOperator}
      onJoinOperatorChange={onJoinOperatorChange}
      searchText={searchText}
      onSearchTextChange={onSearchTextChange}
      overlayPlugins={overlayPlugins}
      rowBands={rowBands}
      defaultColumnLayout={defaultColumnLayout}
      onColumnLayoutChange={onColumnLayoutChange}
      onColumnResizing={onColumnResizing}
      onSelectionChange={onSelectionChange}
      onSelectionCleared={onSelectionCleared}
      onActiveCellChange={onActiveCellChange}
      onEditStart={onEditStart}
      onEditEnd={onEditEnd}
      onValidationError={onValidationError}
      onCellDoubleClick={onCellDoubleClick}
      onCellContextMenu={onCellContextMenu}
    >
      <DataGridRoot
        className={className}
        rowHeight={rowHeight}
        density={density}
        headerHeight={headerHeight}
        columnOverscan={columnOverscan}
        keymap={keymap}
        direction={direction}
        readOnly={readOnly}
        renderHeaderMenu={renderHeaderMenu}
        renderMarker={renderMarker}
        renderMarkerHeader={renderMarkerHeader}
        emptyState={emptyState}
        loading={loading}
        loadingState={loadingState}
        getRowClassName={erasedRowClassName}
        getCellClassName={erasedCellClassName}
        onCellClick={erasedOnCellClick}
        onRowClick={erasedOnRowClick}
        onRowWindowChange={onRowWindowChange}
      >
        <DataGridApiCapture<TData> ref={ref} />
        {children ?? (
          <>
            <DataGridHeader />
            <DataGridBody />
          </>
        )}
      </DataGridRoot>
    </DataGridProvider>
  );
}
