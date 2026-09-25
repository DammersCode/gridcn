import { page } from "vitest/browser";
import { Component, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGrid, defineColumns, GRID_ATTR } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridPagination } from "./use-data-grid-pagination";
import { DataGridPaginationBar, DataGridPaginationPrev, DataGridPaginationNext } from "./pagination-footer";
// real stylesheet so Select/Button layout is real, matching other block browser tests
import "@/app/global.css";

// Render errors surface async in a real browser render, not synchronously from render() — an
// error boundary is the reliable way to observe the thrown context-guard message.
class CaughtError extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    return this.state.error ? this.state.error.message : this.props.children;
  }
}

type Row = { id: string; name: string };

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({ id: `r${i}`, name: `Person ${i}` }));
}

const columns = defineColumns<Row>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 160 },
] as const);

function PaginatedGrid() {
  const pager = useDataGridPagination({ data: makeRows(101), pageSize: 25 });
  return (
    <div style={{ height: 360, width: 400 }}>
      <DataGrid data={pager.pageData!} columns={columns} getRowId={(r) => r.id} className="h-72" />
      <DataGridPaginationBar {...pager.controls} />
    </div>
  );
}

const windowedRows = makeRows(251);

function WindowedPaginatedGrid({ windowSize }: { windowSize?: number }) {
  const pager = useDataGridPagination({ data: windowedRows, pageSize: 25 });
  return (
    <div style={{ height: 360, width: 400 }}>
      <DataGrid data={pager.pageData!} columns={columns} getRowId={(r) => r.id} className="h-72" />
      <DataGridPaginationBar {...pager.controls} windowSize={windowSize} />
    </div>
  );
}

function CustomPaginatedGrid() {
  const pager = useDataGridPagination({ data: makeRows(101), pageSize: 25 });
  return (
    <div style={{ height: 360, width: 400 }}>
      <DataGrid data={pager.pageData!} columns={columns} getRowId={(r) => r.id} className="h-72" />
      <DataGridPaginationBar {...pager.controls}>
        <DataGridPaginationPrev />
        <DataGridPaginationNext />
      </DataGridPaginationBar>
    </div>
  );
}

describe("DataGridPaginationBar: default layout", () => {
  it("shows the range label for the first page and the first row's content", async () => {
    await render(<PaginatedGrid />);
    await expect.element(page.getByText("1–25 of 101")).toBeInTheDocument();
    await expect.element(page.getByText("Person 0")).toBeInTheDocument();
  });

  it("stamps GRID_ATTR.pagination on the footer root, for CSS-only targeting", async () => {
    await render(<PaginatedGrid />);
    const footer = document.querySelector(`[${GRID_ATTR.pagination}]`);
    expect(footer).not.toBeNull();
  });

  it("next page updates the rendered rows and the range label", async () => {
    await render(<PaginatedGrid />);
    await page.getByRole("button", { name: "Next page" }).click();
    await expect.element(page.getByText("26–50 of 101")).toBeInTheDocument();
    await expect.element(page.getByText("Person 25")).toBeInTheDocument();
    await expect.element(page.getByText("Person 0")).not.toBeInTheDocument();
  });

  it("a numbered page button jumps directly to that page", async () => {
    await render(<PaginatedGrid />);
    await page.getByRole("button", { name: "Go to page 3" }).click();
    await expect.element(page.getByText("51–75 of 101")).toBeInTheDocument();
    await expect.element(page.getByText("Person 50")).toBeInTheDocument();
  });

  it("previous page is disabled on page 1 and next page is disabled on the last page", async () => {
    await render(<PaginatedGrid />);
    await expect.element(page.getByRole("button", { name: "Previous page" })).toBeDisabled();
    await page.getByRole("button", { name: "Go to page 5" }).click();
    await expect.element(page.getByText("101–101 of 101")).toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("changing the page-size select re-slices the grid and resets the visible range", async () => {
    await render(<PaginatedGrid />);
    await page.getByRole("combobox", { name: "Rows per page" }).click();
    await page.getByRole("option", { name: "50 / page" }).click();
    await expect.element(page.getByText("1–50 of 101")).toBeInTheDocument();
    await expect.element(page.getByText("Person 0")).toBeInTheDocument();
  });
});

describe("DataGridPaginationBar: first/last", () => {
  it("jumps to the last page and disables itself there, then jumps back to the first page", async () => {
    await render(<PaginatedGrid />);
    await expect.element(page.getByRole("button", { name: "First page" })).toBeDisabled();

    await page.getByRole("button", { name: "Last page" }).click();
    await expect.element(page.getByText("101–101 of 101")).toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Last page" })).toBeDisabled();
    await expect.element(page.getByRole("button", { name: "Next page" })).toBeDisabled();

    await page.getByRole("button", { name: "First page" }).click();
    await expect.element(page.getByText("1–25 of 101")).toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "First page" })).toBeDisabled();
  });
});

describe("DataGridPaginationBar: windowSize", () => {
  it("the default layout's page buttons follow the bar's windowSize", async () => {
    const screen = await render(<WindowedPaginatedGrid />);
    // 251 rows / 25 per page = 11 pages; default window of 5 on page 1 shows pages 1-5
    await expect.element(page.getByRole("button", { name: "Go to page 5" })).toBeInTheDocument();
    expect(page.getByRole("button", { name: "Go to page 6" }).elements()).toHaveLength(0);

    await screen.rerender(<WindowedPaginatedGrid windowSize={3} />);
    await expect.element(page.getByRole("button", { name: "Go to page 3" })).toBeInTheDocument();
    expect(page.getByRole("button", { name: "Go to page 4" }).elements()).toHaveLength(0);
  });
});

describe("DataGridPaginationBar: custom composition", () => {
  it("renders only the composed parts and still pages", async () => {
    await render(<CustomPaginatedGrid />);
    await expect.element(page.getByRole("button", { name: "Previous page" })).toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Next page" })).toBeInTheDocument();
    expect(page.getByRole("button", { name: "First page" }).elements()).toHaveLength(0);
    expect(page.getByRole("button", { name: "Go to page 1" }).elements()).toHaveLength(0);
    expect(page.getByText("1–25 of 101").elements()).toHaveLength(0);

    await page.getByRole("button", { name: "Next page" }).click();
    await expect.element(page.getByText("Person 25")).toBeInTheDocument();
  });
});

describe("DataGridPaginationBar: context guard", () => {
  it("throws when a part is rendered outside the bar", async () => {
    await render(
      <CaughtError>
        <DataGridPaginationPrev />
      </CaughtError>,
    );
    await expect.element(page.getByText(/must be used inside a <DataGridPaginationBar>/)).toBeInTheDocument();
  });
});
