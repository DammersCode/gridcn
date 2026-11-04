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
export type ExportSource<TData = unknown> = (ctx: ExportSourceContext) => Promise<readonly TData[]> | AsyncIterable<readonly TData[]>;

const SLICE_ROWS = 1000;
const MAX_EMPTY_BATCHES = 1000;

export const DEFAULT_SOURCE_MAX_ROWS = 1_000_000;
export const DEFAULT_SOURCE_MAX_BYTES = 256 * 1024 * 1024;

export type ExportProgress = { rowCount: number; byteCount: number };

export type ExportResult = {
  rowCount: number;
  /** True when `maxRows` or `maxBytes` ended the export before the source did. */
  truncated: boolean;
};

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
  let seenRows = 0;
  let emptyBatches = 0;
  const maxSeenRows = Math.max(maxRows, 1) * 2;
  let iterator: AsyncIterator<readonly unknown[]> | undefined;

  const take = (batch: unknown): void => {
    if (!Array.isArray(batch)) throw new TypeError("[data-grid-io] an export source batch must be an array");
    emptyBatches = batch.length === 0 ? emptyBatches + 1 : 0;
    if (emptyBatches > MAX_EMPTY_BATCHES) throw new RangeError("[data-grid-io] an export source returned only empty batches");
    seenRows += batch.length;
    if (seenRows > maxSeenRows) throw new RangeError("[data-grid-io] an export source returned too many rows");
    for (let from = 0; from < batch.length && !truncated; from += SLICE_ROWS) {
      const present = batch.slice(from, from + SLICE_ROWS).filter((row) => row !== undefined && row !== null);
      const room = maxRows - rowCount;
      if (present.length > room) truncated = true;
      const rows = buildRows(state, present.slice(0, room));
      rowCount += rows.length;
      byteCount += onBatch(rows);
      if (byteCount > maxBytes) truncated = true;
    }
    onProgress?.({ rowCount, byteCount });
  };

  try {
    const result = source({ spec, signal: inner.signal });
    if (isAsyncIterable(result)) {
      iterator = result[Symbol.asyncIterator]();
      while (!truncated) {
        const step = await iterator.next();
        if (outer?.aborted) throw abortReason(outer);
        if (step.done) break;
        take(step.value);
      }
    } else {
      const batch = await result;
      if (outer?.aborted) throw abortReason(outer);
      take(batch);
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
