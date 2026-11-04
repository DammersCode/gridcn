import { getCellValue, type AnyColumnDef, type ServerSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { isDev, type DataGridReadState } from "@/registry/default/blocks/data-grid/data-grid-sdk";

/** What an {@link ExportSource} receives. */
export type ExportSourceContext = {
  /** The grid's sort, filters, and search text when the export started. Send it to your server. */
  spec: ServerSpec;
  /** Aborts when the export is cancelled or stops at a limit. Pass it to your request. */
  signal: AbortSignal;
};

/** Rows of the whole result for an "all rows" export. Return one array, or an async iterable of batches (an async generator that pages through your API). */
export type ExportSource<TData = unknown> = (ctx: ExportSourceContext) => readonly TData[] | Promise<readonly TData[]> | AsyncIterable<readonly TData[]>;

const SLICE_ROWS = 1000;
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
export type RunSourceOptions = {
  source: ExportSource;
  maxRows: number;
  maxBytes: number;
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

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The export was aborted.", "AbortError");
}

/**
 * Reads the batches of `source`, maps each row through the cell types, and hands the text rows to
 * `onBatch` (which returns the byte size it kept). Stops at `maxRows` or `maxBytes` and aborts the source.
 */
export async function runSourceExport(
  state: DataGridReadState,
  options: RunSourceOptions,
  onBatch: (rows: string[][]) => number,
): Promise<ExportResult> {
  const { source, maxRows, maxBytes, signal: outer, onProgress } = options;
  const inner = new AbortController();
  const stop = () => inner.abort(outer?.reason);
  if (outer?.aborted) throw abortReason(outer);
  outer?.addEventListener("abort", stop, { once: true });

  const spec: ServerSpec = { sorts: state.sortState, filters: state.filterState, searchText: state.searchText };
  let rowCount = 0;
  let byteCount = 0;
  let truncated = false;
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

  let sliceStarted = performance.now();
  const take = async (batch: unknown): Promise<void> => {
    if (!Array.isArray(batch)) throw new TypeError("[data-grid-io] an export source batch must be an array");
    emptyBatches = batch.length === 0 ? emptyBatches + 1 : 0;
    if (emptyBatches > MAX_EMPTY_BATCHES) throw new RangeError("[data-grid-io] an export source returned only empty batches");
    for (let from = 0; from < batch.length && !truncated; from += SLICE_ROWS) {
      const slice = batch.slice(from, from + SLICE_ROWS);
      const present = slice.filter((row) => row !== undefined && row !== null);
      skippedRows += slice.length - present.length;
      if (skippedRows > maxSkippedRows) throw new RangeError("[data-grid-io] an export source returned too many empty rows");
      const room = maxRows - rowCount;
      if (present.length > room) truncated = true;
      const rows = buildRows(state, present.slice(0, room));
      rowCount += rows.length;
      byteCount += onBatch(rows);
      if (byteCount > maxBytes) truncated = true;
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
    const result = source({ spec, signal: inner.signal });
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

function buildRows(state: DataGridReadState, rows: readonly unknown[]): string[][] {
  return rows.map((row) =>
    state.visibleColumns.map((column) => {
      const cellType = state.cellTypes[column.type ?? "text"];
      return cellType ? cellType.toText(getCellValue<unknown, AnyColumnDef>(row, column), column.options) : "";
    }),
  );
}

/** Clamps a caller limit to a non-negative integer: `NaN` falls back, `Infinity` becomes the largest safe integer. */
export function normalizeLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || Number.isNaN(value)) return fallback;
  return Math.min(Math.max(0, Math.floor(value)), Number.MAX_SAFE_INTEGER);
}
