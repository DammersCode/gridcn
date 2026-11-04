"use client";

import { useCallback, useEffect, useState } from "react";
import type { DataGridPlugin, DataGridReadState, DataGridStoreWrapper } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridStoreApi } from "@/registry/default/blocks/data-grid/data-grid-sdk";

/**
 * The rule: a block that lands (refresh, retry or window load) replaces every row it carries, except a row that has a pending
 * cell edit or a save that was in flight at any moment since the request was sent: that row keeps its local value. A row with
 * a pending delete is gone: the answer's copy is dropped and its slot stays empty. A protected row that the answer lacks, such as a
 * pending insert, returns to its own slot when no answer row sits there; otherwise it is hidden, and a counted source refreshes
 * when no pending insert or delete is left. A pages refresh appends such a row at the page end (the page can exceed `pageSize`
 * by pending inserts); a sequential refresh that ends before a pending insert may drop it until its save settles.
 * Everything else is replaced. A block shows each id once (the first row of a repeated id in an answer wins) and leaves no hole in its
 * loaded range; rows that moved on the server can mix with older rows until the next refresh settles.
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
  /** Rows of a local insert or delete whose save is pending. */
  structural: Set<string>;
  /** Called when the last pending insert or delete save settled. */
  onStructuralSettled: (() => void) | null;
};

function setListenerOn(holder: Holder, listener: (() => void) | null) {
  holder.onStructuralSettled = listener;
}

function trackStructural(holder: Holder, change: { source: string; ops: readonly { type: string; rowId: string }[] }) {
  if (change.source === "stream" || change.source === "rollback") return;
  const status = holder.store?.getState().saveStatus;
  for (const op of change.ops) if ((op.type === "insert" || op.type === "delete") && status?.get(op.rowId) === "saving") holder.structural.add(op.rowId);
}

function markEditedOn(holder: Holder) {
  holder.edited = true;
}

function trackSaves(holder: Holder, state: DataGridReadState, prev: DataGridReadState) {
  if (state.saveStatus === prev.saveStatus) return;
  if (holder.structural.size > 0) {
    for (const [id, status] of prev.saveStatus) {
      if (status === "saving" && state.saveStatus.get(id) !== "saving" && holder.structural.delete(id) && holder.structural.size === 0) holder.onStructuralSettled?.();
    }
  }
  if (!holder.recording) return;
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
      const unsubscribe = store.subscribe((state, prev) => trackSaves(holder, state, prev));
      return () => {
        unsubscribe();
        holder.store = null;
      };
    }, [store]);
    return null;
  }
  return { name: "server-rows-refresh-guard", Mount: RefreshGuardMount, onDataChange: (_next, change) => trackStructural(holder, change) };
}

/** A plugin that gives the hook, which sits outside the provider, read access to the grid's save status and edit session. */
export function useRefreshGuard() {
  const [holder] = useState<Holder>(() => ({ store: null, everMounted: false, edited: false, generation: 0, recording: false, savedAt: new Map(), structural: new Set(), onStructuralSettled: null }));
  const [plugins] = useState(() => [createGuardPlugin(holder)]);
  const savingRows = useCallback((): ProtectedRows => {
    const state = holder.store?.getState();
    if (!state) return null;
    const ids = new Set<string>();
    for (const [rowId, status] of state.saveStatus) if (status === "saving") ids.add(rowId);
    return ids.size > 0 ? ids : null;
  }, [holder]);
  const protectedRows = useCallback((): ProtectedRows => {
    const editing = holder.store?.getState().editing;
    return editing ? unionIds(savingRows(), new Set([editing.rowId])) : savingRows();
  }, [holder, savingRows]);
  const guardMissing = useCallback(() => holder.edited && !holder.everMounted, [holder]);
  const markEdited = useCallback(() => markEditedOn(holder), [holder]);
  const saveMark = useCallback(() => markSavesOn(holder), [holder]);
  const savedSince = useCallback((mark: number) => savedSinceOn(holder, mark), [holder]);
  const setSettleListener = useCallback((listener: (() => void) | null) => setListenerOn(holder, listener), [holder]);
  const forgetStructural = useCallback(() => holder.structural.clear(), [holder]);
  const pruneSaves = useCallback((oldestMark: number | null) => pruneSavesOn(holder, oldestMark), [holder]);
  return { plugins, protectedRows, savingRows, guardMissing, markEdited, saveMark, savedSince, pruneSaves, setSettleListener, forgetStructural };
}

