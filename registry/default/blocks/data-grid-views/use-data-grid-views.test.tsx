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
import { useDataGridViews, type UseDataGridViewsOptions, type UseDataGridViewsResult } from "./use-data-grid-views";
import { createMemoryViewsStorage, type DataGridViewsStorage } from "./view-storage";
import { emptyViewState, type DataGridViewsDocument } from "./view-state";

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
    const load = vi.fn(() => seeded());
    const { probe } = setup({ storage: { load, save: () => {} } }, {}, undefined, true);
    await ready(probe);
    expect(probe.current!.views.views).toHaveLength(2);
  });

  it("ignores a result that lands after unmount", async () => {
    let resolve: (doc: DataGridViewsDocument) => void = () => {};
    const storage: DataGridViewsStorage = { load: () => new Promise((r) => (resolve = r)), save: () => {} };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { view } = setup({ storage });
    view.unmount();
    resolve(seeded());
    await Promise.resolve();
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
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
});
