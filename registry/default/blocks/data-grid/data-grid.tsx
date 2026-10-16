"use client";

import { useImperativeHandle, type ReactNode, type Ref } from "react";
import type { DataGridApi } from "./types";
import {
  DataGridProvider,
  useDataGridStoreApi,
  type ExternalStoreProps,
  type OwnedStoreProps,
} from "./store";
import { apiHandleOf } from "./store/api";
import { DataGridRoot, type DataGridRootProps } from "./root";
import { DataGridHeader } from "./header";
import { DataGridBody } from "./body";

/** Public entry point — the only module consumers/docs should import from. */
export { DataGridRoot, type DataGridRootProps, type EmptyStateReason, type EmptyStateRenderer, type LoadingStateReason, type LoadingStateRenderer } from "./root";
export { DataGridHeader, type DataGridHeaderProps, type HeaderCellRenderCtx, type HeaderCellRenderer } from "./header";
export { DataGridBody, type DataGridBodyProps } from "./body";
/** The per-cell renderer — `data-grid-pinned-rows`'s `DataGridPinnedRow` reuses this in `pinned` mode for identical cell-type rendering/alignment as data rows. */
export { DataGridCell, type DataGridCellProps } from "./cell";
export {
  DataGridOverlays,
  type DataGridOverlaysProps,
  type OverlayPluginCtx,
  type PinTrackData,
  type RectSegment,
} from "./overlays";
/** Primitives for custom cell-type editors: seed the input's focus with the caret at the end, and guard a one-shot commit against Enter-then-blur double-commits. `useCellEditor` bundles both plus the draft state and the Enter/Escape/blur bindings a text-input editor needs. */
export { useSeedFocus } from "./interaction/use-seed-focus";
export { useCommitGuard } from "./interaction/use-commit-guard";
export { useCellEditor, type CellEditorCodec } from "./interaction/use-cell-editor";
/** The `direction` prop's value space (add-ons' direction math lives in `./data-grid-sdk`). */
export type { GridDirection } from "./windowing/direction";
/** The `plugins` prop's surface: one entry per add-on that reaches into the grid — overlay painter, row-band contribution, data-change observer, commands/keymap, and root mount. `DataGridReadState` is what `api.store` exposes. */
export type { DataGridPlugin, PluginRowBands, DataGridPluginCtx, DataGridReadState, DataGridStoreWrapper } from "./types";
export { type RowBandRenderCtx } from "./layout-context";
/** The custom row-marker render slots (`DataGridRootProps.renderMarker`/`renderMarkerHeader`) and their ctx types. */
export { type HeaderMenuRenderer, type MarkerCellRenderCtx, type MarkerHeaderRenderCtx, type MarkerCellRenderer, type MarkerHeaderRenderer } from "./layout-context";

export {
  cellErrorKey,
  DataGridProvider,
  useDataGridStoreProps,
  useDataGridActions,
  useDataGridScrollToCell,
  useDataGridScrollToCellAt,
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
  useDataGridCellErrors,
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
  useDataGridIsSearchMatch,
  useDataGridRow,
  useDataGridRowId,
  useDataGridRowIds,
  useDataGridRowIdToViewRow,
  useDataGridRowCount,
  useDataGridIsRowSelected,
  useDataGridIsRowChannelSelected,
  useDataGridIsRowCellSelected,
  useDataGridCellEditingError,
  useDataGridCellState,
  type DataGridCellState,
  useDataGridRowCellState,
  type DataGridRowCellState,
  useDataGridRowMarkers,
  useDataGridSelectionConfig,
  useDataGridAllRowsSelected,
  useDataGridHeaderClickBehavior,
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
  type DataGridStoreStateOf,
  type DataGridActions,
  type DataGridStore,
  type DataGridProviderProps,
  type AnyColumnDef,
  createDataGridSelector,
  useDataGridSelector,
} from "./store";
export type { AnyCellType, ColumnDefOf, ClipboardProcessCtx } from "./store";

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
  urlCellType,
  longTextCellType,
  safeHref,
} from "./cell-types/cell-types";
export { displayText } from "./cell-types/display-text";
export { CellSpan } from "./cell-types/cell-span";

