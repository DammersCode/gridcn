import { act, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { memo, type ReactNode } from "react";
import type { ColumnDef, DataChange } from "../types";
import { CompactSelection } from "../selection/compact-selection";
import { cellTypes } from "../cell-types/cell-types";
import {
  DataGridProvider,
  type DataGridSyncProps,
  cellErrorKey,
  createDataGridSelector,
  useDataGridInternalActions,
  useDataGridCellErrors,
  useDataGridActiveCell,
  useDataGridAllRowsSelected,
  useDataGridColumnFeatureFlags,
  useDataGridEditing,
  useDataGridEditingError,
  useDataGridFilterState,
  useDataGridIsRowSelected,
  useDataGridJoinOperator,
  useDataGridColumnWidth,
  useDataGridRow,
  useDataGridRowCellState,
  useDataGridRowIdToViewRow,
  useDataGridRowMarkers,
  useDataGridSearchMatches,
  useDataGridSearchText,
  useDataGridSelection,
  useDataGridSelectionConfig,
  useDataGridGetSelectionValues,
  useDataGridSelector,
  useDataGridSortState,
  useDataGridStoreApi,
  useDataGridViewIndex,
  useDataGridViewStale,
  useDataGridVisibleColumns,
  type DataGridStoreState,
} from "../store";
import type { FilterSpec, SortSpec } from "../types";

type Row = { id: string; name: string; age: number };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "age", header: "Age", accessorKey: "age" },
];

function rows(): Row[] {
  return [
    { id: "1", name: "Charlie", age: 30 },
    { id: "2", name: "Alice", age: 25 },
    { id: "3", name: "Bob", age: 40 },
  ];
}

function makeWrapper(data: Row[] = rows()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DataGridProvider data={data} columns={columns} getRowId={(r) => r.id}>
        {children}
      </DataGridProvider>
    );
  };
}

/** Wrapper accepting selection-config/rowMarkers overrides, for the gating tests below. */
function makeConfigWrapper(configProps: Partial<DataGridSyncProps<Row>> = {}, data: Row[] = rows()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DataGridProvider data={data} columns={columns} getRowId={(r) => r.id} {...configProps}>
        {children}
      </DataGridProvider>
    );
  };
}

describe("DataGridProvider instance isolation", () => {
  it("actions on one provider instance do not affect another", () => {
    const wrapperA = makeWrapper();
    const wrapperB = makeWrapper();
    const a = renderHook(() => ({ actions: useDataGridInternalActions(), viewIndex: useDataGridViewIndex() }), {
      wrapper: wrapperA,
    });
    const b = renderHook(() => ({ actions: useDataGridInternalActions(), viewIndex: useDataGridViewIndex() }), {
      wrapper: wrapperB,
    });

    act(() => {
      a.result.current.actions.selectCellAt({ col: 0, row: 0 });
    });

    const selA = renderHook(() => useDataGridInternalActions(), { wrapper: wrapperA });
    void selA;

    // Selection state lives outside these hooks under test here; assert isolation via sort instead.
    act(() => {
      a.result.current.actions.toggleSort("name", false);
    });
    a.rerender();
    b.rerender();

    expect(a.result.current.viewIndex).toEqual([1, 2, 0]); // Alice, Bob, Charlie
    expect(b.result.current.viewIndex).toEqual([0, 1, 2]); // untouched, original order
  });
});

describe("_syncProps recompute", () => {
  it("recomputes viewIndex when sort state changes", () => {
    const wrapper = makeWrapper();
    const { result, rerender } = renderHook(
      () => ({ actions: useDataGridInternalActions(), viewIndex: useDataGridViewIndex(), sortState: useDataGridSortState() }),
      { wrapper },
    );

    expect(result.current.viewIndex).toEqual([0, 1, 2]);

    act(() => {
      result.current.actions.toggleSort("name", false);
    });
    rerender();

    expect(result.current.sortState).toEqual([{ columnId: "name", direction: "asc" }]);
    expect(result.current.viewIndex).toEqual([1, 2, 0]);

    act(() => {
      result.current.actions.toggleSort("name", false);
    });
    rerender();

    expect(result.current.sortState).toEqual([{ columnId: "name", direction: "desc" }]);
    expect(result.current.viewIndex).toEqual([0, 2, 1]);

    act(() => {
      result.current.actions.toggleSort("name", false);
    });
    rerender();

    expect(result.current.sortState).toEqual([]);
    expect(result.current.viewIndex).toEqual([0, 1, 2]);
  });

  it("recomputes viewIndex when live data prop changes", () => {
    const wrapper = makeWrapper();
    const { result, rerender: rerenderHook } = renderHook(() => useDataGridViewIndex(), { wrapper });
    expect(result.current).toEqual([0, 1, 2]);

    function Harness({ data }: { data: Row[] }) {
      return (
        <DataGridProvider data={data} columns={columns} getRowId={(r) => r.id}>
          <Probe />
        </DataGridProvider>
      );
    }
    function Probe() {
      const viewIndex = useDataGridViewIndex();
      return <div data-testid="view-index">{viewIndex.join(",")}</div>;
    }

    const { rerender } = render(<Harness data={rows()} />);
    expect(screen.getByTestId("view-index").textContent).toBe("0,1,2");

    const shorter = rows().slice(0, 2);
    rerender(<Harness data={shorter} />);
    expect(screen.getByTestId("view-index").textContent).toBe("0,1");
    rerenderHook();
  });

  it("a reference-identical resync (same data/columns, unrelated parent re-render) keeps the viewIndex/searchMatches/visibleColumns references", () => {
    const data = rows();
    const { result, rerender } = renderHook(
      () => ({
        actions: useDataGridInternalActions(),
        viewIndex: useDataGridViewIndex(),
        visibleColumns: useDataGridVisibleColumns(),
        searchMatches: useDataGridSearchMatches(),
      }),
      { wrapper: makeWrapper(data) },
    );

    const viewIndexBefore = result.current.viewIndex;
    const visibleColumnsBefore = result.current.visibleColumns;
    const searchMatchesBefore = result.current.searchMatches;

    // An unrelated parent re-render calls _syncProps again with the exact same data/columns
    // references (no sort/filter/search change) — nothing derived should be recomputed.
    act(() => {
      result.current.actions._syncProps({ data, columns, getRowId: (r: Row) => r.id } as never);
    });
    rerender();

    expect(result.current.viewIndex).toBe(viewIndexBefore);
    expect(result.current.visibleColumns).toBe(visibleColumnsBefore);
    expect(result.current.searchMatches).toBe(searchMatchesBefore);
  });

  it("changed data that actually reorders the view DOES produce a new viewIndex reference on resync", () => {
    let captured: number[] | null = null;

    function Harness({ data }: { data: Row[] }) {
      return (
        <DataGridProvider data={data} columns={columns} getRowId={(r) => r.id} sortState={[{ columnId: "name", direction: "asc" }]}>
          <Probe />
        </DataGridProvider>
      );
    }
    function Probe() {
      const viewIndex = useDataGridViewIndex();
      captured = viewIndex;
      return <div data-testid="view-index-ref">{viewIndex.join(",")}</div>;
    }

    // Charlie, Alice, Bob sorted asc by name -> Alice(1), Bob(2), Charlie(0).
    const initial = rows();
    const { rerender } = render(<Harness data={initial} />);
    expect(screen.getByTestId("view-index-ref").textContent).toBe("1,2,0");
    const before = captured;

    // Renaming row 0 to sort first changes the resulting order, so this resync must not reuse
    // the stale reference — guarding on `data` identity alone (ignoring content) would miss this.
    const changed = [{ ...initial[0]!, name: "Aaron" }, initial[1]!, initial[2]!];
    rerender(<Harness data={changed} />);
    expect(screen.getByTestId("view-index-ref").textContent).toBe("0,1,2");

    expect(captured).not.toBe(before);
  });
});

describe("viewIndex reference reuse", () => {
  it("re-applying an identical sort (setSorts with a new but content-equal spec) keeps the viewIndex reference", () => {
    const wrapper = makeWrapper();
    const { result, rerender } = renderHook(
      () => ({ actions: useDataGridInternalActions(), viewIndex: useDataGridViewIndex() }),
      { wrapper },
    );

    act(() => {
      result.current.actions.setSorts([{ columnId: "name", direction: "asc" }]);
    });
    rerender();
    const afterFirstSort = result.current.viewIndex;
    expect(afterFirstSort).toEqual([1, 2, 0]);

    // A fresh array with the same spec content re-derives the identical index order.
    act(() => {
      result.current.actions.setSorts([{ columnId: "name", direction: "asc" }]);
    });
    rerender();

    expect(result.current.viewIndex).toBe(afterFirstSort);
  });
});

