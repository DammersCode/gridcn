import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef } from "../types";
import { DataGridProvider, useDataGridStoreApi, type DataGridProviderProps, type DataGridStoreState, type DataGridSyncProps } from ".";

type Row = { id: string; a: string; b: string; c: string };

const col = (id: keyof Row & string, extra: Partial<ColumnDef<Row, unknown>> = {}): ColumnDef<Row, unknown> => ({
  id,
  header: id.toUpperCase(),
  accessorKey: id,
  ...extra,
});

const twoColumns: readonly ColumnDef<Row, unknown>[] = [col("a"), col("b")];
const threeColumns: readonly ColumnDef<Row, unknown>[] = [col("a"), col("b"), col("c")];

type Props = Partial<DataGridSyncProps<Row>>;

function mount(props: Props) {
  let api: StoreApi<DataGridStoreState> | null = null;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  const grid = (next: Props) => (
    <DataGridProvider defaultData={[]} columns={twoColumns} getRowId={(row) => row.id} {...next}>
      <Probe />
    </DataGridProvider>
  );
  const view = render(grid(props));
  return { store: () => api!, rerender: (next: Props) => view.rerender(grid(next)) };
}

const visibleIds = (store: StoreApi<DataGridStoreState>) => store.getState().visibleColumns.map((column) => column.id);

describe("columns missing from the column order", () => {
  it("renders a column added to columns after a reorder, appended in def order", () => {
    const { store, rerender } = mount({ columns: twoColumns });
    act(() => store().getState().actions.setColumnOrder("b", "a", "before"));
    expect(visibleIds(store())).toEqual(["b", "a"]);

    rerender({ columns: threeColumns });

    expect(visibleIds(store())).toEqual(["b", "a", "c"]);
  });

  it("reorders around a column added after a reorder", () => {
    const { store, rerender } = mount({ columns: twoColumns });
    act(() => store().getState().actions.setColumnOrder("b", "a", "before"));
    rerender({ columns: threeColumns });

    act(() => store().getState().actions.setColumnOrder("a", "c", "after"));

    expect(visibleIds(store())).toEqual(["b", "c", "a"]);
  });

  it("reports the completed order to onColumnLayoutChange after a column is added", () => {
    const onColumnLayoutChange = vi.fn();
    const { store, rerender } = mount({ columns: twoColumns, onColumnLayoutChange });
    act(() => store().getState().actions.setColumnOrder("b", "a", "before"));
    rerender({ columns: threeColumns, onColumnLayoutChange });

    act(() => store().getState().actions.commitColumnWidth("a", 200));

    expect(onColumnLayoutChange).toHaveBeenLastCalledWith(expect.objectContaining({ order: ["b", "a", "c"] }));
  });

  it("renders a column missing from a restored defaultColumnLayout order", () => {
    const { store } = mount({ columns: threeColumns, defaultColumnLayout: { widths: {}, order: ["c", "a"], pins: {}, hidden: [] } });

    expect(visibleIds(store())).toEqual(["c", "a", "b"]);
  });

  it("reorders a column that the stored order lacks", () => {
    const { store } = mount({ columns: threeColumns, defaultColumnLayout: { widths: {}, order: ["c", "a"], pins: {}, hidden: [] } });

    act(() => store().getState().actions.setColumnOrder("b", "c", "before"));

    expect(visibleIds(store())).toEqual(["b", "c", "a"]);
  });
});

describe("defaultColumnLayout normalization", () => {
  const columns: readonly ColumnDef<Row, unknown>[] = [
    col("a", { pinnable: false, minWidth: 80, maxWidth: 200 }),
    col("b"),
    col("c", { minWidth: 60 }),
  ];

  it("drops pins on unpinnable columns, clamps widths, and drops unknown ids", () => {
    const { store } = mount({
      columns,
      defaultColumnLayout: {
        widths: { a: 999, c: 10, ghost: 120 },
        order: ["ghost", "c", "a"],
        pins: { a: "left", b: "right", ghost: "left" },
        hidden: ["ghost"],
      },
    });

    const s = store().getState();
    expect(s.columns.find((column) => column.id === "a")?.pin).toBeUndefined();
    expect(s.columns.find((column) => column.id === "b")?.pin).toBe("right");
    expect(s.columnWidths).toEqual({ a: 200, c: 60 });
    expect(s.columnOrder).toEqual(["c", "a", "b"]);
    expect(s.hiddenColumns).toEqual([]);
  });
});

