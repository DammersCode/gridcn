import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NuqsTestingAdapter, type UrlUpdateEvent } from "nuqs/adapters/testing";
import type { StoreApi } from "zustand/vanilla";
import { DataGridUrlState } from "@/registry/default/blocks/data-grid-url-state/data-grid-url-state";
import { useDataGridServerRows } from "@/registry/default/blocks/data-grid-server/data-grid-server";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState } from "@/registry/default/blocks/data-grid/store";
import { serializeFilterState } from "@/registry/default/blocks/data-grid-url-state/filter-param";
import type { ColumnDef } from "@/registry/default/blocks/data-grid/types";
import { columns, makeRows, type Row } from "./modes";

afterEach(cleanup);

let api: StoreApi<DataGridStoreState> | null = null;
function Capture() {
  api = useDataGridStoreApi();
  return null;
}
const state = () => api!.getState();
const viewIds = () => state().viewIndex.map((i) => (state().data[i] as Row | undefined)?.id ?? "");

function LazyGrid() {
  const server = useDataGridServerRows<Row>({
    mode: "scroll",
    getRowId: (r) => r.id,
    blockSize: 6,
    fetchRows: async ({ start, end }) => ({ rows: makeRows().slice(start, end), totalRowCount: 6 }),
  });
  return (
    <DataGridProvider columns={columns} {...server.providerProps}>
      <DataGridUrlState spec={["sort", "filter", "search"]} />
      <Capture />
    </DataGridProvider>
  );
}

