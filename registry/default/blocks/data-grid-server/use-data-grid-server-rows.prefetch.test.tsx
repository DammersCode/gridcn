import { act, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import { DataGridProvider, DataGridRoot, defineColumns, type DataChange } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridStoreApi } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import type { DataGridStoreState } from "@/registry/default/blocks/data-grid/store";
import { useDataGridServerRows, type ServerRowsAnswer, type ServerRowsPageRequest, type UseDataGridServerRowsOptions, type UseDataGridServerRowsResult } from "./use-data-grid-server-rows";

type Row = { id: string; name: string };
type Call = { page: number; request: ServerRowsPageRequest; settled: boolean; resolve: () => void; reject: () => void };

const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text" }] as const);
const person = (i: number): Row => ({ id: `r${i}`, name: `Person ${i}` });
const PAGE = 10;

function server({ total = 100 as number | null, hold = false, fail = false, answer }: { total?: number | null; hold?: boolean; fail?: boolean; answer?: (page: number) => Row[] } = {}) {
  const calls: Call[] = [];
  const state = { hold, fail, total };
  const fetchRows = vi.fn(
    (request: ServerRowsPageRequest) =>
      new Promise<ServerRowsAnswer<Row>>((resolve, reject) => {
        const rows = answer ? answer(request.page) : Array.from({ length: Math.max(0, Math.min(request.end, state.total ?? request.end) - request.start) }, (_, i) => person(request.start + i));
        const call: Call = { page: request.page, request, settled: false, resolve: () => ((call.settled = true), resolve(state.total === null ? { rows, hasMore: request.page < 3 } : { rows, totalRowCount: state.total })), reject: () => ((call.settled = true), reject(new Error("boom"))) };
        calls.push(call);
        if (state.fail) call.reject();
        else if (!state.hold) call.resolve();
      }),
  );
  return { fetchRows, calls, state, pages: () => calls.map((call) => call.page), open: () => calls.filter((call) => !call.settled && !call.request.signal.aborted) };
}

const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "requestAnimationFrame", "cancelAnimationFrame"] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Extra = Partial<UseDataGridServerRowsOptions<Row>>;

async function mount(s: ReturnType<typeof server>, extra: Extra = {}, holdAhead = false) {
  const renders: Array<{ loading: boolean; first: string | undefined; page: number }> = [];
  const view = renderHook(
    (props: Extra) => {
      const result = useDataGridServerRows<Row>({ getRowId: (row) => row.id, fetchRows: s.fetchRows, defaultPageSize: PAGE, pageSizeOptions: [PAGE, 20], prefetchNextPage: true, ...extra, ...props });
      renders.push({ loading: result.loading, first: result.gridProps.data[0]?.id, page: result.pager.page });
      return result;
    },
    { initialProps: {} as Extra },
  );
  await advance(0);
  if (holdAhead) s.state.hold = true;
  await advance(0);
  return { ...view, renders };
}

const goTo = (view: { result: { current: UseDataGridServerRowsResult<Row> } }, page: number) => act(() => view.result.current.pager.onPageChange(page));