export const GUARD_MISSING_MESSAGE =
  "refresh cannot protect rows with a pending save or an open edit because the refresh guard plugin never mounted; if you pass your own `plugins` prop to the provider, put ...gridProps.plugins first in it";

/** Applies the rule to an incoming page: a deleted row is dropped, a protected row keeps its local value by id, and a protected row the page lacks stays at the end. */
export function keepProtectedRows<TData>(
  incoming: readonly TData[],
  current: readonly TData[],
  guarded: ProtectedRows,
  deleted: ReadonlySet<string>,
  keepMissing: boolean,
  idOf: (row: TData, index: number) => string,
): TData[] {
  if (guarded === null && deleted.size === 0) return incoming as TData[];
  const local = new Map<string, TData>();
  current.forEach((row, index) => {
    const id = idOf(row, index);
    if (guarded?.has(id)) local.set(id, row);
  });
  const placed = new Set<string>();
  const page: TData[] = [];
  incoming.forEach((row, index) => {
    const id = idOf(row, index);
    if (deleted.has(id)) return;
    placed.add(id);
    page.push(local.get(id) ?? row);
  });
  if (keepMissing) for (const [id, row] of local) if (!placed.has(id) && !deleted.has(id)) page.push(row);
  return page;
}

/** Notes the rows a change deleted, and forgets a row that a change inserted again. */
export function trackDeletes(deleted: Set<string>, change: { ops: readonly { type: string; rowId: string }[] }) {
  for (const op of (change.ops as typeof change.ops | undefined) ?? []) {
    if (op.type === "delete") deleted.add(op.rowId);
    else if (op.type === "insert") deleted.delete(op.rowId);
  }
}

/** Drops the rows whose delete is no longer pending. */
export function pruneIds(ids: Set<string>, stillSaving: ProtectedRows) {
  for (const id of ids) if (!stillSaving?.has(id)) ids.delete(id);
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
  orphans: Map<string, { row: TData; slot: number }>,
) {
  for (const { start, end } of ranges) {
    for (let index = start; index < Math.min(end, rows.length); index++) {
      const row = rows[index];
      if (row !== undefined && guarded.has(idOf(row, index))) {
        into.set(idOf(row, index), row);
        orphans.set(idOf(row, index), { row, slot: index });
      }
    }
  }
}

function findSlot<TData>(rows: readonly (TData | undefined)[], ranges: readonly { start: number; end: number }[], id: string, idOf: (row: TData, index: number) => string, near: number): number {
  for (const index of [near - 1, near + 1]) {
    const row = rows[index];
    if (row !== undefined && idOf(row, index) === id) return index;
  }
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
  memory: { orphans: Map<string, { row: TData; slot: number }>; carried: Set<string> },
  final = false,
): { rows: (TData | undefined)[]; cleared: number[] } {
  const next = prev.slice();
  const emptied: number[] = [];
  const { carried, orphans: overwritten } = memory;
  const stillProtected = new Set<string>();
  for (const { start, rows, guard } of blocks) {
    const guarded = unionIds(guard, live);
    if (guarded !== null) for (const id of guarded) stillProtected.add(id);
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
      if (incomingId !== undefined) carried.add(incomingId);
      if (incomingId !== undefined && guarded.has(incomingId)) {
        if (occupantId === incomingId) continue;
        if (occupantId !== undefined && guarded.has(occupantId)) {
          displaced.set(occupantId, occupant as TData);
          overwritten.set(occupantId, { row: occupant as TData, slot });
        }
        const from = findSlot(next, ranges, incomingId, idOf, slot);
        const local = from >= 0 ? next[from] : displaced.get(incomingId);
        next[slot] = local ?? incoming;
        if (local !== undefined && from >= 0) {
          next[from] = undefined;
          emptied.push(from);
        }
        continue;
      }
      if (occupantId !== undefined && guarded.has(occupantId)) {
        displaced.set(occupantId, occupant as TData);
        overwritten.set(occupantId, { row: occupant as TData, slot });
      }
      next[slot] = incoming;
    }
  }
  // Nothing else is loading: a protected row that the answer does not carry (a pending insert) returns to its own slot when no answer row sits there.
  if (final) {
    for (const [id, { row, slot }] of overwritten) {
      if (carried.has(id) || !stillProtected.has(id) || slot >= next.length || next[slot] !== undefined) continue;
      next[slot] = row;
    }
  }
  return { rows: next, cleared: emptied.filter((slot) => next[slot] === undefined) };
}
