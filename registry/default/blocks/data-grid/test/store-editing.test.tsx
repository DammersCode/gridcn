import { act, render, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import type { ColumnDef, DataChange } from "../types";
import { DataGridProvider, cellErrorKey, getInternalActions, useDataGridInternalActions, useDataGridCellErrors, useDataGridActiveCell, useDataGridEditing, useDataGridRow, useDataGridSelection, useDataGridStore, useDataGridStoreApi, useDataGridViewIndex, useDataGridVisibleColumns, type DataGridStoreState } from "../store";
import type { SortSpec } from "../types";
import { viewIndexes } from "@/registry/default/blocks/data-grid/types";
import { type Row, makeWrapper, makeConfigWrapper, type EditRow, editColumns, editRows, makeEditWrapper, makeUncontrolledWrapper } from "./store-setup.test-helper";

describe("defaultData (uncontrolled mode)", () => {
  it("an edit mutates the internal array with no data prop, visible via useDataGridRow", () => {
    const onDataChange = vi.fn();
    const wrapper = makeUncontrolledWrapper(onDataChange);
    const { result, rerender } = renderHook(
      () => ({ actions: useDataGridInternalActions(), row: useDataGridRow(0) }),
      { wrapper },
    );

    expect((result.current.row as EditRow).name).toBe("Charlie");

    act(() => {
      result.current.actions.startEditingAt({ col: 0, row: 0 });
    });
    act(() => {
      result.current.actions.commitCellEdit("Charlotte", { dx: 0, dy: 0 });
    });
    rerender();

    expect((result.current.row as EditRow).name).toBe("Charlotte");
  });

  it("onDataChange still notifies (same payload shape as controlled) even though the grid owns the data", () => {
    const onDataChange = vi.fn();
    const wrapper = makeUncontrolledWrapper(onDataChange);
    const { result } = renderHook(() => useDataGridInternalActions(), { wrapper });

    act(() => {
      result.current.startEditingAt({ col: 0, row: 0 });
      result.current.commitCellEdit("Charlotte", { dx: 0, dy: 0 });
    });

    expect(onDataChange).toHaveBeenCalledTimes(1);
    const [next, change] = onDataChange.mock.calls[0] as [readonly EditRow[], DataChange<EditRow>];
    expect(next[0]!.name).toBe("Charlotte");
    expect(change.source).toBe("edit");
    expect(change.ops[0]).toMatchObject({ type: "update", rowId: "1" });
  });

  it("onDataChange is optional — omitting it doesn't prevent the internal mutation", () => {
    const wrapper = makeUncontrolledWrapper(undefined);
    const { result, rerender } = renderHook(
      () => ({ actions: useDataGridInternalActions(), row: useDataGridRow(0) }),
      { wrapper },
    );

    act(() => {
      result.current.actions.startEditingAt({ col: 0, row: 0 });
      result.current.actions.commitCellEdit("Charlotte", { dx: 0, dy: 0 });
    });
    rerender();

    expect((result.current.row as EditRow).name).toBe("Charlotte");
  });

  it("deleteSelection/paste-style batch writes (applyCellUpdates) mutate the internal array too", () => {
    const wrapper = makeUncontrolledWrapper();
    const { result, rerender } = renderHook(
      () => ({ actions: useDataGridInternalActions(), row: useDataGridRow(1) }),
      { wrapper },
    );

    act(() => {
      result.current.actions.applyCellUpdates([{ viewRowIndex: 1, columnId: "name", value: "Allison" }], "paste");
    });
    rerender();

    expect((result.current.row as EditRow).name).toBe("Allison");
  });

  it("re-syncing (e.g. an unrelated parent re-render) does not reset an edit already applied — defaultData is init-only", () => {
    const seed = editRows();
    const wrapper = makeUncontrolledWrapper(undefined, seed);
    const { result, rerender } = renderHook(
      () => ({ actions: useDataGridInternalActions(), row: useDataGridRow(0) }),
      { wrapper },
    );

    act(() => {
      result.current.actions.startEditingAt({ col: 0, row: 0 });
      result.current.actions.commitCellEdit("Charlotte", { dx: 0, dy: 0 });
    });
    rerender();
    expect((result.current.row as EditRow).name).toBe("Charlotte");

    // A second sync (the provider's own useEffect re-running with the same defaultData prop
    // reference on an unrelated parent re-render) must not revert the edit — defaultData is
    // read once at store creation and never re-applied.
    rerender();
    expect((result.current.row as EditRow).name).toBe("Charlotte");
  });

  it("both data and defaultData set: data wins (controlled behavior), and dev mode warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const controlledData = editRows();
    const onDataChange = vi.fn();

    const { rerender } = render(
      <DataGridProvider data={controlledData} defaultData={editRows()} columns={editColumns} getRowId={(r) => r.id} onDataChange={onDataChange}>
        <div />
      </DataGridProvider>,
    );

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("both `data` and `defaultData` were provided"));
    const callCountAfterFirst = warn.mock.calls.filter((c) => String(c[0]).includes("both `data` and `defaultData`")).length;
    expect(callCountAfterFirst).toBe(1);

    // Re-render with the same both-props combo: the warning does not fire again (warn-once).
    rerender(
      <DataGridProvider data={controlledData} defaultData={editRows()} columns={editColumns} getRowId={(r) => r.id} onDataChange={onDataChange}>
        <div />
      </DataGridProvider>,
    );
    const callCountAfterSecond = warn.mock.calls.filter((c) => String(c[0]).includes("both `data` and `defaultData`")).length;
    expect(callCountAfterSecond).toBe(1);

    warn.mockRestore();
  });

  it("committing edits in uncontrolled mode never fires the controlled-mode 'data array identity changed' guardrail", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const wrapper = makeUncontrolledWrapper();
    const { result, rerender } = renderHook(() => useDataGridInternalActions(), { wrapper });

    act(() => {
      result.current.startEditingAt({ col: 0, row: 0 });
      result.current.commitCellEdit("Charlotte", { dx: 0, dy: 0 });
    });
    rerender();
    act(() => {
      result.current.startEditingAt({ col: 1, row: 1 });
      result.current.commitCellEdit(99, { dx: 0, dy: 0 });
    });
    rerender();

    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("data array identity changed"));
    warn.mockRestore();
  });
});

