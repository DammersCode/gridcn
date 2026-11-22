import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, defineColumns, useDataGridSelectedRows, type DataChange, type DataGridSelectedRows } from "@/registry/default/blocks/data-grid/data-grid";
import { groupIdOf, useDataGridStoreApi } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import type { DataGridStoreState } from "@/registry/default/blocks/data-grid/store";
import { useDataGridInternalActions, type DataGridInternalActions } from "@/registry/default/blocks/data-grid/store";
import { fakeServer, rowsOf, type Row } from "./group-fake-server.test-helper";
import type { ServerRowsRequest } from "./read-answer";
import { useDataGridServerRows, type UseDataGridServerRowsResult } from "./use-data-grid-server-rows";
import { useDataGridHistory, type UseDataGridHistoryResult } from "@/registry/default/blocks/data-grid-history/data-grid-history";

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

type Options = { grouped?: boolean; sequential?: boolean; onSave?: boolean; withHistory?: boolean };

/** A scroll source whose answers can be parked. */
function setup({ grouped = false, sequential = false, onSave = false, withHistory = false }: Options = {}) {
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
  let history!: UseDataGridHistoryResult<Row>;
  let internal!: DataGridInternalActions;
  function Probe() {
    store = useDataGridStoreApi() as unknown as StoreApi<DataGridStoreState>;
    selected = useDataGridSelectedRows();
    internal = useDataGridInternalActions();
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
    history = useDataGridHistory<Row>();
    const rowFactories = { createRow: (index: number) => ({ id: `N${index}`, region: "N", city: "N-c0", qty: 1 }), duplicateRow: (row: Row) => ({ ...row, id: `${row.id}-copy` }) };
    return (
      <DataGridProvider {...hook.providerProps} columns={columns} enableRowSelection {...rowFactories} plugins={withHistory ? [history.plugin] : undefined}>
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
    history: () => history,
    internal: () => internal,
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
    expect(t.actions().selectAllMatching()).toEqual({ ok: false, reason: "server-held" });
    expect(t.cityOf("A0")).toBe("A-c0");
    await t.land();
    expect(t.state().serverHeld).toBe(false);
    act(() => void t.actions().commitCellValue({ rowId: "A0", columnId: "city" }, "After"));
    expect(t.cityOf("A0")).toBe("After");
  });

  type Setup = ReturnType<typeof setup>;
  const city = (t: Setup) => t.cityOf("A0");
  const changedCity = (t: Setup) => city(t) !== "A-c0";
  const hasRow = (id: string) => (t: Setup) => t.hook().providerProps.data.some((row) => row?.id === id);
  const editBefore = (t: Setup) => act(() => void t.actions().commitCellValue({ rowId: "A0", columnId: "city" }, "Edited"));
  const gestures: { name: string; withHistory?: boolean; before?: (t: Setup) => void; run: (t: Setup) => unknown; wrote: (t: Setup) => boolean; refused?: unknown }[] = [
    { name: "edit commit", run: (t) => t.actions().commitCellValue({ rowId: "A0", columnId: "city" }, "Typed"), wrote: changedCity },
    { name: "edit start", run: (t) => t.actions().startEditing({ rowId: "A0", columnId: "city" }), wrote: (t) => t.state().editing !== null },
    { name: "paste", run: (t) => t.actions().applyCellUpdates([{ viewRowIndex: 0, columnId: "city", value: "Pasted" }], "paste"), wrote: (t) => t.hook().providerProps.data.some((row) => row?.city === "Pasted") },
    { name: "fill", run: (t) => t.actions().applyCellUpdates([{ viewRowIndex: 0, columnId: "city", value: "Filled" }], "fill"), wrote: (t) => t.hook().providerProps.data.some((row) => row?.city === "Filled") },
    { name: "cut", run: (t) => t.internal()._deleteCellsById(["A0"], ["city"]), wrote: changedCity },
    {
      name: "delete",
      run: (t) => {
        t.actions().selectAll();
        t.actions().deleteSelection();
      },
      wrote: changedCity,
    },
    { name: "replace", run: (t) => t.actions().updateCells([{ rowId: "A0", columnId: "city", value: "Replaced" }], { source: "replace" }), wrote: changedCity, refused: { applied: 0, skipped: [{ patchIndex: 0, reason: "server-held" }], pending: false } },
    { name: "import", run: (t) => t.actions().commitChange({ source: "import", ops: [{ type: "insert", rowId: "I1", row: { id: "I1", region: "I", city: "I-c0", qty: 1 }, index: 7 }] }), wrote: hasRow("I1") },
    { name: "insert rows", run: (t) => t.actions().insertRows(0, 1), wrote: (t) => t.hook().providerProps.data.some((row) => row?.region === "N"), refused: { ok: false, reason: "server-held" } },
    { name: "duplicate rows", run: (t) => t.actions().duplicateRowsAt([0]), wrote: (t) => t.hook().providerProps.data.some((row) => row?.id.endsWith("-copy")), refused: { ok: false, reason: "server-held" } },
    { name: "delete rows", run: (t) => t.actions().deleteRowsAt([0]), wrote: (t) => t.hook().providerProps.data.filter((row) => row !== undefined).length < 7, refused: { ok: false, reason: "server-held" } },
    { name: "move rows", run: (t) => t.actions().reorderRows(1, 0), wrote: (t) => t.hook().providerProps.data[0]?.id !== "A0", refused: false },
    { name: "undo", withHistory: true, before: editBefore, run: (t) => t.history().undo(), wrote: (t) => city(t) === "A-c0" },
    {
      name: "redo",
      withHistory: true,
      before: (t) => {
        editBefore(t);
        act(() => t.history().undo());
      },
      run: (t) => t.history().redo(),
      wrote: (t) => city(t) === "Edited",
    },
  ];

  for (const gesture of gestures) {
    it(`refuses ${gesture.name} while the rows are held, and runs it after the answer lands`, async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const t = setup({ withHistory: gesture.withHistory });
      await waitFor(() => expect(t.cityOf("A0")).toBe("A-c0"));
      gesture.before?.(t);
      t.park();
      act(() => t.hook().gridProps.onSearchTextChange("x"));
      await settle();
      expect(t.state().serverHeld).toBe(true);
      const shown = t.hook().providerProps.data;
      let result: unknown;
      act(() => void (result = gesture.run(t)));
      if ("refused" in gesture) expect(result).toEqual(gesture.refused);
      expect(t.hook().providerProps.data).toBe(shown);
      expect(gesture.wrote(t)).toBe(false);
      await t.land();
      act(() => void gesture.run(t));
      expect(gesture.wrote(t)).toBe(true);
    });
  }

  it("warns once in development when commitChange carries a user gesture source during the hold, and applies an app source", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = setup();
    await holdOnSort(t);
    const update = (source: DataChange<Row>["source"], value: string): DataChange<unknown> => ({ source, ops: [{ type: "update", rowId: "A0", row: { id: "A0", region: "A", city: value, qty: 1 }, prev: { id: "A0", region: "A", city: "A-c0", qty: 1 } }] });
    act(() => t.actions().commitChange(update("paste", "Gesture")));
    act(() => t.actions().commitChange(update("fill", "Gesture")));
    expect(t.cityOf("A0")).toBe("A-c0");
    expect(warn.mock.calls.filter(([message]) => String(message).includes("while the server hook holds the rows"))).toHaveLength(1);
    act(() => t.actions().commitChange(update("app", "App")));
    expect(t.cityOf("A0")).toBe("App");
  });

  it("applies updateRows and editRows from your code during the hold", async () => {
    const t = setup();
    await holdOnSort(t);
    act(() => void t.actions().updateRows([{ rowId: "A0", changes: { city: "Rows" } }], { source: "stream" }));
    expect(t.cityOf("A0")).toBe("Rows");
    act(() => void t.actions().editRows([{ rowId: "A1", changes: { city: "Edited" } }]));
    expect(t.cityOf("A1")).toBe("Edited");
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
