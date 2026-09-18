"use client";

import { useEffect, useRef, type ReactNode } from "react";
import {
  isDev,
  useDataGridFilterState,
  useDataGridSearchText,
  useDataGridSortState,
} from "@/registry/default/blocks/data-grid/data-grid";

/** Props for {@link DataGridLazyGuard}. */
export type DataGridLazyGuardProps = {
  /** Whether unloaded rows currently exist (e.g. `lazy.unloadedCount > 0`); the warning only makes sense while data is partial. */
  hasHoles: boolean;
};

let warned = false;

/**
 * Dev-only guardrail (lazy-loading design doc constraint: "client-side sort/filter/search are
 * incompatible with partial data"): mount once inside `<DataGridProvider>`, alongside
 * `<DataGridRoot>`. Renders nothing. Sort/filter/search are only reachable here through the
 * store's own committed state (`useDataGridSortState`/`useDataGridFilterState`/`useDataGridSearchText`)
 * because `useDataGridLazyRows` itself runs OUTSIDE the provider (it builds the props the provider
 * is constructed from) and so has no access to whether sort/filter is controlled. A change to any
 * of the three while holes still exist means either an uncontrolled header-click/filter-menu/search
 * gesture fired (client-side, over incomplete data — the unsupported case) or the consumer's own
 * controlled `sortState`/`filterState`/`searchText` changed, which is the supported server-driven
 * path; this guard can't tell those apart from inside the store, so it warns either way and leaves
 * it to the consumer to recognize which case applies. Zero cost in production (isDev() short-circuits).
 */
export function DataGridLazyGuard({ hasHoles }: DataGridLazyGuardProps): ReactNode {
  const sortState = useDataGridSortState();
  const filterState = useDataGridFilterState();
  const searchText = useDataGridSearchText();

  const prevRef = useRef({ sortState, filterState, searchText });
  useEffect(() => {
    const prev = prevRef.current;
    const changed = prev.sortState !== sortState || prev.filterState !== filterState || prev.searchText !== searchText;
    prevRef.current = { sortState, filterState, searchText };
    if (!isDev() || !changed || !hasHoles || warned) return;
    warned = true;
    console.warn(
      "[data-grid-lazy] sort/filter/search changed while rows are still unloaded. Client-side sort/filter/search cannot see rows it hasn't fetched — pass DataGrid's sortState/filterState/searchText as controlled props (the server escape hatch) when using useDataGridLazyRows.",
    );
  }, [sortState, filterState, searchText, hasHoles]);

  return null;
}
