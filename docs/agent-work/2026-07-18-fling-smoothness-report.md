# Scroll smoothness at 100k under sustained fling — 2026-07-18

**Workplan item 44.** Measure-first lane against `/dev/benchmark`'s own driver (read-only yardstick),
prod build (`next build` + `next start -p 3011`; the user's :3000 and a pre-existing :3001 server were
never touched), headed Chrome, 100k rows.

## Executive summary

| Lever | Verdict | Why |
|---|---|---|
| 1. Commit strategy (rAF-align / coalesce) | **No action — no headroom exists** | Measured 1.00 scroll events and 1.00 commit batches per frame *already*. There is nothing to coalesce. |
| 2a. Lower the velocity-overscan cap | **Rejected** | Buys fps, but blank frames go 42 → 159 (cap 1000) → 231 (cap 600). Trades the grid's differentiating guarantee. |
| 2b. Deferred (post-paint) overscan commit | **Rejected** | Correct version costs *more* than baseline (69-91ms/frame vs 41ms): the critical/full window split makes rows churn in and out across the two commits. |
| 2c. `Intl.DateTimeFormat` construction per cell render | **Adopted** | Real waste removed. Paired A/B: **+1.11fps (+4.7%) on fling, 7/7 paired wins, t=10.78.** |
| 3. Row pooling | **Not attempted — gate not met on this evidence** | See "On row pooling" below: the premise the fallback was gated on did not survive measurement. |

**Headline honesty note:** the workplan's premise — gridcn 27.5fps fling vs MUI X 37.4 / rdg 47.2 /
TanStack 46.6 — did not reproduce in the shape it was written. The machine exhibits a **bimodal
per-browser-launch** fast/slow mode that affects *all four grids at once*, and it was not controlled
for in the original numbers. Controlled for, gridcn is at **~45fps fling vs ~60fps** for the other
three. The gap is real but roughly half the size the item assumed, and it is **not** caused by the
mechanism the item names (velocity overscan mounting ~44 rows + synchronous flushSync).

---

## 1. What the fling frame is actually made of

Attribution on a 240-frame fling tier at 100k rows (prod), before any change:

```
burst frames avg 29.98ms   settle frames avg 15.53ms
scroll events per burst frame      1.00
commit batches per burst frame     1.00
rows ADDED per burst frame        27.53
rows removed per burst frame      24.58
```

Two things follow immediately, and both redirect the lane:

**Lever 1 has no headroom.** The commit is already exactly one per frame. The item's "competitors
coalesce into deferred renders while gridcn flushSync's per scroll event" describes a cost that is
not being paid: the browser delivers one scroll event per frame at rAF cadence, and the store already
collapses row- + column-window updates into a single `flushSync`. rAF-aligning a thing that already
happens once per frame is a no-op.

**The cost is row mount/unmount turnover, and it is linear in it.** Sweeping sustained scroll speeds
(constant delta, so the estimator is pinned at cap in every row — window SIZE is constant at 65 rows,
only turnover varies):

| delta px/frame | rows added/frame | ms/frame | fps |
|---|---|---|---|
| 100 | 3.1 | 22.0 | 45.6 |
| 300 | 8.5 | 24.1 | 41.4 |
| 600 | 16.8 | 25.7 | 38.9 |
| 1200 | 33.3 | 31.8 | 31.4 |
| 1800 | 50.0 | 40.9 | 24.5 |

Slope ≈ **0.40ms per row mounted** (~0.05ms/cell at 8 columns), fixed floor ≈ 21ms. Note the window
size is identical (65 rows) in every row — so **window size is not the cost, turnover is**. This is
the single most important measurement in the lane and it is what makes 2a/2b the wrong shape.

The "fixed floor" is not grid cost. Isolating it:

