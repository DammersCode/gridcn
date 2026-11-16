import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import type { ColumnDef } from "../types";
import { DataGridProvider, useDataGridActions } from ".";

type Row = { id: string; price: number };
const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "price", header: "Price", accessorKey: "price" }];

it("applies a source-less push on a readOnly grid, and asks once in development to name the source", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DataGridProvider data={[{ id: "a", price: 0 }]} columns={columns} readOnly>
        {children}
      </DataGridProvider>
    );
  }
  const { result } = renderHook(() => useDataGridActions(), { wrapper: Wrapper });
  expect(result.current.updateCells([{ rowId: "a", columnId: "price", value: 1 }])).toEqual({ applied: 1, skipped: [], pending: false });
  act(() => void result.current.updateCells([{ rowId: "a", columnId: "price", value: 2 }], { source: "stream" }));
  const readOnlyWarnings = warn.mock.calls.filter(([message]) => String(message).includes("the grid is readOnly"));
  expect(readOnlyWarnings).toHaveLength(1);
  expect(String(readOnlyWarnings[0]![0])).toContain('Pass source: "stream" to confirm the push, or source: "edit" to keep the readOnly check');
  warn.mockRestore();
});
