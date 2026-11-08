import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef } from "../types";
import { holeRowId } from "../data-grid-sdk";
import { DataGridProvider, useDataGridStoreApi, useDataGridSelectedRows, type DataGridStoreState, type DataGridSyncProps } from ".";
import { CompactSelection } from "../selection/compact-selection";
import { dispatchGridAction } from "../interaction/use-grid-interaction";
import { readSelectedRows } from "./selected-rows";

type Row = { id: string; name: string };

const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];

const page = (ids: string[]): Row[] => ids.map((id) => ({ id, name: id.toUpperCase() }));
const NO_SPEC = { sorts: [], filters: [], searchText: "" };
const PAGE_ONE = page(["a", "b", "c"]);
const PAGE_TWO = page(["d", "e", "f"]);

function mount(props: Partial<DataGridSyncProps<Row>> = {}) {
  let api: StoreApi<DataGridStoreState> | null = null;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  const tree = (next: Partial<DataGridSyncProps<Row>>) => (
    <DataGridProvider
      columns={columns}
      getRowId={(row: Row | undefined, index: number) => (row === undefined ? holeRowId(index) : row.id)}
      data={PAGE_ONE}
      checkedRowsLifetime="across-filters"
      totalRowCount={9}
      {...next}
    >
      <Probe />
    </DataGridProvider>
  );
  const view = render(tree(props));
  const state = () => api!.getState();
  return {
    state,
    store: () => api!,
    rerender: (next: Partial<DataGridSyncProps<Row>>) => view.rerender(tree(next)),
    check: (...viewRows: number[]) => act(() => viewRows.forEach((r) => state().actions.setRowSelected(r, true))),
    uncheck: (...viewRows: number[]) => act(() => viewRows.forEach((r) => state().actions.setRowSelected(r, false))),
    checkedViewRows: () => state().selection.rows.toArray(),
    remembered: () => [...state().hiddenCheckedRowIds].sort(),
    dispatch: (action: "deleteRows" | "duplicateRow" | "moveRowsDown") =>
      act(() =>
        dispatchGridAction({
          action,
          actions: state().actions,
          storeApi: api!,
          scrollRef: { current: null },
          scrollCellIntoView: () => {},
          rowHeight: 36,
          preventDefault: () => {},
        }),
      ),
  };
}

afterEach(() => vi.restoreAllMocks());

describe("remembered checks over a window of the result (totalRowCount)", () => {
  it("remembers a checked row that leaves data and checks it again when it returns", () => {
    const m = mount();
    m.check(0, 2);
    m.rerender({ data: PAGE_TWO });
    expect(m.checkedViewRows()).toEqual([]);
    expect(m.remembered()).toEqual(["a", "c"]);
    m.rerender({ data: PAGE_ONE });
    expect(m.checkedViewRows()).toEqual([0, 2]);
    expect(m.remembered()).toEqual([]);
  });

  it("keeps checks of two pages at once", () => {
    const m = mount();
    m.check(1);
    m.rerender({ data: PAGE_TWO });
    m.check(0);
    expect(m.remembered()).toEqual(["b"]);
    expect(m.checkedViewRows()).toEqual([0]);
    m.rerender({ data: PAGE_ONE });
    expect(m.remembered()).toEqual(["d"]);
  });

  it("works under sortMode and filterMode server", () => {
    const m = mount({ sortMode: "server", filterMode: "server" });
    m.check(0);
    m.rerender({ sortMode: "server", filterMode: "server", data: PAGE_TWO });
    expect(m.remembered()).toEqual(["a"]);
  });

  it("keeps checked skeleton rows by index and remembers loaded ones when the window moves", () => {
    const sparse = (loaded: Record<number, Row>) => {
      const data = new Array<Row | undefined>(6);
      for (const [i, row] of Object.entries(loaded)) data[Number(i)] = row;
      return data as Row[];
    };
    const m = mount({ data: sparse({ 0: { id: "a", name: "A" }, 1: { id: "b", name: "B" } }), totalRowCount: 6 });
    m.check(1, 4);
    m.rerender({ data: sparse({ 3: { id: "d", name: "D" } }), totalRowCount: 6 });
    expect(m.remembered()).toEqual(["b"]);
    expect(m.checkedViewRows()).toEqual([4]);
  });

  it("does not remember anything without totalRowCount (a missing row drops out)", () => {
    const m = mount({ totalRowCount: undefined });
    m.check(0);
    m.rerender({ data: PAGE_TWO, totalRowCount: undefined });
    expect(m.remembered()).toEqual([]);
    expect(m.checkedViewRows()).toEqual([]);
  });

  it("caps the remembered ids", async () => {
    const { MAX_HIDDEN_CHECKED_ROWS } = await import("./hidden-checked-rows");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const many = page(Array.from({ length: MAX_HIDDEN_CHECKED_ROWS + 5 }, (_, i) => `x${i}`));
    const m = mount({ data: many, totalRowCount: many.length });
    act(() => m.state().actions.setAllRowsSelected(true));
    m.rerender({ data: PAGE_TWO, totalRowCount: many.length });
    expect(m.state().hiddenCheckedRowIds.size).toBe(MAX_HIDDEN_CHECKED_ROWS);
    expect(warn).toHaveBeenCalled();
  });
});

