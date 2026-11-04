import { StrictMode } from "react";
import { act, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import { DataGridProvider, DataGridRoot, defineColumns, type DataChange } from "@/registry/default/blocks/data-grid/data-grid";
import { getSelectedViewRows, useDataGridStoreApi } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import type { DataGridStoreState } from "@/registry/default/blocks/data-grid/store";
import { useDataGridServerRows, type ServerRowsAnswer, type UseDataGridServerRowsScrollOptions, type UseDataGridServerRowsScrollResult } from "./use-data-grid-server-rows";

type Row = { id: string; name: string };
type Request = { start: number; end: number; signal: AbortSignal; settled: boolean; resolve: () => void; reject: () => void };

const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text" }] as const);
const person = (i: number): Row => ({ id: `r${i}`, name: `Person ${i}` });
const FRAME = 20;

type Extra = Partial<UseDataGridServerRowsScrollOptions<Row>>;
type SetupOptions = { total?: number; auto?: boolean; onSave?: boolean; strict?: boolean; repeatSlot?: number };

function setup(extra: Extra = {}, { total = 100_000, auto = false, onSave = true, strict = false, repeatSlot }: SetupOptions = {}) {
  const requests: Request[] = [];
  let autoResolve = auto;
  let currentTotal = total;
  let shift = 0;
  const fetchRows = vi.fn(
    ({ start, end, signal }: { start: number; end: number; signal: AbortSignal }) =>
      new Promise<ServerRowsAnswer<Row>>((resolve, reject) => {
        const answer = (): ServerRowsAnswer<Row> => ({ rows: Array.from({ length: Math.max(0, Math.min(end, currentTotal) - start) }, (_, i) => person(start + i === repeatSlot ? start + i - 1 : start + i - shift)), totalRowCount: currentTotal });
        const request: Request = { start, end, signal, settled: false, resolve: () => ((request.settled = true), resolve(answer())), reject: () => ((request.settled = true), reject(new Error("boom"))) };
        requests.push(request);
        if (autoResolve) request.resolve();
      }),
  );
  let server!: UseDataGridServerRowsScrollResult<Row>;
  let store!: StoreApi<DataGridStoreState>;
  const saves: Array<() => void> = [];
  const save = (_change: DataChange<Row>) => new Promise<void>((resolve) => saves.push(resolve));
  function Probe() {
    store = useDataGridStoreApi() as unknown as StoreApi<DataGridStoreState>;
    return null;
  }
  function Harness() {
    server = useDataGridServerRows<Row>({ mode: "scroll", getRowId: (row) => row.id, fetchRows, blockSize: 10, overscan: 0, loadDelay: 0, maxConcurrentFetches: 16, maxLoadedRows: Infinity, ...extra });
    return (
      <DataGridProvider {...server.providerProps} columns={columns} enableRowSelection onSave={onSave ? save : undefined}>
        <DataGridRoot>
          <Probe />
        </DataGridRoot>
      </DataGridProvider>
    );
  }
  const view = render(strict ? <StrictMode><Harness /></StrictMode> : <Harness />);
  const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
  const t = {
    server: () => server,
    state: () => store.getState(),
    requests,
    view,
    starts: () => requests.map((request) => request.start),
    open: () => requests.filter((request) => !request.settled && !request.signal.aborted),
    latest: (start: number) => requests.filter((request) => request.start === start).at(-1)!,
    advance,
    report: (start: number, end: number) => act(() => server.gridProps.onRenderedRowsChange({ start, end })),
    land: async (...starts: number[]) => {
      await act(async () => starts.forEach((start) => t.open().find((request) => request.start === start)!.resolve()));
      await advance(FRAME);
    },
    landAll: async () => {
      await act(async () => t.open().forEach((request) => request.resolve()));
      await advance(FRAME);
    },
    autoResolve: (on: boolean) => (autoResolve = on),
    setTotal: (next: number) => (currentTotal = next),
    setShift: (next: number) => (shift = next),
    idsOf: (id: string) => server.gridProps.data.filter((row) => row?.id === id).length,
    loadedRows: () => server.getLoadedRanges().reduce((sum, range) => sum + range.end - range.start, 0),
    isLoaded: (index: number) => server.getLoadedRanges().some((range) => range.start <= index && index < range.end),
    dataAt: (index: number) => server.gridProps.data[index],
    saves,
    settleSaves: () => act(async () => saves.splice(0).forEach((resolve) => resolve())),
  };
  return t;
}

async function mount(extra: Extra = {}, options: SetupOptions = {}) {
  const t = setup(extra, options);
  await t.advance(0);
  await t.land(0);
  return t;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "requestAnimationFrame", "cancelAnimationFrame"] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("abort what left the keep range", () => {
  it("aborts a block request outside the keep range and keeps one inside it", async () => {
    const t = await mount();
    await t.report(100, 110);
    await t.report(110, 120);
    expect(t.latest(100).signal.aborted).toBe(false);
    await t.report(500, 510);
    expect(t.latest(100).signal.aborted).toBe(true);
    expect(t.latest(500).signal.aborted).toBe(false);
  });

  it("starts the block again when it is wanted again", async () => {
    const t = await mount();
    await t.report(100, 110);
    await t.report(500, 510);
    await t.report(100, 110);
    expect(t.starts().filter((start) => start === 100)).toHaveLength(2);
    expect(t.latest(100).signal.aborted).toBe(false);
  });

  it("does not report an aborted request as an error and clears loading when nothing else runs", async () => {
    const onError = vi.fn();
    const t = await mount({ onError });
    await t.report(100, 110);
    expect(t.server().loading).toBe(true);
    await t.report(0, 10);
    await t.advance(FRAME);
    expect(t.latest(100).signal.aborted).toBe(true);
    expect(onError).not.toHaveBeenCalled();
    expect(t.server().loading).toBe(false);
    expect(t.server().error).toBeNull();
  });

  it("forgets a failed block outside the keep range and clears the error", async () => {
    const t = await mount();
    await t.report(100, 110);
    await act(async () => t.latest(100).reject());
    expect(t.server().status).toBe("error");
    await t.report(500, 510);
    expect(t.server().error).toBeNull();
    await t.land(500);
    expect(t.server().status).toBe("ready");
  });

  it("keeps a failed block inside the keep range as the error", async () => {
    const t = await mount();
    await t.report(100, 110);
    await act(async () => t.latest(100).reject());
    await t.report(110, 120);
    expect(t.server().status).toBe("error");
  });

  it("unloads the old rows of a refresh block that was aborted, so a later view fetches them", async () => {
    const t = await mount();
    await t.report(0, 10);
    act(() => t.server().refresh());
    expect(t.latest(0).settled).toBe(false);
    expect(t.dataAt(3)).toEqual(person(3));
    await t.report(500, 510);
    expect(t.latest(0).signal.aborted).toBe(true);
    expect(t.isLoaded(3)).toBe(false);
    expect(t.dataAt(3)).toBeUndefined();
  });
});

describe("load delay", () => {
  it("starts no request while the rendered rows jump, and starts the wanted blocks once they rest", async () => {
    const t = await mount({ loadDelay: 100, blockSize: 50, overscan: 30 });
    for (let i = 1; i <= 20; i++) {
      await t.report(i * 4000, i * 4000 + 30);
      await t.advance(4);
    }
    expect(t.starts()).toEqual([0]);
    await t.advance(95);
    expect(t.starts()).toEqual([0]);
    await t.advance(1);
    expect(t.starts().slice(1).sort((a, b) => a - b)).toEqual([79950, 80000, 80050]);
  });

  it("starts the next block 100 ms after it enters the overscan while the rows scroll slowly", async () => {
    const t = await mount({ loadDelay: 100, blockSize: 50, overscan: 30 });
    const firstSeen = new Map<number, number>();
    let elapsed = 0;
    for (let i = 0; i < 50; i++) {
      await t.report(i, 30 + i);
      await t.advance(20);
      elapsed += 20;
      for (const request of t.open()) if (!firstSeen.has(request.start)) firstSeen.set(request.start, elapsed);
    }
    expect([...firstSeen]).toEqual([[50, 100], [100, 920]]);
  });

  it("with loadDelay 0 starts the blocks in the same call", async () => {
    const t = await mount({ loadDelay: 0 });
    await t.report(100, 130);
    expect(t.starts().slice(1)).toEqual([110, 100, 120]);
  });

  it("does not start a block that a report dropped before its delay ended", async () => {
    const t = await mount({ loadDelay: 100 });
    await t.report(100, 110);
    await t.advance(60);
    await t.report(300, 310);
    await t.advance(60);
    expect(t.starts()).toEqual([0]);
    await t.advance(40);
    expect(t.starts()).toEqual([0, 300]);
  });

  it("restarts the delay of a block that left the wanted range and came back", async () => {
    const t = await mount({ loadDelay: 100 });
    await t.report(100, 110);
    await t.advance(80);
    await t.report(300, 310);
    await t.report(100, 110);
    await t.advance(90);
    expect(t.starts()).toEqual([0]);
    await t.advance(10);
    expect(t.starts()).toEqual([0, 100]);
  });

  it("lets block 0, refresh, retry, and the refetch after a count change skip the delay", async () => {
    const t = setup({ loadDelay: 100 });
    await t.advance(0);
    expect(t.starts()).toEqual([0]);
    await t.land(0);
    await t.report(100, 110);
    await t.advance(100);
    await t.land(100);
    act(() => t.server().refresh());
    expect(t.open().map((request) => request.start)).toEqual([100]);
    await act(async () => t.latest(100).reject());
    expect(t.server().error).not.toBeNull();
    act(() => t.server().retry());
    expect(t.open().map((request) => request.start)).toEqual([100]);
  });

  it("does not count a block that waits for its delay as loading", async () => {
    const t = await mount({ loadDelay: 100 });
    await t.report(100, 110);
    expect(t.server().loading).toBe(false);
    await t.advance(100);
    expect(t.server().loading).toBe(true);
  });

  it("clamps an invalid loadDelay to the default", async () => {
    const t = await mount({ loadDelay: Number.NaN });
    await t.report(100, 110);
    await t.advance(99);
    expect(t.starts()).toEqual([0]);
    await t.advance(1);
    expect(t.starts()).toEqual([0, 100]);
  });

  it("lets the refetch after the first answer skip the delay", async () => {
    const t = setup({ loadDelay: 100 });
    await t.advance(0);
    await t.report(100, 110);
    await t.land(0);
    expect(t.starts()).toEqual([0, 100]);
  });
});

describe("concurrency cap", () => {
  it("starts at most maxConcurrentFetches requests and starts the nearest waiting block when one settles", async () => {
    const t = await mount({ maxConcurrentFetches: 2 });
    await t.report(100, 150);
    expect(t.starts().slice(1)).toEqual([120, 110]);
    await t.land(120);
    expect(t.starts().slice(1)).toEqual([120, 110, 130]);
    await t.land(110);
    expect(t.starts().slice(1)).toEqual([120, 110, 130, 100]);
    expect(t.open()).toHaveLength(2);
  });

  it("keeps loading true while blocks wait for a slot", async () => {
    const t = await mount({ maxConcurrentFetches: 1 });
    await t.report(100, 130);
    await t.land(110);
    expect(t.server().loading).toBe(true);
    await t.land(100);
    await t.land(120);
    expect(t.server().loading).toBe(false);
  });

  it("queues the blocks of a refresh, drains them before uncovered blocks, and counts them as loading", async () => {
    const t = await mount({ maxConcurrentFetches: 1 });
    t.autoResolve(true);
    await t.report(100, 130);
    await t.advance(FRAME);
    t.autoResolve(false);
    await t.report(100, 130);
    const before = t.starts().length;
    act(() => t.server().refresh());
    expect(t.starts().slice(before)).toEqual([110]);
    expect(t.server().loading).toBe(true);
    await t.land(110);
    expect(t.starts().slice(before)).toEqual([110, 100]);
    await t.land(100);
    await t.land(120);
    expect(t.server().loading).toBe(false);
    expect(t.starts().slice(before)).toEqual([110, 100, 120]);
  });

  it("drains the owed blocks of a refresh before the blocks the rendered rows now want", async () => {
    const t = await mount({ maxConcurrentFetches: 1 });
    t.autoResolve(true);
    await t.report(100, 130);
    await t.advance(FRAME);
    t.autoResolve(false);
    const before = t.starts().length;
    act(() => t.server().refresh());
    await t.report(100, 170);
    await t.land(110);
    await t.land(120);
    await t.land(100);
    expect(t.starts().slice(before)).toEqual([110, 120, 100, 130]);
  });

  it("queues the blocks of a retry behind the cap", async () => {
    const t = await mount({ maxConcurrentFetches: 1 });
    await t.report(100, 130);
    await act(async () => t.latest(110).reject());
    await act(async () => t.latest(100).reject());
    await act(async () => t.latest(120).reject());
    expect(t.server().status).toBe("error");
    const before = t.starts().length;
    act(() => t.server().retry());
    expect(t.starts().length - before).toBe(1);
    expect(t.server().loading).toBe(true);
  });

  it("clamps an invalid maxConcurrentFetches to 3", async () => {
    const t = await mount({ maxConcurrentFetches: Number.NaN });
    await t.report(100, 200);
    expect(t.open()).toHaveLength(3);
  });
});

describe("bounded cache", () => {
  async function scrollThrough(t: Awaited<ReturnType<typeof mount>>, blocks: number) {
    for (let block = 1; block < blocks; block++) {
      await t.report(block * 10, block * 10 + 10);
      await t.land(block * 10);
    }
  }

  it("evicts the least recently viewed blocks and keeps the keep range", async () => {
    const t = await mount({ maxLoadedRows: 40 });
    await scrollThrough(t, 10);
    expect(t.loadedRows()).toBeLessThanOrEqual(40);
    expect(t.server().getLoadedRanges()).toEqual([{ start: 60, end: 100 }]);
    expect(t.dataAt(95)).toEqual(person(95));
    expect(t.dataAt(5)).toBeUndefined();
    expect(t.server().unloadedCount).toBe(100_000 - 40);
  });

  it("fetches an evicted block again when it is viewed again", async () => {
    const t = await mount({ maxLoadedRows: 40 });
    await scrollThrough(t, 10);
    await t.report(0, 10);
    expect(t.open().map((request) => request.start)).toContain(0);
  });

  it("never exceeds the cap outside the keep range when the rendered rows rest", async () => {
    const t = await mount({ maxLoadedRows: 30 });
    await scrollThrough(t, 12);
    expect(t.loadedRows()).toBeLessThanOrEqual(30);
  });

  it("does not evict with Infinity", async () => {
    const t = await mount({ maxLoadedRows: Infinity });
    await scrollThrough(t, 10);
    expect(t.loadedRows()).toBe(100);
  });

  it("raises a maxLoadedRows below one block to one block", async () => {
    const t = await mount({ maxLoadedRows: 1 });
    await scrollThrough(t, 6);
    expect(t.loadedRows()).toBeLessThanOrEqual(20);
    expect(t.isLoaded(55)).toBe(true);
  });

  it("warns once in development for an invalid maxLoadedRows and uses 10,000", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = await mount({ maxLoadedRows: Number.NaN });
    await scrollThrough(t, 10);
    expect(t.loadedRows()).toBe(100);
    expect(warn.mock.calls.filter((call) => String(call[0]).includes("maxLoadedRows"))).toHaveLength(1);
  });

  it("keeps the row of an open edit session", async () => {
    const t = await mount({ maxLoadedRows: 40 });
    act(() => t.state().actions.startEditing({ rowId: "r5", columnId: "name" }));
    await scrollThrough(t, 10);
    expect(t.dataAt(5)).toBeDefined();
    expect(t.dataAt(5)).toEqual(person(5));
    expect(t.isLoaded(6)).toBe(false);
    expect(t.loadedRows()).toBeLessThanOrEqual(41);
  });

  it("keeps a row with a save in flight and unloads it on a later pass once the save settled", async () => {
    const t = await mount({ maxLoadedRows: 40 });
    act(() => t.state().actions.commitCellValue({ rowId: "r5", columnId: "name" }, "Saved"));
    await scrollThrough(t, 10);
    expect(t.dataAt(5)?.name).toBe("Saved");
    await t.settleSaves();
    await t.report(100, 110);
    await t.land(100);
    expect(t.dataAt(5)).toBeUndefined();
  });

  it("keeps a row with a save logged for an open request until the request has settled", async () => {
    const t = await mount({ maxLoadedRows: 50 });
    await scrollThrough(t, 5);
    await t.report(50, 60);
    act(() => t.state().actions.commitCellValue({ rowId: "r5", columnId: "name" }, "Saved"));
    await t.settleSaves();
    await t.report(60, 70);
    await t.land(60);
    expect(t.dataAt(5)).toBeDefined();
    expect(t.isLoaded(15)).toBe(false);
    await t.land(50);
    await t.report(70, 80);
    await t.land(70);
    expect(t.dataAt(5)).toBeUndefined();
  });

  it("keeps an edit with no onSave until a landed block replaces it", async () => {
    const t = await mount({ maxLoadedRows: 40 }, { onSave: false });
    act(() => t.state().actions.commitCellValue({ rowId: "r5", columnId: "name" }, "Local"));
    await scrollThrough(t, 10);
    expect(t.dataAt(5)?.name).toBe("Local");
    await t.report(0, 10);
    act(() => t.server().refresh());
    await t.landAll();
    expect(t.dataAt(5)?.name).toBe("Person 5");
    await scrollThrough(t, 10);
    expect(t.dataAt(5)).toBeUndefined();
  });

  it("keeps the row under the active cell when the rendered rows scroll far away", async () => {
    const t = await mount({ maxLoadedRows: 40 });
    act(() => t.state().actions.selectCell({ rowId: "r5", columnId: "name" }));
    await scrollThrough(t, 10);
    expect(t.dataAt(5)).toBeDefined();
    expect(t.dataAt(5)).toEqual(person(5));
  });

  it("keeps the checked rows when their blocks are evicted", async () => {
    const t = await mount({ maxLoadedRows: 40 });
    act(() => t.state().actions.setRowSelected(2, true));
    expect(getSelectedViewRows(t.state().selection)).toEqual([2]);
    await scrollThrough(t, 10);
    expect(t.isLoaded(2)).toBe(false);
    expect([...t.state().hiddenCheckedRowIds]).toEqual(["r2"]);
  });

  it("evicts no block of the keep range even when the cap is below it", async () => {
    const t = await mount({ maxLoadedRows: 10 });
    await t.report(50, 80);
    await t.land(50, 60, 70);
    expect(t.server().getLoadedRanges()).toEqual([{ start: 50, end: 80 }]);
  });
});

