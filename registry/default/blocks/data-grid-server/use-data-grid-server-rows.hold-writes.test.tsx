import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, defineColumns, useDataGridSelectedRows, type DataChange, type DataGridSelectedRows } from "@/registry/default/blocks/data-grid/data-grid";
import { groupIdOf, useDataGridStoreApi } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import type { DataGridStoreState } from "@/registry/default/blocks/data-grid/store";
import { fakeServer, rowsOf, type Row } from "./group-fake-server.test-helper";
import type { ServerRowsRequest } from "./read-answer";
import { useDataGridServerRows, type UseDataGridServerRowsResult } from "./use-data-grid-server-rows";

const columns = defineColumns<Row>()([
  { id: "region", header: "Region", accessorKey: "region", type: "text" },
  { id: "city", header: "City", accessorKey: "city", type: "text" },
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

const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 40))));

type Options = { grouped?: boolean; sequential?: boolean; onSave?: boolean };

/** A scroll source whose answers can be parked. */
function setup({ grouped = false, sequential = false, onSave = false }: Options = {}) {
  const server = fakeServer(rowsOf({ A: 4, B: 3 }));
  let parked: ((fail: boolean) => void)[] | null = null;
  const requests: ServerRowsRequest<never>[] = [];
  const fetchRows = (request: ServerRowsRequest<never>) => {
    requests.push(request);
    const answer = server.fetchRows(request).then((value) => (sequential && !request.childKind && "rows" in value ? { rows: value.rows, nextCursor: null } : value));
    if (parked === null) return answer;
    return new Promise((resolve, reject) => parked!.push((fail) => (fail ? reject(new Error("down")) : resolve(answer))));
  };
  const saves: (() => void)[] = [];
  let hook!: UseDataGridServerRowsResult<Row>;
  let store!: StoreApi<DataGridStoreState>;
  let selected!: DataGridSelectedRows;
  const changes: DataChange<Row>[] = [];
  function Probe() {
    store = useDataGridStoreApi() as unknown as StoreApi<DataGridStoreState>;
    selected = useDataGridSelectedRows();
    return null;
  }
  function Harness() {
    hook = useDataGridServerRows<Row>({
      mode: "scroll",
      blockSize: 20,
      overscan: 0,
      loadDelayMs: 0,
      fetchRows: fetchRows as never,
      onDataChange: (_: unknown, change: DataChange<Row>) => void changes.push(change),
      ...(onSave ? { onSave: () => new Promise<void>((resolve) => saves.push(resolve)) } : null),
      defaultSpec: { groupBy: grouped ? ["region"] : [] },
    } as never) as unknown as UseDataGridServerRowsResult<Row>;
    return (
      <DataGridProvider {...hook.providerProps} columns={columns} enableRowSelection>
        <DataGridRoot aria-label="Sales" {...hook.rootProps}>
          <DataGridHeader />
          <DataGridBody />
          <Probe />
        </DataGridRoot>
      </DataGridProvider>
    );
  }
  render(<Harness />);
  const actions = () => store.getState().actions;
  const cityOf = (id: string) => hook.providerProps.data.find((row) => row?.id === id)?.city;
  return {
    hook: () => hook,
    state: () => store.getState(),
    selected: () => selected,
    changes,
    server,
    actions,
    cityOf,
    park: () => void (parked = []),
    requests,
    land: async (fail = false) => {
      const run = parked ?? [];
      parked = fail ? [] : null;
      for (const go of run) go(fail);
      await settle();
      await settle();
    },
    saves,
  };
}

