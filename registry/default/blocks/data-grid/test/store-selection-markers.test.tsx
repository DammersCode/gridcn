import { act, render, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DataChange } from "../types";
import { CompactSelection } from "../selection/compact-selection";
import { DataGridProvider, useDataGridInternalActions, useDataGridActiveCell, useDataGridAllRowsSelected, useDataGridIsRowSelected, useDataGridRowMarkers, useDataGridSelection, useDataGridSelectionConfig } from "../store";
import { viewIndex } from "@/registry/default/blocks/data-grid/types";
import { type Row, columns, makeWrapper, makeConfigWrapper, type EditRow, makeEditWrapper } from "./store-setup.test-helper";

describe("deleteSelection", () => {
  it("clears the selected range to each column's clearValue, skips readOnly cells, and emits one batch DataChange", () => {
    const onDataChange = vi.fn();
    const wrapper = makeEditWrapper(onDataChange);
    const { result } = renderHook(
      () => ({ actions: useDataGridInternalActions() }),
      { wrapper },
    );

    act(() => {
      // Select the (name, age, active, locked) row for data row 0 ("Charlie").
      result.current.actions.selectCellAt({ col: 0, row: 0 });
      result.current.actions.extendToAt({ col: 3, row: 0 });
    });
    act(() => {
      result.current.actions.deleteSelection();
    });

    expect(onDataChange).toHaveBeenCalledTimes(1);
    const [next, change] = onDataChange.mock.calls[0] as [readonly EditRow[], DataChange<EditRow>];
    // name and age cleared; active was already false (no-op, excluded); locked is readOnly (untouched).
    expect(next[0]).toEqual({ id: "1", name: "", age: null, active: false });
    expect(change.source).toBe("delete");
    expect(change.ops).toHaveLength(1);
    expect(change.ops[0]).toMatchObject({
      type: "update",
      rowId: "1",
      cells: expect.arrayContaining([
        { columnId: "name", value: "", prev: "Charlie" },
        { columnId: "age", value: null, prev: 30 },
      ]),
    });
    const op = change.ops[0]!;
    expect(op.type === "update" ? op.cells : undefined).toHaveLength(2);
  });

  it("does not call onDataChange when every affected cell is already at its clearValue (pure no-op)", () => {
    const onDataChange = vi.fn();
    const noopRows: EditRow[] = [{ id: "1", name: "", age: null as unknown as number, active: false }];
    const wrapper = makeEditWrapper(onDataChange, noopRows);
    const { result } = renderHook(() => useDataGridInternalActions(), { wrapper });

    act(() => {
      result.current.selectCellAt({ col: 0, row: 0 });
      result.current.extendToAt({ col: 3, row: 0 });
    });
    act(() => {
      result.current.deleteSelection();
    });

    expect(onDataChange).not.toHaveBeenCalled();
  });

  it("is a no-op with nothing selected", () => {
    const onDataChange = vi.fn();
    const wrapper = makeEditWrapper(onDataChange);
    const { result } = renderHook(() => useDataGridInternalActions(), { wrapper });

    act(() => {
      result.current.deleteSelection();
    });

    expect(onDataChange).not.toHaveBeenCalled();
  });
});

