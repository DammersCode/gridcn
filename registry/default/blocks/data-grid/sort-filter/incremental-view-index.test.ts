import { describe, expect, it } from "vitest";
import type { FilterJoinOperator, FilterSpec, SortSpec } from "../types";
import { buildViewIndex, type CellAccessor } from "./build-view-index";
import { INCREMENTAL_PATCH_LIMIT, lowerBound, makeViewComparator, updateViewIndex } from "./incremental-view-index";

/**
 * The acceptance bar for workplan #78: the incremental path must produce an ELEMENT-IDENTICAL
 * viewIndex to a from-scratch `buildViewIndex`, not merely an order-equivalent one. Every case here
 * — targeted and randomized — asserts against a fresh rebuild of the same state.
 */

type Row = { name: string; city: string; score: number; note: string };

function accessorFor(rows: readonly Row[]): CellAccessor {
  return {
    getText(rowIndex, columnId) {
      const row = rows[rowIndex];
      if (!row) return "";
      const value = row[columnId as keyof Row];
      return value === undefined || value === null ? "" : String(value);
    },
  };
}

/**
 * The wired shape (#85): every column carries a cell-type comparator over raw values, so the fuzz
 * suite proves equivalence for the comparator source that now actually runs in production, not only
 * for the text path. `score` is genuinely numeric — the case the collator got wrong.
 */
function typedAccessorFor(rows: readonly Row[]): CellAccessor {
  const text = accessorFor(rows);
  const valueAt = (rowIndex: number, columnId: string) => rows[rowIndex]?.[columnId as keyof Row];
  return {
    ...text,
    compare: (columnId) => (a, b) => {
      const valueA = valueAt(a, columnId);
      const valueB = valueAt(b, columnId);
      if (typeof valueA === "number" && typeof valueB === "number") return valueA - valueB;
      return String(valueA ?? "").localeCompare(String(valueB ?? ""));
    },
    isEmpty: (rowIndex, columnId) => {
      const value = valueAt(rowIndex, columnId);
      return value == null || value === "";
    },
  };
}

type State = { sorts: SortSpec[]; filters: FilterSpec[]; joinOperator?: FilterJoinOperator };

/** The two comparator sources the sort path can resolve; both must reach the identical view index. */
const ACCESSOR_KINDS = [
  ["default text compare", accessorFor],
  ["resolved cell-type compare", typedAccessorFor],
] as const;

function rebuild(rows: readonly Row[], state: State): number[] {
  return buildViewIndex(rows.length, accessorFor(rows), {
    sorts: state.sorts,
    filters: state.filters,
    joinOperator: state.joinOperator,
  });
}

/** Applies `patch` to a copy of `rows` and returns both the new rows and the incremental view. */
function step(rows: Row[], view: readonly number[], state: State, touched: number[], apply: (rows: Row[]) => void) {
  const next = rows.map((r) => ({ ...r }));
  apply(next);
  const result = updateViewIndex(view, touched, accessorFor(next), {
    sorts: state.sorts,
    filters: state.filters,
    joinOperator: state.joinOperator,
  });
  return { next, result };
}

