import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { ColumnDef } from "../types";
import { DataGrid, DataGridProvider, useDataGridActions, useDataGridSelector, type DataGridProviderProps } from "../data-grid";
import { useDataGridStoreApi } from "../data-grid-sdk";

type Row = { id: string; name: string; qty: number };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number" },
];

function rows(): Row[] {
  return [
    { id: "1", name: "Row 0", qty: 0 },
    { id: "2", name: "Row 1", qty: 1 },
    { id: "3", name: "Row 2", qty: 2 },
  ];
}

const validatingColumns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number", validate: (v) => (v === -1 ? "nope" : null) },
];

function makeWrapper(overrides: Partial<DataGridProviderProps<Row>> = {}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DataGridProvider data={rows()} columns={columns} getRowId={(r) => r.id} {...overrides}>
        {children}
      </DataGridProvider>
    );
  };
}

function useActionsAndEditing() {
  return { actions: useDataGridActions(), editing: useDataGridSelector((s) => s.editing) };
}

afterEach(cleanup);

// jsdom performs no layout; drive useRowWindow's viewport math by stubbing clientHeight.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return 360;
    },
  });
});

describe("onEditStart", () => {
  it("returns false to veto the edit: no session opens", () => {
    const onEditStart = vi.fn(() => false);
    const { result } = renderHook(useActionsAndEditing, { wrapper: makeWrapper({ onEditStart }) });
    act(() => {
      result.current.actions.startEditingAt({ col: 0, row: 0 });
    });
    expect(onEditStart).toHaveBeenCalledWith({ rowId: "1", columnId: "name", viewRowIndex: 0, viewColumnIndex: 0 });
    expect(result.current.editing).toBeNull();
  });

  it("proceeds when the callback returns undefined", () => {
    const onEditStart = vi.fn();
    const { result } = renderHook(useActionsAndEditing, { wrapper: makeWrapper({ onEditStart }) });
    act(() => {
      result.current.actions.startEditingAt({ col: 0, row: 0 });
    });
    expect(onEditStart).toHaveBeenCalledWith({ rowId: "1", columnId: "name", viewRowIndex: 0, viewColumnIndex: 0 });
    expect(result.current.editing).not.toBeNull();
  });

  it("does not fire for a readOnly column", () => {
    const onEditStart = vi.fn(() => false);
    const readOnlyColumns: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name", readOnly: true },
      { id: "qty", header: "Qty", accessorKey: "qty", type: "number" },
    ];
    const { result } = renderHook(useActionsAndEditing, { wrapper: makeWrapper({ onEditStart, columns: readOnlyColumns }) });
    act(() => {
      result.current.actions.startEditingAt({ col: 0, row: 0 });
    });
    expect(onEditStart).not.toHaveBeenCalled();
    expect(result.current.editing).toBeNull();
  });
});

