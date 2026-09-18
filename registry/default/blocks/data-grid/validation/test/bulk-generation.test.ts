import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { candidateRowIds, isBulkBatchCurrent, snapshotBulkBatch, useBulkGeneration } from "../bulk-generation";
import type { DataGridStoreState } from "../../store";

type Row = { id: string; qty: number };

function state(overrides: Partial<DataGridStoreState> = {}): DataGridStoreState {
  const data: Row[] = [
    { id: "a", qty: 1 },
    { id: "b", qty: 2 },
    { id: "c", qty: 3 },
  ];
  return {
    data,
    viewIndex: [0, 1, 2],
    getRowId: (row: unknown) => (row as Row).id,
    sortState: [],
    filterState: [],
    ...overrides,
  } as unknown as DataGridStoreState;
}

describe("candidateRowIds", () => {
  it("resolves view rows to row ids, deduped", () => {
    const s = state();
    expect(candidateRowIds(s, [{ viewRow: 0 }, { viewRow: 0 }, { viewRow: 2 }])).toEqual(["a", "c"]);
  });

  it("skips a view row outside the current view", () => {
    expect(candidateRowIds(state(), [{ viewRow: 99 }])).toEqual([]);
  });
});

describe("isBulkBatchCurrent", () => {
  it("survives a re-render that changes nothing relevant", () => {
    const s = state();
    const snapshot = snapshotBulkBatch(s, candidateRowIds(s, [{ viewRow: 0 }]));
    expect(isBulkBatchCurrent(state({ sortState: s.sortState, filterState: s.filterState }), snapshot)).toBe(true);
  });

  it("survives a PURE REORDER — targets are row-id keyed, so a moved row is still found", () => {
    const s = state();
    const snapshot = snapshotBulkBatch(s, candidateRowIds(s, [{ viewRow: 0 }, { viewRow: 2 }]));
    const reordered = state({
      sortState: s.sortState,
      filterState: s.filterState,
      data: [
        { id: "c", qty: 3 },
        { id: "a", qty: 1 },
        { id: "b", qty: 2 },
      ],
    });
    expect(isBulkBatchCurrent(reordered, snapshot)).toBe(true);
  });

  it("drops when a target row is gone (data replacement or delete)", () => {
    const s = state();
    const snapshot = snapshotBulkBatch(s, candidateRowIds(s, [{ viewRow: 0 }]));
    const replaced = state({
      sortState: s.sortState,
      filterState: s.filterState,
      data: [{ id: "z", qty: 9 }],
      viewIndex: [0],
    });
    expect(isBulkBatchCurrent(replaced, snapshot)).toBe(false);
  });

  it("drops on a sort change — the view the targets were picked in is gone", () => {
    const s = state();
    const snapshot = snapshotBulkBatch(s, candidateRowIds(s, [{ viewRow: 0 }]));
    expect(isBulkBatchCurrent(state({ filterState: s.filterState, sortState: [{ columnId: "qty", direction: "asc" }] as never }), snapshot)).toBe(false);
  });

  it("drops on a filter change", () => {
    const s = state();
    const snapshot = snapshotBulkBatch(s, candidateRowIds(s, [{ viewRow: 0 }]));
    expect(isBulkBatchCurrent(state({ sortState: s.sortState, filterState: [{ id: "f1", columnId: "qty" }] as never }), snapshot)).toBe(false);
  });

  it("an empty target list is always current — nothing to invalidate", () => {
    const s = state();
    expect(isBulkBatchCurrent(s, snapshotBulkBatch(s, []))).toBe(true);
  });
});

describe("useBulkGeneration", () => {
  it("keeps a stable identity across renders", () => {
    const { result, rerender } = renderHook(() => useBulkGeneration());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("a newer batch supersedes an older one: only the newest token is current", () => {
    const { result } = renderHook(() => useBulkGeneration());
    const s = state();
    const snapshot = snapshotBulkBatch(s, []);
    const older = result.current.begin();
    const newer = result.current.begin();
    expect(result.current.isCurrent(older, s, snapshot)).toBe(false);
    expect(result.current.isCurrent(newer, s, snapshot)).toBe(true);
  });

  it("unmount invalidates an in-flight batch", () => {
    const { result, unmount } = renderHook(() => useBulkGeneration());
    const s = state();
    const snapshot = snapshotBulkBatch(s, []);
    const guard = result.current;
    const token = guard.begin();
    expect(guard.isCurrent(token, s, snapshot)).toBe(true);
    unmount();
    expect(guard.isCurrent(token, s, snapshot)).toBe(false);
  });
});
