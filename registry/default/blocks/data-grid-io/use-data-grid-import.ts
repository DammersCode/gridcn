"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { parseImportFile, type CsvDelimiter, type ParsedImportFile } from "./parse-import-file";
import { applyImportOptions, type ImportTargetColumn, type ImportDefaults } from "./match-import-column";
import type { ImportColumnMapping } from "./build-imported-rows";

export type { ImportTargetColumn, ImportDefaults };

/** Rows shown in the preview table, capped for readability. */
export const IMPORT_PREVIEW_ROW_COUNT = 10;

/** Keys into `labels.io` for the parse-failure messages {@link useDataGridImportPreview} can surface. */
export type ImportErrorKey = "errorParseFailed" | "errorNoRows" | "errorUnsupportedFile";

/** Error thrown by {@link parseImportFile} for extensions outside csv/xlsx/xls. */
const UNSUPPORTED_FILE_TYPE_MESSAGE = "unsupported-file-type";

/** True when a parse was aborted (new file chosen, dialog closed) — the caller drops the result instead of surfacing an error. */
function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
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
  /** Re-parses the current CSV file with the given delimiter override; no-op for xlsx/xls files or before a file is loaded. */
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
};

/** Builds display headers: the file's header row when present, else `labels.io.columnFallback(N)`. */
function computeImportHeaders(rows: string[][], hasHeaderRow: boolean, columnFallback: (index: number) => string): string[] {
  const columnCount = rows[0]?.length ?? 0;
  if (hasHeaderRow && rows[0]) return rows[0];
  return Array.from({ length: columnCount }, (_, i) => columnFallback(i + 1));
}

/** Resolves the `csvDelimiter` override to parse with, given `ImportDefaults`; undefined means "let auto-detect run". */
function resolveDelimiterOverride(options: ImportDefaults): CsvDelimiter | undefined {
  if (options.autoDetectDelimiter === false) return options.defaultDelimiter ?? ",";
  return options.defaultDelimiter;
}

/**
 * Owns the parse -> preview -> column-mapping state for the import dialog. File I/O and header
 * matching are pure functions ({@link parseImportFile}, {@link applyImportOptions}); this hook only
 * sequences them and exposes editable dialog state (header-row toggle, delimiter, per-column mapping).
 *
 * @param columnFallback `labels.io.columnFallback` — builds the header shown for column N when the file has no header row.
 * @param options Consumer-configurable preselection defaults (see {@link ImportDefaults}); omit for today's behavior unchanged.
 */
