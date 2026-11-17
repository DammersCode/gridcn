import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef, ColumnLayout } from "@/registry/default/blocks/data-grid/types";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState, type DataGridSyncProps } from "@/registry/default/blocks/data-grid/store";

type Row = { id: string; a: string; b: string; c: string };
const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "a", header: "A", accessorKey: "a", width: 100, pin: "start" },
  { id: "b", header: "B", accessorKey: "b" },
  { id: "c", header: "C", accessorKey: "c", hidden: true },
];
const defaults: ColumnLayout = { widths: {}, order: ["a", "b", "c"], pins: { a: "start" }, hidden: ["c"] };

function mount(props: Partial<DataGridSyncProps<Row>>) {
  let api!: StoreApi<DataGridStoreState>;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  const view = render(
    <DataGridProvider columns={columns} getRowId={(r: Row) => r.id} defaultData={[{ id: "r", a: "1", b: "2", c: "3" }]} {...props}>
      <Probe />
    </DataGridProvider>,
  );
  return { state: () => api.getState(), view };
}

const changed: Partial<ColumnLayout> = { widths: { b: 220 }, order: ["c", "b", "a"], pins: { b: "end" }, hidden: ["a"] };

describe("resetColumnLayout", () => {
  it("restores the column defs and fires onColumnLayoutChange once", () => {
    const onColumnLayoutChange = vi.fn();
    const m = mount({ onColumnLayoutChange });
    act(() => m.state().actions.setColumnLayout(changed));
    onColumnLayoutChange.mockClear();
    act(() => m.state().actions.resetColumnLayout());
    expect(onColumnLayoutChange).toHaveBeenCalledTimes(1);
    expect(onColumnLayoutChange).toHaveBeenCalledWith(defaults);
  });

  it("fires nothing when the layout already matches the defs", () => {
    const onColumnLayoutChange = vi.fn();
    const m = mount({ onColumnLayoutChange });
    act(() => m.state().actions.resetColumnLayout());
    expect(onColumnLayoutChange).not.toHaveBeenCalled();
  });

  it("in controlled mode reports the defaults and leaves the layout to the prop", () => {
    const onColumnLayoutChange = vi.fn();
    const m = mount({ columnLayout: changed as ColumnLayout, onColumnLayoutChange });
    act(() => m.state().actions.resetColumnLayout());
    expect(onColumnLayoutChange).toHaveBeenCalledTimes(1);
    expect(onColumnLayoutChange).toHaveBeenCalledWith(defaults);
  });
});
