import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef, DataChange } from "../types";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState, type DataGridSyncProps } from ".";
import type { WriteAck, WriteRejection } from "./write-ack";

type Row = { id: string; name: string; note: string };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "note", header: "Note", accessorKey: "note" },
];

const initial = (): Row[] => [
  { id: "a", name: "A", note: "a" },
  { id: "b", name: "B", note: "b" },
  { id: "c", name: "C", note: "c" },
];

type Handler = (next: readonly Row[], change: DataChange<Row>) => void | Promise<WriteAck>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function mount(onDataChange: Handler, props: Partial<DataGridSyncProps<Row>> = {}) {
  let api: StoreApi<DataGridStoreState> | null = null;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  const tree = (next: Partial<DataGridSyncProps<Row>>) => (
    <DataGridProvider columns={columns} getRowId={(row: Row) => row.id} defaultData={initial()} onDataChange={onDataChange as never} {...next}>
      <Probe />
    </DataGridProvider>
  );
  const view = render(tree(props));
  const state = () => api!.getState();
  return {
    state,
    rerender: (next: Partial<DataGridSyncProps<Row>>) => view.rerender(tree(next)),
    unmount: () => view.unmount(),
    edit: (rowId: string, columnId: string, value: unknown) => act(() => state().actions.commitCellValue({ rowId, columnId }, value)),
    value: (rowId: string, field: "name" | "note") => (state().data as Row[]).find((r) => r.id === rowId)![field],
    status: (rowId: string) => state().writeStatus.get(rowId),
  };
}

const flush = () => act(async () => {});

afterEach(() => vi.restoreAllMocks());

