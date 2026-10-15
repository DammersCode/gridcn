import { getCellValue, sanitizeFormulaCell, type AnyColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import { columnLabelText, displayText, getSelectedViewRows, isDev, type DataGridReadState } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import type { CsvDelimiter } from "./parse-import-file";

/** Longest cell text an Excel worksheet holds; XLSX export and print cut longer text to it. */
export const MAX_CELL_TEXT = 32_767;

/** Options for {@link exportGrid}. */
export type ExportGridOptions = {
  /** 'xlsx' via lazily-imported hucre, or hand-rolled RFC4180 'csv'. */
  format: "xlsx" | "csv";
  /** 'view' (default) exports the current sort/filter order; 'all' ignores view order and exports every row in `data` order; 'selection' exports only the selected rows, in view order. */
  scope?: "view" | "all" | "selection";
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
  /** Name of the single sheet inside the xlsx file; default 'Sheet1'. Ignored for csv. An invalid Excel sheet name (over 31 characters, `[]:*?/\`, `History`) rejects. */
  workbookName?: string;
  /** Caps the number of data rows exported (the header row is not counted); when the scope exceeds the cap, the export is truncated with a dev-only warning. */
  maxRows?: number;
};

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
 * Resolves the data indices a scope covers (lazy holes excluded): `'view'` walks `viewIndex`
 * (current sort/filter order), `'all'` walks `data` as-is, `'selection'` walks only the selected
 * rows in view order.
 */
export function exportDataIndices(state: DataGridReadState, scope: "view" | "all" | "selection"): number[] {
  const scoped =
    scope === "all"
      ? state.data.map((_, i) => i)
      : scope === "selection"
        ? getSelectedViewRows(state.selection).map((viewRow) => state.viewIndex[viewRow]!)
        : state.viewIndex;
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
export function buildExportRows(state: DataGridReadState, scope: "view" | "all" | "selection", options: BuildExportRowsOptions = {}): string[][] {
  const { text = "export", maxRows } = options;
  const dataIndices = exportDataIndices(state, scope);
  return buildRowsAt(state, maxRows === undefined ? dataIndices : dataIndices.slice(0, maxRows), text);
}

function buildRowsAt(state: DataGridReadState, dataIndices: readonly number[], text: "export" | "display"): string[][] {
  return dataIndices.map((dataRowIndex) => {
    const row = state.data[dataRowIndex];
    return state.visibleColumns.map((column) => {
      const cellType = state.cellTypes[column.type ?? "text"];
      const value = getCellValue<unknown, AnyColumnDef>(row, column);
      return cellType ? (text === "display" ? displayText(cellType, value, column.options) : cellType.toText(value, column.options)) : "";
    });
  });
}

/** Builds at most `maxRows` rows, with a dev-only warning when the scope exceeds the cap. */
function buildCappedExportRows(state: DataGridReadState, scope: "view" | "all" | "selection", maxRows: number | undefined): string[][] {
  if (maxRows !== undefined) {
    const total = exportDataIndices(state, scope).length;
    if (total > maxRows && isDev()) console.warn(`[data-grid-io] export truncated to ${maxRows} of ${total} rows (maxRows)`);
  }
  return buildExportRows(state, scope, { maxRows });
}

/** Header row text for each visible column, in the same order `buildExportRows` emits cells. */
export function buildExportHeaders(state: DataGridReadState): string[] {
  return state.visibleColumns.map((column) => columnLabelText(column));
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
export type BuildXlsxOptions = {
  /** Row scope, same semantics as {@link ExportGridOptions.scope}; default 'view'. */
  scope?: "view" | "all" | "selection";
  /** Whether to emit a header row; default true. */
  includeHeaders?: boolean;
  /** Name of the single sheet inside the workbook; default 'Sheet1'. An invalid Excel sheet name (over 31 characters, `[]:*?/\`, `History`) rejects. */
  workbookName?: string;
  /** Same row cap as {@link ExportGridOptions.maxRows}. */
  maxRows?: number;
};

/**
 * Builds an xlsx `Blob` from the grid's state without triggering a download — for server uploads
 * or inspecting the workbook before it leaves the browser. Values go through each column's cell
 * type `toText` like `exportGrid` and land as string cells, never formulas; hucre loads lazily.
 */
export async function buildXlsx(state: DataGridReadState, options: BuildXlsxOptions = {}): Promise<Blob> {
  const { scope = "view", includeHeaders = true, workbookName = "Sheet1", maxRows } = options;
  const rows = buildCappedExportRows(state, scope, maxRows);
  const table = includeHeaders ? [buildExportHeaders(state), ...rows] : rows;

  const cutRows = table.map((row) => row.map((text) => (text.length > MAX_CELL_TEXT ? text.slice(0, MAX_CELL_TEXT) : text)));

  const { writeXlsx } = await import("./xlsx-writer");
  const bytes = await writeXlsx({ sheets: [{ name: workbookName, rows: cutRows }] });
  // hucre types its output as ArrayBufferLike, but writeXlsx never returns a SharedArrayBuffer view
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/**
 * Serializes the grid to CSV or XLSX and triggers a download. Values always go through each
 * column's cell type `toText` (never raw values), so clipboard/export fidelity matches. hucre is
 * loaded lazily (dynamic `import()`) so the dependency never loads for CSV-only consumers.
 */
export async function exportGrid(state: DataGridReadState, options: ExportGridOptions): Promise<void> {
  const { format, scope = "view", includeHeaders = true, csvDelimiter = ",", csvBom = true, sanitizeFormulas = true, fileName = "export", workbookName, maxRows } = options;
  if (format === "csv") {
    const rows = buildCappedExportRows(state, scope, maxRows);
    const table = includeHeaders ? [buildExportHeaders(state), ...rows] : rows;
    const csv = (csvBom ? "\uFEFF" : "") + rowsToCsv(table, csvDelimiter, sanitizeFormulas);
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `${fileName}.csv`);
    return;
  }

  const blob = await buildXlsx(state, { scope, includeHeaders, workbookName, maxRows });
  downloadBlob(blob, `${fileName}.xlsx`);
}
