# Incremental sort maintenance — cheap `reorder: "immediate"` (workplan #78)

User go (2026-08-01) with one hard condition: "as long as we don't break the sorting."
Correctness is the acceptance bar, speed is the goal. The streaming spec parked this as risk 4;
it is now promoted with the risk addressed head-on.

## Problem

`reorder: "immediate"` on `updateCells` pays the full `buildViewIndex` — ~26ms at 100k rows
(decorate-sort-undecorate incl. Intl.Collator) — even when one row moved. Target: O(k log n)
for k patched rows, so auto-sort streaming is cheap at any scale.

## Approach

When an `updateCells` batch runs with `"immediate"` (or `reconcileView` resolves a small
deferred set) and an incremental path is SAFE (see fallbacks), do per touched row:
1. Remove the row from its current position in the view order.
2. Re-test filter membership (a value change can add/remove the row from the filtered set —
   this is part of the job, not an edge case).
3. Binary-search its new position with the SAME comparator chain the full rebuild uses
   (multi-column sort keys, collator, direction) and reinsert.

Tiebreak stability: the full rebuild breaks ties by original data index
(decorate-sort-undecorate). The incremental path must use the IDENTICAL tiebreak — compare
(sortKeys..., dataIndex) — so a reinserted row lands exactly where the full rebuild would put
it, not merely somewhere order-equivalent. This is what "don't break the sorting" means
mechanically: bit-identical viewIndex, not just sorted-looking.

## Fallbacks (safety valves — correctness beats cleverness)

- Patch count above a threshold (measure the crossover; expect k where k log n ≈ n log n /
  const): full rebuild.
- Anything the incremental path cannot prove it handles (unknown comparator edge, sort/filter
  state changed in the same tick, search active recompute needs): full rebuild.
- The full rebuild path stays untouched and remains the reference implementation.

## Correctness proof (the acceptance bar)

1. EQUIVALENCE FUZZ TEST: randomized sequences (hundreds of iterations) of patches ×
   {sorted asc/desc, multi-column, filtered, collator strings, duplicate sort values} —
   after every step, incremental viewIndex must be ELEMENT-IDENTICAL to a from-scratch
   buildViewIndex on the same state. Any mismatch fails the suite.
2. Dev-mode assertion (sampled or gated) re-deriving the full index and comparing — the same
   guard style as the rowId-map's diffRowIndex.
3. Targeted unit cases: duplicate values (tiebreak), row enters/leaves filter via patch, row
   moves to first/last position, patch on a non-sort column (no move), k=all rows (fallback
   triggers).
4. All existing sort/filter/streaming suites stay green untouched.

## Perf targets

100k rows, prod, paired in-launch: `"immediate"` single-row patch ≤1ms (today ~26-30ms);
20 scattered rows ≤2ms; the fallback threshold documented with its measured crossover.
The `"defer"` path stays bit-identical in behavior and cost.

## Docs

streaming-updates.mdx: the "immediate costs ~30ms" caveat updates to the new numbers; the
auto-sort switch section drops its cost warning if the measured result supports it.
Register row updates. NO CHANGELOG (paused).
