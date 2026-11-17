"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FILE_TOO_LARGE_MESSAGE,
  IMPORT_TOO_MANY_CELLS_MESSAGE,
  PART_TOO_LARGE_MESSAGE,
  UNSUPPORTED_EXCEL_FORMAT_MESSAGE,
  assertImportRows,
  parseImportFile,
  resolveImportLimits,
  type CsvDelimiter,
  type ImportCsvEncoding,
  type ImportLimits,
  type ImportValueMode,
  type ParsedImportFile,
} from "./parse-import-file";
import { resolveImportMapping, type ImportTargetColumn, type ImportDefaults } from "./match-import-column";
import { runImportCheck, type CheckImport, type ImportCheck } from "./import-check";
import { buildImportedRows, IMPORT_CANCELLED_MESSAGE, type BuildImportedRowsOptions, type BuildImportedRowsResult, type ImportColumnMapping } from "./build-imported-rows";
import { DEFAULT_LABELS, type AnyCellType } from "@/registry/default/blocks/data-grid/data-grid";
import { isDev, isThenable, useOptionalDataGridColumnSource, useOptionalDataGridGateTracker, useOptionalDataGridLabels, type GateTracker } from "@/registry/default/blocks/data-grid/data-grid-sdk";

export type { ImportTargetColumn, ImportDefaults };

/** Rows shown in the preview table, capped for readability. */
export const IMPORT_PREVIEW_ROW_COUNT = 10;

/** Keys into `labels.io` for the parse-failure messages {@link useDataGridImportPreview} can surface. */
export type ImportErrorKey = "errorParseFailed" | "errorNoRows" | "errorUnsupportedFile" | "errorUnsupportedExcelFormat" | "errorFileTooLarge" | "errorPartTooLarge" | "errorTooManyCells";

/** Error thrown by {@link parseImportFile} for extensions outside csv/xlsx/xls. */
const UNSUPPORTED_FILE_TYPE_MESSAGE = "unsupported-file-type";

/** True when a parse was aborted (new file chosen, dialog closed) — the caller drops the result instead of surfacing an error. */
function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/** Maps a parse failure to its dialog error key; null for aborts the caller drops silently. */
export function importErrorKey(err: unknown): ImportErrorKey | null {
  if (isAbortError(err)) return null;
  if (err instanceof Error) {
    switch (err.message) {
      case UNSUPPORTED_FILE_TYPE_MESSAGE:
        return "errorUnsupportedFile";
      case UNSUPPORTED_EXCEL_FORMAT_MESSAGE:
        return "errorUnsupportedExcelFormat";
      case FILE_TOO_LARGE_MESSAGE:
        return "errorFileTooLarge";
      case PART_TOO_LARGE_MESSAGE:
        return "errorPartTooLarge";
      case IMPORT_TOO_MANY_CELLS_MESSAGE:
        return "errorTooManyCells";
    }
  }
  return "errorParseFailed";
}

/** Parsed-and-ready import state, once a file has been chosen and parsed successfully. */
export type ImportFileState = {
  fileName: string;
  /** All parsed rows, including the header row (if `hasHeaderRow`) at index 0. */
  rows: string[][];
  hasHeaderRow: boolean;
  /** Display header per column: the file's header row text, or `labels.io.columnFallback(N)` when there's no header row. */
  importHeaders: string[];
  mapping: ImportColumnMapping[];
  delimiter?: CsvDelimiter;
  /** Every sheet name in the workbook. Undefined for CSV. Lets a consumer offer a sheet picker when a workbook has more than one sheet. */
  sheetNames?: string[];
  /** The sheet `rows` came from (first by default, or the one selected via {@link UseDataGridImportPreviewResult.setSheetName}). Undefined for CSV. */
  sheetName?: string;
};

