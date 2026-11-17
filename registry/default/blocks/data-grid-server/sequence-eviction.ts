import type { RowRange } from "@/registry/default/blocks/data-grid/data-grid";
import { distanceToCentre, rangesIntersect } from "./fetch-hygiene";
import { subtractRanges } from "./range-math";
import type { ProtectedRows } from "./refresh-guard";
import type { Core } from "./scroll-core";
import { protectedSlotsIn } from "./scroll-eviction";

/** One landed block of a sequential chain: where its rows sit in `data` and the request that fetches it again. */
export type SeqBlock = { local: number; length: number; server: number; serverEnd: number; cursor: unknown; evicted: boolean };

/** The loaded rows of a sequential chain: `[0, position)` minus the evicted blocks. */
export function sequenceLoaded(position: number, blocks: readonly SeqBlock[]): RowRange[] {
  const gone = blocks.filter((block) => block.evicted).map((block) => ({ start: block.local, end: block.local + block.length }));
  return position > 0 ? subtractRanges({ start: 0, end: position }, gone) : [];
}

/** The evicted blocks that overlap `range`. */
export function evictedBlocksIn(blocks: readonly SeqBlock[], range: RowRange): SeqBlock[] {
  let low = 0;
  let high = blocks.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (blocks[mid]!.local + blocks[mid]!.length <= range.start) low = mid + 1;
    else high = mid;
  }
  const found: SeqBlock[] = [];
  for (let index = low; index < blocks.length && blocks[index]!.local < range.end; index++) if (blocks[index]!.evicted) found.push(blocks[index]!);
  return found;
}

/** Moves the blocks after a local insert (`delta` 1) or delete (`delta` -1) at `index`. */
export function shiftBlocks(blocks: SeqBlock[], index: number, delta: 1 | -1): SeqBlock[] {
  const shifted: SeqBlock[] = [];
  for (const block of blocks) {
    if (block.local >= index + (delta === 1 ? 0 : 1)) shifted.push({ ...block, local: block.local + delta });
    else if (index < block.local + block.length) shifted.push({ ...block, length: block.length + delta });
    else shifted.push(block);
  }
  return shifted.filter((block) => block.length > 0);
}

type EvictInput<TData> = {
  /** `evicted` flags before this commit; a repeated run of the updater picks the same blocks. */
  wasEvicted: readonly boolean[];
  loadedTotal: number;
  keep: RowRange;
  cap: number;
  protectedIds: ProtectedRows;
  idOf: (row: TData, index: number) => string;
};

/**
 * Unloads the blocks furthest from the keep range until the loaded rows fit `cap`; that is the front of the chain while the user scrolls down.
 * A block with a protected row stays whole. Writes the slots of `rows` in place.
 */
export function evictSequenceRows<TData>(core: Core<TData>, rows: (TData | undefined)[], { wasEvicted, loadedTotal, keep, cap, protectedIds, idOf }: EvictInput<TData>): (TData | undefined)[] {
  const { blocks } = core.seq;
  const centre = (keep.start + keep.end) / 2;
  const candidates = blocks.filter((block, index) => !wasEvicted[index] && !rangesIntersect({ start: block.local, end: block.local + block.length }, keep));
  candidates.sort((a, b) => distanceToCentre({ start: b.local, end: b.local + b.length }, centre) - distanceToCentre({ start: a.local, end: a.local + a.length }, centre) || a.local - b.local);
  let total = loadedTotal;
  let evicted = false;
  for (const block of candidates) {
    if (total <= cap) break;
    const range = { start: block.local, end: block.local + block.length };
    if (protectedIds !== null && protectedSlotsIn(rows, range, protectedIds, idOf).length > 0) continue;
    rows.fill(undefined, range.start, Math.min(range.end, rows.length));
    block.evicted = true;
    total -= block.length;
    evicted = true;
  }
  if (!evicted) return rows;
  core.loaded = sequenceLoaded(core.seq.length, blocks);
  core.unloaded = true;
  return rows;
}
