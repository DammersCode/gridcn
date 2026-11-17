import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataGridProvider, DataGridRoot, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridPaginationBar } from "@/registry/default/blocks/data-grid-pagination/data-grid-pagination";
import { useDataGridServerRows } from "./use-data-grid-server-rows";

afterEach(cleanup);

type Row = { id: string };
const columns = defineColumns<Row>()([{ id: "id", header: "Id", accessorKey: "id", type: "text", width: 100 }] as const);

function Grid() {
  const server = useDataGridServerRows<Row>({
    getRowId: (r) => r.id,
    defaultPageSize: 10,
    fetchRows: async ({ page, pageSize }) => ({ rows: Array.from({ length: pageSize }, (_, i) => ({ id: `r${(page - 1) * pageSize + i}` })), totalRowCount: 95 }),
  });
  return (
    <DataGridProvider columns={columns} {...server.providerProps}>
      <DataGridRoot {...server.rootProps} />
      <DataGridPaginationBar />
    </DataGridProvider>
  );
}

describe("DataGridPaginationBar without controls under useDataGridServerRows", () => {
  it("reads the server pager, pages it, and raises no pager warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<Grid />);
    await waitFor(() => expect(screen.getByText("1–10 of 95")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(screen.getByText("11–20 of 95")).toBeInTheDocument());
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("pager"))).toHaveLength(0);
    warn.mockRestore();
  });
});
