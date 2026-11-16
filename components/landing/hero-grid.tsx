"use client";

import { useMemo, type ReactNode } from "react";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridFill } from "@/registry/default/blocks/data-grid-fill/data-grid-fill";
import { useDataGridHistory } from "@/registry/default/blocks/data-grid-history/data-grid-history";

type Row = { id: string; count: string; item: string; owner: string; region: string };

const ROWS: Row[] = [
  { id: "r1", count: "1", item: "Item 1", owner: "Ada", region: "West" },
  { id: "r2", count: "2", item: "Item 2", owner: "Grace", region: "West" },
  { id: "r3", count: "3", item: "Item 3", owner: "Margaret", region: "West" },
  { id: "r4", count: "", item: "", owner: "Katherine", region: "" },
  { id: "r5", count: "", item: "", owner: "Ada", region: "" },
  { id: "r6", count: "", item: "", owner: "Grace", region: "" },
  { id: "r7", count: "", item: "", owner: "Margaret", region: "" },
  { id: "r8", count: "", item: "", owner: "Katherine", region: "" },
];

const columns = defineColumns<Row>()([
  { id: "count", header: "Count", accessorKey: "count", type: "text", width: 80, flex: 1 },
  { id: "item", header: "Item", accessorKey: "item", type: "text", width: 100, flex: 1 },
  { id: "owner", header: "Owner", accessorKey: "owner", type: "text", width: 100, flex: 1 },
  { id: "region", header: "Region", accessorKey: "region", type: "text", width: 90, flex: 1 },
] as const);

export function HeroGrid(): ReactNode {
  const { plugin: fill } = useDataGridFill();
  const { plugin: history } = useDataGridHistory<Row>();
  const plugins = useMemo(() => [fill, history], [fill, history]);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="h-60 overflow-hidden rounded-lg border bg-background sm:h-72">
        <DataGridProvider defaultData={ROWS} columns={columns} plugins={plugins} enableColumnReorder={false}>
          <DataGridRoot aria-label="Live example grid" className="h-full">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      </div>
      <p className="text-sm text-muted-foreground">
        <span className="pointer-coarse:hidden">
          Try it: select the Count and Item cells of rows 1 to 3, then drag the corner handle down. The series continues: 4, 5, 6 and Item 4, Item 5, Item 6. Ctrl+Z undoes it.
        </span>
        <span className="hidden pointer-coarse:inline">Try it: tap a cell, then drag a corner circle to select a range. The fill handle needs a mouse.</span>
      </p>
    </div>
  );
}