describe("kept slots", () => {
  async function keepSlot120(extra: Extra = {}) {
    const t = await mount({ blockSize: 50, maxLoadedRows: 50, ...extra });
    await t.report(100, 110);
    await t.land(100);
    act(() => t.state().actions.selectCell({ rowId: "r120", columnId: "name" }));
    await t.report(300, 310);
    await t.land(300);
    return t;
  }

  it("keeps the protected row but no longer claims its slot as loaded", async () => {
    const t = await keepSlot120();
    expect(t.dataAt(120)).toEqual(person(120));
    expect(t.isLoaded(120)).toBe(false);
    expect(t.dataAt(110)).toBeUndefined();
  });

  it("fetches the whole block again when the rendered rows come back, so requests stay on the block grid", async () => {
    const t = await keepSlot120();
    await t.report(100, 110);
    const request = t.latest(100);
    expect([request.start, request.end]).toEqual([100, 150]);
    await t.land(100);
    expect(t.idsOf("r120")).toBe(1);
    expect(t.isLoaded(120)).toBe(true);
  });

  it("shows a row that moved on the server once", async () => {
    const t = await keepSlot120();
    t.setShift(1);
    await t.report(100, 110);
    await t.land(100);
    expect(t.idsOf("r120")).toBe(1);
    expect(t.dataAt(121)?.id).toBe("r120");
  });

  it("clears the answered-empty slots of an evicted block, so the block loads whole again", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = await mount({ maxLoadedRows: 10 }, { repeatSlot: 5 });
    await t.report(10, 20);
    await t.land(10);
    await t.report(30, 40);
    await t.land(30);
    await t.report(0, 10);
    const request = t.latest(0);
    expect([request.start, request.end]).toEqual([0, 10]);
    expect(t.requests.filter((entry) => entry.start === 0 && !entry.signal.aborted).length).toBeGreaterThan(0);
  });

  it("fetches the blocks that the rendered rows came back to before the eviction rendered", async () => {
    const t = await mount({ maxLoadedRows: 40 });
    for (let block = 1; block < 9; block++) {
      await t.report(block * 10, block * 10 + 10);
      await t.land(block * 10);
    }
    await t.report(90, 110);
    await act(async () => {
      t.latest(90).resolve();
      t.latest(100).resolve();
      await vi.advanceTimersByTimeAsync(0);
      t.server().gridProps.onRenderedRowsChange({ start: 50, end: 70 });
    });
    expect(t.open().map((request) => request.start)).toContain(50);
  });

  it("keeps the row under the active cell and the edits without onSave through a revalidation tick", async () => {
    const t = await mount({ revalidateInterval: 5000 }, { onSave: false });
    act(() => t.state().actions.commitCellValue({ rowId: "r5", columnId: "name" }, "Local"));
    act(() => t.state().actions.selectCell({ rowId: "r6", columnId: "name" }));
    await t.report(300, 310);
    await t.land(300);
    await t.advance(5000);
    await t.landAll();
    expect(t.dataAt(5)?.name).toBe("Local");
    expect(t.dataAt(6)).toBeDefined();
    expect(t.dataAt(7)).toBeUndefined();
  });
});

