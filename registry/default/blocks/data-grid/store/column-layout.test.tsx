import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef } from "../types";
import { DataGridProvider, useDataGridStoreApi, type DataGridProviderProps, type DataGridStoreState } from ".";

type Row = { id: string; a: string; b: string; c: string };

const col = (id: keyof Row & string, extra: Partial<ColumnDef<Row, unknown>> = {}): ColumnDef<Row, unknown> => ({
  id,
  header: id.toUpperCase(),
  accessorKey: id,
  ...extra,
});

const twoColumns: readonly ColumnDef<Row, unknown>[] = [col("a"), col("b")];
const threeColumns: readonly ColumnDef<Row, unknown>[] = [col("a"), col("b"), col("c")];

type Props = Partial<DataGridProviderProps<Row>>;

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
