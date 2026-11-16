"use client";

import { useCallback, useEffect, useState } from "react";
import type { DataChange, DataGridPlugin, DataGridReadState, DataGridStoreWrapper } from "@/registry/default/blocks/data-grid/data-grid";
import { isDev, rowIdAtViewRow, setCellValue, setServerReshapeHandler, useDataGridStoreApi } from "@/registry/default/blocks/data-grid/data-grid-sdk";

/**
 * The rule: a block that lands (refresh, retry or window load) replaces every row it carries, except a row that has a pending
 * cell edit or a save that was in flight at any moment since the request was sent: that row keeps its local value. A row with
 * a pending delete is gone: the answer's copy is dropped and its slot stays empty. A protected row that the answer lacks, such as a
 * pending insert, returns to its own slot when no answer row sits there; otherwise it is hidden, and a counted source refreshes
 * when no pending insert or delete is left. A pages refresh appends such a row at the page end (the page can exceed `pageSize`
 * by pending inserts); a sequential refresh that ends before a pending insert may drop it until its save settles.
 * Everything else is replaced, except the cells that a push wrote after the request was sent: those keep the pushed value. A block shows each id once (the first row of a repeated id in an answer wins) and leaves no hole in its
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
  /** Called when a row's save starts. */
  onSaveStarted: (() => void) | null;
  /** Second save-start listener, for the check that the hook's `onSave` ran. */
  onSaveStartedCheck: (() => void) | null;
  /** Changes the hook's `onDataChange` merged, and changes the plugin observed; a gap means a provider `onDataChange` replaced the merge. */
  merged: number;
  seen: number;
  mergeWarned: boolean;
  /** The hook's own handlers: the observer runs `onDataChange` when a provider prop after the spread replaced it, and the mount checks `onRenderedRowsChange`. */
  handlers: GuardHandlers | null;
  /** Called when the last saving row leaves `"saving"`. */
  onSavesSettled: (() => void) | null;
  /** Called when the grid asks for a reshape: `reconcileView()`, an immediate push, or a deferred push that marked a row. */
  onReshape: ((trigger: "urgent" | "stale") => void) | null;
  /** Cells that a push wrote while a request was open: row id -> column id -> value and the generation of the push. Dropped when no request is open. */
  pushed: Map<string, Map<string, { value: unknown; at: number }>>;
  trackUnacknowledged: boolean;
  /** Rows with a local edit or insert that no save and no landed block has acknowledged; eviction keeps them. */
  unacknowledged: Set<string>;
};

function setListenerOn(holder: Holder, listener: (() => void) | null) {
  holder.onStructuralSettled = listener;
}

function setSaveListenerOn(holder: Holder, listener: (() => void) | null) {
  holder.onSaveStarted = listener;
}

function setSaveCheckOn(holder: Holder, listener: (() => void) | null) {
  holder.onSaveStartedCheck = listener;
}

function setSettledListenerOn(holder: Holder, listener: (() => void) | null) {
  holder.onSavesSettled = listener;
}

function setReshapeOn(holder: Holder, listener: ((trigger: "urgent" | "stale") => void) | null) {
  holder.onReshape = listener;
}

function hasSaving(status: ReadonlyMap<string, string>): boolean {
  for (const value of status.values()) if (value === "saving") return true;
  return false;
}

function trackStructural(holder: Holder, change: { source: string; ops: readonly { type: string; rowId: string }[] }) {
  if (change.source === "stream" || change.source === "rollback") return;
  const status = holder.store?.getState().saveStatus;
  for (const op of change.ops) if ((op.type === "insert" || op.type === "delete") && status?.get(op.rowId) === "saving") holder.structural.add(op.rowId);
}

function trackUnacknowledgedRows(holder: Holder, change: { source: string; ops: readonly { type: string; rowId: string }[] }) {
  if (!holder.trackUnacknowledged || change.source === "stream" || change.source === "rollback") return;
  for (const op of change.ops) {
    if (op.type === "update" || op.type === "insert") holder.unacknowledged.add(op.rowId);
    else if (op.type === "delete") holder.unacknowledged.delete(op.rowId);
  }
}

function trackPushedCells(holder: Holder, change: { source: string; ops: readonly { type: string; rowId: string; cells?: readonly { columnId: string; value: unknown }[] }[] }) {
  if (!holder.recording || change.source !== "stream") return;
  for (const op of change.ops) {
    if (op.type !== "update" || !op.cells) continue;
    const at = ++holder.generation;
    let cells = holder.pushed.get(op.rowId);
    if (!cells) holder.pushed.set(op.rowId, (cells = new Map<string, { value: unknown; at: number }>()));
    for (const cell of op.cells) cells.set(cell.columnId, { value: cell.value, at });
  }
}

