import type { DataChange } from "../types";

/** Fills `beforeRowId` and `afterRowId` of each move that has neither (an undo, a redo, or an app batch) from the data after the batch. */
export function withMoveNeighbors(change: DataChange<unknown>, nextData: readonly unknown[], getRowId: (row: unknown, index: number) => string): DataChange<unknown> {
  if (!change.ops.some((op) => op.type === "move" && op.beforeRowId === undefined && op.afterRowId === undefined)) return change;
  let indexOf: Map<string, number> | null = null;
  const idAt = (index: number) => (nextData[index] === undefined ? undefined : getRowId(nextData[index], index));
  const ops = change.ops.map((op) => {
    if (op.type !== "move" || op.beforeRowId !== undefined || op.afterRowId !== undefined) return op;
    let at: number | undefined = op.to;
    if (idAt(at) !== op.rowId) at = (indexOf ??= new Map(nextData.map((row, index) => [row === undefined ? "" : getRowId(row, index), index]))).get(op.rowId);
    if (at === undefined) return op;
    const beforeRowId = idAt(at + 1);
    const afterRowId = idAt(at - 1);
    return { ...op, ...(beforeRowId !== undefined && { beforeRowId }), ...(afterRowId !== undefined && { afterRowId }) };
  });
  return { ...change, ops };
}
