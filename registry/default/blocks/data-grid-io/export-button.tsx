"use client";

import type { ReactNode } from "react";
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
import type { ExportGridOptions } from "./export-grid";

type ExportFormat = "xlsx" | "csv";

/** Props for {@link DataGridExportButton}. */
export type DataGridExportButtonProps = {
  className?: string;
  /** The formats the button offers; one format exports on click, several open a menu. Default `["xlsx", "csv"]`. */
  formats?: readonly ExportFormat[];
  /** Export options applied to both formats besides `format` itself; default `{ scope: 'view', includeHeaders: true }`. */
  options?: Omit<ExportGridOptions, "format">;
  /** Receives the rejection when an export fails; without it, the failure logs a dev-only warning. */
  onError?: (error: unknown, format: ExportFormat) => void;
};

/**
 * Toolbar-slot export trigger: a ghost icon button opening a dropdown of xlsx/csv, wired to
 * {@link useDataGridExport}. `size-8` + ghost variant matches the toolbar's other icon buttons.
 */
export function DataGridExportButton(props: DataGridExportButtonProps): ReactNode {
  const { className, formats = ["xlsx", "csv"], options, onError } = props;
  const labels = useDataGridLabels();
  const { exportGrid } = useDataGridExport();

  const runExport = (format: ExportFormat) => {
    exportGrid({ ...options, format }).catch((error: unknown) => {
      if (onError) {
        onError(error, format);
        return;
      }
      if (isDev()) console.warn(`[data-grid-io] ${format} export failed`, error);
    });
  };

  const triggerButton = (onClick?: () => void) => (
    <Button type="button" variant="ghost" size="icon" className={className} aria-label={labels.io.exportButtonAriaLabel} onClick={onClick}>
      <Download />
    </Button>
  );

  if (formats.length === 1) return triggerButton(() => runExport(formats[0]!));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={triggerButton()} />
      <DropdownMenuContent align="start">
        {formats.includes("xlsx") && (
          <DropdownMenuItem onClick={() => runExport("xlsx")}>
            {labels.io.exportXlsx}
          </DropdownMenuItem>
        )}
        {formats.includes("csv") && (
          <DropdownMenuItem onClick={() => runExport("csv")}>
            {labels.io.exportCsv}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
