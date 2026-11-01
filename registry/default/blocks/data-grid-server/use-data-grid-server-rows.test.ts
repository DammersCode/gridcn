import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDataGridServerRows, type ServerRowsPageRequest, type ServerRowsAnswer, type UseDataGridServerRowsOptions } from "./use-data-grid-server-rows";
import type { ServerSpec } from "@/registry/default/blocks/data-grid/data-grid";

type Row = { id: string };

const rowsOf = (from: number, count: number): Row[] => Array.from({ length: count }, (_, i) => ({ id: `r${from + i}` }));

type Fetch = (ctx: ServerRowsPageRequest) => Promise<ServerRowsAnswer<Row>>;

function server(total = 95) {
  return vi.fn<Fetch>(async ({ page, pageSize }) => {
    const from = (page - 1) * pageSize;
    return { rows: rowsOf(from, Math.max(0, Math.min(pageSize, total - from))), totalRowCount: total };
  });
}

const make = (fetchRows: Fetch, extra: Partial<UseDataGridServerRowsOptions<Row>> = {}) => renderHook(() => useDataGridServerRows<Row>({ getRowId: (r) => r.id, fetchRows, defaultPageSize: 10, ...extra }));

afterEach(() => vi.restoreAllMocks());

describe("useDataGridServerRows", () => {
  it("fetches page 1 on mount, shows loading until it lands, then the rows and the count", async () => {
    const fetchRows = server();
    const { result } = make(fetchRows);
    expect(result.current.gridProps.loading).toBe(true);
    expect(result.current.gridProps.data).toEqual([]);
    await waitFor(() => expect(result.current.gridProps.loading).toBe(false));
    expect(fetchRows).toHaveBeenCalledTimes(1);
    expect(fetchRows.mock.calls[0]![0]).toMatchObject({ page: 1, pageSize: 10, start: 0, end: 10, cursor: undefined, spec: { sorts: [], filters: [], searchText: "" } });
    expect(result.current.gridProps.data).toHaveLength(10);
    expect(result.current.gridProps.totalRowCount).toBe(95);
    expect(result.current.pager).toMatchObject({ page: 1, pageSize: 10, totalRowCount: 95, pageCount: 10 });
    expect(result.current.gridProps).toMatchObject({ sortMode: "server", filterMode: "server", keepCheckedRows: true });
    expect("headerClickBehavior" in result.current.gridProps).toBe(false);
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
    await waitFor(() => expect(fetchRows.mock.calls.at(-1)![0].spec.searchText).toBe("zz"));
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
    const answers: Array<(page: ServerRowsAnswer<Row>) => void> = [];
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
    answers[1]!({ rows: rowsOf(10, 10), totalRowCount: 95 });
    await waitFor(() => expect(result.current.gridProps.data[0]).toEqual({ id: "r10" }));
    answers[0]!({ rows: rowsOf(0, 10), totalRowCount: 95 });
    await act(async () => {});
    expect(result.current.gridProps.data[0]).toEqual({ id: "r10" });
  });

  it("an error keeps the last good rows, retry repeats the request, and the error clears with it", async () => {
    let fail = false;
    const fetchRows = vi.fn<Fetch>(async ({ page, pageSize }) => {
      if (fail) throw new Error("down");
      return { rows: rowsOf((page - 1) * pageSize, pageSize), totalRowCount: 95 };
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

  it("without a count the pager uses hasMore and totalRowCount is null", async () => {
    const fetchRows = vi.fn<Fetch>(async ({ page }) => ({ rows: rowsOf((page - 1) * 10, 10), hasMore: page < 3 }));
    const { result } = make(fetchRows);
    await waitFor(() => expect(result.current.gridProps.loading).toBe(false));
    expect(result.current.gridProps.totalRowCount).toBeNull();
    expect(result.current.pager).toMatchObject({ totalRowCount: null, hasNextPage: true });
  });

  it("warns once and keeps only pageSize rows when the answer is longer", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchRows = vi.fn<Fetch>(async () => ({ rows: rowsOf(0, 15), totalRowCount: 15 }));
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
    act(() => result.current.gridProps.onDataChange([{ id: "edited" }], {} as never));
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

  it("without hasMore a full page means another page exists", async () => {
    const fetchRows = vi.fn<Fetch>(async () => ({ rows: rowsOf(0, 10) }));
    const { result } = make(fetchRows);
    await waitFor(() => expect(result.current.gridProps.loading).toBe(false));
    expect(result.current.pager.hasNextPage).toBe(true);
  });

  it("the page clamps when the total shrinks below it", async () => {
    let total = 95;
    const fetchRows = vi.fn<Fetch>(async ({ page, pageSize }) => ({ rows: rowsOf((page - 1) * pageSize, 5), totalRowCount: total }));
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
    make(fetchRows, { defaultSpec: { searchText: "ann" } });
    await waitFor(() => expect(fetchRows).toHaveBeenCalled());
    expect(fetchRows.mock.calls[0]![0].spec.searchText).toBe("ann");
  });

  it("sends start and end derived from the page and the page size", async () => {
    const fetchRows = server();
    const { result } = make(fetchRows);
    await waitFor(() => expect(result.current.gridProps.loading).toBe(false));
    act(() => result.current.pager.onPageChange(3));
    await waitFor(() => expect(fetchRows).toHaveBeenCalledTimes(2));
    expect(fetchRows.mock.calls[1]![0]).toMatchObject({ page: 3, pageSize: 10, start: 20, end: 30, cursor: undefined });
  });

  it("keeps the identity of every callback across renders and after the rows land", async () => {
    const { result, rerender } = make(server());
    const pick = () => {
      const { gridProps, providerProps, rootProps, retry, refresh, pager } = result.current;
      return [
        gridProps.getRowId,
        gridProps.onDataChange,
        gridProps.onSortChange,
        gridProps.onFilterChange,
        gridProps.onSearchTextChange,
        providerProps.onDataChange,
        rootProps.onRetry,
        retry,
        refresh,
        pager.onPageChange,
        pager.onPageSizeChange,
      ];
    };
    const first = pick();
    rerender();
    pick().forEach((fn, i) => expect(fn).toBe(first[i]));
    await waitFor(() => expect(result.current.gridProps.loading).toBe(false));
    rerender();
    pick().forEach((fn, i) => expect(fn).toBe(first[i]));
  });

  describe("hostile answers", () => {
    const answerWith = (extra: Record<string, unknown>) => vi.fn(async () => ({ rows: rowsOf(0, 10), ...extra })) as unknown as Fetch;

    it.each([
      ["negative", -1],
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["fractional", 4.5],
      ["a string", "95"],
    ])("a %s totalRowCount reads as unknown and warns once", async (_name, totalRowCount) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { result } = make(answerWith({ totalRowCount }));
      await waitFor(() => expect(result.current.gridProps.loading).toBe(false));
      expect(result.current.gridProps.totalRowCount).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it("clamps a count of 1e12 to ten million", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { result } = make(answerWith({ totalRowCount: 1e12 }));
      await waitFor(() => expect(result.current.gridProps.loading).toBe(false));
      expect(result.current.gridProps.totalRowCount).toBe(10_000_000);
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it("keeps 10k rows out of a page of 25", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const fetchRows = vi.fn<Fetch>(async () => ({ rows: rowsOf(0, 10_000), totalRowCount: 10_000 }));
      const { result } = make(fetchRows, { defaultPageSize: 25 });
      await waitFor(() => expect(result.current.gridProps.loading).toBe(false));
      expect(result.current.gridProps.data).toHaveLength(25);
    });

    it.each([
      ["a string", "oops"],
      ["null", null],
      ["an object", {}],
    ])("%s as rows is an error and keeps no rows", async (_name, rows) => {
      const { result } = make(vi.fn(async () => ({ rows })) as unknown as Fetch);
      await waitFor(() => expect(result.current.status).toBe("error"));
      expect(result.current.gridProps.data).toEqual([]);
    });

    it("a missing answer is an error", async () => {
      const { result } = make(vi.fn(async () => undefined) as unknown as Fetch);
      await waitFor(() => expect(result.current.status).toBe("error"));
    });

    it("warns once when the answer uses the old names", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { result } = make(answerWith({ total: 95, hasNextPage: true }));
      await waitFor(() => expect(result.current.gridProps.loading).toBe(false));
      act(() => result.current.refresh());
      await waitFor(() => expect(result.current.gridProps.loading).toBe(false));
      expect(warn.mock.calls.filter(([message]) => String(message).includes("totalRowCount"))).toHaveLength(1);
    });
  });

  it("an omitted count keeps the last known one and null declares it unknown", async () => {
    let answer: Record<string, unknown> = { totalRowCount: 95 };
    const fetchRows = vi.fn(async () => ({ rows: rowsOf(0, 10), ...answer })) as unknown as Fetch;
    const { result } = make(fetchRows);
    await waitFor(() => expect(result.current.gridProps.totalRowCount).toBe(95));
    answer = {};
    act(() => result.current.refresh());
    await waitFor(() => expect(fetchRows).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.gridProps.loading).toBe(false));
    expect(result.current.gridProps.totalRowCount).toBe(95);
    answer = { totalRowCount: null };
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.gridProps.totalRowCount).toBeNull());
  });

  it("refresh keeps the rows on screen while the answer is on its way", async () => {
    const { result } = make(server());
    await waitFor(() => expect(result.current.gridProps.loading).toBe(false));
    act(() => result.current.refresh());
    expect(result.current.loading).toBe(true);
    expect(result.current.gridProps.data).toHaveLength(10);
  });

  it("a failed request reads as status error and not loading", async () => {
    const { result } = make(
      vi.fn<Fetch>(async () => {
        throw new Error("down");
      }),
    );
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.loading).toBe(false);
  });

  describe("options", () => {
    it("onLoaded reports the range of the answered rows and onError the failure", async () => {
      const onLoaded = vi.fn();
      const onError = vi.fn();
      let fail = false;
      const fetchRows = vi.fn<Fetch>(async ({ page, pageSize }) => {
        if (fail) throw new Error("down");
        return { rows: rowsOf((page - 1) * pageSize, pageSize), totalRowCount: 95 };
      });
      const { result } = make(fetchRows, { onLoaded, onError });
      await waitFor(() => expect(onLoaded).toHaveBeenCalledWith({ start: 0, end: 10 }));
      fail = true;
      act(() => result.current.pager.onPageChange(2));
      await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
      expect(onError.mock.calls[0]![0]).toBeInstanceOf(Error);
      expect(onLoaded).toHaveBeenCalledTimes(1);
    });

    it("a throwing onLoaded does not drop the answer", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { result } = make(server(), {
        onLoaded: () => {
          throw new Error("boom");
        },
      });
      await waitFor(() => expect(result.current.status).toBe("ready"));
      expect(result.current.gridProps.data).toHaveLength(10);
    });

    it("onDataChange runs after the hook keeps the edit, with the change", async () => {
      const seen: unknown[] = [];
      const { result } = make(server(), { onDataChange: (next, change) => seen.push([next, change]) });
      await waitFor(() => expect(result.current.gridProps.loading).toBe(false));
      const change = { source: "edit" } as never;
      act(() => result.current.gridProps.onDataChange([{ id: "edited" }], change));
      expect(result.current.gridProps.data).toEqual([{ id: "edited" }]);
      expect(seen).toEqual([[[{ id: "edited" }], change]]);
    });
  });

  describe("controlled pairs", () => {
    const specOf = (searchText = ""): ServerSpec => ({ sorts: [], filters: [], searchText });

    it("a controlled spec is the one sent, and a grid change goes to onSpecChange without moving the hook", async () => {
      const onSpecChange = vi.fn();
      const fetchRows = server();
      const { result, rerender } = renderHook(
        ({ spec }: { spec: ServerSpec }) => useDataGridServerRows<Row>({ getRowId: (r) => r.id, fetchRows, defaultPageSize: 10, spec, onSpecChange }),
        { initialProps: { spec: specOf("ann") } },
      );
      await waitFor(() => expect(fetchRows).toHaveBeenCalledTimes(1));
      expect(fetchRows.mock.calls[0]![0].spec.searchText).toBe("ann");
      act(() => result.current.gridProps.onSearchTextChange("bob"));
      expect(onSpecChange).toHaveBeenCalledWith({ sorts: [], filters: [], searchText: "bob" });
      expect(result.current.gridProps.searchText).toBe("ann");
      rerender({ spec: specOf("bob") });
      await waitFor(() => expect(fetchRows).toHaveBeenCalledTimes(2));
      expect(fetchRows.mock.calls[1]![0].spec.searchText).toBe("bob");
    });

    it("an equal spec with a new identity does not refetch", async () => {
      const fetchRows = server();
      const { rerender } = renderHook(
        ({ spec }: { spec: ServerSpec }) => useDataGridServerRows<Row>({ getRowId: (r) => r.id, fetchRows, defaultPageSize: 10, spec, onSpecChange: () => {} }),
        { initialProps: { spec: specOf("ann") } },
      );
      await waitFor(() => expect(fetchRows).toHaveBeenCalledTimes(1));
      rerender({ spec: specOf("ann") });
      await act(async () => {});
      expect(fetchRows).toHaveBeenCalledTimes(1);
    });

    it("a controlled page and page size are sent and changes go to their callbacks", async () => {
      const onPageChange = vi.fn();
      const onPageSizeChange = vi.fn();
      const fetchRows = server();
      const { result } = make(fetchRows, { page: 3, onPageChange, pageSize: 25, onPageSizeChange });
      await waitFor(() => expect(fetchRows).toHaveBeenCalledTimes(1));
      expect(fetchRows.mock.calls[0]![0]).toMatchObject({ page: 3, pageSize: 25, start: 50, end: 75 });
      act(() => result.current.pager.onPageChange(4));
      expect(onPageChange).toHaveBeenCalledWith(4);
      expect(result.current.pager.page).toBe(3);
      act(() => result.current.pager.onPageSizeChange(50));
      expect(onPageSizeChange).toHaveBeenCalledWith(50);
      expect(result.current.pager.pageSize).toBe(25);
    });

    it("a spec change after the first answer asks the owner of the page for page 1", async () => {
      const onPageChange = vi.fn();
      const { result } = make(server(), { page: 3, onPageChange });
      await waitFor(() => expect(result.current.gridProps.loading).toBe(false));
      act(() => result.current.gridProps.onSearchTextChange("zz"));
      expect(onPageChange).toHaveBeenCalledWith(1);
    });

    it("a spec restored before the first answer keeps the deep-linked page", () => {
      const onPageChange = vi.fn();
      const { result } = make(
        vi.fn<Fetch>(() => new Promise(() => {})),
        { page: 3, onPageChange },
      );
      act(() => result.current.gridProps.onSortChange([{ columnId: "id", direction: "desc" }]));
      expect(onPageChange).not.toHaveBeenCalled();
    });

    it("a page below 1 is sent as page 1", async () => {
      const fetchRows = server();
      make(fetchRows, { page: -4, onPageChange: () => {} });
      await waitFor(() => expect(fetchRows).toHaveBeenCalled());
      expect(fetchRows.mock.calls[0]![0]).toMatchObject({ page: 1, start: 0 });
    });
  });
});