describe("evict", () => {
  it("aborts the in-flight blocks it covers", async () => {
    const t = await mount();
    await t.report(100, 130);
    t.server().evict({ start: 100, end: 120 });
    expect(t.latest(100).signal.aborted).toBe(true);
    expect(t.latest(110).signal.aborted).toBe(true);
    expect(t.latest(120).signal.aborted).toBe(false);
  });

  it("does not let an evicted in-flight block land", async () => {
    const t = await mount();
    await t.report(100, 110);
    act(() => t.server().evict({ start: 100, end: 110 }));
    await act(async () => t.latest(100).resolve());
    await t.advance(FRAME);
    expect(t.isLoaded(100)).toBe(false);
    expect(t.server().loading).toBe(false);
  });

  it("keeps the rows with an open edit or a pending save and unloads the rest", async () => {
    const t = await mount();
    act(() => t.state().actions.startEditing({ rowId: "r2", columnId: "name" }));
    act(() => t.state().actions.commitCellValue({ rowId: "r4", columnId: "name" }, "Saved"));
    act(() => t.server().evict({ start: 0, end: 10 }));
    expect(t.server().getLoadedRanges()).toEqual([]);
    expect(t.dataAt(2)).toEqual(person(2));
    expect(t.dataAt(4)?.name).toBe("Saved");
    expect(t.dataAt(3)).toBeUndefined();
  });
});

