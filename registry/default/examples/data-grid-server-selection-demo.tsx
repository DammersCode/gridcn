"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  DataGridBody,
  DataGridHeader,
  DataGridProvider,
  DataGridRoot,
  defineColumns,
  useDataGridSelectedRows,
} from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridStatusBar } from "@/registry/default/blocks/data-grid-status-bar/data-grid-status-bar";
import { DataGridPaginationBar, useDataGridPagination } from "@/registry/default/blocks/data-grid-pagination/data-grid-pagination";

type Row = { id: string; name: string; email: string };

const TOTAL = 237;
const PAGE_SIZE = 10;

const columns = defineColumns<Row>()([
  { id: "id", header: "ID", accessorKey: "id", type: "text", width: 90 },
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 140, flex: 1 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 200, flex: 2 },
] as const);

const rowAt = (index: number): Row => ({ id: `row-${index}`, name: `Person ${index}`, email: `person${index}@example.com` });

function SelectionPanel(): ReactNode {
  const selected = useDataGridSelectedRows();
  const summary = selected.mode === "ids" ? `${selected.count} checked` : `all matching, ${selected.count?.toLocaleString("en-US")} rows`;
  const list = selected.mode === "ids" ? selected.ids : selected.excludedIds;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-2 text-sm">
      <strong>{summary}</strong>
      <code className="block truncate text-xs text-muted-foreground">
        {selected.mode === "ids" ? "ids" : "excludedIds"}: [{list.slice(0, 6).join(", ")}
        {list.length > 6 ? `, +${list.length - 6} more` : ""}]
      </code>
    </div>
  );
}

/** A paged "server": checks survive page changes, and "select all matching" covers rows that were never loaded. */
export default function DataGridServerSelectionDemo(): ReactNode {
  const [page, setPage] = useState(1);
  const rows = useMemo(() => Array.from({ length: PAGE_SIZE }, (_, i) => rowAt((page - 1) * PAGE_SIZE + i)).filter((row) => Number(row.id.slice(4)) < TOTAL), [page]);
  const pager = useDataGridPagination({ page, pageSize: PAGE_SIZE, total: TOTAL, onPageChange: setPage, pageSizeOptions: [PAGE_SIZE] });

  return (
    <div className="flex w-full flex-col gap-2">
      <p className="m-0 text-sm text-muted-foreground">
        Check rows on page 1, go to page 3, and check more. Then tick the header checkbox: the bar under the grid offers "Select all {TOTAL} matching". Uncheck a row and change pages.
      </p>
      <DataGridProvider data={rows} columns={columns} getRowId={(row) => row.id} rowMarkers="checkbox" totalRowCount={TOTAL}>
        <DataGridRoot className="h-[360px]">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
        <DataGridPaginationBar {...pager.controls} />
        <DataGridStatusBar />
        <SelectionPanel />
      </DataGridProvider>
    </div>
  );
}
