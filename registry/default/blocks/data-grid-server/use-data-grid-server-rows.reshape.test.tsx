import { StrictMode } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataGridProvider, DataGridRoot, defineColumns, type RowRange, type SortSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridStoreApi } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { useDataGridServerRows, type ServerRowsAnswer, type ServerRowsRequest, type UseDataGridServerRowsOptions, type UseDataGridServerRowsScrollOptions } from "./use-data-grid-server-rows";

type Row = { id: string; name: string; price: number };
type Fetch = (request: ServerRowsRequest<number>) => Promise<ServerRowsAnswer<Row, number>>;

const columns = defineColumns<Row>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text" },
  { id: "price", header: "Price", accessorKey: "price", type: "number" },
] as const);
const person = (i: number): Row => ({ id: `r${i}`, name: `Person ${i}`, price: 10 });
const SORTED = { sorts: [{ columnId: "name", direction: "asc" as const }], filters: [], searchText: "" };

function server({ total = 100 } = {}) {
  const state = { hold: false, fail: false, override: {} as Record<string, Partial<Row>> };
  const held: Array<() => void> = [];
  const fetchRows = vi.fn(
    ({ start, end }: { start: number; end: number }) =>
      new Promise<ServerRowsAnswer<Row>>((resolve, reject) => {
        if (state.fail) return reject(new Error("boom"));
        const answer = () => resolve({ rows: Array.from({ length: Math.max(0, Math.min(end, total) - start) }, (_, i) => ({ ...person(start + i), ...state.override[`r${start + i}`] })), totalRowCount: total });
        if (state.hold) held.push(answer);
        else answer();
      }),
  );
  const releaseHeld = () => held.splice(0).forEach((answer) => answer());
  const settleHeld = () => act(async () => void releaseHeld());
  return { fetchRows, state, settleHeld, releaseHeld };
}

