import type { DataChange } from "../types";
import { getCellValue, setCellValue } from "../columns/column-helpers";
import { invertChange } from "./history";

/** What {@link buildRollback} reads from the store. */
export type RollbackSource<TData> = { data: readonly unknown[]; getRowId: (row: TData, index: number) => string; columns: readonly { id: string }[] };

function shallowEqualRows(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => Object.is((a as never)[k], (b as never)[k]));
}

/**
 * Builds the inverse of `change` against the current data: a cell reverts only while it still holds
 * the change's value, so later edits to the same row (or the same cell) survive the rollback.
 * The result names `change` in `reverts`.
 */
export function buildRollback<TData>(change: DataChange<TData>, s: RollbackSource<TData>): DataChange<TData> {
  const rowById = new Map<string, TData>();
  (s.data as readonly TData[]).forEach((row, i) => {
    if (row === undefined) return;
    const id = s.getRowId(row, i);
    if (!rowById.has(id)) rowById.set(id, row);
  });
  const columnsById = new Map(s.columns.map((c) => [c.id, c] as const));
  const working = new Map<string, TData>();
  const ops: DataChange<TData>["ops"] = [];
  const reinsertedAt = new Map<string, number>();
  const pushUpdate = (update: Extract<DataChange<TData>["ops"][number], { type: "update" }>) => {
    const at = reinsertedAt.get(update.rowId);
    const insert = at === undefined ? undefined : ops[at];
    // a batch applies an update before the insert that creates its row, so the update folds into the insert
    if (at !== undefined && insert?.type === "insert") ops[at] = { ...insert, row: update.row };
    else ops.push(update);
  };
  for (const op of [...change.ops].reverse()) {
    if (op.type !== "update") {
      const inverse = invertChange({ ops: [op], source: "rollback" }, "rollback").ops;
      for (const inverted of inverse) {
        if (inverted.type !== "insert") continue;
        working.set(inverted.rowId, inverted.row);
        reinsertedAt.set(inverted.rowId, ops.length + inverse.indexOf(inverted));
      }
      ops.push(...inverse);
      continue;
    }
    const current = working.get(op.rowId) ?? rowById.get(op.rowId);
    if (current === undefined) continue;
    if (!op.cells) {
      if (!shallowEqualRows(current, op.row)) continue;
      pushUpdate({ type: "update", rowId: op.rowId, row: op.prev, prev: current });
      working.set(op.rowId, op.prev);
      continue;
    }
    let row: TData = current;
    const cells: NonNullable<typeof op.cells> = [];
    for (const cell of [...op.cells].reverse()) {
      const column = columnsById.get(cell.columnId);
      if (!column || !Object.is(getCellValue(row, column as never), cell.value)) continue;
      row = setCellValue<TData, never>(row, column as never, cell.prev as never);
      cells.push({ columnId: cell.columnId, value: cell.prev, prev: cell.value });
    }
    if (cells.length > 0) {
      pushUpdate({ type: "update", rowId: op.rowId, row, prev: current, cells });
      working.set(op.rowId, row);
    }
  }
  return { ops, source: "rollback", label: change.label, reverts: change };
}

/**
 * Re-targets an undo or redo `change` at the current rows: an update with cells writes only those
 * cells onto the row as it is now, so values that changed since the edit (a stream push, a refetch) stay.
 * An update without cells, an update for a row that `s.data` lacks, and every insert, delete, and move pass through.
 */
export function rebaseOntoCurrent<TData>(change: DataChange<TData>, s: RollbackSource<TData>): DataChange<TData> {
  if (!change.ops.some((op) => op.type === "update" && op.cells)) return change;
  const rowById = new Map<string, TData>();
  (s.data as readonly TData[]).forEach((row, i) => {
    if (row === undefined) return;
    const id = s.getRowId(row, i);
    if (!rowById.has(id)) rowById.set(id, row);
  });
  const columnsById = new Map(s.columns.map((c) => [c.id, c] as const));
  const working = new Map<string, TData>();
  const ops: DataChange<TData>["ops"] = [];
  for (const op of change.ops) {
    if (op.type === "insert") working.set(op.rowId, op.row);
    if (op.type !== "update" || !op.cells) {
      ops.push(op);
      continue;
    }
    const current = working.get(op.rowId) ?? rowById.get(op.rowId);
    if (current === undefined) {
      ops.push(op);
      continue;
    }
    let row: TData = current;
    const cells: NonNullable<typeof op.cells> = [];
    for (const cell of op.cells) {
      const column = columnsById.get(cell.columnId);
      if (!column) continue;
      cells.push({ columnId: cell.columnId, value: cell.value, prev: getCellValue(row, column as never) });
      row = setCellValue<TData, never>(row, column as never, cell.value as never);
    }
    if (cells.length === 0) continue;
    working.set(op.rowId, row);
    ops.push({ type: "update", rowId: op.rowId, row, prev: current, cells });
  }
  return { ...change, ops };
}
