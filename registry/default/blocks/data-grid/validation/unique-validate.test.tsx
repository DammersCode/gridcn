import { describe, expect, it, vi } from "vitest";
import { createDataGridStore } from "../store/create-store";
import type { InternalSyncProps } from "../store/types";
import { pasteText } from "../clipboard/use-grid-clipboard";
import { unique, type CellValidateContext } from "../data-grid";

type Row = { id: string; email: string };
const data = (): Row[] => [{ id: "a", email: "ann@x" }, { id: "b", email: "bob@x" }, { id: "c", email: "" }];

function mount(validate: InternalSyncProps["columns"][number]["validate"], onValidationError = vi.fn()) {
  const store = createDataGridStore({
    defaultData: data(),
    columns: [{ id: "email", header: "Email", accessorKey: "email", validate }],
    getRowId: (row: unknown) => (row as Row).id,
    onValidationError,
  } as unknown as InternalSyncProps);
  return { store, emails: () => store.getState().data.map((row) => (row as Row).email), onValidationError };
}

describe("validate ctx and unique()", () => {
  it("rejects an edit that repeats another row's value, and accepts the row's own value", () => {
    const m = mount(unique());
    m.store.getState().actions.commitCellValue({ rowId: "b", columnId: "email" }, "ann@x");
    expect(m.emails()).toEqual(["ann@x", "bob@x", ""]);
    m.store.getState().actions.commitCellValue({ rowId: "a", columnId: "email" }, "ann@x");
    m.store.getState().actions.commitCellValue({ rowId: "c", columnId: "email" }, "cy@x");
    expect(m.emails()).toEqual(["ann@x", "bob@x", "cy@x"]);
  });

  it("rejects two cells of one paste that share a value, and a paste over a row frees its old value", () => {
    const m = mount(unique({ ignoreCase: true }));
    m.store.getState().actions.selectCellAt({ col: 0, row: 1 });
    pasteText(m.store.getState(), m.store.getState().actions, "Dup@x\ndup@x", undefined, m.store);
    expect(m.emails()).toEqual(["ann@x", "bob@x", ""]);
    expect(m.onValidationError).toHaveBeenCalledTimes(1);
    m.store.getState().actions.selectCellAt({ col: 0, row: 0 });
    pasteText(m.store.getState(), m.store.getState().actions, "bob@x\nann@x", undefined, m.store);
    expect(m.emails()).toEqual(["bob@x", "ann@x", ""]);
  });

  it("checks an updateCells batch against the other rows and the batch", () => {
    const m = mount(unique());
    const verdict = m.store.getState().actions.updateCells([{ rowId: "c", columnId: "email", value: "bob@x" }], { source: "edit" });
    expect(verdict.skipped).toEqual([{ patchIndex: 0, reason: "invalid" }]);
  });

  it("hands the function form the rows, the batch, and valueOf", () => {
    const seen: CellValidateContext[] = [];
    const m = mount((_value: unknown, _row: unknown, ctx: CellValidateContext) => (seen.push(ctx), null));
    m.store.getState().actions.updateCells([{ rowId: "a", columnId: "email", value: "1" }, { rowId: "b", columnId: "email", value: "2" }], { source: "edit" });
    expect(seen[0]!.rows).toHaveLength(3);
    expect(seen[0]!.batch.map((cell) => cell.value)).toEqual(["1", "2"]);
    expect(seen[0]!.valueOf(data()[1]!)).toBe("bob@x");
    expect(seen[1]).toBe(seen[0]);
  });
});
