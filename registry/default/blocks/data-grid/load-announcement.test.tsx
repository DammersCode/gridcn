import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import { DataGridProvider, DataGridRoot, type ColumnDef } from "./data-grid";
import { useDataGridStoreApi, type DataGridStoreState } from "./store";

type Row = { id: string; name: string };

const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];
const rows = (count: number): (Row | undefined)[] => Array.from({ length: count }, (_, i) => ({ id: `r${i}`, name: `Name ${i}` }));

afterEach(cleanup);

type Setup = { data?: (Row | undefined)[]; totalRowCount?: number; announceResults?: boolean; filterMode?: "client" | "server" };

function mount(setup: Setup = {}) {
  let api: StoreApi<DataGridStoreState> | null = null;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  const tree = (root: { loading?: boolean; error?: unknown }) => (
    <DataGridProvider
      data={(setup.data ?? rows(3)) as Row[]}
      columns={columns}
      getRowId={(row: Row) => row.id}
      announceResults={setup.announceResults ?? true}
      totalRowCount={setup.totalRowCount}
      filterMode={setup.filterMode}
    >
      <Probe />
      <DataGridRoot {...root} />
    </DataGridProvider>
  );
  const view = render(tree({ loading: true }));
  return { live: () => api!.getState().liveAnnouncement, rerender: (root: { loading?: boolean; error?: unknown }) => view.rerender(tree(root)) };
}

describe("load announcements", () => {
  it("announces the server count when a load ends", () => {
    const grid = mount({ totalRowCount: 1234, filterMode: "server" });
    expect(grid.live()).toBeNull();
    grid.rerender({ loading: false });
    expect(grid.live()).toMatchObject({ kind: "results", count: 1234 });
  });

  it("announces the loaded rows as partial while the count is unknown and rows are missing", () => {
    const grid = mount({ data: [...rows(2), undefined] });
    grid.rerender({ loading: false });
    expect(grid.live()).toMatchObject({ kind: "results", count: 2, partial: true });
  });

  it("announces zero results after a load that returns no rows", () => {
    const grid = mount({ data: [], totalRowCount: 0, filterMode: "server" });
    grid.rerender({ loading: false });
    expect(grid.live()).toMatchObject({ kind: "results", count: 0 });
  });

  it("announces the failure when a load ends in an error", () => {
    const grid = mount({ totalRowCount: 10, filterMode: "server" });
    grid.rerender({ loading: false, error: new Error("boom") });
    expect(grid.live()).toMatchObject({ kind: "loadError" });
  });

  it("announces again after a retry", () => {
    const grid = mount({ totalRowCount: 10, filterMode: "server" });
    grid.rerender({ loading: false, error: new Error("boom") });
    const first = grid.live()?.seq;
    grid.rerender({ loading: true, error: new Error("boom") });
    grid.rerender({ loading: false });
    expect(grid.live()).toMatchObject({ kind: "results", count: 10 });
    expect(grid.live()!.seq).toBeGreaterThan(first!);
  });

  it("stays silent without announceResults and when nothing was loading", () => {
    const quiet = mount({ announceResults: false, totalRowCount: 5 });
    quiet.rerender({ loading: false });
    expect(quiet.live()).toBeNull();
  });
});

describe("empty and error presentation", () => {
  function renderRoot(setup: { data: Row[]; filterMode?: "client" | "server"; filterState?: never[] | { columnId: string; operator: string; value: string }[]; root?: Record<string, unknown> }) {
    return render(
      <DataGridProvider data={setup.data} columns={columns} getRowId={(row: Row) => row.id} filterMode={setup.filterMode} filterState={setup.filterState as never}>
        <DataGridRoot {...setup.root} />
      </DataGridProvider>,
    );
  }
  const empty = () => document.querySelector("[data-grid-empty-state]")?.textContent;
  const miss = [{ columnId: "name", operator: "equals", value: "nothing" }];

  it("says No rows when the data is empty and nothing filters", () => {
    renderRoot({ data: [] });
    expect(empty()).toBe("No rows");
  });

  it("says No results when a server filter leaves zero rows", () => {
    renderRoot({ data: [], filterMode: "server", filterState: miss });
    expect(empty()).toBe("No results");
  });

  it("says No results when a client filter hides every row", () => {
    renderRoot({ data: rows(2) as Row[], filterState: miss });
    expect(empty()).toBe("No results");
  });

  it("shows the error overlay with Retry instead of the empty state when a fetch failed", () => {
    renderRoot({ data: [], filterMode: "server", root: { error: new Error("x"), onRetry: () => {} } });
    expect(document.querySelector("[data-grid-error-state]")?.getAttribute("role")).toBe("alert");
    expect(empty()).toBeUndefined();
  });
});
