import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataGridProvider, type AnyColumnDef, type ColumnDef, type FetchFilterValues, type FilterNode } from "@/registry/default/blocks/data-grid/data-grid";
import { MAX_SET_FILTER_ENTRIES } from "./apply-set-filter";
import { mergeKnownValues, sanitizeServerValues, useServerFilterValues } from "./server-filter-values";

type Row = { id: string; city: string };

const city: ColumnDef<Row, unknown> = { id: "city", header: "City", accessorKey: "city" };
const select: ColumnDef<Row, unknown> = { id: "city", header: "City", accessorKey: "city", type: "select", options: { choices: [{ value: "a", label: "A" }] } };
const data: Row[] = [{ id: "1", city: "Berlin" }];

afterEach(cleanup);

function setup(fetchFilterValues: FetchFilterValues | undefined, column: ColumnDef<Row, unknown> = city, filterState: FilterNode[] = []) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DataGridProvider data={data} columns={[column]} getRowId={(row: Row) => row.id} fetchFilterValues={fetchFilterValues} defaultFilterState={filterState}>
      {children}
    </DataGridProvider>
  );
  return renderHook(({ search }) => useServerFilterValues(column as AnyColumnDef, search), { wrapper, initialProps: { search: "" } });
}

describe("sanitizeServerValues", () => {
  it("keeps string labels once per lowercase key and drops everything else", () => {
    const result = sanitizeServerValues({ values: [{ label: "Berlin", count: 3 }, { label: "BERLIN" }, { label: 7 }, null, { label: "Rome", count: -1 }, { label: "" }] });
    expect(result?.options.map((o) => [o.key, o.text, o.count])).toEqual([["berlin", "Berlin", 3], ["rome", "Rome", undefined], ["", "", undefined]]);
  });

  it("caps the list and flags it", () => {
    const values = Array.from({ length: MAX_SET_FILTER_ENTRIES + 5 }, (_, i) => ({ label: `v${i}` }));
    const result = sanitizeServerValues({ values });
    expect(result?.options).toHaveLength(MAX_SET_FILTER_ENTRIES);
    expect(result?.capped).toBe(true);
  });

  it("returns null for a response without a values array", () => {
    expect(sanitizeServerValues(null)).toBeNull();
    expect(sanitizeServerValues({ values: "x" })).toBeNull();
  });
});

describe("useServerFilterValues", () => {
  it("returns null without a provider", () => {
    expect(setup(undefined).result.current).toBeNull();
  });

  it("returns null and never calls the provider for a choices column", () => {
    const fetchFilterValues = vi.fn();
    expect(setup(fetchFilterValues, select).result.current).toBeNull();
    expect(fetchFilterValues).not.toHaveBeenCalled();
  });

  it("loads the list and passes the search through raw", async () => {
    const fetchFilterValues = vi.fn<FetchFilterValues>(async () => ({ values: [{ label: "Berlin", count: 2 }] }));
    const { result, rerender } = setup(fetchFilterValues);
    expect(result.current?.status).toBe("loading");
    await waitFor(() => expect(result.current?.status).toBe("ready"));
    expect(result.current?.options[0]).toMatchObject({ key: "berlin", label: "Berlin", text: "Berlin", count: 2 });
    rerender({ search: "<b>'; DROP" });
    await waitFor(() => expect(fetchFilterValues).toHaveBeenCalledTimes(2));
    expect(fetchFilterValues.mock.calls[1]![0]).toMatchObject({ columnId: "city", search: "<b>'; DROP" });
  });

  it("sends the open filters without the column's own set entry", async () => {
    const other: FilterNode = { columnId: "id", operator: "equals", value: "1" };
    const own: FilterNode = { columnId: "city", operator: "isAnyOf", value: ["Berlin"] };
    const fetchFilterValues = vi.fn<FetchFilterValues>(async () => ({ values: [] }));
    setup(fetchFilterValues, city, [other, own]);
    await waitFor(() => expect(fetchFilterValues).toHaveBeenCalled());
    expect(fetchFilterValues.mock.calls[0]![0].filters).toEqual([expect.objectContaining(other)]);
  });

  it("aborts the request on a new search and on unmount, and ignores the aborted result", async () => {
    const signals: AbortSignal[] = [];
    const resolvers: ((v: { values: { label: string }[] }) => void)[] = [];
    const fetchFilterValues: FetchFilterValues = ({ signal }) => {
      signals.push(signal);
      return new Promise((resolve) => resolvers.push(resolve));
    };
    const { result, rerender, unmount } = setup(fetchFilterValues);
    rerender({ search: "b" });
    expect(signals[0]!.aborted).toBe(true);
    await act(async () => resolvers[0]!({ values: [{ label: "Stale" }] }));
    expect(result.current?.options).toEqual([]);
    await act(async () => resolvers[1]!({ values: [{ label: "Fresh" }] }));
    expect(result.current?.options.map((o) => o.text)).toEqual(["Fresh"]);
    rerender({ search: "bb" });
    unmount();
    expect(signals[2]!.aborted).toBe(true);
  });

  it("keeps the previous list while a new search loads", async () => {
    let resolveSecond: (v: { values: { label: string }[] }) => void = () => {};
    const fetchFilterValues = vi
      .fn<FetchFilterValues>()
      .mockResolvedValueOnce({ values: [{ label: "Berlin" }] })
      .mockImplementationOnce(() => new Promise((resolve) => (resolveSecond = resolve)));
    const { result, rerender } = setup(fetchFilterValues);
    await waitFor(() => expect(result.current?.status).toBe("ready"));
    rerender({ search: "r" });
    expect(result.current?.status).toBe("loading");
    expect(result.current?.options).toHaveLength(1);
    await act(async () => resolveSecond({ values: [] }));
    expect(result.current?.options).toEqual([]);
  });

  it("reports a rejection, a throw and a malformed response as an error", async () => {
    for (const impl of [() => Promise.reject(new Error("x")), () => { throw new Error("y"); }, () => Promise.resolve({ values: 3 })]) {
      const { result, unmount } = setup(impl as unknown as FetchFilterValues);
      await waitFor(() => expect(result.current?.status).toBe("error"));
      unmount();
    }
  });
});

describe("mergeKnownValues", () => {
  const option = (key: string) => ({ key, text: key, label: key });

  it("keeps the newest MAX_SET_FILTER_ENTRIES entries across searches", () => {
    let known = new Map<string, string>();
    for (let page = 0; page < 3; page++) {
      known = mergeKnownValues(known, Array.from({ length: MAX_SET_FILTER_ENTRIES }, (_, i) => option(`p${page}-${i}`)));
    }
    expect(known.size).toBe(MAX_SET_FILTER_ENTRIES);
    expect(known.has("p2-0")).toBe(true);
    expect(known.has("p0-0")).toBe(false);
  });

  it("keeps the first-seen order when a value comes back", () => {
    const known = mergeKnownValues(new Map([["a", "a"], ["b", "b"]]), [option("a")]);
    expect([...known.keys()]).toEqual(["a", "b"]);
  });
});
