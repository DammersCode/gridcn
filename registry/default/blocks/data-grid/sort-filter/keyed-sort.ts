import type { SortSpec } from "../types";
import type { CellAccessor } from "./build-view-index";
import { sortCollator, variantSortCollator } from "./sort-collator";

/** Below this many rows the comparator-chain sort wins on setup cost, so the keyed sort stays out. */
export const KEYED_SORT_MIN_ROWS = 256;

/** What a {@link SortKeyReader} returns for an empty cell. */
export const EMPTY_SORT_VALUE: unique symbol = Symbol("empty-sort-value");

/**
 * Reads one column's raw sort values for the keyed sort. `kind: "number"` promises that the column
 * orders finite numbers by `a - b`; `kind: "text"` promises that it orders strings by `localeCompare`.
 * `read` returns {@link EMPTY_SORT_VALUE} for a cell that sorts last in both directions.
 */
export type SortKeyReader = {
  kind: "number" | "text";
  read(rowIndex: number): unknown;
};

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
/** Beyond this magnitude two finite numbers can differ by Infinity, which the comparator treats as unordered. */
const NUMBER_LIMIT = 1e300;

type Keys = { lo: Uint32Array; hi: Uint32Array | null; bytes: number };

/**
 * Number keys: the IEEE-754 bits, flipped so unsigned integer order equals numeric order. Descending
 * inverts every bit. An empty cell takes the all-ones key, which no finite number maps to, so it sorts
 * last in both directions. Returns `null` for a value the plain comparator would not order by `a - b`.
 */
function numberKeys(indices: readonly number[], read: (row: number) => unknown, descending: boolean): Keys | null {
  const count = indices.length;
  const lo = new Uint32Array(count);
  const hi = new Uint32Array(count);
  const float = new Float64Array(1);
  const bits = new Uint32Array(float.buffer);
  for (let position = 0; position < count; position++) {
    const value = read(indices[position]!);
    if (value === EMPTY_SORT_VALUE) {
      lo[position] = 0xffffffff;
      hi[position] = 0xffffffff;
      continue;
    }
    if (typeof value !== "number" || value > NUMBER_LIMIT || value < -NUMBER_LIMIT || value !== value) return null;
    float[0] = value === 0 ? 0 : value;
    let high = bits[1]!;
    let low = bits[0]!;
    if (high & 0x80000000) {
      high = ~high;
      low = ~low;
    } else {
      high |= 0x80000000;
    }
    if (descending) {
      high = ~high;
      low = ~low;
    }
    lo[position] = low;
    hi[position] = high;
  }
  return { lo, hi, bytes: 8 };
}

/**
 * Text keys: the dense rank of each row's string under `compare`, so equal strings (and strings the
 * comparator calls equal) share a key. Only the distinct strings are sorted. `readText` returns `null`
 * for an empty cell, which takes the largest key in both directions; it returns `undefined` for a value
 * the keyed sort cannot rank.
 */
function textKeys(
  count: number,
  readText: (position: number) => string | null | undefined,
  compare: (a: string, b: string) => number,
  descending: boolean,
): Keys | null {
  const ids = new Uint32Array(count);
  const idOf = new Map<string, number>();
  const distinct: string[] = [];
  const EMPTY_ID = 0xffffffff;
  for (let position = 0; position < count; position++) {
    const text = readText(position);
    if (text === undefined) return null;
    if (text === null) {
      ids[position] = EMPTY_ID;
      continue;
    }
    let id = idOf.get(text);
    if (id === undefined) {
      id = distinct.length;
      idOf.set(text, id);
      distinct.push(text);
    }
    ids[position] = id;
  }
  const ordered = distinct.sort(compare);
  const rankOfId = new Uint32Array(distinct.length);
  let rank = 0;
  for (let i = 0; i < ordered.length; i++) {
    if (i > 0 && compare(ordered[i - 1]!, ordered[i]!) !== 0) rank++;
    rankOfId[idOf.get(ordered[i]!)!] = rank;
  }
  const emptyKey = ordered.length === 0 ? 0 : rank + 1;
  const lo = ids;
  for (let position = 0; position < count; position++) {
    const id = ids[position]!;
    lo[position] = id === EMPTY_ID ? emptyKey : descending ? rank - rankOfId[id]! : rankOfId[id]!;
  }
  return { lo, hi: null, bytes: emptyKey > 0xffffff ? 4 : emptyKey > 0xffff ? 3 : emptyKey > 0xff ? 2 : 1 };
}

type Buffers = { order: Uint32Array; spareOrder: Uint32Array; lo: Uint32Array; spareLo: Uint32Array; hi: Uint32Array; spareHi: Uint32Array };

/**
 * One stable least-significant-digit radix sort of `buffers.order` by `keys`. A byte that is the same in
 * every key is skipped. Returns the buffers with `order` holding the new order.
 */
