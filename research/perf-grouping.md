# Perf: row grouping, package GB

Merge-base `c0e5710d`. Method: baseline and current alternate in one process on the same seeded rows (`scripts/bench-sort.mjs --baseline-root`), median and MAD, 2 warm-ups, machine not idle (another lane ran in parallel). Rule: a grid that does not group is blocked when it is worse than the baseline by more than 3% and more than 2 MAD.

## Grids that do not group

`bench-sort`, 100k rows, 7 runs, ratio = baseline / current (above 1 is faster):

| Case | Current ms | Baseline ms | Ratio |
|---|---|---|---|
| 20 one-shot cases | 4.2 to 235.7 | 4.2 to 234.1 | 0.89 to 1.06 |
| number with NaN asc, repeated at 13 runs | 46.3 | 48.1 | 1.04 |
| number float asc, input sorted, repeated at 13 runs | 12.8 | 13.2 | 1.03 |
| dataset filter age, repeated at 13 runs | 4.6 | 4.6 | 1.00 |
| 2 keys text asc, int desc, repeated at 13 runs | 93.6 | 93.1 | 0.99 |

Three cases of the first pass sat past the rule (0.89, 0.93, 0.95, MAD 0.5 to 1.4 ms). Each came back to 0.99 to 1.04 at 13 runs: noise. `computeViewIndex` runs the same code for a grid without `groupBy`.

`bench-sort --live`, 100k rows, 9 runs, ms of main thread per second of updates:

| Case | Current | Baseline | Ratio |
|---|---|---|---|
| deferred, 10 x 100, sort column | 2.9 | 2.9 | 0.99 |
| immediate, 10 x 100, sort column | 26.5 | 26.0 | 0.98 |
| immediate, 1000 x 1, sort column | 793.8 | 796.2 | 1.00 |
| immediate, 1000 x 1, filtered, sort column | 817.2 | 834.5 | 1.02 |
| immediate, 1000 x 1, non-sort column | 195.3 | 193.3 | 0.99 |

Vitest budgets `view-index-perf`, `commit-perf`, `selection-perf`, `delete-perf`: pass. `perf.browser.test.tsx` (3 tests): pass under the browser lock. `perf-interaction.mjs` and `perf-scroll.mjs` did not run: the app does not build in a worktree (Turbopack refuses the `node_modules` junction).

## Grids that group

`bench-sort --grouped`, 100k rows, 2 levels (40 x 25 = 1,000 inner groups), 3 aggregates, sort on one column:

| Step | Measured | Test ceiling |
|---|---|---|
| Flat sort of the same rows | 5.5 ms | |
| Group build (leaf sort, buckets, aggregates) | 41 ms (range 28 to 56 on a busy machine) | 150 ms |
| Toggle one group (flatten the kept buckets) | under 0.1 ms | 8 ms |
| Expand all (flatten 100k entries) | 1.8 ms | 30 ms |
| Stream tick of 20 rows, column that is no group, sort, filter, or aggregate column | 0.182 ms, flat grid 0.186 ms | 1.5 times flat plus 5 ms |
| Stream tick of 20 rows on an aggregate column (touched groups only) | 1.98 ms | 8 ms |

At 1M rows the build takes about 900 ms: the leaf order is random against the data index, so every bucket read misses the cache. The target of 1.5 times the flat build plus 20 ms is not met at 100k rows (7.5 times, 41 ms against 5.5 ms): the build reads five columns and reduces each aggregate once per level. Upgrade path: reduce an outer group from the partial results of its children for the named reducers, and bucket by leaf position instead of data index.