describe("select all matching", () => {
  it("checks every view row and reports excluded ids when the user unchecks one", () => {
    const m = mount();
    act(() => m.state().actions.selectAllMatching());
    expect(m.state().allMatching).toBe(true);
    expect(m.checkedViewRows()).toEqual([0, 1, 2]);
    m.uncheck(1);
    expect(m.checkedViewRows()).toEqual([0, 2]);
  });

  it("rows of the next page show as checked unless excluded", () => {
    const m = mount();
    act(() => m.state().actions.selectAllMatching());
    m.uncheck(1);
    m.rerender({ data: PAGE_TWO });
    expect(m.checkedViewRows()).toEqual([0, 1, 2]);
    expect(m.remembered()).toEqual(["b"]);
    m.uncheck(0);
    m.rerender({ data: PAGE_ONE });
    expect(m.checkedViewRows()).toEqual([0, 2]);
    expect(m.remembered()).toEqual(["b", "d"]);
  });

  it("re-checking an excluded row on its page removes the exclusion", () => {
    const m = mount();
    act(() => m.state().actions.selectAllMatching());
    m.uncheck(1);
    m.rerender({ data: PAGE_TWO });
    m.rerender({ data: PAGE_ONE });
    m.check(1);
    m.rerender({ data: PAGE_TWO });
    expect(m.remembered()).toEqual([]);
  });

  it("clearSelection, header off, and setSelection(null) leave allMatching", () => {
    for (const clear of [
      (s: DataGridStoreState) => s.actions.clearSelection(),
      (s: DataGridStoreState) => s.actions.setAllRowsSelected(false),
      (s: DataGridStoreState) => s.actions.setSelection(null),
    ]) {
      const m = mount();
      act(() => m.state().actions.selectAllMatching());
      m.uncheck(0);
      m.rerender({ data: PAGE_TWO });
      act(() => clear(m.state()));
      expect(m.state().allMatching).toBe(false);
      expect(m.remembered()).toEqual([]);
      expect(m.checkedViewRows()).toEqual([]);
    }
  });

  it("is a no-op with a warning without totalRowCount or without across-filters", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const noTotal = mount({ totalRowCount: undefined });
    act(() => noTotal.state().actions.selectAllMatching());
    expect(noTotal.state().allMatching).toBe(false);
    const noKeep = mount({ checkedRowsLifetime: "until-cleared" });
    act(() => noKeep.state().actions.selectAllMatching());
    expect(noKeep.state().allMatching).toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("clears allMatching instead of dropping an exclusion past the cap", async () => {
    const { MAX_HIDDEN_CHECKED_ROWS } = await import("./hidden-checked-rows");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const many = page(Array.from({ length: MAX_HIDDEN_CHECKED_ROWS + 2 }, (_, i) => `x${i}`));
    const m = mount({ data: many, totalRowCount: many.length + 10 });
    act(() => m.state().actions.selectAllMatching());
    act(() => m.store().setState({ selection: { ...m.state().selection, rows: CompactSelection.empty() } }));
    m.rerender({ data: PAGE_TWO, totalRowCount: many.length + 10 });
    expect(m.state().allMatching).toBe(false);
  });

  it("row operations on checked rows do nothing while allMatching is on", () => {
    const m = mount({ createRow: () => ({ id: "n", name: "N" }), duplicateRow: (row: Row) => ({ ...row, id: `${row.id}2` }) });
    act(() => m.state().actions.selectAllMatching());
    m.dispatch("deleteRows");
    m.dispatch("duplicateRow");
    m.dispatch("moveRowsDown");
    expect(m.state().data).toHaveLength(3);
  });
});

describe("useDataGridSelectedRows", () => {
  function mountWithHook(props: Partial<DataGridSyncProps<Row>> = {}) {
    let api: StoreApi<DataGridStoreState> | null = null;
    let latest: ReturnType<typeof useDataGridSelectedRows> | null = null;
    function Probe() {
      api = useDataGridStoreApi();
      latest = useDataGridSelectedRows();
      return null;
    }
    const tree = (next: Partial<DataGridSyncProps<Row>>) => (
      <DataGridProvider
        columns={columns}
        getRowId={(row: Row | undefined, index: number) => (row === undefined ? holeRowId(index) : row.id)}
        data={PAGE_ONE}
        checkedRowsLifetime="across-filters"
        totalRowCount={9}
        {...next}
      >
        <Probe />
      </DataGridProvider>
    );
    const view = render(tree(props));
    return { api: () => api!, selected: () => latest!, rerender: (next: Partial<DataGridSyncProps<Row>>) => view.rerender(tree(next)) };
  }

  it("ids mode lists the checked and the remembered rows", () => {
    const m = mountWithHook();
    act(() => m.api().getState().actions.setRowSelected(0, true));
    m.rerender({ data: PAGE_TWO });
    act(() => m.api().getState().actions.setRowSelected(1, true));
    expect(m.selected()).toEqual({ mode: "ids", ids: ["e", "a"], excludedIds: [], count: 2 });
  });

  it("allMatching mode reports the exclusions and the count from totalRowCount", () => {
    const m = mountWithHook();
    act(() => m.api().getState().actions.selectAllMatching());
    act(() => m.api().getState().actions.setRowSelected(1, false));
    expect(m.selected()).toEqual({ mode: "allMatching", ids: [], excludedIds: ["b"], count: 8, spec: NO_SPEC });
    m.rerender({ data: PAGE_TWO });
    expect(m.selected()).toMatchObject({ mode: "allMatching", excludedIds: ["b"], count: 8 });
  });

  it("re-checking an excluded row on its page removes it from excludedIds without a page change", () => {
    const m = mountWithHook();
    act(() => m.api().getState().actions.selectAllMatching());
    act(() => m.api().getState().actions.setRowSelected(1, false));
    m.rerender({ data: PAGE_TWO });
    m.rerender({ data: PAGE_ONE });
    act(() => m.api().getState().actions.setRowSelected(1, true));
    expect(m.selected()).toEqual({ mode: "allMatching", ids: [], excludedIds: [], count: 9, spec: NO_SPEC });
  });

  it("count is null in allMatching mode when the size is unknown", () => {
    const m = mountWithHook({ totalRowCount: null });
    act(() => m.api().getState().actions.selectAllMatching());
    expect(m.selected()).toMatchObject({ mode: "allMatching", count: null });
  });

  it("allMatching mode carries the sort, filters, and search text the grid holds", () => {
    const sorts = [{ columnId: "name", direction: "asc" as const }];
    const filters = [{ filterId: "f1", columnId: "name", operator: "contains" as const, value: "a" }];
    const m = mountWithHook({ sortState: sorts, filterState: filters, searchText: "q", sortMode: "server", filterMode: "server" });
    act(() => m.api().getState().actions.selectAllMatching());
    expect(m.selected()).toMatchObject({ mode: "allMatching", spec: { sorts, filters, searchText: "q" } });
  });

  it("a grid with totalRowCount and no checkedRowsLifetime keeps the default until-click", () => {
    const m = mountWithHook({ checkedRowsLifetime: undefined });
    expect(m.api().getState().checkedRowsLifetime).toBe("until-click");
  });

  it("skips skeleton rows in ids", () => {
    const sparse = [{ id: "a", name: "A" }, undefined, { id: "c", name: "C" }] as Row[];
    const m = mountWithHook({ data: sparse, totalRowCount: 3 });
    act(() => m.api().getState().actions.setAllRowsSelected(true));
    expect(m.selected().ids).toEqual(["a", "c"]);
  });
});

describe("select all matching and the result spec", () => {
  it("a filter or search change leaves allMatching and unchecks the rows", () => {
    for (const change of [
      (s: DataGridStoreState) => s.actions.setFilters([{ filterId: "f", columnId: "name", operator: "equals", value: "A" }] as never),
      (s: DataGridStoreState) => s.actions.setSearch("a"),
    ]) {
      const m = mount();
      act(() => m.state().actions.selectAllMatching());
      act(() => change(m.state()));
      expect(m.state().allMatching).toBe(false);
      expect(m.checkedViewRows()).toEqual([]);
    }
  });

  it("the last onSelectionChange after a filter change is the cleared selection", () => {
    const onSelectionChange = vi.fn();
    const m = mount({ onSelectionChange });
    act(() => m.state().actions.selectAllMatching());
    act(() => m.state().actions.setFilters([{ filterId: "f", columnId: "name", operator: "equals", value: "A" }] as never));
    const last = onSelectionChange.mock.calls.at(-1)![0] as { rows?: unknown[] } | undefined;
    expect(m.state().allMatching).toBe(false);
    expect(JSON.stringify(last)).not.toContain("[0,1,2]");
  });

  it("a controlled filterState re-created with equal content keeps allMatching", () => {
    const filters = () => [{ filterId: `x${Math.random()}`, columnId: "name", operator: "equals", value: "A" }] as never;
    const m = mount({ filterState: filters(), filterMode: "server" });
    act(() => m.state().actions.selectAllMatching());
    m.rerender({ filterState: filters(), filterMode: "server" });
    expect(m.state().allMatching).toBe(true);
  });

  it("totalRowCount alone does not turn the id memory on", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = mount({ checkedRowsLifetime: undefined });
    expect(m.state().checkedRowsLifetime).toBe("until-click");
    act(() => m.state().actions.selectAllMatching());
    expect(m.state().allMatching).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("until-cleared keeps selectAllMatching off with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = mount({ checkedRowsLifetime: "until-cleared" });
    act(() => m.state().actions.selectAllMatching());
    expect(m.state().allMatching).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("a programmatic deleteRows leaves allMatching", () => {
    const m = mount({ onDataChange: () => {} });
    act(() => m.state().actions.selectAllMatching());
    act(() => m.state().actions.deleteRows([0]));
    expect(m.state().allMatching).toBe(false);
  });

  it("a non-finite or negative totalRowCount counts as unknown", () => {
    for (const bad of [Number.NaN, -3, Infinity]) expect(mount({ totalRowCount: bad }).state().totalRowCount).toBeNull();
  });
});

describe("selectAllMatching announcement", () => {
  it("announces the row count of the result, or a count-free text for an unknown size", () => {
    const known = mount();
    act(() => known.state().actions.selectAllMatching());
    expect(known.state().liveAnnouncement).toMatchObject({ kind: "rowsChecked", count: 9 });
    expect(known.state().liveAnnouncement?.partial).toBeUndefined();
    cleanup();
    const unknown = mount({ totalRowCount: null });
    act(() => unknown.state().actions.selectAllMatching());
    expect(unknown.state().liveAnnouncement).toMatchObject({ kind: "rowsChecked", partial: true });
  });

  it("a later uncheck or check reads the result size minus every exclusion, across pages", () => {
    const m = mount();
    act(() => m.state().actions.selectAllMatching());
    m.uncheck(1);
    expect(m.state().liveAnnouncement).toMatchObject({ kind: "rowsChecked", count: 8 });
    m.rerender({ data: PAGE_TWO });
    m.uncheck(0);
    expect(m.state().liveAnnouncement).toMatchObject({ kind: "rowsChecked", count: 7 });
    m.rerender({ data: PAGE_ONE });
    m.check(1);
    expect(m.state().liveAnnouncement).toMatchObject({ kind: "rowsChecked", count: 8 });
    expect(readSelectedRows(m.state()).count).toBe(8);
  });

  it("the count skips unloaded rows of a scroll-mode window, like the selection value", () => {
    const sparse = [{ id: "a", name: "A" }, undefined, { id: "c", name: "C" }, undefined] as Row[];
    const m = mount({ data: sparse, totalRowCount: 20 });
    act(() => m.state().actions.selectAllMatching());
    m.uncheck(1, 2);
    expect(m.state().liveAnnouncement).toMatchObject({ kind: "rowsChecked", count: 19 });
    expect(readSelectedRows(m.state()).count).toBe(19);
  });

  it("a later uncheck on a result of unknown size stays quiet", () => {
    const m = mount({ totalRowCount: null });
    act(() => m.state().actions.selectAllMatching());
    const announced = m.state().liveAnnouncement;
    m.uncheck(1);
    expect(m.state().liveAnnouncement).toBe(announced);
  });

  it("a plain number click that ends all-matching reads the one checked row", () => {
    const m = mount();
    act(() => m.state().actions.selectAllMatching());
    m.uncheck(0);
    m.rerender({ data: PAGE_TWO });
    act(() => m.state().actions.selectRow(1));
    expect(m.state().liveAnnouncement).toMatchObject({ kind: "rowsChecked", count: 1 });
  });
});

describe("onBeforeDeleteRows while all-matching is on", () => {
  it("passes hiddenCount 0: the set holds exclusions, and the delete ends all-matching", () => {
    const gate = vi.fn(() => true);
    const props = { onBeforeDeleteRows: gate, onDataChange: () => {} };
    const m = mount(props);
    act(() => m.state().actions.selectAllMatching());
    m.uncheck(1);
    m.rerender({ ...props, data: PAGE_TWO });
    expect(m.remembered()).toEqual(["b"]);
    act(() => m.state().actions.deleteRows([0]));
    expect(gate).toHaveBeenCalledWith({ rowIds: ["d"], hiddenCount: 0, signal: expect.any(AbortSignal) });
    expect(m.state().allMatching).toBe(false);
  });
});

describe("remembered checks and a cell click", () => {
  it("a cell click keeps the remembered ids and all-matching under across-filters", () => {
    const m = mount();
    act(() => m.state().actions.selectAllMatching());
    act(() => m.state().actions.selectCell({ rowId: m.state().getRowId(m.state().data[0]!, 0), columnId: m.state().visibleColumns[0]!.id }));
    expect(m.state().allMatching).toBe(true);
  });

  it("switching to until-click releases the remembered ids and all-matching", () => {
    const m = mount();
    m.check(1);
    m.rerender({ data: PAGE_TWO });
    expect(m.remembered()).toEqual(["b"]);
    act(() => m.state().actions.selectAllMatching());
    m.rerender({ data: PAGE_TWO, checkedRowsLifetime: "until-click" });
    expect(m.state().allMatching).toBe(false);
    expect(m.remembered()).toEqual([]);
  });
});

describe("header click (selectColumn) and remembered checks", () => {
  it("with across-filters a header click keeps the checked rows and all-matching", () => {
    const m = mount();
    act(() => m.state().actions.selectAllMatching());
    act(() => m.state().actions.selectColumn(0));
    expect(m.checkedViewRows()).toEqual([0, 1, 2]);
    expect(m.state().allMatching).toBe(true);
    expect(m.state().selection.columns.hasIndex(0)).toBe(true);
  });

  it("until-click: a header click clears the checks", () => {
    const m = mount({ checkedRowsLifetime: "until-click" });
    m.check(1);
    act(() => m.state().actions.selectColumn(0));
    expect(m.checkedViewRows()).toEqual([]);
    expect(m.state().allMatching).toBe(false);
  });

  it("an additive header click keeps the checks and all-matching", () => {
    const m = mount();
    act(() => m.state().actions.selectAllMatching());
    act(() => m.state().actions.selectColumn(0, { additive: true }));
    expect(m.checkedViewRows()).toEqual([0, 1, 2]);
    expect(m.state().allMatching).toBe(true);
  });
});

describe("row number click (selectRow) and all-matching", () => {
  it("a plain number click checks only that row and ends all-matching", () => {
    const m = mount();
    act(() => m.state().actions.selectAllMatching());
    act(() => m.state().actions.selectRow(1));
    expect(m.checkedViewRows()).toEqual([1]);
    expect(m.state().allMatching).toBe(false);
  });

  it("an additive number click keeps all-matching", () => {
    const m = mount();
    act(() => m.state().actions.selectAllMatching());
    act(() => m.state().actions.selectRow(1, { additive: true }));
    expect(m.checkedViewRows()).toEqual([0, 2]);
    expect(m.state().allMatching).toBe(true);
  });
});

describe("Ctrl/Cmd+A (selectAll) and remembered checks", () => {
  it("after selectAllMatching, selectAll ends all-matching and reads 0 rows checked", () => {
    const m = mount();
    act(() => m.state().actions.selectAllMatching());
    act(() => m.state().actions.selectAll());
    expect(m.state().allMatching).toBe(false);
    expect(m.checkedViewRows()).toEqual([]);
    expect(m.state().liveAnnouncement).toMatchObject({ kind: "rowsChecked", count: 0 });
  });

  it("drops the remembered checks of other pages, also with across-filters", () => {
    const m = mount();
    m.check(1);
    m.rerender({ data: PAGE_TWO });
    m.check(0);
    act(() => m.state().actions.selectAll());
    expect(m.checkedViewRows()).toEqual([]);
    expect(m.remembered()).toEqual([]);
    m.rerender({ data: PAGE_ONE });
    expect(m.checkedViewRows()).toEqual([]);
  });

  it("on dense data a check placed over the whole-grid range drops on the next selectAll", () => {
    const m = mount({ totalRowCount: undefined });
    act(() => m.state().actions.selectAll());
    m.check(1);
    act(() => m.state().actions.selectAll());
    expect(m.checkedViewRows()).toEqual([]);
    expect(m.state().selection.current?.range).toEqual({ x: 0, y: 0, width: 1, height: 3 });
    expect(m.state().liveAnnouncement).toMatchObject({ kind: "rowsChecked", count: 0 });
  });

  it("without any check selectAll stays quiet", () => {
    const m = mount();
    act(() => m.state().actions.selectAll());
    expect(m.state().liveAnnouncement).toBeNull();
  });
});
