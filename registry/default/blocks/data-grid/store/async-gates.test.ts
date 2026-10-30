import { afterEach, describe, expect, it, vi } from "vitest";
import { createDataGridStore } from "./create-store";
import { getInternalActions } from "./internal-actions";
import type { InternalSyncProps } from "./types";

type Row = { id: string; name: string };

const columns = [{ id: "name", header: "Name", accessorKey: "name" }];
const rows = (ids = ["a", "b", "c"]): Row[] => ids.map((id) => ({ id, name: id.toUpperCase() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve));
const warnings = () => vi.spyOn(console, "warn").mockImplementation(() => {});

function mount(overrides: Partial<InternalSyncProps> = {}) {
  const base = { data: rows(), columns, getRowId: (row: unknown) => (row as Row).id, ...overrides } as InternalSyncProps;
  const store = createDataGridStore(base);
  return {
    store,
    state: () => store.getState(),
    ids: () => store.getState().data.map((row) => (row as Row).id),
    sync: (next: Partial<InternalSyncProps>) => {
      getInternalActions(store)._syncConfig({ ...base, ...next } as InternalSyncProps);
      getInternalActions(store)._syncProps({ ...base, ...next } as InternalSyncProps);
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("validateRow async", () => {
  const edit = (m: ReturnType<typeof mount>, value: string, rowId = "a") => m.state().actions.updateCells([{ rowId, columnId: "name", value }]);

  it("sync verdict still lands in the same commit", () => {
    const m = mount({ validateRow: () => ({ name: "bad" }) });
    edit(m, "x");
    expect(m.state().cellErrors.get("a:name")).toBe("bad");
  });

  it("an async verdict leaves the write alone and merges its errors on settle", async () => {
    const d = deferred<Record<string, string> | null>();
    const m = mount({ validateRow: () => d.promise });
    edit(m, "x");
    expect((m.state().data[0] as Row).name).toBe("x");
    expect(m.state().cellErrors.size).toBe(0);
    d.resolve({ name: "taken" });
    await settle();
    expect(m.state().cellErrors.get("a:name")).toBe("taken");
  });

  it("a null verdict clears the row's earlier async errors", async () => {
    const verdicts = [Promise.resolve({ name: "taken" }), Promise.resolve(null)];
    const m = mount({ validateRow: () => verdicts.shift()! });
    edit(m, "x");
    await settle();
    expect(m.state().cellErrors.size).toBe(1);
    edit(m, "y");
    await settle();
    expect(m.state().cellErrors.size).toBe(0);
  });

  it("a newer write to the same row supersedes a pending verdict", async () => {
    const first = deferred<Record<string, string> | null>();
    const second = deferred<Record<string, string> | null>();
    const queue = [first, second];
    const m = mount({ validateRow: () => queue.shift()!.promise });
    edit(m, "x");
    edit(m, "y");
    second.resolve(null);
    await settle();
    first.resolve({ name: "stale" });
    await settle();
    expect(m.state().cellErrors.size).toBe(0);
  });

  it("a rejection adds no error, keeps the write, and warns once", async () => {
    const warn = warnings();
    const m = mount({ validateRow: () => Promise.reject(new Error("boom")) });
    edit(m, "x");
    edit(m, "y");
    await settle();
    expect((m.state().data[0] as Row).name).toBe("y");
    expect(m.state().cellErrors.size).toBe(0);
    expect(warn.mock.calls.filter(([message]) => String(message).includes("validateRow rejected"))).toHaveLength(1);
  });

  it("drops the verdict when the row is gone, and keeps it when the consumer re-created the row", async () => {
    const gone = deferred<Record<string, string> | null>();
    const recreated = deferred<Record<string, string> | null>();
    const queue = [gone, recreated];
    const m = mount({ validateRow: () => queue.shift()!.promise });
    edit(m, "x", "a");
    edit(m, "y", "b");
    m.sync({ data: [{ id: "b", name: "fresh" }, { id: "c", name: "C" }] });
    gone.resolve({ name: "late" });
    recreated.resolve({ name: "kept" });
    await settle();
    expect(Array.from(m.state().cellErrors.keys())).toEqual(["b:name"]);
  });

  it("does not reorder the view when it settles under sortMode=\"server\"", async () => {
    const d = deferred<Record<string, string> | null>();
    const m = mount({ sortMode: "server", sortState: [{ columnId: "name", direction: "desc" }] as never, validateRow: () => d.promise });
    edit(m, "x");
    const before = m.state().viewIndex;
    d.resolve({ name: "bad" });
    await settle();
    expect(m.state().viewIndex).toBe(before);
    expect(m.ids()).toEqual(["a", "b", "c"]);
  });

  it("fires one onDataChange per gesture in controlled mode", async () => {
    const onDataChange = vi.fn();
    const m = mount({ onDataChange, validateRow: () => Promise.resolve({ name: "bad" }) });
    edit(m, "x");
    await settle();
    expect(onDataChange).toHaveBeenCalledTimes(1);
  });
});

describe("onEditStart async", () => {
  it("a sync result opens the editor in the same tick", () => {
    const m = mount({ onEditStart: () => true });
    m.state().actions.startEditingAt({ row: 0, col: 0 });
    expect(m.state().editing?.rowId).toBe("a");
  });

  it("a sync false vetoes", () => {
    const m = mount({ onEditStart: () => false });
    m.state().actions.startEditingAt({ row: 0, col: 0 });
    expect(m.state().editing).toBeNull();
  });

  it("holds the editor until an async true settles, and keeps the initial text", async () => {
    const d = deferred<boolean>();
    const m = mount({ onEditStart: () => d.promise });
    m.state().actions.startEditingAt({ row: 1, col: 0 }, "z");
    expect(m.state().editing).toBeNull();
    d.resolve(true);
    await settle();
    expect(m.state().editing).toMatchObject({ rowId: "b", columnId: "name", initialText: "z" });
  });

  it("an async false or void keeps veto semantics", async () => {
    const results = [Promise.resolve(false), Promise.resolve(undefined)];
    const m = mount({ onEditStart: () => results.shift()! });
    m.state().actions.startEditingAt({ row: 0, col: 0 });
    await settle();
    expect(m.state().editing).toBeNull();
    m.state().actions.startEditingAt({ row: 0, col: 0 });
    await settle();
    expect(m.state().editing?.rowId).toBe("a");
  });

  it("a pending promise ignores a second request", async () => {
    const d = deferred<boolean>();
    const onEditStart = vi.fn(() => d.promise);
    const m = mount({ onEditStart });
    m.state().actions.startEditingAt({ row: 0, col: 0 });
    m.state().actions.startEditingAt({ row: 1, col: 0 });
    m.state().actions.startEditingAt({ row: 2, col: 0 });
    expect(onEditStart).toHaveBeenCalledTimes(1);
    d.resolve(true);
    await settle();
    expect(m.state().editing?.rowId).toBe("a");
  });

  it("a rejection cancels, warns, and leaves the gate usable", async () => {
    const warn = warnings();
    const results = [Promise.reject(new Error("down")), Promise.resolve(true)];
    const m = mount({ onEditStart: () => results.shift()! });
    m.state().actions.startEditingAt({ row: 0, col: 0 });
    await settle();
    expect(m.state().editing).toBeNull();
    expect(warn.mock.calls.some(([message]) => String(message).includes("onEditStart rejected"))).toBe(true);
    m.state().actions.startEditingAt({ row: 0, col: 0 });
    await settle();
    expect(m.state().editing?.rowId).toBe("a");
  });

  it("drops a late result when the user moved on, the grid went readOnly, or the row is gone", async () => {
    const moved = deferred<boolean>();
    const m = mount({ onEditStart: () => moved.promise });
    m.state().actions.selectCellAt({ row: 0, col: 0 });
    m.state().actions.startEditingAt({ row: 0, col: 0 });
    m.state().actions.selectCellAt({ row: 2, col: 0 });
    moved.resolve(true);
    await settle();
    expect(m.state().editing).toBeNull();

    const ro = deferred<boolean>();
    const m2 = mount({ onEditStart: () => ro.promise });
    m2.state().actions.startEditingAt({ row: 0, col: 0 });
    m2.sync({ readOnly: true });
    ro.resolve(true);
    await settle();
    expect(m2.state().editing).toBeNull();

    const del = deferred<boolean>();
    const m3 = mount({ onEditStart: () => del.promise });
    m3.state().actions.startEditingAt({ row: 0, col: 0 });
    m3.sync({ data: rows(["b", "c"]) });
    del.resolve(true);
    await settle();
    expect(m3.state().editing).toBeNull();
  });

  it("opens on the cell's current view position after a reorder", async () => {
    const d = deferred<boolean>();
    const m = mount({ onEditStart: () => d.promise });
    m.state().actions.startEditingAt({ row: 0, col: 0 });
    m.sync({ data: rows(["c", "a", "b"]) });
    d.resolve(true);
    await settle();
    expect(m.state().editing).toMatchObject({ rowId: "a", coord: { row: 1, col: 0 } });
  });
});

describe("createRow async", () => {
  const create = (index: number): Row => ({ id: `new-${index}`, name: "N" });

  it("a sync factory inserts in the same tick", () => {
    const m = mount({ createRow: create });
    m.state().actions.insertRow(0, "below");
    expect(m.ids()).toEqual(["a", "new-1", "b", "c"]);
  });

  it("holds the insert until the promise settles, then writes once", async () => {
    const onDataChange = vi.fn();
    const d = deferred<Row>();
    const m = mount({ createRow: () => d.promise, onDataChange });
    m.state().actions.insertRow(1, "below");
    expect(m.ids()).toEqual(["a", "b", "c"]);
    d.resolve({ id: "x", name: "X" });
    await settle();
    expect(m.ids()).toEqual(["a", "b", "x", "c"]);
    expect(onDataChange).toHaveBeenCalledTimes(1);
  });

  it("builds several rows with a mix of sync and async results", async () => {
    const m = mount({ createRow: (i) => (i % 2 === 0 ? Promise.resolve({ id: `p${i}`, name: "P" }) : { id: `s${i}`, name: "S" }) });
    m.state().actions.insertRows(0, 3, "below");
    await settle();
    expect(m.ids()).toEqual(["a", "s1", "p2", "s3", "b", "c"]);
  });

  it("a pending promise blocks a second insert and warns once", async () => {
    const warn = warnings();
    const d = deferred<Row>();
    const createRow = vi.fn(() => d.promise);
    const m = mount({ createRow });
    m.state().actions.insertRow(0, "below");
    m.state().actions.insertRow(0, "below");
    m.state().actions.insertRow(0, "below");
    expect(createRow).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.filter(([message]) => String(message).includes("createRow"))).toHaveLength(1);
    d.resolve({ id: "x", name: "X" });
    await settle();
    expect(m.ids()).toEqual(["a", "x", "b", "c"]);
  });

  it("a rejection writes nothing and leaves the gate usable", async () => {
    const warn = warnings();
    const results: Promise<Row>[] = [Promise.reject(new Error("down")), Promise.resolve({ id: "x", name: "X" })];
    const m = mount({ createRow: () => results.shift()! });
    m.state().actions.insertRow(0, "below");
    await settle();
    expect(m.ids()).toEqual(["a", "b", "c"]);
    expect(warn.mock.calls.some(([message]) => String(message).includes("createRow rejected"))).toBe(true);
    m.state().actions.insertRow(0, "below");
    await settle();
    expect(m.ids()).toEqual(["a", "x", "b", "c"]);
  });

  it("drops the result when the grid went readOnly or the anchor row is gone, and follows a reorder", async () => {
    const ro = deferred<Row>();
    const m = mount({ createRow: () => ro.promise });
    m.state().actions.insertRow(0, "below");
    m.sync({ readOnly: true });
    ro.resolve({ id: "x", name: "X" });
    await settle();
    expect(m.ids()).toEqual(["a", "b", "c"]);

    const gone = deferred<Row>();
    const m2 = mount({ createRow: () => gone.promise });
    m2.state().actions.insertRow(1, "below");
    m2.sync({ data: rows(["a", "c"]) });
    gone.resolve({ id: "x", name: "X" });
    await settle();
    expect(m2.ids()).toEqual(["a", "c"]);

    const moved = deferred<Row>();
    const m3 = mount({ createRow: () => moved.promise });
    m3.state().actions.insertRow(0, "below");
    m3.sync({ data: rows(["c", "b", "a"]) });
    moved.resolve({ id: "x", name: "X" });
    await settle();
    expect(m3.ids()).toEqual(["c", "b", "a", "x"]);
  });

  it("does not reorder rows locally under sortMode=\"server\"", async () => {
    const d = deferred<Row>();
    const m = mount({ sortMode: "server", sortState: [{ columnId: "name", direction: "desc" }] as never, createRow: () => d.promise });
    m.state().actions.insertRow(0, "below");
    d.resolve({ id: "x", name: "A" });
    await settle();
    expect(m.ids()).toEqual(["a", "x", "b", "c"]);
    expect(Array.from(m.state().viewIndex)).toEqual([0, 1, 2, 3]);
  });
});

describe("duplicateRow async", () => {
  const duplicate = (row: unknown, index: number): Row => ({ id: `${(row as Row).id}-copy${index}`, name: (row as Row).name });

  it("a sync factory duplicates in the same tick, with the same arguments as before", () => {
    const duplicateRow = vi.fn(duplicate);
    const m = mount({ duplicateRow });
    m.state().actions.duplicateRows([0, 2]);
    expect(duplicateRow.mock.calls.map(([row, index]) => [(row as Row).id, index])).toEqual([["c", 3], ["a", 1]]);
    expect(m.ids()).toEqual(["a", "a-copy1", "b", "c", "c-copy3"]);
  });

  it("holds until every copy settles, then writes once", async () => {
    const onDataChange = vi.fn();
    const m = mount({ duplicateRow: (row) => Promise.resolve({ id: `${(row as Row).id}2`, name: (row as Row).name }), onDataChange });
    m.state().actions.duplicateRows([0, 1]);
    expect(m.ids()).toEqual(["a", "b", "c"]);
    await settle();
    expect(m.ids()).toEqual(["a", "a2", "b", "b2", "c"]);
    expect(onDataChange).toHaveBeenCalledTimes(1);
  });

  it("a pending promise blocks a second request and warns once", async () => {
    const warn = warnings();
    const d = deferred<Row>();
    const duplicateRow = vi.fn(() => d.promise);
    const m = mount({ duplicateRow });
    m.state().actions.duplicateRows([0]);
    m.state().actions.duplicateRows([1]);
    m.state().actions.duplicateRows([2]);
    expect(duplicateRow).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.filter(([message]) => String(message).includes("duplicateRow"))).toHaveLength(1);
    d.resolve({ id: "x", name: "X" });
    await settle();
    expect(m.ids()).toEqual(["a", "x", "b", "c"]);
  });

  it("a rejection writes nothing and leaves the gate usable", async () => {
    warnings();
    const results: Promise<Row>[] = [Promise.reject(new Error("down")), Promise.resolve({ id: "x", name: "X" })];
    const m = mount({ duplicateRow: () => results.shift()! });
    m.state().actions.duplicateRows([0]);
    await settle();
    expect(m.ids()).toEqual(["a", "b", "c"]);
    m.state().actions.duplicateRows([0]);
    await settle();
    expect(m.ids()).toEqual(["a", "x", "b", "c"]);
  });

  it("drops the result when readOnly, and skips a source row that is gone", async () => {
    const ro = deferred<Row>();
    const m = mount({ duplicateRow: () => ro.promise });
    m.state().actions.duplicateRows([0]);
    m.sync({ readOnly: true });
    ro.resolve({ id: "x", name: "X" });
    await settle();
    expect(m.ids()).toEqual(["a", "b", "c"]);

    const m2 = mount({ duplicateRow: (row) => Promise.resolve({ id: `${(row as Row).id}2`, name: (row as Row).name }) });
    m2.state().actions.duplicateRows([0, 1]);
    m2.sync({ data: rows(["b", "c"]) });
    await settle();
    expect(m2.ids()).toEqual(["b", "b2", "c"]);
  });
});
