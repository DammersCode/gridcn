import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataChange } from "@/registry/default/blocks/data-grid/data-grid";
import { SAVE_REFRESH_MAX_WAIT_MS, useSaveRefresh, type SaveRefreshOptions } from "./save-refresh";

type Row = { id: string };
const change = {} as DataChange<Row>;
const saveCtx = { actions: {} as never, signal: new AbortController().signal };

function mount(options: SaveRefreshOptions<Row>) {
  const refresh = vi.fn();
  const hook = renderHook(() => useSaveRefresh(options, refresh));
  return { refresh, save: (c = change) => hook.result.current!(c, saveCtx), result: hook.result, unmount: hook.unmount };
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
  it("unmount clears the max-wait timer of a hanging save", () => {
    const m = mount({ onSave: () => deferred().promise as Promise<void> });
    void m.save();
    expect(vi.getTimerCount()).toBe(1);
    m.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("unmount clears the settle timer before it fires", async () => {
    const m = mount({ onSave: async () => {} });
    await m.save();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    m.unmount();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(SAVE_REFRESH_MAX_WAIT_MS);
    expect(m.refresh).not.toHaveBeenCalled();
  });

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

  it("joins saves that settle in one tick into one refresh", async () => {
    const m = mount({ onSave: async () => {} });
    await Promise.all([m.save(), m.save(), m.save()]);
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
    expect(policy).toHaveBeenCalledWith({ saved: 0, rejected: 1, failed: 0, changes: [change], pending: 0 });
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it("a rejected promise rethrows to the grid and, with no save answered, skips the refresh", async () => {
    const m = mount({ onSave: () => Promise.reject(new Error("down")) });
    await expect(m.save()).rejects.toThrow("down");
    await flush();
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it("a handler that returns nothing never refreshes", async () => {
    const m = mount({ onSave: () => {} });
    m.save();
    await flush();
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it("a save that never settles delays the refresh by at most the max wait", async () => {
    let first = true;
    const m = mount({ onSave: () => (first ? ((first = false), new Promise<void>(() => {})) : Promise.resolve()) });
    void m.save();
    await m.save();
    await flush();
    expect(m.refresh).not.toHaveBeenCalled();
    await act(async () => void (await vi.advanceTimersByTimeAsync(SAVE_REFRESH_MAX_WAIT_MS)));
    expect(m.refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes when a save settles after the max wait ran out with nothing settled", async () => {
    const hanging = deferred();
    const late = deferred();
    const queue = [hanging, late];
    const m = mount({ onSave: () => queue.shift()!.promise as Promise<void> });
    void m.save();
    const second = m.save();
    await act(async () => void (await vi.advanceTimersByTimeAsync(SAVE_REFRESH_MAX_WAIT_MS + 500)));
    expect(m.refresh).not.toHaveBeenCalled();
    late.resolve(undefined);
    await second;
    await flush();
    expect(m.refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes after each later save settles while an earlier save still hangs past the max wait", async () => {
    const [hanging, b, d] = [deferred(), deferred(), deferred()];
    const queue = [hanging, b, d];
    const m = mount({ onSave: () => queue.shift()!.promise as Promise<void> });
    void m.save();
    const second = m.save();
    const third = m.save();
    await act(async () => void (await vi.advanceTimersByTimeAsync(SAVE_REFRESH_MAX_WAIT_MS + 500)));
    b.resolve(undefined);
    await second;
    await flush();
    expect(m.refresh).toHaveBeenCalledTimes(1);
    d.resolve(undefined);
    await third;
    await flush();
    expect(m.refresh).toHaveBeenCalledTimes(2);
  });

  it("refreshes for a save that settles after the max wait expired with an earlier save settled", async () => {
    const [hanging, b, d] = [deferred(), deferred(), deferred()];
    const queue = [hanging, b, d];
    const m = mount({ onSave: () => queue.shift()!.promise as Promise<void> });
    void m.save();
    const second = m.save();
    const third = m.save();
    b.resolve(undefined);
    await second;
    await flush();
    expect(m.refresh).not.toHaveBeenCalled();
    await act(async () => void (await vi.advanceTimersByTimeAsync(SAVE_REFRESH_MAX_WAIT_MS)));
    expect(m.refresh).toHaveBeenCalledTimes(1);
    d.resolve(undefined);
    await third;
    await flush();
    expect(m.refresh).toHaveBeenCalledTimes(2);
  });

  it("passes the ack through unchanged", async () => {
    const ack = { rejected: [] };
    const m = mount({ onSave: async () => ack });
    await expect(m.save()).resolves.toBe(ack);
  });
});

describe("useSaveRefresh, bypass warning", () => {
  it("warns once when a save starts but the hook's onSave never ran", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let listener: (() => void) | null = null;
    renderHook(() => useSaveRefresh({ onSave: async () => {} }, vi.fn(), (next) => (listener = next)));
    listener!();
    listener!();
    await flush();
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("did not run"))).toHaveLength(1);
  });

  it("stays quiet when the wrapper ran", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let listener: (() => void) | null = null;
    const hook = renderHook(() => useSaveRefresh({ onSave: async () => {} }, vi.fn(), (next) => (listener = next)));
    await hook.result.current!(change, saveCtx);
    listener!();
    await flush();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("useSaveRefresh save context", () => {
  it("hands the grid's save context to the caller's onSave", async () => {
    const onSave = vi.fn(async () => {});
    const hook = renderHook(() => useSaveRefresh({ onSave }, vi.fn()));
    await hook.result.current!(change, saveCtx);
    expect(onSave).toHaveBeenCalledWith(change, saveCtx);
  });
});
