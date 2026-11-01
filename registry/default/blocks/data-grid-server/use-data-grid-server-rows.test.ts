import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDataGridServerRows, type ServerRowsFetchContext, type ServerRowsPage } from "./use-data-grid-server-rows";

type Row = { id: string };

const rowsOf = (from: number, count: number): Row[] => Array.from({ length: count }, (_, i) => ({ id: `r${from + i}` }));

type Fetch = (ctx: ServerRowsFetchContext) => Promise<ServerRowsPage<Row>>;

function server(total = 95) {
  return vi.fn<Fetch>(async ({ page, pageSize }) => {
    const from = (page - 1) * pageSize;
    return { rows: rowsOf(from, Math.max(0, Math.min(pageSize, total - from))), total: total };
  });
}

const make = (fetchRows: Fetch, extra = {}) => renderHook(() => useDataGridServerRows<Row>({ getRowId: (r) => r.id, fetchRows, defaultPageSize: 10, ...extra }));

afterEach(() => vi.restoreAllMocks());

describe("useDataGridServerRows", () => {
  it("fetches page 1 on mount, shows loading until it lands, then the rows and the count", async () => {
    const fetchRows = server();
    const { result } = make(fetchRows);
    expect(result.current.gridProps.loading).toBe(true);
    expect(result.current.gridProps.data).toEqual([]);
    await waitFor(() => expect(result.current.gridProps.loading).toBe(false));
    expect(fetchRows).toHaveBeenCalledTimes(1);
    expect(fetchRows.mock.calls[0]![0]).toMatchObject({ page: 1, pageSize: 10, spec: { sorts: [], filters: [], search: "" } });
    expect(result.current.gridProps.data).toHaveLength(10);
    expect(result.current.gridProps.totalRowCount).toBe(95);
    expect(result.current.pager).toMatchObject({ page: 1, pageSize: 10, total: 95, pageCount: 10 });
    expect(result.current.gridProps).toMatchObject({ sortMode: "server", filterMode: "server", headerClickBehavior: "sort" });
  });

  it("a page change fetches that page and keeps the old rows until it lands", async () => {
    const fetchRows = server();
    const { result } = make(fetchRows);
    await waitFor(() => expect(result.current.gridProps.loading).toBe(false));
    act(() => result.current.pager.onPageChange(3));
    expect(result.current.gridProps.loading).toBe(true);
    expect(result.current.gridProps.data[0]).toEqual({ id: "r0" });
    await waitFor(() => expect(result.current.gridProps.loading).toBe(false));
    expect(result.current.gridProps.data[0]).toEqual({ id: "r20" });
  });

  it("a spec change goes back to page 1 and sends the spec", async () => {
    const fetchRows = server();
    const { result } = make(fetchRows);
    await waitFor(() => expect(result.current.gridProps.loading).toBe(false));
    act(() => result.current.pager.onPageChange(4));
    await waitFor(() => expect(result.current.gridProps.loading).toBe(false));
    expect(result.current.pager.page).toBe(4);
    act(() => result.current.gridProps.onFilterChange([{ filterId: "f", columnId: "id", operator: "contains", value: "1" }] as never));
    await waitFor(() => expect(fetchRows.mock.calls.at(-1)![0].spec.filters).toHaveLength(1));
    expect(fetchRows.mock.calls.at(-1)![0].page).toBe(1);
    act(() => result.current.gridProps.onSortChange([{ columnId: "id", direction: "desc" }]));
    await waitFor(() => expect(fetchRows.mock.calls.at(-1)![0].spec.sorts).toEqual([{ columnId: "id", direction: "desc" }]));
    act(() => result.current.gridProps.onSearchTextChange("zz"));
    await waitFor(() => expect(fetchRows.mock.calls.at(-1)![0].spec.search).toBe("zz"));
    expect(result.current.gridProps.sortState).toEqual([{ columnId: "id", direction: "desc" }]);
    expect(result.current.gridProps.searchText).toBe("zz");
  });

  it("a page-size change goes back to page 1", async () => {
    const fetchRows = server();
    const { result } = make(fetchRows);
    await waitFor(() => expect(result.current.gridProps.loading).toBe(false));
    act(() => result.current.pager.onPageChange(2));
    await waitFor(() => expect(result.current.gridProps.loading).toBe(false));
    act(() => result.current.pager.onPageSizeChange(25));
    await waitFor(() => expect(fetchRows.mock.calls.at(-1)![0]).toMatchObject({ page: 1, pageSize: 25 }));
  });

  it("aborts the request of a superseded state and ignores its late answer", async () => {
    const answers: Array<(page: ServerRowsPage<Row>) => void> = [];
    const signals: AbortSignal[] = [];
    const fetchRows = vi.fn<Fetch>(({ signal }) => {
      signals.push(signal);
      return new Promise((resolve) => answers.push(resolve));
    });
    const { result } = make(fetchRows);
    await waitFor(() => expect(fetchRows).toHaveBeenCalledTimes(1));
    act(() => result.current.pager.onPageChange(2));
    await waitFor(() => expect(fetchRows).toHaveBeenCalledTimes(2));
    expect(signals[0]!.aborted).toBe(true);
    answers[1]!({ rows: rowsOf(10, 10), total: 95 });
    await waitFor(() => expect(result.current.gridProps.data[0]).toEqual({ id: "r10" }));
    answers[0]!({ rows: rowsOf(0, 10), total: 95 });
    await act(async () => {});
    expect(result.current.gridProps.data[0]).toEqual({ id: "r10" });
  });

  it("an error keeps the last good rows, retry repeats the request, and the error clears with it", async () => {
    let fail = false;
    const fetchRows = vi.fn<Fetch>(async ({ page, pageSize }) => {
      if (fail) throw new Error("down");
      return { rows: rowsOf((page - 1) * pageSize, pageSize), total: 95 };
    });
    const { result } = make(fetchRows);
    await waitFor(() => expect(result.current.gridProps.loading).toBe(false));
    fail = true;
    act(() => result.current.pager.onPageChange(2));
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.gridProps.error).toBe(result.current.error);
    expect(result.current.gridProps.data[0]).toEqual({ id: "r0" });
    expect(result.current.status).toBe("error");
    fail = false;
    act(() => result.current.retry());
    expect(result.current.error).toBeNull();
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.gridProps.data[0]).toEqual({ id: "r10" });
    expect(fetchRows).toHaveBeenCalledTimes(3);
  });

  it("retry does nothing without an error, refresh always refetches", async () => {
    const fetchRows = server();
    const { result } = make(fetchRows);
    await waitFor(() => expect(result.current.gridProps.loading).toBe(false));
    act(() => result.current.retry());
    await act(async () => {});
    expect(fetchRows).toHaveBeenCalledTimes(1);
    act(() => result.current.refresh());
    await waitFor(() => expect(fetchRows).toHaveBeenCalledTimes(2));
  });

  it("without a total the pager uses hasNextPage and totalRowCount is null", async () => {
    const fetchRows = vi.fn<Fetch>(async ({ page }) => ({ rows: rowsOf((page - 1) * 10, 10), hasNextPage: page < 3 }));
    const { result } = make(fetchRows);
    await waitFor(() => expect(result.current.gridProps.loading).toBe(false));
    expect(result.current.gridProps.totalRowCount).toBeNull();
    expect(result.current.pager).toMatchObject({ total: undefined, hasNextPage: true });
  });

  it("warns once and keeps only pageSize rows when the answer is longer", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchRows = vi.fn<Fetch>(async () => ({ rows: rowsOf(0, 15), total: 15 }));
    const { result } = make(fetchRows);
    await waitFor(() => expect(result.current.gridProps.loading).toBe(false));
    expect(result.current.gridProps.data).toHaveLength(10);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("a non-array answer is an error", async () => {
    const fetchRows = vi.fn(async () => ({ rows: "oops" })) as unknown as Fetch;
    const { result } = make(fetchRows);
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
  });

  it("aborts the request on unmount", async () => {
    let signal!: AbortSignal;
    const fetchRows = vi.fn<Fetch>((ctx) => {
      signal = ctx.signal;
      return new Promise(() => {});
    });
    const { unmount } = make(fetchRows);
    await waitFor(() => expect(fetchRows).toHaveBeenCalled());
    unmount();
    expect(signal.aborted).toBe(true);
  });

  it("onDataChange keeps edits, and a later page replaces them", async () => {
    const fetchRows = server();
    const { result } = make(fetchRows);
    await waitFor(() => expect(result.current.gridProps.loading).toBe(false));
    act(() => result.current.gridProps.onDataChange([{ id: "edited" }]));
    expect(result.current.gridProps.data).toEqual([{ id: "edited" }]);
    act(() => result.current.pager.onPageChange(2));
    await waitFor(() => expect(result.current.gridProps.data[0]).toEqual({ id: "r10" }));
  });

  it("a synchronous throw in fetchRows is an error, not a crash", async () => {
    const fetchRows = vi.fn<Fetch>(() => {
      throw new Error("sync");
    });
    const { result } = make(fetchRows);
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
  });

  it("without hasNextPage a full page means another page exists", async () => {
    const fetchRows = vi.fn<Fetch>(async () => ({ rows: rowsOf(0, 10) }));
    const { result } = make(fetchRows);
    await waitFor(() => expect(result.current.gridProps.loading).toBe(false));
    expect(result.current.pager.hasNextPage).toBe(true);
  });

  it("the page clamps when the total shrinks below it", async () => {
    let total = 95;
    const fetchRows = vi.fn<Fetch>(async ({ page, pageSize }) => ({ rows: rowsOf((page - 1) * pageSize, 5), total: total }));
    const { result } = make(fetchRows);
    await waitFor(() => expect(result.current.gridProps.loading).toBe(false));
    act(() => result.current.pager.onPageChange(9));
    await waitFor(() => expect(result.current.gridProps.loading).toBe(false));
    total = 20;
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.pager.page).toBe(2));
  });

  it("exposes the provider and root parts of gridProps", async () => {
    const { result } = make(server());
    await waitFor(() => expect(result.current.gridProps.loading).toBe(false));
    expect(Object.keys(result.current.rootProps).sort()).toEqual(["error", "loading", "onRetry"]);
    expect("loading" in result.current.providerProps).toBe(false);
    expect(result.current.gridProps).toMatchObject({ ...result.current.rootProps });
  });

  it("starts from defaultSpec", async () => {
    const fetchRows = server();
    make(fetchRows, { defaultSpec: { search: "ann" } });
    await waitFor(() => expect(fetchRows).toHaveBeenCalled());
    expect(fetchRows.mock.calls[0]![0].spec.search).toBe("ann");
  });
});
