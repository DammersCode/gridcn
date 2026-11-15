import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import { DataGridProvider, DataGridRoot, type ColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridStoreApi, type DataGridStoreState } from "@/registry/default/blocks/data-grid/store";
import { useDataGridServerRows, type ServerRowsAnswer } from "./use-data-grid-server-rows";

type Row = { id: string; name: string };
const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "requestAnimationFrame", "cancelAnimationFrame"] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

describe.each(["pages", "scroll"] as const)("empty result with revalidateIntervalMs, %s mode", (mode) => {
  async function mount(answer: () => ServerRowsAnswer<Row>) {
    let api!: StoreApi<DataGridStoreState>;
    const announcements = new Set<unknown>();
    const common = { getRowId: (row: Row) => row.id, fetchRows: async () => answer(), revalidateIntervalMs: 1000 };
    const useServer =
      mode === "scroll"
        ? () => useDataGridServerRows<Row>({ ...common, mode: "scroll", blockSize: 10, overscan: 0, loadDelayMs: 0 })
        : () => useDataGridServerRows<Row>({ ...common, defaultPageSize: 10, pageSizeOptions: [10] });
    function Grid() {
      const server = useServer();
      return (
        <DataGridProvider columns={columns} {...server.providerProps} announceResults>
          <Probe />
          <DataGridRoot {...server.rootProps} />
        </DataGridProvider>
      );
    }
    function Probe() {
      api = useDataGridStoreApi();
      const live = api.getState().liveAnnouncement;
      if (live) announcements.add(live);
      return null;
    }
    render(<Grid />);
    await advance(0);
    const seen = () => {
      const live = api.getState().liveAnnouncement;
      if (live) announcements.add(live);
      return announcements.size;
    };
    return { seen, live: () => api.getState().liveAnnouncement };
  }

  it("reads No results once and stays quiet at each unchanged revalidation", async () => {
    const grid = await mount(() => ({ rows: [], totalRowCount: 0 }));
    expect(grid.live()).toMatchObject({ kind: "results", count: 0 });
    const afterFirst = grid.seen();
    await advance(1000);
    await advance(1000);
    await advance(1000);
    expect(grid.seen()).toBe(afterFirst);
  });

  it("reads the new count when a revalidation of an empty result returns rows", async () => {
    let rows: Row[] = [];
    const grid = await mount(() => ({ rows, totalRowCount: rows.length }));
    const afterFirst = grid.seen();
    rows = [{ id: "a", name: "A" }];
    await advance(1000);
    expect(grid.live()).toMatchObject({ kind: "results", count: 1 });
    expect(grid.seen()).toBe(afterFirst + 1);
  });
});
