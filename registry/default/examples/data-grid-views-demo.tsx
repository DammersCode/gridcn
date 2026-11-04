"use client";

import { useMemo, type ReactNode } from "react";
import {
  DataGridBody,
  DataGridHeader,
  DataGridProvider,
  DataGridRoot,
  defineColumns,
} from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridColumnsMenu, DataGridFilterMenu, DataGridSearch, DataGridToolbar } from "@/registry/default/blocks/data-grid-toolbar/data-grid-toolbar";
import { DataGridSortList } from "@/registry/default/blocks/data-grid-sort-list/data-grid-sort-list";
import {
  DataGridViews,
  createLocalStorageViewsStorage,
  type DataGridViewsDocument,
  type DataGridViewsStorage,
} from "@/registry/default/blocks/data-grid-views/data-grid-views";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 160 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 200 },
  {
    id: "role",
    header: "Role",
    accessorKey: "role",
    type: "select",
    options: { choices: ["Admin", "User", "Editor", "Viewer", "Manager"].map((value) => ({ value, label: value })) },
    width: 120,
    filterable: true,
  },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 90 },
] as const);

const emptyLayout = { widths: {}, order: [], pins: {}, hidden: [] };
const noSearch = { matchCase: false, wholeCell: false };

const SEED: DataGridViewsDocument = {
  version: 1,
  defaultViewId: null,
  views: [
    { id: "top-scores", name: "Top scores", state: { sorts: [{ columnId: "score", direction: "desc" }], filters: [], searchText: "", searchOptions: noSearch, columnLayout: emptyLayout } },
    {
      id: "admins",
      name: "Admins, compact",
      state: {
        sorts: [{ columnId: "name", direction: "asc" }],
        filters: [{ columnId: "role", operator: "equals", value: "Admin" }],
        searchText: "",
        searchOptions: noSearch,
        columnLayout: { ...emptyLayout, hidden: ["email"] },
      },
    },
  ],
};

function createDemoStorage(): DataGridViewsStorage {
  const local = createLocalStorageViewsStorage("gridcn-demo-views");
  return { load: async (ctx) => (await local.load(ctx)) ?? SEED, save: local.save };
}

export default function DataGridViewsDemo(): ReactNode {
  const rows = useMemo(() => generateDemoRows(80), []);
  const storage = useMemo(createDemoStorage, []);

  return (
    <div className="flex w-full flex-col gap-2">
      <p className="m-0 text-sm text-muted-foreground">
        Sort, filter, search, or hide a column, then open Views and save the result. Pick a view to restore it. Views stay in this browser.
      </p>
      <DataGridProvider data={rows} columns={columns} getRowId={(row) => row.id} headerClickBehavior="sort">
        <DataGridToolbar>
          <DataGridViews storage={storage} />
          <DataGridSearch />
          <DataGridFilterMenu />
          <DataGridSortList />
          <DataGridColumnsMenu />
        </DataGridToolbar>
        <DataGridRoot className="h-[360px]">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    </div>
  );
}