const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const setVisibility = (value: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value });
  act(() => void document.dispatchEvent(new Event("visibilitychange")));
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "requestAnimationFrame", "cancelAnimationFrame"] });
});
afterEach(() => {
  setVisibility("visible");
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type PagesExtra = Partial<UseDataGridServerRowsOptions<Row>>;
type ScrollExtra = Partial<UseDataGridServerRowsScrollOptions<Row>>;

type Server = {
  providerProps: object;
  gridProps: { onSortChange: (sorts: SortSpec[]) => void; onRenderedRowsChange?: (range: RowRange) => void };
  reshape: () => void;
  refresh: () => void;
  pager?: { onPageChange: (page: number) => void };
  retry: () => void;
  error: unknown;
};

/** The hook outside the provider, the way an app mounts it, with the grid's store exposed for pushes. */
function mountGrid(use: () => Server, strict = false) {
  let server!: Server;
  let store!: ReturnType<typeof useDataGridStoreApi>;
  function Probe() {
    store = useDataGridStoreApi();
    return null;
  }
  function Harness() {
    server = use();
    return (
      <DataGridProvider columns={columns} {...server.providerProps}>
        <DataGridRoot>
          <Probe />
        </DataGridRoot>
      </DataGridProvider>
    );
  }
  const view = render(strict ? <StrictMode><Harness /></StrictMode> : <Harness />);
  const actions = () => store.getState().actions;
  return {
    server: () => server,
    view,
    push: (rowId: string, value = "Aaron", options?: Parameters<ReturnType<typeof actions>["updateCells"]>[1]) => act(() => void actions().updateCells([{ rowId, columnId: "name", value }], options)),
    pushNow: async (rowId: string, value: string | undefined, changes?: Partial<Row>) => void (changes ? actions().updateRows([{ rowId, changes }]) : actions().updateCells([{ rowId, columnId: "name", value }])),
    deleteByServer: (...ids: string[]) => act(() => void actions().deleteRows(ids, { source: "stream" })),
    reconcile: () => act(() => void actions().reconcileView()),
    error: () => server.error,
    ids: () => (store.getState().data as readonly (Row | undefined)[]).map((row) => row?.id),
    goToPage: (page: number) => act(() => server.pager!.onPageChange(page)),
    stale: () => [...store.getState().staleRowIds].sort(),
    row: (rowId: string) => (store.getState().data as readonly (Row | undefined)[]).find((row) => row?.id === rowId),
    pushCells: (rowId: string, changes: Partial<Row>) => act(() => void actions().updateRows([{ rowId, changes }])),
    name: (rowId: string) => (store.getState().data as readonly (Row | undefined)[]).find((row) => row?.id === rowId)?.name,
    report: (range: RowRange) => act(() => server.gridProps.onRenderedRowsChange?.(range as never)),
  };
}

async function pages(s: ReturnType<typeof server>, extra: PagesExtra = {}, strict = false) {
  const grid = mountGrid(() => useDataGridServerRows<Row>({ getRowId: (row) => row.id, fetchRows: s.fetchRows, defaultPageSize: 10, pageSizeOptions: [10], defaultSpec: SORTED, ...extra }), strict);
  await advance(0);
  return grid;
}

async function scroll(s: ReturnType<typeof server>, extra: ScrollExtra = {}, strict = false) {
  const grid = mountGrid(() => useDataGridServerRows<Row>({ mode: "scroll", getRowId: (row) => row.id, fetchRows: s.fetchRows, blockSize: 10, overscan: 0, loadDelayMs: 0, defaultSpec: SORTED, ...extra }), strict);
  await advance(0);
  grid.report({ start: 0, end: 10 });
  await advance(0);
  return grid;
}

describe.each([
  ["pages", pages],
  ["scroll", scroll],
] as const)("reshape, %s mode", (_name, mount) => {
  it("marks a deferred push and sends no request without reshapeDelayMs", async () => {
    const s = server();
    const grid = await mount(s);
    grid.push("r1");
    await advance(10_000);
    expect(grid.stale()).toEqual(["r1"]);
    expect(s.fetchRows).toHaveBeenCalledTimes(1);
  });

  it("reshapes once after the delay, however many pushes joined the timer", async () => {
    const s = server();
    const grid = await mount(s, { reshapeDelayMs: 1000 });
    grid.push("r1");
    await advance(400);
    grid.push("r2");
    await advance(500);
    grid.push("r3");
    await advance(99);
    expect(s.fetchRows).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(s.fetchRows).toHaveBeenCalledTimes(2);
    await advance(5000);
    expect(s.fetchRows).toHaveBeenCalledTimes(2);
    expect(grid.stale()).toEqual([]);
  });

  it("starts the next timer for a push during the reshape request", async () => {
    const s = server();
    const grid = await mount(s, { reshapeDelayMs: 1000 });
    grid.push("r1");
    s.state.hold = true;
    await advance(1000);
    expect(s.fetchRows).toHaveBeenCalledTimes(2);
    await advance(100);
    grid.push("r2");
    await advance(400);
    s.state.hold = false;
    await s.settleHeld();
    expect(s.fetchRows).toHaveBeenCalledTimes(2);
    await advance(599);
    expect(s.fetchRows).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(s.fetchRows).toHaveBeenCalledTimes(3);
  });

  it("waits for a request in flight when the timer fires and runs once after it settles", async () => {
    const s = server();
    const grid = await mount(s, { reshapeDelayMs: 1000 });
    grid.push("r1");
    s.state.hold = true;
    await advance(1000);
    expect(s.fetchRows).toHaveBeenCalledTimes(2);
    grid.push("r2");
    await advance(1000);
    expect(s.fetchRows).toHaveBeenCalledTimes(2);
    s.state.hold = false;
    await s.settleHeld();
    await advance(0);
    expect(s.fetchRows).toHaveBeenCalledTimes(3);
    await advance(5000);
    expect(s.fetchRows).toHaveBeenCalledTimes(3);
  });

  it("sends one request on the next frame for a stream delete", async () => {
    const s = server();
    const grid = await mount(s);
    grid.deleteByServer("r1");
    expect(s.fetchRows).toHaveBeenCalledTimes(1);
    await advance(20);
    expect(s.fetchRows).toHaveBeenCalledTimes(2);
  });

  it("joins three reshape() calls in one frame", async () => {
    const s = server();
    const grid = await mount(s);
    act(() => {
      grid.server().reshape();
      grid.server().reshape();
      grid.server().reshape();
    });
    await advance(20);
    expect(s.fetchRows).toHaveBeenCalledTimes(2);
  });

  it("makes a stream delete and reshape() follow the delay when one is set", async () => {
    const s = server();
    const grid = await mount(s, { reshapeDelayMs: 1000 });
    grid.deleteByServer("r1");
    act(() => grid.server().reshape());
    await advance(999);
    expect(s.fetchRows).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(s.fetchRows).toHaveBeenCalledTimes(2);
  });

  it("makes reconcileView() and an immediate push reshape on the next frame despite the delay", async () => {
    const s = server();
    const grid = await mount(s, { reshapeDelayMs: 5000 });
    grid.push("r1");
    grid.reconcile();
    await advance(20);
    expect(s.fetchRows).toHaveBeenCalledTimes(2);
    grid.push("r2", "Abe", { reorder: "immediate" });
    await advance(20);
    expect(s.fetchRows).toHaveBeenCalledTimes(3);
  });

  it("keeps the marks until the answer re-delivers the rows", async () => {
    const s = server();
    const grid = await mount(s);
    grid.push("r1");
    grid.reconcile();
    s.state.hold = true;
    await advance(20);
    expect(grid.stale()).toEqual(["r1"]);
    s.state.hold = false;
    await s.settleHeld();
    expect(grid.stale()).toEqual([]);
  });

  it("cancels the timer when the spec changes", async () => {
    const s = server();
    const grid = await mount(s, { reshapeDelayMs: 1000 });
    grid.push("r1");
    await advance(500);
    act(() => grid.server().gridProps.onSortChange([]));
    await advance(0);
    const afterSpecChange = s.fetchRows.mock.calls.length;
    expect(afterSpecChange).toBe(2);
    await advance(5000);
    expect(s.fetchRows).toHaveBeenCalledTimes(afterSpecChange);
  });

  it("cancels the timer when the hook unmounts", async () => {
    const s = server();
    const grid = await mount(s, { reshapeDelayMs: 1000 });
    grid.push("r1");
    grid.view.unmount();
    await advance(5000);
    expect(s.fetchRows).toHaveBeenCalledTimes(1);
  });

  it("sends one request per delay under StrictMode", async () => {
    const s = server();
    const grid = await mount(s, { reshapeDelayMs: 1000 }, true);
    const before = s.fetchRows.mock.calls.length;
    grid.push("r1");
    await advance(1000);
    expect(s.fetchRows).toHaveBeenCalledTimes(before + 1);
    await advance(5000);
    expect(s.fetchRows).toHaveBeenCalledTimes(before + 1);
  });

  it("waits while the document is hidden and runs once when it shows again", async () => {
    const s = server();
    const grid = await mount(s, { reshapeDelayMs: 1000 });
    setVisibility("hidden");
    grid.push("r1");
    await advance(5000);
    expect(s.fetchRows).toHaveBeenCalledTimes(1);
    setVisibility("visible");
    await advance(0);
    expect(s.fetchRows).toHaveBeenCalledTimes(2);
  });

  it("raises reshapeDelayMs below 250 ms to 250 and warns once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = server();
    const grid = await mount(s, { reshapeDelayMs: 100 });
    grid.push("r1");
    await advance(249);
    expect(s.fetchRows).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(s.fetchRows).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.filter((call) => String(call[0]).includes("reshapeDelayMs"))).toHaveLength(1);
  });

  it.each([0, -1, Number.NaN])("treats reshapeDelayMs %s as off and warns once", async (value) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = server();
    const grid = await mount(s, { reshapeDelayMs: value });
    grid.push("r1");
    await advance(10_000);
    expect(s.fetchRows).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.filter((call) => String(call[0]).includes("reshapeDelayMs"))).toHaveLength(1);
  });

  it("keeps a push made after the request left when its answer lands", async () => {
    const s = server();
    const grid = await mount(s);
    s.state.hold = true;
    act(() => grid.server().refresh());
    await advance(20);
    grid.push("r1", "Pushed");
    s.state.hold = false;
    await s.settleHeld();
    expect(grid.name("r1")).toBe("Pushed");
    expect(grid.name("r2")).toBe("Person 2");
  });

  it("lets the answer win over a push made before the request left", async () => {
    const s = server();
    const grid = await mount(s);
    grid.push("r2", "Old");
    s.state.hold = true;
    act(() => grid.server().refresh());
    await advance(20);
    s.state.hold = false;
    await s.settleHeld();
    expect(grid.name("r2")).toBe("Person 2");
    expect(grid.stale()).toEqual([]);
  });

  it("keeps the pushed cell only for the pushed column", async () => {
    const s = server();
    const grid = await mount(s);
    s.state.hold = true;
    act(() => grid.server().refresh());
    await advance(20);
    grid.push("r1", "Pushed");
    s.state.hold = false;
    await s.settleHeld();
    grid.push("r1", "Later");
    expect(grid.name("r1")).toBe("Later");
  });

  it("drops the copy of a row that a stream delete removed while an answer was in flight", async () => {
    const s = server();
    const grid = await mount(s, { reshapeDelayMs: 60_000 });
    s.state.hold = true;
    act(() => grid.server().refresh());
    await advance(20);
    grid.deleteByServer("r1");
    s.state.hold = false;
    await s.settleHeld();
    expect(grid.name("r1")).toBeUndefined();
    expect(grid.name("r2")).toBe("Person 2");
  });

  it("keeps the marks and reports the failure when the reshape request fails, and retry() repeats it", async () => {
    const s = server();
    const grid = await mount(s, { reshapeDelayMs: 1000 });
    grid.push("r1");
    s.state.fail = true;
    await advance(1000);
    expect(grid.error()).toBeInstanceOf(Error);
    expect(grid.stale()).toEqual(["r1"]);
    s.state.fail = false;
    act(() => grid.server().retry());
    await advance(20);
    expect(grid.error()).toBeNull();
    expect(grid.stale()).toEqual([]);
  });

  it("lays only the pushed cell on a row that landed between the push and its render", async () => {
    const s = server();
    const grid = await mount(s);
    grid.pushCells("r2", { name: "A", price: 5 });
    s.state.override["r2"] = { name: "B", price: 10 };
    s.state.hold = true;
    act(() => grid.server().refresh());
    await advance(20);
    s.state.hold = false;
    await act(async () => {
      s.releaseHeld();
      for (let i = 0; i < 20; i++) await Promise.resolve();
      await grid.pushNow("r2", undefined, { price: 7 });
    });
    expect(grid.row("r2")).toMatchObject({ name: "B", price: 7 });
  });

  it("a reshape request equals the refresh request", async () => {
    const s = server();
    const grid = await mount(s);
    act(() => grid.server().refresh());
    await advance(20);
    act(() => grid.server().reshape());
    await advance(20);
    const [, refreshCall, reshapeCall] = s.fetchRows.mock.calls.map(([request]) => {
      const { signal: _signal, ...rest } = request as unknown as Record<string, unknown>;
      return rest;
    });
    expect(reshapeCall).toEqual(refreshCall);
  });
});