export function useDataGridImportPreview(
  columnFallback: (index: number) => string,
  options: ImportDefaults = {},
): UseDataGridImportPreviewResult {
  const [preview, setPreview] = useState<ImportFileState | null>(null);
  const [error, setError] = useState<ImportErrorKey | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  // kept for delimiter-override re-parses, which need the original file + target columns again.
  const currentFileRef = useRef<File | null>(null);
  const gridColumnsRef = useRef<readonly ImportTargetColumn[]>([]);
  // aborts an in-flight file read when a newer load starts or the dialog resets.
  const parseControllerRef = useRef<AbortController | null>(null);
  // generation guard for async sheet re-parses: a newer sheet switch, file load, or reset must win over a slower older one.
  const sheetGenerationRef = useRef(0);
  const { defaultHeaderRow = true, defaultSkipColumns, mapColumn } = options;

  const reset = useCallback(() => {
    sheetGenerationRef.current += 1;
    parseControllerRef.current?.abort();
    setPreview(null);
    setError(null);
    setIsParsing(false);
    currentFileRef.current = null;
    gridColumnsRef.current = [];
  }, []);

  const loadFile = useCallback(async (file: File, gridColumns: readonly ImportTargetColumn[]) => {
    sheetGenerationRef.current += 1;
    parseControllerRef.current?.abort();
    const controller = new AbortController();
    parseControllerRef.current = controller;
    setError(null);
    setIsParsing(true);
    try {
      const parsed = await parseImportFile(file, { csvDelimiter: resolveDelimiterOverride(options) }, controller.signal);
      if (parsed.rows.length === 0) {
        setError("errorNoRows");
        setPreview(null);
        return;
      }
      currentFileRef.current = file;
      gridColumnsRef.current = gridColumns;
      const hasHeaderRow = defaultHeaderRow;
      const importHeaders = computeImportHeaders(parsed.rows, hasHeaderRow, columnFallback);
      const matched = applyImportOptions(importHeaders, gridColumns, { defaultSkipColumns, mapColumn });
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
      if (isAbortError(err)) return; // superseded by a newer file or a dialog reset
      const isUnsupportedType = err instanceof Error && err.message === UNSUPPORTED_FILE_TYPE_MESSAGE;
      setError(isUnsupportedType ? "errorUnsupportedFile" : "errorParseFailed");
      setPreview(null);
    } finally {
      setIsParsing(false);
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- destructured option fields are the real deps; `options` itself may be a fresh object each render.
  }, [columnFallback, defaultHeaderRow, defaultSkipColumns, mapColumn]);

  const setHasHeaderRow = useCallback(
    (hasHeaderRow: boolean) => {
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
    let parsed: ParsedImportFile;
    try {
      parsed = await parseImportFile(file, { csvDelimiter: delimiter }, parseControllerRef.current?.signal);
    } catch (err) {
      if (isAbortError(err)) return;
      throw err;
    }
    if (parsed.rows.length === 0) return;
      setPreview((prev) => {
        if (!prev) return prev;
        const importHeaders = computeImportHeaders(parsed.rows, prev.hasHeaderRow, columnFallback);
        const matched = applyImportOptions(importHeaders, gridColumnsRef.current, { defaultSkipColumns, mapColumn });
        return {
          ...prev,
          rows: parsed.rows,
          importHeaders,
          delimiter,
          mapping: matched.map((gridColumnId, importColumnIndex) => ({ importColumnIndex, gridColumnId })),
        };
      });
    },
    [columnFallback, defaultSkipColumns, mapColumn],
  );

  const setSheetName = useCallback(
    async (sheetName: string) => {
      const file = currentFileRef.current;
      if (!file) return;
      const generation = ++sheetGenerationRef.current;
      setError(null);
      setIsParsing(true);
      try {
        const parsed = await parseImportFile(file, { sheetName }, parseControllerRef.current?.signal);
        if (generation !== sheetGenerationRef.current) return; // superseded by a newer sheet switch, file load, or reset
        if (parsed.rows.length === 0) {
          // empty sheet: the picker keeps the chosen name honest, the preview clears, Import stays disabled
          setPreview((prev) =>
            prev ? { ...prev, rows: [], importHeaders: [], mapping: [], sheetName: parsed.sheetName ?? sheetName } : prev,
          );
          setError("errorNoRows");
          return;
        }
        setPreview((prev) => {
          if (!prev) return prev;
          const importHeaders = computeImportHeaders(parsed.rows, prev.hasHeaderRow, columnFallback);
          const matched = applyImportOptions(importHeaders, gridColumnsRef.current, { defaultSkipColumns, mapColumn });
          return {
            ...prev,
            rows: parsed.rows,
            importHeaders,
            sheetName: parsed.sheetName,
            mapping: matched.map((gridColumnId, importColumnIndex) => ({ importColumnIndex, gridColumnId })),
          };
        });
      } catch (err) {
        if (isAbortError(err)) return;
        if (generation === sheetGenerationRef.current) setError("errorParseFailed");
      } finally {
        if (generation === sheetGenerationRef.current) setIsParsing(false);
      }
    },
    [columnFallback, defaultSkipColumns, mapColumn],
  );

  const setMapping = useCallback((importColumnIndex: number, gridColumnId: string | null) => {
    setPreview((prev) => {
      if (!prev) return prev;
      const mapping = prev.mapping.map((m) => (m.importColumnIndex === importColumnIndex ? { ...m, gridColumnId } : m));
      return { ...prev, mapping };
    });
  }, []);

  const importRows = useMemo(() => {
    if (!preview) return [];
    return preview.hasHeaderRow ? preview.rows.slice(1) : preview.rows;
  }, [preview]);

  const previewRows = useMemo(() => importRows.slice(0, IMPORT_PREVIEW_ROW_COUNT), [importRows]);

  return { preview, error, isParsing, loadFile, setHasHeaderRow, setDelimiter, setSheetName, setMapping, reset, previewRows, importRows };
}