function radixStage(buffers: Buffers, keys: Keys, count: number): Buffers {
  let { order, spareOrder, lo, spareLo, hi, spareHi } = buffers;
  const hasHigh = keys.hi !== null;
  for (let i = 0; i < count; i++) {
    const row = order[i]!;
    lo[i] = keys.lo[row]!;
    if (hasHigh) hi[i] = keys.hi![row]!;
  }
  const counts = new Uint32Array(8 * 256);
  for (let i = 0; i < count; i++) {
    const low = lo[i]!;
    counts[low & 0xff]!++;
    counts[256 + ((low >>> 8) & 0xff)]!++;
    counts[512 + ((low >>> 16) & 0xff)]!++;
    counts[768 + (low >>> 24)]!++;
    if (hasHigh) {
      const high = hi[i]!;
      counts[1024 + (high & 0xff)]!++;
      counts[1280 + ((high >>> 8) & 0xff)]!++;
      counts[1536 + ((high >>> 16) & 0xff)]!++;
      counts[1792 + (high >>> 24)]!++;
    }
  }
  const offsets = new Uint32Array(256);
  for (let pass = 0; pass < keys.bytes; pass++) {
    const base = pass * 256;
    let single = false;
    let sum = 0;
    for (let bucket = 0; bucket < 256; bucket++) {
      const size = counts[base + bucket]!;
      if (size === count) single = true;
      offsets[bucket] = sum;
      sum += size;
    }
    if (single) continue;
    const useHigh = pass >= 4;
    const shift = (pass & 3) * 8;
    if (useHigh) {
      for (let i = 0; i < count; i++) {
        const high = hi[i]!;
        const target = offsets[(high >>> shift) & 0xff]!++;
        spareOrder[target] = order[i]!;
        spareLo[target] = lo[i]!;
        spareHi[target] = high;
      }
      [hi, spareHi] = [spareHi, hi];
    } else if (hasHigh) {
      for (let i = 0; i < count; i++) {
        const low = lo[i]!;
        const target = offsets[(low >>> shift) & 0xff]!++;
        spareOrder[target] = order[i]!;
        spareLo[target] = low;
        spareHi[target] = hi[i]!;
      }
      [hi, spareHi] = [spareHi, hi];
    } else {
      for (let i = 0; i < count; i++) {
        const low = lo[i]!;
        const target = offsets[(low >>> shift) & 0xff]!++;
        spareOrder[target] = order[i]!;
        spareLo[target] = low;
      }
    }
    [order, spareOrder] = [spareOrder, order];
    [lo, spareLo] = [spareLo, lo];
  }
  return { order, spareOrder, lo, spareLo, hi, spareHi };
}

function keysFor(indices: readonly number[], accessor: CellAccessor, sort: SortSpec): Keys | null {
  const descending = sort.direction === "desc";
  const reader = accessor.sortKeys?.(sort.columnId);
  if (reader) {
    if (reader.kind === "number") return numberKeys(indices, reader.read, descending);
    return textKeys(
      indices.length,
      (position) => {
        const value = reader.read(indices[position]!);
        if (value === EMPTY_SORT_VALUE) return null;
        return typeof value === "string" ? value : undefined;
      },
      variantSortCollator().compare,
      descending,
    );
  }
  if (accessor.compare?.(sort.columnId)) return null;
  return textKeys(
    indices.length,
    (position) => {
      const text = accessor.getText(indices[position]!, sort.columnId);
      return text === "" ? null : text;
    },
    sortCollator().compare,
    descending,
  );
}

/**
 * Sorts `indices` (ascending data indices) by `sorts` without a per-comparison callback: each sort
 * column becomes an unsigned integer key per row, and one stable radix pass per key byte orders the
 * rows from the last sort column to the first. A tie on every key keeps data order. Returns `null`
 * when any column cannot be keyed exactly, and the caller then runs the comparator-chain sort.
 */
export function sortByKeys(indices: readonly number[], accessor: CellAccessor, sorts: readonly SortSpec[]): number[] | null {
  if (!LITTLE_ENDIAN) return null;
  const count = indices.length;
  if (sorts.some((sort) => !accessor.sortKeys?.(sort.columnId) && accessor.compare?.(sort.columnId))) return null;
  const keys: Keys[] = [];
  for (const sort of sorts) {
    const column = keysFor(indices, accessor, sort);
    if (!column) return null;
    keys.push(column);
  }
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i++) order[i] = i;
  let buffers: Buffers = {
    order,
    spareOrder: new Uint32Array(count),
    lo: new Uint32Array(count),
    spareLo: new Uint32Array(count),
    hi: new Uint32Array(keys.some((column) => column.hi) ? count : 0),
    spareHi: new Uint32Array(keys.some((column) => column.hi) ? count : 0),
  };
  for (let i = keys.length - 1; i >= 0; i--) buffers = radixStage(buffers, keys[i]!, count);
  const result = new Array<number>(count);
  for (let i = 0; i < count; i++) result[i] = indices[buffers.order[i]!]!;
  return result;
}
