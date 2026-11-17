"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Printer } from "lucide-react";
import { useDataGridLabels } from "@/registry/default/blocks/data-grid/data-grid";
import { isDev } from "@/registry/default/blocks/data-grid/data-grid-sdk";
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
  const [busy, setBusy] = useState(false);
  const runRef = useRef<AbortController | null>(null);

  useEffect(() => () => runRef.current?.abort(), []);

  const print = () => {
    runRef.current?.abort();
    const run = new AbortController();
    runRef.current = run;
    const signal = options?.signal ? AbortSignal.any([options.signal, run.signal]) : run.signal;
    setBusy(true);
    printGrid({ ...options, signal })
      .catch((error: unknown) => {
        if (!run.signal.aborted && isDev()) console.warn("[data-grid-io] print failed", error);
      })
      .finally(() => {
        if (runRef.current !== run) return;
        runRef.current = null;
        setBusy(false);
      });
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={className}
      aria-label={labels.io.printButtonAriaLabel}
      aria-busy={busy || undefined}
      onClick={print}
    >
      <Printer />
    </Button>
  );
}
