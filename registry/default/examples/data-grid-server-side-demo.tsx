"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
  useDataGridSortState,
  useDataGridFilterState,
  useDataGridJoinOperator,
  useDataGridSearchText,
  type DataChange,
} from "@/registry/default/blocks/data-grid/data-grid";
import {
  DataGridToolbar,
  DataGridSearch,
  DataGridFilterMenu,
  DataGridColumnsMenu,
} from "@/registry/default/blocks/data-grid-toolbar/data-grid-toolbar";
import { useDataGridPagination, DataGridPaginationBar } from "@/registry/default/blocks/data-grid-pagination/data-grid-pagination";
import { type DemoRow } from "./demo-data";
import { createRemoteServer } from "./fake-remote-server";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 120, flex: 1 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 150, flex: 2 },
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
    width: 100,
    filterable: true,
  },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 70, flex: 1 },
] as const);

type RemotePage = { rows: DemoRow[]; total: number };

/**
 * Lives inside the provider so it can read the grid's store (sort/filter/search) and turn every
 * state change into one query. Reports the fetched page up via `onLoaded`, because the
 * `data` prop that feeds it sits outside the provider.
 */
function RemoteStateBridge({
  server,
  page,
  pageSize,
  onLoaded,
}: {
  server: ReturnType<typeof createRemoteServer>;
  page: number;
  pageSize: number;
  onLoaded: (data: RemotePage) => void;
}): ReactNode {
  const sortState = useDataGridSortState();
  const filterState = useDataGridFilterState();
  const joinOperator = useDataGridJoinOperator();
  const searchText = useDataGridSearchText();

  const query = useQuery({
    queryKey: ["rows", page, pageSize, sortState, filterState, joinOperator, searchText],
    queryFn: () =>
      server.fetchPage({ page, pageSize, sorts: sortState, filters: filterState, join: joinOperator, search: searchText }),
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    if (query.data) onLoaded(query.data);
  }, [query.data, onLoaded]);

  return null;
}

/**
 * The full server-side contract in one grid: header-click sort, filter menu, quick search, and
 * pagination are all sent to the fake server (~300 ms per request) and applied there - nothing
 * is filtered or sorted client-side. Each view state is a `useQuery` key, so revisiting a state
 * is instant from the query cache, and `keepPreviousData` keeps the previous page on screen while
 * the next one loads. Edits write through to the fake server, then `invalidateQueries` refetches
 * the current page so you see the server's truth. `headerClickBehavior="sort"` makes sorting
 * reachable via plain header clicks.
 */
function ServerSideGrid(): ReactNode {
  const server = useMemo(() => createRemoteServer(), []);
  const queryClient = useQueryClient();
  const [data, setData] = useState<RemotePage | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const handleLoaded = useCallback((next: RemotePage) => setData(next), []);

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
      void queryClient.invalidateQueries({ queryKey: ["rows"] });
    },
    [queryClient, server],
  );

  return (
    <div className="w-full flex flex-col gap-2">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {data
            ? `Page ${pager.controls.page} of ${pager.controls.pageCount} · ${data.total} rows on the server`
            : "Loading…"}
        </span>
        <span>sort, filter, search and page are all server-side</span>
      </div>
      <div className="flex h-[420px] flex-col overflow-hidden rounded-md border border-border">
        <DataGridProvider
          data={data?.rows ?? []}
          columns={columns}
          getRowId={(row) => row.id}
          headerClickBehavior="sort"
          onDataChange={onDataChange}
        >
          <RemoteStateBridge server={server} page={pager.controls.page} pageSize={pager.controls.pageSize} onLoaded={handleLoaded} />
          <DataGridToolbar>
            <DataGridSearch />
            <DataGridFilterMenu />
            <DataGridColumnsMenu />
          </DataGridToolbar>
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

export default function DataGridServerSideDemo(): ReactNode {
  const queryClient = useMemo(() => new QueryClient(), []);
  return (
    <QueryClientProvider client={queryClient}>
      <ServerSideGrid />
    </QueryClientProvider>
  );
}
