import { getSelectedViewRows, isDev, type AnyColumnDef, type DataGridStoreState } from "@/registry/default/blocks/data-grid/data-grid";
import type { CsvDelimiter } from "./parse-import-file";

/** Options for {@link exportGrid}. */
export type ExportGridOptions = {
  /** 'xlsx' via lazily-imported SheetJS, or hand-rolled RFC4180 'csv'. */
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
  /** Download file name, without extension; default 'export'. */
  fileName?: string;
  /** Name of the single sheet inside the xlsx file; default 'Sheet1'. Ignored for csv. */
  workbookName?: string;
  /** Caps the number of data rows exported (the header row is not counted); when the scope exceeds the cap, the export is truncated with a dev-only warning. */
  maxRows?: number;
};

const NEEDS_QUOTING_DEFAULT = /["\r\n]/;

/** Column display header: `headerText` override, else the string `header`, else the column id. */
function columnHeaderText(column: AnyColumnDef): string {
  return column.headerText ?? (typeof column.header === "string" ? column.header : column.id);
}

/** Quotes one RFC4180 CSV field when it contains the delimiter, a quote, or a line break; doubles internal quotes. */
export function quoteCsvField(value: string, delimiter: string): string {
  const needsQuoting = value.includes(delimiter) || NEEDS_QUOTING_DEFAULT.test(value);
  if (!needsQuoting) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/** Joins rows of already-quoted-as-needed fields into an RFC4180 CSV string (CRLF line endings). */
export function rowsToCsv(rows: readonly (readonly string[])[], delimiter: string): string {
  return rows.map((row) => row.map((field) => quoteCsvField(field, delimiter)).join(delimiter)).join("\r\n");
}

/** Truncates to `maxRows` data rows when the scope exceeds the cap, with a dev-only warning. */
function capExportRows(rows: string[][], maxRows: number | undefined): string[][] {
  if (maxRows === undefined || rows.length <= maxRows) return rows;
  if (isDev()) console.warn(`[data-grid-io] export truncated to ${maxRows} of ${rows.length} rows (maxRows)`);
  return rows.slice(0, maxRows);
}

/**
 * Resolves the rows to export via the cell-type pipeline (`toText`, never raw values), in the
 * requested `scope` order: `'view'` walks `viewIndex` (current sort/filter order), `'all'` walks
 * `data` as-is, ignoring any active sort/filter, `'selection'` walks only the selected rows in
 * view order. Every scope emits all visible columns, so a row-shaped export always matches its
 * header row. Hole rows (unloaded indices of a lazy grid's sparse `data`) are skipped in every
 * scope.
 */
export function buildExportRows(state: DataGridStoreState, scope: "view" | "all" | "selection"): string[][] {
  const dataIndices =
    scope === "all"
      ? state.data.map((_, i) => i)
      : scope === "selection"
          ? getSelectedViewRows(state.selection).map((viewRow) => state.viewIndex[viewRow]!)
        : state.viewIndex;
  // lazy grids keep `data` sparse: skip holes before any accessor runs
  return dataIndices.filter((dataRowIndex) => state.data[dataRowIndex] !== undefined).map((dataRowIndex) => {
    const row = state.data[dataRowIndex];
    return state.visibleColumns.map((column) => {
      const cellType = state.cellTypes[column.type ?? "text"];
      const value = column.accessorFn
        ? column.accessorFn(row)
        : column.accessorKey
          ? (row as Record<string, unknown> | undefined)?.[column.accessorKey]
          : undefined;
      return cellType ? cellType.toText(value, column.options) : "";
    });
  });
}

/** Header row text for each visible column, in the same order `buildExportRows` emits cells. */
export function buildExportHeaders(state: DataGridStoreState): string[] {
  return state.visibleColumns.map((column) => columnHeaderText(column));
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
  /** Name of the single sheet inside the workbook; default 'Sheet1'. */
  workbookName?: string;
  /** Same row cap as {@link ExportGridOptions.maxRows}. */
  maxRows?: number;
};

/**
 * Builds an xlsx `Blob` from the grid's state without triggering a download — for server uploads
 * or inspecting the workbook before it leaves the browser. Values go through each column's cell
 * type `toText` like `exportGrid`; `xlsx` loads lazily.
 */
export async function buildXlsx(state: DataGridStoreState, options: BuildXlsxOptions = {}): Promise<Blob> {
  const { scope = "view", includeHeaders = true, workbookName = "Sheet1", maxRows } = options;
  const rows = capExportRows(buildExportRows(state, scope), maxRows);
  const table = includeHeaders ? [buildExportHeaders(state), ...rows] : rows;

  const XLSX = await import("xlsx");
  const worksheet = XLSX.utils.aoa_to_sheet(table);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, workbookName);
  const arrayBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return new Blob([arrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/**
 * Serializes the grid to CSV or XLSX and triggers a download. Values always go through each
 * column's cell type `toText` (never raw values), so clipboard/export fidelity matches. `xlsx` is
 * loaded lazily (dynamic `import("xlsx")`) so the dependency never loads for CSV-only consumers.
 */
export async function exportGrid(state: DataGridStoreState, options: ExportGridOptions): Promise<void> {
  const { format, scope = "view", includeHeaders = true, csvDelimiter = ",", csvBom = true, fileName = "export", workbookName, maxRows } = options;
  const rows = capExportRows(buildExportRows(state, scope), maxRows);
  const headers = buildExportHeaders(state);
  const table = includeHeaders ? [headers, ...rows] : rows;

  if (format === "csv") {
    const csv = (csvBom ? "\uFEFF" : "") + rowsToCsv(table, csvDelimiter);
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `${fileName}.csv`);
    return;
  }

  const blob = await buildXlsx(state, { scope, includeHeaders, workbookName, maxRows });
  downloadBlob(blob, `${fileName}.xlsx`);
}
