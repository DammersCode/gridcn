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
import { DEALERSHIPS, MAKES, REGIONS, generateSales, type SaleRow } from "./sales-data";

const columns = defineColumns<SaleRow>()([
  { id: "customer", header: "Customer", accessorKey: "customer", type: "text", width: 140, flex: 1, groupable: false },
  { id: "region", header: "Region", accessorKey: "region", type: "select", options: { choices: REGIONS }, width: 100 },
  { id: "dealership", header: "Dealership", accessorKey: "dealership", type: "select", options: { choices: DEALERSHIPS }, width: 160 },
  { id: "discount", header: "Discount", accessorKey: "discount", type: "number", width: 100, aggregate: "avg" },
  { id: "price", header: "Price", accessorKey: "price", type: "number", width: 110, aggregate: "sum" },
  { id: "make", header: "Make", accessorKey: "make", type: "select", options: { choices: MAKES }, width: 100 },
  { id: "financed", header: "Financed", accessorKey: "financed", type: "checkbox", width: 90 },
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
      <Button size="sm" variant="outline" onClick={() => actions.setGroupBy(["region", "dealership"])}>
        Group by region, then dealership
      </Button>
      <Button size="sm" variant="outline" onClick={() => actions.setGroupBy([])}>
        Ungroup
      </Button>
    </div>
  );
}

/** Car sales grouped by region. Each group row shows its row count, the average discount, and the revenue. Open a header menu to group by another column. */
export default function DataGridRowGroupingDemo(): ReactNode {
  const rows = useMemo(() => generateSales(200), []);
  return (
    <div className="flex w-full flex-col gap-2">
      <DataGridProvider defaultData={rows} columns={columns} defaultGroupBy={["region"]}>
        <GroupControls />
        <div className="h-[380px] overflow-hidden rounded-md border border-border">
          <DataGridContextMenu className="flex h-full flex-col">
            <DataGridRoot aria-label="Car sales by region" className="h-full rounded-[inherit] border-none" renderHeaderMenu={(ctx) => <DataGridHeaderDropdown {...ctx} />}>
              <DataGridHeader />
              <DataGridBody />
            </DataGridRoot>
          </DataGridContextMenu>
        </div>
      </DataGridProvider>
    </div>
  );
}
