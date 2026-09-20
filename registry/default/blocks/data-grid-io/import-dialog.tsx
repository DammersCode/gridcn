"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import {
  useDataGridActions,
  useDataGridAllColumns,
  useDataGridLabels,
  useDataGridStoreApi,
  type AnyColumnDef,
} from "@/registry/default/blocks/data-grid/data-grid";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { buildImportedRows } from "./build-imported-rows";
import { useDataGridImportPreview, type ImportTargetColumn, type ImportDefaults } from "./use-data-grid-import";
import type { CsvDelimiter } from "./parse-import-file";

export type { ImportDefaults };

const DELIMITER_OPTIONS: { value: CsvDelimiter; labelKey: "delimiterComma" | "delimiterSemicolon" | "delimiterTab" }[] = [
  { value: ",", labelKey: "delimiterComma" },
  { value: ";", labelKey: "delimiterSemicolon" },
  { value: "\t", labelKey: "delimiterTab" },
];

/** Column display header: `headerText`, else the string `header`, else the id. */
function columnLabel(column: Pick<AnyColumnDef, "id" | "header" | "headerText">): string {
  return column.headerText ?? (typeof column.header === "string" ? column.header : column.id);
}

/** Props for {@link DataGridImportDialog}. */
export type DataGridImportDialogProps<TData> = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Builds a fresh row for import row `index`; required — the dialog never writes to the grid store directly. */
  createRow: (index: number) => TData;
  /** Called with the fully-built rows on confirm; the consumer decides how to merge (replace/append). */
  onImport: (rows: TData[]) => void;
  /** Consumer-configurable preselection defaults (delimiter, header row, skip columns, mapping). Omit for today's behavior unchanged. */
  importDefaults?: ImportDefaults;
};

/**
 * File-picker -> preview -> column-mapping -> confirm dialog (PLAN §8 item 5). Parses via
 * {@link useDataGridImportPreview}, builds `TData` rows via {@link buildImportedRows} through each mapped
 * column's cell-type `fromText` + `validate`, then hands the result to `onImport` — it never writes
 * to the grid store directly, so replace/append semantics stay the consumer's call.
 */
