import { act, cleanup, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef, SelectionState } from "../types";
import { DataGrid, DataGridProvider } from "../data-grid";
import { useDataGridStoreApi, type DataGridStoreState, type DataGridSyncProps } from "../store";
import * as selectionStateModule from "../store/selection-state";

type Row = { id: string; name: string; age: number };

const data: Row[] = [
  { id: "1", name: "Charlie", age: 30 },
  { id: "2", name: "Alice", age: 25 },
  { id: "3", name: "Bob", age: 40 },
  { id: "4", name: "Dana", age: 35 },
];

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "age", header: "Age", accessorKey: "age" },
];

// Module-scoped so re-renders pass the same identity: the echo-sync early return requires it.
const getRowId = (row: Row) => row.id;

function singleCell(rowId: string, columnId: string): SelectionState {
  const ref = { rowId, columnId };
  return { anchor: ref, range: { start: ref, end: ref }, rangeStack: [], rowIds: [], columnIds: [] };
}

type Props = Partial<DataGridSyncProps<Row>>;

function mount(props: Props) {
  let api: StoreApi<DataGridStoreState> | null = null;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  const grid = (next: Props) => (
    <DataGridProvider data={data} columns={columns} getRowId={getRowId} {...next}>
      <Probe />
    </DataGridProvider>
  );
  const view = render(grid(props));
  return {
    store: () => api!,
    actions: () => api!.getState().actions,
    rerender: (next: Props) => view.rerender(grid(next)),
    derived: () => api!.getState().actions._deriveSelection(),
  };
}

// jsdom performs no layout; the full-grid SSR test drives the body's viewport math by stubbing clientHeight.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return 360;
    },
  });
});

afterEach(cleanup);

describe("defaultSelection", () => {
  it("seeds the store selection and the cursor at the anchor on the first render", () => {
    const { store, derived } = mount({ defaultSelection: singleCell("2", "age") });
    expect(store().getState().activeCell).toEqual({ row: 1, col: 1 });
    expect(derived()).toEqual(singleCell("2", "age"));
  });

  it("is seed-only: a later defaultSelection is ignored", () => {
    const { rerender, derived } = mount({ defaultSelection: singleCell("2", "age") });
    rerender({ defaultSelection: singleCell("4", "name") });
    expect(derived()).toEqual(singleCell("2", "age"));
  });

  it("selection wins when both are provided, with one dev warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { derived } = mount({ selection: singleCell("3", "age"), defaultSelection: singleCell("1", "name") });
    expect(derived()).toEqual(singleCell("3", "age"));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("`selection` wins");
    warn.mockRestore();
  });

  it("SSR and the first client paint show defaultSelection and columnLayout", () => {
    const grid = (extra: { className?: string } = {}) => (
      <DataGrid data={data} columns={columns} getRowId={getRowId} defaultSelection={singleCell("2", "age")} columnLayout={{ order: ["age", "name"] }} {...extra} />
    );

    // SSR paints no body cells (the viewport is unknown on the server): the controlled order
    // shows in the header, and the store seeds the selection at creation.
    const ssr = renderToString(grid());
    expect(ssr.indexOf("Age")).toBeLessThan(ssr.indexOf("Name"));

    render(grid({ className: "h-[400px]" }));
    // First client paint: the seeded selection marks its single cell, under the leading Age header.
    expect(document.querySelectorAll('[role="gridcell"][aria-selected="true"]')).toHaveLength(1);
    expect(document.querySelectorAll('[role="columnheader"]')[0]?.textContent).toBe("Age");
  });
});

