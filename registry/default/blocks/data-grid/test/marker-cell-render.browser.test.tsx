import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import type { ReactNode } from "react";
import { DataGrid, type MarkerCellRenderCtx } from "../data-grid";
import { makeRows } from "./perf-probe.test-helper";
import "@/app/global.css";

const wideColumns = Array.from({ length: 60 }, (_, i) => ({
  id: `c${i}`,
  header: `Col ${i}`,
  accessorKey: "name" as const,
  type: "text" as const,
  width: 150,
}));

describe("marker cell renders", () => {
  it("does not re-render marker cells of mounted rows when the column window changes", async () => {
    const renderCounts = new Map<string, number>();
    const renderMarker = ({ rowId }: MarkerCellRenderCtx): ReactNode => {
      renderCounts.set(rowId, (renderCounts.get(rowId) ?? 0) + 1);
      return null;
    };
    await render(
      <div style={{ height: 400, width: 800 }}>
        <DataGrid data={makeRows(200)} columns={wideColumns} getRowId={(r) => r.id} rowMarkers="checkbox" renderMarker={renderMarker} className="h-100 w-200" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    const mountedColumns = () => grid.querySelector('[role="row"][data-grid-row-index="0"]')?.querySelectorAll('[role="gridcell"]:not([data-grid-marker-cell])').length ?? 0;
    const firstColumnCount = mountedColumns();
    expect(firstColumnCount).toBeGreaterThan(0);

    const before = new Map(renderCounts);
    let columnWindowChanges = 0;
    for (let step = 1; step <= 12; step++) {
      const lastBefore = grid.querySelector('[role="row"][data-grid-row-index="0"] [role="gridcell"]:last-child')?.getAttribute("aria-colindex");
      grid.scrollLeft = step * 400;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const lastAfter = grid.querySelector('[role="row"][data-grid-row-index="0"] [role="gridcell"]:last-child')?.getAttribute("aria-colindex");
      if (lastBefore !== lastAfter) columnWindowChanges++;
    }
    expect(columnWindowChanges).toBeGreaterThan(3);

    let extraRenders = 0;
    for (const [rowId, count] of before) extraRenders += (renderCounts.get(rowId) ?? 0) - count;
    console.log(`marker-render extraRenders=${extraRenders} rows=${before.size} columnWindowChanges=${columnWindowChanges}`);
    expect(extraRenders).toBe(0);
  });
});
