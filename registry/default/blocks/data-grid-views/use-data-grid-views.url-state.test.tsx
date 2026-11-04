import { act, cleanup, render, waitFor } from "@testing-library/react";
import { NuqsTestingAdapter, type UrlUpdateEvent } from "nuqs/adapters/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataGridProvider, defineColumns, useDataGridSearchText } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridUrlState } from "@/registry/default/blocks/data-grid-url-state/data-grid-url-state";
import { useDataGridViews, type UseDataGridViewsResult } from "./use-data-grid-views";
import { createMemoryViewsStorage } from "./view-storage";
import { emptyViewState, type DataGridViewsDocument } from "./view-state";

afterEach(cleanup);

type Row = { id: string; name: string; age: number };
const rows: Row[] = [{ id: "r0", name: "Alice", age: 30 }];
const columns = defineColumns<Row>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 100 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 80 },
] as const);

const doc = (): DataGridViewsDocument => ({
  version: 1,
  defaultViewId: "a",
  views: [{ id: "a", name: "By age", state: { ...emptyViewState(), sorts: [{ columnId: "age", direction: "desc" }], searchText: "bo" } }],
});

function Probe({ onProbe }: { onProbe: (p: { views: UseDataGridViewsResult; search: string }) => void }) {
  const views = useDataGridViews({ storage: createMemoryViewsStorage(doc()) });
  const search = useDataGridSearchText();
  onProbe({ views, search });
  return null;
}

function setup(searchParams: string, onUrlUpdate?: (e: UrlUpdateEvent) => void) {
  const probe: { current: { views: UseDataGridViewsResult; search: string } | null } = { current: null };
  render(
    <NuqsTestingAdapter searchParams={searchParams} onUrlUpdate={onUrlUpdate}>
      <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id}>
        <DataGridUrlState />
        <Probe onProbe={(p) => (probe.current = p)} />
      </DataGridProvider>
    </NuqsTestingAdapter>,
  );
  return probe;
}

describe("useDataGridViews with DataGridUrlState", () => {
  it("lets a URL with params win over the default view", async () => {
    const probe = setup("?q=hello");
    await waitFor(() => expect(probe.current!.views.loading).toBe(false));
    expect(probe.current!.views.activeViewId).toBeNull();
    expect(probe.current!.search).toBe("hello");
  });

  it("applies the default view when the URL carries no state", async () => {
    const probe = setup("");
    await waitFor(() => expect(probe.current!.views.activeViewId).toBe("a"));
    expect(probe.current!.search).toBe("bo");
  });

  it("writes an opened view to the URL", async () => {
    const onUrlUpdate = vi.fn();
    const probe = setup("", onUrlUpdate);
    await waitFor(() => expect(probe.current!.views.activeViewId).toBe("a"));
    await waitFor(() => expect(onUrlUpdate.mock.calls.some(([e]) => String(e.queryString).includes("sort=age"))).toBe(true));
    act(() => probe.current!.views.selectView(null));
    expect(probe.current!.views.activeViewId).toBeNull();
  });
});
