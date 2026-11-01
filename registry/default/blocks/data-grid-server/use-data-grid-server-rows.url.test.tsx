import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { DataGridProvider, DataGridRoot, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridUrlState, useDataGridUrlPagination } from "@/registry/default/blocks/data-grid-url-state/data-grid-url-state";
import { useDataGridServerRows, type ServerRowsAnswer, type ServerRowsPageRequest } from "./use-data-grid-server-rows";

afterEach(cleanup);

type Row = { id: string; name: string };

const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text", width: 100 }] as const);

function mount(searchParams: string) {
  const fetchRows = vi.fn<(req: ServerRowsPageRequest) => Promise<ServerRowsAnswer<Row>>>(async ({ start, end }) => ({
    rows: Array.from({ length: end - start }, (_, i) => ({ id: `r${start + i}`, name: `Name ${start + i}` })),
    totalRowCount: 500,
  }));
  let status = "";
  function Tree() {
    const url = useDataGridUrlPagination({ defaultPageSize: 10, pageSizeOptions: [10, 25] });
    const server = useDataGridServerRows<Row>({ getRowId: (row) => row.id, fetchRows, ...url });
    status = server.status;
    return (
      <DataGridProvider columns={columns} {...server.providerProps}>
        <DataGridUrlState />
        <DataGridRoot {...server.rootProps} />
      </DataGridProvider>
    );
  }
  render(
    <NuqsTestingAdapter searchParams={searchParams}>
      <Tree />
    </NuqsTestingAdapter>,
  );
  return { fetchRows, status: () => status };
}

describe("a spec restored from the URL", () => {
  it("issues one request, with the restored sort, search, and page", async () => {
    const { fetchRows, status } = mount("?sort=name:desc&q=ann&page=3");
    await waitFor(() => expect(status()).toBe("ready"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchRows).toHaveBeenCalledTimes(1);
    expect(fetchRows.mock.calls[0]![0]).toMatchObject({ page: 3, pageSize: 10, start: 20, end: 30, spec: { sorts: [{ columnId: "name", direction: "desc" }], searchText: "ann" } });
  });

  it("without URL state issues one request too", async () => {
    const { fetchRows, status } = mount("");
    await waitFor(() => expect(status()).toBe("ready"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchRows).toHaveBeenCalledTimes(1);
  });
});
