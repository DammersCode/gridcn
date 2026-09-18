import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGrid, DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, gridAttrSelector, type DeepPartialLabels } from "../data-grid";
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
    render(
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
    expect(skeleton!.getAttribute("aria-label")).toBe("Loading…");
    // enough bars to more than fill a 360px-tall viewport at the default 36px row height.
    expect(skeleton!.children.length).toBeGreaterThanOrEqual(9);
  });

  it("labels.grid.loading overrides the skeleton's aria-label", async () => {
    const labels: DeepPartialLabels = { grid: { loading: "Wird geladen…" } };
    render(
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
    const skeleton = document.querySelector(gridAttrSelector("loadingSkeleton"));
    expect(skeleton!.getAttribute("aria-label")).toBe("Wird geladen…");
  });
});

describe("loading + rows present: indeterminate bar", () => {
  it("keeps rows visible and shows the progress bar instead of a skeleton", async () => {
    render(
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
    expect(bar!.getAttribute("role")).toBe("progressbar");
    expect(bar!.getAttribute("aria-label")).toBe("Loading…");

    // real data rows still render underneath the bar.
    const cells = document.querySelectorAll('[role="gridcell"][data-column-id="name"]');
    expect(cells.length).toBeGreaterThan(0);
    expect(cells[0]!.textContent).toBe("Person 0");
  });
});

describe("loading=false: unchanged default behavior", () => {
  it("zero rows still shows the empty state, no aria-busy, no skeleton/bar", async () => {
    render(
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
    render(
      <div style={{ height: 360, width: 600 }}>
        <DataGrid data={makeRows(5)} columns={columns} getRowId={(r: Row) => r.id} className="h-90 w-150" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    expect(document.querySelector(gridAttrSelector("loadingBar"))).toBeNull();
  });
});
