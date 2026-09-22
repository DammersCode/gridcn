"use client";

import { type ReactNode } from "react";
import { DataGrid, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { generateDemoRows, type DemoRow } from "./demo-data";

type TaskRow = { id: string; task: string; start: number; end: number };

function initialRows(): TaskRow[] {
  return generateDemoRows(8).map((row: DemoRow, i) => ({ id: row.id, task: row.name, start: 9, end: 17 }));
}

const columns = defineColumns<TaskRow>()([
  { id: "task", header: "Task", accessorKey: "task", type: "text", width: 140, flex: 2 },
  { id: "start", header: "Start", accessorKey: "start", type: "number", width: 70, flex: 1 },
  { id: "end", header: "End", accessorKey: "end", type: "number", width: 70, flex: 1 },
] as const);

/**
 * Cross-field validation with `validateRow`: End must stay at or after Start. The rule sees the
 * row AFTER a whole write gesture commits (so a pasted block is judged as one state), and a
 * rejected row flags the named cell the same way a server error does — the value still commits,
 * no rollback. Setting the row consistent again clears the flag.
 */
export default function DataGridCrossFieldDemo(): ReactNode {
  return (
    <div className="w-full flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Make an End time earlier than its Start (edit one cell, or paste both): the End cell gets
        flagged with the row-level message and the value still commits. Set the row consistent
        again and the flag clears.
      </p>
      <div className="h-[280px] overflow-hidden rounded-md border border-border">
        <DataGrid
          defaultData={initialRows()}
          columns={columns}
          getRowId={(row) => row.id}
          validateRow={(row) => (row.end < row.start ? { end: "End must be at or after Start" } : null)}
          className="h-full rounded-none border-none"
        />
      </div>
    </div>
  );
}