export function DataGridImportDialog<TData>(props: DataGridImportDialogProps<TData>): ReactNode {
  const { open, onOpenChange, createRow, onImport, importDefaults } = props;
  const labels = useDataGridLabels();
  const actions = useDataGridActions();
  const storeApi = useDataGridStoreApi();
  const allColumns = useDataGridAllColumns<TData>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isValidating, setIsValidating] = useState(false);
  /** Generation guard for a held async import: a newer confirm, or closing the dialog, drops the older batch. */
  const confirmTokenRef = useRef(0);
  /** Aborts the in-flight chunked build (large sync imports and async-schema imports alike) when Cancel is clicked or the dialog closes. */
  const abortControllerRef = useRef<AbortController | null>(null);
  const { preview, error, isParsing, loadFile, setHasHeaderRow, setDelimiter, setSheetName, setMapping, reset, previewRows, importRows } =
    useDataGridImportPreview(labels.io.columnFallback, importDefaults);

  useEffect(() => {
    if (open) return;
    confirmTokenRef.current += 1;
    abortControllerRef.current?.abort();
    setIsValidating(false);
    reset();
  }, [open, reset]);

  const onFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const targets: ImportTargetColumn[] = allColumns.map((c) => ({ id: c.id, headerText: c.headerText, header: c.header }));
      void loadFile(file, targets);
    },
    [allColumns, loadFile],
  );

  const finish = useCallback(
    (rows: TData[]) => {
      onImport(rows);
      actions.clearSelection();
      onOpenChange(false);
    },
    [onImport, actions, onOpenChange],
  );

  const onConfirm = useCallback(() => {
    if (!preview) return;
    const state = storeApi.getState();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    // state.cellTypes comes back from the generic-erased store (TData = unknown, see core store.tsx's InternalSyncProps comment); re-widened here to this dialog's own TData. allColumns is already TData-typed via useDataGridAllColumns<TData>() above.
    const rows = buildImportedRows<TData>({
      dataRows: importRows,
      mapping: preview.mapping,
      columns: allColumns,
      cellTypes: state.cellTypes as never,
      createRow,
      signal: abortController.signal,
    });
    if (!(rows instanceof Promise)) {
      finish(rows);
      return;
    }
    // A large import (chunked so the dialog can repaint and Cancel can land) or an async schema on a
    // mapped column: the dialog stays open with Import disabled — the existing pending affordance —
    // and closes when the last verdict is in, or drops the batch silently if Cancel/close beat it.
    const token = ++confirmTokenRef.current;
    setIsValidating(true);
    void rows.then(
      (resolved) => {
        if (confirmTokenRef.current !== token) return; // superseded by a newer confirm, or the dialog reset
        setIsValidating(false);
        finish(resolved);
      },
      () => {
        // cancelled (signal aborted) or a validator threw outside runValidateBatch's own guard — either way, no rows to import.
        if (confirmTokenRef.current !== token) return;
        setIsValidating(false);
      },
    );
  }, [preview, importRows, allColumns, storeApi, createRow, finish]);

  const onCancel = useCallback(() => {
    abortControllerRef.current?.abort();
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="min-w-0 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{labels.io.importDialogTitle}</DialogTitle>
          <DialogDescription>{labels.io.importDialogDescription}</DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.tsv,.xlsx,.xls,text/csv,text/tab-separated-values,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={onFileChange}
            />
            <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
              {labels.io.chooseFile}
            </Button>
            <span className="truncate text-sm text-muted-foreground">{preview?.fileName ?? labels.io.noFileChosen}</span>
          </div>

          {error && <p className="text-sm text-destructive">{labels.io[error]}</p>}

          {preview && (
            <>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={preview.hasHeaderRow}
                    onChange={(e) => setHasHeaderRow(e.target.checked)}
                  />
                  {labels.io.hasHeaderRow}
                </label>
                {preview.delimiter !== undefined && (
                  <label className="flex items-center gap-2 text-sm text-foreground">
                    {labels.io.delimiter}
                    <Select value={preview.delimiter} onValueChange={(value) => void setDelimiter(value as CsvDelimiter)}>
                      <SelectTrigger className="w-36" size="sm" aria-label={labels.io.delimiter}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DELIMITER_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {labels.io[option.labelKey]}
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
                <div className="min-w-0 overflow-x-auto rounded-md border border-border">
                  {/* one grid for header+selects+preview so every column shares an identical track — keeps selects and preview cells aligned */}
                  <div
                    role="table"
                    className="grid text-sm"
                    style={{ gridTemplateColumns: `repeat(${preview.importHeaders.length}, minmax(9rem, 1fr))` }}
                  >
                    {preview.importHeaders.map((header, importColumnIndex) => {
                      const currentGridColumnId = preview.mapping[importColumnIndex]?.gridColumnId ?? null;
                      // a grid column already claimed by another row can't be picked again — one source per grid column (v1 rule)
                      const takenElsewhere = new Set(
                        preview.mapping
                          .filter((m) => m.importColumnIndex !== importColumnIndex && m.gridColumnId !== null)
                          .map((m) => m.gridColumnId),
                      );
                      return (
                        <div
                          key={importColumnIndex}
                          role="columnheader"
                          className="min-w-0 border-b border-border bg-muted/50 p-1.5 text-start font-medium text-foreground"
                        >
                          <div className="mb-1 truncate" title={header}>
                            {header}
                          </div>
                          <div className="flex items-center gap-1">
                            <Select
                              value={currentGridColumnId ?? "__skip__"}
                              onValueChange={(value) =>
                                setMapping(importColumnIndex, value === "__skip__" || value === null ? null : value)
                              }
                            >
                              <SelectTrigger className="w-full" size="sm" aria-label={labels.io.mapColumnAriaLabel(header)}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__skip__">{labels.io.skipColumn}</SelectItem>
                                {allColumns.map((column) => (
                                  <SelectItem key={column.id} value={column.id} disabled={takenElsewhere.has(column.id)}>
                                    {columnLabel(column)}
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
                        </div>
                      );
                    })}
                    {previewRows.map((row, rowIndex) =>
                      preview.importHeaders.map((_, columnIndex) => (
                        <div
                          key={`${rowIndex}-${columnIndex}`}
                          role="cell"
                          className={cn(
                            "min-w-0 truncate p-1.5 text-muted-foreground",
                            rowIndex < previewRows.length - 1 && "border-b border-border",
                          )}
                          title={row[columnIndex] ?? ""}
                        >
                          {row[columnIndex] ?? ""}
                        </div>
                      )),
                    )}
                  </div>
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
            <Button type="button" onClick={onConfirm} disabled={!preview || importRows.length === 0 || isParsing || isValidating}>
              {labels.io.import}
            </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
