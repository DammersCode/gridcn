import { act, render, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import { DataGridProvider, DataGridRoot, defineColumns, type DataChange } from "@/registry/default/blocks/data-grid/data-grid";
import { applyChangeWith, useDataGridStoreApi } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import type { DataGridStoreState } from "@/registry/default/blocks/data-grid/store";
import { applyChange } from "@/registry/default/blocks/data-grid/data-grid";
import { pruneIds, rowOfStreamUpdate, trackDeletes, useRefreshGuard } from "./refresh-guard";

type Row = { id: string; name: string };
const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text" }] as const);
const data: Row[] = Array.from({ length: 60 }, (_, i) => ({ id: `r${i}`, name: `Person ${i}` }));

function mount({ saves = "pending", trackUnacknowledged = false }: { saves?: "pending" | "none" | "resolving"; trackUnacknowledged?: boolean } = {}) {
  const resolvers: Array<() => void> = [];
  let guard!: ReturnType<typeof useRefreshGuard>;
  let store!: StoreApi<DataGridStoreState>;
  function Probe() {
    store = useDataGridStoreApi() as unknown as StoreApi<DataGridStoreState>;
    return null;
  }
  function Harness() {
    guard = useRefreshGuard({ trackUnacknowledged });
    const onSave = saves === "none" ? undefined : (_change: DataChange<Row>) => new Promise<void>((resolve) => saves === "resolving" && resolvers.push(resolve));
    return (
      <DataGridProvider data={data} getRowId={(row: Row) => row.id} columns={columns} plugins={guard.plugins} onSave={onSave}>
        <DataGridRoot>
          <Probe />
        </DataGridRoot>
      </DataGridProvider>
    );
  }
  render(<Harness />);
  const save = (start: number, end: number) => {
    for (let i = start; i < end; i++) act(() => store.getState().actions.commitCellValue({ rowId: `r${i}`, columnId: "name" }, `Saved ${i}`));
  };
  const select = (index: number) => act(() => store.getState().actions.selectCell({ rowId: `r${index}`, columnId: "name" }));
  const settleSaves = () => act(async () => resolvers.splice(0).forEach((resolve) => resolve()));
  return { guard: () => guard, save, select, settleSaves };
}

describe("the save log", () => {
  it("records no save while no request is open", () => {
    const t = mount();
    t.save(0, 50);
    expect(t.guard().savedSince(0)).toBeNull();
  });

  it("records the saves that start after a request opened, and drops them when the last request ends", () => {
    const t = mount();
    const mark = t.guard().saveMark();
    t.save(0, 5);
    expect(t.guard().savedSince(mark)?.size).toBe(5);
    t.guard().pruneSaves(null);
    expect(t.guard().savedSince(mark)).toBeNull();
    t.save(5, 10);
    expect(t.guard().savedSince(mark)).toBeNull();
  });

  it("holds one entry per saved row however often it saves", () => {
    const t = mount();
    const mark = t.guard().saveMark();
    for (let round = 0; round < 3; round++) t.save(0, 20);
    expect(t.guard().savedSince(mark)?.size).toBe(20);
  });
});

describe("pending deletes", () => {
  it("tracks deleted ids, forgets a restored row, and drops the ids whose save settled", () => {
    const deleted = new Set<string>();
    trackDeletes(deleted, { ops: [{ type: "delete", rowId: "a" }, { type: "delete", rowId: "b" }, { type: "delete", rowId: "c" }] });
    trackDeletes(deleted, { ops: [{ type: "insert", rowId: "b" }] });
    expect([...deleted]).toEqual(["a", "c"]);
    pruneIds(deleted, new Set(["c"]));
    expect([...deleted]).toEqual(["c"]);
    pruneIds(deleted, null);
    expect(deleted.size).toBe(0);
  });
});

describe("eviction protection", () => {
  it("protects nothing for an idle grid", () => {
    const t = mount({ saves: "none", trackUnacknowledged: true });
    expect(t.guard().evictionProtected()).toBeNull();
  });

  it("protects the row under the active cell", () => {
    const t = mount({ saves: "none" });
    t.select(7);
    expect([...t.guard().evictionProtected()!]).toEqual(["r7"]);
  });

  it("keeps an edit with no onSave until a landed block acknowledges it", () => {
    const t = mount({ saves: "none", trackUnacknowledged: true });
    t.save(3, 5);
    expect([...t.guard().evictionProtected()!].sort()).toEqual(["r3", "r4"]);
    t.guard().acknowledge("r3");
    expect([...t.guard().evictionProtected()!]).toEqual(["r4"]);
    expect(t.guard().unacknowledgedRows()?.has("r4")).toBe(true);
  });

  it("drops an unacknowledged row when its save leaves saving", async () => {
    const t = mount({ saves: "resolving", trackUnacknowledged: true });
    t.save(0, 2);
    expect([...t.guard().evictionProtected()!].sort()).toEqual(["r0", "r1"]);
    await t.settleSaves();
    expect(t.guard().evictionProtected()).toBeNull();
    expect(t.guard().unacknowledgedRows()).toBeNull();
  });

  it("tracks nothing unless asked to", () => {
    const t = mount({ saves: "none" });
    t.save(0, 3);
    expect(t.guard().unacknowledgedRows()).toBeNull();
  });

  it("forgets unacknowledged rows when the structural state resets", () => {
    const t = mount({ saves: "none", trackUnacknowledged: true });
    t.save(0, 3);
    t.guard().forgetStructural();
    expect(t.guard().unacknowledgedRows()).toBeNull();
  });
});

describe("replaying a stream update", () => {
  type Item = { id: string; name: string; price: number };
  const cols = [{ id: "name", accessorKey: "name" }, { id: "price", accessorKey: "price" }];
  const rows: Item[] = Array.from({ length: 1000 }, (_, i) => ({ id: `r${i}`, name: `n${i}`, price: i }));

  it("reads the row ids in one pass, the one applyChange makes anyway", () => {
    let calls = 0;
    const idOf = (row: Item) => (calls++, row.id);
    const op = { type: "update" as const, rowId: "r5", prev: rows[5]!, row: { ...rows[5]!, price: 7 }, cells: [{ columnId: "price", value: 7, prev: 5 }] };
    const change = { source: "stream" as const, ops: [op] };
    const next = applyChangeWith(rows, change, idOf, { rowOfUpdate: rowOfStreamUpdate(change, cols) });
    expect(calls).toBe(rows.length);
    expect(next[5]).toBe(op.row);
  });

  it("writes only the cells onto a row that is not the one the push was made on", () => {
    const landed = { id: "r5", name: "B", price: 10 };
    const op = { type: "update" as const, rowId: "r5", prev: rows[5]!, row: { id: "r5", name: "A", price: 7 }, cells: [{ columnId: "price", value: 7, prev: 5 }] };
    const change = { source: "stream" as const, ops: [op] };
    expect(applyChangeWith([landed], change, (row) => row.id, { rowOfUpdate: rowOfStreamUpdate(change, cols) })[0]).toEqual({ id: "r5", name: "B", price: 7 });
  });

  it("writes only the cells onto the first copy of a repeated id", () => {
    const first = { id: "r5", name: "B", price: 10 };
    const second = { id: "r5", name: "C", price: 20 };
    const op = { type: "update" as const, rowId: "r5", prev: rows[5]!, row: { id: "r5", name: "A", price: 7 }, cells: [{ columnId: "price", value: 7, prev: 5 }] };
    const change = { source: "stream" as const, ops: [op] };
    const next = applyChangeWith([first, second], change, (row) => row.id, { rowOfUpdate: rowOfStreamUpdate(change, cols) });
    expect(next).toEqual([{ id: "r5", name: "B", price: 7 }, second]);
  });

  it("keeps the whole row of a user edit", () => {
    const landed = { id: "r5", name: "B", price: 10 };
    const op = { type: "update" as const, rowId: "r5", prev: rows[5]!, row: { id: "r5", name: "A", price: 7 }, cells: [{ columnId: "price", value: 7, prev: 5 }] };
    const change = { source: "edit" as const, ops: [op] };
    expect(rowOfStreamUpdate(change, cols)).toBeUndefined();
    expect(applyChange([landed], change, (row) => row.id)[0]).toEqual({ id: "r5", name: "A", price: 7 });
  });
});

describe("merge bypass warning", () => {
  it("warns once when the grid reports a change the hook's merge never saw", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() => useRefreshGuard());
    const change = { source: "edit", ops: [] } as unknown as DataChange<Row>;
    result.current.plugins[0]!.onDataChange?.([], change, undefined as never);
    result.current.plugins[0]!.onDataChange?.([], change, undefined as never);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("merge did not run"))).toHaveLength(1);
  });

  it("stays quiet when markEdited ran first", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() => useRefreshGuard());
    result.current.markEdited();
    result.current.plugins[0]!.onDataChange?.([], { source: "edit", ops: [] } as unknown as DataChange<Row>, undefined as never);
    expect(warn).not.toHaveBeenCalled();
  });
});
