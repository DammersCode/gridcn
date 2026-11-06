import { sanitizeFormulaCell } from "@/registry/default/blocks/data-grid/data-grid";
import { columnLabelText, fullViewOf, getSelectedViewRows, isDev, type DataGridReadState } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import type { CsvDelimiter } from "./parse-import-file";
import {
  DEFAULT_SOURCE_MAX_BYTES,
  DEFAULT_SOURCE_MAX_ROWS,
  MAX_CELL_TEXT,
  exportCellSize,
  exportRows,
  mapExportRow,
  normalizeLimit,
  resolveExportColumns,
  type ExportCell,
  type ExportCellContext,
  type ExportCellValue,
  type ExportProgress,
  type ExportResult,
  type ExportRowsOptions,
  type ExportSource,
  type ExportSourceContext,
  type FormatExportCell,
} from "./export-source";

const BOM = String.fromCharCode(0xfeff);
const CSV_EOL = "\r\n";

/** Rows an Excel worksheet holds, header row included. */
const XLSX_MAX_ROWS = 1_048_576;

/** Cells one xlsx source export holds; the writer joins the sheet into one string. */
const XLSX_MAX_CELLS = 5_000_000;

const INVALID_SHEET_NAME = /[[\]:*?/\\]/;

export { MAX_CELL_TEXT, exportRows };

/** Where an export delivers its file instead of the browser download. */
export type ExportOutput = (file: Blob, ctx: { fileName: string; format: "csv" | "xlsx"; signal: AbortSignal }) => void | Promise<void>;

/** Column selection and cell formatting shared by every export. */
export type ExportShapeOptions<TData = unknown> = {
  /** Column ids to export, in this order. Hidden grid columns are allowed. Default: the visible columns in view order. An unknown id throws a `RangeError` before any row is read or fetched. With `source`, the source receives the same ids as `columnIds`. */
  columns?: readonly string[];
  /** Replaces the value of each exported cell. Runs once per cell after the cell type made its text (`text` holds that default). Return `null` or `undefined` for an empty cell. CSV writes numbers and booleans as text and Dates as ISO 8601; XLSX keeps numbers, booleans and Dates typed. A string stays text, cut at 32,767 characters. A number that is not finite and an invalid Date make an empty cell. A throw rejects the export. */
  formatCell?: FormatExportCell<TData>;
};

/** Options for {@link buildCsv}. */
export type BuildCsvOptions<TData = unknown> = ExportShapeOptions<TData> & {
  /** Row scope, same semantics as {@link ExportGridOptions.scope}; default 'view'. */
  scope?: "view" | "page" | "all" | "selection";
  /** Whether to emit a header row; default true. */
  includeHeaders?: boolean;
  /** CSV field delimiter; default ','. */
  csvDelimiter?: CsvDelimiter;
  /** Prefix the file with a UTF-8 BOM; default `true`. */
  csvBom?: boolean;
  /** Prefix formula-like cells with a single quote; default `true`. */
  sanitizeFormulas?: boolean;
  /** Same row cap as {@link ExportGridOptions.maxRows}. */
  maxRows?: number;
};

/** Options for {@link exportGrid}. */
export type ExportGridOptions<TData = unknown> = ExportShapeOptions<TData> & {
  /** Receives the finished file instead of the browser download. The grid builds no object URL. `fileName` carries the extension. A rejection rejects the export, and an aborted `signal` rejects before `output` runs. Works for loaded rows, `source`, and both formats. */
  output?: ExportOutput;
  /** 'xlsx' via lazily-imported hucre, or hand-rolled RFC4180 'csv' (default). */
  format?: "xlsx" | "csv";
  /** 'view' (default) exports the current sort/filter order; 'all' ignores view order and exports every row in `data` order; 'selection' exports only the selected rows, in view order. */
  scope?: "view" | "page" | "all" | "selection";
  /** Whether to emit a header row; default true. */
  includeHeaders?: boolean;
  /** CSV field delimiter; default ','. Ignored for xlsx. */
  csvDelimiter?: CsvDelimiter;
  /**
   * Prefix the CSV with a UTF-8 BOM (`\uFEFF`); default `true`. Excel only detects UTF-8 when the
   * file starts with a BOM — without it, umlauts and other non-ASCII characters open as mojibake.
   * Set `false` when a downstream consumer chokes on a leading BOM character.
   */
  csvBom?: boolean;
  /**
   * Prefix formula-like CSV cells (leading `=`, `+`, `-`, `@`, TAB, or CR; plain numbers exempt) with
   * a single quote so Excel/LibreOffice/Sheets read them as text instead of executing them;
   * default `true`. Set `false` when a downstream consumer expects the raw string.
   * XLSX exports are unaffected (string cells never run as formulas).
   */
  sanitizeFormulas?: boolean;
  /** Download file name, without extension; default 'export'. */
  fileName?: string;
  /** Name of the single sheet inside the xlsx file; default 'Sheet1'. Ignored for csv. An invalid Excel sheet name (empty, over 31 characters, `[]:*?/\`, a leading or trailing `'`, `history` in any case) rejects. */
  workbookName?: string;
  /** Caps the number of data rows exported (the header row is not counted); when the scope exceeds the cap, the export is truncated with a dev-only warning. With `source` the default is 1,000,000, and an xlsx file also stops at the Excel sheet limit and at 5,000,000 cells. */
  maxRows?: number;
  /** Where the rows of the whole result come from, for a grid that holds one page or some loaded blocks. With `source` the export ignores `scope` and the held rows; the grid's `spec` goes to the source. */
  source?: ExportSource;
  /** With `source`: stop after this many bytes of file text (xlsx: characters); default 256 MiB. The export keeps what it has and reports `truncated`. */
  maxBytes?: number;
  /** Cancels the export. The promise rejects with the signal's reason, no file downloads, and `output` does not run. */
  signal?: AbortSignal;
  /** With `source`: called after each batch with the running totals. */
  onProgress?: (progress: ExportProgress) => void;
};

