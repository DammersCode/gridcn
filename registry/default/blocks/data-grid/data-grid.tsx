"use client";

import type { ReactNode } from "react";
import type { StoreApi } from "zustand/vanilla";
import type {
  CellCoord,
  ColumnLayout,
  DataChange,
  DensityMode,
  FilterJoinOperator,
  FilterSpec,
  GetCellClassName,
  GetRowClassName,
  GridSelection,
  HeaderClickBehavior,
  Keymap,
  OnCellClick,
  OnRowClick,
  RowMarkersMode,
  SortSpec,
} from "./types";
import { DataGridProvider, type DataGridStoreState, type SelectionChangeDetails } from "./store";
import type { GridDirection } from "./windowing/direction";
import { DataGridRoot } from "./root";
import { DataGridHeader } from "./header";
import { DataGridBody } from "./body";
import type { OverlayPlugin } from "./overlays";
import type { MarkerCellRenderer, MarkerHeaderRenderer, RowBandsSpec } from "./layout-context";
import type { DeepPartialLabels } from "./labels";

/** Public entry point — the only module consumers/docs should import from. */
export { DataGridRoot, type DataGridRootProps } from "./root";
export { DataGridHeader } from "./header";
export { DataGridBody } from "./body";
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
/** Pointer px -> view-coord translation + its layout input — `data-grid-fill`'s drag-tracking loop reuses this rather than reimplementing pointer hit-testing. */
export { GRID_LAYER, cellLayer, type GridLayer } from "./layers";
export { pointerToCoord, type InteractionLayout } from "./interaction/use-grid-interaction";
/** Custom cell-type editors: the same focus/commit primitives the built-in editors use — seed the input's focus with the caret at the end, and guard a one-shot commit against Enter-then-blur double-commits. */
export { useSeedFocus } from "./interaction/use-seed-focus";
export { useCommitGuard } from "./interaction/use-commit-guard";
/**
 * Direction (LTR/RTL) math, all of it. Physical pointer/scroll coordinates are converted to the
 * grid's inline axis exclusively through these, so add-ons doing their own pointer work stay
 * RTL-correct without repeating the sign logic — `data-grid-fill`'s drag auto-scroll is the
 * in-tree consumer. Add a helper here rather than writing new physical coordinate math elsewhere.
 */
export {
  applyInlineScrollDelta,
  directionSign,
  inlineAutoScrollStep,
  inlineDelta,
  inlineStartX,
  isInlineStartHalf,
  normalizeScrollLeft,
  visualArrowKey,
  type GridDirection,
} from "./windowing/direction";
/** The shared root layout context (scrollRef, column layout, row/header heights) — `data-grid-fill`'s tracker component reads this to reconstruct an `InteractionLayout` from inside `DataGridRoot`'s own subtree, the only place these values exist. */
export { useDataGridRootContext, type DataGridRootContextValue } from "./layout-context";
/** The provider-level row-bands seam — `data-grid-pinned-rows`'s `useDataGridPinnedRows()` returns a `RowBandsSpec` to pass into `rowBands`. */
export { type RowBandsSpec, type RowBandRenderCtx, type WindowedColumn } from "./layout-context";
/** The custom row-marker render slots (`DataGridRootProps.renderMarker`/`renderMarkerHeader`) and their ctx types. */
export { type MarkerCellRenderCtx, type MarkerHeaderRenderCtx, type MarkerCellRenderer, type MarkerHeaderRenderer } from "./layout-context";
/** `layout-context.ts`'s per-column layout (widths/template/track offsets), aliased on export to avoid colliding with `types.ts`'s same-named `ColumnLayout` (the `defaultColumnLayout`/`onColumnLayoutChange` persisted-snapshot shape) below — `data-grid-pinned-rows` needs this one, for the live render-time layout `RowBandRenderCtx.layout` carries. */
export { type ColumnLayout as GridColumnLayout } from "./layout-context";