describe("onColumnLayoutChange on no-op layout actions", () => {
  const columns: readonly ColumnDef<Row, unknown>[] = [col("a", { pin: "left" }), col("b"), col("c", { pinnable: false })];

  function mountWithSpy() {
    const onColumnLayoutChange = vi.fn();
    const { store } = mount({ columns, onColumnLayoutChange });
    return { actions: () => store().getState().actions, store, onColumnLayoutChange };
  }

  it("does not fire when setColumnPin keeps the pin", () => {
    const { actions, onColumnLayoutChange } = mountWithSpy();

    act(() => actions().setColumnPin("a", "left"));
    act(() => actions().setColumnPin("b", null));

    expect(onColumnLayoutChange).not.toHaveBeenCalled();
    act(() => actions().setColumnPin("b", "right"));
    expect(onColumnLayoutChange).toHaveBeenCalledTimes(1);
  });

  it("does not fire when setColumnHidden keeps the visibility, and ignores unknown ids", () => {
    const { actions, store, onColumnLayoutChange } = mountWithSpy();

    act(() => actions().setColumnHidden("b", false));
    act(() => actions().setColumnHidden("ghost", true));

    expect(onColumnLayoutChange).not.toHaveBeenCalled();
    expect(store().getState().hiddenColumns).toEqual([]);
    act(() => actions().setColumnHidden("b", true));
    act(() => actions().setColumnHidden("b", true));
    expect(onColumnLayoutChange).toHaveBeenCalledTimes(1);
  });

  it("does not fire when commitColumnWidth repeats the committed width", () => {
    const { actions, onColumnLayoutChange } = mountWithSpy();

    act(() => actions().setColumnWidth("b", 220));
    act(() => actions().commitColumnWidth("b", 220));
    act(() => actions().commitColumnWidth("b", 220));

    expect(onColumnLayoutChange).toHaveBeenCalledTimes(1);
    act(() => actions().commitColumnWidth("b", 240));
    expect(onColumnLayoutChange).toHaveBeenCalledTimes(2);
  });
});

describe("the column channel follows column identity", () => {
  const selectedColumnIds = (store: StoreApi<DataGridStoreState>) => {
    const s = store.getState();
    return s.selection.columns.toArray().map((col) => s.visibleColumns[col]?.id);
  };

  it("keeps the selected column across a reorder", () => {
    const { store } = mount({ columns: threeColumns });
    act(() => store().getState().actions.selectColumn(0));

    act(() => store().getState().actions.setColumnOrder("a", "c", "after"));

    expect(selectedColumnIds(store())).toEqual(["a"]);
  });

  it("keeps the selected column when a column before it hides, pins, or the consumer swaps columns", () => {
    const { store, rerender } = mount({ columns: threeColumns });
    act(() => store().getState().actions.selectColumn(1));

    act(() => store().getState().actions.setColumnHidden("a", true));
    expect(selectedColumnIds(store())).toEqual(["b"]);

    act(() => store().getState().actions.setColumnPin("c", "left"));
    expect(selectedColumnIds(store())).toEqual(["b"]);

    rerender({ columns: [col("b"), col("a"), col("c")] });
    expect(selectedColumnIds(store())).toEqual(["b"]);
  });

  it("drops a selected column that leaves the view", () => {
    const { store } = mount({ columns: threeColumns });
    act(() => store().getState().actions.selectColumn(1));

    act(() => store().getState().actions.setColumnHidden("b", true));

    expect(selectedColumnIds(store())).toEqual([]);
  });
});

describe("column widths for unknown ids", () => {
  it("setColumnWidth and commitColumnWidth ignore a column id that columns does not define", () => {
    const onColumnLayoutChange = vi.fn();
    const onColumnResizing = vi.fn();
    const { store } = mount({ columns: twoColumns, onColumnLayoutChange, onColumnResizing });

    act(() => store().getState().actions.setColumnWidth("ghost", 200));
    act(() => store().getState().actions.commitColumnWidth("ghost", 200));

    expect(store().getState().columnWidths).toEqual({});
    expect(onColumnResizing).not.toHaveBeenCalled();
    expect(onColumnLayoutChange).not.toHaveBeenCalled();
  });
});

describe("setColumnOrder on a no-op drop", () => {
  it("does not fire onColumnLayoutChange when the drop keeps the order", () => {
    const onColumnLayoutChange = vi.fn();
    const { store } = mount({ columns: twoColumns, onColumnLayoutChange });

    act(() => store().getState().actions.setColumnOrder("a", "b", "before"));

    expect(onColumnLayoutChange).not.toHaveBeenCalled();
    expect(store().getState().columnOrder).toBeNull();
  });

  it("ignores an unknown column id", () => {
    const onColumnLayoutChange = vi.fn();
    const { store } = mount({ columns: twoColumns, onColumnLayoutChange });

    act(() => store().getState().actions.setColumnOrder("ghost", "b", "before"));

    expect(onColumnLayoutChange).not.toHaveBeenCalled();
    expect(store().getState().columnOrder).toBeNull();
  });
});

describe("defaultColumnLayout restored from older or malformed storage", () => {
  it("keeps a def-hidden column hidden when the saved order does not list it", () => {
    const columns: readonly ColumnDef<Row, unknown>[] = [col("a"), col("b"), col("c", { hidden: true })];
    const { store } = mount({ columns, defaultColumnLayout: { widths: {}, order: ["b", "a"], pins: {}, hidden: [] } });

    expect(visibleIds(store())).toEqual(["b", "a"]);
  });

  it("ignores malformed parts instead of throwing", () => {
    const malformed = { widths: "wide", order: { a: 1 }, pins: 5, hidden: "a" } as unknown as DataGridProviderProps<Row>["defaultColumnLayout"];
    const { store } = mount({ columns: threeColumns, defaultColumnLayout: malformed });

    expect(visibleIds(store())).toEqual(["a", "b", "c"]);
    expect(store().getState().columnWidths).toEqual({});
  });
});
