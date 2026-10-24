import { describe, expect, it } from "vitest";
import type { SortSpec } from "../types";
import { buildViewIndex, isEmptyCell, type CellAccessor } from "./build-view-index";
import { defaultCompareText } from "./default-compare-text";

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

function referenceSort(rowCount: number, accessor: CellAccessor, sorts: SortSpec[]): number[] {
  const indices: number[] = [];
  for (let i = 0; i < rowCount; i++) indices.push(i);
  if (sorts.length === 0) return indices;
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const comparators = sorts.map((sort) => {
    const custom = accessor.compare?.(sort.columnId);
    const dir = sort.direction === "asc" ? 1 : -1;
    if (custom) {
      const empties = new Map<number, boolean>();
      for (const row of indices) empties.set(row, isEmptyCell(accessor, row, sort.columnId));
      return (a: number, b: number) => {
        const emptyA = empties.get(a)!;
        const emptyB = empties.get(b)!;
        if (emptyA && emptyB) return 0;
        if (emptyA) return 1;
        if (emptyB) return -1;
        return dir * custom(a, b);
      };
    }
    const keys = new Map<number, string>();
    for (const row of indices) keys.set(row, accessor.getText(row, sort.columnId));
    return (a: number, b: number) => {
      const textA = keys.get(a)!;
      const textB = keys.get(b)!;
      if (textA === "" || textB === "") return defaultCompareText(textA, textB, collator);
      return dir * defaultCompareText(textA, textB, collator);
    };
  });
  const decorated = indices.map((row, position) => ({ row, position }));
  decorated.sort((a, b) => {
    for (const cmp of comparators) {
      const result = cmp(a.row, b.row);
      if (result !== 0) return result;
    }
    return a.position - b.position;
  });
  return decorated.map((d) => d.row);
}

const WORDS = ["alpha", "Alpha", "beta", "Zoë", "zoe", "Émile", "emile", "ångström", "straße", "strasse", "日本", "中文", "😀", "a-b", "a b"];
const ROW_COUNT = 2000;

function buildTable(random: () => number) {
  const pick = <T,>(items: T[]): T => items[Math.floor(random() * items.length)]!;
  return Array.from({ length: ROW_COUNT }, () => ({
    text: random() < 0.15 ? "" : `${pick(WORDS)}${random() < 0.5 ? "" : ` ${Math.floor(random() * 30)}`}`,
    numeric: random() < 0.1 ? "" : String(Math.floor(random() * 40) * (random() < 0.3 ? 10 : 1)),
    dup: pick(["x", "y", "", "X", "y2", "y10"]),
    typed: random() < 0.2 ? "" : String(Math.floor(random() * 15)),
  }));
}

describe("buildViewIndex sort equivalence", () => {
  const columnIds = ["text", "numeric", "dup", "typed"];
  for (const seed of [1, 7, 42, 2024]) {
    it(`matches the reference order, stability included (seed ${seed})`, () => {
      const random = seededRandom(seed);
      const table = buildTable(random);
      const accessor: CellAccessor = {
        getText: (row, columnId) => table[row]![columnId as "text"],
        compare: (columnId) =>
          columnId === "typed" ? (a, b) => Number(table[a]!.typed) - Number(table[b]!.typed) : undefined,
        isEmpty: (row, columnId) => table[row]![columnId as "text"] === "",
      };
      for (let round = 0; round < 12; round++) {
        const count = 1 + Math.floor(random() * 3);
        const sorts: SortSpec[] = Array.from({ length: count }, () => ({
          columnId: columnIds[Math.floor(random() * columnIds.length)]!,
          direction: random() < 0.5 ? "asc" : "desc",
        }));
        expect(buildViewIndex(ROW_COUNT, accessor, { sorts, filters: [] })).toEqual(
          referenceSort(ROW_COUNT, accessor, sorts),
        );
      }
    });
  }

  it("matches the reference when a filter narrows the rows first", () => {
    const random = seededRandom(5);
    const table = buildTable(random);
    const accessor: CellAccessor = { getText: (row, columnId) => table[row]![columnId as "text"] };
    const sorts: SortSpec[] = [{ columnId: "text", direction: "desc" }];
    const result = buildViewIndex(ROW_COUNT, accessor, {
      sorts,
      filters: [{ columnId: "dup", operator: "equals", value: "y" } as never],
    });
    const kept = new Set(result);
    const reference = referenceSort(ROW_COUNT, accessor, sorts).filter((row) => kept.has(row));
    expect(result).toEqual(reference);
  });
});
