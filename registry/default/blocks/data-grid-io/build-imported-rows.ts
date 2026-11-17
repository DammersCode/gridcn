import type { AnyColumnDef, CellType, ColumnDef, GateContext } from "@/registry/default/blocks/data-grid/data-grid";
import type { ValidateBatchItem, ValidateResult } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { createWarnOnce, isDev, isThenable, parseWithHook, resolveColumnValidate, runValidateBatch, safeFromText, settleHookFailure, setCellValue, validateContextsFor } from "@/registry/default/blocks/data-grid/data-grid-sdk";

/** One import-column -> grid-column mapping entry; `null` skips the import column. */
export type ImportColumnMapping = { importColumnIndex: number; gridColumnId: string | null };

/** Above this row count, `buildImportedRows` yields between chunks so the dialog stays responsive and Cancel can land. */
export const IMPORT_CHUNK_THRESHOLD_ROWS = 5_000;

/** Rows processed per chunk once {@link IMPORT_CHUNK_THRESHOLD_ROWS} is exceeded. */
const CHUNK_SIZE = 2_000;

/** One import cell whose value failed `column.validate`: the cell is cleared with its cell type's `clearValue()`, and the row is still imported. */
export type ImportRejectedCell = {
  /** 0-based index into `dataRows` (header row excluded). */
  rowIndex: number;
  /** 0-based index of the source column in the import file. */
  importColumnIndex: number;
  /** The grid column the value was mapped to and cleared in. */
  gridColumnId: string;
  /** The validator's reason, cut at {@link MAX_REJECTED_MESSAGE_LENGTH} characters. */
  message?: string;
};

/** Longest validator message an {@link ImportRejectedCell} keeps. */
export const MAX_REJECTED_MESSAGE_LENGTH = 200;

/** Replaces `cellType.fromText` for one import cell. The returned value still goes through the column's `validate`. */
export type ProcessCellFromText<TData> = (
  text: string,
  ctx: {
    /** The row as `createRow` returned it. */
    row: TData;
    column: ColumnDef<TData, unknown, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    source: "import";
    signal: AbortSignal;
    /** The column's own parser, for the cells you do not change. */
    fromText: (text: string) => unknown;
  },
) => unknown;

/** Result of {@link buildImportedRows}: the built rows plus every rejected (cleared) cell. */
export type BuildImportedRowsResult<TData> = {
  rows: TData[];
  /** Cells whose value failed `column.validate` and was cleared. Their rows are still built. */
  rejected: ImportRejectedCell[];
  /** Cells of `validationMode: "warn"` columns whose value failed validation. The value stays in its row, uncleared. */
  flagged: ImportRejectedCell[];
};

/** Inputs for {@link buildImportedRows}. */
export type BuildImportedRowsOptions<TData> = {
  /** Data rows only (header row, if any, already excluded by the caller). */
  dataRows: readonly string[][];
  mapping: readonly ImportColumnMapping[];
  // ColumnDef's 3rd param (TValidate) erases to `any`, not `unknown` — see data-grid/store.tsx's
  // AnyColumnDef doc: validate's function-or-schema union can't stay bivariant as a plain property.
  columns: readonly ColumnDef<TData, unknown, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  cellTypes: Record<string, CellType<TData, unknown, unknown>>;
  /** Builds a fresh row for import row `index`; required — the dialog never writes to the grid store directly. A promise makes the build a Promise; a rejection rejects it. `ctx.signal` is `options.signal`. */
  createRow: (index: number, ctx: GateContext) => TData | Promise<TData>;
  /** Parses one cell instead of `cellType.fromText`; may return a promise, which makes the build asynchronous. Its value is validated like any other. */
  processCellFromText?: ProcessCellFromText<TData>;
  /** Checked between chunks on the chunked path (above {@link IMPORT_CHUNK_THRESHOLD_ROWS} rows, or with `processCellFromText`) and after an async `createRow`; an aborted signal throws `"import-cancelled"`. A small synchronous build ignores it. */
  signal?: AbortSignal;
  /** The rows the import joins. `unique()` compares each imported value with them and with the other imported rows. The default append passes the grid's `data`. Default `[]`. */
  existingRows?: readonly TData[];
  /** Runs once per built row after its cells are set, like the grid's `validateRow`. A verdict entry for a mapped column clears that cell and lands in `rejected`; an entry for an unmapped column lands in `flagged` with `importColumnIndex` `-1`. A throw or a rejection gives that row no verdict. Rows run in chunks, so `signal` cancels between chunks. */
  validateRow?: (row: TData, rowId: string, ctx: GateContext) => Record<string, string> | null | undefined | Promise<Record<string, string> | null | undefined>;
  /** The id `validateRow` receives for built row `index`. Default: `String(index)`. */
  getRowId?: (row: TData, index: number) => string;
};

