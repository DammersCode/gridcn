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
import { DataGridUrlState, useDataGridUrlState, type UseDataGridUrlStateResult } from "./data-grid-url-state";

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

/** Calls the hook directly so the test can reach its result (the component discards it). */
function UrlStateProbe(props: { prefix?: string; onResult: (result: UseDataGridUrlStateResult) => void }) {
  const result = useDataGridUrlState({ prefix: props.prefix });
  props.onResult(result);
  return null;
}

type StatusRow = { id: string; status: string };

const statusColumns = defineColumns<StatusRow>()([
  {
    id: "status",
    header: "Status",
    accessorKey: "status",
    type: "select",
    width: 80,
    options: { choices: [{ value: "new", label: "New" }, { value: "open", label: "Open" }] },
  },
] as const);

function renderGrid(options: {
  searchParams?: string;
  prefix?: string;
  onUrlUpdate?: (event: UrlUpdateEvent) => void;
  exposeUrlState?: (result: UseDataGridUrlStateResult) => void;
}) {
  let latestState: { sort: unknown; filter: unknown; search: string } | undefined;
  let actions: ReturnType<typeof useDataGridActions> | undefined;
  const utils = render(
    <NuqsTestingAdapter searchParams={options.searchParams} onUrlUpdate={options.onUrlUpdate}>
      <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id}>
        {options.exposeUrlState ? (
          <UrlStateProbe prefix={options.prefix} onResult={options.exposeUrlState} />
        ) : (
          <DataGridUrlState prefix={options.prefix} />
        )}
        <StateProbe onState={(s) => (latestState = s)} />
        <ActionsProbe onActions={(a) => (actions = a)} />
      </DataGridProvider>
    </NuqsTestingAdapter>,
  );
  return { ...utils, getState: () => latestState!, getActions: () => actions! };
}

describe("DataGridUrlState isAnyOf bound", () => {
  it("bounds a URL isAnyOf list by the column's own choices", () => {
    const values = Array.from({ length: 100 }, (_, i) => `v${i}`).join("|");
    let filter: unknown;
    const Probe = () => {
      filter = useDataGridFilterState();
      return null;
    };
    render(
      <NuqsTestingAdapter searchParams={`?filter=status%3AisAnyOf%3A${values}`}>
        <DataGridProvider data={[{ id: "r0", status: "new" }]} columns={statusColumns} getRowId={(r) => r.id}>
          <DataGridUrlState />
          <Probe />
        </DataGridProvider>
      </NuqsTestingAdapter>,
    );
    expect(filter).toEqual([{ filterId: expect.any(String), columnId: "status", operator: "isAnyOf", value: Array.from({ length: 64 }, (_, i) => `v${i}`) }]);
  });

  it("keeps a deep link on a select column whose choices have not loaded yet", () => {
    let filter: unknown;
    const Probe = () => {
      filter = useDataGridFilterState();
      return null;
    };
    render(
      <NuqsTestingAdapter searchParams="?filter=status%3AisAnyOf%3Anew%7Copen">
        <DataGridProvider
          data={[{ id: "r0", status: "new" }]}
          columns={defineColumns<StatusRow>()([{ id: "status", header: "Status", accessorKey: "status", type: "select", width: 80, options: { choices: [] } }] as const)}
          getRowId={(r) => r.id}
        >
          <DataGridUrlState />
          <Probe />
        </DataGridProvider>
      </NuqsTestingAdapter>,
    );
    expect(filter).toEqual([{ filterId: expect.any(String), columnId: "status", operator: "isAnyOf", value: ["new", "open"] }]);
  });

  it("keeps a long isAnyOf list for a column without choices", () => {
    const values = Array.from({ length: 100 }, (_, i) => `v${i}`).join("|");
    const { getState } = renderGrid({ searchParams: `?filter=name%3AisAnyOf%3A${values}` });
    expect((getState().filter as { value: string[] }[])[0]!.value).toHaveLength(100);
  });
});

describe("DataGridUrlState isNoneOf", () => {
  it("applies an isNoneOf list from the URL", () => {
    const { getState } = renderGrid({ searchParams: "?filter=name%3AisNoneOf%3AAlice%7CBob" });
    expect(getState().filter).toEqual([{ filterId: expect.any(String), columnId: "name", operator: "isNoneOf", value: ["Alice", "Bob"] }]);
  });

  it("drops an isNoneOf list over the bound instead of shortening it", () => {
    const values = Array.from({ length: 1001 }, (_, i) => `v${i}`).join("|");
    const { getState } = renderGrid({ searchParams: `?filter=name%3AisNoneOf%3A${values}` });
    expect(getState().filter).toEqual([]);
  });
});

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

