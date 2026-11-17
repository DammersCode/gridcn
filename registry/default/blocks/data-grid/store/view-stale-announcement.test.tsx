import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef, SortSpec } from "../types";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState } from ".";

type Row = { id: string; name: string };

const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];
const sorts: SortSpec[] = [{ columnId: "name", direction: "asc" }];

function mount(mode: "client" | "server") {
  let api: StoreApi<DataGridStoreState> | null = null;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  render(
    <DataGridProvider columns={columns} getRowId={(row: Row) => row.id} defaultData={[{ id: "a", name: "A" }, { id: "b", name: "B" }]} sortState={sorts} sortMode={mode}>
      <Probe />
    </DataGridProvider>,
  );
  const state = () => api!.getState();
  let tick = 0;
  return {
    state,
    announcement: () => state().liveAnnouncement,
    push: () => act(() => void state().actions.updateCells([{ rowId: "a", columnId: "name", value: `v${++tick}` }], { source: "stream" })),
    reconcile: () => act(() => state().actions.reconcileView()),
  };
}

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
afterEach(() => vi.useRealTimers());

describe.each(["client", "server"] as const)("view stale announcement (%s sort)", (mode) => {
  it("announces once when the view turns stale and stays silent for 30 seconds", () => {
    const m = mount(mode);
    expect(m.announcement()).toBeNull();
    m.push();
    expect(m.announcement()).toMatchObject({ kind: "viewStale", seq: 1 });
    m.push();
    m.reconcile();
    m.push();
    expect(m.announcement()?.seq).toBe(1);
  });

  it("announces again once 30 seconds passed", () => {
    const m = mount(mode);
    m.push();
    m.reconcile();
    vi.setSystemTime(Date.now() + 30_000);
    m.push();
    expect(m.announcement()).toMatchObject({ kind: "viewStale", seq: 2 });
  });

  it("does not announce a push that leaves the view fresh", () => {
    const m = mount(mode);
    act(() => void m.state().actions.updateCells([{ rowId: "a", columnId: "name", value: "Z" }], { source: "stream", reorder: "never" }));
    expect(m.announcement()).toBeNull();
  });
});
