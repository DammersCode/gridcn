"use client";

import { createContext, use, useEffect, useRef, useState, type ReactNode } from "react";
import type { StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import type { OverlayPlugin } from "../overlays";
import type { RowBandsSpec } from "../layout-context";
import { checkDevGuardrails, checkUnresolvableColumnTypes } from "./commit";
import { makeSelectionChangeDetails } from "./compute";
import { createDataGridStore } from "./create-store";
import { toInternalSyncProps } from "./types";
import type { AnyColumnDef, DataGridActions, DataGridProviderProps, DataGridStoreState, DataGridSyncProps } from "./types";
import { isSelectionEmpty } from "../selection";

/**
 * Wires `onSelectionChange`: one `storeApi.subscribe` on `state.selection`'s identity, not a
 * per-action callback insertion — `selection` is replaced by ~15 different call sites (click,
 * extend, row/col select, edits shifting rows, `_syncProps` clamping out-of-view rows, etc.), and a
 * single subscription covers all of them without threading the callback through every one, and
 * without adding a React subscription in row/cell components (this runs entirely outside React).
 * Reads `onSelectionChange` fresh off the store on each fire so `_syncProps` updates to it apply
 * immediately, same as every other sync-prop callback. Returns the unsubscribe.
 */
function subscribeSelectionChange(store: StoreApi<DataGridStoreState>): () => void {
  return store.subscribe((state, prevState) => {
    if (state.selection === prevState.selection) return;
    // getValues() closes over store.getState (not this fire's `state`) so a call from inside the
    // handler always sees the current selection even if something re-entrantly changed it first.
    state.onSelectionChange?.(state.selection, makeSelectionChangeDetails(store.getState));
  });
}

function subscribeSelectionCleared(store: StoreApi<DataGridStoreState>): () => void {
  let wasEmpty = isSelectionEmpty(store.getState().selection);
  return store.subscribe((state, prevState) => {
    if (state.selection === prevState.selection) return;
    const empty = isSelectionEmpty(state.selection);
    if (empty && !wasEmpty) state.onSelectionCleared?.();
    wasEmpty = empty;
  });
}

const DataGridStoreContext = createContext<StoreApi<DataGridStoreState> | null>(null);

/**
 * Mounts one store instance per grid (multiple grids per page each get their
 * own instance) and keeps it in sync with the consumer's live props.
 *
 * The public escape hatch for code OUTSIDE the provider's subtree: an `onDataChange` closure,
 * a WebSocket handler, or a sibling control can hold the returned `actions` (stable for the
 * store's lifetime) and the full zustand `StoreApi` without rendering a capture component inside
 * the provider. Pass the returned `store` to `DataGridProvider`'s `store` prop to feed the grid;
 * the sync loop stays here, so pass the same live props to this hook that the grid renders from.
 *
 * Generic over the consumer's row type `TData` — pass real `ColumnDef<TData, TValue>[]`
 * and a real `getRowId` without an unsafe cast; the internal store stays row-agnostic.
 */
export function useDataGridStoreProps<TData>(props: DataGridSyncProps<TData>): {
  store: StoreApi<DataGridStoreState>;
  actions: DataGridActions;
} {
  const { store, actions } = useGridStoreCore(props, undefined);
  return { store, actions };
}

/**
 * The store-ownership core shared by {@link useDataGridStoreProps} and `DataGridProvider`'s
 * default (self-creating) path — one sync loop, guardrail checks, and subscription wiring for
 * both. When `externalStore` is set the hook owns nothing: no creation, no sync, no
 * subscriptions; the consumer's own `useDataGridStoreProps` call drives the store, and this
 * instance only supplies the context value.
 */
function useGridStoreCore<TData>(
  props: DataGridSyncProps<TData>,
  externalStore: StoreApi<DataGridStoreState> | undefined,
): { store: StoreApi<DataGridStoreState>; actions: DataGridActions } {
  const {
    data,
    defaultData,
    columns,
    getRowId,
    onDataChange,
    validateRow,
    onUndo,
    onRedo,
    cellTypes,
    processCellForClipboard,
    processCellFromClipboard,
    processPaste,
    rowMarkers,
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
  } = props;
  const internalInit = toInternalSyncProps({
    data,
    defaultData,
    columns,
    getRowId,
    onDataChange,
    validateRow,
    onUndo,
    onRedo,
    cellTypes,
    processCellForClipboard,
    processCellFromClipboard,
    processPaste,
    rowMarkers,
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
  });
  // Lazy: an external store means this instance owns nothing, and store creation computes the
  // initial view over the full dataset — it must not run for a shell.
  const [ownedStore] = useState<StoreApi<DataGridStoreState> | null>(() => (externalStore ? null : createDataGridStore(internalInit)));
  const store = externalStore ?? (ownedStore as StoreApi<DataGridStoreState>);
  const prevColumns = useRef<readonly AnyColumnDef[] | undefined>(undefined);
  const prevData = useRef<readonly unknown[] | undefined>(undefined);
  const prevOverlayPlugins = useRef<readonly OverlayPlugin[] | undefined>(undefined);
  const prevRowBands = useRef<RowBandsSpec | undefined>(undefined);
  const warnedColumnTypes = useRef<Set<string>>(new Set());

  // One subscription per store instance, outside React's render path (see subscribeSelectionChange).
  // External stores are subscribed by their owner's useDataGridStoreProps call — subscribing here
  // too would double-fire onSelectionChange.
  useEffect(() => {
    if (externalStore) return;
    return subscribeSelectionChange(store);
  }, [store, externalStore]);
  useEffect(() => {
    if (externalStore) return;
    return subscribeSelectionCleared(store);
  }, [store, externalStore]);

  useEffect(() => {
    if (externalStore) return;
    checkDevGuardrails(internalInit, prevColumns.current, prevData.current, prevOverlayPlugins.current, prevRowBands.current);
    checkUnresolvableColumnTypes(internalInit.columns, internalInit.cellTypes, warnedColumnTypes.current);
    prevColumns.current = internalInit.columns;
    prevData.current = internalInit.data;
    prevOverlayPlugins.current = internalInit.overlayPlugins;
    prevRowBands.current = internalInit.rowBands;
    store.getState().actions._syncProps(internalInit);
    // internalInit is a fresh cast object each render; depend on the raw props instead.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [
    store,
    externalStore,
    data,
    columns,
    getRowId,
    onDataChange,
    validateRow,
    onUndo,
    onRedo,
    cellTypes,
    processCellForClipboard,
    processCellFromClipboard,
    processPaste,
    rowMarkers,
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
    onColumnLayoutChange,
    onColumnResizing,
    onSelectionChange,
    onSelectionCleared,
  ]);

  return { store, actions: store.getState().actions };
}

/**
 * Provides the grid's store to the component subtree. By default it self-creates the store via
 * the same ownership core as {@link useDataGridStoreProps}; pass `store` to serve a
 * consumer-created store instead — then this component is a pure context shell and the sync
 * loop lives on the consumer's `useDataGridStoreProps` call.
 */
export function DataGridProvider<TData>(props: DataGridProviderProps<TData>): ReactNode {
  const { store: externalStore, children, ...syncProps } = props;
  const { store } = useGridStoreCore<TData>(syncProps, externalStore);
  return <DataGridStoreContext.Provider value={store}>{children}</DataGridStoreContext.Provider>;
}

/** Resolves the current grid's store, throwing with a clear message outside the provider. */
function useDataGridStoreApiInternal(): StoreApi<DataGridStoreState> {
  const store = use(DataGridStoreContext);
  if (!store) {
    throw new Error("gridcn: this hook must be used inside a <DataGridProvider>.");
  }
  return store;
}

export function useDataGridStore<T>(selector: (state: DataGridStoreState) => T): T {
  return useStore(useDataGridStoreApiInternal(), selector);
}

/**
 * Escape hatch for internal engine components that need imperative `getState()`
 * access in event handlers. Not for consumer use.
 * @internal
 */
export function useDataGridStoreApi(): StoreApi<DataGridStoreState> {
  return useDataGridStoreApiInternal();
}
