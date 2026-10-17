import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { AnyCellType, ColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import {
  DataGridProvider,
  numberCellType,
  useDataGridActions,
} from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridStatusBar, useDataGridSelectionStats } from "./data-grid-status-bar";
import { EMPTY_SELECTION_STATS } from "./compute-selection-stats";

type Row = { id: string; name: string; a: number; b: number };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name", type: "text" },
  { id: "a", header: "A", accessorKey: "a", type: "number" },
  { id: "b", header: "B", accessorKey: "b", type: "number" },
];

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({ id: String(i), name: `R${i}`, a: i, b: i * 2 }));
}

function Provider({ rowCount, children }: { rowCount: number; children: ReactNode }) {
  return (
    <DataGridProvider data={makeRows(rowCount)} columns={columns} getRowId={(r) => r.id}>
      {children}
    </DataGridProvider>
  );
}

function makeWrapper(rowCount: number) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DataGridProvider data={makeRows(rowCount)} columns={columns} getRowId={(r) => r.id}>
        {children}
      </DataGridProvider>
    );
  };
}

function useProbe() {
  return { stats: useDataGridSelectionStats(), actions: useDataGridActions() };
}

let barActions: ReturnType<typeof useDataGridActions> | null = null;
function BarProbe() {
  barActions = useDataGridActions();
  return null;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  barActions = null;
});

describe("useDataGridSelectionStats", () => {
  it("reports the empty baseline while nothing is selected", () => {
    const { result } = renderHook(useProbe, { wrapper: makeWrapper(6) });
    expect(result.current.stats).toEqual(EMPTY_SELECTION_STATS);
  });

  it("computes a small range at once", () => {
    const { result } = renderHook(useProbe, { wrapper: makeWrapper(6) });

    act(() => {
      result.current.actions.selectCellAt({ row: 0, col: 0 });
      result.current.actions.extendToAt({ row: 1, col: 1 });
    });

    // rows 0-1, cols name+a: "R0", 0, "R1", 1
    expect(result.current.stats).toEqual({
      cells: 4,
      count: 4,
      numeric: 2,
      sum: 1,
      avg: 0.5,
      min: 0,
      max: 1,
      numericColumnId: "a",
      approximate: false,
    });
  });

  it("a single cell computes at once and reports one cell", () => {
    const { result } = renderHook(useProbe, { wrapper: makeWrapper(6) });

    act(() => {
      result.current.actions.selectCellAt({ row: 2, col: 1 });
    });

    expect(result.current.stats.cells).toBe(1);
    expect(result.current.stats.sum).toBe(2);
  });

  it("keeps the last stats while the selection identity does not change (W3-04 stationary bail-out)", () => {
    const { result } = renderHook(useProbe, { wrapper: makeWrapper(6) });

    act(() => {
      result.current.actions.selectCellAt({ row: 0, col: 0 });
      result.current.actions.extendToAt({ row: 1, col: 1 });
    });
    const before = result.current.stats;
    expect(before.cells).toBe(4);

    // the same corner again: extendTo returns the same selection object, so no recompute
    act(() => {
      result.current.actions.extendToAt({ row: 1, col: 1 });
    });
    expect(result.current.stats).toBe(before);
  });

  it("computes a large selection once, on the trailing settle timer", () => {
    // 100x100 of ones: 10,000 cells > IMMEDIATE_SELECTION_CELL_LIMIT, below the cap
    type WideRow = { id: string } & { [key: string]: number | string };
    const wideColumns: readonly ColumnDef<WideRow, unknown>[] = Array.from({ length: 100 }, (_, i) => ({
      id: `c${i}`,
      header: `C${i}`,
      accessorKey: `c${i}`,
      type: "number",
    }));
    const wideRows: WideRow[] = Array.from({ length: 100 }, (_, i) => {
      const row: WideRow = { id: `w${i}` };
      for (let c = 0; c < 100; c++) row[`c${c}`] = 1;
      return row;
    });

    function WideProvider({ children }: { children: ReactNode }) {
      return (
        <DataGridProvider data={wideRows} columns={wideColumns} getRowId={(r) => r.id}>
          {children}
        </DataGridProvider>
      );
    }
    const { result } = renderHook(useProbe, { wrapper: WideProvider });

    vi.useFakeTimers();
    act(() => {
      result.current.actions.selectCellAt({ row: 0, col: 0 });
    });
    expect(result.current.stats.cells).toBe(1);

    act(() => {
      result.current.actions.extendToAt({ row: 99, col: 99 });
    });
    // 10,000 cells > the immediate limit: the previous (1-cell) stats stay until the timer fires
    expect(result.current.stats.cells).toBe(1);

    act(() => {
      vi.advanceTimersByTime(150);
    });
    const settled = result.current.stats;
    expect(settled.cells).toBe(10_000);
    expect(settled.sum).toBe(10_000);
    expect(settled.approximate).toBe(false);

    // 25 more drag steps: the trailing timer keeps resetting, nothing computes in between
    for (let i = 0; i < 24; i++) {
      act(() => {
        result.current.actions.extendToAt({ row: 90 + (i % 8), col: 99 });
      });
    }
    act(() => {
      result.current.actions.extendToAt({ row: 99, col: 99 });
    });
    expect(result.current.stats).toBe(settled);

    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current.stats).not.toBe(settled);
    expect(result.current.stats.cells).toBe(10_000);
    expect(result.current.stats.sum).toBe(10_000);
  });
});

