import { page, userEvent } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGrid } from "../data-grid";
import { columns, makeRows } from "./perf-probe.test-helper";
import "@/app/global.css";

const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

// Switching a grid item between `z-index: auto` and an integer, or moving an in-flow grid item, re-lays out the whole canvas.
describe("keys and clicks leave the canvas layout alone", () => {
  it("gives every body cell an integer z-index and keeps unpinned overlays out of flow", async () => {
    await render(
      <div style={{ height: 500, width: 900 }}>
        <DataGrid data={makeRows(50)} columns={columns} getRowId={(r) => r.id} className="h-125 w-225" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    await page.getByRole("gridcell").nth(10).click();
    await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}");
    await frame();

    const cells = [...document.querySelectorAll<HTMLElement>('[role="gridcell"]')];
    expect(cells.length).toBeGreaterThan(20);
    for (const cell of cells) expect(getComputedStyle(cell).zIndex, cell.outerHTML.slice(0, 80)).not.toBe("auto");

    const overlays = [...document.querySelectorAll<HTMLElement>("[data-grid-selection-overlay], [data-grid-active-cell-overlay]")];
    expect(overlays.length).toBeGreaterThanOrEqual(2);
    for (const overlay of overlays) expect(getComputedStyle(overlay).position).toBe("absolute");
  });
});
