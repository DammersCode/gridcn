import type { RowRange } from "@/registry/default/blocks/data-grid/data-grid";
import { pickEvictions, pruneViewed, unloadRangesOf } from "./fetch-hygiene";
import { mergeRanges, subtractRanges } from "./range-math";
import type { ProtectedRows } from "./refresh-guard";
import type { Core } from "./scroll-core";

export function stampViewed<TData>(core: Core<TData>, keep: RowRange, size: number, cap: number) {
  const stamp = ++core.tick;
  for (let index = Math.floor(keep.start / size); index * size < keep.end; index++) core.viewed.set(index, stamp);
  if (core.viewed.size > Math.ceil(cap / size) * 2 + 256) pruneViewed(core.viewed, core.loaded, keep, size);
}

export function stampLanded<TData>(core: Core<TData>, start: number, length: number, size: number, cap: number) {
  if (!Number.isFinite(cap)) return;
  for (let index = Math.floor(start / size); index * size < start + length; index++) if (!core.viewed.has(index)) core.viewed.set(index, core.tick);
}

/** Unloads the target slots of `prev` except protected rows; `cleared` lists the slots that were unloaded. Pure. */
export function unloadRows<TData>(prev: readonly (TData | undefined)[], targets: readonly RowRange[], protectedIds: ProtectedRows, idOf: (row: TData, index: number) => string): { rows: (TData | undefined)[]; cleared: RowRange[]; kept: RowRange[] } {
  let next: (TData | undefined)[] | null = null;
  const kept: RowRange[] = [];
  for (const { start, end } of targets) {
    for (let index = start; index < Math.min(end, prev.length); index++) {
      const row = prev[index];
      if (row === undefined) continue;
      if (protectedIds?.has(idOf(row, index))) kept.push({ start: index, end: index + 1 });
      else (next ??= prev.slice())[index] = undefined;
    }
  }
  return { rows: next ?? (prev as (TData | undefined)[]), cleared: kept.length === 0 ? targets.slice() : targets.flatMap((target) => subtractRanges(target, kept)), kept };
}

/**
 * Removes unloaded slots from the ranges the hook claims. A kept slot (a protected row that stays) moves from `loaded` to `stale`,
 * so the next window fetches its block whole and the answer replaces or moves the row. Idempotent: a StrictMode updater may run twice.
 */
export function forgetUnloaded<TData>(core: Core<TData>, cleared: readonly RowRange[], kept: readonly RowRange[] = []) {
  if (cleared.length === 0 && kept.length === 0) return;
  core.loaded = mergeRanges(core.loaded.flatMap((range) => subtractRanges(range, [...cleared, ...kept])));
  core.stale = mergeRanges([...core.stale.flatMap((range) => subtractRanges(range, cleared)), ...kept]);
  core.empty = core.empty.flatMap((range) => subtractRanges(range, cleared));
  core.unloaded = true;
}

type EvictInput<TData> = { loaded: readonly RowRange[]; keep: RowRange; size: number; cap: number; protectedIds: ProtectedRows; idOf: (row: TData, index: number) => string };

/** Unloads the least recently viewed blocks outside the keep range until the loaded rows fit the cap. Pure in `rows`; the core updates are idempotent. */
export function evictRows<TData>(core: Core<TData>, rows: (TData | undefined)[], { loaded, keep, size, cap, protectedIds, idOf }: EvictInput<TData>): (TData | undefined)[] {
  const protectedSlots = protectedIds === null ? undefined : (block: RowRange) => protectedSlotsIn(rows, block, protectedIds, idOf);
  const picks = pickEvictions({ loaded, viewed: core.viewed, keep, blockSize: size, cap, protectedSlots });
  if (picks.length === 0) return rows;
  const ranges = picks.flatMap(unloadRangesOf);
  // `rows` is the fresh copy that `writeBlocks` returned, so the slots are written in place.
  for (const { start, end } of ranges) rows.fill(undefined, start, Math.min(end, rows.length));
  forgetUnloaded(core, ranges, picks.flatMap((pick) => pick.kept.map((slot) => ({ start: slot, end: slot + 1 }))));
  core.reportAfterUnload = true;
  for (const pick of picks) if (pick.kept.length === 0) core.evictedBlocks.add(pick.block.start / size);
  return rows;
}

export function protectedSlotsIn<TData>(rows: readonly (TData | undefined)[], block: RowRange, protectedIds: ReadonlySet<string>, idOf: (row: TData, index: number) => string): number[] {
  const slots: number[] = [];
  for (let index = block.start; index < Math.min(block.end, rows.length); index++) {
    const row = rows[index];
    if (row !== undefined && protectedIds.has(idOf(row, index))) slots.push(index);
  }
  return slots;
}