/** One import cell awaiting its validation verdict: where it goes, and what to write if the value is rejected. */
type ImportCell = {
  rowIndex: number;
  importColumnIndex: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- same TValidate erasure as BuildImportedRowsOptions.columns.
  column: ColumnDef<any, unknown, any>;
  clearedValue: unknown;
  warn: boolean;
};

/** Thrown from the chunked path when `options.signal` is aborted between chunks. */
export const IMPORT_CANCELLED_MESSAGE = "import-cancelled";

/**
 * Builds `TData` rows from parsed import rows: one `createRow(index)` per row, then each mapped
 * cell is parsed through its column's cell type `fromText` and checked by `column.validate` (or the
 * cell type's `validate`) — invalid values are cleared via `clearValue()` rather than dropping the
 * whole row, and every rejected cell is listed in the result's `rejected`.
 *
 * Always returns a Promise, and a throw rejects it. Imports above {@link IMPORT_CHUNK_THRESHOLD_ROWS} rows
 * (or with `processCellFromText`) are built in chunks that yield to the event loop, so the dialog repaints
 * and `options.signal` can cancel between chunks. Async validators run with the shared chunked concurrency cap.
 *
 * The function form's second argument is the row as `createRow` returned it, not the row with this
 * import row's earlier columns already folded in — validating a whole import row concurrently and
 * validating it left to right cannot both be true, and the fresh row is the predictable one.
 */
export async function buildImportedRows<TData>(options: BuildImportedRowsOptions<TData>): Promise<BuildImportedRowsResult<TData>> {
  const built = await buildNow(options);
  return options.validateRow ? validateBuiltRows(built, options, options.validateRow) : built;
}

/** Runs `validateRow` over the built rows, `CHUNK_SIZE` rows at a time. A verdict reads only the keys of known columns, so a hostile object costs at most one lookup per column. */
async function validateBuiltRows<TData>(
  built: BuildImportedRowsResult<TData>,
  options: BuildImportedRowsOptions<TData>,
  validateRow: NonNullable<BuildImportedRowsOptions<TData>["validateRow"]>,
): Promise<BuildImportedRowsResult<TData>> {
  const { rows, rejected, flagged } = built;
  const { columns, cellTypes, mapping, signal = NEVER_ABORTED, getRowId = (_row, index) => String(index) } = options;
  const gateCtx: GateContext = { signal };
  const importIndexOf = new Map<string, number>();
  for (const m of mapping) if (m.gridColumnId !== null && !importIndexOf.has(m.gridColumnId)) importIndexOf.set(m.gridColumnId, m.importColumnIndex);

  for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
    if (signal.aborted) throw new Error(IMPORT_CANCELLED_MESSAGE);
    const end = Math.min(start + CHUNK_SIZE, rows.length);
    const verdicts = await Promise.all(
      rows.slice(start, end).map(async (row, offset) => {
        try {
          return await validateRow(row, getRowId(row, start + offset), gateCtx);
        } catch {
          return null;
        }
      }),
    );
    if (signal.aborted) throw new Error(IMPORT_CANCELLED_MESSAGE);
    verdicts.forEach((verdict, offset) => {
      if (!verdict || typeof verdict !== "object") return;
      const rowIndex = start + offset;
      for (const column of columns) {
        if (!Object.hasOwn(verdict, column.id) || typeof verdict[column.id] !== "string") continue;
        const message = verdict[column.id]!.slice(0, MAX_REJECTED_MESSAGE_LENGTH);
        const importColumnIndex = importIndexOf.get(column.id);
        const cellType = cellTypes[column.type ?? "text"];
        if (importColumnIndex === undefined || !cellType) {
          flagged.push({ rowIndex, importColumnIndex: -1, gridColumnId: column.id, message });
          continue;
        }
        // as never: setCellValue is typed against this column's own TData/TValue, which TS can't unify with the generic TData/unknown here
        rows[rowIndex] = setCellValue(rows[rowIndex] as never, column as never, cellType.clearValue(column.options) as never) as TData;
        rejected.push({ rowIndex, importColumnIndex, gridColumnId: column.id, message });
      }
    });
    await yieldToEventLoop();
  }
  return built;
}

