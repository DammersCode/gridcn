import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, defineColumns, useDataGridSelectedRows, type DataGridSelectedRows } from "@/registry/default/blocks/data-grid/data-grid";
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
const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 40))));

function setup(mode: "scroll" | "pages" = "scroll", rows = rowsOf({ A: 6, B: 4 })) {
  const server = fakeServer(rows);
  const onSelectionChange = vi.fn();
  const onEditEnd = vi.fn();
  let hook!: UseDataGridServerRowsResult<Row>;
  let store!: StoreApi<DataGridStoreState>;
  let selected!: DataGridSelectedRows;
  function Probe() {
    store = useDataGridStoreApi() as unknown as StoreApi<DataGridStoreState>;
    selected = useDataGridSelectedRows();
    return null;
  }
  function Harness() {
    hook = useDataGridServerRows<Row>({
      ...(mode === "pages" ? { defaultPageSize: 5 } : { mode: "scroll" as const, blockSize: 20, overscan: 0, loadDelayMs: 0 }),
      fetchRows: server.fetchRows as never,
      defaultSpec: { groupBy: ["region"] },
    } as never) as unknown as UseDataGridServerRowsResult<Row>;
    return (
      <DataGridProvider {...hook.providerProps} columns={columns} enableRowSelection onSelectionChange={onSelectionChange} onEditEnd={onEditEnd}>
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
  const open = async (...regions: string[]) => {
    act(() => actions().setExpanded({ mode: "collapsed", ids: regions.map(idOf) }));
    act(() => hook.providerProps.onRenderedRowsChange?.({ start: 0, end: 12 }));
    await waitFor(() => expect(hook.providerProps.data.some((row) => row?.id === `${regions[0]}0`)).toBe(true));
  };
  return { server, hook: () => hook, state: () => store.getState(), actions, selected: () => selected, open, onSelectionChange, onEditEnd, ready: () => waitFor(() => expect(hook.providerProps.data.length).toBeGreaterThan(0)) };
}

describe("selecting rows of a grouped server source", () => {
  it.each(["scroll", "pages"] as const)("counts all matching rows by the leaf count the server sent (%s)", async (mode) => {
    const t = setup(mode);
    await t.ready();
    expect(t.hook().providerProps.data).toHaveLength(2);
    let verdict: unknown;
    act(() => void (verdict = t.actions().selectAllMatching()));
    expect(verdict).toEqual({ ok: true });
    expect(t.selected()).toMatchObject({ mode: "allMatching", count: 10 });
    expect(t.state().liveAnnouncement).toMatchObject({ kind: "rowsChecked", count: 10 });
  });

  it("keeps the exclusions of all matching rows when a group collapses and opens again, without an announcement", async () => {
    const t = setup();
    await t.ready();
    await t.open("A");
    act(() => void t.actions().selectAllMatching());
    act(() => t.actions().setRowChecked("A1", false));
    expect(t.selected()).toMatchObject({ mode: "allMatching", excludedIds: ["A1"], count: 9 });
    const quiet = { announced: t.state().liveAnnouncement, changes: t.onSelectionChange.mock.calls.length };
    act(() => t.actions().setExpanded({ mode: "collapsed", ids: [] }));
    expect(t.hook().providerProps.data).toHaveLength(2);
    expect(t.selected()).toMatchObject({ mode: "allMatching", excludedIds: ["A1"], count: 9 });
    await t.open("A");
    await waitFor(() => expect(t.hook().providerProps.data[2]?.id).toBe("A1"));
    expect(t.selected()).toMatchObject({ mode: "allMatching", excludedIds: ["A1"], count: 9 });
    expect(t.state().allMatching).toBe(true);
    expect(t.state().liveAnnouncement).toBe(quiet.announced);
    expect(t.onSelectionChange.mock.calls.length).toBe(quiet.changes);
  });

  it("remembers checked rows that a collapse hides and returns them when the group opens", async () => {
    const t = setup();
    await t.ready();
    await t.open("A");
    act(() => t.actions().setRowChecked("A1", true));
    act(() => t.actions().setRowChecked("A2", true));
    expect(t.selected()).toMatchObject({ mode: "ids", ids: ["A1", "A2"], count: 2 });
    const quiet = { announced: t.state().liveAnnouncement, changes: t.onSelectionChange.mock.calls.length };
    act(() => t.actions().setExpanded({ mode: "collapsed", ids: [] }));
    expect(t.selected()).toMatchObject({ mode: "ids", count: 2 });
    expect([...t.state().hiddenCheckedRowIds].sort()).toEqual(["A1", "A2"]);
    await t.open("A");
    await waitFor(() => expect(t.hook().providerProps.data[3]?.id).toBe("A2"));
    expect(t.state().hiddenCheckedRowIds.size).toBe(0);
    expect(t.selected()).toMatchObject({ mode: "ids", ids: ["A1", "A2"], count: 2 });
    expect(t.state().liveAnnouncement).toBe(quiet.announced);
    expect(t.onSelectionChange.mock.calls.length).toBe(quiet.changes);
  });

  it("announces a toggle once and never as a checked-row count", async () => {
    const t = setup();
    await t.ready();
    act(() => void t.actions().selectAllMatching());
    act(() => t.actions().toggleGroup(idOf("A")));
    expect(t.state().liveAnnouncement?.kind).toBe("groupExpanded");
    expect(t.selected()).toMatchObject({ mode: "allMatching", count: 10 });
  });

  it("swaps between grouped and ungrouped rows with an edit session open, which follows its row", async () => {
    const t = setup();
    await t.ready();
    await t.open("A");
    await waitFor(() => expect(t.hook().providerProps.data[1]?.id).toBe("A0"));
    act(() => t.actions().startEditingAt({ row: 1, col: 0 }));
    expect(t.state().editing).not.toBeNull();
    act(() => t.hook().providerProps.onGroupByChange!([]));
    await waitFor(() => expect(t.hook().providerProps.data).toHaveLength(10));
    expect(t.hook().providerProps.groupLayout).toBeUndefined();
    expect(t.state().editing).toMatchObject({ rowId: "A0", coord: { row: 0 } });
    expect(t.onEditEnd).not.toHaveBeenCalled();
    act(() => t.hook().providerProps.onGroupByChange!(["region"]));
    await waitFor(() => expect(t.hook().providerProps.groupLayout?.rows).toHaveLength(2));
  });
});

describe("a hole inside an open group", () => {
  it("is a busy row at the level of the rows of its group", async () => {
    const t = setup("scroll", rowsOf({ A: 60, B: 4 }));
    await t.ready();
    const original = t.server.fetchRows.getMockImplementation()!;
    t.server.fetchRows.mockImplementation((request) => (request.childKind === "rows" ? new Promise(() => {}) : original(request)));
    act(() => t.actions().setExpanded({ mode: "collapsed", ids: [idOf("A")] }));
    await waitFor(() => expect(document.querySelectorAll('[role="row"][aria-busy="true"]').length).toBeGreaterThan(0));
    const levels = new Set([...document.querySelectorAll('[role="row"][aria-busy="true"]')].map((row) => row.getAttribute("aria-level")));
    expect(levels).toEqual(new Set(["2"]));
    await settle();
  });
});
