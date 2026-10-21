import { page, userEvent } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGrid } from "../data-grid";
import { makeRows } from "./perf-probe.test-helper";
import { cellAt, firstRowHeight, gridElement, scrollByTicks, settle } from "./scroll-origin.test-helper";
import "@/app/global.css";

const columns = Array.from({ length: 8 }, (_, i) => ({
  id: `c${i}`,
  header: `Col ${i}`,
  accessorKey: "name" as const,
  type: "text" as const,
  width: 150,
}));

const mount = (className = "h-100 w-200") =>
  render(
    <div style={{ height: 400, width: 800 }}>
      <DataGrid data={makeRows(100_000)} columns={columns} getRowId={(r) => r.id} className={className} />
    </div>,
  );

const inside = (inner: DOMRect, outer: DOMRect) =>
  inner.left >= outer.left - 1 && inner.right <= outer.right + 1 && inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1;

describe("editor start reveals the active cell", () => {
  it("brings a cell clipped at the right edge fully into view on Enter", async () => {
    await mount("h-100 w-80");
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = gridElement();
    const columnId = "c2";
    await userEvent.click(cellAt(2, "c0"));
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    await settle();
    grid.scrollLeft -= 60;
    await settle();
    expect(inside(cellAt(2, columnId).getBoundingClientRect(), grid.getBoundingClientRect())).toBe(false);

    await userEvent.keyboard("{Enter}");
    await settle();

    const input = grid.querySelector<HTMLInputElement>("input")!;
    expect(inside(cellAt(2, columnId).getBoundingClientRect(), grid.getBoundingClientRect())).toBe(true);
    expect(inside(input.getBoundingClientRect(), grid.getBoundingClientRect())).toBe(true);
  });

  it("brings a parked active row into view when typing opens the editor", async () => {
    await mount();
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    await userEvent.click(cellAt(2, "c1"));
    await scrollByTicks(3000, firstRowHeight());
    const grid = gridElement();
    const parkedScrollTop = grid.scrollTop;

    await userEvent.keyboard("a");
    await settle();

    const input = grid.querySelector<HTMLInputElement>("input")!;
    expect(grid.scrollTop).toBeLessThan(parkedScrollTop);
    expect(inside(input.getBoundingClientRect(), grid.getBoundingClientRect())).toBe(true);
  });
});
