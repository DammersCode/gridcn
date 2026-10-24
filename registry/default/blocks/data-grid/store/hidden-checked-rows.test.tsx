import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef, DataChange, SelectionState } from "../types";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState, type DataGridSyncProps } from ".";
import { MAX_HIDDEN_CHECKED_ROWS } from "./hidden-checked-rows";
import { CompactSelection } from "../selection/compact-selection";
import { dispatchGridAction } from "../interaction/use-grid-interaction";

type Row = { id: string; name: string };

const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];

const rows = (ids = ["a", "b", "c", "d", "e"]): Row[] => ids.map((id) => ({ id, name: id.toUpperCase() }));

const onlyD = [{ filterId: "f", columnId: "name", operator: "equals", value: "D" }] as const;

function mount(props: Partial<DataGridSyncProps<Row>> = {}) {
  let api: StoreApi<DataGridStoreState> | null = null;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  const tree = (next: Partial<DataGridSyncProps<Row>>) => (
    <DataGridProvider columns={columns} getRowId={(row: Row) => row.id} defaultData={rows()} keepCheckedRows keepHiddenCheckedRows {...next}>
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
    filterToD: () => act(() => state().actions.setFilters([...onlyD] as never)),
    clearFilter: () => act(() => state().actions.setFilters([])),
    hiddenIds: () => [...state().hiddenCheckedRowIds].sort(),
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
    dataIds: () => state().data.map((r) => (r as Row).id),
  };
}

afterEach(() => vi.restoreAllMocks());

