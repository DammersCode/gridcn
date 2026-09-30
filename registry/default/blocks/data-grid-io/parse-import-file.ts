import Papa from "papaparse";

/** CSV delimiter choices exposed in the import dialog; `undefined` means auto-detect. */
export type CsvDelimiter = "," | ";" | "\t";

/**
 * Default bounds for every import. Unbounded parsing is a memory/CPU DoS vector: a tiny xlsx with
 * two far-apart cells expands to millions of cells. File size is checked before the file is read;
 * the row, column, and cell caps are checked against the real cell extent before any conversion
 * (xlsx/xls) or right after the parse (CSV). A file over a cap is rejected, never truncated.
 */
export const DEFAULT_IMPORT_LIMITS = {
  /** Maximum file size in bytes; default 50 MB. */
  maxFileBytes: 50 * 1024 * 1024,
  /** Maximum rows, header row included; default 1,000,000. */
  maxRows: 1_000_000,
  /** Maximum columns; default 1,000. */
  maxColumns: 1_000,
  /** Maximum cells, counted as rows times columns of the imported rectangle; default 5,000,000. */
  maxCells: 5_000_000,
} as const;

/** Error message {@link parseImportFile} throws for a file over `maxFileBytes`. */
export const FILE_TOO_LARGE_MESSAGE = "file-too-large";

/** Error message {@link parseImportFile} throws when the grid exceeds `maxRows`, `maxColumns`, or `maxCells`. */
export const IMPORT_TOO_MANY_CELLS_MESSAGE = "import-too-many-cells";

/** Import bounds; each omitted field falls back to {@link DEFAULT_IMPORT_LIMITS}. A file over any bound is rejected, never truncated. */
export type ImportLimits = {
  /** Reject files above this size (bytes) before the file is read; default 50 MB. */
  maxFileBytes?: number;
  /** Maximum rows, header row included; default 1,000,000. */
  maxRows?: number;
  /** Maximum columns; default 1,000. */
  maxColumns?: number;
  /** Maximum rows times columns of the imported rectangle; default 5,000,000. */
  maxCells?: number;
};

/** Options for {@link parseImportFile}. */
export type ParseImportFileOptions = ImportLimits & {
  /** Overrides CSV delimiter auto-detection; ignored for xlsx/xls. */
  csvDelimiter?: CsvDelimiter;
  /** For xlsx/xls: import this sheet by name instead of the first; rejects when the workbook has no sheet by that name. Ignored for CSV. */
  sheetName?: string;
};

type GridLimits = Required<Pick<ImportLimits, "maxRows" | "maxColumns" | "maxCells">>;

/** Throws the too-many-cells error when a `rows` by `columns` rectangle breaks any cap. */
function assertWithinLimits(rows: number, columns: number, limits: GridLimits): void {
  if (rows > limits.maxRows || columns > limits.maxColumns || rows * columns > limits.maxCells) {
    throw new Error(IMPORT_TOO_MANY_CELLS_MESSAGE);
  }
}

/** Normalized parse result: a plain 2D grid of strings, header row (if any) included at `rows[0]`. */
export type ParsedImportFile = {
  rows: string[][];
  /** Delimiter actually used (auto-detected or overridden); undefined for xlsx/xls. */
  delimiter?: CsvDelimiter;
  /** Every sheet name in the workbook. Undefined for CSV, or for a workbook with no sheets. */
  sheetNames?: string[];
  /** The sheet `rows` came from — the `sheetName` option, or the first sheet. Undefined for CSV. */
  sheetName?: string;
};

function isCsvFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".csv") || name.endsWith(".tsv") || file.type === "text/csv" || file.type === "text/tab-separated-values";
}

function isExcelFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".xlsx") || name.endsWith(".xls");
}

/** Parses CSV text with papaparse; delimiter auto-detected unless `csvDelimiter` overrides it. */
function parseCsvText(text: string, csvDelimiter?: CsvDelimiter): ParsedImportFile {
  const result = Papa.parse<string[]>(text, { delimiter: csvDelimiter, skipEmptyLines: true });
  const rows = result.data.map((row) => row.map((cell) => cell ?? ""));
  const delimiter = (csvDelimiter ?? (result.meta.delimiter as CsvDelimiter | undefined)) || ",";
  return { rows, delimiter };
}

/** Aborts the file read; rejected parses surface as an AbortError the caller can ignore. */
function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

/** 0-based column index to an Excel column letter (0 → A, 25 → Z, 26 → AA). */
function columnLetter(index: number): string {
  let n = index;
  let letters = "";
  while (n >= 0) {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  }
  return letters;
}