export type { ExportCell, ExportCellContext, ExportCellValue, ExportProgress, ExportResult, ExportRowsOptions, ExportSource, ExportSourceContext, FormatExportCell };

const NEEDS_QUOTING_DEFAULT = /["\r\n]/;

/** Quotes one RFC4180 CSV field when it contains the delimiter, a quote, or a line break; doubles internal quotes. */
export function quoteCsvField(value: string, delimiter: string): string {
  const needsQuoting = value.includes(delimiter) || NEEDS_QUOTING_DEFAULT.test(value);
  if (!needsQuoting) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Joins rows into an RFC4180 CSV string (CRLF line endings), quoting fields as needed. With
 * `sanitizeFormulas` (default `true`), formula-like fields get a leading `'` first (see `sanitizeFormulaCell`).
 */
export function rowsToCsv(rows: readonly (readonly string[])[], delimiter: string, sanitizeFormulas = true): string {
  // sanitize before quoting: the apostrophe prefix itself never needs quoting
  const field = (value: string) => quoteCsvField(sanitizeFormulas ? sanitizeFormulaCell(value) : value, delimiter);
  return rows.map((row) => row.map(field).join(delimiter)).join("\r\n");
}

/** Options for {@link buildExportRows}. */
export type BuildExportRowsOptions = {
  /** Cell text source: `'export'` uses the cell type's `toText` (CSV/XLSX), `'display'` uses `toDisplayText ?? toText` (print). Default `'export'`. */
  text?: "export" | "display";
  /** Caps the number of data rows built (the header row is not counted). */
  maxRows?: number;
};

/**
 * Resolves the data indices a scope covers (lazy holes excluded): `'view'` walks the whole sorted and filtered view (every page)
 * (current sort/filter order), `'all'` walks `data` as-is, `'selection'` walks only the selected
 * rows in view order.
 */
export function exportDataIndices(state: DataGridReadState, scope: "view" | "page" | "all" | "selection"): number[] {
  const scoped =
    scope === "all"
      ? state.data.map((_, i) => i)
      : scope === "selection"
        ? getSelectedViewRows(state.selection, { checkedRowsOnly: state.keepCheckedRows }).map((viewRow) => state.viewIndex[viewRow]!)
        : scope === "page"
          ? state.viewIndex
          : fullViewOf(state.viewIndex);
  // lazy grids keep `data` sparse: skip holes before any accessor runs
  return scoped.filter((dataRowIndex) => state.data[dataRowIndex] !== undefined);
}

/**
 * Resolves the rows to export via the cell-type pipeline, in the requested `scope` order. With
 * `options.text: "display"` the cell type's display text (`toDisplayText ?? toText`) is used; the
 * default `'export'` uses `toText` (CSV/XLSX). Every scope emits all visible columns, so a
 * row-shaped export always matches its header row. Hole rows (unloaded indices of a lazy grid's
 * sparse `data`) are skipped in every scope. `options.maxRows` caps the number of rows built.
 */
export function buildExportRows(state: DataGridReadState, scope: "view" | "page" | "all" | "selection", options: BuildExportRowsOptions = {}): string[][] {
  const { text = "export", maxRows } = options;
  const dataIndices = exportDataIndices(state, scope);
  return buildRowsAt(state, maxRows === undefined ? dataIndices : dataIndices.slice(0, maxRows), text) as string[][];
}

function buildRowsAt<TData>(
  state: DataGridReadState,
  dataIndices: readonly number[],
  text: "export" | "display",
  columns: readonly ExportColumn[] = state.visibleColumns,
  formatCell?: FormatExportCell<TData>,
  typed = false,
): ExportCell[][] {
  return dataIndices.map((dataRowIndex) => mapExportRow(state, columns, state.data[dataRowIndex] as TData, text, formatCell, typed));
}

type ExportColumn = DataGridReadState["visibleColumns"][number];

/** Builds at most `maxRows` rows, with a dev-only warning when the scope exceeds the cap. */
function buildCappedExportRows<TData>(state: DataGridReadState, scope: "view" | "page" | "all" | "selection", maxRows: number | undefined, shape: ExportShapeOptions<TData>, typed: boolean): ExportCell[][] {
  const columns = resolveExportColumns(state, shape.columns);
  const dataIndices = exportDataIndices(state, scope);
  if (maxRows !== undefined && dataIndices.length > maxRows && isDev()) console.warn(`[data-grid-io] export truncated to ${maxRows} of ${dataIndices.length} rows (maxRows)`);
  return buildRowsAt(state, maxRows === undefined ? dataIndices : dataIndices.slice(0, maxRows), "export", columns, shape.formatCell, typed);
}

/** Header row text for each exported column: the visible columns, or the columns named by `columnIds`. */
export function buildExportHeaders(state: DataGridReadState, columnIds?: readonly string[]): string[] {
  return resolveExportColumns(state, columnIds).map((column) => columnLabelText(column));
}

/** Triggers a browser download of `blob` named `fileName`, via a temporary anchor + object URL (revoke deferred — see below). */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Firefox/Safari read the blob URL asynchronously after click(); revoking on the same tick can truncate the download.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Options for {@link buildXlsx}. */
export type BuildXlsxOptions<TData = unknown> = ExportShapeOptions<TData> & {
  /** Row scope, same semantics as {@link ExportGridOptions.scope}; default 'view'. */
  scope?: "view" | "page" | "all" | "selection";
  /** Whether to emit a header row; default true. */
  includeHeaders?: boolean;
  /** Name of the single sheet inside the workbook; default 'Sheet1'. An invalid Excel sheet name (empty, over 31 characters, `[]:*?/\`, a leading or trailing `'`, `history` in any case) rejects. */
  workbookName?: string;
  /** Same row cap as {@link ExportGridOptions.maxRows}. */
  maxRows?: number;
};

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function writeSheet(name: string, rows: ExportCell[][]): Promise<Blob> {
  const { writeXlsx } = await import("./xlsx-writer");
  const bytes = await writeXlsx({ sheets: [{ name, rows }] });
  // hucre types its output as ArrayBufferLike, but writeXlsx never returns a SharedArrayBuffer view
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: XLSX_TYPE });
}

