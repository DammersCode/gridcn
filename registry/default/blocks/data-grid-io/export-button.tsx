"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Download } from "lucide-react";
import { useDataGridLabels } from "@/registry/default/blocks/data-grid/data-grid";
import { isDev } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDataGridExport } from "./use-data-grid-export";
import type { ExportGridOptions, ExportResult } from "./export-grid";

type ExportFormat = "xlsx" | "csv";

/** Props for {@link DataGridExportButton}. */
export type DataGridExportButtonProps<TData = unknown> = {
  className?: string;
  /** The formats the button offers; one format exports on click, several open a menu. Default `["xlsx", "csv"]`. */
  formats?: readonly ExportFormat[];
  /** Export options applied to both formats besides `format` itself, including `columns`, `formatCell`, and `output`; default `{ scope: 'view', includeHeaders: true }`. With `source`, the menu adds "all rows" items that export the source's rows; the plain items export the rows the grid holds. */
  options?: Omit<ExportGridOptions<TData>, "format">;
  /** Receives the rejection when an export fails; without it, the failure logs a dev-only warning. */
  onError?: (error: unknown, format: ExportFormat) => void;
};

/**
 * Toolbar-slot export trigger: a ghost icon button opening a dropdown of xlsx/csv, wired to
 * {@link useDataGridExport}. `size-8` + ghost variant matches the toolbar's other icon buttons.
 */
export function DataGridExportButton<TData = unknown>(props: DataGridExportButtonProps<TData>): ReactNode {
  const { className, formats = ["xlsx", "csv"], options, onError } = props;
  const labels = useDataGridLabels();
  const { exportGrid } = useDataGridExport();
  const { source, ...loadedOptions } = options ?? {};
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState("");
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const cancelExport = useCallback(() => controllerRef.current?.abort(), []);

  const runExport = (format: ExportFormat, all: boolean) => {
    const controller = new AbortController();
    controllerRef.current = controller;
    const tracked = all || loadedOptions.output !== undefined;
    setDone("");
    setRunning(tracked);
    const signal = loadedOptions.signal ? AbortSignal.any([controller.signal, loadedOptions.signal]) : controller.signal;
    exportGrid({ ...loadedOptions, format, signal, ...(all ? { source } : {}) })
      .then((result: ExportResult) => {
        if (tracked && controllerRef.current === controller) setDone(labels.io.exportDone(result.rowCount, result.truncated));
      })
      .catch((error: unknown) => {
        const current = controllerRef.current === controller;
        if (signal.aborted) {
          if (tracked && current) setDone(labels.io.exportCancelled);
          return;
        }
        if (tracked && current) setDone(labels.io.exportFailed);
        if (onError) {
          onError(error, format);
          return;
        }
        if (isDev()) console.warn(`[data-grid-io] ${format} export failed`, error);
      })
      .finally(() => {
        if (controllerRef.current === controller) setRunning(false);
      });
  };

  const singleFormat = formats.length === 1 && !source;
  const trigger = (
    <Button type="button" variant="ghost" size="icon" className={className} aria-label={labels.io.exportButtonAriaLabel} aria-busy={running || undefined} aria-disabled={(singleFormat && running) || undefined} onClick={singleFormat ? () => !running && runExport(formats[0]!, false) : undefined}>
      <Download />
    </Button>
  );

  const status = (
    <span role="status" className="sr-only">
      {done}
    </span>
  );

  if (singleFormat) return trigger;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={trigger} />
        <DropdownMenuContent align="start">
          {formats.includes("xlsx") && (
            <DropdownMenuItem disabled={running} onClick={() => runExport("xlsx", false)}>
              {labels.io.exportXlsx}
            </DropdownMenuItem>
          )}
          {formats.includes("csv") && (
            <DropdownMenuItem disabled={running} onClick={() => runExport("csv", false)}>
              {labels.io.exportCsv}
            </DropdownMenuItem>
          )}
          {source && formats.includes("xlsx") && (
            <DropdownMenuItem disabled={running} onClick={() => runExport("xlsx", true)}>
              {labels.io.exportAllXlsx}
            </DropdownMenuItem>
          )}
          {source && formats.includes("csv") && (
            <DropdownMenuItem disabled={running} onClick={() => runExport("csv", true)}>
              {labels.io.exportAllCsv}
            </DropdownMenuItem>
          )}
          {running && <DropdownMenuItem onClick={cancelExport}>{labels.io.exportCancel}</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
      {status}
    </>
  );
}
