import { StrictMode, useEffect } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DataGridProvider,
  defineColumns,
  useDataGridActions,
  useDataGridFilterState,
  useDataGridSearchText,
  useDataGridSortState,
  type FilterNode,
  type SortSpec,
} from "@/registry/default/blocks/data-grid/data-grid";
import { pivotColumnId, useDataGridStoreApi } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { useDataGridServerRows } from "@/registry/default/blocks/data-grid-server/data-grid-server";
import { fakeServer } from "@/registry/default/blocks/data-grid-server/group-fake-server.test-helper";
import type { ServerRowsRequest } from "@/registry/default/blocks/data-grid-server/read-answer";
import { useDataGridViews, type UseDataGridViewsOptions, type UseDataGridViewsResult } from "./use-data-grid-views";
import { createMemoryViewsStorage, type DataGridViewsStorage } from "./view-storage";
import { emptyViewState, type DataGridViewState, type DataGridViewsDocument } from "./view-state";

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
const choiceColumns = defineColumns<Row>()([
  { id: "name", header: "Name", accessorKey: "name", type: "select", options: { choices: ["Alice", "Bob"] } },
] as const);

type Probe = {
  views: UseDataGridViewsResult;
  sort: SortSpec[];
  filter: FilterNode[];
  search: string;
  actions: ReturnType<typeof useDataGridActions>;
  joinOf: () => string;
};

function Harness({ options, onProbe, beforeLoad }: { options?: UseDataGridViewsOptions; onProbe: (p: Probe) => void; beforeLoad?: (a: ReturnType<typeof useDataGridActions>) => void }) {
  const views = useDataGridViews(options);
  const sort = useDataGridSortState();
  const filter = useDataGridFilterState();
  const search = useDataGridSearchText();
  const actions = useDataGridActions();
  useEffect(() => beforeLoad?.(actions), []); // oxlint-disable-line react-hooks/exhaustive-deps
  const storeApi = useDataGridStoreApi();
  onProbe({ views, sort, filter, search, actions, joinOf: () => storeApi.getState().filterJoin });
  return null;
}

function setup(options?: UseDataGridViewsOptions, providerProps: Record<string, unknown> = {}, beforeLoad?: (a: ReturnType<typeof useDataGridActions>) => void, strict = false) {
  const probe: { current: Probe | null } = { current: null };
  const tree = (
    <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id} {...providerProps}>
      <Harness options={options} onProbe={(p) => (probe.current = p)} beforeLoad={beforeLoad} />
    </DataGridProvider>
  );
  const view = render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  return { probe, view };
}

async function ready(probe: { current: Probe | null }) {
  await waitFor(() => expect(probe.current?.views.loading).toBe(false));
}

const seeded = (): DataGridViewsDocument => ({
  version: 1,
  defaultViewId: null,
  views: [
    { id: "a", name: "By age", state: { ...emptyViewState(), sorts: [{ columnId: "age", direction: "desc" }], searchText: "bo" } },
    { id: "b", name: "Alices", state: { ...emptyViewState(), filters: [{ columnId: "name", operator: "equals", value: "Alice" }] } },
  ],
});