/**
 * Builds an xlsx `Blob` from the grid's state without triggering a download — for server uploads
 * or inspecting the workbook before it leaves the browser. Values go through each column's cell
 * type `toText` like `exportGrid` and land as string cells, never formulas, unless `formatCell`
 * returns a number, boolean or Date, which land typed; hucre loads lazily.
 */
export async function buildXlsx<TData = unknown>(state: DataGridReadState, options: BuildXlsxOptions<TData> = {}): Promise<Blob> {
  const { scope = "view", includeHeaders = true, workbookName = "Sheet1", maxRows } = options;
  const rows = buildCappedExportRows(state, scope, maxRows, options, true);
  const table = includeHeaders ? [buildExportHeaders(state, options.columns), ...rows] : rows;
  return writeSheet(workbookName, table.map((row) => row.map((cell) => (typeof cell === "string" ? cutCell(cell) : cell))));
}

/**
 * Builds a CSV `Blob` from the rows the grid holds, without a download. Synchronous; cells go
 * through each column's cell type `toText` like `exportGrid`, then `formatCell`.
 */
export function buildCsv<TData = unknown>(state: DataGridReadState, options: BuildCsvOptions<TData> = {}): Blob {
  const { scope = "view", includeHeaders = true, csvDelimiter = ",", csvBom = true, sanitizeFormulas = true } = options;
  const maxRows = options.maxRows === undefined ? undefined : normalizeLimit(options.maxRows, Number.POSITIVE_INFINITY);
  const rows = buildCappedExportRows(state, scope, maxRows, options, false) as string[][];
  const table = includeHeaders ? [buildExportHeaders(state, options.columns), ...rows] : rows;
  return new Blob([(csvBom ? BOM : "") + rowsToCsv(table, csvDelimiter, sanitizeFormulas)], { type: "text/csv;charset=utf-8;" });
}

function isValidSheetName(name: string): boolean {
  return name.length > 0 && name.length <= 31 && !INVALID_SHEET_NAME.test(name) && !name.startsWith("'") && !name.endsWith("'") && name.toLowerCase() !== "history";
}