/** A sheet cell key's column part ("AA") to a 0-based index. */
function columnToIndex(letters: string): number {
  let n = 0;
  for (const char of letters) n = n * 26 + (char.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * The rectangle from A1 to the sheet's last real cell (from cell keys, ignoring a forged `!ref`):
 * the exact area `sheet_to_json` fills with `defval`. `undefined` when the sheet has no cells.
 */
function realSheetExtent(sheet: Record<string, unknown>): { rows: number; columns: number } | undefined {
  let maxRow = 0;
  let maxCol = 0;
  let hasCell = false;
  for (const key in sheet) {
    if (key.startsWith("!")) continue; // metadata: !ref, !cols, !merges
    const match = /^([A-Z]+)(\d+)$/.exec(key);
    if (!match) continue;
    const col = columnToIndex(match[1] ?? "");
    const row = Number(match[2]) - 1;
    hasCell = true;
    if (row > maxRow) maxRow = row;
    if (col > maxCol) maxCol = col;
  }
  return hasCell ? { rows: maxRow + 1, columns: maxCol + 1 } : undefined;
}

/** Parses one sheet of an xlsx/xls workbook into a 2D string grid via lazily-imported SheetJS; `sheetName` selects the sheet (first by default), and `sheetNames`/`sheetName` let the caller switch sheets later. Only the selected sheet is parsed, and its real extent is checked against the limits before conversion. */
async function parseExcelFile(file: File, sheetName: string | undefined, limits: GridLimits, signal?: AbortSignal): Promise<ParsedImportFile> {
  const XLSX = await import("@e965/xlsx");
  const buffer = await file.arrayBuffer();
  if (signal?.aborted) throw abortError();
  // one row past the cap, so an oversized sheet shows up as a cell in row maxRows + 1
  const workbook = XLSX.read(buffer, { type: "array", sheetRows: limits.maxRows + 1, sheets: sheetName ?? 0 });
  const selected = sheetName !== undefined ? workbook.SheetNames.indexOf(sheetName) : 0;
  if (selected === -1) throw new Error(`unknown sheet "${sheetName}"`);
  const name = workbook.SheetNames[selected];
  const sheet = name !== undefined ? workbook.Sheets[name] : undefined;
  if (!sheet) return { rows: [], sheetNames: workbook.SheetNames, sheetName: name };
  // no real cells: skip the conversion — a forged !ref must not be fed to sheet_to_json
  const extent = realSheetExtent(sheet);
  if (extent === undefined) return { rows: [], sheetNames: workbook.SheetNames, sheetName: name };
  assertWithinLimits(extent.rows, extent.columns, limits);
  const range = `A1:${columnLetter(extent.columns - 1)}${extent.rows}`;
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "", range });
  return { rows: rows.map((row) => row.map((cell) => String(cell ?? ""))), sheetNames: workbook.SheetNames, sheetName: name };
}

/**
 * Parses a `.csv`, `.tsv`, `.xlsx`, or `.xls` file into a normalized 2D string grid. CSV/TSV goes
 * through papaparse (delimiter auto-detect + override); Excel formats go through a
 * dynamically-imported SheetJS (`xlsx` never loads for CSV-only consumers), the `sheetName` sheet
 * or the first one. `signal` aborts the file read when set; an aborted parse rejects with an
 * AbortError.
 */
export async function parseImportFile(file: File, options: ParseImportFileOptions = {}, signal?: AbortSignal): Promise<ParsedImportFile> {
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_IMPORT_LIMITS.maxFileBytes;
  const limits: GridLimits = {
    maxRows: options.maxRows ?? DEFAULT_IMPORT_LIMITS.maxRows,
    maxColumns: options.maxColumns ?? DEFAULT_IMPORT_LIMITS.maxColumns,
    maxCells: options.maxCells ?? DEFAULT_IMPORT_LIMITS.maxCells,
  };
  // before any file read: file.size is synchronous, so the DoS check costs nothing
  if (file.size > maxFileBytes) throw new Error(FILE_TOO_LARGE_MESSAGE);
  if (isExcelFile(file)) return parseExcelFile(file, options.sheetName, limits, signal);
  if (isCsvFile(file)) {
    const text = await file.text();
    if (signal?.aborted) throw abortError();
    const parsed = parseCsvText(text, options.csvDelimiter);
    let columns = 0;
    for (const row of parsed.rows) if (row.length > columns) columns = row.length;
    assertWithinLimits(parsed.rows.length, columns, limits);
    return parsed;
  }
  throw new Error("unsupported-file-type");
}
