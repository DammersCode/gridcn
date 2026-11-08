import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef } from "../types";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState, type DataGridSyncProps } from ".";
import { fullViewOf } from "./compute";

type Row = { id: string; n: number };
const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "n", header: "N", accessorKey: "n" }];
const rows = (count = 10): Row[] => Array.from({ length: count }, (_, i) => ({ id: `r${i}`, n: i }));

function mount(props: Partial<DataGridSyncProps<Row>> = {}) {
  let api: StoreApi<DataGridStoreState> | null = null;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  const tree = (next: Partial<DataGridSyncProps<Row>>) => (
    <DataGridProvider columns={columns} getRowId={(row: Row) => row.id} defaultData={rows()} defaultPageSize={3} {...next}>
      <Probe />
    </DataGridProvider>
  );
  const view = render(tree(props));
  const state = () => api!.getState();
  const shown = () => state().viewIndex.map((i) => (state().data[i] as Row).id);
  return { state, shown, rerender: (next: Partial<DataGridSyncProps<Row>>) => view.rerender(tree(next)) };
}

describe("paging the view", () => {
  it("shows one page and keeps the whole data", () => {
    const m = mount();
    expect(m.shown()).toEqual(["r0", "r1", "r2"]);
    expect(m.state().data).toHaveLength(10);
    expect(fullViewOf(m.state().viewIndex)).toHaveLength(10);
  });

  it("a sort orders every page, not the shown one", () => {
    const m = mount();
    act(() => m.state().actions.setSorts([{ columnId: "n", direction: "desc" }]));
    expect(m.shown()).toEqual(["r9", "r8", "r7"]);
    act(() => m.state().actions.setPage(4));
    expect(m.shown()).toEqual(["r0"]);
  });

  it("a filter narrows across pages and goes back to page 1", () => {
    const onPageChange = vi.fn();
    const m = mount({ onPageChange });
    act(() => m.state().actions.setPage(3));
    act(() => m.state().actions.setFilters([{ columnId: "n", operator: "gte", value: "5" }]));
    expect(m.state().page).toBe(1);
    expect(m.shown()).toEqual(["r5", "r6", "r7"]);
    expect(fullViewOf(m.state().viewIndex)).toHaveLength(5);
    expect(onPageChange).toHaveBeenLastCalledWith(1);
  });

  it("a streamed patch on another page lands in data", () => {
    const m = mount();
    act(() => m.state().actions.updateCells([{ rowId: "r9", columnId: "n", value: 99 }], { source: "stream" }));
    expect((m.state().data[9] as Row).n).toBe(99);
  });

  it("setPageSize keeps the first row of the page on screen", () => {
    const m = mount();
    act(() => m.state().actions.setPage(3));
    expect(m.shown()).toEqual(["r6", "r7", "r8"]);
    act(() => m.state().actions.setPageSize(2));
    expect(m.state().page).toBe(4);
    expect(m.shown()).toEqual(["r6", "r7"]);
  });

  it("a page past the end shows the last page", () => {
    const m = mount({ page: 99 });
    expect(m.shown()).toEqual(["r9"]);
  });

  it("a controlled page waits for the parent and reports the request", () => {
    const onPageChange = vi.fn();
    const m = mount({ page: 1, onPageChange });
    act(() => m.state().actions.setPage(2));
    expect(onPageChange).toHaveBeenCalledWith(2);
    expect(m.shown()).toEqual(["r0", "r1", "r2"]);
    m.rerender({ page: 2, onPageChange });
    expect(m.shown()).toEqual(["r3", "r4", "r5"]);
  });

  it("without pageSize every row shows", () => {
    const m = mount({ defaultPageSize: undefined });
    expect(m.state().viewIndex).toHaveLength(10);
  });
});

describe("paging the view, controlled size", () => {
  it("a controlled pageSize reports the request and waits", () => {
    const onPageSizeChange = vi.fn();
    const m = mount({ defaultPageSize: undefined, pageSize: 3, onPageSizeChange });
    act(() => m.state().actions.setPageSize(5));
    expect(onPageSizeChange).toHaveBeenCalledWith(5);
    expect(m.shown()).toHaveLength(3);
  });
});

