"use client";

import { useMemo, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, useInfiniteQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridPagination, DataGridPaginationBar } from "@/registry/default/blocks/data-grid-pagination/data-grid-pagination";
import { type DemoRow } from "./demo-data";
import { createRemoteServer } from "./fake-remote-server";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 100, flex: 1, readOnly: true },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 130, flex: 2, readOnly: true },
  { id: "role", header: "Role", accessorKey: "role", type: "text", width: 90, flex: 1, readOnly: true },
] as const);

const getRowId = (row: DemoRow) => row.id;

/** A keyset source through `useInfiniteQuery`: each page's `next` cursor is the next `pageParam`. */
function useCursorRows(limit: number) {
  const server = useMemo(() => createRemoteServer(), []);
  return useInfiniteQuery({
    queryKey: ["cursor-rows", limit],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => server.fetchAfter({ after: pageParam, limit, signal }),
    getNextPageParam: (last) => last.next ?? undefined,
  });
}

function InfiniteScroll(): ReactNode {
  const query = useCursorRows(50);
  const rows = useMemo(() => query.data?.pages.flatMap((page) => page.rows) ?? [], [query.data]);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm text-muted-foreground">
        {rows.length} rows so far{hasNextPage ? ", more available" : ", end of the list"}
        <span className={isFetchingNextPage || query.isPending ? undefined : "invisible"}> · fetching…</span>
      </div>
      <div className="h-[360px] overflow-hidden rounded-md border border-border">
        <DataGridProvider
          data={rows}
          columns={columns}
          getRowId={getRowId}
          onRenderedRowsChange={({ end }) => {
            if (hasNextPage && !isFetchingNextPage && end >= rows.length - 20) void fetchNextPage();
          }}
        >
          <DataGridRoot className="h-full">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      </div>
    </div>
  );
}

const PAGE_SIZE = 10;

function Pages(): ReactNode {
  const query = useCursorRows(PAGE_SIZE);
  const [page, setPage] = useState(1);
  const loaded = query.data?.pages.length ?? 0;
  const { pager } = useDataGridPagination({
    page,
    pageSize: PAGE_SIZE,
    totalRowCount: null,
    hasNextPage: page < loaded || query.hasNextPage,
    pageSizeOptions: [PAGE_SIZE],
    onPageChange: (next) => {
      if (next <= loaded) setPage(next);
      else void query.fetchNextPage().then((result) => (result.data?.pages.length ?? 0) >= next && setPage(next));
    },
  });
  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm text-muted-foreground">{query.isFetching ? "Fetching…" : "Pages already loaded come from the query cache."}</div>
      <div className="flex h-[360px] flex-col overflow-hidden rounded-md border border-border">
        <DataGridProvider data={query.data?.pages[page - 1]?.rows ?? []} columns={columns} getRowId={getRowId}>
          <DataGridRoot className="min-h-0 flex-1">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
        <DataGridPaginationBar {...pager} />
      </div>
    </div>
  );
}

/** A cursor source without a row count through TanStack Query: infinite scroll and a pager over `useInfiniteQuery`. */
export default function DataGridCursorReactQueryDemo(): ReactNode {
  const queryClient = useMemo(() => new QueryClient(), []);
  const [mode, setMode] = useState<"infinite" | "pages">("infinite");
  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex w-full flex-col gap-3">
        <div className="flex gap-2">
          <Button type="button" size="xs" variant={mode === "infinite" ? "default" : "outline"} onClick={() => setMode("infinite")}>
            Infinite scroll
          </Button>
          <Button type="button" size="xs" variant={mode === "pages" ? "default" : "outline"} onClick={() => setMode("pages")}>
            Pages without a total
          </Button>
        </div>
        {mode === "infinite" ? <InfiniteScroll key="infinite" /> : <Pages key="pages" />}
      </div>
    </QueryClientProvider>
  );
}
