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

type Answer = "onDataChange" | "onActiveCellChange";

/** Mounts a grid whose `onDataChange` (or `onActiveCellChange`) answers the first change with one `updateCells` write. */
function mount(mode: Mode, answerFrom: Answer = "onDataChange") {
  let api: StoreApi<DataGridStoreState> | null = null;
  let consumerData: readonly Row[] = initialRows;
  let answered = false;
  let armed = answerFrom === "onDataChange";
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  const write = () => {
    answered = true;
    api!.getState().actions.updateCells([{ rowId: "b", columnId: "note", value: "answered" }]);
  };
  const answer = (change: DataChange<Row>) => {
    if (answerFrom !== "onDataChange" || answered || change.source === "stream") return;
    write();
  };
  const onActiveCellChange = () => {
    if (answerFrom === "onActiveCellChange" && armed && !answered) write();
  };
  const rowOps = {
    createRow: () => ({ id: "new", name: "New", note: "" }),
    duplicateRow: (row: Row) => ({ ...row, id: `${row.id}2` }),
  };
  function Controlled() {
    const [data, setData] = useState(initialRows);
    consumerData = data;
    return (
      <DataGridProvider
        data={data}
        columns={columns}
        getRowId={getRowId}
        {...rowOps}
        onActiveCellChange={onActiveCellChange}
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
        {...rowOps}
        onActiveCellChange={onActiveCellChange}
        onDataChange={(_next, change) => answer(change)}
      >
        <Probe />
      </DataGridProvider>
    );
  }
  render(mode === "controlled" ? <Controlled /> : <Uncontrolled />);
  return {
    store: () => api!,
    consumerData: () => consumerData,
    arm: () => {
      armed = true;
    },
  };
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

type Site = { site: string; run: (store: StoreApi<DataGridStoreState>) => void; check: (data: readonly unknown[]) => void };

const sortByName = (store: StoreApi<DataGridStoreState>) => store.getState().actions.setSorts([{ columnId: "name", direction: "asc" }]);
const ids = (data: readonly unknown[]) => (data as readonly Row[]).map((row) => row.id);

const sites: Site[] = [
  {
    site: "deleteSelection",
    run: (store) => {
      store.getState().actions.selectCellAt({ row: 0, col: 0 });
      store.getState().actions.deleteSelection();
    },
    check: (data) => expect(byId(data, "a").name).toBe(""),
  },
  {
    site: "commitCellEdit",
    run: (store) => {
      store.getState().actions.startEditingAt({ row: 0, col: 0 });
      store.getState().actions.commitCellEdit("Changed");
    },
    check: (data) => expect(byId(data, "a").name).toBe("Changed"),
  },
  {
    site: "commitCellValueAt",
    run: (store) => store.getState().actions.commitCellValueAt({ row: 0, col: 0 }, "Changed"),
    check: (data) => expect(byId(data, "a").name).toBe("Changed"),
  },
  {
    site: "applyCellUpdates",
    run: (store) => store.getState().actions.applyCellUpdates([{ viewRowIndex: 0, columnId: "name", value: "Changed" }], "paste"),
    check: (data) => expect(byId(data, "a").name).toBe("Changed"),
  },
  {
    site: "updateCells (deferred)",
    run: (store) => store.getState().actions.updateCells([{ rowId: "a", columnId: "name", value: "Changed" }], { source: "app" }),
    check: (data) => expect(byId(data, "a").name).toBe("Changed"),
  },
  {
    site: "updateCells (immediate)",
    run: (store) => {
      sortByName(store);
      store.getState().actions.updateCells([{ rowId: "a", columnId: "name", value: "Zulu" }], { source: "app", reorder: "immediate" });
    },
    check: (data) => expect(byId(data, "a").name).toBe("Zulu"),
  },
  {
    site: "insertRows",
    run: (store) => store.getState().actions.insertRows(0, 1, "below"),
    check: (data) => expect(ids(data)).toEqual(["a", "new", "b"]),
  },
  {
    site: "insertRows (sorted)",
    run: (store) => {
      sortByName(store);
      store.getState().actions.insertRows(0, 1, "below");
    },
    check: (data) => expect(ids(data)).toEqual(["a", "new", "b"]),
  },
  {
    site: "deleteRows",
    run: (store) => store.getState().actions.deleteRows([0]),
    check: (data) => expect(ids(data)).toEqual(["b"]),
  },
  {
    site: "duplicateRows",
    run: (store) => store.getState().actions.duplicateRows([0]),
    check: (data) => expect(ids(data)).toEqual(["a", "a2", "b"]),
  },
  {
    site: "duplicateRows (sorted)",
    run: (store) => {
      sortByName(store);
      store.getState().actions.duplicateRows([0]);
    },
    check: (data) => expect(ids(data)).toEqual(["a", "a2", "b"]),
  },
  {
    site: "reorderRows",
    run: (store) => store.getState().actions.reorderRows(0, 1),
    check: (data) => expect(ids(data)).toEqual(["b", "a"]),
  },
];

describe.each<Mode>(["controlled", "uncontrolled"])("a write inside onDataChange at every emit site (%s)", (mode) => {
  it.each(sites)("$site keeps both writes", ({ run, check }) => {
    const { store, consumerData } = mount(mode);

    act(() => run(store()));

    const data = store().getState().data;
    check(data);
    expect(byId(data, "b").note).toBe("answered");
    if (mode === "controlled") expect(consumerData()).toBe(data);
  });
});

describe("a write from a store subscriber during a commit", () => {
  it.each<Mode>(["controlled", "uncontrolled"])("keeps both the commit and an onActiveCellChange write (%s)", (mode) => {
    const { store, consumerData, arm } = mount(mode, "onActiveCellChange");
    act(() => store().getState().actions.startEditingAt({ row: 0, col: 0 }));
    arm();

    act(() => store().getState().actions.commitCellEdit("Changed", { dx: 0, dy: 1 }));

    const data = store().getState().data;
    expect(byId(data, "a").name).toBe("Changed");
    expect(byId(data, "b").note).toBe("answered");
    if (mode === "controlled") expect(consumerData()).toBe(data);
  });
});

describe.each<Mode>(["controlled", "uncontrolled"])("a write from a store subscriber at every emit site (%s)", (mode) => {
  it.each(sites)("$site emits in gesture order and keeps both writes", ({ run, check }) => {
    let api: StoreApi<DataGridStoreState> | null = null;
    let consumerData: readonly Row[] = initialRows;
    const emits: DataChange<Row>[] = [];
    let answered = false;
    function Probe() {
      api = useDataGridStoreApi();
      return null;
    }
    const onDataChange = (change: DataChange<Row>) => emits.push(change);
    const rowOps = {
      createRow: () => ({ id: "new", name: "New", note: "" }),
      duplicateRow: (row: Row) => ({ ...row, id: `${row.id}2` }),
    };
    function Controlled() {
      const [data, setData] = useState(initialRows);
      consumerData = data;
      return (
        <DataGridProvider
          data={data}
          columns={columns}
          getRowId={getRowId}
          {...rowOps}
          onDataChange={(next, change) => {
            setData(next);
            onDataChange(change);
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
          {...rowOps}
          onDataChange={(_next, change) => onDataChange(change)}
        >
          <Probe />
        </DataGridProvider>
      );
    }
    render(mode === "controlled" ? <Controlled /> : <Uncontrolled />);
    api!.subscribe((state, prev) => {
      if (answered || state.data === prev.data) return;
      answered = true;
      state.actions.updateCells([{ rowId: "b", columnId: "note", value: "answered" }], { source: "stream" });
    });

    act(() => run(api!));

    const data = api!.getState().data;
    check(data);
    expect(byId(data, "b").note).toBe("answered");
    expect(emits.map((change) => change.source)).toEqual([expect.not.stringMatching(/^stream$/), "stream"]);
    if (mode === "controlled") expect(consumerData).toBe(data);
  });
});
