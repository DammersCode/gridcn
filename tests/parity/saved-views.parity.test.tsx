import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useDataGridViews, type UseDataGridViewsResult } from "@/registry/default/blocks/data-grid-views/use-data-grid-views";
import { createMemoryViewsStorage } from "@/registry/default/blocks/data-grid-views/view-storage";
import { emptyViewState, type DataGridViewsDocument } from "@/registry/default/blocks/data-grid-views/view-state";
import { ALL_MODES, mountMode, type Mounted } from "./modes";

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
