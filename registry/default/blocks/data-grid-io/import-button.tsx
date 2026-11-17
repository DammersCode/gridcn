"use client";

import { useState, type ReactNode } from "react";
import { Upload } from "lucide-react";
import { useDataGridLabels } from "@/registry/default/blocks/data-grid/data-grid";
import { Button } from "@/components/ui/button";
import { DataGridImportDialog, useImportBlock, type DataGridImportDialogProps, type ImportDefaults } from "./import-dialog";

export type { ImportDefaults };

/** Props for {@link DataGridImportButton}: the dialog's props except the open state, plus `className`. */
export type DataGridImportButtonProps<TData> = Omit<DataGridImportDialogProps<TData>, "open" | "onOpenChange" | "className"> & {
  className?: string;
};

/**
 * Toolbar-slot import trigger: a ghost icon button that opens {@link DataGridImportDialog}.
 * `size-8` + ghost variant matches the toolbar's other icon buttons.
 */
export function DataGridImportButton<TData>(props: DataGridImportButtonProps<TData>): ReactNode {
  const { className, ...dialogProps } = props;
  const labels = useDataGridLabels();
  const [open, setOpen] = useState(false);
  const importBlock = useImportBlock(dialogProps.onImport, true);

  return (
    <>
      <Button type="button" variant="ghost" size="icon" className={className} aria-label={labels.io.importButton} disabled={importBlock !== null} title={importBlock ? labels.io[importBlock] : undefined} onClick={() => setOpen(true)}>
        <Upload />
      </Button>
      <DataGridImportDialog open={open} onOpenChange={setOpen} {...dialogProps} />
    </>
  );
}
