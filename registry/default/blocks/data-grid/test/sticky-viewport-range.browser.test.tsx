import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGrid } from "../data-grid";
import { makeRows } from "./perf-probe.test-helper";
import { gridElement, settle } from "./scroll-origin.test-helper";
import "@/app/global.css";

const ROWS = 480_000;
// Firefox places a sticky box at most 2^29 app units (about 8.9M px) from its containing block.
const MAX_STICKY_OFFSET_PX = 4_000_000;

const columns = [{ id: "name", header: "Name", accessorKey: "name" as const, type: "text" as const, width: 200 }];

function stickyViewport(): HTMLElement {
  let el = document.querySelector<HTMLElement>("[data-grid-rows-canvas]");
  while (el && getComputedStyle(el).position !== "sticky") el = el.parentElement;
  if (!el?.parentElement) throw new Error("sticky viewport not found");
  return el;
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
});
