import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef, DataChange } from "../types";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState, type DataGridSyncProps } from ".";
import type { SaveAck, SaveContext } from "./write-ack";

type Row = { id: string; name: string };

const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];

function mount(onSave: (change: DataChange<Row>, ctx: SaveContext) => void | Promise<SaveAck<Row>>, props: Partial<DataGridSyncProps<Row>> = {}) {
  let api: StoreApi<DataGridStoreState> | null = null;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  const view = render(
    <DataGridProvider columns={columns} getRowId={(row: Row) => row.id} defaultData={[{ id: "a", name: "A" }]} onSave={onSave} {...props}>
      <Probe />
    </DataGridProvider>,
  );
  const state = () => api!.getState();
  return {
    state,
    unmount: () => view.unmount(),
    edit: (value: string) => act(() => state().actions.commitCellValue({ rowId: "a", columnId: "name" }, value)),
    name: () => (state().data as Row[])[0]!.name,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("onSave context", () => {
  it("passes the grid actions and a live signal", () => {
    const seen: SaveContext[] = [];
    const m = mount((_change, ctx) => void seen.push(ctx));
    m.edit("X");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.actions).toBe(m.state().actions);
    expect(seen[0]!.signal.aborted).toBe(false);
  });

  it("aborts the signal of a pending save when the grid unmounts", () => {
    let signal!: AbortSignal;
    const m = mount((_change, ctx) => {
      signal = ctx.signal;
      return new Promise<SaveAck<Row>>(() => {});
    });
    m.edit("X");
    expect(signal.aborted).toBe(false);
    m.unmount();
    expect(signal.aborted).toBe(true);
  });

  it("a one-argument handler keeps working", () => {
    const onSave = vi.fn((_change: DataChange<Row>) => {});
    mount(onSave).edit("X");
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe("saveTimeoutMs", () => {
  it("is off by default: a slow save is never refused", async () => {
    vi.useFakeTimers();
    let resolve!: () => void;
    const m = mount(() => new Promise<void>((r) => (resolve = r)));
    m.edit("X");
    await act(() => vi.advanceTimersByTimeAsync(10 * 60_000));
    expect(m.state().saveStatus.get("a")).toBe("saving");
    resolve();
    await act(async () => {});
    expect(m.name()).toBe("X");
  });

  it("refuses a save that outlives it: aborts the signal, reverts, and reports reason timeout", async () => {
    vi.useFakeTimers();
    let signal!: AbortSignal;
    const onSaveRejected = vi.fn();
    const m = mount(
      (_change, ctx) => {
        signal = ctx.signal;
        return new Promise<SaveAck<Row>>(() => {});
      },
      { saveTimeoutMs: 500, onSaveRejected },
    );
    m.edit("X");
    await act(() => vi.advanceTimersByTimeAsync(499));
    expect(signal.aborted).toBe(false);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(signal.aborted).toBe(true);
    expect(m.name()).toBe("A");
    expect(m.state().saveStatus.get("a")).toBe("failed");
    expect(onSaveRejected.mock.calls[0]![0].rejected[0]).toMatchObject({ rowId: "a", reason: "timeout" });
  });

  it("ignores the answer that arrives after the timeout", async () => {
    vi.useFakeTimers();
    let resolve!: () => void;
    const onSaveRejected = vi.fn();
    const m = mount(() => new Promise<void>((r) => (resolve = r)), { saveTimeoutMs: 100, onSaveRejected });
    m.edit("X");
    await act(() => vi.advanceTimersByTimeAsync(100));
    resolve();
    await act(async () => {});
    expect(onSaveRejected).toHaveBeenCalledTimes(1);
    expect(m.name()).toBe("A");
  });

  it("a save that settles in time clears the timer", async () => {
    vi.useFakeTimers();
    let resolve!: () => void;
    const onSaveRejected = vi.fn();
    const m = mount(() => new Promise<void>((r) => (resolve = r)), { saveTimeoutMs: 100, onSaveRejected });
    m.edit("X");
    resolve();
    await act(async () => {});
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(onSaveRejected).not.toHaveBeenCalled();
    expect(m.name()).toBe("X");
  });
});
