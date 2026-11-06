import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataChange } from "@/registry/default/blocks/data-grid/data-grid";
import { useSaveRefresh, type SaveRefreshOptions } from "./save-refresh";

type Row = { id: string };
const change = {} as DataChange<Row>;

function mount(options: SaveRefreshOptions<Row>) {
  const refresh = vi.fn();
  const hook = renderHook(() => useSaveRefresh(options, refresh));
  return { refresh, save: (c = change) => hook.result.current!(c), result: hook.result };
}
const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(5)));
const deferred = () => {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useSaveRefresh", () => {
  it("returns nothing without onSave, so a spread never overrides the provider's own", () => {
    expect(mount({}).result.current).toBeUndefined();
  });

  it("refreshes once after parallel saves have all settled", async () => {
    const a = deferred();
    const b = deferred();
    const queue = [a, b];
    const m = mount({ onSave: () => queue.shift()!.promise as Promise<void> });
    const first = m.save();
    const second = m.save();
    a.resolve(undefined);
    await first;
    await flush();
    expect(m.refresh).not.toHaveBeenCalled();
    b.resolve(undefined);
    await second;
    await flush();
    expect(m.refresh).toHaveBeenCalledTimes(1);
  });

  it("joins synchronous saves of one tick into one refresh", async () => {
    const m = mount({ onSave: () => {} });
    m.save();
    m.save();
    m.save();
    await flush();
    expect(m.refresh).toHaveBeenCalledTimes(1);
  });

  it('"each" refreshes after every settled save', async () => {
    const m = mount({ onSave: async () => {}, refreshAfterSave: "each" });
    await m.save();
    await flush();
    await m.save();
    await flush();
    expect(m.refresh).toHaveBeenCalledTimes(2);
  });

  it("false never refreshes", async () => {
    const m = mount({ onSave: async () => {}, refreshAfterSave: false });
    await m.save();
    await flush();
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it("a function gets the counts and decides", async () => {
    const policy = vi.fn(() => false);
    const m = mount({ onSave: async () => ({ rejected: [{ rowId: "a" }] as never }), refreshAfterSave: policy });
    await m.save();
    await flush();
    expect(policy).toHaveBeenCalledWith({ saved: 0, rejected: 1, failed: 0 });
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it("a rejected promise counts as failed, still refreshes by default, and rethrows to the grid", async () => {
    const m = mount({ onSave: () => Promise.reject(new Error("down")) });
    await expect(m.save()).rejects.toThrow("down");
    await flush();
    expect(m.refresh).toHaveBeenCalledTimes(1);
  });

  it("passes the ack through unchanged", async () => {
    const ack = { rejected: [] };
    const m = mount({ onSave: async () => ack });
    await expect(m.save()).resolves.toBe(ack);
  });
});
