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

const getRowId = (row: Row) => row.id;

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "age", header: "Age", accessorKey: "age", type: "number" },
];

const initialRows: Row[] = [
  { id: "a", name: "Alice", age: 30 },
  { id: "b", name: "Bob", age: 25 },
  { id: "c", name: "Cara", age: 40 },
];

function editChange(rowId: string, next: Row, prev: Row): DataChange<Row> {
  return {
    source: "edit",
    ops: [{ type: "update", rowId, row: next, prev, cells: [{ columnId: "name", value: next.name, prev: prev.name }] }],
  };
}

/**
 * Mounts the history plugin into a real controlled grid (consumer `data` + `onDataChange` echo,
 * like a real consumer), so the plugin's `onDataChange` observer and `Mount`-stashed api handle
 * both run for real. `commit` drives a change through the grid's public `commitChange` action;
 * `consumerSwap` reorders/rewrites the consumer's array with no grid write (no history entry).
 */
function setupHarness(historyOpts: UseDataGridHistoryOptions<Row> = {}, gridOpts: Partial<DataGridSyncProps<Row>> = {}) {
  let currentHistoryOpts = historyOpts;
  let currentGridOpts = gridOpts;
  let data: readonly Row[] = initialRows;
  const setData = (next: readonly Row[]) => {
    data = next;
  };
  let history: UseDataGridHistoryResult<Row> | null = null;
  let store: StoreApi<DataGridStoreState> | null = null;

  function Capture() {
    store = useDataGridStoreApi();
    return null;
  }

  function Harness() {
    const h = useDataGridHistory<Row>(currentHistoryOpts);
    history = h;
    return (
      <DataGridProvider
        data={data}
        columns={columns}
        getRowId={currentGridOpts.getRowId ?? getRowId}
        plugins={[h.plugin]}
        onDataChange={(next, change) => {
          setData(next);
          currentGridOpts.onDataChange?.(next, change);
        }}
        readOnly={currentGridOpts.readOnly}
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
    /** Drives a change through the grid's public `commitChange` action (one write, one emit, observer records). */
    commit: (change: DataChange<Row>) => act(() => store!.getState().actions.commitChange(change)),
    /** Consumer-side array rewrite with no grid write (an external sort or lazy refetch): no history entry. */
    consumerSwap: (next: readonly Row[]) => {
      setData(next);
      act(() => view.rerender(<Harness />));
    },
    setHistoryOpts: (opts: UseDataGridHistoryOptions<Row>) => {
      currentHistoryOpts = opts;
      act(() => view.rerender(<Harness />));
    },
    setGridOpts: (opts: Partial<DataGridSyncProps<Row>>) => {
      currentGridOpts = { ...currentGridOpts, ...opts };
      act(() => view.rerender(<Harness />));
    },
  };
}

afterEach(cleanup);

describe("useDataGridHistory", () => {
  it("round-trips a single edit through undo/redo", () => {
    const h = setupHarness();
    const prev = initialRows[0]!;
    const next = { ...prev, name: "Alicia" };

    h.commit(editChange("a", next, prev));
    expect(h.data()[0]!.name).toBe("Alicia");
    expect(h.history().canUndo).toBe(true);

    act(() => h.history().undo());
    expect(h.data()[0]!.name).toBe("Alice");
    expect(h.history().canUndo).toBe(false);
    expect(h.history().canRedo).toBe(true);

    act(() => h.history().redo());
    expect(h.data()[0]!.name).toBe("Alicia");
    expect(h.history().canRedo).toBe(false);
  });

  it("undoes a multi-row paste-style batch in one step", () => {
    const h = setupHarness();
    const prevA = initialRows[0]!;
    const prevB = initialRows[1]!;
    const nextA = { ...prevA, name: "X1" };
    const nextB = { ...prevB, name: "X2" };
    const batch: DataChange<Row> = {
      source: "paste",
      ops: [
        { type: "update", rowId: "a", row: nextA, prev: prevA, cells: [{ columnId: "name", value: "X1", prev: "Alice" }] },
        { type: "update", rowId: "b", row: nextB, prev: prevB, cells: [{ columnId: "name", value: "X2", prev: "Bob" }] },
      ],
    };

    h.commit(batch);
    expect(h.data().map((r) => r.name)).toEqual(["X1", "X2", "Cara"]);

    act(() => h.history().undo());
    expect(h.data().map((r) => r.name)).toEqual(["Alice", "Bob", "Cara"]);
  });

  it("undoes by row id after the consumer reorders the array (id-keyed, not index-keyed)", () => {
    const h = setupHarness();
    const prev = initialRows[0]!; // "a" / Alice, currently at index 0
    const next = { ...prev, name: "Alicia" };
    h.commit(editChange("a", next, prev));

    // the consumer reorders the array in their own state without a grid write (e.g. an external
    // sort): no onDataChange batch, so no history entry — row "a" just moves to the end
    h.consumerSwap([h.data()[2]!, h.data()[1]!, h.data()[0]!]);
    expect(h.data().map((r) => r.id)).toEqual(["c", "b", "a"]);

    act(() => h.history().undo());
    const row = h.data().find((r) => r.id === "a")!;
    expect(row.name).toBe("Alice");
  });

  it("caps the undo stack at the given capacity", () => {
    const h = setupHarness({ capacity: 2 });
    const rows = [...initialRows];
    for (let i = 0; i < 3; i++) {
      const prev = rows[0]!;
      const next = { ...prev, age: prev.age + 1 };
      rows[0] = next;
      h.commit(editChange("a", next, prev));
    }
    expect(h.data()[0]!.age).toBe(33);

    // capacity 2: only the last 2 of 3 edits are undoable
    act(() => h.history().undo());
    expect(h.data()[0]!.age).toBe(32);
    act(() => h.history().undo());
    expect(h.data()[0]!.age).toBe(31);
    expect(h.history().canUndo).toBe(false);
  });

  it("discards the redo branch once a new change is pushed", () => {
    const h = setupHarness();
    const prev = initialRows[0]!;
    const next1 = { ...prev, name: "First" };
    h.commit(editChange("a", next1, prev));
    act(() => h.history().undo());
    expect(h.history().canRedo).toBe(true);

    const next2 = { ...prev, name: "Second" };
    h.commit(editChange("a", next2, prev));

    expect(h.history().canRedo).toBe(false);
    act(() => h.history().redo()); // no-op: redo branch was discarded
    expect(h.data()[0]!.name).toBe("Second");
  });

  it("ignores changes tagged source 'history' so undo/redo never loop back into the stack", () => {
    const h = setupHarness();
    const prev = initialRows[0]!;
    const next = { ...prev, name: "Alicia" };
    h.commit(editChange("a", next, prev));
    expect(h.history().historySize).toBe(1);

    // a second, history-sourced change applied straight through the grid records no entry
    const next2 = { ...next, name: "Loop" };
    h.commit({
      source: "history",
      ops: [{ type: "update", rowId: "a", row: next2, prev: next, cells: [{ columnId: "name", value: "Loop", prev: "Alicia" }] }],
    });
    expect(h.data()[0]!.name).toBe("Loop");
    expect(h.history().historySize).toBe(1);
  });

  it("does not record source 'stream' by default, so a live feed cannot evict the undo stack", () => {
    const h = setupHarness();
    const prev = initialRows[0]!;
    const next = { ...prev, name: "Tick" };
    h.commit({
      source: "stream",
      ops: [{ type: "update", rowId: "a", row: next, prev, cells: [{ columnId: "name", value: "Tick", prev: "Alice" }] }],
    });
    expect(h.data()[0]!.name).toBe("Tick");
    expect(h.history().canUndo).toBe(false);
  });

  it("records source 'stream' when recordSources opts in", () => {
    const h = setupHarness({ recordSources: ["edit", "stream"] });
    const prev = initialRows[0]!;
    const next = { ...prev, name: "Tick" };
    h.commit({
      source: "stream",
      ops: [{ type: "update", rowId: "a", row: next, prev, cells: [{ columnId: "name", value: "Tick", prev: "Alice" }] }],
    });
    expect(h.history().canUndo).toBe(true);
  });

  it("recordSources can also drop a source that is recorded by default", () => {
    const h = setupHarness({ recordSources: ["row-op"] });
    const prev = initialRows[0]!;
    const next = { ...prev, name: "Changed" };
    h.commit(editChange("a", next, prev));
    expect(h.data()[0]!.name).toBe("Changed");
    expect(h.history().canUndo).toBe(false);
  });

  it("round-trips undo with an index-derived getRowId", () => {
    type OptionalIdRow = { id?: string; name: string; age: number };
    const rows: OptionalIdRow[] = [{ name: "Alice", age: 30 }, { name: "Bob", age: 25 }];
    const h = setupHarness(
      {},
      {
        getRowId: ((row: OptionalIdRow, index: number) => row.id ?? `row-${index}`) as never,
        // `data` is injected through the harness's initial array; a second column is unused here, so
        // the test only needs the harness's own rows — swap them in via consumerSwap instead.
      },
    );
    h.consumerSwap(rows as Row[]);
    const prev = rows[0]!;
    const next = { ...prev, name: "Alicia" };
    h.commit({
      source: "edit",
      ops: [{ type: "update", rowId: "row-0", row: next as Row, prev: prev as Row, cells: [{ columnId: "name", value: "Alicia", prev: "Alice" }] }],
    });
    expect((h.data() as readonly OptionalIdRow[])[0]!.name).toBe("Alicia");

    act(() => h.history().undo());
    expect((h.data() as readonly OptionalIdRow[])[0]!.name).toBe("Alice");
  });

  it("clear() empties both stacks", () => {
    const h = setupHarness();
    const prev = initialRows[0]!;
    const next = { ...prev, name: "Changed" };
    h.commit(editChange("a", next, prev));
    expect(h.history().canUndo).toBe(true);

    act(() => h.history().clear());
    expect(h.history().canUndo).toBe(false);
    expect(h.history().canRedo).toBe(false);
  });

  it("record() applies a programmatic change and registers it as one undo step", () => {
    const h = setupHarness();
    const prev = initialRows[0]!;
    const next = { ...prev, name: "Zoe" };
    const change: DataChange<Row> = {
      source: "app",
      ops: [{ type: "update", rowId: "a", row: next, prev, cells: [{ columnId: "name", value: "Zoe", prev: "Alice" }] }],
    };

    // record() applies the change through the grid itself; the consumer no longer applies it
    act(() => h.history().record(change));
    expect(h.data()[0]!.name).toBe("Zoe");
    expect(h.history().canUndo).toBe(true);
    expect(h.history().historySize).toBe(1); // one entry, not two

    act(() => h.history().undo());
    expect(h.data()[0]!.name).toBe("Alice");
    expect(h.history().canRedo).toBe(true);

    act(() => h.history().redo());
    expect(h.data()[0]!.name).toBe("Zoe");
  });

  it("record() accepts a labeled change and still round-trips through undo", () => {
    const h = setupHarness();
    const prev = initialRows[0]!;
    const next = { ...prev, name: "Zoe" };
    const change: DataChange<Row> = {
      source: "app",
      label: "Batch save rollback",
      ops: [{ type: "update", rowId: "a", row: next, prev, cells: [{ columnId: "name", value: "Zoe", prev: "Alice" }] }],
    };
    act(() => h.history().record(change, "Batch save rollback"));
    expect(h.data()[0]!.name).toBe("Zoe");
    act(() => h.history().undo());
    expect(h.data()[0]!.name).toBe("Alice");
  });

  it("records source 'app' through commitChange by default", () => {
    const h = setupHarness();
    const prev = initialRows[0]!;
    const next = { ...prev, name: "App" };
    h.commit({
      source: "app",
      ops: [{ type: "update", rowId: "a", row: next, prev, cells: [{ columnId: "name", value: "App", prev: "Alice" }] }],
    });
    expect(h.history().canUndo).toBe(true);
  });

  it("dev-warns once when undo runs over a sparse (lazy) data array", () => {
    const warn = vi.spyOn(console, "warn");
    // a hole at index 1, the shape of useDataGridLazyRows' data with one unloaded range
    // (a real hole, not an undefined slot: array literals with `undefined` are dense)
    const sparse = (rowC: Row) => {
      const arr = new Array<Row | undefined>(3);
      arr[0] = initialRows[0]!;
      arr[2] = rowC;
      return arr;
    };
    const h = setupHarness(
      {},
      { getRowId: ((row: Row | undefined, index: number) => (row ? row.id : `hole-${index}`)) as never },
    );
    h.consumerSwap(sparse(initialRows[2]!) as Row[]);

    const prev = initialRows[2]!;
    const next = { ...prev, name: "Changed" };
    h.commit(editChange("c", next, prev));
    expect(warn).not.toHaveBeenCalled();

    // the grid's own write densified the hole into an explicit undefined; undo reads the store's
    // data at run time, so re-feed the consumer's sparse array (the lazy page the consumer owns)
    h.consumerSwap(sparse(next) as Row[]);
    act(() => h.history().undo());
    // the swap also trips the core's data-identity dev-warn; only the sparse-data one counts here
    const sparseWarns = () => warn.mock.calls.filter((c) => String(c[0]).includes("sparse")).length;
    expect(sparseWarns()).toBe(1);
    expect(h.data()[2]!.name).toBe("Cara"); // the undo landed across the hole

    const prev2 = h.data()[2]!;
    const next2 = { ...prev2, name: "Again" };
    h.commit(editChange("c", next2, prev2));
    h.consumerSwap(sparse(next2) as Row[]);
    act(() => h.history().undo());
    // the once-per-app flag holds the second warn back
    expect(sparseWarns()).toBe(1);
    warn.mockRestore();
  });

  it("historySize tracks the undo stack across commit, undo, and clear", () => {
    const h = setupHarness();
    expect(h.history().historySize).toBe(0);
    const prev = initialRows[0]!;
    const next = { ...prev, name: "Changed" };
    h.commit(editChange("a", next, prev));
    expect(h.history().historySize).toBe(1);

    act(() => h.history().undo());
    expect(h.history().historySize).toBe(0);

    act(() => h.history().redo());
    expect(h.history().historySize).toBe(1);

    act(() => h.history().clear());
    expect(h.history().historySize).toBe(0);
  });

  it("clears both undo and redo stacks when datasetKey changes", () => {
    const h = setupHarness({ datasetKey: "A" });
    const prev = initialRows[0]!;
    const next = { ...prev, name: "Changed" };
    h.commit(editChange("a", next, prev));
    expect(h.history().canUndo).toBe(true);

    act(() => h.history().undo());
    expect(h.history().canRedo).toBe(true);

    h.setHistoryOpts({ datasetKey: "B" });
    expect(h.history().canUndo).toBe(false);
    expect(h.history().canRedo).toBe(false);
    expect(h.history().historySize).toBe(0);
    // the data array itself is untouched — only the stacks clear
    expect(h.data()[0]!.name).toBe("Alice");
  });

  it("does not clear the stack on the initial mount when datasetKey is set", () => {
    const h = setupHarness({ datasetKey: "A" });
    const prev = initialRows[0]!;
    const next = { ...prev, name: "Changed" };
    h.commit(editChange("a", next, prev));
    expect(h.history().canUndo).toBe(true);
    expect(h.history().historySize).toBe(1);
  });

  it("keeps history when datasetKey is stable across renders", () => {
    const h = setupHarness({ datasetKey: 7 });
    const prev = initialRows[0]!;
    const next = { ...prev, name: "Changed" };
    h.commit(editChange("a", next, prev));
    h.setHistoryOpts({ datasetKey: 7 });
    h.setHistoryOpts({ datasetKey: 7 });
    expect(h.history().canUndo).toBe(true);
    expect(h.history().historySize).toBe(1);
  });
});

describe("useDataGridHistory readOnly", () => {
  it("a read-only grid records nothing: writes are gated at the store", () => {
    const h = setupHarness({}, { readOnly: true });
    const prev = initialRows[0]!;
    const next = { ...prev, name: "Alicia" };
    h.commit(editChange("a", next, prev));
    expect(h.data()[0]!.name).toBe("Alice"); // the write was refused
    expect(h.history().canUndo).toBe(false);
  });

  it("undo/redo are no-ops while the grid is read-only, without losing the entry", () => {
    const h = setupHarness();
    const prev = initialRows[0]!;
    const next = { ...prev, name: "Alicia" };
    h.commit(editChange("a", next, prev));
    expect(h.history().canUndo).toBe(true);

    h.setGridOpts({ readOnly: true });
    act(() => h.history().undo());
    expect(h.history().canUndo).toBe(true); // the entry is kept, not popped unapplied
    expect(h.data()[0]!.name).toBe("Alicia"); // the data is untouched

    h.setGridOpts({ readOnly: false });
    act(() => h.history().undo());
    expect(h.data()[0]!.name).toBe("Alice");
    expect(h.history().canUndo).toBe(false);
  });

  it("rollback reverts a failed change with source 'rollback' and leaves no dead undo entry", () => {
    const seen: DataChange<Row>[] = [];
    const h = setupHarness({}, { onDataChange: (_next, change) => seen.push(change) });
    const change = editChange("a", { id: "a", name: "Alicia", age: 30 }, initialRows[0]!);
    h.commit(change);
    expect(h.history().historySize).toBe(1);

    act(() => h.history().rollback(seen[0]!));

    expect(h.data()[0]!.name).toBe("Alice");
    expect(seen.map((c) => c.source)).toEqual(["edit", "rollback"]);
    expect(h.history().historySize).toBe(0);
    expect(h.history().canRedo).toBe(false);
  });
});
