import Papa from "papaparse";
import type { CellValue } from "hucre";

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

/** Error message {@link parseImportFile} throws for an Excel file that is neither xlsx nor BIFF8 xls, e.g. an HTML table, Excel 2003 XML, or Excel 5.0/95. */
export const UNSUPPORTED_EXCEL_FORMAT_MESSAGE = "unsupported-excel-format";

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

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const OLE2_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0];

/** Largest xlsx part (worksheet, shared strings) that may be inflated; a bigger part is a zip bomb or far past the cell cap. */
const MAX_DECOMPRESSED_BYTES = 512 * 1024 * 1024;

function hasSignature(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

/**
 * The largest uncompressed size an entry declares in the zip's central directory; a ZIP64 directory
 * counts as unbounded. 0 when the directory is unreadable, so hucre reports the corruption itself.
 */
function largestDeclaredEntry(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lowest = Math.max(0, bytes.length - 22 - 0xffff);
  let end = bytes.length - 22;
  while (end >= lowest && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < lowest) return 0;
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  if (count === 0xffff || offset === 0xffffffff) return Infinity;
  let largest = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) return largest;
    largest = Math.max(largest, view.getUint32(offset + 24, true));
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  return largest;
}

type HucreReader = typeof import("./xlsx-reader");
type FormatValue = HucreReader["formatValue"];
type CellVisitor = (row: number, col: number, value: CellValue, numFmt: string | undefined) => void;

/** A date without a number format (xls, ISO cells): ISO date, plus the time when it is not midnight. */
function isoDateText(date: Date): string {
  if (Number.isNaN(date.getTime())) return "";
  const iso = date.toISOString();
  return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.slice(0, 19).replace("T", " ");
}

/** A cell's display text: its number format when it has one, else Excel's General rendering. */
function cellText(value: CellValue, numFmt: string | undefined, formatValue: FormatValue): string {
  if (value === null) return "";
  if (numFmt !== undefined && numFmt !== "General") return formatValue(value, numFmt);
  // 15 significant digits is Excel's precision: 0.1 + 0.2 shows as 0.3
  if (typeof value === "number") return String(Number(value.toPrecision(15)));
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return isoDateText(value);
  return value;
}

/** Builds the string grid from A1 to the last non-empty cell, after checking that box against the limits. */
function textGrid(forEachCell: (visit: CellVisitor) => void, limits: GridLimits, formatValue: FormatValue): string[][] {
  let rowCount = 0;
  let columnCount = 0;
  forEachCell((row, col, value) => {
    if (value === null) return;
    if (row >= rowCount) rowCount = row + 1;
    if (col >= columnCount) columnCount = col + 1;
  });
  assertWithinLimits(rowCount, columnCount, limits);
  const grid = Array.from({ length: rowCount }, () => new Array<string>(columnCount).fill(""));
  forEachCell((row, col, value, numFmt) => {
    if (value !== null) grid[row]![col] = cellText(value, numFmt, formatValue);
  });
  return grid;
}

/** Maps hucre's limit errors to gridcn's messages; hucre has no error codes, so its message text is matched. */
function importError(err: unknown, hucre: HucreReader): unknown {
  if (err instanceof hucre.ZipError && err.message.includes("exceeds limit")) return new Error(FILE_TOO_LARGE_MESSAGE, { cause: err });
  if (err instanceof hucre.ParseError) {
    if (/over the \d+ limit|more than \d+ filled cells/.test(err.message)) return new Error(IMPORT_TOO_MANY_CELLS_MESSAGE, { cause: err });
    if (err.message.startsWith("Unsupported XLS version")) return new Error(UNSUPPORTED_EXCEL_FORMAT_MESSAGE, { cause: err });
  }
  return err;
}