describe("a switch between flat and grouped rows", () => {
  it("sends a refresh to the group engine while the flat rows wait for the groups", async () => {
    const t = setup();
    await waitFor(() => expect(t.cityOf("A0")).toBe("A-c0"));
    t.park();
    act(() => t.hook().gridProps.onGroupByChange!(["region"]));
    await settle();
    expect(t.cityOf("A0")).toBe("A-c0");
    expect(t.hook().providerProps.serverHeld).toBe(true);
    const sent = t.requests.length;
    act(() => t.hook().refresh());
    await settle();
    expect(t.requests.slice(sent).every((request) => request.childKind === "groups")).toBe(true);
    expect(t.requests.slice(sent).length).toBeGreaterThan(0);
  });

  it("sends a refresh to the flat engine while the groups wait for the flat rows", async () => {
    const t = setup({ grouped: true });
    await waitFor(() => expect(t.hook().providerProps.groupLayout?.rows).toHaveLength(2));
    t.park();
    act(() => t.hook().gridProps.onGroupByChange!([]));
    await settle();
    expect(t.hook().providerProps.groupLayout?.rows).toHaveLength(2);
    const sent = t.requests.length;
    act(() => t.hook().refresh());
    await settle();
    expect(t.requests.slice(sent).some((request) => request.childKind === undefined && request.spec.groupBy === undefined)).toBe(true);
  });

  it("keeps the flat rows next to the error bar when the first group answer fails, and switches after a retry", async () => {
    const t = setup();
    await waitFor(() => expect(t.cityOf("A0")).toBe("A-c0"));
    t.park();
    act(() => t.hook().gridProps.onGroupByChange!(["region"]));
    await settle();
    await t.land(true);
    expect(t.hook().status).toBe("error");
    expect(t.cityOf("A0")).toBe("A-c0");
    expect(t.hook().rootProps.error).not.toBeNull();
    await t.land();
    act(() => t.hook().retry());
    await waitFor(() => expect(t.hook().providerProps.groupLayout?.rows).toHaveLength(2));
  });

  it("restarts the first load on refresh() instead of joining the request in flight", async () => {
    const t = setup();
    t.park();
    await settle();
    const first = t.requests.at(-1)!;
    act(() => t.hook().refresh());
    await settle();
    expect(first.signal.aborted).toBe(true);
    expect(t.requests.at(-1)).not.toBe(first);
    await t.land();
    expect(t.cityOf("A0")).toBe("A-c0");
  });
});

