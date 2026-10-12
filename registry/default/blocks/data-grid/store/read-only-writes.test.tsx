import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef, DataChange } from "../types";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState, type DataGridSyncProps } from ".";
import { toInternalSyncProps } from "./types";

type Row = { id: string; name: string };

const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];

function mount(props: Partial<DataGridSyncProps<Row>>) {
  let api: StoreApi<DataGridStoreState> | null = null;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  render(
    <DataGridProvider
      defaultData={[
        { id: "a", name: "Alpha" },
        { id: "b", name: "Bravo" },
      ]}
      columns={columns}
      getRowId={(row) => row.id}
      {...props}
    >
      <Probe />
    </DataGridProvider>,
  );
  return api!;
}

describe("store writes in a read-only grid", () => {
  it("cancels the open edit session when the config sync flips readOnly, so a later commit writes nothing", () => {
    const onDataChange = vi.fn<(next: readonly Row[], change: DataChange<Row>) => void>();
    const onEditEnd = vi.fn();
    const store = mount({ onDataChange, onEditEnd });
    act(() => store.getState().actions.startEditingAt({ row: 0, col: 0 }));
    expect(store.getState().editing).not.toBeNull();

    act(() =>
      store.getState().actions._syncConfig(
        toInternalSyncProps({
          defaultData: [
            { id: "a", name: "Alpha" },
            { id: "b", name: "Bravo" },
          ],
          columns,
          getRowId: (row) => row.id,
          onDataChange,
          onEditEnd,
          readOnly: true,
        }),
      ),
    );

    expect(store.getState().editing).toBeNull();
    expect(onEditEnd).toHaveBeenCalledTimes(1);
    expect(onEditEnd).toHaveBeenCalledWith(expect.objectContaining({ rowId: "a", columnId: "name", result: "cancel" }));
    act(() => store.getState().actions.commitCellEdit("Changed"));
    expect(onDataChange).not.toHaveBeenCalled();
    expect((store.getState().data[0] as Row).name).toBe("Alpha");
  });

  it("commitCellEdit writes nothing when the session outlives the readOnly flip", () => {
    const onDataChange = vi.fn();
    const store = mount({ onDataChange });
    act(() => store.getState().actions.startEditingAt({ row: 0, col: 0 }));

    act(() => store.setState({ readOnly: true }));
    act(() => store.getState().actions.commitCellEdit("Changed"));

    expect(onDataChange).not.toHaveBeenCalled();
    expect((store.getState().data[0] as Row).name).toBe("Alpha");
  });

  it("commitCellValue and commitCellValueAt write nothing", () => {
    const onDataChange = vi.fn();
    const store = mount({ onDataChange });
    act(() => store.setState({ readOnly: true }));

    act(() => store.getState().actions.commitCellValue({ rowId: "b", columnId: "name" }, "Changed"));
    act(() => store.getState().actions.commitCellValueAt({ row: 0, col: 0 }, "Changed"));

    expect(onDataChange).not.toHaveBeenCalled();
    expect(store.getState().data.map((row) => (row as Row).name)).toEqual(["Alpha", "Bravo"]);
  });

  it("commitCellValue writes once readOnly turns false again", () => {
    const onDataChange = vi.fn();
    const store = mount({ onDataChange });
    act(() => store.setState({ readOnly: true }));
    act(() => store.setState({ readOnly: false }));

    act(() => store.getState().actions.commitCellValue({ rowId: "b", columnId: "name" }, "Changed"));

    expect(onDataChange).toHaveBeenCalledTimes(1);
  });
});

describe("the readOnly flip", () => {
  it("is visible to onEditEnd when the config sync flip cancels the open edit", () => {
    let readOnlyAtEditEnd: boolean | null = null;
    let api: StoreApi<DataGridStoreState> | null = null;
    const onEditEnd = () => {
      readOnlyAtEditEnd = api!.getState().readOnly;
    };
    const store = mount({ onEditEnd });
    api = store;
    act(() => store.getState().actions.startEditingAt({ row: 0, col: 0 }));

    act(() =>
      store.getState().actions._syncConfig(
        toInternalSyncProps({
          defaultData: [
            { id: "a", name: "Alpha" },
            { id: "b", name: "Bravo" },
          ],
          columns,
          getRowId: (row) => row.id,
          onEditEnd,
          readOnly: true,
        }),
      ),
    );

    expect(readOnlyAtEditEnd).toBe(true);
  });
});
