import { getCellValue, type AnyColumnDef, type ServerSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { normalizeLimit } from "./normalize-limit";
import { displayText, isDev, isThenable, type DataGridReadState } from "@/registry/default/blocks/data-grid/data-grid-sdk";

/** Longest cell text an Excel worksheet holds; XLSX export and print cut longer text to it, CSV only a `formatCell` string. */
export const MAX_CELL_TEXT = 32_767;

/** What a `formatCell` hook returns. `null` and `undefined` make an empty cell. */
export type ExportCellValue = string | number | boolean | Date | null | undefined;

/** What `formatCell` receives for one exported cell. */
export type ExportCellContext<TData = unknown> = {
  /** The raw cell value. */
  value: unknown;
  /** The text the column's cell type exports by default. */
  text: string;
  row: TData;
  column: AnyColumnDef;
  /** Aborts when the export is cancelled, fails, or stops at a limit. Pass it to a request. */
  signal: AbortSignal;
};

/** Replaces the exported value of every cell. Runs once per cell, after the cell type made its text. */
export type FormatExportCellSync<TData = unknown> = (ctx: ExportCellContext<TData>) => ExportCellValue;

/** {@link FormatExportCellSync}, or a hook that returns a promise. The promises of one slice of rows settle together. */
export type FormatExportCell<TData = unknown> = (ctx: ExportCellContext<TData>) => ExportCellValue | PromiseLike<ExportCellValue>;

/** The signal of an export that cannot be cancelled. */
export const NEVER_ABORTED: AbortSignal = new AbortController().signal;

/** One exported cell after the format step: CSV rows hold strings only, XLSX rows keep typed values. */
export type ExportCell = string | number | boolean | Date | null;

/** What an {@link ExportSource} receives. */
export type ExportSourceContext = {
  /** The grid's sort, filters, and search text when the export started. Send it to your server. */
  spec: ServerSpec;
  /** Aborts when the export is cancelled or stops at a limit. Pass it to your request. */
  signal: AbortSignal;
  /** The ids of the columns the export writes, in order. Narrow your query to them. */
  columnIds: readonly string[];
};

/** Rows of the whole result for an "all rows" export. Return one array, or an async iterable of batches (an async generator that pages through your API). */
export type ExportSource<TData = unknown> = (ctx: ExportSourceContext) => readonly TData[] | Promise<readonly TData[]> | AsyncIterable<readonly TData[]>;

export const SLICE_ROWS = 1000;
/** Most `formatCell` promises awaited together. */
const ASYNC_GROUP_CELLS = 10_000;
const MAX_EMPTY_BATCHES = 1000;
const YIELD_AFTER_MS = 40;

export const DEFAULT_SOURCE_MAX_ROWS = 1_000_000;
export const DEFAULT_SOURCE_MAX_BYTES = 256 * 1024 * 1024;

/** Running totals after a batch: data rows written and file bytes (xlsx: characters) so far. */
export type ExportProgress = { rowCount: number; byteCount: number };

/** What a finished export wrote. */
export type ExportResult = {
  rowCount: number;
  /** True when `maxRows` or `maxBytes` ended the export before the source did. */
  truncated: boolean;
};

/** Resolved limits and callbacks of one source export. */
export type ExportRowsOptions<TData = unknown> = {
  source: ExportSource;
  /** Column ids to write, in order; default the visible columns. An unknown id throws before the source runs. */
  columns?: readonly string[];
  formatCell?: FormatExportCell<TData>;
  /** Cell text source: `"export"` uses the cell type's `toText` (default), `"display"` its display text (print). */
  text?: "export" | "display";
  /** Keep numbers, booleans and Dates typed (XLSX). Default: every cell becomes a string (CSV). */
  typed?: boolean;
  /** Most data rows to write. Default `1_000_000`; a negative or fractional value rounds to a non-negative integer. */
  maxRows?: number;
  /** Most bytes to write (xlsx: characters). Default 256 MiB. */
  maxBytes?: number;
  signal?: AbortSignal;
  onProgress?: (progress: ExportProgress) => void;
};

function isAsyncIterable(value: unknown): value is AsyncIterable<readonly unknown[]> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

/** A message-channel hop: unlike `setTimeout`, a hidden tab does not throttle it. */
function yieldToEventLoop(): Promise<void> {
  if (typeof MessageChannel === "undefined") return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => {
      port1.close();
      resolve();
    };
    port2.postMessage(0);
  });
}

export function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The export was aborted.", "AbortError");
}

/**
 * Reads the batches of `source`, maps each row through the cell types, and hands the text rows to
 * `onBatch` (which returns the byte size it kept). Stops at `maxRows` or `maxBytes` and aborts the source.
 */
