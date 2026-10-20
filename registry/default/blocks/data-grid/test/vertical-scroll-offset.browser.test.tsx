import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGrid } from "../data-grid";
import { makeRows } from "./perf-probe.test-helper";
import "@/app/global.css";

const columns = Array.from({ length: 5 }, (_, i) => ({
  id: `c${i}`,
  header: `Col ${i}`,
  accessorKey: "name" as const,
  type: "text" as const,
  width: 150,
}));

const nextFrames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

describe("vertical scroll offset", () => {
  it("positions rows at their scroll offset without inherited per-tick custom properties", async () => {
    await render(
      <div style={{ height: 400, width: 800 }}>
        <DataGrid data={makeRows(2000)} columns={columns} getRowId={(r) => r.id} className="h-100 w-200" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    const firstRow = () => grid.querySelector<HTMLElement>('[role="row"][data-grid-row-index]')!;
    const rowTopInGrid = (row: HTMLElement) => row.getBoundingClientRect().top - grid.getBoundingClientRect().top;
    const rowHeight = firstRow().getBoundingClientRect().height;
    const offsetAt = async (scrollTop: number) => {
      grid.scrollTop = scrollTop;
      await nextFrames();
      const row = firstRow();
      const index = Number(row.dataset["gridRowIndex"]);
      return rowTopInGrid(row) + grid.scrollTop - index * rowHeight;
    };

    const headerOffset = await offsetAt(0);
    for (const scrollTop of [37, 1203, 9001, 20000, 150]) {
      expect(await offsetAt(scrollTop)).toBeCloseTo(headerOffset, 0);
    }
    expect(grid.innerHTML).not.toMatch(/--grid-scroll-top|--grid-window-top/);
  });

  it("leaves the style of surviving rows untouched while the window shifts a few rows", async () => {
    await render(
      <div style={{ height: 400, width: 800 }}>
        <DataGrid data={makeRows(5000)} columns={columns} getRowId={(r) => r.id} className="h-100 w-200" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    const canvas = grid.querySelector<HTMLElement>("[data-grid-rows-canvas]")!;
    const rowHeight = grid.querySelector<HTMLElement>('[role="row"][data-grid-row-index]')!.getBoundingClientRect().height;
    grid.scrollTop = 500 * rowHeight;
    await new Promise((resolve) => setTimeout(resolve, 400));

    const survivors = new Set(canvas.querySelectorAll('[role="row"][data-grid-row-index]'));
    let styleWrites = 0;
    const observer = new MutationObserver((records) => {
      for (const record of records) if (record.attributeName === "style" && survivors.has(record.target as Element)) styleWrites++;
    });
    observer.observe(canvas, { attributes: true, subtree: true, attributeFilter: ["style"] });
    for (let step = 1; step <= 6; step++) {
      grid.scrollTop = (500 + step) * rowHeight;
      await nextFrames();
    }
    observer.disconnect();
    const stillMounted = [...survivors].filter((row) => row.isConnected).length;
    expect(stillMounted).toBeGreaterThan(3);
    expect(styleWrites).toBe(0);
  });
});
