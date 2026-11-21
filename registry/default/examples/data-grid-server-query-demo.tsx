"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Switch } from "@/components/ui/switch";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridServerRows } from "@/registry/default/blocks/data-grid-server/data-grid-server";
import { describeFilterOperators, withColumnMap } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query";
import { DataGridHeaderFilter } from "@/registry/default/blocks/data-grid-toolbar/data-grid-toolbar";
import type { LoggedQuery, QueryDemoRow } from "./data-grid-server-query-demo-db";

const columnDefs = defineColumns<QueryDemoRow>()([
  { id: "id", header: "Id", accessorKey: "id", type: "number", width: 70 },
  { id: "soldOn", header: "Sold on", accessorKey: "soldOn", type: "date", width: 110 },
  { id: "customer", header: "Customer", accessorKey: "customer", type: "text", width: 140, flex: 1 },
  { id: "region", header: "Region", accessorKey: "region", type: "select", width: 90 },
  { id: "dealership", header: "Dealership", accessorKey: "dealership", type: "select", width: 160 },
  { id: "salesperson", header: "Salesperson", accessorKey: "salesperson", type: "text", width: 130 },
  { id: "make", header: "Make", accessorKey: "make", type: "select", width: 90 },
  { id: "model", header: "Model", accessorKey: "model", type: "text", width: 90 },
  { id: "price", header: "Price", accessorKey: "price", type: "number", width: 90 },
  { id: "discount", header: "Discount", accessorKey: "discount", type: "number", width: 90 },
  { id: "financed", header: "Financed", accessorKey: "financed", type: "checkbox", width: 90 },
] as const);

const HOSTILE_FILTER = { filterId: "hostile", columnId: "customer", operator: "contains", value: "'; DROP TABLE car_sales; --" };

type Demo = Awaited<ReturnType<typeof import("./data-grid-server-query-demo-db").createQueryDemo>>;

const loadDemo = (onQuery: (entry: LoggedQuery) => void) => import("./data-grid-server-query-demo-db").then(({ createQueryDemo }) => createQueryDemo(onQuery));

/**
 * A grid over an in-browser PostgreSQL. Each request goes through `fetchRows` of the query layer, which reads the column map and runs
 * Drizzle. The panel shows the statement and the bound parameters of the last request. The switch adds a hostile filter value to every request.
 */
export default function DataGridServerQueryDemo(): ReactNode {
  const [demo, setDemo] = useState<Demo | null>(null);
  const [last, setLast] = useState<LoggedQuery[]>([]);
  const logRef = useRef<LoggedQuery[]>([]);

  useEffect(() => {
    let cancelled = false;
    void loadDemo((entry) => {
      logRef.current = [...logRef.current.slice(-1), entry];
      setLast(logRef.current);
    }).then((ready) => {
      if (!cancelled) setDemo(ready);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!demo) {
    return <div className="flex h-[420px] w-full items-center justify-center rounded-md border border-border text-sm text-muted-foreground">Starting the in-browser database…</div>;
  }
  return <QueryGrid demo={demo} last={last} />;
}

function QueryGrid({ demo, last }: { demo: Demo; last: LoggedQuery[] }): ReactNode {
  const [hostile, setHostile] = useState(false);
  return (
    <div className="flex w-full flex-col gap-2">
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <Switch checked={hostile} onCheckedChange={setHostile} />
        Add a hostile filter value
      </label>
      <HostileGrid key={String(hostile)} demo={demo} last={last} hostile={hostile} />
    </div>
  );
}

function HostileGrid({ demo, last, hostile }: { demo: Demo; last: LoggedQuery[]; hostile: boolean }): ReactNode {
  const columns = useMemo(() => withColumnMap(columnDefs, describeFilterOperators(demo.columns)), [demo.columns]);

  const server = useDataGridServerRows<QueryDemoRow>({
    mode: "scroll",
    getRowId: (row) => String(row.id),
    blockSize: 50,
    fetchRows: ({ signal, spec, ...request }) => {
      const filters = hostile ? [...spec.filters, HOSTILE_FILTER] : spec.filters;
      return demo.query.fetchRows({ ...request, spec: { ...spec, filters } }, { signal });
    },
  });

  return (
    <div className="flex w-full flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        {(server.totalRowCount ?? demo.total).toLocaleString("en-US")} rows match<span className={server.loading ? undefined : "invisible"}> · fetching…</span>
      </p>
      <div className="flex h-[360px] flex-col overflow-hidden rounded-md border border-border">
        <DataGridProvider
          {...server.providerProps}
          columns={columns}
          fetchFilterValues={({ columnId, query, filters }) => demo.query.filterValues({ columnId, query, filters })}
          readOnly
        >
          <DataGridRoot className="min-h-0 flex-1 rounded-[inherit] border-none" renderHeaderFilter={(ctx) => <DataGridHeaderFilter {...ctx} />} {...server.rootProps}>
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      </div>
      <div className="rounded-md border border-border bg-muted/40 p-3 text-xs">
        <p className="mb-1 font-medium text-foreground">Last statements</p>
        {last.length === 0 ? <p className="text-muted-foreground">None yet.</p> : null}
        {last.map((entry, index) => (
          <div key={index} className="mb-2 last:mb-0">
            <pre className="whitespace-pre-wrap break-all font-mono text-foreground">{entry.sql}</pre>
            <pre className="whitespace-pre-wrap break-all font-mono text-muted-foreground">params: {JSON.stringify(entry.params)}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}
