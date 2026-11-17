import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalStorageViewsStorage, createMemoryViewsStorage } from "./view-storage";
import { emptyViewState, type DataGridViewsDocument } from "./view-state";

const ctx = { signal: new AbortController().signal };
const doc: DataGridViewsDocument = { version: 1, defaultViewId: "a", views: [{ id: "a", name: "A", state: emptyViewState() }] };

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("createMemoryViewsStorage", () => {
  it("loads what was saved", async () => {
    const storage = createMemoryViewsStorage();
    await storage.save(doc);
    expect(await storage.load(ctx)).toEqual(doc);
  });

  it("starts from a seed", async () => {
    expect(await createMemoryViewsStorage(doc).load(ctx)).toEqual(doc);
  });
});

describe("createLocalStorageViewsStorage", () => {
  it("tells a subscriber about a storage event on its key only, until it unsubscribes", () => {
    const onChange = vi.fn();
    const stop = createLocalStorageViewsStorage("k-sub").subscribe!(onChange);
    window.dispatchEvent(new StorageEvent("storage", { key: "other" }));
    expect(onChange).not.toHaveBeenCalled();
    window.dispatchEvent(new StorageEvent("storage", { key: "k-sub" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
    window.dispatchEvent(new StorageEvent("storage", { key: "k-sub" }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("tells the other subscribers of the key on this page about a save, which fires no storage event here", async () => {
    const onChange = vi.fn();
    const onOtherKey = vi.fn();
    const stop = createLocalStorageViewsStorage("k-page").subscribe!(onChange);
    createLocalStorageViewsStorage("k-else").subscribe!(onOtherKey);
    await createLocalStorageViewsStorage("k-page").save(doc);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onOtherKey).not.toHaveBeenCalled();
    stop();
    await createLocalStorageViewsStorage("k-page").save(doc);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("round-trips through localStorage under the key", async () => {
    const storage = createLocalStorageViewsStorage("k1");
    await storage.save(doc);
    expect(JSON.parse(localStorage.getItem("k1")!)).toEqual(doc);
    expect(await createLocalStorageViewsStorage("k1").load(ctx)).toEqual(doc);
  });

  it("treats malformed text as no document and throws on oversize text", async () => {
    localStorage.setItem("bad", "{nope");
    expect(await createLocalStorageViewsStorage("bad").load(ctx)).toBeUndefined();
    localStorage.setItem("big", "x".repeat(1_100_000));
    expect(() => createLocalStorageViewsStorage("big").load(ctx)).toThrow();
  });

  it("keeps the document in memory and throws when writing fails", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    const storage = createLocalStorageViewsStorage("k2");
    expect(() => storage.save(doc)).toThrow();
    expect(await createLocalStorageViewsStorage("k2").load(ctx)).toEqual(doc);
  });

  it("falls back to memory when the store is blocked", async () => {
    for (const method of ["getItem", "setItem"] as const) {
      vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new DOMException("denied", "SecurityError");
      });
    }
    const storage = createLocalStorageViewsStorage("k3");
    expect(await storage.load(ctx)).toBeUndefined();
    expect(() => storage.save(doc)).toThrow();
    expect(await storage.load(ctx)).toEqual(doc);
  });

  it("prefers the unsaved document over an older stored one, and forgets it after a good save", async () => {
    const older = { ...doc, defaultViewId: null };
    localStorage.setItem("k4", JSON.stringify(older));
    const failing = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    const storage = createLocalStorageViewsStorage("k4");
    expect(() => storage.save(doc)).toThrow();
    expect(await createLocalStorageViewsStorage("k4").load(ctx)).toEqual(doc);
    failing.mockRestore();
    await storage.save(doc);
    localStorage.clear();
    expect(await createLocalStorageViewsStorage("k4").load(ctx)).toBeUndefined();
  });
});
