import { page, userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, type ColumnDef, type GridDirection } from "../data-grid";
import "@/app/global.css";

type Row = { id: string; region: string; qty: number };

const rows: Row[] = Array.from({ length: 60 }, (_, i) => ({ id: `r${i}`, region: `Region ${i % 4}`, qty: i }));

function makeColumns(extra: number, pin?: "start" | "end") {
  return [
    { id: "region", header: "Region", accessorKey: "region", width: 140, ...(pin === "start" ? { pin } : {}) },
    ...Array.from({ length: extra }, (_, i) => ({ id: `c${i}`, header: `Col ${i}`, accessorFn: (r: Row) => r.qty + i, type: "number" as const, width: 100 })),
    { id: "qty", header: "Qty", accessorKey: "qty", type: "number" as const, aggregate: "sum" as const, width: 100, ...(pin === "end" ? { pin } : {}) },
  ];
}

async function renderGrid(opts: { columns?: ReturnType<typeof makeColumns>; direction?: GridDirection; style?: Record<string, string>; width?: number } = {}) {
  return render(
    <div style={{ height: 500, width: opts.width ?? 800, ...opts.style }}>
      <DataGridProvider data={rows} columns={(opts.columns ?? makeColumns(0)) as ColumnDef<Row, unknown>[]} getRowId={(r: Row) => r.id} defaultGroupBy={["region"]} rowMarkers="number">
        <DataGridRoot direction={opts.direction ?? "ltr"} className="size-full" aria-label="Groups">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    </div>,
  );
}

const groupRows = () => [...document.querySelectorAll<HTMLElement>("[data-grid-group-row]")];
const bodyRows = () => [...document.querySelectorAll<HTMLElement>('[role="row"][data-grid-row-index]')];
const treegrid = () => document.querySelector<HTMLElement>('[role="treegrid"]')!;

describe("row grouping rendering", () => {
  it("opens and closes a group with the toggle button", async () => {
    await renderGrid();
    await expect.poll(() => groupRows().length).toBe(4);
    expect(bodyRows()).toHaveLength(4);
    await userEvent.click(page.getByRole("button", { name: "Expand Region 0" }));
    await expect.poll(() => bodyRows().length).toBeGreaterThan(10);
    expect(bodyRows().filter((row) => row.getAttribute("aria-level") === "2").length).toBeGreaterThan(5);
    expect(groupRows()[0]!.getAttribute("aria-expanded")).toBe("true");
    await userEvent.click(page.getByRole("button", { name: "Collapse Region 0" }));
    await expect.poll(() => bodyRows().length).toBe(4);
  });

  it("gives every row, group rows included, one height, with the label inside the grid", async () => {
    await renderGrid();
    await expect.poll(() => groupRows().length).toBe(4);
    const gridRect = treegrid().getBoundingClientRect();
    expect(new Set(bodyRows().map((row) => Math.round(row.getBoundingClientRect().height))).size).toBe(1);
    const label = groupRows()[0]!.querySelector<HTMLElement>("[data-grid-group-label]")!.getBoundingClientRect();
    expect(label.left).toBeGreaterThanOrEqual(gridRect.left);
    expect(label.right).toBeLessThanOrEqual(gridRect.right);
  });

  it("keeps the label at the inline start while the columns scroll", async () => {
    await renderGrid({ columns: makeColumns(12), width: 500 });
    await expect.poll(() => groupRows().length).toBe(4);
    const el = treegrid();
    const before = groupRows()[0]!.querySelector<HTMLElement>("[data-grid-group-label]")!.getBoundingClientRect().left;
    el.scrollLeft = 300;
    el.dispatchEvent(new Event("scroll"));
    await vi.waitFor(() => {
      const after = groupRows()[0]!.querySelector<HTMLElement>("[data-grid-group-label]")!.getBoundingClientRect().left;
      expect(Math.abs(after - before)).toBeLessThan(2);
    });
  });

  it("renders only the windowed columns of a wide grid on a group row", async () => {
    await renderGrid({ columns: makeColumns(60), width: 500 });
    await expect.poll(() => groupRows().length).toBe(4);
    const cells = groupRows()[0]!.querySelectorAll('[role="gridcell"]');
    expect(cells.length).toBeGreaterThan(1);
    expect(cells.length).toBeLessThan(30);
  });

  it("pins an aggregate column of a group row to the inline end", async () => {
    await renderGrid({ columns: makeColumns(12, "end"), width: 500 });
    await expect.poll(() => groupRows().length).toBe(4);
    const pinned = groupRows()[0]!.querySelector<HTMLElement>('[data-column-id="qty"]')!;
    expect(pinned.getAttribute("data-pinned")).toBe("end");
    expect(Math.abs(pinned.getBoundingClientRect().right - treegrid().getBoundingClientRect().right)).toBeLessThan(20);
  });

  it("lays the label out at the inline start in RTL", async () => {
    await renderGrid({ direction: "rtl" });
    await expect.poll(() => groupRows().length).toBe(4);
    const gridRect = treegrid().getBoundingClientRect();
    const label = groupRows()[0]!.querySelector<HTMLElement>("[data-grid-group-label]")!.getBoundingClientRect();
    expect(gridRect.right - label.right).toBeLessThan(gridRect.width / 2);
  });

  it.each([
    ["square corners", { "--radius": "0px" }],
    ["round corners", { "--radius": "1rem" }],
    ["larger base font", { fontSize: "20px" }],
  ])("keeps the toggle inside its group row with %s", async (_name, style) => {
    await renderGrid({ style });
    await expect.poll(() => groupRows().length).toBe(4);
    const rowRect = groupRows()[0]!.getBoundingClientRect();
    const toggle = groupRows()[0]!.querySelector<HTMLElement>("[data-grid-group-toggle]")!.getBoundingClientRect();
    expect(toggle.top).toBeGreaterThanOrEqual(rowRect.top - 1);
    expect(toggle.bottom).toBeLessThanOrEqual(rowRect.bottom + 1);
  });
});
