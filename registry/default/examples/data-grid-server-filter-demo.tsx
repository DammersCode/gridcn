"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, defineColumns, type FilterNode } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridLazyRows } from "@/registry/default/blocks/data-grid-lazy/data-grid-lazy";
import { DataGridHeaderFilter } from "@/registry/default/blocks/data-grid-toolbar/data-grid-toolbar";
import type { DemoRow } from "./demo-data";
import { createRemoteServer, type RemoteFilterNode } from "./fake-remote-server";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 120, flex: 1 },
  { id: "role", header: "Role", accessorKey: "role", type: "text", width: 110, flex: 1 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 90, flex: 1 },
] as const);

/**
 * A lazy grid filtered by a fake server. `filterMode="server"` keeps the view as an identity map, the
 * header filter lists the server's values through `fetchFilterValues`, and a filter change asks the
 * server for the new total before it resets the loaded rows.
 */
export default function DataGridServerFilterDemo(): ReactNode {
  const server = useMemo(() => createRemoteServer(), []);
  const [applied, setApplied] = useState<{ filters: readonly RemoteFilterNode[]; total: number }>({ filters: [], total: server.total });
  const latestChange = useRef(0);

  const lazy = useDataGridLazyRows<DemoRow>({
    total: applied.total,
    getRowId: (row) => row.id,
    fetchRows: (start, end, signal) => server.fetchRange({ start, end, filters: applied.filters, signal }).then((page) => page.rows),
  });

  const onFilterChange = async (next: FilterNode[]) => {
    const change = ++latestChange.current;
    const { total } = await server.fetchRange({ start: 0, end: 0, filters: next as RemoteFilterNode[] });
    if (change !== latestChange.current) return;
    setApplied({ filters: next as RemoteFilterNode[], total });
    lazy.reset();
  };

  return (
    <div className="w-full flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        {applied.total.toLocaleString("en-US")} rows match{lazy.isLoading && " · fetching…"}
      </p>
      <div className="flex h-[420px] flex-col overflow-hidden rounded-md border border-border">
        <DataGridProvider
          data={lazy.gridProps.data}
          columns={columns}
          getRowId={lazy.gridProps.getRowId}
          onDataChange={lazy.onDataChange}
          onRenderedRowsChange={lazy.gridProps.onRenderedRowsChange}
          filterMode="server"
          onFilterChange={onFilterChange}
          fetchFilterValues={({ columnId, search, filters, signal }) => server.fetchValues({ columnId, search, filters: filters as RemoteFilterNode[], signal })}
          readOnly
        >
          <DataGridRoot className="min-h-0 flex-1 rounded-none border-none" renderHeaderFilter={(ctx) => <DataGridHeaderFilter {...ctx} />}>
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      </div>
    </div>
  );
}
