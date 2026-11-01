import type { StoreApi } from "zustand/vanilla";
import { isDev } from "../is-dev";
import { warnDev } from "./commit";
import type { DataGridStoreState } from "./types";

function hasHole(data: readonly unknown[]): boolean {
  for (let i = 0; i < data.length; i++) if (data[i] === undefined) return true;
  return false;
}

/** Warns once per store when a client sort or filter changes while `data` holds unloaded rows. */
export function watchClientViewOverHoles(store: StoreApi<DataGridStoreState>): () => void {
  let warned = false;
  return store.subscribe((state, prev) => {
    if (warned || !isDev()) return;
    const sortChanged = state.sortMode !== "server" && state.sortState !== prev.sortState;
    const filterChanged = state.filterMode !== "server" && state.filterState !== prev.filterState;
    if (!sortChanged && !filterChanged) return;
    if (!hasHole(state.data)) return;
    warned = true;
    warnDev(
      'a client sort or filter changed while data holds unloaded rows. The client cannot sort or filter rows it has not fetched; use sortMode="server" and filterMode="server" and send the sort and filter to your backend.',
    );
  });
}
