"use client";

import { useMemo, type ReactNode } from "react";
import { DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridToolbar, DataGridSearch, DataGridFilterMenu, DataGridColumnsMenu } from "@/registry/default/blocks/data-grid-toolbar/data-grid-toolbar";
import { DataGridPaginationBar } from "@/registry/default/blocks/data-grid-pagination/data-grid-pagination";
import { useDataGridServerRows } from "@/registry/default/blocks/data-grid-server/data-grid-server";
import { type DemoRow } from "./demo-data";
import { createRemoteServer, type RemoteFilterNode } from "./fake-remote-server";

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

/**
 * The full server-side contract in one grid: header-click sort, filter menu, quick search, and pagination are sent
 * to the fake server (~300 ms per request) and applied there - nothing is filtered or sorted client-side.
 * `useDataGridServerRows` owns the spec and the page, aborts a stale request, goes back to page 1 on a spec change,
 * and keeps the last page on screen while the next one loads. Edits go to the server from `onSave`, then the page
 * is fetched again so you see the server's truth.
 */
export default function DataGridServerSideDemo(): ReactNode {
  const remote = useMemo(() => createRemoteServer(), []);
  const server = useDataGridServerRows<DemoRow>({
    getRowId: (row) => row.id,
    defaultPageSize: 25,
    fetchRows: async ({ spec, page, pageSize, signal }) => {
      const answer = await remote.fetchPage({ page, pageSize, sorts: spec.sorts, filters: spec.filters as RemoteFilterNode[], search: spec.search, signal });
      return { rows: answer.rows, totalRowCount: answer.total };
    },
  });

  return (
    <div className="w-full flex flex-col gap-2">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{server.gridProps.totalRowCount === null ? "Loading…" : `Page ${server.pager.page} of ${server.pager.pageCount} · ${server.gridProps.totalRowCount} rows on the server`}</span>
        <span>sort, filter, search and page are all server-side</span>
      </div>
      <div className="flex h-[420px] flex-col overflow-hidden rounded-md border border-border">
        <DataGridProvider
          {...server.providerProps}
          columns={columns}
          onSave={(change) => {
            remote.applyOps(change.ops);
            server.refresh();
          }}
        >
          <DataGridToolbar>
            <DataGridSearch />
            <DataGridFilterMenu />
            <DataGridColumnsMenu />
          </DataGridToolbar>
          <DataGridRoot className="min-h-0 flex-1 rounded-none border-none" {...server.rootProps}>
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
        <DataGridPaginationBar {...server.pager} />
      </div>
    </div>
  );
}
