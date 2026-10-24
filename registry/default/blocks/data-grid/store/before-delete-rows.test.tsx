import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef, DataChange } from "../types";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState, type DataGridSyncProps } from ".";
import { dispatchGridAction } from "../interaction/use-grid-interaction";

type Row = { id: string; name: string };

const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];

const rows = (ids = ["a", "b", "c", "d", "e"]): Row[] => ids.map((id) => ({ id, name: id.toUpperCase() }));

type Gate = (ctx: { rowIds: readonly string[]; hiddenCount: number }) => boolean | Promise<boolean>;

function mount(onBeforeDeleteRows: Gate | undefined, props: Partial<DataGridSyncProps<Row>> = {}) {
  let api: StoreApi<DataGridStoreState> | null = null;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  const tree = (next: Partial<DataGridSyncProps<Row>>) => (
    <DataGridProvider columns={columns} getRowId={(row: Row) => row.id} defaultData={rows()} onBeforeDeleteRows={onBeforeDeleteRows} {...next}>
      <Probe />
    </DataGridProvider>
  );
  const view = render(tree(props));
  const state = () => api!.getState();
  return {
    state,
    store: () => api!,
    rerender: (next: Partial<DataGridSyncProps<Row>>) => view.rerender(tree(next)),
    dataIds: () => state().data.map((r) => (r as Row).id),
  };
}