export async function exportRows<TData = unknown, TCell extends ExportCell = string>(
  state: DataGridReadState,
  options: ExportRowsOptions<TData>,
  onBatch: (rows: TCell[][]) => number,
): Promise<ExportResult> {
  const { source, signal: outer, onProgress, formatCell, typed = false } = options;
  const maxRows = normalizeLimit(options.maxRows, DEFAULT_SOURCE_MAX_ROWS);
  const maxBytes = normalizeLimit(options.maxBytes, DEFAULT_SOURCE_MAX_BYTES);
  const columns = resolveExportColumns(state, options.columns);
  const columnIds = columns.map((column) => column.id);
  const inner = new AbortController();
  const stop = () => inner.abort(outer?.reason);
  if (outer?.aborted) throw abortReason(outer);
  outer?.addEventListener("abort", stop, { once: true });

  const spec: ServerSpec = { sorts: state.sortState, filters: state.filterState, searchText: state.searchText };
  let rowCount = 0;
  let byteCount = 0;
  let truncated = false;
  // The slice that crosses maxBytes is written whole; the export is truncated only if more rows follow it.
  let overBytes = false;
  let skippedRows = 0;
  let emptyBatches = 0;
  const maxSkippedRows = Math.max(maxRows, 1) * 2;
  let iterator: AsyncIterator<readonly unknown[]> | undefined;

  const untilAborted = <T,>(promise: Promise<T>): Promise<T> => {
    if (!outer) return promise;
    return new Promise<T>((resolve, reject) => {
      const fail = () => reject(abortReason(outer));
      if (outer.aborted) return fail();
      outer.addEventListener("abort", fail, { once: true });
      const settle = (done: () => void) => () => {
        outer.removeEventListener("abort", fail);
        done();
      };
      promise.then(
        (value) => settle(() => resolve(value))(),
        (error) => settle(() => reject(error))(),
      );
    });
  };

  let warnedBatchBytes = false;
  let sliceStarted = performance.now();
  const take = async (batch: unknown): Promise<void> => {
    if (!Array.isArray(batch)) throw new TypeError("[data-grid-io] an export source batch must be an array");
    emptyBatches = batch.length === 0 ? emptyBatches + 1 : 0;
    if (emptyBatches > MAX_EMPTY_BATCHES) throw new RangeError("[data-grid-io] an export source returned only empty batches");
    for (let from = 0; from < batch.length && !truncated; from += SLICE_ROWS) {
      const slice = batch.slice(from, from + SLICE_ROWS);
      const present = slice.filter((row) => row !== undefined && row !== null);
      if (overBytes && present.length > 0) {
        truncated = true;
        break;
      }
      skippedRows += slice.length - present.length;
      const room = maxRows - rowCount;
      if (present.length > room) truncated = true;
      else if (skippedRows > maxSkippedRows) throw new RangeError("[data-grid-io] an export source returned too many empty rows");
      const pending: PendingCell[] = [];
      const rows = present.slice(0, room).map((row) => mapExportRow(state, columns, row as TData, options.text ?? "export", formatCell, typed, inner.signal, pending) as TCell[]);
      if (pending.length > 0) await settlePending(pending, typed, inner.signal);
      rowCount += rows.length;
      const batchBytes = onBatch(rows);
      if (Number.isFinite(batchBytes)) byteCount += batchBytes;
      else if (!warnedBatchBytes && isDev()) {
        warnedBatchBytes = true;
        console.warn("[data-grid-io] onBatch must return the byte size it kept as a finite number; this batch counts as 0 bytes");
      }
      if (byteCount > maxBytes) overBytes = true;
      if (performance.now() - sliceStarted > YIELD_AFTER_MS) {
        await yieldToEventLoop();
        if (outer?.aborted) throw abortReason(outer);
        sliceStarted = performance.now();
      }
    }
    try {
      onProgress?.({ rowCount, byteCount });
    } catch (error) {
      if (isDev()) console.warn("[data-grid-io] onProgress threw", error);
    }
  };

  try {
    const result = source({ spec, signal: inner.signal, columnIds });
    if (isAsyncIterable(result)) {
      iterator = result[Symbol.asyncIterator]();
      while (!truncated) {
        const step = await untilAborted(iterator.next());
        if (outer?.aborted) throw abortReason(outer);
        if (step.done) break;
        await take(step.value);
      }
    } else {
      const batch = await untilAborted(Promise.resolve(result));
      if (outer?.aborted) throw abortReason(outer);
      await take(batch);
    }
  } finally {
    outer?.removeEventListener("abort", stop);
    inner.abort();
    void Promise.resolve(iterator?.return?.()).catch(() => {});
  }

  if (truncated && isDev()) console.warn(`[data-grid-io] export stopped at ${rowCount} rows (maxRows ${maxRows}, maxBytes ${maxBytes})`);
  return { rowCount, truncated };
}

