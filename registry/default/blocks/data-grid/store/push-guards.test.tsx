import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef, DataChange } from "../types";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState } from ".";
import type { SaveAck } from "./write-ack";

type Row = { id: string; name: string; note: string };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "note", header: "Note", accessorKey: "note" },
];

const rows = (): Row[] => [
  { id: "a", name: "A", note: "a" },
  { id: "b", name: "B", note: "b" },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function mount(onSave?: (change: DataChange<Row>) => void | Promise<SaveAck<Row>>) {
  let api: StoreApi<DataGridStoreState> | null = null;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  render(
    <DataGridProvider columns={columns} getRowId={(row: Row) => row.id} defaultData={rows()} onSave={onSave}>
      <Probe />
    </DataGridProvider>,
  );
  const state = () => api!.getState();
  return {
    state,
    value: (rowId: string, field: "name" | "note") => (state().data as Row[]).find((r) => r.id === rowId)![field],
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
  it('skips the row with reason "saving" and lands after the save settles', async () => {
    const save = deferred<SaveAck<Row>>();
    const onSave = vi.fn(() => save.promise);
    const m = mount(onSave);
    act(() => m.state().actions.commitCellValue({ rowId: "a", columnId: "name" }, "Edited"));
    expect(m.state().saveStatus.get("a")).toBe("saving");

    const blocked = m.push([{ rowId: "a", columnId: "note", value: "pushed" }, { rowId: "b", columnId: "note", value: "other" }]);
    expect(blocked.skipped).toEqual([{ patchIndex: 0, reason: "saving" }]);
    expect(blocked.applied).toBe(1);
    expect(m.value("a", "note")).toBe("a");
    expect(m.value("b", "note")).toBe("other");

    save.resolve(undefined);
    await act(async () => {});
    const landed = m.push([{ rowId: "a", columnId: "note", value: "pushed" }]);
    expect(landed.skipped).toEqual([]);
    expect(m.value("a", "note")).toBe("pushed");
    expect(onSave).toHaveBeenCalledTimes(1);
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
