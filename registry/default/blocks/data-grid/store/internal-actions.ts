import type { StoreApi } from "zustand/vanilla";
import type { DataGridActions, DataGridInternalActions, DataGridStoreState } from "./types";

/**
 * One actions table per store, kept OUT of the store state: `state.actions` (and the
 * `useDataGridActions()`/`api.actions`/`DataGridReadState` views of it) expose the public actions
 * only, while the `_`-prefixed internals the core wiring calls (`_syncProps`, `_register*`,
 * `_moveActiveCell`, …) live here. The accessor returns both merged into one stable object, so
 * internal call sites and tests get a single table. Reached only through {@link getInternalActions}
 * from inside the block — neither the consumer barrel nor the sdk barrel exports it.
 */
const internalActionsByStore = new WeakMap<StoreApi<DataGridStoreState>, DataGridInternalActions>();
const mergedActionsByStore = new WeakMap<StoreApi<DataGridStoreState>, DataGridInternalActions & DataGridActions>();

/** Records the store's internal-actions table (called once at store creation). */
export function registerInternalActions(store: StoreApi<DataGridStoreState>, actions: DataGridInternalActions): void {
  internalActionsByStore.set(store, actions);
}

/**
 * The store's actions table, public and internal. Built lazily on first access (the registration
 * runs inside the store's initializer, before state exists), and cached: both source tables keep
 * their identity for the store's lifetime, so the merge does too.
 */
export function getInternalActions(store: StoreApi<DataGridStoreState>): DataGridInternalActions & DataGridActions {
  let merged = mergedActionsByStore.get(store);
  if (!merged) {
    const internal = internalActionsByStore.get(store);
    if (!internal) throw new Error("gridcn: no internal actions registered for this store");
    merged = { ...store.getState().actions, ...internal };
    mergedActionsByStore.set(store, merged);
  }
  return merged;
}
