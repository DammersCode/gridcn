import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef, ColumnGroupDef } from "../types";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState, type DataGridSyncProps } from ".";

type Row = { id: string };

const col = (id: string, extra: Partial<ColumnDef<Row, unknown>> = {}): ColumnDef<Row, unknown> => ({ id, header: id.toUpperCase(), accessorFn: () => id, ...extra });

const columns: readonly ColumnDef<Row, unknown>[] = [col("a"), col("b"), col("c"), col("d"), col("e")];
const groups: readonly ColumnGroupDef[] = [{ id: "ab", header: "AB", children: ["a", "b"] }];

type Props = Partial<DataGridSyncProps<Row>>;

function mount(props: Props) {
  let api: StoreApi<DataGridStoreState> | null = null;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  const grid = (next: Props) => (
    <DataGridProvider defaultData={[]} columns={columns} getRowId={(row) => row.id} {...next}>
      <Probe />
    </DataGridProvider>
  );
  const view = render(grid(props));
  return { store: () => api!, rerender: (next: Props) => view.rerender(grid(next)) };
}

const visibleIds = (store: StoreApi<DataGridStoreState>) => store.getState().visibleColumns.map((column) => column.id);

describe("column groups and the column layout", () => {
  it("fires no event when a split order repairs to the current layout", () => {
    const onColumnLayoutChange = vi.fn();
    const { store } = mount({ columnGroups: groups, onColumnLayoutChange });

    act(() => store().getState().actions.setColumnLayout({ order: ["a", "c", "b", "d", "e"] }));

    expect(visibleIds(store())).toEqual(["a", "b", "c", "d", "e"]);
    expect(onColumnLayoutChange).toHaveBeenCalledTimes(0);
  });

  it("fires once with the repaired order when the repair changes the layout", () => {
    const onColumnLayoutChange = vi.fn();
    const { store } = mount({ columnGroups: groups, onColumnLayoutChange });

    act(() => store().getState().actions.setColumnLayout({ order: ["c", "a", "d", "b", "e"] }));

    expect(visibleIds(store())).toEqual(["c", "a", "b", "d", "e"]);
    expect(onColumnLayoutChange).toHaveBeenCalledTimes(1);
    expect(onColumnLayoutChange).toHaveBeenCalledWith(expect.objectContaining({ order: ["c", "a", "b", "d", "e"] }));
  });

  it("repairs a split defaultColumnLayout order and a split def order", () => {
    const { store } = mount({ columnGroups: groups, defaultColumnLayout: { order: ["b", "c", "a", "d", "e"] } });
    expect(visibleIds(store())).toEqual(["b", "a", "c", "d", "e"]);
    expect(store().getState().columnLayout.order).toEqual(["b", "a", "c", "d", "e"]);

    const split = mount({ columns: [col("a"), col("x"), col("b")], columnGroups: groups });
    expect(visibleIds(split.store())).toEqual(["a", "b", "x"]);
  });

  it("repairs a controlled columnLayout whose order splits a group", () => {
    const { store } = mount({ columnGroups: groups, columnLayout: { order: ["a", "c", "b", "d", "e"] } });
    expect(visibleIds(store())).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("applies new groups to an already reordered grid without firing a layout event", () => {
    const onColumnLayoutChange = vi.fn();
    const { store, rerender } = mount({ onColumnLayoutChange });
    act(() => store().getState().actions.setColumnOrder("a", "c", "after"));
    expect(visibleIds(store())).toEqual(["b", "c", "a", "d", "e"]);
    onColumnLayoutChange.mockClear();

    rerender({ columnGroups: groups, onColumnLayoutChange });

    expect(visibleIds(store())).toEqual(["b", "a", "c", "d", "e"]);
    expect(store().getState().columnLayout.order).toEqual(["b", "a", "c", "d", "e"]);
    expect(onColumnLayoutChange).not.toHaveBeenCalled();
  });

  it("keeps the model identity for an inline literal with the same structure", () => {
    const { store, rerender } = mount({ columnGroups: [{ id: "ab", header: "AB", children: ["a", "b"] }] });
    const first = store().getState().columnGroupModel;
    rerender({ columnGroups: [{ id: "ab", header: "AB", children: ["a", "b"] }] });
    expect(store().getState().columnGroupModel).toBe(first);
    rerender({ columnGroups: [{ id: "ab", header: "AB2", children: ["a", "b"] }] });
    expect(store().getState().columnGroupModel).not.toBe(first);
  });

  it("moves a column only inside its group and a column next to a whole group", () => {
    const { store } = mount({ columnGroups: groups });
    const { setColumnOrder } = store().getState().actions;

    act(() => setColumnOrder("a", "c", "after"));
    expect(visibleIds(store())).toEqual(["a", "b", "c", "d", "e"]);

    act(() => setColumnOrder("a", "b", "after"));
    expect(visibleIds(store())).toEqual(["b", "a", "c", "d", "e"]);

    act(() => setColumnOrder("d", "a", "before"));
    expect(visibleIds(store())).toEqual(["d", "b", "a", "c", "e"]);
  });

  it("warns once in development for an unknown column id", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bad: readonly ColumnGroupDef[] = [{ id: "g", header: "G", children: ["a", "ghost"] }];
    const { rerender } = mount({ columnGroups: bad });
    rerender({ columnGroups: [{ id: "g", header: "G", children: ["a", "ghost"] }] });
    expect(warn.mock.calls.filter(([message]) => String(message).includes("ghost"))).toHaveLength(1);
    warn.mockRestore();
  });
});