describe("URL state in mode Z (lazy rows)", () => {
  it("a deep link seeds the sort and filter spec and no loaded row is reordered or hidden", async () => {
    render(
      <NuqsTestingAdapter searchParams="?sort=n%3Adesc&filter=n%3Agt%3A2">
        <LazyGrid />
      </NuqsTestingAdapter>,
    );
    await waitFor(() => expect(state().sortState).toEqual([{ columnId: "n", direction: "desc" }]));
    expect(state().filterState).toHaveLength(1);
    await waitFor(() => expect(state().data).toHaveLength(6));
    expect(state().viewIndex).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe("URL state join in mode Z (lazy rows)", () => {
  it("a deep-linked join=or reaches the server spec and the rows stay whole", async () => {
    render(
      <NuqsTestingAdapter searchParams="?filter=n%3Alt%3A1,n%3Agt%3A4&join=or">
        <LazyGrid />
      </NuqsTestingAdapter>,
    );
    await waitFor(() => expect(state().filterJoin).toBe("or"));
    expect(state().filterState).toHaveLength(2);
    await waitFor(() => expect(state().data).toHaveLength(6));
    expect(state().viewIndex).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe("URL state in mode SS (sortMode server)", () => {
  it("a deep-linked sort is tracked and the server's order stays", async () => {
    render(
      <NuqsTestingAdapter searchParams="?sort=n%3Adesc">
        <DataGridProvider columns={columns} defaultData={makeRows()} getRowId={(r: Row) => r.id} sortMode="server">
          <DataGridUrlState spec={["sort", "filter", "search"]} />
          <Capture />
        </DataGridProvider>
      </NuqsTestingAdapter>,
    );
    await waitFor(() => expect(state().sortState).toEqual([{ columnId: "n", direction: "desc" }]));
    expect(viewIds()).toEqual(["r0", "r1", "r2", "r3", "r4", "r5"]);
  });
});

describe("URL state in mode API (write-through with onDataChange)", () => {
  it("an edit reaches onDataChange without a URL write, a sort change does write", async () => {
    const onUrlUpdate = vi.fn();
    const onDataChange = vi.fn();
    render(
      <NuqsTestingAdapter onUrlUpdate={onUrlUpdate}>
        <DataGridProvider columns={columns} defaultData={makeRows()} getRowId={(r: Row) => r.id} onDataChange={onDataChange}>
          <DataGridUrlState spec={["sort", "filter", "search"]} />
          <Capture />
        </DataGridProvider>
      </NuqsTestingAdapter>,
    );
    onUrlUpdate.mockClear();
    act(() => state().actions.commitCellValue({ rowId: "r1", columnId: "n" }, 9));
    expect(onDataChange).toHaveBeenCalledTimes(1);
    await act(async () => {
      await Promise.resolve();
    });
    expect(onUrlUpdate).not.toHaveBeenCalled();
    await act(async () => state().actions.setSorts([{ columnId: "n", direction: "desc" }]));
    await waitFor(() => expect((onUrlUpdate.mock.calls.at(-1)?.[0] as UrlUpdateEvent | undefined)?.searchParams.get("sort")).toBe("n:desc"));
  });
});

describe("URL state in mode FS (server filter with fetchFilterValues)", () => {
  const choiceColumns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name", options: { choices: ["a", "b", "c"] } }, columns[1]!];
  const link = (operator: "isAnyOf" | "isNoneOf", count: number) =>
    `?filter=${encodeURIComponent(serializeFilterState([{ columnId: "name", operator, value: Array.from({ length: count }, (_, i) => `v${i}`) }]))}`;

  function mountFs(search: string) {
    render(
      <NuqsTestingAdapter searchParams={search}>
        <DataGridProvider columns={choiceColumns} defaultData={makeRows()} getRowId={(r: Row) => r.id} filterMode="server" fetchFilterValues={async () => ({ values: [] })}>
          <DataGridUrlState spec={["sort", "filter", "search"]} />
          <Capture />
        </DataGridProvider>
      </NuqsTestingAdapter>,
    );
  }
  const listLength = () => ((state().filterState[0] as { value?: unknown[] } | undefined)?.value ?? []).length;

  it("keeps a list of 200 values although the column has 3 static choices", async () => {
    mountFs(link("isAnyOf", 200));
    await waitFor(() => expect(listLength()).toBe(200));
  });

  it("cuts a list at 1,000 values", async () => {
    mountFs(link("isAnyOf", 1001));
    await waitFor(() => expect(listLength()).toBe(1000));
  });

  it("drops an isNoneOf list past 1,000 values", async () => {
    mountFs(link("isNoneOf", 1001));
    await waitFor(() => expect(state().filterState).toEqual([]));
  });
});

describe("URL state group param in mode Z (lazy rows) and SS (sortMode server)", () => {
  it("a deep-linked group is tracked and the loaded rows stay ungrouped", async () => {
    function Grid() {
      const server = useDataGridServerRows<Row>({
        mode: "scroll",
        getRowId: (r) => r.id,
        blockSize: 6,
        fetchRows: async ({ start, end }) => ({ rows: makeRows().slice(start, end), totalRowCount: 6 }),
      });
      return (
        <DataGridProvider columns={columns} defaultGroupBy={[]} {...server.providerProps}>
          <DataGridUrlState spec={["group"]} />
          <Capture />
        </DataGridProvider>
      );
    }
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(
      <NuqsTestingAdapter searchParams="?group=name">
        <Grid />
      </NuqsTestingAdapter>,
    );
    await waitFor(() => expect(state().groupBy).toEqual(["name"]));
    await waitFor(() => expect(state().data).toHaveLength(6));
    expect(state().viewIndex).toEqual([0, 1, 2, 3, 4, 5]);
    warn.mockRestore();
  });

  it("with a server sort the group still reaches the URL", async () => {
    const onUrlUpdate = vi.fn();
    render(
      <NuqsTestingAdapter onUrlUpdate={onUrlUpdate}>
        <DataGridProvider columns={columns} defaultData={makeRows()} getRowId={(r: Row) => r.id} sortMode="server" defaultGroupBy={[]}>
          <DataGridUrlState spec={["sort", "group"]} />
          <Capture />
        </DataGridProvider>
      </NuqsTestingAdapter>,
    );
    act(() => state().actions.setGroupBy(["name"]));
    await waitFor(() => expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get("group")).toBe("name"));
  });
});