describe("updateViewIndex — targeted cases from the design spec", () => {
  const base: Row[] = [
    { name: "Charlie", city: "Berlin", score: 30, note: "x" },
    { name: "alice", city: "Oslo", score: 25, note: "y" },
    { name: "Bob", city: "Berlin", score: 40, note: "z" },
    { name: "bob", city: "Lima", score: 25, note: "w" },
    { name: "", city: "Oslo", score: 10, note: "v" },
  ];

  it("places a moved row exactly where the rebuild does", () => {
    const state: State = { sorts: [{ columnId: "name", direction: "asc" }], filters: [] };
    const view = rebuild(base, state);
    const { next, result } = step(base, view, state, [0], (rows) => {
      rows[0]!.name = "aaron";
    });
    expect(result.viewIndex).toEqual(rebuild(next, state));
  });

  it("breaks ties on data index, matching the rebuild's position tiebreak", () => {
    // score 25 already appears twice; patching a third row into it forces the tiebreak.
    const state: State = { sorts: [{ columnId: "score", direction: "asc" }], filters: [] };
    const view = rebuild(base, state);
    const { next, result } = step(base, view, state, [2], (rows) => {
      rows[2]!.score = 25;
    });
    expect(result.viewIndex).toEqual(rebuild(next, state));
    expect(result.viewIndex).toEqual([4, 1, 2, 3, 0]);
  });

  it("adds a row to the view when a patch makes it pass the filter", () => {
    const state: State = { sorts: [{ columnId: "name", direction: "asc" }], filters: [{ columnId: "city", operator: "equals", value: "Berlin" }] };
    const view = rebuild(base, state);
    expect(view).toEqual([2, 0]);
    const { next, result } = step(base, view, state, [1], (rows) => {
      rows[1]!.city = "Berlin";
    });
    expect(result.viewIndex).toEqual(rebuild(next, state));
    expect(result.viewIndex).toContain(1);
  });

  it("drops a row from the view when a patch makes it fail the filter", () => {
    const state: State = { sorts: [{ columnId: "name", direction: "asc" }], filters: [{ columnId: "city", operator: "equals", value: "Berlin" }] };
    const view = rebuild(base, state);
    const { next, result } = step(base, view, state, [2], (rows) => {
      rows[2]!.city = "Paris";
    });
    expect(result.viewIndex).toEqual(rebuild(next, state));
    expect(result.viewIndex).not.toContain(2);
  });

  it("moves a row to the first position", () => {
    const state: State = { sorts: [{ columnId: "score", direction: "asc" }], filters: [] };
    const view = rebuild(base, state);
    const { next, result } = step(base, view, state, [0], (rows) => {
      rows[0]!.score = -100;
    });
    expect(result.viewIndex).toEqual(rebuild(next, state));
    expect(result.viewIndex![0]).toBe(0);
  });

  it("moves a row to the last position", () => {
    const state: State = { sorts: [{ columnId: "score", direction: "asc" }], filters: [] };
    const view = rebuild(base, state);
    const { next, result } = step(base, view, state, [0], (rows) => {
      rows[0]!.score = 9999;
    });
    expect(result.viewIndex).toEqual(rebuild(next, state));
    expect(result.viewIndex!.at(-1)).toBe(0);
  });

  it("leaves the order untouched for a patch on a non-sort column", () => {
    const state: State = { sorts: [{ columnId: "name", direction: "asc" }], filters: [] };
    const view = rebuild(base, state);
    const { next, result } = step(base, view, state, [3], (rows) => {
      rows[3]!.note = "changed";
    });
    expect(result.viewIndex).toEqual(rebuild(next, state));
    expect(result.viewIndex).toEqual([...view]);
  });

  it("keeps empty values sorting last in both directions", () => {
    for (const direction of ["asc", "desc"] as const) {
      const state: State = { sorts: [{ columnId: "name", direction }], filters: [] };
      const view = rebuild(base, state);
      const { next, result } = step(base, view, state, [2], (rows) => {
        rows[2]!.name = "";
      });
      expect(result.viewIndex).toEqual(rebuild(next, state));
    }
  });

  it("matches the rebuild under a multi-column sort", () => {
    const state: State = {
      sorts: [
        { columnId: "city", direction: "asc" },
        { columnId: "score", direction: "desc" },
      ],
      filters: [],
    };
    const view = rebuild(base, state);
    const { next, result } = step(base, view, state, [3], (rows) => {
      rows[3]!.city = "Berlin";
    });
    expect(result.viewIndex).toEqual(rebuild(next, state));
  });

  it("matches the rebuild with an OR join across two filters", () => {
    const state: State = {
      sorts: [{ columnId: "score", direction: "asc" }],
      filters: [
        { columnId: "city", operator: "equals", value: "Berlin" },
        { columnId: "score", operator: "gte", value: "30" },
      ],
      joinOperator: "or",
    };
    const view = rebuild(base, state);
    const { next, result } = step(base, view, state, [1], (rows) => {
      rows[1]!.score = 55;
    });
    expect(result.viewIndex).toEqual(rebuild(next, state));
  });

  it("matches the rebuild with no sort at all (filter-only view)", () => {
    const state: State = { sorts: [], filters: [{ columnId: "city", operator: "equals", value: "Oslo" }] };
    const view = rebuild(base, state);
    const { next, result } = step(base, view, state, [0], (rows) => {
      rows[0]!.city = "Oslo";
    });
    expect(result.viewIndex).toEqual(rebuild(next, state));
    expect(result.viewIndex).toEqual([0, 1, 4]);
  });
});

