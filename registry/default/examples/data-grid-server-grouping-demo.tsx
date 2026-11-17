"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, defineColumns, useDataGridActions } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridServerRows } from "@/registry/default/blocks/data-grid-server/data-grid-server";
import { describeFilterOperators, withColumnMap } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query";
import type { LoggedQuery, QueryDemoRow } from "./data-grid-server-query-demo-db";

const columnDefs = defineColumns<QueryDemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 170, flex: 1, groupable: false },
  { id: "role", header: "Role", accessorKey: "role", type: "select", width: 110 },
  { id: "active", header: "Active", accessorFn: (row) => row.active === true, type: "checkbox", width: 90 },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 110, aggregate: "avg" },
] as const);

type Demo = Awaited<ReturnType<typeof import("./data-grid-server-query-demo-db").createQueryDemo>>;

const loadDemo = (onQuery: (entry: LoggedQuery) => void) => import("./data-grid-server-query-demo-db").then(({ createQueryDemo }) => createQueryDemo(onQuery));

function GroupControls(): ReactNode {
  const actions = useDataGridActions();
  return (
    <div className="flex gap-2">
      <Button size="sm" variant="outline" onClick={() => actions.setGroupBy(["role"])}>
        Group by role
      </Button>
      <Button size="sm" variant="outline" onClick={() => actions.setGroupBy(["role", "active"])}>
        Group by role, then active
      </Button>
      <Button size="sm" variant="outline" onClick={() => actions.setGroupBy([])}>
        Ungroup
      </Button>
    </div>
  );
}

function GroupedGrid({ demo, lastQuery }: { demo: Demo; lastQuery: LoggedQuery | undefined }): ReactNode {
  const columns = useMemo(() => withColumnMap(columnDefs, describeFilterOperators(demo.columns)), [demo.columns]);
  const server = useDataGridServerRows<QueryDemoRow>({
    mode: "scroll",
    getRowId: (row) => String(row.id),
    blockSize: 50,
    defaultSpec: { sorts: [], filters: [], searchText: "", groupBy: ["role"] },
    fetchRows: ({ signal, ...request }) => demo.query.fetchRows(request, { signal }),
  });
  return (
    <div className="flex w-full flex-col gap-2">
      <DataGridProvider {...server.providerProps} columns={columns} readOnly>
        <GroupControls />
        <div className="flex h-[360px] flex-col overflow-hidden rounded-md border border-border">
          <DataGridRoot aria-label="Users grouped on the server" className="min-h-0 flex-1 rounded-[inherit] border-none" {...server.rootProps}>
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

/** A grid grouped on an in-browser PostgreSQL. Each open group is one `fetchRows` request that the query layer answers with `group by`. */
export default function DataGridServerGroupingDemo(): ReactNode {
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
    return <div className="flex h-[420px] w-full items-center justify-center rounded-md border border-border text-sm text-muted-foreground">Starting the in-browser database…</div>;
  }
  return <GroupedGrid demo={demo} lastQuery={lastQuery} />;
}