function buildNow<TData>(options: BuildImportedRowsOptions<TData>): BuildImportedRowsResult<TData> | Promise<BuildImportedRowsResult<TData>> {
  const { dataRows, mapping, columns, cellTypes, createRow, signal, processCellFromText, existingRows = [] } = options;
  const columnsById = new Map(columns.map((column) => [column.id, column] as const));
  const seenColumns = new Set<string>();
  const warnedColumns = new Set<string>();
  const activeMappings = mapping.filter((m): m is { importColumnIndex: number; gridColumnId: string } => {
    if (m.gridColumnId === null) return false;
    if (!seenColumns.has(m.gridColumnId)) {
      seenColumns.add(m.gridColumnId);
      return true;
    }
    if (isDev() && !warnedColumns.has(m.gridColumnId)) {
      warnedColumns.add(m.gridColumnId);
      console.warn(`[data-grid-io] buildImportedRows: grid column "${m.gridColumnId}" is mapped by more than one import column - the first mapping wins`);
    }
    return false;
  });

  if (dataRows.length > IMPORT_CHUNK_THRESHOLD_ROWS || processCellFromText) {
    return buildImportedRowsChunked(dataRows, activeMappings, columnsById, cellTypes, createRow, signal ?? new AbortController().signal, existingRows, processCellFromText);
  }

  const gateCtx: GateContext = { signal: signal ?? new AbortController().signal };
  const created = dataRows.map((_, index) => createRow(index, gateCtx));
  if (created.some((row) => isThenable(row))) {
    return Promise.all(created).then((rows) => {
      if (signal?.aborted) throw new Error(IMPORT_CANCELLED_MESSAGE);
      return finishSmallImport(dataRows, activeMappings, columnsById, cellTypes, rows, existingRows);
    });
  }
  return finishSmallImport(dataRows, activeMappings, columnsById, cellTypes, created as TData[], existingRows);
}

function finishSmallImport<TData>(
  dataRows: readonly string[][],
  activeMappings: readonly ResolvedMapping[],
  columnsById: ReadonlyMap<string, ColumnDef<TData, unknown, any>>, // eslint-disable-line @typescript-eslint/no-explicit-any
  cellTypes: Record<string, CellType<TData, unknown, unknown>>,
  rows: TData[],
  existingRows: readonly TData[],
): BuildImportedRowsResult<TData> | Promise<BuildImportedRowsResult<TData>> {
  const rejected: ImportRejectedCell[] = [];
  const flagged: ImportRejectedCell[] = [];
  const { items, cells } = buildCellsForRange(dataRows, 0, dataRows.length, activeMappings, columnsById, cellTypes, rows);
  attachValidateContexts(items, cells, existingRows);
  const results = runValidateBatch(items);
  if (results instanceof Promise) return results.then((resolved) => ({ rows: writeCells(rows, cells, items, resolved, rejected, flagged), rejected, flagged }));
  return { rows: writeCells(rows, cells, items, results, rejected, flagged), rejected, flagged };
}

/** One resolved mapping entry: the source column index paired with its target column definition. */
type ResolvedMapping = { importColumnIndex: number; gridColumnId: string };

// shortcut: a chunked import (past one chunk) checks each chunk's cells as one batch; a duplicate across chunks passes. Upgrade: settle every chunk's values before validating.
/** Gives each function `validate` the imported cells of its column as the batch, over the rows the import joins. */
function attachValidateContexts(items: ValidateBatchItem[], cells: readonly ImportCell[], existingRows: readonly unknown[]): void {
  const contexts = validateContextsFor(existingRows, cells.map((cell) => cell.column as AnyColumnDef), cells.map((cell, i) => ({ columnId: cell.column.id, row: items[i]!.row, value: items[i]!.value })));
  cells.forEach((cell, i) => (items[i]!.ctx = contexts.get(cell.column.id)));
}

/** Builds `rows[start, end)`'s validation items/cells against the already-created `rows` array. */
function buildCellsForRange<TData>(
  dataRows: readonly string[][],
  start: number,
  end: number,
  activeMappings: readonly ResolvedMapping[],
  columnsById: ReadonlyMap<string, ColumnDef<TData, unknown, any>>, // eslint-disable-line @typescript-eslint/no-explicit-any
  cellTypes: Record<string, CellType<TData, unknown, unknown>>,
  rows: TData[],
  processCellFromText?: ProcessCellFromText<TData>,
  signal: AbortSignal = NEVER_ABORTED,
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
      const columnValidate = resolveColumnValidate(column as AnyColumnDef, cellType);
      const parsed = processCellFromText
        ? parseWithHook("processCellFromText", () => processCellFromText(text, { row: rows[rowIndex] as TData, column, source: "import", signal, fromText: (raw) => cellType.fromText(raw, column.options) }), columnValidate, warnOnceFor(processCellFromText))
        : safeFromText(cellType, text, column.options, columnValidate);
      items.push({ validate: parsed.validate as never, value: parsed.value, row: rows[rowIndex] });
      cells.push({ rowIndex, importColumnIndex, column, clearedValue: cellType.clearValue(column.options), warn: column.validationMode === "warn" });
    }
  }
  return { items, cells };
}

