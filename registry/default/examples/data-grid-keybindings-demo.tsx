"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
  type GridCommand,
  type Keymap,
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
 * button below or the `?` (shift+/) shortcut once focused in the grid. Also carries one custom
 * command (Save row, mod+s) to show how consumer commands join the keymap and the dialog.
 */
export default function DataGridKeybindingsDemo(): ReactNode {
  const rows = useMemo(() => generateDemoRows(6), []);
  const [open, setOpen] = useState(false);
  const [lastCommand, setLastCommand] = useState<string | null>(null);

  // A real consumer augments GridActions via declaration merging (like GridCellTypes); that
  // can't run inside this repo's tsc program (it would break the exhaustive GridAction test), so
  // the demo asserts the custom binding.
  const demoKeymap = { saveRow: ["mod+s"] } as Keymap;
  const commands = useMemo<Record<string, GridCommand<DemoRow>>>(
    () => ({
      saveRow: {
        label: "Save row",
        group: "editing",
        when: (ctx) => ctx.cell !== null,
        run: (ctx) => setLastCommand(`Saved ${ctx.row?.name ?? "no row"}`),
      },
    }),
    [],
  );

  return (
    <div className="w-full flex h-[300px] flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        Click a cell to focus the grid, then press ? (shift+/) to open the shortcuts dialog — or use
        the button below. Mod+S runs the custom Save row command (listed in the dialog under
        Editing); its result shows below.
      </p>
      <Button variant="outline" size="sm" className="w-fit" onClick={() => setOpen(true)}>
        Keyboard shortcuts
      </Button>
      {lastCommand && <p className="text-xs text-muted-foreground">{lastCommand}</p>}
      <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
        <DataGridProvider defaultData={rows} columns={columns} getRowId={(row) => row.id} commands={commands} keymap={demoKeymap}>
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
