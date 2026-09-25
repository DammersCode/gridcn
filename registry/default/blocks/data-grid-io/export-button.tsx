"use client";

import type { ReactNode } from "react";
import { Download } from "lucide-react";
import { isDev, useDataGridLabels } from "@/registry/default/blocks/data-grid/data-grid";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDataGridExport } from "./use-data-grid-export";
import type { ExportGridOptions } from "./export-grid";

/** Props for {@link DataGridExportButton}. */
export type DataGridExportButtonProps = {
  className?: string;
  /** Export options applied to both formats besides `format` itself; default `{ scope: 'view', includeHeaders: true }`. */
  options?: Omit<ExportGridOptions, "format">;
  /** Receives the rejection when an export fails; without it, the failure logs a dev-only warning. */
  onError?: (error: unknown, format: "xlsx" | "csv") => void;
};

/**
 * Toolbar-slot export trigger: a ghost icon button opening a dropdown of xlsx/csv, wired to
 * {@link useDataGridExport}. `size-8` + ghost variant matches the toolbar's other icon buttons.
 */
export function DataGridExportButton(props: DataGridExportButtonProps): ReactNode {
  const { className, options, onError } = props;
  const labels = useDataGridLabels();
  const { exportGrid } = useDataGridExport();

  const runExport = (format: "xlsx" | "csv") => {
    exportGrid({ ...options, format }).catch((error: unknown) => {
      if (onError) {
        onError(error, format);
        return;
      }
      if (isDev()) console.warn(`[data-grid-io] ${format} export failed`, error);
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" variant="ghost" size="icon" className={className} aria-label={labels.io.exportButtonAriaLabel}>
            <Download />
          </Button>
        }
      />
      <DropdownMenuContent align="start">
        <DropdownMenuItem onClick={() => runExport("xlsx")}>
          {labels.io.exportXlsx}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => runExport("csv")}>
          {labels.io.exportCsv}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
