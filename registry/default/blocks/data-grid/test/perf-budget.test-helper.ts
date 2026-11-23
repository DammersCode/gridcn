/** True only on CI. The vitest `define` writes the string "false" into `process.env.CI` locally, so a truthiness check on it is wrong. */
export const IS_CI = String(import.meta.env.CI) === "true";

/** `factor` on CI, 1 elsewhere. Scales an absolute budget; never scale a same-run reference. */
export function ciFactor(factor = 2, ci = IS_CI): number {
  return ci ? factor : 1;
}

/** Fastest of `runs` runs in milliseconds: load only slows single runs. */
export function bestMs(fn: () => unknown, runs = 5): number {
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

/** Same-run CPU speed probe for wall-clock tests that have no work mix to mirror, such as browser long-task totals. */
export function plainLoopMs(): number {
  return bestMs(() => {
    let sum = 0;
    for (let i = 0; i < 2_000_000; i++) sum += Math.sqrt(i);
    return sum;
  });
}

export type BudgetOptions = {
  /** Milliseconds that pass on an idle machine with no reference slowdown. */
  floor: number;
  /** Highest budget, so a regression still fails when the reference is slow. */
  cap: number;
  /** Multiple of the same-run reference that raises the budget above the floor. */
  k?: number;
  /** Same-run milliseconds of a plain loop with the work's mix. Omit for a fixed floor. */
  reference?: number;
  /** CI widening of floor and cap only; the reference term stays as measured. */
  ciFactor?: number;
  ci?: boolean;
};

/** `min(CI x cap, max(CI x floor, k x reference))`: load raises the budget from the floor toward the cap. */
export function budget({ floor, cap, k = 1, reference = 0, ciFactor: factor = 2, ci = IS_CI }: BudgetOptions): number {
  const scale = ciFactor(factor, ci);
  return Math.min(scale * cap, Math.max(scale * floor, k * reference));
}
