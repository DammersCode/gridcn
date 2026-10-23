/** One batch of row moves as a single permutation of the `count` view rows. */
export type RowMovePlan = {
  /** Distinct moved rows, ascending, as view indices before the move. */
  sources: readonly number[];
  /** Final view index of each source, parallel to `sources`. */
  targets: readonly number[];
  /** Final view index of every row: `newIndexOf[before] === after`. */
  newIndexOf: Int32Array;
};

function distinctSources(count: number, rows: readonly number[]): number[] | null {
  const marked = new Uint8Array(count);
  let distinct = 0;
  for (const row of rows) {
    if (!Number.isInteger(row) || row < 0 || row >= count) return null;
    if (marked[row] === 0) {
      marked[row] = 1;
      distinct++;
    }
  }
  if (distinct === 0) return null;
  const sources = new Array<number>(distinct);
  let at = 0;
  for (let row = 0; row < count; row++) if (marked[row] === 1) sources[at++] = row;
  return sources;
}

function buildPlan(count: number, sources: readonly number[], targets: readonly number[]): RowMovePlan | null {
  if (sources.every((source, i) => source === targets[i])) return null;
  const newIndexOf = new Int32Array(count);
  let nextSource = 0;
  let nextTarget = 0;
  let slot = 0;
  for (let row = 0; row < count; row++) {
    if (nextSource < sources.length && sources[nextSource] === row) {
      newIndexOf[row] = targets[nextSource++]!;
      continue;
    }
    while (nextTarget < targets.length && targets[nextTarget] === slot) {
      slot++;
      nextTarget++;
    }
    newIndexOf[row] = slot++;
  }
  return { sources, targets, newIndexOf };
}

/**
 * Plans moving `rows` as one block: the rows keep their relative order and land contiguous, the
 * first at final index `to`. Returns `null` for an empty or out-of-range list, a `to` that leaves
 * no room for the block, and a move that changes nothing. Linear in `count` plus `rows.length`.
 */
export function planBlockMove(count: number, rows: readonly number[], to: number): RowMovePlan | null {
  const sources = distinctSources(count, rows);
  if (!sources || !Number.isInteger(to) || to < 0 || to + sources.length > count) return null;
  return buildPlan(count, sources, sources.map((_, i) => to + i));
}

/**
 * Plans shifting every row in `rows` by `delta` and keeping the gaps between them. Returns `null`
 * when any row would leave the grid, so the whole batch stays put at an edge.
 */
export function planShiftMove(count: number, rows: readonly number[], delta: number): RowMovePlan | null {
  const sources = distinctSources(count, rows);
  if (!sources || !Number.isInteger(delta) || delta === 0) return null;
  if (sources[0]! + delta < 0 || sources[sources.length - 1]! + delta >= count) return null;
  return buildPlan(count, sources, sources.map((source) => source + delta));
}
