import { describe, expect, it, vi } from "vitest";
import { createDataGridStore } from "./create-store";
import { getInternalActions } from "./internal-actions";
import type { InternalSyncProps } from "./types";

type Row = { id: string; price: number; discount: number; note: string };

const columns = [
  { id: "price", header: "Price", accessorKey: "price", type: "number" },
  { id: "discount", header: "Discount", accessorKey: "discount", type: "number" },
  { id: "note", header: "Note", accessorKey: "note", type: "text" },
];

function makeStore(overrides: Partial<InternalSyncProps> = {}) {
  return createDataGridStore({
    data: [
      { id: "a", price: 100, discount: 10, note: "" },
      { id: "b:x", price: 100, discount: 10, note: "" },
    ],
    columns,
    getRowId: (row) => (row as Row).id,
    validateRow: (row, _rowId) => {
      const r = row as Row;
      return r.discount > r.price ? { discount: "discount above price" } : null;
    },
    ...overrides,
  } as InternalSyncProps);
}

describe("validateRow", () => {
  it("verdict is independent of column order inside a paste — the defining case", () => {
    for (const patches of [
      [
        { rowId: "a", columnId: "price", value: 30 },
        { rowId: "a", columnId: "discount", value: 40 },
      ],
      [
        { rowId: "a", columnId: "discount", value: 40 },
        { rowId: "a", columnId: "price", value: 30 },
      ],
    ]) {
      const store = makeStore();
      store.getState().actions.updateCells(patches);
      const s = store.getState();
      expect(s.cellErrors.get("a:discount"), `order: ${patches[0]!.columnId} first`).toBe("discount above price");
      // values still commit — server-error stance, no rollback
      expect((s.data[0] as Row).price).toBe(30);
      expect((s.data[0] as Row).discount).toBe(40);
    }
  });

  it("a later write that fixes the row clears the stale verdict", () => {
    const store = makeStore();
    store.getState().actions.updateCells([
      { rowId: "a", columnId: "price", value: 30 },
      { rowId: "a", columnId: "discount", value: 40 },
    ]);
    expect(store.getState().cellErrors.get("a:discount")).toBe("discount above price");
    store.getState().actions.updateCells([{ rowId: "a", columnId: "discount", value: 5 }]);
    expect(store.getState().cellErrors.has("a:discount")).toBe(false);
  });

  it("clears the verdict when a DIFFERENT column's write fixes the row — ownership, not write-clears-error", () => {
    const store = makeStore();
    store.getState().actions.updateCells([{ rowId: "a", columnId: "discount", value: 500 }]);
    expect(store.getState().cellErrors.get("a:discount")).toBe("discount above price");
    // the fixing write never touches `discount`, so clearErrorsForOps cannot clear its key
    store.getState().actions.updateCells([{ rowId: "a", columnId: "price", value: 1000 }]);
    expect(store.getState().cellErrors.has("a:discount")).toBe(false);
  });

  it("runs on a single-cell edit too — one semantics for every write", () => {
    const store = makeStore();
    store.getState().actions.updateCells([{ rowId: "a", columnId: "discount", value: 500 }]);
    expect(store.getState().cellErrors.get("a:discount")).toBe("discount above price");
  });

  it("never touches setCellErrors entries on other cells of the same row", () => {
    const store = makeStore();
    store.getState().actions.setCellErrors([{ rowId: "a", columnId: "note", message: "server said no" }]);
    store.getState().actions.updateCells([{ rowId: "a", columnId: "discount", value: 500 }]);
    const errors = store.getState().cellErrors;
    expect(errors.get("a:discount")).toBe("discount above price");
    expect(errors.get("a:note")).toBe("server said no");
    // fixing the row clears only the validateRow-owned key
    store.getState().actions.updateCells([{ rowId: "a", columnId: "discount", value: 1 }]);
    expect(store.getState().cellErrors.has("a:discount")).toBe(false);
    expect(store.getState().cellErrors.get("a:note")).toBe("server said no");
  });

  it("keys through cellErrorKey, so a colon-bearing rowId never collides", () => {
    const store = makeStore();
    store.getState().actions.updateCells([{ rowId: "b:x", columnId: "discount", value: 500 }]);
    const errors = store.getState().cellErrors;
    expect(errors.get("b:x:discount")).toBe("discount above price");
    expect(errors.size).toBe(1);
  });

  it("without the prop, cellErrors keeps the same identity through a write", () => {
    const store = makeStore({ validateRow: undefined });
    const before = store.getState().cellErrors;
    store.getState().actions.updateCells([{ rowId: "a", columnId: "discount", value: 500 }]);
    expect(store.getState().cellErrors).toBe(before);
  });
});

