"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
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

type Mode = "pages" | "scroll";

/**
 * The full server-side contract in one grid: header-click sort, filter menu, quick search, and paging are sent
 * to the fake server (~300 ms per request) and applied there - nothing is filtered or sorted client-side.
 * `useDataGridServerRows` owns the spec, aborts a stale request, and keeps the rows on screen while the next ones
 * load. `mode: "pages"` fetches one page per state and goes back to page 1 on a spec change; `mode: "scroll"`
 * sizes the grid from `totalRowCount` and fetches the blocks the rendered rows need. Edits go to the server from
 * `onSave`, then the rows are fetched again so you see the server's truth.
 */
export default function DataGridServerSideDemo(): ReactNode {
  const [mode, setMode] = useState<Mode>("pages");
  const remote = useMemo(() => createRemoteServer(), []);
  return (
    <div className="w-full flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant={mode === "pages" ? "default" : "outline"} aria-pressed={mode === "pages"} onClick={() => setMode("pages")}>
          Pages
        </Button>
        <Button type="button" size="sm" variant={mode === "scroll" ? "default" : "outline"} aria-pressed={mode === "scroll"} onClick={() => setMode("scroll")}>
          Scroll
        </Button>
        <span className="text-sm text-muted-foreground">sort, filter, search and paging are all server-side</span>
      </div>
      {mode === "pages" ? <PagesGrid key="pages" remote={remote} /> : <ScrollGrid key="scroll" remote={remote} />}
    </div>
  );
}

type Remote = ReturnType<typeof createRemoteServer>;

function PagesGrid({ remote }: { remote: Remote }): ReactNode {
  const server = useDataGridServerRows<DemoRow>({
    getRowId: (row) => row.id,
    defaultPageSize: 25,
    fetchRows: async ({ spec, page, pageSize, signal }) => {
      const answer = await remote.fetchPage({ page, pageSize, sorts: spec.sorts, filters: spec.filters as RemoteFilterNode[], search: spec.searchText, signal });
      return { rows: answer.rows, totalRowCount: answer.total };
    },
  });

  return (
    <>
      <div className="text-sm text-muted-foreground">{server.totalRowCount === null ? "Loading…" : `Page ${server.pager.page} of ${server.pager.pageCount} · ${server.totalRowCount} rows on the server`}</div>
      <div className="flex h-[420px] flex-col overflow-hidden rounded-md border border-border">
        <DataGridProvider
          {...server.providerProps}
          columns={columns}
          headerClickBehavior="sort"
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
    </>
  );
}

function ScrollGrid({ remote }: { remote: Remote }): ReactNode {
  const server = useDataGridServerRows<DemoRow>({
    mode: "scroll",
    getRowId: (row) => row.id,
    fetchRows: async ({ spec, start, end, signal }) => {
      const answer = await remote.fetchRange({ start, end, sorts: spec.sorts, filters: spec.filters as RemoteFilterNode[], search: spec.searchText, signal });
      return { rows: answer.rows, totalRowCount: answer.total };
    },
  });

  return (
    <>
      <div className="text-sm text-muted-foreground">{server.totalRowCount === null ? "Loading…" : `${server.totalRowCount} rows on the server · ${server.unloadedCount} not loaded yet`}</div>
      <div className="flex h-[420px] flex-col overflow-hidden rounded-md border border-border">
        <DataGridProvider
          {...server.providerProps}
          columns={columns}
          headerClickBehavior="sort"
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
      </div>
    </>
  );
}