/** Return value of {@link useDataGridImportPreview}. */
export type UseDataGridImportPreviewResult = {
  preview: ImportFileState | null;
  error: ImportErrorKey | null;
  /** True while a file is being read/parsed. */
  isParsing: boolean;
  /** Parses `file`; on success populates `preview` with column mapping prefilled by header-text match. */
  loadFile: (file: File, gridColumns: readonly ImportTargetColumn[]) => Promise<void>;
  setHasHeaderRow: (hasHeaderRow: boolean) => void;
  /** Re-parses the current CSV file with the given delimiter override; no-op for xlsx/xls files or before a file is loaded. A failed re-parse sets `error` instead of throwing. */
  setDelimiter: (delimiter: CsvDelimiter) => Promise<void>;
  /**
   * Re-parses the current xlsx/xls workbook with the given sheet; no-op for CSV or before a file
   * is loaded. Switching sheets recomputes the column mapping from scratch (different headers), so
   * any manual mapping the user set on the previous sheet is discarded.
   */
  setSheetName: (sheetName: string) => Promise<void>;
  setMapping: (importColumnIndex: number, gridColumnId: string | null) => void;
  reset: () => void;
  /** Data rows only (header row excluded when `hasHeaderRow`), capped to `IMPORT_PREVIEW_ROW_COUNT` for the preview table. */
  previewRows: string[][];
  /** All data rows (header row excluded when `hasHeaderRow`) — the full set `onImport` will build from. */
  importRows: string[][];
  /**
   * Builds the `TData` rows from the current preview: `processImportRows` (when given), then
   * `buildImportedRows` with the current mapping. Returns `null` when `processImportRows` returned
   * `false` or there is no preview yet. A hook result outside the import limits rejects with the
   * too-many-cells error. Always returns a Promise.
   */
  build: <TData>(options: BuildImportOptions<TData>) => Promise<ImportBuildResult<TData> | null>;
};

/** Result of {@link UseDataGridImportPreviewResult.build}: with `checkImport`, `check` holds the read answer. */
export type ImportBuildResult<TData> = BuildImportedRowsResult<TData> & { check?: ImportCheck };

/** Builds display headers: the file's header row when present, else `labels.io.columnFallback(N)`. */
function computeImportHeaders(rows: string[][], hasHeaderRow: boolean, columnFallback: (index: number) => string): string[] {
  const columnCount = rows[0]?.length ?? 0;
  if (hasHeaderRow && rows[0]) return rows[0];
  return Array.from({ length: columnCount }, (_, i) => columnFallback(i + 1));
}

/** Options for {@link useDataGridImportPreview}. */
export type UseDataGridImportPreviewOptions = {
  /** Builds the header shown for column N when the file has no header row. Default: `labels.io.columnFallback` of the enclosing grid, else the built-in label. */
  columnFallback?: (index: number) => string;
  /** Preselection defaults (see {@link ImportDefaults}). */
  defaults?: ImportDefaults;
  /** Size, row, column, cell, and unpacked-size bounds for every parse; omitted fields use `DEFAULT_IMPORT_LIMITS`. */
  limits?: ImportLimits;
  /** Reads the file instead of the built-in parser, for every parse (file load, delimiter, sheet). A file over `maxFileBytes` is rejected before the hook runs. Its rows must be arrays of strings inside `limits`, which are checked after the hook. `csvEncoding` does not apply. */
  parseFile?: ParseFile;
  /** Decodes a CSV file with this `TextDecoder` label instead of UTF-8; see `IMPORT_CSV_ENCODINGS` for the accepted labels. */
  csvEncoding?: ImportCsvEncoding;
};

const MAX_SHEET_NAMES = 256;
const MAX_SHEET_NAME_CHARS = 255;

/** Up to {@link MAX_SHEET_NAMES} distinct strings from the first entries of `names`; a huge list is not scanned to the end. */
function uniqueSheetNames(names: readonly unknown[]): string[] {
  const unique = new Set<string>();
  const scanLimit = Math.min(names.length, MAX_SHEET_NAMES * 4);
  for (let index = 0; index < scanLimit && unique.size < MAX_SHEET_NAMES; index++) {
    const name = names[index];
    if (typeof name === "string") unique.add(name.slice(0, MAX_SHEET_NAME_CHARS));
  }
  return [...unique];
}

const CSV_DELIMITERS: readonly CsvDelimiter[] = [",", ";", "\t", "|"];

/** Keeps only the fields of a custom parse result that the dialog reads, and bounds the lists and strings in them. */
function sanitizeParsedFile(parsed: ParsedImportFile): ParsedImportFile {
  const delimiter = CSV_DELIMITERS.includes(parsed.delimiter as CsvDelimiter) ? parsed.delimiter : undefined;
  const sheetNames = Array.isArray(parsed.sheetNames) ? uniqueSheetNames(parsed.sheetNames) : undefined;
  const sheetName = typeof parsed.sheetName === "string" ? parsed.sheetName.slice(0, MAX_SHEET_NAME_CHARS) : undefined;
  return { rows: parsed.rows, delimiter, sheetNames, sheetName };
}

