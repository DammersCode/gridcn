import type { DataChange, DataOp } from "../types";

/** Inverts a single operation: update swaps row/prev, insert becomes delete, delete becomes insert. */
function invertOp<TData>(op: DataOp<TData>): DataOp<TData> {
  switch (op.type) {
    case "update":
      return {
        type: "update",
        rowId: op.rowId,
        row: op.prev,
        prev: op.row,
        cells: op.cells?.map((cell) => ({
          columnId: cell.columnId,
          value: cell.prev,
          prev: cell.value,
        })),
      };
    case "insert":
      return { type: "delete", rowId: op.rowId, row: op.row, index: op.index };
    case "delete":
      return { type: "insert", rowId: op.rowId, row: op.row, index: op.index };
    // the row sits at `op.to` after the move, so undoing swaps the two snapshot positions
    case "move":
      return { type: "move", rowId: op.rowId, row: op.row, from: op.to, to: op.from };
  }
}

/**
 * Produces the change that undoes `change`: each operation is inverted and the operation
 * order is reversed (so a batch unwinds in the correct dependency order). `source` tags the result;
 * pass `"rollback"` to revert a failed optimistic save so an `onDataChange` handler can tell it from an undo.
 */
export function invertChange<TData>(change: DataChange<TData>, source: "history" | "rollback" = "history"): DataChange<TData> {
  return {
    ops: [...change.ops].reverse().map(invertOp),
    source,
    label: change.label,
  };
}

/**
 * Applies a change to `data` immutably in O(n + k log(n + k)), returning a new array.
 * Rows are located by id (never by the operation's stored index, which is only a
 * hint for where an insert should land). If an id referenced by an
 * update/delete operation is no longer present (row was deleted by a later change),
 * that operation is skipped silently rather than throwing.
 *
 * `index` convention: operation indices are snapshot positions — each operation's index
 * is that row's position in the array as it stood before the whole batch
 * was applied (the natural output of a delete-range/insert-range emitter),
 * not a running "log-time" position updated one operation at a time. update/delete operations
 * are row-id-based so their index is informational only; insert operations (including
 * ones produced by inverting a delete batch) are therefore applied in
 * ascending-index order regardless of the order they appear in `ops`, so a
 * multi-row batch round-trips through invertChange correctly.
 */
export function applyChange<TData>(
  data: readonly TData[],
  change: DataChange<TData>,
  getRowId: (row: TData, index: number) => string,
): TData[] {
  const indexById = new Map<string, number>();
  const idByIndex = new Array<string>(data.length);
  let hasDuplicateId = false;
  for (let i = 0; i < data.length; i++) {
    const id = getRowId(data[i]!, i);
    idByIndex[i] = id;
    if (indexById.has(id)) hasDuplicateId = true;
    else indexById.set(id, i);
  }

  const deleteIndices = new Set<number>();
  const inserts: Extract<DataOp<TData>, { type: "insert" }>[] = [];
  let postDelete: TData[];

  if (!hasDuplicateId) {
    const updateById = new Map<string, TData>();
    for (const op of change.ops) {
      if (op.type === "insert") {
        inserts.push(op);
        continue;
      }
      const idx = indexById.get(op.rowId);
      if (idx === undefined) continue;
      if (op.type === "update") updateById.set(op.rowId, op.row);
      else if (op.type === "delete") deleteIndices.add(idx);
      // a move is a delete + insert of the same row: the insert lands at the row's post-move slot
      else {
        deleteIndices.add(idx);
        inserts.push({ type: "insert", rowId: op.rowId, row: op.row, index: op.to });
      }
    }

    postDelete = [];
    for (let i = 0; i < data.length; i++) {
      if (deleteIndices.has(i)) continue;
      const id = idByIndex[i]!;
      const updated = updateById.get(id);
      postDelete.push(updated !== undefined ? updated : data[i]!);
    }
  } else {
    // Duplicate row ids are invalid, but this path preserves the legacy first-occurrence scan.
    const indicesById = new Map<string, number[]>();
    for (let i = 0; i < data.length; i++) {
      const id = idByIndex[i]!;
      const indices = indicesById.get(id);
      if (indices) indices.push(i);
      else indicesById.set(id, [i]);
    }

    const opsById = new Map<string, DataOp<TData>[]>();
    for (const op of change.ops) {
      if (op.type === "insert") {
        inserts.push(op);
        continue;
      }
      const ops = opsById.get(op.rowId);
      if (ops) ops.push(op);
      else opsById.set(op.rowId, [op]);
    }

    const updateByIndex = new Map<number, TData>();
    for (const idOps of opsById.values()) {
      const indices = indicesById.get(idOps[0]!.rowId);
      if (!indices) continue;
      let next = 0;
      for (const op of idOps) {
        if (next >= indices.length) break;
        const target = indices[next]!;
        if (op.type === "update") {
          updateByIndex.set(target, op.row);
        } else {
          deleteIndices.add(target);
          if (op.type === "move") inserts.push({ type: "insert", rowId: op.rowId, row: op.row, index: op.to });
          next++;
        }
      }
    }

    postDelete = [];
    for (let i = 0; i < data.length; i++) {
      if (deleteIndices.has(i)) continue;
      postDelete.push(updateByIndex.get(i) ?? data[i]!);
    }
  }

  const sorted = [...inserts].sort((a, b) => a.index - b.index);
  const total = postDelete.length + sorted.length;
  if (total === 0) return [];

  // Fenwick slot placement reproduces the legacy clamped insert order.
  const bit = new Int32Array(total + 1);
  for (let i = 1; i <= total; i++) bit[i] = i & -i;
  const insertAt = new Int32Array(total).fill(-1);
  const addFree = (pos: number) => {
    for (let i = pos + 1; i <= total; i += i & -i) bit[i]!--;
  };
  const findFreeSlot = (rank: number): number => {
    let idx = 0;
    let target = rank;
    let mask = 1 << Math.floor(Math.log2(total));
    while (mask !== 0) {
      const next = idx + mask;
      if (next <= total && bit[next]! < target) {
        idx = next;
        target -= bit[next]!;
      }
      mask >>= 1;
    }
    return idx;
  };

  for (let q = sorted.length - 1; q >= 0; q--) {
    const at = Math.min(sorted[q]!.index, postDelete.length + q);
    const pos = findFreeSlot(at + 1);
    insertAt[pos] = q;
    addFree(pos);
  }

  const out = new Array<TData>(total);
  let original = 0;
  for (let pos = 0; pos < total; pos++) {
    const q = insertAt[pos]!;
    out[pos] = q === -1 ? postDelete[original++]! : sorted[q]!.row;
  }
  return out;
}