/** Resolves column ids against all grid columns, hidden ones included; no ids means the visible columns. */
export function resolveExportColumns(state: DataGridReadState, ids: readonly string[] | undefined): readonly AnyColumnDef[] {
  if (ids === undefined) return state.visibleColumns;
  const all = state.columns ?? state.visibleColumns;
  const byId = new Map(all.map((column) => [column.id, column] as const));
  return ids.map((id) => {
    const column = byId.get(id);
    if (!column) throw new RangeError(`[data-grid-io] unknown export column: ${id}`);
    return column;
  });
}

function cutText(text: string): string {
  return text.length > MAX_CELL_TEXT ? text.slice(0, MAX_CELL_TEXT) : text;
}

function toCsvCell(value: ExportCellValue): string {
  if (typeof value === "string") return cutText(value);
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return String(value);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  return "";
}

function toTypedCell(value: ExportCellValue): ExportCell {
  if (typeof value === "string") return cutText(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  return null;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The typed XLSX cell of a built-in `number`, `date`, or `checkbox` column; any other column keeps its text. */
function builtInTypedCell(type: string | undefined, value: unknown, text: string): ExportCell {
  if (type === "number") {
    const number = text === "" ? Number.NaN : Number(text);
    return Number.isFinite(number) ? number : text;
  }
  if (type === "checkbox") return typeof value === "boolean" ? value : text;
  if (type === "date") {
    const match = typeof value === "string" ? ISO_DATE.exec(value) : null;
    if (!match) return text;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return date.getUTCMonth() === Number(match[2]) - 1 ? date : text;
  }
  return text;
}

/** Characters one exported cell adds to the file; typed cells count as `String(value)`. */
export function exportCellSize(cell: ExportCell): number {
  if (cell === null) return 0;
  if (typeof cell === "string") return cell.length;
  return cell instanceof Date ? cell.toISOString().length : String(cell).length;
}

/** A cell whose `formatCell` returned a promise: the value lands in `row[index]` once it settles. */
export type PendingCell = { row: ExportCell[]; index: number; value: PromiseLike<ExportCellValue> };

/** Awaits the promises together in groups, converts each value like a sync one, and reads `signal` after every group. */
export async function settlePending(pending: readonly PendingCell[], typed: boolean, signal: AbortSignal): Promise<void> {
  // a later group's rejection must not surface as an unhandled rejection while an earlier group is awaited
  for (const cell of pending) Promise.resolve(cell.value).catch(() => {});
  for (let from = 0; from < pending.length; from += ASYNC_GROUP_CELLS) {
    const group = pending.slice(from, from + ASYNC_GROUP_CELLS);
    const values = await Promise.all(group.map((cell) => cell.value));
    if (signal.aborted) throw abortReason(signal);
    group.forEach((cell, i) => {
      cell.row[cell.index] = typed ? toTypedCell(values[i]) : toCsvCell(values[i]);
    });
  }
}

/**
 * Maps one row through the cell types, then `formatCell`; the loaded rows and the source rows share it.
 * A promise from `formatCell` goes to `pending` and leaves the cell empty until `settlePending`; without `pending` it throws.
 */
export function mapExportRow<TData>(
  state: DataGridReadState,
  columns: readonly AnyColumnDef[],
  row: TData,
  text: "export" | "display",
  formatCell: FormatExportCell<TData> | undefined,
  typed: boolean,
  signal: AbortSignal = NEVER_ABORTED,
  pending?: PendingCell[],
): ExportCell[] {
  const cells = new Array<ExportCell>(columns.length);
  for (let index = 0; index < columns.length; index++) {
    const column = columns[index]!;
    const cellType = state.cellTypes[column.type ?? "text"];
    const value = getCellValue<unknown, AnyColumnDef>(row, column);
    const cellText = cellType ? (text === "display" ? displayText(cellType, value, column.options) : cellType.toText(value, column.options)) : "";
    if (!formatCell) {
      cells[index] = typed ? builtInTypedCell(column.type, value, cellText) : cellText;
      continue;
    }
    const formatted = formatCell({ value, text: cellText, row, column, signal });
    if (isThenable<ExportCellValue>(formatted)) {
      if (!pending) throw new TypeError("[data-grid-io] formatCell returned a promise; use exportGrid or buildXlsx, which await it");
      pending.push({ row: cells, index, value: formatted });
      cells[index] = null;
      continue;
    }
    cells[index] = typed ? toTypedCell(formatted) : toCsvCell(formatted);
  }
  return cells;
}
