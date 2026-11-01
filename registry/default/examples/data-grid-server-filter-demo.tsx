"use client";

import { useMemo, type ReactNode } from "react";
import { DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridServerRows } from "@/registry/default/blocks/data-grid-server/data-grid-server";
import { DataGridHeaderFilter } from "@/registry/default/blocks/data-grid-toolbar/data-grid-toolbar";
import type { DemoRow } from "./demo-data";
import { createRemoteServer, type RemoteFilterNode } from "./fake-remote-server";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 120, flex: 1 },
  { id: "role", header: "Role", accessorKey: "role", type: "text", width: 110, flex: 1 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 90, flex: 1 },
] as const);

/**
 * A scrolling grid filtered by a fake server. `useDataGridServerRows` sets `filterMode="server"`, so the view keeps the rows as
 * fetched, the header filter lists the server's values through `fetchFilterValues`, and a filter change starts the blocks over with
 * the new spec. Each answer carries the matching row count.
 */
export default function DataGridServerFilterDemo(): ReactNode {
  const remote = useMemo(() => createRemoteServer(), []);

  const server = useDataGridServerRows<DemoRow>({
    mode: "scroll",
    getRowId: (row) => row.id,
    fetchRows: async ({ start, end, signal, spec }) => {
      const page = await remote.fetchRange({ start, end, filters: spec.filters as RemoteFilterNode[], signal });
      return { rows: page.rows, totalRowCount: page.total };
    },
  });

  return (
    <div className="w-full flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        {(server.totalRowCount ?? remote.total).toLocaleString("en-US")} rows match<span className={server.loading ? undefined : "invisible"}> · fetching…</span>
      </p>
      <div className="flex h-[420px] flex-col overflow-hidden rounded-md border border-border">
        <DataGridProvider
          {...server.providerProps}
          columns={columns}
          fetchFilterValues={({ columnId, query, filters, signal }) => remote.fetchValues({ columnId, search: query, filters: filters as RemoteFilterNode[], signal })}
          readOnly
        >
          <DataGridRoot className="min-h-0 flex-1 rounded-none border-none" renderHeaderFilter={(ctx) => <DataGridHeaderFilter {...ctx} />} {...server.rootProps}>
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      </div>
    </div>
  );
}
