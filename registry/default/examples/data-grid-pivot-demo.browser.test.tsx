import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import DataGridPivotDemo, { carSales } from "./data-grid-pivot-demo";
import "@/app/global.css";

const Wide = () => (
  <div style={{ width: 1000 }}>
    <DataGridPivotDemo />
  </div>
);

const REGIONS = ["North", "South", "East", "West"];
const MAKES = ["Kestrel", "Marlow", "Nordvik", "Solenne", "Vantor"];

const groupRows = () => [...document.querySelectorAll<HTMLElement>('[role="row"][data-grid-group-row]')];
const headerTexts = () => [...document.querySelectorAll<HTMLElement>('[role="columnheader"][data-column-id]')].map((header) => header.textContent ?? "");
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === name)!;
const amount = (text: string) => Number(text.replace(/[^\d.]/g, ""));

/** The revenue cell of each region row, by the header text of its column. */
function revenueByRegion(): Map<string, Map<string, number>> {
  const headerOf = new Map([...document.querySelectorAll<HTMLElement>('[role="columnheader"][data-column-id]')].map((h) => [h.getAttribute("data-column-id")!, h.textContent ?? ""]));
  const table = new Map<string, Map<string, number>>();
  for (const row of groupRows()) {
    const region = REGIONS.find((name) => row.textContent!.includes(name))!;
    const cells = new Map<string, number>();
    for (const cell of row.querySelectorAll<HTMLElement>('[role="gridcell"][data-column-id]')) {
      const header = headerOf.get(cell.getAttribute("data-column-id")!);
      if (header && header !== "Region") cells.set(header, amount(cell.textContent ?? ""));
    }
    table.set(region, cells);
  }
  return table;
}

type Frame = { header: string[]; rows: number; orphanCells: number };

const headerIds = () => new Set([...document.querySelectorAll<HTMLElement>('[role="columnheader"][data-column-id]')].map((header) => header.getAttribute("data-column-id")));
const orphanCells = () => {
  const ids = headerIds();
  return [...document.querySelectorAll<HTMLElement>('[role="row"][data-grid-row-index] [role="gridcell"][data-column-id]')].filter((cell) => !ids.has(cell.getAttribute("data-column-id"))).length;
};
const frame = (): Frame => ({ header: headerTexts(), rows: document.querySelectorAll('[role="row"][data-grid-row-index]').length, orphanCells: orphanCells() });

/** Samples the painted grid once per frame while `run` acts, then until `frames` frames passed. */
async function timeline(run: () => void, frames = 8): Promise<Frame[]> {
  const samples: Frame[] = [];
  await new Promise<void>((resolve) => {
    let left = frames;
    const tick = () => {
      samples.push(frame());
      if (--left === 0) resolve();
      else requestAnimationFrame(tick);
    };
    run();
    requestAnimationFrame(tick);
  });
  return samples;
}

const settled = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

function expectOldOrNew(samples: readonly Frame[], before: Frame, after: Frame) {
  expect(after).not.toEqual(before);
  for (const [i, sample] of samples.entries()) {
    expect(sample.rows, `frame ${i}`).toBeGreaterThan(0);
    expect(sample.orphanCells, `frame ${i}`).toBe(0);
    expect([before.header, after.header], `frame ${i}`).toContainEqual(sample.header);
  }
}

describe("data-grid-pivot-demo", () => {
  it("shows one row per region, one column per make, and the revenue of each region and make", async () => {
    const screen = await render(<Wide />);
    await vi.waitFor(() => expect(groupRows()).toHaveLength(4));
    expect(headerTexts()).toEqual(["Region", ...MAKES]);
    const expected = new Map<string, Map<string, number>>();
    for (const sale of carSales(5000)) {
      const byMake = expected.get(sale.region) ?? new Map<string, number>();
      byMake.set(sale.make, (byMake.get(sale.make) ?? 0) + sale.price);
      expected.set(sale.region, byMake);
    }
    expect(revenueByRegion()).toEqual(new Map(REGIONS.map((region) => [region, new Map(MAKES.map((make) => [make, expected.get(region)!.get(make) ?? 0]))])));
    await screen.unmount();
  });

  it("switches the pivot to financed and off without a frame that lacks rows or mixes the headers", async () => {
    const screen = await render(<Wide />);
    await vi.waitFor(() => expect(groupRows()).toHaveLength(4));
    const byMake = frame();

    const toFinanced = await timeline(() => button("Financed").click());
    await settled();
    const byFinanced = frame();
    expectOldOrNew(toFinanced, byMake, byFinanced);
    expect(byFinanced.header).toEqual(["Region", "false", "true"]);
    expect(groupRows()).toHaveLength(4);

    const toOff = await timeline(() => button("Off").click());
    await settled();
    const off = frame();
    expectOldOrNew(toOff, byFinanced, off);
    expect(off.header).toEqual(["Region", "Dealership", "Make", "Financed", "Revenue"]);
    expect(button("Off").getAttribute("aria-pressed")).toBe("true");

    const toMake = await timeline(() => button("Make").click());
    await settled();
    expectOldOrNew(toMake, off, frame());
    expect(frame()).toEqual(byMake);
    await screen.unmount();
  });
});
