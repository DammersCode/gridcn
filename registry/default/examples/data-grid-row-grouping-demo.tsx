"use client";

import { useMemo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DataGridBody,
  DataGridHeader,
  DataGridProvider,
  DataGridRoot,
  defineColumns,
  useDataGridActions,
} from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridContextMenu, DataGridHeaderDropdown } from "@/registry/default/blocks/data-grid-context-menu/data-grid-context-menu";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 160, flex: 1, groupable: false },
  { id: "role", header: "Role", accessorKey: "role", type: "select", options: { choices: ["Admin", "User", "Editor", "Viewer", "Manager"] }, width: 110 },
  { id: "active", header: "Active", accessorKey: "active", type: "checkbox", width: 90 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 80, aggregate: "avg" },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 90, aggregate: "sum" },
] as const);

function GroupControls(): ReactNode {
  const actions = useDataGridActions();
  return (
    <div className="flex gap-2">
      <Button size="sm" variant="outline" onClick={() => actions.expandAll()}>
        Expand all
      </Button>
      <Button size="sm" variant="outline" onClick={() => actions.collapseAll()}>
        Collapse all
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

/** Rows grouped by role. Each group row shows its row count and the average age and total score. Open a header menu to group by another column. */
export default function DataGridRowGroupingDemo(): ReactNode {
  const rows = useMemo(() => generateDemoRows(200), []);
  return (
    <div className="flex w-full flex-col gap-2">
      <DataGridProvider defaultData={rows} columns={columns} defaultGroupBy={["role"]}>
        <GroupControls />
        <div className="h-[380px] overflow-hidden rounded-md border border-border">
          <DataGridContextMenu className="flex h-full flex-col">
            <DataGridRoot aria-label="Employees by role" className="h-full rounded-[inherit] border-none" renderHeaderMenu={(ctx) => <DataGridHeaderDropdown {...ctx} />}>
              <DataGridHeader />
              <DataGridBody />
            </DataGridRoot>
          </DataGridContextMenu>
        </div>
      </DataGridProvider>
    </div>
  );
}
