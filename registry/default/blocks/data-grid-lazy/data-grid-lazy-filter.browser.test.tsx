import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { StoreApi } from "zustand/vanilla";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
  type FilterNode,
} from "@/registry/default/blocks/data-grid/data-grid";
import { StoreProbe } from "@/registry/default/blocks/data-grid/test/store-probe.test-helper";
import type { DataGridStoreState } from "@/registry/default/blocks/data-grid/store";
import { useDataGridLazyRows, type LazyFetchContext } from "./use-data-grid-lazy-rows";
import "@/app/global.css";

const ROW_HEIGHT = 36;

type Row = { id: string; name: string };

const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text", width: 180 }] as const);

const spec: FilterNode[] = [{ columnId: "name", operator: "contains", value: "zzz" }];

function LazyGrid(props: { filterMode?: "client" | "server"; defaultFilterState?: FilterNode[]; fetchRows: (ctx: LazyFetchContext) => Promise<Row[]>; onReady: (api: StoreApi<DataGridStoreState>) => void }) {
  const lazy = useDataGridLazyRows<Row>({ total: 10_000, fetchRows: props.fetchRows, getRowId: (row) => row.id, overscan: 5, pageSize: 20 });
  return (
    <DataGridProvider
      data={lazy.gridProps.data}
      columns={columns}
      getRowId={lazy.gridProps.getRowId}
      onDataChange={lazy.onDataChange}
      onRenderedRowsChange={lazy.gridProps.onRenderedRowsChange}
      filterMode={props.filterMode}
      defaultFilterState={props.defaultFilterState}
    >
      <StoreProbe onReady={props.onReady} />
      <DataGridRoot className="h-90 w-100">
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
    </DataGridProvider>
  );
}

const fetchRows = () =>
  vi.fn(async ({ start, end }: LazyFetchContext) => Array.from({ length: end - start }, (_, i) => ({ id: `row-${start + i}`, name: `Person ${start + i}` })));

describe("data-grid-lazy with filterMode server", () => {
  it("keeps the identity view for a spec present at mount, so the first window loads from row 0", async () => {
    const fetch = fetchRows();
    let api!: StoreApi<DataGridStoreState>;
    await render(<LazyGrid filterMode="server" defaultFilterState={spec} fetchRows={fetch} onReady={(a) => (api = a)} />);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(fetch.mock.calls[0]![0].start).toBe(0);
    expect(api.getState().viewIndex).toHaveLength(10_000);
    await vi.waitFor(() => expect(document.body.textContent).toContain("Person 0"));
  });

  it("maps the rendered range to data indices after a filter is applied and the view is scrolled", async () => {
    const fetch = fetchRows();
    let api!: StoreApi<DataGridStoreState>;
    await render(<LazyGrid filterMode="server" fetchRows={fetch} onReady={(a) => (api = a)} />);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    api.getState().actions.setFilters(spec);
    expect(api.getState().viewIndex).toHaveLength(10_000);
    document.querySelector<HTMLElement>('[role="grid"]')!.scrollTop = 500 * ROW_HEIGHT;
    await vi.waitFor(() => expect(fetch.mock.calls.some(([{ start, end }]) => start <= 500 && end > 500)).toBe(true));
    await vi.waitFor(() => expect(document.body.textContent).toContain("Person 500"));
  });

  it("without filterMode the same positive filter empties the view of partial data", async () => {
    const fetch = fetchRows();
    let api!: StoreApi<DataGridStoreState>;
    await render(<LazyGrid defaultFilterState={spec} fetchRows={fetch} onReady={(a) => (api = a)} />);
    await vi.waitFor(() => expect(api).toBeTruthy());
    expect(api.getState().viewIndex).toHaveLength(0);
  });
});
