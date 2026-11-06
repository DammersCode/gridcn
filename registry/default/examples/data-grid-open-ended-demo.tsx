"use client";

import { useState, type ComponentProps, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, defineColumns, type DataChange } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridServerRows } from "@/registry/default/blocks/data-grid-server/data-grid-server";
import { DataGridPaginationBar } from "@/registry/default/blocks/data-grid-pagination/data-grid-pagination";

type Row = { id: string; name: string; email: string };

const LATENCY_MS = 300;
const SERVER_SIZE = 1_234;

const columns = defineColumns<Row>()([
  { id: "id", header: "ID", accessorKey: "id", type: "text", width: 80, readOnly: true },
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 140, flex: 1 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 180, flex: 2 },
] as const);

const rowAt = (index: number): Row => ({ id: `row-${index}`, name: `Person ${index}`, email: `person${index}@example.com` });

type Page = { rows: Row[]; nextCursor: string | null };

/** A keyset API: the cursor is an opaque token for "after this row", and the response carries no count. */
async function fetchAfter(cursor: string | undefined, limit: number, signal: AbortSignal): Promise<Page> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, LATENCY_MS);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    });
  });
  const from = cursor === undefined ? 0 : Number(cursor.slice("after:".length)) + 1;
  const to = Math.min(from + limit, SERVER_SIZE);
  const rows = Array.from({ length: to - from }, (_, i) => rowAt(from + i));
  return { rows, nextCursor: to < SERVER_SIZE ? `after:${to - 1}` : null };
}

function Grid({ data, getRowId, onDataChange, onRenderedRowsChange, plugins }: {
  data: readonly Row[];
  getRowId: (row: Row, index: number) => string;
  onDataChange?: (next: readonly Row[], change: DataChange<Row>) => void;
  onRenderedRowsChange?: (range: { start: number; end: number }) => void;
  plugins?: ComponentProps<typeof DataGridProvider<Row>>["plugins"];
}): ReactNode {
  return (
    <div className="h-[360px] overflow-hidden rounded-md border border-border">
      <DataGridProvider data={data} columns={columns} getRowId={getRowId} onDataChange={onDataChange} onRenderedRowsChange={onRenderedRowsChange} plugins={plugins}>
        <DataGridRoot className="h-full">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    </div>
  );
}

function InfiniteScroll(): ReactNode {
  const server = useDataGridServerRows<Row, string>({
    mode: "scroll",
    blockSize: 50,
    getRowId: (row) => row.id,
    fetchRows: async ({ cursor, start, end, signal }) => fetchAfter(cursor, end - start, signal),
  });
  const { data, getRowId, onDataChange, onRenderedRowsChange, plugins } = server.providerProps;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {server.totalRowCount === null ? `${data.length - server.unloadedCount} rows so far, more available` : `${server.totalRowCount} rows, end of the list`}
          <span className={server.loading ? undefined : "invisible"}> · fetching…</span>
        </span>
        <Button type="button" variant="outline" size="xs" onClick={server.refresh}>
          Refresh
        </Button>
      </div>
      <Grid data={data} getRowId={getRowId} onDataChange={onDataChange} onRenderedRowsChange={onRenderedRowsChange} plugins={plugins} />
    </div>
  );
}

function KeysetPages(): ReactNode {
  const server = useDataGridServerRows<Row, string>({
    pageSizeOptions: [10],
    getRowId: (row) => row.id,
    fetchRows: async ({ cursor, pageSize, signal }) => fetchAfter(cursor, pageSize, signal),
  });
  const { data, getRowId, onDataChange, plugins } = server.providerProps;
  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm text-muted-foreground">{server.loading ? "Fetching…" : "The server sends a cursor and no total."}</div>
      <Grid data={data} getRowId={getRowId} onDataChange={onDataChange} plugins={plugins} />
      <DataGridPaginationBar {...server.pager} />
    </div>
  );
}

/** Two ways to connect a server that sends no row count: infinite scroll and pages, both following the cursor chain the hook keeps. */
export default function DataGridOpenEndedDemo(): ReactNode {
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
      {mode === "infinite" ? <InfiniteScroll key="infinite" /> : <KeysetPages key="pages" />}
    </div>
  );
}
