"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import useSWR from "swr";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
  type DataChange,
} from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridPagination, DataGridPaginationBar } from "@/registry/default/blocks/data-grid-pagination/data-grid-pagination";
import { type DemoRow } from "./demo-data";
import { createRemoteServer } from "./fake-remote-server";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 100, flex: 1 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 130, flex: 2 },
  { id: "role", header: "Role", accessorKey: "role", type: "text", width: 90, flex: 1 },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 70, flex: 1 },
] as const);

/**
 * Server-mode pagination through SWR: `useSWR(["rows", page, pageSize], fetcher)` fetches the
 * current page from the fake server (~300 ms) and caches it by key, so paging back is instant.
 * The last fetched rows are kept in local state so the grid keeps showing them while the next
 * page loads (SWR has no built-in keep-previous). Edits write through to the fake server, then
 * the scoped `mutate` revalidates the current key so the grid shows the server's truth.
 *
 * The fetcher receives the key itself as its argument (SWR 2.x convention), hence the tuple
 * cast rather than destructured parameters.
 */
function PaginatedSwrGrid(): ReactNode {
  const server = useMemo(() => createRemoteServer(), []);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [rows, setRows] = useState<readonly DemoRow[]>([]);

  const { data, isLoading, mutate } = useSWR(["rows", page, pageSize] as [string, number, number], (key) =>
    server.fetchPage({ page: key[1], pageSize: key[2] }),
  );

  useEffect(() => {
    if (data) setRows(data.rows);
  }, [data]);

  const pager = useDataGridPagination({
    page,
    pageSize,
    total: data?.total ?? server.total,
    onPageChange: setPage,
    onPageSizeChange: (next) => {
      setPageSize(next);
      setPage(1);
    },
  });

  const onDataChange = useCallback(
    (_next: readonly DemoRow[], change: DataChange<DemoRow>) => {
      server.applyOps(change.ops);
      void mutate(undefined, { revalidate: true });
    },
    [mutate, server],
  );

  return (
    <div className="w-full flex flex-col gap-2">
      <div className="text-sm text-muted-foreground">
        {isLoading ? "Loading page…" : `Page ${pager.controls.page} of ${pager.controls.pageCount} · ${data?.total ?? 0} rows on the server`}
      </div>
      <div className="flex h-[420px] flex-col overflow-hidden rounded-md border border-border">
        <DataGridProvider data={rows} columns={columns} getRowId={(row) => row.id} onDataChange={onDataChange}>
          <DataGridRoot className="min-h-0 flex-1 rounded-none border-none">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
        <DataGridPaginationBar {...pager.controls} />
      </div>
    </div>
  );
}

export default function DataGridPaginationSwrDemo(): ReactNode {
  return <PaginatedSwrGrid />;
}
