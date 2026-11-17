import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef } from "../types";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState, type DataGridSyncProps } from ".";

type Row = { id: string; a: string; b: string; c: string; d: string };

const col = (id: keyof Row & string, extra: Partial<ColumnDef<Row, unknown>> = {}): ColumnDef<Row, unknown> => ({ id, header: id, accessorKey: id, ...extra });
const columns = [col("a", { pin: "start" }), col("b"), col("c", { reorderable: false }), col("d")];

function mount(props: Partial<DataGridSyncProps<Row>> = {}) {
  let api: StoreApi<DataGridStoreState> | null = null;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  render(
    <DataGridProvider defaultData={[]} columns={columns} getRowId={(row) => row.id} {...props}>
      <Probe />
    </DataGridProvider>,
  );
  return () => api!.getState();
}

const ids = (state: DataGridStoreState) => state.visibleColumns.map((column) => column.id);

describe("setColumnOrder result", () => {
  it("returns ok on a move and names the reason of every no-op", () => {
    const state = mount();
    expect(state().actions.setColumnOrder("d", "b", "before")).toEqual({ ok: true });
    expect(ids(state())).toEqual(["a", "d", "b", "c"]);
    expect(state().actions.setColumnOrder("d", "b", "before")).toEqual({ ok: false, reason: "nothing-to-do" });
    expect(state().actions.setColumnOrder("d", "c", "after")).toEqual({ ok: false, reason: "not-reorderable" });
    expect(state().actions.setColumnOrder("d", "a", "before")).toEqual({ ok: false, reason: "pin-zone" });
    expect(state().actions.setColumnOrder("d", "zzz", "before")).toEqual({ ok: false, reason: "unknown-column" });
    expect(ids(state())).toEqual(["a", "d", "b", "c"]);
  });

  it('returns "pin-zone" for a group that spans two pin zones or moves onto another zone', () => {
    const state = mount({ columnGroups: [{ id: "split", header: "Split", children: ["a", "b"] }, { id: "end", header: "End", children: ["d"] }] });
    expect(state().actions.setColumnOrder("split", "d", "after")).toEqual({ ok: false, reason: "pin-zone" });
    expect(state().actions.canSetColumnOrder("end", "a", "before")).toEqual({ ok: false, reason: "pin-zone" });
  });

  it('returns "disabled" with enableColumnReorder false', () => {
    const state = mount({ enableColumnReorder: false });
    expect(state().actions.setColumnOrder("d", "b", "before")).toEqual({ ok: false, reason: "disabled" });
  });

  it("canSetColumnOrder answers the same without moving", () => {
    const state = mount();
    expect(state().actions.canSetColumnOrder("d", "b", "before")).toEqual({ ok: true });
    expect(state().actions.canSetColumnOrder("d", "a", "before")).toEqual({ ok: false, reason: "pin-zone" });
    expect(ids(state())).toEqual(["a", "b", "c", "d"]);
  });
});
