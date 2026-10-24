import { userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, defineColumns, type FilterSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { gridAttrSelector } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { DataGridHeaderFilter } from "./data-grid-toolbar";
import "@/app/global.css";

type Row = { id: string; city: string; age: number; status: string };

const ROWS = 100_000;
const RUNS = 5;

const columns = defineColumns<Row>()([
  { id: "city", header: "City", accessorKey: "city", type: "text", width: 160 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 100 },
  { id: "status", header: "Status", accessorKey: "status", type: "text", width: 100 },
] as const);

const filters: FilterSpec[] = [
  { columnId: "age", operator: "gte", value: "10" },
  { columnId: "status", operator: "notEquals", value: "closed" },
];

const makeRows = (cardinality: number): Row[] =>
  Array.from({ length: ROWS }, (_, i) => ({ id: "r" + i, city: "City " + ((i * 7919) % cardinality), age: i % 100, status: i % 5 === 0 ? "closed" : "open" }));

const firstOption = () => document.querySelector(`${gridAttrSelector("headerFilterPopup")} [role="option"]`);

async function timeToFirstOption(): Promise<number> {
  const trigger = document.querySelector<HTMLElement>(`[data-column-id="city"] ${gridAttrSelector("headerFilterTrigger")}`)!;
  const start = performance.now();
  trigger.click();
  while (!firstOption()) await new Promise((r) => requestAnimationFrame(r));
  return performance.now() - start;
}

describe("DataGridHeaderFilter open time", () => {
  it.each([
    [10, 150],
    [10_000, 400],
  ])("opens to the first option over 100k rows and two other filters at cardinality %i within %i ms", async (cardinality, budgetMs) => {
    const rows = makeRows(cardinality);
    await render(
      <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id} defaultFilterState={filters}>
        <DataGridRoot className="h-75" renderHeaderFilter={(ctx) => <DataGridHeaderFilter {...ctx} />}>
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>,
    );
    await vi.waitFor(() => expect(document.querySelector('[data-column-id="city"]')).toBeTruthy());
    const times: number[] = [];
    for (let run = 0; run < RUNS; run++) {
      times.push(await timeToFirstOption());
      await userEvent.keyboard("{Escape}");
      await vi.waitFor(() => expect(document.querySelector(gridAttrSelector("headerFilterPopup"))).toBeNull());
    }
    times.sort((a, b) => a - b);
    const median = times[RUNS >> 1]!;
    expect(median, `runs ${times.map((t) => t.toFixed(1)).join(", ")}`).toBeLessThan(budgetMs);
  });
});
