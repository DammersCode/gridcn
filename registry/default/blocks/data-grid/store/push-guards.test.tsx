import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef, DataChange } from "../types";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState } from ".";
import type { SaveAck } from "./write-ack";
import { viewIndex } from "@/registry/default/blocks/data-grid/types";

type Row = { id: string; name: string; note: string; locked: string; byRow: string };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "note", header: "Note", accessorKey: "note" },
  { id: "locked", header: "Locked", accessorKey: "locked", readOnly: true },
  { id: "byRow", header: "By row", accessorKey: "byRow", readOnly: (row: Row) => row.id === "b" },
];

const rows = (): Row[] => [
  { id: "a", name: "A", note: "a", locked: "l", byRow: "r" },
  { id: "b", name: "B", note: "b", locked: "l", byRow: "r" },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function mount(onSave?: (change: DataChange<Row>) => void | Promise<SaveAck<Row>>, extra: Record<string, unknown> = {}) {
  let api: StoreApi<DataGridStoreState> | null = null;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  render(
    <DataGridProvider columns={columns} getRowId={(row: Row) => row.id} defaultData={rows()} onSave={onSave} {...extra}>
      <Probe />
    </DataGridProvider>,
  );
  const state = () => api!.getState();
  return {
    state,
    value: (rowId: string, field: "name" | "note" | "locked" | "byRow") => (state().data as Row[]).find((r) => r.id === rowId)![field],
    push: (...args: Parameters<DataGridStoreState["actions"]["updateCells"]>) => {
      let verdict!: ReturnType<DataGridStoreState["actions"]["updateCells"]>;
      act(() => {
        verdict = state().actions.updateCells(...args);
      });
      return verdict;
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("push to a row with a save in flight", () => {
  it('holds the patch with reason "saving" and applies it once the save settles', async () => {
    const save = deferred<SaveAck<Row>>();
    const onSave = vi.fn(() => save.promise);
    const m = mount(onSave);
    act(() => m.state().actions.commitCellValue({ rowId: "a", columnId: "name" }, "Edited"));
    expect(m.state().saveStatus.get("a")).toBe("saving");

    const blocked = m.push([{ rowId: "a", columnId: "note", value: "first" }, { rowId: "b", columnId: "note", value: "other" }]);
    expect(blocked.skipped).toEqual([{ patchIndex: 0, reason: "saving" }]);
    expect(blocked.applied).toBe(1);
    m.push([{ rowId: "a", columnId: "note", value: "pushed" }]);
    expect(m.value("a", "note")).toBe("a");
    expect(m.value("b", "note")).toBe("other");

    await act(async () => save.resolve(undefined));
    expect(m.value("a", "note")).toBe("pushed");
    expect(m.value("a", "name")).toBe("Edited");
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("applies a held patch after a refused save rolls the row back", async () => {
    const save = deferred<SaveAck<Row>>();
    const m = mount(() => save.promise);
    act(() => m.state().actions.commitCellValue({ rowId: "a", columnId: "name" }, "Edited"));
    m.push([{ rowId: "a", columnId: "note", value: "pushed" }]);
    await act(async () => save.reject(new Error("refused")));
    expect(m.value("a", "note")).toBe("pushed");
  });

  it("still lets a user-source batch write to a saving row", () => {
    const m = mount(() => new Promise<SaveAck<Row>>(() => {}));
    act(() => m.state().actions.commitCellValue({ rowId: "a", columnId: "name" }, "Edited"));
    const verdict = m.push([{ rowId: "a", columnId: "note", value: "typed" }], { source: "edit" });
    expect(verdict.skipped).toEqual([]);
    expect(m.value("a", "note")).toBe("typed");
  });
});

describe("bound on one stream call", () => {
  const manyPatches = (count: number) => Array.from({ length: count }, (_, i) => ({ rowId: i % 2 === 0 ? "a" : "b", columnId: "note", value: i === 100_000 ? "last" : `v${i % 7}` }));

  it('skips the patches past 100,000 with reason "limit" and warns once', () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = mount();
    const verdict = m.push(manyPatches(100_001));
    expect(verdict.skipped).toEqual([{ patchIndex: 100_000, reason: "limit" }]);
    expect(m.value("a", "note")).not.toBe("last");
    m.push(manyPatches(100_002));
    expect(warn.mock.calls.filter(([message]) => String(message).includes("100000"))).toHaveLength(1);
  });

  it("applies a call of exactly 100,000 patches whole", () => {
    const m = mount();
    expect(m.push(manyPatches(100_000)).skipped.filter((skip) => skip.reason === "limit")).toEqual([]);
  });

  it("counts the cells that updateRows expands", () => {
    const m = mount();
    const updates = Array.from({ length: 50_001 }, () => ({ rowId: "a", changes: { name: "x", note: "y" } }));
    const verdict = m.state().actions.updateRows(updates);
    expect(verdict.skipped.filter((skip) => skip.reason === "limit")).toEqual([
      { patchIndex: 100_000, reason: "limit" },
      { patchIndex: 100_001, reason: "limit" },
    ]);
  });

  it("leaves a user-source batch unbounded", () => {
    const m = mount();
    expect(m.push(manyPatches(100_001), { source: "edit" }).skipped.filter((skip) => skip.reason === "limit")).toEqual([]);
  });
});

describe("stream delete", () => {
  const ids = (m: ReturnType<typeof mount>) => (m.state().data as Row[]).map((row) => row.id);

  it("skips onBeforeDeleteRows and onSave, reports a stream change, and unchecks the row", () => {
    const onSave = vi.fn();
    const onBeforeDeleteRows = vi.fn(() => true);
    const onDataChange = vi.fn();
    const m = mount(onSave, { onBeforeDeleteRows, onDataChange });
    act(() => m.state().actions.setRowCheckedAt(viewIndex(0), true));
    expect(m.state().selection.rows.length).toBe(1);

    act(() => m.state().actions.deleteRows(["a"], { source: "stream" }));

    expect(ids(m)).toEqual(["b"]);
    expect(onBeforeDeleteRows).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
    expect(onDataChange).toHaveBeenCalledTimes(1);
    expect(onDataChange.mock.calls[0]![1]).toMatchObject({ source: "stream", ops: [{ type: "delete", rowId: "a" }] });
    expect(m.state().selection.rows.length).toBe(0);
  });

  it("keeps the checked state of the other rows", () => {
    const m = mount();
    act(() => m.state().actions.setRowCheckedAt(viewIndex(1), true));
    act(() => m.state().actions.deleteRows(["a"], { source: "stream" }));
    expect(m.state().selection.rows.hasIndex(0)).toBe(true);
  });

  it("ignores ids that match no row, including a prototype key", () => {
    const m = mount();
    act(() => m.state().actions.deleteRows(["nope", "__proto__", "constructor"], { source: "stream" }));
    expect(ids(m)).toEqual(["a", "b"]);
  });

  it("keeps the default row-operation delete through the gate and onSave", () => {
    const onSave = vi.fn();
    const onBeforeDeleteRows = vi.fn(() => true);
    const m = mount(onSave, { onBeforeDeleteRows });
    act(() => m.state().actions.deleteRows(["a"]));
    expect(onBeforeDeleteRows).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("takes at most 100,000 ids per stream call", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = mount();
    const many = Array.from({ length: 100_000 }, (_, i) => `x${i}`);
    act(() => m.state().actions.deleteRows([...many, "a"], { source: "stream" }));
    expect(ids(m)).toEqual(["a", "b"]);
    expect(warn.mock.calls.filter(([message]) => String(message).includes("100000"))).toHaveLength(1);
  });
});

describe("stream into read-only targets", () => {
  it("writes into a readOnly grid", () => {
    const m = mount(undefined, { readOnly: true });
    const verdict = m.push([{ rowId: "a", columnId: "note", value: "pushed" }], { source: "stream" });
    expect(verdict).toMatchObject({ applied: 1, skipped: [] });
    expect(m.value("a", "note")).toBe("pushed");
  });

  it("writes into a read-only column and a read-only row", () => {
    const m = mount();
    const verdict = m.push([{ rowId: "a", columnId: "locked", value: "x" }, { rowId: "b", columnId: "byRow", value: "y" }]);
    expect(verdict.applied).toBe(2);
    expect(m.value("a", "locked")).toBe("x");
    expect(m.value("b", "byRow")).toBe("y");
  });

  it('keeps every read-only check for source "edit"', () => {
    const grid = mount();
    const columnOnly = grid.push([{ rowId: "a", columnId: "locked", value: "x" }, { rowId: "b", columnId: "byRow", value: "y" }], { source: "edit" });
    expect(columnOnly.skipped.map((skip) => skip.reason)).toEqual(["readonly", "readonly"]);
    const readOnlyGrid = mount(undefined, { readOnly: true });
    const verdict = readOnlyGrid.push([{ rowId: "a", columnId: "note", value: "x" }], { source: "edit" });
    expect(verdict.applied).toBe(0);
    expect(readOnlyGrid.value("a", "note")).toBe("a");
  });

  it("deletes by stream in a readOnly grid, and a user delete stays refused", () => {
    const m = mount(undefined, { readOnly: true });
    act(() => m.state().actions.deleteRows(["a"]));
    expect(m.state().data).toHaveLength(2);
    act(() => m.state().actions.deleteRows(["a"], { source: "stream" }));
    expect(m.state().data).toHaveLength(1);
  });

  it("reports a rejected value to onValidationError in a readOnly grid", () => {
    const onValidationError = vi.fn();
    const m = mount(undefined, { readOnly: true, onValidationError, columns: [{ id: "note", header: "Note", accessorKey: "note", validate: (value: unknown) => (value === "bad" ? "no" : null) }] });
    const verdict = m.push([{ rowId: "a", columnId: "note", value: "bad" }], { source: "stream" });
    expect(verdict.skipped).toEqual([{ patchIndex: 0, reason: "invalid" }]);
    expect(onValidationError).toHaveBeenCalledTimes(1);
  });
});

describe("a source-less write into a readOnly grid", () => {
  const readOnlyWarnings = (warn: { mock: { calls: unknown[][] } }) => warn.mock.calls.filter(([m]) => String(m).includes("the write is refused"));

  it("refuses and warns once when updateCells and updateRows pass no source", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = mount(undefined, { readOnly: true });
    act(() => {
      m.state().actions.updateCells([{ rowId: "a", columnId: "note", value: "1" }]);
      m.state().actions.updateRows([{ rowId: "a", changes: { note: "2" } }]);
    });
    expect(readOnlyWarnings(warn)).toHaveLength(1);
  });

  it("stays silent with an explicit source or a writable grid", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const readOnly = mount(undefined, { readOnly: true });
    act(() => readOnly.state().actions.updateCells([{ rowId: "a", columnId: "note", value: "1" }], { source: "stream" }));
    const writable = mount();
    act(() => writable.state().actions.updateCells([{ rowId: "a", columnId: "note", value: "1" }]));
    expect(readOnlyWarnings(warn)).toHaveLength(0);
  });
});

describe("stream limit warnings", () => {
  it("warns for the patch cap and the delete cap separately", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = mount();
    const patches = Array.from({ length: 100_001 }, () => ({ rowId: "a", columnId: "note", value: "x" }));
    const many = Array.from({ length: 100_001 }, (_, i) => `x${i}`);
    act(() => {
      m.state().actions.updateCells(patches);
      m.state().actions.deleteRows(many, { source: "stream" });
    });
    expect(warn.mock.calls.filter(([message]) => String(message).includes("100000"))).toHaveLength(2);
  });
});

describe("insertRows warnings", () => {
  it("warns once per grid when there is no createRow", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = mount();
    act(() => {
      m.state().actions.insertRows(0, 1);
      m.state().actions.insertRows(0, 1);
    });
    expect(warn.mock.calls.filter(([message]) => String(message).includes("createRow"))).toHaveLength(1);
  });
});
