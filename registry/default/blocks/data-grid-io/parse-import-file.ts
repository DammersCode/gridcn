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
  /** Maximum unpacked size of one xlsx part (a worksheet, the shared strings); default 256 MiB. */
  maxDecompressedBytes: 256 * 1024 * 1024,
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
  /** Reject an xlsx whose parts (a worksheet, the shared strings) unpack to more than this many bytes; default 256 MiB. Stops zip bombs. */
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

/** The smallest real xlsx cell, `<c r="A1"><v>1</v></c>`; hucre's sparse read holds about 125 bytes per cell it finds. */
const MIN_CELL_XML_BYTES = 21;

/** Room in a worksheet part for everything but cells: columns, merges, validations, formatting rules. */
const WORKSHEET_OVERHEAD_BYTES = 1024 * 1024;

/** Largest declared size of a package part read to find the selected sheet's part. */
const MAX_PACKAGE_PART_BYTES = 16 * 1024 * 1024;

type ZipEntry = { method: number; compressedSize: number; size: number; localOffset: number };

type ZipDirectory = { entries: Map<string, ZipEntry>; largestPart: number };

/**
 * Reads the zip's central directory. A ZIP64 directory counts as unbounded; an unreadable one yields
 * no entries, so hucre reports the corruption itself.
 */
function readZipDirectory(bytes: Uint8Array): ZipDirectory {
  const directory: ZipDirectory = { entries: new Map(), largestPart: 0 };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lowest = Math.max(0, bytes.length - 22 - 0xffff);
  let end = bytes.length - 22;
  while (end >= lowest && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < lowest) return directory;
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  if (count === 0xffff || offset === 0xffffffff) return { entries: new Map(), largestPart: Infinity };
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) return directory;
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    directory.largestPart = Math.max(directory.largestPart, size);
    directory.entries.set(decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)), {
      method: view.getUint16(offset + 10, true),
      compressedSize: view.getUint32(offset + 20, true),
      size,
      localOffset: view.getUint32(offset + 42, true),
    });
    offset += 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  return directory;
}

function unresolvablePackage(): Error {
  return new Error(UNSUPPORTED_EXCEL_FORMAT_MESSAGE);
}

async function inflateWithin(data: Uint8Array, limit: number): Promise<Uint8Array> {
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(data as Uint8Array<ArrayBuffer>);
      controller.close();
    },
  });
  const reader = source.pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        await reader.cancel();
        throw new Error(FILE_TOO_LARGE_MESSAGE);
      }
      chunks.push(value);
    }
  } catch (err) {
    throw err instanceof Error && err.message === FILE_TOO_LARGE_MESSAGE ? err : unresolvablePackage();
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** Inflates one small package part; a part declaring or inflating past the limit is a zip bomb. */
async function readPackagePart(bytes: Uint8Array, directory: ZipDirectory, path: string): Promise<string> {
  const entry = directory.entries.get(path);
  if (!entry) throw unresolvablePackage();
  if (entry.size > MAX_PACKAGE_PART_BYTES) throw new Error(FILE_TOO_LARGE_MESSAGE);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (entry.localOffset + 30 > bytes.length || view.getUint32(entry.localOffset, true) !== 0x04034b50) throw unresolvablePackage();
  const dataStart = entry.localOffset + 30 + view.getUint16(entry.localOffset + 26, true) + view.getUint16(entry.localOffset + 28, true);
  const data = bytes.subarray(dataStart, dataStart + entry.compressedSize);
  let inflated: Uint8Array;
  if (entry.method === 0) inflated = data;
  else if (entry.method === 8) inflated = await inflateWithin(data, MAX_PACKAGE_PART_BYTES);
  else throw unresolvablePackage();
  const encoding = inflated[0] === 0xff && inflated[1] === 0xfe ? "utf-16le" : inflated[0] === 0xfe && inflated[1] === 0xff ? "utf-16be" : "utf-8";
  return new TextDecoder(encoding).decode(inflated);
}

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXmlEntities(text: string): string {
  return text.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi, (_, hex: string | undefined, decimal: string | undefined, name: string | undefined) =>
    name ? XML_ENTITIES[name.toLowerCase()]! : String.fromCodePoint(hex ? parseInt(hex, 16) : Number(decimal)),
  );
}

