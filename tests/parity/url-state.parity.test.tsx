import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NuqsTestingAdapter, type UrlUpdateEvent } from "nuqs/adapters/testing";
import type { StoreApi } from "zustand/vanilla";
import { DataGridUrlState } from "@/registry/default/blocks/data-grid-url-state/data-grid-url-state";
import { useDataGridLazyRows } from "@/registry/default/blocks/data-grid-lazy/use-data-grid-lazy-rows";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState } from "@/registry/default/blocks/data-grid/store";
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
  const lazy = useDataGridLazyRows<Row>({ total: 6, getRowId: (r) => r.id, pageSize: 6, fetchRows: async ({ start, end }) => makeRows().slice(start, end) });
  return (
    <DataGridProvider columns={columns} {...lazy.gridProps} onDataChange={lazy.onDataChange} sortMode="server" filterMode="server">
      <DataGridUrlState />
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
    expect(state().data).toHaveLength(6);
    expect(state().viewIndex).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe("URL state in mode SS (sortMode server)", () => {
  it("a deep-linked sort is tracked and the server's order stays", async () => {
    render(
      <NuqsTestingAdapter searchParams="?sort=n%3Adesc">
        <DataGridProvider columns={columns} defaultData={makeRows()} getRowId={(r: Row) => r.id} sortMode="server">
          <DataGridUrlState />
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
          <DataGridUrlState />
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