describe("commitCellEdit", () => {
  it("under an active sort, edits the correct data row and emits prev/rowId from data-space via viewIndex mapping", () => {
    const onDataChange = vi.fn();
    const wrapper = makeEditWrapper(onDataChange);
    const { result, rerender } = renderHook(
      () => ({ actions: useDataGridInternalActions(), viewIndex: useDataGridViewIndex() }),
      { wrapper },
    );

    // Sort by name ascending: Alice(1), Bob(2), Charlie(0) in view order.
    act(() => {
      result.current.actions.toggleSort("name");
    });
    rerender();
    expect(result.current.viewIndex).toEqual([1, 2, 0]);

    // View row 1 is "Bob" (data index 2); edit the "age" column (view col 1).
    act(() => {
      result.current.actions.startEditingAt({ col: 1, row: 1 });
    });
    act(() => {
      result.current.actions.commitCellEdit(99);
    });

    expect(onDataChange).toHaveBeenCalledTimes(1);
    const [next, change] = onDataChange.mock.calls[0] as [readonly EditRow[], DataChange<EditRow>];
    expect(next[2]).toEqual({ id: "3", name: "Bob", age: 99, active: false });
    expect(change.ops).toEqual([
      {
        type: "update",
        rowId: "3",
        row: { id: "3", name: "Bob", age: 99, active: false },
        prev: { id: "3", name: "Bob", age: 40, active: false },
        cells: [{ columnId: "age", value: 99, prev: 40 }],
      },
    ]);
  });

  it("preserves object identity of untouched rows in the emitted next array", () => {
    const onDataChange = vi.fn();
    const original = editRows();
    const wrapper = makeEditWrapper(onDataChange, original);
    const { result } = renderHook(() => useDataGridInternalActions(), { wrapper });

    act(() => {
      result.current.startEditingAt({ col: 0, row: 0 });
    });
    act(() => {
      result.current.commitCellEdit("Charlotte");
    });

    const [next] = onDataChange.mock.calls[0] as [readonly EditRow[], DataChange<EditRow>];
    expect(next[0]).not.toBe(original[0]);
    expect(next[1]).toBe(original[1]);
    expect(next[2]).toBe(original[2]);
  });

  it("clears editing and moves activeCell by movement, clamped to bounds", () => {
    const onDataChange = vi.fn();
    const wrapper = makeEditWrapper(onDataChange);
    const { result, rerender } = renderHook(
      () => ({ actions: useDataGridInternalActions(), activeCell: useDataGridActiveCell(), editing: useDataGridEditing() }),
      { wrapper },
    );

    act(() => {
      result.current.actions.startEditingAt({ col: 0, row: 2 });
    });
    rerender();
    expect(result.current.editing).toEqual({
      coord: { col: 0, row: 2 },
      rowId: "3",
      columnId: "name",
      initialText: undefined,
      session: expect.any(Number),
    });

    // dy: +1 from the last row clamps back to the last row (3 rows -> max index 2).
    act(() => {
      result.current.actions.commitCellEdit("Charlie", { dx: 0, dy: 1 });
    });
    rerender();

    expect(result.current.editing).toBeNull();
    expect(result.current.activeCell).toEqual({ col: 0, row: 2 });
  });

  it("rejects an invalid value via column.validate, keeping editing open and setting editingError", () => {
    const onDataChange = vi.fn();
    const wrapper = makeEditWrapper(onDataChange);
    const { result, rerender } = renderHook(
      () => ({
        actions: useDataGridInternalActions(),
        editing: useDataGridEditing(),
        editingError: useDataGridStore((s) => s.editingError),
      }),
      { wrapper },
    );

    act(() => {
      result.current.actions.startEditingAt({ col: 1, row: 0 });
    });
    act(() => {
      result.current.actions.commitCellEdit(-5);
    });
    rerender();

    expect(onDataChange).not.toHaveBeenCalled();
    expect(result.current.editing).toEqual({
      coord: { col: 1, row: 0 },
      rowId: "1",
      columnId: "age",
      initialText: undefined,
      session: expect.any(Number),
    });
    expect(result.current.editingError).toBe("must be >= 0");
  });

  it("startEditing then commitCellEdit in the same tick commits", () => {
    const onDataChange = vi.fn();
    const wrapper = makeEditWrapper(onDataChange);
    const { result } = renderHook(() => useDataGridInternalActions(), { wrapper });

    act(() => {
      result.current.startEditingAt({ col: 0, row: 1 });
      result.current.commitCellEdit("Zed", { dx: 0, dy: 0 });
    });

    expect(onDataChange).toHaveBeenCalledTimes(1);
    const [next, change] = onDataChange.mock.calls[0] as [readonly EditRow[], DataChange<EditRow>];
    expect(next[1]!.name).toBe("Zed");
    expect(change.source).toBe("edit");
  });

  it("does not call onDataChange when the committed value equals the previous value (no-op commit)", () => {
    const onDataChange = vi.fn();
    const wrapper = makeEditWrapper(onDataChange);
    const { result, rerender } = renderHook(
      () => ({ actions: useDataGridInternalActions(), activeCell: useDataGridActiveCell(), editing: useDataGridEditing() }),
      { wrapper },
    );

    act(() => {
      result.current.actions.startEditingAt({ col: 0, row: 0 });
    });
    act(() => {
      result.current.actions.commitCellEdit("Charlie", { dx: 0, dy: 1 });
    });
    rerender();

    expect(onDataChange).not.toHaveBeenCalled();
    expect(result.current.editing).toBeNull();
    expect(result.current.activeCell).toEqual({ col: 0, row: 1 });
  });

  it("startEditing is a no-op on a readOnly column", () => {
    const onDataChange = vi.fn();
    const wrapper = makeEditWrapper(onDataChange);
    const { result, rerender } = renderHook(
      () => ({ actions: useDataGridInternalActions(), editing: useDataGridEditing() }),
      { wrapper },
    );

    act(() => {
      result.current.actions.startEditingAt({ col: 3, row: 0 });
    });
    rerender();

    expect(result.current.editing).toBeNull();
  });
});