/** Replaces the built-in file parser; see {@link UseDataGridImportPreviewOptions.parseFile}. */
export type ParseFile = (
  file: File,
  ctx: { signal: AbortSignal; limits: Required<ImportLimits>; sheetName?: string; csvDelimiter?: CsvDelimiter; valueMode: ImportValueMode },
) => ParsedImportFile | Promise<ParsedImportFile>;

/** Rewrites or drops the data rows before they are mapped and built; see {@link UseDataGridImportPreviewResult.build}. */
export type ProcessImportRows = (ctx: {
  /** The data rows, header row excluded. */
  rows: string[][];
  /** The header text of each source column. */
  headers: string[];
  mapping: ImportColumnMapping[];
  signal: AbortSignal;
}) => string[][] | false | Promise<string[][] | false>;

/** Inputs of {@link UseDataGridImportPreviewResult.build} besides the file state the hook already holds. */
export type BuildImportOptions<TData> = Omit<BuildImportedRowsOptions<TData>, "dataRows" | "mapping" | "columns" | "cellTypes"> & {
  /** The columns the rows are built for. Default: the columns of the enclosing grid. */
  columns?: BuildImportedRowsOptions<TData>["columns"];
  /** The cell types that parse each cell. Default: the resolved cell types of the enclosing grid, which `useDataGridCellTypes()` returns. */
  cellTypes?: Record<string, AnyCellType>;
  /** Runs on the data rows before the mapping is applied. `false` cancels the import: `build()` resolves `null`. The result is checked against the import limits. */
  processImportRows?: ProcessImportRows;
  /** Checks the built rows on your server before they are saved; the answer lands in `result.check`. A throw or a rejection gives `{ status: "failed" }`. Absent: no check. */
  checkImport?: CheckImport<TData>;
};

type MappingGate = { signal: AbortSignal; arm: () => void; stop: () => void };

/** The `mapColumn` signal: aborts with `signal`, or through the grid's gate run (`gateTimeoutMs.mapColumn`) once {@link MappingGate.arm} holds it. */
function mappingGate(signal: AbortSignal, gates: GateTracker | null): MappingGate {
  const run = gates?.begin("mapColumn");
  return {
    signal: run ? AbortSignal.any([signal, run.signal]) : signal,
    arm: () => run && gates!.hold(run),
    stop: () => run && gates!.settle(run),
  };
}

/** Awaits a promised mapping until it settles or `gate` aborts; a rejected or timed-out `mapColumn` falls back to the built-in match so the dialog still opens. */
async function settleMapping(
  mapped: Promise<(string | null)[]>,
  fallback: () => (string | null)[],
  gate: MappingGate,
): Promise<(string | null)[]> {
  gate.arm();
  const aborted = new Promise<never>((_, reject) => gate.signal.addEventListener("abort", () => reject(gate.signal.reason), { once: true }));
  try {
    return await Promise.race([mapped, aborted]);
  } catch (error) {
    if (isDev() && !gate.signal.aborted) console.warn("[data-grid-io] mapColumn rejected, so the built-in column match is used", error);
    return fallback();
  } finally {
    gate.stop();
  }
}

/**
 * Owns the parse -> preview -> column-mapping state for the import dialog. File I/O and header
 * matching are pure functions ({@link parseImportFile}, {@link applyImportOptions}); this hook only
 * sequences them and exposes editable dialog state (header-row toggle, delimiter, per-column mapping).
 *
 */
