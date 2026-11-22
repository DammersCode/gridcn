import type { CSSProperties } from "react";
import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGrid, DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, type DeepPartialLabels } from "../data-grid";
import { gridAttrSelector } from "../data-grid-sdk";
// real stylesheet — layout/viewport-fill assertions need the real cascade.
import "@/app/global.css";

type Row = { id: string; name: string };

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({ id: `row-${i}`, name: `Person ${i}` }));
}

const columns = [
  { id: "id", header: "ID", accessorKey: "id" as const, type: "text" as const, width: 120 },
  { id: "name", header: "Name", accessorKey: "name" as const, type: "text" as const, width: 180 },
];

describe("loading + zero rows: skeleton body", () => {
  it("renders viewport-filling skeleton rows instead of the empty state, and sets aria-busy", async () => {
    await render(
      <div style={{ height: 360, width: 600 }}>
        <DataGrid data={[]} columns={columns} getRowId={(r: Row) => r.id} className="h-90 w-150" loading />
      </div>,
    );
    const grid = page.getByRole("grid");
    await expect.element(grid).toBeInTheDocument();
    await expect.element(grid).toHaveAttribute("aria-busy", "true");

    expect(document.querySelector(gridAttrSelector("emptyState"))).toBeNull();
    const skeleton = document.querySelector(gridAttrSelector("loadingSkeleton"));
    expect(skeleton).not.toBeNull();
    expect(skeleton!.getAttribute("aria-hidden")).toBe("true");
    expect(document.querySelector("[role=progressbar]")!.getAttribute("aria-label")).toBe("Loading…");
    // enough bars to more than fill a 360px-tall viewport at the default 36px row height.
    expect(skeleton!.children.length).toBeGreaterThanOrEqual(9);
  });

  it("labels.grid.loading overrides the progressbar label while the skeleton shows", async () => {
    const labels: DeepPartialLabels = { grid: { loading: "Wird geladen…" } };
    await render(
      <div style={{ height: 360, width: 600 }}>
        <DataGridProvider data={[]} columns={columns} getRowId={(r: Row) => r.id} labels={labels}>
          <DataGridRoot className="h-90 w-150" loading>
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    expect(document.querySelector("[role=progressbar]")!.getAttribute("aria-label")).toBe("Wird geladen…");
  });
});

describe("loading + rows present: indeterminate bar", () => {
  it("keeps rows visible and shows the progress bar instead of a skeleton", async () => {
    await render(
      <div style={{ height: 360, width: 600 }}>
        <DataGrid data={makeRows(20)} columns={columns} getRowId={(r: Row) => r.id} className="h-90 w-150" loading />
      </div>,
    );
    const grid = page.getByRole("grid");
    await expect.element(grid).toBeInTheDocument();
    await expect.element(grid).toHaveAttribute("aria-busy", "true");

    expect(document.querySelector(gridAttrSelector("loadingSkeleton"))).toBeNull();
    const bar = document.querySelector(gridAttrSelector("loadingBar"));
    expect(bar).not.toBeNull();
    expect(bar!.getAttribute("aria-hidden")).toBe("true");
    const progress = document.querySelector("[role=progressbar]");
    expect(progress).not.toBeNull();
    expect(progress!.getAttribute("aria-label")).toBe("Loading…");
    expect(progress!.closest("[role=grid]")).toBeNull();

    // real data rows still render underneath the bar.
    const cells = document.querySelectorAll('[role="gridcell"][data-column-id="name"]');
    expect(cells.length).toBeGreaterThan(0);
    expect(cells[0]!.textContent).toBe("Person 0");
  });

  it("paints the bar after a 150 ms show delay, while aria-busy is on at once", async () => {
    await render(
      <div style={{ height: 360, width: 600 }}>
        <DataGrid data={makeRows(20)} columns={columns} getRowId={(r: Row) => r.id} className="h-90 w-150" loading />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toHaveAttribute("aria-busy", "true");
    const bar = document.querySelector<HTMLElement>(gridAttrSelector("loadingBar"))!;
    const style = getComputedStyle(bar);
    expect(style.animationName).toBe("grid-loading-show");
    expect(style.animationDuration).toBe("0.15s");
    await expect.poll(() => getComputedStyle(bar).opacity).toBe("1");
  });

  it("paints the bar at once with --grid-loading-bar-delay: 0ms", async () => {
    await render(
      <div style={{ height: 360, width: 600, "--grid-loading-bar-delay": "0ms" } as CSSProperties}>
        <DataGrid data={makeRows(20)} columns={columns} getRowId={(r: Row) => r.id} className="h-90 w-150" loading />
      </div>,
    );
    const bar = document.querySelector<HTMLElement>(gridAttrSelector("loadingBar"))!;
    expect(getComputedStyle(bar).animationDuration).toBe("0s");
    expect(getComputedStyle(bar).opacity).toBe("1");
  });

  it("keeps the bar transparent while the show delay runs", async () => {
    await render(
      <div style={{ height: 360, width: 600, "--grid-loading-bar-delay": "60s" } as CSSProperties}>
        <DataGrid data={makeRows(20)} columns={columns} getRowId={(r: Row) => r.id} className="h-90 w-150" loading />
      </div>,
    );
    const bar = document.querySelector<HTMLElement>(gridAttrSelector("loadingBar"))!;
    expect(getComputedStyle(bar).opacity).toBe("0");
  });
});

describe("loading=false: unchanged default behavior", () => {
  it("zero rows still shows the empty state, no aria-busy, no skeleton/bar", async () => {
    await render(
      <div style={{ height: 360, width: 600 }}>
        <DataGrid data={[]} columns={columns} getRowId={(r: Row) => r.id} className="h-90 w-150" />
      </div>,
    );
    const grid = page.getByRole("grid");
    await expect.element(grid).toBeInTheDocument();
    await expect.element(grid).not.toHaveAttribute("aria-busy");

    expect(document.querySelector(gridAttrSelector("emptyState"))).not.toBeNull();
    expect(document.querySelector(gridAttrSelector("loadingSkeleton"))).toBeNull();
    expect(document.querySelector(gridAttrSelector("loadingBar"))).toBeNull();
  });

  it("rows present, loading omitted: no progress bar", async () => {
    await render(
      <div style={{ height: 360, width: 600 }}>
        <DataGrid data={makeRows(5)} columns={columns} getRowId={(r: Row) => r.id} className="h-90 w-150" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    expect(document.querySelector(gridAttrSelector("loadingBar"))).toBeNull();
  });
});
