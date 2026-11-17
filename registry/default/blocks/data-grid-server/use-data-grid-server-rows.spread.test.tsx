import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import { DataGridProvider, DataGridRoot, defineColumns, type DataGridPlugin } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridStoreApi } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import type { DataGridStoreState } from "@/registry/default/blocks/data-grid/store";
import { useDataGridServerRows, type ServerRowsAnswer, type ServerRowsPageRequest, type ServerRowsRequest, type UseDataGridServerRowsResult, type UseDataGridServerRowsScrollResult } from "./use-data-grid-server-rows";

type Row = { id: string; name: string };
const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text" }] as const);
const rowsOf = (start: number, end: number): Row[] => Array.from({ length: end - start }, (_, i) => ({ id: `r${start + i}`, name: `Person ${start + i}` }));
let fetchCount = 0;
const fetchRows = async ({ start, end }: ServerRowsRequest<number>): Promise<ServerRowsAnswer<Row, number>> => (fetchCount++, { rows: rowsOf(start, Math.min(end, 40)), totalRowCount: 40 });
const fetchPage = async ({ start, end }: ServerRowsPageRequest): Promise<ServerRowsAnswer<Row>> => (fetchCount++, { rows: rowsOf(start, Math.min(end, 40)), totalRowCount: 40 });

afterEach(() => vi.restoreAllMocks());

const wiringWarnings = (warn: { mock: { calls: unknown[][] } }) => warn.mock.calls.filter(([message]) => !String(message).includes("`pager`"));

function mount(mode: "pages" | "scroll", after: { onDataChange?: () => void; onRenderedRowsChange?: () => void; onSortChange?: () => void; onFilterChange?: () => void; plugins?: readonly DataGridPlugin<unknown>[]; onSave?: () => Promise<void> }, hookOptions: { onSave?: () => Promise<void> } = {}) {
  let server!: UseDataGridServerRowsResult<Row> | UseDataGridServerRowsScrollResult<Row>;
  let store!: StoreApi<DataGridStoreState>;
  function Probe() {
    store = useDataGridStoreApi() as unknown as StoreApi<DataGridStoreState>;
    return null;
  }
  function Harness() {
    server =
      mode === "pages"
        ? useDataGridServerRows<Row>({ getRowId: (r) => r.id, fetchRows: fetchPage, defaultPageSize: 10, pageSizeOptions: [10], ...hookOptions })
        : useDataGridServerRows<Row, number>({ mode: "scroll", loadDelayMs: 0, blockSize: 10, overscan: 0, getRowId: (r) => r.id, fetchRows, ...hookOptions });
    return (
      <DataGridProvider {...server.gridProps} columns={columns} {...after}>
        <DataGridRoot aria-label="People">
          <Probe />
        </DataGridRoot>
      </DataGridProvider>
    );
  }
  render(<Harness />);
  return { fetches: () => fetchCount, server: () => server, state: () => store.getState() };
}

describe.each(["pages", "scroll"] as const)("an onDataChange prop after the gridProps spread, %s mode", (mode) => {
  it("runs, and the hook still keeps the edit", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mine = vi.fn();
    const t = mount(mode, { onDataChange: mine });
    await waitFor(() => expect(t.server().gridProps.data[1]).toBeDefined());
    act(() => t.state().actions.commitCellValue({ rowId: "r1", columnId: "name" }, "Edited"));
    expect(mine).toHaveBeenCalledTimes(1);
    expect(t.server().gridProps.data[1]?.name).toBe("Edited");
    expect(warn.mock.calls.some((c) => String(c[0]).includes("merge did not run"))).toBe(false);
  });
});

describe("an onRenderedRowsChange prop after the gridProps spread, scroll mode", () => {
  it("runs next to the hook's handler, so rows still load", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mine = vi.fn();
    const t = mount("scroll", { onRenderedRowsChange: mine });
    await waitFor(() => expect(t.server().gridProps.data[1]).toBeDefined());
    act(() => t.state().onRenderedRowsChange?.({ start: 0, end: 5 }));
    expect(mine).toHaveBeenCalledTimes(1);
    expect(wiringWarnings(warn)).toHaveLength(0);
  });
});

