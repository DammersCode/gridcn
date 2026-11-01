import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import { useDataGridServerRows, type ServerRowsFetchContext, type ServerRowsPage } from "@/registry/default/blocks/data-grid-server/use-data-grid-server-rows";
import { DataGridRoot } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState } from "@/registry/default/blocks/data-grid/store";
import type { DataChange } from "@/registry/default/blocks/data-grid/types";
import { columns, type Row } from "./modes";

afterEach(() => {
  cleanup();
  saved.clear();
});

type Fetch = (ctx: ServerRowsFetchContext) => Promise<ServerRowsPage<Row>>;

const rowsOf = (from: number, count: number): Row[] => Array.from({ length: count }, (_, i) => ({ id: `r${from + i}`, name: `Name ${from + i}`, n: from + i }));

const saved = new Map<string, number>();

function pagedSource(total: number | undefined, honorSpec = true) {
  return vi.fn<Fetch>(async ({ page, pageSize, spec }) => {
    const from = (page - 1) * pageSize;
    const count = Math.max(0, Math.min(pageSize, 95 - from));
    const rows = rowsOf(from, count).map((row) => ({ ...row, n: saved.get(row.id) ?? row.n }));
    if (honorSpec && spec.sorts[0]?.direction === "desc") rows.reverse();
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

describe("server pagination in mode SS (sortMode server)", () => {
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

  it("the grid never reorders the page, even when the server ignores the sort", async () => {
    const grid = await mountServer(pagedSource(undefined, false));
    act(() => grid.state().actions.setSorts([{ columnId: "n", direction: "desc" }]));
    await grid.ready();
    expect(grid.state().sortState).toEqual([{ columnId: "n", direction: "desc" }]);
    expect(grid.state().viewIndex).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe("server pagination in mode FS (filterMode server)", () => {
  it("the grid never filters the page, even when the server ignores the filter", async () => {
    const fetchRows = pagedSource(undefined, false);
    const grid = await mountServer(fetchRows);
    act(() => grid.state().actions.setFilters([{ filterId: "f", columnId: "n", operator: "gt", value: "100" }] as never));
    await waitFor(() => expect(fetchRows.mock.calls.at(-1)![0].spec.filters).toHaveLength(1));
    await grid.ready();
    expect(grid.state().viewIndex).toHaveLength(10);
  });
});

describe("a source with no row count in mode C (controlled state)", () => {
  it("the pager and the grid carry an unknown total while the controlled sort, filter, and search reach the server", async () => {
    const fetchRows = pagedSource(undefined);
    const grid = await mountServer(fetchRows);
    expect(grid.server().pager.totalRowCount).toBeNull();
    expect(grid.server().pager.hasNextPage).toBe(true);
    expect(grid.state().totalRowCount).toBeNull();
    act(() => grid.state().actions.setFilters([{ filterId: "f", columnId: "n", operator: "gt", value: "1" }] as never));
    act(() => grid.state().actions.setSearch("Name"));
    await waitFor(() => expect(fetchRows.mock.calls.at(-1)![0].spec).toMatchObject({ filters: [{ columnId: "n" }], searchText: "Name" }));
    await grid.ready();
    expect(grid.state().viewIndex).toHaveLength(10);
  });

  it("the last page ends the pager", async () => {
    const grid = await mountServer(pagedSource(undefined));
    act(() => grid.server().pager.onPageChange(10));
    await grid.ready();
    expect(grid.server().pager.hasNextPage).toBe(false);
  });
});

describe("server pagination in mode API (onSave write-through)", () => {
  it("an edit on page 2 saves once by row id, and a refusal reverts it through onDataChange", async () => {
    const saves: DataChange<Row>[] = [];
    const grid = await mountServer(pagedSource(95), async (change) => {
      saves.push(change);
      return { rejected: [{ rowId: "r12", message: "no" }] };
    });
    act(() => grid.server().pager.onPageChange(2));
    await grid.ready();
    await waitFor(() => expect((grid.state().data as Row[]).some((row) => row.id === "r12")).toBe(true), { timeout: 5000 });
    act(() => grid.state().actions.commitCellValue({ rowId: "r12", columnId: "n" }, 999));
    await waitFor(() => expect(saves).toHaveLength(1), { timeout: 5000 });
    expect(saves[0]!.ops[0]).toMatchObject({ rowId: "r12" });
    await waitFor(() => expect((grid.state().data as Row[]).find((row) => row.id === "r12")?.n).toBe(12), { timeout: 5000 });
  });

  it("an accepted save survives a refetch of the same page, with and without a row count", async () => {
    for (const total of [95, undefined]) {
      saved.clear();
      cleanup();
      const grid = await mountServer(pagedSource(total), async (change) => {
        for (const op of change.ops) if (op.type === "update") saved.set(op.rowId, (op.row as Row).n);
        return undefined;
      });
      act(() => grid.state().actions.commitCellValue({ rowId: "r1", columnId: "n" }, 55));
      await waitFor(() => expect(saved.get("r1")).toBe(55));
      act(() => grid.server().refresh());
      await grid.ready();
      await waitFor(() => expect((grid.state().data as Row[]).find((row) => row.id === "r1")?.n).toBe(55));
    }
  });
});
