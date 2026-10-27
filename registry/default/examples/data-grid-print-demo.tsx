"use client";

import { useState, type ReactNode } from "react";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
} from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridState } from "@/registry/default/blocks/data-grid-history/data-grid-history";
import { DataGridToolbar } from "@/registry/default/blocks/data-grid-toolbar/data-grid-toolbar";
import {
  DataGridPrintButton,
  type PrintGridOptions,
} from "@/registry/default/blocks/data-grid-io/data-grid-io";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { generateDemoRows, type DemoRow } from "./demo-data";

type PageSize = NonNullable<PrintGridOptions["pageSize"]>;

const PAGE_SIZES: PageSize[] = ["A4", "A3", "Letter", "Legal"];

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 120, flex: 1 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 160, flex: 2 },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 80, flex: 1 },
] as const);

/** Print button with a paper size picker: the chosen size is passed as `options.pageSize`. */
export default function DataGridPrintDemo(): ReactNode {
  const grid = useDataGridState(generateDemoRows(10), { getRowId: (row) => row.id });
  const [pageSize, setPageSize] = useState<PageSize>("A4");

  return (
    <div className="w-full flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Print opens the browser print dialog with the current view. Pick a paper size, then print
        or choose "Save as PDF" in the dialog.
      </p>
      <div className="flex h-[360px] flex-col overflow-hidden rounded-md border border-border">
        <DataGridProvider {...grid} columns={columns}>
          <DataGridToolbar>
            <Select value={pageSize} onValueChange={(value) => setPageSize(value as PageSize)}>
              <SelectTrigger aria-label="Paper size" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((size) => (
                  <SelectItem key={size} value={size}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DataGridPrintButton options={{ pageSize }} />
          </DataGridToolbar>
          <DataGridRoot className="min-h-0 flex-1 rounded-none border-none">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      </div>
    </div>
  );
}
