"use client";

import { useMemo, type ReactNode } from "react";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
  type FilterOperator,
} from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridToolbar, DataGridFilterMenu } from "@/registry/default/blocks/data-grid-toolbar/data-grid-toolbar";
import { DataGridSortList } from "@/registry/default/blocks/data-grid-sort-list/data-grid-sort-list";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 100, flex: 1 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 130, flex: 2, hidden: true },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 70, flex: 1, filterOperators: ["gt", "lt"] },
] as const);

// name only offers exact-match operators here; score keeps its column-level gt/lt (this prop wins when both apply).
function operatorsForColumn(column: { id: string }): FilterOperator[] | undefined {
  return column.id === "name" ? ["equals", "notEquals"] : undefined;
}

/**
 * `operatorsForColumn` narrows Name to exact-match only; Score keeps its own `filterOperators`
 * (gt/lt). Sort list shows every column via `allColumns`, including the hidden Email column.
 */
export default function DataGridFilterOperatorsDemo(): ReactNode {
  const rows = useMemo(() => generateDemoRows(60), []);

  return (
    <div className="w-full flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Filter Name for only equals/not equals, or Score for only greater/less than. Sort by Email
        even though it is hidden from the grid.
      </p>
      <div className="flex h-[420px] flex-col overflow-hidden rounded-md border border-border">
        <DataGridProvider defaultData={rows} columns={columns} getRowId={(row) => row.id}>
          <DataGridToolbar>
            <DataGridFilterMenu operatorsForColumn={operatorsForColumn} />
            <DataGridSortList allColumns />
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
