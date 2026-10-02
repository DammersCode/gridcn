import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import type { ColumnDef } from "../types";
import { DataGridProvider, useDataGridActions, useDataGridStoreProps } from "../data-grid";

type Row = { id: string; name: string };

const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];
const getRowId = (row: Row) => row.id;

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <DataGridProvider defaultData={[{ id: "a", name: "Alpha" }]} columns={columns} getRowId={getRowId}>
      {children}
    </DataGridProvider>
  );
}

const internalKeys = (actions: object) => Object.keys(actions).filter((key) => key.startsWith("_"));

describe("public actions", () => {
  it("useDataGridActions exposes no internal actions", () => {
    const { result } = renderHook(() => useDataGridActions(), { wrapper: Wrapper });

    expect((result.current as unknown as Record<string, unknown>)["_registerReadOnly"]).toBeUndefined();
    expect(internalKeys(result.current)).toEqual([]);
    expect(typeof result.current.selectCellAt).toBe("function");
  });

  it("keeps one public actions identity across renders", () => {
    const { result, rerender } = renderHook(() => useDataGridActions(), { wrapper: Wrapper });
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });

  it("useDataGridStoreProps returns the public actions", () => {
    const { result } = renderHook(() =>
      useDataGridStoreProps({ defaultData: [{ id: "a", name: "Alpha" }], columns, getRowId }),
    );

    expect(internalKeys(result.current.actions)).toEqual([]);
  });
});