describe("editing anchored to its row across view rebuilds", () => {
  it("a re-sort while editing remaps the edit to the row's new view position and the commit lands on the original row", () => {
    const onDataChange = vi.fn();
    const wrapper = makeEditWrapper(onDataChange);
    const { result, rerender } = renderHook(
      () => ({ actions: useDataGridInternalActions(), editing: useDataGridEditing() }),
      { wrapper },
    );

    // Unsorted: view row 0 is Charlie (id "1"); edit his age (view col 1).
    act(() => {
      result.current.actions.startEditingAt({ col: 1, row: 0 });
    });
    rerender();
    expect(result.current.editing).toEqual({
      coord: { col: 1, row: 0 },
      rowId: "1",
      columnId: "age",
      initialText: undefined,
      session: expect.any(Number),
    });

    // Sorting by name asc moves Charlie from view row 0 to view row 2.
    act(() => {
      result.current.actions.toggleSort("name");
    });
    rerender();
    expect(result.current.editing).toEqual({
      coord: { col: 1, row: 2 },
      rowId: "1",
      columnId: "age",
      initialText: undefined,
      session: expect.any(Number),
    });

    act(() => {
      result.current.actions.commitCellEdit(99);
    });

    expect(onDataChange).toHaveBeenCalledTimes(1);
    const [next, change] = onDataChange.mock.calls[0] as [readonly EditRow[], DataChange<EditRow>];
    // Charlie (data 0) receives the write, not the row that now occupies view row 0 (Alice, data 1).
    expect(next[0]).toEqual({ id: "1", name: "Charlie", age: 99, active: false });
    expect(next[1]!.age).toBe(25);
    expect(next[2]!.age).toBe(40);
    expect(change.ops[0]).toMatchObject({
      rowId: "1",
      cells: [{ columnId: "age", value: 99, prev: 30 }],
    });
  });

  it("useDataGridEditing exposes the row and column identity the edit is anchored to", () => {
    const wrapper = makeEditWrapper(vi.fn());
    const { result } = renderHook(() => ({ actions: useDataGridInternalActions(), editing: useDataGridEditing() }), { wrapper });

    act(() => {
      result.current.actions.startEditingAt({ col: 1, row: 0 });
    });

    const anchor: { rowId: string; columnId: string } | undefined = result.current.editing ?? undefined;
    expect(anchor).toEqual({ coord: { col: 1, row: 0 }, rowId: "1", columnId: "age", initialText: undefined, session: expect.any(Number) });
  });

  it("keeps the draft (initialText) and a stable editing reference when the rebuild moves nothing", () => {
    const wrapper = makeEditWrapper(vi.fn());
    const { result, rerender } = renderHook(
      () => ({ actions: useDataGridInternalActions(), editing: useDataGridEditing() }),
      { wrapper },
    );

    // Bob (id "3") sits at view row 2 (age 40, the maximum).
    act(() => {
      result.current.actions.startEditingAt({ col: 1, row: 2 }, "typed");
    });
    rerender();
    const before = result.current.editing;

    // age asc: Alice(1), Charlie(0), Bob(2) — Bob stays at view row 2.
    act(() => {
      result.current.actions.toggleSort("age");
    });
    rerender();
    expect(result.current.editing).toBe(before);
    expect(result.current.editing).toEqual({
      coord: { col: 1, row: 2 },
      rowId: "3",
      columnId: "age",
      initialText: "typed",
      session: expect.any(Number),
    });
  });

  it("activeCell follows the edit's row when it was the edit cell, and is left alone otherwise", () => {
    const wrapper = makeWrapper();
    const { result, rerender } = renderHook(
      () => ({
        actions: useDataGridInternalActions(),
        editing: useDataGridEditing(),
        activeCell: useDataGridActiveCell(),
      }),
      { wrapper },
    );

    act(() => {
      result.current.actions.startEditingAt({ col: 0, row: 0 });
    });
    rerender();
    expect(result.current.activeCell).toEqual({ col: 0, row: 0 });

    act(() => {
      result.current.actions.toggleSort("name");
    });
    rerender();
    // Charlie moved 0 -> 2, so the cursor follows the row.
    expect(result.current.activeCell).toEqual({ col: 0, row: 2 });

    // Click-away: activeCell sits on another cell, so a second sort must not touch it.
    act(() => {
      result.current.actions.selectCellAt({ col: 1, row: 1 });
    });
    rerender();
    expect(result.current.activeCell).toEqual({ col: 1, row: 1 });
    act(() => {
      result.current.actions.toggleSort("name");
    });
    rerender();
    expect(result.current.activeCell).toEqual({ col: 1, row: 1 });
  });

  it("the selection anchor follows the edit's row, so a range never paints on another record", () => {
    const wrapper = makeWrapper();
    const { result, rerender } = renderHook(
      () => ({ actions: useDataGridInternalActions(), selection: useDataGridSelection(), activeCell: useDataGridActiveCell() }),
      { wrapper },
    );

    act(() => {
      result.current.actions.selectCellAt({ col: 0, row: 0 });
      result.current.actions.startEditingAt({ col: 0, row: 0 });
    });
    rerender();
    act(() => {
      result.current.actions.toggleSort("name");
    });
    rerender();

    expect(result.current.activeCell).toEqual({ col: 0, row: 2 });
    expect(result.current.selection.current?.cell).toEqual({ col: 0, row: 2 });
    expect(result.current.selection.current?.range).toEqual({ x: 0, y: 2, width: 1, height: 1 });
  });

  it("the selection is cleared with the active cell when the edited row leaves the view", () => {
    const wrapper = makeWrapper();
    const { result, rerender } = renderHook(
      () => ({ actions: useDataGridInternalActions(), selection: useDataGridSelection() }),
      { wrapper },
    );

    act(() => {
      result.current.actions.selectCellAt({ col: 0, row: 0 });
      result.current.actions.startEditingAt({ col: 0, row: 0 });
    });
    rerender();
    act(() => {
      result.current.actions.setFilters([{ columnId: "name", operator: "equals", value: "Alice" }]);
    });
    rerender();

    expect(result.current.selection.current).toBeNull();
  });

  it("filtering out the edited row cancels the edit and drops the draft", () => {
    const wrapper = makeWrapper();
    const { result, rerender } = renderHook(
      () => ({ actions: useDataGridInternalActions(), editing: useDataGridEditing(), activeCell: useDataGridActiveCell() }),
      { wrapper },
    );

    act(() => {
      result.current.actions.startEditingAt({ col: 0, row: 0 }, "typed");
    });
    rerender();
    expect(result.current.editing).not.toBeNull();

    // Keep only Alice: the edited row (Charlie) leaves the view.
    act(() => {
      result.current.actions.setFilters([{ columnId: "name", operator: "equals", value: "Alice" }]);
    });
    rerender();
    expect(result.current.editing).toBeNull();
    expect(result.current.activeCell).toBeNull();
  });

  it("a late commit after the cancel (a validation that resolved during the filter) is a no-op", () => {
    const onDataChange = vi.fn();
    const wrapper = makeEditWrapper(onDataChange);
    const { result, rerender } = renderHook(
      () => ({ actions: useDataGridInternalActions(), editing: useDataGridEditing() }),
      { wrapper },
    );

    act(() => {
      result.current.actions.startEditingAt({ col: 1, row: 0 });
    });
    act(() => {
      result.current.actions.setFilters([{ columnId: "name", operator: "equals", value: "Alice" }]);
    });
    rerender();
    expect(result.current.editing).toBeNull();

    // The async layer resolves now and commits the value it validated.
    act(() => {
      result.current.actions.commitCellEdit(99);
    });
    rerender();

    expect(onDataChange).not.toHaveBeenCalled();
  });

  it("hiding the edited column cancels the edit", () => {
    const wrapper = makeEditWrapper(vi.fn());
    const { result, rerender } = renderHook(
      () => ({ actions: useDataGridInternalActions(), editing: useDataGridEditing() }),
      { wrapper },
    );

    act(() => {
      result.current.actions.startEditingAt({ col: 1, row: 0 });
    });
    rerender();
    expect(result.current.editing).not.toBeNull();

    act(() => {
      result.current.actions.setColumnHidden("age", true);
    });
    rerender();
    expect(result.current.editing).toBeNull();
  });

  it("reordering columns remaps the edit's column and the commit lands on the right column", () => {
    const onDataChange = vi.fn();
    const wrapper = makeEditWrapper(onDataChange);
    const { result, rerender } = renderHook(
      () => ({ actions: useDataGridInternalActions(), editing: useDataGridEditing(), visibleColumns: useDataGridVisibleColumns() }),
      { wrapper },
    );

    act(() => {
      result.current.actions.startEditingAt({ col: 1, row: 0 });
    });
    rerender();

    // Move age in front of name: the edit's view column becomes 0.
    act(() => {
      result.current.actions.setColumnOrder("age", "name", "before");
    });
    rerender();
    expect(result.current.visibleColumns.map((c) => c.id)).toEqual(["age", "name", "active", "locked"]);
    expect(result.current.editing).toEqual({
      coord: { col: 0, row: 0 },
      rowId: "1",
      columnId: "age",
      initialText: undefined,
      session: expect.any(Number),
    });

    act(() => {
      result.current.actions.commitCellEdit(99);
    });

    const [next, change] = onDataChange.mock.calls[0] as [readonly EditRow[], DataChange<EditRow>];
    expect(next[0]).toEqual({ id: "1", name: "Charlie", age: 99, active: false });
    expect(next[0]!.name).toBe("Charlie");
    expect(change.ops[0]).toMatchObject({ rowId: "1", cells: [{ columnId: "age", value: 99, prev: 30 }] });
  });

});

