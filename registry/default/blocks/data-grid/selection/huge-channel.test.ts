import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactSelection } from "./compact-selection";
import { offsetSelectionForRows } from "./offset-selection-for-rows";
import { remapSelectionRows } from "./remap-selection-rows";
import { getSelectedViewRows } from "./selected-view-rows";
import { selectLine } from "./select-line-options";
import { emptySelection, selectCell } from "./selection-ops";
import type { CompactSelectionLike, GridSelection } from "../types";

const HUGE = 100_000;

function rowsSelection(rows: CompactSelectionLike): GridSelection {
  return { ...emptySelection(), rows };
}

function alternating(count: number): CompactSelection {
  return CompactSelection.fromArray(Array.from({ length: count }, (_, i) => i * 2));
}

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

function randomMembers(random: () => number, size: number): number[] {
  return Array.from({ length: size }, (_, i) => i).filter(() => random() < 0.4);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("offsetSelectionForRows over a huge row channel", () => {
  it("matches the member-by-member shift on random channels", () => {
    const random = seeded(7);
    for (let round = 0; round < 300; round++) {
      const members = randomMembers(random, 30);
      const atIndex = Math.floor(random() * 32);
      const delta = Math.floor(random() * 9) - 4;
      const expected = [...new Set(members.filter((r) => r < atIndex).concat(members.filter((r) => r >= atIndex).map((r) => Math.max(atIndex, r + delta)).filter((r) => r >= 0)))].sort((a, b) => a - b);
      const next = offsetSelectionForRows(rowsSelection(CompactSelection.fromArray(members)), atIndex, delta);
      expect(next.rows.toArray(), `members ${members} at ${atIndex} by ${delta}`).toEqual(expected);
    }
  });

  it("shifts 1,000,000 checked rows in one run without listing them", () => {
    const toArray = vi.spyOn(CompactSelection.prototype, "toArray");
    const checked = CompactSelection.fromSingleSelection([0, 1_000_000]);
    const inserted = offsetSelectionForRows(rowsSelection(checked), 500_000, 3);
    const deleted = offsetSelectionForRows(rowsSelection(checked), 500_000, -3);
    expect(toArray).not.toHaveBeenCalled();
    expect(inserted.rows.runs()).toEqual([[0, 500_000], [500_003, 1_000_003]]);
    expect(deleted.rows.runs()).toEqual([[0, 999_997]]);
  });

  it("shifts 100,000 separate checked rows in time linear in the runs", () => {
    const checked = alternating(HUGE);
    const toArray = vi.spyOn(CompactSelection.prototype, "toArray");
    const start = performance.now();
    const next = offsetSelectionForRows(rowsSelection(checked), 1, -1);
    const elapsed = performance.now() - start;
    expect(toArray).not.toHaveBeenCalled();
    expect(next.rows.length).toBe(HUGE);
    expect(next.rows.runs().slice(0, 2)).toEqual([[0, 2], [3, 4]]);
    expect(elapsed).toBeLessThan(200);
  });
});

describe("remapSelectionRows over a huge row channel", () => {
  it("matches the member-by-member remap on random permutations", () => {
    const random = seeded(11);
    for (let round = 0; round < 200; round++) {
      const size = 24;
      const members = randomMembers(random, size);
      const order = Array.from({ length: size }, (_, i) => i).sort(() => random() - 0.5);
      const newIndexOf = Int32Array.from(order);
      const expected = members.map((r) => newIndexOf[r]!).sort((a, b) => a - b);
      expect(remapSelectionRows(rowsSelection(CompactSelection.fromArray(members)), newIndexOf).rows.toArray()).toEqual(expected);
    }
  });

  it("remaps 100,000 checked rows without listing them", () => {
    const newIndexOf = new Int32Array(HUGE + 1);
    for (let row = 0; row < HUGE; row++) newIndexOf[row] = row + 1;
    newIndexOf[HUGE] = 0;
    const toArray = vi.spyOn(CompactSelection.prototype, "toArray");
    const next = remapSelectionRows(rowsSelection(CompactSelection.fromSingleSelection([0, HUGE])), newIndexOf);
    expect(toArray).not.toHaveBeenCalled();
    expect(next.rows.runs()).toEqual([[1, HUGE + 1]]);
  });
});

describe("getSelectedViewRows over a huge row channel", () => {
  it("unions 100,000 checked rows with the cell range, sorted and deduped", () => {
    const selection = { ...selectCell({ col: 0, row: 3 }), rows: alternating(HUGE) };
    const rows = getSelectedViewRows(selection);
    expect(rows.length).toBe(HUGE + 1);
    expect(rows.slice(0, 4)).toEqual([0, 2, 3, 4]);
    expect(rows[rows.length - 1]).toBe((HUGE - 1) * 2);
  });
});

describe("selectLine with a structural channel", () => {
  it("rebuilds 1,000,000 members from runs without listing them", () => {
    const real = CompactSelection.fromSingleSelection([0, 1_000_000]);
    const like: CompactSelectionLike = { length: real.length, hasIndex: (i) => real.hasIndex(i), equals: () => false, hasAll: () => false, toArray: vi.fn(() => real.toArray()), runs: () => real.runs() };
    const next = selectLine(like, 2_000_000, { additive: true });
    expect(like.toArray).not.toHaveBeenCalled();
    expect(next.runs()).toEqual([[0, 1_000_000], [2_000_000, 2_000_001]]);
  });
});
