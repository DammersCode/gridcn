import type { DataGridStoreState } from "./types";

type WarnOnce = (key: string, message: string) => void;

/** Dev-warns once per grid when a sort or filter change lands on a server-mode part that no `onSortChange` or `onFilterChange` handles, so no request carries it. */
export function warnUnhandledServerSpec(state: DataGridStoreState, prev: DataGridStoreState, warn: WarnOnce): void {
  if (state.sortState !== prev.sortState && state.sortMode === "server" && state.onSortChange === undefined) {
    warn("unhandled server sort", 'the sort changed, but sortMode is "server" (totalRowCount sets it by default) and nothing handles onSortChange, so no request carries it and the rows keep their order. Pass onSortChange and sortState to your fetch, or set sortMode="client"');
  }
  if (state.filterState !== prev.filterState && state.filterMode === "server" && state.onFilterChange === undefined) {
    warn("unhandled server filter", 'the filters changed, but filterMode is "server" (totalRowCount sets it by default) and nothing handles onFilterChange, so no request carries them and the rows stay. Pass onFilterChange and filterState to your fetch, or set filterMode="client"');
  }
}