export { CompactSelection } from "./selection/compact-selection";
export { defineColumns, getCellValue } from "./columns/column-helpers";
export type { KeysMatching, TypedColumnDef, TypedTextColumnDef, AnyTypedColumn, AccessorLike, InferredValue } from "./columns/column-helpers";
/** A column's sort-direction arrow + multi-sort priority number — string headers get it automatically in `sort` mode; embed it inside a custom (ReactNode) header when you want it there. */
export { DataGridSortIndicator, type DataGridSortIndicatorProps } from "./columns/sort-indicator";

export { DEFAULT_KEYMAP } from "./keyboard";

/** A `SelectionState` with nothing selected: the initial value for a controlled `selection` prop. */
export { EMPTY_SELECTION_STATE } from "./store/selection-state";

export { applyChange, invertChange } from "./interaction/history";

export {
  DEFAULT_LABELS,
  deepMergeLabels,
  type DataGridLabels,
  type DeepPartialLabels,
  type DataGridToolbarLabels,
  type DataGridContextMenuLabels,
  type DataGridKeybindingsLabels,
  type DataGridMarkerLabels,
  type DataGridGridLabels,
  type DataGridIOLabels,
  type DataGridPaginationLabels,
  type DataGridStatusBarLabels,
} from "./labels";


export type {
  CellRef,
  CellRange,
  SelectionState,
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
  FilterValueInputProps,
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
  AutosizeOptions,
  ColumnLayout,
  GetRowClassName,
  GetCellClassName,
  CellClassNameCtx,
  OnCellClick,
  OnCellDoubleClick,
  OnCellContextMenu,
  CellClickCtx,
  GridEditEndEvent,
  GridBulkValidationError,
  GridValidationErrorEvent,
} from "./types";
export { measureTextWidths } from "./columns/measure-column-text";
export { createFilterMatcher, type SearchMatch } from "./sort-filter";

/** Props for {@link DataGrid}: the sync props (the store's home) plus the root's render/layout props — a prop lives on exactly one surface, so nothing is hand-forwarded. */
export type DataGridProps<TData> = (ExternalStoreProps | OwnedStoreProps<TData>) &
  DataGridRootProps<TData> & {
    /**
     * Imperative handle (React 19 ref-as-prop): assigned with this grid's {@link DataGridApi} once
     * mounted; stable for the grid's lifetime. Manual composition gets the same handle from
     * `DataGridProvider`'s `ref` or from {@link useDataGridApi}.
     */
    ref?: Ref<DataGridApi<TData>>;
  };

/**
 * The imperative API of one grid — see {@link DataGridApi}. Call it anywhere under the grid's
 * `DataGridProvider`, a toolbar sibling of `DataGridRoot` included. `scrollTo` and `focus` no-op
 * until a `DataGridRoot` mounts. Pass a `ref` to hand the handle out; the returned object is
 * stable for the grid's lifetime, safe to close over.
 */
export function useDataGridApi<TData = unknown>(ref?: Ref<DataGridApi<TData>>): DataGridApi<TData> {
  const api = apiHandleOf<TData>(useDataGridStoreApi());
  useImperativeHandle(ref, () => api, [api]);
  return api;
}

/**
 * Convenience wrapper: provider + scroll root + header + body. Compose the
 * parts directly (`DataGridProvider`/`DataGridRoot`/`DataGridHeader`/`DataGridBody`)
 * for custom layouts (toolbar, overlays, context menu).
 */
export function DataGrid<TData>(props: DataGridProps<TData>): ReactNode {
  // The root keeps exactly DATA_GRID_ROOT_PROP_KEYS; the rest (the sync props plus `store`) goes to the provider.
  const {
    className,
    rowHeight,
    density,
    headerHeight,
    columnOverscan,
    direction,
    emptyState,
    loading,
    loadingState,
    renderHeaderMenu,
    renderMarker,
    renderMarkerHeader,
    getRowClassName,
    getCellClassName,
    children,
    ...rest
  } = props;
  return (
    <DataGridProvider {...rest}>
      <DataGridRoot
        className={className}
        rowHeight={rowHeight}
        density={density}
        headerHeight={headerHeight}
        columnOverscan={columnOverscan}
        direction={direction}
        emptyState={emptyState}
        loading={loading}
        loadingState={loadingState}
        renderHeaderMenu={renderHeaderMenu}
        renderMarker={renderMarker}
        renderMarkerHeader={renderMarkerHeader}
        getRowClassName={getRowClassName}
        getCellClassName={getCellClassName}
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