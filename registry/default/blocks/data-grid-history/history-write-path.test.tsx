import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import {
  DataGridProvider,
  DataGridRoot,
  type ColumnDef,
  type DataChange,
  type DataGridSyncProps,
} from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridStoreApi, type DataGridStoreState } from "@/registry/default/blocks/data-grid/store";
import { useDataGridHistory, type UseDataGridHistoryOptions, type UseDataGridHistoryResult } from "./use-data-grid-history";

type Row = { id: string; name: string; age: number };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "age", header: "Age", accessorKey: "age", type: "number" },
];

const initialRows: Row[] = [
  { id: "a", name: "Alice", age: 30 },
  { id: "b", name: "Bob", age: 25 },
  { id: "c", name: "Cara", age: 40 },
];

const holeTolerantRowId = (row: Row | undefined, index: number) => (row ? row.id : `hole-${index}`);

function editChange(rowId: string, next: Row, prev: Row): DataChange<Row> {
  return {
    source: "edit",
    ops: [{ type: "update", rowId, row: next, prev, cells: [{ columnId: "name", value: next.name, prev: prev.name }] }],
  };
}

function setup(historyOpts: UseDataGridHistoryOptions<Row> = {}, gridOpts: Partial<DataGridSyncProps<Row>> = {}) {
  let data: readonly Row[] = initialRows;
  let history: UseDataGridHistoryResult<Row> | null = null;
  let store: StoreApi<DataGridStoreState> | null = null;

  function Capture() {
    store = useDataGridStoreApi();
    return null;
  }

  function Harness() {
    const h = useDataGridHistory<Row>(historyOpts);
    history = h;
    return (
      <DataGridProvider
        data={data}
        columns={columns}
        getRowId={(gridOpts.getRowId ?? ((row: Row) => row.id)) as never}
        plugins={[h.plugin]}
        onDataChange={(next) => {
          data = next;
        }}
        onSave={gridOpts.onSave as never}
        totalRowCount={gridOpts.totalRowCount}
      >
        <DataGridRoot>
          <Capture />
        </DataGridRoot>
      </DataGridProvider>
    );
  }

  const view = render(<Harness />);
  return {
    history: () => history!,
    data: () => data,
    announcement: () => store!.getState().liveAnnouncement,
    commit: (change: DataChange<Row>) => act(() => store!.getState().actions.commitChange(change)),
    swapData: (next: readonly Row[]) => {
      data = next;
      act(() => view.rerender(<Harness />));
    },
    unmount: () => view.unmount(),
  };
}

function sparseWithout(holeAt: number): Row[] {
  const arr = new Array<Row | undefined>(initialRows.length);
  initialRows.forEach((row, i) => {
    if (i !== holeAt) arr[i] = row;
  });
  return arr as Row[];
}

afterEach(cleanup);