describe("a getRowId swapped together with data", () => {
  type Keyed = Row & { key: string };
  const byId = (row: unknown) => (row as Keyed).id;
  const byKey = (row: unknown) => (row as Keyed).key;
  const keyedStore = () =>
    makeStore({
      data: [{ id: "a", key: "k1", price: 100, discount: 10, note: "" }],
      getRowId: byId,
    });

  it("prunes cellErrors by the new row ids", () => {
    const store = keyedStore();
    store.getState().actions.setCellErrors([{ rowId: "a", columnId: "note", message: "server" }]);

    getInternalActions(store)._syncProps({
      data: [{ id: "a", key: "k1", price: 100, discount: 10, note: "" }],
      columns,
      getRowId: byKey,
    } as InternalSyncProps);

    expect(store.getState().cellErrors.has("a:note")).toBe(false);
  });

  it("prunes validateRow keys by the new row ids, so a reused id keeps its consumer errors", () => {
    const store = keyedStore();
    store.getState().actions.updateCells([{ rowId: "a", columnId: "discount", value: 400 }]);
    expect(store.getState().cellErrors.get("a:discount")).toBe("discount above price");

    getInternalActions(store)._syncProps({
      data: [{ id: "a", key: "k1", price: 100, discount: 400, note: "" }],
      columns,
      getRowId: byKey,
    } as InternalSyncProps);
    getInternalActions(store)._syncProps({
      data: [{ id: "x", key: "a", price: 100, discount: 10, note: "" }],
      columns,
      getRowId: byKey,
    } as InternalSyncProps);
    store.getState().actions.setCellErrors([{ rowId: "a", columnId: "discount", message: "server" }]);
    store.getState().actions.updateCells([{ rowId: "a", columnId: "note", value: "edited" }]);

    expect(store.getState().cellErrors.get("a:discount")).toBe("server");
  });
});

describe("a getRowId swap that keeps the data array", () => {
  type Keyed = Row & { key: string };
  const data: Keyed[] = [
    { id: "a", key: "k1", price: 100, discount: 10, note: "" },
    { id: "b", key: "k2", price: 100, discount: 10, note: "" },
  ];

  it("does not warn for a new function that returns the same ids", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = makeStore({ data, getRowId: (row) => (row as Keyed).id });

    getInternalActions(store)._syncProps({ data, columns, getRowId: (row: unknown) => (row as Keyed).id } as InternalSyncProps);

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("warns once when the new function returns other ids for the same data array", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = makeStore({ data, getRowId: (row) => (row as Keyed).id });

    getInternalActions(store)._syncProps({ data, columns, getRowId: (row: unknown) => (row as Keyed).key } as InternalSyncProps);
    getInternalActions(store)._syncProps({ data, columns, getRowId: (row: unknown) => `x-${(row as Keyed).key}` } as InternalSyncProps);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("getRowId");
    warn.mockRestore();
  });

  it("skips unloaded rows when it samples ids", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sparse = [undefined, data[0], undefined] as unknown as Keyed[];
    const store = makeStore({ data: sparse, getRowId: (row) => (row as Keyed).id });

    getInternalActions(store)._syncProps({ data: sparse, columns, getRowId: (row: unknown) => (row as Keyed).id } as InternalSyncProps);

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
