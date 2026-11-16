import type { DataChange } from "../types";

const changedByGrid = new WeakMap<object, WeakSet<object>>();

/** The sources of a change the user made on purpose; a push, an undo, a rollback, or an id swap marks no row. */
const USER_SOURCES: ReadonlySet<DataChange<unknown>["source"]> = new Set(["edit", "paste", "fill", "delete", "cut", "replace", "import", "row-operation"]);

/**
 * Marks the row objects a user change wrote, keyed by the grid's `actions` table. A later write gives a
 * row a new object, so an undo, a push, a rollback, or new `data` clears the mark without bookkeeping.
 */
export function markChangedRows(grid: object, change: DataChange<unknown>, rowOf: (rowId: string) => unknown): void {
  if (!USER_SOURCES.has(change.source)) return;
  let changed = changedByGrid.get(grid);
  if (!changed) changedByGrid.set(grid, (changed = new WeakSet()));
  for (const op of change.ops) {
    if (op.type !== "update" && op.type !== "insert") continue;
    const row = rowOf(op.rowId);
    if (typeof row === "object" && row !== null) changed.add(row);
  }
}

/** Whether a user change wrote this row object. */
export function isRowChanged(grid: object, row: unknown): boolean {
  return typeof row === "object" && row !== null && changedByGrid.get(grid)?.has(row) === true;
}