describe("_moveActiveCell", () => {
  it("moves the active cell by delta, clamped to view bounds", () => {
    const wrapper = makeWrapper();
    const { result, rerender } = renderHook(
      () => ({ actions: useDataGridInternalActions(), activeCell: useDataGridActiveCell() }),
      { wrapper },
    );

    act(() => {
      result.current.actions.selectCellAt({ col: 0, row: 0 });
    });
    rerender();

    act(() => {
      result.current.actions._moveActiveCell({ dx: 1, dy: 5 });
    });
    rerender();

    // 3 rows (max index 2), 2 columns (max index 1): dx clamps to 1, dy clamps to 2.
    expect(result.current.activeCell).toEqual({ col: 1, row: 2 });

    act(() => {
      result.current.actions._moveActiveCell({ dx: -10, dy: -10 });
    });
    rerender();

    expect(result.current.activeCell).toEqual({ col: 0, row: 0 });
  });

  it("extends the selection instead of replacing it when opts.extend is set", () => {
    const wrapper = makeWrapper();
    const { result, rerender } = renderHook(
      () => ({ actions: useDataGridInternalActions(), selection: useDataGridSelection(), activeCell: useDataGridActiveCell() }),
      { wrapper },
    );

    act(() => {
      result.current.actions.selectCellAt({ col: 0, row: 0 });
    });
    rerender();

    // real callers (arrow-key extend) only ever pass a single-axis delta; extend grows the
    // range's far edge from the anchor rather than moving activeCell (see extendSelection).
    act(() => {
      result.current.actions._moveActiveCell({ dx: 0, dy: 1 }, { extend: true });
    });
    rerender();

    expect(result.current.selection.current?.cell).toEqual({ col: 0, row: 0 });
    expect(result.current.selection.current?.range).toEqual({ x: 0, y: 0, width: 1, height: 2 });
    expect(result.current.activeCell).toEqual({ col: 0, row: 0 }); // anchor never moves during extend

    // repeated extension in the same direction keeps growing the far edge, not resetting to height 2.
    act(() => {
      result.current.actions._moveActiveCell({ dx: 0, dy: 1 }, { extend: true });
    });
    rerender();

    expect(result.current.selection.current?.range).toEqual({ x: 0, y: 0, width: 1, height: 3 });
  });

  it("retain mode moves the active cell without collapsing the existing selection", () => {
    const wrapper = makeWrapper();
    const { result, rerender } = renderHook(
      () => ({ actions: useDataGridInternalActions(), selection: useDataGridSelection(), activeCell: useDataGridActiveCell() }),
      { wrapper },
    );

    act(() => {
      result.current.actions.selectCellAt({ col: 0, row: 0 });
      result.current.actions.extendToAt({ col: 1, row: 2 });
    });
    rerender();

    const selectionBefore = result.current.selection;
    act(() => {
      result.current.actions._moveActiveCell({ dx: 0, dy: 1 }, { retain: true });
    });
    rerender();

    expect(result.current.activeCell).toEqual({ col: 0, row: 1 });
    expect(result.current.selection).toEqual(selectionBefore);
  });

  it("retain mode from an empty selection does not create a selection", () => {
    const wrapper = makeWrapper();
    const { result, rerender } = renderHook(
      () => ({ actions: useDataGridInternalActions(), selection: useDataGridSelection(), activeCell: useDataGridActiveCell() }),
      { wrapper },
    );

    act(() => {
      result.current.actions._moveActiveCell({ dx: 0, dy: 1 }, { retain: true });
    });
    rerender();

    expect(result.current.activeCell).toEqual({ col: 0, row: 1 });
    expect(result.current.selection.current).toBeNull();
  });
});

describe("actions object referential stability with new editing/delete actions", () => {
  it("keeps the same actions identity across startEditing/commitCellEdit/deleteSelection", () => {
    const onDataChange = vi.fn();
    const wrapper = makeEditWrapper(onDataChange);
    const { result, rerender } = renderHook(() => useDataGridInternalActions(), { wrapper });
    const firstActions = result.current;

    act(() => {
      result.current.startEditingAt({ col: 0, row: 0 });
    });
    rerender();
    expect(result.current).toBe(firstActions);

    act(() => {
      result.current.commitCellEdit("X");
    });
    rerender();
    expect(result.current).toBe(firstActions);

    act(() => {
      result.current.selectCellAt({ col: 0, row: 0 });
      result.current.deleteSelection();
    });
    rerender();
    expect(result.current).toBe(firstActions);
  });
});

describe("rowMarkers config", () => {
  it("defaults to 'none'", () => {
    const { result } = renderHook(() => useDataGridRowMarkers(), { wrapper: makeWrapper() });
    expect(result.current).toBe("none");
  });

  it("reflects the rowMarkers prop", () => {
    const { result } = renderHook(() => useDataGridRowMarkers(), {
      wrapper: makeConfigWrapper({ rowMarkers: "checkbox" }),
    });
    expect(result.current).toBe("checkbox");
  });
});