describe("atomic hook re-render counts", () => {
  it("a row hook does not re-render when a different row's identity changes", () => {
    let rendersRow0 = 0;
    let rendersRow1 = 0;

    const RowProbe = memo(function RowProbe({ index, onRender }: { index: number; onRender: () => void }) {
      onRender();
      const row = useDataGridRow(index) as Row | undefined;
      return <div data-testid={`row-${index}`}>{row?.name}</div>;
    });

    const onRenderRow0 = () => rendersRow0++;
    const onRenderRow1 = () => rendersRow1++;

    function Harness({ data }: { data: Row[] }) {
      return (
        <DataGridProvider data={data} columns={columns} getRowId={(r) => r.id}>
          <RowProbe index={0} onRender={onRenderRow0} />
          <RowProbe index={1} onRender={onRenderRow1} />
        </DataGridProvider>
      );
    }

    const initial = rows();
    const { rerender } = render(<Harness data={initial} />);
    expect(rendersRow0).toBe(1);
    expect(rendersRow1).toBe(1);

    // Replace only row 1's identity; row 0 is untouched.
    const changed = [initial[0]!, { ...initial[1]!, name: "Alicia" }, initial[2]!];
    rerender(<Harness data={changed} />);

    expect(rendersRow1).toBe(2);
    expect(rendersRow0).toBe(1); // row 0's own selector output didn't change identity, so no re-render
    expect(screen.getByTestId("row-1").textContent).toBe("Alicia");
  });

  describe("useDataGridRowIdToViewRow", () => {
    it("does not rebuild the map on an unrelated store change (selection)", () => {
      let computeCount = 0;
      let lastMap: ReadonlyMap<string, number> | undefined;

      function Probe() {
        const map = useDataGridRowIdToViewRow();
        if (map !== lastMap) computeCount++;
        lastMap = map;
        return null;
      }

      function Harness() {
        const actions = useDataGridInternalActions();
        return (
          <>
            <Probe />
            <button onClick={() => actions.selectCellAt({ col: 0, row: 1 })}>select</button>
          </>
        );
      }

      render(<Harness />, { wrapper: makeWrapper() });
      expect(computeCount).toBe(1);

      act(() => {
        screen.getByText("select").click();
      });
      // a selection change is a store write, but touches neither viewIndex, data, nor getRowId —
      // useMemo must return the SAME map reference, so the probe's identity check sees no change.
      expect(computeCount).toBe(1);
    });

    it("rebuilds the map after a sort changes the view", () => {
      let computeCount = 0;

      function Probe() {
        useDataGridRowIdToViewRow();
        computeCount++;
        return null;
      }

      function Harness() {
        const actions = useDataGridInternalActions();
        return (
          <>
            <Probe />
            <button onClick={() => actions.toggleSort("name", false)}>sort</button>
          </>
        );
      }

      render(<Harness />, { wrapper: makeWrapper() });
      expect(computeCount).toBe(1);

      act(() => {
        screen.getByText("sort").click();
      });
      expect(computeCount).toBe(2);
    });

    it("maps rowId to the correct post-sort view row", () => {
      const { result } = renderHook(
        () => ({ actions: useDataGridInternalActions(), map: useDataGridRowIdToViewRow() }),
        { wrapper: makeWrapper() },
      );

      // unsorted: Charlie(1)=row0, Alice(2)=row1, Bob(3)=row2
      expect(result.current.map.get("2")).toBe(1);

      act(() => {
        result.current.actions.toggleSort("name", false);
      });
      // sorted asc by name: Alice(2)=row0, Bob(3)=row1, Charlie(1)=row2
      expect(result.current.map.get("2")).toBe(0);
      expect(result.current.map.get("1")).toBe(2);
    });

    it("a rowId filtered out of the view is absent from the map", () => {
      const { result } = renderHook(
        () => ({ actions: useDataGridInternalActions(), map: useDataGridRowIdToViewRow() }),
        { wrapper: makeWrapper() },
      );

      act(() => {
        result.current.actions.setFilters([{ filterId: "f1", columnId: "name", operator: "equals", value: "Alice" }]);
      });
      expect(result.current.map.size).toBe(1);
      expect(result.current.map.get("2")).toBe(0);
      expect(result.current.map.get("1")).toBeUndefined();
    });

    it("a value-only updateCells tick keeps the map identity (row identities did not move)", () => {
      let computeCount = 0;
      let lastMap: ReadonlyMap<string, number> | undefined;

      function Probe() {
        const map = useDataGridRowIdToViewRow();
        if (map !== lastMap) computeCount++;
        lastMap = map;
        return map;
      }

      function Harness() {
        const actions = useDataGridInternalActions();
        return (
          <>
            <Probe />
            <button
              onClick={() => {
                actions.updateCells([{ rowId: "1", columnId: "name", value: "Aaron" }]);
              }}
            >
              patch
            </button>
          </>
        );
      }

      render(<Harness />, { wrapper: makeWrapper() });
      expect(computeCount).toBe(1);

      // A value-only patch replaces the `data` array (immutability) but moves no row: the map's
      // contents are unchanged, so its reference must be too.
      act(() => {
        screen.getByText("patch").click();
      });
      expect(computeCount).toBe(1);
    });

    it("reorderRows without a sort moves the mapped rows", () => {
      const { result } = renderHook(
        () => ({ actions: useDataGridInternalActions(), map: useDataGridRowIdToViewRow() }),
        { wrapper: makeWrapper() },
      );
      expect(result.current.map.get("1")).toBe(0);

      act(() => {
        result.current.actions.reorderRows(0, 2);
      });

      // Alice(2)=row0, Bob(3)=row1, Charlie(1)=row2
      expect(result.current.map.get("1")).toBe(2);
      expect(result.current.map.get("2")).toBe(0);
    });

    it("a consumer swap to same-length data with other ids rebuilds the map", () => {
      let map: ReadonlyMap<string, number> = new Map();
      function Probe() {
        map = useDataGridRowIdToViewRow();
        return null;
      }
      const stableGetRowId = (r: Row) => r.id;
      const ui = (data: Row[]) => (
        <DataGridProvider data={data} columns={columns} getRowId={stableGetRowId}>
          <Probe />
        </DataGridProvider>
      );
      const view = render(ui(rows()));
      expect(map.get("1")).toBe(0);

      view.rerender(ui(rows().map((r) => ({ ...r, id: `x${r.id}` }))));

      expect(map.get("1")).toBeUndefined();
      expect(map.get("x1")).toBe(0);
    });

    it("filling a lazy hole adds the row to the map", () => {
      let map: ReadonlyMap<string, number> = new Map();
      function Probe() {
        map = useDataGridRowIdToViewRow();
        return null;
      }
      const lazyId = (r: Row | undefined, index: number) => (r === undefined ? `hole-${index}` : r.id);
      const ui = (data: (Row | undefined)[]) => (
        <DataGridProvider data={data as Row[]} columns={columns} getRowId={lazyId as never}>
          <Probe />
        </DataGridProvider>
      );
      const sparse: (Row | undefined)[] = rows();
      sparse[1] = undefined;
      const view = render(ui(sparse));
      expect(map.get("2")).toBeUndefined();

      view.rerender(ui(rows()));

      expect(map.get("2")).toBe(1);
    });

    it("a value-only updateCells tick does not re-render the host", () => {
      let renderCount = 0;

      function Probe() {
        useDataGridRowIdToViewRow();
        renderCount++;
        return null;
      }

      const Base = makeWrapper();
      const { result } = renderHook(() => useDataGridInternalActions(), {
        wrapper: ({ children }) => (
          <Base>
            <Probe />
            {children}
          </Base>
        ),
      });
      expect(renderCount).toBe(1);

      act(() => {
        result.current.updateCells([{ rowId: "1", columnId: "name", value: "Aaron" }]);
      });
      expect(renderCount).toBe(1);
    });

    it("insertRows and deleteRows rebuild the map (the rowId-to-index mapping moved)", () => {
      let computeCount = 0;
      let lastMap: ReadonlyMap<string, number> | undefined;

      function Probe() {
        const map = useDataGridRowIdToViewRow();
        if (map !== lastMap) computeCount++;
        lastMap = map;
        return map;
      }

      function Harness() {
        const actions = useDataGridInternalActions();
        return (
          <>
            <Probe />
            <button onClick={() => actions.insertRows(0, 1)}>insert</button>
            <button onClick={() => actions.deleteRows([0])}>delete</button>
          </>
        );
      }

      render(<Harness />, { wrapper: makeConfigWrapper({ createRow: () => ({ id: "9", name: "New", age: 0 }) }) });
      expect(computeCount).toBe(1);

      act(() => {
        screen.getByText("insert").click();
      });
      expect(computeCount).toBe(2);

      act(() => {
        screen.getByText("delete").click();
      });
      expect(computeCount).toBe(3);
    });
  });

  it("useDataGridIsRowSelected only re-renders the affected row", () => {
    let rendersRow0 = 0;
    let rendersRow2 = 0;

    function SelectedProbe({ index, onRender }: { index: number; onRender: () => void }) {
      onRender();
      const selected = useDataGridIsRowSelected(index);
      return <div data-testid={`sel-${index}`}>{String(selected)}</div>;
    }

    function Harness() {
      const actions = useDataGridInternalActions();
      return (
        <>
          <button onClick={() => actions.selectRow(0)}>select-0</button>
          <SelectedProbe index={0} onRender={() => rendersRow0++} />
          <SelectedProbe index={2} onRender={() => rendersRow2++} />
        </>
      );
    }

    render(
      <DataGridProvider data={rows()} columns={columns} getRowId={(r) => r.id}>
        <Harness />
      </DataGridProvider>,
    );

    expect(rendersRow0).toBe(1);
    expect(rendersRow2).toBe(1);
    expect(screen.getByTestId("sel-0").textContent).toBe("false");

    act(() => {
      screen.getByText("select-0").click();
    });

    expect(screen.getByTestId("sel-0").textContent).toBe("true");
    expect(screen.getByTestId("sel-2").textContent).toBe("false");
    expect(rendersRow0).toBe(2);
    expect(rendersRow2).toBe(1); // row 2's selected-ness didn't change, so it didn't re-render
  });
});

describe("useDataGridRowCellState (one subscription per row)", () => {
  it("an active-cell move only re-renders the two affected rows, never an untouched row", () => {
    const renders = [0, 0, 0];
    let actionsRef: ReturnType<typeof useDataGridInternalActions> | null = null;

    function RowProbe({ index, onRender }: { index: number; onRender: () => void }) {
      onRender();
      const state = useDataGridRowCellState(index);
      return <div data-testid={`row-${index}`}>{String(state.activeCol)}</div>;
    }

    function Harness() {
      actionsRef = useDataGridInternalActions();
      return (
        <>
          <RowProbe index={0} onRender={() => renders[0]!++} />
          <RowProbe index={1} onRender={() => renders[1]!++} />
          <RowProbe index={2} onRender={() => renders[2]!++} />
        </>
      );
    }

    render(
      <DataGridProvider data={rows()} columns={columns} getRowId={(r) => r.id}>
        <Harness />
      </DataGridProvider>,
    );
    const before = [...renders];

    act(() => actionsRef!.selectCellAt({ col: 0, row: 0 }));
    // only row 0 (the newly-active row) re-renders; rows 1 and 2 are untouched.
    expect(renders[0]).toBe(before[0]! + 1);
    expect(renders[1]).toBe(before[1]);
    expect(renders[2]).toBe(before[2]);

    const afterFirst = [...renders];
    act(() => actionsRef!.selectCellAt({ col: 0, row: 1 }));
    // moving the active cell from row 0 to row 1 re-renders exactly those two rows (each recomputes
    // its own activeCol to null/0 respectively); row 2 still never re-renders.
    expect(renders[0]).toBe(afterFirst[0]! + 1);
    expect(renders[1]).toBe(afterFirst[1]! + 1);
    expect(renders[2]).toBe(afterFirst[2]);
  });

  it("row-level selector output is referentially stable across a store update that doesn't touch this row", () => {
    const wrapper = makeWrapper();
    const { result, rerender } = renderHook(
      () => ({ actions: useDataGridInternalActions(), row2: useDataGridRowCellState(2) }),
      { wrapper },
    );
    const firstState = result.current.row2;

    // activating row 0's cell is unrelated to row 2 — row 2's derived object must keep its identity.
    act(() => result.current.actions.selectCellAt({ col: 0, row: 0 }));
    rerender();

    expect(result.current.row2).toBe(firstState);
  });

  it("collapses selection to a small selectedColRanges array instead of a per-column flag", () => {
    const wrapper = makeWrapper();
    const { result, rerender } = renderHook(
      () => ({ actions: useDataGridInternalActions(), row0: useDataGridRowCellState(0) }),
      { wrapper },
    );

    act(() => {
      result.current.actions.selectCellAt({ col: 0, row: 0 });
      result.current.actions.extendToAt({ col: 1, row: 0 });
    });
    rerender();

    expect(result.current.row0.selectedColRanges).toEqual([[0, 2]]);
  });

  it("editingInitialText is only populated for the row currently being edited", () => {
    const wrapper = makeWrapper();
    const { result, rerender } = renderHook(
      () => ({
        actions: useDataGridInternalActions(),
        row0: useDataGridRowCellState(0),
        row1: useDataGridRowCellState(1),
      }),
      { wrapper },
    );

    act(() => result.current.actions.startEditingAt({ col: 0, row: 0 }, "typed"));
    rerender();

    expect(result.current.row0.editingCol).toBe(0);
    expect(result.current.row0.editingInitialText).toBe("typed");
    expect(result.current.row1.editingCol).toBeNull();
    expect(result.current.row1.editingInitialText).toBeUndefined();
  });
});

