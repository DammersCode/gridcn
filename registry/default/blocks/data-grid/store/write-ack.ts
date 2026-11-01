import type { DataChange, DataOp } from "../types";

/** One refusal in a {@link SaveAck}: the row the server refused, and optionally one of its columns. */
export type SaveRejection<TData = unknown> = {
  rowId: string;
  /** Limits the refusal to this column of an update; omitted, every entry of the row is refused. */
  columnId?: string;
  /** Display text for `onSaveRejected`; the grid does not render it. */
  message?: string;
  /**
   * The row as the server holds it now. The revert puts this row in place of the refused one, unless a newer
   * write to the row is pending. A refused delete restores it; a refused insert removes the row. The row's
   * id must equal `rowId`, otherwise the grid does a plain revert.
   */
  current?: TData;
};

/** What a promise returned by `onSave` resolves with. `void` accepts the whole change. */
export type SaveAck<TData = unknown> = void | { rejected?: readonly SaveRejection<TData>[] };

/** Context of `onSaveRejected`. */
export type SaveRejectedContext<TData> = {
  /** The change `onSave` received. */
  change: DataChange<TData>;
  rejected: readonly SaveRejection<TData>[];
  /** The rejection reason of the `onSave` promise; `null` when it resolved with `{ rejected }`. */
  error: unknown;
};

/** Status of a row with an acknowledged write: pending, or refused and reverted. */
export type RowSaveStatus = "saving" | "failed";

export const EMPTY_SAVE_STATUS: ReadonlyMap<string, RowSaveStatus> = new Map();

/** The grid reads at most this many rejections of one ack. */
export const MAX_WRITE_REJECTIONS = 10_000;

/** The rejections of a settled ack: a thrown error refuses every row, a malformed or oversized ack keeps its valid entries. */
export function readRejections(change: DataChange<unknown>, ack: SaveAck, error: unknown, failed: boolean): SaveRejection[] {
  if (failed) {
    const message = error instanceof Error ? error.message : undefined;
    return [...new Set(change.ops.map((op) => op.rowId))].map((rowId) => (message === undefined ? { rowId } : { rowId, message }));
  }
  const rejected = ack?.rejected;
  if (!Array.isArray(rejected)) return [];
  const out: SaveRejection[] = [];
  for (const entry of rejected as readonly unknown[]) {
    if (out.length >= MAX_WRITE_REJECTIONS) break;
    if (typeof entry !== "object" || entry === null || typeof (entry as SaveRejection).rowId !== "string") continue;
    const { rowId, columnId, message, current } = entry as SaveRejection;
    out.push({
      rowId,
      ...(typeof columnId === "string" ? { columnId } : {}),
      ...(typeof message === "string" ? { message } : {}),
      ...(current !== undefined && current !== null ? { current } : {}),
    });
  }
  return out;
}

/** The `change.ops` entries that `rejected` refuses; a cell-level update keeps only its refused cells. */
export function refusedOps(change: DataChange<unknown>, rejected: readonly SaveRejection[]): DataOp<unknown>[] {
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
