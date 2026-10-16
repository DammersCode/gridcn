"use client";

import { useEffect, useRef, type ReactNode } from "react";
import {
  useDataGridFilterState,
  useDataGridSearchText,
  useDataGridSelector,
  useDataGridSortState,
} from "@/registry/default/blocks/data-grid/data-grid";
import { isDev } from "@/registry/default/blocks/data-grid/data-grid-sdk";

/** Props for {@link DataGridLazyGuard}. */
export type DataGridLazyGuardProps = {
  /** Whether unloaded rows currently exist (e.g. `lazy.unloadedCount > 0`); the warning only makes sense while data is partial. */
  hasHoles: boolean;
};

let warned = false;

/**
 * Dev-only guardrail: client-side sort/filter/search are incompatible with partial data (lazy
 * loading). Mount once inside `<DataGridProvider>`, alongside `<DataGridRoot>`. Renders nothing.
 * Sort/filter/search are only reachable here through the store's own committed state
 * (`useDataGridSortState`/`useDataGridFilterState`/`useDataGridSearchText`), because
 * `useDataGridLazyRows` runs OUTSIDE the provider and has no access to whether sort/filter is
 * controlled. A change to any of the three while holes still exist means either an uncontrolled
 * header-click/filter-menu/search gesture fired (client-side, over incomplete data) or the
 * consumer's controlled `filterState`/`searchText` changed. This guard can't tell those apart, so
 * it warns either way. Sort changes are ignored under `sortMode="server"`, where the server owns
 * the order. Zero cost in production (isDev() short-circuits).
 */
export function DataGridLazyGuard({ hasHoles }: DataGridLazyGuardProps): ReactNode {
  const sortState = useDataGridSortState();
  const filterState = useDataGridFilterState();
  const searchText = useDataGridSearchText();
  const serverSort = useDataGridSelector((s) => s.sortMode === "server");

  const prevRef = useRef({ sortState, filterState, searchText });
  useEffect(() => {
    const prev = prevRef.current;
    const changed = (!serverSort && prev.sortState !== sortState) || prev.filterState !== filterState || prev.searchText !== searchText;
    prevRef.current = { sortState, filterState, searchText };
    if (!isDev() || !changed || !hasHoles || warned) return;
    warned = true;
    console.warn(
      "[data-grid-lazy] sort/filter/search changed while rows are still unloaded. Client-side sort/filter/search cannot see rows it hasn't fetched — use sortMode=\"server\" with onSortChange for sorting, and hand filterState/searchText to your backend, when using useDataGridLazyRows.",
    );
  }, [sortState, filterState, searchText, serverSort, hasHoles]);

  return null;
}
