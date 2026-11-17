import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef } from "../types";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState, type DataGridSyncProps } from ".";
import { dispatchGridAction } from "../interaction/use-grid-interaction";

type Row = { id: string };

const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "id", header: "Id", accessorKey: "id" }];

function mount(props: Partial<DataGridSyncProps<Row>>) {
  let api: StoreApi<DataGridStoreState> | null = null;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  render(
    <DataGridProvider columns={columns} getRowId={(row: Row) => row.id} defaultData={[{ id: "a" }, { id: "b" }]} {...props}>
      <Probe />
    </DataGridProvider>,
  );
  return api! as StoreApi<DataGridStoreState>;
}

const pressDeleteRows = (store: StoreApi<DataGridStoreState>) =>
  act(() =>
    dispatchGridAction({ action: "deleteRows", actions: store.getState().actions, storeApi: store, scrollRef: { current: null }, scrollCellIntoView: () => {}, rowHeight: 36, preventDefault: () => {} }),
  );

describe("enableRowDelete", () => {
  it("defaults to true and the key deletes", () => {
    const store = mount({});
    act(() => store.getState().actions.selectCellAt({ col: 0, row: 0 }));
    pressDeleteRows(store);
    expect(store.getState().enableRowDelete).toBe(true);
    expect(store.getState().data).toHaveLength(1);
  });

  it("false skips the key with reason disabled and keeps actions.deleteRows working", () => {
    const onRowActionSkipped = vi.fn();
    const store = mount({ enableRowDelete: false, onRowActionSkipped });
    act(() => store.getState().actions.selectCellAt({ col: 0, row: 0 }));
    pressDeleteRows(store);
    expect(store.getState().data).toHaveLength(2);
    expect(onRowActionSkipped).toHaveBeenCalledWith({ action: "deleteRows", reason: "disabled" });
    act(() => store.getState().actions.deleteRows(["a"]));
    expect(store.getState().data).toHaveLength(1);
  });
});

describe("openCellMenu", () => {
  it("dispatches contextmenu on the active cell element", () => {
    const store = mount({});
    act(() => store.getState().actions.selectCellAt({ col: 0, row: 0 }));
    const scroll = document.createElement("div");
    const cell = document.createElement("div");
    cell.setAttribute("data-active", "true");
    scroll.append(cell);
    const seen = vi.fn();
    cell.addEventListener("contextmenu", seen);
    act(() =>
      dispatchGridAction({ action: "openCellMenu", actions: store.getState().actions, storeApi: store, scrollRef: { current: scroll }, scrollCellIntoView: () => {}, rowHeight: 36, preventDefault: () => {} }),
    );
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