describe("DataGridUrlState excluded columns", () => {
  const guardedColumns = defineColumns<Row>()([
    { id: "name", header: "Name", accessorKey: "name", type: "text", width: 100 },
    { id: "age", header: "Age", accessorKey: "age", type: "number", width: 80, sortable: false },
    { id: "id", header: "Id", accessorKey: "id", type: "text", width: 80, filterable: false, hidden: true },
  ] as const);

  function renderGuarded(searchParams: string) {
    let latest: { sort: unknown; filter: unknown; search: string } | undefined;
    render(
      <NuqsTestingAdapter searchParams={searchParams}>
        <DataGridProvider data={rows} columns={guardedColumns} getRowId={(r) => r.id}>
          <DataGridUrlState />
          <StateProbe onState={(s) => (latest = s)} />
        </DataGridProvider>
      </NuqsTestingAdapter>,
    );
    return () => latest!;
  }

  it("drops a row for a hidden column inside a group and removes the emptied group", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const getState = renderGuarded("?filter=name%3Aequals%3AAlice,[or,id%3Aequals%3Ar0,],[or,id%3Aequals%3Ar1,name%3Acontains%3Ab,]");
    expect(getState().filter).toEqual([
      { filterId: expect.any(String), columnId: "name", operator: "equals", value: "Alice" },
      { filterId: expect.any(String), join: "or", filters: [{ filterId: expect.any(String), columnId: "name", operator: "contains", value: "b" }] },
    ]);
    warn.mockRestore();
  });

  it("drops URL sort specs for a sortable:false or hidden column and dev-warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const getState = renderGuarded("?sort=age%3Aasc,id%3Adesc,name%3Aasc");
    expect(getState().sort).toEqual([{ columnId: "name", direction: "asc" }]);
    expect(warn.mock.calls.length).toBe(2);
    warn.mockRestore();
  });

  it("keeps a URL sort for a def-hidden column the user shows again", async () => {
    let result: UseDataGridUrlStateResult | undefined;
    let actions: ReturnType<typeof useDataGridActions> | undefined;
    let latest: { sort: unknown } | undefined;
    render(
      <NuqsTestingAdapter searchParams="?sort=id%3Adesc">
        <DataGridProvider data={rows} columns={guardedColumns} getRowId={(r) => r.id}>
          <UrlStateProbe onResult={(r) => (result = r)} />
          <ActionsProbe onActions={(a) => (actions = a)} />
          <StateProbe onState={(s) => (latest = s)} />
        </DataGridProvider>
      </NuqsTestingAdapter>,
    );
    act(() => actions!.setColumnHidden("id", false));
    act(() => actions!.setSorts([{ columnId: "id", direction: "desc" }]));
    await act(async () => result!.applyFromUrl());
    expect(latest!.sort).toEqual([{ columnId: "id", direction: "desc" }]);
  });

  it("drops a URL sort for a column the URL hide part hides", () => {
    const getState = renderGuarded("?sort=name%3Aasc&hide=name");
    expect(getState().sort).toEqual([]);
  });

  it("keeps a URL sort for a def-hidden column the URL hide part shows", () => {
    const getState = renderGuarded("?sort=id%3Adesc&hide=-");
    expect(getState().sort).toEqual([{ columnId: "id", direction: "desc" }]);
  });

  it("drops a URL filter for a column the URL hide part hides", () => {
    const getState = renderGuarded("?filter=name%3Aequals%3AAlice&hide=name");
    expect(getState().filter).toEqual([]);
  });

  it("drops URL filter specs for a filterable:false or hidden column", () => {
    const getState = renderGuarded("?filter=id%3Aequals%3Ar0,name%3Aequals%3AAlice");
    expect(getState().filter).toEqual([
      { filterId: expect.any(String), columnId: "name", operator: "equals", value: "Alice" },
    ]);
  });
});

