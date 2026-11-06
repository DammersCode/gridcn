import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef } from "./types";
import { LiveRegion } from "./live-region";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState, type LiveAnnouncement } from "./store";

type Row = { id: string; name: string };

const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];

function mount() {
  let api: StoreApi<DataGridStoreState> | null = null;
  function Probe() {
    api = useDataGridStoreApi() as StoreApi<DataGridStoreState>;
    return null;
  }
  render(
    <DataGridProvider columns={columns} getRowId={(row: Row) => row.id} defaultData={[{ id: "a", name: "A" }]}>
      <Probe />
      <LiveRegion />
    </DataGridProvider>,
  );
  return (announcement: LiveAnnouncement) => {
    act(() => api!.setState({ liveAnnouncement: announcement }));
    act(() => {
      vi.advanceTimersByTime(600);
    });
    return document.querySelector("[data-grid-live-region]")!.textContent;
  };
}

describe("LiveRegion write states", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reads a refused save with the row count", () => {
    const announce = mount();
    expect(announce({ kind: "saveRejected", count: 1, seq: 1 })).toBe("1 row not saved");
    expect(announce({ kind: "saveRejected", count: 2, seq: 2 })).toBe("2 rows not saved");
  });

  it("reads a history step blocked by unloaded rows", () => {
    const announce = mount();
    expect(announce({ kind: "historyBlocked", count: 3, seq: 1, partial: true })).toBe("Undo or redo needs rows that are not loaded yet");
  });

  it("reads a history step skipped because the rows are gone", () => {
    const announce = mount();
    expect(announce({ kind: "historyBlocked", count: 3, seq: 1 })).toBe("Undo or redo skipped: the rows no longer exist");
  });
});
