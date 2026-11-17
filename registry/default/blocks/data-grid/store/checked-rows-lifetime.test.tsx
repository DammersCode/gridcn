import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef, DataChange } from "../types";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState, type DataGridSyncProps } from ".";
import { getInternalActions } from "./internal-actions";
import { dispatchGridAction } from "../interaction/use-grid-interaction";
import { viewIndex } from "@/registry/default/blocks/data-grid/types";

type Row = { id: string; name: string };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "other", header: "Other", accessorKey: "name" },
];

const rows = (): Row[] => ["a", "b", "c", "d", "e"].map((id) => ({ id, name: id.toUpperCase() }));

function mount(props: Partial<DataGridSyncProps<Row>>) {
  let api: StoreApi<DataGridStoreState> | null = null;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  render(
    <DataGridProvider columns={columns} getRowId={(row: Row) => row.id} defaultData={rows()} {...props}>
      <Probe />
    </DataGridProvider>,
  );
  const state = () => api!.getState();
  return {
    state,
    store: () => api!,
    check: (...viewRows: number[]) => act(() => viewRows.forEach((r) => state().actions.setRowCheckedAt(viewIndex(r), true))),
  };
}

function dispatch(store: StoreApi<DataGridStoreState>, action: "deleteRows" | "duplicateRow" | "cancel"): void {
  act(() =>
    dispatchGridAction({
      action,
      actions: store.getState().actions,
      storeApi: store,
      scrollRef: { current: null },
      scrollCellIntoView: () => {},
      rowHeight: 36,
      preventDefault: () => {},
    }),
  );
}

describe("clearCellSelection", () => {
  it("clears the range and the columns channel and keeps the checked rows", () => {
    const { state, check } = mount({});
    act(() => state().actions.selectCellAt({ col: 0, row: 4 }));
    check(0, 1, 2);
    act(() => state().actions.clearCellSelection());
    expect(state().selection.current).toBeNull();
    expect(state().selection.columns.length).toBe(0);
    expect(state().selection.rows.toArray()).toEqual([0, 1, 2]);
  });
});