export {
  cellErrorKey,
  flashCellKey,
  DataGridProvider,
  useDataGridStoreApi,
  useDataGridStoreProps,
  useDataGridActions,
  useDataGridScrollToCell,
  useDataGridReadOnly,
  useDataGridKeymap,
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
  type CellErrorTarget,
  type CellErrorEntry,
  type DataGridStoreState,
  type DataGridActions,
  type DataGridStore,
  type DataGridProviderProps,
  type AnyColumnDef,
} from "./store";
export type { AnyCellType, ColumnDefOf, ClipboardProcessCtx } from "./store";
import type { AnyCellType, ColumnDefOf, ClipboardProcessCtx } from "./store";

export { useDataGridClipboard, type UseDataGridClipboardResult, type PasteFromClipboardResult } from "./clipboard/use-data-grid-clipboard";
export { useDataGridContainer } from "./interaction/use-data-grid-container";
export { DataGridGlobalShortcuts, type DataGridGlobalShortcutsProps } from "./keyboard/use-data-grid-global-shortcuts";
export {
  type GlobalShortcutAction,
  type GlobalShortcutsConfig,
} from "./keyboard/global-shortcuts";

export {
  cellTypes,
  textCellType,
  numberCellType,
  checkboxCellType,
  selectCellType,
  dateCellType,
} from "./cell-types/cell-types";

export { CompactSelection } from "./selection/compact-selection";
/** Bounding-box union of two rects — `data-grid-fill`'s drag pipeline uses this to expand a selection over `combineRects(source, strip)`. */
export { combineRects } from "./selection";
export { defineColumns, getCellValue, setCellValue } from "./columns/column-helpers";
export type { KeysMatching, TypedColumnDef, TypedTextColumnDef, AnyTypedColumn, AccessorLike, InferredValue } from "./columns/column-helpers";
/** A column's sort-direction arrow + multi-sort priority number — string headers get it automatically in `sort` mode; embed it inside a custom (ReactNode) header when you want it there. */
export { DataGridSortIndicator, type DataGridSortIndicatorProps } from "./columns/sort-indicator";

/** Runs a column's `validate` (function form or Standard Schema) for one cell; an async schema passes through unchanged here — `runValidateBatch`/`resolveBulkWrites` are the awaiting bulk path. */
export { runValidateSync, runValidatePending, isStandardSchema, formatIssues, type CellValidate, type ValidateResult } from "./validation/validate-cell";
/** The bulk validation engine: chunked-concurrency batches for paste/fill/import, and the per-surface race guard that drops a superseded one. See editing-cell-types.mdx. */
export {
  runValidateBatch,
  resolveBulkWrites,
  VALIDATE_CONCURRENCY,
  type ValidateBatchItem,
  type BulkCandidate,
  type BulkWrite,
} from "./validation/validate-batch";
export {
  useBulkGeneration,
  snapshotBulkBatch,
  candidateRowIds,
  isBulkBatchCurrent,
  type BulkGeneration,
  type BulkBatchSnapshot,
} from "./validation/bulk-generation";

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

export { isDev } from "./is-dev";

export { GRID_ATTR, gridAttrSelector, type GridAttrName, type GridAttr, type GridAttrValue } from "./data-attributes";

