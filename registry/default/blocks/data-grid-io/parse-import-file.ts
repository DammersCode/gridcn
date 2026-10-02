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
  /** Maximum unpacked size of one xlsx part (a worksheet, the shared strings); default 256 MiB, and no more than `maxCells` times 10 bytes plus 1 MiB. */
  maxDecompressedBytes: 256 * 1024 * 1024,
} as const;

/** Error message {@link parseImportFile} throws for a file over `maxFileBytes`. */
export const FILE_TOO_LARGE_MESSAGE = "file-too-large";

/** Error message {@link parseImportFile} throws when one part of an xlsx file (a worksheet, the shared strings) unpacks to more than the part cap, a lower `maxDecompressedBytes` or `maxCells` times 10 bytes plus 1 MiB. */
export const PART_TOO_LARGE_MESSAGE = "part-too-large";

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
  /** Reject an xlsx whose parts (a worksheet, the shared strings) unpack to more than this many bytes; default 256 MiB, and no more than `maxCells` times 10 bytes plus 1 MiB. Stops zip bombs. */
  maxDecompressedBytes?: number;
};

/** Options for {@link parseImportFile}. */
export type ParseImportFileOptions = ImportLimits & {
  /** Overrides CSV delimiter auto-detection; ignored for xlsx/xls. */
  csvDelimiter?: CsvDelimiter;
  /** For xlsx/xls: import this sheet by name instead of the first; rejects when the workbook has no sheet by that name. Ignored for CSV. */
  sheetName?: string;
};

type GridLimits = Required<Pick<ImportLimits, "maxRows" | "maxColumns" | "maxCells">>;
type ExcelLimits = GridLimits & Required<Pick<ImportLimits, "maxDecompressedBytes">>;

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

/** Characters papaparse sees when it guesses the delimiter and the newline. */
const CSV_SAMPLE_CHARS = 1024 * 1024;

/** The newline papaparse would guess: whichever of `\n`, `\r\n`, or `\r` ends the first line. */
function detectNewline(sample: string): "\n" | "\r\n" | "\r" {
  const cr = sample.indexOf("\r");
  const lf = sample.indexOf("\n");
  if (cr === -1 || (lf !== -1 && lf < cr)) return "\n";
  return sample[cr + 1] === "\n" ? "\r\n" : "\r";
}

/**
 * Checks the rows and the widest row against the limits without building a field. The counts
 * are upper bounds of papaparse's: it leaves a quoted field only at a quote before a delimiter or newline.
 */
function assertCsvWithinLimits(text: string, delimiter: string, newline: string, limits: GridLimits): void {
  const delimiterCode = delimiter.charCodeAt(0);
  const newlineCode = newline.charCodeAt(0);
  let rows = 0;
  let columns = 0;
  let fields = 1;
  let lineLength = 0;
  let inQuotes = false;
  let fieldStart = true;
  const endLine = () => {
    if (lineLength > 0) {
      rows += 1;
      if (fields > columns) columns = fields;
      assertWithinLimits(rows, columns, limits);
    }
    fields = 1;
    lineLength = 0;
    fieldStart = true;
  };
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (inQuotes) {
      lineLength += 1;
      if (code !== 34) continue;
      if (text.charCodeAt(i + 1) === 34) i += 1;
      else inQuotes = false;
      continue;
    }
    if (code === newlineCode && text.startsWith(newline, i)) {
      endLine();
      i += newline.length - 1;
      continue;
    }
    lineLength += 1;
    if (code === delimiterCode) {
      fields += 1;
      if (fields > limits.maxColumns) assertWithinLimits(rows + 1, fields, limits);
      fieldStart = true;
      continue;
    }
    if (fieldStart && code === 34) inQuotes = true;
    fieldStart = false;
  }
  endLine();
}

/** Parses CSV text with papaparse; delimiter auto-detected unless `csvDelimiter` overrides it. The limits run before the parse, which builds a whole row at once. */
function parseCsvText(text: string, csvDelimiter: CsvDelimiter | undefined, limits: GridLimits): ParsedImportFile {
  const sample = text.slice(0, CSV_SAMPLE_CHARS);
  const newline = detectNewline(sample);
  const delimiter =
    csvDelimiter ?? ((Papa.parse<string[]>(sample, { preview: 10, newline, skipEmptyLines: true }).meta.delimiter as CsvDelimiter | undefined) || ",");
  assertCsvWithinLimits(text, delimiter, newline, limits);
  const result = Papa.parse<string[]>(text, { delimiter, newline, skipEmptyLines: true });
  return { rows: result.data.map((row) => row.map((cell) => cell ?? "")), delimiter };
}