describe("onEditEnd", () => {
  it("fires commit when the commit succeeds", () => {
    const onEditEnd = vi.fn();
    const { result } = renderHook(useActionsAndEditing, { wrapper: makeWrapper({ onEditEnd }) });
    act(() => {
      result.current.actions.startEditingAt({ col: 0, row: 0 });
    });
    act(() => {
      result.current.actions.commitCellEdit("x");
    });
    expect(onEditEnd).toHaveBeenCalledWith({ rowId: "1", columnId: "name", viewRowIndex: 0, viewColumnIndex: 0, result: "commit" });
    expect(result.current.editing).toBeNull();
  });

  it("fires rejected and keeps the session open when validate refuses", () => {
    const onEditEnd = vi.fn();
    const { result } = renderHook(useActionsAndEditing, { wrapper: makeWrapper({ onEditEnd, columns: validatingColumns }) });
    act(() => {
      result.current.actions.startEditingAt({ col: 1, row: 0 });
    });
    act(() => {
      result.current.actions.commitCellEdit(-1);
    });
    expect(onEditEnd).toHaveBeenCalledWith({ rowId: "1", columnId: "qty", viewRowIndex: 0, viewColumnIndex: 1, result: "rejected" });
    expect(result.current.editing).not.toBeNull();
  });

  it("fires commit for a no-op re-commit of the same value", () => {
    const onEditEnd = vi.fn();
    const { result } = renderHook(useActionsAndEditing, { wrapper: makeWrapper({ onEditEnd }) });
    act(() => {
      result.current.actions.startEditingAt({ col: 0, row: 0 });
    });
    act(() => {
      result.current.actions.commitCellEdit("Row 0");
    });
    expect(onEditEnd).toHaveBeenCalledWith({ rowId: "1", columnId: "name", viewRowIndex: 0, viewColumnIndex: 0, result: "commit" });
  });

  it("fires cancel when the draft is discarded", () => {
    const onEditEnd = vi.fn();
    const { result } = renderHook(useActionsAndEditing, { wrapper: makeWrapper({ onEditEnd }) });
    act(() => {
      result.current.actions.startEditingAt({ col: 0, row: 0 });
    });
    act(() => {
      result.current.actions.cancelEditing();
    });
    expect(onEditEnd).toHaveBeenCalledWith({ rowId: "1", columnId: "name", viewRowIndex: 0, viewColumnIndex: 0, result: "cancel" });
    expect(result.current.editing).toBeNull();
  });

  it("fires commit exactly once for a committed session", () => {
    const onEditEnd = vi.fn();
    const { result } = renderHook(useActionsAndEditing, { wrapper: makeWrapper({ onEditEnd }) });
    act(() => result.current.actions.startEditingAt({ col: 0, row: 0 }));
    act(() => result.current.actions.commitCellEdit("x"));
    expect(onEditEnd.mock.calls).toEqual([[{ rowId: "1", columnId: "name", viewRowIndex: 0, viewColumnIndex: 0, result: "commit" }]]);
  });

  it("fires cancel once when a filter removes the edited row", () => {
    const onEditEnd = vi.fn();
    const { result } = renderHook(useActionsAndEditing, { wrapper: makeWrapper({ onEditEnd }) });
    act(() => result.current.actions.startEditingAt({ col: 0, row: 0 }));
    act(() => result.current.actions.setFilters([{ filterId: "f", columnId: "name", operator: "equals", value: "Row 2" }]));
    expect(result.current.editing).toBeNull();
    expect(onEditEnd.mock.calls).toEqual([[{ rowId: "1", columnId: "name", viewRowIndex: 0, viewColumnIndex: 0, result: "cancel" }]]);
  });

  it("fires nothing when a sort only moves the edited row", () => {
    const onEditEnd = vi.fn();
    const { result } = renderHook(useActionsAndEditing, { wrapper: makeWrapper({ onEditEnd }) });
    act(() => result.current.actions.startEditingAt({ col: 0, row: 0 }));
    act(() => result.current.actions.setSorts([{ columnId: "qty", direction: "desc" }]));
    expect(result.current.editing).toMatchObject({ rowId: "1", coord: { col: 0, row: 2 } });
    expect(onEditEnd).not.toHaveBeenCalled();
  });

  it("fires cancel once when the edited column is hidden", () => {
    const onEditEnd = vi.fn();
    const { result } = renderHook(useActionsAndEditing, { wrapper: makeWrapper({ onEditEnd }) });
    act(() => result.current.actions.startEditingAt({ col: 1, row: 0 }));
    act(() => result.current.actions.setColumnHidden("qty", true));
    expect(result.current.editing).toBeNull();
    expect(onEditEnd.mock.calls).toEqual([[{ rowId: "1", columnId: "qty", viewRowIndex: 0, viewColumnIndex: 1, result: "cancel" }]]);
  });

  it("fires cancel once when a consumer data swap drops the edited row", () => {
    const onEditEnd = vi.fn();
    let data = rows();
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <DataGridProvider data={data} columns={columns} getRowId={(r) => r.id} onEditEnd={onEditEnd}>
          {children}
        </DataGridProvider>
      );
    }
    const { result, rerender } = renderHook(useActionsAndEditing, { wrapper: Wrapper });
    act(() => result.current.actions.startEditingAt({ col: 0, row: 1 }));
    data = data.filter((r) => r.id !== "2");
    rerender();
    expect(result.current.editing).toBeNull();
    expect(onEditEnd.mock.calls).toEqual([[{ rowId: "2", columnId: "name", viewRowIndex: 1, viewColumnIndex: 0, result: "cancel" }]]);
  });

  it("ends the open session with cancel before a second startEditing opens a new one", () => {
    const onEditEnd = vi.fn();
    const { result } = renderHook(useActionsAndEditing, { wrapper: makeWrapper({ onEditEnd }) });
    act(() => result.current.actions.startEditingAt({ col: 0, row: 0 }));
    act(() => result.current.actions.startEditingAt({ col: 0, row: 2 }));
    expect(result.current.editing).toMatchObject({ rowId: "3" });
    expect(onEditEnd.mock.calls).toEqual([[{ rowId: "1", columnId: "name", viewRowIndex: 0, viewColumnIndex: 0, result: "cancel" }]]);
  });

  it("keeps the open session when onEditStart vetoes a second startEditing", () => {
    const onEditEnd = vi.fn();
    const onEditStart = vi.fn((cell: { viewRowIndex: number }) => (cell.viewRowIndex === 2 ? false : undefined));
    const { result } = renderHook(useActionsAndEditing, { wrapper: makeWrapper({ onEditEnd, onEditStart }) });
    act(() => result.current.actions.startEditingAt({ col: 0, row: 0 }));
    act(() => result.current.actions.startEditingAt({ col: 0, row: 2 }));
    expect(result.current.editing).toMatchObject({ rowId: "1" });
    expect(onEditEnd).not.toHaveBeenCalled();
  });

  it("fires rejected per async rejection, then exactly one cancel when the session ends", () => {
    const onEditEnd = vi.fn();
    const { result } = renderHook(useActionsAndEditing, { wrapper: makeWrapper({ onEditEnd }) });
    act(() => result.current.actions.startEditingAt({ col: 0, row: 0 }));
    act(() => result.current.actions.setEditingError("taken"));
    expect(result.current.editing).not.toBeNull();
    act(() => result.current.actions.cancelEditing());
    act(() => result.current.actions.cancelEditing());
    expect(onEditEnd.mock.calls).toEqual([
      [{ rowId: "1", columnId: "name", viewRowIndex: 0, viewColumnIndex: 0, result: "rejected" }],
      [{ rowId: "1", columnId: "name", viewRowIndex: 0, viewColumnIndex: 0, result: "cancel" }],
    ]);
  });

  it("fires cancel once when a commit discards a draft whose anchor went stale", () => {
    const onEditEnd = vi.fn();
    const onDataChange = vi.fn();
    const { result } = renderHook(() => ({ ...useActionsAndEditing(), store: useDataGridStoreApi() }), {
      wrapper: makeWrapper({ onEditEnd, onDataChange }),
    });
    act(() => result.current.actions.startEditingAt({ col: 0, row: 0 }));
    // a view rebuild that bypassed the remap
    act(() => result.current.store.setState({ viewIndex: [2, 1, 0] }));
    act(() => result.current.actions.commitCellEdit("x"));
    expect(onDataChange).not.toHaveBeenCalled();
    expect(onEditEnd.mock.calls).toEqual([[{ rowId: "1", columnId: "name", viewRowIndex: 0, viewColumnIndex: 0, result: "cancel" }]]);
  });

  it("delivers onActiveCellChange, then onDataChange, then onEditEnd on a moving commit", () => {
    const order: string[] = [];
    const wrapper = makeWrapper({
      onDataChange: () => order.push("data"),
      onActiveCellChange: () => order.push("active"),
      onEditEnd: () => order.push("editend"),
    });
    const { result } = renderHook(useActionsAndEditing, { wrapper });
    act(() => {
      result.current.actions.startEditingAt({ col: 0, row: 0 });
    });
    order.length = 0; // startEditing's own cursor move is a separate gesture
    act(() => {
      result.current.actions.commitCellEdit("x", { dx: 0, dy: 1 });
    });
    expect(order).toEqual(["active", "data", "editend"]);
  });
});

