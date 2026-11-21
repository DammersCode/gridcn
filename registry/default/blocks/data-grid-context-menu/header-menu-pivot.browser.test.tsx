import axe from "axe-core";
import { userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridContextMenu, DataGridHeaderDropdown } from "./data-grid-context-menu";
import "@/app/global.css";

type Sale = { id: string; region: string; year: number; amount: number };

const columns = defineColumns<Sale>()([
  { id: "region", header: "Region", accessorKey: "region", type: "text", width: 120 },
  { id: "year", header: "Year", accessorKey: "year", type: "number", width: 100 },
  { id: "amount", header: "Amount", accessorKey: "amount", type: "number", width: 100, aggregate: "sum" },
] as const);

const sales: Sale[] = [
  { id: "s0", region: "EU", year: 2024, amount: 1 },
  { id: "s1", region: "US", year: 2025, amount: 2 },
];

function renderGrid() {
  return render(
    <main>
      <DataGridProvider data={sales} columns={columns} getRowId={(row) => row.id} groupBy={["region"]} defaultExpanded={{ mode: "expanded", ids: [] }}>
        <DataGridContextMenu>
          <DataGridRoot aria-label="Sales" className="h-75" renderHeaderMenu={(ctx) => <DataGridHeaderDropdown {...ctx} />}>
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridContextMenu>
      </DataGridProvider>
    </main>,
  );
}

const menuItem = (name: string) => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) => el.textContent?.includes(name));
const generatedHeaders = () => [...document.querySelectorAll<HTMLElement>('[role="columnheader"][data-column-id^="__pivot:"]')].map((header) => header.textContent);
const grid = () => document.querySelector<HTMLElement>('[role="treegrid"]')!;
const openHeaderMenu = () => userEvent.keyboard("{Shift>}{Alt>}{ArrowDown}{/Alt}{/Shift}");

async function focusItem(name: string) {
  await vi.waitFor(() => expect(menuItem(name)).toBeDefined());
  for (let step = 0; step < 20 && document.activeElement !== menuItem(name); step++) await userEvent.keyboard("{ArrowDown}");
  expect(document.activeElement).toBe(menuItem(name));
}

describe("the pivot items of the header menu, by keyboard", () => {
  it("pivots by the active column, keeps the focus in the grid, and turns the pivot off again", async () => {
    const screen = await renderGrid();
    await userEvent.click(document.querySelector<HTMLElement>('[role="gridcell"][data-column-id="year"]')!);
    await openHeaderMenu();
    await focusItem("Pivot by Year");
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(generatedHeaders()).toEqual(["2024", "2025"]));
    await vi.waitFor(() => expect(grid().contains(document.activeElement)).toBe(true));

    await userEvent.click(document.querySelector<HTMLElement>('[role="gridcell"][data-column-id="region"]')!);
    await openHeaderMenu();
    await focusItem("Turn off pivot");
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(generatedHeaders()).toEqual([]));
    expect(document.querySelector('[role="columnheader"][data-column-id="year"]')).not.toBeNull();
    await vi.waitFor(() => expect(grid().contains(document.activeElement)).toBe(true));
    await screen.unmount();
  });

  it("closes on Escape and returns the focus to the cell that opened it, with no axe violations while open", async () => {
    const screen = await renderGrid();
    const cell = () => document.querySelector<HTMLElement>('[role="gridcell"][data-column-id="year"]')!;
    await userEvent.click(cell());
    await openHeaderMenu();
    await vi.waitFor(() => expect(menuItem("Pivot by Year")).toBeDefined());
    // The menu portals to the body, outside the page's landmark, which axe's region rule wants.
    const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(menuItem("Pivot by Year")).toBeUndefined());
    await vi.waitFor(() => expect(document.activeElement).toBe(cell()));
    await screen.unmount();
  });
});
