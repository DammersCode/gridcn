"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, defineColumns, useDataGridApi } from "@/registry/default/blocks/data-grid/data-grid";
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
 * `onSave`, then the rows are fetched again so you see the server's truth. Pages mode prefetches the next page, so
 * Next shows it with no wait; the toggle revalidates the rows every 10 seconds. The grid sorts by score. The Server
 * pushes switch pushes score changes every 500 ms: a row whose score the sort reads keeps its place and turns
 * dim and italic (`data-row-stale`) until the hook reshapes (a refresh) and the server places it. Delete on server
 * pushes a delete. The reshape delay select sets `reshapeDelay`: off waits for a refresh, one second reshapes after the pushes.
 */
export default function DataGridServerSideDemo(): ReactNode {
  const [mode, setMode] = useState<Mode>("pages");
  const remote = useMemo(() => createRemoteServer(), []);
  const [revalidate, setRevalidate] = useState(false);
  const [live, setLive] = useState(false);
  const [reshapeDelay, setReshapeDelay] = useState<"off" | "1000">("off");
  const push = { live, reshapeDelay: reshapeDelay === "off" ? undefined : Number(reshapeDelay) };
  return (
    <div className="w-full flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant={mode === "pages" ? "default" : "outline"} aria-pressed={mode === "pages"} onClick={() => setMode("pages")}>
          Pages
        </Button>
        <Button type="button" size="sm" variant={mode === "scroll" ? "default" : "outline"} aria-pressed={mode === "scroll"} onClick={() => setMode("scroll")}>
          Scroll
        </Button>
        <Button type="button" size="sm" variant={revalidate ? "default" : "outline"} aria-pressed={revalidate} onClick={() => setRevalidate((on) => !on)}>
          Revalidate every 10 s
        </Button>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={live} onCheckedChange={setLive} aria-label="Server pushes" />
          Server pushes
        </label>
        <Select value={reshapeDelay} onValueChange={(value) => setReshapeDelay(value as "off" | "1000")}>
          <SelectTrigger aria-label="Reshape delay" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="off">Reshape: off</SelectItem>
            <SelectItem value="1000">Reshape: 1 s</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">sort, filter, search and paging are all server-side</span>
      </div>
      {mode === "pages" ? <PagesGrid key="pages" remote={remote} revalidate={revalidate} {...push} /> : <ScrollGrid key="scroll" remote={remote} revalidate={revalidate} {...push} />}
    </div>
  );
}

type Remote = ReturnType<typeof createRemoteServer>;
type PushProps = { remote: Remote; live: boolean; reshapeDelay: number | undefined };

const BY_SCORE = { sorts: [{ columnId: "score", direction: "desc" as const }] };
const STALE_ROW = "[&_[data-row-stale]]:text-muted-foreground [&_[data-row-stale]]:italic";

/** Pushes the server's score changes into the grid while `live` is on, and deletes the first row on the server on demand. */
function PushControls({ remote, live }: { remote: Remote; live: boolean }): ReactNode {
  const api = useDataGridApi<DemoRow>();
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      const ids = api.getViewRowIds({ loaded: true }).slice(0, 8);
      api.actions.updateRows(remote.bumpScores(ids.slice(0, 3)));
    }, 500);
    return () => clearInterval(timer);
  }, [api, remote, live]);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() => {
        const first = api.getRow(0);
        if (!first) return;
        remote.remove([first.id]);
        api.actions.deleteRowsById([first.id], { source: "stream" });
      }}
    >
      Delete on server
    </Button>
  );
}

function PagesGrid({ remote, revalidate, live, reshapeDelay }: PushProps & { revalidate: boolean }): ReactNode {
  const server = useDataGridServerRows<DemoRow>({
    defaultPageSize: 25,
    defaultSpec: BY_SCORE,
    prefetchNextPage: true,
    revalidateInterval: revalidate ? 10_000 : undefined,
    reshapeDelay,
    onSave: async (change) => remote.applyOps(change.ops),
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
        >
          <DataGridToolbar>
            <DataGridSearch />
            <DataGridFilterMenu />
            <DataGridColumnsMenu />
            <PushControls remote={remote} live={live} />
          </DataGridToolbar>
          <DataGridRoot className={`min-h-0 flex-1 rounded-none border-none ${STALE_ROW}`} {...server.rootProps}>
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
        <DataGridPaginationBar {...server.pager} />
      </div>
    </>
  );
}

function ScrollGrid({ remote, revalidate, live, reshapeDelay }: PushProps & { revalidate: boolean }): ReactNode {
  const server = useDataGridServerRows<DemoRow>({
    mode: "scroll",
    defaultSpec: BY_SCORE,
    revalidateInterval: revalidate ? 10_000 : undefined,
    reshapeDelay,
    onSave: async (change) => remote.applyOps(change.ops),
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
        >
          <DataGridToolbar>
            <DataGridSearch />
            <DataGridFilterMenu />
            <DataGridColumnsMenu />
            <PushControls remote={remote} live={live} />
          </DataGridToolbar>
          <DataGridRoot className={`min-h-0 flex-1 rounded-none border-none ${STALE_ROW}`} {...server.rootProps}>
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      </div>
    </>
  );
}