describe("onActiveCellChange", () => {
  it("fires when the cell changes and not on a same-cell re-select", () => {
    const onActiveCellChange = vi.fn();
    const { result } = renderHook(() => useDataGridActions(), { wrapper: makeWrapper({ onActiveCellChange }) });
    expect(onActiveCellChange).not.toHaveBeenCalled();
    act(() => {
      result.current.selectCellAt({ col: 1, row: 0 });
    });
    expect(onActiveCellChange).toHaveBeenCalledTimes(1);
    expect(onActiveCellChange).toHaveBeenLastCalledWith({ rowId: "1", columnId: "qty", viewRowIndex: 0, viewColumnIndex: 1 });
    act(() => {
      result.current.selectCellAt({ col: 1, row: 0 });
    });
    expect(onActiveCellChange).toHaveBeenCalledTimes(1);
    act(() => {
      result.current.selectCellAt({ col: 0, row: 1 });
    });
    expect(onActiveCellChange).toHaveBeenCalledTimes(2);
    expect(onActiveCellChange).toHaveBeenLastCalledWith({ rowId: "2", columnId: "name", viewRowIndex: 1, viewColumnIndex: 0 });
  });

  it("follows its record when a sort moves it, and fires for the move", () => {
    const onActiveCellChange = vi.fn();
    const { result } = renderHook(() => useDataGridActions(), { wrapper: makeWrapper({ onActiveCellChange }) });
    act(() => {
      result.current.selectCellAt({ col: 0, row: 0 });
    });
    expect(onActiveCellChange).toHaveBeenCalledTimes(1);
    act(() => {
      result.current.setSorts([{ columnId: "qty", direction: "desc" }]);
    });
    expect(onActiveCellChange).toHaveBeenCalledTimes(2);
    expect(onActiveCellChange).toHaveBeenLastCalledWith({ rowId: "1", columnId: "name", viewRowIndex: 2, viewColumnIndex: 0 });
  });

  it("clamps the active cell into the view when a filter shrinks it", () => {
    const onActiveCellChange = vi.fn();
    const { result } = renderHook(() => useDataGridActions(), { wrapper: makeWrapper({ onActiveCellChange }) });
    act(() => {
      result.current.selectCellAt({ col: 0, row: 2 });
    });
    act(() => {
      result.current.setFilters([{ filterId: "f", columnId: "name", operator: "equals", value: "Row 2" }]);
    });
    expect(onActiveCellChange).toHaveBeenCalledTimes(2);
    expect(onActiveCellChange).toHaveBeenLastCalledWith({ rowId: "3", columnId: "name", viewRowIndex: 0, viewColumnIndex: 0 });
  });

  it("clears the active cell when a filter empties the view", () => {
    const onActiveCellChange = vi.fn();
    const { result } = renderHook(() => useDataGridActions(), { wrapper: makeWrapper({ onActiveCellChange }) });
    act(() => {
      result.current.selectCellAt({ col: 0, row: 0 });
    });
    act(() => {
      result.current.setFilters([{ filterId: "f", columnId: "name", operator: "equals", value: "missing" }]);
    });
    expect(onActiveCellChange).toHaveBeenCalledTimes(2);
    expect(onActiveCellChange).toHaveBeenLastCalledWith(null);
  });
});

