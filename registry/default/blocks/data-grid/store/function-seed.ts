import type { StoreApi } from "zustand/vanilla";
import { toSafeText } from "../cell-types/safe-text";
import { warnDev } from "../is-dev";
import type { FilterNode, SortSpec } from "../types";
import type { DataGridStoreState, InternalSyncProps } from "./types";

/** A seed prop's value, or nothing for a function seed: the store starts empty and {@link applyFunctionSeeds} fills it after mount. */
export const plainSeed = <T>(seed: T | undefined): Exclude<T, () => unknown> | undefined => (typeof seed === "function" ? undefined : (seed as Exclude<T, () => unknown>));

function readSeed(name: string, seed: unknown): unknown {
  if (typeof seed !== "function") return undefined;
  try {
    return (seed as () => unknown)();
  } catch (error) {
    warnDev(`${name} threw, so the grid keeps its first state: ${toSafeText(error)}`);
    return undefined;
  }
}

const seededStores = new WeakSet<object>();

/** Calls each function seed once per store on the client after mount and applies what it returns; a controlled prop wins as with a plain seed. */
export function applyFunctionSeeds(store: StoreApi<DataGridStoreState>, init: InternalSyncProps): void {
  if (seededStores.has(store)) return;
  seededStores.add(store);
  const { actions } = store.getState();
  const sorts = init.sortState === undefined ? readSeed("defaultSortState", init.defaultSortState) : undefined;
  if (Array.isArray(sorts)) actions.setSorts(sorts as SortSpec[]);
  const filters = init.filterState === undefined ? readSeed("defaultFilterState", init.defaultFilterState) : undefined;
  if (Array.isArray(filters)) actions.setFilters(filters as FilterNode[]);
  const search = init.searchText === undefined ? readSeed("defaultSearchText", init.defaultSearchText) : undefined;
  if (typeof search === "string") actions.setSearch(search);
  const layout = init.columnLayout === undefined ? readSeed("defaultColumnLayout", init.defaultColumnLayout) : undefined;
  if (layout !== null && typeof layout === "object") actions.setColumnLayout(layout);
}