describe("write acknowledgement", () => {
  it("a void onDataChange behaves as before: no status, no pending count", () => {
    const m = mount(() => {});
    m.edit("a", "name", "X");
    expect(m.value("a", "name")).toBe("X");
    expect(m.state().writeStatus.size).toBe(0);
    expect(m.state().pendingWriteCount).toBe(0);
  });

  it("marks the row saving while the promise is pending, and clears it on success", async () => {
    const d = deferred<WriteAck>();
    const m = mount(() => d.promise);
    m.edit("a", "name", "X");
    expect(m.status("a")).toBe("saving");
    expect(m.state().pendingWriteCount).toBe(1);
    d.resolve(undefined);
    await flush();
    expect(m.status("a")).toBeUndefined();
    expect(m.state().pendingWriteCount).toBe(0);
    expect(m.value("a", "name")).toBe("X");
  });

  it("a partial rejection reverts only the named row and marks it failed", async () => {
    const d = deferred<WriteAck>();
    const onWriteRejected = vi.fn();
    const m = mount(() => d.promise, { onWriteRejected });
    act(() =>
      m.state().actions.updateCells([
        { rowId: "a", columnId: "name", value: "X" },
        { rowId: "b", columnId: "name", value: "Y" },
      ]),
    );
    d.resolve({ rejected: [{ rowId: "b", message: "taken" }] });
    await flush();
    expect(m.value("a", "name")).toBe("X");
    expect(m.value("b", "name")).toBe("B");
    expect(m.status("a")).toBeUndefined();
    expect(m.status("b")).toBe("failed");
    expect(onWriteRejected).toHaveBeenCalledTimes(1);
    expect(onWriteRejected.mock.calls[0]![0].rejected).toEqual([{ rowId: "b", message: "taken" }]);
  });

  it("a cell-level rejection reverts only that column", async () => {
    const d = deferred<WriteAck>();
    const m = mount(() => d.promise);
    act(() =>
      m.state().actions.updateCells([
        { rowId: "a", columnId: "name", value: "X" },
        { rowId: "a", columnId: "note", value: "N" },
      ]),
    );
    d.resolve({ rejected: [{ rowId: "a", columnId: "note" }] });
    await flush();
    expect(m.value("a", "name")).toBe("X");
    expect(m.value("a", "note")).toBe("a");
  });

  it("a rejected promise refuses the whole change and passes the error message", async () => {
    const d = deferred<WriteAck>();
    const onWriteRejected = vi.fn();
    const m = mount(() => d.promise, { onWriteRejected });
    act(() =>
      m.state().actions.updateCells([
        { rowId: "a", columnId: "name", value: "X" },
        { rowId: "b", columnId: "name", value: "Y" },
      ]),
    );
    d.reject(new Error("offline"));
    await flush();
    expect(m.value("a", "name")).toBe("A");
    expect(m.value("b", "name")).toBe("B");
    const rejected = onWriteRejected.mock.calls[0]![0].rejected as WriteRejection[];
    expect(rejected.map((r) => r.rowId).sort()).toEqual(["a", "b"]);
    expect(rejected[0]!.message).toBe("offline");
  });

  it("a newer write to the same cell while pending supersedes the earlier verdict", async () => {
    const first = deferred<WriteAck>();
    const second = deferred<WriteAck>();
    const queue = [first, second];
    const m = mount(() => queue.shift()!.promise);
    m.edit("a", "name", "X");
    m.edit("a", "name", "Z");
    first.resolve({ rejected: [{ rowId: "a" }] });
    await flush();
    expect(m.value("a", "name")).toBe("Z");
    expect(m.status("a")).toBe("saving");
    second.resolve(undefined);
    await flush();
    expect(m.status("a")).toBeUndefined();
  });

  it("keeps a row saving until every pending change of it settles", async () => {
    const first = deferred<WriteAck>();
    const second = deferred<WriteAck>();
    const queue = [first, second];
    const m = mount(() => queue.shift()!.promise);
    m.edit("a", "name", "X");
    m.edit("a", "note", "N");
    first.resolve(undefined);
    await flush();
    expect(m.status("a")).toBe("saving");
    expect(m.state().pendingWriteCount).toBe(1);
    second.resolve(undefined);
    await flush();
    expect(m.status("a")).toBeUndefined();
  });

  it("a revert is one rollback change that is never acknowledged", async () => {
    const d = deferred<WriteAck>();
    const changes: DataChange<Row>[] = [];
    const m = mount((_next, change) => {
      changes.push(change);
      return change.source === "rollback" ? (Promise.resolve({ rejected: [{ rowId: "a" }] }) as Promise<WriteAck>) : d.promise;
    });
    m.edit("a", "name", "X");
    d.resolve({ rejected: [{ rowId: "a" }] });
    await flush();
    const rollbacks = changes.filter((c) => c.source === "rollback");
    expect(rollbacks).toHaveLength(1);
    expect(rollbacks[0]!.reverts).toBe(changes[0]);
    expect(m.state().pendingWriteCount).toBe(0);
    expect(m.value("a", "name")).toBe("A");
  });

  it("a rejected row insert is removed again, a rejected delete comes back", async () => {
    const insert = deferred<WriteAck>();
    const m = mount(() => insert.promise, { createRow: () => ({ id: "n", name: "N", note: "n" }) });
    act(() => m.state().actions.insertRow(0, "below"));
    expect(m.state().data).toHaveLength(4);
    insert.resolve({ rejected: [{ rowId: "n" }] });
    await flush();
    expect(m.state().data).toHaveLength(3);

    const del = deferred<WriteAck>();
    const m2 = mount(() => del.promise);
    act(() => m2.state().actions.deleteRows([1]));
    expect(m2.state().data).toHaveLength(2);
    del.resolve({ rejected: [{ rowId: "b" }] });
    await flush();
    expect((m2.state().data as Row[]).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("clears the cell errors of a reverted cell in the same step", async () => {
    const d = deferred<WriteAck>();
    const m = mount(() => d.promise);
    m.edit("a", "name", "X");
    act(() => m.state().actions.setCellErrors([{ rowId: "a", columnId: "name", message: "bad" }] as never));
    d.resolve({ rejected: [{ rowId: "a", columnId: "name" }] });
    await flush();
    expect(m.state().cellErrors.size).toBe(0);
  });

  it("skips the revert on a readOnly grid, warns once, and still marks the row failed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const d = deferred<WriteAck>();
    const m = mount(() => d.promise);
    m.edit("a", "name", "X");
    m.rerender({ readOnly: true });
    d.resolve({ rejected: [{ rowId: "a" }] });
    await flush();
    expect(m.value("a", "name")).toBe("X");
    expect(m.status("a")).toBe("failed");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("a throwing onWriteRejected does not break the settle", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deferred<WriteAck>();
    const m = mount(() => d.promise, {
      onWriteRejected: () => {
        throw new Error("toast failed");
      },
    });
    m.edit("a", "name", "X");
    d.resolve({ rejected: [{ rowId: "a" }] });
    await flush();
    expect(m.value("a", "name")).toBe("A");
    expect(m.status("a")).toBe("failed");
  });

  it("a new write to a failed row clears its failed mark", async () => {
    const first = deferred<WriteAck>();
    const m = mount(() => first.promise);
    m.edit("a", "name", "X");
    first.resolve({ rejected: [{ rowId: "a" }] });
    await flush();
    expect(m.status("a")).toBe("failed");
    const next = deferred<WriteAck>();
    const m2 = mount(() => next.promise);
    m2.edit("a", "name", "Q");
    expect(m2.status("a")).toBe("saving");
  });

  it("clearWriteStatus drops the failed marks and keeps saving ones", async () => {
    const first = deferred<WriteAck>();
    const second = deferred<WriteAck>();
    const queue = [first, second];
    const m = mount((_next, change) => (change.source === "rollback" ? undefined : queue.shift()!.promise));
    m.edit("a", "name", "X");
    m.edit("b", "name", "Y");
    first.resolve({ rejected: [{ rowId: "a" }] });
    await flush();
    act(() => m.state().actions.clearWriteStatus());
    expect(m.status("a")).toBeUndefined();
    expect(m.status("b")).toBe("saving");
  });

  it("ignores the rejections beyond the bound", async () => {
    const d = deferred<WriteAck>();
    const onWriteRejected = vi.fn();
    const m = mount(() => d.promise, { onWriteRejected });
    m.edit("a", "name", "X");
    d.resolve({ rejected: Array.from({ length: 10_050 }, (_, i) => ({ rowId: i === 0 ? "a" : `ghost${i}` })) });
    await flush();
    expect((onWriteRejected.mock.calls[0]![0].rejected as unknown[]).length).toBe(10_000);
  });
});

describe("write acknowledgement: refusals in sequence", () => {
  it("two refused writes to one cell end at the original value", async () => {
    const first = deferred<WriteAck>();
    const second = deferred<WriteAck>();
    const queue = [first, second];
    const m = mount((_next, change) => (change.source === "rollback" ? undefined : queue.shift()!.promise));
    m.edit("a", "name", "X");
    m.edit("a", "name", "Z");
    first.resolve({ rejected: [{ rowId: "a" }] });
    await flush();
    second.resolve({ rejected: [{ rowId: "a" }] });
    await flush();
    expect(m.value("a", "name")).toBe("A");
  });

  it("a refusal after an accepted write does not revert past it", async () => {
    const w1 = deferred<WriteAck>();
    const w2 = deferred<WriteAck>();
    const w3 = deferred<WriteAck>();
    const queue = [w1, w2, w3];
    const m = mount((_next, change) => (change.source === "rollback" ? undefined : queue.shift()!.promise));
    m.edit("a", "name", "X");
    w1.resolve({ rejected: [{ rowId: "a" }] });
    await flush();
    expect(m.value("a", "name")).toBe("A");
    m.edit("a", "name", "X");
    w2.resolve(undefined);
    await flush();
    m.edit("a", "name", "Q");
    w3.resolve({ rejected: [{ rowId: "a" }] });
    await flush();
    expect(m.value("a", "name")).toBe("X");
  });

  it("a refused insert leaves no remembered checked id", async () => {
    const d = deferred<WriteAck>();
    const m = mount((_next, change) => (change.source === "rollback" ? undefined : d.promise), {
      createRow: () => ({ id: "n", name: "N", note: "n" }),
      keepCheckedRows: true,
      totalRowCount: 9,
    });
    act(() => m.state().actions.insertRow(0, "below"));
    act(() => m.state().actions.setRowSelected(1, true));
    d.resolve({ rejected: [{ rowId: "n" }] });
    await flush();
    expect(m.state().hiddenCheckedRowIds.has("n")).toBe(false);
  });

  it("a late ack after unmount does not revert", async () => {
    const d = deferred<WriteAck>();
    const onWriteRejected = vi.fn();
    const m = mount(() => d.promise, { onWriteRejected });
    m.edit("a", "name", "X");
    const state = m.state;
    m.unmount();
    d.resolve({ rejected: [{ rowId: "a" }] });
    await flush();
    expect(state().data.find((r) => (r as Row).id === "a")).toMatchObject({ name: "X" });
    expect(onWriteRejected).not.toHaveBeenCalled();
  });
});