function pushedSinceOn(holder: Holder, generation: number): ReadonlyMap<string, ReadonlyMap<string, unknown>> | null {
  let rows: Map<string, Map<string, unknown>> | null = null;
  for (const [rowId, cells] of holder.pushed) {
    let fresh: Map<string, unknown> | null = null;
    for (const [columnId, cell] of cells) if (cell.at > generation) (fresh ??= new Map()).set(columnId, cell.value);
    if (fresh) (rows ??= new Map()).set(rowId, fresh);
  }
  return rows;
}

function markEditedOn(holder: Holder) {
  holder.edited = true;
  holder.merged += 1;
}

function trackSaves(holder: Holder, state: DataGridReadState, prev: DataGridReadState) {
  if (state.saveStatus === prev.saveStatus) return;
  if (holder.unacknowledged.size > 0) {
    for (const [id, status] of prev.saveStatus) if (status === "saving" && state.saveStatus.get(id) !== "saving") holder.unacknowledged.delete(id);
  }
  if (holder.structural.size > 0) {
    for (const [id, status] of prev.saveStatus) {
      if (status === "saving" && state.saveStatus.get(id) !== "saving" && holder.structural.delete(id) && holder.structural.size === 0) holder.onStructuralSettled?.();
    }
  }
  let started = false;
  for (const [id, status] of state.saveStatus) {
    if (status !== "saving" || prev.saveStatus.get(id) === "saving") continue;
    started = true;
    if (holder.recording) holder.savedAt.set(id, ++holder.generation);
  }
  if (started) {
    holder.onSaveStarted?.();
    holder.onSaveStartedCheck?.();
  }
  if (holder.onSavesSettled && hasSaving(prev.saveStatus) && !hasSaving(state.saveStatus)) holder.onSavesSettled();
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
  if (oldestGeneration === null) {
    holder.savedAt.clear();
    holder.pushed.clear();
    return;
  }
  for (const [id, at] of holder.savedAt) if (at <= oldestGeneration) holder.savedAt.delete(id);
  for (const [id, cells] of holder.pushed) {
    for (const [columnId, cell] of cells) if (cell.at <= oldestGeneration) cells.delete(columnId);
    if (cells.size === 0) holder.pushed.delete(id);
  }
}

function createGuardPlugin(holder: Holder): DataGridPlugin<unknown> {
  function RefreshGuardMount() {
    const store = useDataGridStoreApi();
    useEffect(() => {
      holder.store = store;
      holder.everMounted = true;
      const unsubscribe = store.subscribe((state, prev) => trackSaves(holder, state, prev));
      setServerReshapeHandler(store, (trigger) => holder.onReshape?.(trigger));
      const own = holder.handlers?.onRenderedRowsChange;
      if (isDev() && own !== undefined && (store.getState() as { onRenderedRowsChange?: unknown }).onRenderedRowsChange !== own) {
        console.warn("[data-grid-server] an onRenderedRowsChange prop on DataGridProvider after {...gridProps} replaced the hook's handler, so scroll mode loads no rows. Pass your handler to the hook's onRenderedRowsChange option instead");
      }
      return () => {
        setServerReshapeHandler(store, null);
        unsubscribe();
        holder.store = null;
      };
    }, [store]);
    return null;
  }
  return {
    name: "server-rows-refresh-guard",
    Mount: RefreshGuardMount,
    onDataChange: (next, change) => {
      holder.seen += 1;
      // A provider onDataChange after the spread replaced the hook's merge; the merge runs here instead.
      if (holder.merged < holder.seen && holder.handlers) holder.handlers.onDataChange(next as readonly never[], change as DataChange<never>);
      if (isDev() && holder.merged < holder.seen && !holder.mergeWarned) {
        holder.mergeWarned = true;
        console.warn("[data-grid-server] a change reached the grid, but the hook's onDataChange merge did not run: an onDataChange prop on DataGridProvider after {...gridProps} replaced it, so edits vanish on the next render. Pass your handler to the hook's onDataChange option instead");
      }
      trackStructural(holder, change);
      trackUnacknowledgedRows(holder, change);
      trackPushedCells(holder, change);
    },
  };
}

export type GuardHandlers = { onDataChange: (next: readonly never[], change: DataChange<never>) => void; onRenderedRowsChange?: unknown };

export type RefreshGuardOptions = {
  /** Remember rows with a local change that no save acknowledged, for `evictionProtected`. Scroll mode only. */
  trackUnacknowledged?: boolean;
};