const hookWarnings = new WeakMap<object, ReturnType<typeof createWarnOnce>>();

function warnOnceFor(hook: object): ReturnType<typeof createWarnOnce> {
  let warnOnce = hookWarnings.get(hook);
  if (!warnOnce) hookWarnings.set(hook, (warnOnce = createWarnOnce()));
  return warnOnce;
}

const NEVER_ABORTED = new AbortController().signal;

/** Awaits every item whose value a `processCellFromText` hook returned as a promise. */
async function settleItemValues(items: ValidateBatchItem[]): Promise<void> {
  const pending: Promise<void>[] = [];
  items.forEach((item, index) => {
    if (isThenable(item.value)) pending.push(Promise.resolve(item.value).then((value) => void (items[index] = settleHookFailure({ ...items[index]!, value }))));
  });
  if (pending.length > 0) await Promise.all(pending);
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
  createRow: (index: number, ctx: GateContext) => TData | Promise<TData>,
  signal: AbortSignal,
  existingRows: readonly TData[],
  processCellFromText?: ProcessCellFromText<TData>,
): Promise<BuildImportedRowsResult<TData>> {
  const gateCtx: GateContext = { signal };
  const created = dataRows.map((_, index) => createRow(index, gateCtx));
  const rows = created.some((row) => isThenable(row)) ? await Promise.all(created) : (created as TData[]);
  const rejected: ImportRejectedCell[] = [];
  const flagged: ImportRejectedCell[] = [];

  for (let start = 0; start < dataRows.length; start += CHUNK_SIZE) {
    if (signal?.aborted) throw new Error(IMPORT_CANCELLED_MESSAGE);
    const end = Math.min(start + CHUNK_SIZE, dataRows.length);
    const { items, cells } = buildCellsForRange(dataRows, start, end, activeMappings, columnsById, cellTypes, rows, processCellFromText, signal);
    await settleItemValues(items);
    if (signal?.aborted) throw new Error(IMPORT_CANCELLED_MESSAGE);
    attachValidateContexts(items, cells, existingRows);
    const results = await runValidateBatch(items);
    writeCells(rows, cells, items, results, rejected, flagged);
    await yieldToEventLoop();
  }
  if (signal?.aborted) throw new Error(IMPORT_CANCELLED_MESSAGE);

  return { rows, rejected, flagged };
}

function rejectionMessage(result: ValidateResult): string | undefined {
  if (!("error" in result) || typeof result.error !== "string" || result.error === "") return undefined;
  return result.error.slice(0, MAX_REJECTED_MESSAGE_LENGTH);
}

/**
 * Folds each verdict into its row: the validator's output on success, the cell type's `clearValue()`
 * on rejection (the rejected cell is appended to `rejected`). `cells` is grouped by `rowIndex`
 * (built in mapping order per row), so a run of
 * consecutive plain-`accessorKey` cells for the same row is merged into one spread instead of one
 * spread per cell — this was the measured hot spot, one spread + 2 temp objects per cell at scale.
 * The run is flushed (a) before a `setValue` cell in the same row, so `setValue` still sees every
 * earlier cell's write, exactly as the un-merged left-to-right spreads did, and (b) at each row
 * boundary. A column with a custom `setValue` keeps writing through `setCellValue` per cell, since
 * only `setValue` knows how to fold its own value into the row.
 */
function writeCells<TData>(
  rows: TData[],
  cells: readonly ImportCell[],
  items: readonly { value: unknown }[],
  results: readonly ValidateResult[],
  rejected: ImportRejectedCell[],
  flagged: ImportRejectedCell[],
): TData[] {
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
    const isRejected = "error" in result;
    const keepsValue = isRejected && cell.warn && !result.thrown;
    if (isRejected) (keepsValue ? flagged : rejected).push({ rowIndex: cell.rowIndex, importColumnIndex: cell.importColumnIndex, gridColumnId: cell.column.id, message: rejectionMessage(result) });
    const value = keepsValue ? items[i]!.value : isRejected ? cell.clearedValue : result.value;

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
