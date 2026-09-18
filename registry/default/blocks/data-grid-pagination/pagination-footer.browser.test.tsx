import { page } from "vitest/browser";
import { Component, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGrid, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
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
    render(<PaginatedGrid />);
    await expect.element(page.getByText("1–25 of 101")).toBeInTheDocument();
    await expect.element(page.getByText("Person 0")).toBeInTheDocument();
  });

  it("next page updates the rendered rows and the range label", async () => {
    render(<PaginatedGrid />);
    await page.getByRole("button", { name: "Next page" }).click();
    await expect.element(page.getByText("26–50 of 101")).toBeInTheDocument();
    await expect.element(page.getByText("Person 25")).toBeInTheDocument();
    await expect.element(page.getByText("Person 0")).not.toBeInTheDocument();
  });

  it("a numbered page button jumps directly to that page", async () => {
    render(<PaginatedGrid />);
    await page.getByRole("button", { name: "Go to page 3" }).click();
    await expect.element(page.getByText("51–75 of 101")).toBeInTheDocument();
    await expect.element(page.getByText("Person 50")).toBeInTheDocument();
  });

  it("previous page is disabled on page 1 and next page is disabled on the last page", async () => {
    render(<PaginatedGrid />);
    await expect.element(page.getByRole("button", { name: "Previous page" })).toBeDisabled();
    await page.getByRole("button", { name: "Go to page 5" }).click();
    await expect.element(page.getByText("101–101 of 101")).toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("changing the page-size select re-slices the grid and resets the visible range", async () => {
    render(<PaginatedGrid />);
    await page.getByRole("combobox", { name: "Rows per page" }).click();
    await page.getByRole("option", { name: "50 / page" }).click();
    await expect.element(page.getByText("1–50 of 101")).toBeInTheDocument();
    await expect.element(page.getByText("Person 0")).toBeInTheDocument();
  });
});

describe("DataGridPaginationBar: first/last", () => {
  it("jumps to the last page and disables itself there, then jumps back to the first page", async () => {
    render(<PaginatedGrid />);
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

describe("DataGridPaginationBar: custom composition", () => {
  it("renders only the composed parts and still pages", async () => {
    render(<CustomPaginatedGrid />);
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
    render(
      <CaughtError>
        <DataGridPaginationPrev />
      </CaughtError>,
    );
    await expect.element(page.getByText(/must be used inside a <DataGridPaginationBar>/)).toBeInTheDocument();
  });
});