/** Options for {@link createHistory}. */
export type HistoryOptions = {
  /** Maximum number of entries kept on the undo stack; oldest entries are dropped past this. */
  capacity?: number;
};

/**
 * Operation-based undo/redo stack, UI-free. Consumers call `push` after each
 * applied gesture, and `undo`/`redo` to get the change to apply back to data.
 */
export type History<TData> = {
  /** Records a change; discards any redo branch. Changes with source "history", "rollback", "merge" or "id-swap" are ignored. */
  push(change: DataChange<TData>): void;
  /** Removes a recorded change (matched by identity) from both stacks; true when it was found. Pass the change `undo()` or `redo()` returned to remove its entry. */
  discard(change: DataChange<TData>): boolean;
  /** Returns the inverted top-of-undo-stack change to apply, or null if nothing to undo. */
  undo(): DataChange<TData> | null;
  /** Returns the original change, re-tagged source "history", to re-apply; or null if nothing to redo. */
  redo(): DataChange<TData> | null;
  /**
   * Puts the entry behind a change that `undo()` or `redo()` returned back where it was, because the
   * change was not applied or was refused. False when the entry cannot return (a newer change moved on).
   */
  restore(change: DataChange<TData>): boolean;
  /**
   * Gives a row a new id in every entry: `ops` on `oldId` get `newId`, and each snapshot of the row takes
   * the fields that differ between `oldRow` and `newRow`. An entry with a snapshot that is not a plain
   * object goes. True when any entry changed.
   */
  replaceRowId(oldId: string, newId: string, oldRow: TData, newRow: TData): boolean;
  /** {@link History.replaceRowId} for many rows in one pass over the entries. */
  replaceRowIds(swaps: readonly { oldId: string; newId: string; oldRow: TData; newRow: TData }[]): boolean;
  /** Removes the `ops` on `rowIds` from every entry; an entry left without `ops` goes. True when any entry changed. */
  dropRows(rowIds: Iterable<string>): boolean;
  /** Whether `undo()` would return a change. */
  readonly canUndo: boolean;
  /** Whether `redo()` would return a change. */
  readonly canRedo: boolean;
  /** Clears both stacks. */
  clear(): void;
  /** Number of entries on the undo stack. */
  readonly size: number;
};

type Applied<TData> = { entry: DataChange<TData>; direction: "undo" | "redo" };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** The fields to copy from `oldRow` to `newRow`: changed or added keys, and removed keys. */
function rowPatch(oldRow: unknown, newRow: unknown): { set: [string, unknown][]; unset: string[] } | null {
  if (!isPlainObject(oldRow) || !isPlainObject(newRow)) return null;
  const set: [string, unknown][] = [];
  const unset: string[] = [];
  for (const key of Object.keys(newRow)) {
    if (!(key in oldRow) || !Object.is(oldRow[key], newRow[key])) set.push([key, newRow[key]]);
  }
  for (const key of Object.keys(oldRow)) if (!(key in newRow)) unset.push(key);
  return { set, unset };
}

