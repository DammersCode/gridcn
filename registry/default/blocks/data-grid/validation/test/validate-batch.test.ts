import { describe, expect, it, vi } from "vitest";
import { VALIDATE_CONCURRENCY, resolveBulkWrites, runValidateBatch, type BulkCandidate } from "../validate-batch";
import type { StandardSchemaV1 } from "../../types";

function schema(validate: (value: unknown) => unknown): StandardSchemaV1 {
  return { "~standard": { version: 1, vendor: "mock", validate } } as never;
}

const syncDouble = schema((v) => ({ value: (v as number) * 2 }));
const asyncDouble = schema(async (v) => ({ value: (v as number) * 2 }));
const asyncReject = schema(async () => ({ issues: [{ message: "nope" }] }));

describe("runValidateBatch — sync contract", () => {
  it("returns the array directly (never a Promise) when nothing is async", () => {
    const results = runValidateBatch([
      { validate: undefined, value: 1, row: {} },
      { validate: (v) => ((v as number) > 0 ? null : "positive"), value: 2, row: {} },
      { validate: syncDouble, value: 3, row: {} },
    ]);
    expect(results).not.toBeInstanceOf(Promise);
    expect(results).toEqual([{ value: 1 }, { value: 2 }, { value: 6 }]);
  });

  it("invokes no async machinery on the sync path — nothing is ever chained or queued", () => {
    const thenSpy = vi.spyOn(Promise.prototype, "then");
    const queueSpy = vi.spyOn(globalThis, "queueMicrotask");
    const results = runValidateBatch([
      { validate: undefined, value: 1, row: {} },
      { validate: (v) => ((v as number) > 0 ? null : "positive"), value: 2, row: {} },
      { validate: syncDouble, value: 3, row: {} },
    ]);
    expect(results).not.toBeInstanceOf(Promise);
    expect(thenSpy).not.toHaveBeenCalled();
    expect(queueSpy).not.toHaveBeenCalled();
    thenSpy.mockRestore();
    queueSpy.mockRestore();
  });

  it("an empty batch is sync and empty", () => {
    expect(runValidateBatch([])).toEqual([]);
  });
});

describe("runValidateBatch — async branch", () => {
  it("resolves a pass/fail mix positionally, keeping the schema's transformed value", async () => {
    const results = runValidateBatch([
      { validate: asyncDouble, value: 5, row: {} },
      { validate: asyncReject, value: 5, row: {} },
      { validate: undefined, value: 7, row: {} },
    ]);
    expect(results).toBeInstanceOf(Promise);
    await expect(results).resolves.toEqual([{ value: 10 }, { error: "nope" }, { value: 7 }]);
  });

  it("a sync validator AFTER the first async one still resolves in place", async () => {
    await expect(
      runValidateBatch([
        { validate: asyncDouble, value: 1, row: {} },
        { validate: syncDouble, value: 2, row: {} },
      ]),
    ).resolves.toEqual([{ value: 2 }, { value: 4 }]);
  });

  it("a throwing validator is that cell's rejection, not the batch's", async () => {
    const results = await runValidateBatch([
      { validate: asyncDouble, value: 1, row: {} },
      {
        validate: () => {
          throw new Error("boom");
        },
        value: 2,
        row: {},
      },
    ]);
    expect(results).toEqual([{ value: 2 }, { error: "boom" }]);
  });

  it("a rejected schema promise is that cell's rejection", async () => {
    const results = await runValidateBatch([
      { validate: schema(async () => Promise.reject(new Error("network"))), value: 1, row: {} },
      { validate: asyncDouble, value: 2, row: {} },
    ]);
    expect(results).toEqual([{ error: "network" }, { value: 4 }]);
  });
});

describe("runValidateBatch — concurrency cap", () => {
  /** Instruments a schema so the test can watch how many validations are in flight at once. */
  function tracker() {
    const state = { inFlight: 0, peak: 0 };
    const resolvers: (() => void)[] = [];
    const validate = schema(() => {
      state.inFlight += 1;
      state.peak = Math.max(state.peak, state.inFlight);
      return new Promise((resolve) => {
        resolvers.push(() => {
          state.inFlight -= 1;
          resolve({ value: "ok" });
        });
      });
    });
    return { state, resolvers, validate };
  }

  it("never exceeds the default cap, however large the batch", async () => {
    const { state, resolvers, validate } = tracker();
    const items = Array.from({ length: 200 }, (_, i) => ({ validate, value: i, row: {} }));
    const pending = runValidateBatch(items);

    // Drain in waves: each tick releases everything started so far, letting the next wave start.
    while (resolvers.length > 0) {
      resolvers.splice(0).forEach((release) => release());
      await Promise.resolve();
      await Promise.resolve();
    }
    await pending;
    expect(state.peak).toBeLessThanOrEqual(VALIDATE_CONCURRENCY);
    expect(state.peak).toBeGreaterThan(1);
  });

  it("honors an explicit lower cap", async () => {
    const { state, resolvers, validate } = tracker();
    const items = Array.from({ length: 50 }, (_, i) => ({ validate, value: i, row: {} }));
    const pending = runValidateBatch(items, 4);

    while (resolvers.length > 0) {
      resolvers.splice(0).forEach((release) => release());
      await Promise.resolve();
      await Promise.resolve();
    }
    await pending;
    expect(state.peak).toBeLessThanOrEqual(4);
  });

  it("validates every item exactly once", async () => {
    const spy = vi.fn(async () => ({ value: "ok" }));
    const items = Array.from({ length: 100 }, (_, i) => ({ validate: schema(spy), value: i, row: {} }));
    const results = await runValidateBatch(items);
    expect(spy).toHaveBeenCalledTimes(100);
    expect(results).toHaveLength(100);
  });
});

describe("resolveBulkWrites", () => {
  const candidates: BulkCandidate[] = [
    { viewRow: 0, columnId: "a", value: 1, validate: asyncDouble, row: {} },
    { viewRow: 0, columnId: "b", value: 2, validate: asyncReject, row: {} },
    { viewRow: 1, columnId: "a", value: 3, validate: undefined, row: {} },
  ];

  it("keeps only the passing cells and commits the transformed value", async () => {
    await expect(resolveBulkWrites(candidates)).resolves.toEqual([
      { viewRow: 0, columnId: "a", value: 2 },
      { viewRow: 1, columnId: "a", value: 3 },
    ]);
  });

  it("stays synchronous when no candidate is async", () => {
    const writes = resolveBulkWrites([{ viewRow: 0, columnId: "a", value: 4, validate: syncDouble, row: {} }]);
    expect(writes).not.toBeInstanceOf(Promise);
    expect(writes).toEqual([{ viewRow: 0, columnId: "a", value: 8 }]);
  });
});
