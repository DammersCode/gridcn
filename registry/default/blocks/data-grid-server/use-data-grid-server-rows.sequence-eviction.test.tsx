import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import { DataGridProvider, DataGridRoot, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridStoreApi } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import type { DataGridStoreState } from "@/registry/default/blocks/data-grid/store";
import { useDataGridServerRows, type ServerRowsAnswer, type ServerRowsRequest, type UseDataGridServerRowsScrollResult } from "./use-data-grid-server-rows";

type Row = { id: string; name: string };

const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text" }] as const);
const person = (i: number): Row => ({ id: `r${i}`, name: `Person ${i}` });
const TOTAL = 1000;

function setup() {
  const fetchRows = vi.fn(async ({ cursor, start, end }: ServerRowsRequest<number>): Promise<ServerRowsAnswer<Row, number>> => {
    const from = cursor ?? 0;
    const count = Math.min(end - start, TOTAL - from);
    return { rows: Array.from({ length: count }, (_, i) => person(from + i)), nextCursor: from + count < TOTAL ? from + count : null };
  });
  let server!: UseDataGridServerRowsScrollResult<Row>;
  let store!: StoreApi<DataGridStoreState>;
  function Probe() {
    store = useDataGridStoreApi() as unknown as StoreApi<DataGridStoreState>;
    return null;
  }
  function Harness() {
    server = useDataGridServerRows<Row, number>({ mode: "scroll", refreshAfterSave: false, getRowId: (row) => row.id, fetchRows, blockSize: 10, overscan: 0, loadDelayMs: 0, maxLoadedRows: 20 });
    return (
      <DataGridProvider {...server.providerProps} columns={columns} onSave={() => new Promise<void>(() => {})}>
        <DataGridRoot>
          <Probe />
        </DataGridRoot>
      </DataGridProvider>
    );
  }
  render(<Harness />);
  const settled = () => waitFor(() => expect(server.loading).toBe(false));
  const scrollDown = async (to = 50) => {
    for (let end = 10; end <= to; end += 10) {
      act(() => server.gridProps.onRenderedRowsChange({ start: end - 10, end }));
      await settled();
    }
  };
  return { server: () => server, state: () => store.getState(), fetchRows, settled, scrollDown };
}

afterEach(() => vi.restoreAllMocks());

describe("sequential eviction protects what random-access eviction protects", () => {
  it("keeps the block of an open edit session", async () => {
    const t = setup();
    await t.settled();
    act(() => t.state().actions.startEditing({ rowId: "r5", columnId: "name" }));
    await t.scrollDown();
    expect(t.server().gridProps.data[5]).toEqual(person(5));
    expect(t.server().gridProps.data[15]).toBeUndefined();
  });

  it("keeps the block of a row with a save in flight", async () => {
    const t = setup();
    await t.settled();
    act(() => t.state().actions.commitCellValue({ rowId: "r5", columnId: "name" }, "Saved"));
    await t.scrollDown();
    expect(t.server().gridProps.data[5]?.name).toBe("Saved");
  });
});

describe("sequential eviction with local row operations", () => {
  it("reloads an evicted block at its shifted position after a local insert", async () => {
    const t = setup();
    await t.settled();
    await t.scrollDown();
    await waitFor(() => expect(t.server().gridProps.data[25]).toBeUndefined());
    const data = t.server().gridProps.data as Row[];
    const row = { id: "new", name: "New" };
    act(() => t.server().gridProps.onDataChange([row, ...data], { source: "row-operation", ops: [{ type: "insert", rowId: "new", row, index: 0 }] }));
    act(() => t.server().gridProps.onRenderedRowsChange({ start: 20, end: 30 }));
    await waitFor(() => expect(t.server().gridProps.data[26]).toEqual(person(25)));
    expect(t.server().gridProps.data[0]).toEqual(row);
  });
});