describe("checkedRowsLifetime", () => {
  it("until-click: a cell click replaces the checked rows", () => {
    const { state, check } = mount({});
    check(0, 1);
    act(() => state().actions.selectCellAt({ col: 0, row: 3 }));
    expect(state().selection.rows.length).toBe(0);
  });

  it("until-cleared: selecting a cell, extending, and pushing a range keep the checked rows", () => {
    const { state, check } = mount({ checkedRowsLifetime: "until-cleared" });
    check(0, 1);
    act(() => state().actions.selectCellAt({ col: 0, row: 3 }));
    expect(state().selection.rows.toArray()).toEqual([0, 1]);
    expect(state().selection.current?.cell).toEqual({ col: 0, row: 3 });
    act(() => state().actions.extendToAt({ col: 1, row: 4 }));
    act(() => state().actions.pushRangeAt({ col: 0, row: 2 }));
    expect(state().selection.rows.toArray()).toEqual([0, 1]);
  });

  it("until-cleared: arrow navigation keeps the checked rows", () => {
    const { state, store, check } = mount({ checkedRowsLifetime: "until-cleared" });
    check(0, 1);
    act(() => state().actions.selectCellAt({ col: 0, row: 3 }));
    act(() => getInternalActions(store())._moveActiveCell({ dx: 0, dy: 1 }));
    expect(state().selection.rows.toArray()).toEqual([0, 1]);
  });

  it("until-cleared: deleteRows removes only the checked rows, not the range", () => {
    const onDataChange = vi.fn<(next: readonly Row[], change: DataChange<Row>) => void>();
    const { state, store, check } = mount({ checkedRowsLifetime: "until-cleared", onDataChange });
    check(0, 1);
    act(() => state().actions.selectCellAt({ col: 0, row: 3 }));
    dispatch(store(), "deleteRows");
    const [, change] = onDataChange.mock.calls[0]!;
    expect(change.ops.map((op) => op.rowId).sort()).toEqual(["a", "b"]);
  });

  it("until-cleared: duplicateRow duplicates only the checked rows", () => {
    const onDataChange = vi.fn<(next: readonly Row[], change: DataChange<Row>) => void>();
    const { state, store, check } = mount({ checkedRowsLifetime: "until-cleared", onDataChange, duplicateRow: (row) => ({ ...row, id: `${row.id}2` }) });
    check(0);
    act(() => state().actions.selectCellAt({ col: 0, row: 3 }));
    dispatch(store(), "duplicateRow");
    const [next] = onDataChange.mock.calls[0]!;
    expect(next.map((r) => r.id)).toEqual(["a", "a2", "b", "c", "d", "e"]);
  });

  it("until-cleared: with no checked row, deleteRows acts on the range", () => {
    const onDataChange = vi.fn<(next: readonly Row[], change: DataChange<Row>) => void>();
    const { state, store } = mount({ checkedRowsLifetime: "until-cleared", onDataChange });
    act(() => state().actions.selectCellAt({ col: 0, row: 3 }));
    dispatch(store(), "deleteRows");
    const [, change] = onDataChange.mock.calls[0]!;
    expect(change.ops.map((op) => op.rowId)).toEqual(["d"]);
  });

  it("until-click: deleteRows acts on the union of range and checked rows", () => {
    const onDataChange = vi.fn<(next: readonly Row[], change: DataChange<Row>) => void>();
    const { state, store, check } = mount({ onDataChange });
    act(() => state().actions.selectCellAt({ col: 0, row: 3 }));
    check(0);
    dispatch(store(), "deleteRows");
    const [, change] = onDataChange.mock.calls[0]!;
    expect(change.ops.map((op) => op.rowId).sort()).toEqual(["a", "d"]);
  });

  it("until-cleared: Escape clears the checked rows", () => {
    const { state, store, check } = mount({ checkedRowsLifetime: "until-cleared" });
    check(0, 1);
    dispatch(store(), "cancel");
    expect(state().selection.rows.length).toBe(0);
  });

  it("until-cleared: unchecking and clearSelection still change the checks", () => {
    const { state, check } = mount({ checkedRowsLifetime: "until-cleared" });
    check(0, 1);
    act(() => state().actions.setRowCheckedAt(viewIndex(0), false));
    expect(state().selection.rows.toArray()).toEqual([1]);
    act(() => state().actions.clearSelection());
    expect(state().selection.rows.length).toBe(0);
  });
});

describe.each(["until-cleared", "across-filters"] as const)("checkedRowsLifetime %s keeps the checks", (checkedRowsLifetime) => {
  it("across a cell click, Shift click, Ctrl click and an arrow key", () => {
    const { state, store, check } = mount({ checkedRowsLifetime });
    check(0, 1);
    act(() => state().actions.selectCellAt({ col: 0, row: 3 }));
    act(() => state().actions.extendToAt({ col: 1, row: 4 }));
    act(() => state().actions.pushRangeAt({ col: 0, row: 2 }));
    act(() => getInternalActions(store())._moveActiveCell({ dx: 0, dy: 1 }));
    expect(state().selection.rows.toArray()).toEqual([0, 1]);
  });

  it("across a column header click", () => {
    const { state, check } = mount({ checkedRowsLifetime });
    check(0, 1);
    act(() => state().actions.selectColumn(0));
    expect(state().selection.rows.toArray()).toEqual([0, 1]);
  });

  it("until a marker checkbox, the header checkbox, Escape or clearSelection changes them", () => {
    const { state, store, check } = mount({ checkedRowsLifetime });
    check(0, 1);
    act(() => state().actions.setRowCheckedAt(viewIndex(0), false));
    expect(state().selection.rows.toArray()).toEqual([1]);
    act(() => state().actions.setAllRowsChecked(true));
    expect(state().selection.rows.length).toBe(5);
    act(() => state().actions.setAllRowsChecked(false));
    expect(state().selection.rows.length).toBe(0);
    check(2);
    dispatch(store(), "cancel");
    expect(state().selection.rows.length).toBe(0);
    check(3);
    act(() => state().actions.clearSelection());
    expect(state().selection.rows.length).toBe(0);
  });

  it("until the checked rows are deleted", () => {
    const { state, store, check } = mount({ checkedRowsLifetime, onDataChange: () => {} });
    check(0, 1);
    dispatch(store(), "deleteRows");
    expect(state().selection.rows.length).toBe(0);
  });
});