describe("the controlled selection prop", () => {
  it("applies a new value silently: no event, the cursor moves to the anchor", () => {
    const onSelectionChange = vi.fn();
    const { store, rerender, derived } = mount({ onSelectionChange });
    const value: SelectionState = {
      anchor: { rowId: "2", columnId: "name" },
      range: { start: { rowId: "1", columnId: "name" }, end: { rowId: "2", columnId: "name" } },
      rangeStack: [],
      rowIds: [],
      columnIds: [],
    };
    rerender({ onSelectionChange, selection: value });
    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(store().getState().activeCell).toEqual({ row: 1, col: 0 });
    expect(derived()).toEqual(value);
  });

  it("an echo sync (feeding back a fired value) writes nothing to the store", () => {
    const onSelectionChange = vi.fn();
    const { store, rerender } = mount({ onSelectionChange });
    const seen: DataGridStoreState[] = [];
    const unsub = store().subscribe((state) => {
      seen.push(state);
    });
    act(() => store().getState().actions.selectCellAt({ row: 0, col: 0 }));
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    const echo = onSelectionChange.mock.calls[0]![0];
    const stateBefore = store().getState();
    const notificationsBefore = seen.length;

    rerender({ onSelectionChange, selection: echo });

    unsub();
    expect(seen.length).toBe(notificationsBefore);
    expect(store().getState()).toBe(stateBefore);
  });

  it("a structurally equal inline literal applies nothing", () => {
    const onSelectionChange = vi.fn();
    const { store, rerender } = mount({ onSelectionChange });
    act(() => store().getState().actions.selectCellAt({ row: 0, col: 0 }));
    const emitted = onSelectionChange.mock.calls[0]![0];
    onSelectionChange.mockClear();
    const literal: SelectionState = {
      ...emitted,
      range: emitted.range === null ? null : { ...emitted.range },
      rangeStack: [...emitted.rangeStack],
      rowIds: [...emitted.rowIds],
      columnIds: [...emitted.columnIds],
    };
    const selectionBefore = store().getState().selection;

    rerender({ onSelectionChange, selection: literal });

    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(store().getState().selection).toBe(selectionBefore);
  });

  it("a lagging consumer never snaps the selection back: confirm step 2 of 5, then step 5", () => {
    const onSelectionChange = vi.fn();
    const { store, rerender, derived } = mount({ onSelectionChange });
    act(() => store().getState().actions.selectCellAt({ row: 0, col: 0 }));
    act(() => store().getState().actions.extendToAt({ row: 1, col: 0 }));
    act(() => store().getState().actions.extendToAt({ row: 2, col: 0 }));
    act(() => store().getState().actions.extendToAt({ row: 3, col: 0 }));
    act(() => store().getState().actions.selectCellAt({ row: 3, col: 1 }));
    expect(onSelectionChange).toHaveBeenCalledTimes(5);
    const e2 = onSelectionChange.mock.calls[1]![0];
    const e3 = onSelectionChange.mock.calls[2]![0];
    const e5 = onSelectionChange.mock.calls[4]![0];
    onSelectionChange.mockClear();

    // The consumer confirms the lagging step 2: nothing applies, no snap-back.
    rerender({ onSelectionChange, selection: e2 });
    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(derived()).toEqual(e5);
    // Their state catches up to step 5, which is still queued: also silent.
    rerender({ onSelectionChange, selection: e5 });
    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(derived()).toEqual(e5);

    // A new gesture moves on from the confirmed state, and a value the queue dropped
    // (structurally different from the current one) applies on a later sync.
    act(() => store().getState().actions.selectCellAt({ row: 0, col: 1 }));
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    onSelectionChange.mockClear();
    rerender({ onSelectionChange, selection: e3 });
    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(derived()).toEqual(e3);
  });

  it("the subscription derives nothing while no one reads the value", () => {
    const { store, rerender } = mount({});
    const deriveRowIds = vi.spyOn(selectionStateModule, "deriveRowIds");
    const deriveColumnIds = vi.spyOn(selectionStateModule, "deriveColumnIds");

    act(() => store().getState().actions.selectCellAt({ row: 0, col: 0 }));
    act(() => store().getState().actions.extendToAt({ row: 1, col: 0 }));
    expect(deriveRowIds).not.toHaveBeenCalled();
    expect(deriveColumnIds).not.toHaveBeenCalled();

    const onSelectionChange = vi.fn();
    rerender({ onSelectionChange });
    expect(onSelectionChange).not.toHaveBeenCalled(); // the current selection does not replay
    act(() => store().getState().actions.extendToAt({ row: 2, col: 0 }));
    expect(onSelectionChange).toHaveBeenCalledTimes(1);

    deriveRowIds.mockRestore();
    deriveColumnIds.mockRestore();
  });

  it("a range with an inside anchor survives a controlled round trip with the same anchor", () => {
    const onSelectionChange = vi.fn();
    const { store, rerender, derived } = mount({ onSelectionChange });
    const value: SelectionState = {
      anchor: { rowId: "2", columnId: "age" },
      range: { start: { rowId: "1", columnId: "name" }, end: { rowId: "4", columnId: "age" } },
      rangeStack: [],
      rowIds: [],
      columnIds: [],
    };
    rerender({ onSelectionChange, selection: value });
    expect(store().getState().activeCell).toEqual({ row: 1, col: 1 });

    rerender({ onSelectionChange, selection: { ...value, range: { ...value.range! } } });

    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(derived()).toEqual(value);
  });

  it("rowIds keeps its array identity across a range drag while the row channel is unchanged", () => {
    const onSelectionChange = vi.fn();
    const { store } = mount({ onSelectionChange });
    act(() => store().getState().actions.selectCellAt({ row: 0, col: 0 }));
    act(() => store().getState().actions.setRowSelected(0, true));
    onSelectionChange.mockClear();

    act(() => store().getState().actions.extendToAt({ row: 1, col: 0 }));
    const first = onSelectionChange.mock.calls[0]![0];
    act(() => store().getState().actions.extendToAt({ row: 2, col: 0 }));
    const second = onSelectionChange.mock.calls[1]![0];

    expect(onSelectionChange).toHaveBeenCalledTimes(2);
    expect(first.rowIds).toEqual(["1"]);
    expect(second.rowIds).toBe(first.rowIds);
    expect(first.columnIds).toEqual([]);
    expect(second.columnIds).toBe(first.columnIds);
  });

  describe("the fire guard across view rebuilds", () => {
    it("a sort keeps the checked records and fires nothing; deleteRows then deletes only them", () => {
      const onSelectionChange = vi.fn();
      const { store, derived } = mount({ onSelectionChange });
      act(() => store().getState().actions.selectRow(0)); // checks id "1" (Charlie)
      expect(derived().rowIds).toEqual(["1"]);
      onSelectionChange.mockClear();

      act(() => store().getState().actions.setSorts([{ columnId: "name", direction: "asc" }]));

      expect(onSelectionChange).not.toHaveBeenCalled();
      expect(derived().rowIds).toEqual(["1"]);

      // Charlie now sits at view row 2: deleting it removes the checked record only.
      act(() => store().getState().actions.deleteRows([2]));
      expect(store().getState().data.map((row) => (row as Row).id)).toEqual(["2", "3", "4"]);
    });

    it("a filter that drops one checked row fires once, without it", () => {
      const onSelectionChange = vi.fn();
      const { store, derived } = mount({ onSelectionChange });
      act(() => store().getState().actions.selectRow(0)); // checks id "1"
      onSelectionChange.mockClear();

      act(() => store().getState().actions.setFilters([{ columnId: "name", operator: "equals", value: "Dana" }]));

      expect(onSelectionChange).toHaveBeenCalledTimes(1);
      expect(derived().rowIds).toEqual([]);
    });

    it("a sort under a partial range fires once and collapses the range onto the active cell's record", () => {
      const onSelectionChange = vi.fn();
      const { store, derived } = mount({ onSelectionChange });
      act(() => store().getState().actions.selectCellAt({ row: 0, col: 0 }));
      act(() => store().getState().actions.extendToAt({ row: 1, col: 0 })); // records {1, 2}
      onSelectionChange.mockClear();

      act(() => store().getState().actions.setSorts([{ columnId: "name", direction: "asc" }]));

      expect(onSelectionChange).toHaveBeenCalledTimes(1);
      // The rect no longer covers records {1, 2}: the range collapses onto the cursor's
      // record (Charlie, now at view row 2).
      expect(derived().range).toEqual({
        start: { rowId: "1", columnId: "name" },
        end: { rowId: "1", columnId: "name" },
      });
    });

    it("a sort under a whole-grid range keeps the range; a no-op sort fires nothing", () => {
      const onSelectionChange = vi.fn();
      const { store, derived } = mount({ onSelectionChange });
      act(() => store().getState().actions.selectCellAt({ row: 0, col: 0 }));
      act(() => store().getState().actions.extendToAt({ row: 3, col: 1 })); // the whole grid
      onSelectionChange.mockClear();

      act(() => store().getState().actions.setSorts([{ columnId: "name", direction: "asc" }]));

      // The rect still covers every record: the range survives; only its corner refs re-project.
      expect(derived().range!.start).toEqual({ rowId: "2", columnId: "name" });
      expect(derived().range!.end).toEqual({ rowId: "4", columnId: "age" });

      onSelectionChange.mockClear();
      const selectionBefore = store().getState().selection;
      act(() => store().getState().actions.setSorts([{ columnId: "name", direction: "asc" }]));
      expect(onSelectionChange).not.toHaveBeenCalled();
      expect(store().getState().selection).toBe(selectionBefore);
    });

    it("a data swap that moves nothing keeps the selection identity", () => {
      const onSelectionChange = vi.fn();
      const { store, rerender } = mount({ onSelectionChange });
      act(() => store().getState().actions.selectCellAt({ row: 0, col: 0 }));
      onSelectionChange.mockClear();

      rerender({ onSelectionChange, data: data.map((row) => ({ ...row })) });

      expect(onSelectionChange).not.toHaveBeenCalled();
    });
  });
});

