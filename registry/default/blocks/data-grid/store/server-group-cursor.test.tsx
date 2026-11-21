import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef } from "../types";
import type { ServerGroupLayout, ServerGroupSlot } from "../group-types";
import { DataGridProvider } from ".";
import { useDataGridStoreApi } from "./provider";
import { recordKeyAt } from "./view-rows";
import type { DataGridStoreState } from "./types";

type Row = { id: string; region: string; city: string };

const columns: ColumnDef<Row, unknown>[] = [
  { id: "region", header: "Region", accessorKey: "region", type: "text" },
  { id: "city", header: "City", accessorKey: "city", type: "text" },
];
const GROUP_BY = ["region", "city"];
const hole = undefined as unknown as Row;
const row = (id: string, city: string): Row => ({ id, region: "EU", city });
const slot = (viewRow: number, keys: string[], childCount = 1): ServerGroupSlot => ({ viewRow, path: keys.map((key, level) => ({ columnId: GROUP_BY[level]!, key })), count: 1, childCount });

function mount(first: ServerGroupLayout, rows: Row[]) {
  let store!: StoreApi<DataGridStoreState>;
  const Probe = () => {
    store = useDataGridStoreApi();
    return null;
  };
  const tree = (groupLayout: ServerGroupLayout, data: Row[]) => (
    <DataGridProvider data={data} columns={columns} getRowId={(r: Row, i: number) => r?.id ?? `hole-${i}`} groupBy={GROUP_BY} groupLayout={groupLayout} groupMode="server">
      <Probe />
    </DataGridProvider>
  );
  const view = render(tree(first, rows));
  const state = () => store.getState();
  return { state, cursorRecord: () => recordKeyAt(state().viewIndex, state().activeCell!.row), rerender: (next: ServerGroupLayout, data: Row[]) => act(() => view.rerender(tree(next, data))) };
}

/** EU open at 0; its cities Paris (open, row p1) and Rome (open, row r1) below it; US closed at 5. */
const before = () => ({ layout: { rows: [slot(0, ["EU"], 2), slot(1, ["EU", "Paris"]), slot(3, ["EU", "Rome"]), slot(5, ["US"], 1)], leafCount: 3 }, data: [hole, hole, row("p1", "Paris"), hole, row("r1", "Rome"), hole] });
/** Paris left the result: Rome now sits at view row 1. */
const after = () => ({ layout: { rows: [slot(0, ["EU"], 1), slot(1, ["EU", "Rome"]), slot(3, ["US"], 1)], leafCount: 2 }, data: [hole, hole, row("r1", "Rome"), hole] });

describe("the cursor when its server group leaves the layout", () => {
  it("moves to the parent group, never onto the record that now holds its index", () => {
    const { layout, data } = before();
    const m = mount(layout, data);
    act(() => m.state().actions.selectCellAt({ row: 1, col: 1 }));
    expect(m.cursorRecord()).toBe("__group:region=EU/city=Paris");
    m.rerender(after().layout, after().data);
    expect(m.cursorRecord()).toBe("__group:region=EU");
    expect(m.state().activeCell).toEqual({ row: 0, col: 1 });
  });

  it("moves a cursor on a row of a group that left to the nearest group that stayed", () => {
    const { layout, data } = before();
    const m = mount(layout, data);
    act(() => m.state().actions.selectCellAt({ row: 2, col: 0 }));
    expect(m.cursorRecord()).toBe(2);
    m.rerender(after().layout, after().data);
    expect(m.cursorRecord()).toBe("__group:region=EU");
  });

  it("clamps a cursor on a top-level group that left, as before", () => {
    const m = mount({ rows: [slot(0, ["EU"], 0), slot(1, ["US"], 0), slot(2, ["XX"], 0)], leafCount: 0 }, [hole, hole, hole]);
    act(() => m.state().actions.selectCellAt({ row: 2, col: 0 }));
    m.rerender({ rows: [slot(0, ["EU"], 0), slot(1, ["US"], 0)], leafCount: 0 }, [hole, hole]);
    expect(m.state().activeCell).toEqual({ row: 1, col: 0 });
  });
});