| loop | ms/frame | fps |
|---|---|---|
| pure rAF, no scrolling | 16.7 | 60.0 |
| 2px/frame (below the row-change threshold → no commit) | 16.6 | 60.3 |
| 36px/frame (exactly 1 row/frame) | 18.5 | 54.1 |

At 2px/frame the grid holds a **full 60fps** — the zero-render CSS-var scroll path costs nothing
measurable. 100% of the deficit is row mount/unmount.

## 2. Blank-frame method and the baseline it establishes

Ported the instant-of-write sampling technique from `scroll-drag.browser.test.tsx`'s phase-0 harness
onto the **benchmark driver's own gesture shape** (burst→settle tiers, rAF-paced `scrollTop` writes,
no synthetic scroll dispatch): sample the DOM immediately after the write, before the browser's async
scroll task runs; count visible-range rows with no mounted element. 3 repeats/tier, first 3 ticks
exempt (documented first-tick concession). Script: scratch-only, not committed.

Baseline, and the constant every candidate was held against:

| tier | frames sampled | blank frames | worst missing rows | max mounted | settled rows |
|---|---|---|---|---|---|
| medium | 711 | 25 | 6 | 65 | 20 |
| fling | 711 | 42 | 17 | 65 | 20 |

**These are not visual blanks.** Characterizing all 14 events in a dedicated run:

- every event is at burst phase 0 or 1 — the first frames after a 15-frame settle;
- every event resolves within one frame (`missOneFrameLater: 0`);
- every event has **`gapPxAtWrite: 0`** — rows cover the whole viewport band; they show *stale*
  content for one frame rather than leaving an unpainted stripe.

This is exactly the documented first-tick concession: the settle resets the velocity estimator, so
the next burst's opening 1800px jump is unbuffered by design. It is a fixed property of the current
design, identical before and after the adopted change, and it is the bar the rejected candidates
were measured against.

## 3. Lever 2a — lower the overscan cap (REJECTED)

`VELOCITY_OVERSCAN_CAP_PX` swept, full build + restart + benchmark + blank detector per value:

| cap | medium fps | fling fps | medium blank frames | **fling blank frames** | max mounted |
|---|---|---|---|---|---|
| 1600 (current) | 32.2 | 23.3 | 24 | **42** | 65 |
| 1000 | 37.5 | 27.2 | 27 | **159** | 48 |
| 600 | 43.6 | 31.5 | 27 | **231** | 37 |

The fps gain is real and so is the price: **3.8x and 5.5x more blank frames at fling**. The cap's
existing doc comment already records that ~1500px is the measured floor for covering real thumb-drag
deltas; this sweep independently reproduces that. **Rejected** — this trades the no-blank guarantee,
which is the grid's stated differentiator, for fps. Reverted; the cap is untouched.

## 4. Lever 2b — deferred (post-paint) overscan commit (REJECTED)

The idea the mandate proposes, and it is a good one on its face: ~44 of the ~61 rows in a maxed-out
window are velocity buffer that exists to cover the *next* jump and is never painted on the frame it
mounts. So: commit the critical window (visible + base overscan) synchronously inside the scroll
event — which is what the no-blank guarantee actually rests on — and top the buffer up in a second,
non-blocking commit after paint.

Implemented as `computeWindow(..., velocityScale)` (0 = critical, 1 = full) plus a
`requestDeferredFlush` channel on the element store, tried with rAF-chained, `setTimeout`, and
`requestIdleCallback` scheduling.

**It does not work, and the measurement says why.** Frame cost with the split:

| variant | ms/burst frame | rows added/frame | commit batches/frame | settle collapse |
|---|---|---|---|---|
| baseline | 30.0 | 27.5 | 1.00 | 65 → 20 rows ✓ |
| deferred, rAF-chained | 69.3 | 27.5 | 1.00 | **stuck at 64** ✗ |
| deferred + settle fix (`commitVersion`) | 69.9 | 26.8 | 1.00 | 65 → 20 ✓ |
| deferred + idle scheduling | 71.1 | 27.4 | 1.00 | 65 → 20 ✓ |
| deferred, measured by commit-batch probe | 91.1 | 50.1 | 1.00 | — |