export function useDataGridImportPreview(options: UseDataGridImportPreviewOptions = {}): UseDataGridImportPreviewResult {
  const gridLabels = useOptionalDataGridLabels();
  const grid = useOptionalDataGridColumnSource();
  const gates = useOptionalDataGridGateTracker();
  const mapGate = useCallback((signal: AbortSignal) => mappingGate(signal, gates), [gates]);
  const gridColumns = grid?.columns;
  const gridCellTypes = grid?.cellTypes;
  const labelsIo = (gridLabels ?? DEFAULT_LABELS).io;
  const columnFallback = options.columnFallback ?? labelsIo.columnFallback;
  const { defaults = {}, limits = {}, parseFile, csvEncoding } = options;
  const [preview, setPreview] = useState<ImportFileState | null>(null);
  const [error, setError] = useState<ImportErrorKey | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  // kept for delimiter-override re-parses, which need the original file + target columns again.
  const currentFileRef = useRef<File | null>(null);
  const gridColumnsRef = useRef<readonly ImportTargetColumn[]>([]);
  // aborts an in-flight file read when a newer load starts or the dialog resets.
  const parseControllerRef = useRef<AbortController | null>(null);
  // generation guard for every async parse (file load, sheet switch, delimiter override): a newer parse or reset wins over a slower older one.
  const parseGenerationRef = useRef(0);
  const { defaultHeaderRow = true, defaultSkipColumns, mapColumn } = defaults;
  const valueMode: ImportValueMode = defaults.valueMode === "raw" ? "raw" : "formatted";
  const headerRowIndex = typeof defaultHeaderRow === "number" ? Math.max(0, Math.floor(defaultHeaderRow) || 0) : 0;
  const initialHasHeaderRow = defaultHeaderRow !== false;
  // the header-row toggle as the async mapping steps read it; they cannot read a state updater's `prev`.
  const hasHeaderRowRef = useRef(initialHasHeaderRow);
  const parseFileRef = useRef(parseFile);
  useEffect(() => {
    parseFileRef.current = parseFile;
  });
  const { maxFileBytes, maxRows, maxColumns, maxCells, maxDecompressedBytes } = limits;
  const limitOptions = useMemo(
    () => ({ maxFileBytes, maxRows, maxColumns, maxCells, maxDecompressedBytes }),
    [maxFileBytes, maxRows, maxColumns, maxCells, maxDecompressedBytes],
  );

  useEffect(
    () => () => {
      parseGenerationRef.current += 1;
      parseControllerRef.current?.abort();
    },
    [],
  );

  const startParse = useCallback((): { generation: number; controller: AbortController } => {
    const generation = ++parseGenerationRef.current;
    parseControllerRef.current?.abort();
    const controller = new AbortController();
    parseControllerRef.current = controller;
    return { generation, controller };
  }, []);

  const effectiveLimits = useMemo<Required<ImportLimits>>(
    () => resolveImportLimits({ maxFileBytes, maxRows, maxColumns, maxCells, maxDecompressedBytes }),
    [maxFileBytes, maxRows, maxColumns, maxCells, maxDecompressedBytes],
  );

  /** One parse: the consumer's `parseFile` (its result checked against the limits) or the built-in parser; rows above the header-row index are dropped. */
  const parse = useCallback(
    async (file: File, extra: { sheetName?: string; csvDelimiter?: CsvDelimiter }, signal?: AbortSignal): Promise<ParsedImportFile> => {
      const custom = parseFileRef.current;
      let parsed: ParsedImportFile;
      if (custom) {
        if (file.size > effectiveLimits.maxFileBytes) throw new Error(FILE_TOO_LARGE_MESSAGE);
        const checked = await custom(file, { signal: signal ?? new AbortController().signal, limits: effectiveLimits, valueMode, ...extra });
        if (typeof checked !== "object" || checked === null) throw new Error("invalid-import-rows");
        assertImportRows(checked.rows, effectiveLimits);
        parsed = sanitizeParsedFile(checked);
      } else {
        parsed = await parseImportFile(file, { ...limitOptions, csvEncoding, valueMode, ...extra, signal });
      }
      return headerRowIndex > 0 ? { ...parsed, rows: parsed.rows.slice(headerRowIndex) } : parsed;
    },
    [effectiveLimits, limitOptions, csvEncoding, headerRowIndex, valueMode],
  );

  const reset = useCallback(() => {
    parseGenerationRef.current += 1;
    parseControllerRef.current?.abort();
    setPreview(null);
    setError(null);
    setIsParsing(false);
    currentFileRef.current = null;
    gridColumnsRef.current = [];
  }, []);

  const loadFile = useCallback(async (file: File, gridColumns: readonly ImportTargetColumn[]) => {
    // a re-parse started while this file loads has no file to re-parse, so it cannot outlive this load
    currentFileRef.current = null;
    const { generation, controller } = startParse();
    setError(null);
    setIsParsing(true);
    try {
      const parsed = await parse(file, { csvDelimiter: defaults.defaultDelimiter }, controller.signal);
      if (generation !== parseGenerationRef.current) return; // superseded by a newer file load or a reset
      if (parsed.rows.length === 0) {
        setError("errorNoRows");
        setPreview(null);
        return;
      }
      currentFileRef.current = file;
      gridColumnsRef.current = gridColumns;
      const hasHeaderRow = initialHasHeaderRow;
      hasHeaderRowRef.current = hasHeaderRow;
      const importHeaders = computeImportHeaders(parsed.rows, hasHeaderRow, columnFallback);
      const gate = mapGate(controller.signal);
      const mapped = resolveImportMapping(importHeaders, gridColumns, { defaultSkipColumns, mapColumn, signal: gate.signal });
      const matched = isThenable(mapped)
        ? await settleMapping(mapped, () => resolveImportMapping(importHeaders, gridColumns, { defaultSkipColumns }) as (string | null)[], gate)
        : (gate.stop(), mapped);
      if (generation !== parseGenerationRef.current) return; // superseded while mapColumn was pending
      setPreview({
        fileName: file.name,
        rows: parsed.rows,
        hasHeaderRow,
        importHeaders,
        mapping: matched.map((gridColumnId, importColumnIndex) => ({ importColumnIndex, gridColumnId })),
        delimiter: parsed.delimiter,
        sheetNames: parsed.sheetNames,
        sheetName: parsed.sheetName,
      });
    } catch (err) {
      const key = importErrorKey(err);
      if (key === null || generation !== parseGenerationRef.current) return; // superseded by a newer file or a dialog reset
      setError(key);
      setPreview(null);
    } finally {
      // a superseded (aborted) load must not clear the newer load's parsing state
      if (parseControllerRef.current === controller) setIsParsing(false);
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- destructured option fields are the real deps; `defaults` itself may be a fresh object each render.
  }, [columnFallback, initialHasHeaderRow, defaultSkipColumns, mapColumn, mapGate, parse, startParse]);

  const mapForReparse = useCallback(
    (importHeaders: readonly string[], signal: AbortSignal): (string | null)[] | Promise<(string | null)[]> => {
      const gridColumns = gridColumnsRef.current;
      const gate = mapGate(signal);
      const mapped = resolveImportMapping(importHeaders, gridColumns, { defaultSkipColumns, mapColumn, signal: gate.signal });
      return isThenable(mapped)
        ? settleMapping(mapped, () => resolveImportMapping(importHeaders, gridColumns, { defaultSkipColumns }) as (string | null)[], gate)
        : (gate.stop(), mapped);
    },
    [defaultSkipColumns, mapColumn, mapGate],
  );

  const setHasHeaderRow = useCallback(
    (hasHeaderRow: boolean) => {
      hasHeaderRowRef.current = hasHeaderRow;
      setPreview((prev) => {
        if (!prev) return prev;
        const importHeaders = computeImportHeaders(prev.rows, hasHeaderRow, columnFallback);
        return { ...prev, hasHeaderRow, importHeaders };
      });
    },
    [columnFallback],
  );

  const setDelimiter = useCallback(
    async (delimiter: CsvDelimiter) => {
      const file = currentFileRef.current;
      if (!file) return;
      const { generation, controller } = startParse();
      setError(null);
      setIsParsing(true);
      try {
        const parsed = await parse(file, { csvDelimiter: delimiter }, controller.signal);
        if (generation !== parseGenerationRef.current) return; // superseded by a newer file load, sheet switch, or reset
        if (parsed.rows.length === 0) return;
        const importHeaders = computeImportHeaders(parsed.rows, hasHeaderRowRef.current, columnFallback);
        const mappedHeaders = mapForReparse(importHeaders, controller.signal);
        const matched = isThenable(mappedHeaders) ? await mappedHeaders : mappedHeaders;
        if (generation !== parseGenerationRef.current) return; // superseded while mapColumn was pending
        setPreview((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            rows: parsed.rows,
            importHeaders,
            delimiter,
            mapping: matched.map((gridColumnId, importColumnIndex) => ({ importColumnIndex, gridColumnId })),
          };
        });
      } catch (err) {
        const key = importErrorKey(err);
        if (key === null) return;
        if (generation === parseGenerationRef.current) setError(key);
      } finally {
        if (generation === parseGenerationRef.current) setIsParsing(false);
      }
    },
    [columnFallback, mapForReparse, parse, startParse],
  );

  const setSheetName = useCallback(
    async (sheetName: string) => {
      const file = currentFileRef.current;
      if (!file) return;
      const { generation, controller } = startParse();
      setError(null);
      setIsParsing(true);
      try {
        const parsed = await parse(file, { sheetName }, controller.signal);
        if (generation !== parseGenerationRef.current) return; // superseded by a newer sheet switch, file load, or reset
        if (parsed.rows.length === 0) {
          // empty sheet: the picker keeps the chosen name honest, the preview clears, Import stays disabled
          setPreview((prev) =>
            prev ? { ...prev, rows: [], importHeaders: [], mapping: [], sheetName: parsed.sheetName ?? sheetName } : prev,
          );
          setError("errorNoRows");
          return;
        }
        const importHeaders = computeImportHeaders(parsed.rows, hasHeaderRowRef.current, columnFallback);
        const mappedHeaders = mapForReparse(importHeaders, controller.signal);
        const matched = isThenable(mappedHeaders) ? await mappedHeaders : mappedHeaders;
        if (generation !== parseGenerationRef.current) return; // superseded while mapColumn was pending
        setPreview((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            rows: parsed.rows,
            importHeaders,
            sheetName: parsed.sheetName,
            mapping: matched.map((gridColumnId, importColumnIndex) => ({ importColumnIndex, gridColumnId })),
          };
        });
      } catch (err) {
        const key = importErrorKey(err);
        if (key === null) return;
        if (generation === parseGenerationRef.current) setError(key);
      } finally {
        if (generation === parseGenerationRef.current) setIsParsing(false);
      }
    },
    [columnFallback, mapForReparse, parse, startParse],
  );

  const setMapping = useCallback((importColumnIndex: number, gridColumnId: string | null) => {
    setPreview((prev) => {
      if (!prev) return prev;
      const mapping = prev.mapping.map((m) =>
        m.importColumnIndex === importColumnIndex ? { ...m, gridColumnId } : gridColumnId !== null && m.gridColumnId === gridColumnId ? { ...m, gridColumnId: null } : m,
      );
      return { ...prev, mapping };
    });
  }, []);

  const importRows = useMemo(() => {
    if (!preview) return [];
    return preview.hasHeaderRow ? preview.rows.slice(1) : preview.rows;
  }, [preview]);

  const previewRows = useMemo(() => importRows.slice(0, IMPORT_PREVIEW_ROW_COUNT), [importRows]);

  const warnedNoPreviewRef = useRef(false);
  const build = useCallback(
    async <TData,>(buildOptions: BuildImportOptions<TData>): Promise<ImportBuildResult<TData> | null> => {
      if (!preview) {
        if (isDev() && !warnedNoPreviewRef.current) {
          warnedNoPreviewRef.current = true;
          console.warn("[data-grid-io] build() ran before a file was loaded and returns null; call loadFile() first");
        }
        return null;
      }
      const { processImportRows, checkImport, columns, cellTypes, ...rest } = buildOptions;
      if (!(columns && cellTypes) && !gridColumns && isDev()) console.warn("[data-grid-io] build() found no grid; pass `columns` and `cellTypes` or call it under a DataGridProvider");
      const signal = rest.signal ?? new AbortController().signal;
      const buildColumns = columns ?? ((gridColumns ?? []) as BuildImportedRowsOptions<TData>["columns"]);
      const finish = async (dataRows: string[][]): Promise<ImportBuildResult<TData>> => {
        const built = await buildImportedRows<TData>({
          ...rest,
          columns: buildColumns,
          cellTypes: (cellTypes ?? gridCellTypes ?? {}) as BuildImportedRowsOptions<TData>["cellTypes"],
          signal: rest.signal,
          dataRows,
          mapping: preview.mapping,
        });
        if (!checkImport) return built;
        const ctx = { signal, mapping: preview.mapping, fileName: preview.fileName, sheetName: preview.sheetName, rejected: built.rejected };
        const check = await runImportCheck(checkImport, built.rows, ctx, new Set(buildColumns.map((column) => column.id)));
        if (signal.aborted) throw new Error(IMPORT_CANCELLED_MESSAGE);
        return { ...built, check };
      };
      if (!processImportRows) return finish(importRows);
      const hooked = processImportRows({ rows: importRows, headers: preview.importHeaders, mapping: preview.mapping, signal });
      const accept = (result: string[][] | false): ImportBuildResult<TData> | null | Promise<ImportBuildResult<TData>> => {
        if (signal.aborted) throw new Error(IMPORT_CANCELLED_MESSAGE);
        if (result === false) return null;
        assertImportRows(result, effectiveLimits, preview.hasHeaderRow ? 1 : 0);
        return finish(result);
      };
      return isThenable(hooked) ? Promise.resolve(hooked).then(accept) : accept(hooked);
    },
    [preview, importRows, effectiveLimits, gridColumns, gridCellTypes],
  );

  return { preview, error, isParsing, loadFile, setHasHeaderRow, setDelimiter, setSheetName, setMapping, reset, previewRows, importRows, build };
}
