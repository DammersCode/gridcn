import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import type { ColumnDef } from "../types";
import { DataGridProvider, useDataGridActions } from ".";

type Row = { id: string; price: number };
const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "price", header: "Price", accessorKey: "price" }];

it("refuses a source-less push, and asks once in development to name the source", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DataGridProvider data={[{ id: "a", price: 0 }]} columns={columns} readOnly>
        {children}
      </DataGridProvider>
    );
  }
  const { result } = renderHook(() => useDataGridActions(), { wrapper: Wrapper });
  expect(result.current.updateCells([{ rowId: "a", columnId: "price", value: 1 }], undefined as never)).toEqual({ applied: 0, skipped: [{ patchIndex: 0, reason: "no-source" }], pending: false });
  act(() => void result.current.updateCells([{ rowId: "a", columnId: "price", value: 2 }], undefined as never));
  const readOnlyWarnings = warn.mock.calls.filter(([message]) => String(message).includes("need a source"));
  expect(readOnlyWarnings).toHaveLength(1);
  expect(String(readOnlyWarnings[0]![0])).toContain('Pass source: "stream" for a push');
  warn.mockRestore();
});

it("skips every patch with reason readonly when a non-stream write meets a readOnly grid", () => {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DataGridProvider data={[{ id: "a", price: 0 }]} columns={columns} readOnly>
        {children}
      </DataGridProvider>
    );
  }
  const { result } = renderHook(() => useDataGridActions(), { wrapper: Wrapper });
  const patches = [{ rowId: "a", columnId: "price", value: 1 }, { rowId: "a", columnId: "price", value: 2 }];
  const skipped = [{ patchIndex: 0, reason: "readonly" }, { patchIndex: 1, reason: "readonly" }];
  expect(result.current.updateCells(patches, { source: "edit" })).toEqual({ applied: 0, skipped, pending: false });
  expect(result.current.editRows([{ rowId: "a", changes: { price: 3 } }])).toEqual({ applied: 0, skipped: skipped.slice(0, 1), pending: false });
});