export type {
  CellCoord,
  GridRect,
  GridSelection,
  CompactSelectionLike,
  DataOp,
  DataChange,
  CellRenderProps,
  CellEditorProps,
  CellType,
  ColumnDef,
  SortSpec,
  FilterOperator,
  FilterSpec,
  FilterJoinOperator,
  GridAction,
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
  CellClickCtx,
  RowClickCtx,
} from "./types";
export { measureColumnAutosizeWidth, measureTextWidths } from "./columns/measure-column-text";
export { type SearchMatch } from "./sort-filter";

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
  /** Undo keymap action (mod+Z); the `data-grid-history` add-on plugs its `undo()` in here. */
  onUndo?: () => void;
  /** Redo keymap action (mod+Y / mod+shift+Z); the `data-grid-history` add-on plugs its `redo()` in here. */
  onRedo?: () => void;
  /**
   * Cell-type registry keyed by `ColumnDef.type`; defaults to the built-in registry. Providing a
   * registry REPLACES the built-ins, it is not merged over them: to extend the built-ins, spread
   * the exported `cellTypes` in (`cellTypes={{ ...cellTypes, myType }}`).
   */
  cellTypes?: Record<string, AnyCellType>;
  /** Overrides a cell's clipboard-copy text; falls back to the cell type's `toText`. */
  processCellForClipboard?: (value: unknown, ctx: ClipboardProcessCtx<TData>) => string;
  /** Overrides parsing pasted text into a cell value; falls back to the cell type's `fromText`. */
  processCellFromClipboard?: (text: string, ctx: ClipboardProcessCtx<TData>) => unknown;
  /** Runs on the parsed paste grid before it's applied; returning `false` vetoes the paste entirely. */
  processPaste?: (cells: string[][], target: CellCoord) => string[][] | false;
  /** Merged over `DEFAULT_KEYMAP`; per-action bindings here take precedence. */
  keymap?: Keymap;
  /** Layout direction; omitted, it follows the page's own direction. See {@link DataGridRootProps.direction}. */
  direction?: GridDirection;
  /** Disables editing and delete grid-wide, independent of any per-column `readOnly`. */
  readOnly?: boolean;
  /** Marker column mode: a pinned-left column rendered before all data columns; default 'none'. */
  rowMarkers?: RowMarkersMode;
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
  /** Row-height preset: compact 28 / default 36 / comfortable 44. Ignored when `rowHeight` is set. */
  density?: DensityMode;
  /** Row class hook, merged via `cn()` after the built-in row classes. Pass a stable identity. */
  getRowClassName?: GetRowClassName<TData>;
  /** Cell class hook, merged via `cn()` after the built-in cell classes. Pass a stable identity. */
  getCellClassName?: GetCellClassName<TData>;
  /** Fired on a plain click on any cell — see {@link OnCellClick}. Attached to the cell's own existing click handler, no new subscription. Pass a stable identity. */
  onCellClick?: OnCellClick<TData>;
  /** Fired alongside `onCellClick` once per click regardless of column — see {@link OnRowClick}. */
  onRowClick?: OnRowClick<TData>;
  /** Rendered centered in place of the body when there are zero rows in view. Never shown while `loading` is true. */
  emptyState?: ReactNode;
  /** Presentational loading flag: zero rows renders a viewport-filling skeleton instead of the empty state; rows present adds a slim indeterminate bar under the header. Default `false`. See {@link DataGridRootProps.loading}. */
  loading?: boolean;
  /** Fired after a row-window commit with the rendered data-row range; see {@link DataGridRootProps.onRowWindowChange}. */
  onRowWindowChange?: (range: { start: number; end: number }) => void;
  /** Composition escape hatch; defaults to header + body when omitted. */
  children?: ReactNode;
};

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
    keymap,
    direction,
    readOnly,
    rowMarkers,
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
    density,
    getRowClassName,
    getCellClassName,
    onCellClick,
    onRowClick,
    emptyState,
    loading,
    onRowWindowChange,
    children,
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
    >
      <DataGridRoot
        className={className}
        rowHeight={rowHeight}
        density={density}
        keymap={keymap}
        direction={direction}
        readOnly={readOnly}
        renderMarker={renderMarker}
        renderMarkerHeader={renderMarkerHeader}
        emptyState={emptyState}
        loading={loading}
        getRowClassName={erasedRowClassName}
        getCellClassName={erasedCellClassName}
        onCellClick={erasedOnCellClick}
        onRowClick={erasedOnRowClick}
        onRowWindowChange={onRowWindowChange}
      >
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
