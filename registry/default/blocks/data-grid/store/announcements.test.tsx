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
    checkRange: (target: number, opts?: { commit?: boolean }) => act(() => state().actions.checkRowRange(target, opts)),
    cellRange: (height: number) =>
      act(() => {
        state().actions.selectCellAt({ col: 0, row: 0 });
        for (let i = 1; i < height; i++) state().actions.extendSelection("down");
      }),
    setAll: (checked: boolean) => act(() => state().actions.setAllRowsSelected(checked)),
    selectRow: (index: number, opts?: { additive?: boolean }) => act(() => state().actions.selectRow(index, opts)),
    filters: (filters: unknown) => act(() => state().actions.setFilters(filters as never)),
    sorts: (sorts: unknown) => act(() => state().actions.setSorts(sorts as never)),
    joinIntoOrGroup: () => act(() => state().actions.setFilters([{ join: "or", filters: state().filterState }])),
    search: (text: string) => act(() => state().actions.setSearch(text)),
    clear: () => act(() => state().actions.clearSelection()),
    selection: (rowIds: string[]) =>
      act(() => state().actions.setSelection({ anchor: null, range: null, rangeStack: [], rowIds, columnIds: [] })),
  };
}

const checked = (count: number, seq?: number) => ({ kind: "rowsChecked", count, ...(seq === undefined ? {} : { seq }) });
const results = (count: number) => ({ kind: "results", count });

describe("liveAnnouncement (checked rows)", () => {
  it("starts empty", () => {
    expect(mount().state().liveAnnouncement).toBeNull();
  });

  it("setRowSelected records the checked total on check and uncheck", () => {
    const m = mount();
    m.check(0, 2);
    expect(m.state().liveAnnouncement).toMatchObject(checked(2));
    m.uncheck(0);
    expect(m.state().liveAnnouncement).toMatchObject(checked(1));
  });

  it("selectRow records the replaced and the extended channel", () => {
    const m = mount();
    m.selectRow(3);
    expect(m.state().liveAnnouncement).toMatchObject(checked(1));
    m.selectRow(1, { additive: true });
    expect(m.state().liveAnnouncement).toMatchObject(checked(2));
  });

  it("setAllRowsSelected records the full view and the empty set", () => {
    const m = mount();
    m.setAll(true);
    expect(m.state().liveAnnouncement).toMatchObject(checked(5));
    m.setAll(false);
    expect(m.state().liveAnnouncement).toMatchObject(checked(0));
  });

  it("checkRowRange records the final count of a marker range drag", () => {
    const m = mount();
    m.selectRow(0);
    m.checkRange(2);
    m.checkRange(4);
    expect(m.state().liveAnnouncement).toMatchObject(checked(5));
    m.checkRange(1);
    expect(m.state().liveAnnouncement).toMatchObject(checked(2));
  });

  it("checkRowRange without range selection falls back to a single row", () => {
    const m = mount({ enableRangeSelection: false });
    m.checkRange(3);
    expect(m.state().liveAnnouncement).toMatchObject(checked(1));
  });

  it("counts the rows the markers show: rows covered by a cell range count too", () => {
    const m = mount();
    m.cellRange(3);
    m.check(4);
    expect(m.state().liveAnnouncement).toMatchObject(checked(4));
    m.uncheck(1);
    expect(m.state().liveAnnouncement).toMatchObject(checked(3));
  });

  it("every announcement gets a fresh seq, so the same text can repeat", () => {
    const m = mount();
    m.check(0);
    const first = m.state().liveAnnouncement!.seq;
    m.uncheck(0);
    m.check(0);
    expect(m.state().liveAnnouncement).toMatchObject(checked(1));
    expect(m.state().liveAnnouncement!.seq).toBeGreaterThan(first + 1);
  });

  it("no-op writes keep the announcement: uncheck of an unchecked row, check of a checked row, check all when all are checked", () => {
    const m = mount();
    m.check(0);
    m.uncheck(4);
    m.check(0);
    const after = m.state().liveAnnouncement;
    expect(after).toMatchObject(checked(1));
    m.setAll(true);
    const all = m.state().liveAnnouncement;
    m.setAll(true);
    expect(m.state().liveAnnouncement).toBe(all);
    m.setAll(false);
    const none = m.state().liveAnnouncement;
    m.setAll(false);
    expect(m.state().liveAnnouncement).toBe(none);
  });

  it("programmatic setSelection and clearSelection stay quiet", () => {
    const m = mount();
    m.selection(["a", "b"]);
    expect(m.state().liveAnnouncement).toBeNull();
    m.clear();
    expect(m.state().liveAnnouncement).toBeNull();
  });

  it("stays quiet while row selection is disabled", () => {
    const m = mount({ enableRowSelection: false });
    m.check(0);
    expect(m.state().liveAnnouncement).toBeNull();
  });
});