describe("resolving a controlled value", () => {
  it("drops unresolvable refs, applies the resolvable subset silently, and warns once in dev", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onSelectionChange = vi.fn();
    const { store, rerender, derived } = mount({ onSelectionChange });
    act(() => store().getState().actions.setColumnHidden("age", true));

    rerender({
      onSelectionChange,
      selection: {
        anchor: { rowId: "99", columnId: "name" },
        range: { start: { rowId: "99", columnId: "name" }, end: { rowId: "2", columnId: "name" } },
        rangeStack: [],
        rowIds: ["1", "99"],
        columnIds: ["age", "name"],
      },
    });

    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(derived()).toEqual({
      anchor: null,
      range: null,
      rangeStack: [],
      rowIds: ["1"],
      columnIds: ["name"],
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("no longer resolve");
    warn.mockRestore();
  });
});

describe("actions.setSelection", () => {
  it("emits like a gesture and moves the cursor to the anchor", () => {
    const onSelectionChange = vi.fn();
    const { store, derived } = mount({ onSelectionChange });
    act(() => store().getState().actions.setSelection(singleCell("2", "age")));
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect(onSelectionChange.mock.calls[0]![0]).toEqual(singleCell("2", "age"));
    expect(store().getState().activeCell).toEqual({ row: 1, col: 1 });
    expect(derived()).toEqual(singleCell("2", "age"));
  });

  it("null clears and emits an empty value; a second null fires nothing", () => {
    const onSelectionChange = vi.fn();
    const { store } = mount({ onSelectionChange });
    act(() => store().getState().actions.setSelection(singleCell("2", "age")));
    onSelectionChange.mockClear();

    act(() => store().getState().actions.setSelection(null));
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect(onSelectionChange.mock.calls[0]![0]).toEqual(selectionStateModule.EMPTY_SELECTION_STATE);

    act(() => store().getState().actions.setSelection(null));
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
  });

  it("a value equal to the current selection writes nothing", () => {
    const onSelectionChange = vi.fn();
    const { store } = mount({ onSelectionChange });
    act(() => store().getState().actions.setSelection(singleCell("2", "age")));
    onSelectionChange.mockClear();
    const selectionBefore = store().getState().selection;

    act(() => store().getState().actions.setSelection({ ...singleCell("2", "age") }));

    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(store().getState().selection).toBe(selectionBefore);
  });
});