describe("checkedRowsLifetime until-click", () => {
  it.each([
    ["a cell click", (m: ReturnType<typeof mount>) => m.state().actions.selectCellAt({ col: 0, row: 3 })],
    ["a Shift click", (m: ReturnType<typeof mount>) => m.state().actions.extendToAt({ col: 1, row: 4 })],
    ["a Ctrl click", (m: ReturnType<typeof mount>) => m.state().actions.pushRangeAt({ col: 0, row: 2 })],
    ["an arrow key", (m: ReturnType<typeof mount>) => getInternalActions(m.store())._moveActiveCell({ dx: 0, dy: 1 })],
    ["a column header click", (m: ReturnType<typeof mount>) => m.state().actions.selectColumn(0)],
  ])("clears the checks on %s", (_name, gesture) => {
    const m = mount({ checkedRowsLifetime: "until-click" });
    m.check(0, 1);
    act(() => gesture(m));
    expect(m.state().selection.rows.length).toBe(0);
  });

  it("defaults to across-filters with totalRowCount, and an explicit value wins", () => {
    expect(mount({ totalRowCount: 10 }).state().checkedRowsLifetime).toBe("across-filters");
    expect(mount({ totalRowCount: 10, checkedRowsLifetime: "until-click" }).state().checkedRowsLifetime).toBe("until-click");
  });

  it("is the default", () => {
    expect(mount({}).state().checkedRowsLifetime).toBe("until-click");
  });
});

describe("the effective checkedRowsLifetime", () => {
  it("defaults to until-cleared when the markers show a checkbox", () => {
    for (const rowMarkers of ["checkbox", "both", "reorder-checkbox"] as const) {
      expect(mount({ rowMarkers }).state().checkedRowsLifetime).toBe("until-cleared");
    }
  });

  it("defaults to until-click when no marker shows a checkbox", () => {
    for (const rowMarkers of ["none", "number", "reorder"] as const) {
      expect(mount({ rowMarkers }).state().checkedRowsLifetime).toBe("until-click");
    }
  });

  it("lets an explicit value win over the marker default", () => {
    expect(mount({ rowMarkers: "checkbox", checkedRowsLifetime: "until-click" }).state().checkedRowsLifetime).toBe("until-click");
  });

  it("reports until-cleared for across-filters on a server-sorted grid without totalRowCount", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(mount({ checkedRowsLifetime: "across-filters", sortMode: "server" }).state().checkedRowsLifetime).toBe("until-cleared");
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("falls back"))).toHaveLength(1);
    warn.mockRestore();
  });

  it("keeps across-filters with totalRowCount", () => {
    expect(mount({ checkedRowsLifetime: "across-filters", sortMode: "server", totalRowCount: 5 }).state().checkedRowsLifetime).toBe("across-filters");
  });
});

describe("the headerClickBehavior default", () => {
  it("sorts with totalRowCount and selects without", () => {
    expect(mount({ totalRowCount: 5 }).state().headerClickBehavior).toBe("sort");
    expect(mount({}).state().headerClickBehavior).toBe("select");
    expect(mount({ totalRowCount: 5, headerClickBehavior: "select" }).state().headerClickBehavior).toBe("select");
  });
});
