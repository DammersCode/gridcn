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
import { publicActionsOf } from "./compute";

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
    expect(result.current.actions).toBe(publicActionsOf(first.store.getState().actions));
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
          <DataGridProvider store={external!}>
            {children}
          </DataGridProvider>
        );
      },
    });

    expect(consumer.result.current.api).toBe(external);
    act(() => {
      consumer.result.current.actions.selectCellAt({ col: 0, row: 1 });
    });
    // The owner's hook owns the selection subscription; the provider shell must not subscribe again.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("syncs the commands prop into the store state (and back to null when removed)", () => {
    const cmd = { run: () => {} };
    let props: { data: Row[]; columns: typeof columns; getRowId: typeof getRowId; commands?: Record<string, { run: () => void }> } = {
      data: rows(3),
      columns,
      getRowId,
      commands: { myCmd: cmd },
    };
    const { result, rerender } = renderHook(() => useDataGridStoreProps(props));
    expect(result.current.store.getState().commands).toEqual({ myCmd: cmd });
    props = { data: rows(3), columns, getRowId };
    rerender();
    expect(result.current.store.getState().commands).toBeNull();
  });

  it("dev-warns once when a command shadows a built-in action name", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderHook(() =>
      useDataGridStoreProps({ data: rows(3), columns, getRowId, commands: { selectAll: { run: () => {} } } }),
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("shadows");
    warn.mockRestore();
  });

  it("dev-warns when a command shadows editReplace, which has no default binding", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderHook(() =>
      useDataGridStoreProps({ data: rows(3), columns, getRowId, commands: { editReplace: { run: () => {} } } }),
    );
    const shadow = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("shadows"));
    expect(shadow).toHaveLength(1);
    expect(shadow[0]).toContain("editReplace");
    warn.mockRestore();
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
      result.current.selectCellAt({ col: 1, row: 0 });
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.current.setCellErrors).toBeDefined();
  });
});
