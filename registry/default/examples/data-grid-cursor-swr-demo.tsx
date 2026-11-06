"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import useSWRInfinite from "swr/infinite";
import { Button } from "@/components/ui/button";
import { DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridServerPager, DataGridPaginationBar } from "@/registry/default/blocks/data-grid-pagination/data-grid-pagination";
import { type DemoRow } from "./demo-data";
import { createRemoteServer } from "./fake-remote-server";

type CursorPage = { rows: DemoRow[]; next: string | null };
type CursorKey = readonly [scope: string, limit: number, after: string | undefined];

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 100, flex: 1, readOnly: true },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 130, flex: 2, readOnly: true },
  { id: "role", header: "Role", accessorKey: "role", type: "text", width: 90, flex: 1, readOnly: true },
] as const);

const getRowId = (row: DemoRow) => row.id;

/** A keyset source through `useSWRInfinite`: the key getter returns `null` after the last page, which ends the chain. */
function useCursorRows(limit: number) {
  const server = useMemo(() => createRemoteServer(), []);
  const scope = useId();
  const swr = useSWRInfinite<CursorPage, Error, (index: number, previous: CursorPage | null) => CursorKey | null>(
    (_index, previous) => (previous && previous.next === null ? null : [scope, limit, previous?.next ?? undefined]),
    ([, size, after]) => server.fetchAfter({ after, limit: size }),
    { revalidateFirstPage: false },
  );
  const last = swr.data?.[swr.data.length - 1];
  return { ...swr, hasNextPage: last === undefined || last.next !== null };
}

function InfiniteScroll(): ReactNode {
  const { data, size: loadedPages, setSize, isValidating, hasNextPage } = useCursorRows(50);
  const rows = useMemo(() => data?.flatMap((page) => page.rows) ?? [], [data]);
  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm text-muted-foreground">
        {rows.length} rows so far{hasNextPage ? ", more available" : ", end of the list"}
        <span className={isValidating ? undefined : "invisible"}> · fetching…</span>
      </div>
      <div className="h-[360px] overflow-hidden rounded-md border border-border">
        <DataGridProvider
          data={rows}
          columns={columns}
          getRowId={getRowId}
          onRenderedRowsChange={({ end }) => {
            if (hasNextPage && !isValidating && data?.length === loadedPages && end >= rows.length - 20) void setSize(loadedPages + 1);
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
  const { data, setSize, isValidating, hasNextPage } = useCursorRows(PAGE_SIZE);
  const [page, setPage] = useState(1);
  const loaded = data?.length ?? 0;
  const { pager } = useDataGridServerPager({
    page,
    pageSize: PAGE_SIZE,
    totalRowCount: null,
    hasMore: page < loaded || hasNextPage,
    pageSizeOptions: [PAGE_SIZE],
    onPageChange: (next) => {
      if (next <= loaded) setPage(next);
      else void setSize(next).then((pages) => (pages?.length ?? 0) >= next && setPage(next));
    },
  });
  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm text-muted-foreground">{isValidating ? "Fetching…" : "Pages already loaded come from the SWR cache."}</div>
      <div className="flex h-[360px] flex-col overflow-hidden rounded-md border border-border">
        <DataGridProvider data={data?.[page - 1]?.rows ?? []} columns={columns} getRowId={getRowId}>
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

/** A cursor source without a row count through SWR: infinite scroll and a pager over `useSWRInfinite`. */
export default function DataGridCursorSwrDemo(): ReactNode {
  const [mode, setMode] = useState<"infinite" | "pages">("infinite");
  return (
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
  );
}
