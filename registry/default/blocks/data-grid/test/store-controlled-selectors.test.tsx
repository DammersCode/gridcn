import { act, render, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import type { DataChange } from "../types";
import { withFilterIds } from "../store/compute";
import { DataGridProvider, createDataGridSelector, useDataGridInternalActions, useDataGridActiveCell, useDataGridEditing, useDataGridFilterState, useDataGridIsColumnFiltered, useDataGridRow, useDataGridSearchMatches, useDataGridSearchText, useDataGridSelection, useDataGridSortState, useDataGridStoreApi, useDataGridViewIndex, useDataGridViewStale, type DataGridStoreState, useDataGridSelector } from "../store";
import type { FilterGroup, FilterNode, FilterSpec, SortSpec } from "../types";
import { viewIndexes } from "@/registry/default/blocks/data-grid/types";
import { type Row, columns, rows, makeWrapper, makeConfigWrapper, type EditRow, makeUncontrolledWrapper } from "./store-setup.test-helper";

describe("controlled sortState/filterState/searchText (server escape hatch)", () => {
  function useSortProbe() {
    return { actions: useDataGridInternalActions(), sortState: useDataGridSortState(), viewIndex: useDataGridViewIndex() };
  }
  function useFilterProbe() {
    return { actions: useDataGridInternalActions(), filterState: useDataGridFilterState(), viewIndex: useDataGridViewIndex() };
  }
  function useSearchProbe() {
    return { actions: useDataGridInternalActions(), searchText: useDataGridSearchText(), searchMatches: useDataGridSearchMatches() };
  }

  describe("uncontrolled (prop omitted): unchanged store-owned behavior", () => {
    it("toggleSort mutates sortState/viewIndex directly, no callback required", () => {
      const wrapper = makeWrapper();
      const { result, rerender } = renderHook(useSortProbe, { wrapper });
      act(() => result.current.actions.toggleSort("name"));
      rerender();
      expect(result.current.sortState).toEqual([{ columnId: "name", direction: "asc" }]);
      expect(result.current.viewIndex).toEqual([1, 2, 0]); // Alice, Bob, Charlie
    });

    it("setFilters mutates filterState/viewIndex directly", () => {
      const wrapper = makeWrapper();
      const { result, rerender } = renderHook(useFilterProbe, { wrapper });
      act(() => result.current.actions.setFilters([{ columnId: "name", operator: "contains", value: "a" }]));
      rerender();
      // setFilters backfills a stable filterId for any row the caller didn't supply one for.
      expect(result.current.filterState).toEqual([
        { filterId: expect.any(String), columnId: "name", operator: "contains", value: "a" },
      ]);
      expect(result.current.viewIndex.length).toBeLessThan(3);
    });

    it("an isAnyOf filter keeps every row matching any listed choice", () => {
      const wrapper = makeWrapper();
      const { result, rerender } = renderHook(useFilterProbe, { wrapper });
      act(() =>
        result.current.actions.setFilters([{ columnId: "name", operator: "isAnyOf", value: ["Alice", "Bob"] }]),
      );
      rerender();
      // rows() is Charlie/Alice/Bob — two of the three survive, in data order
      expect(result.current.viewIndex).toEqual([1, 2]);
    });

    it("an isAnyOf filter with no choices selected keeps no rows", () => {
      const wrapper = makeWrapper();
      const { result, rerender } = renderHook(useFilterProbe, { wrapper });
      act(() => result.current.actions.setFilters([{ columnId: "name", operator: "isAnyOf", value: [] }]));
      rerender();
      expect(result.current.viewIndex).toEqual([]);
    });

    it("setSearch mutates searchText/searchMatches directly", () => {
      const wrapper = makeWrapper();
      const { result, rerender } = renderHook(useSearchProbe, { wrapper });
      act(() => result.current.actions.setSearch("Alice"));
      rerender();
      expect(result.current.searchText).toBe("Alice");
      expect(result.current.searchMatches.length).toBeGreaterThan(0);
    });
  });

  describe("callback fires in uncontrolled mode too (React input convention: onXChange always fires on user-driven change)", () => {
    it("onSortChange fires from toggleSort even though sortState prop is absent", () => {
      const onSortChange = vi.fn();
      const wrapper = makeConfigWrapper({ onSortChange });
      const { result } = renderHook(useSortProbe, { wrapper });
      act(() => result.current.actions.toggleSort("name"));
      expect(onSortChange).toHaveBeenCalledWith([{ columnId: "name", direction: "asc" }]);
    });

    it("onFilterChange fires from setFilters even though filterState prop is absent", () => {
      const onFilterChange = vi.fn();
      const wrapper = makeConfigWrapper({ onFilterChange });
      const { result } = renderHook(useFilterProbe, { wrapper });
      const spec: FilterSpec[] = [{ columnId: "name", operator: "contains", value: "a" }];
      act(() => result.current.actions.setFilters(spec));
      // the callback receives the filterId-backfilled filters, not the caller's original array.
      expect(onFilterChange).toHaveBeenCalledWith([{ filterId: expect.any(String), ...spec[0] }]);
    });

    it("onSearchTextChange fires from setSearch even though searchText prop is absent", () => {
      const onSearchTextChange = vi.fn();
      const wrapper = makeConfigWrapper({ onSearchTextChange });
      const { result } = renderHook(useSearchProbe, { wrapper });
      act(() => result.current.actions.setSearch("Alice"));
      expect(onSearchTextChange).toHaveBeenCalledWith("Alice");
    });

    it("an options-only setSearch does not fire onSearchTextChange with unchanged text", () => {
      const onSearchTextChange = vi.fn();
      const wrapper = makeConfigWrapper({ onSearchTextChange });
      const { result } = renderHook(useSearchProbe, { wrapper });
      act(() => result.current.actions.setSearch("Alice"));
      act(() => result.current.actions.setSearch("Alice", { matchCase: true }));
      expect(onSearchTextChange).toHaveBeenCalledTimes(1);
    });
  });

  describe("controlled sortState: prop drives view order, header-click fires onSortChange but doesn't reorder until the prop updates", () => {
    it("toggleSort fires onSortChange and leaves viewIndex/sortState untouched (prop stays source of truth)", () => {
      const onSortChange = vi.fn();
      const wrapper = makeConfigWrapper({ sortState: [], onSortChange });
      const { result, rerender } = renderHook(useSortProbe, { wrapper });

      expect(result.current.viewIndex).toEqual([0, 1, 2]); // original order, untouched by the click below

      act(() => result.current.actions.toggleSort("name"));
      rerender();

      expect(onSortChange).toHaveBeenCalledWith([{ columnId: "name", direction: "asc" }]);
      // controlled: the store's sortState/viewIndex do NOT move just because the user clicked —
      // only the prop itself (via _syncProps) can move them (standard controlled-input semantics).
      expect(result.current.sortState).toEqual([]);
      expect(result.current.viewIndex).toEqual([0, 1, 2]);
    });

    it("viewIndex updates once the sortState prop itself changes (consumer applies the callback's value)", () => {
      // Mirrors a real controlled consumer: sortState lives in a variable this test mutates directly
      // (standing in for the consumer's own useState + setState) and re-renders through — the
      // wrapper always reads the CURRENT value, so mutating it + rerender() simulates the prop
      // actually changing. onSortChange only records the pending value (like a setState call queued
      // but not yet applied) — applying it is a deliberate separate step, so the test can assert the
      // view stays put on the render where only toggleSort ran, same as a real setState's next render.
      let currentSortState: SortSpec[] = [];
      let pendingSortState: SortSpec[] | null = null;
      const onSortChange = vi.fn((next: SortSpec[]) => {
        pendingSortState = next;
      });
      function ControlledWrapper({ children }: { children: ReactNode }) {
        return (
          <DataGridProvider data={rows()} columns={columns} getRowId={(r) => r.id} sortState={currentSortState} onSortChange={onSortChange}>
            {children}
          </DataGridProvider>
        );
      }
      const { result, rerender } = renderHook(useSortProbe, { wrapper: ControlledWrapper });
      expect(result.current.viewIndex).toEqual([0, 1, 2]);

      act(() => result.current.actions.toggleSort("name"));
      rerender();
      expect(onSortChange).toHaveBeenCalledWith([{ columnId: "name", direction: "asc" }]);
      expect(result.current.viewIndex).toEqual([0, 1, 2]); // still unmoved — the prop hasn't changed yet

      currentSortState = pendingSortState!; // the consumer applies the callback's value
      rerender();
      expect(result.current.sortState).toEqual([{ columnId: "name", direction: "asc" }]);
      expect(result.current.viewIndex).toEqual([1, 2, 0]); // Alice, Bob, Charlie
    });

    it("a callback-ignoring consumer's grid stays visually fixed (controlled-input semantics)", () => {
      // sortState is always [] — the consumer never applies onSortChange's value.
      const wrapper = makeConfigWrapper({ sortState: [], onSortChange: () => {} });
      const { result, rerender } = renderHook(useSortProbe, { wrapper });
      act(() => result.current.actions.toggleSort("name"));
      act(() => result.current.actions.toggleSort("age"));
      rerender();
      expect(result.current.sortState).toEqual([]);
      expect(result.current.viewIndex).toEqual([0, 1, 2]);
    });
  });

  describe("controlled filterState", () => {
    it("setFilters fires onFilterChange without touching store filterState/viewIndex", () => {
      const onFilterChange = vi.fn();
      const wrapper = makeConfigWrapper({ filterState: [], onFilterChange });
      const { result, rerender } = renderHook(useFilterProbe, { wrapper });
      const spec: FilterSpec[] = [{ columnId: "name", operator: "contains", value: "a" }];

      act(() => result.current.actions.setFilters(spec));
      rerender();

      expect(onFilterChange).toHaveBeenCalledWith([{ filterId: expect.any(String), ...spec[0] }]);
      expect(result.current.filterState).toEqual([]);
      expect(result.current.viewIndex).toEqual([0, 1, 2]);
    });

    it("viewIndex narrows once the filterState prop itself changes", () => {
      const wrapper = makeConfigWrapper({ filterState: [{ columnId: "name", operator: "contains", value: "a" }] });
      const { result } = renderHook(useFilterProbe, { wrapper });
      // "Charlie", "Alice", "Bob" — only Charlie and Alice contain "a".
      expect(result.current.viewIndex).toEqual([0, 1]);
    });
  });

  describe("filterId (backward-compat auto-assignment)", () => {
    it("setFilters backfills a filterId for a row that omits one", () => {
      const wrapper = makeWrapper();
      const { result, rerender } = renderHook(useFilterProbe, { wrapper });
      act(() => result.current.actions.setFilters([{ columnId: "name", operator: "contains", value: "a" }]));
      rerender();
      expect(result.current.filterState[0]!.filterId).toEqual(expect.any(String));
    });

    it("preserves a caller-supplied filterId instead of overwriting it", () => {
      const wrapper = makeWrapper();
      const { result, rerender } = renderHook(useFilterProbe, { wrapper });
      act(() => result.current.actions.setFilters([{ filterId: "custom-1", columnId: "name", operator: "contains", value: "a" }]));
      rerender();
      expect(result.current.filterState[0]!.filterId).toBe("custom-1");
    });

    it("stays stable across an unrelated re-render (same object identity is not required, but the id itself doesn't change)", () => {
      const wrapper = makeWrapper();
      const { result, rerender } = renderHook(useFilterProbe, { wrapper });
      act(() => result.current.actions.setFilters([{ columnId: "name", operator: "contains", value: "a" }]));
      rerender();
      const firstId = result.current.filterState[0]!.filterId;
      rerender();
      expect(result.current.filterState[0]!.filterId).toBe(firstId);
    });

    it("assigns distinct ids to multiple filter rows on the same column", () => {
      const wrapper = makeWrapper();
      const { result, rerender } = renderHook(useFilterProbe, { wrapper });
      act(() =>
        result.current.actions.setFilters([
          { columnId: "age", operator: "gt", value: "10" },
          { columnId: "age", operator: "lt", value: "50" },
        ]),
      );
      rerender();
      const [first, second] = result.current.filterState;
      expect(first!.filterId).toEqual(expect.any(String));
      expect(second!.filterId).toEqual(expect.any(String));
      expect(first!.filterId).not.toBe(second!.filterId);
    });

    it("a controlled filterState prop without filterId still gets one backfilled into the store", () => {
      const wrapper = makeConfigWrapper({ filterState: [{ columnId: "name", operator: "contains", value: "a" }] });
      const { result } = renderHook(useFilterProbe, { wrapper });
      expect(result.current.filterState[0]!.filterId).toEqual(expect.any(String));
    });
  });

  describe("filter groups", () => {
    function useTreeProbe() {
      return { actions: useDataGridInternalActions(), filterState: useDataGridFilterState(), viewIndex: useDataGridViewIndex() };
    }
    const orGroup = (): FilterNode => ({
      join: "or",
      filters: [
        { columnId: "name", operator: "contains", value: "z" }, // matches nobody
        { columnId: "age", operator: "gt", value: "35" }, // matches Bob (40)
      ],
    });

    it("setFilters keeps a group and fills ids at every level", () => {
      const { result } = renderHook(useTreeProbe, { wrapper: makeWrapper() });
      act(() => result.current.actions.setFilters([orGroup()]));
      const [group] = result.current.filterState as FilterGroup[];
      expect(group!.filterId).toEqual(expect.any(String));
      expect(group!.join).toBe("or");
      expect(group!.filters.every((child) => child.filterId)).toBe(true);
      expect(result.current.viewIndex).toEqual([2]);
    });

    it("useDataGridIsColumnFiltered sees a column used only inside a group", () => {
      const { result } = renderHook(
        () => ({ ...useTreeProbe(), age: useDataGridIsColumnFiltered("age"), city: useDataGridIsColumnFiltered("city") }),
        { wrapper: makeWrapper() },
      );
      act(() => result.current.actions.setFilters([orGroup()]));
      expect(result.current.age).toBe(true);
      expect(result.current.city).toBe(false);
    });

    it("withFilterIds keeps the reference when no id is missing", () => {
      const tree: FilterNode[] = [{ filterId: "g", join: "or", filters: [{ filterId: "a", columnId: "name", operator: "equals", value: "x" }] }];
      expect(withFilterIds(tree)).toBe(tree);
    });

    it("withFilterIds fills a nested group and leaves existing ids", () => {
      const tree: FilterNode[] = [{ filterId: "g", join: "and", filters: [{ join: "or", filters: [{ columnId: "name", operator: "equals", value: "x" }] }] }];
      const filled = withFilterIds(tree) as FilterGroup[];
      expect(filled[0]!.filterId).toBe("g");
      const inner = filled[0]!.filters[0] as FilterGroup;
      expect(inner.filterId).toEqual(expect.any(String));
      expect(inner.filters[0]!.filterId).toEqual(expect.any(String));
    });

    it("withFilterIds drops groups below the depth cap, also for a cyclic tree", () => {
      const leaf: FilterNode = { filterId: "l", columnId: "name", operator: "equals", value: "x" };
      const cyclic: FilterGroup = { filterId: "c", join: "or", filters: [leaf] };
      cyclic.filters.push(cyclic);
      const filled = withFilterIds([cyclic]) as FilterGroup[];
      const inner = filled[0]!.filters.find((n) => "filters" in n) as FilterGroup;
      expect(inner.filters.some((n) => "filters" in n)).toBe(false);
    });

    it("onFilterChange emits the tree", () => {
      const onFilterChange = vi.fn();
      const { result } = renderHook(useTreeProbe, { wrapper: makeConfigWrapper({ onFilterChange }) });
      act(() => result.current.actions.setFilters([orGroup()]));
      expect(onFilterChange).toHaveBeenCalledWith([expect.objectContaining({ join: "or", filters: expect.any(Array) })]);
    });

    it("a controlled tree narrows the view and backfills ids", () => {
      const wrapper = makeConfigWrapper({ filterState: [orGroup()] });
      const { result } = renderHook(useTreeProbe, { wrapper });
      expect(result.current.viewIndex).toEqual([2]);
      expect(result.current.filterState[0]!.filterId).toEqual(expect.any(String));
    });
  });

  describe("controlled searchText", () => {
    it("setSearch fires onSearchTextChange without touching store searchText/searchMatches", () => {
      const onSearchTextChange = vi.fn();
      const wrapper = makeConfigWrapper({ searchText: "", onSearchTextChange });
      const { result, rerender } = renderHook(useSearchProbe, { wrapper });

      act(() => result.current.actions.setSearch("Alice"));
      rerender();

      expect(onSearchTextChange).toHaveBeenCalledWith("Alice");
      expect(result.current.searchText).toBe("");
      expect(result.current.searchMatches).toEqual([]);
    });

    it("searchMatches populate once the searchText prop itself changes", () => {
      const wrapper = makeConfigWrapper({ searchText: "Alice" });
      const { result } = renderHook(useSearchProbe, { wrapper });
      expect(result.current.searchText).toBe("Alice");
      expect(result.current.searchMatches.length).toBeGreaterThan(0);
    });
  });
});

describe("updateCells while an edit session is open", () => {
  it("an immediate re-sort applies live under the open editor and remaps the edit to its row's new view slot", () => {
    const onDataChange = vi.fn();
    const wrapper = makeUncontrolledWrapper(onDataChange);
    const { result } = renderHook(
      () => ({
        actions: useDataGridInternalActions(),
        viewIndex: useDataGridViewIndex(),
        viewStale: useDataGridViewStale(),
        editing: useDataGridEditing(),
        activeCell: useDataGridActiveCell(),
      }),
      { wrapper },
    );

    // sorted by name ascending: view order is Alice(1), Bob(2), Charlie(0).
    act(() => result.current.actions.setSorts([{ columnId: "name", direction: "asc" }]));
    expect(result.current.viewIndex).toEqual([1, 2, 0]);
    act(() => result.current.actions.startEditingAt({ col: 0, row: 0 }));

    // Charlie (data 0) renamed to "Aaron": the immediate re-sort moves him to the top of the view
    // and the open edit (Alice) shifts down from view 0 to view 1.
    act(() => result.current.actions.updateCells([{ rowId: "1", columnId: "name", value: "Aaron" }], { source: "stream", reorder: "immediate" }));

    const [next] = onDataChange.mock.calls[0] as [readonly EditRow[], DataChange<EditRow>];
    expect(next[0]).toMatchObject({ id: "1", name: "Aaron" }); // the value landed
    expect(result.current.viewIndex).toEqual([0, 1, 2]); // Aaron, Alice, Bob
    expect(result.current.viewStale).toBe(false);
    expect(result.current.editing).toEqual({
      coord: { col: 0, row: 1 },
      rowId: "2",
      columnId: "name",
      initialText: undefined,
      session: expect.any(Number),
    });
    expect(result.current.activeCell).toEqual({ col: 0, row: 1 });
  });
});


describe("useDataGridSelector / typed useDataGridRow", () => {
  it("hands the selector rows typed as TData", () => {
    const { result, unmount } = renderHook(
      () => {
        const data = useDataGridSelector<Row, readonly Row[]>((s) => s.data);
        const first = useDataGridRow<Row>(0);
        return { data, first };
      },
      { wrapper: makeWrapper() },
    );
    expect(result.current.data.map((r) => r.name)).toEqual(["Charlie", "Alice", "Bob"]);
    expect(result.current.first?.name).toBe("Charlie");
    unmount();
  });

  it("honors an equality function: a value-only update that keeps the derived value equal does not re-render", () => {
    let renders = 0;
    let storeApi: import("zustand/vanilla").StoreApi<DataGridStoreState> | null = null;
    function Probe() {
      renders++;
      storeApi = useDataGridStoreApi();
      useDataGridSelector<Row, { n: number }>(
        (s) => ({ n: s.data.length }),
        (a, b) => a.n === b.n,
      );
      return null;
    }
    const { unmount } = render(
      <DataGridProvider data={rows()} columns={columns} getRowId={(r) => r.id}>
        <Probe />
      </DataGridProvider>,
    );
    const base = renders;
    act(() => storeApi?.getState().actions.updateCells([{ rowId: "1", columnId: "age", value: 31 }], { source: "stream" }));
    expect(renders).toBe(base);
    // a length change still re-renders
    act(() => storeApi?.getState().actions.deleteRowsAt(viewIndexes([0])));
    expect(renders).toBe(base + 1);
    unmount();
  });

  it("createDataGridSelector: the factory form reads typed rows with an inferred result", () => {
    const useRowSelector = createDataGridSelector<Row>();
    const { result, unmount } = renderHook(
      () => {
        const names = useRowSelector((s) => s.data.map((r) => r.name));
        const first = useRowSelector((s) => s.data[0]?.name);
        return { names, first };
      },
      { wrapper: makeWrapper() },
    );
    expect(result.current.names).toEqual(["Charlie", "Alice", "Bob"]);
    expect(result.current.first).toBe("Charlie");
    unmount();
  });
});

describe("CellRef actions (stable identity coordinates)", () => {
  function useRefActions() {
    return { actions: useDataGridInternalActions(), selection: useDataGridSelection(), activeCell: useDataGridActiveCell(), editing: useDataGridEditing() };
  }

  it("selectCell resolves the ref against the current (sorted) view", () => {
    const { result } = renderHook(useRefActions, {
      wrapper: makeConfigWrapper({ sortState: [{ columnId: "name", direction: "asc" }] }),
    });
    // name-asc: Alice(2) view 0, Bob(3) view 1, Charlie(1) view 2
    act(() => result.current.actions.selectCell({ rowId: "1", columnId: "age" }));
    expect(result.current.selection.current?.cell).toEqual({ col: 1, row: 2 });
  });

  it("setActiveCell moves only the active cell; null clears it", () => {
    const { result } = renderHook(useRefActions, {
      wrapper: makeConfigWrapper({ sortState: [{ columnId: "name", direction: "asc" }] }),
    });
    act(() => result.current.actions.setActiveCell({ rowId: "3", columnId: "name" }));
    expect(result.current.activeCell).toEqual({ col: 0, row: 1 });
    expect(result.current.selection.current).toBeNull();
    act(() => result.current.actions.setActiveCell(null));
    expect(result.current.activeCell).toBeNull();
  });

  it("startEditing opens the session at the ref's resolved view cell", () => {
    const { result } = renderHook(useRefActions, {
      wrapper: makeConfigWrapper({ sortState: [{ columnId: "name", direction: "asc" }] }),
    });
    act(() => result.current.actions.startEditing({ rowId: "2", columnId: "age" }));
    expect(result.current.editing).toMatchObject({ coord: { col: 1, row: 0 }, rowId: "2", columnId: "age" });
    expect(result.current.activeCell).toEqual({ col: 1, row: 0 });
  });

  it("extendTo and pushRange resolve their ref against the current (sorted) view", () => {
    const { result } = renderHook(useRefActions, {
      wrapper: makeConfigWrapper({ sortState: [{ columnId: "name", direction: "asc" }] }),
    });
    // name-asc: Alice(2) view 0, Bob(3) view 1, Charlie(1) view 2
    act(() => result.current.actions.selectCell({ rowId: "2", columnId: "name" }));
    act(() => result.current.actions.extendTo({ rowId: "1", columnId: "age" }));
    // anchor (0,0) to Charlie's age cell (1,2): a 2x3 rect
    expect(result.current.selection.current?.range).toEqual({ x: 0, y: 0, width: 2, height: 3 });
    act(() => result.current.actions.pushRange({ rowId: "3", columnId: "name" }));
    expect(result.current.selection.current?.cell).toEqual({ col: 0, row: 1 });
    expect(result.current.selection.current?.range).toEqual({ x: 0, y: 1, width: 1, height: 1 });
    expect(result.current.selection.current?.rangeStack).toHaveLength(1);
  });

  it("a ref that no longer resolves is a no-op and dev-warns once per grid", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(useRefActions, {
      wrapper: makeConfigWrapper({ sortState: [{ columnId: "name", direction: "asc" }] }),
    });
    act(() => result.current.actions.selectCell({ rowId: "missing", columnId: "name" }));
    expect(result.current.selection.current).toBeNull();
    act(() => result.current.actions.selectCell({ rowId: "1", columnId: "hidden" }));
    expect(result.current.selection.current).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("a ref to a row filtered out of the view is a no-op; an in-view ref still resolves", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(useRefActions, {
      wrapper: makeConfigWrapper({
        filterState: [{ filterId: "f", columnId: "name", operator: "equals", value: "Alice" }],
      }),
    });
    // the filter keeps Alice (id "2") only; Charlie (id "1") and Bob (id "3") are filtered out.
    act(() => result.current.actions.selectCell({ rowId: "1", columnId: "name" }));
    expect(result.current.selection.current).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    // the same grid still resolves a ref to an in-view row, at its filtered position
    act(() => result.current.actions.selectCell({ rowId: "2", columnId: "age" }));
    expect(result.current.selection.current?.cell).toEqual({ col: 1, row: 0 });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("commitCellValue writes at the ref's resolved cell without moving the active cell", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(useRefActions, {
      wrapper: makeConfigWrapper({ sortState: [{ columnId: "name", direction: "asc" }], onDataChange: () => {} }),
    });
    act(() => result.current.actions.selectCellAt({ col: 0, row: 0 }));
    act(() => result.current.actions.commitCellValue({ rowId: "3", columnId: "age" }, 41));
    expect(result.current.activeCell).toEqual({ col: 0, row: 0 });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
