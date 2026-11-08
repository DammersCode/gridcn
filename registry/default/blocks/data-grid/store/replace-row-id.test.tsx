import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef, DataChange } from "../types";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState, type DataGridSyncProps } from ".";
import type { SaveAck } from "./write-ack";

type Row = { id: string; name: string; note: string };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "note", header: "Note", accessorKey: "note" },
];

const initial = (): Row[] => [
  { id: "tmp-1", name: "A", note: "a" },
  { id: "b", name: "B", note: "b" },
  { id: "c", name: "C", note: "c" },
];

const server: Row = { id: "42", name: "A", note: "a" };

function mount(props: Partial<DataGridSyncProps<Row>> = {}) {
  let api: StoreApi<DataGridStoreState> | null = null;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  const tree = (next: Partial<DataGridSyncProps<Row>>) => (
    <DataGridProvider columns={columns} getRowId={(row: Row) => row.id} defaultData={initial()} {...next}>
      <Probe />
    </DataGridProvider>
  );
  const view = render(tree(props));
  const state = () => api!.getState();
  return {
    state,
    setState: (partial: Partial<DataGridStoreState>) => api!.setState(partial),
    rerender: (next: Partial<DataGridSyncProps<Row>>) => view.rerender(tree(next)),
    ids: () => (state().data as Row[]).map((r) => r.id),
    swap: (oldId: string, row: Row) => act(() => state().actions.replaceRowId(oldId, row)),
  };
}

const flush = () => act(async () => {});

afterEach(() => vi.restoreAllMocks());

