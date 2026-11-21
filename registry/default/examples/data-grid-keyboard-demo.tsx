"use client";

import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { DataGrid, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 150, flex: 2 },
  { id: "role", header: "Role", accessorKey: "role", type: "text", width: 100, flex: 1 },
  { id: "score", header: "Logins (30 days)", accessorKey: "score", type: "number", width: 90, flex: 1 },
] as const);

function describeChord(event: KeyboardEvent): string {
  const modifiers = [event.ctrlKey && "Ctrl", event.metaKey && "Cmd", event.altKey && "Alt", event.shiftKey && "Shift"].filter(Boolean);
  const key = event.key === " " ? "Space" : event.key;
  return [...modifiers, key].join("+");
}

/** Click a cell, then move with the arrow keys, extend with Shift, or press Enter to edit. The line shows the last chord. */
export default function DataGridKeyboardDemo(): ReactNode {
  const rows = useMemo(() => generateDemoRows(30), []);
  const [lastChord, setLastChord] = useState("none yet");

  return (
    <div className="flex w-full flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        Last chord: <kbd className="rounded-md border px-1.5 py-0.5 font-mono text-xs">{lastChord}</kbd>
      </p>
      <div onKeyDownCapture={(event) => setLastChord(describeChord(event))}>
        <DataGrid className="h-[320px] w-full" defaultData={rows} columns={columns} getRowId={(row) => row.id} />
      </div>
    </div>
  );
}