describe("paging the view: search and reorder", () => {
  it("quick search counts matches on every page and highlights the shown page", () => {
    const m = mount();
    act(() => m.state().actions.setSearch("9"));
    expect(m.state().searchMatches.map((x) => x.row)).toEqual([9]);
    expect(m.state().searchMatchSet.size).toBe(0);
    act(() => m.state().actions.setPage(4));
    expect(m.state().searchMatchSet.size).toBe(1);
  });

  it("reorderRows moves a row of the shown page by page rows", () => {
    const m = mount();
    act(() => m.state().actions.setPage(2));
    expect(m.shown()).toEqual(["r3", "r4", "r5"]);
    act(() => void m.state().actions.reorderRows(0, 2));
    expect(m.shown()).toEqual(["r4", "r5", "r3"]);
  });

  it("a move on a paged grid keeps the checked rows and the active cell on their rows", () => {
    const m = mount({ enableRowSelection: true });
    act(() => m.state().actions.setPage(2));
    act(() => {
      m.state().actions.setRowSelected(0, true);
      m.state().actions.setRowSelected(1, true);
      m.state().actions.setActiveCellAt({ row: 1, col: 0 });
    });
    expect(m.state().actions.moveRowsBy([0, 1], 1)).toBe(true);
    expect(m.shown()).toEqual(["r5", "r3", "r4"]);
    expect(m.state().selection.rows.toArray()).toEqual([1, 2]);
    expect(m.state().activeCell?.row).toBe(2);
  });

  it("a move that leaves the shown page does nothing", () => {
    const m = mount();
    act(() => m.state().actions.setPage(2));
    expect(m.state().actions.moveRowsBy([2], 1)).toBe(false);
    expect(m.state().actions.moveRowsBy([0], -1)).toBe(false);
    expect(m.state().actions.reorderRows(0, 3)).toBe(false);
    expect(m.state().actions.reorderRows([0, 1], 2)).toBe(false);
    expect(m.shown()).toEqual(["r3", "r4", "r5"]);
    expect(m.state().data.map((row) => (row as Row).id)).toEqual(rows().map((row) => row.id));
  });

  it("a move on a paged grid reports data indices in its operations", () => {
    const onDataChange = vi.fn();
    const m = mount({ onDataChange });
    act(() => m.state().actions.setPage(2));
    act(() => void m.state().actions.reorderRows(0, 2));
    const change = onDataChange.mock.calls.at(-1)![1] as { ops: { type: string; from: number; to: number }[] };
    expect(change.ops).toEqual([expect.objectContaining({ type: "move", from: 3, to: 5 })]);
  });

  it("a move on a paged grid announces page row numbers over the page row count", () => {
    const m = mount();
    act(() => m.state().actions.setPage(2));
    act(() => void m.state().actions.reorderRows(0, 2));
    expect(m.state().rowMoveAnnouncement).toBe("Row 1 moved to position 3 of 3");
    act(() => void m.state().actions.moveRowsBy([0, 1], 1));
    expect(m.state().rowMoveAnnouncement).toBe("2 rows moved to position 2 of 3");
  });

  it("reorderRows stays blocked while a sort is active", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = mount();
    act(() => m.state().actions.setSorts([{ columnId: "n", direction: "desc" }]));
    expect(m.state().actions.reorderRows(0, 1)).toBe(false);
  });
});

describe("totalRowCount default modes", () => {
  const flush = () => act(async () => {});

  it("warns once when totalRowCount makes sorting server-side and nothing handles it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mount({ defaultPageSize: undefined, totalRowCount: 100 });
    await flush();
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("server-side by default"))).toHaveLength(1);
  });

  it("stays quiet with an explicit mode or a handler", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mount({ defaultPageSize: undefined, totalRowCount: 100, sortMode: "client" });
    mount({ defaultPageSize: undefined, totalRowCount: 100, onSortChange: () => {} });
    await flush();
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("server-side by default"))).toHaveLength(0);
  });
});