function deferred() {
  let resolve!: (value: boolean) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<boolean>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => act(async () => {});

afterEach(() => vi.restoreAllMocks());

describe("onBeforeDeleteRows", () => {
  it("without the prop a delete runs at once", () => {
    const m = mount(undefined);
    act(() => m.state().actions.deleteRows([0]));
    expect(m.dataIds()).toEqual(["b", "c", "d", "e"]);
  });

  it("gets the row ids that go and the hidden count, and a true result deletes synchronously", () => {
    const gate = vi.fn<Gate>(() => true);
    const m = mount(gate, { keepCheckedRows: true, keepHiddenCheckedRows: true });
    act(() => [0, 1, 3].forEach((r) => m.state().actions.setRowSelected(r, true)));
    act(() => m.state().actions.setFilters([{ filterId: "f", columnId: "name", operator: "equals", value: "D" }] as never));
    act(() => m.state().actions.deleteRows(m.state().selection.rows.toArray()));
    expect(gate).toHaveBeenCalledWith({ rowIds: ["d"], hiddenCount: 2 });
    expect(m.dataIds()).toEqual(["a", "b", "c", "e"]);
  });

  it("false cancels the delete", () => {
    const m = mount(() => false);
    act(() => m.state().actions.deleteRows([0]));
    expect(m.dataIds()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("covers the keyboard action, the context-menu entry, and deleteRowsById", () => {
    const gate = vi.fn<Gate>(() => false);
    const m = mount(gate);
    act(() => m.state().actions.selectCellAt({ col: 0, row: 1 }));
    act(() =>
      dispatchGridAction({
        action: "deleteRows",
        actions: m.state().actions,
        storeApi: m.store(),
        scrollRef: { current: null },
        scrollCellIntoView: () => {},
        rowHeight: 36,
        preventDefault: () => {},
      }),
    );
    act(() => m.state().actions.deleteRowsById(["c"]));
    expect(gate.mock.calls.map(([ctx]) => ctx.rowIds)).toEqual([["b"], ["c"]]);
    expect(m.dataIds()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("an async true deletes after the promise settles; an async false cancels", async () => {
    const yes = deferred();
    const onDataChange = vi.fn<(next: readonly Row[], change: DataChange<Row>) => void>();
    const m = mount(() => yes.promise, { onDataChange });
    act(() => m.state().actions.deleteRows([0]));
    expect(m.dataIds()).toEqual(["a", "b", "c", "d", "e"]);
    yes.resolve(true);
    await flush();
    expect(m.dataIds()).toEqual(["b", "c", "d", "e"]);
    expect(onDataChange).toHaveBeenCalledTimes(1);

    const no = deferred();
    m.rerender({ onBeforeDeleteRows: () => no.promise });
    act(() => m.state().actions.deleteRows([0]));
    no.resolve(false);
    await flush();
    expect(m.dataIds()).toEqual(["b", "c", "d", "e"]);
  });

  it("a pending promise blocks a second delete", async () => {
    const pending = deferred();
    const gate = vi.fn<Gate>(() => pending.promise);
    const m = mount(gate);
    act(() => m.state().actions.deleteRows([0]));
    act(() => m.state().actions.deleteRows([1]));
    expect(gate).toHaveBeenCalledTimes(1);
    pending.resolve(true);
    await flush();
    expect(m.dataIds()).toEqual(["b", "c", "d", "e"]);
    act(() => m.state().actions.deleteRows([0]));
    expect(gate).toHaveBeenCalledTimes(2);
  });

  it("drops the result when readOnly turned on while the promise was pending", async () => {
    const pending = deferred();
    const gate = () => pending.promise;
    const m = mount(gate);
    act(() => m.state().actions.deleteRows([0]));
    m.rerender({ readOnly: true });
    pending.resolve(true);
    await flush();
    expect(m.dataIds()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("drops the result when the row set changed while the promise was pending", async () => {
    const pending = deferred();
    const m = mount(() => pending.promise, { createRow: () => ({ id: "z", name: "Z" }) });
    act(() => m.state().actions.deleteRows([0]));
    act(() => m.state().actions.insertRow(0, "above"));
    pending.resolve(true);
    await flush();
    expect(m.dataIds()).toEqual(["z", "a", "b", "c", "d", "e"]);
  });

  it("drops the result when the checked rows changed while the promise was pending", async () => {
    const pending = deferred();
    const m = mount(() => pending.promise, { keepCheckedRows: true });
    act(() => m.state().actions.setRowSelected(0, true));
    act(() => m.state().actions.deleteRows([0]));
    act(() => m.state().actions.setRowSelected(1, true));
    pending.resolve(true);
    await flush();
    expect(m.dataIds()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("treats a throw and a rejection as cancel and warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const throwing = mount(() => {
      throw new Error("boom");
    });
    act(() => throwing.state().actions.deleteRows([0]));
    expect(throwing.dataIds()).toEqual(["a", "b", "c", "d", "e"]);

    const bad = deferred();
    const rejecting = mount(() => bad.promise);
    act(() => rejecting.state().actions.deleteRows([0]));
    bad.reject(new Error("nope"));
    await flush();
    expect(rejecting.dataIds()).toEqual(["a", "b", "c", "d", "e"]);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("onBeforeDeleteRows"))).toHaveLength(2);
    act(() => rejecting.state().actions.deleteRows([0]));
    expect(rejecting.dataIds()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("does not run for a readOnly grid", () => {
    const gate = vi.fn<Gate>(() => true);
    const m = mount(gate, { readOnly: true });
    act(() => m.state().actions.deleteRows([0]));
    expect(gate).not.toHaveBeenCalled();
  });

  it("does not run when no row resolves", () => {
    const gate = vi.fn<Gate>(() => true);
    const m = mount(gate);
    act(() => m.state().actions.deleteRows([99]));
    act(() => m.state().actions.deleteRowsById(["zzz"]));
    expect(gate).not.toHaveBeenCalled();
  });

  it("hiddenCount leaves out hidden rows that are in rowIds", () => {
    const gate = vi.fn<Gate>(() => false);
    const m = mount(gate, { keepCheckedRows: true, keepHiddenCheckedRows: true });
    act(() => [0, 1].forEach((r) => m.state().actions.setRowSelected(r, true)));
    act(() => m.state().actions.setFilters([{ filterId: "f", columnId: "name", operator: "equals", value: "D" }] as never));
    act(() => m.state().actions.deleteRowsById(["a"]));
    expect(gate).toHaveBeenCalledWith({ rowIds: ["a"], hiddenCount: 1 });
  });

  it("warns once per instance for repeated throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = mount(() => {
      throw new Error("boom");
    });
    act(() => m.state().actions.deleteRows([0]));
    act(() => m.state().actions.deleteRows([0]));
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("onBeforeDeleteRows"))).toHaveLength(1);
  });

  it("warns once when a delete is requested while a promise is pending", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = mount(() => new Promise<boolean>(() => {}));
    act(() => m.state().actions.deleteRows([0]));
    act(() => m.state().actions.deleteRows([1]));
    act(() => m.state().actions.deleteRows([2]));
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("pending"))).toHaveLength(1);
  });
});
