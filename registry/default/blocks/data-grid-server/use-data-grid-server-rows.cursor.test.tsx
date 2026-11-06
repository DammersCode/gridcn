import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDataGridServerRows, type ServerRowsAnswer, type ServerRowsPageRequest } from "./use-data-grid-server-rows";

type Row = { id: string };
type Options = { searchText?: string; page?: number; onPageChange?: (page: number) => void; fail?: () => boolean };

const SIZE = 10;
const TOTAL = 25;

function setup(options: Options = {}) {
  const requests: { page: number; cursor: string | undefined }[] = [];
  const fetchRows = vi.fn(async ({ page, start, end, cursor }: ServerRowsPageRequest<string>): Promise<ServerRowsAnswer<Row, string>> => {
    requests.push({ page, cursor });
    if (options.fail?.()) throw new Error("offline");
    const to = Math.min(end, TOTAL);
    return { rows: Array.from({ length: to - start }, (_, i) => ({ id: `r${start + i}` })), nextCursor: to < TOTAL ? `after:${to - 1}` : null };
  });
  const hook = renderHook(
    (props: Options) =>
      useDataGridServerRows<Row, string>({ getRowId: (r) => r.id, fetchRows, defaultPageSize: SIZE, pageSizeOptions: [SIZE, 5], page: props.page, onPageChange: props.onPageChange, defaultSpec: { searchText: props.searchText ?? "" } }),
    { initialProps: options },
  );
  const settle = () => waitFor(() => expect(hook.result.current.loading).toBe(false));
  const goTo = async (page: number) => {
    act(() => hook.result.current.pager.onPageChange(page));
    await settle();
  };
  return { hook, requests, settle, goTo, fetchRows };
}

describe("cursor pages", () => {
  it("sends no cursor for page 1 and the stored cursor for the next page", async () => {
    const { hook, requests, settle, goTo } = setup();
    await settle();
    expect(hook.result.current.pager.hasNextPage).toBe(true);
    expect(hook.result.current.pager.totalRowCount).toBeNull();
    await goTo(2);
    expect(requests).toEqual([
      { page: 1, cursor: undefined },
      { page: 2, cursor: "after:9" },
    ]);
  });

  it("goes back with the stored cursor and ends on nextCursor null", async () => {
    const { hook, requests, settle, goTo } = setup();
    await settle();
    await goTo(2);
    await goTo(3);
    expect(hook.result.current.pager.hasNextPage).toBe(false);
    expect(hook.result.current.gridProps.data).toHaveLength(5);
    await goTo(2);
    expect(requests.at(-1)).toEqual({ page: 2, cursor: "after:9" });
    expect(hook.result.current.pager.hasNextPage).toBe(true);
  });

  it("keeps the chain on refresh", async () => {
    const { hook, requests, settle, goTo } = setup();
    await settle();
    await goTo(2);
    act(() => hook.result.current.refresh());
    await settle();
    expect(requests.at(-1)).toEqual({ page: 2, cursor: "after:9" });
  });

  it("drops the chain and returns to page 1 when the page size changes", async () => {
    const { hook, requests, settle, goTo } = setup();
    await settle();
    await goTo(2);
    act(() => hook.result.current.pager.onPageSizeChange(5));
    await settle();
    expect(hook.result.current.pager.page).toBe(1);
    expect(requests.at(-1)).toEqual({ page: 1, cursor: undefined });
    await goTo(2);
    expect(requests.at(-1)).toEqual({ page: 2, cursor: "after:4" });
  });

  it("drops the chain when the search text changes", async () => {
    const { hook, requests, settle, goTo } = setup();
    await settle();
    await goTo(2);
    act(() => hook.result.current.providerProps.onSearchTextChange("ann"));
    await settle();
    expect(hook.result.current.pager.page).toBe(1);
    expect(requests.at(-1)).toEqual({ page: 1, cursor: undefined });
  });

  it("snaps a controlled page beyond the chain back to the furthest known page", async () => {
    const onPageChange = vi.fn();
    const { hook, settle } = setup({ page: 3, onPageChange });
    await waitFor(() => expect(onPageChange).toHaveBeenCalledWith(1));
    hook.rerender({ page: 1, onPageChange });
    await settle();
    expect(hook.result.current.pager.page).toBe(1);
  });

  it("repeats the failed page with its cursor on retry", async () => {
    let failing = false;
    const { hook, requests, settle } = setup({ fail: () => failing });
    await settle();
    failing = true;
    act(() => hook.result.current.pager.onPageChange(2));
    await waitFor(() => expect(hook.result.current.status).toBe("error"));
    expect(hook.result.current.gridProps.data).toHaveLength(SIZE);
    failing = false;
    act(() => hook.result.current.retry());
    await settle();
    expect(requests.at(-1)).toEqual({ page: 2, cursor: "after:9" });
    expect(hook.result.current.pager.page).toBe(2);
  });
});

describe("cursor pages, races", () => {
  it("drops a slow answer of a page the user left", async () => {
    const resolvers: Record<number, () => void> = {};
    const fetchRows = vi.fn(async ({ page }: ServerRowsPageRequest<string>): Promise<ServerRowsAnswer<Row, string>> => {
      if (page === 2) await new Promise<void>((resolve) => (resolvers[2] = resolve));
      return { rows: [{ id: `p${page}` }], nextCursor: page < 3 ? `c${page}` : null };
    });
    const hook = renderHook(() => useDataGridServerRows<Row, string>({ getRowId: (r) => r.id, fetchRows, defaultPageSize: 1, pageSizeOptions: [1] }));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    act(() => hook.result.current.pager.onPageChange(2));
    act(() => hook.result.current.pager.onPageChange(1));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    resolvers[2]?.();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(hook.result.current.gridProps.data).toEqual([{ id: "p1" }]);
  });

  it("keeps later cursors when a refetch returns the same next cursor", async () => {
    const { requests, settle, goTo } = setup();
    await settle();
    await goTo(2);
    await goTo(3);
    await goTo(2);
    await goTo(3);
    expect(requests.at(-1)).toEqual({ page: 3, cursor: "after:19" });
  });
});