describe("selection config defaults and gating", () => {
  it("defaults every enable flag to true and checkedRowsLifetime to until-click", () => {
    const { result } = renderHook(() => useDataGridSelectionConfig(), { wrapper: makeWrapper() });
    expect(result.current).toEqual({
      enableRowSelection: true,
      enableColumnSelection: true,
      enableRangeSelection: true,
      enableMultiRange: true,
      checkedRowsLifetime: "until-click",
    });
  });

  it("enableRowSelection: false makes selectRow a no-op", () => {
    const wrapper = makeConfigWrapper({ enableRowSelection: false });
    const { result } = renderHook(() => ({ actions: useDataGridInternalActions(), selection: useDataGridSelection() }), { wrapper });

    act(() => result.current.actions.selectRow(1));

    expect(result.current.selection.rows.length).toBe(0);
  });

  it("enableColumnSelection: false makes selectColumn a no-op", () => {
    const wrapper = makeConfigWrapper({ enableColumnSelection: false });
    const { result } = renderHook(() => ({ actions: useDataGridInternalActions(), selection: useDataGridSelection() }), { wrapper });

    act(() => result.current.actions.selectColumn(1));

    expect(result.current.selection.columns.length).toBe(0);
  });

  it("enableRangeSelection: false collapses extendTo to single-cell active only", () => {
    const wrapper = makeConfigWrapper({ enableRangeSelection: false });
    const { result } = renderHook(() => ({ actions: useDataGridInternalActions(), selection: useDataGridSelection() }), { wrapper });

    act(() => {
      result.current.actions.selectCellAt({ col: 0, row: 0 });
      result.current.actions.extendToAt({ col: 1, row: 2 });
    });

    expect(result.current.selection.current?.range).toEqual({ x: 1, y: 2, width: 1, height: 1 });
    expect(result.current.selection.current?.cell).toEqual({ col: 1, row: 2 });
  });

  it("enableRangeSelection: false makes extendSelection (shift+arrow) a no-op", () => {
    const wrapper = makeConfigWrapper({ enableRangeSelection: false });
    const { result } = renderHook(() => ({ actions: useDataGridInternalActions(), selection: useDataGridSelection() }), { wrapper });

    act(() => {
      result.current.actions.selectCellAt({ col: 0, row: 0 });
      result.current.actions.extendSelection("down");
    });

    expect(result.current.selection.current?.range).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it("enableMultiRange: false makes pushRange (ctrl-click) behave as a plain click", () => {
    const wrapper = makeConfigWrapper({ enableMultiRange: false });
    const { result } = renderHook(() => ({ actions: useDataGridInternalActions(), selection: useDataGridSelection() }), { wrapper });

    act(() => {
      result.current.actions.selectCellAt({ col: 0, row: 0 });
      result.current.actions.pushRangeAt({ col: 1, row: 1 });
    });

    expect(result.current.selection.current?.rangeStack).toEqual([]);
    expect(result.current.selection.current?.range).toEqual({ x: 1, y: 1, width: 1, height: 1 });
  });

  it("enableMultiRange: false demotes an additive selectRow to a plain single-row toggle", () => {
    const wrapper = makeConfigWrapper({ enableMultiRange: false });
    const { result } = renderHook(() => ({ actions: useDataGridInternalActions(), selection: useDataGridSelection() }), { wrapper });

    act(() => {
      result.current.actions.selectRow(0);
      result.current.actions.selectRow(1, { additive: true });
    });

    // additive demoted to plain: row 1 replaces row 0 rather than joining it.
    expect(result.current.selection.rows.toArray()).toEqual([1]);
  });
});

describe("marker channel wiring: setRowCheckedAt / setAllRowsChecked / useDataGridAllRowsSelected", () => {
  it("setRowCheckedAt adds/removes a single row from the rows channel without touching the range channel", () => {
    const wrapper = makeConfigWrapper({ rowMarkers: "checkbox" });
    const { result } = renderHook(() => ({ actions: useDataGridInternalActions(), selection: useDataGridSelection() }), { wrapper });

    act(() => {
      result.current.actions.selectCellAt({ col: 0, row: 2 }); // unrelated range/active-cell state
      result.current.actions.setRowCheckedAt(viewIndex(1), true);
    });

    expect(result.current.selection.rows.toArray()).toEqual([1]);
    expect(result.current.selection.current?.cell).toEqual({ col: 0, row: 2 }); // untouched

    act(() => result.current.actions.setRowCheckedAt(viewIndex(1), false));
    expect(result.current.selection.rows.toArray()).toEqual([]);
  });

  it("setRowChecked checks a row by its id and ignores an id that is not in the view", () => {
    const wrapper = makeConfigWrapper({ rowMarkers: "checkbox" });
    const { result } = renderHook(() => ({ actions: useDataGridInternalActions(), selection: useDataGridSelection() }), { wrapper });

    act(() => result.current.actions.setRowChecked("2", true));
    expect(result.current.selection.rows.toArray()).toEqual([1]);

    act(() => result.current.actions.setRowChecked("missing", true));
    expect(result.current.selection.rows.toArray()).toEqual([1]);
  });

  it("unchecking a row inside a drag range with enableMultiRange false leaves a single range around the anchor", () => {
    const data = Array.from({ length: 10 }, (_, i) => ({ id: String(i), name: "n" + i, age: i }));
    const wrapper = makeConfigWrapper({ rowMarkers: "checkbox", enableMultiRange: false }, data);
    const { result } = renderHook(() => ({ actions: useDataGridInternalActions(), selection: useDataGridSelection() }), { wrapper });

    act(() => {
      result.current.actions.selectCellAt({ col: 0, row: 1 });
      result.current.actions.extendToAt({ col: 1, row: 5 });
    });
    act(() => result.current.actions.setRowCheckedAt(viewIndex(3), false));

    expect(result.current.selection.current?.range).toEqual({ x: 0, y: 1, width: 2, height: 2 });
    expect(result.current.selection.current?.rangeStack).toEqual([]);
    expect(result.current.selection.current?.cell).toEqual({ col: 0, row: 1 });
  });

  it("setRowCheckedAt is additive: toggling a second row keeps the first", () => {
    const wrapper = makeConfigWrapper({ rowMarkers: "checkbox" });
    const { result } = renderHook(() => ({ actions: useDataGridInternalActions(), selection: useDataGridSelection() }), { wrapper });

    act(() => {
      result.current.actions.setRowCheckedAt(viewIndex(0), true);
      result.current.actions.setRowCheckedAt(viewIndex(2), true);
    });

    expect(result.current.selection.rows.toArray()).toEqual([0, 2]);
  });

  it("setRowCheckedAt is a no-op when enableRowSelection is false", () => {
    const wrapper = makeConfigWrapper({ rowMarkers: "checkbox", enableRowSelection: false });
    const { result } = renderHook(() => ({ actions: useDataGridInternalActions(), selection: useDataGridSelection() }), { wrapper });

    act(() => result.current.actions.setRowCheckedAt(viewIndex(0), true));

    expect(result.current.selection.rows.length).toBe(0);
  });

  it("setAllRowsChecked(true) selects every view row; (false) clears the channel", () => {
    const wrapper = makeConfigWrapper({ rowMarkers: "checkbox" });
    const { result } = renderHook(() => ({ actions: useDataGridInternalActions(), selection: useDataGridSelection() }), { wrapper });

    act(() => result.current.actions.setAllRowsChecked(true));
    expect(result.current.selection.rows.toArray()).toEqual([0, 1, 2]);

    act(() => result.current.actions.setAllRowsChecked(false));
    expect(result.current.selection.rows.toArray()).toEqual([]);
  });

  it("useDataGridAllRowsSelected reports checked/indeterminate/unchecked", () => {
    const wrapper = makeConfigWrapper({ rowMarkers: "checkbox" });
    const { result } = renderHook(
      () => ({ actions: useDataGridInternalActions(), state: useDataGridAllRowsSelected() }),
      { wrapper },
    );

    expect(result.current.state).toBe("unchecked");

    act(() => result.current.actions.setRowCheckedAt(viewIndex(0), true));
    expect(result.current.state).toBe("indeterminate");

    act(() => result.current.actions.setAllRowsChecked(true));
    expect(result.current.state).toBe("checked");

    act(() => result.current.actions.setAllRowsChecked(false));
    expect(result.current.state).toBe("unchecked");
  });

  it("useDataGridAllRowsSelected reads the rows channel only: a cell range over every row leaves the header unchecked", () => {
    // drag-select a cell range over all 3 rows — no marker interaction, selection.rows stays empty.
    const wrapper = makeConfigWrapper({ rowMarkers: "checkbox" });
    const { result } = renderHook(
      () => ({
        actions: useDataGridInternalActions(),
        allRowsState: useDataGridAllRowsSelected(),
        row0Selected: useDataGridIsRowSelected(0),
        row1Selected: useDataGridIsRowSelected(1),
        row2Selected: useDataGridIsRowSelected(2),
      }),
      { wrapper },
    );

    act(() => {
      result.current.actions.selectCellAt({ col: 0, row: 0 });
      result.current.actions.extendToAt({ col: 1, row: 2 });
    });

    expect(result.current.row0Selected).toBe(true);
    expect(result.current.row1Selected).toBe(true);
    expect(result.current.row2Selected).toBe(true);
    expect(result.current.allRowsState).toBe("unchecked");
  });

  it("the header turns checked once the rows channel holds every row, and indeterminate for some", () => {
    const wrapper = makeConfigWrapper({ rowMarkers: "checkbox" });
    const { result } = renderHook(() => ({ actions: useDataGridInternalActions(), allRowsState: useDataGridAllRowsSelected() }), { wrapper });
    act(() => result.current.actions.setRowCheckedAt(viewIndex(0), true));
    expect(result.current.allRowsState).toBe("indeterminate");
    act(() => result.current.actions.setAllRowsChecked(true));
    expect(result.current.allRowsState).toBe("checked");
  });

  it("reconciles selection.rows against a narrower view when data/filter changes (out-of-range marker indices don't read as checked)", () => {
    const data = [
      { id: "1", name: "Charlie", age: 30 },
      { id: "2", name: "Alice", age: 25 },
      { id: "3", name: "Bob", age: 40 },
      { id: "4", name: "Dana", age: 22 },
      { id: "5", name: "Eve", age: 50 },
    ];
    // re-render the SAME provider instance with narrowed data via a prop change, so the fix in
    // _syncProps (not a fresh store) is what's under test.
    let latest: { actions: ReturnType<typeof useDataGridInternalActions>; allRowsState: string; rows: number[] } | null = null;
    function Probe() {
      latest = {
        actions: useDataGridInternalActions(),
        allRowsState: useDataGridAllRowsSelected(),
        rows: useDataGridSelection().rows.toArray(),
      };
      return null;
    }
    function Harness({ data: harnessData }: { data: typeof data }) {
      return (
        <DataGridProvider data={harnessData} columns={columns} getRowId={(r) => r.id} rowMarkers="checkbox">
          <Probe />
        </DataGridProvider>
      );
    }

    const { rerender } = render(<Harness data={data} />);

    // select 2 of 5 view rows via checkbox marker (indices 3, 4).
    act(() => {
      latest!.actions.setRowCheckedAt(viewIndex(3), true);
      latest!.actions.setRowCheckedAt(viewIndex(4), true);
    });
    expect(latest!.allRowsState).toBe("indeterminate");

    // narrow the view to exactly those two rows' complement being filtered out — 2 rows remain,
    // but neither was ever toggled by the user, so the checkbox must not read 'checked'.
    rerender(<Harness data={data.slice(0, 2)} />);
    expect(latest!.rows).toEqual([]);
    expect(latest!.allRowsState).toBe("unchecked");
  });

  it("setRowCheckedAt(index, false) unchecks a row that an active range covered, splitting the range", () => {
    const wrapper = makeConfigWrapper({ rowMarkers: "checkbox" });
    const { result } = renderHook(
      () => ({ actions: useDataGridInternalActions(), row1Selected: useDataGridIsRowSelected(1) }),
      { wrapper },
    );

    act(() => {
      result.current.actions.selectCellAt({ col: 0, row: 0 });
      result.current.actions.extendToAt({ col: 1, row: 2 }); // range covers rows 0-2, including row 1
      result.current.actions.setRowCheckedAt(viewIndex(1), true);
    });
    expect(result.current.row1Selected).toBe(true);

    act(() => result.current.actions.setRowCheckedAt(viewIndex(1), false));
    expect(result.current.row1Selected).toBe(false);
  });

  it("useDataGridAllRowsSelected does not scan every row (O(1) per store write)", () => {
    const bigData: Row[] = Array.from({ length: 20_000 }, (_, i) => ({ id: String(i), name: `r${i}`, age: i }));
    const wrapper = makeConfigWrapper({ rowMarkers: "checkbox" }, bigData);
    const { result } = renderHook(
      () => ({ actions: useDataGridInternalActions(), state: useDataGridAllRowsSelected() }),
      { wrapper },
    );

    // hasIndex was the old implementation's per-row primitive (one call per view row, in a loop);
    // the rewrite never calls it at all, using hasAll's O(its own run count) coverage check
    // instead — asserting zero calls is a direct regression guard against the O(rowCount) loop
    // coming back, independent of timing.
    const hasIndexSpy = vi.spyOn(CompactSelection.prototype, "hasIndex");
    const hasAllSpy = vi.spyOn(CompactSelection.prototype, "hasAll");

    // empty selection: the old loop still paid rowCount hasIndex/range-membership calls even with
    // nothing selected — this is the "no fast path" case the audit called out specifically.
    expect(result.current.state).toBe("unchecked");
    expect(hasIndexSpy).not.toHaveBeenCalled();

    hasIndexSpy.mockClear();
    hasAllSpy.mockClear();
    act(() => result.current.actions.setRowCheckedAt(viewIndex(0), true));
    expect(result.current.state).toBe("indeterminate");
    expect(hasIndexSpy).not.toHaveBeenCalled();
    expect(hasAllSpy.mock.calls.length).toBeLessThan(50);

    hasIndexSpy.mockClear();
    hasAllSpy.mockClear();
    act(() => result.current.actions.setAllRowsChecked(true));
    expect(result.current.state).toBe("checked");
    expect(hasIndexSpy).not.toHaveBeenCalled();
    expect(hasAllSpy.mock.calls.length).toBeLessThan(50);

    hasIndexSpy.mockRestore();
    hasAllSpy.mockRestore();
  });
});
