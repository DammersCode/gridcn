import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataGridProvider, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridPaginationBar } from "./pagination-footer";

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
  const warnings = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.filter((c) => String(c[0]).includes("spread `server.pager`"));

  it("warns once in development when a no-props bar reads a grid with a server row count", () => {
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
    expect(warnings(warn)).toHaveLength(1);
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
