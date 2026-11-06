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
type Next = { loading?: boolean; error?: unknown; data?: (Row | undefined)[]; totalRowCount?: number; searchText?: string };

function mount(setup: Setup = {}) {
  let api: StoreApi<DataGridStoreState> | null = null;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  const tree = (next: Next) => (
    <DataGridProvider
      data={(next.data ?? setup.data ?? rows(3)) as Row[]}
      columns={columns}
      getRowId={(row: Row) => row.id}
      announceResults={setup.announceResults ?? true}
      totalRowCount={"totalRowCount" in next ? next.totalRowCount : setup.totalRowCount}
      filterMode={setup.filterMode}
      searchText={next.searchText}
    >
      <Probe />
      <DataGridRoot loading={next.loading} error={next.error} />
    </DataGridProvider>
  );
  const view = render(tree({ loading: true }));
  return {
    live: () => api!.getState().liveAnnouncement,
    rerender: async (next: Next) => {
      view.rerender(tree(next));
      await Promise.resolve();
    },
  };
}

describe("load announcements", () => {
  it("announces the server count when a load that changed it ends", async () => {
    const grid = mount({ totalRowCount: 100, filterMode: "server" });
    expect(grid.live()).toBeNull();
    await grid.rerender({ loading: true, totalRowCount: 1234 });
    await grid.rerender({ loading: false, totalRowCount: 1234 });
    expect(grid.live()).toMatchObject({ kind: "results", count: 1234 });
  });

  it("announces the load that follows a changed search", async () => {
    const grid = mount({ totalRowCount: 7, filterMode: "server" });
    await grid.rerender({ loading: true, searchText: "berlin" });
    await grid.rerender({ loading: false, searchText: "berlin" });
    expect(grid.live()).toMatchObject({ kind: "results", count: 7 });
  });

  it("reads the loaded rows as partial while the count is unknown and rows are missing", async () => {
    const grid = mount({ data: [...rows(2), undefined], filterMode: "server" });
    await grid.rerender({ loading: true, searchText: "x", data: [...rows(2), undefined] });
    await grid.rerender({ loading: false, searchText: "x", data: [...rows(2), undefined] });
    expect(grid.live()).toMatchObject({ kind: "results", count: 2, partial: true });
  });

  it("reads zero when a changed spec returns no rows", async () => {
    const grid = mount({ data: rows(3), filterMode: "server" });
    await grid.rerender({ loading: true, searchText: "zzz" });
    await grid.rerender({ loading: false, searchText: "zzz", data: [], totalRowCount: 0 });
    expect(grid.live()).toMatchObject({ kind: "results", count: 0 });
  });

  it("announces a spec change made before loading turned on", async () => {
    const grid = mount({ data: rows(50), filterMode: "server" });
    await grid.rerender({ loading: false });
    await grid.rerender({ loading: false, searchText: "x", data: rows(3) });
    await grid.rerender({ loading: true, searchText: "x", data: rows(3) });
    await grid.rerender({ loading: false, searchText: "x", data: rows(3) });
    expect(grid.live()).toMatchObject({ kind: "results", count: 3 });
  });

  it("stays quiet when only the client evaluated search changed between loads", async () => {
    const grid = mount({ totalRowCount: 5, filterMode: "client" });
    await grid.rerender({ loading: false });
    await grid.rerender({ loading: false, searchText: "x" });
    await grid.rerender({ loading: true, searchText: "x" });
    await grid.rerender({ loading: false, searchText: "x" });
    expect(grid.live()).toBeNull();
  });

  it("stays quiet for a block fill or page change that changes no spec or count", async () => {
    const grid = mount({ totalRowCount: 10_000, filterMode: "server" });
    await grid.rerender({ loading: false });
    await grid.rerender({ loading: true });
    await grid.rerender({ loading: false });
    expect(grid.live()).toBeNull();
  });

  it("reads the rows that arrive in the same render as the end of the load", async () => {
    const grid = mount({ data: rows(50), filterMode: "server" });
    await grid.rerender({ loading: true, searchText: "x" });
    await grid.rerender({ loading: false, searchText: "x", data: rows(3) });
    expect(grid.live()).toMatchObject({ kind: "results", count: 3 });
  });

  it("leaves a failed load to the alert overlay", async () => {
    const grid = mount({ totalRowCount: 10, filterMode: "server" });
    await grid.rerender({ loading: true, searchText: "x" });
    await grid.rerender({ loading: false, searchText: "x", error: new Error("boom") });
    expect(grid.live()).toBeNull();
  });

  it("announces the result of a retry after a failure", async () => {
    const grid = mount({ totalRowCount: 10, filterMode: "server" });
    await grid.rerender({ loading: false, error: new Error("boom") });
    await grid.rerender({ loading: true });
    await grid.rerender({ loading: false });
    expect(grid.live()).toMatchObject({ kind: "results", count: 10 });
  });

  it("stays silent without announceResults", async () => {
    const quiet = mount({ announceResults: false, totalRowCount: 5 });
    await quiet.rerender({ loading: true, totalRowCount: 6 });
    await quiet.rerender({ loading: false, totalRowCount: 6 });
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
