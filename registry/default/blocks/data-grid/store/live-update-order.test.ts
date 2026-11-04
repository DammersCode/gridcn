import { describe, expect, it } from "vitest";
import { cellTypes as builtinCellTypes } from "../cell-types/cell-types";
import type { FilterSpec, SortSpec } from "../types";
import { computeViewIndex } from "./compute";
import { createDataGridStore } from "./create-store";
import type { InternalSyncProps } from "./types";

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Row = { id: string; name: string | null; age: number | null; score: number | null };

const columns = [
  { id: "name", header: "Name", accessorKey: "name", type: "text" },
  { id: "age", header: "Age", accessorKey: "age", type: "number" },
  { id: "score", header: "Score", accessorKey: "score", type: "number" },
] as const;

const NAMES = ["Eager Eagle", "quick lion", "Silent Tiger", "Bold Bear", "Swift Wolf", "émile", "Émile", null];

function makeStore(rowCount: number, sorts: SortSpec[], filters: FilterSpec[]) {
  const rand = seededRandom(5);
  const data: Row[] = Array.from({ length: rowCount }, (_, i) => ({
    id: `r${i}`,
    name: NAMES[Math.floor(rand() * NAMES.length)]!,
    age: rand() < 0.05 ? null : 18 + Math.floor(rand() * 50),
    score: rand() < 0.05 ? null : Math.floor(rand() * 40),
  }));
  const store = createDataGridStore({
    data,
    columns,
    getRowId: (row: unknown) => (row as Row).id,
    cellTypes: builtinCellTypes,
  } as unknown as InternalSyncProps);
  store.getState().actions.setSorts(sorts);
  if (filters.length > 0) store.getState().actions.setFilters(filters);
  return { store, rand };
}

function freshView(store: ReturnType<typeof makeStore>["store"], sorts: SortSpec[], filters: FilterSpec[]): number[] {
  const s = store.getState();
  return computeViewIndex(s.data, s.columns, sorts, filters, undefined, s.cellTypes);
}

const SCENARIOS: { name: string; sorts: SortSpec[]; filters: FilterSpec[] }[] = [
  { name: "number asc", sorts: [{ columnId: "score", direction: "asc" }], filters: [] },
  { name: "number desc", sorts: [{ columnId: "score", direction: "desc" }], filters: [] },
  { name: "text asc then number desc", sorts: [{ columnId: "name", direction: "asc" }, { columnId: "score", direction: "desc" }], filters: [] },
  { name: "number asc under a filter", sorts: [{ columnId: "score", direction: "asc" }], filters: [{ columnId: "age", operator: "gte", value: "40" }] },
];

describe("immediate live updates keep the view equal to a full re-sort", () => {
  for (const scenario of SCENARIOS) {
    for (const batchSize of [1, 2, 5, 40]) {
      it(`${scenario.name}, batches of ${batchSize}`, () => {
        const { store, rand } = makeStore(1500, scenario.sorts, scenario.filters);
        for (let tick = 0; tick < 25; tick++) {
          const patches = Array.from({ length: batchSize }, () => {
            const rowId = `r${Math.floor(rand() * 1500)}`;
            const column = rand() < 0.15 ? "age" : rand() < 0.2 ? "name" : "score";
            const value = column === "name" ? NAMES[Math.floor(rand() * NAMES.length)] : rand() < 0.05 ? null : Math.floor(rand() * (column === "age" ? 70 : 40));
            return { rowId, columnId: column, value };
          });
          store.getState().actions.updateCells(patches, { reorder: "immediate" });
          expect(store.getState().viewIndex, `tick ${tick}`).toEqual(freshView(store, scenario.sorts, scenario.filters));
        }
      });
    }
  }

  it("keeps the same viewIndex array when no touched row changes place", () => {
    const { store } = makeStore(800, [{ columnId: "score", direction: "asc" }], []);
    const before = store.getState().viewIndex;
    const row = store.getState().data[before[400]!] as Row;
    store.getState().actions.updateCells([{ rowId: row.id, columnId: "score", value: row.score }], { reorder: "immediate" });
    expect(store.getState().viewIndex).toBe(before);
  });

  it("re-places rows sorted by a derived column when a patch writes the field it reads", () => {
    type Line = { id: string; price: number; qty: number };
    const rand = seededRandom(9);
    const data: Line[] = Array.from({ length: 600 }, (_, i) => ({ id: `l${i}`, price: Math.floor(rand() * 50), qty: 1 + Math.floor(rand() * 9) }));
    const derived = [
      { id: "price", header: "Price", accessorKey: "price", type: "number" },
      { id: "qty", header: "Qty", accessorKey: "qty", type: "number" },
      { id: "total", header: "Total", accessorFn: (row: Line) => row.price * row.qty, type: "number" },
    ];
    const store = createDataGridStore({
      data,
      columns: derived,
      getRowId: (row: unknown) => (row as Line).id,
      cellTypes: builtinCellTypes,
    } as unknown as InternalSyncProps);
    const sorts: SortSpec[] = [{ columnId: "total", direction: "asc" }];
    store.getState().actions.setSorts(sorts);
    for (let tick = 0; tick < 20; tick++) {
      const rowId = `l${Math.floor(rand() * 600)}`;
      store.getState().actions.updateCells([{ rowId, columnId: "price", value: Math.floor(rand() * 500) }], { reorder: "immediate" });
      const s = store.getState();
      expect(s.viewIndex, `tick ${tick}`).toEqual(computeViewIndex(s.data, s.columns, sorts, [], undefined, s.cellTypes));
    }
  });

  it("re-places rows when a patch goes through a setValue that writes a sorted field", () => {
    type Line = { id: string; qty: number; price: number };
    const rand = seededRandom(13);
    const data: Line[] = Array.from({ length: 600 }, (_, i) => ({ id: `l${i}`, qty: 1, price: Math.floor(rand() * 50) }));
    const custom = [
      { id: "qty", header: "Qty", accessorKey: "qty", type: "number", setValue: (row: Line, value: unknown) => ({ ...row, qty: value as number, price: (value as number) * 2 }) },
      { id: "price", header: "Price", accessorKey: "price", type: "number" },
    ];
    const store = createDataGridStore({
      data,
      columns: custom,
      getRowId: (row: unknown) => (row as Line).id,
      cellTypes: builtinCellTypes,
    } as unknown as InternalSyncProps);
    const sorts: SortSpec[] = [{ columnId: "price", direction: "asc" }];
    store.getState().actions.setSorts(sorts);
    for (let tick = 0; tick < 20; tick++) {
      const rowId = `l${Math.floor(rand() * 600)}`;
      store.getState().actions.updateCells([{ rowId, columnId: "qty", value: Math.floor(rand() * 90) }], { reorder: "immediate" });
      const s = store.getState();
      expect(s.viewIndex, `tick ${tick}`).toEqual(computeViewIndex(s.data, s.columns, sorts, [], undefined, s.cellTypes));
    }
  });
});
