import type { DataChange, DataOp } from "../types";

/** Inverts a single op: update swaps row/prev, insert becomes delete, delete becomes insert. */
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
  }
}

/**
 * Produces the change that undoes `change`: each op is inverted and the op
 * order is reversed (so a batch unwinds in the correct dependency order).
 */
export function invertChange<TData>(change: DataChange<TData>): DataChange<TData> {
  return {
    ops: [...change.ops].reverse().map(invertOp),
    source: "history",
  };
}

/**
 * Applies a change to `data` immutably in O(n + k log(n + k)), returning a new array.
 * Rows are located by id (never by the op's stored index, which is only a
 * hint for where an insert should land). If an id referenced by an
 * update/delete op is no longer present (row was deleted by a later change),
 * that op is skipped silently rather than throwing.
 *
 * `index` convention: op indices are snapshot positions — each op's index
 * is that row's position in the array as it stood before the whole batch
 * was applied (the natural output of a delete-range/insert-range emitter),
 * not a running "log-time" position updated op-by-op. update/delete ops
 * are id-keyed so their index is informational only; insert ops (including
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
      else deleteIndices.add(idx);
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
 * Op-based undo/redo stack, UI-free. Consumers call `push` after each
 * applied gesture, and `undo`/`redo` to get the change to apply back to data.
 */
export type History<TData> = {
  /** Records a change; discards any redo branch. Changes with source "history" are ignored. */
  push(change: DataChange<TData>): void;
  /** Returns the inverted top-of-undo-stack change to apply, or null if nothing to undo. */
  undo(): DataChange<TData> | null;
  /** Returns the original change, re-tagged source "history", to re-apply; or null if nothing to redo. */
  redo(): DataChange<TData> | null;
  /** Whether `undo()` would return a change. */
  readonly canUndo: boolean;
  /** Whether `redo()` would return a change. */
  readonly canRedo: boolean;
  /** Clears both stacks. */
  clear(): void;
  /** Number of entries on the undo stack. */
  readonly size: number;
};

/** Creates an id-keyed undo/redo history. */
export function createHistory<TData>(opts: HistoryOptions = {}): History<TData> {
  const capacity = opts.capacity ?? 100;
  let undoStack: DataChange<TData>[] = [];
  let redoStack: DataChange<TData>[] = [];

  return {
    push(change) {
      if (change.source === "history") return;
      undoStack.push(change);
      if (undoStack.length > capacity) undoStack.shift();
      redoStack = [];
    },
    undo() {
      const change = undoStack.pop();
      if (!change) return null;
      redoStack.push(change);
      return invertChange(change);
    },
    redo() {
      const change = redoStack.pop();
      if (!change) return null;
      undoStack.push(change);
      return { ...change, source: "history" };
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
