import { page, userEvent } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGrid } from "../data-grid";
import { makeRows } from "./perf-probe.test-helper";
import { cellAt, firstRowHeight, gridElement, scrollByTicks } from "./scroll-origin.test-helper";
import "@/app/global.css";

const columns = Array.from({ length: 5 }, (_, i) => ({
  id: `c${i}`,
  header: `Col ${i}`,
  accessorKey: "name" as const,
  type: "text" as const,
  width: 150,
}));

describe("editor on a parked active cell", () => {
  it("leaves the scroll position alone when typing opens the editor", async () => {
    await render(
      <div style={{ height: 400, width: 800 }}>
        <DataGrid data={makeRows(100_000)} columns={columns} getRowId={(r) => r.id} className="h-100 w-200" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    await userEvent.click(cellAt(2, "c1"));
    await scrollByTicks(3000, firstRowHeight());
    const grid = gridElement();
    const scrollTop = grid.scrollTop;
    const scrollLeft = grid.scrollLeft;

    await userEvent.keyboard("a");
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(document.activeElement?.tagName).toBe("INPUT");
    expect(grid.scrollTop).toBe(scrollTop);
    expect(grid.scrollLeft).toBe(scrollLeft);
  });
});
