"use client";

import { useCallback, useEffect, useState } from "react";
import type { DataGridPlugin, DataGridStoreWrapper } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridStoreApi } from "@/registry/default/blocks/data-grid/data-grid-sdk";

/** The rows an answer must not overwrite: a save is pending, or an edit session is open. */
export type ProtectedRows = ReadonlySet<string> | null;

type Holder = { store: DataGridStoreWrapper | null; everMounted: boolean; edited: boolean };

function markEditedOn(holder: Holder) {
  holder.edited = true;
}

function createGuardPlugin(holder: Holder): DataGridPlugin<unknown> {
  function RefreshGuardMount() {
    const store = useDataGridStoreApi();
    useEffect(() => {
      holder.store = store;
      holder.everMounted = true;
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
  const [holder] = useState<Holder>(() => ({ store: null, everMounted: false, edited: false }));
  const [plugins] = useState(() => [createGuardPlugin(holder)]);
  const protectedRows = useCallback((): ProtectedRows => {
    const state = holder.store?.getState();
    if (!state) return null;
    const ids = new Set<string>();
    for (const [rowId, status] of state.saveStatus) if (status === "saving") ids.add(rowId);
    if (state.editing) ids.add(state.editing.rowId);
    return ids.size > 0 ? ids : null;
  }, [holder]);
  const guardMissing = useCallback(() => holder.edited && !holder.everMounted, [holder]);
  const markEdited = useCallback(() => markEditedOn(holder), [holder]);
  return { plugins, protectedRows, guardMissing, markEdited };
}

export const GUARD_MISSING_MESSAGE =
  "refresh cannot protect rows with a pending save or an open edit because the refresh guard plugin never mounted; if you pass your own `plugins` prop to the provider, put ...gridProps.plugins first in it";

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

/** The local rows a refresh protects, by id, with the slot each held when the refresh started. */
export type RowSnapshot<TData> = Map<string, { row: TData; index: number }>;

/** Adds the protected rows found in the given index ranges of `rows` to `snapshot`; a row already in it takes the latest value and slot. */
export function collectProtectedRows<TData>(
  snapshot: RowSnapshot<TData>,
  rows: readonly (TData | undefined)[],
  ranges: readonly { start: number; end: number }[],
  guarded: ReadonlySet<string>,
  idOf: (row: TData, index: number) => string,
) {
  for (const { start, end } of ranges) {
    for (let index = start; index < Math.min(end, rows.length); index++) {
      const row = rows[index];
      if (row === undefined) continue;
      const id = idOf(row, index);
      if (guarded.has(id)) snapshot.set(id, { row, index });
    }
  }
}

/**
 * Writes blocks into a copy of `prev`. A snapshot row keeps its local value and appears once, at the index the answer gives it.
 * `cleared` lists the slots left empty because the row moved away from them.
 */
export function writeBlocks<TData>(
  prev: readonly (TData | undefined)[],
  blocks: readonly { start: number; rows: readonly (TData | undefined)[] }[],
  snapshot: RowSnapshot<TData> | null,
  idOf: (row: TData, index: number) => string,
): { rows: (TData | undefined)[]; cleared: number[] } {
  const next = prev.slice();
  const guarded = snapshot !== null && snapshot.size > 0 ? snapshot : null;
  const moved: { id: string; index: number }[] = [];
  for (const { start, rows } of blocks) {
    for (let i = 0; i < rows.length && start + i < next.length; i++) {
      const incoming = rows[i];
      const id = guarded === null || incoming === undefined ? undefined : idOf(incoming, start + i);
      const own = id === undefined ? undefined : guarded!.get(id);
      if (own === undefined) {
        next[start + i] = incoming;
        continue;
      }
      next[start + i] = own.row;
      if (own.index !== start + i) moved.push({ id: id!, index: own.index });
    }
  }
  const cleared: number[] = [];
  for (const { id, index } of moved) {
    const left = next[index];
    if (left !== undefined && idOf(left, index) === id) {
      next[index] = undefined;
      cleared.push(index);
    }
  }
  return { rows: next, cleared };
}