describe("onActiveCellChange — columns, writes, and clamps", () => {
  function useActionsAndStore() {
    return { actions: useDataGridActions(), store: useDataGridStoreApi() };
  }

  it("fires when hiding a column moves another column under the cursor", () => {
    const onActiveCellChange = vi.fn();
    const { result } = renderHook(() => useDataGridActions(), { wrapper: makeWrapper({ onActiveCellChange }) });
    act(() => result.current.selectCellAt({ col: 0, row: 0 }));
    act(() => result.current.setColumnHidden("name", true));
    expect(onActiveCellChange).toHaveBeenCalledTimes(2);
    expect(onActiveCellChange).toHaveBeenLastCalledWith({ rowId: "1", columnId: "qty", viewRowIndex: 0, viewColumnIndex: 0 });
  });

  it("follows its column when a column reorder moves it, and fires for the move", () => {
    const onActiveCellChange = vi.fn();
    const { result } = renderHook(() => useDataGridActions(), {
      wrapper: makeWrapper({ onActiveCellChange, enableColumnReorder: true }),
    });
    act(() => result.current.selectCellAt({ col: 0, row: 0 }));
    act(() => result.current.setColumnOrder("qty", "name", "before"));
    expect(onActiveCellChange).toHaveBeenCalledTimes(2);
    expect(onActiveCellChange).toHaveBeenLastCalledWith({ rowId: "1", columnId: "name", viewRowIndex: 0, viewColumnIndex: 1 });
  });

  it("follows its column when pinning another column moves it, and fires for the move", () => {
    const onActiveCellChange = vi.fn();
    const { result } = renderHook(() => useDataGridActions(), {
      wrapper: makeWrapper({ onActiveCellChange, enableColumnPinning: true }),
    });
    act(() => result.current.selectCellAt({ col: 0, row: 0 }));
    act(() => result.current.setColumnPin("qty", "left"));
    expect(onActiveCellChange).toHaveBeenCalledTimes(2);
    expect(onActiveCellChange).toHaveBeenLastCalledWith({ rowId: "1", columnId: "name", viewRowIndex: 0, viewColumnIndex: 1 });
  });

  it("does not fire when a rebuild keeps its record and column in place", () => {
    const onActiveCellChange = vi.fn();
    const { result } = renderHook(() => useDataGridActions(), { wrapper: makeWrapper({ onActiveCellChange }) });
    act(() => result.current.selectCellAt({ col: 0, row: 0 }));
    act(() => result.current.setColumnHidden("qty", true));
    act(() => result.current.setSorts([{ columnId: "qty", direction: "asc" }]));
    expect(onActiveCellChange).toHaveBeenCalledTimes(1);
  });

  it("does not fire for a value-only updateCells under the cursor", () => {
    const onActiveCellChange = vi.fn();
    const { result } = renderHook(() => useDataGridActions(), { wrapper: makeWrapper({ onActiveCellChange }) });
    act(() => result.current.selectCellAt({ col: 1, row: 0 }));
    act(() => {
      result.current.updateCells([{ rowId: "1", columnId: "qty", value: 9 }], { reorder: "immediate" });
    });
    expect(onActiveCellChange).toHaveBeenCalledTimes(1);
  });

  it("calls no getRowId for a store update that leaves the cursor, view, data, and columns alone", () => {
    const getRowId = vi.fn((r: Row) => r.id);
    const onActiveCellChange = vi.fn();
    const { result } = renderHook(() => useActionsAndStore(), { wrapper: makeWrapper({ onActiveCellChange, getRowId }) });
    act(() => result.current.actions.selectCellAt({ col: 0, row: 0 }));
    getRowId.mockClear();
    act(() => result.current.actions.setColumnWidth("name", 222));
    expect(getRowId).not.toHaveBeenCalled();
    expect(onActiveCellChange).toHaveBeenCalledTimes(1);
  });

  it("calls no getRowId from the subscription when no onActiveCellChange is set", () => {
    const getRowId = vi.fn((r: Row) => r.id);
    const { result } = renderHook(() => useActionsAndStore(), { wrapper: makeWrapper({ getRowId }) });
    act(() => result.current.actions.selectCellAt({ col: 0, row: 0 }));
    getRowId.mockClear();
    act(() => result.current.actions.selectCellAt({ col: 1, row: 1 }));
    expect(getRowId).not.toHaveBeenCalled();
  });

  it("clamps the cursor and collapses the selection when a consumer data swap shrinks the view", () => {
    const onActiveCellChange = vi.fn();
    let data = rows();
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <DataGridProvider data={data} columns={columns} getRowId={(r) => r.id} onActiveCellChange={onActiveCellChange}>
          {children}
        </DataGridProvider>
      );
    }
    const { result, rerender } = renderHook(() => useActionsAndStore(), { wrapper: Wrapper });
    act(() => result.current.actions.selectCellAt({ col: 1, row: 2 }));
    data = rows().slice(0, 1);
    rerender();
    const s = result.current.store.getState();
    expect(s.activeCell).toEqual({ col: 1, row: 0 });
    expect(s.selection.current?.cell).toEqual({ col: 1, row: 0 });
    expect(s.selection.current?.range).toEqual({ x: 1, y: 0, width: 1, height: 1 });
    expect(onActiveCellChange).toHaveBeenLastCalledWith({ rowId: "1", columnId: "qty", viewRowIndex: 0, viewColumnIndex: 1 });
  });

  it("fires when a lazy row loads under the cursor", () => {
    const onActiveCellChange = vi.fn();
    const loaded = rows();
    let data: Row[] = [loaded[0]!, undefined as unknown as Row, loaded[2]!];
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <DataGridProvider data={data} columns={columns} getRowId={(r) => r.id} onActiveCellChange={onActiveCellChange}>
          {children}
        </DataGridProvider>
      );
    }
    const { result, rerender } = renderHook(() => useActionsAndStore(), { wrapper: Wrapper });
    act(() => result.current.actions.selectCellAt({ col: 0, row: 1 }));
    expect(onActiveCellChange).toHaveBeenLastCalledWith({ rowId: "__lazy-unloaded-1", columnId: "name", viewRowIndex: 1, viewColumnIndex: 0 });
    data = loaded;
    rerender();
    expect(onActiveCellChange).toHaveBeenCalledTimes(2);
    expect(onActiveCellChange).toHaveBeenLastCalledWith({ rowId: "2", columnId: "name", viewRowIndex: 1, viewColumnIndex: 0 });
  });

  it("clears the selection's current range when a filter empties the view", () => {
    const { result } = renderHook(() => useActionsAndStore(), { wrapper: makeWrapper() });
    act(() => result.current.actions.selectCellAt({ col: 0, row: 1 }));
    act(() => result.current.actions.setFilters([{ filterId: "f", columnId: "name", operator: "equals", value: "missing" }]));
    const s = result.current.store.getState();
    expect(s.activeCell).toBeNull();
    expect(s.selection.current).toBeNull();
  });

  it("clears the selection's current range when every column is hidden", () => {
    const { result } = renderHook(() => useActionsAndStore(), { wrapper: makeWrapper() });
    act(() => result.current.actions.selectCellAt({ col: 1, row: 0 }));
    act(() => result.current.actions.setColumnHidden("name", true));
    act(() => result.current.actions.setColumnHidden("qty", true));
    const s = result.current.store.getState();
    expect(s.activeCell).toBeNull();
    expect(s.selection.current).toBeNull();
  });

  it("clamps the cursor when an immediate updateCells drops its row out of a filtered view", () => {
    const onActiveCellChange = vi.fn();
    const { result } = renderHook(() => useActionsAndStore(), { wrapper: makeWrapper({ onActiveCellChange }) });
    act(() => result.current.actions.setFilters([{ filterId: "f", columnId: "qty", operator: "gt", value: "0" }]));
    act(() => result.current.actions.selectCellAt({ col: 0, row: 1 }));
    expect(onActiveCellChange).toHaveBeenLastCalledWith({ rowId: "3", columnId: "name", viewRowIndex: 1, viewColumnIndex: 0 });
    act(() => {
      result.current.actions.updateCells([{ rowId: "3", columnId: "qty", value: -5 }], { reorder: "immediate" });
    });
    const s = result.current.store.getState();
    expect(s.viewIndex).toHaveLength(1);
    expect(s.activeCell).toEqual({ col: 0, row: 0 });
    expect(s.selection.current?.cell).toEqual({ col: 0, row: 0 });
    expect(onActiveCellChange).toHaveBeenLastCalledWith({ rowId: "2", columnId: "name", viewRowIndex: 0, viewColumnIndex: 0 });
  });
});

