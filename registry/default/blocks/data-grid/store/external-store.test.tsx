import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef } from "../types";
import {
  DataGridProvider,
  useDataGridActions,
  useDataGridStoreApi,
  useDataGridStoreProps,
  type DataGridStoreState,
} from "../store";

type Row = { id: string; name: string; age: number };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "age", header: "Age", accessorKey: "age", type: "number" },
];

function rows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({ id: `r${i}`, name: `Row ${i}`, age: 20 + i }));
}

const getRowId = (row: Row) => row.id;

describe("useDataGridStoreProps (external store ownership)", () => {
  it("returns a stable store and actions across re-renders", () => {
    let data = rows(3);
    const { result, rerender } = renderHook(() => {
      const r = useDataGridStoreProps({ data, columns, getRowId });
      return r;
    });
    const first = result.current;
    rerender();
    data = rows(3);
    rerender();
    expect(result.current.store).toBe(first.store);
    expect(result.current.actions).toBe(first.actions);
    expect(result.current.actions).toBe(first.store.getState().actions);
  });

  it("keeps the store in sync with live props passed to the hook", () => {
    let data = rows(3);
    const { result, rerender } = renderHook(() => useDataGridStoreProps({ data, columns, getRowId }));
    expect(result.current.store.getState().data).toHaveLength(3);
    data = rows(5);
    rerender();
    expect(result.current.store.getState().data).toHaveLength(5);
  });

  it("serves the external store to the provider's subtree, and onSelectionChange fires exactly once", () => {
    const spy = vi.fn();
    let external: StoreApi<DataGridStoreState> | null = null;
    renderHook(() => {
      const r = useDataGridStoreProps({ data: rows(3), columns, getRowId, onSelectionChange: spy });
      external = r.store;
      return r;
    });
    const consumer = renderHook(() => ({ actions: useDataGridActions(), api: useDataGridStoreApi() }), {
      wrapper: function Wrapper({ children }: { children: ReactNode }) {
        return (
          <DataGridProvider store={external ?? undefined} data={rows(3)} columns={columns} getRowId={getRowId}>
            {children}
          </DataGridProvider>
        );
      },
    });

    expect(consumer.result.current.api).toBe(external);
    act(() => {
      consumer.result.current.actions.selectCell({ col: 0, row: 1 });
    });
    // The owner's hook owns the selection subscription; the provider shell must not subscribe again.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("self-creating provider (no store prop) still owns the sync and subscriptions", () => {
    const spy = vi.fn();
    const { result } = renderHook(() => useDataGridActions(), {
      wrapper: function Wrapper({ children }: { children: ReactNode }) {
        return (
          <DataGridProvider data={rows(3)} columns={columns} getRowId={getRowId} onSelectionChange={spy}>
            {children}
          </DataGridProvider>
        );
      },
    });
    act(() => {
      result.current.selectCell({ col: 1, row: 0 });
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.current.setCellErrors).toBeDefined();
  });
});
