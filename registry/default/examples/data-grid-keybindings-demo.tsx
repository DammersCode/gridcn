"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
} from "@/registry/default/blocks/data-grid/data-grid";
import {
  DataGridKeybindingsDialog,
  DataGridKeybindingsShortcut,
} from "@/registry/default/blocks/data-grid-keybindings/data-grid-keybindings";
import { Button } from "@/components/ui/button";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 150, flex: 2 },
  {
    id: "role",
    header: "Role",
    accessorKey: "role",
    type: "select",
    options: {
      choices: [
        { value: "Admin", label: "Admin" },
        { value: "User", label: "User" },
        { value: "Editor", label: "Editor" },
        { value: "Viewer", label: "Viewer" },
        { value: "Manager", label: "Manager" },
      ],
    },
    width: 120,
    flex: 1,
  },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 90, flex: 1 },
] as const);

/**
 * A shortcuts dialog generated at runtime from the grid's effective keymap. Opens via the toolbar
 * button below or the `?` (shift+/) shortcut once focused in the grid.
 */
export default function DataGridKeybindingsDemo(): ReactNode {
  const rows = useMemo(() => generateDemoRows(6), []);
  const [open, setOpen] = useState(false);

  return (
    <div className="w-full flex h-[300px] flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        Click a cell to focus the grid, then press ? (shift+/) to open the shortcuts dialog — or use
        the button below.
      </p>
      <Button variant="outline" size="sm" className="w-fit" onClick={() => setOpen(true)}>
        Keyboard shortcuts
      </Button>
      <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
        <DataGridProvider defaultData={rows} columns={columns} getRowId={(row) => row.id}>
          <DataGridKeybindingsDialog open={open} onOpenChange={setOpen} />
          <DataGridRoot className="h-full rounded-none border-none">
            <DataGridKeybindingsShortcut onOpen={() => setOpen(true)} />
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      </div>
    </div>
  );
}