/** Aborts the file read; rejected parses surface as an AbortError the caller can ignore. */
function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const OLE2_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0];

function hasSignature(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

/** The smallest cell hucre stores in a sparse read, a styled empty cell `<c s="0"/>`; each costs far more heap than XML. */
const SMALLEST_CELL_XML_BYTES = 10;

/** Room in one part for everything but cells: columns, merges, validations, formatting rules. */
const PART_OVERHEAD_BYTES = 1024 * 1024;

const UNREADABLE_ZIP_MESSAGE = "unreadable-zip";

const ZIP64_SENTINEL = 0xffffffff;

/** The largest unpacked size any one part of an xlsx may have: bounds the cells a part can hold. */
function partCap(limits: ExcelLimits): number {
  return Math.min(limits.maxDecompressedBytes, limits.maxCells * SMALLEST_CELL_XML_BYTES + PART_OVERHEAD_BYTES);
}

/**
 * Rejects a zip with any entry whose stored or declared size exceeds `cap`. Reads only the central directory,
 * and fails closed: an unreadable directory or a ZIP64 marker rejects. Hucre bounds what it inflates itself,
 * but not stored entries.
 */
function assertEntriesWithin(bytes: Uint8Array, cap: number): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lowest = Math.max(0, bytes.length - 22 - 0xffff);
  let end = bytes.length - 22;
  while (end >= lowest && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < lowest) throw new Error(UNREADABLE_ZIP_MESSAGE);
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  if (count === 0xffff || view.getUint32(end + 12, true) === ZIP64_SENTINEL || offset === ZIP64_SENTINEL) throw new Error(PART_TOO_LARGE_MESSAGE);
  for (let i = 0; i < count; i++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) throw new Error(UNREADABLE_ZIP_MESSAGE);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    if (compressedSize > cap || uncompressedSize > cap || compressedSize === ZIP64_SENTINEL || uncompressedSize === ZIP64_SENTINEL) throw new Error(PART_TOO_LARGE_MESSAGE);
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
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

/** Excel's own limit on a number format's length; hucre's format scanning grows quadratically past it. */
const MAX_NUMBER_FORMAT_LENGTH = 255;

/** A fraction denominator of four or more placeholders: hucre searches every denominator up to 10^n, about a second per cell at n = 9. */
const WIDE_FRACTION_DENOMINATOR = /\/[?#0]{4}/;

/** The format as hucre's fraction test sees it: conditions, colors, locales, and fill codes stripped, literals masked. */
function fractionView(numFmt: string): string {
  return numFmt
    .replace(/\[[<>=!]+-?\d+(?:\.\d+)?\]/g, "")
    .replace(/\[(?:Black|Blue|Cyan|Green|Magenta|Red|White|Yellow|Color\s*\d+)\]/gi, "")
    .replace(/\[\$[^\]]*\]/g, "")
    .replace(/[_*]./g, "")
    .replace(/"[^"]*"?|\\[\s\S]?/g, "\0");
}

function isSafeNumberFormat(numFmt: string): boolean {
  return numFmt.length <= MAX_NUMBER_FORMAT_LENGTH && !WIDE_FRACTION_DENOMINATOR.test(fractionView(numFmt));
}

/** The number format's rendering, or `undefined` when the format is unsafe or hucre cannot apply it. */
function formattedText(value: CellValue, numFmt: string | undefined, formatValue: FormatValue): string | undefined {
  if (numFmt === undefined || numFmt === "General" || !isSafeNumberFormat(numFmt)) return undefined;
  try {
    return formatValue(value, numFmt);
  } catch {
    return undefined;
  }
}

/** A cell's display text: its number format when it has a usable one, else Excel's General rendering. */
function cellText(value: CellValue, numFmt: string | undefined, formatValue: FormatValue): string {
  if (value === null) return "";
  const formatted = formattedText(value, numFmt, formatValue);
  if (formatted !== undefined) return formatted;
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
  if (err instanceof hucre.ZipError && err.message.includes("exceeds limit")) return new Error(PART_TOO_LARGE_MESSAGE, { cause: err });
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
  limits: ExcelLimits,
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
    maxDecompressedBytes: limits.maxDecompressedBytes,
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

const OLE2_END_OF_CHAIN = 0xfffffffe;
const OLE2_FREE_SECTOR = 0xffffffff;
const OLE2_SECTOR_SHIFTS = [9, 12];
const OLE2_MINI_SECTOR_SHIFT = 6;
const OLE2_DEFAULT_MINI_CUTOFF = 4096;
const OLE2_DIRECTORY_ENTRY_BYTES = 128;
const UNREADABLE_XLS_MESSAGE = "unreadable-xls";

/** Records a workbook may hold besides its cells: formats, styles, fonts, sheet metadata. */
const XLS_RECORD_SLACK = 100_000;

/** The most records an xls workbook may hold: hucre keeps about 300 bytes per record, so half a record per cell of `maxCells` stays near 0.8 GB at the defaults. */
function maxXlsRecords(maxCells: number): number {
  return maxCells / 2 + XLS_RECORD_SLACK;
}

type Ole2Entry = { name: string; type: number; start: number; size: number };

const unreadableXls = () => new Error(UNREADABLE_XLS_MESSAGE);

/**
 * The `Workbook` (or `Book`) stream of an OLE2 container, read the way hucre's reader reads it. Fails closed
 * wherever hucre would take a path the scan cannot follow: duplicate stream names, chain loops, sizes past the data.
 */
function readOle2Workbook(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 512) throw unreadableXls();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sectorShift = view.getUint16(30, true);
  if (!OLE2_SECTOR_SHIFTS.includes(sectorShift) || view.getUint16(32, true) !== OLE2_MINI_SECTOR_SHIFT) throw unreadableXls();
  const sectorSize = 1 << sectorShift;
  const miniSectorSize = 1 << OLE2_MINI_SECTOR_SHIFT;
  const fatSectorCount = view.getUint32(44, true);
  const miniCutoff = view.getUint32(56, true) || OLE2_DEFAULT_MINI_CUTOFF;
  const miniFatSectorCount = view.getUint32(64, true);
  const difatSectorCount = view.getUint32(72, true);
  const maxSectors = Math.floor(bytes.length / sectorSize) + 1;
  const sectorAt = (sector: number) => {
    const at = (sector + 1) * sectorSize;
    if (at + sectorSize > bytes.length) throw unreadableXls();
    return at;
  };
  const fatSectors: number[] = [];
  for (let i = 0; i < 109 && fatSectors.length < fatSectorCount; i++) {
    const sector = view.getUint32(76 + i * 4, true);
    if (sector === OLE2_FREE_SECTOR || sector === OLE2_END_OF_CHAIN) break;
    fatSectors.push(sector);
  }
  const difatLimit = Math.min(difatSectorCount, maxSectors);
  let difat = view.getUint32(68, true);
  for (let hops = 0; difat !== OLE2_END_OF_CHAIN && difat !== OLE2_FREE_SECTOR && difatLimit > 0 && hops < difatLimit + 1; hops++) {
    const at = sectorAt(difat);
    for (let i = 0; i < sectorSize / 4 - 1 && fatSectors.length < fatSectorCount; i++) {
      const sector = view.getUint32(at + i * 4, true);
      if (sector !== OLE2_FREE_SECTOR && sector !== OLE2_END_OF_CHAIN) fatSectors.push(sector);
    }
    difat = view.getUint32(at + sectorSize - 4, true);
  }
  if (fatSectors.length > maxSectors || new Set(fatSectors).size !== fatSectors.length) throw unreadableXls();
  const fat = new Uint32Array((fatSectors.length * sectorSize) / 4);
  fatSectors.forEach((sector, index) => {
    const at = sectorAt(sector);
    for (let i = 0; i < sectorSize / 4; i++) fat[(index * sectorSize) / 4 + i] = view.getUint32(at + i * 4, true);
  });

  let hopsLeft = fat.length;
  const walk = (start: number): number[] => {
    const sectors: number[] = [];
    for (let sector = start; sector !== OLE2_END_OF_CHAIN && sector !== OLE2_FREE_SECTOR; sector = fat[sector] ?? OLE2_END_OF_CHAIN) {
      if (--hopsLeft < 0) throw unreadableXls();
      sectorAt(sector);
      sectors.push(sector);
    }
    return sectors;
  };
  const readChain = (start: number): Uint8Array => {
    const sectors = walk(start);
    const out = new Uint8Array(sectors.length * sectorSize);
    sectors.forEach((sector, index) => out.set(bytes.subarray(sectorAt(sector), sectorAt(sector) + sectorSize), index * sectorSize));
    return out;
  };

  const directory = readChain(view.getUint32(48, true));
  const directoryView = new DataView(directory.buffer);
  const entries: Ole2Entry[] = [];
  for (let at = 0; at + OLE2_DIRECTORY_ENTRY_BYTES <= directory.length; at += OLE2_DIRECTORY_ENTRY_BYTES) {
    const type = directory[at + 66]!;
    if (type === 0) continue;
    const nameLength = directoryView.getUint16(at + 64, true);
    let name = "";
    for (let i = 0; i + 1 < nameLength; i += 2) {
      const code = directoryView.getUint16(at + i, true);
      if (code === 0) break;
      name += String.fromCharCode(code);
    }
    entries.push({ name, type, start: directoryView.getUint32(at + 116, true), size: directoryView.getUint32(at + 120, true) });
  }
  const root = entries.find((entry) => entry.type === 5);
  if (!root) throw unreadableXls();
  const streams = entries.filter((entry) => entry.type === 2);
  const workbooks = streams.filter((entry) => entry.name === "Workbook");
  const books = streams.filter((entry) => entry.name === "Book");
  if (workbooks.length > 1 || books.length > 1) throw unreadableXls();
  const workbook = workbooks[0] ?? books[0];
  if (!workbook) throw unreadableXls();
  if (streams.reduce((total, entry) => total + entry.size, 0) > bytes.length) throw unreadableXls();

  const miniStream = readChain(root.start).subarray(0, root.size);
  const miniFatBytes =
    miniFatSectorCount > 0 && view.getUint32(60, true) !== OLE2_END_OF_CHAIN ? readChain(view.getUint32(60, true)).subarray(0, miniFatSectorCount * sectorSize) : new Uint8Array(0);
  const miniFatView = new DataView(miniFatBytes.buffer, miniFatBytes.byteOffset, miniFatBytes.byteLength);
  const miniFatLength = Math.floor(miniFatBytes.length / 4);
  let workbookBytes: Uint8Array = new Uint8Array(0);
  for (const stream of streams) {
    if (stream.size < miniCutoff) {
      if (stream.size > miniStream.length) throw unreadableXls();
      if (stream !== workbook) continue;
      workbookBytes = new Uint8Array(stream.size);
      let filled = 0;
      for (let sector = stream.start, hops = 0; filled < stream.size; sector = miniFatView.getUint32(sector * 4, true), hops++) {
        if (hops > miniFatLength || sector >= miniFatLength || (sector + 1) * miniSectorSize > miniStream.length) throw unreadableXls();
        const chunk = miniStream.subarray(sector * miniSectorSize, (sector + 1) * miniSectorSize);
        workbookBytes.set(chunk.subarray(0, stream.size - filled), filled);
        filled += chunk.length;
      }
    } else if (stream === workbook) {
      workbookBytes = readChain(stream.start).subarray(0, stream.size);
    } else {
      walk(stream.start);
    }
  }
  return workbookBytes;
}

const BIFF_BOF = 0x809;
const BIFF_EOF = 0x0a;
const BIFF_BOUNDSHEET = 0x85;
const BIFF8_VERSION = 0x600;
const BIFF_CELL_RECORDS = new Set([0xfd, 0x27e, 0x203, 0x205, 0x204, 0x06]);
const BIFF_MULRK = 0xbd;
const BIFF_MULRK_CELL_BYTES = 6;

type BiffRecord = { id: number; data: number; length: number };

/** Walks the BIFF records from `offset`, as hucre's `parseRecords` does; a record cut short by the stream end keeps the bytes that exist. */
function* biffRecords(stream: Uint8Array, view: DataView, offset: number): Generator<BiffRecord, void> {
  for (let at = offset; at + 4 <= stream.length; ) {
    const id = view.getUint16(at, true);
    const length = view.getUint16(at + 2, true);
    const data = at + 4;
    yield { id, data, length: Math.min(length, stream.length - data) };
    if (id === 0 && length === 0) return;
    at = data + length;
  }
}

/** How many records hucre's `parseRecords` would build, counted without building them; stops at `cap + 1`. */
function biffRecordCount(stream: Uint8Array, view: DataView, cap: number): number {
  let count = 0;
  for (let at = 0; at + 4 <= stream.length && count <= cap; count++) {
    const length = view.getUint16(at + 2, true);
    if (length === 0 && view.getUint16(at, true) === 0) return count + 1;
    at += 4 + length;
  }
  return count;
}

/** The cells a worksheet substream spans, and where its records end; reads on from the record after `start`, as hucre does, and stops once the span passes `cap`. */
function biffSheetBox(stream: Uint8Array, view: DataView, start: number, cap: number): { cells: number; end: number } {
  let rows = 0;
  let columns = 0;
  let end = start;
  let atStart = true;
  for (const { id, data, length } of biffRecords(stream, view, start)) {
    end = data + length;
    if (atStart) {
      atStart = false;
      continue;
    }
    if (id === BIFF_EOF) break;
    const mulrk = id === BIFF_MULRK;
    if (length < 4 || !(mulrk || BIFF_CELL_RECORDS.has(id))) continue;
    let lastColumn = view.getUint16(data + 2, true);
    if (mulrk) {
      if (length < 6) continue;
      const cells = (length - 6) / BIFF_MULRK_CELL_BYTES;
      if (!Number.isInteger(cells)) throw unreadableXls();
      if (cells === 0) continue;
      lastColumn += cells - 1;
    }
    rows = Math.max(rows, view.getUint16(data, true) + 1);
    columns = Math.max(columns, lastColumn + 1);
    if (rows * columns > cap) break;
  }
  return { cells: rows * columns, end };
}

// hucre pads every sheet and builds one object per record; bound both before it runs.
function assertXlsWithinLimits(bytes: Uint8Array, limits: GridLimits): void {
  const stream = readOle2Workbook(bytes);
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  if (biffRecordCount(stream, view, maxXlsRecords(limits.maxCells)) > maxXlsRecords(limits.maxCells)) throw new Error(IMPORT_TOO_MANY_CELLS_MESSAGE);
  const sheetStarts: number[] = [];
  let atStart = true;
  for (const { id, data, length } of biffRecords(stream, view, 0)) {
    if (atStart) {
      if (id !== BIFF_BOF || (length >= 2 && view.getUint16(data, true) !== BIFF8_VERSION)) return;
      atStart = false;
      continue;
    }
    if (id === BIFF_EOF) break;
    if (id === BIFF_BOUNDSHEET && length >= 4) sheetStarts.push(view.getUint32(data, true));
  }
  const boxes = new Map<number, number>();
  let total = 0;
  let scanBudget = stream.length;
  for (const start of sheetStarts) {
    if (!boxes.has(start)) {
      const { cells, end } = biffSheetBox(stream, view, start, limits.maxCells);
      scanBudget -= end - start;
      if (scanBudget < 0) throw unreadableXls();
      boxes.set(start, cells);
    }
    total += boxes.get(start)!;
    if (total > limits.maxCells) throw new Error(IMPORT_TOO_MANY_CELLS_MESSAGE);
  }
}

/** Reads a BIFF8 `.xls` workbook; hucre parses every sheet, each bounded by `maxCells`, and returns values without number formats. */
async function readXlsSheet(
  bytes: Uint8Array,
  sheetName: string | undefined,
  limits: GridLimits,
  { readXls, formatValue }: HucreReader,
): Promise<ParsedImportFile> {
  assertXlsWithinLimits(bytes, limits);
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
async function parseExcelFile(file: File, sheetName: string | undefined, limits: ExcelLimits, signal?: AbortSignal): Promise<ParsedImportFile> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (signal?.aborted) throw abortError();
  const isXlsx = hasSignature(bytes, ZIP_SIGNATURE);
  if (!isXlsx && !hasSignature(bytes, OLE2_SIGNATURE)) throw new Error(UNSUPPORTED_EXCEL_FORMAT_MESSAGE);
  const parseLimits = isXlsx ? { ...limits, maxDecompressedBytes: partCap(limits) } : limits;
  if (isXlsx) assertEntriesWithin(bytes, parseLimits.maxDecompressedBytes);
  const hucre = await import("./xlsx-reader");
  try {
    return await (isXlsx ? readXlsxSheet : readXlsSheet)(bytes, sheetName, parseLimits, hucre);
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
  if (isExcelFile(file)) {
    const maxDecompressedBytes = options.maxDecompressedBytes ?? DEFAULT_IMPORT_LIMITS.maxDecompressedBytes;
    return parseExcelFile(file, options.sheetName, { ...limits, maxDecompressedBytes }, signal);
  }
  if (isCsvFile(file)) {
    const text = await file.text();
    if (signal?.aborted) throw abortError();
    const parsed = parseCsvText(text, options.csvDelimiter, limits);
    let columns = 0;
    for (const row of parsed.rows) if (row.length > columns) columns = row.length;
    assertWithinLimits(parsed.rows.length, columns, limits);
    return parsed;
  }
  throw new Error("unsupported-file-type");
}
