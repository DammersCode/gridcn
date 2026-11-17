import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef, DataChange } from "../types";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState, type DataGridSyncProps } from ".";
import type { SaveAck, SaveConflictContext, SaveResolution } from "./write-ack";
import { viewIndexes } from "@/registry/default/blocks/data-grid/types";

type Row = { id: string; name: string; note: string; version: number };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "note", header: "Note", accessorKey: "note" },
];

const initial = (): Row[] => [
  { id: "a", name: "A", note: "a", version: 1 },
  { id: "b", name: "B", note: "b", version: 1 },
];

const theirs: Row = { id: "a", name: "SERVER", note: "server-note", version: 2 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function mount(onSave: (change: DataChange<Row>) => void | Promise<SaveAck<Row>>, props: Partial<DataGridSyncProps<Row>> = {}) {
  let api: StoreApi<DataGridStoreState> | null = null;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  const tree = (next: Partial<DataGridSyncProps<Row>>) => (
    <DataGridProvider columns={columns} getRowId={(row: Row) => row.id} defaultData={initial()} onSave={onSave as never} {...next}>
      <Probe />
    </DataGridProvider>
  );
  const view = render(tree(props));
  const state = () => api!.getState();
  return {
    state,
    unmount: () => view.unmount(),
    rerender: (next: Partial<DataGridSyncProps<Row>>) => view.rerender(tree(next)),
    edit: (rowId: string, columnId: string, value: unknown) => act(() => state().actions.commitCellValue({ rowId, columnId }, value)),
    row: (rowId: string) => (state().data as Row[]).find((r) => r.id === rowId)!,
  };
}

const flush = () => act(async () => {});
const refuse = (current: Row = theirs): SaveAck<Row> => ({ rejected: [{ rowId: "a", message: "stale", current }] });

afterEach(() => vi.restoreAllMocks());

describe("resolveSaveConflict", () => {
  it("is called with the grid's row, the server's row, the change and the message", async () => {
    const seen: SaveConflictContext<Row>[] = [];
    const m = mount(() => Promise.resolve(refuse()), { resolveSaveConflict: (ctx) => void seen.push(ctx) });
    m.edit("a", "name", "X");
    await flush();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ rowId: "a", mine: { name: "X" }, theirs, message: "stale" });
    expect(seen[0]!.change.source).toBe("edit");
    expect(seen[0]!.signal.aborted).toBe(false);
  });

  it.each<[string, SaveResolution<Row>]>([
    ["nothing", undefined],
    ['"theirs"', "theirs"],
  ])("%s takes the server's row in the rollback change", async (_label, answer) => {
    const changes: DataChange<Row>[] = [];
    const m = mount(() => Promise.resolve(refuse()), { resolveSaveConflict: () => answer, onDataChange: (_n: readonly Row[], c: DataChange<Row>) => void changes.push(c) });
    m.edit("a", "name", "X");
    await flush();
    expect(m.row("a")).toEqual(theirs);
    expect(changes.map((c) => c.source)).toEqual(["edit", "rollback"]);
    expect(changes[1]!.serverRowIds).toEqual(["a"]);
  });

  it('"mine" puts the user\'s row on top of the server\'s row as one "merge" change that onSave receives', async () => {
    const saved: DataChange<Row>[] = [];
    const sources: string[] = [];
    const m = mount(
      (change) => {
        saved.push(change);
        return Promise.resolve(saved.length === 1 ? refuse() : undefined);
      },
      { resolveSaveConflict: () => "mine", onDataChange: (_n: readonly Row[], c: DataChange<Row>) => void sources.push(c.source) },
    );
    m.edit("a", "name", "X");
    await flush();
    expect(sources).toEqual(["edit", "rollback", "merge"]);
    expect(m.row("a").name).toBe("X");
    expect(saved).toHaveLength(2);
    expect(saved[1]!.source).toBe("merge");
    const op = saved[1]!.ops[0]!;
    expect(op).toMatchObject({ type: "update", rowId: "a", prev: theirs });
    expect(saved[1]!.reverts).toBe(saved[0]);
    expect(m.state().saveStatus.get("a")).toBeUndefined();
  });

  it("a merged row replaces the row and is saved", async () => {
    const merged: Row = { id: "a", name: "X", note: "server-note", version: 2 };
    const saved: DataChange<Row>[] = [];
    const m = mount(
      (change) => {
        saved.push(change);
        return Promise.resolve(saved.length === 1 ? refuse() : undefined);
      },
      { resolveSaveConflict: () => ({ row: merged }) },
    );
    m.edit("a", "name", "X");
    await flush();
    expect(m.row("a")).toEqual(merged);
    expect(saved[1]!.source).toBe("merge");
  });

  it("a merged row with another id falls back to the server's row with one warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = mount(() => Promise.resolve(refuse()), { resolveSaveConflict: () => ({ row: { ...theirs, id: "zzz" } }) });
    m.edit("a", "name", "X");
    await flush();
    expect(m.row("a")).toEqual(theirs);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("a throwing resolver falls back to the server's row and logs", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const m = mount(() => Promise.resolve(refuse()), {
      resolveSaveConflict: () => {
        throw new Error("boom");
      },
    });
    m.edit("a", "name", "X");
    await flush();
    expect(m.row("a")).toEqual(theirs);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("an async resolver keeps the row saving until it answers", async () => {
    const answer = deferred<SaveResolution<Row>>();
    const m = mount(() => Promise.resolve(refuse()), { resolveSaveConflict: () => answer.promise });
    m.edit("a", "name", "X");
    await flush();
    expect(m.state().saveStatus.get("a")).toBe("saving");
    expect(m.row("a").name).toBe("X");
    answer.resolve("theirs");
    await flush();
    expect(m.row("a")).toEqual(theirs);
    expect(m.state().saveStatus.get("a")).toBe("failed");
  });

  it("a newer write to the row aborts the resolver and the answer is ignored", async () => {
    const answer = deferred<SaveResolution<Row>>();
    let signal: AbortSignal | undefined;
    const acks = [Promise.resolve(refuse()), new Promise<SaveAck<Row>>(() => {})];
    const m = mount(() => acks.shift()!, {
      resolveSaveConflict: (ctx) => {
        signal = ctx.signal;
        return answer.promise;
      },
    });
    m.edit("a", "name", "X");
    await flush();
    m.edit("a", "note", "N");
    expect(signal?.aborted).toBe(true);
    answer.resolve("theirs");
    await flush();
    expect(m.row("a").note).toBe("N");
    expect(m.row("a").name).not.toBe("SERVER");
  });

  it("an unmount aborts a pending resolver, and its late answer throws nothing", async () => {
    const answer = deferred<SaveResolution<Row>>();
    let signal: AbortSignal | undefined;
    const m = mount(() => Promise.resolve(refuse()), {
      resolveSaveConflict: (ctx) => {
        signal = ctx.signal;
        return answer.promise;
      },
    });
    m.edit("a", "name", "X");
    await flush();
    m.unmount();
    expect(signal?.aborted).toBe(true);
    answer.resolve("theirs");
    await flush();
  });

  it("is not called while a newer write to the row is pending", async () => {
    const resolver = vi.fn();
    const acks = [Promise.resolve(refuse()), new Promise<SaveAck<Row>>(() => {})];
    const m = mount(() => acks.shift()!, { resolveSaveConflict: resolver });
    m.edit("a", "name", "X");
    m.edit("a", "note", "N");
    await flush();
    expect(resolver).not.toHaveBeenCalled();
    expect(m.row("a").note).toBe("N");
  });

  it("is not called for a refused insert or delete", async () => {
    const resolver = vi.fn();
    const m = mount(() => Promise.resolve({ rejected: [{ rowId: "a", current: theirs }] }), { resolveSaveConflict: resolver });
    act(() => m.state().actions.deleteRowsAt(viewIndexes([0])));
    await flush();
    expect(resolver).not.toHaveBeenCalled();
    expect(m.row("a")).toEqual(theirs);
  });

  it("is not called on a readOnly grid, which still takes the server row", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const resolver = vi.fn();
    const ack = deferred<SaveAck<Row>>();
    const m = mount(() => ack.promise, { resolveSaveConflict: resolver });
    m.edit("a", "name", "X");
    m.rerender({ resolveSaveConflict: resolver, readOnly: true });
    ack.resolve(refuse());
    await flush();
    expect(resolver).not.toHaveBeenCalled();
    expect(m.row("a").name).not.toBe("X");
  });

  it("onSaveRejected still reports the refusal after a resolution", async () => {
    const onSaveRejected = vi.fn();
    const m = mount(() => Promise.resolve(refuse()), { resolveSaveConflict: () => "theirs", onSaveRejected });
    m.edit("a", "name", "X");
    await flush();
    expect(onSaveRejected).toHaveBeenCalledTimes(1);
    expect(onSaveRejected.mock.calls[0]![0].rejected[0].rowId).toBe("a");
  });

  it("announces the refused rows through the live region", async () => {
    const m = mount(() => Promise.resolve(refuse()));
    m.edit("a", "name", "X");
    await flush();
    expect(m.state().liveAnnouncement).toMatchObject({ kind: "saveRejected", count: 1 });
  });

  it.each([null, 42, { nope: 1 }])("treats the answer %j as the server's row and still reports the refusal", async (answer) => {
    const onSaveRejected = vi.fn();
    const m = mount(() => Promise.resolve(refuse()), { resolveSaveConflict: (() => answer) as never, onSaveRejected });
    m.edit("a", "name", "X");
    await flush();
    expect(m.row("a")).toEqual(theirs);
    expect(m.state().saveStatus.get("a")).toBe("failed");
    expect(onSaveRejected).toHaveBeenCalledTimes(1);
  });

  it("a plain refusal of another row in the same change still fails and reverts while an async resolver waits", async () => {
    const answer = deferred<SaveResolution<Row>>();
    const bTheirs: Row = { id: "b", name: "SRV-B", note: "b", version: 2 };
    const m = mount(() => Promise.resolve({ rejected: [{ rowId: "a", current: theirs }, { rowId: "b", current: bTheirs }] }), {
      resolveSaveConflict: (ctx) => (ctx.rowId === "a" ? answer.promise : "theirs"),
    });
    act(() => m.state().actions.applyCellUpdates([{ viewRowIndex: 0, columnId: "name", value: "X" }, { viewRowIndex: 1, columnId: "name", value: "Y" }], "edit"));
    await flush();
    answer.resolve("theirs");
    await flush();
    expect(m.row("a")).toEqual(theirs);
    expect(m.row("b")).toEqual(bTheirs);
    expect(m.state().saveStatus.get("a")).toBe("failed");
    expect(m.state().saveStatus.get("b")).toBe("failed");
  });

  it("an id swap while the resolver waits leaves no stuck saving row and reverts per cell", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const answer = deferred<SaveResolution<Row>>();
    const swapped: Row = { ...theirs, id: "a" };
    const m = mount(() => Promise.resolve({ rejected: [{ rowId: "a", current: swapped }] }), { resolveSaveConflict: () => answer.promise });
    m.edit("a", "name", "X");
    await flush();
    act(() => m.state().actions.replaceRowId("a", { ...m.row("a"), id: "z" }));
    answer.resolve("theirs");
    await flush();
    expect(m.state().saveStatus.get("z")).toBe("failed");
    expect(m.state().saveStatus.has("a")).toBe(false);
    expect((m.state().data as Row[]).find((r) => r.id === "z")?.name).toBe("A");
  });

  it("a cell-level refusal with current resolves the whole row", async () => {
    const seen: string[] = [];
    const m = mount(() => Promise.resolve({ rejected: [{ rowId: "a", columnId: "name", current: theirs }] }), { resolveSaveConflict: (ctx) => void seen.push(ctx.rowId) });
    m.edit("a", "name", "X");
    await flush();
    expect(seen).toEqual(["a"]);
    expect(m.row("a")).toEqual(theirs);
  });

  it("a refused merge change calls the resolver again and the resolver can stop with theirs", async () => {
    const answers: SaveResolution<Row>[] = ["mine", "theirs"];
    const sources: string[] = [];
    const m = mount(() => Promise.resolve(refuse()), {
      resolveSaveConflict: (ctx) => {
        sources.push(ctx.change.source);
        return answers.shift();
      },
    });
    m.edit("a", "name", "X");
    await flush();
    await flush();
    expect(sources).toEqual(["edit", "merge"]);
    expect(m.row("a")).toEqual(theirs);
  });
  it("a resolver that ignores its aborted signal does not hold the other rows", async () => {
    const never = new Promise<SaveResolution<Row>>(() => {});
    const acks = [Promise.resolve(refuse()), new Promise<SaveAck<Row>>(() => {})];
    const m = mount(() => acks.shift()!, { resolveSaveConflict: () => never });
    m.edit("a", "name", "X");
    await flush();
    m.edit("a", "note", "N");
    await flush();
    expect(m.row("a").name).not.toBe("SERVER");
    expect(m.state().saveStatus.get("a")).toBe("saving");
    expect(m.state().pendingSaveCount).toBe(1);
  });

  it("a thenable whose then throws refuses the change instead of leaving the row saving", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = {};
    Reflect.set(bad, "then", () => {
      throw new Error("bad thenable");
    });
    const m = mount(() => bad as never);
    m.edit("a", "name", "X");
    await flush();
    expect(m.row("a").name).toBe("A");
    expect(m.state().saveStatus.get("a")).toBe("failed");
  });
});