/** Reads the selected sheet of an xlsx workbook. Sparse mode keeps memory proportional to the real cells, whatever their box. */
async function readXlsxSheet(
  bytes: Uint8Array,
  sheetName: string | undefined,
  limits: GridLimits,
  { readXlsx, formatValue }: HucreReader,
): Promise<ParsedImportFile> {
  const sheetNames: string[] = [];
  const workbook = await readXlsx(bytes, {
    sheets: (info) => {
      sheetNames.push(info.name);
      return sheetName === undefined ? info.index === 0 : info.name === sheetName;
    },
    sparse: true,
    readStyles: true,
    maxDecompressedBytes: MAX_DECOMPRESSED_BYTES,
  });
  if (sheetName !== undefined && !sheetNames.includes(sheetName)) throw new Error(`unknown sheet "${sheetName}"`);
  const sheet = workbook.sheets[0];
  if (!sheet) return { rows: [], sheetNames, sheetName };
  const rows = textGrid(
    (visit) => {
      for (const [key, cell] of sheet.cells ?? []) {
        const comma = key.indexOf(",");
        visit(Number(key.slice(0, comma)), Number(key.slice(comma + 1)), cell.value, cell.style?.numFmt);
      }
    },
    limits,
    formatValue,
  );
  return { rows, sheetNames, sheetName: sheet.name };
}

/** Reads a BIFF8 `.xls` workbook; hucre parses every sheet, each bounded by `maxCells`, and returns values without number formats. */
async function readXlsSheet(
  bytes: Uint8Array,
  sheetName: string | undefined,
  limits: GridLimits,
  { readXls, formatValue }: HucreReader,
): Promise<ParsedImportFile> {
  const workbook = await readXls(bytes, { maxTotalCells: limits.maxCells });
  const sheetNames = workbook.sheets.map((sheet) => sheet.name);
  const selected = sheetName !== undefined ? sheetNames.indexOf(sheetName) : 0;
  if (selected === -1) throw new Error(`unknown sheet "${sheetName}"`);
  const sheet = workbook.sheets[selected];
  if (!sheet) return { rows: [], sheetNames, sheetName };
  const rows = textGrid((visit) => sheet.rows.forEach((row, r) => row.forEach((value, c) => visit(r, c, value, undefined))), limits, formatValue);
  return { rows, sheetNames, sheetName: sheet.name };
}

/** Parses one sheet of an xlsx/xls workbook into a 2D string grid via lazily-imported hucre; `sheetName` selects the sheet (first by default). The file's signature, not its extension, picks the reader. */
async function parseExcelFile(file: File, sheetName: string | undefined, limits: GridLimits, signal?: AbortSignal): Promise<ParsedImportFile> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (signal?.aborted) throw abortError();
  const isXlsx = hasSignature(bytes, ZIP_SIGNATURE);
  if (!isXlsx && !hasSignature(bytes, OLE2_SIGNATURE)) throw new Error(UNSUPPORTED_EXCEL_FORMAT_MESSAGE);
  // an entry declared past the cap makes hucre stream-parse up to the cap (about 15 s of CPU) before it fails
  if (isXlsx && largestDeclaredEntry(bytes) > MAX_DECOMPRESSED_BYTES) throw new Error(FILE_TOO_LARGE_MESSAGE);
  const hucre = await import("./xlsx-reader");
  try {
    return await (isXlsx ? readXlsxSheet : readXlsSheet)(bytes, sheetName, limits, hucre);
  } catch (err) {
    throw importError(err, hucre);
  }
}

/**
 * Parses a `.csv`, `.tsv`, `.xlsx`, or `.xls` file into a normalized 2D string grid. CSV/TSV goes
 * through papaparse (delimiter auto-detect + override); Excel formats go through a
 * dynamically-imported hucre (it never loads for CSV-only consumers), the `sheetName` sheet
 * or the first one. `.xls` means Excel 97-2003 (BIFF8); other `.xls` flavours reject. `signal`
 * aborts the file read when set; an aborted parse rejects with an AbortError.
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
