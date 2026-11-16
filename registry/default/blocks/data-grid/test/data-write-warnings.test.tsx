import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { ColumnDef } from "../types";
import { DataGridProvider, useDataGridInternalActions, type DataGridSyncProps } from "../store";

type Row = { id: string; name: string };

const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];
const rows: Row[] = Array.from({ length: 4 }, (_, i) => ({ id: String(i), name: `Row ${i}` }));

function setup(props: Partial<DataGridSyncProps<Row>> = { onDataChange: () => {} }) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id} {...props}>
        {children}
      </DataGridProvider>
    );
  }
  return renderHook(() => useDataGridInternalActions(), { wrapper: Wrapper });
}

const warnings = (warn: { mock: { calls: unknown[][] } }, text: string) => warn.mock.calls.filter(([message]) => String(message).includes(text));

afterEach(() => vi.restoreAllMocks());

describe("data write development warnings", () => {
  it("warns once per grid for a CellRef that does not resolve", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = setup();
    act(() => result.current.setActiveCell({ rowId: "gone", columnId: "name" }));
    act(() => result.current.setActiveCell({ rowId: "also-gone", columnId: "name" }));
    expect(warnings(warn, "does not resolve")).toHaveLength(1);
  });

  it("warns once per grid for a number row id", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = setup();
    act(() => result.current.setRowChecked(0 as never, true));
    act(() => void result.current.deleteRows([1 as never]));
    expect(warnings(warn, "takes stable row ids")).toHaveLength(1);
  });

  it("warns once per grid for controlled data without onDataChange", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = setup({});
    act(() => void result.current.deleteRows(["0"]));
    act(() => void result.current.deleteRows(["1"]));
    expect(warnings(warn, "no onDataChange receives this change")).toHaveLength(1);
  });
});