describe("keepHiddenCheckedRows", () => {
  it("moves checked rows a filter hides into the hidden set and back when the filter clears", () => {
    const m = mount();
    m.check(0, 1, 2);
    m.filterToD();
    expect(m.state().selection.rows.length).toBe(0);
    expect(m.hiddenIds()).toEqual(["a", "b", "c"]);
    m.clearFilter();
    expect(m.state().selection.rows.toArray()).toEqual([0, 1, 2]);
    expect(m.hiddenIds()).toEqual([]);
  });

  it("keeps a visible check visible and hides only the rows that leave", () => {
    const m = mount();
    m.check(0, 3);
    m.filterToD();
    expect(m.state().selection.rows.toArray()).toEqual([0]);
    expect(m.hiddenIds()).toEqual(["a"]);
  });

  it("off by default: a filter drops the checks", () => {
    const m = mount({ keepHiddenCheckedRows: false });
    m.check(0, 1);
    m.filterToD();
    m.clearFilter();
    expect(m.state().selection.rows.length).toBe(0);
    expect(m.hiddenIds()).toEqual([]);
  });

  it("needs keepCheckedRows", () => {
    const m = mount({ keepCheckedRows: false });
    m.check(0, 1);
    m.filterToD();
    expect(m.hiddenIds()).toEqual([]);
  });

  it("a sort keeps both the visible checks and the hidden set", () => {
    const m = mount();
    m.check(0, 1, 3);
    m.filterToD();
    act(() => m.state().actions.setSorts([{ columnId: "name", direction: "desc" }]));
    expect(m.state().selection.rows.toArray()).toEqual([0]);
    expect(m.hiddenIds()).toEqual(["a", "b"]);
    m.clearFilter();
    expect(m.state().selection.rows.toArray()).toEqual([1, 3, 4]);
  });

  it("deleting a visible checked row leaves the hidden ids alone", () => {
    const m = mount();
    m.check(0, 1);
    m.filterToD();
    m.check(0);
    act(() => m.state().actions.deleteRows([0]));
    expect(m.dataIds()).toEqual(["a", "b", "c", "e"]);
    expect(m.hiddenIds()).toEqual(["a", "b"]);
  });

  it("deleting a hidden row by id removes its id from the set", () => {
    const m = mount();
    m.check(0, 1);
    m.filterToD();
    act(() => m.state().actions.deleteRowsById(["a"]));
    expect(m.hiddenIds()).toEqual(["b"]);
  });

  it("a data swap drops ids that no longer exist", () => {
    const m = mount({ data: rows(), defaultData: undefined });
    m.check(0, 1, 2);
    m.filterToD();
    expect(m.hiddenIds()).toEqual(["a", "b", "c"]);
    m.rerender({ data: rows(["b", "c", "d", "e"]), defaultData: undefined });
    expect(m.hiddenIds()).toEqual(["b", "c"]);
  });

  it("caps the hidden set and warns once with the cap", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ids = Array.from({ length: MAX_HIDDEN_CHECKED_ROWS + 5 }, (_, i) => `r${i}`);
    const m = mount({ defaultData: rows(ids) });
    act(() => m.state().actions.setAllRowsSelected(true));
    act(() => m.state().actions.setFilters([{ filterId: "f", columnId: "name", operator: "equals", value: "none" }] as never));
    expect(m.state().hiddenCheckedRowIds.size).toBe(MAX_HIDDEN_CHECKED_ROWS);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain(String(MAX_HIDDEN_CHECKED_ROWS));
  });

  it("clearSelection clears the hidden set", () => {
    const m = mount();
    m.check(0, 1);
    m.filterToD();
    act(() => m.state().actions.clearSelection());
    expect(m.hiddenIds()).toEqual([]);
    m.clearFilter();
    expect(m.state().selection.rows.length).toBe(0);
  });

  it("setSelection(null) and uncheck-all clear the hidden set", () => {
    const m = mount();
    m.check(0, 1);
    m.filterToD();
    act(() => m.state().actions.setSelection(null));
    expect(m.hiddenIds()).toEqual([]);
    m.clearFilter();
    m.check(0);
    m.filterToD();
    expect(m.hiddenIds()).toEqual(["a"]);
    act(() => m.state().actions.setAllRowsSelected(false));
    expect(m.hiddenIds()).toEqual([]);
  });

  it("unchecking a visible row and clearing a cell range keep the hidden set", () => {
    const m = mount();
    m.check(0, 3);
    m.filterToD();
    act(() => m.state().actions.setRowSelected(0, false));
    act(() => m.state().actions.clearCellSelection());
    expect(m.hiddenIds()).toEqual(["a"]);
  });

  it("select all stays view-only and adds no hidden rows", () => {
    const m = mount();
    m.check(0);
    m.filterToD();
    act(() => m.state().actions.setAllRowsSelected(true));
    expect(m.state().selection.rows.toArray()).toEqual([0]);
    expect(m.hiddenIds()).toEqual(["a"]);
  });

  it("turning the option off drops the hidden set", () => {
    const m = mount();
    m.check(0);
    m.filterToD();
    m.rerender({ keepHiddenCheckedRows: false });
    expect(m.hiddenIds()).toEqual([]);
  });

  it("the controlled selection carries visible rows only", () => {
    const onSelectionChange = vi.fn<(next: SelectionState) => void>();
    const m = mount({ onSelectionChange });
    m.check(0, 3);
    m.filterToD();
    expect(onSelectionChange.mock.calls.at(-1)![0].rowIds).toEqual(["d"]);
  });

  it("server sorting ignores the option and warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = mount({ sortMode: "server" });
    m.check(0, 1);
    m.filterToD();
    m.clearFilter();
    m.filterToD();
    expect(m.hiddenIds()).toEqual([]);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("keepHiddenCheckedRows"))).toHaveLength(1);
  });

  it("lazy data with unloaded rows ignores the option and warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const lazy = [...rows(["a", "b"]), undefined, undefined, ...rows(["e"])] as unknown as Row[];
    const m = mount({ defaultData: lazy });
    m.check(0, 1);
    m.filterToD();
    m.clearFilter();
    m.filterToD();
    expect(m.hiddenIds()).toEqual([]);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("keepHiddenCheckedRows"))).toHaveLength(1);
  });

  it("a delete of the visible checks never reaches a hidden row", () => {
    const onDataChange = vi.fn<(next: readonly Row[], change: DataChange<Row>) => void>();
    const m = mount({ onDataChange });
    m.check(0, 1, 3);
    m.filterToD();
    act(() => m.state().actions.deleteRows(m.state().selection.rows.toArray()));
    const [, change] = onDataChange.mock.calls[0]!;
    expect(change.ops.map((op) => op.rowId)).toEqual(["d"]);
  });
});

const commitUpdate = (m: ReturnType<typeof mount>, rowId: string, name: string) =>
  act(() => {
    const prev = m.state().data.find((r) => (r as Row).id === rowId) as Row;
    m.state().actions.commitChange({ source: "history", ops: [{ type: "update", rowId, row: { ...prev, name }, prev, cells: [{ columnId: "name", value: name, prev: prev.name }] }] });
  });