describe("useDataGridViews", () => {
  it("works with no arguments and loads from the storage", async () => {
    const { probe } = setup({ storage: createMemoryViewsStorage(seeded()) });
    expect(probe.current!.views.loading).toBe(true);
    await ready(probe);
    expect(probe.current!.views.views.map((v) => v.name)).toEqual(["By age", "Alices"]);
  });

  it("starts empty for storage that holds nothing", async () => {
    const { probe } = setup({ storage: createMemoryViewsStorage() });
    await ready(probe);
    expect(probe.current!.views.views).toEqual([]);
    expect(probe.current!.views.activeView).toBeNull();
  });

  it("selectView applies sort, filter, search, and layout", async () => {
    const doc = seeded();
    doc.views[0]!.state.columnLayout = { widths: { name: 222 }, order: ["age", "name"], pins: { age: "start" }, hidden: [] };
    const { probe } = setup({ storage: createMemoryViewsStorage(doc) });
    await ready(probe);
    act(() => probe.current!.views.selectView("a"));
    expect(probe.current!.sort).toEqual([{ columnId: "age", direction: "desc" }]);
    expect(probe.current!.search).toBe("bo");
    expect(probe.current!.views.activeViewId).toBe("a");
    expect(probe.current!.views.modified).toBe(false);
    act(() => probe.current!.views.selectView("b"));
    expect(probe.current!.sort).toEqual([]);
    expect(probe.current!.filter).toMatchObject([{ columnId: "name", operator: "equals", value: "Alice" }]);
    expect(probe.current!.search).toBe("");
  });

  it("saves the top-level join and restores it on select", async () => {
    const storage = createMemoryViewsStorage();
    const { probe } = setup({ storage });
    await ready(probe);
    act(() => probe.current!.actions.setFilters([{ columnId: "name", operator: "equals", value: "Alice" }, { columnId: "age", operator: "gt", value: "35" }]));
    act(() => probe.current!.actions.setFilterJoin("or"));
    let saved: ReturnType<UseDataGridViewsResult["saveView"]> = null;
    act(() => {
      saved = probe.current!.views.saveView("Either");
    });
    expect(saved).toMatchObject({ state: { filterJoin: "or" } });
    expect(probe.current!.views.modified).toBe(false);
    act(() => probe.current!.actions.setFilterJoin("and"));
    expect(probe.current!.views.modified).toBe(true);
    act(() => probe.current!.views.selectView(saved!.id));
    expect(probe.current!.joinOf()).toBe("or");
  });

  it("ignores an unknown id", async () => {
    const { probe } = setup({ storage: createMemoryViewsStorage(seeded()) });
    await ready(probe);
    act(() => probe.current!.views.selectView("nope"));
    expect(probe.current!.views.activeViewId).toBeNull();
  });

  it("reports modified after a change and clears it on update", async () => {
    const { probe } = setup({ storage: createMemoryViewsStorage(seeded()) });
    await ready(probe);
    act(() => probe.current!.views.selectView("a"));
    act(() => probe.current!.actions.setSearch("al"));
    expect(probe.current!.views.modified).toBe(true);
    act(() => void probe.current!.views.updateView());
    expect(probe.current!.views.modified).toBe(false);
    expect(probe.current!.views.activeView!.state.searchText).toBe("al");
  });

  it("selecting the active view again reverts the changes", async () => {
    const { probe } = setup({ storage: createMemoryViewsStorage(seeded()) });
    await ready(probe);
    act(() => probe.current!.views.selectView("a"));
    act(() => probe.current!.actions.setSearch("zzz"));
    act(() => probe.current!.views.selectView("a"));
    expect(probe.current!.search).toBe("bo");
    expect(probe.current!.views.modified).toBe(false);
  });

  it("saveView captures the grid state, activates the view, and persists", async () => {
    const storage = createMemoryViewsStorage();
    const save = vi.spyOn(storage, "save");
    const { probe } = setup({ storage });
    await ready(probe);
    act(() => probe.current!.actions.setSorts([{ columnId: "name", direction: "asc" }]));
    act(() => probe.current!.actions.setSearch("ali"));
    let saved: ReturnType<UseDataGridViewsResult["saveView"]> = null;
    act(() => {
      saved = probe.current!.views.saveView("  Mine  ");
    });
    expect(saved).toMatchObject({ name: "Mine", state: { sorts: [{ columnId: "name", direction: "asc" }], searchText: "ali" } });
    expect(probe.current!.views.activeViewId).toBe(saved!.id);
    expect(probe.current!.views.modified).toBe(false);
    await waitFor(() => expect(save).toHaveBeenCalled());
    const stored = (await storage.load({ signal: new AbortController().signal })) as DataGridViewsDocument;
    expect(stored.views[0]!.name).toBe("Mine");
  });

  it("refuses a blank name and the view limit", async () => {
    const { probe } = setup({ storage: createMemoryViewsStorage() });
    await ready(probe);
    let blank: unknown = "x";
    act(() => {
      blank = probe.current!.views.saveView("   ");
    });
    expect(blank).toBeNull();
    let last: unknown;
    act(() => {
      for (let i = 0; i < 51; i++) last = probe.current!.views.saveView(`v${i}`);
    });
    expect(last).toBeNull();
    expect(probe.current!.views.views).toHaveLength(50);
  });

  it("renames, deletes, and sets the default", async () => {
    const storage = createMemoryViewsStorage(seeded());
    const { probe } = setup({ storage });
    await ready(probe);
    act(() => void probe.current!.views.renameView("a", "Oldest first"));
    expect(probe.current!.views.views[0]!.name).toBe("Oldest first");
    expect(probe.current!.views.renameView("a", "  ")).toBe(false);
    act(() => void probe.current!.views.setDefaultView("a"));
    expect(probe.current!.views.defaultViewId).toBe("a");
    act(() => probe.current!.views.selectView("a"));
    act(() => void probe.current!.views.deleteView("a"));
    expect(probe.current!.views.views.map((v) => v.id)).toEqual(["b"]);
    expect(probe.current!.views.defaultViewId).toBeNull();
    expect(probe.current!.views.activeViewId).toBeNull();
    expect(probe.current!.views.setDefaultView("gone")).toBe(false);
  });

  it("applies the default view when the grid still holds its start state", async () => {
    const doc = { ...seeded(), defaultViewId: "a" };
    const { probe } = setup({ storage: createMemoryViewsStorage(doc) });
    await ready(probe);
    await waitFor(() => expect(probe.current!.views.activeViewId).toBe("a"));
    expect(probe.current!.sort).toEqual([{ columnId: "age", direction: "desc" }]);
  });

  it("skips the default view when something else changed the grid first", async () => {
    const doc = { ...seeded(), defaultViewId: "a" };
    const { probe } = setup({ storage: createMemoryViewsStorage(doc) }, {}, (actions) => actions.setSearch("url"));
    await ready(probe);
    expect(probe.current!.views.activeViewId).toBeNull();
    expect(probe.current!.search).toBe("url");
  });

  it("skips the default view with enableDefaultView off or a defaultValue", async () => {
    const doc = { ...seeded(), defaultViewId: "a" };
    const off = setup({ storage: createMemoryViewsStorage(doc), enableDefaultView: false });
    await ready(off.probe);
    expect(off.probe.current!.views.activeViewId).toBeNull();
    cleanup();
    const seed = setup({ storage: createMemoryViewsStorage(doc), defaultValue: "b" });
    await ready(seed.probe);
    expect(seed.probe.current!.views.activeViewId).toBe("b");
    expect(seed.probe.current!.sort).toEqual([]);
    expect(seed.probe.current!.filter).toHaveLength(1);
  });

  it("applies a controlled value change and reports picks", async () => {
    const onValueChange = vi.fn();
    const storage = createMemoryViewsStorage(seeded());
    const probe: { current: Probe | null } = { current: null };
    const tree = (value: string | null) => (
      <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id}>
        <Harness options={{ storage, value, onValueChange }} onProbe={(p) => (probe.current = p)} />
      </DataGridProvider>
    );
    const view = render(tree(null));
    await ready(probe);
    view.rerender(tree("a"));
    await waitFor(() => expect(probe.current!.sort).toEqual([{ columnId: "age", direction: "desc" }]));
    act(() => probe.current!.views.selectView("b"));
    expect(onValueChange).toHaveBeenLastCalledWith("b");
    expect(probe.current!.views.activeViewId).toBe("a");
  });

  it("calls the change callbacks of controlled sort and filter state, client and server mode", async () => {
    for (const mode of ["client", "server"] as const) {
      cleanup();
      const onSortChange = vi.fn();
      const onFilterChange = vi.fn();
      const { probe } = setup(
        { storage: createMemoryViewsStorage(seeded()) },
        { sortState: [], filterState: [], onSortChange, onFilterChange, sortMode: mode, filterMode: mode },
      );
      await ready(probe);
      act(() => probe.current!.views.selectView("a"));
      expect(onSortChange).toHaveBeenCalledWith([{ columnId: "age", direction: "desc" }]);
      act(() => probe.current!.views.selectView("b"));
      expect(onFilterChange).toHaveBeenCalled();
    }
  });

  it("drops entries for columns the grid no longer has when applying", async () => {
    const doc = seeded();
    doc.views[0]!.state.sorts = [{ columnId: "gone", direction: "asc" }];
    const { probe } = setup({ storage: createMemoryViewsStorage(doc) });
    await ready(probe);
    act(() => probe.current!.views.selectView("a"));
    expect(probe.current!.sort).toEqual([]);
  });

  it("exports and imports a view", async () => {
    const { probe } = setup({ storage: createMemoryViewsStorage(seeded()) });
    await ready(probe);
    act(() => probe.current!.views.selectView("a"));
    const text = probe.current!.views.exportView()!;
    expect(JSON.parse(text)).toMatchObject({ format: "gridcn-view", version: 1, name: "By age" });
    expect(probe.current!.views.exportView("nope")).toBeNull();
    let result: ReturnType<UseDataGridViewsResult["importView"]> | undefined;
    act(() => {
      result = probe.current!.views.importView(text);
    });
    expect(result).toMatchObject({ ok: true, dropped: 0 });
    expect(probe.current!.views.views).toHaveLength(3);
    expect(probe.current!.views.activeView!.name).toBe("By age");
  });

  it("rejects hostile imports and reports dropped entries", async () => {
    const { probe } = setup({ storage: createMemoryViewsStorage(seeded()) });
    await ready(probe);
    let result: ReturnType<UseDataGridViewsResult["importView"]> | undefined;
    act(() => {
      result = probe.current!.views.importView("{nope");
    });
    expect(result).toEqual({ ok: false, reason: "invalid" });
    act(() => {
      result = probe.current!.views.importView("x".repeat(500_000));
    });
    expect(result).toEqual({ ok: false, reason: "too-large" });
    const file = JSON.stringify({ format: "gridcn-view", version: 1, name: "Old", state: { sorts: [{ columnId: "gone", direction: "asc" }] } });
    act(() => {
      result = probe.current!.views.importView(file);
    });
    expect(result).toMatchObject({ ok: true, dropped: 1 });
    expect(probe.current!.views.views).toHaveLength(3);
  });

  it("reports a load failure and retries", async () => {
    const onError = vi.fn();
    let fail = true;
    const storage: DataGridViewsStorage = {
      load: () => {
        if (fail) throw new Error("offline");
        return seeded();
      },
      save: () => {},
    };
    const { probe } = setup({ storage, onError });
    await waitFor(() => expect(probe.current!.views.error).toBeInstanceOf(Error));
    expect(probe.current!.views.loading).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
    fail = false;
    act(() => probe.current!.views.retry());
    await waitFor(() => expect(probe.current!.views.views).toHaveLength(2));
    expect(probe.current!.views.error).toBeNull();
  });

  it("keeps the local change when a save fails and retries the save", async () => {
    let fail = true;
    const save = vi.fn(async () => {
      if (fail) throw new Error("denied");
    });
    const storage: DataGridViewsStorage = { load: () => undefined, save };
    const { probe } = setup({ storage });
    await ready(probe);
    act(() => void probe.current!.views.saveView("Mine"));
    await waitFor(() => expect(probe.current!.views.error).toBeInstanceOf(Error));
    expect(probe.current!.views.views).toHaveLength(1);
    fail = false;
    act(() => probe.current!.views.retry());
    await waitFor(() => expect(probe.current!.views.error).toBeNull());
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("coalesces saves that start while one is in flight", async () => {
    const calls: number[] = [];
    let release: () => void = () => {};
    const storage: DataGridViewsStorage = {
      load: () => undefined,
      save: (doc) =>
        new Promise<void>((resolve) => {
          calls.push(doc.views.length);
          release = resolve;
        }),
    };
    const { probe } = setup({ storage });
    await ready(probe);
    act(() => {
      probe.current!.views.saveView("a");
      probe.current!.views.saveView("b");
      probe.current!.views.saveView("c");
    });
    expect(calls).toEqual([1]);
    await act(async () => release());
    await waitFor(() => expect(calls).toEqual([1, 3]));
    await act(async () => release());
    await waitFor(() => expect(probe.current!.views.saving).toBe(false));
  });

  it("loads once per mount under StrictMode", async () => {
    const load = vi.fn((_ctx: { signal: AbortSignal }) => seeded());
    const { probe } = setup({ storage: { load, save: () => {} } }, {}, undefined, true);
    await ready(probe);
    expect(probe.current!.views.views).toHaveLength(2);
    expect(load.mock.calls.length).toBeLessThanOrEqual(2);
    expect(load.mock.calls.at(-1)![0].signal.aborted).toBe(false);
  });

  it("ignores a result that lands after unmount", async () => {
    let resolve: (doc: DataGridViewsDocument) => void = () => {};
    let signal: AbortSignal | undefined;
    const storage: DataGridViewsStorage = {
      load: (ctx) => {
        signal = ctx.signal;
        return new Promise((r) => (resolve = r));
      },
      save: () => {},
    };
    const onError = vi.fn();
    const { view } = setup({ storage, onError });
    view.unmount();
    expect(signal?.aborted).toBe(true);
    resolve(seeded());
    await Promise.resolve();
    expect(onError).not.toHaveBeenCalled();
  });

  it("default storage reads and writes localStorage", async () => {
    localStorage.setItem("views-test", JSON.stringify(seeded()));
    const { probe } = setup({ storage: "views-test" });
    await ready(probe);
    expect(probe.current!.views.views).toHaveLength(2);
    act(() => void probe.current!.views.deleteView("a"));
    await waitFor(() => expect(JSON.parse(localStorage.getItem("views-test")!).views).toHaveLength(1));
    localStorage.clear();
  });

  it("opening a view calls only the callbacks of the parts that differ", async () => {
    const onSortChange = vi.fn();
    const onFilterChange = vi.fn();
    const { probe } = setup({ storage: createMemoryViewsStorage(seeded()) }, { sortState: [], filterState: [], onSortChange, onFilterChange });
    await ready(probe);
    act(() => probe.current!.views.selectView("b"));
    expect(onFilterChange).toHaveBeenCalledTimes(1);
    expect(onSortChange).not.toHaveBeenCalled();
  });

  it("with an async controlled value, a save keeps the grid until the parent accepts the id", async () => {
    const storage = createMemoryViewsStorage(seeded());
    const probe: { current: Probe | null } = { current: null };
    const tree = (value: string | null) => (
      <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id}>
        <Harness options={{ storage, value }} onProbe={(p) => (probe.current = p)} />
      </DataGridProvider>
    );
    const view = render(tree("a"));
    await ready(probe);
    await waitFor(() => expect(probe.current!.sort).toEqual([{ columnId: "age", direction: "desc" }]));
    act(() => probe.current!.actions.setSorts([{ columnId: "name", direction: "asc" }]));
    let saved: ReturnType<UseDataGridViewsResult["saveView"]> = null;
    act(() => {
      saved = probe.current!.views.saveView("Name sort");
    });
    expect(probe.current!.sort).toEqual([{ columnId: "name", direction: "asc" }]);
    view.rerender(tree(saved!.id));
    expect(probe.current!.sort).toEqual([{ columnId: "name", direction: "asc" }]);
    expect(probe.current!.views.modified).toBe(false);
  });

  it("with a controlled value, a pick that the parent rejects changes nothing", async () => {
    const onValueChange = vi.fn();
    const { probe } = setup({ storage: createMemoryViewsStorage(seeded()), value: null, onValueChange });
    await ready(probe);
    act(() => probe.current!.views.selectView("a"));
    expect(onValueChange).toHaveBeenCalledWith("a");
    expect(probe.current!.sort).toEqual([]);
  });

  it("does not load a document in an unknown format and keeps it from being overwritten", async () => {
    const save = vi.fn();
    const storage: DataGridViewsStorage = { load: () => ({ version: 9, views: [] }), save };
    const { probe } = setup({ storage });
    await waitFor(() => expect(probe.current!.views.failed).toBe("load"));
    let saved: unknown = "x";
    act(() => {
      saved = probe.current!.views.saveView("Mine");
    });
    expect(saved).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it("refuses to save a document over the size limit and reports it", async () => {
    const save = vi.fn();
    const onError = vi.fn();
    const filters = Array.from({ length: 64 }, () => ({ columnId: "name", operator: "equals", value: "y".repeat(1000) }));
    const huge = Array.from({ length: 50 }, (_, i) => ({ id: `h${i}`, name: "n", state: { ...emptyViewState(), filters } }));
    const storage: DataGridViewsStorage = { load: () => ({ version: 1, defaultViewId: null, views: huge }), save };
    const { probe } = setup({ storage, onError });
    await ready(probe);
    act(() => void probe.current!.views.renameView("h0", "renamed"));
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(save).not.toHaveBeenCalled();
    expect(probe.current!.views.failed).toBe("save");
  });

  it("loads again and drops the old views when the storage key changes", async () => {
    localStorage.setItem("key-a", JSON.stringify(seeded()));
    localStorage.setItem("key-b", JSON.stringify({ version: 1, defaultViewId: null, views: [{ id: "z", name: "Zed", state: emptyViewState() }] }));
    const probe: { current: Probe | null } = { current: null };
    const tree = (storageKey: string) => (
      <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id}>
        <Harness options={{ storage: storageKey }} onProbe={(p) => (probe.current = p)} />
      </DataGridProvider>
    );
    const view = render(tree("key-a"));
    await ready(probe);
    expect(probe.current!.views.views).toHaveLength(2);
    view.rerender(tree("key-b"));
    await waitFor(() => expect(probe.current!.views.views.map((v) => v.id)).toEqual(["z"]));
    localStorage.clear();
  });

  it("keeps retry stable across renders", async () => {
    const { probe } = setup({ storage: createMemoryViewsStorage(seeded()) });
    await ready(probe);
    const first = probe.current!.views.retry;
    act(() => void probe.current!.views.renameView("a", "x"));
    expect(probe.current!.views.retry).toBe(first);
  });

  it("keeps the page of a server grid when a view changes only the layout", async () => {
    const fetchRows = vi.fn(async ({ start, end }: { start: number; end: number }) => ({ rows: rows.slice(start, end), totalRowCount: 40 }));
    const layoutOnly = seeded();
    layoutOnly.views[1]!.state = { ...emptyViewState(), columnLayout: { widths: { name: 150 }, order: [], pins: {}, hidden: [] } };
    let latest: UseDataGridViewsResult | null = null;
    let page = 0;
    function ServerGrid() {
      const server = useDataGridServerRows<Row>({ mode: "pages", getRowId: (r) => r.id, defaultPageSize: 1, fetchRows });
      page = server.pager.page;
      return (
        <DataGridProvider columns={columns} {...server.providerProps}>
          <Harness options={{ storage: createMemoryViewsStorage(layoutOnly), enableDefaultView: false }} onProbe={(p) => (latest = p.views)} />
          <button onClick={() => server.pager.onPageChange(2)}>next</button>
        </DataGridProvider>
      );
    }
    const view = render(<ServerGrid />);
    await waitFor(() => expect(latest?.loading).toBe(false));
    act(() => view.getByText("next").click());
    await waitFor(() => expect(page).toBe(2));
    const calls = fetchRows.mock.calls.length;
    act(() => latest!.selectView("b"));
    expect(page).toBe(2);
    expect(fetchRows.mock.calls.length).toBe(calls);
  });

  it("keeps programmatic specs on columns that opt out of sort and filter UI when a view opens", async () => {
    const lockedColumns = defineColumns<Row>()([
      { id: "name", header: "Name", accessorKey: "name", type: "text", width: 100, filterable: false },
      { id: "age", header: "Age", accessorKey: "age", type: "number", width: 80, sortable: false },
    ] as const);
    const doc = seeded();
    doc.views[0]!.state = { ...emptyViewState(), filters: [{ columnId: "name", operator: "notEquals", value: "Bob" }], sorts: [{ columnId: "age", direction: "asc" }] };
    const probe: { current: Probe | null } = { current: null };
    render(
      <DataGridProvider data={rows} columns={lockedColumns} getRowId={(r) => r.id}>
        <Harness options={{ storage: createMemoryViewsStorage(doc) }} onProbe={(p) => (probe.current = p)} />
      </DataGridProvider>,
    );
    await ready(probe);
    act(() => probe.current!.views.selectView("a"));
    expect(probe.current!.filter).toMatchObject([{ columnId: "name", operator: "notEquals", value: "Bob" }]);
    expect(probe.current!.sort).toEqual([{ columnId: "age", direction: "asc" }]);
  });

  it("stores a search text at its limit unchanged", async () => {
    const { probe } = setup({ storage: createMemoryViewsStorage() });
    await ready(probe);
    act(() => probe.current!.actions.setSearch("x".repeat(500)));
    let saved: ReturnType<UseDataGridViewsResult["saveView"]> = null;
    act(() => {
      saved = probe.current!.views.saveView("Long search");
    });
    expect(saved!.state.searchText).toHaveLength(500);
    expect(probe.current!.views.modified).toBe(false);
  });

  it("clears an uncontrolled active view when the storage key changes", async () => {
    localStorage.setItem("key-c", JSON.stringify(seeded()));
    localStorage.setItem("key-d", JSON.stringify(seeded()));
    const probe: { current: Probe | null } = { current: null };
    const tree = (storageKey: string) => (
      <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id}>
        <Harness options={{ storage: storageKey }} onProbe={(p) => (probe.current = p)} />
      </DataGridProvider>
    );
    const view = render(tree("key-c"));
    await ready(probe);
    act(() => probe.current!.views.selectView("a"));
    expect(probe.current!.views.activeViewId).toBe("a");
    view.rerender(tree("key-d"));
    await waitFor(() => expect(probe.current!.views.activeViewId).toBeNull());
    localStorage.clear();
  });

  it("sends the sort and filter of a view to a server grid", async () => {
    const fetchRows = vi.fn(async ({ start, end }: { start: number; end: number }) => ({ rows: rows.slice(start, end), totalRowCount: 2 }));
    let latest: UseDataGridViewsResult | null = null;
    function ServerGrid() {
      const server = useDataGridServerRows<Row>({ mode: "pages", getRowId: (r) => r.id, defaultPageSize: 5, fetchRows });
      return (
        <DataGridProvider columns={columns} {...server.providerProps}>
          <Harness options={{ storage: createMemoryViewsStorage(seeded()), enableDefaultView: false }} onProbe={(p) => (latest = p.views)} />
        </DataGridProvider>
      );
    }
    render(<ServerGrid />);
    await waitFor(() => expect(latest?.loading).toBe(false));
    await waitFor(() => expect(fetchRows).toHaveBeenCalled());
    act(() => latest!.selectView("a"));
    await waitFor(() =>
      expect(fetchRows.mock.calls.at(-1)![0]).toMatchObject({ spec: { sorts: [{ columnId: "age", direction: "desc" }], searchText: expect.any(String) } }),
    );
  });

  it("is not modified right after saving a grid that holds an empty-value filter", async () => {
    const { probe } = setup({ storage: createMemoryViewsStorage() });
    await ready(probe);
    act(() => probe.current!.actions.setFilters([{ columnId: "name", operator: "notEmpty", value: "" }]));
    act(() => void probe.current!.views.saveView("Filled"));
    expect(probe.current!.views.modified).toBe(false);
  });

  it("returns null when a view is too large to import again", async () => {
    const big = seeded();
    big.views[0]!.state.filters = Array.from({ length: 64 }, () => ({ columnId: "name", operator: "isAnyOf", value: Array.from({ length: 1000 }, (_, i) => `value-${i}`) }));
    const { probe } = setup({ storage: createMemoryViewsStorage(big) });
    await ready(probe);
    expect(probe.current!.views.exportView("a")).toBeNull();
    expect(probe.current!.views.exportView("b")).not.toBeNull();
  });

  it("treats a live filter beyond the storage limits as a change and clears it when a view opens", async () => {
    const { probe } = setup({ storage: createMemoryViewsStorage(seeded()) });
    await ready(probe);
    act(() => probe.current!.views.selectView("a"));
    act(() => probe.current!.actions.setFilters([{ columnId: "name", operator: "contains", value: "x".repeat(1001) }]));
    expect(probe.current!.views.modified).toBe(true);
    act(() => probe.current!.views.selectView("a"));
    expect(probe.current!.filter).toEqual([]);
    act(() => probe.current!.actions.setFilters([{ columnId: "name", operator: "isNoneOf", value: Array.from({ length: 1001 }, (_, i) => String(i)) }]));
    act(() => probe.current!.views.selectView("a"));
    expect(probe.current!.filter).toEqual([]);
  });

  it("drops list values that match no choice and no data value when a view opens", async () => {
    const doc = seeded();
    doc.views[0]!.state.filters = [{ columnId: "name", operator: "isAnyOf", value: ["Alice", "Mallory", ""] }];
    doc.views[1]!.state.filters = [{ columnId: "name", operator: "isNoneOf", value: ["Mallory"] }];
    const { probe } = setup({ storage: createMemoryViewsStorage(doc) }, { columns: choiceColumns });
    await ready(probe);
    act(() => probe.current!.views.selectView("a"));
    expect(probe.current!.filter).toMatchObject([{ columnId: "name", operator: "isAnyOf", value: ["Alice", ""] }]);
    act(() => probe.current!.views.selectView("b"));
    expect(probe.current!.filter).toEqual([]);
  });

  it("keeps a data value outside the choices and matches without regard to case when a view opens", async () => {
    const doc = seeded();
    doc.views[0]!.state.filters = [{ columnId: "name", operator: "isAnyOf", value: ["carol", "ALICE"] }];
    const { probe } = setup({ storage: createMemoryViewsStorage(doc) }, { columns: choiceColumns, data: [...rows, { id: "r2", name: "Carol", age: 50 }] });
    await ready(probe);
    act(() => probe.current!.views.selectView("a"));
    expect(probe.current!.filter).toMatchObject([{ columnId: "name", operator: "isAnyOf", value: ["carol", "ALICE"] }]);
  });

  it("keeps every list value in server filter mode when a view opens", async () => {
    const doc = seeded();
    doc.views[0]!.state.filters = [{ columnId: "name", operator: "isAnyOf", value: ["Alice", "Mallory"] }];
    const { probe } = setup({ storage: createMemoryViewsStorage(doc) }, { columns: choiceColumns, sortMode: "server", filterMode: "server" });
    await ready(probe);
    act(() => probe.current!.views.selectView("a"));
    expect(probe.current!.filter).toMatchObject([{ columnId: "name", operator: "isAnyOf", value: ["Alice", "Mallory"] }]);
  });

  it("counts list values outside the column choices as dropped on import", async () => {
    const { probe } = setup({ storage: createMemoryViewsStorage() }, { columns: choiceColumns });
    await ready(probe);
    const file = JSON.stringify({ format: "gridcn-view", version: 1, name: "Picked", state: { filters: [{ columnId: "name", operator: "isAnyOf", value: ["Bob", "Mallory"] }] } });
    let result: ReturnType<UseDataGridViewsResult["importView"]> | undefined;
    act(() => {
      result = probe.current!.views.importView(file);
    });
    expect(result).toMatchObject({ ok: true, dropped: 1 });
    expect(probe.current!.views.views.at(-1)!.state.filters).toEqual([{ columnId: "name", operator: "isAnyOf", value: ["Bob"] }]);
  });
});

