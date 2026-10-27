"use client";

import { useMemo, type ReactNode } from "react";
import { DataGrid, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 50, flex: 1 },
  { id: "joined", header: "Calendar at edit start", accessorKey: "joined", type: "date", width: 60, flex: 1 },
  {
    id: "joinedTrigger",
    header: "Calendar button",
    accessorKey: "joined",
    type: "date",
    options: { calendarTrigger: true },
    width: 60,
    flex: 1,
  },
] as const);

/** Two date columns: the first opens its calendar at edit start, the second shows a typed input with a calendar button. */
export default function DataGridDatePickerDemo(): ReactNode {
  const rows = useMemo(() => generateDemoRows(6), []);

  return (
    <div className="w-full flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Press Enter on a date cell. The first column opens the calendar at once. The second shows a typed input
        with a calendar button, and the calendar opens when you press the button.
      </p>
      <div className="h-[280px] overflow-hidden rounded-md border border-border">
        <DataGrid defaultData={rows} columns={columns} getRowId={(row) => row.id} className="h-full" />
      </div>
    </div>
  );
}
