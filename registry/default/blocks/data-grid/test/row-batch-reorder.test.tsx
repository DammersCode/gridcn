import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { ColumnDef, DataChange } from "../types";
import { applyChange, createHistory } from "../interaction/history";
import {
  DataGridProvider,
  useDataGridActiveCell,
  useDataGridInternalActions,
  useDataGridSelection,
  type DataGridSyncProps,
} from "../store";

const CI_FACTOR = process.env["CI"] ? 2 : 1;

type Row = { id: string; name: string };

const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];

const makeRows = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: String(i), name: `Row ${i}` }));
const idsOf = (data: readonly Row[]) => data.map((row) => row.id);

function setup(n: number, overrides: Partial<DataGridSyncProps<Row>> = {}) {
  const onDataChange = vi.fn<(next: readonly Row[], change: DataChange<Row>) => void>();
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DataGridProvider data={makeRows(n)} columns={columns} getRowId={(r) => r.id} onDataChange={onDataChange} {...overrides}>
        {children}
      </DataGridProvider>
    );
  }
  const hook = renderHook(
    () => ({ actions: useDataGridInternalActions(), selection: useDataGridSelection(), activeCell: useDataGridActiveCell() }),
    { wrapper: Wrapper },
  );
  return { onDataChange, ...hook };
}

describe("reorderRows with a list", () => {
  it("moves a block as one change with one move op per row and final indices", () => {
    const { onDataChange, result } = setup(8);

    act(() => void result.current.actions.reorderRows([1, 3, 6], 4));

    expect(onDataChange).toHaveBeenCalledTimes(1);
    const [next, change] = onDataChange.mock.calls[0]!;
    expect(idsOf(next)).toEqual(["0", "2", "4", "5", "1", "3", "6", "7"]);
    expect(change.source).toBe("row-operation");
    expect(change.ops.map((op) => (op.type === "move" ? [op.rowId, op.from, op.to] : null))).toEqual([
      ["1", 1, 4],
      ["3", 3, 5],
      ["6", 6, 6],
    ]);
  });

  it("dedupes the list and ignores its order", () => {
    const { onDataChange, result } = setup(5);

    act(() => void result.current.actions.reorderRows([3, 1, 3], 0));

    expect(idsOf(onDataChange.mock.calls[0]![0])).toEqual(["1", "3", "0", "2", "4"]);
  });

  it("is a silent no-op for an empty list, an out-of-range index, or a block already in place", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { onDataChange, result } = setup(5);

    act(() => {
      result.current.actions.reorderRows([], 0);
      result.current.actions.reorderRows([1, 9], 0);
      result.current.actions.reorderRows([3, 4], 4);
      result.current.actions.reorderRows([1, 2], 1);
    });

    expect(onDataChange).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("is a no-op when enableRowReorder is false", () => {
    const { onDataChange, result } = setup(5, { enableRowReorder: false });
    act(() => void result.current.actions.reorderRows([0, 1], 3));
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it("is a no-op with a dev warning under an active sort", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { onDataChange, result } = setup(5, { sortState: [{ columnId: "name", direction: "asc" }] });
    act(() => void result.current.actions.reorderRows([0, 1], 3));
    expect(onDataChange).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("sort"));
    warn.mockRestore();
  });

  it("moves under sortMode=server, where the data order is the view order", () => {
    const { onDataChange, result } = setup(5, { sortMode: "server", sortState: [{ columnId: "name", direction: "asc" }] });
    act(() => void result.current.actions.reorderRows([0, 1], 3));
    expect(idsOf(onDataChange.mock.calls[0]![0])).toEqual(["2", "3", "4", "0", "1"]);
  });

  it("is a no-op with a dev warning while rows are unloaded", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sparse = makeRows(5);
    delete (sparse as (Row | undefined)[])[2];
    const onDataChange = vi.fn();
    const { result } = renderHook(() => useDataGridInternalActions(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <DataGridProvider data={sparse} columns={columns} getRowId={(r) => r?.id ?? "hole"} onDataChange={onDataChange}>
          {children}
        </DataGridProvider>
      ),
    });
    act(() => void result.current.reorderRows([0, 1], 3));
    expect(onDataChange).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("unloaded"));
    warn.mockRestore();
  });

  it("keeps the row channel and the cursor on their rows", () => {
    const { result } = setup(8);
    act(() => {
      result.current.actions.selectCellAt({ col: 0, row: 3 });
      result.current.actions.setRowSelected(1, true);
      result.current.actions.setRowSelected(3, true);
    });

    act(() => void result.current.actions.reorderRows([1, 3], 5));

    expect(result.current.selection.rows.toArray()).toEqual([5, 6]);
    expect(result.current.activeCell).toEqual({ col: 0, row: 6 });
  });

  it("one undo restores the order and the history holds one entry", () => {
    const history = createHistory<Row>();
    const { onDataChange, result } = setup(6, { onDataChange: (_, change) => history.push(change) });
    void onDataChange;

    act(() => void result.current.actions.reorderRows([0, 2, 4], 3));
    expect(history.size).toBe(1);

    const undo = history.undo()!;
    const restored = applyChange(
      applyChange(makeRows(6), history.redo()!, (r) => r.id),
      undo,
      (r) => r.id,
    );
    expect(idsOf(restored)).toEqual(["0", "1", "2", "3", "4", "5"]);
  });

  it("a controlled consumer applying the change through applyChange matches the grid", () => {
    const { onDataChange, result } = setup(8);
    act(() => void result.current.actions.reorderRows([0, 5, 6], 2));
    const [next, change] = onDataChange.mock.calls[0]!;
    expect(idsOf(applyChange(makeRows(8), change, (r) => r.id))).toEqual(idsOf(next));
  });
});

describe("moveRowsBy", () => {
  it("shifts each row by delta and keeps the gaps", () => {
    const { onDataChange, result } = setup(8);
    act(() => void result.current.actions.moveRowsBy([1, 3, 5], 1));
    expect(onDataChange).toHaveBeenCalledTimes(1);
    expect(idsOf(onDataChange.mock.calls[0]![0])).toEqual(["0", "2", "1", "4", "3", "6", "5", "7"]);
  });

  it("does nothing for the whole batch when one row sits at the edge", () => {
    const { onDataChange, result } = setup(5);
    act(() => {
      result.current.actions.moveRowsBy([0, 3], -1);
      result.current.actions.moveRowsBy([1, 4], 1);
    });
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it("is a no-op while readOnly", () => {
    const { onDataChange, result } = setup(5, { readOnly: true });
    act(() => void result.current.actions.moveRowsBy([1], 1));
    expect(onDataChange).not.toHaveBeenCalled();
  });
});

describe("batch reorder cost at 100,000 rows", () => {
  it("moves 1,000 rows in one change inside the budget", () => {
    const { onDataChange, result } = setup(100_000);
    const rows = Array.from({ length: 1000 }, (_, i) => i * 50);
    const start = performance.now();
    act(() => void result.current.actions.reorderRows(rows, 40_000));
    const ms = performance.now() - start;
    expect(onDataChange).toHaveBeenCalledTimes(1);
    expect(onDataChange.mock.calls[0]![1].ops).toHaveLength(1000);
    expect(ms).toBeLessThan(100 * CI_FACTOR);
  });
});
