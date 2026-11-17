import { cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataGridProvider, DataGridRoot, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridPaginationBar } from "./pagination-footer";
import { useDataGridServerPager } from "./use-data-grid-server-pager";

afterEach(cleanup);

type Row = { id: string };
const columns = defineColumns<Row>()([{ id: "id", header: "Id", accessorKey: "id", type: "text", width: 100 }] as const);
const rows: Row[] = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}` }));

describe("DataGridPaginationBar labels", () => {
  it("reads labels.pagination from the provider and lets the bar's labels win", () => {
    render(
      <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id} pageSize={10} labels={{ pagination: { nextPage: "Weiter", previousPage: "Zurück" } }}>
        <DataGridPaginationBar labels={{ previousPage: "Vorherige" }} />
      </DataGridProvider>,
    );
    expect(screen.getByRole("button", { name: "Weiter" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Vorherige" })).toBeInTheDocument();
  });

  it("falls back to the defaults outside a provider", () => {
    render(
      <DataGridPaginationBar
        page={0}
        pageSize={10}
        totalRowCount={30}
        pageCount={3}
        hasMore
        pageSizeOptions={[10]}
        onPageChange={() => {}}
        onPageSizeChange={() => {}}
        labels={{ nextPage: undefined }}
      />,
    );
    expect(screen.getByRole("button", { name: "Next page" })).toBeInTheDocument();
  });
});

describe("DataGridPaginationBar in a server grid", () => {
  const warnings = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.filter((c) => String(c[0]).includes("pager.gridProps"));

  it("warns once in development when a no-props bar reads a grid with a server row count", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { rerender } = render(
      <DataGridProvider data={rows.slice(0, 10)} columns={columns} getRowId={(r) => r.id} totalRowCount={500}>
        <DataGridPaginationBar />
      </DataGridProvider>,
    );
    rerender(
      <DataGridProvider data={rows.slice(0, 10)} columns={columns} getRowId={(r) => r.id} totalRowCount={500}>
        <DataGridPaginationBar />
      </DataGridProvider>,
    );
    await waitFor(() => expect(warnings(warn)).toHaveLength(1));
    warn.mockRestore();
  });

  it("stays quiet for a provider that pages its view", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(
      <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id} pageSize={10}>
        <DataGridPaginationBar />
      </DataGridProvider>,
    );
    expect(warnings(warn)).toHaveLength(0);
    warn.mockRestore();
  });
});

describe("DataGridPaginationBar without controls under a server pager", () => {
  function Grid({ onPageChange }: { onPageChange: (page: number) => void }) {
    const { gridProps } = useDataGridServerPager({ page: 2, pageSize: 10, totalRowCount: 95, onPageChange, onPageSizeChange: () => {}, pageSizeOptions: [10, 20] });
    return (
      <DataGridProvider data={rows.slice(0, 10)} columns={columns} getRowId={(r) => r.id} {...gridProps}>
        <DataGridRoot />
        <DataGridPaginationBar />
      </DataGridProvider>
    );
  }

  it("reads the server pager from gridProps and reports page changes", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onPageChange = vi.fn();
    render(<Grid onPageChange={onPageChange} />);
    expect(screen.getByText("11–20 of 95")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(onPageChange).toHaveBeenCalledWith(3);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("pager.gridProps"))).toHaveLength(0);
    warn.mockRestore();
  });

  it("gridProps carries the row count that puts the grid in server mode", () => {
    const { result } = renderHook(() => useDataGridServerPager({ page: 1, pageSize: 10, totalRowCount: 95, onPageChange: () => {} }));
    expect(result.current.gridProps.totalRowCount).toBe(95);
  });
});

describe("DataGridPaginationBar with a provider pageSizeOptions", () => {
  it("offers the provider's sizes", () => {
    render(
      <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id} pageSize={10} pageSizeOptions={[10, 15]}>
        <DataGridPaginationBar />
      </DataGridProvider>,
    );
    expect(screen.getByRole("combobox", { name: "Rows per page" })).toBeInTheDocument();
  });
});
