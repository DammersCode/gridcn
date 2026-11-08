"use client";

import { useMemo, useState, type ReactNode } from "react";
import { DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridServerRows } from "@/registry/default/blocks/data-grid-server/data-grid-server";
import {
  DataGridServerAggregateReporter,
  PENDING_SERVER_AGGREGATE,
  useDataGridPinnedRows,
  type ServerAggregateResult,
} from "@/registry/default/blocks/data-grid-pinned-rows/data-grid-pinned-rows";
import { DataGridHeaderFilter } from "@/registry/default/blocks/data-grid-toolbar/data-grid-toolbar";
import { Button } from "@/components/ui/button";
import type { DemoRow } from "./demo-data";
import { createRemoteServer, type RemoteFilterNode } from "./fake-remote-server";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 120, flex: 1 },
  { id: "role", header: "Role", accessorKey: "role", type: "text", width: 110, flex: 1 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 90, flex: 1 },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 90, flex: 1 },
] as const);

/**
 * A scrolling grid over a fake server with a totals row that the server computes. The grid holds only the loaded blocks, but the
 * band sums the whole filtered result: `fetchAggregates` receives the spec, so a filter change requests new totals. The band dims
 * while the request runs and keeps the old numbers until the answer lands.
 */
export default function DataGridServerTotalsDemo(): ReactNode {
  const remote = useMemo(() => createRemoteServer(), []);
  const [aggregate, setAggregate] = useState<ServerAggregateResult>(PENDING_SERVER_AGGREGATE);

  const server = useDataGridServerRows<DemoRow>({
    mode: "scroll",
    fetchRows: async ({ start, end, signal, spec }) => {
      const page = await remote.fetchRange({ start, end, filters: spec.filters as RemoteFilterNode[], signal });
      return { rows: page.rows, totalRowCount: page.total };
    },
  });

  const bottomRows = useMemo(() => [{ id: "__totals__", name: "Total", ...aggregate.row }], [aggregate.row]);
  const { plugin } = useDataGridPinnedRows({ bottomRows, status: aggregate.status });
  const plugins = useMemo(() => [...server.providerProps.plugins, plugin], [server.providerProps.plugins, plugin]);

  return (
    <div className="w-full flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>
          {(server.totalRowCount ?? remote.total).toLocaleString("en-US")} rows match · totals {aggregate.status}
        </span>
        <Button type="button" size="sm" variant="outline" onClick={aggregate.status === "error" ? aggregate.retry : aggregate.refresh}>
          {aggregate.status === "error" ? "Retry totals" : "Refresh totals"}
        </Button>
      </div>
      <div className="flex h-[420px] flex-col overflow-hidden rounded-md border border-border">
        <DataGridProvider
          {...server.providerProps}
          columns={columns}
          plugins={plugins}
          fetchFilterValues={({ columnId, query, filters, signal }) => remote.fetchValues({ columnId, search: query, filters: filters as RemoteFilterNode[], signal })}
          readOnly
        >
          <DataGridServerAggregateReporter
            columnIds={["age", "score"]}
            onChange={setAggregate}
            fetchAggregates={async ({ spec, signal }) => {
              const all = await remote.fetchRange({ start: 0, end: remote.total, filters: spec.filters as RemoteFilterNode[], signal });
              return {
                age: all.rows.reduce((sum, row) => sum + row.age, 0),
                score: all.rows.reduce((sum, row) => sum + row.score, 0),
              };
            }}
          />
          <DataGridRoot className="min-h-0 flex-1 rounded-none border-none" renderHeaderFilter={(ctx) => <DataGridHeaderFilter {...ctx} />} {...server.rootProps}>
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      </div>
    </div>
  );
}