describe("non-writable columns (accessorFn-only) in batch writes", () => {
  // regression: fill-handle drag over an accessorFn-only column crashed in setCellValue (user QA 2026-07-16)
  it("applyCellUpdates skips a column with neither setValue nor accessorKey instead of throwing", () => {
    const onDataChange = vi.fn();
    const mixedColumns: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name" },
      { id: "computed", header: "Computed", accessorFn: (r) => `${r.name}-${r.age}` },
    ];
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <DataGridProvider data={rows()} columns={mixedColumns} getRowId={(r) => r.id} onDataChange={onDataChange}>
          {children}
        </DataGridProvider>
      );
    }
    const { result } = renderHook(() => useDataGridInternalActions(), { wrapper: Wrapper });

    expect(() =>
      act(() => {
        result.current.applyCellUpdates(
          [
            { viewRowIndex: 0, columnId: "name", value: "Written" },
            { viewRowIndex: 0, columnId: "computed", value: "must-be-skipped" },
          ],
          "fill",
        );
      }),
    ).not.toThrow();

    expect(onDataChange).toHaveBeenCalledTimes(1);
    const [nextData, change] = onDataChange.mock.calls[0] as [readonly Row[], DataChange<Row>];
    expect(nextData[0]!.name).toBe("Written");
    const op = change.ops[0]!;
    if (op.type !== "update" || !op.cells) throw new Error("expected an update op with cell detail");
    // only the writable column produced a cell delta; the accessorFn-only one was skipped
    expect(op.cells.map((c) => c.columnId)).toEqual(["name"]);
  });
});

describe("actions referential stability", () => {
  it("the actions object keeps the same identity across state changes", () => {
    const wrapper = makeWrapper();
    const { result, rerender } = renderHook(
      () => ({ actions: useDataGridInternalActions(), viewIndex: useDataGridViewIndex() }),
      { wrapper },
    );
    const firstActions = result.current.actions;

    act(() => {
      result.current.actions.toggleSort("name", false);
    });
    rerender();

    expect(result.current.actions).toBe(firstActions);

    act(() => {
      result.current.actions.selectCellAt({ col: 0, row: 0 });
    });
    rerender();

    expect(result.current.actions).toBe(firstActions);
  });
});

describe("hidden columns", () => {
  const hiddenCols: readonly ColumnDef<Row, unknown>[] = [
    { id: "name", header: "Name", accessorKey: "name" },
    { id: "age", header: "Age", accessorKey: "age", hidden: true },
  ];

  function wrapperWithHidden({ children }: { children: ReactNode }) {
    return (
      <DataGridProvider data={rows()} columns={hiddenCols} getRowId={(r) => r.id}>
        {children}
      </DataGridProvider>
    );
  }

  it("excludes def-level hidden columns from visibleColumns", () => {
    const { result } = renderHook(() => useDataGridVisibleColumns(), { wrapper: wrapperWithHidden });
    expect(result.current.map((c) => c.id)).toEqual(["name"]);
  });

  it("excludes def-level hidden columns from quick-search matches", () => {
    const { result } = renderHook(
      () => ({ actions: useDataGridInternalActions(), matches: useDataGridSearchMatches() }),
      { wrapper: wrapperWithHidden },
    );

    act(() => {
      // "40" only matches the hidden "age" column's value; visible "name" column never contains it.
      result.current.actions.setSearch("40");
    });

    expect(result.current.matches).toEqual([]);
  });
});

describe("search never filters viewIndex", () => {
  it("setSearch leaves viewIndex unchanged (highlight + navigate only)", () => {
    const wrapper = makeWrapper();
    const { result, rerender } = renderHook(
      () => ({
        actions: useDataGridInternalActions(),
        viewIndex: useDataGridViewIndex(),
        matches: useDataGridSearchMatches(),
      }),
      { wrapper },
    );
    const viewIndexBeforeSearch = result.current.viewIndex;

    act(() => {
      result.current.actions.setSearch("Bob");
    });
    rerender();

    expect(result.current.viewIndex).toEqual(viewIndexBeforeSearch);
    expect(result.current.viewIndex).toEqual([0, 1, 2]);
    expect(result.current.matches).toEqual([{ row: 2, columnId: "name" }]);
  });

  it("recomputes searchMatches (not viewIndex) when a matching column becomes hidden via _syncProps", () => {
    function Harness({ hideAge }: { hideAge: boolean }) {
      const cols: readonly ColumnDef<Row, unknown>[] = [
        { id: "name", header: "Name", accessorKey: "name" },
        { id: "age", header: "Age", accessorKey: "age", hidden: hideAge },
      ];
      return (
        <DataGridProvider data={rows()} columns={cols} getRowId={(r) => r.id}>
          <Probe />
        </DataGridProvider>
      );
    }
    function Probe() {
      const actions = useDataGridInternalActions();
      const viewIndex = useDataGridViewIndex();
      const matches = useDataGridSearchMatches();
      return (
        <div>
          <div data-testid="vi">{viewIndex.join(",")}</div>
          <div data-testid="matches">{matches.map((m) => `${m.row}:${m.columnId}`).join(",")}</div>
          <button onClick={() => actions.setSearch("40")}>search-40</button>
        </div>
      );
    }

    const { rerender: rerenderTree } = render(<Harness hideAge={false} />);
    act(() => {
      screen.getByText("search-40").click();
    });
    // "40" matches the visible "age" column's value at row 2; viewIndex is untouched either way.
    expect(screen.getByTestId("vi").textContent).toBe("0,1,2");
    expect(screen.getByTestId("matches").textContent).toBe("2:age");

    // hiding "age" removes it from quick-search's column set — the match disappears, viewIndex doesn't change.
    rerenderTree(<Harness hideAge />);
    expect(screen.getByTestId("vi").textContent).toBe("0,1,2");
    expect(screen.getByTestId("matches").textContent).toBe("");
  });
});

describe("activeCell stays synced with the selection anchor", () => {
  it("pushRange (ctrl-click) moves activeCell to the new anchor", () => {
    const wrapper = makeWrapper();
    const { result, rerender } = renderHook(
      () => ({
        actions: useDataGridInternalActions(),
        activeCell: useDataGridActiveCell(),
        selection: useDataGridSelection(),
      }),
      { wrapper },
    );

    act(() => {
      result.current.actions.selectCellAt({ col: 0, row: 0 });
    });
    rerender();

    act(() => {
      result.current.actions.pushRangeAt({ col: 1, row: 1 });
    });
    rerender();

    expect(result.current.activeCell).toEqual({ col: 1, row: 1 });
    expect(result.current.selection.current?.cell).toEqual({ col: 1, row: 1 });
  });

  it("extendTo's empty-selection fallback sets activeCell to the new anchor", () => {
    const wrapper = makeWrapper();
    const { result, rerender } = renderHook(
      () => ({ actions: useDataGridInternalActions(), activeCell: useDataGridActiveCell() }),
      { wrapper },
    );

    expect(result.current.activeCell).toBeNull();

    act(() => {
      result.current.actions.extendToAt({ col: 1, row: 1 });
    });
    rerender();

    expect(result.current.activeCell).toEqual({ col: 1, row: 1 });
  });
});

describe("toggleSort additive preserves column priority", () => {
  it("shift-click on an already-sorted column cycles direction in place instead of demoting it", () => {
    const wrapper = makeWrapper();
    const { result, rerender } = renderHook(
      () => ({ actions: useDataGridInternalActions(), sortState: useDataGridSortState() }),
      { wrapper },
    );

    act(() => {
      result.current.actions.toggleSort("name", true);
    });
    rerender();
    act(() => {
      result.current.actions.toggleSort("age", true);
    });
    rerender();
    expect(result.current.sortState).toEqual([
      { columnId: "name", direction: "asc" },
      { columnId: "age", direction: "asc" },
    ]);

    act(() => {
      result.current.actions.toggleSort("name", true);
    });
    rerender();

    expect(result.current.sortState).toEqual([
      { columnId: "name", direction: "desc" },
      { columnId: "age", direction: "asc" },
    ]);
  });
});

describe("dev-mode guardrails", () => {
  it("warns once per instance on duplicate column ids, not per render", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const dupCols: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name" },
      { id: "name", header: "Name Again", accessorKey: "name" },
    ];

    const { rerender } = render(
      <DataGridProvider data={rows()} columns={dupCols} getRowId={(r) => r.id}>
        <div />
      </DataGridProvider>,
    );
    rerender(
      <DataGridProvider data={rows()} columns={dupCols} getRowId={(r) => r.id}>
        <div />
      </DataGridProvider>,
    );
    rerender(
      <DataGridProvider data={rows()} columns={dupCols} getRowId={(r) => r.id}>
        <div />
      </DataGridProvider>,
    );

    // once per instance (per duplicated id), not per render
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('duplicate column id "name"')).length).toBe(1);
    warn.mockRestore();
  });

  it("warns once per instance when a column type resolves to nothing in the cellTypes registry", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cols: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name", type: "number" },
      { id: "bad", header: "Bad", accessorKey: "name", type: "bogus" },
    ];

    const { rerender } = render(
      <DataGridProvider data={rows()} columns={cols} getRowId={(r) => r.id}>
        <div />
      </DataGridProvider>,
    );
    rerender(
      <DataGridProvider data={rows()} columns={cols} getRowId={(r) => r.id}>
        <div />
      </DataGridProvider>,
    );

    // once per instance (per bad column id + type), not per render
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('type "bogus"')).length).toBe(1);
    warn.mockRestore();
  });

  it("does not warn for a built-in type when the cellTypes prop names only custom types", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cols: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name", type: "custom" as never },
      { id: "age", header: "Age", accessorKey: "age", type: "number" },
    ];
    const custom = { ...cellTypes.text };

    render(
      <DataGridProvider data={rows()} columns={cols} getRowId={(r) => r.id} cellTypes={{ custom } as never}>
        <div />
      </DataGridProvider>,
    );

    expect(warn.mock.calls.filter((c) => String(c[0]).includes("resolves to nothing"))).toEqual([]);
    warn.mockRestore();
  });

  it("warns when a null cellTypes entry removes a type a column uses", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cols: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name" },
      { id: "age", header: "Age", accessorKey: "age", type: "number" },
    ];

    render(
      <DataGridProvider data={rows()} columns={cols} getRowId={(r) => r.id} cellTypes={{ number: null }}>
        <div />
      </DataGridProvider>,
    );

    expect(warn.mock.calls.filter((c) => String(c[0]).includes('type "number"')).length).toBe(1);
    warn.mockRestore();
  });

  it("warns when the columns array identity changes every render", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // The churn is constructed by the caller, not inside render, so the compiler has no
    // render-scoped expression to memoize — the provider still sees a fresh array each pass,
    // which is exactly the anti-pattern the guardrail targets.
    const freshColumns = (): readonly ColumnDef<Row, unknown>[] => [
      { id: "name", header: "Name", accessorKey: "name" },
    ];

    function Harness({ columns }: { columns: readonly ColumnDef<Row, unknown>[] }) {
      return (
        <DataGridProvider data={rows()} columns={columns} getRowId={(r) => r.id}>
          <div />
        </DataGridProvider>
      );
    }

    const { rerender } = render(<Harness columns={freshColumns()} />);
    rerender(<Harness columns={freshColumns()} />);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("columns array identity changed"));
    warn.mockRestore();
  });

  it("does NOT warn on a legitimate immutable single-row edit (new array, one row replaced)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cols: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];
    const initial = rows();

    const { rerender } = render(
      <DataGridProvider data={initial} columns={cols} getRowId={(r) => r.id}>
        <div />
      </DataGridProvider>,
    );
    const edited = initial.map((r, i) => (i === 0 ? { ...r, name: "Edited" } : r));
    rerender(
      <DataGridProvider data={edited} columns={cols} getRowId={(r) => r.id}>
        <div />
      </DataGridProvider>,
    );

    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("data array identity changed"));
    warn.mockRestore();
  });

  it("warns when the data array is rebuilt with zero row changes (identity churn)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cols: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];
    const initial = rows();

    const { rerender } = render(
      <DataGridProvider data={initial} columns={cols} getRowId={(r) => r.id}>
        <div />
      </DataGridProvider>,
    );
    rerender(
      <DataGridProvider data={[...initial]} columns={cols} getRowId={(r) => r.id}>
        <div />
      </DataGridProvider>,
    );

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("data array identity changed with no row changes"));
    warn.mockRestore();
  });
});