describe("useDataGridViews storage events", () => {
  it("reloads the views when the storage reports a change from another tab", async () => {
    let stored: DataGridViewsDocument = seeded();
    let notify: () => void = () => {};
    const storage: DataGridViewsStorage = {
      load: () => stored,
      save: (next) => {
        stored = next;
      },
      subscribe: (onChange) => {
        notify = onChange;
        return () => {};
      },
    };
    const { probe } = setup({ storage });
    await ready(probe);
    expect(probe.current!.views.views.map((v) => v.name)).toEqual(["By age", "Alices"]);
    stored = { ...stored, views: [...stored.views, { id: "c", name: "From tab two", state: emptyViewState() }] };
    act(() => notify());
    await waitFor(() => expect(probe.current!.views.views.map((v) => v.name)).toEqual(["By age", "Alices", "From tab two"]));
  });
});

describe("useDataGridViews storage events, inline storage", () => {
  function tabStorage(doc: DataGridViewsDocument) {
    const state = { stored: doc, notify: () => {}, subscribes: 0 };
    const make = (): DataGridViewsStorage => ({
      load: () => state.stored,
      save: (next) => {
        state.stored = next;
      },
      subscribe: (onChange) => {
        state.subscribes += 1;
        state.notify = onChange;
        return () => {};
      },
    });
    return { state, make };
  }

  it("subscribes once for an inline storage object that changes on every render", async () => {
    const tab = tabStorage(seeded());
    const probe: { current: Probe | null } = { current: null };
    const tree = () => (
      <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id}>
        <Harness options={{ storage: tab.make() }} onProbe={(p) => (probe.current = p)} />
      </DataGridProvider>
    );
    const view = render(tree());
    await ready(probe);
    view.rerender(tree());
    view.rerender(tree());
    expect(tab.state.subscribes).toBe(1);
  });

  it("clears the active view when another tab deleted it", async () => {
    const tab = tabStorage(seeded());
    const onValueChange = vi.fn();
    const { probe } = setup({ storage: tab.make(), onValueChange });
    await ready(probe);
    act(() => probe.current!.views.selectView("a"));
    expect(probe.current!.views.activeViewId).toBe("a");
    tab.state.stored = { ...tab.state.stored, views: tab.state.stored.views.filter((v) => v.id !== "a") };
    act(() => tab.state.notify());
    await waitFor(() => expect(probe.current!.views.activeViewId).toBeNull());
    expect(onValueChange).toHaveBeenLastCalledWith(null);
  });
});

