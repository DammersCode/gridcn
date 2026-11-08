"use client";

import { useMemo, useState, type ReactNode } from "react";
import { DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, type ColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import { lookupCellType, type LookupFetchRequest, type LookupOption, type LookupOptions, type LookupValue } from "@/registry/default/blocks/data-grid-lookup/data-grid-lookup";

type Order = { id: string; item: string; customer: LookupValue };

const COMPANIES = ["Acme", "Globex", "Initech", "Umbrella", "Hooli", "Stark Industries", "Wayne Enterprises", "Wonka", "Soylent", "Cyberdyne", "Tyrell", "Vandelay"].flatMap((name) =>
  ["North", "South", "East", "West"].map((region, i) => ({ value: `${name}-${i}`.toLowerCase(), label: `${name} ${region}` })),
);

/** A fake foreign-key search: 48 companies, 400 ms away, filtered by the query. A real app calls its API with the signal. */
function searchCompanies({ query, signal }: LookupFetchRequest): Promise<LookupOption[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(COMPANIES.filter((company) => company.label.toLowerCase().includes(query.toLowerCase()))), 400);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    });
  });
}

const LOOKUP_OPTIONS: LookupOptions = { fetchOptions: searchCompanies };

const INITIAL: Order[] = [
  { id: "o1", item: "Anvil", customer: { value: "acme-0", label: "Acme North" } },
  { id: "o2", item: "Rocket skates", customer: null },
  { id: "o3", item: "Giant magnet", customer: "wonka-2" },
];

/**
 * An async `lookup` column: double-click or press Enter on a Customer cell, type to search the fake server, then pick with the arrow
 * keys and Enter or with a click. The third row stores a bare key, so it shows the key in muted text until you pick its company.
 */
export default function DataGridLookupDemo(): ReactNode {
  const [data, setData] = useState<readonly Order[]>(INITIAL);
  const columns = useMemo<readonly ColumnDef<Order, unknown>[]>(
    () => [
      { id: "item", header: "Item", accessorKey: "item", type: "text", width: 140, flex: 1 },
      { id: "customer", header: "Customer", accessorKey: "customer", type: "lookup", options: LOOKUP_OPTIONS, width: 220, flex: 2 },
    ],
    [],
  );
  return (
    <div className="w-full h-[200px] overflow-hidden rounded-md border border-border">
      <DataGridProvider data={data} onDataChange={setData} columns={columns} cellTypes={{ lookup: lookupCellType }}>
        <DataGridRoot className="h-full rounded-none border-none">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    </div>
  );
}
