import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import { DataGridProvider, DataGridRoot, defineColumns, type DataChange } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridStoreApi } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import type { DataGridStoreState } from "@/registry/default/blocks/data-grid/store";
import { useDataGridServerRows, type ServerRowsAnswer, type ServerRowsRequest, type UseDataGridServerRowsScrollResult } from "./use-data-grid-server-rows";

type Row = { id: string; name: string };
type Fetch = (request: ServerRowsRequest<number>) => Promise<ServerRowsAnswer<Row, number>>;

const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text" }] as const);
const rowsOf = (from: number, count: number, suffix: string): Row[] => Array.from({ length: count }, (_, i) => ({ id: `r${from + i}`, name: `Person ${from + i}${suffix}` }));

type Source = "counted" | "cursor";

function setup(source: Source) {
  let suffix = "";
  const fetchRows = vi.fn<Fetch>(async ({ cursor, start, end }) => {
    if (source === "counted") return { rows: rowsOf(start, Math.min(end, 100) - start, suffix), totalRowCount: 100 };
    const from = cursor ?? 0;
    return { rows: rowsOf(from, end - start, suffix), nextCursor: from + (end - start) };
  });
  let server!: UseDataGridServerRowsScrollResult<Row>;
  let store!: StoreApi<DataGridStoreState>;
  const saves: Array<() => void> = [];
  const onSave = (_change: DataChange<Row>) => new Promise<void>((resolve) => saves.push(resolve));
  function Probe() {
    store = useDataGridStoreApi() as unknown as StoreApi<DataGridStoreState>;
    return null;
  }
  function Harness() {
    server = useDataGridServerRows<Row, number>({ mode: "scroll", getRowId: (r) => r.id, fetchRows, blockSize: 10, overscan: 0 });
    return (
      <DataGridProvider {...server.providerProps} columns={columns} onSave={onSave}>
        <DataGridRoot>
          <Probe />
        </DataGridRoot>
      </DataGridProvider>
    );
  }
  render(<Harness />);
  return {
    server: () => server,
    state: () => store.getState(),
    saves,
    setSuffix: (next: string) => (suffix = next),
    name: (index: number) => server.gridProps.data[index]?.name,
    ready: () => waitFor(() => expect(server.loading).toBe(false)),
  };
}

afterEach(() => vi.restoreAllMocks());

describe.each<Source>(["counted", "cursor"])("refresh in place, %s source", (source) => {
  it("keeps the value of a row whose save is pending and refreshes the other rows", async () => {
    const t = setup(source);
    await t.ready();
    act(() => t.state().actions.commitCellValue({ rowId: "r3", columnId: "name" }, "Saved"));
    expect(t.state().saveStatus.get("r3")).toBe("saving");
    t.setSuffix("!");
    act(() => t.server().refresh());
    await waitFor(() => expect(t.name(4)).toBe("Person 4!"));
    expect(t.name(3)).toBe("Saved");
  });

  it("takes the server value once the save settled", async () => {
    const t = setup(source);
    await t.ready();
    act(() => t.state().actions.commitCellValue({ rowId: "r3", columnId: "name" }, "Saved"));
    await act(async () => t.saves.splice(0).forEach((resolve) => resolve()));
    expect(t.state().saveStatus.get("r3")).toBeUndefined();
    t.setSuffix("!");
    act(() => t.server().refresh());
    await waitFor(() => expect(t.name(3)).toBe("Person 3!"));
  });

  it("keeps the row under an edit session", async () => {
    const t = setup(source);
    await t.ready();
    act(() => t.state().actions.startEditing({ rowId: "r5", columnId: "name" }));
    expect(t.state().editing?.rowId).toBe("r5");
    t.setSuffix("!");
    act(() => t.server().refresh());
    await waitFor(() => expect(t.name(6)).toBe("Person 6!"));
    expect(t.name(5)).toBe("Person 5");
  });
});