describe("a push between a landing and its render, pages mode", () => {
  const flushMicrotasks = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };

  it("shows the landed page, not the page the push was made on", async () => {
    const s = server();
    const grid = await pages(s);
    s.state.hold = true;
    grid.goToPage(2);
    await advance(20);
    s.state.hold = false;
    await act(async () => {
      s.releaseHeld();
      await flushMicrotasks();
      await grid.pushNow("r2", "Pushed");
    });
    expect(grid.ids()).toEqual(Array.from({ length: 10 }, (_, i) => `r${10 + i}`));
    expect(grid.name("r2")).toBeUndefined();
  });

  it("keeps a push on a refresh of the same page", async () => {
    const s = server();
    const grid = await pages(s);
    s.state.hold = true;
    act(() => grid.server().refresh());
    await advance(20);
    s.state.hold = false;
    await act(async () => {
      s.releaseHeld();
      await flushMicrotasks();
      await grid.pushNow("r2", "Pushed");
    });
    expect(grid.ids()).toHaveLength(10);
    expect(grid.name("r2")).toBe("Pushed");
  });
});

describe("reshape, sequential source", () => {
  const rowsOf = (from: number, count: number): Row[] => Array.from({ length: count }, (_, i) => person(from + i));
  const offsetSource = () => vi.fn<Fetch>(async ({ start, end }) => ({ rows: rowsOf(start, Math.min(end, 1000) - start), hasMore: end < 1000 }));

  function mountSequence(fetchRows: Fetch, extra: Partial<UseDataGridServerRowsScrollOptions<Row, number>> = {}) {
    return mountGrid(() => useDataGridServerRows<Row, number>({ mode: "scroll", getRowId: (row) => row.id, fetchRows, blockSize: 10, overscan: 0, loadDelayMs: 0, defaultSpec: SORTED, ...extra }));
  }

  it("shifts the next block start by the rows a stream delete removed", async () => {
    const fetchRows = offsetSource();
    const grid = mountSequence(fetchRows, { reshapeDelayMs: 60_000 });
    await advance(0);
    grid.report({ start: 0, end: 10 });
    await advance(0);
    grid.deleteByServer("r1");
    grid.report({ start: 0, end: 20 });
    await advance(0);
    const starts = fetchRows.mock.calls.map(([request]) => request.start);
    expect(starts).toEqual([0, 10, 19]);
  });

  it("skips a reshape while the rendered rows end beyond 10 blocks", async () => {
    const fetchRows = offsetSource();
    const grid = mountSequence(fetchRows);
    await advance(0);
    grid.report({ start: 0, end: 150 });
    await advance(100);
    const before = fetchRows.mock.calls.length;
    grid.deleteByServer("r1");
    await advance(100);
    expect(fetchRows.mock.calls.length).toBe(before);
  });

  it("reshapes from the first block while the rendered rows end within 10 blocks", async () => {
    const fetchRows = offsetSource();
    const grid = mountSequence(fetchRows);
    await advance(0);
    grid.report({ start: 0, end: 20 });
    await advance(100);
    const before = fetchRows.mock.calls.length;
    grid.deleteByServer("r1");
    await advance(100);
    expect(fetchRows.mock.calls.length).toBeGreaterThan(before);
    expect(fetchRows.mock.calls[before]![0].start).toBe(0);
  });
});