describe("prefetchNextPage", () => {
  it("requests the page after the current one once the current page landed, as a plain page request", async () => {
    const s = server();
    await mount(s);
    expect(s.pages()).toEqual([1, 2]);
    expect(s.calls[1]!.request).toMatchObject({ page: 2, pageSize: PAGE, start: 10, end: 20, cursor: undefined, spec: { sorts: [], filters: [], searchText: "" } });
    expect(s.calls[1]!.request.signal).toBeInstanceOf(AbortSignal);
  });

  it("is off by default", async () => {
    const s = server();
    await mount(s, { prefetchNextPage: undefined });
    await advance(60_000);
    expect(s.pages()).toEqual([1]);
  });

  it("shows the prefetched page with no request and no loading render, then prefetches the next one", async () => {
    const s = server();
    const view = await mount(s);
    const onLoaded = vi.fn();
    view.rerender({ onLoaded });
    view.renders.length = 0;
    goTo(view, 2);
    expect(s.pages()).toEqual([1, 2]);
    expect(view.renders.every((entry) => !entry.loading)).toBe(true);
    expect(view.renders.at(-1)).toMatchObject({ first: "r10", page: 2 });
    expect(view.result.current.gridProps.data.map((row) => row.id)).toEqual(Array.from({ length: PAGE }, (_, i) => `r${10 + i}`));
    expect(onLoaded).toHaveBeenCalledWith({ start: 10, end: 20 });
    await advance(0);
    expect(s.pages()).toEqual([1, 2, 3]);
    expect(view.result.current.status).toBe("ready");
  });

  it("adopts a request in flight as the page request: no second request, loading until it lands", async () => {
    const s = server();
    const view = await mount(s, {}, true);
    goTo(view, 2);
    expect(s.pages()).toEqual([1, 2]);
    expect(view.result.current.loading).toBe(true);
    await act(async () => s.calls[1]!.resolve());
    expect(view.result.current.loading).toBe(false);
    expect(view.result.current.gridProps.data[0]?.id).toBe("r10");
    expect(s.pages().filter((page) => page === 2)).toHaveLength(1);
  });

  it("does not let a prefetch land after the user moved on", async () => {
    const s = server();
    const view = await mount(s, {}, true);
    goTo(view, 3);
    expect(s.calls[1]!.request.signal.aborted).toBe(true);
    s.state.hold = false;
    await advance(0);
    await act(async () => s.calls[1]!.resolve());
    await advance(20);
    expect(view.result.current.gridProps.data[0]?.id).toBe("r20");
    expect(view.result.current.pager.page).toBe(3);
  });

  it("fetches normally when the pager goes to a page that was not prefetched, and drops the entry", async () => {
    const s = server();
    const view = await mount(s);
    goTo(view, 5);
    expect(s.calls[1]!.settled).toBe(true);
    await advance(0);
    expect(s.pages().slice(2)).toEqual([5]);
    await advance(0);
    expect(s.pages().slice(2)).toEqual([5, 6]);
    goTo(view, 4);
    await advance(0);
    expect(s.pages().filter((page) => page === 4)).toHaveLength(1);
  });

  it("aborts an entry in flight when the pager goes elsewhere", async () => {
    const s = server();
    const view = await mount(s, {}, true);
    goTo(view, 4);
    expect(s.calls[1]!.request.signal.aborted).toBe(true);
  });

  it("drops the entry on a spec change and prefetches again after the new first page", async () => {
    const s = server();
    const view = await mount(s);
    act(() => view.result.current.gridProps.onSearchTextChange("a"));
    await advance(0);
    await advance(0);
    expect(s.calls.at(-2)!.request.spec.searchText).toBe("a");
    expect(s.calls.at(-1)!.request).toMatchObject({ page: 2, spec: { searchText: "a" } });
    const before = s.calls.length;
    goTo(view, 2);
    expect(s.calls.length).toBe(before);
    expect(view.result.current.gridProps.data[0]?.id).toBe("r10");
  });

  it("drops the entry on a page size change", async () => {
    const s = server();
    const view = await mount(s);
    act(() => view.result.current.pager.onPageSizeChange(20));
    await advance(0);
    expect(s.calls.at(-1)!.request).toMatchObject({ page: 1, pageSize: 20 });
    await advance(0);
    expect(s.calls.at(-1)!.request).toMatchObject({ page: 2, pageSize: 20, start: 20, end: 40 });
  });

  it("drops the entry on refresh and prefetches again after the refreshed page landed", async () => {
    const s = server();
    const view = await mount(s);
    act(() => view.result.current.refresh());
    await advance(0);
    expect(s.pages()).toEqual([1, 2, 1]);
    await advance(0);
    expect(s.pages()).toEqual([1, 2, 1, 2]);
  });

  it.each(["insert", "delete", "reorder"] as const)("drops the entry on a local %s, so the next page loads from the server", async (type) => {
    const s = server();
    const view = await mount(s);
    act(() => view.result.current.gridProps.onDataChange(view.result.current.gridProps.data, { source: "row-operation", ops: [{ type, rowId: "r1" }] } as never));
    await advance(0);
    expect(s.pages()).toEqual([1, 2]);
    expect(view.result.current.gridProps.data.length).toBeGreaterThan(0);
    goTo(view, 2);
    expect(view.result.current.loading).toBe(true);
    await advance(0);
    expect(s.pages().filter((page) => page === 2)).toHaveLength(2);
  });

  it("keeps the entry on a local cell edit", async () => {
    const s = server();
    const view = await mount(s);
    act(() => view.result.current.gridProps.onDataChange(view.result.current.gridProps.data, { source: "edit", ops: [{ type: "update", rowId: "r1" }] } as never));
    goTo(view, 2);
    expect(view.result.current.loading).toBe(false);
    expect(s.pages().filter((page) => page === 2)).toHaveLength(1);
  });

  it("drops a landed entry older than 30 seconds", async () => {
    const s = server();
    const view = await mount(s);
    await advance(30_001);
    goTo(view, 2);
    expect(view.result.current.loading).toBe(true);
    await advance(0);
    expect(s.pages().filter((page) => page === 2)).toHaveLength(2);
  });

  it("keeps a landed entry younger than 30 seconds", async () => {
    const s = server();
    const view = await mount(s);
    await advance(29_000);
    goTo(view, 2);
    expect(view.result.current.loading).toBe(false);
  });

  it("is silent when the prefetch fails: no error, no onError, no retry", async () => {
    const onError = vi.fn();
    const s = server();
    const view = await mount(s, { onError }, true);
    await act(async () => s.calls[1]!.reject());
    await advance(60_000);
    expect(onError).not.toHaveBeenCalled();
    expect(view.result.current.error).toBeNull();
    expect(view.result.current.status).toBe("ready");
    expect(s.pages()).toEqual([1, 2]);
  });

  it("reports the failure of its own request when the user then goes to the failed page", async () => {
    const onError = vi.fn();
    const s = server();
    const view = await mount(s, { onError }, true);
    await act(async () => s.calls[1]!.reject());
    s.state.hold = false;
    s.state.fail = true;
    goTo(view, 2);
    await advance(0);
    expect(view.result.current.status).toBe("error");
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("reports the failure when an adopted request in flight fails", async () => {
    const onError = vi.fn();
    const s = server();
    const view = await mount(s, { onError }, true);
    goTo(view, 2);
    await act(async () => s.calls[1]!.reject());
    expect(view.result.current.status).toBe("error");
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("does not prefetch past the last page", async () => {
    const s = server({ total: 15 });
    const view = await mount(s);
    expect(s.pages()).toEqual([1, 2]);
    goTo(view, 2);
    await advance(60_000);
    expect(s.pages()).toEqual([1, 2]);
  });

  it("prefetches while the count is unknown and hasMore is true, and stops when hasMore ends", async () => {
    const s = server({ total: null });
    const view = await mount(s);
    expect(s.pages()).toEqual([1, 2]);
    goTo(view, 2);
    await advance(0);
    expect(s.pages()).toEqual([1, 2, 3]);
    goTo(view, 3);
    await advance(60_000);
    expect(s.pages()).toEqual([1, 2, 3]);
  });

  it("adopts on a controlled page change", async () => {
    const s = server();
    const onPageChange = vi.fn();
    const view = await mount(s, { page: 1, onPageChange });
    view.rerender({ page: 2 });
    expect(view.result.current.loading).toBe(false);
    expect(view.result.current.gridProps.data[0]?.id).toBe("r10");
    expect(s.pages().filter((page) => page === 2)).toHaveLength(1);
  });

  it("ignores the count and hasMore of an entry that was not adopted", async () => {
    const s = server({ answer: (page) => (page === 1 ? Array.from({ length: PAGE }, (_, i) => person(i)) : [person(10)]) });
    const view = await mount(s);
    expect(view.result.current.pager.hasMore).toBe(true);
    expect(view.result.current.totalRowCount).toBe(100);
  });

  it("leaves no timer or request after unmount", async () => {
    const s = server();
    const view = await mount(s, {}, true);
    view.unmount();
    expect(s.calls[1]!.request.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves no timer after unmount with a landed entry", async () => {
    const s = server();
    const view = await mount(s);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("prefetchNextPage with the refresh guard", () => {
  function mountGrid(s: ReturnType<typeof server>) {
    let result!: UseDataGridServerRowsResult<Row>;
    let store!: StoreApi<DataGridStoreState>;
    const saves: Array<() => void> = [];
    const onSave = (_change: DataChange<Row>) => new Promise<void>((resolve) => saves.push(resolve));
    function Probe() {
      store = useDataGridStoreApi() as unknown as StoreApi<DataGridStoreState>;
      return null;
    }
    function Harness() {
      result = useDataGridServerRows<Row>({ getRowId: (row) => row.id, fetchRows: s.fetchRows, defaultPageSize: PAGE, pageSizeOptions: [PAGE], prefetchNextPage: true });
      return (
        <DataGridProvider {...result.providerProps} columns={columns} onSave={onSave}>
          <DataGridRoot>
            <Probe />
          </DataGridRoot>
        </DataGridProvider>
      );
    }
    render(<Harness />);
    return { result: () => result, store: () => store.getState(), saves };
  }

  const sharedRow = (page: number) => (page === 2 ? [{ id: "r5", name: "Person 5" }, ...Array.from({ length: PAGE - 1 }, (_, i) => person(10 + i))] : Array.from({ length: PAGE }, (_, i) => person((page - 1) * PAGE + i)));

  it("keeps the local value of a row saved after the prefetch started, and of a row still saving", async () => {
    const s = server({ answer: sharedRow });
    const t = mountGrid(s);
    await advance(0);
    await advance(0);
    expect(s.pages()).toEqual([1, 2]);
    act(() => t.store().actions.commitCellValue({ rowId: "r5", columnId: "name" }, "Edited"));
    await act(async () => t.saves.splice(0).forEach((resolve) => resolve()));
    act(() => t.result().pager.onPageChange(2));
    const r5 = t.result().gridProps.data.find((row) => row.id === "r5");
    expect(r5?.name).toBe("Edited");
    expect(s.pages().filter((page) => page === 2)).toHaveLength(1);
  });

  it("drops the prefetched page when a save starts, so a row that moved to another page is not stale", async () => {
    let version = 0;
    const s = server({ answer: (page) => Array.from({ length: PAGE }, (_, i) => ({ id: `r${(page - 1) * PAGE + i}`, name: `v${version}` })) });
    const t = mountGrid(s);
    await advance(0);
    await advance(0);
    expect(s.pages()).toEqual([1, 2]);
    act(() => t.store().actions.commitCellValue({ rowId: "r1", columnId: "name" }, "Edited"));
    await act(async () => t.saves.splice(0).forEach((resolve) => resolve()));
    version = 1;
    act(() => t.result().pager.onPageChange(2));
    expect(t.result().loading).toBe(true);
    await advance(0);
    expect(s.pages().filter((page) => page === 2)).toHaveLength(2);
    expect(t.result().gridProps.data[0]?.name).toBe("v1");
  });

  it("fetches the page again when a save starts while the prefetch is the page request", async () => {
    const s = server({ answer: (page) => Array.from({ length: PAGE }, (_, i) => ({ id: `r${(page - 1) * PAGE + i}`, name: `p${page}` })) });
    const t = mountGrid(s);
    await advance(0);
    s.state.hold = true;
    await advance(0);
    act(() => t.result().pager.onPageChange(2));
    act(() => t.store().actions.commitCellValue({ rowId: "r1", columnId: "name" }, "Edited"));
    s.state.hold = false;
    await advance(0);
    expect(s.calls.filter((call) => call.page === 2 && !call.request.signal.aborted)).toHaveLength(1);
    expect(t.result().loading).toBe(false);
    expect(t.result().gridProps.data[0]?.name).toBe("p2");
  });

  it("prefetches again once the last pending save settled, so the next page shows with no request", async () => {
    const s = server();
    const t = mountGrid(s);
    await advance(0);
    await advance(0);
    act(() => t.store().actions.commitCellValue({ rowId: "r1", columnId: "name" }, "Edited"));
    await act(async () => t.saves.splice(0).forEach((resolve) => resolve()));
    await advance(0);
    expect(s.pages()).toEqual([1, 2, 2]);
    act(() => t.result().pager.onPageChange(2));
    expect(t.result().loading).toBe(false);
    expect(s.pages().filter((page) => page === 2)).toHaveLength(2);
  });

  it("starts no prefetch while a save is pending", async () => {
    const s = server();
    const t = mountGrid(s);
    await advance(0);
    await advance(0);
    act(() => t.result().pager.onPageChange(2));
    act(() => t.store().actions.commitCellValue({ rowId: "r11", columnId: "name" }, "Edited"));
    await advance(0);
    expect(s.pages()).toEqual([1, 2]);
  });

  it("replaces a row that no save touched", async () => {
    const s = server({ answer: sharedRow });
    const t = mountGrid(s);
    await advance(0);
    await advance(0);
    act(() => t.result().pager.onPageChange(2));
    expect(t.result().gridProps.data.find((row) => row.id === "r5")?.name).toBe("Person 5");
  });

  it("protects a save logged for the prefetch after the page request settled", async () => {
    const s = server({ answer: sharedRow, hold: true });
    const t = mountGrid(s);
    await advance(0);
    await act(async () => s.calls[0]!.resolve());
    await advance(0);
    act(() => t.store().actions.commitCellValue({ rowId: "r5", columnId: "name" }, "Late"));
    await act(async () => t.saves.splice(0).forEach((resolve) => resolve()));
    await act(async () => s.calls[1]!.resolve());
    act(() => t.result().pager.onPageChange(2));
    expect(t.result().gridProps.data.find((row) => row.id === "r5")?.name).toBe("Late");
  });
});
