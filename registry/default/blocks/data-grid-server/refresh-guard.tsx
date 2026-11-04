"use client";

import { useCallback, useEffect, useState } from "react";
import type { DataGridPlugin, DataGridReadState, DataGridStoreWrapper } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridStoreApi } from "@/registry/default/blocks/data-grid/data-grid-sdk";

/**
 * The rule: a block that lands (refresh, retry or window load) replaces every row it carries, except a row that has a pending
 * cell edit, a save in flight, or a save that was in flight at any moment since the request was sent: that row keeps its local
 * value. Everything else is replaced, and a block never creates a duplicate id or a hole.
 */

/** The rows an answer must not overwrite: a save is pending, or an edit session is open. */
export type ProtectedRows = ReadonlySet<string> | null;

type Holder = {
  store: DataGridStoreWrapper | null;
  everMounted: boolean;
  edited: boolean;
  generation: number;
  /** Saves are tracked only while a request is open. */
  recording: boolean;
  /** Row id -> generation of its latest save start; holds one entry per saved row, dropped when no request is open. */
  savedAt: Map<string, number>;
};

function markEditedOn(holder: Holder) {
  holder.edited = true;
}

function trackSaveStarts(holder: Holder, state: DataGridReadState, prev: DataGridReadState) {
  if (!holder.recording || state.saveStatus === prev.saveStatus) return;
  for (const [id, status] of state.saveStatus) {
    if (status === "saving" && prev.saveStatus.get(id) !== "saving") holder.savedAt.set(id, ++holder.generation);
  }
}

function savedSinceOn(holder: Holder, generation: number): ProtectedRows {
  let ids: Set<string> | null = null;
  for (const [id, at] of holder.savedAt) if (at > generation) (ids ??= new Set()).add(id);
  return ids;
}

function markSavesOn(holder: Holder): number {
  holder.recording = true;
  return holder.generation;
}

function pruneSavesOn(holder: Holder, oldestGeneration: number | null) {
  holder.recording = oldestGeneration !== null;
  if (oldestGeneration === null) holder.savedAt.clear();
  else for (const [id, at] of holder.savedAt) if (at <= oldestGeneration) holder.savedAt.delete(id);
}

function createGuardPlugin(holder: Holder): DataGridPlugin<unknown> {
  function RefreshGuardMount() {
    const store = useDataGridStoreApi();
    useEffect(() => {
      holder.store = store;
      holder.everMounted = true;
      const unsubscribe = store.subscribe((state, prev) => trackSaveStarts(holder, state, prev));
      return () => {
        unsubscribe();
        holder.store = null;
      };
    }, [store]);
    return null;
  }
  return { name: "server-rows-refresh-guard", Mount: RefreshGuardMount };
}

/** A plugin that gives the hook, which sits outside the provider, read access to the grid's save status and edit session. */
export function useRefreshGuard() {
  const [holder] = useState<Holder>(() => ({ store: null, everMounted: false, edited: false, generation: 0, recording: false, savedAt: new Map() }));
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
  const saveMark = useCallback(() => markSavesOn(holder), [holder]);
  const savedSince = useCallback((mark: number) => savedSinceOn(holder, mark), [holder]);
  const pruneSaves = useCallback((oldestMark: number | null) => pruneSavesOn(holder, oldestMark), [holder]);
  return { plugins, protectedRows, guardMissing, markEdited, saveMark, savedSince, pruneSaves };
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

/** The union of two protected sets; either may be `null`. */
export function unionIds(a: ProtectedRows, b: ProtectedRows): ProtectedRows {
  if (a === null) return b;
  if (b === null || a === b) return a;
  return new Set([...a, ...b]);
}

export type GuardedBlock<TData> = { start: number; rows: readonly (TData | undefined)[]; guard: ProtectedRows };

/** Moves the guarded rows in the given index ranges into `into`, for the block that brings their ids back. */
export function stashGuardedRows<TData>(
  rows: readonly (TData | undefined)[],
  ranges: readonly { start: number; end: number }[],
  guarded: ReadonlySet<string>,
  into: Map<string, TData>,
  idOf: (row: TData, index: number) => string,
) {
  for (const { start, end } of ranges) {
    for (let index = start; index < Math.min(end, rows.length); index++) {
      const row = rows[index];
      if (row !== undefined && guarded.has(idOf(row, index))) into.set(idOf(row, index), row);
    }
  }
}

function findSlot<TData>(rows: readonly (TData | undefined)[], ranges: readonly { start: number; end: number }[], id: string, idOf: (row: TData, index: number) => string): number {
  for (const { start, end } of ranges) {
    for (let index = start; index < Math.min(end, rows.length); index++) {
      const row = rows[index];
      if (row !== undefined && idOf(row, index) === id) return index;
    }
  }
  return -1;
}

/**
 * Writes blocks into a copy of `prev`. A block guards the ids it was requested with plus the `live` ones: such a row keeps its
 * local value and appears once, at the index the answer gives it. `displaced` holds a guarded row that an earlier block overwrote,
 * for the block that brings its id back. `cleared` lists the slots left empty because a row moved away from them.
 */
export function writeBlocks<TData>(
  prev: readonly (TData | undefined)[],
  blocks: readonly GuardedBlock<TData>[],
  live: ProtectedRows,
  displaced: Map<string, TData>,
  ranges: readonly { start: number; end: number }[],
  idOf: (row: TData, index: number) => string,
): { rows: (TData | undefined)[]; cleared: number[] } {
  const next = prev.slice();
  const emptied: number[] = [];
  for (const { start, rows, guard } of blocks) {
    const guarded = unionIds(guard, live);
    for (let i = 0; i < rows.length && start + i < next.length; i++) {
      const slot = start + i;
      const incoming = rows[i];
      if (guarded === null) {
        next[slot] = incoming;
        continue;
      }
      const occupant = next[slot];
      const occupantId = occupant === undefined ? undefined : idOf(occupant, slot);
      const incomingId = incoming === undefined ? undefined : idOf(incoming, slot);
      if (incomingId !== undefined && guarded.has(incomingId)) {
        if (occupantId === incomingId) continue;
        if (occupantId !== undefined && guarded.has(occupantId)) displaced.set(occupantId, occupant as TData);
        const kept = displaced.get(incomingId);
        const from = kept === undefined ? findSlot(next, ranges, incomingId, idOf) : -1;
        const local = kept ?? (from >= 0 ? next[from] : undefined);
        next[slot] = local ?? incoming;
        if (local !== undefined && from >= 0) {
          next[from] = undefined;
          emptied.push(from);
        }
        continue;
      }
      if (occupantId !== undefined && guarded.has(occupantId)) displaced.set(occupantId, occupant as TData);
      next[slot] = incoming;
    }
  }
  return { rows: next, cleared: emptied.filter((slot) => next[slot] === undefined) };
}
