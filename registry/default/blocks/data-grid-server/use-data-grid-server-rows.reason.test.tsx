import { act, render, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DataGridProvider, DataGridRoot, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridStoreApi } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { useDataGridServerRows, type FetchReason, type ServerRowsAnswer, type ServerRowsRequest } from "./use-data-grid-server-rows";

type Row = { id: string; name: string };
const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text" }] as const);
const rowsOf = (start: number, end: number): Row[] => Array.from({ length: Math.max(0, Math.min(end, 40) - start) }, (_, i) => ({ id: `r${start + i}`, name: `Person ${start + i}` }));

function recorder() {
  const reasons: FetchReason[] = [];
  let fail = false;
  const fetchRows = vi.fn(async (request: ServerRowsRequest): Promise<ServerRowsAnswer<Row>> => {
    reasons.push(request.reason);
    if (fail) throw new Error("boom");
    return { rows: rowsOf(request.start, request.end), totalRowCount: 40 };
  });
  return { reasons, fetchRows, failNext: (value: boolean) => (fail = value) };
}

describe.each(["pages", "scroll"] as const)("fetch reason, %s mode", (mode) => {
  const options = (fetchRows: ReturnType<typeof recorder>["fetchRows"]) => (mode === "pages" ? ({ fetchRows, defaultPageSize: 10, pageSizeOptions: [10] } as const) : ({ mode: "scroll", fetchRows, blockSize: 10, overscan: 0, loadDelayMs: 0 } as const));
  const mountHook = (r: ReturnType<typeof recorder>) => renderHook(() => useDataGridServerRows<Row>(options(r.fetchRows) as never) as { status: string; refresh: () => void; retry: () => void; loading: boolean });

  it("labels the first request load, refresh() refresh, and a retry retry", async () => {
    const r = recorder();
    const view = mountHook(r);
    await waitFor(() => expect(view.result.current.status).toBe("ready"));
    expect(r.reasons).toEqual(["load"]);
    act(() => view.result.current.refresh());
    await waitFor(() => expect(r.reasons).toEqual(["load", "refresh"]));
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    r.failNext(true);
    act(() => view.result.current.refresh());
    await waitFor(() => expect(view.result.current.status).toBe("error"));
    r.failNext(false);
    act(() => view.result.current.retry());
    await waitFor(() => expect(view.result.current.status).toBe("ready"));
    expect(r.reasons.at(-1)).toBe("retry");
    act(() => view.result.current.refresh());
    await waitFor(() => expect(r.reasons.at(-1)).toBe("refresh"));
  });

  it("labels the refresh after a settled save save", async () => {
    const r = recorder();
    let store!: ReturnType<typeof useDataGridStoreApi>;
    function Probe() {
      store = useDataGridStoreApi();
      return null;
    }
    function Harness() {
      const server = useDataGridServerRows<Row>({ ...(options(r.fetchRows) as object), onSave: async () => {}, getRowId: (row: Row) => row.id } as never) as unknown as { gridProps: object };
      return (
        <DataGridProvider {...server.gridProps} columns={columns}>
          <DataGridRoot aria-label="People">
            <Probe />
          </DataGridRoot>
        </DataGridProvider>
      );
    }
    render(<Harness />);
    await waitFor(() => expect(r.reasons).toEqual(["load"]));
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 20))));
    act(() => store.getState().actions.commitCellValue({ rowId: "r1", columnId: "name" }, "Edited"));
    await waitFor(() => expect(r.reasons.at(-1)).toBe("save"));
  });
});
