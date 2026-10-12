"use client";

import { createContext, use, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { isDev } from "../is-dev";
import { apiHandleOf } from "./api";
import { checkDevGuardrails, checkDuplicateColumnIds, checkUnresolvableColumnTypes, warnDev, warnExternalStoreSyncPropsOnce } from "./commit";
import { holeRowId, makeSelectionChangeDetails, publicActionsOf, rowIdAtViewRow } from "./compute";
import { createDataGridStore } from "./create-store";
import { toInternalSyncProps } from "./types";
import type { AnyColumnDef, DataGridActions, DataGridProviderProps, DataGridStoreState, DataGridStoreStateOf, DataGridSyncProps, InternalSyncProps } from "./types";
import type { ViewCellRef, ViewCoord } from "../types";
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

/** The event payload for a cursor: the record's stable id (the index-derived placeholder id for an unloaded hole) plus its view position. */
function activeCellEvent(s: DataGridStoreState, coord: ViewCoord): ViewCellRef {
  const dataRowIndex = s.viewIndex[coord.row];
  const row = dataRowIndex === undefined ? undefined : s.data[dataRowIndex];
  return {
    rowId: dataRowIndex === undefined ? "" : row === undefined ? holeRowId(dataRowIndex) : s.getRowId(row, dataRowIndex),
    columnId: s.visibleColumns[coord.col]?.id ?? "",
    viewRowIndex: coord.row,
    viewColumnIndex: coord.col,
  };
}

/**
 * Wires `onActiveCellChange`: one `storeApi.subscribe` on `state.activeCell` that fires on a coord
 * move (the cursor following its record or column included), a clear, or a different record or
 * column under the cursor (a lazy load, a clamp). Re-selecting the same cell on the same record and
 * column does not fire.
 */
function subscribeActiveCellChange(store: StoreApi<DataGridStoreState>): () => void {
  return store.subscribe((state, prevState) => {
    if (!state.onActiveCellChange) return;
    const next = state.activeCell;
    const prev = prevState.activeCell;
    const viewChanged =
      state.viewIndex !== prevState.viewIndex || state.data !== prevState.data || state.getRowId !== prevState.getRowId;
    const columnsChanged = state.visibleColumns !== prevState.visibleColumns;
    if (next === prev && !viewChanged && !columnsChanged) return;
    if (next !== null && prev !== null && next.row === prev.row && next.col === prev.col) {
      const columnMoved = columnsChanged && prevState.visibleColumns[prev.col]?.id !== state.visibleColumns[next.col]?.id;
      const recordMoved = viewChanged && rowIdAtViewRow(prevState, prev.row) !== rowIdAtViewRow(state, next.row);
      if (!columnMoved && !recordMoved) return;
    } else if (next === prev) {
      return;
    }
    state.onActiveCellChange(next === null ? null : activeCellEvent(state, next));
  });
}

const DataGridStoreContext = createContext<StoreApi<DataGridStoreState> | null>(null);

const GridInstanceIdContext = createContext<string>("");

/**
 * This provider instance's id (a React `useId` value, stamped on the grid's root and toolbar
 * as `data-grid-instance`). Two grids on one page each get a distinct id, so DOM scoping checks
 * (the toolbar's mod+F capture) match this grid only.
 */
export function useDataGridInstanceId(): string {
  const instanceId = use(GridInstanceIdContext);
  if (instanceId === "") {
    throw new Error("gridcn: this hook must be used inside a <DataGridProvider>.");
  }
  return instanceId;
}

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

/** The recompute-phase slice: the inputs of derived state (`_syncProps` rebuilds the view index and search matches over them). */
const RECOMPUTE_KEYS = ["data", "columns", "getRowId", "cellTypes", "sortState", "filterState", "joinOperator", "searchText"] as const satisfies readonly (keyof DataGridSyncProps)[];
/** Seed-only props: applied once at store creation, ignored on later renders — in neither sync phase. */
const SEED_KEYS = ["defaultData", "defaultColumnLayout"] as const satisfies readonly (keyof DataGridSyncProps)[];
/** The config-phase slice: everything that feeds no derived state — `readOnly`, `keymap`, the `enable*` flags, and every callback. */
const CONFIG_KEYS = [
  "readOnly",
  "keymap",
  "onDataChange",
  "validateRow",
  "onUndo",
  "onRedo",
  "processCellForClipboard",
  "processCellFromClipboard",
  "processPaste",
  "sanitizeClipboardFormulas",
  "rowMarkers",
  "enableRowSelection",
  "enableColumnSelection",
  "enableRangeSelection",
  "enableMultiRange",
  "enableColumnResize",
  "enableColumnReorder",
  "enableRowReorder",
  "enableColumnPinning",
  "headerClickBehavior",
  "labels",
  "createRow",
  "duplicateRow",
  "commands",
  "onSortChange",
  "onFilterChange",
  "onJoinOperatorChange",
  "onSearchTextChange",
  "overlayPlugins",
  "rowBands",
  "autosizeOnMount",
  "onColumnLayoutChange",
  "onColumnResizing",
  "onSelectionChange",
  "onSelectionCleared",
  "onActiveCellChange",
  "onEditStart",
  "onEditEnd",
  "onValidationError",
  "onCellDoubleClick",
  "onCellContextMenu",
  "onCellClick",
  "onRowClick",
  "onRowWindowChange",
] as const satisfies readonly (keyof DataGridSyncProps)[];

/** Fails the compile when a new sync prop lands in no slice list (a silently-unsynced prop). */
const _syncSliceExhaustive: (Exclude<keyof DataGridSyncProps, (typeof RECOMPUTE_KEYS)[number] | (typeof SEED_KEYS)[number] | (typeof CONFIG_KEYS)[number]> extends never ? true : never) = true;
void _syncSliceExhaustive;

/** True when any of `keys` differs by reference between `last` and `next`. */
function sliceChanged(last: InternalSyncProps, next: InternalSyncProps, keys: readonly (keyof InternalSyncProps)[]): boolean {
  for (const key of keys) {
    if (last[key] !== next[key]) return true;
  }
  return false;
}

/**
 * The store-ownership core shared by {@link useDataGridStoreProps} and `DataGridProvider`'s
 * default (self-creating) path — one sync loop, guardrail checks, and subscription wiring for
 * both. When `externalStore` is set the hook owns nothing: no creation, no sync, no
 * subscriptions; the consumer's own `useDataGridStoreProps` call drives the store, and this
 * instance only supplies the context value.
 *
 * The sync runs in two phases, each with no deps array (the slice compare against the last
 * synced slice is the gate): a layout effect writes the config slice so a `readOnly` flip is
 * live before the browser paints or dispatches the next event, and a passive effect writes the
 * recompute slice so the O(n log n) view rebuild stays off the layout-effect path.
 */
function useGridStoreCore<TData>(
  props: DataGridSyncProps<TData>,
  externalStore: StoreApi<DataGridStoreState> | undefined,
): { store: StoreApi<DataGridStoreState>; actions: DataGridActions } {
  const internalInit = toInternalSyncProps(props);
  // Lazy: an external store means this instance owns nothing, and store creation computes the
  // initial view over the full dataset — it must not run for a shell.
  const [ownedStore] = useState<StoreApi<DataGridStoreState> | null>(() => (externalStore ? null : createDataGridStore(internalInit)));
  const store = externalStore ?? (ownedStore as StoreApi<DataGridStoreState>);
  const prevColumns = useRef<readonly AnyColumnDef[] | undefined>(undefined);
  const prevData = useRef<readonly unknown[] | undefined>(undefined);
  const warnedColumnTypes = useRef<Set<string>>(new Set());
  const warnedDuplicateColumnIds = useRef<Set<string>>(new Set());
  const lastConfig = useRef<InternalSyncProps | null>(null);
  const lastRecompute = useRef<InternalSyncProps | null>(null);

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
    return subscribeActiveCellChange(store);
  }, [store, externalStore]);
  useEffect(() => {
    if (externalStore) return;
    return store.getState().actions._subscribeEditEnd();
  }, [store, externalStore]);

  // Config phase: the slice that feeds no derived state. The layout timing closes the write
  // window between the commit and the passive effects, so a `readOnly` flip blocks a keydown
  // that arrives right after the commit.
  useLayoutEffect(() => {
    if (externalStore) return;
    const last = lastConfig.current;
    if (last !== null && !sliceChanged(last, internalInit, CONFIG_KEYS)) return;
    if (isDev() && last !== null) {
      if (last.overlayPlugins !== undefined && last.overlayPlugins !== internalInit.overlayPlugins) {
        warnDev(
          "overlayPlugins array identity changed since the last render; pass a stable reference (module scope or useMemo) or every render re-syncs the provider props into the store",
        );
      }
      if (last.rowBands !== undefined && last.rowBands !== internalInit.rowBands) {
        warnDev(
          "rowBands identity changed since the last render; pass a stable reference (the add-on's hook already returns one) or every render recomputes band heights/aria-rowcount",
        );
      }
    }
    lastConfig.current = internalInit;
    store.getState().actions._syncConfig(internalInit);
  });

  // Recompute phase: the derived-state inputs, off the layout-effect path.
  useEffect(() => {
    if (externalStore) return;
    const last = lastRecompute.current;
    if (last !== null && !sliceChanged(last, internalInit, RECOMPUTE_KEYS)) return;
    lastRecompute.current = internalInit;
    checkDevGuardrails(internalInit, prevColumns.current, prevData.current);
    checkDuplicateColumnIds(internalInit.columns, warnedDuplicateColumnIds.current);
    prevColumns.current = internalInit.columns;
    prevData.current = internalInit.data;
    store.getState().actions._syncProps(internalInit);
    checkUnresolvableColumnTypes(internalInit.columns, store.getState().cellTypes, warnedColumnTypes.current);
  });

  return { store, actions: publicActionsOf(store.getState().actions) };
}

