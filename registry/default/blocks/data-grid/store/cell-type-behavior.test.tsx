import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { ColumnDef } from "../types";
import {
  DataGridProvider,
  useDataGridActions,
  useDataGridCellErrors,
  useDataGridStoreApi,
  type DataGridProviderProps,
} from "../store";

type Row = { id: string; fruit: string | null; qty: number };

/** opaque stored values; the visible labels differ, so label search and value search give different results */
const CHOICES = [
  { value: "v1", label: "Cherry" },
  { value: "v2", label: "Dragonfruit" },
];

/** A custom cell type whose own `validate` the column does not declare — the type-level fallback every validation path must honor. */
function makeCustomType(validate?: (value: unknown, row: unknown) => string | null) {
  const Cell = ({ value }: { value: unknown }) => <span>{String(value ?? "")}</span>;
  const Editor = ({ commit, cancel }: { commit: () => void; cancel: () => void }) => (
    <input
      aria-label="custom editor"
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") cancel();
      }}
    />
  );
  return {
    Cell,
    Editor,
    toText: (value: unknown) => (value == null ? "" : String(value)),
    fromText: (text: string) => text,
    clearValue: () => null,
    isEmpty: (value: unknown) => value == null,
    validate,
  };
}

function makeWrapper(overrides: Partial<DataGridProviderProps<Row>> = {}) {
  const columns: readonly ColumnDef<Row, unknown>[] = [
    { id: "fruit", header: "Fruit", accessorKey: "fruit", type: "select", options: { choices: CHOICES } },
    { id: "qty", header: "Qty", accessorKey: "qty", type: "custom-qty" as never },
  ];
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DataGridProvider
        data={[{ id: "1", fruit: "v1", qty: 3 }, { id: "2", fruit: "v2", qty: 7 }]}
        columns={columns}
        getRowId={(r) => r.id}
        cellTypes={{ "custom-qty": makeCustomType((value) => (typeof value === "number" && value > 5 ? "Too big" : null)) } as never}
        {...overrides}
      >
        {children}
      </DataGridProvider>
    );
  };
}

function useHarness() {
  const actions = useDataGridActions();
  const cellErrors = useDataGridCellErrors();
  const store = useDataGridStoreApi();
  return { actions, cellErrors, store };
}

describe("cell type `validate` as the fallback for commit validation", () => {
  it("a blocking type-level rejection keeps the editor open and flags editingError", () => {
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper() });

    act(() => {
      result.current.actions.startEditingAt({ row: 0, col: 1 });
      result.current.actions.commitCellEdit(99);
    });

    expect(result.current.store.getState().editing).not.toBeNull();
    expect(result.current.store.getState().editingError).toBe("Too big");
    expect((result.current.store.getState().data[0]! as Row).qty).toBe(3);
  });

  it("a passing value commits after the rejection, and the error clears", () => {
    const onDataChange = vi.fn();
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper({ onDataChange }) });

    act(() => {
      result.current.actions.startEditingAt({ row: 0, col: 1 });
      result.current.actions.commitCellEdit(99);
      result.current.actions.commitCellEdit(4);
    });

    expect(onDataChange).toHaveBeenCalledTimes(1);
    expect(result.current.store.getState().editing).toBeNull();
    expect(result.current.store.getState().editingError).toBeNull();
    expect((result.current.store.getState().data[0]! as Row).qty).toBe(4);
  });
});

describe("cell type `validate` on the updateCells path", () => {
  it("a rejected patch is silently skipped (updateCells streaming contract) and reported in the result", () => {
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper() });

    let verdict: ReturnType<typeof result.current.actions.updateCells> | undefined;
    act(() => {
      verdict = result.current.actions.updateCells([{ rowId: "2", columnId: "qty", value: 8 }]);
    });

    expect(verdict!.skipped).toHaveLength(1);
    expect((result.current.store.getState().data[1]! as Row).qty).toBe(7);
  });

  it("a passing patch applies", () => {
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper() });

    let verdict: ReturnType<typeof result.current.actions.updateCells> | undefined;
    act(() => {
      verdict = result.current.actions.updateCells([{ rowId: "2", columnId: "qty", value: 2 }]);
    });

    expect(verdict!.skipped).toHaveLength(0);
    expect((result.current.store.getState().data[1]! as Row).qty).toBe(2);
  });
});

describe("select quick search matches the choice label, not the stored value", () => {
  it("the label matches and the stored value does not", () => {
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper() });

    act(() => {
      result.current.actions.setSearch("Cherry");
    });
    const byLabel = result.current.store.getState().searchMatches;
    expect(byLabel).toHaveLength(1);
    expect(byLabel[0]!.columnId).toBe("fruit");

    act(() => {
      result.current.actions.setSearch("v1");
    });
    expect(result.current.store.getState().searchMatches).toHaveLength(0);
  });

  it("a label substring still matches", () => {
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper() });

    act(() => {
      result.current.actions.setSearch("ragon");
    });
    expect(result.current.store.getState().searchMatches).toHaveLength(1);
  });
});
