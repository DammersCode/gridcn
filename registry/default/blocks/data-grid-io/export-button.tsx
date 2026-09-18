"use client";

import type { ReactNode } from "react";
import { Download } from "lucide-react";
import { useDataGridLabels } from "@/registry/default/blocks/data-grid/data-grid";
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
};

/**
 * Toolbar-slot export trigger: a ghost icon button opening a dropdown of xlsx/csv, wired to
 * {@link useDataGridExport}. `size-8` + ghost variant matches the toolbar's other icon buttons.
 */
export function DataGridExportButton(props: DataGridExportButtonProps): ReactNode {
  const { className, options } = props;
  const labels = useDataGridLabels();
  const { exportGrid } = useDataGridExport();

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
        <DropdownMenuItem onClick={() => void exportGrid({ ...options, format: "xlsx" })}>
          {labels.io.exportXlsx}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void exportGrid({ ...options, format: "csv" })}>
          {labels.io.exportCsv}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
