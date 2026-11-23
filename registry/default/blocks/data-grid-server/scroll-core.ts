import type { RowRange } from "@/registry/default/blocks/data-grid/data-grid";
import { scheduleFrame } from "./server-state";
import type { Wanted } from "./fetch-hygiene";
import type { SeqBlock } from "./sequence-eviction";
import type { FetchReason } from "./read-answer";
import type { GuardedBlock, ProtectedRows } from "./refresh-guard";

export type Pending<TData> = GuardedBlock<TData> & { rows: (TData | undefined)[]; mark: number; final?: boolean };
/** `guard` is the set of rows protected when the request started; a retry reuses it. */
export type Guard = { ids: ProtectedRows; /** The save count when the request started; later saves are protected too. */ mark: number };
export type InFlight = { range: RowRange; controller: AbortController; guard: Guard; /** The answer is being written; the request only waits to settle. */ landed: boolean };
export type Failed = { range: RowRange; cursor: unknown; error: unknown };

export type Sequence = {
  /** The cursor the next block sends. */
  cursor: unknown;
  ended: boolean;
  /** Rows loaded, without the skeleton rows below them. */
  length: number;
  /** Where the next request starts: the rows the server answered, which exceed `length` by the protected rows dropped from appended blocks. */
  offset: number;
  /** The count the server sent, if any. */
  sentCount: number | null;
  /** A refresh rewrites the rows in place from the first block until the chain passes `keepUntil`. */
  refresh: { keepUntil: number; local: number } | null;
  /** Keys of the cursors the chain returned so far. */
  seen: Set<string>;
  /** The landed blocks, ascending by `local`; an evicted block reloads from its stored cursor. */
  blocks: SeqBlock[];
};

export const freshSequence = (): Sequence => ({ cursor: undefined, ended: false, length: 0, offset: 0, sentCount: null, refresh: null, seen: new Set(), blocks: [] });

export type Core<TData> = {
  count: number | null;
  /** The first block of the current spec landed. */
  ready: boolean;
  loaded: RowRange[];
  /** Decided by the first answer of the current spec. */
  kind: "unknown" | "random" | "sequence";
  seq: Sequence;
  inFlight: Map<string, InFlight>;
  failed: Map<string, Failed>;
  pending: Pending<TData>[];
  cancelFrame: (() => void) | null;
  lastWindow: RowRange | null;
  rowsLength: number;
  warned: Set<string>;
  /** Guarded rows an earlier block overwrote, for the block that brings their id back; empty when no request is pending. */
  displaced: Map<string, TData>;
  /** Protected rows that are not loaded (dropped by a spec change or deleted locally); a block that carries one keeps its incoming copy. */
  absent: Set<string>;
  /** Ranges whose rows a local row operation moved: not loaded, but a protected row may still sit there. A landing block or an eviction removes them. */
  stale: RowRange[];
  /** Protected rows that a block overwrote, and the ids the landed blocks carried; both are emptied when no request is pending. */
  orphans: Map<string, { row: TData; slot: number }>;
  carried: Set<string>;
  /** Cancels the refresh that a burst of local row operations queued for the next frame. */
  cancelQueuedRefresh: (() => void) | null;
  /** Rows with a delete still saving: an answer that carries one drops it. */
  deleted: Set<string>;
  /** Slots an answer left empty on purpose (a repeated or deleted row): answered, never refetched, never claimed as loaded. */
  empty: RowRange[];
  /** Slots a protected row moved away from; `core.loaded` stops claiming them. */
  cleared: Set<number>;
  /** Slots where a protected row returned outside any claimed range; they join `stale`, so a count change still finds the row. */
  restored: Set<number>;
  /** Uncovered blocks of the wanted range with the time each entered it; one entry for a sequential source. */
  wanted: Wanted;
  /** Evicted sequential blocks inside the wanted range, by server start. */
  reloads: Wanted;
  delayTimer: ReturnType<typeof setTimeout> | null;
  /** Why the requests that start now run; back to `"load"` when none is owed or in flight. */
  reason: FetchReason;
  /** Blocks of a refresh or retry that wait for a free request slot. */
  owed: RowRange[];
  /** Block index -> stamp of the latest report that had the block in its keep range. */
  viewed: Map<number, number>;
  tick: number;
  /** The keep range of the latest report. */
  keep: RowRange | null;
  /** Blocks an eviction unloaded; the layout effect drops their stamps. */
  evictedBlocks: Set<number>;
  /** Set when rows were unloaded; the layout effect syncs the loaded count. */
  unloaded: boolean;
  /** Set by an eviction; the layout effect reports the rendered rows again, in case a report ran before the rows unloaded. */
  reportAfterUnload: boolean;
  pumping: boolean;
  pumpAgain: boolean;
};