describe("consumer data swap while editing (exactly one sync)", () => {
  const getEditRowId = (r: EditRow) => r.id;

  function renderControlled(initial: EditRow[]) {
    const onDataChange = vi.fn();
    let storeApi: import("zustand/vanilla").StoreApi<DataGridStoreState> | null = null;
    function Probe() {
      storeApi = useDataGridStoreApi();
      return null;
    }
    const ui = (data: EditRow[]) => (
      <DataGridProvider data={data} columns={editColumns} getRowId={getEditRowId} onDataChange={onDataChange}>
        <Probe />
      </DataGridProvider>
    );
    const view = render(ui(initial));
    const state = () => storeApi!.getState();
    const syncProps = vi.spyOn(getInternalActions(storeApi!), "_syncProps");
    return {
      onDataChange,
      state,
      actions: state().actions,
      swapData(next: EditRow[]) {
        view.rerender(ui(next));
        // A second sync re-remaps against the swapped data and masks a wrong first remap.
        expect(syncProps).toHaveBeenCalledTimes(1);
      },
    };
  }

  it("a consumer data replacement that drops the edited row cancels the edit", () => {
    const grid = renderControlled(editRows());
    act(() => grid.actions.startEditingAt({ col: 1, row: 0 }, "typed"));

    grid.swapData(editRows().slice(1));

    expect(grid.state().editing).toBeNull();
    expect(grid.state().activeCell).toBeNull();
  });

  it("reversing the rows moves the selection anchor with the edit", () => {
    const grid = renderControlled(editRows());
    act(() => {
      grid.actions.selectCellAt({ col: 1, row: 0 });
      grid.actions.startEditingAt({ col: 1, row: 0 });
    });

    grid.swapData(editRows().reverse());

    expect(grid.state().activeCell).toEqual({ col: 1, row: 2 });
    expect(grid.state().selection.current?.cell).toEqual({ col: 1, row: 2 });
    expect(grid.state().selection.current?.range).toEqual({ x: 1, y: 2, width: 1, height: 1 });
  });

  it("a controlled sortState change moves the selection anchor with the edit", () => {
    let storeApi: import("zustand/vanilla").StoreApi<DataGridStoreState> | null = null;
    function Probe() {
      storeApi = useDataGridStoreApi();
      return null;
    }
    const data = editRows();
    const ui = (sortState: SortSpec[]) => (
      <DataGridProvider data={data} columns={editColumns} getRowId={getEditRowId} sortState={sortState}>
        <Probe />
      </DataGridProvider>
    );
    const view = render(ui([]));
    act(() => {
      storeApi!.getState().actions.selectCellAt({ col: 0, row: 0 });
      storeApi!.getState().actions.startEditingAt({ col: 0, row: 0 });
    });

    view.rerender(ui([{ columnId: "name", direction: "asc" }]));

    // Charlie moves from view row 0 to 2
    expect(storeApi!.getState().activeCell).toEqual({ col: 0, row: 2 });
    expect(storeApi!.getState().selection.current?.cell).toEqual({ col: 0, row: 2 });
  });

  it("a multi-cell range collapses to the edited cell when its row moves", () => {
    const grid = renderControlled(editRows());
    act(() => {
      grid.actions.selectCellAt({ col: 1, row: 0 });
      grid.actions.extendSelection("down");
      grid.actions.startEditingAt({ col: 1, row: 0 });
    });
    expect(grid.state().selection.current?.range.height).toBe(2);

    grid.swapData(editRows().reverse());

    expect(grid.state().selection.current?.range).toEqual({ x: 1, y: 2, width: 1, height: 1 });
  });

  it("reversing the rows moves the editor with its row and the commit lands on that row", () => {
    const grid = renderControlled(editRows());
    act(() => grid.actions.startEditingAt({ col: 1, row: 0 }));

    grid.swapData(editRows().reverse());

    expect(grid.state().editing).toEqual({ coord: { col: 1, row: 2 }, rowId: "1", columnId: "age", initialText: undefined, session: expect.any(Number) });
    expect(grid.state().activeCell).toEqual({ col: 1, row: 2 });
    act(() => grid.actions.commitCellEdit(99, { dx: 0, dy: 1 }));
    const [next, change] = grid.onDataChange.mock.calls[0] as [readonly EditRow[], DataChange<EditRow>];
    expect(next.map((r) => r.age)).toEqual([40, 25, 99]);
    expect(change.ops[0]).toMatchObject({ rowId: "1", cells: [{ columnId: "age", value: 99, prev: 30 }] });
  });

  it("inserting a row above the edited row remaps the editor down", () => {
    const grid = renderControlled(editRows());
    act(() => grid.actions.startEditingAt({ col: 1, row: 0 }));

    grid.swapData([{ id: "0", name: "Zed", age: 1, active: false }, ...editRows()]);

    expect(grid.state().editing?.coord).toEqual({ col: 1, row: 1 });
    act(() => grid.actions.commitCellEdit(99));
    const [next] = grid.onDataChange.mock.calls[0] as [readonly EditRow[]];
    expect(next.map((r) => r.age)).toEqual([1, 99, 25, 40]);
  });

  it("a replace, Escape, a value write, and updateCells by rowId write the right rows", () => {
    const grid = renderControlled(editRows());
    act(() => grid.actions.startEditingAt({ col: 1, row: 0 }));

    grid.swapData(editRows().reverse());
    act(() => grid.actions.cancelEditing());
    // View row 0 is now Bob (id "3"); the value write rebases the rowId map onto its new array.
    act(() => grid.actions.commitCellValueAt({ col: 1, row: 0 }, 50));
    act(() => {
      grid.actions.updateCells([{ rowId: "1", columnId: "age", value: 77 }], { source: "stream" });
    });

    const byId = Object.fromEntries((grid.state().data as EditRow[]).map((r) => [r.id, r.age]));
    expect(byId).toEqual({ "1": 77, "2": 25, "3": 50 });
  });
});

