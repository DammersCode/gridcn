import Papa from "papaparse";

/** CSV delimiter choices exposed in the import dialog; `undefined` means auto-detect. */
export type CsvDelimiter = "," | ";" | "\t";

/** Options for {@link parseImportFile}. */
export type ParseImportFileOptions = {
  /** Overrides CSV delimiter auto-detection; ignored for xlsx/xls. */
  csvDelimiter?: CsvDelimiter;
};

/** Normalized parse result: a plain 2D grid of strings, header row (if any) included at `rows[0]`. */
export type ParsedImportFile = {
  rows: string[][];
  /** Delimiter actually used (auto-detected or overridden); undefined for xlsx/xls. */
  delimiter?: CsvDelimiter;
  /** Every sheet name in the workbook; `rows` came from `sheetNames[0]`. Undefined for CSV, or for a workbook with no sheets. */
  sheetNames?: string[];
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

/** Parses the first sheet of an xlsx/xls workbook into a 2D string grid via lazily-imported SheetJS; `sheetNames` lets the caller tell the user when a sheet besides the first was silently skipped. */
async function parseExcelFile(file: File): Promise<ParsedImportFile> {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = firstSheetName !== undefined ? workbook.Sheets[firstSheetName] : undefined;
  if (!sheet) return { rows: [] };
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" });
  return { rows: rows.map((row) => row.map((cell) => String(cell ?? ""))), sheetNames: workbook.SheetNames };
}

/**
 * Parses a `.csv`, `.tsv`, `.xlsx`, or `.xls` file into a normalized 2D string grid. CSV/TSV goes
 * through papaparse (delimiter auto-detect + override); Excel formats go through a
 * dynamically-imported SheetJS (`xlsx` never loads for CSV-only consumers), first sheet only.
 */
export async function parseImportFile(file: File, options: ParseImportFileOptions = {}): Promise<ParsedImportFile> {
  if (isExcelFile(file)) return parseExcelFile(file);
  if (isCsvFile(file)) return parseCsvText(await file.text(), options.csvDelimiter);
  throw new Error("unsupported-file-type");
}