describe("races and cleanup", () => {
  it("a spec change drops the waiting blocks and the timer, and nothing from the old spec lands", async () => {
    const t = await mount({ loadDelay: 100 });
    await t.report(100, 110);
    act(() => t.server().gridProps.onSortChange([{ columnId: "name", direction: "asc" }] as never));
    await t.advance(500);
    expect(t.starts().filter((start) => start === 100)).toHaveLength(0);
  });

  it("a spec change aborts the in-flight blocks", async () => {
    const t = await mount();
    await t.report(100, 110);
    act(() => t.server().gridProps.onSortChange([{ columnId: "name", direction: "asc" }] as never));
    expect(t.latest(100).signal.aborted).toBe(true);
  });

  it("a count change keeps the landing block, drops the waiting blocks, and refetches the rendered rows without the delay", async () => {
    const t = await mount({ loadDelay: 100 });
    await t.report(100, 110);
    await t.advance(100);
    await t.report(110, 140);
    expect(t.starts()).toEqual([0, 100]);
    t.setTotal(5000);
    await t.land(100);
    expect(t.server().totalRowCount).toBe(5000);
    expect(t.starts().slice(2)).toEqual([120, 110, 130]);
  });

  it("leaves no timer after unmount", async () => {
    const t = await mount({ loadDelay: 100 });
    await t.report(100, 110);
    t.view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(t.starts()).toEqual([0]);
  });

  it("leaves no timer or open request after unmount with blocks in flight", async () => {
    const t = await mount();
    await t.report(100, 130);
    t.view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(t.open()).toHaveLength(0);
  });

  it("starts each block once under StrictMode", async () => {
    const t = await mount({ loadDelay: 100 }, { strict: true });
    await t.report(100, 130);
    await t.advance(100);
    expect(t.starts().filter((start) => start === 100)).toHaveLength(1);
    expect(t.starts().filter((start) => start === 0)).toHaveLength(1);
  });
});

