import { describe, expect, it, vi } from "vitest";
import { createDataGridStore } from "../store/create-store";
import { isBulkBatchCurrent, reresolveBulkWrites, type BulkGeneration } from "../validation/bulk-generation";
import type { InternalSyncProps } from "../store/types";
import { textCellType } from "../cell-types/text";
import { pasteText } from "./use-grid-clipboard";

type Row = { id: string; code: string };

const settle = () => new Promise<void>((resolve) => setTimeout(resolve));

function mount(resolveTexts: NonNullable<typeof textCellType.resolveTexts>) {
  const known = new Map<string, string>();
  const codes = {
    ...textCellType,
    resolveTexts: (texts: readonly string[], options: unknown, ctx: { signal: AbortSignal }) => resolveTexts(texts, options, ctx),
    fromText: (text: string) => known.get(text) ?? text,
  };
  const onDataChange = vi.fn();
  const base = {
    data: ["a", "b", "c"].map((id) => ({ id, code: id })),
    columns: [{ id: "code", header: "Code", accessorKey: "code", type: "codes" }],
    cellTypes: { codes },
    getRowId: (row: unknown) => (row as Row).id,
    onDataChange,
  } as unknown as InternalSyncProps;
  const store = createDataGridStore(base);
  let generation = 0;
  const guard: BulkGeneration = { begin: () => ++generation, isCurrent: (t, s, snap) => generation === t && isBulkBatchCurrent(s, snap), reresolve: reresolveBulkWrites };
  store.getState().actions.selectCellAt({ col: 0, row: 0 });
  return {
    known,
    onDataChange,
    store,
    paste: (text: string) => pasteText(store.getState(), store.getState().actions, text, guard, store),
    codes: () => store.getState().data.map((row) => (row as Row).code),
  };
}

describe("cell type resolveTexts on paste", () => {
  it("calls the hook once with the distinct texts, holds the paste as a gate, then parses with what it learned", async () => {
    let finish!: () => void;
    const calls: (readonly string[])[] = [];
    const m = mount((texts) => {
      calls.push(texts);
      return new Promise<void>((resolve) => (finish = resolve));
    });
    m.paste("Alpha\nBeta\nAlpha");
    expect(calls).toEqual([["Alpha", "Beta"]]);
    expect(m.store.getState().gatesPending.has("resolveTexts")).toBe(true);
    expect(m.codes()).toEqual(["a", "b", "c"]);

    m.known.set("Alpha", "A1");
    m.known.set("Beta", "B1");
    finish();
    await settle();

    expect(m.store.getState().gatesPending.has("resolveTexts")).toBe(false);
    expect(m.codes()).toEqual(["A1", "B1", "A1"]);
    expect(m.onDataChange).toHaveBeenCalledTimes(1);
  });

  it("writes in the same tick when the hook is sync", () => {
    const m = mount(() => {});
    m.paste("x");
    expect(m.codes()).toEqual(["x", "b", "c"]);
  });

  it("drops the paste when a newer paste supersedes it, and aborts the signal", async () => {
    const signals: AbortSignal[] = [];
    const resolvers: (() => void)[] = [];
    const m = mount((_texts, _options, ctx) => {
      signals.push(ctx.signal);
      return new Promise<void>((resolve) => resolvers.push(resolve));
    });
    m.paste("one");
    m.paste("two");
    expect(signals[0]!.aborted).toBe(true);
    resolvers.forEach((resolve) => resolve());
    await settle();
    expect(m.codes()).toEqual(["two", "b", "c"]);
  });

  it("cancels the paste when the hook rejects", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = mount(() => Promise.reject(new Error("down")));
    m.paste("x");
    await settle();
    expect(m.codes()).toEqual(["a", "b", "c"]);
    expect(m.store.getState().gatesPending.has("resolveTexts")).toBe(false);
  });
});
