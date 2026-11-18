import { act, render, waitFor } from "@testing-library/react";
import type { StoreApi } from "zustand/vanilla";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState } from "@/registry/default/blocks/data-grid/store";
import { describe, expect, it } from "vitest";
import { useDataGridViews, type UseDataGridViewsResult } from "@/registry/default/blocks/data-grid-views/use-data-grid-views";
import { createMemoryViewsStorage } from "@/registry/default/blocks/data-grid-views/view-storage";
import { emptyViewState, type DataGridViewsDocument } from "@/registry/default/blocks/data-grid-views/view-state";
import type { ColumnDef } from "@/registry/default/blocks/data-grid/types";
import { ALL_MODES, makeRows, mountMode, type Mounted, type Row } from "./modes";

const document = (): DataGridViewsDocument => ({
  version: 1,
  defaultViewId: null,
  views: [
    {
      id: "v1",
      name: "Big first",
      state: {
        ...emptyViewState(),
        sorts: [{ columnId: "n", direction: "desc" }],
        filters: [{ columnId: "n", operator: "gt", value: "1" }],
        searchText: "Name 3",
      },
    },
    { id: "v3", name: "Neither", state: { ...emptyViewState(), filters: [{ join: "or", not: true, filters: [{ columnId: "n", operator: "lt", value: "1" }, { columnId: "n", operator: "gt", value: "4" }] }] } },
    { id: "v2", name: "Either", state: { ...emptyViewState(), filters: [{ columnId: "n", operator: "lt", value: "1" }, { columnId: "n", operator: "gt", value: "4" }], filterJoin: "or" } },
  ],
});

async function mountViews(mode: (typeof ALL_MODES)[number]): Promise<{ grid: Mounted; views: () => UseDataGridViewsResult }> {
  let latest: UseDataGridViewsResult | null = null;
  const storage = createMemoryViewsStorage(document());
  function Child() {
    latest = useDataGridViews({ storage });
    return null;
  }
  const grid = await mountMode(mode, { Child });
  await waitFor(() => expect(latest?.loading).toBe(false));
  return { grid, views: () => latest! };
}

describe.each(ALL_MODES)("saved views in mode %s", (mode) => {
  it("opening a view sets the sort, filter, and search spec of the grid", async () => {
    const { grid, views } = await mountViews(mode);
    grid.act(() => views().selectView("v1"));
    await waitFor(() => expect(grid.state().sortState).toEqual([{ columnId: "n", direction: "desc" }]));
    expect(grid.state().filterState).toMatchObject([{ columnId: "n", operator: "gt", value: "1" }]);
    expect(grid.state().searchText).toBe("Name 3");
    expect(views().modified).toBe(false);
  });

  it("a view restores the top-level join of its filters", async () => {
    const { grid, views } = await mountViews(mode);
    grid.act(() => views().selectView("v2"));
    await waitFor(() => expect(grid.state().filterJoin).toBe("or"));
    grid.act(() => views().selectView("v1"));
    await waitFor(() => expect(grid.state().filterJoin).toBe("and"));
  });

  it("a view restores a negated filter group", async () => {
    const { grid, views } = await mountViews(mode);
    grid.act(() => views().selectView("v3"));
    await waitFor(() => expect(grid.state().filterState).toMatchObject([{ join: "or", not: true }]));
    grid.act(() => views().selectView("v1"));
    await waitFor(() => expect(grid.state().filterState).toMatchObject([{ columnId: "n", operator: "gt" }]));
  });

  it("a saved view restores the spec after the grid changed", async () => {
    const { grid, views } = await mountViews(mode);
    grid.setSorts([{ columnId: "n", direction: "asc" }]);
    grid.act(() => void views().saveView("Ascending"));
    grid.setSorts([]);
    await waitFor(() => expect(views().modified).toBe(true));
    const saved = views().views.find((v) => v.name === "Ascending")!;
    grid.act(() => views().selectView(saved.id));
    await waitFor(() => expect(grid.state().sortState).toEqual([{ columnId: "n", direction: "asc" }]));
  });
});

describe("saved views under a server filter with fetchFilterValues", () => {
  it("keeps set-filter values the static choices do not list", async () => {
    const stored: DataGridViewsDocument = {
      version: 1,
      defaultViewId: null,
      views: [{ id: "v1", name: "Many", state: { ...emptyViewState(), filters: [{ columnId: "name", operator: "isAnyOf", value: ["x", "y", "z"] }] } }],
    };
    let latest: UseDataGridViewsResult | null = null;
    let api: StoreApi<DataGridStoreState> | null = null;
    function Child() {
      latest = useDataGridViews({ storage: createMemoryViewsStorage(stored) });
      api = useDataGridStoreApi();
      return null;
    }
    const choiceColumns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name", options: { choices: ["a", "b"] } }];
    render(
      <DataGridProvider columns={choiceColumns} defaultData={makeRows()} getRowId={(r: Row) => r.id} fetchFilterValues={async () => ({ values: [] })}>
        <Child />
      </DataGridProvider>,
    );
    await waitFor(() => expect(latest?.loading).toBe(false));
    act(() => latest!.selectView("v1"));
    await waitFor(() => expect(api!.getState().filterState).toMatchObject([{ columnId: "name", operator: "isAnyOf", value: ["x", "y", "z"] }]));
  });
});

describe.each(ALL_MODES)("saved views keep the group columns in mode %s", (mode) => {
  const mountGrouped = async () => {
    let latest: UseDataGridViewsResult | null = null;
    const storage = createMemoryViewsStorage({ version: 1, defaultViewId: null, views: [{ id: "g", name: "By name", state: { ...emptyViewState(), groupBy: ["name", "gone"] } }] });
    function Child() {
      latest = useDataGridViews({ storage });
      return null;
    }
    const grid = await mountMode(mode, { Child, props: { defaultGroupBy: [] } });
    await waitFor(() => expect(latest?.loading).toBe(false));
    return { grid, views: () => latest! };
  };

  it("opening a view sets groupBy and drops a column the grid lacks", async () => {
    const { grid, views } = await mountGrouped();
    grid.act(() => views().selectView("g"));
    await waitFor(() => expect(grid.state().groupBy).toEqual(["name"]));
    expect(views().modified).toBe(false);
  });

  it("a saved view restores the group columns and leaves the expanded state out", async () => {
    const { grid, views } = await mountGrouped();
    act(() => grid.state().actions.setGroupBy(["n"]));
    act(() => grid.state().actions.setExpanded({ mode: "expanded", ids: [] }));
    grid.act(() => void views().saveView("Grouped"));
    act(() => grid.state().actions.setGroupBy([]));
    await waitFor(() => expect(views().modified).toBe(true));
    const saved = views().views.find((v) => v.name === "Grouped")!;
    expect(JSON.stringify(saved.state)).not.toContain("expanded");
    grid.act(() => views().selectView(saved.id));
    await waitFor(() => expect(grid.state().groupBy).toEqual(["n"]));
  });
});
