import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NuqsTestingAdapter, type UrlUpdateEvent } from "nuqs/adapters/testing";
import {
  DataGridProvider,
  defineColumns,
  useDataGridActions,
  useDataGridFilterState,
  useDataGridSearchText,
  useDataGridSortState,
} from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridUrlState } from "./data-grid-url-state";

afterEach(cleanup);

type Row = { id: string; name: string; age: number };

const rows: Row[] = [
  { id: "r0", name: "Alice", age: 30 },
  { id: "r1", name: "Bob", age: 40 },
];

const columns = defineColumns<Row>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 100 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 80 },
] as const);

/** Reads out the store's sort/filter/search state as plain data, for assertions. */
function StateProbe(props: { onState: (state: { sort: unknown; filter: unknown; search: string }) => void }) {
  const sort = useDataGridSortState();
  const filter = useDataGridFilterState();
  const search = useDataGridSearchText();
  props.onState({ sort, filter, search });
  return null;
}

/** Exposes the store's actions to the test via a ref-like callback, for driving state changes. */
function ActionsProbe(props: { onActions: (actions: ReturnType<typeof useDataGridActions>) => void }) {
  const actions = useDataGridActions();
  props.onActions(actions);
  return null;
}

function renderGrid(options: { searchParams?: string; prefix?: string; onUrlUpdate?: (event: UrlUpdateEvent) => void }) {
  let latestState: { sort: unknown; filter: unknown; search: string } | undefined;
  let actions: ReturnType<typeof useDataGridActions> | undefined;
  const utils = render(
    <NuqsTestingAdapter searchParams={options.searchParams} onUrlUpdate={options.onUrlUpdate}>
      <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id}>
        <DataGridUrlState prefix={options.prefix} />
        <StateProbe onState={(s) => (latestState = s)} />
        <ActionsProbe onActions={(a) => (actions = a)} />
      </DataGridProvider>
    </NuqsTestingAdapter>,
  );
  return { ...utils, getState: () => latestState!, getActions: () => actions! };
}

describe("DataGridUrlState mount-apply", () => {
  it("applies sort/filter/search from the URL on mount", () => {
    const { getState } = renderGrid({ searchParams: "?sort=name%3Aasc&filter=age%3Agt%3A30&q=alice" });
    expect(getState().sort).toEqual([{ columnId: "name", direction: "asc" }]);
    // the store backfills a stable filterId for URL-parsed filters (they never carry one).
    expect(getState().filter).toEqual([{ filterId: expect.any(String), columnId: "age", operator: "gt", value: "30" }]);
    expect(getState().search).toBe("alice");
  });

  it("falls back to defaults silently for malformed URL params", () => {
    const { getState } = renderGrid({ searchParams: "?sort=!!!garbage!!!&filter=also-garbage" });
    expect(getState().sort).toEqual([]);
    expect(getState().filter).toEqual([]);
  });

  it("leaves store state untouched when no URL params are present", () => {
    const { getState } = renderGrid({});
    expect(getState().sort).toEqual([]);
    expect(getState().filter).toEqual([]);
    expect(getState().search).toBe("");
  });

  it("drops sort/filter specs for removed columns on mount-apply and dev-warns each", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { getState } = renderGrid({ searchParams: "?sort=ghost%3Aasc,name%3Aasc&filter=ghost%3Agt%3A30" });
    expect(getState().sort).toEqual([{ columnId: "name", direction: "asc" }]);
    expect(getState().filter).toEqual([]);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("ghost")).length).toBe(2);
    warn.mockRestore();
  });

  it("namespaces URL keys with the prefix option, ignoring unprefixed/other-prefixed params", () => {
    const { getState } = renderGrid({
      prefix: "orders",
      searchParams: "?sort=name%3Aasc&orders_sort=age%3Adesc",
    });
    expect(getState().sort).toEqual([{ columnId: "age", direction: "desc" }]);
  });
});

describe("DataGridUrlState state -> URL write", () => {
  it("writes a sort change to the URL", async () => {
    const onUrlUpdate = vi.fn();
    const { getActions } = renderGrid({ onUrlUpdate });
    await act(async () => {
      getActions().setSorts([{ columnId: "name", direction: "asc" }]);
    });
    await vi.waitFor(() => {
      const last = onUrlUpdate.mock.calls.at(-1)?.[0] as UrlUpdateEvent | undefined;
      expect(last?.searchParams.get("sort")).toBe("name:asc");
    });
  });

  it("writes a filter change to the URL", async () => {
    const onUrlUpdate = vi.fn();
    const { getActions } = renderGrid({ onUrlUpdate });
    await act(async () => {
      getActions().setFilters([{ columnId: "age", operator: "gt", value: "30" }]);
    });
    await vi.waitFor(() => {
      const last = onUrlUpdate.mock.calls.at(-1)?.[0] as UrlUpdateEvent | undefined;
      expect(last?.searchParams.get("filter")).toBe("age:gt:30");
    });
  });

  it("debounces search-text writes to the URL", async () => {
    vi.useFakeTimers();
    const onUrlUpdate = vi.fn();
    const { getActions } = renderGrid({ onUrlUpdate });
    act(() => {
      getActions().setSearch("a");
    });
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(onUrlUpdate.mock.calls.find((c) => (c[0] as UrlUpdateEvent).searchParams.get("q") === "a")).toBeUndefined();
    await act(async () => {
      vi.advanceTimersByTime(1);
      await vi.runOnlyPendingTimersAsync();
    });
    expect(onUrlUpdate.mock.calls.some((c) => (c[0] as UrlUpdateEvent).searchParams.get("q") === "a")).toBe(true);
    vi.useRealTimers();
  });

  it("uses history replace, never push, for URL writes", async () => {
    const onUrlUpdate = vi.fn();
    const { getActions } = renderGrid({ onUrlUpdate });
    await act(async () => {
      getActions().setSorts([{ columnId: "name", direction: "asc" }]);
    });
    await vi.waitFor(() => {
      const last = onUrlUpdate.mock.calls.at(-1)?.[0] as UrlUpdateEvent | undefined;
      expect(last?.options.history).toBe("replace");
    });
  });

  it("namespaces written URL keys with the prefix option", async () => {
    const onUrlUpdate = vi.fn();
    const { getActions } = renderGrid({ prefix: "orders", onUrlUpdate });
    await act(async () => {
      getActions().setSorts([{ columnId: "name", direction: "asc" }]);
    });
    await vi.waitFor(() => {
      const last = onUrlUpdate.mock.calls.at(-1)?.[0] as UrlUpdateEvent | undefined;
      expect(last?.searchParams.get("orders_sort")).toBe("name:asc");
      expect(last?.searchParams.get("sort")).toBeNull();
    });
  });
});
