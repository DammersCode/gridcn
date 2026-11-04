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

  it("falls back to memory when reading throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    const storage = createLocalStorageViewsStorage("k3");
    expect(await storage.load(ctx)).toBeUndefined();
    await storage.save(doc);
    expect(await storage.load(ctx)).toEqual(doc);
  });
});
