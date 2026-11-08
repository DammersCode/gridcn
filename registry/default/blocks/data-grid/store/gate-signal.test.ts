import { afterEach, describe, expect, it, vi } from "vitest";
import { pasteText } from "../clipboard/use-grid-clipboard";
import { createDataGridStore } from "./create-store";
import { EMPTY_GATES_PENDING, createGateTracker, type GateName } from "./gate-signal";
import { getInternalActions } from "./internal-actions";
import type { DataGridStoreState, InternalSyncProps } from "./types";

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

function mount(overrides: Partial<InternalSyncProps> = {}) {
  const base = { data: rows(), onDataChange: () => {}, columns, getRowId: (row: unknown) => (row as Row).id, ...overrides } as InternalSyncProps;
  const store = createDataGridStore(base);
  return {
    store,
    state: () => store.getState(),
    ids: () => store.getState().data.map((row) => (row as Row).id),
    pending: () => [...store.getState().gatesPending],
    unmount: () => getInternalActions(store)._disposeWrites(),
    sync: (next: Partial<InternalSyncProps>) => {
      getInternalActions(store)._syncConfig({ ...base, ...next } as InternalSyncProps);
      getInternalActions(store)._syncProps({ ...base, ...next } as InternalSyncProps);
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("gate tracker", () => {
  function tracker() {
    const published: ReadonlySet<GateName>[] = [];
    let listener: ((now: DataGridStoreState, prev: DataGridStoreState) => void) | null = null;
    const gates = createGateTracker({
      publish: (pending) => published.push(pending),
      subscribe: (next) => {
        listener = next;
        return () => {
          listener = null;
        };
      },
    });
    return { gates, published, hasListener: () => listener !== null };
  }

  it("publishes the shared empty set when the last run settles", () => {
    const { gates, published } = tracker();
    const run = gates.begin("createRow");
    gates.hold(run);
    gates.settle(run);
    expect([...published[0]!]).toEqual(["createRow"]);
    expect(published[1]).toBe(EMPTY_GATES_PENDING);
  });

  it("publishes once per name while several runs of one gate overlap", () => {
    const { gates, published } = tracker();
    const first = gates.begin("validateRow");
    const second = gates.begin("validateRow");
    gates.hold(first);
    gates.hold(second);
    gates.settle(first);
    expect(published).toHaveLength(1);
    gates.settle(second);
    expect(published).toHaveLength(2);
  });

  it("aborts a held run, drops it from the pending set, and ignores its late settle", () => {
    const { gates, published } = tracker();
    const run = gates.begin("onEditStart");
    const { signal } = run;
    gates.hold(run);
    gates.abortRun(run);
    expect(signal.aborted).toBe(true);
    expect(published[1]).toBe(EMPTY_GATES_PENDING);
    gates.settle(run);
    expect(published).toHaveLength(2);
  });

  it("reads an aborted signal when the run was already cancelled", () => {
    const { gates } = tracker();
    const run = gates.begin("validateRow");
    run.cancel();
    expect(run.signal.aborted).toBe(true);
  });

  it("subscribes to the store only while a watched run is held", () => {
    const { gates, hasListener } = tracker();
    const run = gates.begin("createRow", () => false);
    gates.hold(run);
    expect(hasListener()).toBe(true);
    gates.settle(run);
    expect(hasListener()).toBe(false);
  });

  it("track() marks a name pending until released", () => {
    const { gates, published } = tracker();
    const release = gates.track("import");
    expect([...published[0]!]).toEqual(["import"]);
    release();
    expect(published[1]).toBe(EMPTY_GATES_PENDING);
  });
});

describe("validateRow signal", () => {
  const edit = (m: ReturnType<typeof mount>, value: string, rowId = "a") => m.state().actions.updateCells([{ rowId, columnId: "name", value }]);

  it("hands every run a signal that stays live for a sync verdict", () => {
    const signals: AbortSignal[] = [];
    const m = mount({
      validateRow: (_row, _id, ctx) => {
        signals.push(ctx.signal);
        return null;
      },
    });
    edit(m, "x");
    expect(signals).toHaveLength(1);
    expect(signals[0]!.aborted).toBe(false);
    expect(m.state().gatesPending).toBe(EMPTY_GATES_PENDING);
  });

  it("aborts the older run when a newer run for the same row starts, and drops its verdict", async () => {
    const signals: AbortSignal[] = [];
    const verdicts = [deferred<Record<string, string> | null>(), deferred<Record<string, string> | null>()];
    const m = mount({
      validateRow: (_row, _id, ctx) => {
        signals.push(ctx.signal);
        return verdicts[signals.length - 1]!.promise;
      },
    });
    edit(m, "x");
    expect(m.pending()).toEqual(["validateRow"]);
    edit(m, "y");
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);
    verdicts[0]!.resolve({ name: "stale" });
    verdicts[1]!.resolve({ name: "fresh" });
    await settle();
    expect(m.state().cellErrors.get("a:name")).toBe("fresh");
    expect(m.state().gatesPending).toBe(EMPTY_GATES_PENDING);
  });

  it("a sync verdict for the row aborts a pending async one", async () => {
    const d = deferred<Record<string, string> | null>();
    const signals: AbortSignal[] = [];
    let calls = 0;
    const m = mount({
      validateRow: (_row, _id, ctx) => {
        signals.push(ctx.signal);
        return ++calls === 1 ? d.promise : null;
      },
    });
    edit(m, "x");
    edit(m, "y");
    expect(signals[0]!.aborted).toBe(true);
    d.resolve({ name: "stale" });
    await settle();
    expect(m.state().cellErrors.size).toBe(0);
  });

  it("aborts a pending run when its row leaves the data", async () => {
    const d = deferred<Record<string, string> | null>();
    let signal!: AbortSignal;
    const m = mount({
      validateRow: (_row, _id, ctx) => {
        signal = ctx.signal;
        return d.promise;
      },
    });
    edit(m, "x");
    m.state().actions.deleteRows([0]);
    expect(signal.aborted).toBe(true);
    expect(m.state().gatesPending).toBe(EMPTY_GATES_PENDING);
  });

  it("aborts a pending run on unmount and drops the verdict", async () => {
    const d = deferred<Record<string, string> | null>();
    let signal!: AbortSignal;
    const m = mount({
      validateRow: (_row, _id, ctx) => {
        signal = ctx.signal;
        return d.promise;
      },
    });
    edit(m, "x");
    m.unmount();
    expect(signal.aborted).toBe(true);
    d.resolve({ name: "late" });
    await settle();
    expect(m.state().cellErrors.size).toBe(0);
  });

  it("does not warn for a rejection after the run was aborted", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const d = deferred<Record<string, string> | null>();
    const m = mount({ validateRow: () => d.promise });
    edit(m, "x");
    m.unmount();
    d.reject(new DOMException("aborted", "AbortError"));
    await settle();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("onEditStart signal", () => {
  const begin = (m: ReturnType<typeof mount>, row = 0) => m.state().actions.startEditingAt({ row, col: 0 });

  it("passes the cell and a signal, and shows the gate pending until it settles", async () => {
    const d = deferred<boolean>();
    const gate = vi.fn((_cell: unknown, _ctx: { signal: AbortSignal }) => d.promise);
    const m = mount({ onEditStart: gate });
    begin(m);
    expect(gate.mock.calls[0]![0]).toMatchObject({ rowId: "a", columnId: "name" });
    expect(m.pending()).toEqual(["onEditStart"]);
    d.resolve(true);
    await settle();
    expect(m.state().editing?.rowId).toBe("a");
    expect(m.state().gatesPending).toBe(EMPTY_GATES_PENDING);
  });

  it("a sync gate never shows pending", () => {
    const m = mount({ onEditStart: () => true });
    begin(m);
    expect(m.state().gatesPending).toBe(EMPTY_GATES_PENDING);
    expect(m.state().editing?.rowId).toBe("a");
  });

  it("aborts when the cursor moves to another cell, and a newer start runs", async () => {
    const signals: AbortSignal[] = [];
    const verdicts = [deferred<boolean>(), deferred<boolean>()];
    const m = mount({
      onEditStart: (_cell, ctx) => {
        signals.push(ctx.signal);
        return verdicts[signals.length - 1]!.promise;
      },
    });
    m.state().actions.selectCellAt({ row: 0, col: 0 });
    begin(m);
    m.state().actions.selectCellAt({ row: 2, col: 0 });
    expect(signals[0]!.aborted).toBe(true);
    expect(m.state().gatesPending).toBe(EMPTY_GATES_PENDING);
    begin(m, 2);
    expect(signals).toHaveLength(2);
    verdicts[0]!.resolve(true);
    verdicts[1]!.resolve(true);
    await settle();
    expect(m.state().editing?.rowId).toBe("c");
  });

  it("aborts on cancelEditing (Escape)", async () => {
    const d = deferred<boolean>();
    let signal!: AbortSignal;
    const m = mount({
      onEditStart: (_cell, ctx) => {
        signal = ctx.signal;
        return d.promise;
      },
    });
    begin(m);
    m.state().actions.cancelEditing();
    expect(signal.aborted).toBe(true);
    d.resolve(true);
    await settle();
    expect(m.state().editing).toBeNull();
  });

  it("aborts when the grid goes readOnly", async () => {
    const d = deferred<boolean>();
    let signal!: AbortSignal;
    const m = mount({
      onEditStart: (_cell, ctx) => {
        signal = ctx.signal;
        return d.promise;
      },
    });
    begin(m);
    m.sync({ readOnly: true });
    expect(signal.aborted).toBe(true);
    d.resolve(true);
    await settle();
    expect(m.state().editing).toBeNull();
  });

  it("aborts on unmount", () => {
    let signal!: AbortSignal;
    const m = mount({
      onEditStart: (_cell, ctx) => {
        signal = ctx.signal;
        return new Promise<boolean>(() => {});
      },
    });
    begin(m);
    m.unmount();
    expect(signal.aborted).toBe(true);
    expect(m.state().gatesPending).toBe(EMPTY_GATES_PENDING);
  });

  it("an aborted start releases the latch for the next start", async () => {
    const results = [new Promise<boolean>(() => {}), Promise.resolve(true)];
    const m = mount({ onEditStart: () => results.shift()! });
    begin(m);
    m.state().actions.cancelEditing();
    begin(m);
    await settle();
    expect(m.state().editing?.rowId).toBe("a");
  });
});

describe("createRow signal", () => {
  it("passes a signal, shows the gate pending, and clears it when the insert lands", async () => {
    const d = deferred<Row>();
    const createRow = vi.fn((_index: number, _ctx: { signal: AbortSignal }) => d.promise);
    const m = mount({ createRow });
    m.state().actions.insertRow(1, "below");
    expect(createRow.mock.calls[0]![1].signal.aborted).toBe(false);
    expect(m.pending()).toEqual(["createRow"]);
    d.resolve({ id: "x", name: "X" });
    await settle();
    expect(m.ids()).toEqual(["a", "b", "x", "c"]);
    expect(m.state().gatesPending).toBe(EMPTY_GATES_PENDING);
  });

  it("shares one signal across the rows of one request", () => {
    const signals = new Set<AbortSignal>();
    const m = mount({
      createRow: (i, ctx) => {
        signals.add(ctx.signal);
        return { id: `n${i}`, name: "N" };
      },
    });
    m.state().actions.insertRows(0, 3, "below");
    expect(signals.size).toBe(1);
    expect(m.state().gatesPending).toBe(EMPTY_GATES_PENDING);
  });

  it("aborts and drops the result on unmount", async () => {
    const d = deferred<Row>();
    let signal!: AbortSignal;
    const m = mount({
      createRow: (_i, ctx) => {
        signal = ctx.signal;
        return d.promise;
      },
    });
    m.state().actions.insertRow(1, "below");
    m.unmount();
    expect(signal.aborted).toBe(true);
    d.resolve({ id: "x", name: "X" });
    await settle();
    expect(m.ids()).toEqual(["a", "b", "c"]);
  });

  it("aborts and drops the result when the grid goes readOnly", async () => {
    const d = deferred<Row>();
    let signal!: AbortSignal;
    const m = mount({
      createRow: (_i, ctx) => {
        signal = ctx.signal;
        return d.promise;
      },
    });
    m.state().actions.insertRow(1, "below");
    m.sync({ readOnly: true });
    expect(signal.aborted).toBe(true);
    d.resolve({ id: "x", name: "X" });
    await settle();
    expect(m.ids()).toEqual(["a", "b", "c"]);
  });

  it("aborts when the anchor row leaves the data, and a new insert is allowed at once", async () => {
    const signals: AbortSignal[] = [];
    const pending = new Promise<Row>(() => {});
    const m = mount({
      createRow: (i, ctx) => {
        signals.push(ctx.signal);
        return signals.length === 1 ? pending : { id: `n${i}`, name: "N" };
      },
    });
    m.state().actions.insertRow(1, "below");
    m.sync({ data: rows(["a", "c"]) });
    expect(signals[0]!.aborted).toBe(true);
    m.state().actions.insertRow(0, "below");
    expect(m.ids()).toEqual(["a", "n1", "c"]);
  });

  it("does not warn when the aborted promise rejects", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const d = deferred<Row>();
    const m = mount({ createRow: () => d.promise });
    m.state().actions.insertRow(1, "below");
    m.unmount();
    d.reject(new Error("aborted"));
    await settle();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("duplicateRow signal", () => {
  const copy = (row: Row, index: number): Row => ({ id: `${row.id}-${index}`, name: row.name });

  it("passes a signal and shows the gate pending until every copy settles", async () => {
    const d = deferred<Row>();
    const duplicateRow = vi.fn((_row: unknown, _index: number, _ctx: { signal: AbortSignal }) => d.promise);
    const m = mount({ duplicateRow });
    m.state().actions.duplicateRows([0]);
    expect(duplicateRow.mock.calls[0]![2].signal.aborted).toBe(false);
    expect(m.pending()).toEqual(["duplicateRow"]);
    d.resolve(copy(rows()[0]!, 1));
    await settle();
    expect(m.ids()).toEqual(["a", "a-1", "b", "c"]);
    expect(m.state().gatesPending).toBe(EMPTY_GATES_PENDING);
  });

  it("aborts and drops the result on unmount", async () => {
    const d = deferred<Row>();
    let signal!: AbortSignal;
    const m = mount({
      duplicateRow: (_row, _i, ctx) => {
        signal = ctx.signal;
        return d.promise;
      },
    });
    m.state().actions.duplicateRows([0]);
    m.unmount();
    expect(signal.aborted).toBe(true);
    d.resolve({ id: "z", name: "Z" });
    await settle();
    expect(m.ids()).toEqual(["a", "b", "c"]);
  });

  it("aborts and drops the result when the grid goes readOnly", async () => {
    const d = deferred<Row>();
    let signal!: AbortSignal;
    const m = mount({
      duplicateRow: (_row, _i, ctx) => {
        signal = ctx.signal;
        return d.promise;
      },
    });
    m.state().actions.duplicateRows([0]);
    m.sync({ readOnly: true });
    expect(signal.aborted).toBe(true);
    d.resolve({ id: "z", name: "Z" });
    await settle();
    expect(m.ids()).toEqual(["a", "b", "c"]);
  });

  it("aborts when every source row leaves the data", () => {
    let signal!: AbortSignal;
    const m = mount({
      duplicateRow: (_row, _i, ctx) => {
        signal = ctx.signal;
        return new Promise<Row>(() => {});
      },
    });
    m.state().actions.duplicateRows([0]);
    m.sync({ data: rows(["b", "c"]) });
    expect(signal.aborted).toBe(true);
  });

  it("a sync factory gets a signal and never shows pending", () => {
    const signals: AbortSignal[] = [];
    const m = mount({
      duplicateRow: (row, i, ctx) => {
        signals.push(ctx.signal);
        return copy(row as Row, i);
      },
    });
    m.state().actions.duplicateRows([0]);
    expect(signals).toHaveLength(1);
    expect(m.state().gatesPending).toBe(EMPTY_GATES_PENDING);
  });
});

describe("onBeforeDeleteRows signal", () => {
  it("passes a signal and shows the gate pending until it settles", async () => {
    const d = deferred<boolean>();
    const gate = vi.fn((_ctx: { rowIds: readonly string[]; hiddenCount: number; signal: AbortSignal }) => d.promise);
    const m = mount({ onBeforeDeleteRows: gate });
    m.state().actions.deleteRows([0]);
    expect(gate.mock.calls[0]![0].signal.aborted).toBe(false);
    expect(m.pending()).toEqual(["onBeforeDeleteRows"]);
    d.resolve(true);
    await settle();
    expect(m.ids()).toEqual(["b", "c"]);
    expect(m.state().gatesPending).toBe(EMPTY_GATES_PENDING);
  });

  it("aborts and drops a confirmed delete on unmount", async () => {
    const d = deferred<boolean>();
    let signal!: AbortSignal;
    const m = mount({
      onBeforeDeleteRows: (ctx) => {
        signal = ctx.signal;
        return d.promise;
      },
    });
    m.state().actions.deleteRows([0]);
    m.unmount();
    expect(signal.aborted).toBe(true);
    d.resolve(true);
    await settle();
    expect(m.ids()).toEqual(["a", "b", "c"]);
  });

  it("aborts and drops the delete when the grid goes readOnly", async () => {
    const d = deferred<boolean>();
    let signal!: AbortSignal;
    const m = mount({
      onBeforeDeleteRows: (ctx) => {
        signal = ctx.signal;
        return d.promise;
      },
    });
    m.state().actions.deleteRows([0]);
    m.sync({ readOnly: true });
    expect(signal.aborted).toBe(true);
    d.resolve(true);
    await settle();
    expect(m.ids()).toEqual(["a", "b", "c"]);
  });

  it("aborts when the row identity changes under the pending confirm", async () => {
    const d = deferred<boolean>();
    let signal!: AbortSignal;
    const m = mount({
      onBeforeDeleteRows: (ctx) => {
        signal = ctx.signal;
        return d.promise;
      },
    });
    m.state().actions.deleteRows([0]);
    m.sync({ data: rows(["x", "y"]) });
    expect(signal.aborted).toBe(true);
    d.resolve(true);
    await settle();
    expect(m.ids()).toEqual(["x", "y"]);
  });

  it("a second request after an abort asks again", async () => {
    const results = [new Promise<boolean>(() => {}), Promise.resolve(true)];
    const m = mount({ onBeforeDeleteRows: () => results.shift()! });
    m.state().actions.deleteRows([0]);
    m.sync({ readOnly: true });
    m.sync({ readOnly: false });
    m.state().actions.deleteRows([0]);
    await settle();
    expect(m.ids()).toEqual(["b", "c"]);
  });
});

describe("processPaste signal", () => {
  const paste = (m: ReturnType<typeof mount>, text: string) => pasteText(m.state(), m.state().actions, text, undefined, m.store);

  it("passes a signal and shows the gate pending until it settles", async () => {
    const d = deferred<string[][] | false>();
    const gate = vi.fn((_ctx: { cells: string[][]; signal: AbortSignal }) => d.promise);
    const m = mount({ processPaste: gate });
    m.state().actions.selectCellAt({ row: 0, col: 0 });
    paste(m, "x");
    expect(gate.mock.calls[0]![0].signal.aborted).toBe(false);
    expect(m.pending()).toEqual(["processPaste"]);
    d.resolve([["server"]]);
    await settle();
    expect((m.state().data[0] as Row).name).toBe("server");
    expect(m.state().gatesPending).toBe(EMPTY_GATES_PENDING);
  });

  it("aborts and drops the result on unmount", async () => {
    const d = deferred<string[][] | false>();
    let signal!: AbortSignal;
    const m = mount({
      processPaste: (ctx) => {
        signal = ctx.signal;
        return d.promise;
      },
    });
    m.state().actions.selectCellAt({ row: 0, col: 0 });
    paste(m, "x");
    m.unmount();
    expect(signal.aborted).toBe(true);
    d.resolve([["late"]]);
    await settle();
    expect((m.state().data[0] as Row).name).toBe("A");
  });

  it("aborts and drops the result when the grid goes readOnly", async () => {
    const d = deferred<string[][] | false>();
    let signal!: AbortSignal;
    const m = mount({
      processPaste: (ctx) => {
        signal = ctx.signal;
        return d.promise;
      },
    });
    m.state().actions.selectCellAt({ row: 0, col: 0 });
    paste(m, "x");
    m.sync({ readOnly: true });
    expect(signal.aborted).toBe(true);
    d.resolve([["late"]]);
    await settle();
    expect((m.state().data[0] as Row).name).toBe("A");
  });

  it("aborts when an edit starts, and a new paste is accepted", async () => {
    const signals: AbortSignal[] = [];
    const results = [new Promise<string[][] | false>(() => {}), Promise.resolve([["second"]])];
    const m = mount({
      processPaste: (ctx) => {
        signals.push(ctx.signal);
        return results.shift()!;
      },
    });
    m.state().actions.selectCellAt({ row: 0, col: 0 });
    paste(m, "x");
    m.state().actions.startEditingAt({ row: 1, col: 0 });
    expect(signals[0]!.aborted).toBe(true);
    m.state().actions.cancelEditing();
    paste(m, "y");
    await settle();
    expect((m.state().data[0] as Row).name).toBe("second");
  });

  it("a sync gate gets a signal and never shows pending", () => {
    const signals: AbortSignal[] = [];
    const m = mount({
      processPaste: ({ cells, signal }) => {
        signals.push(signal);
        return cells;
      },
    });
    m.state().actions.selectCellAt({ row: 0, col: 0 });
    paste(m, "x");
    expect(signals).toHaveLength(1);
    expect(m.state().gatesPending).toBe(EMPTY_GATES_PENDING);
  });
});

describe("controlled data (server path)", () => {
  it("drops a createRow result when readOnly flips during the await, and onDataChange stays silent", async () => {
    const onDataChange = vi.fn();
    const d = deferred<Row>();
    const m = mount({ createRow: () => d.promise, onDataChange });
    m.state().actions.insertRow(1, "below");
    m.sync({ readOnly: true, onDataChange });
    d.resolve({ id: "x", name: "X" });
    await settle();
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it("aborts a pending validateRow when the consumer replaces the data without the row (server refetch)", () => {
    let signal!: AbortSignal;
    const m = mount({
      validateRow: (_row, _id, ctx) => {
        signal = ctx.signal;
        return new Promise<Record<string, string> | null>(() => {});
      },
    });
    m.state().actions.updateCells([{ rowId: "a", columnId: "name", value: "x" }]);
    m.sync({ data: rows(["b", "c"]) });
    expect(signal.aborted).toBe(true);
  });
});