describe("hidden checked rows: row actions with only hidden checks", () => {
  it("Delete rows and Duplicate row do nothing and keep the active row", () => {
    const onDataChange = vi.fn();
    const m = mount({ onDataChange, duplicateRow: (row: Row) => ({ ...row, id: `${row.id}2` }) });
    m.check(0, 1);
    m.filterToD();
    act(() => m.state().actions.selectCellAt({ col: 0, row: 0 }));
    m.dispatch("deleteRows");
    m.dispatch("duplicateRow");
    m.dispatch("moveRowsDown");
    expect(onDataChange).not.toHaveBeenCalled();
    expect(m.dataIds()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("Delete rows still acts on the active row when no row is checked anywhere", () => {
    const onDataChange = vi.fn();
    const m = mount({ onDataChange });
    act(() => m.state().actions.selectCellAt({ col: 0, row: 0 }));
    m.dispatch("deleteRows");
    expect(onDataChange).toHaveBeenCalledTimes(1);
  });
});

describe("hidden checked rows: undo and redo style commits under a filter", () => {
  it("a row that starts to match shows up checked and leaves the hidden set", () => {
    const m = mount();
    m.check(0, 3);
    m.filterToD();
    commitUpdate(m, "a", "D");
    expect(m.hiddenIds()).toEqual([]);
    expect(m.state().viewIndex).toHaveLength(2);
    expect(m.state().selection.rows.toArray()).toEqual([0, 1]);
  });

  it("a checked row that stops matching moves to the hidden set", () => {
    const m = mount();
    m.check(3);
    m.filterToD();
    commitUpdate(m, "d", "Z");
    expect(m.state().selection.rows.length).toBe(0);
    expect(m.hiddenIds()).toEqual(["d"]);
    commitUpdate(m, "d", "D");
    expect(m.state().selection.rows.toArray()).toEqual([0]);
    expect(m.hiddenIds()).toEqual([]);
  });

  it("an insert op under a filter keeps the hidden ids", () => {
    const m = mount();
    m.check(0);
    m.filterToD();
    act(() => m.state().actions.commitChange({ source: "history", ops: [{ type: "insert", rowId: "x", row: { id: "x", name: "D" }, index: 5 }] }));
    expect(m.hiddenIds()).toEqual(["a"]);
    expect(m.state().viewIndex).toHaveLength(2);
  });

  it("a delete op drops the hidden id of the removed row", () => {
    const m = mount();
    m.check(0, 1);
    m.filterToD();
    act(() => m.state().actions.commitChange({ source: "history", ops: [{ type: "delete", rowId: "a", row: { id: "a", name: "A" }, index: 0 }] }));
    expect(m.hiddenIds()).toEqual(["b"]);
  });

  it("an update-only commit under a sort keeps the checks on their records", () => {
    const m = mount({ keepHiddenCheckedRows: false });
    act(() => m.state().actions.setSorts([{ columnId: "name", direction: "desc" }]));
    m.check(0);
    expect(m.state().selection.rows.toArray()).toEqual([0]);
    commitUpdate(m, "e", "A0");
    const viewIds = m.state().viewIndex.map((i) => (m.state().data[i] as Row).id);
    const checkedIds = m.state().selection.rows.toArray().map((v) => viewIds[v]);
    expect(checkedIds).toEqual(["e"]);
  });
});

describe("hidden checked rows: sortMode and cap", () => {
  it("switching to server sorting clears the hidden set and warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = mount();
    m.check(0, 1);
    m.filterToD();
    expect(m.hiddenIds()).toEqual(["a", "b"]);
    m.rerender({ sortMode: "server" });
    expect(m.hiddenIds()).toEqual([]);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("keepHiddenCheckedRows"))).toHaveLength(1);
  });

  it("over the cap, new hidden ids are dropped and earlier ones stay", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ids = Array.from({ length: MAX_HIDDEN_CHECKED_ROWS + 5 }, (_, i) => `r${i}`);
    const m = mount({ defaultData: rows(ids) });
    act(() => m.store().setState({ selection: { ...m.state().selection, rows: CompactSelection.fromSingleSelection([0, MAX_HIDDEN_CHECKED_ROWS - 1]) } }));
    const isAnyOf = (values: string[]) => [{ filterId: "f", columnId: "name", operator: "isAnyOf", value: values }] as never;
    act(() => m.state().actions.setFilters(isAnyOf(["R100002", "R100003", "R100004"])));
    expect(m.state().hiddenCheckedRowIds.size).toBe(MAX_HIDDEN_CHECKED_ROWS - 1);
    act(() => m.state().actions.setAllRowsSelected(true));
    act(() => m.state().actions.setFilters(isAnyOf(["none"])));
    const hidden = m.state().hiddenCheckedRowIds;
    expect(hidden.size).toBe(MAX_HIDDEN_CHECKED_ROWS);
    expect(hidden.has("r0") && hidden.has("r99998")).toBe(true);
    expect(hidden.has("r100004")).toBe(false);
  });
});