describe("updateViewIndex — fallback valves", () => {
  const rows: Row[] = [{ name: "a", city: "x", score: 1, note: "" }];
  const state: State = { sorts: [{ columnId: "name", direction: "asc" }], filters: [] };

  it("bails above the patch limit", () => {
    const touched = Array.from({ length: INCREMENTAL_PATCH_LIMIT + 1 }, (_, i) => i);
    const result = updateViewIndex([0], touched, accessorFor(rows), { sorts: state.sorts, filters: [] });
    expect(result).toEqual({ viewIndex: null, bail: "too-many-rows" });
  });

  it("runs (no longer bails) when a sorted column has a resolved comparator", () => {
    const accessor: CellAccessor = { ...accessorFor(rows), compare: (columnId) => (columnId === "name" ? (a, b) => a - b : undefined) };
    const result = updateViewIndex([0], [0], accessor, { sorts: state.sorts, filters: [] });
    expect(result).toEqual({ viewIndex: [0], bail: null });
  });

  it("runs when the custom comparator is on an unsorted column", () => {
    const accessor: CellAccessor = { ...accessorFor(rows), compare: (columnId) => (columnId === "city" ? (a, b) => a - b : undefined) };
    expect(updateViewIndex([0], [0], accessor, { sorts: state.sorts, filters: [] }).bail).toBeNull();
  });

  it("bails when buildViewIndex would also narrow by search", () => {
    const result = updateViewIndex([0], [0], accessorFor(rows), {
      sorts: state.sorts,
      filters: [],
      search: "a",
      searchColumnIds: ["name"],
    });
    expect(result).toEqual({ viewIndex: null, bail: "search-active" });
  });
});

describe("lowerBound", () => {
  const numeric = (a: number, b: number) => a - b;

  it("finds the insertion point in an empty array", () => {
    expect(lowerBound([], 5, numeric)).toBe(0);
  });

  it("finds the insertion point at both ends and in the middle", () => {
    const view = [1, 3, 5, 7];
    expect(lowerBound(view, 0, numeric)).toBe(0);
    expect(lowerBound(view, 4, numeric)).toBe(2);
    expect(lowerBound(view, 9, numeric)).toBe(4);
  });
});

// --- The equivalence fuzz suite -----------------------------------------------------------------
// The user's one hard condition ("do not break the sorting") in executable form: hundreds of
// randomized patch sequences over every sort/filter shape, each asserting element-identical
// equality against a from-scratch rebuild after EVERY step.

/** xorshift32 — a seeded PRNG, so a failure reproduces exactly from the printed seed. */
function makeRandom(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 1_000_000) / 1_000_000;
  };
}

const CITIES = ["Berlin", "Oslo", "Lima", "Ålesund", "", "berlin", "Zürich"];
// Deliberately tiny value spaces: duplicates and ties are the interesting case, not uniqueness.
const NAMES = ["alice", "Alice", "bob", "", "Zoe", "ätna", "item 2", "item 10"];

function randomRows(random: () => number, count: number): Row[] {
  return Array.from({ length: count }, () => ({
    name: NAMES[Math.floor(random() * NAMES.length)]!,
    city: CITIES[Math.floor(random() * CITIES.length)]!,
    score: Math.floor(random() * 6),
    note: String(Math.floor(random() * 3)),
  }));
}

function randomState(random: () => number): State {
  const columns = ["name", "city", "score", "note"];
  const sortCount = Math.floor(random() * 3); // 0, 1, or 2 sort columns
  const sorts: SortSpec[] = [];
  const used = new Set<string>();
  for (let i = 0; i < sortCount; i++) {
    const columnId = columns[Math.floor(random() * columns.length)]!;
    if (used.has(columnId)) continue;
    used.add(columnId);
    sorts.push({ columnId, direction: random() < 0.5 ? "asc" : "desc" });
  }
  const filters: FilterSpec[] = [];
  if (random() < 0.6) {
    filters.push(
      random() < 0.5
        ? { columnId: "city", operator: "contains", value: CITIES[Math.floor(random() * CITIES.length)]! }
        : { columnId: "score", operator: "gte", value: String(Math.floor(random() * 5)) },
    );
  }
  if (random() < 0.3) filters.push({ columnId: "name", operator: "notEmpty", value: "" });
  return { sorts, filters, joinOperator: filters.length > 1 && random() < 0.5 ? "or" : "and" };
}

