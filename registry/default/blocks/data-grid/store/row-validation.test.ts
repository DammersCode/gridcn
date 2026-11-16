import { describe, expect, it } from "vitest";
import { createStore } from "zustand/vanilla";
import { cellErrorKey } from "./compute";
import { createGateTracker } from "./gate-signal";
import { createRowIndexCache } from "./row-index";
import { createRowValidation } from "./row-validation";
import type { DataGridStoreState } from "./types";

type Row = { id: string };
type Verdict = Record<string, string> | null;

function setup(validateRow: (row: unknown, rowId: string) => Verdict | PromiseLike<Verdict>) {
  const data: Row[] = [{ id: "a" }, { id: "b" }];
  const store = createStore<DataGridStoreState>(
    () => ({ data, getRowId: (row: unknown) => (row as Row).id, cellErrors: new Map(), validateRow }) as unknown as DataGridStoreState,
  );
  const rowIndexCache = createRowIndexCache();
  const gates = createGateTracker({ publish: () => {}, subscribe: (listener) => store.subscribe(listener) });
  const validation = createRowValidation({ getStore: () => store, rowIndexCache, gates, warnOnce: () => {} });
  const apply = (...rowIds: string[]) => {
    const ops = rowIds.map((rowId) => ({ type: "update", rowId }));
    return validation.apply(store.getState(), store.getState().cellErrors, data, ops as never);
  };
  return { store, validation, apply };
}

describe("createRowValidation", () => {
  it("returns the same map when validateRow is absent", () => {
    const { store, validation } = setup(() => null);
    store.setState({ validateRow: undefined });
    const errors = store.getState().cellErrors;
    expect(validation.apply(store.getState(), errors, [], [{ type: "update", rowId: "a" }] as never)).toBe(errors);
  });

  it("writes a sync verdict and clears it on the next clean run", () => {
    let message: Verdict = { x: "bad" };
    const { apply } = setup(() => message);
    expect(apply("a").get(cellErrorKey("a", "x"))).toBe("bad");
    message = null;
    expect(apply("a").size).toBe(0);
  });

  it("merges async verdicts that settle in the same tick into one write", async () => {
    let writes = 0;
    const ctx = setup(() => Promise.resolve({ x: "late" }));
    ctx.store.subscribe(() => writes++);
    ctx.apply("a", "b");
    await Promise.resolve();
    await Promise.resolve();
    expect(writes).toBe(1);
    expect(ctx.store.getState().cellErrors.size).toBe(2);
  });

  it("drops the pending verdict of a row that was renamed", async () => {
    const ctx = setup(() => Promise.resolve({ x: "late" }));
    ctx.apply("a");
    ctx.validation.renameRow("a", "z");
    await Promise.resolve();
    await Promise.resolve();
    expect(ctx.store.getState().cellErrors.size).toBe(0);
  });

  it("moves the keys of a renamed row so a later clean run clears them", () => {
    let verdict: Verdict = { x: "bad" };
    const ctx = setup(() => verdict);
    const withError = ctx.apply("a");
    ctx.validation.renameRow("a", "b");
    verdict = null;
    const cleared = ctx.validation.apply(ctx.store.getState(), new Map([[cellErrorKey("b", "x"), "bad"]]), [{ id: "b" }], [{ type: "update", rowId: "b" }] as never);
    expect(withError.size).toBe(1);
    expect(cleared.size).toBe(0);
  });

  it("prunes the keys of rows that left the data", () => {
    let verdict: Verdict = { x: "bad" };
    const ctx = setup(() => verdict);
    ctx.apply("a");
    verdict = null;
    ctx.validation.prune([{ id: "b" }], (row) => (row as Row).id);
    const errors = new Map([[cellErrorKey("a", "x"), "consumer"]]);
    const next = ctx.validation.apply(ctx.store.getState(), errors, [{ id: "a" }], [{ type: "update", rowId: "a" }] as never);
    expect(next.get(cellErrorKey("a", "x"))).toBe("consumer");
  });
});
