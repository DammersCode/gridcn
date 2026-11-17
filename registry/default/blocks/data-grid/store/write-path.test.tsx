import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef, DataChange } from "../types";
import { holeRowId } from "../data-grid-sdk";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState, type DataGridSyncProps } from ".";
import type { SaveAck } from "./write-ack";
import { viewIndexes } from "@/registry/default/blocks/data-grid/types";

type Row = { id: string; name: string };

const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];

const dense = (): Row[] => ["a", "b", "c"].map((id) => ({ id, name: id.toUpperCase() }));

function sparse(): (Row | undefined)[] {
  const data = new Array<Row | undefined>(6);
  for (const i of [0, 1, 4]) data[i] = { id: `r${i}`, name: `R${i}` };
  return data;
}

function mount(props: Partial<DataGridSyncProps<Row>> = {}, data: readonly (Row | undefined)[] = dense()) {
  let api: StoreApi<DataGridStoreState> | null = null;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  const tree = (next: Partial<DataGridSyncProps<Row>>) => (
    <DataGridProvider
      columns={columns}
      getRowId={(row: Row | undefined, index: number) => (row === undefined ? holeRowId(index) : row.id)}
      defaultData={data as Row[]}
      {...next}
    >
      <Probe />
    </DataGridProvider>
  );
  const view = render(tree(props));
  const state = () => api!.getState();
  return {
    state,
    rerender: (next: Partial<DataGridSyncProps<Row>>) => view.rerender(tree(next)),
    edit: (value: string) => act(() => state().actions.commitCellValue({ rowId: "a", columnId: "name" }, value)),
    ids: () => (state().data as (Row | undefined)[]).map((row) => row?.id),
    name: (rowId = "a") => (state().data as Row[]).find((row) => row?.id === rowId)?.name,
  };
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => act(async () => {});

afterEach(() => vi.restoreAllMocks());

describe("a refused save", () => {
  it("reverts on a readOnly grid and reports reverted: true", async () => {
    const d = deferred<SaveAck<Row>>();
    const onSaveRejected = vi.fn();
    const m = mount({ onSave: () => d.promise, onSaveRejected });
    m.edit("X");
    m.rerender({ onSave: () => d.promise, onSaveRejected, readOnly: true });
    d.resolve({ rejected: [{ rowId: "a" }] });
    await flush();
    expect(m.name()).toBe("A");
    expect(m.state().saveStatus.get("a")).toBe("failed");
    expect(onSaveRejected.mock.calls[0]![0].reverted).toBe(true);
  });

  it("keep: true leaves the value, marks the cell with the message, and reports reverted: false", async () => {
    const d = deferred<SaveAck<Row>>();
    const onSaveRejected = vi.fn();
    const onDataChange = vi.fn();
    const m = mount({ onSave: () => d.promise, onSaveRejected, onDataChange });
    m.edit("X");
    onDataChange.mockClear();
    d.resolve({ rejected: [{ rowId: "a", columnId: "name", keep: true, message: "Name is taken" }] });
    await flush();
    expect(m.name()).toBe("X");
    expect(onDataChange).not.toHaveBeenCalled();
    expect([...m.state().cellErrors.values()]).toEqual(["Name is taken"]);
    expect(m.state().saveStatus.get("a")).toBe("failed");
    expect(onSaveRejected.mock.calls[0]![0].reverted).toBe(false);
  });

  it("keep: true marks the cells of a whole-row refusal and uses a default message", async () => {
    const d = deferred<SaveAck<Row>>();
    const m = mount({ onSave: () => d.promise });
    m.edit("X");
    d.resolve({ rejected: [{ rowId: "a", keep: true }] });
    await flush();
    expect(m.name()).toBe("X");
    expect(m.state().cellErrors.size).toBe(1);
  });

  it("keeps one entry and reverts another of the same answer", async () => {
    const d = deferred<SaveAck<Row>>();
    const onSaveRejected = vi.fn();
    const m = mount({ onSave: () => d.promise, onSaveRejected });
    act(() => m.state().actions.commitChange({ source: "edit", ops: [
      { type: "update", rowId: "a", row: { id: "a", name: "X" }, prev: { id: "a", name: "A" }, cells: [{ columnId: "name", value: "X", prev: "A" }] },
      { type: "update", rowId: "b", row: { id: "b", name: "Y" }, prev: { id: "b", name: "B" }, cells: [{ columnId: "name", value: "Y", prev: "B" }] },
    ] }));
    d.resolve({ rejected: [{ rowId: "a", keep: true }, { rowId: "b" }] });
    await flush();
    expect(m.name("a")).toBe("X");
    expect(m.name("b")).toBe("B");
    expect(onSaveRejected.mock.calls[0]![0].reverted).toBe(true);
  });
});

describe("callback errors", () => {
  it("a throwing onDataChange does not throw to the caller and does not drop onSave or observers", () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const order: string[] = [];
    const m = mount({
      onDataChange: () => {
        order.push("data");
        throw new Error("consumer threw");
      },
      onSave: () => void order.push("save"),
      plugins: [{ name: "obs", onDataChange: () => void order.push("observer") }],
    });
    expect(() => m.edit("X")).not.toThrow();
    expect(order).toEqual(["data", "save", "observer"]);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(String(reportError.mock.calls[0]![0])).toContain("consumer threw");
    vi.unstubAllGlobals();
  });

  it("a throwing plugin observer goes to reportError, and the rest still run", () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const seen: string[] = [];
    const m = mount({
      plugins: [
        { name: "one", onDataChange: () => { throw new Error("one threw"); } },
        { name: "two", onDataChange: () => void seen.push("two") },
      ],
    });
    m.edit("X");
    expect(seen).toEqual(["two"]);
    expect(reportError).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("falls back to console.error without a global reportError", () => {
    vi.stubGlobal("reportError", undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const m = mount({ onDataChange: () => { throw new Error("boom"); } });
    expect(() => m.edit("X")).not.toThrow();
    expect(error).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("updateCells and updateRows without a source", () => {
  const patches = [{ rowId: "a", columnId: "name", value: "Z" }];

  it("refuses every patch with reason no-source and warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = mount();
    const actions = m.state().actions as unknown as { updateCells: (p: unknown) => { applied: number; skipped: { reason: string }[] }; updateRows: (u: unknown) => { applied: number; skipped: { reason: string }[] } };
    const verdict = actions.updateCells(patches);
    expect(verdict).toMatchObject({ applied: 0, skipped: [{ patchIndex: 0, reason: "no-source" }] });
    expect(actions.updateRows([{ rowId: "a", changes: { name: "Z" } }]).skipped[0]!.reason).toBe("no-source");
    expect(m.name()).toBe("A");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('source: "stream"');
    expect(String(warn.mock.calls[0]![0])).toContain('source: "edit"');
  });

  it("applies with an explicit source, on a readOnly grid too for stream", () => {
    const m = mount({ readOnly: true });
    expect(m.state().actions.updateCells(patches, { source: "stream" }).applied).toBe(1);
    expect(m.name()).toBe("Z");
    expect(m.state().actions.updateCells(patches, { source: "edit" }).skipped[0]!.reason).toBe("readonly");
  });
});

describe("deleteRows with unloaded rows", () => {
  it("deletes the loaded targets and reports the skipped count", () => {
    const onRowActionSkipped = vi.fn();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = mount({ onRowActionSkipped }, sparse());
    const result = m.state().actions.deleteRowsAt(viewIndexes([0, 2]));
    expect(result).toEqual({ ok: true });
    expect(m.state().data).toHaveLength(5);
    expect(m.ids()).not.toContain("r0");
    expect(onRowActionSkipped).toHaveBeenCalledWith({ action: "deleteRows", reason: "unloaded-rows", count: 1 });
  });

  it("deleteRows by id with a placeholder id deletes the loaded id", () => {
    const m = mount({}, sparse());
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(m.state().actions.deleteRows(["r0", holeRowId(2)])).toEqual({ ok: true });
    expect(m.ids()).not.toContain("r0");
  });

  it("returns ok: false only when nothing was loaded", () => {
    const onRowActionSkipped = vi.fn();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = mount({ onRowActionSkipped }, sparse());
    expect(m.state().actions.deleteRowsAt(viewIndexes([2, 3]))).toEqual({ ok: false, reason: "unloaded-rows" });
    expect(m.state().data).toHaveLength(6);
    expect(onRowActionSkipped).toHaveBeenCalledTimes(1);
  });

  it("a fully loaded request reports nothing", () => {
    const onRowActionSkipped = vi.fn();
    const m = mount({ onRowActionSkipped }, sparse());
    m.state().actions.deleteRowsAt(viewIndexes([0, 1]));
    expect(onRowActionSkipped).not.toHaveBeenCalled();
  });
});

describe("the delete gate", () => {
  it("a second delete supersedes a stuck gate", async () => {
    const onGateAborted = vi.fn();
    const first = deferred<boolean>();
    let call = 0;
    const signals: AbortSignal[] = [];
    const m = mount({
      onGateAborted,
      onBeforeDeleteRows: ({ signal }) => {
        signals.push(signal);
        return call++ === 0 ? first.promise : Promise.resolve(true);
      },
    });
    act(() => void m.state().actions.deleteRowsAt(viewIndexes([0])));
    expect(act(() => m.state().actions.deleteRowsAt(viewIndexes([1])))).toBeDefined();
    await flush();
    expect(signals[0]!.aborted).toBe(true);
    expect(onGateAborted).toHaveBeenCalledWith({ gate: "onBeforeDeleteRows", reason: "superseded" });
    expect(m.ids()).toEqual(["a", "c"]);
    first.resolve(true);
    await flush();
    expect(m.ids()).toEqual(["a", "c"]);
  });

  it("reports gate-declined for an async false", async () => {
    const onRowActionSkipped = vi.fn();
    const m = mount({ onRowActionSkipped, onBeforeDeleteRows: () => Promise.resolve(false) });
    act(() => void m.state().actions.deleteRowsAt(viewIndexes([0])));
    await flush();
    expect(onRowActionSkipped).toHaveBeenCalledWith({ action: "deleteRows", reason: "gate-declined" });
    expect(m.ids()).toEqual(["a", "b", "c"]);
  });

  it("reports gate-threw for an async rejection", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const onRowActionSkipped = vi.fn();
    const m = mount({ onRowActionSkipped, onBeforeDeleteRows: () => Promise.reject(new Error("no")) });
    act(() => void m.state().actions.deleteRowsAt(viewIndexes([0])));
    await flush();
    expect(onRowActionSkipped).toHaveBeenCalledWith({ action: "deleteRows", reason: "gate-threw" });
  });

  it("a second insert supersedes a pending createRow, and a rejection is reported", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const onGateAborted = vi.fn();
    const onRowActionSkipped = vi.fn();
    const first = deferred<Row>();
    let call = 0;
    const m = mount({
      onGateAborted,
      onRowActionSkipped,
      createRow: (index) => (call++ === 0 ? first.promise : Promise.resolve({ id: `n${index}`, name: "N" })),
    });
    act(() => void m.state().actions.insertRow(0, "below"));
    act(() => void m.state().actions.insertRow(1, "below"));
    await flush();
    expect(onGateAborted).toHaveBeenCalledWith({ gate: "createRow", reason: "superseded" });
    expect(m.ids()).toHaveLength(4);
    first.reject(new Error("late"));
    await flush();
    const failing = mount({ onRowActionSkipped, createRow: () => Promise.reject(new Error("no")) });
    act(() => void failing.state().actions.insertRow(0, "below"));
    await flush();
    expect(onRowActionSkipped).toHaveBeenCalledWith({ action: "insertRows", reason: "gate-threw" });
  });

  it("a second duplicate supersedes a pending duplicateRow, and a rejection is reported", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const onGateAborted = vi.fn();
    const onRowActionSkipped = vi.fn();
    const first = deferred<Row>();
    let call = 0;
    const m = mount({
      onGateAborted,
      onRowActionSkipped,
      duplicateRow: (row) => (call++ === 0 ? first.promise : Promise.resolve({ ...(row as Row), id: `${(row as Row).id}2` })),
    });
    act(() => void m.state().actions.duplicateRowsAt(viewIndexes([0])));
    act(() => void m.state().actions.duplicateRowsAt(viewIndexes([1])));
    await flush();
    expect(onGateAborted).toHaveBeenCalledWith({ gate: "duplicateRow", reason: "superseded" });
    expect(m.ids()).toHaveLength(4);
    const failing = mount({ onRowActionSkipped, duplicateRow: () => Promise.reject(new Error("no")) });
    act(() => void failing.state().actions.duplicateRowsAt(viewIndexes([0])));
    await flush();
    expect(onRowActionSkipped).toHaveBeenCalledWith({ action: "duplicateRows", reason: "gate-threw" });
  });
});

describe("applyCellUpdates with an async schema", () => {
  it("defers the write by one tick and applies it after the schema settles", async () => {
    const asyncColumns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name", validate: { "~standard": { version: 1, vendor: "test", validate: async (value: unknown) => ({ value }) } } as never }];
    let api: StoreApi<DataGridStoreState> | null = null;
    function Probe() {
      api = useDataGridStoreApi();
      return null;
    }
    render(
      <DataGridProvider columns={asyncColumns} getRowId={(row: Row) => row.id} defaultData={dense()}>
        <Probe />
      </DataGridProvider>,
    );
    const name = () => (api!.getState().data as Row[])[0]!.name;
    api!.getState().actions.applyCellUpdates([{ viewRowIndex: 0, columnId: "name", value: "Z" }], "paste");
    expect(name()).toBe("A");
    await flush();
    expect(name()).toBe("Z");
  });

  it("a synchronous schema applies at once", () => {
    const m = mount();
    act(() => m.state().actions.applyCellUpdates([{ viewRowIndex: 0, columnId: "name", value: "Z" }], "paste"));
    expect(m.name()).toBe("Z");
  });
});

export type { DataChange };