/** The attributes of every `<local ...>` element; comments and CDATA are dropped first, and quoted values may hold `>`. */
function elementAttributes(xml: string, local: string): Record<string, string>[] {
  const stripped = xml.replace(/<!--[\s\S]*?-->/g, "").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  const tag = new RegExp(`<(?:[\\w.-]+:)?${local}(?=[\\s/>])((?:[^>"']|"[^"]*"|'[^']*')*)>`, "g");
  return [...stripped.matchAll(tag)].map((match) => {
    const attributes: Record<string, string> = {};
    for (const attribute of match[1]!.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      attributes[attribute[1]!] = decodeXmlEntities(attribute[2] ?? attribute[3] ?? "");
    }
    return attributes;
  });
}

/** Resolves a relationship target against a base directory the way hucre does. */
function resolvePackagePath(baseDirectory: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = baseDirectory.split("/").filter(Boolean);
  for (const part of target.split("/").filter(Boolean)) {
    if (part === "..") parts.pop();
    else if (part !== ".") parts.push(part);
  }
  return parts.join("/");
}

function relationshipsOf(xml: string): { id: string; type: string; target: string }[] {
  return elementAttributes(xml, "Relationship").flatMap((attributes) =>
    attributes["Id"] && attributes["Type"] && attributes["Target"] ? [{ id: attributes["Id"], type: attributes["Type"], target: attributes["Target"] }] : [],
  );
}

/**
 * The directory entry of the worksheet part hucre reads for the selected sheet, found through the package
 * relationships as hucre finds it. `undefined` when hucre reads no worksheet: no such sheet, or a chart sheet.
 */
async function selectedSheetEntry(bytes: Uint8Array, directory: ZipDirectory, sheetName: string | undefined): Promise<ZipEntry | undefined> {
  if (directory.entries.size === 0) return undefined;
  const rootRelationship = relationshipsOf(await readPackagePart(bytes, directory, "_rels/.rels")).find((rel) => rel.type.endsWith("/officeDocument"));
  if (!rootRelationship) throw unresolvablePackage();
  const workbookPath = rootRelationship.target.startsWith("/") ? rootRelationship.target.slice(1) : rootRelationship.target;
  const slash = workbookPath.lastIndexOf("/");
  const workbookDirectory = slash === -1 ? "" : workbookPath.slice(0, slash);
  const relationshipsPath = workbookDirectory ? `${workbookDirectory}/_rels/${workbookPath.slice(slash + 1)}.rels` : `_rels/${workbookPath}.rels`;
  const sheets = elementAttributes(await readPackagePart(bytes, directory, workbookPath), "sheet");
  const selected = sheetName === undefined ? sheets[0] : sheets.find((sheet) => sheet["name"] === sheetName);
  if (!selected) return undefined;
  const relationshipId = selected["r:id"] ?? selected["R:id"] ?? Object.entries(selected).find(([key, value]) => key.endsWith(":id") && value.startsWith("rId"))?.[1];
  const relationship = relationshipsOf(await readPackagePart(bytes, directory, relationshipsPath)).find((rel) => rel.id === relationshipId);
  if (!relationship) throw unresolvablePackage();
  if (!relationship.type.endsWith("/worksheet")) return undefined;
  const entry = directory.entries.get(resolvePackagePath(workbookDirectory, relationship.target));
  if (!entry) throw unresolvablePackage();
  return entry;
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

function isSafeNumberFormat(numFmt: string): boolean {
  return numFmt.length <= MAX_NUMBER_FORMAT_LENGTH && !WIDE_FRACTION_DENOMINATOR.test(numFmt);
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
async function parseExcelFile(file: File, sheetName: string | undefined, limits: ExcelLimits, signal?: AbortSignal): Promise<ParsedImportFile> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (signal?.aborted) throw abortError();
  const isXlsx = hasSignature(bytes, ZIP_SIGNATURE);
  if (!isXlsx && !hasSignature(bytes, OLE2_SIGNATURE)) throw new Error(UNSUPPORTED_EXCEL_FORMAT_MESSAGE);
  if (isXlsx) {
    const directory = readZipDirectory(bytes);
    // an entry declared past the cap makes hucre stream-parse up to the cap (about 15 s of CPU) before it fails
    if (directory.largestPart > limits.maxDecompressedBytes) throw new Error(FILE_TOO_LARGE_MESSAGE);
    // a sparse read holds every real cell, so a worksheet that could hold more than maxCells is refused unread
    const sheetEntry = await selectedSheetEntry(bytes, directory, sheetName);
    if (sheetEntry && sheetEntry.size > limits.maxCells * MIN_CELL_XML_BYTES + WORKSHEET_OVERHEAD_BYTES) throw new Error(IMPORT_TOO_MANY_CELLS_MESSAGE);
  }
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
