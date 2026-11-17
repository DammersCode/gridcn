import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import { DataGridProvider, DataGridRoot, defineColumns, type DataChange, type SaveAck } from "@/registry/default/blocks/data-grid/data-grid";
import { groupIdOf, useDataGridStoreApi } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import type { DataGridStoreState } from "@/registry/default/blocks/data-grid/store";
import { fakeServer, rowsOf, type Row } from "./group-fake-server.test-helper";
import { useDataGridServerRows, type UseDataGridServerRowsResult } from "./use-data-grid-server-rows";

const columns = defineColumns<Row>()([
  { id: "region", header: "Region", accessorKey: "region", type: "text" },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number" },
] as const);

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 360 });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 800 });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const idOf = (region: string) => groupIdOf([{ columnId: "region", key: region }]);

function setup(options: { refreshAfterSave?: false; mode?: "scroll" | "pages"; answer?: (row: Row) => SaveAck<Row> } = {}) {
  const server = fakeServer(rowsOf({ A: 6, B: 4 }));
  const saved: DataChange<Row>[] = [];
  const onSave = async (change: DataChange<Row>): Promise<SaveAck<Row>> => {
    saved.push(change);
    const answer = options.answer?.((change.ops[0] as { row: Row }).row);
    if (answer) return answer;
    for (const op of change.ops) {
      if (op.type !== "update") continue;
      const at = server.rows.findIndex((row) => row.id === op.rowId);
      if (at >= 0) server.rows[at] = { ...(op.row as Row) };
    }
  };
  let hook!: UseDataGridServerRowsResult<Row>;
  let store!: StoreApi<DataGridStoreState>;
  function Probe() {
    store = useDataGridStoreApi() as unknown as StoreApi<DataGridStoreState>;
    return null;
  }
  function Harness() {
    hook = useDataGridServerRows<Row>({
      ...(options.mode === "pages" ? { defaultPageSize: 5 } : { mode: "scroll" as const, blockSize: 20, overscan: 0, loadDelayMs: 0 }),
      fetchRows: server.fetchRows as never,
      defaultSpec: { groupBy: ["region"], aggregates: [{ columnId: "qty", reducer: "sum" }] },
      onSave,
      ...(options.refreshAfterSave === false ? { refreshAfterSave: false as const } : {}),
    } as never) as unknown as UseDataGridServerRowsResult<Row>;
    return (
      <DataGridProvider {...hook.gridProps} columns={columns}>
        <DataGridRoot aria-label="Sales">
          <Probe />
        </DataGridRoot>
      </DataGridProvider>
    );
  }
  render(<Harness />);
  const openGroup = async (region: string) => {
    act(() => store.getState().actions.setExpanded({ mode: "collapsed", ids: [idOf(region)] }));
    act(() => hook.gridProps.onRenderedRowsChange?.({ start: 0, end: 12 }));
    await waitFor(() => expect(hook.gridProps.data[1]?.id).toBe(`${region}0`));
  };
  const slots = () => hook.gridProps.groupLayout?.rows ?? [];
  const requests = (kind: "groups" | "rows") => server.calls.filter((call) => call.childKind === kind);
  return { server, saved, hook: () => hook, store: () => store.getState(), openGroup, slots, requests };
}

describe("a grouped server source after a save", () => {
  it.each(["scroll", "pages"] as const)("reloads the group rows and the open list in place when a save changes a group column (%s)", async (mode) => {
    const t = setup({ mode });
    await waitFor(() => expect(t.slots()).toHaveLength(2));
    await t.openGroup("A");
    const before = t.server.calls.length;
    act(() => t.store().actions.applyCellUpdates([{ viewRowIndex: 1, columnId: "region", value: "B" }], "edit"));
    expect(t.hook().gridProps.data[1]?.region).toBe("B");
    await waitFor(() => expect(t.slots().map((slot) => slot.childCount)).toEqual([5, 5]));
    expect(t.saved).toHaveLength(1);
    const refetched = t.server.calls.slice(before);
    expect(refetched.every((call) => call.reason === "save")).toBe(true);
    expect(new Set(refetched.map((call) => call.childKind))).toEqual(new Set(["groups", "rows"]));
    expect(t.slots().map((slot) => slot.aggregates?.["qty"])).toEqual([5, 5]);
    expect(t.hook().gridProps.data.filter((row) => row?.region === "A")).toHaveLength(5);
    expect(t.hook().gridProps.data.some((row) => row?.id === "A0")).toBe(false);
  });

  it("reverts a refused save and leaves the groups alone", async () => {
    const t = setup({ answer: (row) => ({ rejected: [{ rowId: row.id }] }) });
    await waitFor(() => expect(t.slots()).toHaveLength(2));
    await t.openGroup("A");
    act(() => t.store().actions.applyCellUpdates([{ viewRowIndex: 1, columnId: "region", value: "B" }], "edit"));
    await waitFor(() => expect(t.hook().gridProps.data[1]?.region).toBe("A"));
    expect(t.hook().gridProps.data[1]?.id).toBe("A0");
    await waitFor(() => expect(t.hook().loading).toBe(false));
    expect(t.slots().map((slot) => slot.childCount)).toEqual([6, 4]);
  });

  it("writes a streamed cell update into its list and leaves the aggregates until refresh()", async () => {
    const t = setup({ refreshAfterSave: false });
    await waitFor(() => expect(t.slots()).toHaveLength(2));
    await t.openGroup("A");
    const requests = t.server.calls.length;
    act(() => t.store().actions.updateCells([{ rowId: "A0", columnId: "qty", value: 9 }], { source: "stream" }));
    expect(t.hook().gridProps.data[1]?.qty).toBe(9);
    expect(t.slots()[0]!.aggregates?.["qty"]).toBe(6);
    expect(t.server.calls.length).toBe(requests);
    const row = t.server.rows.find((candidate) => candidate.id === "A0")!;
    row.qty = 9;
    act(() => t.hook().refresh());
    await waitFor(() => expect(t.slots()[0]!.aggregates?.["qty"]).toBe(14));
    expect(t.hook().gridProps.data[1]?.qty).toBe(9);
  });

  it("does not refresh a settled save with refreshAfterSave false", async () => {
    const t = setup({ refreshAfterSave: false });
    await waitFor(() => expect(t.slots()).toHaveLength(2));
    await t.openGroup("A");
    const requests = t.server.calls.length;
    act(() => t.store().actions.applyCellUpdates([{ viewRowIndex: 1, columnId: "region", value: "B" }], "edit"));
    await waitFor(() => expect(t.saved).toHaveLength(1));
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 60))));
    expect(t.server.calls.length).toBe(requests);
  });
});
