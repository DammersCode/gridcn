import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef, DataChange } from "../types";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState, type DataGridSyncProps } from ".";
import type { SaveAck, SaveConflictContext, SaveResolution } from "./write-ack";

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

  it("an unmount aborts a pending resolver and reverts nothing", async () => {
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
    act(() => m.state().actions.deleteRows([0]));
    await flush();
    expect(resolver).not.toHaveBeenCalled();
    expect(m.row("a")).toEqual(theirs);
  });

  it("is not called on a readOnly grid, which keeps the refused value", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const resolver = vi.fn();
    const ack = deferred<SaveAck<Row>>();
    const m = mount(() => ack.promise, { resolveSaveConflict: resolver });
    m.edit("a", "name", "X");
    m.rerender({ resolveSaveConflict: resolver, readOnly: true });
    ack.resolve(refuse());
    await flush();
    expect(resolver).not.toHaveBeenCalled();
    expect(m.row("a").name).toBe("X");
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
});