/** A plugin that gives the hook, which sits outside the provider, read access to the grid's save status and edit session. */
export function useRefreshGuard({ trackUnacknowledged = false }: RefreshGuardOptions = {}) {
  const [holder] = useState<Holder>(() => ({ store: null, everMounted: false, edited: false, generation: 0, recording: false, savedAt: new Map(), structural: new Set(), onStructuralSettled: null, onSaveStarted: null, onSaveStartedCheck: null, merged: 0, seen: 0, mergeWarned: false, handlers: null, onSavesSettled: null, onReshape: null, pushed: new Map(), trackUnacknowledged, unacknowledged: new Set() }));
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
  const setSaveStartListener = useCallback((listener: (() => void) | null) => setSaveListenerOn(holder, listener), [holder]);
  const setSaveCheckListener = useCallback((listener: (() => void) | null) => setSaveCheckOn(holder, listener), [holder]);
  const setSavesSettledListener = useCallback((listener: (() => void) | null) => setSettledListenerOn(holder, listener), [holder]);
  const setReshapeListener = useCallback((listener: ((trigger: "urgent" | "stale") => void) | null) => setReshapeOn(holder, listener), [holder]);
  const forgetStructural = useCallback(() => {
    holder.structural.clear();
    holder.unacknowledged.clear();
  }, [holder]);
  const evictionProtected = useCallback((): ProtectedRows => {
    const ids = holder.unacknowledged.size > 0 ? unionIds(protectedRows(), holder.unacknowledged) : protectedRows();
    const state = holder.store?.getState();
    const active = state?.activeCell ? rowIdAtViewRow(state, state.activeCell.row) : undefined;
    return active === undefined ? ids : unionIds(ids, new Set([active]));
  }, [holder, protectedRows]);
  const acknowledge = useCallback((rowId: string) => holder.unacknowledged.delete(rowId), [holder]);
  const unacknowledgedRows = useCallback((): ReadonlySet<string> | null => (holder.unacknowledged.size > 0 ? holder.unacknowledged : null), [holder]);
  const pruneSaves = useCallback((oldestMark: number | null) => pruneSavesOn(holder, oldestMark), [holder]);
  const streamUpdateRow = useCallback(
    <TData,>(change: DataChange<TData>) => {
      const columns = holder.store?.getState().columns;
      return columns ? rowOfStreamUpdate(change, columns) : undefined;
    },
    [holder],
  );
  const overlayPushed = useCallback(
    <TData,>(rows: readonly TData[], mark: number, start: number, idOf: (row: TData, index: number) => string): TData[] => {
      const pushed = pushedSinceOn(holder, mark);
      const columns = holder.store?.getState().columns;
      if (pushed === null || !columns) return rows as TData[];
      const byId = new Map(columns.map((column) => [column.id, column] as const));
      return rows.map((row, index) => {
        const cells = row === undefined ? undefined : pushed.get(idOf(row, start + index));
        if (!cells) return row;
        let next = row;
        for (const [columnId, value] of cells) {
          const column = byId.get(columnId);
          if (column) next = setCellValue(next, column as never, value as never);
        }
        return next;
      });
    },
    [holder],
  );
  const setHandlers = useCallback((handlers: GuardHandlers) => void (holder.handlers = handlers), [holder]);
  return { setHandlers, setSaveCheckListener, plugins, protectedRows, savingRows, guardMissing, markEdited, saveMark, savedSince, pruneSaves, overlayPushed, streamUpdateRow, setSettleListener, setSaveStartListener, setSavesSettledListener, setReshapeListener, forgetStructural, evictionProtected, acknowledge, unacknowledgedRows };
}

/**
 * The row a stream update writes onto the row that `data` holds now. A push made on a row that a block has replaced since carries
 * the whole row it was made on; writing only its cells keeps the old values of the other cells from coming back.
 * `applyChange` calls it with the current row, so it needs no pass of its own over the rows.
 */
export function rowOfStreamUpdate<TData>(change: DataChange<TData>, columns: readonly { id: string }[]) {
  if (change.source !== "stream") return undefined;
  const byId = new Map(columns.map((column) => [column.id, column] as const));
  return (op: Extract<DataChange<TData>["ops"][number], { type: "update" }>, current: TData): TData => {
    if (!op.cells || current === op.prev) return op.row;
    let row = current;
    for (const cell of op.cells) {
      const column = byId.get(cell.columnId);
      if (column) row = setCellValue(row, column as never, cell.value as never);
    }
    return row;
  };
}

export const GUARD_MISSING_MESSAGE =
  "refresh cannot protect rows with a pending save or an open edit because the refresh guard plugin never mounted; pass your own plugins through the `plugins` option of useDataGridServerRows instead of a `plugins` prop after the gridProps spread";

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
): { rows: (TData | undefined)[]; cleared: number[]; restored: number[] } {
  const next = prev.slice();
  const emptied: number[] = [];
  const restored: number[] = [];
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
      restored.push(slot);
    }
  }
  return { rows: next, cleared: emptied.filter((slot) => next[slot] === undefined), restored };
}
