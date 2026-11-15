import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef } from "@/registry/default/blocks/data-grid/types";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState, type DataGridSyncProps } from "@/registry/default/blocks/data-grid/store";

type Row = { id: string; name: string };
const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];
const rows: Row[] = [{ id: "a", name: "A" }, { id: "b", name: "B" }];

function mount(props: Partial<DataGridSyncProps<Row>>) {
  let api: StoreApi<DataGridStoreState> | null = null;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  const view = render(
    <DataGridProvider columns={columns} getRowId={(r: Row) => r.id} defaultData={rows} {...props}>
      <Probe />
    </DataGridProvider>,
  );
  return { state: () => api!.getState(), view };
}

const flush = () => act(async () => { await Promise.resolve(); });

describe("gate abort reasons", () => {
  it("moving to another cell before onBeforeEditStart settles aborts the run as 'changed'", async () => {
    const onGateAborted = vi.fn();
    let signal: AbortSignal | undefined;
    const m = mount({
      onGateAborted,
      onBeforeEditStart: (_cell, ctx) => {
        signal = ctx.signal;
        return new Promise<boolean>(() => {});
      },
    });
    act(() => m.state().actions.selectCellAt({ row: 0, col: 0 }));
    act(() => m.state().actions.startEditingAt({ row: 0, col: 0 }));
    expect(m.state().gatesPending.has("onBeforeEditStart")).toBe(true);
    act(() => m.state().actions.selectCellAt({ row: 1, col: 0 }));
    await flush();
    expect(signal?.aborted).toBe(true);
    expect(onGateAborted).toHaveBeenCalledWith({ gate: "onBeforeEditStart", reason: "changed" });
  });

  it("an onGateAborted that throws a value without a string form does not break the abort", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = mount({
      onGateAborted: () => {
        throw Object.create(null);
      },
      onBeforeEditStart: () => new Promise<boolean>(() => {}),
    });
    act(() => m.state().actions.selectCellAt({ row: 0, col: 0 }));
    act(() => m.state().actions.startEditingAt({ row: 0, col: 0 }));
    expect(() => act(() => m.state().actions.selectCellAt({ row: 1, col: 0 }))).not.toThrow();
    await flush();
  });

  it("a second startEditing while onBeforeEditStart is pending starts no newer run", () => {
    const gate = vi.fn(() => new Promise<boolean>(() => {}));
    const m = mount({ onBeforeEditStart: gate });
    act(() => m.state().actions.selectCellAt({ row: 0, col: 0 }));
    act(() => m.state().actions.startEditingAt({ row: 0, col: 0 }));
    act(() => m.state().actions.startEditingAt({ row: 0, col: 0 }));
    expect(gate).toHaveBeenCalledTimes(1);
  });
});