describe("useDataGridViews limits", () => {
  const wide = defineColumns<Record<string, string> & { id: string }>()(
    Array.from({ length: 65 }, (_, i) => ({ id: `c${i}`, header: `C${i}`, accessorKey: `c${i}`, type: "text", width: 80 })) as never,
  );
  const wideRows = [{ id: "r0", ...Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`c${i}`, "x"])) }];

  async function setupWide() {
    const probe: { current: Probe | null } = { current: null };
    render(
      <DataGridProvider data={wideRows} columns={wide} getRowId={(r) => r.id}>
        <Harness options={{ storage: createMemoryViewsStorage() }} onProbe={(p) => (probe.current = p)} />
      </DataGridProvider>,
    );
    await ready(probe);
    return probe;
  }

  it("a state with every kind of part saves unchanged and reads as not modified", async () => {
    const { probe } = setup({ storage: createMemoryViewsStorage() });
    await ready(probe);
    act(() => {
      probe.current!.actions.setSorts([{ columnId: "age", direction: "desc" }, { columnId: "name", direction: "asc" }]);
      probe.current!.actions.setFilters([
        { columnId: "name", operator: "contains", value: "a" },
        { columnId: "age", operator: "isBetween", value: ["1", "99"] },
        { columnId: "name", operator: "isAnyOf", value: ["Alice", ""] },
        { columnId: "name", operator: "isNoneOf", value: ["Bob"] },
        { columnId: "name", operator: "empty" },
        { join: "or", filters: [{ columnId: "age", operator: "gt", value: "3" }, { columnId: "age", operator: "lte", value: "9" }] },
      ]);
      probe.current!.actions.setSearch("ali", { matchCase: true, wholeCell: false });
      probe.current!.actions.setColumnLayout({ widths: { name: 150 }, order: ["age", "name"], pins: { age: "start" }, hidden: [] });
    });
    expect(probe.current!.views.overLimit).toBe(false);
    let saved: ReturnType<UseDataGridViewsResult["saveView"]> = null;
    act(() => {
      saved = probe.current!.views.saveView("All parts");
    });
    expect(saved).not.toBeNull();
    expect(probe.current!.views.modified).toBe(false);
  });

  it.each([
    ["a filter value of 1,001 characters", "filters", () => ({ filters: [{ columnId: "name", operator: "contains", value: "x".repeat(1001) }] as FilterNode[] })],
    ["an isAnyOf list of 1,001 entries", "filters", () => ({ filters: [{ columnId: "name", operator: "isAnyOf", value: Array.from({ length: 1001 }, (_, i) => `v${i}`) }] as FilterNode[] })],
    ["an isNoneOf list of 1,001 entries", "filters", () => ({ filters: [{ columnId: "name", operator: "isNoneOf", value: Array.from({ length: 1001 }, (_, i) => `v${i}`) }] as FilterNode[] })],
    ["65 short filters", "filters", () => ({ filters: Array.from({ length: 65 }, (_, i) => ({ columnId: "name", operator: "contains", value: `v${i}` })) as FilterNode[] })],
    ["a search text of 501 characters", "search", () => ({ search: "s".repeat(501) })],
    ["a column width of 12,000 px", "layout", () => ({ layout: { widths: { name: 12_000 }, order: [], pins: {}, hidden: [] } })],
  ])("%s is refused: overLimit names %s, saveView returns null, updateView returns false", async (_name, part, make) => {
    const { probe } = setup({ storage: createMemoryViewsStorage() });
    await ready(probe);
    let first: ReturnType<UseDataGridViewsResult["saveView"]> = null;
    act(() => {
      first = probe.current!.views.saveView("Fine");
    });
    expect(first).not.toBeNull();
    const change = make() as { filters?: FilterNode[]; search?: string; layout?: DataGridViewState["columnLayout"] };
    act(() => {
      if (change.filters) probe.current!.actions.setFilters(change.filters);
      if (change.search) probe.current!.actions.setSearch(change.search);
      if (change.layout) probe.current!.actions.setColumnLayout(change.layout);
    });
    expect(probe.current!.views.overLimit).toBe(part);
    let result: unknown = "unset";
    let updated: boolean | undefined;
    act(() => {
      result = probe.current!.views.saveView("Too much");
      updated = probe.current!.views.updateView();
    });
    expect(result).toBeNull();
    expect(updated).toBe(false);
    expect(probe.current!.views.views).toHaveLength(1);
    expect(probe.current!.views.activeView!.name).toBe("Fine");
  });

  it("a grid with a 300-character column id can save, sort on it, and reads as not modified", async () => {
    const longId = "c".repeat(300);
    const longColumns = defineColumns<Row>()([
      { id: "name", header: "Name", accessorKey: "name", type: "text", width: 100 },
      { id: longId, header: "Age", accessorKey: "age", type: "number", width: 80 },
    ] as never);
    const probe: { current: Probe | null } = { current: null };
    render(
      <DataGridProvider data={rows} columns={longColumns} getRowId={(r) => r.id}>
        <Harness options={{ storage: createMemoryViewsStorage() }} onProbe={(p) => (probe.current = p)} />
      </DataGridProvider>,
    );
    await ready(probe);
    expect(probe.current!.views.overLimit).toBe(false);
    act(() => probe.current!.actions.setSorts([{ columnId: longId, direction: "desc" }]));
    expect(probe.current!.views.overLimit).toBe(false);
    let saved: ReturnType<UseDataGridViewsResult["saveView"]> = null;
    act(() => {
      saved = probe.current!.views.saveView("Long id");
    });
    expect(saved).not.toBeNull();
    expect(probe.current!.views.modified).toBe(false);
  });

  describe("state of a column the grid lacks is not a view limit", () => {
    const [nameColumn] = columns;
    const withColumns = (...cols: readonly object[]) => defineColumns<Row>()(cols as never);
    const both = withColumns(columns[0], columns[1]);
    const nameOnly = withColumns(nameColumn);

    async function mountSwappable(initial: typeof both, providerProps: Record<string, unknown> = {}) {
      const probe: { current: Probe | null } = { current: null };
      const tree = (cols: typeof both) => (
        <DataGridProvider data={rows} columns={cols} getRowId={(r) => r.id} {...providerProps}>
          <Harness options={{ storage: createMemoryViewsStorage() }} onProbe={(p) => (probe.current = p)} />
        </DataGridProvider>
      );
      const view = render(tree(initial));
      await ready(probe);
      return { probe, swap: (cols: typeof both) => view.rerender(tree(cols)) };
    }
    function expectSavable(probe: { current: Probe | null }) {
      expect(probe.current!.views.overLimit).toBe(false);
      let saved: ReturnType<UseDataGridViewsResult["saveView"]> = null;
      act(() => {
        saved = probe.current!.views.saveView("Kept");
      });
      expect(saved).not.toBeNull();
    }

    it("a sort on an unknown column", async () => {
      const { probe } = await mountSwappable(both);
      act(() => probe.current!.actions.setSorts([{ columnId: "ghost", direction: "asc" }]));
      expectSavable(probe);
    });
    it("a server filter on a field that is not a column", async () => {
      const { probe } = await mountSwappable(both, { filterMode: "server" });
      act(() => probe.current!.actions.setFilters([{ columnId: "ghost", operator: "contains", value: "x" }]));
      expectSavable(probe);
    });
    it("a server filter with an operator the column does not register", async () => {
      const { probe } = await mountSwappable(both, { filterMode: "server" });
      act(() => probe.current!.actions.setFilters([{ columnId: "name", operator: "fuzzy" as never, value: "x" }]));
      expectSavable(probe);
    });
    it("a width of a removed column", async () => {
      const { probe, swap } = await mountSwappable(both);
      act(() => probe.current!.actions.setColumnLayout({ widths: { name: 150, age: 222 } } as never));
      swap(nameOnly);
      expectSavable(probe);
    });
    it("a hidden removed column", async () => {
      const { probe, swap } = await mountSwappable(both);
      act(() => probe.current!.actions.setColumnLayout({ hidden: ["age"] } as never));
      swap(nameOnly);
      expectSavable(probe);
    });
    it("a sort and a filter on a removed column", async () => {
      const { probe, swap } = await mountSwappable(both);
      act(() => {
        probe.current!.actions.setSorts([{ columnId: "age", direction: "asc" }]);
        probe.current!.actions.setFilters([{ columnId: "age", operator: "equals", value: "30" }]);
      });
      swap(nameOnly);
      expectSavable(probe);
    });
    it("a column added after a reorder", async () => {
      const { probe, swap } = await mountSwappable(nameOnly);
      act(() => probe.current!.actions.setColumnLayout({ order: ["name"] } as never));
      swap(both);
      expectSavable(probe);
    });
  });

  it("65 sorts are refused and 64 are saved", async () => {
    const probe = await setupWide();
    act(() => probe.current!.actions.setSorts(Array.from({ length: 64 }, (_, i) => ({ columnId: `c${i}`, direction: "asc" as const }))));
    expect(probe.current!.views.overLimit).toBe(false);
    let saved: unknown = null;
    act(() => {
      saved = probe.current!.views.saveView("Max sorts");
    });
    expect(saved).not.toBeNull();
    act(() => probe.current!.actions.setSorts(Array.from({ length: 65 }, (_, i) => ({ columnId: `c${i}`, direction: "asc" as const }))));
    expect(probe.current!.views.overLimit).toBe("sorts");
    let result: unknown = "unset";
    act(() => {
      result = probe.current!.views.saveView("Many sorts");
    });
    expect(result).toBeNull();
  });
});