describe("undo over rows that are not loaded", () => {
  it("keeps the entry, reports rows-not-loaded and announces a partial block", () => {
    const onSkip = vi.fn();
    const h = setup({ onSkip }, { getRowId: holeTolerantRowId as never });
    const prev = initialRows[1]!;
    h.commit(editChange("b", { ...prev, name: "Bobby" }, prev));
    h.swapData(sparseWithout(1));

    act(() => h.history().undo());

    expect(onSkip).toHaveBeenCalledWith({ direction: "undo", reason: "rows-not-loaded", rowIds: ["b"] });
    expect(h.history().canUndo).toBe(true);
    expect(h.history().canRedo).toBe(false);
    expect(h.announcement()).toMatchObject({ kind: "historyBlocked", count: 1, partial: true });
  });

  it("applies the kept entry once the rows are loaded", () => {
    const h = setup({}, { getRowId: holeTolerantRowId as never });
    const prev = initialRows[1]!;
    const edited = { ...prev, name: "Bobby" };
    h.commit(editChange("b", edited, prev));
    h.swapData(sparseWithout(1));
    act(() => h.history().undo());

    h.swapData([initialRows[0]!, edited, initialRows[2]!]);
    act(() => h.history().undo());

    expect(h.data()[1]!.name).toBe("Bob");
    expect(h.history().canRedo).toBe(true);
  });

  it("keeps a redo entry whose row is not loaded", () => {
    const onSkip = vi.fn();
    const h = setup({ onSkip }, { getRowId: holeTolerantRowId as never });
    const prev = initialRows[1]!;
    h.commit(editChange("b", { ...prev, name: "Bobby" }, prev));
    act(() => h.history().undo());
    h.swapData(sparseWithout(1));

    act(() => h.history().redo());

    expect(onSkip).toHaveBeenCalledWith({ direction: "redo", reason: "rows-not-loaded", rowIds: ["b"] });
    expect(h.history().canRedo).toBe(true);
  });

  it("applies an entry whose rows are loaded even when other rows are holes", () => {
    const onSkip = vi.fn();
    const h = setup({ onSkip }, { getRowId: holeTolerantRowId as never });
    const prev = initialRows[2]!;
    h.commit(editChange("c", { ...prev, name: "Changed" }, prev));
    const sparse = sparseWithout(1);
    sparse[2] = { ...prev, name: "Changed" };
    h.swapData(sparse);

    act(() => h.history().undo());

    expect(onSkip).not.toHaveBeenCalled();
    expect(h.data()[2]!.name).toBe("Cara");
  });

  it("isolates a throwing onSkip", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const h = setup({ onSkip: () => { throw new Error("boom"); } }, { getRowId: holeTolerantRowId as never });
    const prev = initialRows[1]!;
    h.commit(editChange("b", { ...prev, name: "Bobby" }, prev));
    h.swapData(sparseWithout(1));

    expect(() => act(() => h.history().undo())).not.toThrow();
    expect(h.announcement()).toMatchObject({ kind: "historyBlocked" });
    error.mockRestore();
  });
});

describe("undo and redo over a server page", () => {
  it("keeps the entry of a row on another page as rows-not-loaded, then undoes it on its page", () => {
    const onSkip = vi.fn();
    const h = setup({ onSkip }, { totalRowCount: 10 });
    const prev = initialRows[1]!;
    h.commit(editChange("b", { ...prev, name: "Bobby" }, prev));
    const page1 = h.data();
    h.swapData([{ id: "x", name: "Xena", age: 1 }]);

    act(() => h.history().undo());
    expect(onSkip).toHaveBeenCalledWith({ direction: "undo", reason: "rows-not-loaded", rowIds: ["b"] });
    expect(h.history().canUndo).toBe(true);

    h.swapData(page1);
    act(() => h.history().undo());
    expect(h.data()[1]!.name).toBe("Bob");
  });
});

describe("undo and redo over a cursor source", () => {
  it("keeps the entry as rows-not-loaded when totalRowCount is null", () => {
    const onSkip = vi.fn();
    const h = setup({ onSkip }, { totalRowCount: null });
    const prev = initialRows[1]!;
    h.commit(editChange("b", { ...prev, name: "Bobby" }, prev));
    h.swapData([{ id: "x", name: "Xena", age: 1 }]);

    act(() => h.history().undo());

    expect(onSkip).toHaveBeenCalledWith({ direction: "undo", reason: "rows-not-loaded", rowIds: ["b"] });
    expect(h.history().canUndo).toBe(true);
  });
});

