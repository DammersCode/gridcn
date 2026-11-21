"use client";

import { useMemo, type ReactNode } from "react";
import { DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridServerRows } from "@/registry/default/blocks/data-grid-server/data-grid-server";
import { serverAggregateRow, useDataGridPinnedRows } from "@/registry/default/blocks/data-grid-pinned-rows/data-grid-pinned-rows";
import { DataGridHeaderFilter } from "@/registry/default/blocks/data-grid-toolbar/data-grid-toolbar";
import { createRemoteServer, type RemoteFilterNode } from "./fake-remote-server";
import { generateSales, type SaleRow } from "./sales-data";

const columns = defineColumns<SaleRow>()([
  { id: "customer", header: "Customer", accessorKey: "customer", type: "text", width: 140, flex: 1 },
  { id: "make", header: "Make", accessorKey: "make", type: "text", width: 100, flex: 1 },
  { id: "model", header: "Model", accessorKey: "model", type: "text", width: 100, flex: 1 },
  { id: "price", header: "Price", accessorKey: "price", type: "number", width: 110, flex: 1 },
] as const);

/**
 * A scrolling grid over a fake server with a totals row that the server computes. The grid holds only the loaded blocks, but the
 * band sums the price of the whole filtered result: `fetchAggregates` receives the spec, so a filter change requests new totals. The band dims
 * while the request runs and keeps the old numbers until the answer lands.
 */
export default function DataGridServerTotalsDemo(): ReactNode {
  const remote = useMemo(() => createRemoteServer({ rows: generateSales(1000) }), []);
  const totals = useMemo(
    () =>
      serverAggregateRow({
        columnIds: ["price"],
        cells: { id: "__totals__", customer: "Total revenue" },
        fetchAggregates: async ({ spec, signal }) => {
          const all = await remote.fetchRange({ start: 0, end: remote.total, filters: spec.filters as RemoteFilterNode[], signal });
          return { price: all.rows.reduce((sum, row) => sum + row.price, 0) };
        },
      }),
    [remote],
  );

  const server = useDataGridServerRows<SaleRow>({
    mode: "scroll",
    fetchRows: async ({ start, end, signal, spec }) => {
      const page = await remote.fetchRange({ start, end, filters: spec.filters as RemoteFilterNode[], signal });
      return { rows: page.rows, totalRowCount: page.total };
    },
  });

  const { plugin } = useDataGridPinnedRows({ bottomRows: [totals] });
  const plugins = useMemo(() => [...server.providerProps.plugins, plugin], [server.providerProps.plugins, plugin]);

  return (
    <div className="w-full flex flex-col gap-2">
      <span className="text-sm text-muted-foreground">{(server.totalRowCount ?? remote.total).toLocaleString("en-US")} rows match</span>
      <div className="flex h-[420px] flex-col overflow-hidden rounded-md border border-border">
        <DataGridProvider
          {...server.providerProps}
          columns={columns}
          plugins={plugins}
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
