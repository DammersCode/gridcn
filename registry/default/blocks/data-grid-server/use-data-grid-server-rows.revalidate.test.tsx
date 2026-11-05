import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDataGridServerRows, type ServerRowsAnswer, type UseDataGridServerRowsOptions, type UseDataGridServerRowsScrollOptions } from "./use-data-grid-server-rows";

type Row = { id: string; name: string };
type Held = { start: number; signal: AbortSignal; resolve: () => void; reject: () => void; settled: boolean };

const person = (i: number): Row => ({ id: `r${i}`, name: `Person ${i}` });

function server({ hold = false, total = 1000, fail = false } = {}) {
  const held: Held[] = [];
  const state = { hold, fail };
  const fetchRows = vi.fn(
    ({ start, end, signal }: { start: number; end: number; signal: AbortSignal }) =>
      new Promise<ServerRowsAnswer<Row>>((resolve, reject) => {
        const answer = (): ServerRowsAnswer<Row> => ({ rows: Array.from({ length: Math.max(0, Math.min(end, total) - start) }, (_, i) => person(start + i)), totalRowCount: total });
        const entry: Held = { start, signal, settled: false, resolve: () => ((entry.settled = true), resolve(answer())), reject: () => ((entry.settled = true), reject(new Error("boom"))) };
        held.push(entry);
        if (state.fail) entry.reject();
        else if (!state.hold) entry.resolve();
      }),
  );
  return { fetchRows, held, state };
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

async function mountPages(s: ReturnType<typeof server>, extra: PagesExtra = {}) {
  const view = renderHook(() => useDataGridServerRows<Row>({ getRowId: (row) => row.id, fetchRows: s.fetchRows, defaultPageSize: 10, pageSizeOptions: [10], ...extra }));
  await advance(0);
  return view;
}

async function mountScroll(s: ReturnType<typeof server>, extra: ScrollExtra = {}) {
  const view = renderHook(() => useDataGridServerRows<Row>({ mode: "scroll", getRowId: (row) => row.id, fetchRows: s.fetchRows, blockSize: 10, overscan: 0, loadDelay: 0, ...extra }));
  await advance(0);
  return view;
}

describe.each([
  ["pages", mountPages],
  ["scroll", mountScroll],
] as const)("revalidateInterval, %s mode", (_name, mount) => {
  it("refreshes at the interval and never before", async () => {
    const s = server();
    await mount(s, { revalidateInterval: 5000 });
    expect(s.fetchRows).toHaveBeenCalledTimes(1);
    await advance(4999);
    expect(s.fetchRows).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(s.fetchRows).toHaveBeenCalledTimes(2);
    await advance(5000);
    expect(s.fetchRows).toHaveBeenCalledTimes(3);
  });

  it("is off without the option", async () => {
    const s = server();
    await mount(s);
    await advance(60_000);
    expect(s.fetchRows).toHaveBeenCalledTimes(1);
  });

  it("raises an interval below one second to one second", async () => {
    const s = server();
    await mount(s, { revalidateInterval: 10 });
    await advance(999);
    expect(s.fetchRows).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(s.fetchRows).toHaveBeenCalledTimes(2);
  });

  it.each([0, -5, Number.NaN, Infinity])("is off and warns once for the invalid interval %s", async (value) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = server();
    const view = await mount(s, { revalidateInterval: value });
    view.rerender();
    await advance(60_000);
    expect(s.fetchRows).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.filter((call) => String(call[0]).includes("revalidateInterval"))).toHaveLength(1);
  });

  it("does not warn when the option is missing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await mount(server());
    expect(warn.mock.calls.filter((call) => String(call[0]).includes("revalidateInterval"))).toHaveLength(0);
  });

  it("waits for a request in flight and runs once, however many ticks passed", async () => {
    const s = server();
    await mount(s, { revalidateInterval: 2000 });
    s.state.hold = true;
    await advance(2000);
    expect(s.fetchRows).toHaveBeenCalledTimes(2);
    await advance(10_000);
    expect(s.fetchRows).toHaveBeenCalledTimes(2);
    await act(async () => s.held.filter((entry) => !entry.settled).forEach((entry) => entry.resolve()));
    await advance(20);
    expect(s.fetchRows).toHaveBeenCalledTimes(3);
    await advance(1999);
    expect(s.fetchRows).toHaveBeenCalledTimes(3);
  });

  it("does not run a waiting tick while the page is hidden, and runs it once the page is visible", async () => {
    const s = server();
    await mount(s, { revalidateInterval: 2000 });
    s.state.hold = true;
    await advance(2000);
    expect(s.fetchRows).toHaveBeenCalledTimes(2);
    await advance(2000);
    setVisibility("hidden");
    await act(async () => s.held.filter((entry) => !entry.settled).forEach((entry) => entry.resolve()));
    await advance(20);
    expect(s.fetchRows).toHaveBeenCalledTimes(2);
    s.state.hold = false;
    setVisibility("visible");
    await advance(20);
    expect(s.fetchRows).toHaveBeenCalledTimes(3);
  });

  it("restarts the clock on a manual refresh", async () => {
    const s = server();
    const view = await mount(s, { revalidateInterval: 5000 });
    await advance(4000);
    act(() => view.result.current.refresh());
    await advance(20);
    expect(s.fetchRows).toHaveBeenCalledTimes(2);
    await advance(4000);
    expect(s.fetchRows).toHaveBeenCalledTimes(2);
    await advance(1000);
    expect(s.fetchRows).toHaveBeenCalledTimes(3);
  });

  it("stops while the page is hidden and runs once at once when it turns visible with a tick due", async () => {
    const s = server();
    await mount(s, { revalidateInterval: 5000 });
    setVisibility("hidden");
    await advance(30_000);
    expect(s.fetchRows).toHaveBeenCalledTimes(1);
    setVisibility("visible");
    await advance(20);
    expect(s.fetchRows).toHaveBeenCalledTimes(2);
  });

  it("re-arms for the rest of the interval when the page turns visible before a tick is due", async () => {
    const s = server();
    await mount(s, { revalidateInterval: 5000 });
    await advance(1000);
    setVisibility("hidden");
    await advance(1000);
    setVisibility("visible");
    await advance(2999);
    expect(s.fetchRows).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(s.fetchRows).toHaveBeenCalledTimes(2);
  });

  it("keeps ticking after an error", async () => {
    const s = server();
    const view = await mount(s, { revalidateInterval: 3000 });
    s.state.fail = true;
    await advance(3000);
    await advance(20);
    expect(view.result.current.status).toBe("error");
    await advance(3000);
    expect(s.fetchRows).toHaveBeenCalledTimes(3);
  });

  it("restarts the clock when the spec changes", async () => {
    const s = server();
    const view = await mount(s, { revalidateInterval: 5000 });
    await advance(4000);
    act(() => view.result.current.gridProps.onSearchTextChange("a"));
    await advance(20);
    const afterChange = s.fetchRows.mock.calls.length;
    await advance(4900);
    expect(s.fetchRows).toHaveBeenCalledTimes(afterChange);
    await advance(100);
    expect(s.fetchRows).toHaveBeenCalledTimes(afterChange + 1);
  });

  it("leaves no timer or listener after unmount", async () => {
    const s = server();
    const view = await mount(s, { revalidateInterval: 5000 });
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    await advance(60_000);
    expect(s.fetchRows).toHaveBeenCalledTimes(1);
  });

  it("starts nothing on a hook that unmounted while a tick waited", async () => {
    const s = server();
    const view = await mount(s, { revalidateInterval: 2000 });
    s.state.hold = true;
    await advance(2000);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("revalidateInterval, scroll mode", () => {
  it("refetches the rendered blocks and drops the other loaded rows", async () => {
    const s = server();
    const view = await mountScroll(s, { revalidateInterval: 5000 });
    act(() => view.result.current.gridProps.onRenderedRowsChange({ start: 100, end: 110 }));
    await advance(20);
    s.fetchRows.mockClear();
    act(() => view.result.current.gridProps.onRenderedRowsChange({ start: 300, end: 310 }));
    await advance(20);
    s.fetchRows.mockClear();
    await advance(5000);
    await advance(20);
    expect(s.fetchRows.mock.calls.map(([request]) => request.start)).toEqual([300]);
    expect(view.result.current.getLoadedRanges()).toEqual([{ start: 300, end: 310 }]);
  });
});

describe("revalidateInterval, sequential source", () => {
  function sequence() {
    const requests: Array<{ start: number }> = [];
    const fetchRows = vi.fn(async ({ start, end }: { start: number; end: number; cursor: number | undefined }) => {
      requests.push({ start });
      return { rows: Array.from({ length: end - start }, (_, i) => person(start + i)), nextCursor: end } satisfies ServerRowsAnswer<Row, number>;
    });
    return { fetchRows, requests };
  }
  const mountSequence = async (s: ReturnType<typeof sequence>) => {
    const view = renderHook(() => useDataGridServerRows<Row, number>({ mode: "scroll", getRowId: (row) => row.id, fetchRows: s.fetchRows, blockSize: 10, overscan: 0, loadDelay: 0, revalidateInterval: 3000 }));
    await advance(0);
    await advance(20);
    return view;
  };

  it("refreshes from the first block up to the rendered rows", async () => {
    const s = sequence();
    const view = await mountSequence(s);
    act(() => view.result.current.gridProps.onRenderedRowsChange({ start: 0, end: 20 }));
    await advance(20);
    await advance(20);
    s.requests.length = 0;
    await advance(3000);
    await advance(100);
    expect(s.requests.map((request) => request.start).slice(0, 2)).toEqual([0, 10]);
  });

  it("skips a tick while the rendered rows end beyond 10 blocks and tries again at the next one", async () => {
    const s = sequence();
    const view = await mountSequence(s);
    for (let end = 10; end <= 130; end += 10) {
      act(() => view.result.current.gridProps.onRenderedRowsChange({ start: end - 10, end }));
      await advance(20);
    }
    s.fetchRows.mockClear();
    await advance(3000);
    await advance(100);
    expect(s.fetchRows).not.toHaveBeenCalled();
    act(() => view.result.current.gridProps.onRenderedRowsChange({ start: 0, end: 10 }));
    await advance(20);
    s.fetchRows.mockClear();
    await advance(3000);
    await advance(100);
    expect(s.fetchRows.mock.calls.length).toBeGreaterThan(0);
  });
});
