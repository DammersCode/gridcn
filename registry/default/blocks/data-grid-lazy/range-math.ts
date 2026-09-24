/** A half-open row range `[start, end)`, matching `onRowWindowChange`'s convention. */
export type Range = { start: number; end: number };

/** `end - start`, clamped to 0 for an inverted/empty range. */
export function rangeSize(range: Range): number {
  return Math.max(0, range.end - range.start);
}

/** Whether two half-open ranges overlap or touch at an edge (touching ranges are mergeable). */
function rangesAdjacentOrOverlapping(a: Range, b: Range): boolean {
  return a.start <= b.end && b.start <= a.end;
}

/**
 * Expands `range` by `overscan` rows on each side, then rounds outward so both edges land on a
 * `batchSize` boundary — small scrolls request the same batch repeatedly instead of a slightly
 * different range every tick (spec: "round ranges up so tiny scrolls don't spam requests").
 * Clamps to `[0, total]`.
 */
export function expandRange(range: Range, opts: { overscan: number; batchSize: number; total?: number }): Range {
  const { overscan, batchSize, total = Infinity } = opts;
  const withOverscan = { start: range.start - overscan, end: range.end + overscan };
  const batch = Math.max(1, batchSize);
  const start = Math.floor(withOverscan.start / batch) * batch;
  const end = Math.ceil(withOverscan.end / batch) * batch;
  return {
    start: Math.max(0, start),
    end: Math.min(total, Math.max(start, end)),
  };
}

/**
 * Subtracts every range in `covered` (already loaded or in-flight, any order/overlap) from
 * `target`, returning the remaining uncovered pieces coalesced into as few ranges as possible —
 * this is the "never re-request a loading/loaded range; merge adjacent gaps" rule as pure math.
 */
export function subtractRanges(target: Range, covered: readonly Range[]): Range[] {
  if (rangeSize(target) === 0) return [];
  const relevant = covered
    .filter((r) => rangeSize(r) > 0 && rangesAdjacentOrOverlapping(r, target))
    .map((r) => ({ start: Math.max(r.start, target.start), end: Math.min(r.end, target.end) }))
    .sort((a, b) => a.start - b.start);

  const merged: Range[] = [];
  for (const r of relevant) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ ...r });
    }
  }

  const gaps: Range[] = [];
  let cursor = target.start;
  for (const r of merged) {
    if (r.start > cursor) gaps.push({ start: cursor, end: r.start });
    cursor = Math.max(cursor, r.end);
  }
  if (cursor < target.end) gaps.push({ start: cursor, end: target.end });
  return gaps;
}

/** Sum of `rangeSize` across a list of ranges — callers pass an already-merged (disjoint) list so this is a true row count, not a double-count of overlaps. */
export function sumRangeSizes(ranges: readonly Range[]): number {
  return ranges.reduce((total, r) => total + rangeSize(r), 0);
}

/**
 * Splits `range` into consecutive chunks of at most `max` rows, covering it exactly once; a
 * single chunk when the range already fits. Each chunk obeys the `fetchRows` contract on its
 * own: exactly `chunk.end - chunk.start` rows, positionally aligned to `chunk.start`.
 */
export function chunkRange(range: Range, max: number): Range[] {
  const size = rangeSize(range);
  const cap = Math.max(1, max);
  if (size <= cap) return [range];
  const chunks: Range[] = [];
  for (let start = range.start; start < range.end; start += cap) {
    chunks.push({ start, end: Math.min(range.end, start + cap) });
  }
  return chunks;
}

/** Merges a list of ranges (any order/overlap) into the minimal set of disjoint, non-touching ranges. */
export function mergeRanges(ranges: readonly Range[]): Range[] {
  const sorted = ranges
    .filter((r) => rangeSize(r) > 0)
    .slice()
    .sort((a, b) => a.start - b.start);
  const merged: Range[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}