describe("undo and redo over rows that are gone", () => {
  it("drops the undo entry, reports rows-gone and announces a full block", () => {
    const onSkip = vi.fn();
    const h = setup({ onSkip });
    const prev = initialRows[1]!;
    h.commit(editChange("b", { ...prev, name: "Bobby" }, prev));
    h.swapData([initialRows[0]!, initialRows[2]!]);

    act(() => h.history().undo());

    expect(onSkip).toHaveBeenCalledWith({ direction: "undo", reason: "rows-gone", rowIds: ["b"] });
    expect(h.history().canUndo).toBe(false);
    expect(h.history().canRedo).toBe(false);
    const announcement = h.announcement();
    expect(announcement).toMatchObject({ kind: "historyBlocked", count: 1 });
    expect(announcement).not.toHaveProperty("partial");
  });

  it("drops the redo entry the same way", () => {
    const onSkip = vi.fn();
    const h = setup({ onSkip });
    const prev = initialRows[1]!;
    h.commit(editChange("b", { ...prev, name: "Bobby" }, prev));
    act(() => h.history().undo());
    h.swapData([initialRows[0]!, initialRows[2]!]);

    act(() => h.history().redo());

    expect(onSkip).toHaveBeenCalledWith({ direction: "redo", reason: "rows-gone", rowIds: ["b"] });
    expect(h.history().canRedo).toBe(false);
    expect(h.history().canUndo).toBe(false);
  });

  it("does not need the row to undo an insert that a swap removed", () => {
    const onSkip = vi.fn();
    const h = setup({ onSkip });
    h.commit({ source: "delete", ops: [{ type: "delete", rowId: "b", row: initialRows[1]!, index: 1 }] });
    expect(h.data().map((r) => r.id)).toEqual(["a", "c"]);

    act(() => h.history().undo());

    expect(onSkip).not.toHaveBeenCalled();
    expect(h.data().map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});

describe("a refused undo or redo", () => {
  const refuseHistory = (change: DataChange<Row>) =>
    change.source === "history" ? Promise.resolve({ rejected: [{ rowId: change.ops[0]!.rowId }] }) : Promise.resolve();

  it("puts a refused undo back on the undo stack", async () => {
    const h = setup({}, { onSave: refuseHistory as never });
    const prev = initialRows[0]!;
    h.commit(editChange("a", { ...prev, name: "Alicia" }, prev));
    await act(async () => {});

    act(() => h.history().undo());
    expect(h.history().canRedo).toBe(true);
    await act(async () => {});

    expect(h.data()[0]!.name).toBe("Alicia");
    expect(h.history().canUndo).toBe(true);
    expect(h.history().canRedo).toBe(false);
  });

  it("undoes again after a refused undo is restored", async () => {
    let refuse = true;
    const onSave = (change: DataChange<Row>) =>
      refuse && change.source === "history" ? Promise.resolve({ rejected: [{ rowId: "a" }] }) : Promise.resolve();
    const h = setup({}, { onSave: onSave as never });
    const prev = initialRows[0]!;
    h.commit(editChange("a", { ...prev, name: "Alicia" }, prev));
    act(() => h.history().undo());
    await act(async () => {});
    refuse = false;

    act(() => h.history().undo());
    await act(async () => {});

    expect(h.data()[0]!.name).toBe("Alice");
    expect(h.history().canUndo).toBe(false);
    expect(h.history().canRedo).toBe(true);
  });
});

describe("a refused redo", () => {
  it("puts the entry back on the redo stack", async () => {
    let refuse = false;
    const onSave = (change: DataChange<Row>) =>
      refuse && change.source === "history" ? Promise.resolve({ rejected: [{ rowId: "a" }] }) : Promise.resolve();
    const h = setup({}, { onSave: onSave as never });
    const prev = initialRows[0]!;
    h.commit(editChange("a", { ...prev, name: "Alicia" }, prev));
    act(() => h.history().undo());
    await act(async () => {});
    refuse = true;

    act(() => h.history().redo());
    expect(h.history().canUndo).toBe(true);
    await act(async () => {});

    expect(h.data()[0]!.name).toBe("Alice");
    expect(h.history().canUndo).toBe(false);
    expect(h.history().canRedo).toBe(true);
  });
});

describe("changes from the server", () => {
  it("rewrites entries when a row swaps its id, so an older edit still undoes", () => {
    const h = setup();
    const prev = initialRows[0]!;
    const edited = { ...prev, name: "Alicia" };
    h.commit(editChange("a", edited, prev));
    const server: Row = { id: "a2", name: "Alicia", age: 31 };
    h.commit({ source: "id-swap", ops: [{ type: "update", rowId: "a", row: server, prev: edited }] });
    expect(h.history().historySize).toBe(1);

    act(() => h.history().undo());

    expect(h.data()[0]).toEqual({ id: "a2", name: "Alice", age: 31 });
  });

  it("rewrites the entries of every row of a batch swap", () => {
    const onSkip = vi.fn();
    const h = setup({ onSkip });
    const [a, b] = [initialRows[0]!, initialRows[1]!];
    h.commit(editChange("a", { ...a, name: "A2" }, a));
    h.commit(editChange("b", { ...b, name: "B2" }, b));
    const serverA: Row = { id: "a2", name: "A2", age: 30 };
    const serverB: Row = { id: "b2", name: "B2", age: 25 };
    h.commit({
      source: "id-swap",
      ops: [
        { type: "update", rowId: "a", row: serverA, prev: { ...a, name: "A2" } },
        { type: "update", rowId: "b", row: serverB, prev: { ...b, name: "B2" } },
      ],
    });
    act(() => h.history().undo());
    act(() => h.history().undo());
    expect(onSkip).not.toHaveBeenCalled();
    expect(h.data().map((row) => row.name)).toEqual(["Alice", "Bob", "Cara"]);
  });

  it("does not record an id-swap change, even when recordSources lists it", () => {
    const h = setup({ recordSources: ["id-swap", "edit"] });
    const prev = initialRows[0]!;
    h.commit({ source: "id-swap", ops: [{ type: "update", rowId: "a", row: { id: "a2", name: "Alice", age: 30 }, prev }] });
    expect(h.history().historySize).toBe(0);
  });

  it("discards the entry a merge change reverts and records nothing for the merge", () => {
    const h = setup();
    const prev = initialRows[0]!;
    const first = editChange("a", { ...prev, name: "Alicia" }, prev);
    h.commit(first);
    h.commit({
      source: "merge",
      ops: [{ type: "update", rowId: "a", row: { ...prev, name: "Merged" }, prev: { ...prev, name: "Alicia" } }],
      reverts: first,
    });
    expect(h.history().historySize).toBe(0);
  });

  it("removes the ops of rows the server replaced from older entries", () => {
    const h = setup();
    const [a, b] = initialRows as [Row, Row];
    h.commit({
      source: "paste",
      ops: [
        { type: "update", rowId: "a", row: { ...a, name: "A2" }, prev: a },
        { type: "update", rowId: "b", row: { ...b, name: "B2" }, prev: b },
      ],
    });
    h.commit(editChange("c", { ...initialRows[2]!, name: "C2" }, initialRows[2]!));
    h.commit({
      source: "merge",
      ops: [{ type: "update", rowId: "a", row: { ...a, name: "Server" }, prev: { ...a, name: "A2" } }],
      serverRowIds: ["a"],
    });

    act(() => h.history().undo());
    act(() => h.history().undo());

    expect(h.data().find((r) => r.id === "b")!.name).toBe("Bob");
    expect(h.data().find((r) => r.id === "a")!.name).toBe("Server");
    expect(h.history().canUndo).toBe(false);
  });

  it("removes an older entry that only touched a server-replaced row", () => {
    const h = setup();
    const prev = initialRows[0]!;
    h.commit(editChange("a", { ...prev, name: "Alicia" }, prev));
    h.commit({
      source: "rollback",
      ops: [{ type: "update", rowId: "a", row: { ...prev, name: "Server" }, prev: { ...prev, name: "Alicia" } }],
      serverRowIds: ["a"],
    });
    expect(h.history().canUndo).toBe(false);
  });
});

describe("dataset swaps", () => {
  it("reports an undo over a swapped-out dataset instead of doing nothing", () => {
    const onSkip = vi.fn();
    const h = setup({ onSkip });
    const prev = initialRows[0]!;
    h.commit(editChange("a", { ...prev, name: "Alicia" }, prev));
    h.swapData([{ id: "x", name: "Xavier", age: 1 }]);

    act(() => h.history().undo());

    expect(onSkip).toHaveBeenCalledWith({ direction: "undo", reason: "rows-gone", rowIds: ["a"] });
    expect(h.data()).toEqual([{ id: "x", name: "Xavier", age: 1 }]);
  });
});

describe("sparse data warning", () => {
  it("warns once per hook instance", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sparseWarns = () => warn.mock.calls.filter((call) => String(call[0]).includes("sparse")).length;
    const undoOverHoles = () => {
      const h = setup({}, { getRowId: holeTolerantRowId as never });
      const prev = initialRows[2]!;
      h.commit(editChange("c", { ...prev, name: "Changed" }, prev));
      h.swapData(sparseWithout(2));
      act(() => h.history().undo());
      return h;
    };

    undoOverHoles();
    expect(sparseWarns()).toBe(1);
    undoOverHoles();
    expect(sparseWarns()).toBe(2);
    warn.mockRestore();
  });
});