describe.each(["pages", "scroll"] as const)("a plugins prop after the gridProps spread, %s mode", (mode) => {
  it("mounts next to the refresh guard", async () => {
    const mounted = vi.fn();
    const mine: DataGridPlugin<unknown> = {
      name: "mine",
      Mount: () => {
        mounted();
        return null;
      },
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = mount(mode, { plugins: [mine] });
    await waitFor(() => expect(t.server().gridProps.data[1]).toBeDefined());
    expect(mounted).toHaveBeenCalled();
    expect(t.state().plugins.list.map((p) => p.name)).toEqual([...t.server().gridProps.plugins.map((p) => p.name), "mine"]);
    expect(wiringWarnings(warn)).toHaveLength(0);
  });
});

describe.each(["pages", "scroll"] as const)("onSortChange and onFilterChange props after the gridProps spread, %s mode", (mode) => {
  it("run next to the hook's, which still owns the spec", async () => {
    const onSortChange = vi.fn();
    const onFilterChange = vi.fn();
    const t = mount(mode, { onSortChange, onFilterChange });
    await waitFor(() => expect(t.server().gridProps.data[1]).toBeDefined());
    act(() => t.state().actions.setSorts([{ columnId: "name", direction: "asc" }]));
    expect(onSortChange).toHaveBeenCalledTimes(1);
    expect(t.server().spec.sorts).toHaveLength(1);
    act(() => t.state().actions.setFilters([{ type: "condition", columnId: "name", operator: "contains", value: "x" } as never]));
    expect(onFilterChange).toHaveBeenCalledTimes(1);
    expect(t.server().spec.filters).toHaveLength(1);
  });
});

describe.each(["pages", "scroll"] as const)("an onSave prop after the gridProps spread, %s mode", (mode) => {
  it("runs in place of the hook option and still triggers refreshAfterSave", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mine = vi.fn(async () => {});
    const t = mount(mode, { onSave: mine });
    await waitFor(() => expect(t.server().gridProps.data[1]).toBeDefined());
    const fetched = t.fetches();
    act(() => t.state().actions.commitCellValue({ rowId: "r1", columnId: "name" }, "Edited"));
    await waitFor(() => expect(mine).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(t.fetches()).toBeGreaterThan(fetched));
    expect(wiringWarnings(warn)).toHaveLength(0);
  });
});

describe.each(["pages", "scroll"] as const)("an onDataChange prop that forwards to the hook's handler, %s mode", (mode) => {
  it("merges the change once", async () => {
    let server!: UseDataGridServerRowsResult<Row> | UseDataGridServerRowsScrollResult<Row>;
    let store!: StoreApi<DataGridStoreState>;
    function Probe() {
      store = useDataGridStoreApi() as unknown as StoreApi<DataGridStoreState>;
      return null;
    }
    function Harness() {
      server = mode === "pages" ? useDataGridServerRows<Row>({ getRowId: (r) => r.id, fetchRows: fetchPage, defaultPageSize: 10, pageSizeOptions: [10] }) : useDataGridServerRows<Row, number>({ mode: "scroll", loadDelayMs: 0, blockSize: 10, overscan: 0, getRowId: (r) => r.id, fetchRows });
      return (
        <DataGridProvider {...server.gridProps} columns={columns} createRow={() => ({ id: "new", name: "New" })} onDataChange={(next, change) => server.gridProps.onDataChange(next as Row[], change as never)}>
          <DataGridRoot aria-label="People">
            <Probe />
          </DataGridRoot>
        </DataGridProvider>
      );
    }
    render(<Harness />);
    await waitFor(() => expect(server.gridProps.data[1]).toBeDefined());
    const before = server.gridProps.data.length;
    await act(async () => void store.getState().actions.insertRow(0, "above"));
    await waitFor(() => expect(server.gridProps.data.some((row) => row?.id === "new")).toBe(true));
    expect(server.gridProps.data.filter((row) => row?.id === "new")).toHaveLength(1);
    expect(server.gridProps.data.length - before).toBeLessThanOrEqual(1);
  });
});
