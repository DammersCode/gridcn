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
  const guardMounted = useCallback(() => holder.store !== null, [holder]);
  return { plugins, protectedRows, guardMounted };
}

export const GUARD_MISSING_MESSAGE =
  "refresh cannot protect rows with a pending save or an open edit because the plugin in gridProps.plugins never mounted; your own `plugins` prop replaced it, so put ...gridProps.plugins first in it";

/** Keeps the local value of each protected row in an incoming page, matched by id. */
export function keepProtectedRows<TData>(incoming: readonly TData[], current: readonly TData[], guarded: ProtectedRows, idOf: (row: TData, index: number) => string): TData[] {
  if (guarded === null) return incoming as TData[];
  const local = new Map<string, TData>();
  current.forEach((row, index) => {
    const id = idOf(row, index);
    if (guarded.has(id)) local.set(id, row);
  });
  return incoming.map((row, index) => local.get(idOf(row, index)) ?? row);
}

/** Writes blocks into a copy of `prev`. A protected row keeps its local value and appears once, at the index the answer gives it. */
export function writeBlocks<TData>(
  prev: readonly (TData | undefined)[],
  blocks: readonly { start: number; rows: readonly (TData | undefined)[] }[],
  guarded: ProtectedRows,
  idOf: (row: TData, index: number) => string,
): (TData | undefined)[] {
  const next = prev.slice();
  const local = new Map<string, { row: TData; index: number }>();
  if (guarded !== null) {
    prev.forEach((row, index) => {
      if (row !== undefined && guarded.has(idOf(row, index))) local.set(idOf(row, index), { row, index });
    });
  }
  const moved: { row: TData; index: number }[] = [];
  for (const { start, rows } of blocks) {
    for (let i = 0; i < rows.length && start + i < next.length; i++) {
      const incoming = rows[i];
      const own = incoming === undefined ? undefined : local.get(idOf(incoming, start + i));
      if (own === undefined) {
        next[start + i] = incoming;
        continue;
      }
      next[start + i] = own.row;
      if (own.index !== start + i) moved.push(own);
    }
  }
  for (const { row, index } of moved) if (next[index] === row) next[index] = undefined;
  return next;
}
