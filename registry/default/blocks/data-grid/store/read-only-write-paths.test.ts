import { describe, expect, it, vi } from "vitest";
import { createDataGridStore } from "./create-store";
import type { InternalSyncProps } from "./types";

type Row = { id: string; price: number };

const nonNegative = (value: unknown) => ((value as number) < 0 ? "must be >= 0" : null);

function makeStore(overrides: Partial<InternalSyncProps> = {}) {
  const onValidationError = vi.fn();
  const store = createDataGridStore({
    data: [{ id: "a", price: 10 }, { id: "b", price: 20 }],
    columns: [{ id: "price", header: "Price", accessorKey: "price", type: "number", validate: nonNegative }],
    getRowId: (row) => (row as Row).id,
    onValidationError,
    ...overrides,
  } as InternalSyncProps);
  return { store, onValidationError };
}

describe("readOnly write paths", () => {
  it("refuses updateCells without a source on a readOnly grid", () => {
    const { store } = makeStore({ readOnly: true });
    const verdict = store.getState().actions.updateCells([{ rowId: "a", columnId: "price", value: 5 }]);
    expect(verdict.applied).toBe(0);
    expect(verdict.skipped).toEqual([{ patchIndex: 0, reason: "readonly" }]);
    expect((store.getState().data[0] as Row).price).toBe(10);
  });

  it("refuses updateRows without a source on a readOnly grid", () => {
    const { store } = makeStore({ readOnly: true });
    store.getState().actions.updateRows([{ rowId: "a", changes: { price: 5 } }]);
    expect((store.getState().data[0] as Row).price).toBe(10);
  });

  it('writes on a readOnly grid when source is "stream"', () => {
    const { store } = makeStore({ readOnly: true });
    store.getState().actions.updateCells([{ rowId: "a", columnId: "price", value: 5 }], { source: "stream" });
    expect((store.getState().data[0] as Row).price).toBe(5);
  });
});

describe("applyCellUpdates validation", () => {
  it("rejects a value that fails the column validate when the caller passes no results", () => {
    const { store, onValidationError } = makeStore();
    store.getState().actions.applyCellUpdates([{ viewRowIndex: 0, columnId: "price", value: -1 }, { viewRowIndex: 1, columnId: "price", value: 7 }], "paste");
    expect((store.getState().data[0] as Row).price).toBe(10);
    expect((store.getState().data[1] as Row).price).toBe(7);
    expect(onValidationError).toHaveBeenCalledTimes(1);
  });
});
