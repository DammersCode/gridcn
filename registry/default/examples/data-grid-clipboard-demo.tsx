"use client";

import type { ReactNode } from "react";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";

type Entry = { id: string; label: string; formula: string };

const ROWS: Entry[] = [
  { id: "r1", label: "Total", formula: "=SUM(B2:B9)" },
  { id: "r2", label: "Offset", formula: "+12" },
  { id: "r3", label: "Mention", formula: "@alice" },
  { id: "r4", label: "Note", formula: "plain text" },
];

const columns = defineColumns<Entry>()([
  { id: "label", header: "Label", accessorKey: "label", type: "text", width: 120, flex: 1 },
  { id: "formula", header: "Formula", accessorKey: "formula", type: "text", width: 160, flex: 2 },
] as const);

/** Copy a range, then paste it into a spreadsheet: the grid puts a quote before each formula-like cell. */
export default function DataGridClipboardDemo(): ReactNode {
  return (
    <div className="w-full flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Select the Formula cells and press Ctrl/Cmd+C. Paste into a spreadsheet: each cell that starts with =, +, -, or @
        arrives as text. Paste back into the grid to restore the raw value.
      </p>
      <div className="h-[240px] overflow-hidden rounded-md border border-border">
        <DataGridProvider defaultData={ROWS} columns={columns}>
          <DataGridRoot className="h-full">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      </div>
    </div>
  );
}