describe("DOM cell events", () => {
  it("onCellDoubleClick fires with the cell context and the native event", () => {
    const onCellDoubleClick = vi.fn();
    const data = rows();
    render(<DataGrid data={data} columns={columns} getRowId={(r) => r.id} onCellDoubleClick={onCellDoubleClick} />);
    fireEvent.doubleClick(screen.getByRole("gridcell", { name: "Row 1" }));
    expect(onCellDoubleClick).toHaveBeenCalledTimes(1);
    const [ctx, event] = onCellDoubleClick.mock.calls[0]! as [{ row: unknown; rowId: string; columnId: string; viewRowIndex: number; viewColumnIndex: number }, MouseEvent];
    expect(ctx.row).toBe(data[1]);
    expect(ctx.rowId).toBe("2");
    expect(ctx.columnId).toBe("name");
    expect(ctx.viewRowIndex).toBe(1);
    expect(ctx.viewColumnIndex).toBe(0);
    expect(event).toBeInstanceOf(MouseEvent);
  });

  it("onCellDoubleClick fires even on a readOnly grid", () => {
    const onCellDoubleClick = vi.fn();
    render(<DataGrid data={rows()} columns={columns} getRowId={(r) => r.id} readOnly onCellDoubleClick={onCellDoubleClick} />);
    fireEvent.doubleClick(screen.getByRole("gridcell", { name: "Row 0" }));
    expect(onCellDoubleClick).toHaveBeenCalledTimes(1);
  });

  it("onCellContextMenu fires with the cell context and the native event", () => {
    const onCellContextMenu = vi.fn();
    render(<DataGrid data={rows()} columns={columns} getRowId={(r) => r.id} onCellContextMenu={onCellContextMenu} />);
    fireEvent.contextMenu(screen.getByRole("gridcell", { name: "Row 1" }));
    expect(onCellContextMenu).toHaveBeenCalledTimes(1);
    const [ctx, event] = onCellContextMenu.mock.calls[0]! as [{ row: unknown; rowId: string; viewRowIndex: number }, MouseEvent];
    expect(ctx.rowId).toBe("2");
    expect(ctx.viewRowIndex).toBe(1);
    expect(event).toBeInstanceOf(MouseEvent);
  });
});