/**
 * Provides the grid's store to the component subtree. By default it self-creates the store via
 * the same ownership core as {@link useDataGridStoreProps}; pass `store` to serve a
 * consumer-created store instead — then this component is a pure context shell and the sync
 * loop lives on the consumer's `useDataGridStoreProps` call. `ref` receives the grid's imperative handle.
 */
export function DataGridProvider<TData>(props: DataGridProviderProps<TData>): ReactNode {
  const { store: externalStore, children, ref, ...syncProps } = props;
  // The prop union makes a sync prop next to `store` a compile error; this catches a cast/untyped caller.
  if (externalStore && Object.values(syncProps).some((v) => v !== undefined)) {
    warnExternalStoreSyncPropsOnce();
  }
  // The rest's external-store branch types the sync keys as never; the core reads none of them when `externalStore` is set.
  const { store } = useGridStoreCore<TData>(syncProps as DataGridSyncProps<TData>, externalStore);
  useImperativeHandle(ref, () => apiHandleOf<TData>(store), [store]);
  // useId is hydration-safe and distinct per provider instance — two grids on one page each get their own id.
  const instanceId = useId();
  return (
    <DataGridStoreContext.Provider value={store}>
      <GridInstanceIdContext.Provider value={instanceId}>{children}</GridInstanceIdContext.Provider>
    </DataGridStoreContext.Provider>
  );
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
 * Typed raw store selector for the current grid: `TData` types `state.data`, so a selector that
 * reads rows gets them back typed (the same erasure-boundary guarantee as the provider — every
 * row in `state.data` originated from this grid's own `TData`-typed `data`/`defaultData` prop).
 * Both type arguments are explicit at the call (`useDataGridSelector<Row, readonly Row[]>((s) => s.data)`);
 * prefer {@link createDataGridSelector}, which fixes `TData` at the factory and infers the result.
 * `eq` (default `Object.is`) controls re-renders, like `useStore`.
 */
export function useDataGridSelector<TData, TResult>(
  selector: (state: DataGridStoreStateOf<TData>) => TResult,
  eq?: (a: TResult, b: TResult) => boolean,
): TResult {
  return useStoreWithEqualityFn(useDataGridStoreApiInternal(), (s) => selector(s as DataGridStoreStateOf<TData>), eq);
}

/**
 * Creates a typed raw store selector with `TData` fixed at the factory call: the returned hook
 * hands its selector `state.data` typed as `readonly TData[]` and infers the result type, so the
 * common one-type-argument form compiles without a second annotation. `eq` (default `Object.is`)
 * controls re-renders, like `useStore`.
 */
export function createDataGridSelector<TData>() {
  return function useDataGridSelector<TResult>(
    selector: (state: DataGridStoreStateOf<TData>) => TResult,
    eq?: (a: TResult, b: TResult) => boolean,
  ): TResult {
    return useStoreWithEqualityFn(useDataGridStoreApiInternal(), (s) => selector(s as DataGridStoreStateOf<TData>), eq);
  };
}

/**
 * Escape hatch for internal engine components that need imperative `getState()`
 * access in event handlers. Not for consumer use.
 * @internal
 */
export function useDataGridStoreApi(): StoreApi<DataGridStoreState> {
  return useDataGridStoreApiInternal();
}