describe("saved views on a server grid that holds its rows", () => {
  it("save the requested groupBy next to the sorts while the old groups stay on screen", async () => {
    const people: Row[] = [...rows, { id: "r2", name: "Carol", age: 30 }];
    const fake = fakeServer(people);
    let open = true;
    const parked: (() => void)[] = [];
    const fetchRows = (request: ServerRowsRequest<never>) => (open ? fake.fetchRows(request) : new Promise((resolve) => parked.push(() => void fake.fetchRows(request).then(resolve))));
    const probe: { current: Probe | null } = { current: null };
    let shownGroupBy: () => readonly string[] = () => [];
    function Shown() {
      const storeApi = useDataGridStoreApi();
      shownGroupBy = () => storeApi.getState().groupBy;
      return null;
    }
    function ServerGrid() {
      const server = useDataGridServerRows<Row>({ mode: "scroll", getRowId: (r) => r.id, fetchRows: fetchRows as never, loadDelayMs: 0, defaultSpec: { sorts: [], filters: [], searchText: "", groupBy: ["name"] } });
      return (
        <DataGridProvider columns={columns} {...server.providerProps}>
          <Harness options={{ storage: createMemoryViewsStorage(), enableDefaultView: false }} onProbe={(p) => (probe.current = p)} />
          <Shown />
        </DataGridProvider>
      );
    }
    render(<ServerGrid />);
    await ready(probe);
    await waitFor(() => expect(fake.fetchRows).toHaveBeenCalled());
    open = false;
    act(() => {
      probe.current!.actions.setGroupBy(["age"]);
      probe.current!.actions.setSorts([{ columnId: "age", direction: "desc" }]);
    });
    expect(shownGroupBy()).toEqual(["name"]);
    let saved: ReturnType<UseDataGridViewsResult["saveView"]> = null;
    act(() => {
      saved = probe.current!.views.saveView("Held");
    });
    expect(saved!.state).toMatchObject({ groupBy: ["age"], sorts: [{ columnId: "age", direction: "desc" }] });
    open = true;
    act(() => parked.splice(0).forEach((go) => go()));
  });
});

