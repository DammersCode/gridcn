import type { DataChange, DataOp } from "../types";
import type { DataGridActions } from "./types";

/** One refusal in a {@link SaveAck}: the row the server refused, and optionally one of its columns. */
export type SaveRejection<TData = unknown> = {
  rowId: string;
  /** Limits the refusal to this column of an update; omitted, every entry of the row is refused. */
  columnId?: string;
  /** Display text for `onSaveRejected`; the grid does not render it. */
  message?: string;
  /** Keeps the refused value and marks its cells with `message` instead of reverting. Default `false`. */
  keep?: boolean;
  /** Set by the grid: `"timeout"` marks a refusal because `onSave` outlived `saveTimeoutMs`. */
  reason?: "timeout";
  /**
   * The row as the server holds it now. The revert puts this row in place of the refused one, unless a newer
   * write to the row is pending. A refused delete restores it; a refused insert removes the row. The row's
   * id must equal `rowId`, otherwise the grid does a plain revert.
   */
  current?: TData;
};

/** The second argument of `onSave`. */
export type SaveContext = {
  /** The grid's actions, so a save can write the server's answer back without a grid ref. */
  actions: DataGridActions;
  /** Aborts when the grid unmounts or `saveTimeoutMs` runs out; pass it to `fetch`. */
  signal: AbortSignal;
};

/** Hands a throw of a consumer callback to the page (`reportError`), or to `console.error` where the platform has none. */
export function reportCallbackError(message: string, error: unknown): void {
  const report = (globalThis as { reportError?: (error: unknown) => void }).reportError;
  if (typeof report === "function") report(error);
  else console.error(`[data-grid] ${message}`, error);
}

/** The error a save that outlived `saveTimeoutMs` settles with. */
export class SaveTimeoutError extends Error {
  constructor(ms: number) {
    super(`onSave did not settle within ${ms} ms`);
    this.name = "SaveTimeoutError";
  }
}

/** What a promise returned by `onSave` resolves with. `void` accepts the whole change. */
export type SaveAck<TData = unknown> = void | { rejected?: readonly SaveRejection<TData>[] };

/** Context of `onSaveRejected`. */
export type SaveRejectedContext<TData> = {
  /** The change `onSave` received. */
  change: DataChange<TData>;
  /** After an id swap (`replaceRowId`) the entries carry the new ids, while `change` keeps the ids it had. */
  rejected: readonly SaveRejection<TData>[];
  /** The rejection reason of the `onSave` promise; `null` when it resolved with `{ rejected }`. */
  error: unknown;
  /** `true` when the grid wrote a revert; `false` when every refused entry set `keep` or nothing was left to revert. */
  reverted: boolean;
};

/** What `resolveSaveConflict` receives for one refused row that has a usable `current`. */
export type SaveConflictContext<TData> = {
  rowId: string;
  /** The row in the grid now. */
  mine: TData;
  /** The server's row (`SaveRejection.current`). */
  theirs: TData;
  /** The refused change `onSave` received. */
  change: DataChange<TData>;
  /** `SaveRejection.message`. */
  message?: string;
  /** Aborts when a newer write to the row starts or the grid unmounts; an answer after that is ignored. */
  signal: AbortSignal;
};

/** The answer of `resolveSaveConflict`: take the server's row, keep the grid's row, or save a merged row. */
export type SaveResolution<TData> = "theirs" | "mine" | { row: TData } | void;

/** Status of a row with an acknowledged write: pending, or refused and reverted. */
export type RowSaveStatus = "saving" | "failed";

export const EMPTY_SAVE_STATUS: ReadonlyMap<string, RowSaveStatus> = new Map();

/** The grid reads at most this many rejections of one ack. */
export const MAX_WRITE_REJECTIONS = 10_000;

/** The rejections of a settled ack: a thrown error or more than {@link MAX_WRITE_REJECTIONS} rejections refuse every row of the change; a malformed ack keeps its valid entries. */
export function readRejections(change: DataChange<unknown>, ack: SaveAck, error: unknown, failed: boolean, warn?: (key: string, message: string) => void): SaveRejection[] {
  const rejected = ack?.rejected;
  if (!failed && Array.isArray(rejected) && rejected.length > MAX_WRITE_REJECTIONS) {
    warn?.("rejection bound", `an onSave answer listed more than ${MAX_WRITE_REJECTIONS} rejections, so the grid refuses every row of that change. Send at most ${MAX_WRITE_REJECTIONS} rejections, or reject with an error`);
    return readRejections(change, undefined, undefined, true);
  }
  if (failed) {
    const message = error instanceof Error ? error.message : undefined;
    const reason = error instanceof SaveTimeoutError ? ({ reason: "timeout" } as const) : {};
    return [...new Set(change.ops.map((op) => op.rowId))].map((rowId) => ({ rowId, ...(message === undefined ? {} : { message }), ...reason }));
  }
  if (!Array.isArray(rejected)) return [];
  const out: SaveRejection[] = [];
  for (const entry of rejected as readonly unknown[]) {
    if (typeof entry !== "object" || entry === null || typeof (entry as SaveRejection).rowId !== "string") continue;
    const { rowId, columnId, message, current, keep } = entry as SaveRejection;
    out.push({
      rowId,
      ...(typeof columnId === "string" ? { columnId } : {}),
      ...(typeof message === "string" ? { message } : {}),
      ...(keep === true ? { keep } : {}),
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