describe("a write while the old rows are held", () => {
  const holdOnSort = async (t: ReturnType<typeof setup>, city = "A-c0") => {
    await waitFor(() => expect(t.cityOf("A0")).toBe(city));
    t.park();
    act(() => t.hook().gridProps.onSortChange([{ columnId: "qty", direction: "desc" }]));
    await settle();
    expect(t.hook().providerProps.serverHeld).toBe(true);
  };

  it("refuses user gestures while the hook holds the rows, and leaves the grid's readOnly alone", async () => {
    const t = setup();
    await holdOnSort(t);
    expect(t.state().readOnly).toBe(false);
    expect(t.state().serverHeld).toBe(true);
    act(() => void t.actions().commitCellValue({ rowId: "A0", columnId: "city" }, "Held"));
    act(() => t.actions().startEditing({ rowId: "A0", columnId: "city" }));
    expect(t.state().editing).toBeNull();
    expect(t.actions().reorderRows(4, 0)).toBe(false);
    expect(t.actions().selectAllMatching()).toEqual({ ok: false, reason: "needs-total-row-count" });
    expect(t.cityOf("A0")).toBe("A-c0");
    await t.land();
    expect(t.state().serverHeld).toBe(false);
    act(() => void t.actions().commitCellValue({ rowId: "A0", columnId: "city" }, "After"));
    expect(t.cityOf("A0")).toBe("After");
  });

  it("reports no count of all matching rows while the rows are held", async () => {
    const t = setup();
    await waitFor(() => expect(t.cityOf("A0")).toBe("A-c0"));
    act(() => void t.actions().selectAllMatching());
    expect(t.selected()).toMatchObject({ mode: "allMatching", count: 7 });
    t.park();
    act(() => t.hook().gridProps.onSortChange([{ columnId: "qty", direction: "desc" }]));
    await settle();
    expect(t.selected()).toMatchObject({ mode: "allMatching", count: null });
    await t.land();
    expect(t.selected()).toMatchObject({ mode: "allMatching", count: 7 });
  });

  for (const variant of [
    { name: "a random source without onSave", options: {} },
    { name: "a random source with onSave", options: { onSave: true } },
    { name: "a sequential source without onSave", options: { sequential: true } },
    { name: "a sequential source with onSave", options: { sequential: true, onSave: true } },
  ] as { name: string; options: Options }[]) {
    it(`keeps a consumer updateCells write when the answer lands (${variant.name})`, async () => {
      const t = setup(variant.options);
      await holdOnSort(t);
      act(() => void t.actions().updateCells([{ rowId: "A0", columnId: "city", value: "Held" }], { source: "edit" }));
      expect(t.cityOf("A0")).toBe("Held");
      await t.land();
      expect(t.cityOf("A0")).toBe("Held");
    });
  }

  it("applies a replaceRowId that a save settling during the hold calls", async () => {
    const t = setup({ onSave: true });
    await waitFor(() => expect(t.cityOf("A0")).toBe("A-c0"));
    act(() => void t.actions().commitCellValue({ rowId: "A0", columnId: "city" }, "Saving"));
    await holdOnSort(t, "Saving");
    act(() => {
      t.saves[0]!();
      t.actions().replaceRowId("A0", { id: "A9", region: "A", city: "Saving", qty: 1 });
    });
    expect(t.hook().providerProps.data.some((row) => row?.id === "A9")).toBe(true);
    expect(t.changes.some((change) => change.source === "id-swap")).toBe(true);
  });

  it("keeps the local value of a row that was saving before the spec changed", async () => {
    const t = setup({ onSave: true });
    await waitFor(() => expect(t.cityOf("A0")).toBe("A-c0"));
    act(() => void t.actions().commitCellValue({ rowId: "A0", columnId: "city" }, "Saving"));
    expect(t.saves).toHaveLength(1);
    t.park();
    act(() => t.hook().gridProps.onSortChange([{ columnId: "qty", direction: "desc" }]));
    await t.land();
    expect(t.cityOf("A0")).toBe("Saving");
  });

  it("leaves no stray row when a push inserts rows during the hold", async () => {
    const t = setup();
    await holdOnSort(t);
    const pushed = { id: "X1", region: "Z", city: "Z-c0", qty: 9 };
    act(() => t.hook().providerProps.onDataChange([pushed, ...(t.hook().providerProps.data as Row[])], { source: "stream", ops: [{ type: "insert", rowId: "X1", row: pushed, index: 0 }] } as never));
    await t.land();
    const ids = t.hook().providerProps.data.map((row) => row?.id);
    expect(ids.filter((id) => id !== undefined)).toEqual(["A0", "A1", "A2", "A3", "B0", "B1", "B2"]);
  });
});

describe("a save before a switch between flat and grouped rows", () => {
  it("keeps the saved value when the groups land, and refreshes the engine that answers", async () => {
    const t = setup({ onSave: true });
    await waitFor(() => expect(t.cityOf("A0")).toBe("A-c0"));
    act(() => void t.actions().commitCellValue({ rowId: "A0", columnId: "city" }, "Saved"));
    t.server.rows[0]!.city = "Saved";
    act(() => t.hook().gridProps.onGroupByChange!(["region"]));
    await waitFor(() => expect(t.hook().providerProps.groupLayout?.rows).toHaveLength(2));
    act(() => t.actions().setExpanded({ mode: "collapsed", ids: [groupIdOf([{ columnId: "region", key: "A" }])] }));
    act(() => t.hook().providerProps.onRenderedRowsChange?.({ start: 0, end: 12 }));
    await waitFor(() => expect(t.cityOf("A0")).toBe("Saved"));
    const sent = t.requests.length;
    await act(async () => t.saves[0]!());
    await settle();
    expect(t.requests.slice(sent).length).toBeGreaterThan(0);
    expect(t.requests.slice(sent).every((request) => request.childKind !== undefined)).toBe(true);
    expect(t.cityOf("A0")).toBe("Saved");
  });
});
