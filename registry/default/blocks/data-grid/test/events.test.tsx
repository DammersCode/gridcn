import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { ColumnDef } from "../types";
import { DataGrid, DataGridProvider, useDataGridActions, useDataGridSelector, type DataGridProviderProps } from "../data-grid";

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
      result.current.actions.startEditing({ col: 0, row: 0 });
    });
    expect(onEditStart).toHaveBeenCalledWith({ col: 0, row: 0 });
    expect(result.current.editing).toBeNull();
  });

  it("proceeds when the callback returns undefined", () => {
    const onEditStart = vi.fn();
    const { result } = renderHook(useActionsAndEditing, { wrapper: makeWrapper({ onEditStart }) });
    act(() => {
      result.current.actions.startEditing({ col: 0, row: 0 });
    });
    expect(onEditStart).toHaveBeenCalledWith({ col: 0, row: 0 });
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
      result.current.actions.startEditing({ col: 0, row: 0 });
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
      result.current.actions.startEditing({ col: 0, row: 0 });
    });
    act(() => {
      result.current.actions.commitCellEdit("x");
    });
    expect(onEditEnd).toHaveBeenCalledWith({ coord: { col: 0, row: 0 }, result: "commit" });
    expect(result.current.editing).toBeNull();
  });

  it("fires rejected and keeps the session open when validate refuses", () => {
    const onEditEnd = vi.fn();
    const { result } = renderHook(useActionsAndEditing, { wrapper: makeWrapper({ onEditEnd, columns: validatingColumns }) });
    act(() => {
      result.current.actions.startEditing({ col: 1, row: 0 });
    });
    act(() => {
      result.current.actions.commitCellEdit(-1);
    });
    expect(onEditEnd).toHaveBeenCalledWith({ coord: { col: 1, row: 0 }, result: "rejected" });
    expect(result.current.editing).not.toBeNull();
  });

  it("fires commit for a no-op re-commit of the same value", () => {
    const onEditEnd = vi.fn();
    const { result } = renderHook(useActionsAndEditing, { wrapper: makeWrapper({ onEditEnd }) });
    act(() => {
      result.current.actions.startEditing({ col: 0, row: 0 });
    });
    act(() => {
      result.current.actions.commitCellEdit("Row 0");
    });
    expect(onEditEnd).toHaveBeenCalledWith({ coord: { col: 0, row: 0 }, result: "commit" });
  });

  it("fires cancel when the draft is discarded", () => {
    const onEditEnd = vi.fn();
    const { result } = renderHook(useActionsAndEditing, { wrapper: makeWrapper({ onEditEnd }) });
    act(() => {
      result.current.actions.startEditing({ col: 0, row: 0 });
    });
    act(() => {
      result.current.actions.cancelEditing();
    });
    expect(onEditEnd).toHaveBeenCalledWith({ coord: { col: 0, row: 0 }, result: "cancel" });
    expect(result.current.editing).toBeNull();
  });

  it("delivers onDataChange, then onActiveCellChange, then onEditEnd on a moving commit", () => {
    const order: string[] = [];
    const wrapper = makeWrapper({
      onDataChange: () => order.push("data"),
      onActiveCellChange: () => order.push("active"),
      onEditEnd: () => order.push("editend"),
    });
    const { result } = renderHook(useActionsAndEditing, { wrapper });
    act(() => {
      result.current.actions.startEditing({ col: 0, row: 0 });
    });
    order.length = 0; // startEditing's own cursor move is a separate gesture
    act(() => {
      result.current.actions.commitCellEdit("x", { dx: 0, dy: 1 });
    });
    expect(order).toEqual(["data", "active", "editend"]);
  });
});

describe("onActiveCellChange", () => {
  it("fires when the cell changes and not on a same-cell re-select", () => {
    const onActiveCellChange = vi.fn();
    const { result } = renderHook(() => useDataGridActions(), { wrapper: makeWrapper({ onActiveCellChange }) });
    expect(onActiveCellChange).not.toHaveBeenCalled();
    act(() => {
      result.current.selectCell({ col: 1, row: 0 });
    });
    expect(onActiveCellChange).toHaveBeenCalledTimes(1);
    expect(onActiveCellChange).toHaveBeenLastCalledWith({ col: 1, row: 0 });
    act(() => {
      result.current.selectCell({ col: 1, row: 0 });
    });
    expect(onActiveCellChange).toHaveBeenCalledTimes(1);
    act(() => {
      result.current.selectCell({ col: 0, row: 1 });
    });
    expect(onActiveCellChange).toHaveBeenCalledTimes(2);
    expect(onActiveCellChange).toHaveBeenLastCalledWith({ col: 0, row: 1 });
  });
});

describe("DOM cell events", () => {
  it("onCellDoubleClick fires with the cell context and the native event", () => {
    const onCellDoubleClick = vi.fn();
    const data = rows();
    render(<DataGrid data={data} columns={columns} getRowId={(r) => r.id} onCellDoubleClick={onCellDoubleClick} />);
    fireEvent.doubleClick(screen.getByRole("gridcell", { name: "Row 1" }));
    expect(onCellDoubleClick).toHaveBeenCalledTimes(1);
    const [ctx, event] = onCellDoubleClick.mock.calls[0]! as [{ row: unknown; rowIndex: number; columnIndex: number }, MouseEvent];
    expect(ctx.row).toBe(data[1]);
    expect(ctx.rowIndex).toBe(1);
    expect(ctx.columnIndex).toBe(0);
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
    const [ctx, event] = onCellContextMenu.mock.calls[0]! as [{ row: unknown; rowIndex: number }, MouseEvent];
    expect(ctx.rowIndex).toBe(1);
    expect(event).toBeInstanceOf(MouseEvent);
  });
});
