import { render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DataGridProvider, useDataGridStoreApi } from ".";
import type { StoreApi } from "zustand/vanilla";
import type { DataGridStoreState } from "./types";

type Row = { id: string; name: string; age: number };
const rows: Row[] = [{ id: "a", name: "Ann", age: 3 }, { id: "b", name: "Bob", age: 1 }];
const columns = [
  { id: "name", header: "Name", accessorKey: "name" as const },
  { id: "age", header: "Age", accessorKey: "age" as const, type: "number" as const },
];

function mount(props: Record<string, unknown>) {
  let api: StoreApi<DataGridStoreState> | null = null;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  const tree = (
    <DataGridProvider data={rows} columns={columns} getRowId={(row) => row.id} {...props}>
      <Probe />
    </DataGridProvider>
  );
  return { tree, state: () => api!.getState() };
}

describe("function seeds for the default sort, filters, search, and layout", () => {
  it("calls a function seed once after mount on the client, never during the server render", () => {
    const readSort = vi.fn(() => [{ columnId: "age", direction: "asc" as const }]);
    const readFilters = vi.fn(() => [{ columnId: "name", operator: "contains" as const, value: "o" }]);
    const readSearch = vi.fn(() => "b");
    const readLayout = vi.fn(() => ({ hidden: ["age"] }));
    const props = { defaultSortState: readSort, defaultFilterState: readFilters, defaultSearchText: readSearch, defaultColumnLayout: readLayout };
    renderToString(mount(props).tree);
    expect(readSort).not.toHaveBeenCalled();
    const onSortChange = vi.fn();
    const grid = mount({ ...props, onSortChange });
    const view = render(grid.tree);
    view.rerender(grid.tree);
    expect(readSort).toHaveBeenCalledTimes(1);
    expect(grid.state().sortState).toEqual([{ columnId: "age", direction: "asc" }]);
    expect(grid.state().filterState).toMatchObject([{ columnId: "name", operator: "contains", value: "o" }]);
    expect(grid.state().searchText).toBe("b");
    expect(grid.state().hiddenColumns).toEqual(["age"]);
    expect(onSortChange).toHaveBeenCalledWith([{ columnId: "age", direction: "asc" }]);
  });

  it("keeps the first state when a seed throws or returns nothing usable", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const grid = mount({ defaultSortState: () => { throw new Error("no storage"); }, defaultFilterState: () => null, defaultSearchText: () => 42 as never });
    render(grid.tree);
    expect(grid.state().sortState).toEqual([]);
    expect(grid.state().filterState).toEqual([]);
    expect(grid.state().searchText).toBe("");
  });
});