describe("saved views under pivot", () => {
  type PivotRow = { id: string; region: string; make: string; qty: number; secret: string };
  const pivotRows: PivotRow[] = [
    { id: "p0", region: "North", make: "Audi", qty: 1, secret: "x" },
    { id: "p1", region: "North", make: "BMW", qty: 2, secret: "y" },
    { id: "p2", region: "South", make: "Audi", qty: 3, secret: "x" },
  ];
  const pivotColumns = defineColumns<PivotRow>()([
    { id: "region", header: "Region", accessorKey: "region", type: "text" },
    { id: "make", header: "Make", accessorKey: "make", type: "text" },
    { id: "qty", header: "Qty", accessorKey: "qty", type: "number", aggregate: "sum" },
    { id: "secret", header: "Secret", accessorKey: "secret", type: "text", groupable: false },
  ] as const);
  const sum = { columnId: "qty", reducer: "sum" } as const;
  const audi = pivotColumnId("make", "Audi", sum);
  const bmw = pivotColumnId("make", "BMW", sum);
  const pivoted = (extra: Partial<DataGridViewState> = {}): DataGridViewState => ({ ...emptyViewState(), groupBy: ["region"], pivotColumnId: "make", pivotWidths: { [audi]: 210, [bmw]: 160 }, ...extra });
  const docOf = (...states: DataGridViewState[]): DataGridViewsDocument => ({ version: 1, defaultViewId: null, views: states.map((state, i) => ({ id: `v${i}`, name: `V${i}`, state })) });

  function pivotSetup(doc: DataGridViewsDocument, providerProps: Record<string, unknown> = {}) {
    const probe: { current: Probe | null } = { current: null };
    let store: ReturnType<typeof useDataGridStoreApi> | null = null;
    function Store() {
      store = useDataGridStoreApi();
      return null;
    }
    const storage = createMemoryViewsStorage(doc);
    const tree = (props: Record<string, unknown>, mounted = true) => (
      <DataGridProvider data={pivotRows} columns={pivotColumns} getRowId={(r) => r.id} {...props}>
        {mounted ? <Harness options={{ storage, enableDefaultView: false }} onProbe={(p) => (probe.current = p)} /> : null}
        <Store />
      </DataGridProvider>
    );
    const view = render(tree(providerProps));
    return { probe, state: () => store!.getState(), rerender: (props: Record<string, unknown>, mounted?: boolean) => view.rerender(tree(props, mounted)) };
  }

  it("capture the pivot column and the widths of generated columns", async () => {
    const t = pivotSetup(docOf(), { defaultGroupBy: ["region"], defaultPivot: { columnIds: ["make"] } });
    await ready(t.probe);
    act(() => t.probe.current!.actions.setColumnWidth(audi, 200));
    let saved: ReturnType<UseDataGridViewsResult["saveView"]> = null;
    act(() => {
      saved = t.probe.current!.views.saveView("Pivot");
    });
    expect(saved!.state).toMatchObject({ groupBy: ["region"], pivotColumnId: "make", pivotWidths: { [audi]: 200 } });
    expect(Object.keys(saved!.state.columnLayout.widths).some((id) => id.startsWith("__pivot"))).toBe(false);
    expect(t.probe.current!.views.modified).toBe(false);
    act(() => t.probe.current!.actions.setColumnWidth(audi, 230));
    expect(t.probe.current!.views.modified).toBe(true);
  });

  it("restore the pivot through setPivot and the generated widths, and turn the pivot off for a view without one", async () => {
    const onPivotChange = vi.fn();
    const t = pivotSetup(docOf(pivoted(), { ...emptyViewState(), groupBy: ["region"] }), { onPivotChange });
    await ready(t.probe);
    act(() => t.probe.current!.views.selectView("v0"));
    expect(t.state().pivotColumnIds).toEqual(["make"]);
    expect(t.state().pivot?.columns.map((c) => c.id)).toEqual([audi, bmw]);
    expect(t.state().columnWidths).toMatchObject({ [audi]: 210, [bmw]: 160 });
    expect(onPivotChange).toHaveBeenLastCalledWith({ columnIds: ["make"] });
    expect(t.probe.current!.views.modified).toBe(false);
    act(() => t.probe.current!.views.selectView("v1"));
    expect(t.state().pivotColumnIds).toEqual([]);
    expect(t.state().pivot).toBeNull();
    expect(onPivotChange).toHaveBeenLastCalledWith({ columnIds: [] });
  });

  it("restore an old view without the pivot fields as before", async () => {
    const old = { ...emptyViewState(), groupBy: ["region"], sorts: [{ columnId: "qty", direction: "desc" as const }] };
    const t = pivotSetup(docOf(old));
    await ready(t.probe);
    act(() => t.probe.current!.views.selectView("v0"));
    expect(t.state().groupBy).toEqual(["region"]);
    expect(t.state().sortState).toEqual(old.sorts);
    expect(t.state().pivotColumnIds).toEqual([]);
    expect(t.probe.current!.views.modified).toBe(false);
  });

  it("hold the widths of generated columns that have not landed until they land, and drop them on the next view change", async () => {
    const north = { viewRow: 0, path: [{ columnId: "region", key: "North" }], count: 2, childCount: 0, pivotCells: Float64Array.of(1, 2) };
    const layoutOf = (keys: string[]) => ({ rows: [north], leafCount: 2, pivot: { columnId: "make", values: [sum], columns: keys.map((key) => ({ path: [key], valueIndex: 0 })), omitted: 0 } });
    const server = { groupBy: ["region"], groupMode: "server", pivot: { columnIds: ["make"] } };
    const t = pivotSetup(docOf(pivoted(), pivoted({ pivotWidths: { [bmw]: 120 } })), { ...server, groupLayout: layoutOf(["Audi"]) });
    await ready(t.probe);
    act(() => t.probe.current!.views.selectView("v0"));
    expect(t.state().columnWidths[audi]).toBe(210);
    expect(t.state().columnWidths[bmw]).toBeUndefined();
    t.rerender({ ...server, groupLayout: layoutOf(["Audi", "BMW"]) });
    await waitFor(() => expect(t.state().columnWidths[bmw]).toBe(160));
    expect(t.probe.current!.views.modified).toBe(false);
    act(() => t.probe.current!.views.selectView("v1"));
    t.rerender({ ...server, groupLayout: layoutOf(["Audi"]) });
    act(() => t.probe.current!.views.selectView("v0"));
    act(() => t.probe.current!.views.selectView("v1"));
    t.rerender({ ...server, groupLayout: layoutOf(["Audi", "BMW"]) });
    await waitFor(() => expect(t.state().pivot?.columns).toHaveLength(2));
    expect(t.state().columnWidths[bmw]).toBe(120);
  });

  it("stop holding widths when the views hook unmounts", async () => {
    const north = { viewRow: 0, path: [{ columnId: "region", key: "North" }], count: 2, childCount: 0, pivotCells: Float64Array.of(1) };
    const server = { groupBy: ["region"], groupMode: "server", pivot: { columnIds: ["make"] } };
    const t = pivotSetup(docOf(pivoted()), { ...server, groupLayout: { rows: [north], leafCount: 2 } });
    await ready(t.probe);
    act(() => t.probe.current!.views.selectView("v0"));
    t.rerender({ ...server, groupLayout: { rows: [north], leafCount: 2 } }, false);
    t.rerender({ ...server, groupLayout: { rows: [north], leafCount: 2, pivot: { columnId: "make", values: [sum], columns: [{ path: ["Audi"], valueIndex: 0 }], omitted: 0 } } }, false);
    await waitFor(() => expect(t.state().pivot?.columns).toHaveLength(1));
    expect(t.state().columnWidths[audi]).toBeUndefined();
  });

  it.each([
    ["an unknown pivot column", { pivotColumnId: "gone" }],
    ["a pivot column that is not groupable", { pivotColumnId: "secret" }],
    ["a pivot column the view hides", { columnLayout: { widths: {}, order: [], pins: {}, hidden: ["make"] } }],
    ["a pivot column in groupBy", { groupBy: ["region", "make"] }],
    ["a view without groupBy", { groupBy: [] }],
    ["a hostile width list", { pivotWidths: JSON.parse(`{"__proto__": 5, "__pivotgroup:make=Audi": 90, "qty": 90, "${audi}": "wide", "${bmw}": 1e400}`) }],
    ["a long generated id", { pivotWidths: { [`__pivot:${"x".repeat(5000)}`]: 100 } }],
  ])("restore a stored view with %s without a throw or a warning, and never pivot where the grid would ignore it", async (_name, change) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const stored = JSON.parse(JSON.stringify(docOf(pivoted(change as Partial<DataGridViewState>))));
    const t = pivotSetup(stored, { defaultGroupBy: ["region"], defaultPivot: { columnIds: ["make"] } });
    await ready(t.probe);
    act(() => t.probe.current!.views.selectView("v0"));
    const s = t.state();
    if (s.pivotColumnIds.length > 0) {
      expect(s.groupBy.length).toBeGreaterThan(0);
      expect(s.groupBy).not.toContain(s.pivotColumnIds[0]);
      expect(s.pivot).not.toBeNull();
    }
    expect(Object.keys(s.columnWidths).every((id) => !id.startsWith("__pivot") || s.pivot?.columns.some((c) => c.id === id))).toBe(true);
    expect(warn.mock.calls.concat(error.mock.calls).map(String).filter((call) => call.includes("pivot"))).toEqual([]);
    warn.mockRestore();
    error.mockRestore();
  });

  it("keep a pivot saved over 200 widths to 200", async () => {
    const many = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [pivotColumnId("make", `k${i}`, sum), 100]));
    const stored = JSON.parse(JSON.stringify(docOf(pivoted({ pivotWidths: { [audi]: 190, ...many } }))));
    const t = pivotSetup(stored);
    await ready(t.probe);
    expect(Object.keys(t.probe.current!.views.views[0]!.state.pivotWidths!)).toHaveLength(200);
    act(() => t.probe.current!.views.selectView("v0"));
    expect(t.state().columnWidths[audi]).toBe(190);
  });
});