describe("replaceRowId", () => {
  it("swaps the id in place with one id-swap change that onSave does not receive", () => {
    const changes: DataChange<Row>[] = [];
    const onSave = vi.fn();
    const m = mount({ onDataChange: (_n: readonly Row[], c: DataChange<Row>) => void changes.push(c), onSave });
    m.swap("tmp-1", server);
    expect(m.ids()).toEqual(["42", "b", "c"]);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ source: "id-swap", ops: [{ type: "update", rowId: "tmp-1", row: server }] });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("keeps the active cell and the open edit on the swapped row", () => {
    const m = mount();
    act(() => m.state().actions.selectCell({ rowId: "tmp-1", columnId: "note" }));
    act(() => m.state().actions.startEditing({ rowId: "tmp-1", columnId: "note" }));
    const before = { active: m.state().activeCell, coord: m.state().editing?.coord };
    expect(m.state().editing?.rowId).toBe("tmp-1");
    m.swap("tmp-1", server);
    expect(before.active).not.toBeNull();
    expect(m.state().activeCell).toEqual(before.active);
    expect(m.state().editing).toMatchObject({ rowId: "42", columnId: "note", coord: before.coord });
  });

  it("moves a checked row that a filter hides to the new id", () => {
    const m = mount();
    act(() => m.setState({ hiddenCheckedRowIds: new Set(["tmp-1", "b"]) }));
    m.swap("tmp-1", server);
    expect([...m.state().hiddenCheckedRowIds].sort()).toEqual(["42", "b"]);
  });

  it("moves cell errors and save status to the new id", async () => {
    let resolve!: (ack: SaveAck<Row>) => void;
    const pending = new Promise<SaveAck<Row>>((res) => {
      resolve = res;
    });
    const m = mount({ onSave: (() => pending) as never });
    act(() => m.state().actions.setCellErrors([{ rowId: "tmp-1", columnId: "name", message: "bad" }]));
    act(() => m.state().actions.commitCellValue({ rowId: "tmp-1", columnId: "note" }, "N"));
    expect(m.state().saveStatus.get("tmp-1")).toBe("saving");
    m.swap("tmp-1", { ...server, note: "N" });
    expect(m.state().saveStatus.get("42")).toBe("saving");
    expect(m.state().saveStatus.has("tmp-1")).toBe(false);
    expect(m.state().cellErrors.get("42:name")).toBe("bad");
    expect(m.state().cellErrors.has("tmp-1:name")).toBe(false);
    resolve(undefined);
    await flush();
    expect(m.state().saveStatus.size).toBe(0);
    expect(m.state().pendingSaveCount).toBe(0);
  });

  it("a save that was in flight for the old id reverts per cell on the new id when refused", async () => {
    let resolve!: (ack: SaveAck<Row>) => void;
    const pending = new Promise<SaveAck<Row>>((res) => {
      resolve = res;
    });
    const m = mount({ onSave: (() => pending) as never });
    act(() => m.state().actions.commitCellValue({ rowId: "tmp-1", columnId: "note" }, "N"));
    m.swap("tmp-1", { ...server, note: "N" });
    resolve({ rejected: [{ rowId: "tmp-1" }] });
    await flush();
    expect((m.state().data[0] as Row).note).toBe("a");
    expect((m.state().data[0] as Row).id).toBe("42");
    expect(m.state().saveStatus.get("42")).toBe("failed");
  });

  it("follows a controlled data prop: the consumer stores the id-swap change", () => {
    let data = initial();
    const onDataChange = (next: readonly Row[]) => {
      data = [...next];
    };
    const m = mount({ data, defaultData: undefined, onDataChange });
    m.swap("tmp-1", server);
    m.rerender({ data, defaultData: undefined, onDataChange });
    expect(m.ids()).toEqual(["42", "b", "c"]);
  });

  it("is a no-op for readOnly, an unknown id and an id another row holds, with one warning each kind", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = mount();
    m.swap("nope", server);
    m.swap("nope", server);
    m.swap("tmp-1", { id: "b", name: "x", note: "y" });
    expect(m.ids()).toEqual(["tmp-1", "b", "c"]);
    expect(warn).toHaveBeenCalledTimes(2);
    m.rerender({ readOnly: true });
    m.swap("tmp-1", server);
    expect(m.ids()).toEqual(["tmp-1", "b", "c"]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("does not re-sort: the row keeps its view position until reconcileView", () => {
    const m = mount({ defaultSortState: [{ columnId: "name", desc: false }] } as never);
    const viewBefore = [...m.state().viewIndex];
    m.swap("tmp-1", { ...server, name: "ZZZ" });
    expect([...m.state().viewIndex]).toEqual(viewBefore);
    expect(m.state().viewStale).toBe(true);
  });

  it("keeps the save bookkeeping when the server keeps the client id", async () => {
    let resolve!: (ack: SaveAck<Row>) => void;
    const pending = new Promise<SaveAck<Row>>((res) => {
      resolve = res;
    });
    const m = mount({ onSave: (() => pending) as never });
    act(() => m.state().actions.commitCellValue({ rowId: "tmp-1", columnId: "note" }, "N"));
    m.swap("tmp-1", { id: "tmp-1", name: "A", note: "N" });
    expect(m.state().saveStatus.get("tmp-1")).toBe("saving");
    resolve({ rejected: [{ rowId: "tmp-1" }] });
    await flush();
    expect(m.state().saveStatus.get("tmp-1")).toBe("failed");
    expect((m.state().data[0] as Row).note).toBe("a");
  });

  it("does not alias a later row that reuses the old id", async () => {
    const m = mount({ onSave: (() => Promise.resolve(undefined)) as never, createRow: () => ({ id: "tmp-1", name: "N", note: "n" }) });
    m.swap("tmp-1", server);
    act(() => m.state().actions.insertRow(0, "below"));
    expect(m.ids()).toContain("tmp-1");
    act(() => m.state().actions.commitCellValue({ rowId: "tmp-1", columnId: "note" }, "X"));
    await flush();
    expect(m.state().saveStatus.size).toBe(0);
    expect(m.state().pendingSaveCount).toBe(0);
  });

  it("replaceRowIds swaps several rows in one write and one id-swap change", () => {
    const changes: DataChange<Row>[] = [];
    const m = mount({ onDataChange: (_n: readonly Row[], c: DataChange<Row>) => void changes.push(c) });
    act(() => m.state().actions.replaceRowIds([{ oldId: "tmp-1", row: server }, { oldId: "b", row: { id: "43", name: "B", note: "b" } }]));
    expect(m.ids()).toEqual(["42", "43", "c"]);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.ops).toHaveLength(2);
  });

  it("runs validateRow again for the swapped row", () => {
    const validateRow = vi.fn(() => null);
    const m = mount({ validateRow });
    m.swap("tmp-1", server);
    expect(validateRow).toHaveBeenCalledWith(server, "42", expect.anything());
  });
  it("skips a chained or permuting batch swap instead of corrupting bookkeeping", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = mount();
    act(() => m.state().actions.replaceRowIds([{ oldId: "tmp-1", row: { id: "b", name: "x", note: "y" } }, { oldId: "b", row: { id: "c2", name: "B", note: "b" } }]));
    expect(m.ids()).toEqual(["tmp-1", "c2", "c"]);
  });

  it("a reused draft id swapped while the first save is in flight leaves no stuck saving row", async () => {
    const acks: Array<(ack: SaveAck<Row>) => void> = [];
    const m = mount({
      onSave: (() => new Promise<SaveAck<Row>>((res) => void acks.push(res))) as never,
      createRow: () => ({ id: "tmp-1", name: "N", note: "n" }),
    });
    act(() => m.state().actions.commitCellValue({ rowId: "tmp-1", columnId: "note" }, "X"));
    m.swap("tmp-1", server);
    act(() => m.state().actions.insertRow(0, "below"));
    act(() => m.state().actions.commitCellValue({ rowId: "tmp-1", columnId: "note" }, "Y"));
    m.swap("tmp-1", { id: "43", name: "N", note: "Y" });
    acks.forEach((resolve) => resolve(undefined));
    await flush();
    expect(m.state().saveStatus.size).toBe(0);
    expect(m.state().pendingSaveCount).toBe(0);
  });

  it("a same-id swap does not abort other pending work", () => {
    const m = mount();
    const before = m.state().rowIdentityVersion;
    m.swap("tmp-1", { id: "tmp-1", name: "A2", note: "a" });
    expect(m.state().rowIdentityVersion).toBe(before);
  });
});
