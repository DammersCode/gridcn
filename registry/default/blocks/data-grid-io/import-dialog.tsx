"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Paperclip, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDataGridActions, useDataGridAllColumns, useDataGridLabels, type GateContext } from "@/registry/default/blocks/data-grid/data-grid";
import { columnLabelText, isDev, useDataGridFlaggedCommit, useDataGridMarkGatePending, useDataGridStoreApi } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { IMPORT_CANCELLED_MESSAGE, type ImportColumnMapping, type ImportRejectedCell, type ProcessCellFromText } from "./build-imported-rows";
import { importErrorKey, useDataGridImportPreview, type ImportTargetColumn, type ImportDefaults, type ParseFile, type ProcessImportRows, type ImportErrorKey } from "./use-data-grid-import";
import { DEFAULT_IMPORT_LIMITS, type CsvDelimiter, type ImportLimits } from "./parse-import-file";
import { Dropzone, DropzoneEmptyState, type DropzoneAccept, type DropzoneRejection } from "@/registry/default/blocks/dropzone/dropzone";

/** Accepted import file types, shared by the file input and the {@link Dropzone}. */
const IMPORT_ACCEPT: DropzoneAccept = {
  "text/csv": [".csv"],
  "text/tab-separated-values": [".tsv"],
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
};

export type { ImportDefaults };

const DELIMITER_OPTIONS: { value: CsvDelimiter; labelKey: "delimiterComma" | "delimiterSemicolon" | "delimiterTab" }[] = [
  { value: ",", labelKey: "delimiterComma" },
  { value: ";", labelKey: "delimiterSemicolon" },
  { value: "\t", labelKey: "delimiterTab" },
];

/** Mapping-select value for a source column that maps to no grid column. */
const SKIP_VALUE = "__skip__";

/** What `onImport` receives beside the rows. */
export type ImportContext = {
  /** Aborts when the user cancels or the dialog closes. Pass it to your request. */
  signal: AbortSignal;
  /** Cells whose value failed `column.validate`; each was cleared and its row is in `rows`. */
  rejected: readonly ImportRejectedCell[];
  /** Cells of `validationMode: "warn"` columns whose value failed `validate`; each keeps its value in `rows`. The default append flags them in `cellErrors`. */
  flagged: readonly ImportRejectedCell[];
  fileName: string;
  /** The sheet the rows came from; undefined for CSV. */
  sheetName?: string;
  /** Which file column went to which grid column. */
  mapping: readonly ImportColumnMapping[];
};

/** The file facts `onImport` gets, taken when the user confirms. */
type ImportSource = Pick<ImportContext, "fileName" | "sheetName" | "mapping">;

/** Maximum characters of an `onImport` error message the dialog shows. */
const MAX_ERROR_MESSAGE_LENGTH = 200;

/** Props for {@link DataGridImportDialog}. */
export type DataGridImportDialogProps<TData> = {
  /** Merges into the dialog content, which is `max-h-[80vh]` and `sm:max-w-2xl` by default. */
  className?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Builds a fresh row for import row `index`; required. */
  createRow: (index: number, ctx: GateContext) => TData | Promise<TData>;
  /** Called with the fully-built rows on confirm; the consumer decides how to merge (replace, upsert, or a server call). Default: appends the rows to `data` as one undoable `"import"` change. A grid with `totalRowCount` holds a window of its result, so it has no default and needs this prop. Cells rejected by `validate` are already cleared in these rows. May be async (e.g. a server upsert) — the dialog stays pending until it settles and surfaces a rejection instead of closing. `ctx.signal` aborts when the user cancels or the dialog closes; pass it to your request. */
  onImport?: (rows: TData[], ctx: ImportContext) => void | Promise<void>;
  /** Called once when `onImport` rejects, with the rejection. The dialog stays open. */
  onImportError?: (error: unknown) => void;
  /** Consumer-configurable preselection defaults (delimiter, header row, skip columns, mapping). Omit to keep the built-in detection. */
  importDefaults?: ImportDefaults;
  /** Size, row, column, cell, and unpacked-size bounds for the file; omitted fields use `DEFAULT_IMPORT_LIMITS`. `maxFileBytes` also sets the drop zone's `maxSize`. */
  importLimits?: ImportLimits;
  /** Reads the file instead of the built-in parser. Its rows are checked against `importLimits` afterwards. */
  parseFile?: ParseFile;
  /** File types the drop zone accepts; default csv, tsv, xls, and xlsx. Pair it with `parseFile` for other types. */
  accept?: DropzoneAccept;
  /** Decodes a CSV file with this `TextDecoder` label instead of UTF-8. A label outside `IMPORT_CSV_ENCODINGS` shows `labels.io.errorParseFailed`. */
  csvEncoding?: string;
  /** Rewrites or drops the data rows before they are mapped. `false` cancels the import quietly. The result is checked against `importLimits`. */
  processImportRows?: ProcessImportRows;
  /** Parses one cell instead of the column's `fromText`. Default: the grid's `processCellFromClipboard`, then `fromText`. The value still passes `column.validate`. */
  processCellFromText?: ProcessCellFromText<TData>;
  /** A file to load when the dialog opens, as if the user had chosen it. */
  file?: File;
};

