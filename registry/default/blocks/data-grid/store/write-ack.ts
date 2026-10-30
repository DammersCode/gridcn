import type { DataChange, DataOp } from "../types";

/** One refusal in a {@link WriteAck}: the row the server refused, and optionally one of its columns. */
export type WriteRejection = {
  rowId: string;
  /** Limits the refusal to this column of an update; omitted, every op of the row is refused. */
  columnId?: string;
  /** Display text for `onWriteRejected`; the grid does not render it. */
  message?: string;
};

/** What a promise returned by `onDataChange` resolves with. `void` accepts the whole change. */
export type WriteAck = void | { rejected: readonly WriteRejection[] };

/** Context of `onWriteRejected`. */
export type WriteRejectedContext<TData> = {
  /** The change the consumer's `onDataChange` received. */
  change: DataChange<TData>;
  rejected: readonly WriteRejection[];
};

/** Status of a row with an acknowledged write: pending, or refused and reverted. */
export type RowWriteStatus = "saving" | "failed";

export const EMPTY_WRITE_STATUS: ReadonlyMap<string, RowWriteStatus> = new Map();

/** The grid reads at most this many rejections of one ack. */
export const MAX_WRITE_REJECTIONS = 10_000;

/** The rejections of a settled ack: a thrown error refuses every row, a malformed or oversized ack keeps its valid entries. */
export function readRejections(change: DataChange<unknown>, ack: WriteAck, error: unknown, failed: boolean): WriteRejection[] {
  if (failed) {
    const message = error instanceof Error ? error.message : undefined;
    return [...new Set(change.ops.map((op) => op.rowId))].map((rowId) => (message === undefined ? { rowId } : { rowId, message }));
  }
  const rejected = ack?.rejected;
  if (!Array.isArray(rejected)) return [];
  const out: WriteRejection[] = [];
  for (const entry of rejected as readonly unknown[]) {
    if (out.length >= MAX_WRITE_REJECTIONS) break;
    if (typeof entry !== "object" || entry === null || typeof (entry as WriteRejection).rowId !== "string") continue;
    const { rowId, columnId, message } = entry as WriteRejection;
    out.push({ rowId, ...(typeof columnId === "string" ? { columnId } : {}), ...(typeof message === "string" ? { message } : {}) });
  }
  return out;
}

/** The ops of `change` that `rejected` refuses; a cell-level update keeps only its refused cells. */
export function refusedOps(change: DataChange<unknown>, rejected: readonly WriteRejection[]): DataOp<unknown>[] {
  const wholeRows = new Set<string>();
  const cellsByRow = new Map<string, Set<string>>();
  for (const { rowId, columnId } of rejected) {
    if (columnId === undefined) wholeRows.add(rowId);
    else (cellsByRow.get(rowId) ?? cellsByRow.set(rowId, new Set()).get(rowId)!).add(columnId);
  }
  const ops: DataOp<unknown>[] = [];
  for (const op of change.ops) {
    if (wholeRows.has(op.rowId)) {
      ops.push(op);
      continue;
    }
    const columns = cellsByRow.get(op.rowId);
    if (!columns) continue;
    if (op.type !== "update" || !op.cells) {
      ops.push(op);
      continue;
    }
    const cells = op.cells.filter((cell) => columns.has(cell.columnId));
    if (cells.length > 0) ops.push({ ...op, cells });
  }
  return ops;
}
