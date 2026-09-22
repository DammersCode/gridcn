"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
  useDataGridActions,
  useDataGridVisibleColumns,
} from "@/registry/default/blocks/data-grid/data-grid";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 150, flex: 2, reorderable: false },
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
    width: 110,
    flex: 1,
  },
  { id: "age", header: "Age", accessorKey: "age", type: "number", options: { min: 18, max: 100 }, width: 80, flex: 1 },
  { id: "joined", header: "Joined", accessorKey: "joined", type: "date", width: 110, flex: 1 },
  { id: "score", header: "Score", accessorKey: "score", type: "number", options: { min: 0, max: 100 }, width: 80, flex: 1, pin: "right" },
] as const);

/** Pick a column + move it one step left/right through the programmatic `setColumnOrder` path. */
function ReorderControls(): ReactNode {
  const actions = useDataGridActions();
  const visible = useDataGridVisibleColumns<DemoRow>();
  const [selectedId, setSelectedId] = useState<string | null>(() => visible[1]?.id ?? visible[0]?.id ?? null);
  const index = selectedId === null ? -1 : visible.findIndex((column) => column.id === selectedId);

  const move = (step: -1 | 1) => {
    if (selectedId === null) return;
    const target = visible[index + step];
    if (target === undefined) return;
    actions.setColumnOrder(selectedId, target.id, step === -1 ? "before" : "after");
  };

  if (visible.length < 2) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground">Move</span>
      <Select value={selectedId} onValueChange={setSelectedId}>
        <SelectTrigger className="h-8 w-40" aria-label="Column to move">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {visible.map((column) => (
            <SelectItem key={column.id} value={column.id}>
              {column.header}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="outline" size="sm" disabled={index <= 0} onClick={() => move(-1)}>
        <ChevronLeft className="size-4" /> Left
      </Button>
      <Button variant="outline" size="sm" disabled={index < 0 || index >= visible.length - 1} onClick={() => move(1)}>
        Right <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}

/**
 * Column drag & drop: `enableColumnReorder` lets a header drag within its pin zone (Name opts
 * out via `reorderable: false`, Score is pinned right and moves only with the pinned zone), and
 * the picker + buttons show the programmatic `setColumnOrder(id, targetId, position)` path.
 */
export default function DataGridColumnDragDemo(): ReactNode {
  const rows = useMemo(() => generateDemoRows(10), []);

  return (
    <div className="w-full flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Drag a header to reorder it — the move stays inside its pin zone. Name cannot be moved
        (<code>reorderable: false</code>) and Score is pinned right. The picker below the line
        moves the chosen column programmatically.
      </p>
      <DataGridProvider defaultData={rows} columns={columns} getRowId={(row) => row.id} enableColumnReorder>
        <ReorderControls />
        <div className="h-[340px] overflow-hidden rounded-md border border-border">
          <DataGridRoot className="h-full rounded-none border-none">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </div>
      </DataGridProvider>
    </div>
  );
}
