"use client";

import { Suspense, useMemo, type ReactNode } from "react";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
} from "@/registry/default/blocks/data-grid/data-grid";
import {
  DataGridToolbar,
  DataGridSearch,
  DataGridFilterMenu,
} from "@/registry/default/blocks/data-grid-toolbar/data-grid-toolbar";
import { DataGridUrlState, useDataGridUrlPagination } from "@/registry/default/blocks/data-grid-url-state/data-grid-url-state";
import { useDataGridPagination, DataGridPaginationBar, pageRange } from "@/registry/default/blocks/data-grid-pagination/data-grid-pagination";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 160 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 200 },
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
    width: 130,
    filterable: true,
  },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 90 },
] as const);

/** nuqs's app-router adapter reads `useSearchParams()`, which Next.js requires inside Suspense during static prerendering. */
function DataGridUrlStateDemoInner(): ReactNode {
  const rows = useMemo(() => generateDemoRows(60), []);
  // server mode simulates a real fetch: this add-on has nothing to do with the fetch itself, only the page/pageSize wiring.
  const url = useDataGridUrlPagination({ prefix: "demo", defaultPageSize: 10 });
  const pager = useDataGridPagination({ total: rows.length, ...url });
  const { start, end } = pageRange(pager.controls.page, pager.controls.pageSize, rows.length);
  const pageRows = rows.slice(start, end);

  return (
    <div className="w-full flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Sort, filter, search, or change page, then reload this page: the URL carries that state and the
        grid comes back exactly as you left it.
      </p>
      <div className="flex h-[420px] flex-col overflow-hidden rounded-md border border-border">
        {/* headerClickBehavior="sort" so the URL-synced sortState is actually reachable in this demo */}
        <DataGridProvider data={pageRows} columns={columns} getRowId={(row) => row.id} headerClickBehavior="sort">
          <DataGridUrlState prefix="demo" />
          <DataGridToolbar>
            <DataGridSearch />
            <DataGridFilterMenu />
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

/**
 * Sort/filter/search state synced to the URL via nuqs, and `page`/`pageSize` synced the same way
 * via `useDataGridUrlPagination` — reload the page or share the link and the grid's view comes
 * back exactly, including which page it was on. `NuqsAdapter` is app-router here
 * (`nuqs/adapters/next/app`); swap for your framework's adapter (pages router, Remix, React
 * Router, plain React) per the nuqs docs. In an app that already renders `NuqsAdapter` once near
 * the root, drop this inner wrapper — adapters must not be nested.
 */
export default function DataGridUrlStateDemo(): ReactNode {
  return (
    <NuqsAdapter>
      <Suspense fallback={null}>
        <DataGridUrlStateDemoInner />
      </Suspense>
    </NuqsAdapter>
  );
}
