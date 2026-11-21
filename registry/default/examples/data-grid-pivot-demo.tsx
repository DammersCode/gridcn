"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";

export type CarSale = { id: string; region: string; dealership: string; make: string; financed: boolean; price: number };

const REGIONS = ["North", "South", "East", "West"];
const DEALERSHIPS = ["Northgate Motors", "Pine Ridge Cars", "Bayview Autos", "Southfield Motors", "Eastbrook Cars", "Harbor Point Motors", "Westlake Autos", "Canyon Road Motors"];
const MAKES = ["Kestrel", "Marlow", "Nordvik", "Solenne", "Vantor"];
// Unequal shares per region and a different make mix in each region, so the cells differ.
const REGION_SLOTS = [0, 0, 0, 0, 1, 1, 1, 2, 2, 3];
const MAKE_MIX = [
  [0, 0, 0, 1, 2, 3, 4, 1],
  [1, 1, 1, 2, 0, 3, 4, 2],
  [2, 2, 3, 3, 3, 0, 1, 4],
  [4, 4, 4, 3, 0, 1, 2, 4],
];

// Index arithmetic instead of Math.random keeps the server and client markup equal.
export const carSales = (count: number): CarSale[] =>
  Array.from({ length: count }, (_, index) => {
    const region = REGION_SLOTS[index % REGION_SLOTS.length]!;
    const mix = MAKE_MIX[region]!;
    const make = mix[Math.floor(index / REGION_SLOTS.length) % mix.length]!;
    return {
      id: `sale-${index}`,
      region: REGIONS[region]!,
      dealership: DEALERSHIPS[region * 2 + (Math.floor(index / 7) % 3 === 0 ? 1 : 0)]!,
      make: MAKES[make]!,
      financed: index % 3 !== 0,
      price: 21000 + make * 6000 + ((index * 37) % 41) * 100,
    };
  });

const columns = defineColumns<CarSale>()([
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
  const rows = useMemo(() => carSales(5000), []);
  const [pivot, setPivot] = useState<{ columnIds: readonly string[] }>({ columnIds: ["make"] });
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
