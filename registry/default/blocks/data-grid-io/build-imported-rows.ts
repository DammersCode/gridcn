import type { CellType, ColumnDef, ValidateBatchItem, ValidateResult } from "@/registry/default/blocks/data-grid/data-grid";
import { runValidateBatch, setCellValue } from "@/registry/default/blocks/data-grid/data-grid";

/** One import-column -> grid-column mapping entry; `null` skips the import column. */
export type ImportColumnMapping = { importColumnIndex: number; gridColumnId: string | null };

/** Above this row count, `buildImportedRows` yields between chunks so the dialog stays responsive and Cancel can land. */
export const IMPORT_CHUNK_THRESHOLD_ROWS = 5_000;

/** Rows processed per chunk once {@link IMPORT_CHUNK_THRESHOLD_ROWS} is exceeded. */
const CHUNK_SIZE = 2_000;

/** Inputs for {@link buildImportedRows}. */
export type BuildImportedRowsOptions<TData> = {
  /** Data rows only (header row, if any, already excluded by the caller). */
  dataRows: readonly string[][];
  mapping: readonly ImportColumnMapping[];
  // ColumnDef's 3rd param (TValidate) erases to `any`, not `unknown` — see data-grid/store.tsx's
  // AnyColumnDef doc: validate's function-or-schema union can't stay bivariant as a plain property.
  columns: readonly ColumnDef<TData, unknown, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  cellTypes: Record<string, CellType<TData, unknown, unknown>>;
  /** Builds a fresh row for import row `index`; required — the dialog never writes to the grid store directly. */
  createRow: (index: number) => TData;
  /** Checked between chunks on the large-import path; throws `"import-cancelled"` when true. Ignored below {@link IMPORT_CHUNK_THRESHOLD_ROWS}. */
  signal?: AbortSignal;
};

/** One import cell awaiting its validation verdict: where it goes, and what to write if the value is rejected. */
type ImportCell = {
  rowIndex: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- same TValidate erasure as BuildImportedRowsOptions.columns.
  column: ColumnDef<any, unknown, any>;
  clearedValue: unknown;
};

/** Thrown from the chunked path when `options.signal` is aborted between chunks. */
export const IMPORT_CANCELLED_MESSAGE = "import-cancelled";

/**
 * Builds `TData` rows from parsed import rows: one `createRow(index)` per row, then each mapped
 * cell is parsed through its column's cell type `fromText` and checked by `column.validate` —
 * invalid values are cleared via `clearValue()` rather than dropping the whole row.
 *
 * Returns the rows directly when every validator is synchronous AND `dataRows` is at or below
 * {@link IMPORT_CHUNK_THRESHOLD_ROWS}. Above that row count, or when a column has an ASYNC Standard
 * Schema, this returns a Promise instead: large imports are built in chunks that yield to the event
 * loop (so the dialog repaints and `options.signal` can cancel between chunks), and any async
 * validators run with the shared chunked concurrency cap. The import dialog's existing pending
 * affordance covers both waits.
 *
 * The function form's second argument is the row as `createRow` returned it, not the row with this
 * import row's earlier columns already folded in — validating a whole import row concurrently and
 * validating it left to right cannot both be true, and the fresh row is the predictable one.
 */
export function buildImportedRows<TData>(options: BuildImportedRowsOptions<TData>): TData[] | Promise<TData[]> {
  const { dataRows, mapping, columns, cellTypes, createRow, signal } = options;
  const columnsById = new Map(columns.map((column) => [column.id, column] as const));
  const activeMappings = mapping.filter((m): m is { importColumnIndex: number; gridColumnId: string } => m.gridColumnId !== null);

  if (dataRows.length > IMPORT_CHUNK_THRESHOLD_ROWS) {
    return buildImportedRowsChunked(dataRows, activeMappings, columnsById, cellTypes, createRow, signal);
  }

  const rows = dataRows.map((_, index) => createRow(index));
  const { items, cells } = buildCellsForRange(dataRows, 0, dataRows.length, activeMappings, columnsById, cellTypes, rows);

  const results = runValidateBatch(items);
  if (results instanceof Promise) return results.then((resolved) => writeCells(rows, cells, resolved));
  return writeCells(rows, cells, results);
}

/** One resolved mapping entry: the source column index paired with its target column definition. */
type ResolvedMapping = { importColumnIndex: number; gridColumnId: string };