describe("default announcement labels", () => {
  it("group thousands and pluralize", () => {
    const { grid } = mount().state().labels;
    expect(grid.rowsChecked(1500)).toBe("1,500 rows checked");
    expect(grid.rowsChecked(1)).toBe("1 row checked");
    expect(grid.resultsCount(1234)).toBe("1,234 rows");
    expect(grid.resultsCount(1)).toBe("1 row");
  });
});

describe("liveAnnouncement (announceResults)", () => {
  it("off by default: filter and sort commits stay quiet", () => {
    const m = mount();
    m.filters(onlyD);
    m.sorts([{ columnId: "name", direction: "asc" }]);
    m.joinIntoOrGroup();
    expect(m.state().liveAnnouncement).toBeNull();
  });

  it("records the view count after a filter commit", () => {
    const m = mount({ announceResults: true });
    m.filters(onlyD);
    expect(m.state().liveAnnouncement).toMatchObject(results(1));
  });

  it("records after a sort commit", () => {
    const m = mount({ announceResults: true });
    m.sorts([{ columnId: "name", direction: "asc" }]);
    expect(m.state().liveAnnouncement).toMatchObject(results(5));
  });

  it("records after a filter group change", () => {
    const m = mount({ announceResults: true });
    m.filters([
      { filterId: "f1", columnId: "name", operator: "equals", value: "D" },
      { filterId: "f2", columnId: "name", operator: "equals", value: "E" },
    ]);
    expect(m.state().liveAnnouncement).toMatchObject(results(0));
    m.joinIntoOrGroup();
    expect(m.state().liveAnnouncement).toMatchObject(results(2));
  });

  it("records when the controlled filterState prop changes", () => {
    const m = mount({ announceResults: true, filterState: onlyD as never });
    expect(m.state().liveAnnouncement).toBeNull();
    m.rerender({ filterState: onlyE as never });
    expect(m.state().liveAnnouncement).toMatchObject(results(1));
  });

  it("an equal-value controlled prop re-render keeps the checked-row announcement", () => {
    const m = mount({ announceResults: true, filterState: onlyD as never });
    m.check(0);
    const before = m.state().liveAnnouncement;
    m.rerender({ filterState: onlyD.map((f) => ({ ...f })) as never });
    expect(m.state().liveAnnouncement).toBe(before);
  });

  it("an equal controlled filterState without filterId keeps the announcement too", () => {
    const bare = () => [{ columnId: "name", operator: "equals", value: "D" }] as never;
    const m = mount({ announceResults: true, filterState: bare() });
    m.check(0);
    const before = m.state().liveAnnouncement;
    m.rerender({ filterState: bare() });
    expect(m.state().liveAnnouncement).toBe(before);
  });

  it("stays quiet with sortMode=\"server\"", () => {
    const m = mount({ announceResults: true, sortMode: "server" });
    m.filters(onlyD);
    expect(m.state().liveAnnouncement).toBeNull();
  });

  it("quick search never records (it never filters)", () => {
    const m = mount({ announceResults: true });
    m.search("B");
    expect(m.state().liveAnnouncement).toBeNull();
  });

  it("a data rebuild does not record (only filter and sort commits do)", () => {
    const m = mount({ announceResults: true });
    m.rerender({ data: rows() });
    expect(m.state().liveAnnouncement).toBeNull();
  });

  it("a lazy source counts the loaded rows only", () => {
    const sparse = [{ id: "a", name: "A" }, undefined, { id: "c", name: "C" }, undefined, { id: "e", name: "E" }] as unknown as Row[];
    const m = mount({ announceResults: true, defaultData: sparse });
    m.sorts([{ columnId: "name", direction: "asc" }]);
    expect(m.state().liveAnnouncement).toMatchObject(results(3));
  });
});
