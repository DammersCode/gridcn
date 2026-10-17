"use client";

import type { ReactNode } from "react";
import { Printer } from "lucide-react";
import { useDataGridLabels } from "@/registry/default/blocks/data-grid/data-grid";
import { Button } from "@/components/ui/button";
import { useDataGridPrint } from "./use-data-grid-print";
import type { PrintGridOptions } from "./print-grid";

/** Props for {@link DataGridPrintButton}. */
export type DataGridPrintButtonProps = {
  className?: string;
  /** Print options applied to the pass; default `{ scope: "view", includeHeaders: true }`. */
  options?: PrintGridOptions;
};

/**
 * Toolbar-slot print trigger: opens the browser print dialog with the grid's rows as a plain
 * paged table (the dialog's "Save as PDF" produces the PDF). `size-8` + ghost variant matches
 * the toolbar's other icon buttons.
 */
export function DataGridPrintButton(props: DataGridPrintButtonProps): ReactNode {
  const { className, options } = props;
  const labels = useDataGridLabels();
  const { printGrid } = useDataGridPrint();

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={className}
      aria-label={labels.io.printButtonAriaLabel}
      onClick={() => printGrid(options)}
    >
      <Printer />
    </Button>
  );
}
