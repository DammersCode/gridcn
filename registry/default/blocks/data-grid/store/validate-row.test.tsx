import { describe, expect, it } from "vitest";
import { createDataGridStore } from "./create-store";
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
