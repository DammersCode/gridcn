"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridServerRows } from "@/registry/default/blocks/data-grid-server/data-grid-server";
import { describeFilterOperators, withColumnMap } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query";
import type { LoggedQuery, QueryDemoRow } from "./data-grid-server-query-demo-db";

const columnDefs = defineColumns<QueryDemoRow>()([
  { id: "region", header: "Region", accessorKey: "region", type: "select", width: 120 },
  { id: "make", header: "Make", accessorKey: "make", type: "select", width: 110 },
  { id: "price", header: "Revenue", accessorKey: "price", type: "number", width: 120, aggregate: "sum" },
] as const);

type Demo = Awaited<ReturnType<typeof import("./data-grid-server-query-demo-db").createQueryDemo>>;

const loadDemo = (onQuery: (entry: LoggedQuery) => void) => import("./data-grid-server-query-demo-db").then(({ createQueryDemo }) => createQueryDemo(onQuery));

function PivotGrid({ demo, lastQuery }: { demo: Demo; lastQuery: LoggedQuery | undefined }): ReactNode {
  const columns = useMemo(() => withColumnMap(columnDefs, describeFilterOperators(demo.columns)), [demo.columns]);
  const server = useDataGridServerRows<QueryDemoRow>({
    mode: "scroll",
    getRowId: (row) => String(row.id),
    defaultSpec: {
      sorts: [],
      filters: [],
      searchText: "",
      groupBy: ["region"],
      aggregates: [{ columnId: "price", reducer: "sum" }],
      pivot: { columnIds: ["make"] },
    },
    fetchRows: ({ signal, ...request }) => demo.query.fetchRows(request, { signal }),
  });
  return (
    <div className="flex w-full flex-col gap-2">
      <DataGridProvider {...server.providerProps} columns={columns} readOnly>
        <div className="flex h-[240px] flex-col overflow-hidden rounded-md border border-border">
          <DataGridRoot aria-label="Car sales revenue per region and make, pivoted on the server" className="min-h-0 flex-1 rounded-[inherit] border-none" {...server.rootProps}>
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </div>
      </DataGridProvider>
      <div className="rounded-md border border-border bg-muted/40 p-3 text-xs">
        <p className="mb-1 font-medium text-foreground">Last statement</p>
        <pre className="whitespace-pre-wrap break-all font-mono text-foreground">{lastQuery?.sql ?? "None yet."}</pre>
        <pre className="whitespace-pre-wrap break-all font-mono text-muted-foreground">{lastQuery ? `params: ${JSON.stringify(lastQuery.params)}` : null}</pre>
      </div>
    </div>
  );
}

/** A server pivot on an in-browser PostgreSQL: one row per region, one generated column per make, each cell the revenue of the cars sold. */
export default function DataGridServerPivotDemo(): ReactNode {
  const [demo, setDemo] = useState<Demo | null>(null);
  const [lastQuery, setLastQuery] = useState<LoggedQuery>();

  useEffect(() => {
    let cancelled = false;
    void loadDemo(setLastQuery).then((ready) => {
      if (!cancelled) setDemo(ready);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!demo) {
    return <div className="flex h-[300px] w-full items-center justify-center rounded-md border border-border text-sm text-muted-foreground">Starting the in-browser database…</div>;
  }
  return <PivotGrid demo={demo} lastQuery={lastQuery} />;
}
