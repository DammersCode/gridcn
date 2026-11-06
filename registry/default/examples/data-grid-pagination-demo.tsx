"use client";

import { useState, type ReactNode } from "react";
import { DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridToolbar, DataGridSearch, DataGridFilterMenu } from "@/registry/default/blocks/data-grid-toolbar/data-grid-toolbar";
import { DataGridPaginationBar } from "@/registry/default/blocks/data-grid-pagination/data-grid-pagination";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 100, flex: 1 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 130, flex: 2 },
  { id: "role", header: "Role", accessorKey: "role", type: "text", width: 90, flex: 1 },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 70, flex: 1 },
] as const);

/**
 * Client paging: `defaultPageSize` pages the view of a 240-row dataset. The grid keeps every row, so a header click sorts all 240,
 * the filter menu and the search narrow all 240, and the footer counts the rows that remain. A filter change goes back to page 1.
 * The footer sits inside the provider and reads the pager from it.
 */
export default function DataGridPaginationDemo(): ReactNode {
  const [rows, setRows] = useState(() => generateDemoRows(240));

  return (
    <div className="w-full flex h-[420px] flex-col overflow-hidden rounded-md border border-border">
      <DataGridProvider
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        onDataChange={(next) => setRows(next as DemoRow[])}
        defaultPageSize={25}
        headerClickBehavior="sort"
      >
        <DataGridToolbar>
          <DataGridSearch />
          <DataGridFilterMenu />
        </DataGridToolbar>
        <DataGridRoot className="min-h-0 flex-1 rounded-none border-none">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
        <DataGridPaginationBar />
      </DataGridProvider>
    </div>
  );
}
