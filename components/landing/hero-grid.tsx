"use client";

import { useMemo, type ReactNode } from "react";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridFill } from "@/registry/default/blocks/data-grid-fill/data-grid-fill";

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
  const { plugin } = useDataGridFill();
  const plugins = useMemo(() => [plugin], [plugin]);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="h-60 overflow-hidden border bg-background sm:h-72">
        <DataGridProvider defaultData={ROWS} columns={columns} plugins={plugins}>
          <DataGridRoot aria-label="Live example grid" className="h-full">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      </div>
      <p className="text-xs text-muted-foreground">Try it: select Count and Item cells, then drag the corner handle down. 1, 2, 3 and Item 1, 2, 3 continue.</p>
    </div>
  );
}