/** Creates a row-id-based undo/redo history. */
export function createHistory<TData>(opts: HistoryOptions = {}): History<TData> {
  const capacity = opts.capacity ?? 100;
  let undoStack: DataChange<TData>[] = [];
  let redoStack: DataChange<TData>[] = [];
  const applied = new WeakMap<DataChange<TData>, Applied<TData>>();
  // a rewritten entry stays findable by the change object the consumer holds
  const origin = new WeakMap<DataChange<TData>, DataChange<TData>>();
  const rootOf = (entry: DataChange<TData>) => origin.get(entry) ?? entry;

  const rewrite = (map: (entry: DataChange<TData>) => DataChange<TData> | null): boolean => {
    let changed = false;
    const mapStack = (stack: DataChange<TData>[]) => {
      const next: DataChange<TData>[] = [];
      for (const entry of stack) {
        const mapped = map(entry);
        if (mapped !== entry) {
          changed = true;
          if (mapped) origin.set(mapped, rootOf(entry));
        }
        if (mapped) next.push(mapped);
      }
      return next;
    };
    undoStack = mapStack(undoStack);
    redoStack = mapStack(redoStack);
    return changed;
  };

  return {
    push(change) {
      if (change.source === "history" || change.source === "rollback" || change.source === "merge" || change.source === "id-swap") return;
      undoStack.push(change);
      if (undoStack.length > capacity) undoStack.shift();
      redoStack = [];
    },
    discard(change) {
      const target = rootOf(applied.get(change)?.entry ?? change);
      const before = undoStack.length + redoStack.length;
      undoStack = undoStack.filter((entry) => rootOf(entry) !== target);
      redoStack = redoStack.filter((entry) => rootOf(entry) !== target);
      return undoStack.length + redoStack.length !== before;
    },
    undo() {
      const entry = undoStack.pop();
      if (!entry) return null;
      redoStack.push(entry);
      const inverted = invertChange(entry);
      applied.set(inverted, { entry, direction: "undo" });
      return inverted;
    },
    redo() {
      const entry = redoStack.pop();
      if (!entry) return null;
      undoStack.push(entry);
      const replay: DataChange<TData> = { ...entry, source: "history" };
      applied.set(replay, { entry, direction: "redo" });
      return replay;
    },
    restore(change) {
      const record = applied.get(change);
      if (!record) return false;
      applied.delete(change);
      const from = record.direction === "undo" ? redoStack : undoStack;
      const at = from.findIndex((entry) => rootOf(entry) === rootOf(record.entry));
      if (at < 0) return false;
      const [entry] = from.splice(at, 1);
      // a redo branch cannot sit under a newer undo entry
      if (record.direction === "redo" && at < from.length) return false;
      if (record.direction === "undo") {
        undoStack.push(entry!);
        if (undoStack.length > capacity) undoStack.shift();
      } else redoStack.push(entry!);
      return true;
    },
    replaceRowId(oldId, newId, oldRow, newRow) {
      return this.replaceRowIds([{ oldId, newId, oldRow, newRow }]);
    },
    replaceRowIds(swaps) {
      const bySource = new Map(swaps.map((swap) => [swap.oldId, { newId: swap.newId, patch: rowPatch(swap.oldRow, swap.newRow) }] as const));
      const patchRow = (row: TData, patch: ReturnType<typeof rowPatch>): TData | null => {
        if (!patch || !isPlainObject(row)) return null;
        const next: Record<string, unknown> = { ...row };
        for (const key of patch.unset) delete next[key];
        for (const [key, value] of patch.set) next[key] = value;
        return next as TData;
      };
      const rewriteOp = (op: DataOp<TData>): DataOp<TData> | null => {
        const swap = bySource.get(op.rowId);
        if (!swap) return op;
        const row = patchRow(op.row, swap.patch);
        if (!row) return null;
        if (op.type !== "update") return { ...op, rowId: swap.newId, row };
        const prev = patchRow(op.prev, swap.patch);
        return prev ? { ...op, rowId: swap.newId, row, prev } : null;
      };
      return rewrite((entry) => {
        if (!entry.ops.some((op) => bySource.has(op.rowId))) return entry;
        const ops: DataOp<TData>[] = [];
        for (const op of entry.ops) {
          const mapped = rewriteOp(op);
          if (!mapped) return null;
          ops.push(mapped);
        }
        return { ...entry, ops };
      });
    },
    dropRows(rowIds) {
      const ids = new Set(rowIds);
      return rewrite((entry) => {
        const ops = entry.ops.filter((op) => !ids.has(op.rowId));
        if (ops.length === entry.ops.length) return entry;
        return ops.length === 0 ? null : { ...entry, ops };
      });
    },
    get canUndo() {
      return undoStack.length > 0;
    },
    get canRedo() {
      return redoStack.length > 0;
    },
    clear() {
      undoStack = [];
      redoStack = [];
    },
    get size() {
      return undoStack.length;
    },
  };
}
