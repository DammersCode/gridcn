"use client";

import { useMemo, type ReactNode } from "react";
import { Pencil, Trash2, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
  useDataGridActions,
} from "@/registry/default/blocks/data-grid/data-grid";
import { generateDemoRows, type DemoRow } from "./demo-data";

function RowActions({ rowIndex }: { rowIndex: number }): ReactNode {
  const actions = useDataGridActions();
  // The row's first editable cell (Name, col 0) is where Edit drops the user.
  const editRow = () => actions.startEditing({ row: rowIndex, col: 0 });

  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        size="icon"
        variant="ghost"
        className="size-7"
        aria-label="Edit row"
        onClick={editRow}
      >
        <Pencil className="size-3.5" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-7"
        aria-label="Delete row"
        onClick={() => actions.deleteRows([rowIndex])}
      >
        <Trash2 className="size-3.5" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label="More actions"
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={editRow}>Edit</DropdownMenuItem>
          <DropdownMenuItem onClick={() => actions.duplicateRows([rowIndex])}>
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => actions.deleteRows([rowIndex])}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

const columns = defineColumns<DemoRow>()([
  {
    id: "name",
    header: "Name",
    accessorKey: "name",
    type: "text",
    width: 140,
    flex: 2,
  },
  {
    id: "role",
    header: "Role",
    accessorKey: "role",
    type: "select",
    width: 90,
    flex: 1,
  },
  {
    id: "age",
    header: "Age",
    accessorKey: "age",
    type: "number",
    width: 70,
    flex: 1,
  },
  {
    id: "actions",
    header: "",
    // accessorFn (no accessorKey) keeps the column readable but read-only by construction; the
    // value is unused — renderCell renders the buttons instead.
    accessorFn: () => "",
    pin: "right",
    readOnly: true,
    width: 110,
    renderCell: ({ rowIndex }) => <RowActions rowIndex={rowIndex} />,
  },
] as const);

/**
 * The action-buttons column pattern: a pinned-right `readOnly` column that composes shadcn
 * Buttons over store actions (`startEditing` drops the row's first editable cell into edit mode,
 * `deleteRows`/`duplicateRows` work on the row by its view index). No new core feature — pure
 * `renderCell` composition.
 */
export default function DataGridActionsDemo(): ReactNode {
  const rows = useMemo(() => generateDemoRows(6), []);

  return (
    <div className="w-full flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Each row's pinned-right column offers inline Edit / Delete buttons plus
        a "more" dropdown (Edit, Duplicate, Delete) — all plain store actions.
      </p>
      <div className="h-[260px] overflow-hidden rounded-md border border-border">
        <DataGridProvider
          defaultData={rows}
          columns={columns}
          getRowId={(row) => row.id}
        >
          <DataGridRoot className="h-full rounded-none border-none">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      </div>
    </div>
  );
}
