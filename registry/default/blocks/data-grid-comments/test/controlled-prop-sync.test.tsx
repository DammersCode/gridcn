import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDataGridComments } from "../use-data-grid-comments";
import type { CellComment } from "../types";

const syncProp = vi.hoisted(() => vi.fn());

vi.mock("../comment-engine", async (importActual) => {
  const actual = await importActual<typeof import("../comment-engine")>();
  return {
    ...actual,
    createCommentEngine: (config: Parameters<typeof actual.createCommentEngine>[0]) => {
      const engine = actual.createCommentEngine(config);
      const original = engine.syncProp;
      engine.syncProp = (next) => {
        syncProp(next);
        original(next);
      };
      return engine;
    },
  };
});

const record = (overrides: Partial<CellComment> = {}): CellComment => ({
  id: "c1",
  rowId: "r1",
  columnId: "name",
  text: "hello",
  createdAt: 1000,
  updatedAt: 1000,
  version: 1,
  resolved: false,
  ...overrides,
});

function mountWithSyncSpy(initial: readonly CellComment[]) {
  syncProp.mockClear();
  const view = renderHook(({ comments }) => useDataGridComments({ comments }), { initialProps: { comments: initial } });
  return { view, syncProp };
}

describe("controlled comments prop sync", () => {
  it("skips the sync for a new array with equal records", () => {
    const { view, syncProp } = mountWithSyncSpy([record()]);
    view.rerender({ comments: [record()] });
    view.rerender({ comments: [record()] });
    expect(syncProp).not.toHaveBeenCalled();
  });

  it.each<[string, readonly CellComment[]]>([
    ["a changed version", [record({ version: 2 })]],
    ["a changed text at the same version", [record({ text: "edited" })]],
    ["an added record", [record(), record({ id: "c2" })]],
    ["a removed record", []],
  ])("syncs once for %s", (_name, next) => {
    const { view, syncProp } = mountWithSyncSpy([record()]);
    view.rerender({ comments: next });
    view.rerender({ comments: [...next] });
    expect(syncProp).toHaveBeenCalledTimes(1);
  });
});
