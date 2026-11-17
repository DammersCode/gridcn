import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DataGrid, type ColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridPinnedRows, type UseDataGridPinnedRowsResult } from "../use-data-grid-pinned-rows";
import { serverAggregateRow } from "../pinned-row-source";

type Row = { id: string; qty: number };

const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "qty", header: "Qty", accessorKey: "qty", type: "number", width: 80 }];
const rows: Row[] = [{ id: "a", qty: 1 }];

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 360 });
});
afterEach(cleanup);

describe("useDataGridPinnedRows serverAggregates", () => {
  it("returns the result of each serverAggregateRow in band order, with refresh", async () => {
    const fetchAggregates = vi.fn(async () => ({ qty: 7 }));
    let pinned!: UseDataGridPinnedRowsResult;
    function Grid() {
      pinned = useDataGridPinnedRows({ bottomRows: [serverAggregateRow({ fetchAggregates, debounceMs: 0 })] });
      return <DataGrid data={rows} columns={columns} getRowId={(r) => r.id} plugins={[pinned.plugin]} />;
    }
    render(<Grid />);
    expect(pinned.serverAggregates).toHaveLength(1);
    await waitFor(() => expect(pinned.serverAggregates[0]!.status).toBe("ready"));
    expect(pinned.serverAggregates[0]!.row).toEqual({ qty: 7 });
    const calls = fetchAggregates.mock.calls.length;
    act(() => pinned.serverAggregates[0]!.refresh());
    await waitFor(() => expect(fetchAggregates.mock.calls.length).toBe(calls + 1));
  });

  it("is empty without a serverAggregateRow", () => {
    let pinned!: UseDataGridPinnedRowsResult;
    function Grid() {
      pinned = useDataGridPinnedRows({ bottomRows: [{ id: "t", qty: 1 }] });
      return <DataGrid data={rows} columns={columns} getRowId={(r) => r.id} plugins={[pinned.plugin]} />;
    }
    render(<Grid />);
    expect(pinned.serverAggregates).toEqual([]);
  });
});
