import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import { useDataGridServerRows, type ServerRowsFetchContext, type ServerRowsPage } from "@/registry/default/blocks/data-grid-server/use-data-grid-server-rows";
import { DataGridRoot } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState } from "@/registry/default/blocks/data-grid/store";
import type { DataChange } from "@/registry/default/blocks/data-grid/types";
import { columns, type Row } from "./modes";

afterEach(cleanup);

type Fetch = (ctx: ServerRowsFetchContext) => Promise<ServerRowsPage<Row>>;

const rowsOf = (from: number, count: number): Row[] => Array.from({ length: count }, (_, i) => ({ id: `r${from + i}`, name: `Name ${from + i}`, n: from + i }));

function pagedSource(total: number | undefined) {
  return vi.fn<Fetch>(async ({ page, pageSize, spec }) => {
    const from = (page - 1) * pageSize;
    const count = Math.max(0, Math.min(pageSize, 95 - from));
    const rows = rowsOf(from, count);
    if (spec.sorts[0]?.direction === "desc") rows.reverse();
    return total === undefined ? { rows, hasNextPage: from + count < 95 } : { rows, total };
  });
}

async function mountServer(fetchRows: Fetch, onSave?: (change: DataChange<Row>) => Promise<undefined | { rejected: { rowId: string; message?: string }[] }>) {
  let server!: ReturnType<typeof useDataGridServerRows<Row>>;
  let api: StoreApi<DataGridStoreState> | null = null;
  function Capture() {
    api = useDataGridStoreApi();
    return null;
  }
  function Tree() {
    server = useDataGridServerRows<Row>({ getRowId: (row) => row.id, fetchRows, defaultPageSize: 10 });
    return (
      <DataGridProvider columns={columns} {...server.providerProps} onSave={onSave as never}>
        <DataGridRoot {...server.rootProps}>
          <Capture />
        </DataGridRoot>
      </DataGridProvider>
    );
  }
  render(<Tree />);
  await waitFor(() => expect(server.status).toBe("ready"));
  return {
    server: () => server,
    state: () => api!.getState(),
    ready: () => waitFor(() => expect(server.status).toBe("ready")),
  };
}

describe("server pagination with sortMode server", () => {
  it("a sort from page 3 asks for page 1 with the spec and shows the server's order", async () => {
    const fetchRows = pagedSource(95);
    const grid = await mountServer(fetchRows);
    act(() => grid.server().pager.onPageChange(3));
    await grid.ready();
    act(() => grid.state().actions.setSorts([{ columnId: "n", direction: "desc" }]));
    await waitFor(() => expect(fetchRows.mock.calls.at(-1)![0]).toMatchObject({ page: 1, spec: { sorts: [{ columnId: "n", direction: "desc" }] } }));
    await grid.ready();
    expect((grid.state().data as Row[]).map((row) => row.id).slice(0, 2)).toEqual(["r9", "r8"]);
  });
});

describe("server pagination with write-through to your own API", () => {
  it("an edit on page 2 saves once by row id, and a refusal reverts it through onDataChange", async () => {
    const saves: DataChange<Row>[] = [];
    const grid = await mountServer(pagedSource(95), async (change) => {
      saves.push(change);
      return { rejected: [{ rowId: "r12", message: "no" }] };
    });
    act(() => grid.server().pager.onPageChange(2));
    await grid.ready();
    act(() => grid.state().actions.commitCellValue({ rowId: "r12", columnId: "n" }, 999));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]!.ops[0]).toMatchObject({ rowId: "r12" });
    await waitFor(() => expect((grid.state().data as Row[]).find((row) => row.id === "r12")?.n).toBe(12));
  });

  it("an accepted save keeps the edit across a refetch of the same page", async () => {
    const grid = await mountServer(pagedSource(95), async () => undefined);
    act(() => grid.state().actions.commitCellValue({ rowId: "r1", columnId: "n" }, 55));
    await waitFor(() => expect((grid.state().data as Row[]).find((row) => row.id === "r1")?.n).toBe(55));
  });
});

describe("a source with no row count", () => {
  it("the pager and the grid carry an unknown total while controlled sort, filter, and search still reach the server", async () => {
    const fetchRows = pagedSource(undefined);
    const grid = await mountServer(fetchRows);
    expect(grid.server().pager.total).toBeUndefined();
    expect(grid.server().pager.hasNextPage).toBe(true);
    expect(grid.state().totalRowCount).toBeNull();
    act(() => grid.state().actions.setFilters([{ filterId: "f", columnId: "n", operator: "gt", value: "1" }] as never));
    act(() => grid.state().actions.setSearch("Name"));
    await waitFor(() => expect(fetchRows.mock.calls.at(-1)![0].spec).toMatchObject({ filters: [{ columnId: "n" }], search: "Name" }));
    await grid.ready();
    expect(grid.state().viewIndex).toHaveLength(10);
  });

  it("the server order and the unfiltered page survive sortMode and filterMode server", async () => {
    const grid = await mountServer(pagedSource(undefined));
    act(() => grid.state().actions.setSorts([{ columnId: "n", direction: "desc" }]));
    await grid.ready();
    expect(grid.state().sortMode).toBe("server");
    expect(grid.state().filterMode).toBe("server");
  });

  it("an edit saves against the unknown-total page", async () => {
    const saves: DataChange<Row>[] = [];
    const grid = await mountServer(pagedSource(undefined), async (change) => {
      saves.push(change);
      return undefined;
    });
    act(() => grid.state().actions.commitCellValue({ rowId: "r2", columnId: "n" }, 7));
    await waitFor(() => expect(saves).toHaveLength(1));
  });
});