describe("Standard Schema validate", () => {
  /** Minimal mock StandardSchemaV1 — no library import anywhere in repo code (per spec). */
  function mockSchema<TValue>(validate: (value: unknown) => { value: TValue } | { issues: { message: string }[] }) {
    return { "~standard": { version: 1 as const, vendor: "mock", validate } };
  }

  type SchemaRow = { id: string; age: number };
  function schemaColumns(schema: ReturnType<typeof mockSchema<number>>): readonly ColumnDef<SchemaRow, unknown>[] {
    return [{ id: "age", header: "Age", accessorKey: "age", type: "number", validate: schema as never }];
  }
  function schemaWrapper(onDataChange: (next: readonly SchemaRow[], change: DataChange<SchemaRow>) => void, schema: ReturnType<typeof mockSchema<number>>) {
    const data: SchemaRow[] = [{ id: "1", age: 30 }];
    return function Wrapper({ children }: { children: ReactNode }) {
      return (
        <DataGridProvider data={data} columns={schemaColumns(schema)} getRowId={(r) => r.id} onDataChange={onDataChange}>
          {children}
        </DataGridProvider>
      );
    };
  }

  it("a passing sync schema commits result.value (transform honored)", () => {
    const onDataChange = vi.fn();
    const schema = mockSchema<number>((v) => ({ value: Math.round(v as number) }));
    const wrapper = schemaWrapper(onDataChange, schema);
    const { result } = renderHook(() => useDataGridInternalActions(), { wrapper });

    act(() => {
      result.current.startEditingAt({ col: 0, row: 0 });
      result.current.commitCellEdit(41.6, { dx: 0, dy: 0 });
    });

    expect(onDataChange).toHaveBeenCalledTimes(1);
    const [next] = onDataChange.mock.calls[0] as [readonly SchemaRow[], DataChange<SchemaRow>];
    expect(next[0]!.age).toBe(42); // rounded by the schema, not the raw 41.6
  });

  it("a failing sync schema rejects, keeping editing open and setting editingError from the first issue", () => {
    const onDataChange = vi.fn();
    const schema = mockSchema<number>(() => ({ issues: [{ message: "must be a whole number" }] }));
    const wrapper = schemaWrapper(onDataChange, schema);
    const { result, rerender } = renderHook(
      () => ({ actions: useDataGridInternalActions(), editing: useDataGridEditing(), editingError: useDataGridStore((s) => s.editingError) }),
      { wrapper },
    );

    act(() => {
      result.current.actions.startEditingAt({ col: 0, row: 0 });
    });
    act(() => {
      result.current.actions.commitCellEdit(41.6);
    });
    rerender();

    expect(onDataChange).not.toHaveBeenCalled();
    expect(result.current.editing).not.toBeNull();
    expect(result.current.editingError).toBe("must be a whole number");
  });

  it("_setEditingError sets editingError without touching editing/data, and no-ops when not editing", () => {
    const onDataChange = vi.fn();
    const wrapper = makeEditWrapper(onDataChange);
    const { result, rerender } = renderHook(
      () => ({ actions: useDataGridInternalActions(), editing: useDataGridEditing(), editingError: useDataGridStore((s) => s.editingError) }),
      { wrapper },
    );

    act(() => {
      result.current.actions._setEditingError("should be a no-op, nothing is being edited");
    });
    rerender();
    expect(result.current.editingError).toBeNull();

    act(() => {
      result.current.actions.startEditingAt({ col: 1, row: 0 });
    });
    act(() => {
      result.current.actions._setEditingError("async rejection message");
    });
    rerender();

    expect(onDataChange).not.toHaveBeenCalled();
    expect(result.current.editing).toEqual({
      coord: { col: 1, row: 0 },
      rowId: "1",
      columnId: "age",
      initialText: undefined,
      session: expect.any(Number),
    });
    expect(result.current.editingError).toBe("async rejection message");
  });
});

