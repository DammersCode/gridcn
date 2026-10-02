import { act, render } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef, DataChange } from "../types";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState } from ".";

type Row = { id: string; name: string; note: string };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "note", header: "Note", accessorKey: "note" },
];

const initialRows: readonly Row[] = [
  { id: "a", name: "Alpha", note: "" },
  { id: "b", name: "Bravo", note: "" },
];

const getRowId = (row: Row) => row.id;

type Mode = "controlled" | "uncontrolled";

/** Mounts a grid whose `onDataChange` answers the first change with one `updateCells` write. */
function mount(mode: Mode) {
  let api: StoreApi<DataGridStoreState> | null = null;
  let consumerData: readonly Row[] = initialRows;
  let answered = false;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  const answer = (change: DataChange<Row>) => {
    if (answered || change.source === "stream") return;
    answered = true;
    api!.getState().actions.updateCells([{ rowId: "b", columnId: "note", value: "answered" }]);
  };
  function Controlled() {
    const [data, setData] = useState(initialRows);
    consumerData = data;
    return (
      <DataGridProvider
        data={data}
        columns={columns}
        getRowId={getRowId}
        createRow={() => ({ id: "new", name: "New", note: "" })}
        onDataChange={(next, change) => {
          setData(next);
          answer(change);
        }}
      >
        <Probe />
      </DataGridProvider>
    );
  }
  function Uncontrolled() {
    return (
      <DataGridProvider
        defaultData={initialRows}
        columns={columns}
        getRowId={getRowId}
        createRow={() => ({ id: "new", name: "New", note: "" })}
        onDataChange={(_next, change) => answer(change)}
      >
        <Probe />
      </DataGridProvider>
    );
  }
  render(mode === "controlled" ? <Controlled /> : <Uncontrolled />);
  return { store: () => api!, consumerData: () => consumerData };
}

function byId(data: readonly unknown[], id: string): Row {
  return (data as readonly Row[]).find((row) => row.id === id)!;
}

describe.each<Mode>(["controlled", "uncontrolled"])("a write inside onDataChange (%s)", (mode) => {
  it("keeps both the edit commit and the handler's write", () => {
    const { store, consumerData } = mount(mode);
    act(() => store().getState().actions.startEditingAt({ row: 0, col: 0 }));

    act(() => store().getState().actions.commitCellEdit("Changed"));

    const data = store().getState().data;
    expect(byId(data, "a").name).toBe("Changed");
    expect(byId(data, "b").note).toBe("answered");
    if (mode === "controlled") expect(consumerData()).toBe(data);
  });

  it("keeps both commitCellValue and the handler's write", () => {
    const { store } = mount(mode);

    act(() => store().getState().actions.commitCellValue({ rowId: "a", columnId: "name" }, "Changed"));

    const data = store().getState().data;
    expect(byId(data, "a").name).toBe("Changed");
    expect(byId(data, "b").note).toBe("answered");
  });

  it("keeps both an inserted row and the handler's write", () => {
    const { store } = mount(mode);

    act(() => store().getState().actions.insertRows(0, 1, "below"));

    const data = store().getState().data;
    expect(data.map((row) => (row as Row).id)).toEqual(["a", "new", "b"]);
    expect(byId(data, "b").note).toBe("answered");
  });
});

describe("echo detection after a foreign sync", () => {
  it("applies an emitted array that the consumer adopts after syncing a refetched one", () => {
    let api: StoreApi<DataGridStoreState> | null = null;
    let emitted: readonly Row[] | null = null;
    function Probe() {
      api = useDataGridStoreApi();
      return null;
    }
    const grid = (data: readonly Row[]) => (
      <DataGridProvider
        data={data}
        columns={columns}
        getRowId={getRowId}
        createRow={() => ({ id: "new", name: "New", note: "" })}
        onDataChange={(next) => {
          emitted = next;
        }}
      >
        <Probe />
      </DataGridProvider>
    );
    const view = render(grid(initialRows));
    act(() => api!.getState().actions.insertRows(1, 1, "below"));
    const refetched: readonly Row[] = [{ id: "b", name: "Bravo (refetched)", note: "" }];

    view.rerender(grid(refetched));
    const versionAfterRefetch = api!.getState().rowIdentityVersion;
    view.rerender(grid(emitted!));

    const s = api!.getState();
    expect(s.viewIndex.map((dataRow) => getRowId(s.data[dataRow] as Row))).toEqual(["a", "b", "new"]);
    expect(s.rowIdentityVersion).toBeGreaterThan(versionAfterRefetch);
    act(() => api!.getState().actions.updateCells([{ rowId: "new", columnId: "note", value: "found" }]));
    expect(byId(api!.getState().data, "new").note).toBe("found");
  });
});
