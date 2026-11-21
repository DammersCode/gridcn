import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import DataGridServerPivotDemo from "./data-grid-server-pivot-demo";
import "@/app/global.css";

const MAKES = ["Kestrel", "Marlow", "Nordvik", "Solenne", "Vantor"];
const pivotRows = () => [...document.querySelectorAll<HTMLElement>('[role="row"][data-grid-group-row]')];
const cellsOf = (row: Element) => [...row.querySelectorAll<HTMLElement>('[role="gridcell"]:not([data-grid-marker-cell])')];

describe("data-grid-server-pivot-demo", () => {
  it("shows one row per region, one column per make, and the revenue in each rendered cell", async () => {
    await render(<DataGridServerPivotDemo />);
    await vi.waitFor(() => expect(pivotRows()).toHaveLength(4), { timeout: 20_000 });
    expect(Number(document.querySelector('[role="treegrid"]')!.getAttribute("aria-colcount"))).toBeGreaterThanOrEqual(1 + MAKES.length);
    const headers = [...document.querySelectorAll('[role="columnheader"]')].map((header) => header.textContent).join(" ");
    expect(headers).toContain(MAKES[0]);
    await vi.waitFor(() => {
      expect(pivotRows()).toHaveLength(4);
      for (const row of pivotRows()) {
        const revenues = cellsOf(row).slice(1).map((cell) => Number(cell.textContent!.replace(/[^\d.]/g, "")));
        expect(revenues.length).toBeGreaterThan(0);
        expect(revenues.every((revenue) => revenue > 1_000_000)).toBe(true);
      }
    });
  });
});
