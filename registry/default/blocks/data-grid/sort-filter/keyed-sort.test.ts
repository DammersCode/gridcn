import { describe, expect, it } from "vitest";
import { cellTypes as builtinCellTypes } from "../cell-types/cell-types";
import { computeViewIndex, textAccessorFor } from "../store/compute";
import type { AnyColumnDef } from "../store/types";
import type { CellType, FilterSpec, SortSpec } from "../types";
import { isEmptyCell, makeFilterNodeTest, type CellAccessor } from "./build-view-index";
import { buildViewIndex } from "./build-view-index";
import { KEYED_SORT_MIN_ROWS, sortByKeys } from "./keyed-sort";
import { withSortLocale } from "./sort-collator";

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

/** The comparator-chain sort the keyed fast path replaces, copied from the original `buildViewIndex`. */
function referenceViewIndex(rowCount: number, accessor: CellAccessor, sorts: SortSpec[], filters: FilterSpec[] = []): number[] {
  let indices: number[] = [];
  for (let i = 0; i < rowCount; i++) indices.push(i);
  for (const node of filters) {
    const test = makeFilterNodeTest(accessor, node);
    indices = indices.filter((row) => test(row));
  }
  if (sorts.length === 0) return indices;
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const comparators = sorts.map((sort) => {
    const custom = accessor.compare?.(sort.columnId);
    const dir = sort.direction === "asc" ? 1 : -1;
    if (custom) {
      const empties = new Uint8Array(rowCount);
      for (const row of indices) empties[row] = isEmptyCell(accessor, row, sort.columnId) ? 1 : 0;
      return (a: number, b: number) => {
        if (empties[a] === 1 && empties[b] === 1) return 0;
        if (empties[a] === 1) return 1;
        if (empties[b] === 1) return -1;
        return dir * custom(a, b);
      };
    }
    const keys = new Array<string>(rowCount);
    for (const row of indices) keys[row] = accessor.getText(row, sort.columnId);
    return (a: number, b: number) => {
      const textA = keys[a]!;
      const textB = keys[b]!;
      if (textA === "") return textB === "" ? 0 : 1;
      if (textB === "") return -1;
      return dir * collator.compare(textA, textB);
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

type Row = Record<string, unknown>;

const FIRST = ["Anna", "ben", "CARLA", "dave", "Émile", "émile", "Zoë", "zoe", "Ångström", "naïve", "Oscar", "oscar", "Maria", "maría", "Jörg", "jorg", "Ünal", "ünal"];
const LAST = ["Smith", "smith", "Müller", "muller", "O'Brien", "Núñez", "nunez", "Lee", "Černý", "cerny", "de la Cruz", "Van Dyk", "Åberg", "Zhang"];
const DIGIT_STRINGS = ["item-1", "item-10", "item-9", "item-009", "v1.2.3", "v1.10.0", "v1.9.9", "007", "7", "a01", "a1", "a1b", "a01b", "-5", "5", "x", "X", "", "10", "2", "1.5", "1.25"];
const DATES = ["2020-01-05", "2019-12-31", "2020-01-05", null, "2021-07-04", "", "2020-01-05T10:00", "0026-01-01"];
const PICKS = ["open", "done", "blocked", "wip", "other", "unknown", "OPEN", "", null];
const CHOICES = [
  { value: "open", label: "Open" },
  { value: "wip", label: "In progress" },
  { value: "done", label: "Done" },
  { value: "blocked", label: "done" },
  { value: "other", label: "Émile" },
];

function makeRows(count: number, seed: number): Row[] {
  const rand = seededRandom(seed);
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
  const rows: Row[] = [];
  for (let i = 0; i < count; i++) {
    const r = rand();
    const name = r < 0.04 ? null : r < 0.07 ? "" : rand() < 0.4 ? `${pick(FIRST)} ${pick(LAST)} ${Math.floor(rand() * 40)}` : `${pick(FIRST)} ${pick(LAST)}`;
    const n = rand();
    rows.push({
      id: `row-${i}`,
      name,
      free: name,
      digits: rand() < 0.05 ? null : pick(DIGIT_STRINGS),
      int: n < 0.05 ? null : Math.floor(rand() * 60) - 20,
      float: n < 0.05 ? null : n < 0.1 ? (rand() < 0.5 ? 0 : -0) : (rand() - 0.5) * 2e6,
      wide: n < 0.05 ? null : (rand() < 0.5 ? -1 : 1) * Math.floor(rand() * 4) * 1e300 * (rand() < 0.5 ? 1 : 1e-300),
      dirty: n < 0.04 ? Number.NaN : n < 0.07 ? Number.POSITIVE_INFINITY : n < 0.1 ? "12" : n < 0.15 ? null : Math.floor(rand() * 30),
      mixed: n < 0.1 ? 42 : n < 0.2 ? null : pick(FIRST),
      custom: Math.floor(rand() * 8),
      when: pick(DATES),
      whenDirty: n < 0.1 ? 20200105 : pick(DATES),
      pick: pick(PICKS),
      pickDirty: n < 0.1 ? 7 : pick(PICKS),
      flag: n < 0.1 ? null : rand() < 0.5,
      flagDirty: n < 0.1 ? "yes" : n < 0.2 ? 2 : n < 0.3 ? null : rand() < 0.5,
    });
  }
  return rows;
}

const columns: AnyColumnDef[] = [
  { id: "name", header: "Name", accessorKey: "name", type: "text" },
  { id: "free", header: "Free", accessorKey: "free" },
  { id: "digits", header: "Digits", accessorKey: "digits", type: "text" },
  { id: "int", header: "Int", accessorKey: "int", type: "number" },
  { id: "float", header: "Float", accessorKey: "float", type: "number" },
  { id: "wide", header: "Wide", accessorKey: "wide", type: "number" },
  { id: "dirty", header: "Dirty", accessorKey: "dirty", type: "number" },
  { id: "mixed", header: "Mixed", accessorKey: "mixed", type: "text" },
  { id: "custom", header: "Custom", accessorKey: "custom", sortCompare: (a: unknown, b: unknown) => (((b as Row)["custom"] as number) % 3) - (((a as Row)["custom"] as number) % 3) },
  { id: "when", header: "When", accessorKey: "when", type: "date" },
  { id: "whenDirty", header: "When dirty", accessorKey: "whenDirty", type: "date" },
  { id: "pick", header: "Pick", accessorKey: "pick", type: "select", options: { choices: CHOICES } },
  { id: "pickPlain", header: "Pick plain", accessorKey: "pick", type: "select" },
  { id: "pickDirty", header: "Pick dirty", accessorKey: "pickDirty", type: "select", options: { choices: CHOICES } },
  { id: "flag", header: "Flag", accessorKey: "flag", type: "checkbox" },
  { id: "flagDirty", header: "Flag dirty", accessorKey: "flagDirty", type: "checkbox" },
] as AnyColumnDef[];

const COLUMN_IDS = columns.map((c) => c.id);
const SIZES = [KEYED_SORT_MIN_ROWS - 1, KEYED_SORT_MIN_ROWS, 1500];

function actual(rows: Row[], sorts: SortSpec[], filters: FilterSpec[] = [], types: Record<string, CellType> = builtinCellTypes as unknown as Record<string, CellType>): number[] {
  return computeViewIndex(rows, columns, sorts, filters, undefined, types);
}

function expected(rows: Row[], sorts: SortSpec[], filters: FilterSpec[] = [], types: Record<string, CellType> = builtinCellTypes as unknown as Record<string, CellType>): number[] {
  return referenceViewIndex(rows.length, textAccessorFor(columns, rows, types), sorts, filters);
}

const spec = (columnId: string, direction: "asc" | "desc"): SortSpec => ({ columnId, direction });

describe("keyed sort coverage", () => {
  const rows = makeRows(1000, 5);
  const accessor = textAccessorFor(columns, rows, builtinCellTypes as unknown as Record<string, CellType>);
  const indices = Array.from({ length: rows.length }, (_, i) => i);
  const keyed = (columnId: string) => sortByKeys(indices, accessor, [spec(columnId, "asc")]) !== null;

  it("keys the built-in number and text columns and the untyped text column", () => {
    for (const columnId of ["name", "free", "digits", "int", "float"]) expect(keyed(columnId), columnId).toBe(true);
  });

  it("keys the built-in date, select, and checkbox columns", () => {
    for (const columnId of ["when", "pick", "pickPlain", "flag"]) expect(keyed(columnId), columnId).toBe(true);
  });

  it("declines a date, select, or checkbox column that holds a value it cannot rank", () => {
    for (const columnId of ["whenDirty", "pickDirty", "flagDirty"]) expect(keyed(columnId), columnId).toBe(false);
  });

  it("declines a column the plain comparator treats as unordered or custom", () => {
    for (const columnId of ["wide", "dirty", "mixed", "custom"]) expect(keyed(columnId), columnId).toBe(false);
  });

  it("declines when any sort key is declined", () => {
    expect(sortByKeys(indices, accessor, [spec("int", "asc"), spec("custom", "asc")])).toBeNull();
  });
});

describe("keyed sort matches the comparator-chain sort", () => {
  for (const size of SIZES) {
    const rows = makeRows(size, 7 + size);
    for (const columnId of COLUMN_IDS) {
      for (const direction of ["asc", "desc"] as const) {
        it(`${size} rows, ${columnId} ${direction}`, () => {
          const sorts = [spec(columnId, direction)];
          expect(actual(rows, sorts)).toEqual(expected(rows, sorts));
        });
      }
    }
  }

  it("matches for already-sorted and reversed input", () => {
    const rows = makeRows(1200, 11);
    for (const columnId of ["name", "free", "int", "float", "digits"]) {
      const sortedOrder = expected(rows, [spec(columnId, "asc")]);
      for (const ordered of [sortedOrder.map((i) => rows[i]!), sortedOrder.map((i) => rows[i]!).reverse()]) {
        for (const direction of ["asc", "desc"] as const) {
          expect(actual(ordered, [spec(columnId, direction)])).toEqual(expected(ordered, [spec(columnId, direction)]));
        }
      }
    }
  });

  it("matches for already-sorted and reversed date, select, and checkbox input", () => {
    const rows = makeRows(1200, 12);
    for (const columnId of ["when", "pick", "pickPlain", "flag"]) {
      const sortedOrder = expected(rows, [spec(columnId, "asc")]);
      for (const ordered of [sortedOrder.map((i) => rows[i]!), sortedOrder.map((i) => rows[i]!).reverse()]) {
        for (const direction of ["asc", "desc"] as const) {
          expect(actual(ordered, [spec(columnId, direction)]), `${columnId} ${direction}`).toEqual(expected(ordered, [spec(columnId, direction)]));
        }
      }
    }
  });

  it("matches under a changed sort locale for a select column", () => {
    const rows = makeRows(1200, 13).map((row, i) => ({ ...row, pick: i % 3 === 0 ? "other" : row["pick"] }));
    const sorts = [spec("pickPlain", "asc")];
    const sv = <T,>(run: () => T) => withSortLocale("sv", run);
    expect(sv(() => actual(rows, sorts))).toEqual(sv(() => expected(rows, sorts)));
  });

  it("matches when a consumer replaces the date, select, or checkbox compare", () => {
    const rows = makeRows(1200, 14);
    for (const [type, columnId] of [["date", "when"], ["select", "pick"], ["checkbox", "flag"]] as const) {
      const own = { ...builtinCellTypes[type], compare: (a: unknown, b: unknown) => String(b).length - String(a).length } as unknown as CellType;
      const types = { ...(builtinCellTypes as unknown as Record<string, CellType>), [type]: own };
      const sorts = [spec(columnId, "asc")];
      expect(actual(rows, sorts, [], types), type).toEqual(expected(rows, sorts, [], types));
    }
  });

  it("matches for every pair of sort keys", () => {
    const rows = makeRows(900, 21);
    for (const first of COLUMN_IDS) {
      for (const second of COLUMN_IDS) {
        const sorts = [spec(first, "asc"), spec(second, "desc")];
        expect(actual(rows, sorts), `${first} asc, ${second} desc`).toEqual(expected(rows, sorts));
      }
    }
  });

  it("matches for three keys that mix text and number", () => {
    const rows = makeRows(1500, 31);
    const sorts = [spec("int", "desc"), spec("name", "asc"), spec("float", "asc")];
    expect(actual(rows, sorts)).toEqual(expected(rows, sorts));
  });

  it("matches under a filter, where the active rows are a subset", () => {
    const rows = makeRows(1800, 41);
    const filters: FilterSpec[] = [{ columnId: "name", operator: "contains", value: "a" }];
    for (const sorts of [[spec("name", "asc")], [spec("float", "desc")], [spec("int", "asc"), spec("free", "desc")]]) {
      expect(actual(rows, sorts, filters)).toEqual(expected(rows, sorts, filters));
    }
  });

  it("matches without cell types, where every column collates its text", () => {
    const rows = makeRows(1200, 51);
    for (const columnId of ["name", "int", "float", "dirty"]) {
      const sorts = [spec(columnId, "asc")];
      expect(computeViewIndex(rows, columns, sorts, [], undefined, undefined)).toEqual(
        referenceViewIndex(rows.length, textAccessorFor(columns, rows, undefined), sorts),
      );
    }
  });

  it("matches when a consumer replaces a built-in cell type with its own compare", () => {
    const rows = makeRows(1200, 61);
    const own = {
      ...builtinCellTypes["number"],
      compare: (a: number | null, b: number | null) => Math.abs(a ?? 0) - Math.abs(b ?? 0),
    } as unknown as CellType;
    const types = { ...(builtinCellTypes as unknown as Record<string, CellType>), number: own };
    const sorts = [spec("int", "asc")];
    expect(actual(rows, sorts, [], types)).toEqual(expected(rows, sorts, [], types));
    const ownEmpty = { ...builtinCellTypes["number"], isEmpty: (value: unknown) => value == null || value === 0 } as unknown as CellType;
    const emptyTypes = { ...(builtinCellTypes as unknown as Record<string, CellType>), number: ownEmpty };
    expect(actual(rows, sorts, [], emptyTypes)).toEqual(expected(rows, sorts, [], emptyTypes));
  });

  it("matches through an accessor that only reads text", () => {
    const rows = makeRows(1200, 71);
    const accessor: CellAccessor = {
      getText: (rowIndex, columnId) => {
        const value = rows[rowIndex]![columnId];
        return value == null ? "" : String(value);
      },
    };
    const sorts = [spec("name", "desc"), spec("int", "asc")];
    expect(buildViewIndex(rows.length, accessor, { sorts, filters: [] })).toEqual(referenceViewIndex(rows.length, accessor, sorts));
  });

  it("keeps rows of an equal key in their data order, and puts empty values last in both directions", () => {
    const rows = makeRows(2000, 81);
    for (const direction of ["asc", "desc"] as const) {
      const view = actual(rows, [spec("int", direction)]);
      expect(view).toHaveLength(rows.length);
      let sawEmpty = false;
      for (let i = 0; i < view.length; i++) {
        const value = rows[view[i]!]!["int"];
        if (value == null) sawEmpty = true;
        else expect(sawEmpty).toBe(false);
        if (i === 0) continue;
        const previous = rows[view[i - 1]!]!["int"];
        if (value == null || previous == null) continue;
        const sign = direction === "asc" ? 1 : -1;
        expect(sign * ((value as number) - (previous as number))).toBeGreaterThanOrEqual(0);
        if (value === previous) expect(view[i]!).toBeGreaterThan(view[i - 1]!);
      }
    }
  });

  it("orders -0 and 0 as equal keys", () => {
    const rows: Row[] = Array.from({ length: 400 }, (_, i) => ({ id: `r${i}`, float: i % 2 === 0 ? 0 : -0 }));
    const view = actual(rows, [spec("float", "asc")]);
    expect(view).toEqual(Array.from({ length: 400 }, (_, i) => i));
  });

  it("orders an all-empty column in data order", () => {
    const rows: Row[] = Array.from({ length: 400 }, (_, i) => ({ id: `r${i}`, name: i % 2 === 0 ? null : "", int: null }));
    for (const columnId of ["name", "free", "int"]) {
      const sorts = [spec(columnId, "desc")];
      expect(actual(rows, sorts)).toEqual(expected(rows, sorts));
    }
  });

  it("ranks canonically equivalent strings like the collator does", () => {
    const forms = ["école", "école", "Ecole", "ecole", "zebra"];
    const rows: Row[] = Array.from({ length: 500 }, (_, i) => ({ id: `r${i}`, name: forms[i % forms.length], free: forms[i % forms.length] }));
    for (const columnId of ["name", "free"]) {
      const sorts = [spec(columnId, "asc")];
      expect(actual(rows, sorts)).toEqual(expected(rows, sorts));
    }
  });

  it("matches when a value's toString throws", () => {
    const rows: Row[] = Array.from({ length: 500 }, (_, i) => ({
      id: `r${i}`,
      name: i % 9 === 0 ? { toString: () => { throw new Error("boom"); } } : `n${i % 40}`,
      free: i % 9 === 0 ? { toString: () => { throw new Error("boom"); } } : `n${i % 40}`,
    }));
    for (const columnId of ["name", "free"]) {
      const sorts = [spec(columnId, "asc")];
      expect(actual(rows, sorts)).toEqual(expected(rows, sorts));
    }
  });

  it("leaves the input rows and column definitions untouched", () => {
    const rows = makeRows(600, 91);
    const snapshot = JSON.stringify(rows);
    actual(rows, [spec("name", "asc"), spec("float", "desc")]);
    expect(JSON.stringify(rows)).toBe(snapshot);
  });

  it("survives hostile values in a sorted column", () => {
    const rows: Row[] = Array.from({ length: 500 }, (_, i) => ({
      id: `r${i}`,
      name: i % 7 === 0 ? Object.create(null) : i % 5 === 0 ? { toString: () => "boom" } : i % 3 === 0 ? "plain" : `n${i}`,
      free: i % 7 === 0 ? Object.create(null) : i % 5 === 0 ? { toString: () => "boom" } : `f${i}`,
      float: i % 11 === 0 ? 10n : i,
    }));
    for (const columnId of ["name", "free", "float"]) {
      const sorts = [spec(columnId, "asc")];
      expect(actual(rows, sorts)).toEqual(expected(rows, sorts));
    }
  });
});
