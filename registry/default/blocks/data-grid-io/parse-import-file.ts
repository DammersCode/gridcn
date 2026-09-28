import Papa from "papaparse";

/** CSV delimiter choices exposed in the import dialog; `undefined` means auto-detect. */
export type CsvDelimiter = "," | ";" | "\t";

/**
 * Default bounds for every import. Unbounded parsing is a memory/CPU DoS vector: an xlsx with a
 * forged `<dimension>` element claims millions of cells from a tiny file. File size is checked
 * before the file is read; the SheetJS read is clamped to `maxRows`/`maxColumns`, and a CSV is
 * checked against the same row and column caps after the parse.
 */
export const DEFAULT_IMPORT_LIMITS = {
  /** Maximum file size in bytes; default 50 MB. */
  maxFileBytes: 50 * 1024 * 1024,
  /** Maximum rows, header row included; default 1,000,000. */
  maxRows: 1_000_000,
  /** Maximum columns; default 1,000. */
  maxColumns: 1_000,
} as const;

/** Error message {@link parseImportFile} throws for a file over `maxFileBytes`. */
export const FILE_TOO_LARGE_MESSAGE = "file-too-large";

/** Error message {@link parseImportFile} throws when the parsed grid exceeds `maxRows` or `maxColumns`. */
export const IMPORT_TOO_MANY_CELLS_MESSAGE = "import-too-many-cells";

/** Options for {@link parseImportFile}. */
export type ParseImportFileOptions = {
  /** Overrides CSV delimiter auto-detection; ignored for xlsx/xls. */
  csvDelimiter?: CsvDelimiter;
  /** For xlsx/xls: import this sheet by name instead of the first; rejects when the workbook has no sheet by that name. Ignored for CSV. */
  sheetName?: string;
  /** Reject files above this size (bytes) before the file is read; default 50 MB ({@link DEFAULT_IMPORT_LIMITS}). */
  maxFileBytes?: number;
  /** Maximum rows, header row included; the xlsx/xls read is clamped, CSV is checked after the parse; default 1,000,000. */
  maxRows?: number;
  /** Maximum columns; the xlsx/xls read is clamped, CSV is checked after the parse; default 1,000. */
  maxColumns?: number;
};

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
 * The sheet's actual cell extent (from cell keys, ignoring the forged `!ref`) clamped to the limits.
 * `sheet_to_json` fills `defval` for every cell inside `range` — a range wider than the real data
 * materializes the whole rectangle, so the range is never expanded past the real cells.
 */
function clampedSheetRange(sheet: Record<string, unknown>, maxRows: number, maxColumns: number): string | undefined {
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
  if (!hasCell) return undefined;
  const row = Math.min(maxRow + 1, maxRows);
  const col = Math.min(maxCol + 1, maxColumns);
  return `A1:${columnLetter(col - 1)}${row}`;
}

/** Parses one sheet of an xlsx/xls workbook into a 2D string grid via lazily-imported SheetJS; `sheetName` selects the sheet (first by default), and `sheetNames`/`sheetName` let the caller switch sheets later. `sheetRows` caps the read and the conversion `range` caps the columns, against a forged `<dimension>`. */
async function parseExcelFile(file: File, sheetName: string | undefined, limits: Required<Pick<ParseImportFileOptions, "maxRows" | "maxColumns">>, signal?: AbortSignal): Promise<ParsedImportFile> {
  const XLSX = await import("@e965/xlsx");
  const buffer = await file.arrayBuffer();
  if (signal?.aborted) throw abortError();
  const workbook = XLSX.read(buffer, { type: "array", sheetRows: limits.maxRows });
  const selected = sheetName !== undefined ? workbook.SheetNames.indexOf(sheetName) : 0;
  if (selected === -1) throw new Error(`unknown sheet "${sheetName}"`);
  const name = workbook.SheetNames[selected];
  const sheet = name !== undefined ? workbook.Sheets[name] : undefined;
  if (!sheet) return { rows: [], sheetNames: workbook.SheetNames, sheetName: name };
  // no real cells: skip the conversion — a forged !ref must not be fed to sheet_to_json
  const range = clampedSheetRange(sheet, limits.maxRows, limits.maxColumns);
  if (range === undefined) return { rows: [], sheetNames: workbook.SheetNames, sheetName: name };
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
  const limits = { maxRows: options.maxRows ?? DEFAULT_IMPORT_LIMITS.maxRows, maxColumns: options.maxColumns ?? DEFAULT_IMPORT_LIMITS.maxColumns };
  // before any file read: file.size is synchronous, so the DoS check costs nothing
  if (file.size > maxFileBytes) throw new Error(FILE_TOO_LARGE_MESSAGE);
  if (isExcelFile(file)) return parseExcelFile(file, options.sheetName, limits, signal);
  if (isCsvFile(file)) {
    const text = await file.text();
    if (signal?.aborted) throw abortError();
    const parsed = parseCsvText(text, options.csvDelimiter);
    if (parsed.rows.length > limits.maxRows) throw new Error(IMPORT_TOO_MANY_CELLS_MESSAGE);
    let maxColumns = 0;
    for (const row of parsed.rows) if (row.length > maxColumns) maxColumns = row.length;
    if (maxColumns > limits.maxColumns) throw new Error(IMPORT_TOO_MANY_CELLS_MESSAGE);
    return parsed;
  }
  throw new Error("unsupported-file-type");
}