/**
 * File-picker -> preview -> column-mapping -> confirm dialog. Parses via
 * {@link useDataGridImportPreview}, builds `TData` rows via {@link buildImportedRows} through each mapped
 * column's cell-type `fromText` + `validate`, then hands the rows to `onImport`. Without `onImport` it
 * appends them through `commitChange`; a replace or a server call passes `onImport`. A cell that
 * fails `validate` is cleared (via its cell type's `clearValue()`), not dropped as a row; the
 * rejected cells are listed in {@link buildImportedRows}'s `rejected` result.
 */
export function DataGridImportDialog<TData>(props: DataGridImportDialogProps<TData>): ReactNode {
  const { open, onOpenChange, createRow, onImport, onImportError, importDefaults, importLimits, parseFile, accept = IMPORT_ACCEPT, csvEncoding, processImportRows, processCellFromText, file, className } = props;
  const maxFileBytes = importLimits?.maxFileBytes ?? DEFAULT_IMPORT_LIMITS.maxFileBytes;
  const labels = useDataGridLabels();
  const actions = useDataGridActions();
  const storeApi = useDataGridStoreApi();
  const commitWithFlags = useDataGridFlaggedCommit();
  const allColumns = useDataGridAllColumns<TData>();
  const [isValidating, setIsValidating] = useState(false);
  /** Generation guard for a held async import: a newer confirm, or closing the dialog, drops the older batch. */
  const confirmTokenRef = useRef(0);
  /** Aborts the in-flight chunked build (large sync imports and async-schema imports alike) when Cancel is clicked or the dialog closes. */
  const abortControllerRef = useRef<AbortController | null>(null);
  const headerRowId = useId();
  const { preview, error, isParsing, loadFile, setHasHeaderRow, setDelimiter, setSheetName, setMapping, reset, previewRows, importRows, build } =
    useDataGridImportPreview({ columnFallback: labels.io.columnFallback, defaults: importDefaults, limits: importLimits, parseFile, csvEncoding });
  useDataGridMarkGatePending("import", isParsing || isValidating);
  // Base UI's SelectValue shows the raw value until the popup mounts its items, unless the root gets `items`
  const delimiterItems = DELIMITER_OPTIONS.map((option) => ({ value: option.value, label: labels.io[option.labelKey] }));
  const mappingItems = [{ value: SKIP_VALUE, label: labels.io.skipColumn }, ...allColumns.map((column) => ({ value: column.id, label: columnLabelText(column) }))];

  useEffect(() => {
    if (open) return;
    confirmTokenRef.current += 1;
    abortControllerRef.current?.abort();
    setIsValidating(false);
    setRejectedCount(0);
    setMergeFailed(false);
    setMergeMessage(null);
    setBuildError(null);
    reset();
  }, [open, reset]);

  useEffect(
    () => () => {
      confirmTokenRef.current += 1;
      abortControllerRef.current?.abort();
    },
    [],
  );

  const onFile = useCallback(
    (file: File) => {
      const targets: ImportTargetColumn[] = allColumns.map((c) => ({ id: c.id, headerText: c.headerText, header: c.header }));
      setRejectedCount(0);
      setMergeFailed(false);
      setMergeMessage(null);
      setBuildError(null);
      void loadFile(file, targets);
    },
    [allColumns, loadFile],
  );

  const loadedPropFileRef = useRef<File | null>(null);
  useEffect(() => {
    if (!open || !file || loadedPropFileRef.current === file) return;
    loadedPropFileRef.current = file;
    onFile(file);
  }, [open, file, onFile]);
  useEffect(() => {
    if (!open) loadedPropFileRef.current = null;
  }, [open]);

  const onDropFiles = useCallback(
    (acceptedFiles: File[], rejections: DropzoneRejection[]) => {
      // a maxSize rejection is re-routed through loadFile so the parse's own size check surfaces the dialog's too-large error
      const file = acceptedFiles[0] ?? (rejections.some((r) => r.reasons.includes("maxSize")) ? rejections[0]?.file : undefined);
      if (file) onFile(file);
    },
    [onFile],
  );

  /** Rejected-cell count from the last confirmed build; non-zero keeps the dialog open so the warning is visible. */
  const [rejectedCount, setRejectedCount] = useState(0);
  /** True when `onImport` rejected; the dialog stays open and the import can be retried. */
  const [mergeFailed, setMergeFailed] = useState(false);
  /** Message of the last `onImport` rejection, when it had one. */
  const [mergeMessage, setMergeMessage] = useState<string | null>(null);
  /** Error key of a row hook or build that failed before `onImport`. */
  const [buildError, setBuildError] = useState<ImportErrorKey | "importBuildFailed" | null>(null);
  const warnedMissingOnImportRef = useRef(false);
  const appendRows = useCallback(
    (rows: TData[], flagged: readonly ImportRejectedCell[]) => {
      const state = storeApi.getState();
      if (state.totalRowCount != null) {
        if (isDev() && !warnedMissingOnImportRef.current) {
          warnedMissingOnImportRef.current = true;
          console.warn("[data-grid-io] this grid holds a window of its result; pass onImport to send the rows to your server");
        }
        throw new Error("");
      }
      if (state.readOnly) throw new Error("");
      const start = state.data.length;
      const flags = flagged.flatMap(({ rowIndex, gridColumnId, message }) => {
        const row = rows[rowIndex];
        return row === undefined ? [] : [{ rowId: state.getRowId(row, start + rowIndex), columnId: gridColumnId, message: message ?? "" }];
      });
      commitWithFlags(
        {
          source: "import",
          ops: rows.map((row, offset) => ({ type: "insert" as const, rowId: state.getRowId(row, start + offset), row, index: start + offset })),
        },
        flags,
      );
    },
    [commitWithFlags, storeApi],
  );
  const finish = useCallback(
    (rows: TData[], rejected: readonly ImportRejectedCell[], flagged: readonly ImportRejectedCell[], source: ImportSource) => {
      setMergeFailed(false);
      setMergeMessage(null);
      setIsValidating(true);
      const token = ++confirmTokenRef.current;
      const signal = abortControllerRef.current?.signal ?? new AbortController().signal;
      void Promise.resolve()
        .then(() => (onImport ? onImport(rows, { signal, rejected, flagged, ...source }) : appendRows(rows, flagged)))
        .then(() => {
          if (confirmTokenRef.current === token) actions.clearSelection();
        })
        .then(
          () => {
            if (confirmTokenRef.current !== token) return;
            setIsValidating(false);
            if (rejected.length > 0) {
              setRejectedCount(rejected.length);
              return;
            }
            onOpenChange(false);
          },
          (error) => {
            if (confirmTokenRef.current !== token) return;
            setIsValidating(false);
            setMergeFailed(true);
            setMergeMessage(error instanceof Error && error.message !== "" ? error.message.slice(0, MAX_ERROR_MESSAGE_LENGTH) : null);
            if (onImportError) {
              try {
                onImportError(error);
              } catch (callbackError) {
                if (isDev()) console.warn("[data-grid-io] onImportError threw", callbackError);
              }
            } else if (isDev() && onImport) console.warn("[data-grid-io] onImport rejected; the dialog stays open", error);
          },
        );
    },
    [onImport, onImportError, appendRows, actions, onOpenChange],
  );

  const onConfirm = useCallback(() => {
    if (!preview) return;
    const state = storeApi.getState();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    setBuildError(null);
    const clipboardParse = state.processCellFromClipboard as ((text: string, ctx: { row: TData; column: unknown; fromText: (text: string) => unknown }) => unknown) | undefined;
    const cellParser: ProcessCellFromText<TData> | undefined =
      processCellFromText ?? (clipboardParse ? (text, ctx) => clipboardParse(text, { row: ctx.row, column: ctx.column, fromText: ctx.fromText }) : undefined);
    // state.cellTypes comes back from the generic-erased store (TData = unknown, see core store.tsx's InternalSyncProps comment); re-widened here to this dialog's own TData. allColumns is already TData-typed via useDataGridAllColumns<TData>() above.
    const source: ImportSource = { fileName: preview.fileName, sheetName: preview.sheetName, mapping: preview.mapping };
    const token = ++confirmTokenRef.current;
    const fail = (reason: unknown) => {
      if (confirmTokenRef.current !== token) return;
      setIsValidating(false);
      if (reason instanceof Error && reason.message === IMPORT_CANCELLED_MESSAGE) return;
      const key = importErrorKey(reason);
      if (key === null) {
        if (!abortController.signal.aborted) setBuildError("importBuildFailed");
        return;
      }
      setBuildError(key === "errorTooManyCells" || key === "errorNoRows" ? key : "importBuildFailed");
    };
    let built;
    try {
      built = build<TData>({
        columns: allColumns,
        cellTypes: state.cellTypes as never,
        createRow,
        signal: abortController.signal,
        processImportRows,
        processCellFromText: cellParser,
      });
    } catch (reason) {
      fail(reason);
      return;
    }
    if (built !== null && !(built instanceof Promise)) {
      finish(built.rows, built.rejected, built.flagged, source);
      return;
    }
    // A large import (chunked so the dialog can repaint and Cancel can land), a row or cell hook, or an
    // async schema on a mapped column: the dialog stays open with Import disabled — the existing pending
    // affordance — and closes when the last verdict is in, or drops the batch silently if Cancel/close beat it.
    setIsValidating(true);
    void Promise.resolve(built).then((result) => {
      if (confirmTokenRef.current !== token) return; // superseded by a newer confirm, or the dialog reset
      setIsValidating(false);
      if (result !== null) finish(result.rows, result.rejected, result.flagged, source);
    }, fail);
  }, [preview, build, allColumns, storeApi, createRow, finish, processImportRows, processCellFromText]);

  const onCancel = useCallback(() => {
    abortControllerRef.current?.abort();
    onOpenChange(false);
  }, [onOpenChange]);

  const acceptedTypesLabel = labels.io.acceptedFileTypes(Object.values(accept).flat().join(", "));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-h-[80vh] min-w-0 overflow-y-auto sm:max-w-2xl", className)}>
        <DialogHeader>
          <DialogTitle>{labels.io.importDialogTitle}</DialogTitle>
          <DialogDescription>{labels.io.importDialogDescription}</DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-3">
          {preview ? (
            <Dropzone compact accept={accept} description={acceptedTypesLabel} maxFiles={1} maxSize={maxFileBytes} onDrop={onDropFiles} aria-label={labels.io.chooseFile}>
              <Paperclip className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">{preview.fileName}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{labels.io.replaceFile}</span>
            </Dropzone>
          ) : (
            <Dropzone accept={accept} description={acceptedTypesLabel} maxFiles={1} maxSize={maxFileBytes} onDrop={onDropFiles} aria-label={labels.io.chooseFile}>
              <DropzoneEmptyState title={labels.io.chooseFile} description={`${labels.io.noFileChosen} — ${labels.io.maxFileSize(maxFileBytes)}`} />
            </Dropzone>
          )}

          {error && <p role="alert" className="text-sm text-destructive">{labels.io[error]}</p>}

          {rejectedCount > 0 && <p role="alert" className="text-sm text-destructive">{labels.io.importRejectedCells(rejectedCount)}</p>}

          {buildError && <p role="alert" className="text-sm text-destructive">{labels.io[buildError]}</p>}

          {mergeFailed && (
            <p role="alert" className="text-sm text-destructive">
              {mergeMessage ? labels.io.importFailedWithMessage(mergeMessage) : labels.io.importMergeFailed}
            </p>
          )}

          {preview && (
            <>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Checkbox id={headerRowId} checked={preview.hasHeaderRow} onCheckedChange={(checked) => setHasHeaderRow(checked === true)} />
                  <Label htmlFor={headerRowId}>{labels.io.hasHeaderRow}</Label>
                </div>
                {preview.delimiter !== undefined && (
                  <label className="flex items-center gap-2 text-sm text-foreground">
                    {labels.io.delimiter}
                    <Select items={delimiterItems} value={preview.delimiter} onValueChange={(value) => void setDelimiter(value as CsvDelimiter)}>
                      <SelectTrigger className="w-36" size="sm" aria-label={labels.io.delimiter}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {delimiterItems.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                )}
                {preview.sheetNames !== undefined && preview.sheetNames.length > 1 && (
                  <label className="flex items-center gap-2 text-sm text-foreground">
                    {labels.io.sheet}
                    <Select value={preview.sheetName ?? preview.sheetNames[0]} onValueChange={(value) => void setSheetName(value as string)}>
                      <SelectTrigger className="w-40" size="sm" aria-label={labels.io.sheet}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {preview.sheetNames.map((name) => (
                          <SelectItem key={name} value={name} title={name}>
                            {name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                )}
              </div>

              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-sm font-medium text-foreground">{labels.io.mapColumns}</span>
                <div className="min-w-0 overflow-hidden rounded-md border border-border">
                  {/* fixed layout gives every column an identical track — keeps selects and preview cells aligned */}
                  <Table className="table-fixed" style={{ minWidth: `${preview.importHeaders.length * 9}rem` }}>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent has-aria-expanded:bg-transparent">
                        {preview.importHeaders.map((header, importColumnIndex) => {
                          const currentGridColumnId = preview.mapping[importColumnIndex]?.gridColumnId ?? null;
                          // one source per grid column: a column mapped elsewhere is disabled
                          const takenElsewhere = new Set(
                            preview.mapping
                              .filter((m) => m.importColumnIndex !== importColumnIndex && m.gridColumnId !== null)
                              .map((m) => m.gridColumnId),
                          );
                          return (
                            <TableHead key={importColumnIndex} className="h-auto bg-muted/50 p-1.5 align-top whitespace-normal">
                              <div className="mb-1 truncate" title={header}>
                                {header}
                              </div>
                              <div className="flex items-center gap-1">
                                <Select
                                  items={mappingItems}
                                  value={currentGridColumnId ?? SKIP_VALUE}
                                  onValueChange={(value) =>
                                    setMapping(importColumnIndex, value === SKIP_VALUE || value === null ? null : value)
                                  }
                                >
                                  <SelectTrigger className="w-full" size="sm" aria-label={labels.io.mapColumnAriaLabel(header)}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {mappingItems.map((item) => (
                                      <SelectItem key={item.value} value={item.value} disabled={takenElsewhere.has(item.value)}>
                                        {item.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                {currentGridColumnId !== null && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-7 shrink-0"
                                    aria-label={labels.io.skipColumnQuick}
                                    onClick={() => setMapping(importColumnIndex, null)}
                                  >
                                    <X className="size-3.5" />
                                  </Button>
                                )}
                              </div>
                            </TableHead>
                          );
                        })}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewRows.map((row, rowIndex) => (
                        <TableRow key={rowIndex} className="hover:bg-transparent">
                          {preview.importHeaders.map((_, columnIndex) => (
                            <TableCell key={columnIndex} className="truncate p-1.5 text-muted-foreground" title={row[columnIndex] ?? ""}>
                              {row[columnIndex] ?? ""}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {preview.importHeaders.length > 1 && (
                  <span className="text-xs text-muted-foreground">{labels.io.mapColumnsHint}</span>
                )}
                <span className="text-xs text-muted-foreground">
                  {labels.io.previewTruncated(previewRows.length, importRows.length)}
                </span>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {labels.io.cancel}
          </Button>
            <Button type="button" onClick={onConfirm} disabled={!preview || importRows.length === 0 || isParsing || isValidating || rejectedCount > 0}>
              {labels.io.import}
            </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