describe("validateRow verdict ownership across row deletion", () => {
  it("a reused rowId keeps a consumer setCellErrors entry after the deleted row's verdict is pruned", () => {
    const wrapper = makeConfigWrapper({
      validateRow: (row: Row) => (row.name === "Charlie" ? { name: "Charlie is banned" } : null),
      createRow: () => ({ id: "1", name: "Reused", age: 50 }),
    });
    const { result } = renderHook(() => ({ actions: useDataGridInternalActions(), errors: useDataGridCellErrors() }), { wrapper });

    act(() => {
      result.current.actions.updateCells([{ rowId: "1", columnId: "age", value: 31 }], { source: "stream" });
    });
    expect(result.current.errors.get(cellErrorKey("1", "name"))).toBe("Charlie is banned");

    act(() => {
      result.current.actions.deleteRowsAt(viewIndexes([0]));
      result.current.actions.insertRow(0, "above");
    });
    act(() => {
      result.current.actions.setCellErrors([{ rowId: "1", columnId: "name", message: "consumer error" }]);
    });
    act(() => {
      result.current.actions.updateCells([{ rowId: "1", columnId: "age", value: 51 }], { source: "stream" });
    });

    expect(result.current.errors.get(cellErrorKey("1", "name"))).toBe("consumer error");
  });
});
