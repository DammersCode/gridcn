"use client";

import { useMemo, type ReactNode } from "react";
import { ArrowUp, Copy, Plus } from "lucide-react";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
  useDataGridActions,
} from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridContextMenu, DataGridHeaderDropdown } from "@/registry/default/blocks/data-grid-context-menu/data-grid-context-menu";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 100, flex: 1 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 130, flex: 2 },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 70, flex: 1 },
] as const);

function createRow(): DemoRow {
  return { id: `new-${Date.now()}`, name: "New row", email: "", age: 18, active: false, role: "User", joined: "", score: 0 };
}

function duplicateRow(row: DemoRow): DemoRow {
  return { ...row, id: `${row.id}-copy-${Date.now()}` };
}

function DuplicateRowItem({ row }: { row: number }) {
  const actions = useDataGridActions();
  return (
    <ContextMenuItem onClick={() => actions.duplicateRows([row])}>
      <Copy className="size-4 text-muted-foreground" />
      Duplicate row
    </ContextMenuItem>
  );
}

function SortAscendingItem({ columnId }: { columnId: string }) {
  const actions = useDataGridActions();
  return (
    <ContextMenuItem onClick={() => actions.setSorts([{ columnId, direction: "asc" }])}>
      <ArrowUp className="size-4 text-muted-foreground" />
      Sort ascending
    </ContextMenuItem>
  );
}

function InsertRowItem({ row }: { row: number }) {
  const actions = useDataGridActions();
  return (
    <ContextMenuItem onClick={() => actions.insertRow(row, "below")}>
      <Plus className="size-4 text-muted-foreground" />
      Insert row below
    </ContextMenuItem>
  );
}

export default function DataGridContextMenuSlotsDemo(): ReactNode {
  const rows = useMemo(() => generateDemoRows(10), []);

  return (
    <div className="w-full flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Right-click a cell for a two-item row menu. Right-click a header for a one-item column menu.
      </p>
      <div className="h-[360px] overflow-hidden rounded-md border border-border">
        <DataGridProvider
          defaultData={rows}
          columns={columns}
          getRowId={(row) => row.id}
          createRow={createRow}
          duplicateRow={duplicateRow}
        >
          <DataGridContextMenu
            className="flex h-full flex-col"
            renderCellMenuItems={({ row, canInsertRow, canDuplicateRow }) => (
              <>
                {canInsertRow && <InsertRowItem row={row} />}
                {canDuplicateRow && <DuplicateRowItem row={row} />}
              </>
            )}
            renderHeaderMenuItems={({ columnId }) => <SortAscendingItem columnId={columnId} />}
          >
            <DataGridRoot
              className="h-full rounded-none border-none"
              renderHeaderMenu={(ctx) => <DataGridHeaderDropdown {...ctx} />}
            >
              <DataGridHeader />
              <DataGridBody />
            </DataGridRoot>
          </DataGridContextMenu>
        </DataGridProvider>
      </div>
    </div>
  );
}