describe.each(ACCESSOR_KINDS)("updateViewIndex — equivalence fuzz (%s)", (_label, makeAccessor) => {
  /** The rebuild reference must read through the SAME comparator source the incremental call uses. */
  const rebuildWith = (rows: readonly Row[], state: State): number[] =>
    buildViewIndex(rows.length, makeAccessor(rows), {
      sorts: state.sorts,
      filters: state.filters,
      joinOperator: state.joinOperator,
    });

  it("stays element-identical to the full rebuild across 400 randomized patch sequences", () => {
    const ITERATIONS = 400;
    const STEPS = 6;
    let steps = 0;
    for (let iteration = 0; iteration < ITERATIONS; iteration++) {
      const seed = iteration * 2654435761 + 12345;
      const random = makeRandom(seed >>> 0);
      const state = randomState(random);
      let rows = randomRows(random, 4 + Math.floor(random() * 20));
      let view: readonly number[] = rebuildWith(rows, state);

      for (let s = 0; s < STEPS; s++) {
        const touchedCount = 1 + Math.floor(random() * 4);
        const touched: number[] = [];
        const nextRows = rows.map((r) => ({ ...r }));
        for (let t = 0; t < touchedCount; t++) {
          const rowIndex = Math.floor(random() * nextRows.length);
          touched.push(rowIndex);
          const column = ["name", "city", "score", "note"][Math.floor(random() * 4)]!;
          const row = nextRows[rowIndex]!;
          if (column === "score") row.score = Math.floor(random() * 6);
          else if (column === "name") row.name = NAMES[Math.floor(random() * NAMES.length)]!;
          else if (column === "city") row.city = CITIES[Math.floor(random() * CITIES.length)]!;
          else row.note = String(Math.floor(random() * 3));
        }

        const result = updateViewIndex(view, touched, makeAccessor(nextRows), {
          sorts: state.sorts,
          filters: state.filters,
          joinOperator: state.joinOperator,
        });
        expect(result.bail, `seed ${seed} step ${s}`).toBeNull();
        const reference = rebuildWith(nextRows, state);
        // toEqual on number arrays IS the element-identical assertion the spec requires.
        expect(result.viewIndex, `seed ${seed} step ${s} state ${JSON.stringify(state)}`).toEqual(reference);
        rows = nextRows;
        view = result.viewIndex!;
        steps++;
      }
    }
    expect(steps).toBe(ITERATIONS * STEPS);
  });

  // The splice path and the merge path have different reinsertion mechanics, so k is swept across
  // their crossover rather than left to chance.
  it.each([1, 2, 4, 7, 8, 9, 12, 30, 64])(
    "stays element-identical when exactly %i rows change per step",
    (touchedCount) => {
      for (let iteration = 0; iteration < 40; iteration++) {
        const seed = (iteration * 40503 + touchedCount * 7919 + 7) >>> 0;
        const random = makeRandom(seed);
        const state = randomState(random);
        let rows = randomRows(random, 70);
        let view: readonly number[] = rebuildWith(rows, state);
        for (let s = 0; s < 4; s++) {
          const nextRows = rows.map((r) => ({ ...r }));
          const touched: number[] = [];
          while (touched.length < touchedCount) {
            const i = Math.floor(random() * nextRows.length);
            touched.push(i);
            nextRows[i]!.score = Math.floor(random() * 6);
            nextRows[i]!.city = CITIES[Math.floor(random() * CITIES.length)]!;
            nextRows[i]!.name = NAMES[Math.floor(random() * NAMES.length)]!;
          }
          const result = updateViewIndex(view, touched, makeAccessor(nextRows), {
            sorts: state.sorts,
            filters: state.filters,
            joinOperator: state.joinOperator,
          });
          expect(result.viewIndex, `k=${touchedCount} seed ${seed} step ${s}`).toEqual(rebuildWith(nextRows, state));
          rows = nextRows;
          view = result.viewIndex!;
        }
      }
    },
  );
});

describe("makeViewComparator", () => {
  it("degenerates to the data-index tiebreak with no sort columns", () => {
    const compare = makeViewComparator(accessorFor([]), []);
    expect(compare(3, 7)).toBeLessThan(0);
    expect(compare(7, 3)).toBeGreaterThan(0);
  });

  it("never returns 0 for two different rows, so the insertion point is unique", () => {
    const rows: Row[] = [
      { name: "same", city: "same", score: 1, note: "" },
      { name: "same", city: "same", score: 1, note: "" },
    ];
    const compare = makeViewComparator(accessorFor(rows), [{ columnId: "name", direction: "asc" }]);
    expect(compare(0, 1)).not.toBe(0);
  });

  it("keeps the data-index tiebreak total under a resolved cell-type comparator", () => {
    const rows: Row[] = [
      { name: "same", city: "same", score: 1, note: "" },
      { name: "same", city: "same", score: 1, note: "" },
    ];
    const compare = makeViewComparator(typedAccessorFor(rows), [{ columnId: "score", direction: "asc" }]);
    expect(compare(0, 1)).toBeLessThan(0);
    expect(compare(1, 0)).toBeGreaterThan(0);
  });

  it("keeps empty cells last in BOTH directions under a resolved comparator", () => {
    const rows: Row[] = [
      { name: "b", city: "x", score: 1, note: "" },
      { name: "", city: "x", score: 2, note: "" },
      { name: "a", city: "x", score: 3, note: "" },
    ];
    for (const direction of ["asc", "desc"] as const) {
      const compare = makeViewComparator(typedAccessorFor(rows), [{ columnId: "name", direction }]);
      expect([0, 1, 2].slice().sort(compare).at(-1), direction).toBe(1);
    }
  });
});
