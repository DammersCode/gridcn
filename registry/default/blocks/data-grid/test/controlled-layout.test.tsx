import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef } from "../types";
import { DataGridProvider } from "../data-grid";
import { useDataGridStoreApi, type DataGridStoreState, type DataGridSyncProps } from "../store";

type Row = { id: string; a: string; b: string; c: string };

const col = (id: keyof Row & string, extra: Partial<ColumnDef<Row, unknown>> = {}): ColumnDef<Row, unknown> => ({
  id,
  header: id.toUpperCase(),
  accessorKey: id,
  ...extra,
});

const data: Row[] = [
  { id: "1", a: "a1", b: "b1", c: "c1" },
  { id: "2", a: "a2", b: "b2", c: "c2" },
  { id: "3", a: "a3", b: "b3", c: "c3" },
];

const twoColumns: readonly ColumnDef<Row, unknown>[] = [col("a"), col("b")];
const threeColumns: readonly ColumnDef<Row, unknown>[] = [col("a"), col("b"), col("c")];

// Module-scoped so re-renders pass the same identity: the echo-sync early return requires it.
const getRowId = (row: Row) => row.id;

type Props = Partial<DataGridSyncProps<Row>>;

function mount(props: Props) {
  let api: StoreApi<DataGridStoreState> | null = null;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  const grid = (next: Props) => (
    <DataGridProvider data={data} columns={twoColumns} getRowId={getRowId} {...next}>
      <Probe />
    </DataGridProvider>
  );
  const view = render(grid(props));
  return {
    store: () => api!,
    actions: () => api!.getState().actions,
    rerender: (next: Props) => view.rerender(grid(next)),
  };
}

const visibleIds = (store: StoreApi<DataGridStoreState>) => store.getState().visibleColumns.map((column) => column.id);

describe("actions.setColumnLayout", () => {
  it("replaces the given parts, keeps the omitted ones, and fires once", () => {
    const onColumnLayoutChange = vi.fn();
    const { store, actions } = mount({ onColumnLayoutChange });
    act(() => actions().setColumnLayout({ widths: { a: 150 } }));

    expect(onColumnLayoutChange).toHaveBeenCalledTimes(1);
    const layout = onColumnLayoutChange.mock.calls[0]![0];
    expect(layout.widths).toEqual({ a: 150 });
    expect(layout.order).toEqual(["a", "b"]);
    expect(layout.pins).toEqual({});
    expect(layout.hidden).toEqual([]);
    expect(store().getState().columnWidths).toEqual({ a: 150 });
  });

  it("does not fire or write when the parts keep the layout", () => {
    const onColumnLayoutChange = vi.fn();
    const { store, actions } = mount({ onColumnLayoutChange });
    act(() => actions().setColumnLayout({ widths: { a: 150 } }));
    const snapshot = store().getState().columnLayout;

    act(() => actions().setColumnLayout({ widths: { a: 150 } }));

    expect(onColumnLayoutChange).toHaveBeenCalledTimes(1);
    expect(store().getState().columnLayout).toBe(snapshot);
  });

  it("applies order and hidden parts", () => {
    const onColumnLayoutChange = vi.fn();
    const { store, actions } = mount({ onColumnLayoutChange });
    act(() => actions().setColumnLayout({ order: ["b", "a"] }));
    expect(visibleIds(store())).toEqual(["b", "a"]);
    act(() => actions().setColumnLayout({ hidden: ["a"] }));
    expect(visibleIds(store())).toEqual(["b"]);
    expect(onColumnLayoutChange).toHaveBeenCalledTimes(2);
  });
});

describe("the controlled columnLayout prop", () => {
  it("applies a new (non-echo) value silently and updates the snapshot", () => {
    const onColumnLayoutChange = vi.fn();
    const { store, rerender } = mount({ onColumnLayoutChange });

    rerender({ onColumnLayoutChange, columnLayout: { widths: { a: 200 } } });

    expect(onColumnLayoutChange).not.toHaveBeenCalled();
    expect(store().getState().columnWidths).toEqual({ a: 200 });
    expect(store().getState().columnLayout.widths).toEqual({ a: 200 });
  });

  it("an echo sync (feeding back a fired snapshot) writes nothing to the store", () => {
    const onColumnLayoutChange = vi.fn();
    const { store, rerender } = mount({ onColumnLayoutChange });
    const seen: DataGridStoreState[] = [];
    const unsub = store().subscribe((state) => {
      seen.push(state);
    });
    act(() => store().getState().actions.commitColumnWidth("a", 180));
    expect(onColumnLayoutChange).toHaveBeenCalledTimes(1);
    const fired = onColumnLayoutChange.mock.calls[0]![0];
    const stateBefore = store().getState();
    const notificationsBefore = seen.length;

    rerender({ onColumnLayoutChange, columnLayout: fired });

    unsub();
    expect(seen.length).toBe(notificationsBefore);
    expect(store().getState()).toBe(stateBefore);
  });

  it("a widths-only control keeps a user reorder (omitted parts stay uncontrolled)", () => {
    const { store, rerender } = mount({});
    act(() => store().getState().actions.setColumnOrder("b", "a", "before"));

    rerender({ columnLayout: { widths: { a: 120 } } });

    expect(visibleIds(store())).toEqual(["b", "a"]);
    expect(store().getState().columnWidths).toEqual({ a: 120 });
  });

  it("normalizes through the prop: unknown ids dropped, missing ids appended, widths clamped, unpinnable pins dropped", () => {
    const columns: readonly ColumnDef<Row, unknown>[] = [
      col("a", { pinnable: false, minWidth: 80, maxWidth: 200 }),
      col("b"),
      col("c", { minWidth: 60 }),
    ];
    const { store, rerender } = mount({ columns });

    rerender({
      columns,
      columnLayout: {
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

  it("a new columns array re-applies the controlled parts over the new defs", () => {
    const { store, rerender } = mount({ columns: twoColumns, columnLayout: { pins: { a: "left" } } });
    expect(store().getState().columns.find((column) => column.id === "a")?.pin).toBe("left");

    rerender({ columns: threeColumns, columnLayout: { pins: { a: "left" } } });

    expect(store().getState().columns.find((column) => column.id === "a")?.pin).toBe("left");
    expect(visibleIds(store())).toEqual(["a", "b", "c"]);
  });

  it("a columns swap followed by a pin fires exactly once", () => {
    const onColumnLayoutChange = vi.fn();
    const { store, rerender } = mount({ columns: twoColumns, onColumnLayoutChange, columnLayout: { pins: { a: "left" } } });

    rerender({ columns: threeColumns, onColumnLayoutChange, columnLayout: { pins: { a: "left" } } });
    expect(onColumnLayoutChange).not.toHaveBeenCalled();

    act(() => store().getState().actions.setColumnPin("c", "left"));
    expect(onColumnLayoutChange).toHaveBeenCalledTimes(1);
  });
});
