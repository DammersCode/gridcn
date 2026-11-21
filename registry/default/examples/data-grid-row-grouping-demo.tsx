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

type CarSale = { id: string; customer: string; region: string; dealership: string; make: string; financed: boolean; price: number; discount: number };

const REGIONS = ["North", "South", "East", "West"];
const DEALERSHIPS = ["Northgate Motors", "Pine Ridge Cars", "Bayview Autos", "Southfield Motors", "Eastbrook Cars", "Harbor Point Motors", "Westlake Autos", "Canyon Road Motors"];
const MAKES = ["Kestrel", "Marlow", "Nordvik", "Solenne", "Vantor"];
// Unequal shares per region and a different make mix in each region, so the group totals differ.
const REGION_SLOTS = [0, 0, 0, 0, 1, 1, 1, 2, 2, 3];
const MAKE_MIX = [
  [0, 0, 0, 1, 2, 3, 4, 1],
  [1, 1, 1, 2, 0, 3, 4, 2],
  [2, 2, 3, 3, 3, 0, 1, 4],
  [4, 4, 4, 3, 0, 1, 2, 4],
];
const FIRST = ["Alex", "Sam", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Jamie", "Avery", "Quinn", "Drew", "Robin"];
const LAST = ["Smith", "Garcia", "Chen", "Patel", "Novak", "Okafor", "Larsen", "Rossi", "Kim", "Silva", "Meyer", "Haddad"];

// Index arithmetic instead of Math.random keeps the server and client markup equal.
const carSales = (count: number): CarSale[] =>
  Array.from({ length: count }, (_, index) => {
    const region = REGION_SLOTS[index % REGION_SLOTS.length]!;
    const mix = MAKE_MIX[region]!;
    const make = mix[Math.floor(index / REGION_SLOTS.length) % mix.length]!;
    return {
      id: `sale-${index}`,
      customer: `${FIRST[Math.floor(index / 5) % FIRST.length]!} ${LAST[(index * 7) % LAST.length]!}`,
      region: REGIONS[region]!,
      dealership: DEALERSHIPS[region * 2 + (Math.floor(index / 7) % 3 === 0 ? 1 : 0)]!,
      make: MAKES[make]!,
      financed: index % 3 !== 0,
      price: 21000 + make * 6000 + ((index * 37) % 41) * 100,
      discount: ((index * 7) % 13) * 250,
    };
  });

const columns = defineColumns<CarSale>()([
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
  const rows = useMemo(() => carSales(200), []);
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