describe("DataGridStatusBar", () => {
  function renderBar() {
    render(
      <Provider rowCount={6}>
        <BarProbe />
        <DataGridStatusBar />
      </Provider>,
    );
    return barActions!;
  }

  it("renders nothing while fewer than 2 cells are selected", () => {
    const actions = renderBar();
    expect(screen.queryByRole("status")).toBeNull();

    act(() => {
      actions.selectCellAt({ row: 0, col: 0 });
    });
    expect(screen.queryByRole("status")).toBeNull();

    act(() => {
      actions.extendToAt({ row: 0, col: 1 });
    });
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("shows each aggregate with its label and no ≈ while exact", () => {
    const actions = renderBar();
    act(() => {
      actions.selectCellAt({ row: 0, col: 1 });
      actions.extendToAt({ row: 3, col: 1 });
    });
    // column a, rows 0-3: 0, 1, 2, 3
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Count 4");
    expect(status.textContent).toContain("Sum 6");
    expect(status.textContent).toContain("Avg 1.5");
    expect(status.textContent).toContain("Min 0");
    expect(status.textContent).toContain("Max 3");
    expect(status).not.toHaveAttribute("title");
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("hides sum/avg/min/max while no numeric cell is selected", () => {
    const actions = renderBar();
    act(() => {
      actions.selectCellAt({ row: 0, col: 0 });
      actions.extendToAt({ row: 5, col: 0 });
    });
    // column name: six text values, no numbers
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Count 6");
    expect(status.textContent).not.toContain("Sum");
    expect(status.textContent).not.toContain("Avg");
  });

  it("formats with the single numeric column's toDisplayText", () => {
    const money: AnyCellType = {
      ...numberCellType,
      toDisplayText: (value: number | null) => (value === null ? "" : `$${value}`),
    };
    function CaptureActions() {
      barActions = useDataGridActions();
      return null;
    }
    render(
      <DataGridProvider
        data={makeRows(6)}
        columns={[{ id: "money", header: "Money", accessorKey: "a", type: "money" }] as readonly ColumnDef<Row, unknown>[]}
        getRowId={(r) => r.id}
        cellTypes={{ money }}
      >
        <CaptureActions />
        <DataGridStatusBar />
      </DataGridProvider>,
    );
    act(() => {
      barActions!.selectCellAt({ row: 0, col: 0 });
      barActions!.extendToAt({ row: 1, col: 0 });
    });
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Sum $1");
    expect(status.textContent).toContain("Avg $0.5");
    expect(status.textContent).toContain("Max $1");
    // count is not a display value: it stays default-formatted
    expect(status.textContent).toContain("Count 2");
  });
});
