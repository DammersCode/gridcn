import { describe, expect, it } from "vitest";
import { createDataGridStore } from "./create-store";
import { isRowChanged } from "./changed-rows";
import type { InternalSyncProps } from "./types";

type Row = { id: string; name: string };

function makeStore() {
  return createDataGridStore({
    defaultData: [
      { id: "a", name: "Ada" },
      { id: "b", name: "Bo" },
    ],
    columns: [{ id: "name", header: "Name", accessorKey: "name" }],
    getRowId: (row: Row) => row.id,
  } as unknown as InternalSyncProps);
}

const rowAt = (store: ReturnType<typeof makeStore>, index: number) => store.getState().data[index] as Row;
const changed = (store: ReturnType<typeof makeStore>, index: number) => isRowChanged(store.getState().actions, rowAt(store, index));

describe("changed rows", () => {
  it("marks a row that a user write changed and not one that a push changed", () => {
    const store = makeStore();
    store.getState().actions.commitChange({ source: "edit", ops: [{ type: "update", rowId: "a", row: { id: "a", name: "Ana" }, prev: rowAt(store, 0), cells: [{ columnId: "name", value: "Ana", prev: "Ada" }] }] });
    store.getState().actions.updateCells([{ rowId: "b", columnId: "name", value: "Bob" }]);
    expect(changed(store, 0)).toBe(true);
    expect(changed(store, 1)).toBe(false);
  });

  it("clears the mark when an undo or a push writes the row again", () => {
    const store = makeStore();
    const before = rowAt(store, 0);
    store.getState().actions.commitChange({ source: "paste", ops: [{ type: "update", rowId: "a", row: { id: "a", name: "Ana" }, prev: before, cells: [{ columnId: "name", value: "Ana", prev: "Ada" }] }] });
    store.getState().actions.commitChange({ source: "history", ops: [{ type: "update", rowId: "a", row: { id: "a", name: "Ada" }, prev: rowAt(store, 0), cells: [{ columnId: "name", value: "Ada", prev: "Ana" }] }] });
    expect(changed(store, 0)).toBe(false);
  });
});
