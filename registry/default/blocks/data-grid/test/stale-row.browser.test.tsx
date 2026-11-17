import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import type { StoreApi } from "zustand/vanilla";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot } from "../data-grid";
import { StoreProbe } from "./store-probe.test-helper";
import { type DataGridStoreState } from "../data-grid-sdk";
import "@/app/global.css";

type Row = { id: string; name: string; price: number };

const rows: Row[] = [
  { id: "a", name: "Charlie", price: 30 },
  { id: "b", name: "Alice", price: 25 },
  { id: "c", name: "Bob", price: 40 },
];
const columns = [
  { id: "name", header: "Name", accessorKey: "name" as const, type: "text" as const },
  { id: "price", header: "Price", accessorKey: "price" as const, type: "number" as const },
];

async function mount(): Promise<StoreApi<DataGridStoreState>> {
  let api: StoreApi<DataGridStoreState> | null = null;
  await render(
    <DataGridProvider defaultData={rows} columns={columns} getRowId={(r: Row) => r.id} sortMode="server" sortState={[{ columnId: "name", direction: "asc" }]}>
      <StoreProbe onReady={(a) => (api = a)} />
      <DataGridRoot className="h-80 w-150">
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
    </DataGridProvider>,
  );
  for (let i = 0; i < 200 && !api; i++) await new Promise((r) => setTimeout(r, 10));
  if (!api) throw new Error("store api never published");
  return api;
}

const staleRows = () => [...document.querySelectorAll('[role="row"][data-row-stale]')].map((row) => row.textContent);

describe("data-row-stale", () => {
  it("marks the pushed row and only that row", async () => {
    const api = await mount();
    expect(staleRows()).toEqual([]);
    api.getState().actions.updateCells([{ rowId: "b", columnId: "name", value: "Zed" }], { source: "stream" });
    await expect.poll(() => staleRows().length).toBe(1);
    expect(staleRows()[0]).toContain("Zed");
  });

  it("leaves a row unmarked when the push touches no column of the spec", async () => {
    const api = await mount();
    api.getState().actions.updateCells([{ rowId: "b", columnId: "price", value: 26 }], { source: "stream" });
    await expect.poll(() => document.body.textContent).toContain("26");
    expect(staleRows()).toEqual([]);
  });
});
