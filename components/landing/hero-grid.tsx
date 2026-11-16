"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import type { SelectionState } from "@/registry/default/blocks/data-grid/data-grid";
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

const START_RANGE: SelectionState = {
  anchor: { rowId: "r1", columnId: "count" },
  range: { start: { rowId: "r1", columnId: "count" }, end: { rowId: "r3", columnId: "item" } },
  rangeStack: [],
  rowIds: [],
  columnIds: [],
};

export function HeroGrid(): ReactNode {
  const { plugin: fill } = useDataGridFill();
  const { plugin: history } = useDataGridHistory<Row>();
  const plugins = useMemo(() => [fill, history], [fill, history]);
  const rootRef = useRef<HTMLDivElement>(null);
  // The seeded active cell focuses itself on mount; the page must load with focus on body.
  useEffect(() => {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && rootRef.current?.contains(focused)) focused.blur();
  }, []);
  return (
    <div ref={rootRef} className="flex min-w-0 flex-col gap-2">
      <div className="h-60 overflow-hidden rounded-lg border bg-background sm:h-72">
        <DataGridProvider defaultData={ROWS} defaultSelection={START_RANGE} columns={columns} plugins={plugins} enableColumnReorder={false}>
          <DataGridRoot aria-label="Live example grid" className="h-full">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      </div>
      <p className="text-sm text-muted-foreground">
        <span className="pointer-coarse:hidden">
          <span className="font-medium text-foreground">Try it:</span> drag the corner handle down. The series continues: 4, 5, 6 and Item 4, Item 5, Item 6. Ctrl+Z undoes it.
        </span>
        <span className="hidden pointer-coarse:inline"><span className="font-medium text-foreground">Try it:</span> tap a cell, then drag a corner circle to select a range. The fill handle needs a mouse.</span>
      </p>
    </div>
  );
}