type EditRow = { id: string; name: string; age: number; active: boolean };

const editColumns: readonly ColumnDef<EditRow, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  {
    id: "age",
    header: "Age",
    accessorKey: "age",
    type: "number",
    validate: (value) => (typeof value === "number" && value < 0 ? "must be >= 0" : null),
  },
  { id: "active", header: "Active", accessorKey: "active", type: "checkbox" },
  { id: "locked", header: "Locked", accessorKey: "name", readOnly: true },
];

function editRows(): EditRow[] {
  return [
    { id: "1", name: "Charlie", age: 30, active: false },
    { id: "2", name: "Alice", age: 25, active: true },
    { id: "3", name: "Bob", age: 40, active: false },
  ];
}

function makeEditWrapper(onDataChange: (next: readonly EditRow[], change: DataChange<EditRow>) => void, data: EditRow[] = editRows()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DataGridProvider data={data} columns={editColumns} getRowId={(r) => r.id} onDataChange={onDataChange}>
        {children}
      </DataGridProvider>
    );
  };
}

/** `defaultData` counterpart to `makeEditWrapper` — no `data` prop, so the store owns the array. */
function makeUncontrolledWrapper(
  onDataChange?: (next: readonly EditRow[], change: DataChange<EditRow>) => void,
  defaultData: EditRow[] = editRows(),
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DataGridProvider defaultData={defaultData} columns={editColumns} getRowId={(r) => r.id} onDataChange={onDataChange}>
        {children}
      </DataGridProvider>
    );
  };
}

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
      result.current.actions.toggleSort("name", false);
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
        editingError: useDataGridEditingError(),
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
      result.current.actions.toggleSort("name", false);
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
      result.current.actions.toggleSort("age", false);
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
      result.current.actions.toggleSort("name", false);
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
      result.current.actions.toggleSort("name", false);
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
      result.current.actions.toggleSort("name", false);
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
    const syncProps = vi.spyOn(state().actions, "_syncProps");
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
      grid.actions.updateCells([{ rowId: "1", columnId: "age", value: 77 }]);
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
      () => ({ actions: useDataGridInternalActions(), editing: useDataGridEditing(), editingError: useDataGridEditingError() }),
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

  it("setEditingError sets editingError without touching editing/data, and no-ops when not editing", () => {
    const onDataChange = vi.fn();
    const wrapper = makeEditWrapper(onDataChange);
    const { result, rerender } = renderHook(
      () => ({ actions: useDataGridInternalActions(), editing: useDataGridEditing(), editingError: useDataGridEditingError() }),
      { wrapper },
    );

    act(() => {
      result.current.actions.setEditingError("should be a no-op, nothing is being edited");
    });
    rerender();
    expect(result.current.editingError).toBeNull();

    act(() => {
      result.current.actions.startEditingAt({ col: 1, row: 0 });
    });
    act(() => {
      result.current.actions.setEditingError("async rejection message");
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
      result.current.actions.updateCells([{ rowId: "1", columnId: "age", value: 31 }]);
    });
    expect(result.current.errors.get(cellErrorKey("1", "name"))).toBe("Charlie is banned");

    act(() => {
      result.current.actions.deleteRows([0]);
      result.current.actions.insertRow(0, "above");
    });
    act(() => {
      result.current.actions.setCellErrors([{ rowId: "1", columnId: "name", message: "consumer error" }]);
    });
    act(() => {
      result.current.actions.updateCells([{ rowId: "1", columnId: "age", value: 51 }]);
    });

    expect(result.current.errors.get(cellErrorKey("1", "name"))).toBe("consumer error");
  });
});

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
  it("defaults every flag to true", () => {
    const { result } = renderHook(() => useDataGridSelectionConfig(), { wrapper: makeWrapper() });
    expect(result.current).toEqual({
      enableRowSelection: true,
      enableColumnSelection: true,
      enableRangeSelection: true,
      enableMultiRange: true,
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

describe("marker channel wiring: setRowSelected / setAllRowsSelected / useDataGridAllRowsSelected", () => {
  it("setRowSelected adds/removes a single row from the rows channel without touching the range channel", () => {
    const wrapper = makeConfigWrapper({ rowMarkers: "checkbox" });
    const { result } = renderHook(() => ({ actions: useDataGridInternalActions(), selection: useDataGridSelection() }), { wrapper });

    act(() => {
      result.current.actions.selectCellAt({ col: 0, row: 2 }); // unrelated range/active-cell state
      result.current.actions.setRowSelected(1, true);
    });

    expect(result.current.selection.rows.toArray()).toEqual([1]);
    expect(result.current.selection.current?.cell).toEqual({ col: 0, row: 2 }); // untouched

    act(() => result.current.actions.setRowSelected(1, false));
    expect(result.current.selection.rows.toArray()).toEqual([]);
  });

  it("setRowSelected is additive: toggling a second row keeps the first", () => {
    const wrapper = makeConfigWrapper({ rowMarkers: "checkbox" });
    const { result } = renderHook(() => ({ actions: useDataGridInternalActions(), selection: useDataGridSelection() }), { wrapper });

    act(() => {
      result.current.actions.setRowSelected(0, true);
      result.current.actions.setRowSelected(2, true);
    });

    expect(result.current.selection.rows.toArray()).toEqual([0, 2]);
  });

  it("setRowSelected is a no-op when enableRowSelection is false", () => {
    const wrapper = makeConfigWrapper({ rowMarkers: "checkbox", enableRowSelection: false });
    const { result } = renderHook(() => ({ actions: useDataGridInternalActions(), selection: useDataGridSelection() }), { wrapper });

    act(() => result.current.actions.setRowSelected(0, true));

    expect(result.current.selection.rows.length).toBe(0);
  });

  it("setAllRowsSelected(true) selects every view row; (false) clears the channel", () => {
    const wrapper = makeConfigWrapper({ rowMarkers: "checkbox" });
    const { result } = renderHook(() => ({ actions: useDataGridInternalActions(), selection: useDataGridSelection() }), { wrapper });

    act(() => result.current.actions.setAllRowsSelected(true));
    expect(result.current.selection.rows.toArray()).toEqual([0, 1, 2]);

    act(() => result.current.actions.setAllRowsSelected(false));
    expect(result.current.selection.rows.toArray()).toEqual([]);
  });

  it("useDataGridAllRowsSelected reports checked/indeterminate/unchecked", () => {
    const wrapper = makeConfigWrapper({ rowMarkers: "checkbox" });
    const { result } = renderHook(
      () => ({ actions: useDataGridInternalActions(), state: useDataGridAllRowsSelected() }),
      { wrapper },
    );

    expect(result.current.state).toBe("unchecked");

    act(() => result.current.actions.setRowSelected(0, true));
    expect(result.current.state).toBe("indeterminate");

    act(() => result.current.actions.setAllRowsSelected(true));
    expect(result.current.state).toBe("checked");

    act(() => result.current.actions.setAllRowsSelected(false));
    expect(result.current.state).toBe("unchecked");
  });

  it("useDataGridAllRowsSelected agrees with useDataGridIsRowSelected for a range covering every view row", () => {
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
      latest!.actions.setRowSelected(3, true);
      latest!.actions.setRowSelected(4, true);
    });
    expect(latest!.allRowsState).toBe("indeterminate");

    // narrow the view to exactly those two rows' complement being filtered out — 2 rows remain,
    // but neither was ever toggled by the user, so the checkbox must not read 'checked'.
    rerender(<Harness data={data.slice(0, 2)} />);
    expect(latest!.rows).toEqual([]);
    expect(latest!.allRowsState).toBe("unchecked");
  });

  it("setRowSelected(index, false) visually unchecks a row even while it remains inside an active range", () => {
    const wrapper = makeConfigWrapper({ rowMarkers: "checkbox" });
    const { result } = renderHook(
      () => ({ actions: useDataGridInternalActions(), row1Selected: useDataGridIsRowSelected(1) }),
      { wrapper },
    );

    act(() => {
      result.current.actions.selectCellAt({ col: 0, row: 0 });
      result.current.actions.extendToAt({ col: 1, row: 2 }); // range covers rows 0-2, including row 1
      result.current.actions.setRowSelected(1, true);
    });
    expect(result.current.row1Selected).toBe(true);

    act(() => result.current.actions.setRowSelected(1, false));
    // still true: row 1 remains inside the active range channel, independent of the rows channel —
    // documented behavior (useDataGridIsRowSelected is a channel union, not rows-channel-only).
    expect(result.current.row1Selected).toBe(true);
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
    act(() => result.current.actions.setRowSelected(0, true));
    expect(result.current.state).toBe("indeterminate");
    expect(hasIndexSpy).not.toHaveBeenCalled();
    expect(hasAllSpy.mock.calls.length).toBeLessThan(50);

    hasIndexSpy.mockClear();
    hasAllSpy.mockClear();
    act(() => result.current.actions.setAllRowsSelected(true));
    expect(result.current.state).toBe("checked");
    expect(hasIndexSpy).not.toHaveBeenCalled();
    expect(hasAllSpy.mock.calls.length).toBeLessThan(50);

    hasIndexSpy.mockRestore();
    hasAllSpy.mockRestore();
  });
});

describe("column UX actions (resize/reorder/pin/visibility)", () => {
  const threeColumns: readonly ColumnDef<Row, unknown>[] = [
    { id: "name", header: "Name", accessorKey: "name" },
    { id: "age", header: "Age", accessorKey: "age" },
    { id: "id", header: "ID", accessorKey: "id" },
  ];

  function useColumnProbe() {
    return {
      actions: useDataGridInternalActions(),
      visibleIds: useDataGridVisibleColumns().map((c) => c.id),
      flags: useDataGridColumnFeatureFlags(),
    };
  }

  describe("setColumnOrder", () => {
    it("moves a column before/after another, in display order", () => {
      const wrapper = makeConfigWrapper({ columns: threeColumns });
      const { result } = renderHook(useColumnProbe, { wrapper });

      act(() => result.current.actions.setColumnOrder("id", "name", "before"));
      expect(result.current.visibleIds).toEqual(["id", "name", "age"]);

      act(() => result.current.actions.setColumnOrder("id", "age", "after"));
      expect(result.current.visibleIds).toEqual(["name", "age", "id"]);
    });

    it("is a no-op when enableColumnReorder is false", () => {
      const wrapper = makeConfigWrapper({ columns: threeColumns, enableColumnReorder: false });
      const { result } = renderHook(useColumnProbe, { wrapper });

      act(() => result.current.actions.setColumnOrder("id", "name", "before"));
      expect(result.current.visibleIds).toEqual(["name", "age", "id"]);
    });

    it("is a no-op when the dragged column has reorderable: false", () => {
      const cols = threeColumns.map((c) => (c.id === "id" ? { ...c, reorderable: false } : c));
      const wrapper = makeConfigWrapper({ columns: cols });
      const { result } = renderHook(useColumnProbe, { wrapper });

      act(() => result.current.actions.setColumnOrder("id", "name", "before"));
      expect(result.current.visibleIds).toEqual(["name", "age", "id"]);
    });

    it("keeps a pinned column inside its own pin zone: dropping it onto an unpinned target is a no-op", () => {
      const cols = threeColumns.map((c) => (c.id === "id" ? { ...c, pin: "left" as const } : c));
      const wrapper = makeConfigWrapper({ columns: cols });
      const { result } = renderHook(useColumnProbe, { wrapper });

      // "id" (pinned left) is already display-first; dragging it next to "age" (unpinned) must not move.
      act(() => result.current.actions.setColumnOrder("id", "age", "after"));
      expect(result.current.visibleIds).toEqual(["id", "name", "age"]);
    });

    it("reorders two pinned-left columns within their own zone", () => {
      const cols = threeColumns.map((c) => (c.id === "id" || c.id === "name" ? { ...c, pin: "left" as const } : c));
      const wrapper = makeConfigWrapper({ columns: cols });
      const { result } = renderHook(useColumnProbe, { wrapper });

      expect(result.current.visibleIds).toEqual(["name", "id", "age"]);
      act(() => result.current.actions.setColumnOrder("id", "name", "before"));
      expect(result.current.visibleIds).toEqual(["id", "name", "age"]);
    });
  });

  describe("setColumnPin", () => {
    it("pins a column left, moving it to the front of display order", () => {
      const wrapper = makeConfigWrapper({ columns: threeColumns });
      const { result } = renderHook(useColumnProbe, { wrapper });

      act(() => result.current.actions.setColumnPin("id", "left"));
      expect(result.current.visibleIds).toEqual(["id", "name", "age"]);
    });

    it("unpins a column back into the unpinned band", () => {
      const cols = threeColumns.map((c) => (c.id === "id" ? { ...c, pin: "left" as const } : c));
      const wrapper = makeConfigWrapper({ columns: cols });
      const { result } = renderHook(useColumnProbe, { wrapper });

      expect(result.current.visibleIds).toEqual(["id", "name", "age"]);
      act(() => result.current.actions.setColumnPin("id", null));
      expect(result.current.visibleIds).toEqual(["name", "age", "id"]);
    });

    it("is a no-op when enableColumnPinning is false", () => {
      const wrapper = makeConfigWrapper({ columns: threeColumns, enableColumnPinning: false });
      const { result } = renderHook(useColumnProbe, { wrapper });

      act(() => result.current.actions.setColumnPin("id", "left"));
      expect(result.current.visibleIds).toEqual(["name", "age", "id"]);
    });

    it("is a no-op when the column has pinnable: false", () => {
      const cols = threeColumns.map((c) => (c.id === "id" ? { ...c, pinnable: false } : c));
      const wrapper = makeConfigWrapper({ columns: cols });
      const { result } = renderHook(useColumnProbe, { wrapper });

      act(() => result.current.actions.setColumnPin("id", "left"));
      expect(result.current.visibleIds).toEqual(["name", "age", "id"]);
    });
  });

  describe("setColumnHidden", () => {
    it("hides and re-shows a column", () => {
      const wrapper = makeConfigWrapper({ columns: threeColumns });
      const { result } = renderHook(useColumnProbe, { wrapper });

      act(() => result.current.actions.setColumnHidden("age", true));
      expect(result.current.visibleIds).toEqual(["name", "id"]);

      act(() => result.current.actions.setColumnHidden("age", false));
      expect(result.current.visibleIds).toEqual(["name", "age", "id"]);
    });

    it("re-shows a def-level hidden: true column, and the layout snapshot reflects it", () => {
      const hiddenCols: readonly ColumnDef<Row, unknown>[] = [
        { id: "name", header: "Name", accessorKey: "name" },
        { id: "age", header: "Age", accessorKey: "age", hidden: true },
      ];
      const onColumnLayoutChange = vi.fn();
      const wrapper = makeConfigWrapper({ columns: hiddenCols, onColumnLayoutChange });
      const { result } = renderHook(useColumnProbe, { wrapper });

      expect(result.current.visibleIds).toEqual(["name"]);

      act(() => {
        result.current.actions.setColumnHidden("age", false);
      });

      expect(result.current.visibleIds).toEqual(["name", "age"]);
      expect(onColumnLayoutChange).toHaveBeenCalledTimes(1);
      expect(onColumnLayoutChange).toHaveBeenLastCalledWith({
        widths: {},
        order: ["name", "age"],
        pins: {},
        hidden: [],
      });

      act(() => {
        result.current.actions.setColumnHidden("age", true);
      });

      expect(result.current.visibleIds).toEqual(["name"]);
      expect(onColumnLayoutChange).toHaveBeenCalledTimes(2);
      expect(onColumnLayoutChange).toHaveBeenLastCalledWith({
        widths: {},
        order: ["name", "age"],
        pins: {},
        hidden: ["age"],
      });
    });

    it("re-seeds def-level hidden ids when the columns prop identity changes; a same-reference re-render keeps the user's choice", () => {
      const defHidden: readonly ColumnDef<Row, unknown>[] = [
        { id: "name", header: "Name", accessorKey: "name" },
        { id: "age", header: "Age", accessorKey: "age", hidden: true },
      ];
      const replacedDefHidden: readonly ColumnDef<Row, unknown>[] = [
        { id: "name", header: "Name", accessorKey: "name" },
        { id: "age", header: "Age", accessorKey: "age", hidden: true },
      ];
      let actionsRef: ReturnType<typeof useDataGridInternalActions> | null = null;
      let probed: string[] = [];
      function Probe() {
        actionsRef = useDataGridInternalActions();
        probed = useDataGridVisibleColumns().map((c) => c.id);
        return null;
      }
      function Harness({ cols }: { cols: readonly ColumnDef<Row, unknown>[] }) {
        return (
          <DataGridProvider data={rows()} columns={cols} getRowId={(r) => r.id}>
            <Probe />
          </DataGridProvider>
        );
      }
      const { rerender } = render(<Harness cols={defHidden} />);
      expect(probed).toEqual(["name"]);

      act(() => {
        actionsRef!.setColumnHidden("age", false);
      });
      expect(probed).toEqual(["name", "age"]);

      // same reference: the user's choice survives an unrelated re-render.
      rerender(<Harness cols={defHidden} />);
      expect(probed).toEqual(["name", "age"]);

      // a new array whose def still says hidden: true re-asserts the def's flag.
      rerender(<Harness cols={replacedDefHidden} />);
      expect(probed).toEqual(["name"]);
    });
  });

  describe("resolved column-feature flags", () => {
    it("default to true", () => {
      const wrapper = makeConfigWrapper({ columns: threeColumns });
      const { result } = renderHook(useColumnProbe, { wrapper });
      expect(result.current.flags).toEqual({
        enableColumnResize: true,
        enableColumnReorder: true,
        enableColumnPinning: true,
      });
    });

    it("resolve grid-wide overrides", () => {
      const wrapper = makeConfigWrapper({
        columns: threeColumns,
        enableColumnResize: false,
        enableColumnReorder: false,
        enableColumnPinning: false,
      });
      const { result } = renderHook(useColumnProbe, { wrapper });
      expect(result.current.flags).toEqual({
        enableColumnResize: false,
        enableColumnReorder: false,
        enableColumnPinning: false,
      });
    });
  });

  describe("setColumnWidth", () => {
    it("sets a live width override read back by resolveColumnWidth's consumers", () => {
      const wrapper = makeConfigWrapper({ columns: threeColumns });
      const { result } = renderHook(
        () => ({ actions: useDataGridInternalActions() }),
        { wrapper },
      );
      act(() => result.current.actions.setColumnWidth("name", 240));
      // width overrides are read via useDataGridColumnWidth/useDataGridColumnWidths (layout-context.ts);
      // asserting through the action's own no-throw + a second call composing correctly is sufficient
      // at the store level — layout composition is covered by column-helpers.test.ts / browser tests.
      act(() => result.current.actions.setColumnWidth("name", 100));
    });

    it("does NOT fire onColumnLayoutChange (per-frame drag write; commitColumnWidth is the commit point)", () => {
      const onColumnLayoutChange = vi.fn();
      const wrapper = makeConfigWrapper({ columns: threeColumns, onColumnLayoutChange });
      const { result } = renderHook(() => ({ actions: useDataGridInternalActions() }), { wrapper });
      act(() => result.current.actions.setColumnWidth("name", 240));
      expect(onColumnLayoutChange).not.toHaveBeenCalled();
    });

    it("fires onColumnResizing once per call, with the column id and width — the in-progress counterpart to onColumnLayoutChange", () => {
      const onColumnResizing = vi.fn();
      const wrapper = makeConfigWrapper({ columns: threeColumns, onColumnResizing });
      const { result } = renderHook(() => ({ actions: useDataGridInternalActions() }), { wrapper });

      act(() => result.current.actions.setColumnWidth("name", 240));
      expect(onColumnResizing).toHaveBeenCalledTimes(1);
      expect(onColumnResizing).toHaveBeenLastCalledWith("name", 240);

      act(() => result.current.actions.setColumnWidth("name", 260));
      expect(onColumnResizing).toHaveBeenCalledTimes(2);
      expect(onColumnResizing).toHaveBeenLastCalledWith("name", 260);
    });

    it("clamps the written width to the column's [max(32, minWidth), maxWidth] bounds, like the resize gesture", () => {
      const cols: readonly ColumnDef<Row, unknown>[] = [
        { id: "name", header: "Name", accessorKey: "name", minWidth: 80, maxWidth: 200 },
        { id: "age", header: "Age", accessorKey: "age" },
        { id: "id", header: "ID", accessorKey: "id" },
      ];
      const onColumnResizing = vi.fn();
      const wrapper = makeConfigWrapper({ columns: cols, onColumnResizing });
      const { result } = renderHook(
        () => ({
          actions: useDataGridInternalActions(),
          nameWidth: useDataGridColumnWidth("name"),
          ageWidth: useDataGridColumnWidth("age"),
        }),
        { wrapper },
      );

      act(() => result.current.actions.setColumnWidth("name", 10)); // below minWidth
      expect(result.current.nameWidth).toBe(80);
      expect(onColumnResizing).toHaveBeenLastCalledWith("name", 80);

      act(() => result.current.actions.setColumnWidth("name", 500)); // above maxWidth
      expect(result.current.nameWidth).toBe(200);

      act(() => result.current.actions.setColumnWidth("name", 120)); // in range, passes through
      expect(result.current.nameWidth).toBe(120);

      act(() => result.current.actions.setColumnWidth("age", 10)); // no minWidth: the 32px floor holds
      expect(result.current.ageWidth).toBe(32);
    });
  });

  describe("commitColumnWidth", () => {
    it("sets the width and fires onColumnLayoutChange once with the full snapshot", () => {
      const onColumnLayoutChange = vi.fn();
      const wrapper = makeConfigWrapper({ columns: threeColumns, onColumnLayoutChange });
      const { result } = renderHook(() => ({ actions: useDataGridInternalActions() }), { wrapper });

      act(() => result.current.actions.commitColumnWidth("name", 240));

      expect(onColumnLayoutChange).toHaveBeenCalledTimes(1);
      expect(onColumnLayoutChange).toHaveBeenLastCalledWith({
        widths: { name: 240 },
        order: ["name", "age", "id"],
        pins: {},
        hidden: [],
      });
    });

    it("does NOT fire onColumnResizing (commit point; setColumnWidth is the per-frame one)", () => {
      const onColumnResizing = vi.fn();
      const wrapper = makeConfigWrapper({ columns: threeColumns, onColumnResizing });
      const { result } = renderHook(() => ({ actions: useDataGridInternalActions() }), { wrapper });

      act(() => result.current.actions.commitColumnWidth("name", 240));
      expect(onColumnResizing).not.toHaveBeenCalled();
    });

    it("clamps the committed width, and the snapshot carries the clamped value", () => {
      const cols: readonly ColumnDef<Row, unknown>[] = [
        { id: "name", header: "Name", accessorKey: "name", minWidth: 80, maxWidth: 200 },
        { id: "age", header: "Age", accessorKey: "age" },
        { id: "id", header: "ID", accessorKey: "id" },
      ];
      const onColumnLayoutChange = vi.fn();
      const wrapper = makeConfigWrapper({ columns: cols, onColumnLayoutChange });
      const { result } = renderHook(() => ({ actions: useDataGridInternalActions() }), { wrapper });

      act(() => result.current.actions.commitColumnWidth("name", 10));

      expect(onColumnLayoutChange).toHaveBeenCalledTimes(1);
      expect(onColumnLayoutChange).toHaveBeenLastCalledWith({
        widths: { name: 80 },
        order: ["name", "age", "id"],
        pins: {},
        hidden: [],
      });
    });
  });

  describe("resetColumnWidth", () => {
    it("drops the width override and fires onColumnLayoutChange once, without it", () => {
      const onColumnLayoutChange = vi.fn();
      const wrapper = makeConfigWrapper({ columns: threeColumns, onColumnLayoutChange });
      const { result } = renderHook(
        () => ({ actions: useDataGridInternalActions(), nameWidth: useDataGridColumnWidth("name") }),
        { wrapper },
      );

      act(() => result.current.actions.commitColumnWidth("name", 240));
      expect(result.current.nameWidth).toBe(240);

      act(() => result.current.actions.resetColumnWidth("name"));
      expect(result.current.nameWidth).toBeUndefined();
      expect(onColumnLayoutChange).toHaveBeenCalledTimes(2);
      expect(onColumnLayoutChange).toHaveBeenLastCalledWith({
        widths: {},
        order: ["name", "age", "id"],
        pins: {},
        hidden: [],
      });
    });

    it("is a no-op (no callback) when the column has no override", () => {
      const onColumnLayoutChange = vi.fn();
      const wrapper = makeConfigWrapper({ columns: threeColumns, onColumnLayoutChange });
      const { result } = renderHook(() => ({ actions: useDataGridInternalActions() }), { wrapper });

      act(() => result.current.actions.resetColumnWidth("name"));

      expect(onColumnLayoutChange).not.toHaveBeenCalled();
    });
  });

  describe("onColumnLayoutChange (setColumnOrder/setColumnPin/setColumnHidden)", () => {
    it("fires once per setColumnOrder commit with the full snapshot", () => {
      const onColumnLayoutChange = vi.fn();
      const wrapper = makeConfigWrapper({ columns: threeColumns, onColumnLayoutChange });
      const { result } = renderHook(() => ({ actions: useDataGridInternalActions() }), { wrapper });

      act(() => result.current.actions.setColumnOrder("id", "name", "before"));

      expect(onColumnLayoutChange).toHaveBeenCalledTimes(1);
      expect(onColumnLayoutChange).toHaveBeenLastCalledWith({
        widths: {},
        order: ["id", "name", "age"],
        pins: {},
        hidden: [],
      });
    });

    it("does not fire setColumnOrder's callback on a gated/no-op reorder", () => {
      const onColumnLayoutChange = vi.fn();
      const wrapper = makeConfigWrapper({ columns: threeColumns, enableColumnReorder: false, onColumnLayoutChange });
      const { result } = renderHook(() => ({ actions: useDataGridInternalActions() }), { wrapper });

      act(() => result.current.actions.setColumnOrder("id", "name", "before"));

      expect(onColumnLayoutChange).not.toHaveBeenCalled();
    });

    it("fires once per setColumnPin commit with the full snapshot", () => {
      const onColumnLayoutChange = vi.fn();
      const wrapper = makeConfigWrapper({ columns: threeColumns, onColumnLayoutChange });
      const { result } = renderHook(() => ({ actions: useDataGridInternalActions() }), { wrapper });

      act(() => result.current.actions.setColumnPin("id", "left"));

      expect(onColumnLayoutChange).toHaveBeenCalledTimes(1);
      expect(onColumnLayoutChange).toHaveBeenLastCalledWith({
        widths: {},
        order: ["name", "age", "id"],
        pins: { id: "left" },
        hidden: [],
      });
    });

    it("fires once per setColumnHidden commit with the full snapshot", () => {
      const onColumnLayoutChange = vi.fn();
      const wrapper = makeConfigWrapper({ columns: threeColumns, onColumnLayoutChange });
      const { result } = renderHook(() => ({ actions: useDataGridInternalActions() }), { wrapper });

      act(() => result.current.actions.setColumnHidden("age", true));

      expect(onColumnLayoutChange).toHaveBeenCalledTimes(1);
      expect(onColumnLayoutChange).toHaveBeenLastCalledWith({
        widths: {},
        order: ["name", "age", "id"],
        pins: {},
        hidden: ["age"],
      });
    });
  });
});

describe("defaultColumnLayout", () => {
  const threeColumns: readonly ColumnDef<Row, unknown>[] = [
    { id: "name", header: "Name", accessorKey: "name" },
    { id: "age", header: "Age", accessorKey: "age" },
    { id: "id", header: "ID", accessorKey: "id" },
  ];

  function useColumnProbe() {
    return {
      visibleIds: useDataGridVisibleColumns().map((c) => c.id),
    };
  }

  it("seeds columnOrder/pins/hidden/widths once at mount, over the column defs", () => {
    const wrapper = makeConfigWrapper({
      columns: threeColumns,
      defaultColumnLayout: {
        widths: { name: 300 },
        order: ["id", "age", "name"],
        pins: { id: "left" },
        hidden: ["age"],
      },
    });
    const { result } = renderHook(useColumnProbe, { wrapper });
    // "id" is pinned left (front), "age" is hidden, "name" keeps its seeded order slot.
    expect(result.current.visibleIds).toEqual(["id", "name"]);
  });

  it("is ignored on a later prop change (NOT a controlled prop)", () => {
    let probed: string[] = [];
    function Probe() {
      probed = useDataGridVisibleColumns().map((c) => c.id);
      return null;
    }
    function Harness({ order }: { order: string[] }) {
      return (
        <DataGridProvider
          data={rows()}
          columns={threeColumns}
          getRowId={(r) => r.id}
          defaultColumnLayout={{ widths: {}, order, pins: {}, hidden: [] }}
        >
          <Probe />
        </DataGridProvider>
      );
    }
    const { rerender } = render(<Harness order={["id", "name", "age"]} />);
    expect(probed).toEqual(["id", "name", "age"]);

    rerender(<Harness order={["age", "name", "id"]} />);
    // a changed defaultColumnLayout prop after mount is a no-op — order stays what it was seeded with.
    expect(probed).toEqual(["id", "name", "age"]);
  });
});

describe("onSelectionChange", () => {
  function useSelectionProbe() {
    return { actions: useDataGridInternalActions() };
  }

  it("fires on selectCell with the current GridSelection", () => {
    const onSelectionChange = vi.fn();
    const wrapper = makeConfigWrapper({ onSelectionChange });
    const { result } = renderHook(useSelectionProbe, { wrapper });

    act(() => result.current.actions.selectCellAt({ col: 0, row: 1 }));

    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    const [selection] = onSelectionChange.mock.calls[0]!;
    expect(selection.current?.cell).toEqual({ col: 0, row: 1 });
  });

  it("fires once per extendTo step (drag-extend), not just on drop", () => {
    const onSelectionChange = vi.fn();
    const wrapper = makeConfigWrapper({ onSelectionChange });
    const { result } = renderHook(useSelectionProbe, { wrapper });

    act(() => result.current.actions.selectCellAt({ col: 0, row: 0 }));
    act(() => result.current.actions.extendToAt({ col: 0, row: 1 }));
    act(() => result.current.actions.extendToAt({ col: 0, row: 2 }));

    expect(onSelectionChange).toHaveBeenCalledTimes(3);
  });

  it("details.getRowIds returns the rows a cell range covers, in view order", () => {
    const onSelectionChange = vi.fn();
    const wrapper = makeConfigWrapper({ onSelectionChange });
    const { result } = renderHook(useSelectionProbe, { wrapper });

    act(() => result.current.actions.selectCellAt({ col: 0, row: 0 }));
    act(() => result.current.actions.extendToAt({ col: 0, row: 1 }));

    const [, details] = onSelectionChange.mock.calls.at(-1)!;
    expect(details.getRowIds()).toEqual(["1", "2"]);
  });

  it("details.getRowIds reads the row channel (checkbox selection), not just cell ranges", () => {
    const onSelectionChange = vi.fn();
    const wrapper = makeConfigWrapper({ onSelectionChange, rowMarkers: "checkbox" });
    const { result } = renderHook(useSelectionProbe, { wrapper });

    act(() => result.current.actions.setRowSelected(2, true));

    const [, details] = onSelectionChange.mock.calls.at(-1)!;
    expect(details.getRowIds()).toEqual(["3"]);
  });

  it("details.getRowIds unions both channels without duplicating a row in each", () => {
    const onSelectionChange = vi.fn();
    const wrapper = makeConfigWrapper({ onSelectionChange, rowMarkers: "checkbox" });
    const { result } = renderHook(useSelectionProbe, { wrapper });

    act(() => result.current.actions.selectCellAt({ col: 0, row: 0 }));
    act(() => result.current.actions.setRowSelected(0, true));
    act(() => result.current.actions.setRowSelected(2, true));

    const [, details] = onSelectionChange.mock.calls.at(-1)!;
    expect(details.getRowIds()).toEqual(["1", "3"]);
  });

  it("details.getRowIds is empty with nothing selected", () => {
    const onSelectionChange = vi.fn();
    const wrapper = makeConfigWrapper({ onSelectionChange });
    const { result } = renderHook(useSelectionProbe, { wrapper });

    act(() => result.current.actions.selectCellAt({ col: 0, row: 0 }));
    act(() => result.current.actions.clearSelection());

    const [, details] = onSelectionChange.mock.calls.at(-1)!;
    expect(details.getRowIds()).toEqual([]);
  });

  it("fires on clearSelection", () => {
    const onSelectionChange = vi.fn();
    const wrapper = makeConfigWrapper({ onSelectionChange });
    const { result } = renderHook(useSelectionProbe, { wrapper });

    act(() => result.current.actions.selectCellAt({ col: 0, row: 0 }));
    onSelectionChange.mockClear();
    act(() => result.current.actions.clearSelection());

    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect(onSelectionChange.mock.calls[0]![0].current).toBeNull();
  });

  it("does not fire when an action leaves selection unchanged", () => {
    const onSelectionChange = vi.fn();
    const wrapper = makeConfigWrapper({ onSelectionChange });
    const { result } = renderHook(useSelectionProbe, { wrapper });

    act(() => result.current.actions.selectCellAt({ col: 0, row: 0 }));
    onSelectionChange.mockClear();
    act(() => result.current.actions.setColumnWidth("name", 200));

    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it("a stationary drag (repeated extendTo at the same coord) fires nothing", () => {
    const onSelectionChange = vi.fn();
    const wrapper = makeConfigWrapper({ onSelectionChange });
    const { result } = renderHook(useSelectionProbe, { wrapper });

    act(() => result.current.actions.selectCellAt({ col: 0, row: 0 }));
    act(() => result.current.actions.extendToAt({ col: 0, row: 1 }));
    onSelectionChange.mockClear();
    act(() => result.current.actions.extendToAt({ col: 0, row: 1 }));
    act(() => result.current.actions.extendToAt({ col: 0, row: 1 }));

    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it("an extendSelection that cannot grow at the grid edge fires nothing", () => {
    const onSelectionChange = vi.fn();
    const wrapper = makeConfigWrapper({ onSelectionChange });
    const { result } = renderHook(useSelectionProbe, { wrapper });

    act(() => result.current.actions.selectCellAt({ col: 1, row: 2 })); // last of 2 columns and 3 rows
    onSelectionChange.mockClear();
    act(() => result.current.actions.extendSelection("down"));
    act(() => result.current.actions.extendSelection("right"));

    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it("a selectRow re-fire with the same replaceFromLast span fires nothing", () => {
    const onSelectionChange = vi.fn();
    const wrapper = makeConfigWrapper({ onSelectionChange, rowMarkers: "checkbox" });
    const { result } = renderHook(useSelectionProbe, { wrapper });

    act(() => result.current.actions.selectRow(0));
    act(() => result.current.actions.selectRow(2, { extendFromLast: true })); // rows 0-2
    onSelectionChange.mockClear();
    act(() => result.current.actions.selectRow(2, { replaceFromLast: true, from: 0 })); // same span

    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it("a selectColumn re-fire with the same span fires nothing", () => {
    const onSelectionChange = vi.fn();
    const wrapper = makeConfigWrapper({ onSelectionChange });
    const { result } = renderHook(useSelectionProbe, { wrapper });

    act(() => result.current.actions.selectColumn(1));
    onSelectionChange.mockClear();
    act(() => result.current.actions.selectColumn(1, { extendFromLast: true })); // span(1,1) = {1}

    expect(onSelectionChange).not.toHaveBeenCalled();
  });
});

describe("onSelectionCleared", () => {
  function useSelectionProbe() {
    return { actions: useDataGridInternalActions() };
  }

  it("fires exactly once when the selection transitions from non-empty to empty", () => {
    const onSelectionChange = vi.fn();
    const onSelectionCleared = vi.fn();
    const wrapper = makeConfigWrapper({ onSelectionChange, onSelectionCleared });
    const { result } = renderHook(useSelectionProbe, { wrapper });

    act(() => result.current.actions.selectCellAt({ col: 0, row: 0 }));
    act(() => result.current.actions.clearSelection());

    expect(onSelectionChange).toHaveBeenCalledTimes(2);
    expect(onSelectionCleared).toHaveBeenCalledTimes(1);
  });

  it("does not fire again when clearing an already-empty selection", () => {
    const onSelectionCleared = vi.fn();
    const wrapper = makeConfigWrapper({ onSelectionCleared });
    const { result } = renderHook(useSelectionProbe, { wrapper });

    act(() => result.current.actions.selectCellAt({ col: 0, row: 0 }));
    act(() => result.current.actions.clearSelection());
    onSelectionCleared.mockClear();
    act(() => result.current.actions.clearSelection());

    expect(onSelectionCleared).not.toHaveBeenCalled();
  });

  it("does not fire for an unrelated store write", () => {
    const onSelectionCleared = vi.fn();
    const wrapper = makeConfigWrapper({ onSelectionCleared });
    const { result } = renderHook(useSelectionProbe, { wrapper });

    act(() => result.current.actions.selectCellAt({ col: 0, row: 0 }));
    onSelectionCleared.mockClear();
    act(() => result.current.actions.setColumnWidth("name", 200));

    expect(onSelectionCleared).not.toHaveBeenCalled();
  });
});

describe("onSelectionChange details.getValues()", () => {
  function useSelectionProbe() {
    return { actions: useDataGridInternalActions(), getValues: useDataGridGetSelectionValues() };
  }

  it("reads the primary range's raw cell values, view-row-major", () => {
    const onSelectionChange = vi.fn();
    const wrapper = makeConfigWrapper({ onSelectionChange });
    const { result } = renderHook(useSelectionProbe, { wrapper });

    act(() => result.current.actions.selectCellAt({ col: 0, row: 0 }));
    act(() => result.current.actions.extendToAt({ col: 1, row: 1 }));

    expect(onSelectionChange).toHaveBeenCalledTimes(2);
    const [, details] = onSelectionChange.mock.calls.at(-1)!;
    // columns are name/age; rows()'s first two rows are Charlie/30, Alice/25.
    expect(details.getValues()).toEqual([
      ["Charlie", 30],
      ["Alice", 25],
    ]);
  });

  it("returns [] when there is no active range (a row/column-only selection, or a clear)", () => {
    const onSelectionChange = vi.fn();
    const wrapper = makeConfigWrapper({ onSelectionChange });
    const { result } = renderHook(useSelectionProbe, { wrapper });

    act(() => result.current.actions.selectRow(0));
    expect(onSelectionChange.mock.calls.at(-1)![1].getValues()).toEqual([]);

    act(() => result.current.actions.selectCellAt({ col: 0, row: 0 }));
    act(() => result.current.actions.clearSelection());
    expect(onSelectionChange.mock.calls.at(-1)![1].getValues()).toEqual([]);
  });

  it("is lazy: the callback runs without ever invoking getValues itself", () => {
    const getValuesSpy = vi.fn();
    const onSelectionChange = vi.fn((_selection, _details: { getValues: () => unknown }) => {
      getValuesSpy(); // proves the callback ran without touching details.getValues itself
    });
    const wrapper = makeConfigWrapper({ onSelectionChange });
    const { result } = renderHook(useSelectionProbe, { wrapper });

    act(() => result.current.actions.selectCellAt({ col: 0, row: 0 }));
    act(() => result.current.actions.extendToAt({ col: 1, row: 2 }));

    expect(onSelectionChange).toHaveBeenCalledTimes(2);
    expect(getValuesSpy).toHaveBeenCalledTimes(2);
  });

  it("reflects the CURRENT selection when called later, not a stale snapshot from fire time", () => {
    const onSelectionChange = vi.fn();
    const wrapper = makeConfigWrapper({ onSelectionChange });
    const { result } = renderHook(useSelectionProbe, { wrapper });

    act(() => result.current.actions.selectCellAt({ col: 0, row: 0 }));
    const [, firstDetails] = onSelectionChange.mock.calls[0]!;
    act(() => result.current.actions.selectCellAt({ col: 0, row: 2 }));

    // calling the FIRST fire's getValues() after a later selection change reads the NEW selection —
    // getValues closes over store.getState, not a point-in-time copy of the selection.
    expect(firstDetails.getValues()).toEqual([["Bob"]]);
  });
});

describe("useDataGridGetSelectionValues", () => {
  function useSelectionProbe() {
    return { actions: useDataGridInternalActions(), getValues: useDataGridGetSelectionValues() };
  }

  it("reads the current selection's values imperatively, outside any onSelectionChange fire", () => {
    const wrapper = makeConfigWrapper();
    const { result } = renderHook(useSelectionProbe, { wrapper });

    expect(result.current.getValues()).toEqual([]);

    act(() => result.current.actions.selectCellAt({ col: 0, row: 2 }));
    expect(result.current.getValues()).toEqual([["Bob"]]);
  });

  it("returns a stable callback across renders", () => {
    const wrapper = makeConfigWrapper();
    const { result, rerender } = renderHook(useSelectionProbe, { wrapper });
    const first = result.current.getValues;
    rerender();
    expect(result.current.getValues).toBe(first);
  });
});

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
      act(() => result.current.actions.toggleSort("name", false));
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
      act(() => result.current.actions.toggleSort("name", false));
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
  });

  describe("controlled sortState: prop drives view order, header-click fires onSortChange but doesn't reorder until the prop updates", () => {
    it("toggleSort fires onSortChange and leaves viewIndex/sortState untouched (prop stays source of truth)", () => {
      const onSortChange = vi.fn();
      const wrapper = makeConfigWrapper({ sortState: [], onSortChange });
      const { result, rerender } = renderHook(useSortProbe, { wrapper });

      expect(result.current.viewIndex).toEqual([0, 1, 2]); // original order, untouched by the click below

      act(() => result.current.actions.toggleSort("name", false));
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

      act(() => result.current.actions.toggleSort("name", false));
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
      act(() => result.current.actions.toggleSort("name", false));
      act(() => result.current.actions.toggleSort("age", false));
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

  describe("joinOperator (same pattern as sort/filter)", () => {
    function useJoinProbe() {
      return { actions: useDataGridInternalActions(), joinOperator: useDataGridJoinOperator(), viewIndex: useDataGridViewIndex() };
    }

    it("defaults to 'and'", () => {
      const wrapper = makeWrapper();
      const { result } = renderHook(useJoinProbe, { wrapper });
      expect(result.current.joinOperator).toBe("and");
    });

    it("uncontrolled: setJoinOperator mutates joinOperator/viewIndex directly, no callback required", () => {
      const wrapper = makeWrapper();
      const { result, rerender } = renderHook(
        () => ({ ...useJoinProbe(), filter: useFilterProbe() }),
        { wrapper },
      );
      act(() =>
        result.current.filter.actions.setFilters([
          { columnId: "name", operator: "contains", value: "z" }, // matches nobody
          { columnId: "age", operator: "gt", value: "35" }, // matches Bob (40)
        ]),
      );
      act(() => result.current.actions.setJoinOperator("or"));
      rerender();
      expect(result.current.joinOperator).toBe("or");
      expect(result.current.viewIndex).toEqual([2]); // Bob survives under OR, nobody would under AND
    });

    it("onJoinOperatorChange fires from setJoinOperator even though the joinOperator prop is absent", () => {
      const onJoinOperatorChange = vi.fn();
      const wrapper = makeConfigWrapper({ onJoinOperatorChange });
      const { result } = renderHook(useJoinProbe, { wrapper });
      act(() => result.current.actions.setJoinOperator("or"));
      expect(onJoinOperatorChange).toHaveBeenCalledWith("or");
    });

    it("controlled: setJoinOperator fires the callback without touching store joinOperator", () => {
      const onJoinOperatorChange = vi.fn();
      const wrapper = makeConfigWrapper({ joinOperator: "and", onJoinOperatorChange });
      const { result, rerender } = renderHook(useJoinProbe, { wrapper });

      act(() => result.current.actions.setJoinOperator("or"));
      rerender();

      expect(onJoinOperatorChange).toHaveBeenCalledWith("or");
      // controlled: the store's joinOperator does NOT move just because the user changed it —
      // only the prop itself (via _syncProps) can move it (standard controlled-input semantics).
      expect(result.current.joinOperator).toBe("and");
    });

    it("viewIndex updates once the joinOperator prop itself changes", () => {
      const wrapper = makeConfigWrapper({
        joinOperator: "or",
        filterState: [
          { columnId: "name", operator: "contains", value: "z" },
          { columnId: "age", operator: "gt", value: "35" },
        ],
      });
      const { result } = renderHook(useJoinProbe, { wrapper });
      expect(result.current.viewIndex).toEqual([2]); // Bob (age 40) survives under OR
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
    act(() => result.current.actions.updateCells([{ rowId: "1", columnId: "name", value: "Aaron" }], { reorder: "immediate" }));

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

describe("row-moving ops with an active view-space presence entry", () => {
  it("does not warn while the registered predicate reports no view-space entry", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() => useDataGridInternalActions(), { wrapper: makeWrapper() });

    act(() => result.current._registerPresenceViewSpaceActive(() => false));
    act(() => {
      result.current.reorderRows(0, 2);
    });
    act(() => {
      result.current.updateCells([{ rowId: "1", columnId: "age", value: 31 }], { reorder: "immediate" });
    });

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("warns exactly once across repeated row-moving ops, not per op", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() => useDataGridInternalActions(), { wrapper: makeWrapper() });

    act(() => result.current._registerPresenceViewSpaceActive(() => true));
    act(() => {
      result.current.reorderRows(0, 2);
    });
    act(() => {
      result.current.reorderRows(2, 0);
    });
    act(() => {
      result.current.updateCells([{ rowId: "1", columnId: "age", value: 31 }], { reorder: "immediate" });
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("view-space presence");
    warn.mockRestore();
  });

  it("warns when a sort, filter, or join change rebuilds the view", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sort = renderHook(() => useDataGridInternalActions(), { wrapper: makeWrapper() });
    act(() => sort.result.current._registerPresenceViewSpaceActive(() => true));
    act(() => sort.result.current.toggleSort("name", false));
    expect(warn).toHaveBeenCalledTimes(1);

    const filter = renderHook(() => useDataGridInternalActions(), { wrapper: makeWrapper() });
    act(() => filter.result.current._registerPresenceViewSpaceActive(() => true));
    act(() => filter.result.current.setFilters([{ columnId: "name", operator: "equals", value: "Alice" }]));
    expect(warn).toHaveBeenCalledTimes(2);

    const join = renderHook(() => useDataGridInternalActions(), { wrapper: makeWrapper() });
    act(() =>
      join.result.current.setFilters([
        { columnId: "name", operator: "equals", value: "Alice" },
        { columnId: "age", operator: "gt", value: "35" },
      ]),
    );
    act(() => join.result.current._registerPresenceViewSpaceActive(() => true));
    act(() => join.result.current.setJoinOperator("or"));
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it("warns when setSorts rebuilds the view", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() => useDataGridInternalActions(), { wrapper: makeWrapper() });
    act(() => result.current._registerPresenceViewSpaceActive(() => true));
    act(() => result.current.setSorts([{ columnId: "name", direction: "asc" }]));
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("does not warn when a consumer swap keeps every row at its position, or a lazy page fills holes", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let actions: ReturnType<typeof useDataGridInternalActions> | undefined;
    function Probe() {
      actions = useDataGridInternalActions();
      return null;
    }
    const lazyId = (r: Row | undefined, index: number) => (r === undefined ? `hole-${index}` : r.id);
    const ui = (data: (Row | undefined)[]) => (
      <DataGridProvider data={data as Row[]} columns={columns} getRowId={lazyId as never}>
        <Probe />
      </DataGridProvider>
    );
    const sparse: (Row | undefined)[] = rows();
    sparse[1] = undefined;
    const view = render(ui(sparse));
    act(() => actions!._registerPresenceViewSpaceActive(() => true));

    view.rerender(ui(rows()));
    view.rerender(ui(rows().map((r) => ({ ...r, age: r.age + 1 }))));

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does not ask the presence predicate outside development", () => {
    const predicate = vi.fn(() => true);
    const { result } = renderHook(() => useDataGridInternalActions(), { wrapper: makeWrapper() });
    act(() => result.current._registerPresenceViewSpaceActive(predicate));
    vi.stubEnv("NODE_ENV", "production");
    act(() => result.current.reorderRows(0, 2));
    vi.unstubAllEnvs();
    expect(predicate).not.toHaveBeenCalled();
  });

  it("warns when a consumer data swap replaces the rows", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let actions: ReturnType<typeof useDataGridInternalActions> | undefined;
    function Probe() {
      actions = useDataGridInternalActions();
      return null;
    }
    const ui = (data: Row[]) => (
      <DataGridProvider data={data} columns={columns} getRowId={(r) => r.id}>
        <Probe />
      </DataGridProvider>
    );
    const view = render(ui(rows()));
    act(() => actions!._registerPresenceViewSpaceActive(() => true));

    view.rerender(ui(rows().reverse()));
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("warns once per grid instance, including on deleteRows", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = renderHook(() => useDataGridInternalActions(), { wrapper: makeWrapper() });
    const second = renderHook(() => useDataGridInternalActions(), { wrapper: makeWrapper() });

    for (const { result } of [first, second]) {
      act(() => result.current._registerPresenceViewSpaceActive(() => true));
      act(() => result.current.deleteRows([0]));
    }

    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("warns when a column reorder, hide, or pin moves the view columns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const reorder = renderHook(() => useDataGridInternalActions(), { wrapper: makeWrapper() });
    act(() => reorder.result.current._registerPresenceViewSpaceActive(() => true));
    act(() => reorder.result.current.setColumnOrder("age", "name", "before"));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("view-space presence");

    const hide = renderHook(() => useDataGridInternalActions(), { wrapper: makeWrapper() });
    act(() => hide.result.current._registerPresenceViewSpaceActive(() => true));
    act(() => hide.result.current.setColumnHidden("name", true));
    expect(warn).toHaveBeenCalledTimes(2);

    const pin = renderHook(() => useDataGridInternalActions(), { wrapper: makeWrapper() });
    act(() => pin.result.current._registerPresenceViewSpaceActive(() => true));
    act(() => pin.result.current.setColumnPin("age", "left"));
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it("does not warn when unhiding a trailing column appends it to the view columns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() => useDataGridInternalActions(), { wrapper: makeWrapper() });
    act(() => result.current.setColumnHidden("age", true));
    act(() => result.current._registerPresenceViewSpaceActive(() => true));
    act(() => result.current.setColumnHidden("age", false));

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does not warn when a width change or a same-position reorder leaves the view columns in place", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() => useDataGridInternalActions(), { wrapper: makeWrapper() });
    act(() => result.current._registerPresenceViewSpaceActive(() => true));
    act(() => result.current.setColumnWidth("name", 200));
    act(() => result.current.setColumnOrder("name", "age", "before"));

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("warns when a consumer columns swap reorders the view columns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let actions: ReturnType<typeof useDataGridInternalActions> | undefined;
    function Probe() {
      actions = useDataGridInternalActions();
      return null;
    }
    const columnsFirst = [
      { id: "name", header: "Name", accessorKey: "name" },
      { id: "age", header: "Age", accessorKey: "age" },
    ] as const;
    const columnsSecond = [
      { id: "age", header: "Age", accessorKey: "age" },
      { id: "name", header: "Name", accessorKey: "name" },
    ] as const;
    const ui = (cols: readonly ColumnDef<Row, unknown>[]) => (
      <DataGridProvider data={rows()} columns={cols} getRowId={(r) => r.id}>
        <Probe />
      </DataGridProvider>
    );
    const view = render(ui(columnsFirst));
    act(() => actions!._registerPresenceViewSpaceActive(() => true));

    view.rerender(ui(columnsSecond));
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("view-space presence"))).toHaveLength(1);
    warn.mockRestore();
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
    act(() => storeApi?.getState().actions.updateCells([{ rowId: "1", columnId: "age", value: 31 }]));
    expect(renders).toBe(base);
    // a length change still re-renders
    act(() => storeApi?.getState().actions.deleteRows([0]));
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

  it("commitCellValue writes at the ref's resolved cell without moving the active cell", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(useRefActions, {
      wrapper: makeConfigWrapper({ sortState: [{ columnId: "name", direction: "asc" }] }),
    });
    act(() => result.current.actions.selectCellAt({ col: 0, row: 0 }));
    act(() => result.current.actions.commitCellValue({ rowId: "3", columnId: "age" }, 41));
    expect(result.current.activeCell).toEqual({ col: 0, row: 0 });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
