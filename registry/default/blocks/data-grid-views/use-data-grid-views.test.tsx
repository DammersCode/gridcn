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
import { useDataGridServerRows } from "@/registry/default/blocks/data-grid-server/data-grid-server";
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

type Probe = {
  views: UseDataGridViewsResult;
  sort: SortSpec[];
  filter: FilterNode[];
  search: string;
  actions: ReturnType<typeof useDataGridActions>;
};

function Harness({ options, onProbe, beforeLoad }: { options?: UseDataGridViewsOptions; onProbe: (p: Probe) => void; beforeLoad?: (a: ReturnType<typeof useDataGridActions>) => void }) {
  const views = useDataGridViews(options);
  const sort = useDataGridSortState();
  const filter = useDataGridFilterState();
  const search = useDataGridSearchText();
  const actions = useDataGridActions();
  useEffect(() => beforeLoad?.(actions), []); // oxlint-disable-line react-hooks/exhaustive-deps
  onProbe({ views, sort, filter, search, actions });
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
    doc.views[0]!.state.columnLayout = { widths: { name: 222 }, order: ["age", "name"], pins: { age: "left" }, hidden: [] };
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
    const { probe } = setup({ storageKey: "views-test" });
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
        <Harness options={{ storageKey }} onProbe={(p) => (probe.current = p)} />
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
        <Harness options={{ storageKey }} onProbe={(p) => (probe.current = p)} />
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
});

describe("useDataGridViews limits", () => {
  const wide = defineColumns<Record<string, string> & { id: string }>()(
    Array.from({ length: 17 }, (_, i) => ({ id: `c${i}`, header: `C${i}`, accessorKey: `c${i}`, type: "text", width: 80 })) as never,
  );
  const wideRows = [{ id: "r0", ...Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`c${i}`, "x"])) }];

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
      probe.current!.actions.setColumnLayout({ widths: { name: 150 }, order: ["age", "name"], pins: { age: "left" }, hidden: [] });
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

  it("17 sorts are refused and 16 are saved", async () => {
    const probe = await setupWide();
    act(() => probe.current!.actions.setSorts(Array.from({ length: 16 }, (_, i) => ({ columnId: `c${i}`, direction: "asc" as const }))));
    expect(probe.current!.views.overLimit).toBe(false);
    act(() => probe.current!.actions.setSorts(Array.from({ length: 17 }, (_, i) => ({ columnId: `c${i}`, direction: "asc" as const }))));
    expect(probe.current!.views.overLimit).toBe("sorts");
    let result: unknown = "unset";
    act(() => {
      result = probe.current!.views.saveView("Many sorts");
    });
    expect(result).toBeNull();
  });
});
