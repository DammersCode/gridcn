import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGrid } from "../data-grid";
import { makeRows } from "./perf-probe.test-helper";
import { gridElement, mountedRows, settle } from "./scroll-origin.test-helper";
import "@/app/global.css";

const ROWS = 480_000;
// Firefox places a sticky box at most 2^29 app units (about 8.9M px) from its containing block.
const MAX_STICKY_OFFSET_PX = 1_000_000;

const columns = [{ id: "name", header: "Name", accessorKey: "name" as const, type: "text" as const, width: 200 }];

function stickyViewport(): HTMLElement {
  const viewport = document.querySelector<HTMLElement>("[data-grid-sticky-track] > *");
  if (!viewport?.parentElement) throw new Error("sticky viewport not found");
  return viewport;
}

describe("sticky viewport range", () => {
  it.each([0.75, 1])("keeps the sticky offset small at %s of a 480k-row scroll range", async (fraction) => {
    await render(
      <div style={{ height: 400, width: 800 }}>
        <DataGrid data={makeRows(ROWS)} columns={columns} getRowId={(r) => r.id} className="h-100 w-200" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = gridElement();
    grid.scrollTop = Math.round((grid.scrollHeight - grid.clientHeight) * fraction);
    await settle();

    const viewport = stickyViewport();
    const stickyOffset = viewport.getBoundingClientRect().top - viewport.parentElement!.getBoundingClientRect().top;
    expect(Math.abs(stickyOffset)).toBeLessThan(MAX_STICKY_OFFSET_PX);
    expect(Math.abs(viewport.getBoundingClientRect().top - grid.getBoundingClientRect().top - grid.clientTop)).toBeLessThanOrEqual(1);

    // Scrolling back to the top must re-anchor the track below the scroll position.
    grid.scrollTop = 0;
    await settle();
    expect(Math.abs(stickyViewport().getBoundingClientRect().top - grid.getBoundingClientRect().top - grid.clientTop)).toBeLessThanOrEqual(1);
  });

  it("keeps the header at the top of the scrollport across repeated big jumps", async () => {
    await render(
      <div style={{ height: 400, width: 800 }}>
        <DataGrid data={makeRows(ROWS)} columns={columns} getRowId={(r) => r.id} className="h-100 w-200" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = gridElement();
    const header = document.querySelector<HTMLElement>("[data-grid-header-layer]")!;
    for (const fraction of [0.8, 0.05, 0.95, 0.4, 1, 0, 0.6]) {
      grid.scrollTop = Math.round((grid.scrollHeight - grid.clientHeight) * fraction);
      await settle();
      const stickyOffset = stickyViewport().getBoundingClientRect().top - stickyViewport().parentElement!.getBoundingClientRect().top;
      expect(Math.abs(stickyOffset)).toBeLessThanOrEqual(MAX_STICKY_OFFSET_PX);
      expect(Math.abs(header.getBoundingClientRect().top - grid.getBoundingClientRect().top - grid.clientTop)).toBeLessThanOrEqual(1);
    }
  });

  it("keeps the sticky viewport free of absolute and clipped ancestors", async () => {
    await render(
      <div style={{ height: 400, width: 800 }}>
        <DataGrid data={makeRows(1000)} columns={columns} getRowId={(r) => r.id} className="h-100 w-200" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = gridElement();
    for (let el = stickyViewport().parentElement; el && el !== grid; el = el.parentElement) {
      const style = getComputedStyle(el);
      expect(style.position, "Firefox skips painting a sticky box in an absolute containing block").not.toBe("absolute");
      expect(style.overflowX).toBe("visible");
      expect(style.overflowY).toBe("visible");
      expect(style.transform).toBe("none");
      expect(style.willChange).toBe("auto");
      expect(style.contain).toBe("none");
    }
  });

  it("keeps the scroll range at the content height after deep scrolls", async () => {
    await render(
      <div style={{ height: 400, width: 800 }}>
        <DataGrid data={makeRows(ROWS)} columns={columns} getRowId={(r) => r.id} className="h-100 w-200" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = gridElement();
    const initial = grid.scrollHeight;
    for (const fraction of [0.75, 1, 0.3, 0]) {
      grid.scrollTop = Math.round((initial - grid.clientHeight) * fraction);
      await settle();
      expect(grid.scrollHeight).toBe(initial);
    }
  });

  it("keeps the header pinned in small steps upward across a re-anchor", async () => {
    await render(
      <div style={{ height: 400, width: 800 }}>
        <DataGrid data={makeRows(ROWS)} columns={columns} getRowId={(r) => r.id} className="h-100 w-200" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = gridElement();
    const header = document.querySelector<HTMLElement>("[data-grid-header-layer]")!;
    grid.scrollTop = 4_000_000;
    await settle();
    for (let i = 0; i < 40; i++) {
      grid.scrollTop -= 60_000;
      await settle();
      expect(Math.abs(header.getBoundingClientRect().top - grid.getBoundingClientRect().top - grid.clientTop)).toBeLessThanOrEqual(1);
    }
  });

  it("clamps the scroll range when the rows shrink below the track top", async () => {
    const view = (rows: number) => (
      <div style={{ height: 400, width: 800 }}>
        <DataGrid data={makeRows(rows)} columns={columns} getRowId={(r) => r.id} className="h-100 w-200" />
      </div>
    );
    const screen = await render(view(300_000));
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = gridElement();
    grid.scrollTop = grid.scrollHeight;
    await settle();

    await screen.rerender(view(10));
    await settle();

    expect(grid.scrollHeight).toBeLessThan(1_000);
    expect(grid.scrollTop).toBeLessThanOrEqual(Math.max(0, grid.scrollHeight - grid.clientHeight));
    const gridRect = grid.getBoundingClientRect();
    const visible = mountedRows().filter((row) => {
      const rect = row.getBoundingClientRect();
      return rect.bottom > gridRect.top && rect.top < gridRect.bottom;
    });
    expect(visible).toHaveLength(10);
  });
});