/** Builds `rows[start, end)`'s validation items/cells against the already-created `rows` array. */
function buildCellsForRange<TData>(
  dataRows: readonly string[][],
  start: number,
  end: number,
  activeMappings: readonly ResolvedMapping[],
  columnsById: ReadonlyMap<string, ColumnDef<TData, unknown, any>>, // eslint-disable-line @typescript-eslint/no-explicit-any
  cellTypes: Record<string, CellType<TData, unknown, unknown>>,
  rows: TData[],
): { items: ValidateBatchItem[]; cells: ImportCell[] } {
  const items: ValidateBatchItem[] = [];
  const cells: ImportCell[] = [];
  for (let rowIndex = start; rowIndex < end; rowIndex++) {
    const sourceRow = dataRows[rowIndex]!; // start/end are within dataRows.length by construction
    for (const { importColumnIndex, gridColumnId } of activeMappings) {
      const column = columnsById.get(gridColumnId);
      if (!column) continue;
      const cellType = cellTypes[column.type ?? "text"];
      if (!cellType) continue;

      const text = sourceRow[importColumnIndex] ?? "";
      // as never: validate is typed against this column's own TData/TValue, which TS can't unify with the generic TData/unknown here — safe since column and row/value are all this same import's TData.
      items.push({ validate: column.validate as never, value: cellType.fromText(text, column.options), row: rows[rowIndex] });
      cells.push({ rowIndex, column, clearedValue: cellType.clearValue(column.options) });
    }
  }
  return { items, cells };
}

/** Yields to the event loop; a chunk boundary for both the main-thread-block fix and the Cancel affordance. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve));
}

/**
 * Large-import path: builds and writes rows {@link CHUNK_SIZE} at a time, yielding between chunks so
 * the dialog's pending state actually repaints and `signal` gets a chance to cancel. Validation still
 * runs once per chunk (not once for the whole import) so a huge async-schema import doesn't hold
 * `CHUNK_SIZE`-multiples of items in flight at once.
 */
async function buildImportedRowsChunked<TData>(
  dataRows: readonly string[][],
  activeMappings: readonly ResolvedMapping[],
  columnsById: ReadonlyMap<string, ColumnDef<TData, unknown, any>>, // eslint-disable-line @typescript-eslint/no-explicit-any
  cellTypes: Record<string, CellType<TData, unknown, unknown>>,
  createRow: (index: number) => TData,
  signal?: AbortSignal,
): Promise<TData[]> {
  const rows = dataRows.map((_, index) => createRow(index));

  for (let start = 0; start < dataRows.length; start += CHUNK_SIZE) {
    if (signal?.aborted) throw new Error(IMPORT_CANCELLED_MESSAGE);
    const end = Math.min(start + CHUNK_SIZE, dataRows.length);
    const { items, cells } = buildCellsForRange(dataRows, start, end, activeMappings, columnsById, cellTypes, rows);
    const results = await runValidateBatch(items);
    writeCells(rows, cells, results);
    await yieldToEventLoop();
  }
  if (signal?.aborted) throw new Error(IMPORT_CANCELLED_MESSAGE);

  return rows;
}

/**
 * Folds each verdict into its row: the validator's output on success, the cell type's `clearValue()`
 * on rejection. `cells` is grouped by `rowIndex` (built in mapping order per row), so a run of
 * consecutive plain-`accessorKey` cells for the same row is merged into one spread instead of one
 * spread per cell — this was the measured hot spot, one spread + 2 temp objects per cell at scale.
 * The run is flushed (a) before a `setValue` cell in the same row, so `setValue` still sees every
 * earlier cell's write, exactly as the un-merged left-to-right spreads did, and (b) at each row
 * boundary. A column with a custom `setValue` keeps writing through `setCellValue` per cell, since
 * only `setValue` knows how to fold its own value into the row.
 */
function writeCells<TData>(rows: TData[], cells: readonly ImportCell[], results: readonly ValidateResult[]): TData[] {
  let pendingRow = -1;
  let pendingPatch: Record<string, unknown> | null = null;
  const flush = () => {
    if (pendingPatch === null) return;
    // as TData: TData is generic here, but pendingPatch's keys are this same TData's own accessorKeys — mirrors setCellValue's own accessorKey-spread branch.
    rows[pendingRow] = { ...rows[pendingRow], ...pendingPatch } as TData;
    pendingPatch = null;
  };

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]!; // i < cells.length by loop condition
    const result = results[i];
    if (!result) continue;
    const value = "error" in result ? cell.clearedValue : result.value;

    if (cell.rowIndex !== pendingRow) flush();
    pendingRow = cell.rowIndex;

    if (!cell.column.setValue && cell.column.accessorKey) {
      pendingPatch ??= {};
      pendingPatch[cell.column.accessorKey] = value;
      continue;
    }
    flush();
    // as never: setCellValue is typed against this column's own TData/TValue, which TS can't unify with the generic TData/unknown here — safe since column and row/value are all this same import's TData.
    rows[cell.rowIndex] = setCellValue(rows[cell.rowIndex] as never, cell.column as never, value as never) as TData;
  }
  flush();
  return rows;
}
