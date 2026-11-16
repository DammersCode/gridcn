import { afterEach, describe, expect, it, vi } from "vitest";
import { createDataGridStore } from "../store/create-store";
import { getInternalActions } from "../store/internal-actions";
import type { InternalSyncProps } from "../store/types";
import { isBulkBatchCurrent, reresolveBulkWrites, type BulkGeneration } from "../validation/bulk-generation";
import { MAX_PASTE_CELLS, pasteText } from "./use-grid-clipboard";

type Row = { id: string; name: string; note: string };

const columns = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "note", header: "Note", accessorKey: "note" },
];
const rows = (ids = ["a", "b", "c"]): Row[] => ids.map((id) => ({ id, name: id.toUpperCase(), note: "" }));

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

function mount(overrides: Partial<InternalSyncProps> = {}) {
  const base = { data: rows(), columns, getRowId: (row: unknown) => (row as Row).id, ...overrides } as InternalSyncProps;
  const store = createDataGridStore(base);
  let generation = 0;
  const guard: BulkGeneration = {
    begin: () => ++generation,
    isCurrent: (token, s, snapshot) => generation === token && isBulkBatchCurrent(s, snapshot),
    reresolve: reresolveBulkWrites,
  };
  store.getState().actions.selectCellAt({ col: 0, row: 0 });
  return {
    store,
    paste: (text: string) => pasteText(store.getState(), store.getState().actions, text, guard, store),
    names: () => store.getState().data.map((row) => (row as Row).name),
    sync: (next: Partial<InternalSyncProps>) => {
      getInternalActions(store)._syncConfig({ ...base, ...next } as InternalSyncProps);
      getInternalActions(store)._syncProps({ ...base, ...next } as InternalSyncProps);
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("processPaste async", () => {
  it("a sync result writes in the same tick", () => {
    const m = mount({ processPaste: ({ cells }) => cells.map((r) => r.map((c) => c.toLowerCase())) });
    m.paste("X\nY");
    expect(m.names()).toEqual(["x", "y", "C"]);
  });

  it("a sync false vetoes", () => {
    const m = mount({ processPaste: () => false });
    expect(m.paste("X")).toBe(false);
    expect(m.names()).toEqual(["A", "B", "C"]);
  });

  it("holds the paste until the promise settles, then writes one change", async () => {
    const onDataChange = vi.fn();
    const d = deferred<string[][] | false>();
    const m = mount({ processPaste: () => d.promise, onDataChange });
    expect(m.paste("raw")).toBe(true);
    expect(m.names()).toEqual(["A", "B", "C"]);
    d.resolve([["server"]]);
    await settle();
    expect(m.names()).toEqual(["server", "B", "C"]);
    expect(onDataChange).toHaveBeenCalledTimes(1);
  });

  it("an async false vetoes", async () => {
    const m = mount({ processPaste: () => Promise.resolve(false) });
    m.paste("raw");
    await settle();
    expect(m.names()).toEqual(["A", "B", "C"]);
  });

  it("caps an async result that re-expands past MAX_PASTE_CELLS", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const big = Array.from({ length: MAX_PASTE_CELLS + 50 }, (_, i) => [`v${i}`]);
    const m = mount({ data: rows(Array.from({ length: MAX_PASTE_CELLS + 100 }, (_, i) => `r${i}`)), processPaste: () => Promise.resolve(big) });
    m.paste("raw");
    await settle();
    expect(m.names()[MAX_PASTE_CELLS - 1]).toBe(`v${MAX_PASTE_CELLS - 1}`);
    expect(m.names()[MAX_PASTE_CELLS]).toBe(`R${MAX_PASTE_CELLS}`);
  });

  it("a newer paste supersedes a pending one: its signal aborts and only the newer paste lands", async () => {
    const first = deferred<string[][]>();
    const second = deferred<string[][]>();
    const signals: AbortSignal[] = [];
    const pending = [first.promise, second.promise];
    const onGateAborted = vi.fn();
    const m = mount({ processPaste: ({ signal }) => (signals.push(signal), pending.shift()!), onGateAborted });
    expect(m.paste("one")).toBe(true);
    expect(m.paste("two")).toBe(true);
    expect(signals[0]!.aborted).toBe(true);
    expect(onGateAborted).toHaveBeenCalledWith({ gate: "processPaste", reason: "superseded" });
    first.resolve([["one"]]);
    second.resolve([["two"]]);
    await settle();
    expect(m.names()).toEqual(["two", "B", "C"]);
  });

  it("a processPaste rejection without a string form cancels the paste", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = mount({ processPaste: () => Promise.reject(Object.create(null)) });
    m.paste("raw");
    await settle();
    expect(m.names()).toEqual(["A", "B", "C"]);
  });

  it("a rejection writes nothing, warns, and leaves the pipeline usable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const results: Promise<string[][]>[] = [Promise.reject(new Error("down")), Promise.resolve([["ok"]])];
    const m = mount({ processPaste: () => results.shift()! });
    m.paste("raw");
    await settle();
    expect(m.names()).toEqual(["A", "B", "C"]);
    expect(warn.mock.calls.some(([message]) => String(message).includes("processPaste rejected"))).toBe(true);
    m.paste("raw");
    await settle();
    expect(m.names()).toEqual(["ok", "B", "C"]);
  });

  it("a sync throw propagates and leaves nothing held", () => {
    const calls = [() => { throw new Error("sync"); }, () => [["ok"]]];
    const m = mount({ processPaste: () => calls.shift()!() });
    expect(() => m.paste("raw")).toThrow("sync");
    m.paste("raw");
    expect(m.names()).toEqual(["ok", "B", "C"]);
  });

  it("drops a late result when readOnly, the rows were replaced, or the anchor row is gone", async () => {
    const ro = deferred<string[][]>();
    const m = mount({ processPaste: () => ro.promise });
    m.paste("raw");
    m.sync({ readOnly: true });
    ro.resolve([["late"]]);
    await settle();
    expect(m.names()).toEqual(["A", "B", "C"]);

    const gone = deferred<string[][]>();
    const m2 = mount({ processPaste: () => gone.promise });
    m2.paste("raw");
    m2.sync({ data: rows(["b", "c"]) });
    gone.resolve([["late"]]);
    await settle();
    expect(m2.names()).toEqual(["B", "C"]);
  });

  it("writes onto the anchor row after a reorder, and drops when a sort or filter changed", async () => {
    const moved = deferred<string[][]>();
    const m = mount({ processPaste: () => moved.promise });
    m.paste("raw");
    m.sync({ data: rows(["c", "b", "a"]) });
    moved.resolve([["late"]]);
    await settle();
    expect(m.names()).toEqual(["C", "B", "late"]);

    const sorted = deferred<string[][]>();
    const m2 = mount({ processPaste: () => sorted.promise });
    m2.paste("raw");
    m2.store.getState().actions.setSorts([{ columnId: "name", direction: "desc" }] as never);
    sorted.resolve([["late"]]);
    await settle();
    expect(m2.names()).toEqual(["A", "B", "C"]);
  });

  it("does not reorder rows locally under sortMode=\"server\"", async () => {
    const d = deferred<string[][]>();
    const m = mount({ sortMode: "server", sortState: [{ columnId: "name", direction: "desc" }] as never, processPaste: () => d.promise });
    m.paste("raw");
    d.resolve([["zzz"]]);
    await settle();
    expect(m.names()).toEqual(["zzz", "B", "C"]);
    expect(Array.from(m.store.getState().viewIndex)).toEqual([0, 1, 2]);
  });

  it("a newer paste after the first settled still works (no stuck lock after success)", async () => {
    const m = mount({ processPaste: ({ cells }) => Promise.resolve(cells) });
    m.paste("one");
    await settle();
    m.paste("two");
    await settle();
    expect(m.names()).toEqual(["two", "B", "C"]);
  });
});