Same rows mounted, same one commit batch per frame, **2.3-3x the frame cost**. The mechanism: the
render path recomputes the critical window every render, so each tick the buffer rows the previous
top-up mounted are dropped and re-mounted — the split converts a single mount into a mount/unmount
cycle. It is a churn amplifier, and churn is precisely what §1 shows the cost is linear in.

A first pass appeared to show a large win (medium 53.9fps, fling 43.2fps, 2 long tasks). It did not
survive scrutiny: it had `settled rows: 64` — the window never collapsed after a scroll stopped,
breaking the tablecn settle-reset contract (`scroll-drag.browser.test.tsx`'s idle-DOM probe failed,
`expected 58 to be less than or equal to 14`). Fixing that correctness bug removed the apparent win
entirely, and the remainder of the apparent win was the launch-mode artifact of §6. **Rejected and
fully reverted** — `use-row-window.ts` is untouched at HEAD.

## 5. Lever 2c — `Intl.DateTimeFormat` per cell render (ADOPTED)

CPU-profiling the fling (CDP sampling profiler, 100μs interval) found real, addressable waste that
none of the structural levers would have touched:

```
40.8%  flushSync (the React commit — intrinsic)
 9.5%  appendChild
 6.5%  Cell
 6.4%  toDisplayText          <-- this
```

`date.tsx`'s `formatDateDisplay` constructed **a new `Intl.DateTimeFormat` on every date-cell
render**. `Intl` constructor cost is dominated by locale-data resolution; measured in isolation:

```
construct-per-call: 38.01us/call
cached formatter:    0.73us/call     (52x)
```

At ~28 newly-mounted rows/frame that is ~1.04ms/frame of pure waste, plus the GC pressure of
throwing away a formatter per cell. **Fix:** module-level cache keyed on `locale|JSON.stringify(format)`
— keyed by option *value*, not identity, because a column's `options` literal is commonly re-created
every render and would never hit an identity-keyed cache.

Post-fix profile: `toDisplayText` is **gone from the profile entirely**, `Cell` drops 6.5% → 0.05%,
GC 2.1% → 1.24%. What remains is browser DOM construction (`appendChild` 8.6%, `setAttribute` 3.0%,
`removeChild` 2.5%) — the irreducible cost of mounting rows.

### The honest size of this win

Naive before/after runs suggested medium 32→55fps and fling 23→45fps. **That comparison was invalid**
— it was sampling the two launch modes of §6, not the two code versions. Re-measured as a **paired
A/B**, alternating arms across launches, with the pre-fix behavior reinstated via an init script that
makes every cached formatter construct a fresh `Intl.DateTimeFormat` per `format()` call:

```
uncached  fps [23.6, 23.8, 23.7, 23.6, 23.4, 42.4]  median 23.7  longtasks [116,118,118,118,118,2]
cached    fps [24.9, 24.7, 24.8, 24.6, 45.0, 45.1]  median 24.9  longtasks [115,116,118,112,0,0]
```

Both arms are bimodal — the mode is a launch property, not the code. Restricting to paired
same-mode samples:

```
paired diffs (cached - uncached): 1.5, 0.6, 1.2, 1.1, 1.0, 1.2, 1.2
cached wins 7/7 | mean +1.11fps | sd 0.27 | t = 10.78 | relative +4.7%
```

**A real, reproducible, statistically solid +4.7%** — not the transformational win the uncontrolled
numbers implied. Adopted because it is free, removes genuine per-frame waste, costs no contract, and
is directionally certain (7/7 paired). Reported at its true size.

Blank frames after the change are **identical to baseline** (medium 27/711, fling 42/711, same worst-
missing, settled rows back to 20) — window sizing is untouched by this fix, as expected.

