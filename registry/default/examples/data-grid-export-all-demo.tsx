"use client";

import { useMemo, type ReactNode } from "react";
import { DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridToolbar, DataGridSearch, DataGridFilterMenu } from "@/registry/default/blocks/data-grid-toolbar/data-grid-toolbar";
import { DataGridPaginationBar } from "@/registry/default/blocks/data-grid-pagination/data-grid-pagination";
import { useDataGridServerRows } from "@/registry/default/blocks/data-grid-server/data-grid-server";
import { DataGridExportButton, DataGridImportButton, type ExportSourceContext } from "@/registry/default/blocks/data-grid-io/data-grid-io";
import { type DemoRow } from "./demo-data";
import { createRemoteServer, type RemoteFilterNode } from "./fake-remote-server";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 120, flex: 1 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 150, flex: 2 },
  { id: "score", header: "Logins (30 days)", accessorKey: "score", type: "number", width: 70, flex: 1 },
] as const);

const BATCH = 200;
let importedCount = 0;

function createImportedRow(): DemoRow {
  return { id: `imported-${importedCount++}`, name: "", email: "", age: 18, active: false, role: "User", joined: "", score: 0 };
}

type Remote = ReturnType<typeof createRemoteServer>;

function createExportSource(remote: Remote) {
  return async function* exportSource({ spec, signal }: ExportSourceContext): AsyncGenerator<DemoRow[]> {
    for (let start = 0; ; start += BATCH) {
      const answer = await remote.fetchRange({ start, end: start + BATCH, sorts: spec.sorts, filters: spec.filters as RemoteFilterNode[], search: spec.searchText, signal });
      if (answer.rows.length === 0) return;
      yield answer.rows;
    }
  };
}

/** A paged server grid whose export menu holds "Export all rows" (the whole filtered result, fetched in batches) and whose import sends the rows to the server, then refreshes. */
export default function DataGridExportAllDemo(): ReactNode {
  const remote = useMemo(() => createRemoteServer(), []);
  const server = useDataGridServerRows<DemoRow>({
    defaultPageSize: 25,
    fetchRows: async ({ spec, page, pageSize, signal }) => {
      const answer = await remote.fetchPage({ page, pageSize, sorts: spec.sorts, filters: spec.filters as RemoteFilterNode[], search: spec.searchText, signal });
      return { rows: answer.rows, totalRowCount: answer.total };
    },
  });

  const exportSource = useMemo(() => createExportSource(remote), [remote]);

  return (
    <div className="flex w-full flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        {server.totalRowCount === null ? "Loading…" : `${server.totalRowCount} rows on the server`}. Filter or search, then use the download menu: the plain items export this page, "Export all rows" exports the whole result. Import adds the file's rows on the server.
      </p>
      <div className="flex h-[420px] flex-col overflow-hidden rounded-md border border-border">
        <DataGridProvider {...server.providerProps} columns={columns} headerClickBehavior="sort">
          <DataGridToolbar>
            <DataGridSearch />
            <DataGridFilterMenu />
            <DataGridImportButton
              createRow={createImportedRow}
              onImport={async (rows) => {
                remote.applyOps(rows.map((row, index) => ({ type: "insert" as const, rowId: row.id, row, index })));
                server.refresh();
              }}
            />
            <DataGridExportButton options={{ source: exportSource, fileName: "server-result" }} />
          </DataGridToolbar>
          <DataGridRoot className="min-h-0 flex-1 rounded-none border-none" {...server.rootProps}>
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
        <DataGridPaginationBar {...server.pager} />
      </div>
    </div>
  );
}
