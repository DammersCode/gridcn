import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import { DataGridProvider, DataGridRoot, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridStoreApi } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import type { DataGridStoreState } from "@/registry/default/blocks/data-grid/store";
import { useDataGridServerRows, type ServerRowsAnswer, type ServerRowsRequest, type UseDataGridServerRowsResult, type UseDataGridServerRowsScrollResult } from "./use-data-grid-server-rows";

type Row = { id: string; name: string };
const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text" }] as const);
const rowsOf = (start: number, end: number): Row[] => Array.from({ length: end - start }, (_, i) => ({ id: `r${start + i}`, name: `Person ${start + i}` }));
const fetchRows = async ({ start, end }: ServerRowsRequest<number>): Promise<ServerRowsAnswer<Row, number>> => ({ rows: rowsOf(start, Math.min(end, 40)), totalRowCount: 40 });

afterEach(() => vi.restoreAllMocks());

function mount(mode: "pages" | "scroll", after: { onDataChange?: () => void; onRenderedRowsChange?: () => void }) {
  let server!: UseDataGridServerRowsResult<Row> | UseDataGridServerRowsScrollResult<Row>;
  let store!: StoreApi<DataGridStoreState>;
  function Probe() {
    store = useDataGridStoreApi() as unknown as StoreApi<DataGridStoreState>;
    return null;
  }
  function Harness() {
    server =
      mode === "pages"
        ? useDataGridServerRows<Row>({ getRowId: (r) => r.id, fetchRows, defaultPageSize: 10, pageSizeOptions: [10] })
        : useDataGridServerRows<Row, number>({ mode: "scroll", loadDelayMs: 0, blockSize: 10, overscan: 0, getRowId: (r) => r.id, fetchRows });
    return (
      <DataGridProvider {...server.gridProps} columns={columns} {...after}>
        <DataGridRoot>
          <Probe />
        </DataGridRoot>
      </DataGridProvider>
    );
  }
  render(<Harness />);
  return { server: () => server, state: () => store.getState() };
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
  it("warns once in development", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mount("scroll", { onRenderedRowsChange: () => {} });
    await act(async () => {});
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("onRenderedRowsChange prop"))).toHaveLength(1);
  });
});