export function createCore<TData>(): Core<TData> {
  return { count: null, ready: false, loaded: [], kind: "unknown", seq: freshSequence(), inFlight: new Map(), failed: new Map(), pending: [], cancelFrame: null, lastWindow: null, rowsLength: 0, warned: new Set(), displaced: new Map(), absent: new Set(), deleted: new Set(), cancelQueuedRefresh: null, orphans: new Map(), carried: new Set(), empty: [], stale: [], cleared: new Set(), restored: new Set(), wanted: new Map(), reloads: new Map(), delayTimer: null, reason: "load", owed: [], viewed: new Map(), tick: 0, keep: null, evictedBlocks: new Set(), unloaded: false, reportAfterUnload: false, pumping: false, pumpAgain: false };
}

export const rangeKey = (range: RowRange) => `${range.start}:${range.end}`;

export const DEFAULT_BLOCK_SIZE = 50;
export const DEFAULT_OVERSCAN = 30;

export function positiveInteger(value: number | undefined, fallback: number, min: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.floor(value)) : fallback;
}

/** Keeps the entries of rows that are still protected: a queued commit may still read or fill the map. */
export function forgetDisplacedWhenIdle<TData>(core: Core<TData>, stillProtected: ProtectedRows) {
  if (oldestMark(core) !== null) return;
  for (const id of core.displaced.keys()) if (!stillProtected?.has(id)) core.displaced.delete(id);
  core.orphans = new Map();
  core.carried = new Set();
}

export function commitOnFrame<TData>(core: Core<TData>, commit: () => void, onIdle: () => void) {
  if (core.cancelFrame !== null) return;
  commit();
  core.cancelFrame = scheduleFrame(() => {
    core.cancelFrame = null;
    if (core.pending.length > 0) commitOnFrame(core, commit, onIdle);
    else onIdle();
  });
}

export function oldestMark<TData>(core: Core<TData>): number | null {
  let oldest: number | null = null;
  const note = (mark: number) => {
    if (oldest === null || mark < oldest) oldest = mark;
  };
  for (const { guard } of core.inFlight.values()) note(guard.mark);
  for (const { mark } of core.pending) note(mark);
  return oldest;
}

export function busy<TData>(core: Core<TData>): boolean {
  return core.inFlight.size > 0 || core.pending.length > 0 || core.owed.length > 0;
}

export function resetQueues<TData>(core: Core<TData>) {
  if (core.delayTimer !== null) clearTimeout(core.delayTimer);
  core.delayTimer = null;
  core.wanted.clear();
  core.reloads.clear();
  core.owed = [];
}

/** Unacknowledged rows that no save is pending for: a landed block replaces them, while a saving row keeps its local value. */
export function unacknowledgedWithoutSave(unacknowledged: ReadonlySet<string> | null, saving: ProtectedRows): ReadonlySet<string> | null {
  if (unacknowledged === null || saving === null) return unacknowledged;
  const rest = new Set<string>();
  for (const id of unacknowledged) if (!saving.has(id)) rest.add(id);
  return rest.size > 0 ? rest : null;
}

/** Runs `step` until no call asked for another pass; a call from inside `step` only asks. */
export function runPumps<TData>(core: Core<TData>, step: () => void) {
  if (core.pumping) {
    core.pumpAgain = true;
    return;
  }
  core.pumping = true;
  try {
    do {
      core.pumpAgain = false;
      step();
    } while (core.pumpAgain);
  } finally {
    core.pumping = false;
  }
}

export function abortRequestsExcept<TData>(core: Core<TData>, keep: RowRange) {
  const keepKey = rangeKey(keep);
  for (const [key, { controller }] of core.inFlight) {
    if (key === keepKey) continue;
    controller.abort();
    core.inFlight.delete(key);
  }
}
