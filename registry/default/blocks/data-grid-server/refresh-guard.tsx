"use client";

import { useCallback, useEffect, useState } from "react";
import type { DataGridPlugin, DataGridStoreWrapper } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridStoreApi } from "@/registry/default/blocks/data-grid/data-grid-sdk";

/** The rows an answer must not overwrite: a save is pending, or an edit session is open. */
export type ProtectedRows = ReadonlySet<string> | null;

type Holder = { store: DataGridStoreWrapper | null };

function createGuardPlugin(holder: Holder): DataGridPlugin<unknown> {
  function RefreshGuardMount() {
    const store = useDataGridStoreApi();
    useEffect(() => {
      holder.store = store;
      return () => {
        holder.store = null;
      };
    }, [store]);
    return null;
  }
  return { name: "server-rows-refresh-guard", Mount: RefreshGuardMount };
}

/** A plugin that gives the hook, which sits outside the provider, read access to the grid's save status and edit session. */
export function useRefreshGuard() {
  const [holder] = useState<Holder>(() => ({ store: null }));
  const [plugins] = useState(() => [createGuardPlugin(holder)]);
  const protectedRows = useCallback((): ProtectedRows => {
    const state = holder.store?.getState();
    if (!state) return null;
    const ids = new Set<string>();
    for (const [rowId, status] of state.saveStatus) if (status === "saving") ids.add(rowId);
    if (state.editing) ids.add(state.editing.rowId);
    return ids.size > 0 ? ids : null;
  }, [holder]);
  return { plugins, protectedRows };
}