function cutCell(text: string): string {
  return text.length > MAX_CELL_TEXT ? text.slice(0, MAX_CELL_TEXT) : text;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("The export was aborted.", "AbortError");
}

function loadedResult(state: DataGridReadState, scope: "view" | "page" | "all" | "selection", maxRows: number | undefined): ExportResult {
  const total = exportDataIndices(state, scope).length;
  return { rowCount: maxRows === undefined ? total : Math.min(total, maxRows), truncated: maxRows !== undefined && total > maxRows };
}

type ExportDelivery = { fileName: string; output: ExportOutput | undefined; signal: AbortSignal };

async function deliver(blob: Blob, format: "csv" | "xlsx", { fileName, output, signal }: ExportDelivery): Promise<void> {
  throwIfAborted(signal);
  const file = `${fileName}.${format}`;
  if (output) await output(blob, { fileName: file, format, signal });
  else downloadBlob(blob, file);
}

/** Exports the rows `source` returns; CSV is written batch by batch, XLSX collects the rows first. */
async function exportFromSource<TData>(state: DataGridReadState, source: ExportSource, options: ExportGridOptions<TData>, delivery: ExportDelivery): Promise<ExportResult> {
  const { format = "csv", includeHeaders = true, csvDelimiter = ",", csvBom = true, sanitizeFormulas = true, workbookName = "Sheet1", onProgress } = options;
  const xlsx = format === "xlsx";
  if (xlsx && !isValidSheetName(workbookName)) throw new Error(`[data-grid-io] invalid xlsx sheet name: ${workbookName}`);
  const headers = buildExportHeaders(state, options.columns).map(cutCell);
  const requested = normalizeLimit(options.maxRows, DEFAULT_SOURCE_MAX_ROWS);
  const maxRows = xlsx ? Math.min(requested, XLSX_MAX_ROWS - (includeHeaders ? 1 : 0), Math.floor(XLSX_MAX_CELLS / Math.max(headers.length, 1))) : requested;
  const run: ExportRowsOptions<TData> = {
    source,
    columns: options.columns,
    formatCell: options.formatCell,
    typed: xlsx,
    maxRows,
    maxBytes: normalizeLimit(options.maxBytes, DEFAULT_SOURCE_MAX_BYTES),
    signal: delivery.signal,
    onProgress,
  };

  if (!xlsx) {
    const parts: Blob[] = [new Blob([csvBom ? BOM : ""])];
    let started = false;
    const append = (rows: readonly (readonly string[])[]): number => {
      if (rows.length === 0) return 0;
      const text = (started ? CSV_EOL : "") + rowsToCsv(rows, csvDelimiter, sanitizeFormulas);
      started = true;
      const part = new Blob([text]);
      parts.push(part);
      return part.size;
    };
    if (includeHeaders) append([headers]);
    const result = await exportRows<TData, string>(state, run, append);
    await deliver(new Blob(parts, { type: "text/csv;charset=utf-8;" }), "csv", delivery);
    return result;
  }

  const table: ExportCell[][] = includeHeaders ? [headers] : [];
  const result = await exportRows<TData, ExportCell>(state, run, (rows) => {
    let size = 0;
    for (const row of rows) {
      const cut = row.map((cell) => (typeof cell === "string" ? cutCell(cell) : cell));
      for (const cell of cut) size += exportCellSize(cell);
      table.push(cut);
    }
    return size;
  });
  await deliver(await writeSheet(workbookName, table), "xlsx", delivery);
  return result;
}

/**
 * Serializes the grid to CSV or XLSX and triggers a download, or hands the file to `output`.
 * Values go through each column's cell type `toText` (never raw values) unless `formatCell`
 * replaces them. hucre is loaded lazily (dynamic `import()`) so the dependency never loads for
 * CSV-only consumers.
 */
export async function exportGrid<TData = unknown>(state: DataGridReadState, options: ExportGridOptions<TData> = {}): Promise<ExportResult> {
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  try {
    return await runExport(state, options, signal);
  } catch (error) {
    controller.abort(error);
    throw error;
  }
}

async function runExport<TData>(state: DataGridReadState, options: ExportGridOptions<TData>, signal: AbortSignal): Promise<ExportResult> {
  const { source, output, format = "csv", scope = "view", fileName = "export" } = options;
  const delivery: ExportDelivery = { fileName, output, signal };
  if (source) return exportFromSource(state, source, options, delivery);
  const maxRows = options.maxRows === undefined ? undefined : normalizeLimit(options.maxRows, Number.POSITIVE_INFINITY);
  if (format === "csv") {
    await deliver(buildCsv(state, { ...options, maxRows }), "csv", delivery);
    return loadedResult(state, scope, maxRows);
  }

  await deliver(await buildXlsx(state, { ...options, maxRows }), "xlsx", delivery);
  return loadedResult(state, scope, maxRows);
}
