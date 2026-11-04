import type { RowRange } from "@/registry/default/blocks/data-grid/data-grid";
import { rangeSize, sumRangeSizes } from "./range-math";

export const DEFAULT_LOAD_DELAY = 100;
const MAX_LOAD_DELAY = 2000;
export const DEFAULT_MAX_CONCURRENT_FETCHES = 3;
const MAX_CONCURRENT_FETCHES = 16;
export const DEFAULT_MAX_LOADED_ROWS = 10_000;

/** A sequential revalidation walks from block 0 to the rendered rows; a tick that would take more blocks is skipped. */
export const MAX_SEQUENTIAL_REVALIDATE_BLOCKS = 10;
export const MIN_REVALIDATE_INTERVAL = 1000;
export const MAX_REVALIDATE_INTERVAL = 2_147_483_647;

export type FetchLimitOptions = { loadDelay?: number; maxConcurrentFetches?: number; maxLoadedRows?: number };

export type FetchLimits = {
  loadDelay: number;
  maxConcurrentFetches: number;
  /** `Infinity` turns eviction off. */
  maxLoadedRows: number;
  /** The consumer passed a value that is not a number, `NaN`, or negative. */
  maxLoadedRowsInvalid: boolean;
};

function clampedInteger(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;
}

/** Reads the fetch limit options; a bad value falls back to its default and never throws. */
export function readFetchLimits(blockSize: number, options: FetchLimitOptions = {}): FetchLimits {
  const rows: unknown = options.maxLoadedRows;
  let maxLoadedRows = DEFAULT_MAX_LOADED_ROWS;
  let maxLoadedRowsInvalid = false;
  if (rows === Infinity) maxLoadedRows = Infinity;
  else if (typeof rows === "number" && Number.isFinite(rows) && rows >= 0) maxLoadedRows = Math.max(blockSize, Math.floor(rows));
  else if (rows !== undefined) maxLoadedRowsInvalid = true;
  return {
    loadDelay: clampedInteger(options.loadDelay, DEFAULT_LOAD_DELAY, 0, MAX_LOAD_DELAY),
    maxConcurrentFetches: clampedInteger(options.maxConcurrentFetches, DEFAULT_MAX_CONCURRENT_FETCHES, 1, MAX_CONCURRENT_FETCHES),
    maxLoadedRows,
    maxLoadedRowsInvalid,
  };
}

/** The interval in ms, or `null` when revalidation is off; `invalid` marks a value that was set but unusable. */
export function readRevalidateInterval(value: unknown): { interval: number | null; invalid: boolean } {
  if (value === undefined) return { interval: null, invalid: false };
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return { interval: null, invalid: true };
  return { interval: Math.min(MAX_REVALIDATE_INTERVAL, Math.max(MIN_REVALIDATE_INTERVAL, Math.floor(value))), invalid: false };
}

/** The wanted range grown by one block on each side, clamped to the result. Abort and eviction act outside it only. */
export function keepRange(wanted: RowRange, blockSize: number, total: number): RowRange {
  return { start: Math.max(0, wanted.start - blockSize), end: Math.min(total, wanted.end + blockSize) };
}

export function rangesIntersect(a: RowRange, b: RowRange): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Uncovered blocks of the wanted range, by block start: the end of the block and when it first entered the range. */
export type Wanted = Map<number, { end: number; since: number }>;

/** Drops the entries that left the wanted range and adds the new ones with `now`; an entry that stays keeps its time. */
export function trackWanted(wanted: Wanted, uncovered: readonly RowRange[], now: number): void {
  const current = new Set<number>();
  for (const block of uncovered) {
    current.add(block.start);
    const known = wanted.get(block.start);
    if (known) known.end = block.end;
    else wanted.set(block.start, { end: block.end, since: now });
  }
  for (const start of wanted.keys()) if (!current.has(start)) wanted.delete(start);
}