describe("DataGridUrlState filter groups", () => {
  const nameId = (columnId: string, operator: string, value: string) => ({ filterId: expect.any(String), columnId, operator, value });

  it("applies a group from the URL on mount", () => {
    const { getState } = renderGrid({ searchParams: "?filter=age%3Agt%3A26,[or,name%3Acontains%3AAli,name%3Acontains%3ABo,]" });
    expect(getState().filter).toEqual([
      nameId("age", "gt", "26"),
      { filterId: expect.any(String), join: "or", filters: [nameId("name", "contains", "Ali"), nameId("name", "contains", "Bo")] },
    ]);
  });

  it("wraps a flat list in one or group for a legacy join=or", () => {
    const { getState } = renderGrid({ searchParams: "?filter=name%3Acontains%3AAli,age%3Agt%3A35&join=or" });
    expect(getState().filter).toEqual([
      { filterId: expect.any(String), join: "or", filters: [nameId("name", "contains", "Ali"), nameId("age", "gt", "35")] },
    ]);
  });

  it("ignores join=or when the filter already holds a group", () => {
    const { getState } = renderGrid({ searchParams: "?filter=age%3Agt%3A26,[and,name%3Acontains%3AAli,]&join=or" });
    expect(getState().filter).toEqual([
      nameId("age", "gt", "26"),
      { filterId: expect.any(String), join: "and", filters: [nameId("name", "contains", "Ali")] },
    ]);
  });

  it("writes the tree to the URL and clears a legacy join param", async () => {
    const onUrlUpdate = vi.fn();
    const { getActions } = renderGrid({ searchParams: "?join=or", onUrlUpdate });
    await act(async () => {
      getActions().setFilters([{ columnId: "age", operator: "gt", value: "30" }, { join: "or", filters: [{ columnId: "name", operator: "equals", value: "A" }] }]);
    });
    await vi.waitFor(() => {
      const last = onUrlUpdate.mock.calls.at(-1)?.[0] as UrlUpdateEvent | undefined;
      expect(last?.searchParams.get("filter")).toBe("age:gt:30,[or,name:equals:A,]");
      expect(last?.searchParams.has("join")).toBe(false);
    });
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

describe("DataGridUrlState applyFromUrl (URL→store after mount)", () => {
  it("re-applies externally changed URL params to the store", async () => {
    let urlState: UseDataGridUrlStateResult | undefined;
    const probe: { sort: unknown; filter: unknown; search: string }[] = [];
    const tree = (searchParams: string) => (
      // hasMemory: the testing adapter only syncs a new searchParams prop into its state with it
      <NuqsTestingAdapter searchParams={searchParams} hasMemory>
        <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id}>
          <UrlStateProbe onResult={(r) => (urlState = r)} />
          <StateProbe onState={(s) => probe.push(s)} />
        </DataGridProvider>
      </NuqsTestingAdapter>
    );
    const utils = render(tree("?sort=name%3Aasc"));
    const latest = () => probe.at(-1)!;

    // mount-apply: the deep-linked sort is in the store
    await act(async () => {});
    expect(latest().sort).toEqual([{ columnId: "name", direction: "asc" }]);

    // let nuqs's throttle queue flush the mount write so no stale entry stomps the external change below
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });

    // an external URL change (back/forward, a framework setSearchParams) arrives as new params —
    // after mount the store does NOT re-read the URL on its own
    await act(async () => {
      utils.rerender(tree("?filter=age%3Agt%3A30"));
      await new Promise((r) => setTimeout(r, 700));
    });
    expect(latest().filter).toEqual([]);

    await act(async () => {
      urlState!.applyFromUrl();
    });
    expect(latest().filter).toEqual([{ filterId: expect.any(String), columnId: "age", operator: "gt", value: "30" }]);
    // a re-apply mirrors the URL: sort's param is gone from the new URL, so it clears
    expect(latest().sort).toEqual([]);
  });

  it("applyFromUrl clears sort/filter/join/search whose param is gone from the URL", async () => {
    let urlState: UseDataGridUrlStateResult | undefined;
    const probe: { sort: unknown; filter: unknown; search: string }[] = [];
    const tree = (searchParams: string) => (
      <NuqsTestingAdapter searchParams={searchParams} hasMemory>
        <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id}>
          <UrlStateProbe onResult={(r) => (urlState = r)} />
          <StateProbe onState={(s) => probe.push(s)} />
        </DataGridProvider>
      </NuqsTestingAdapter>
    );
    const utils = render(tree("?sort=name%3Aasc"));
    const latest = () => probe.at(-1)!;

    await act(async () => {});
    expect(latest().sort).toEqual([{ columnId: "name", direction: "asc" }]);

    await act(async () => {
      utils.rerender(tree(""));
      await new Promise((r) => setTimeout(r, 700));
    });

    await act(async () => {
      urlState!.applyFromUrl();
    });
    expect(latest().sort).toEqual([]);
  });

  it("does not re-apply on its own — only an explicit call re-reads the URL", async () => {
    let urlState: UseDataGridUrlStateResult | undefined;
    const { getState } = renderGrid({ searchParams: "?sort=name%3Aasc", exposeUrlState: (r) => (urlState = r) });
    expect(typeof urlState!.applyFromUrl).toBe("function");
    // the mount-apply is the only re-read until called: the store keeps its applied state
    expect(getState().sort).toEqual([{ columnId: "name", direction: "asc" }]);
  });
});
