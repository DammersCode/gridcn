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
import { useDataGridServerPager, DataGridPaginationBar } from "@/registry/default/blocks/data-grid-pagination/data-grid-pagination";
import { type DemoRow } from "./demo-data";
import { createRemoteServer } from "./fake-remote-server";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 100, flex: 1 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 130, flex: 2 },
  { id: "role", header: "Role", accessorKey: "role", type: "text", width: 90, flex: 1 },
  { id: "score", header: "Logins (30 days)", accessorKey: "score", type: "number", width: 70, flex: 1 },
] as const);

/**
 * Server-mode pagination through TanStack Query: `useDataGridServerPager` only owns the page
 * math; `useQuery` fetches the current `[page, pageSize]` from the fake server (~300 ms), and
 * `keepPreviousData` keeps the old page on screen while the next one loads. `onDataChange` writes
 * the edit into the cached page, and `onSave` writes it to the fake server, then `invalidateQueries`
 * drops the cached pages so the grid refetches and shows the server's truth.
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

  const { pager } = useDataGridServerPager({
    page,
    pageSize,
    totalRowCount: query.data?.total ?? server.total,
    onPageChange: setPage,
    onPageSizeChange: (next) => {
      setPageSize(next);
      setPage(1);
    },
  });

  const onDataChange = useCallback(
    (next: readonly DemoRow[]) => {
      queryClient.setQueryData(["rows", page, pageSize], { rows: [...next], total: query.data?.total ?? server.total });
    },
    [page, pageSize, query.data?.total, queryClient, server],
  );

  const onSave = useCallback(
    async (change: DataChange<DemoRow>) => {
      server.applyOps(change.ops);
      await queryClient.invalidateQueries({ queryKey: ["rows"] });
    },
    [queryClient, server],
  );

  return (
    <div className="w-full flex flex-col gap-2">
      <div className="text-sm text-muted-foreground">
        {query.isPending ? "Loading page…" : `Page ${pager.page} of ${pager.pageCount} · ${query.data?.total ?? 0} rows on the server`}
      </div>
      <div className="flex h-[420px] flex-col overflow-hidden rounded-md border border-border">
        <DataGridProvider data={query.data?.rows ?? []} columns={columns} onDataChange={onDataChange} onSave={onSave}>
          <DataGridRoot className="min-h-0 flex-1 rounded-none border-none">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
        <DataGridPaginationBar {...pager} />
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
