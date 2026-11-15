import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DataGridProvider, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridPaginationBar } from "./pagination-footer";
import { DEFAULT_PAGE_SIZES } from "./pagination-math";

type Row = { id: string };
const columns = defineColumns<Row>()([{ id: "id", header: "Id", accessorKey: "id", type: "text" }] as const);
const rows: Row[] = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}` }));
const labels = { pagination: { firstPage: "Erste Seite", lastPage: "Letzte Seite" } };

describe("DataGridPaginationBar labels", () => {
  it("reads the grid labels inside a provider", () => {
    render(
      <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id} defaultPageSize={10} labels={labels}>
        <DataGridPaginationBar />
      </DataGridProvider>,
    );
    expect(screen.getByLabelText("Erste Seite")).toBeTruthy();
  });

  it("reads the grid labels when the bar gets its own controls", () => {
    const controls = { page: 1, pageCount: 3, pageSize: 10, pageSizeOptions: DEFAULT_PAGE_SIZES, totalRowCount: 30, hasMore: true, onPageChange: () => {}, onPageSizeChange: () => {} };
    render(
      <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id} labels={labels}>
        <DataGridPaginationBar {...controls} />
      </DataGridProvider>,
    );
    expect(screen.getByLabelText("Letzte Seite")).toBeTruthy();
  });

  it("lets the bar's own labels prop win over the grid labels", () => {
    render(
      <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id} defaultPageSize={10} labels={labels}>
        <DataGridPaginationBar labels={{ firstPage: "Anfang" }} />
      </DataGridProvider>,
    );
    expect(screen.getByLabelText("Anfang")).toBeTruthy();
    expect(screen.getByLabelText("Letzte Seite")).toBeTruthy();
  });

  it("renders with the defaults outside a provider", () => {
    const controls = { page: 1, pageCount: 3, pageSize: 10, pageSizeOptions: DEFAULT_PAGE_SIZES, totalRowCount: 30, hasMore: true, onPageChange: () => {}, onPageSizeChange: () => {} };
    render(<DataGridPaginationBar {...controls} />);
    expect(screen.getByLabelText("First page")).toBeTruthy();
  });
});
