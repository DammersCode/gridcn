import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cellTypes as builtinCellTypes } from "../cell-types/cell-types";
import type { FilterSpec, SortSpec } from "../types";
import { computeViewIndex } from "./compute";
import { createDataGridStore } from "./create-store";
import { getInternalActions } from "./internal-actions";
import type { InternalSyncProps } from "./types";

type Row = { id: string; age: number; score: number };

const columns = [
  { id: "age", header: "Age", accessorKey: "age", type: "number" },
  { id: "score", header: "Score", accessorKey: "score", type: "number" },
] as const;
const SORTS: SortSpec[] = [{ columnId: "score", direction: "asc" }];

function makeStore(extra: Record<string, unknown> = {}, filters: FilterSpec[] = []) {
  const data: Row[] = Array.from({ length: 600 }, (_, i) => ({ id: `r${i}`, age: 18 + (i % 50), score: (i * 7) % 90 }));
  const store = createDataGridStore({ data, columns, getRowId: (row: unknown) => (row as Row).id, cellTypes: builtinCellTypes, onDataChange: () => {}, ...extra } as unknown as InternalSyncProps);
  store.getState().actions.setSorts(SORTS);
  if (filters.length > 0) store.getState().actions.setFilters(filters);
  return store;
}

const fullView = (store: ReturnType<typeof makeStore>, filters: FilterSpec[] = []) => {
  const s = store.getState();
  return computeViewIndex(s.data, s.columns, SORTS, filters, undefined, s.cellTypes);
};

let frames: Map<number, () => void>;
let nextId: number;
const runFrames = () => {
  const pending = [...frames.values()];
  frames.clear();
  for (const run of pending) run();
};

beforeEach(() => {
  frames = new Map();
  nextId = 1;
  vi.stubGlobal("requestAnimationFrame", (run: () => void) => {
    frames.set(nextId, run);
    return nextId++;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});
afterEach(() => vi.unstubAllGlobals());

const tick = (store: ReturnType<typeof makeStore>, rowIndex: number, value: number) =>
  store.getState().actions.updateCells([{ rowId: `r${rowIndex}`, columnId: "score", value }], { source: "stream", reorder: "frame" });

describe('reorder: "frame"', () => {
  it("writes values now, keeps the view, and re-places once at the next frame", () => {
    const store = makeStore();
    const before = store.getState().viewIndex;
    let viewChanges = 0;
    store.subscribe((s, prev) => {
      if (s.viewIndex !== prev.viewIndex) viewChanges++;
    });
    for (let i = 0; i < 100; i++) tick(store, i * 5, 200 + i);
    expect((store.getState().data[0] as Row).score).toBe(200);
    expect(store.getState().viewIndex).toBe(before);
    expect(store.getState().viewStale).toBe(false);
    expect(frames.size).toBe(1);
    runFrames();
    expect(viewChanges).toBe(1);
    expect(store.getState().viewIndex).toEqual(fullView(store));
    expect(store.getState().viewStale).toBe(false);
  });

  it("re-places under a filter", () => {
    const filters: FilterSpec[] = [{ columnId: "age", operator: "gte", value: "40" }];
    const store = makeStore({}, filters);
    for (let i = 0; i < 60; i++) tick(store, i * 9, 300 + i);
    runFrames();
    expect(store.getState().viewIndex).toEqual(fullView(store, filters));
  });

  it("reconcileView() re-places now and cancels the frame", () => {
    const store = makeStore();
    tick(store, 3, 500);
    store.getState().actions.reconcileView();
    expect(store.getState().viewIndex).toEqual(fullView(store));
    expect(frames.size).toBe(0);
  });

  it("schedules nothing for a column that feeds no sort or filter", () => {
    const store = makeStore();
    store.getState().actions.updateCells([{ rowId: "r1", columnId: "age", value: 99 }], { source: "stream", reorder: "frame" });
    expect(frames.size).toBe(0);
  });

  it("cancels the pending frame when the store is disposed", () => {
    const store = makeStore();
    tick(store, 3, 500);
    const before = store.getState().viewIndex;
    getInternalActions(store)._disposeWrites();
    runFrames();
    expect(store.getState().viewIndex).toBe(before);
  });

  it("cancels the pending frame when a sort change rebuilds the view", () => {
    const store = makeStore();
    tick(store, 3, 500);
    store.getState().actions.setSorts([{ columnId: "score", direction: "desc" }]);
    expect(frames.size).toBe(0);
  });

  it("writes a stream batch while readOnly", () => {
    const store = makeStore({ readOnly: true });
    tick(store, 3, 500);
    runFrames();
    expect((store.getState().data[3] as Row).score).toBe(500);
    expect(store.getState().viewIndex).toEqual(fullView(store));
  });

  it("falls back to a timer without requestAnimationFrame", () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    vi.useFakeTimers();
    try {
      const store = makeStore();
      tick(store, 3, 500);
      vi.advanceTimersByTime(20);
      expect(store.getState().viewIndex).toEqual(fullView(store));
    } finally {
      vi.useRealTimers();
    }
  });

  it("follows the defer rule for a server-sorted view: no local move, no frame", () => {
    const store = makeStore({ sortMode: "server" });
    const before = store.getState().viewIndex;
    tick(store, 3, 500);
    expect(frames.size).toBe(0);
    expect(store.getState().viewIndex).toBe(before);
  });
});
