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
import { DataGridPaginationBar, useDataGridServerPager } from "@/registry/default/blocks/data-grid-pagination/data-grid-pagination";
import { generateSales, type SaleRow } from "./sales-data";

const TOTAL = 237;
const PAGE_SIZE = 10;
const SALES = generateSales(TOTAL);

const columns = defineColumns<SaleRow>()([
  { id: "id", header: "ID", accessorKey: "id", type: "text", width: 90 },
  { id: "customer", header: "Customer", accessorKey: "customer", type: "text", width: 140, flex: 1 },
  { id: "make", header: "Make", accessorKey: "make", type: "text", width: 100, flex: 1 },
  { id: "model", header: "Model", accessorKey: "model", type: "text", width: 100, flex: 1 },
  { id: "price", header: "Price", accessorKey: "price", type: "number", width: 100 },
] as const);

function SelectionPanel(): ReactNode {
  const selected = useDataGridSelectedRows();
  const summary = selected.mode === "ids" ? `${selected.count} checked` : `all matching, ${selected.count?.toLocaleString("en-US") ?? "an unknown number of"} rows`;
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
  const rows = useMemo(() => SALES.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [page]);
  const { pager } = useDataGridServerPager({ page, pageSize: PAGE_SIZE, totalRowCount: TOTAL, onPageChange: setPage, pageSizeOptions: [PAGE_SIZE] });

  return (
    <div className="flex w-full flex-col gap-2">
      <p className="m-0 text-sm text-muted-foreground">
        Check rows on page 1, go to page 3, and check more. Then check the header checkbox: the bar under the grid offers "Select all {TOTAL} matching". Uncheck a row and change pages.
      </p>
      <DataGridProvider data={rows} columns={columns} readOnly rowMarkers="checkbox" checkedRowsLifetime="across-filters" totalRowCount={TOTAL}>
        <DataGridRoot className="h-[360px]">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
        <DataGridPaginationBar {...pager} />
        <DataGridStatusBar />
        <SelectionPanel />
      </DataGridProvider>
    </div>
  );
}
