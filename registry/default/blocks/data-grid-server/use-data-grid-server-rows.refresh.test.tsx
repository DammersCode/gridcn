import { act, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import { DataGridProvider, DataGridRoot, defineColumns, type DataChange } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridStoreApi } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import type { DataGridStoreState } from "@/registry/default/blocks/data-grid/store";
import { useDataGridServerRows, type ServerRowsAnswer, type ServerRowsPageRequest, type ServerRowsRequest, type UseDataGridServerRowsResult, type UseDataGridServerRowsScrollResult } from "./use-data-grid-server-rows";

type Row = { id: string; name: string };
type Fetch = (request: ServerRowsRequest<number>) => Promise<ServerRowsAnswer<Row, number>>;

const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text" }] as const);
const rowsOf = (from: number, count: number, suffix: string, shift = 0): Row[] =>
  Array.from({ length: count }, (_, i) => {
    const index = from + i;
    return index < shift ? { id: `new${index}`, name: `New ${index}` } : { id: `r${index - shift}`, name: `Person ${index - shift}${suffix}` };
  });

type Source = "counted" | "cursor";

function setup(source: Source) {
  let suffix = "";
  let shift = 0;
  const fetchRows = vi.fn<Fetch>(async ({ cursor, start, end }) => {
    if (source === "counted") return { rows: rowsOf(start, Math.min(end, 100) - start, suffix, shift), totalRowCount: 100 };
    const from = cursor ?? 0;
    return { rows: rowsOf(from, end - start, suffix, shift), nextCursor: from + (end - start) };
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
    setShift: (next: number) => (shift = next),
    ids: () => server.gridProps.data.filter((row) => row !== undefined).map((row) => row.id),
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

  it("keeps one copy of a protected row that moved in the refreshed answer", async () => {
    const t = setup(source);
    await t.ready();
    act(() => t.state().actions.commitCellValue({ rowId: "r3", columnId: "name" }, "Saved"));
    t.setShift(1);
    t.setSuffix("!");
    act(() => t.server().refresh());
    await waitFor(() => expect(t.name(5)).toBe("Person 4!"));
    const ids = t.ids();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id === "r3")).toHaveLength(1);
    expect(t.server().gridProps.data.find((row) => row?.id === "r3")?.name).toBe("Saved");
  });
});

describe("refresh in place, pages mode", () => {
  function setupPages() {
    let suffix = "";
    const fetchRows = vi.fn(async ({ start, end }: ServerRowsPageRequest): Promise<ServerRowsAnswer<Row>> => ({ rows: rowsOf(start, end - start, suffix), totalRowCount: 100 }));
    let server!: UseDataGridServerRowsResult<Row>;
    let store!: StoreApi<DataGridStoreState>;
    const onSave = (_change: DataChange<Row>) => new Promise<void>(() => {});
    function Probe() {
      store = useDataGridStoreApi() as unknown as StoreApi<DataGridStoreState>;
      return null;
    }
    function Harness() {
      server = useDataGridServerRows<Row>({ getRowId: (r) => r.id, fetchRows, defaultPageSize: 10, pageSizeOptions: [10] });
      return (
        <DataGridProvider {...server.providerProps} columns={columns} onSave={onSave}>
          <DataGridRoot>
            <Probe />
          </DataGridRoot>
        </DataGridProvider>
      );
    }
    render(<Harness />);
    return { server: () => server, state: () => store.getState(), setSuffix: (next: string) => (suffix = next), name: (index: number) => server.providerProps.data[index]?.name };
  }

  it("keeps the value of a row whose save is pending and refreshes the other rows", async () => {
    const t = setupPages();
    await waitFor(() => expect(t.server().loading).toBe(false));
    act(() => t.state().actions.commitCellValue({ rowId: "r3", columnId: "name" }, "Saved"));
    t.setSuffix("!");
    act(() => t.server().refresh());
    await waitFor(() => expect(t.name(4)).toBe("Person 4!"));
    expect(t.name(3)).toBe("Saved");
  });
});

describe("refresh without the guard plugin mounted", () => {
  const counted = async ({ start, end }: ServerRowsRequest): Promise<ServerRowsAnswer<Row>> => ({ rows: rowsOf(start, Math.min(end, 100) - start, ""), totalRowCount: 100 });

  it.each(["scroll", "pages"] as const)("warns once in %s mode when a consumer plugins prop replaced it", async (mode) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() =>
      mode === "scroll"
        ? useDataGridServerRows<Row>({ mode: "scroll", getRowId: (r) => r.id, fetchRows: counted, blockSize: 10 })
        : useDataGridServerRows<Row>({ getRowId: (r) => r.id, fetchRows: counted, pageSizeOptions: [10] }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(warn).not.toHaveBeenCalled();
    act(() => result.current.refresh());
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const guardWarnings = warn.mock.calls.filter(([message]) => String(message).includes("gridProps.plugins"));
    expect(guardWarnings).toHaveLength(1);
  });
});
