"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
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
 * Server-mode pagination through TanStack Query: `useDataGridPagination` only owns the page
 * math; `useQuery` fetches the current `[page, pageSize]` from the fake server (~300 ms), and
 * `keepPreviousData` keeps the old page on screen while the next one loads. Edits write through
 * to the fake server, then `invalidateQueries` drops the cached pages so the grid refetches and
 * shows the server's truth.
 */
function PaginatedReactQueryGrid(): ReactNode {
  const server = useMemo(() => createRemoteServer(), []);
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const query = useQuery({
    queryKey: ["rows", page, pageSize],
    queryFn: () => server.fetchPage({ page, pageSize }),
    placeholderData: keepPreviousData,
  });

  const pager = useDataGridPagination({
    page,
    pageSize,
    total: query.data?.total ?? server.total,
    onPageChange: setPage,
    onPageSizeChange: (next) => {
      setPageSize(next);
      setPage(1);
    },
  });

  const onDataChange = useCallback(
    (_next: readonly DemoRow[], change: DataChange<DemoRow>) => {
      server.applyOps(change.ops);
      void queryClient.invalidateQueries({ queryKey: ["rows"] });
    },
    [queryClient, server],
  );

  return (
    <div className="w-full flex flex-col gap-2">
      <div className="text-sm text-muted-foreground">
        {query.isPending ? "Loading page…" : `Page ${pager.controls.page} of ${pager.controls.pageCount} · ${query.data?.total ?? 0} rows on the server`}
      </div>
      <div className="flex h-[420px] flex-col overflow-hidden rounded-md border border-border">
        <DataGridProvider data={query.data?.rows ?? []} columns={columns} getRowId={(row) => row.id} onDataChange={onDataChange}>
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

export default function DataGridPaginationReactQueryDemo(): ReactNode {
  const queryClient = useMemo(() => new QueryClient(), []);
  return (
    <QueryClientProvider client={queryClient}>
      <PaginatedReactQueryGrid />
    </QueryClientProvider>
  );
}