describe("processCellFromClipboard async", () => {
  it("a sync parser writes in the same tick", () => {
    const m = mount({ processCellFromClipboard: (text) => text.toUpperCase() });
    m.paste("x");
    expect(m.names()).toEqual(["X", "B", "C"]);
  });

  it("holds the paste until every cell promise settles, then writes one change", async () => {
    const onDataChange = vi.fn();
    const m = mount({ processCellFromClipboard: (text) => Promise.resolve(`srv-${text}`), onDataChange });
    m.paste("a\nb");
    expect(m.names()).toEqual(["A", "B", "C"]);
    await settle();
    expect(m.names()).toEqual(["srv-a", "srv-b", "C"]);
    expect(onDataChange).toHaveBeenCalledTimes(1);
  });

  it("accepts a mix of sync and async results", async () => {
    const m = mount({ processCellFromClipboard: (text) => (text === "a" ? "sync" : Promise.resolve("async")) });
    m.paste("a\nb");
    await settle();
    expect(m.names()).toEqual(["sync", "async", "C"]);
  });

  it("a newer paste supersedes a pending one, like a paste held by an async schema", async () => {
    const first = deferred<string>();
    const pending = [first.promise, Promise.resolve("two")];
    const onGateAborted = vi.fn();
    const m = mount({ processCellFromClipboard: () => pending.shift()!, onGateAborted });
    expect(m.paste("one")).toBe(true);
    expect(m.paste("two")).toBe(true);
    expect(onGateAborted).toHaveBeenCalledWith({ gate: "processCellFromClipboard", reason: "superseded" });
    first.resolve("one");
    await settle();
    expect(m.names()).toEqual(["two", "B", "C"]);
  });

  it("a processCellFromClipboard rejection without a string form cancels the paste", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = mount({ processCellFromClipboard: () => Promise.reject(Object.create(null)) });
    m.paste("x");
    await settle();
    expect(m.names()).toEqual(["A", "B", "C"]);
  });

  it("one rejected cell is rejected alone and the rest of the paste lands", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = mount({ processCellFromClipboard: (text) => (text === "bad" ? Promise.reject(new Error("down")) : Promise.resolve(text)) });
    m.paste("good\nbad");
    await settle();
    expect(m.names()).toEqual(["good", "B", "C"]);
    expect(warn.mock.calls.some(([message]) => String(message).includes("processCellFromClipboard threw for a cell"))).toBe(true);
    m.paste("fine");
    await settle();
    expect(m.names()).toEqual(["fine", "B", "C"]);
  });

  it("drops the late result when readOnly, a row is gone, or the sort changed; follows a reorder", async () => {
    const ro = deferred<string>();
    const m = mount({ processCellFromClipboard: () => ro.promise });
    m.paste("a");
    m.sync({ readOnly: true });
    ro.resolve("late");
    await settle();
    expect(m.names()).toEqual(["A", "B", "C"]);

    const moved = deferred<string>();
    const m2 = mount({ processCellFromClipboard: () => moved.promise });
    m2.paste("a");
    m2.sync({ data: rows(["c", "b", "a"]) });
    moved.resolve("late");
    await settle();
    expect(m2.names()).toEqual(["C", "B", "late"]);

    const gone = deferred<string>();
    const m3 = mount({ processCellFromClipboard: () => gone.promise });
    m3.paste("a");
    m3.sync({ data: rows(["b", "c"]) });
    gone.resolve("late");
    await settle();
    expect(m3.names()).toEqual(["B", "C"]);
  });

  it("marks the gate pending, passes a signal, and gateTimeoutMs aborts it and frees the next paste", async () => {
    vi.useFakeTimers();
    try {
      const onGateAborted = vi.fn();
      const signals: AbortSignal[] = [];
      const m = mount({
        gateTimeoutMs: { processCellFromClipboard: 100 },
        onGateAborted,
        processCellFromClipboard: (text, ctx) => (signals.push(ctx.signal), text === "x" ? new Promise(() => {}) : text),
      });
      expect(m.paste("x")).toBe(true);
      expect([...m.store.getState().gatesPending]).toEqual(["processCellFromClipboard"]);
      await vi.advanceTimersByTimeAsync(100);
      expect(signals[0]!.aborted).toBe(true);
      expect(onGateAborted).toHaveBeenCalledWith({ gate: "processCellFromClipboard", reason: "timeout" });
      expect(m.store.getState().gatesPending.size).toBe(0);
      expect(m.paste("y")).toBe(true);
      expect(m.names()[0]).toBe("y");
    } finally {
      vi.useRealTimers();
    }
  });

  it("an async parser composes with an async processPaste into one write", async () => {
    const onDataChange = vi.fn();
    const m = mount({
      processPaste: ({ cells }) => Promise.resolve(cells.map((r) => r.map((c) => `${c}!`))),
      processCellFromClipboard: (text) => Promise.resolve(text.toUpperCase()),
      onDataChange,
    });
    m.paste("x");
    await settle();
    expect(m.names()).toEqual(["X!", "B", "C"]);
    expect(onDataChange).toHaveBeenCalledTimes(1);
  });
});

describe("a paste held by an async schema", () => {
  const asyncSchema = (gate: Promise<void>) => ({
    "~standard": { version: 1, vendor: "test", validate: async (value: unknown) => (await gate, { value }) },
  });

  it('marks the "validate" gate pending until the schema settles, and gateTimeoutMs.validate drops the batch', async () => {
    const held = deferred<void>();
    const m = mount({ columns: [{ ...columns[0]!, validate: asyncSchema(held.promise) as never }, columns[1]!] });
    m.paste("one");
    expect([...m.store.getState().gatesPending]).toEqual(["validate"]);
    held.resolve();
    await settle();
    expect(m.store.getState().gatesPending.size).toBe(0);
    expect(m.names()).toEqual(["one", "B", "C"]);

    vi.useFakeTimers();
    try {
      const onGateAborted = vi.fn();
      const stuck = mount({ columns: [{ ...columns[0]!, validate: asyncSchema(new Promise(() => {})) as never }, columns[1]!], gateTimeoutMs: { validate: 50 }, onGateAborted });
      stuck.paste("late");
      vi.advanceTimersByTime(60);
      expect(onGateAborted).toHaveBeenCalledWith({ gate: "validate", reason: "timeout" });
      expect(stuck.store.getState().gatesPending.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
