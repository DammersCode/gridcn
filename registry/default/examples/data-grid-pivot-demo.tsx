"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, defineColumns, type PivotSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { DEALERSHIPS, MAKES, REGIONS, generateSales, type SaleRow } from "./sales-data";

const columns = defineColumns<SaleRow>()([
  { id: "region", header: "Region", accessorKey: "region", type: "select", options: { choices: REGIONS }, width: 110 },
  { id: "dealership", header: "Dealership", accessorKey: "dealership", type: "select", options: { choices: DEALERSHIPS }, width: 170 },
  { id: "make", header: "Make", accessorKey: "make", type: "select", options: { choices: MAKES }, width: 110 },
  { id: "financed", header: "Financed", accessorKey: "financed", type: "checkbox", width: 100 },
  { id: "price", header: "Revenue", accessorKey: "price", type: "number", width: 130, aggregate: "sum" },
] as const);

const PIVOT_CHOICES = [
  { label: "Make", columnIds: ["make"] },
  { label: "Financed", columnIds: ["financed"] },
  { label: "Off", columnIds: [] },
];

/** 5,000 car sales pivoted on the client: one row per region, one column per make, each cell the revenue. The buttons switch the pivot column or turn the pivot off. */
export default function DataGridPivotDemo(): ReactNode {
  const rows = useMemo(() => generateSales(5000), []);
  const [pivot, setPivot] = useState<PivotSpec>({ columnIds: ["make"] });
  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Pivot column</span>
        {PIVOT_CHOICES.map((choice) => {
          const pressed = (pivot.columnIds[0] ?? "") === (choice.columnIds[0] ?? "");
          return (
            <Button key={choice.label} size="sm" variant={pressed ? "default" : "outline"} aria-pressed={pressed} onClick={() => setPivot({ columnIds: choice.columnIds })}>
              {choice.label}
            </Button>
          );
        })}
      </div>
      <DataGridProvider defaultData={rows} columns={columns} defaultGroupBy={["region"]} pivot={pivot} onPivotChange={setPivot} readOnly>
        <div className="h-[300px] overflow-hidden rounded-md border border-border">
          <DataGridRoot aria-label="Car sales revenue per region" className="h-full rounded-[inherit] border-none">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </div>
      </DataGridProvider>
    </div>
  );
}
