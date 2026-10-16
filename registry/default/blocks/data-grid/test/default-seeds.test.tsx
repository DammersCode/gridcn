import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef } from "../types";
import { DataGridProvider } from "../data-grid";
import { useDataGridStoreApi, type DataGridStoreState, type DataGridSyncProps } from "../store";

type Row = { id: string; name: string; age: number };

const data: Row[] = [
  { id: "1", name: "Charlie", age: 30 },
  { id: "2", name: "Alice", age: 25 },
  { id: "3", name: "Bob", age: 40 },
];

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "age", header: "Age", accessorKey: "age" },
];

type Props = Partial<DataGridSyncProps<Row>>;

function mount(props: Props) {
  let api: StoreApi<DataGridStoreState> | null = null;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  const grid = (next: Props) => (
    <DataGridProvider data={data} columns={columns} {...next}>
      <Probe />
    </DataGridProvider>
  );
  const view = render(grid(props));
  return { state: () => api!.getState(), rerender: (next: Props) => view.rerender(grid(next)) };
}

const viewIds = (s: DataGridStoreState) => s.viewIndex.map((i) => (s.data[i] as Row).id);

afterEach(cleanup);

describe("default seeds", () => {
  it("defaultSortState sorts the first render and stays uncontrolled", () => {
    const { state, rerender } = mount({ defaultSortState: [{ columnId: "age", direction: "asc" }] });
    expect(viewIds(state())).toEqual(["2", "1", "3"]);
    expect(state().sortControlled).toBe(false);
    rerender({ defaultSortState: [{ columnId: "age", direction: "desc" }] });
    expect(viewIds(state())).toEqual(["2", "1", "3"]);
  });

  it("defaultFilterState, defaultJoinOperator and defaultSearchText seed the store", () => {
    const { state } = mount({
      defaultFilterState: [{ columnId: "name", operator: "equals", value: "Alice" }],
      defaultJoinOperator: "or",
      defaultSearchText: "bo",
    });
    expect(viewIds(state())).toEqual(["2"]);
    expect(state().joinOperator).toBe("or");
    expect(state().searchText).toBe("bo");
    expect(state().filterControlled).toBe(false);
  });

  it("the controlled prop wins over its default", () => {
    const { state } = mount({ sortState: [{ columnId: "age", direction: "desc" }], defaultSortState: [{ columnId: "age", direction: "asc" }] });
    expect(viewIds(state())).toEqual(["3", "1", "2"]);
    expect(state().sortControlled).toBe(true);
  });
});

describe("getRowId default", () => {
  it("reads the row's id field when getRowId is omitted", () => {
    const { state } = mount({});
    expect(state().getRowId(data[1]!, 1)).toBe("2");
  });

  it("stringifies a numeric id", () => {
    const { state } = mount({});
    expect(state().getRowId({ id: 7 }, 0)).toBe("7");
  });

  it("throws for a row without an id", () => {
    const { state } = mount({});
    expect(() => state().getRowId({ name: "x" }, 0)).toThrow(/getRowId/);
  });
});