/** The blocks that stayed in the wanted range for `delay` ms, nearest to `centre` first and at most `limit`, and when the next one is due. */
export function dueWanted(wanted: Wanted, { now, delay, centre, limit }: { now: number; delay: number; centre: number; limit: number }): { due: RowRange[]; nextAt: number | null } {
  const due: RowRange[] = [];
  let nextAt: number | null = null;
  for (const [start, { end, since }] of wanted) {
    const at = since + delay;
    if (at <= now) due.push({ start, end });
    else if (nextAt === null || at < nextAt) nextAt = at;
  }
  due.sort((a, b) => distanceToCentre(a, centre) - distanceToCentre(b, centre) || a.start - b.start);
  return { due: due.slice(0, Math.max(0, limit)), nextAt };
}

export function distanceToCentre(range: RowRange, centre: number): number {
  return Math.abs((range.start + range.end) / 2 - centre);
}

export type EvictionPick = {
  /** A whole block of the result. */
  block: RowRange;
  /** Slots of the block that stay loaded because their rows are protected. */
  kept: readonly number[];
};

type EvictionInput = {
  /** Merged and ascending. */
  loaded: readonly RowRange[];
  /** Block index -> stamp of the latest report that had the block in its keep range; a block without a stamp is the oldest. */
  viewed: ReadonlyMap<number, number>;
  keep: RowRange;
  blockSize: number;
  cap: number;
  /** The slots of the block whose loaded rows must stay. */
  protectedSlots?: (block: RowRange) => readonly number[];
};

/**
 * Picks whole blocks outside the keep range, least recently viewed first, until the loaded rows fit under `cap`.
 * A block with protected slots frees only its other rows; a block that frees nothing is skipped. The cap is soft.
 */
export function pickEvictions({ loaded, viewed, keep, blockSize, cap, protectedSlots }: EvictionInput): EvictionPick[] {
  let total = sumRangeSizes(loaded);
  if (total <= cap) return [];
  const sizes = new Map<number, number>();
  for (const range of loaded) {
    for (let index = Math.floor(range.start / blockSize); index * blockSize < range.end; index++) {
      const block = { start: index * blockSize, end: (index + 1) * blockSize };
      const overlap = Math.min(range.end, block.end) - Math.max(range.start, block.start);
      sizes.set(index, (sizes.get(index) ?? 0) + overlap);
    }
  }
  const candidates = [...sizes.keys()].filter((index) => !rangesIntersect({ start: index * blockSize, end: (index + 1) * blockSize }, keep));
  candidates.sort((a, b) => (viewed.get(a) ?? 0) - (viewed.get(b) ?? 0) || a - b);
  const picks: EvictionPick[] = [];
  for (const index of candidates) {
    if (total <= cap) break;
    const block = { start: index * blockSize, end: (index + 1) * blockSize };
    const kept = protectedSlots?.(block) ?? [];
    const freed = sizes.get(index)! - kept.length;
    if (freed <= 0) continue;
    picks.push({ block, kept });
    total -= freed;
  }
  return picks;
}

/** The block ranges of a pick, minus the kept slots, as ranges to unload. */
export function unloadRangesOf(pick: EvictionPick): RowRange[] {
  const ranges: RowRange[] = [];
  let from = pick.block.start;
  for (const slot of [...pick.kept].sort((a, b) => a - b)) {
    if (slot > from) ranges.push({ start: from, end: slot });
    from = slot + 1;
  }
  if (from < pick.block.end) ranges.push({ start: from, end: pick.block.end });
  return ranges.filter((range) => rangeSize(range) > 0);
}

/** Drops the stamps of blocks that hold no loaded row and sit outside the keep range. */
export function pruneViewed(viewed: Map<number, number>, loaded: readonly RowRange[], keep: RowRange, blockSize: number): void {
  const held = new Set<number>();
  for (const range of loaded) for (let index = Math.floor(range.start / blockSize); index * blockSize < range.end; index++) held.add(index);
  for (const index of viewed.keys()) {
    if (!held.has(index) && !rangesIntersect({ start: index * blockSize, end: (index + 1) * blockSize }, keep)) viewed.delete(index);
  }
}
