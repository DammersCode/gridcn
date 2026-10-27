import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef } from "../types";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState, type DataGridSyncProps } from ".";

type Row = { id: string; name: string };

const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];

const rows = (): Row[] => ["a", "b", "c", "d", "e"].map((id) => ({ id, name: id.toUpperCase() }));

const onlyD = [{ filterId: "f", columnId: "name", operator: "equals", value: "D" }];
const onlyE = [{ filterId: "f", columnId: "name", operator: "equals", value: "E" }];

function mount(props: Partial<DataGridSyncProps<Row>> = {}) {
  let api: StoreApi<DataGridStoreState> | null = null;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  const tree = (next: Partial<DataGridSyncProps<Row>>) => (
    <DataGridProvider columns={columns} getRowId={(row: Row) => row.id} defaultData={rows()} {...next}>
      <Probe />
    </DataGridProvider>
  );
  const view = render(tree(props));
  const state = () => api!.getState();
  return {
    state,
    // Merge so a re-render keeps the mount props (announceResults) unless next overrides them.
    rerender: (next: Partial<DataGridSyncProps<Row>>) => view.rerender(tree({ ...props, ...next })),
    check: (...viewRows: number[]) => act(() => viewRows.forEach((r) => state().actions.setRowSelected(r, true))),
    uncheck: (viewRow: number) => act(() => state().actions.setRowSelected(viewRow, false)),
    setAll: (checked: boolean) => act(() => state().actions.setAllRowsSelected(checked)),
    selectRow: (index: number, opts?: { additive?: boolean }) => act(() => state().actions.selectRow(index, opts)),
    filters: (filters: unknown) => act(() => state().actions.setFilters(filters as never)),
    sorts: (sorts: unknown) => act(() => state().actions.setSorts(sorts as never)),
    join: (operator: "and" | "or") => act(() => state().actions.setJoinOperator(operator)),
    search: (text: string) => act(() => state().actions.setSearch(text)),
    clear: () => act(() => state().actions.clearSelection()),
    selection: (rowIds: string[]) =>
      act(() => state().actions.setSelection({ anchor: null, range: null, rangeStack: [], rowIds, columnIds: [] })),
  };
}

describe("liveAnnouncement (checked rows)", () => {
  it("setRowSelected writes the checked total on check and uncheck", () => {
    const m = mount();
    expect(m.state().liveAnnouncement).toBe("");
    m.check(0, 2);
    expect(m.state().liveAnnouncement).toBe("2 rows checked");
    m.uncheck(0);
    expect(m.state().liveAnnouncement).toBe("1 row checked");
  });

  it("selectRow announces the replaced and the extended channel", () => {
    const m = mount();
    m.selectRow(3);
    expect(m.state().liveAnnouncement).toBe("1 row checked");
    m.selectRow(1, { additive: true });
    expect(m.state().liveAnnouncement).toBe("2 rows checked");
  });

  it("setAllRowsSelected announces the full view and the empty set", () => {
    const m = mount();
    m.setAll(true);
    expect(m.state().liveAnnouncement).toBe("5 rows checked");
    m.setAll(false);
    expect(m.state().liveAnnouncement).toBe("0 rows checked");
  });

  it("a no-op check leaves the announcement untouched", () => {
    const m = mount();
    m.check(0);
    m.uncheck(4);
    expect(m.state().liveAnnouncement).toBe("1 row checked");
  });

  it("programmatic setSelection and clearSelection stay quiet", () => {
    const m = mount();
    m.selection(["a", "b"]);
    expect(m.state().liveAnnouncement).toBe("");
    m.clear();
    expect(m.state().liveAnnouncement).toBe("");
  });

  it("stays quiet while row selection is disabled", () => {
    const m = mount({ enableRowSelection: false });
    m.check(0);
    expect(m.state().liveAnnouncement).toBe("");
  });
});

describe("liveAnnouncement (announceResults)", () => {
  it("off by default: filter, sort, and join commits stay quiet", () => {
    const m = mount();
    m.filters(onlyD);
    m.sorts([{ columnId: "name", direction: "asc" }]);
    m.join("or");
    expect(m.state().liveAnnouncement).toBe("");
  });

  it("announces the view count after a filter commit", () => {
    const m = mount({ announceResults: true });
    m.filters(onlyD);
    expect(m.state().viewIndex.length).toBe(1);
    expect(m.state().liveAnnouncement).toBe("1 row");
  });

  it("announces after a sort commit", () => {
    const m = mount({ announceResults: true });
    m.sorts([{ columnId: "name", direction: "asc" }]);
    expect(m.state().liveAnnouncement).toBe("5 rows");
  });

  it("announces after a join-operator commit", () => {
    const m = mount({ announceResults: true });
    m.filters([
      { filterId: "f1", columnId: "name", operator: "equals", value: "D" },
      { filterId: "f2", columnId: "name", operator: "equals", value: "E" },
    ]);
    expect(m.state().liveAnnouncement).toBe("0 rows");
    m.join("or");
    expect(m.state().liveAnnouncement).toBe("2 rows");
  });

  it("announces when the controlled filterState prop changes", () => {
    const m = mount({ announceResults: true, filterState: onlyD as never });
    expect(m.state().liveAnnouncement).toBe("");
    m.rerender({ filterState: onlyE as never });
    expect(m.state().liveAnnouncement).toBe("1 row");
  });

  it("stays quiet with sortMode=\"server\"", () => {
    const m = mount({ announceResults: true, sortMode: "server" });
    m.filters(onlyD);
    expect(m.state().liveAnnouncement).toBe("");
  });

  it("quick search never announces (it never filters)", () => {
    const m = mount({ announceResults: true });
    m.search("B");
    expect(m.state().liveAnnouncement).toBe("");
  });

  it("a data rebuild does not announce (only filter, sort, and join commits do)", () => {
    const m = mount({ announceResults: true });
    m.rerender({ data: rows() });
    expect(m.state().liveAnnouncement).toBe("");
  });
});
