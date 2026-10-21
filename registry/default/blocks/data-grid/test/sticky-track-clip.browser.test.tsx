import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import type { ReactNode } from "react";
import { DataGrid } from "../data-grid";
import { useDataGridPinnedRows } from "@/registry/default/blocks/data-grid-pinned-rows/use-data-grid-pinned-rows";
import { makeRows } from "./perf-probe.test-helper";
import { gridElement, settle } from "./scroll-origin.test-helper";
import "@/app/global.css";

const columns = [{ id: "name", header: "Name", accessorKey: "name" as const, type: "text" as const, width: 200 }];

const frame = (children: ReactNode) => <div style={{ height: 600, width: 800 }}>{children}</div>;

const viewport = () => document.querySelector<HTMLElement>("[data-grid-sticky-track] > *")!;

function hitAt(x: number, y: number): Element | null {
  return document.elementFromPoint(x, y);
}

async function mounted() {
  await expect.element(page.getByRole("grid")).toBeInTheDocument();
  await settle();
  return gridElement().getBoundingClientRect();
}

function PinnedBottomGrid() {
  const { plugin } = useDataGridPinnedRows({ bottomRows: [{ id: "total", name: "Total" }] });
  return <DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} plugins={[plugin]} className="h-150 w-200" />;
}

describe("sticky track clipping", () => {
  it("shows the empty state of a tall grid without rows", async () => {
    await render(frame(<DataGrid data={makeRows(0)} columns={columns} getRowId={(r) => r.id} className="h-150 w-200" />));
    await mounted();
    const rect = document.querySelector("[data-grid-empty-state]")!.getBoundingClientRect();
    const hit = hitAt(rect.left + rect.width / 2, rect.top + rect.height / 2);
    expect(hit && viewport().contains(hit)).toBe(true);
  });

  it("shows the loading skeleton of a tall grid without rows", async () => {
    await render(frame(<DataGrid data={makeRows(0)} loading columns={columns} getRowId={(r) => r.id} className="h-150 w-200" />));
    const grid = await mounted();
    const hit = hitAt(grid.left + 100, grid.top + 200);
    expect(hit && viewport().contains(hit)).toBe(true);
  });

  it("shows a pinned-bottom band under a few rows in a tall grid", async () => {
    await render(frame(<PinnedBottomGrid />));
    await mounted();
    const band = document.querySelector('[data-grid-pinned-row-band="bottom"]')!;
    const rect = band.getBoundingClientRect();
    const hit = hitAt(rect.left + 50, rect.top + rect.height / 2);
    expect(hit && band.contains(hit)).toBe(true);
  });

  it("shows the header right of the last column in a grid wider than its columns", async () => {
    await render(frame(<DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} className="h-150 w-100" />));
    const grid = await mounted();
    expect(grid.right).toBeLessThan(window.innerWidth);
    const hit = hitAt(grid.right - 20, grid.top + 10);
    expect(hit && viewport().contains(hit)).toBe(true);
  });

  it("adds no scroll range to a grid smaller than its viewport", async () => {
    await render(frame(<DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} className="h-150 w-200" />));
    await mounted();
    const grid = gridElement();
    expect(grid.scrollHeight).toBe(grid.clientHeight);
    expect(grid.scrollWidth).toBe(grid.clientWidth);
  });
});
