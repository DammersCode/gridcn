import Papa from "papaparse";

/** CSV delimiter choices exposed in the import dialog; `undefined` means auto-detect. */
export type CsvDelimiter = "," | ";" | "\t";

/** Options for {@link parseImportFile}. */
export type ParseImportFileOptions = {
  /** Overrides CSV delimiter auto-detection; ignored for xlsx/xls. */
  csvDelimiter?: CsvDelimiter;
  /** For xlsx/xls: import this sheet by name instead of the first; rejects when the workbook has no sheet by that name. Ignored for CSV. */
  sheetName?: string;
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

/** Parses one sheet of an xlsx/xls workbook into a 2D string grid via lazily-imported SheetJS; `sheetName` selects the sheet (first by default), and `sheetNames`/`sheetName` let the caller switch sheets later. */
async function parseExcelFile(file: File, sheetName?: string): Promise<ParsedImportFile> {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const selected = sheetName !== undefined ? workbook.SheetNames.indexOf(sheetName) : 0;
  if (selected === -1) throw new Error(`unknown sheet "${sheetName}"`);
  const name = workbook.SheetNames[selected];
  const sheet = name !== undefined ? workbook.Sheets[name] : undefined;
  if (!sheet) return { rows: [] };
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" });
  return { rows: rows.map((row) => row.map((cell) => String(cell ?? ""))), sheetNames: workbook.SheetNames, sheetName: name };
}

/**
 * Parses a `.csv`, `.tsv`, `.xlsx`, or `.xls` file into a normalized 2D string grid. CSV/TSV goes
 * through papaparse (delimiter auto-detect + override); Excel formats go through a
 * dynamically-imported SheetJS (`xlsx` never loads for CSV-only consumers), the `sheetName` sheet
 * or the first one.
 */
export async function parseImportFile(file: File, options: ParseImportFileOptions = {}): Promise<ParsedImportFile> {
  if (isExcelFile(file)) return parseExcelFile(file, options.sheetName);
  if (isCsvFile(file)) return parseCsvText(await file.text(), options.csvDelimiter);
  throw new Error("unsupported-file-type");
}
