import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import { DataGridProvider, DataGridRoot, defineColumns, type ServerSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridStoreApi } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import type { DataGridStoreState } from "@/registry/default/blocks/data-grid/store";
import { useDataGridServerRows, type ServerRowsAnswer, type UseDataGridServerRowsResult, type UseDataGridServerRowsScrollResult } from "./data-grid-server";

type Row = { id: string; name: string };
const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text" }] as const);
const rows = Array.from({ length: 20 }, (_, i): Row => ({ id: `r${i}`, name: `Person ${i}` }));
const filters = [
  { columnId: "name", operator: "contains", value: "1" },
  { columnId: "name", operator: "contains", value: "2" },
];

afterEach(() => vi.restoreAllMocks());

function mount(mode: "pages" | "scroll", hookOptions: { defaultSpec?: Partial<ServerSpec>; onSpecChange?: (spec: ServerSpec) => void } = {}) {
  const specs: ServerSpec[] = [];
  let server!: UseDataGridServerRowsResult<Row> | UseDataGridServerRowsScrollResult<Row>;
  let store!: StoreApi<DataGridStoreState>;
  function Probe() {
    store = useDataGridStoreApi() as unknown as StoreApi<DataGridStoreState>;
    return null;
  }
  function Harness() {
    const answer = async ({ spec, start, end }: { spec: ServerSpec; start: number; end: number }): Promise<ServerRowsAnswer<Row>> => {
      specs.push(spec);
      return { rows: rows.slice(start, end), totalRowCount: rows.length };
    };
    server =
      mode === "pages"
        ? useDataGridServerRows<Row>({ getRowId: (r) => r.id, fetchRows: answer, defaultPageSize: 10, pageSizeOptions: [10], ...hookOptions })
        : useDataGridServerRows<Row, number>({ mode: "scroll", loadDelayMs: 0, blockSize: 10, overscan: 0, getRowId: (r) => r.id, fetchRows: answer as never, ...hookOptions });
    return (
      <DataGridProvider {...server.gridProps} columns={columns}>
        <DataGridRoot aria-label="People">
          <Probe />
        </DataGridRoot>
      </DataGridProvider>
    );
  }
  render(<Harness />);
  return { specs, state: () => store.getState(), gridProps: () => server.gridProps as { filterJoin: string } };
}

describe.each(["pages", "scroll"] as const)("the root filter join, %s mode", (mode) => {
  it("reads and from a spec without filterJoin", async () => {
    const t = mount(mode, { defaultSpec: { filters } });
    await waitFor(() => expect(t.specs.length).toBeGreaterThan(0));
    expect(t.gridProps().filterJoin).toBe("and");
    expect("filterJoin" in t.specs[0]!).toBe(false);
  });

  it("seeds or from defaultSpec and sends it with the request", async () => {
    const t = mount(mode, { defaultSpec: { filters, filterJoin: "or" } });
    await waitFor(() => expect(t.specs.length).toBeGreaterThan(0));
    expect(t.gridProps().filterJoin).toBe("or");
    expect(t.state().filterJoin).toBe("or");
    expect(t.specs[0]!.filterJoin).toBe("or");
  });

  it("fetches again with the changed join, reports it through onSpecChange, and drops it for and", async () => {
    const onSpecChange = vi.fn();
    const t = mount(mode, { defaultSpec: { filters }, onSpecChange });
    await waitFor(() => expect(t.specs.length).toBeGreaterThan(0));
    const before = t.specs.length;
    act(() => t.state().actions.setFilterJoin("or"));
    await waitFor(() => expect(t.specs.length).toBeGreaterThan(before));
    expect(t.specs.at(-1)!.filterJoin).toBe("or");
    expect(onSpecChange.mock.lastCall![0].filterJoin).toBe("or");
    act(() => t.state().actions.setFilterJoin("and"));
    await waitFor(() => expect("filterJoin" in onSpecChange.mock.lastCall![0]).toBe(false));
  });
});
