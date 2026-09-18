"use client";

import { useState, type ReactNode } from "react";
import { Upload } from "lucide-react";
import { useDataGridLabels } from "@/registry/default/blocks/data-grid/data-grid";
import { Button } from "@/components/ui/button";
import { DataGridImportDialog, type ImportDefaults } from "./import-dialog";

export type { ImportDefaults };

/** Props for {@link DataGridImportButton}. */
export type DataGridImportButtonProps<TData> = {
  className?: string;
  /** Builds a fresh row for import row `index`; required — the dialog never writes to the grid store directly. */
  createRow: (index: number) => TData;
  /** Called with the fully-built rows on confirm; the consumer decides how to merge (replace/append). */
  onImport: (rows: TData[]) => void;
  /** Consumer-configurable preselection defaults (delimiter, header row, skip columns, mapping). Omit for today's behavior unchanged. */
  importDefaults?: ImportDefaults;
};

/**
 * Toolbar-slot import trigger: a ghost icon button that opens {@link DataGridImportDialog}.
 * `size-8` + ghost variant matches the toolbar's other icon buttons.
 */
export function DataGridImportButton<TData>(props: DataGridImportButtonProps<TData>): ReactNode {
  const { className, createRow, onImport, importDefaults } = props;
  const labels = useDataGridLabels();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="ghost" size="icon" className={className} aria-label={labels.io.importButton} onClick={() => setOpen(true)}>
        <Upload />
      </Button>
      <DataGridImportDialog open={open} onOpenChange={setOpen} createRow={createRow} onImport={onImport} importDefaults={importDefaults} />
    </>
  );
}