## 6. The measurement artifact that invalidates the item's premise

Repeated runs of the same build gave either ~24fps/~117 long tasks or ~45fps/~0 long tasks, with
nothing in between. Within a single page session results are perfectly stable (8 consecutive runs:
24.5-25.3fps, identical mount counts) — so the mode is fixed **per browser launch**.

It is not gridcn-specific. Running all four grids inside the same launch:

| launch | gridcn | mui-x | react-data-grid | tanstack |
|---|---|---|---|---|
| 0 | 24.6 (116 lt) | 46.0 (0) | 53.3 (0) | 60.0 (0) |
| 1 | 45.4 (0) | 59.8 (0) | 60.0 (0) | 60.0 (0) |
| 2 | 45.1 (0) | 60.0 (0) | 60.0 (0) | 60.0 (0) |

Launch 0 is slow for **every** grid. Any before/after comparison that does not pin or pair the launch
mode is measuring the mode, not the change — which is what happened to my own first two candidate
readings, and is the most likely explanation for the item's original 27.5-vs-37.4 framing.

**Methodological recommendation for future perf lanes in this repo:** compare candidates *paired
within a launch*, or report medians over ≥5 launches. Single-run before/after at this noise level is
not decodable. (This is the same failure mode the workplan already records for
`perf.browser.test.tsx`'s load-sensitivity, one level up.)

## 7. Benchmark comparison table (prod, 100k, all four grids)

Full-runner output, reproduced run (the runner's own driver and markdown shape):

| grid | mount ms | slow avg/%<30 | medium avg/worst/%<30 | fling avg/worst/%<30 | click→paint | heap mount/scroll/cycles | DOM | long tasks |
|---|---|---|---|---|---|---|---|---|
| gridcn | 0.0 | 60.0 / 0.0% | 54.2 / 33.0 / 0.8% | 45.4 / 21.2 / 7.5% | 32.0 | 33.2 MB / 58.9 MB / 107.4 MB | 1832* | 1 |
| mui-x | 0.0 | 60.0 / 0.0% | 60.0 / 45.9 / 0.0% | 60.0 / 47.2 / 0.4% | 33.1 | 173.3 MB / 164.5 MB / 149.1 MB | 585 | 0 |
| react-data-grid | 0.1 | 60.0 / 0.0% | 60.0 / 54.9 / 0.0% | 60.0 / 54.8 / 0.0% | 33.3 | 195.4 MB / 41.3 MB / 43.8 MB | 180 | 0 |
| tanstack | 0.0 | 60.0 / 0.0% | 60.0 / 53.3 / 0.0% | 60.0 / 51.0 / 0.0% | 33.0 | 303.6 MB / 335.2 MB / 1659.8 MB | 310 | 0 |

\* The 1832 DOM figure is a sampling artifact — DOM is counted after the remount cycles and caught a
still-wide fling window. Runs of the identical build measured 572 (and the settle trace confirms
collapse to 20 rows); gridcn's flat-572 DOM advantage is intact.

A same-session slow-mode run of the same build (for completeness, showing the artifact rather than
hiding it): gridcn medium 32.6 / fling 24.4 / 210 long tasks. Both are the same code.

**Reading it:** gridcn is at ~45fps fling against ~60 for the other three — behind, but roughly half
the gap the workplan assumed, and it keeps its wins: **least memory after scroll** (33-59MB vs
164MB / 335MB), **flat DOM count**, and the only grid with the no-blank guarantee. TanStack's
1.66GB after 5 mount/unmount cycles remains the standout outlier in the other direction.

## 8. On row pooling (lever 3) — not attempted, and why

The canvas-decision fallback gated row pooling on "a real-drag perf test showing the need". On this
evidence I do not think that gate is honestly met, for three reasons:

1. **The premise moved.** Controlled for launch mode, the gap is ~45 vs ~60fps, not 27.5 vs 37-47.
2. **The named mechanism is not the cost.** The item attributes the deficit to velocity overscan
   size + synchronous flushSync. Measured: commits are already 1/frame (lever 1 is a no-op), and
   window *size* is constant across a 2x fps swing while *turnover* explains it linearly (§1).
3. **Pooling's target is ~14% of samples.** After 2c, the remaining named cost is `appendChild`
   8.6% + `setAttribute` 3.0% + `removeChild` 2.5%. Pooling attacks the append/remove part; it
   cannot touch `flushSync`'s 33.8% reconciliation, and it would put the zero-render probes,
   subgrid pinned columns, overlay alignment, and a11y row semantics all at risk simultaneously —
   the four contracts the mandate lists as non-negotiable.

Recommendation: **do not open the pooling lane on this evidence.** If it is opened later, re-derive
the gate from paired-launch measurements first, and note that the highest-value remaining target is
React reconciliation cost per mounted row, not DOM node creation — which points at cheaper row/cell
render shape (fewer data-attributes, less `cn()` work per cell) before it points at pooling.

## 9. Contract verification

| Contract | Result |
|---|---|
| No-blank guarantee (quantified) | Medium 27/711, fling 42/711 blank frames — **identical to baseline** (25/42), same worst-missing profile, all 1-frame stale-content with zero painted gap |
| Settle collapse (tablecn 9f0200b) | 65 rows during scroll → 20 within ~200ms; `scroll-drag.browser.test.tsx` idle-DOM probe green |
| Zero-render / wasted-render probes | Green (`scroll-drag.browser.test.tsx`, 15/15) |
| Single-commit-per-tick probe | Green |
| Pin shadow | `pin-shadow.browser.test.tsx` green |
| Overlays / selection alignment | `overlays`, `pinned`, `presence`, `select-all` suites green |
| a11y row semantics | `a11y.browser.test.tsx` green |
| CI perf floors | **Unchanged — not lowered** (see gate note below) |
| `noUncheckedIndexedAccess` / documented casts | `tsc --noEmit` clean; no new casts introduced |
| No new deps | None added |

## 10. Gate results

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **clean**, exit 0 |
| `npx eslint .` | **0 errors, 25 warnings** (at the documented ~25 baseline; no new warnings from this lane) |
| `npx vitest run --project=unit` | **55 files, 1025 tests passed** |
| `npx vitest run --project=browser` | **23 files, 263 tests passed** |
| `node scripts/verify-registry.mjs` | **"All items match the filesystem."** |

**`perf.browser.test.tsx` note (load sensitivity, pre-existing).** In the full browser run this test
passed. Run in isolation afterwards it failed intermittently at `bestSwap` 12.3-12.9fps against its
15fps floor. Verified against a **clean checkout** (`git stash`, HEAD): it fails identically there,
5/5 runs, 12.6-12.9fps. This is the machine-load/launch-mode artifact DEVELOPMENT.md and the workplan
both already document for this test, reproduced here on unmodified code — **not** a regression from
this lane. Per the standing instruction the floor was **not lowered**. Interleaved with quiet-machine
runs the same test passed 5/8 isolated attempts on the working tree.

## 11. Files changed

- `registry/default/blocks/data-grid/cell-types/date.tsx` — module-level `Intl.DateTimeFormat` cache
  (`dateFormatterCache` + `getDateFormatter`), keyed by locale + serialized format options.
- `registry/default/blocks/data-grid/cell-types/cell-types.test.tsx` — 2 regression tests: formatter
  reuse across equal-but-not-identical options (the re-created-column-literal case), and cache
  correctness across differing locale/format combinations.

No changes to `windowing/`, `rows/`, `root.tsx`, `body.tsx`, `public/r/`, `app/dev/benchmark/`, or
`package.json`. Both rejected experiments were fully reverted. `registry.json` needs no change (no
files added or removed); `verify-registry` confirms clean.
