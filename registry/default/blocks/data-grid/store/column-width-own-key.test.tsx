import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ColumnDef } from "../types";
import { DataGridProvider, useDataGridActions, useDataGridColumnWidth, useDataGridColumnWidths, useDataGridStoreApi } from ".";

type Row = Record<string, string>;

const columns: readonly ColumnDef<Row, unknown>[] = ["__proto__", "constructor", "a"].map((id) => ({ id, header: id, accessorKey: id }));

describe("column widths keyed by inherited Object property names", () => {
  it("reads no width for an unset __proto__ or constructor column", () => {
    const onColumnLayoutChange = vi.fn();
    let single: unknown = "unread";
    let many: unknown[] = [];
    let actions: ReturnType<typeof useDataGridActions> | null = null;
    function Probe() {
      single = useDataGridColumnWidth("__proto__");
      many = useDataGridColumnWidths(["__proto__", "constructor", "a"]);
      actions = useDataGridActions();
      return null;
    }
    render(
      <DataGridProvider defaultData={[]} columns={columns} getRowId={(row) => row["id"]!} onColumnLayoutChange={onColumnLayoutChange}>
        <Probe />
      </DataGridProvider>,
    );
    expect(single).toBeUndefined();
    expect(many).toEqual([undefined, undefined, undefined]);
    act(() => actions!.resetColumnWidth("__proto__"));
    expect(onColumnLayoutChange).not.toHaveBeenCalled();
    act(() => actions!.setColumnWidth("__proto__", 120));
    expect(single).toBe(120);
  });

  it("keeps the def pin of a __proto__ column under a columnLayout without pins", () => {
    let pins: unknown = null;
    function Probe() {
      pins = useDataGridStoreApi().getState().columnLayout.pins;
      return null;
    }
    const pinned = columns.map((column) => (column.id === "__proto__" ? { ...column, pin: "start" as const } : column));
    render(
      <DataGridProvider defaultData={[]} columns={pinned} getRowId={(row) => row["id"]!} columnLayout={{ order: ["__proto__", "constructor", "a"] }}>
        <Probe />
      </DataGridProvider>,
    );
    expect(Object.entries(pins as object)).toEqual([["__proto__", "start"]]);
  });
});