describe("sequential source", () => {
  type CursorRequest = { start: number; cursor: number | undefined; signal: AbortSignal; resolve: () => void };

  function setupSequence(extra: Partial<UseDataGridServerRowsScrollOptions<Row, number>> = {}) {
    const requests: CursorRequest[] = [];
    const fetchRows = vi.fn(
      ({ start, end, cursor, signal }: { start: number; end: number; cursor: number | undefined; signal: AbortSignal }) =>
        new Promise<ServerRowsAnswer<Row, number>>((resolve) => {
          const rows = Array.from({ length: end - start }, (_, i) => person(start + i));
          requests.push({ start, cursor, signal, resolve: () => resolve({ rows, nextCursor: end }) });
        }),
    );
    const view = renderHook(() => useDataGridServerRows<Row, number>({ mode: "scroll", getRowId: (row) => row.id, fetchRows, blockSize: 10, overscan: 0, ...extra }));
    const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
    const land = async (start: number) => {
      await act(async () => requests.find((request) => request.start === start && !request.signal.aborted)!.resolve());
      await advance(FRAME);
    };
    const report = (start: number, end: number) => act(() => view.result.current.gridProps.onRenderedRowsChange({ start, end }));
    return { view, requests, advance, land, report, starts: () => requests.map((request) => request.start) };
  }

  it("waits the load delay before it asks for the next block", async () => {
    const t = setupSequence({ loadDelay: 100 });
    await t.advance(0);
    await t.land(0);
    await t.report(0, 10);
    await t.advance(99);
    expect(t.starts()).toEqual([0]);
    await t.advance(1);
    expect(t.starts()).toEqual([0, 10]);
    expect(t.requests[1]!.cursor).toBe(10);
  });

  it("goes on at once after a block lands while the rendered rows still rest at the end", async () => {
    const t = setupSequence({ loadDelay: 100 });
    await t.advance(0);
    await t.land(0);
    await t.report(0, 20);
    await t.advance(100);
    await t.land(10);
    expect(t.starts()).toEqual([0, 10, 20]);
  });

  it("starts no request when the rendered rows leave the end before the delay ends", async () => {
    const t = setupSequence({ loadDelay: 100 });
    await t.advance(0);
    await t.land(0);
    await t.report(0, 10);
    await t.advance(60);
    await t.report(0, 3);
    await t.advance(200);
    expect(t.starts()).toEqual([0]);
  });

  it("with loadDelay 0 asks for the next block in the same call", async () => {
    const t = setupSequence({ loadDelay: 0 });
    await t.advance(0);
    await t.land(0);
    await t.report(0, 10);
    expect(t.starts()).toEqual([0, 10]);
  });

  it("does not abort the block in flight when the rendered rows move away", async () => {
    const t = setupSequence({ loadDelay: 0 });
    await t.advance(0);
    await t.land(0);
    await t.report(0, 10);
    await t.report(0, 2);
    expect(t.requests[1]!.signal.aborted).toBe(false);
  });

  it("keeps every loaded row and warns once for a maxLoadedRows that cannot apply", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = setupSequence({ loadDelay: 0, maxLoadedRows: 20 });
    await t.advance(0);
    await t.land(0);
    for (let end = 10; end <= 60; end += 10) {
      await t.report(0, end);
      await t.land(end);
    }
    expect(t.view.result.current.getLoadedRanges()).toEqual([{ start: 0, end: 70 }]);
    expect(warn.mock.calls.filter((call) => String(call[0]).includes("sequential source"))).toHaveLength(1);
  });

  it("does not warn when maxLoadedRows is not passed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = setupSequence({ loadDelay: 0 });
    await t.advance(0);
    await t.land(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("leaves no timer after unmount while the delay runs", async () => {
    const t = setupSequence({ loadDelay: 100 });
    await t.advance(0);
    await t.land(0);
    await t.report(0, 10);
    t.view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
