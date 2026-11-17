import { act, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { memo, type ReactNode } from "react";
import type { ColumnDef, DataChange } from "../types";
import { DataGridProvider, useDataGridInternalActions, useDataGridActiveCell, useDataGridIsRowSelected, useDataGridRow, useDataGridRowCellState, useDataGridRowIdToViewRow, useDataGridSearchMatches, useDataGridSelection, useDataGridSortState, useDataGridViewIndex, useDataGridVisibleColumns } from "../store";
import { viewIndexes } from "@/registry/default/blocks/data-grid/types";
import { type Row, columns, rows, makeWrapper, makeConfigWrapper } from "./store-setup.test-helper";

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
      a.result.current.actions.toggleSort("name");
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
      result.current.actions.toggleSort("name");
    });
    rerender();

    expect(result.current.sortState).toEqual([{ columnId: "name", direction: "asc" }]);
    expect(result.current.viewIndex).toEqual([1, 2, 0]);

    act(() => {
      result.current.actions.toggleSort("name");
    });
    rerender();

    expect(result.current.sortState).toEqual([{ columnId: "name", direction: "desc" }]);
    expect(result.current.viewIndex).toEqual([0, 2, 1]);

    act(() => {
      result.current.actions.toggleSort("name");
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
    let captured: readonly number[] | null = null;

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
    it("maps a duplicate row id to the first row that carries it", () => {
      const duplicated = [...rows(), { ...rows()[0]!, name: "Copy" }];
      let seen: ReadonlyMap<string, number> | undefined;

      function Probe() {
        seen = useDataGridRowIdToViewRow();
        return null;
      }

      render(<Probe />, { wrapper: makeWrapper(duplicated) });
      expect(seen?.get(duplicated[0]!.id)).toBe(0);
    });

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
            <button onClick={() => actions.toggleSort("name")}>sort</button>
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
        result.current.actions.toggleSort("name");
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
            <button onClick={() => actions.deleteRowsAt(viewIndexes([0]))}>delete</button>
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
      result.current.actions.toggleSort("name");
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

  it("recomputes searchMatches (not viewIndex) when a matching column becomes hidden", () => {
    const cols: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name" },
      { id: "age", header: "Age", accessorKey: "age" },
    ];
    function Harness() {
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
          <button onClick={() => actions.setColumnHidden("age", true)}>hide-age</button>
        </div>
      );
    }

    render(<Harness />);
    act(() => {
      screen.getByText("search-40").click();
    });
    // "40" matches the visible "age" column's value at row 2; viewIndex is untouched either way.
    expect(screen.getByTestId("vi").textContent).toBe("0,1,2");
    expect(screen.getByTestId("matches").textContent).toBe("2:age");

    // hiding "age" removes it from quick-search's column set — the match disappears, viewIndex doesn't change.
    act(() => {
      screen.getByText("hide-age").click();
    });
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
      result.current.actions.toggleSort("name", { additive: true });
    });
    rerender();
    act(() => {
      result.current.actions.toggleSort("age", { additive: true });
    });
    rerender();
    expect(result.current.sortState).toEqual([
      { columnId: "name", direction: "asc" },
      { columnId: "age", direction: "asc" },
    ]);

    act(() => {
      result.current.actions.toggleSort("name", { additive: true });
    });
    rerender();

    expect(result.current.sortState).toEqual([
      { columnId: "name", direction: "desc" },
      { columnId: "age", direction: "asc" },
    ]);
  });
});
