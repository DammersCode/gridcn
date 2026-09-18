# Deep performance audit — 2026-07-17

**Scope:** workplan items 9 + 9b. Goes beyond the render-count work already landed (row-level
subscription consolidation, velocity-overscan settle reset, `9f0200b`) to measure, not eyeball,
the grid's hot-path time complexity, allocation behavior, and retained-heap footprint, and to
re-adjudicate the `content-visibility: auto` idea the tablecn-comparison report flagged as a big
win with an unresolved regression.

Every number below is measured on this machine, this run — re-run the cited benchmark/script to
reproduce rather than trusting the number in isolation months later.

## Executive summary

| # | Item | Verdict | Numbers |
|---|---|---|---|
| 1 | Search-match-column derivation (`computeRowCellState`) | **Adopted** | 44.5ms → 1.5ms per 2000-tick/60-row-window simulation at 100k rows/8 cols with active search (**29x**) |
| 2 | `Uint32Array` for `viewIndex` at 100k rows | **Rejected** | build 16.9ms→14.9ms (marginal), random-access read 0.39ms→0.47ms (**20% slower**) — net loss |
| 3 | `Uint32Array` for `viewIndex` at 1M rows | **Rejected** | build 409ms→1004ms (**2.4x slower**, blocks the main thread on every sort/filter) despite reads becoming ~15% faster |
| 4 | Monomorphic `style` object shape in `cell.tsx` | **Rejected (measured, too small to matter)** | 12.2μs→7.9μs per 544-cell tick (35% faster) but ~4μs/tick against a 16,600μs frame budget — not worth the API change |
| 5 | Per-tick allocations in `use-row-window.ts` (`readSnapshot`/`computeWindow`) | **No action — confirmed negligible** | 0.099μs/tick; unmeasurable against the frame budget even at fling tick rates |
| 6 | Clipboard `serializeCells` at realistic bulk-copy scale | **No action — algorithmically optimal already** | 100k×1 col: 84ms; 100k×8 col (select-all): 332ms — one-shot user-triggered cost, not a per-frame cost, already O(cells) with no better bound |
| 7 | `content-visibility: auto` on rows (9b revisit) | **Rejected — real bug found, not a probe artifact** | Row's `subgrid` column tracks collapse to an even fractional split while content-visibility's implied `contain: size` is active — a genuine ~32px/40px CSS layout displacement of pinned body cells, confirmed via direct rect measurement, not fixable with `contain-intrinsic-size` |
| 8 | Retained-heap profile (10/1k/100k/1M rows) | **Measured, clean** | See heap table below — no leak signal across 5 mount/unmount cycles in a production build |
| 9 | UI-visibility sweep (workplan 8 remainder) | See separate section below | |

---

## 1. Hot-function complexity census

| Function | File | Complexity | Notes |
|---|---|---|---|
| `computeWindow` (row window per scroll tick) | `windowing/use-row-window.ts` | O(1) | Pure arithmetic (`scrollTop / rowHeight`), no scan. Velocity estimator is O(1) per tick (`updateVelocityEstimate`). |
| `computeIndices` (column window per scroll tick) | `windowing/use-column-window.ts` | O(log n) for the band boundaries (binary search via `findFirstIndexPast`/`findLastIndexAt`), O(pinned columns) to always include pins | Already optimal; pinned-column counts are small by construction. |
| `useRowWindow`/`useColumnWindow` commit gating | `windowing/use-row-window.ts` (`ElementStore`) | O(listeners) per tick | One `flushSync` per tick regardless of listener count — already collapsed, not a scan concern. |
| `selectionContainsCell` (single-cell selected? check) | `selection/selection-contains-cell.ts` | O(rangeStack size) | Called once per active-cell-style single lookup, not per row/cell in a loop — rangeStack is small (user-driven ctrl-click count). No action needed. |
| `selectedColRangesForRow` (per-row column-range membership) | `selection/selected-col-ranges-for-row.ts` | O(rangeStack + selection.columns) merge-insert per row | Already collapses to a handful of `[start,end)` tuples instead of a per-column boolean/Set — good design, no better bound exists for arbitrary rect selections. |
| `CompactSelection.hasIndex`/`hasAll` | `selection/compact-selection.ts` | O(slice count), early-exit on `index < s` since slices are sorted | Already RLE + sorted; slice count is bounded by selection fragmentation, not row count. |
| `computeRowCellState` (search-match columns) | `store.tsx` | **Was O(visibleColumns) per row per tick with a string-key `Set.has`; now O(1) map lookup** | **Fixed this audit — see §2.1 below.** |
| `serializeRect`/`serializeCopyScope` (clipboard copy) | `clipboard/use-grid-clipboard.ts` | O(rect.height × rect.width) | Optimal — every selected cell must be visited exactly once to serialize it. Measured at realistic bulk scale in §2.3. |
| `serializeCells` (TSV/HTML escaping) | `clipboard/serialize-cells.ts` | O(total cell chars) via chained `.replace()` | Regex-based, already minimal per cell; no better algorithmic bound. |
| `buildViewIndex` (sort + filter) | `sort-filter/build-view-index.ts` | Filter: O(n × filters) (AND) or O(n × filters) (OR, single pass); Sort: O(n log n) with **decorate-sort-undecorate** (one `getText` per row per column, not per comparison) + one shared `Intl.Collator` | Already well-optimized — the doc comments call out both amortizations explicitly and they're real (verified by reading, not just trusting the comment). |
| `findSearchMatches` (quick-search scan) | `sort-filter/find-search-matches.ts` | O(n × searchColumns), with an early-exit `maxMatches` cap (1000) | Already bounded; the cap exists specifically for 100k+ row worst-case (a common substring matching most rows). No further win available without giving up completeness. |
| `generateFill`/`detectSeries` (fill-drag) | `fill/generate-fill.ts`, `fill/detect-series.ts` | O(source + target) for series detection/generation | Target size is a user drag gesture (visible rows), inherently small. No action needed. |
| `distributeFlexWidths` (column layout) | `columns/resolve-column-width.ts` | O(columns) per pass, early-exit to `return baseWidths` unchanged when no flex columns | Column counts are bounded (tens, not thousands) — not a scaling concern at any realistic column count. |

### 1.1 Adopted fix: O(1) search-match-column lookup

**Before:** `computeRowCellState` (`store.tsx`) looped over every visible column for every row, on
every store notification while a search was active, building a string key (`"${row}:${columnId}"`)
and checking `searchMatchSet.has()` — O(rows_in_window × columns) per tick.

**After:** `computeSearchMatches` now also builds `searchMatchRows: ReadonlyMap<number,
ReadonlySet<number>>` (view row → matched column indices) once, at the same point it already builds
`searchMatchSet` (on `setSearch`/`_syncProps`/`setSorts`/`setFilters` — never per row-read).
`computeRowCellState` does a single `Map.get(viewRow)` instead.

**Measured (100k rows, 8 columns, ~1% cell match rate, 2000 ticks × 60-row window — the realistic
per-tick shape during a scroll with an active search):**

```
current (per-row linear scan + string-key Set.has): 44.49ms total, 44.4931ms/iteration
candidate: buildRowMatchIndex (once per search change): 0.20ms total
candidate: Map.get lookup per tick: 1.32ms total
candidate total (build once + 2000 lookups): 1.53ms vs current 44.49ms
speedup: 29.2x
```

This only matters while a search is active AND the grid is being scrolled/interacted with (every
other store notification skips the branch entirely, `searchMatchRows` being empty). It's a real
fix for a real, previously-uncensused hot path, at a scale (100k rows) explicitly in scope.

**Files changed:** `registry/default/blocks/data-grid/store.tsx` — added `searchMatchRows` field to
`DataGridStoreState`, `buildSearchMatchRows()` helper, wired into `computeSearchMatches()`'s return
and the `_syncProps` unchanged-reuse branch, and simplified `computeRowCellState`'s search-match
branch to a single map lookup. `searchMatchSet` (the existing O(1) single-cell string-key lookup
used by `useDataGridIsSearchMatch`) is untouched — it's already O(1) per cell and not the function
this fix targets.

**Tests:** existing `test/store-search-perf.test.tsx` (5 tests) and `store.tsx`'s own unit tests
(96 total in the two files) pass unchanged — no test needed updating because `searchMatchRows` is
purely an internal derivation with the same externally-observable `searchMatchCols` behavior.

---

## 2. Allocation / monomorphic-shape audit

### 2.1 Rejected: monomorphic `style` object shape in `cell.tsx`

`DataGridCellImpl` builds its `style` object as `{ gridColumnStart, ...pinnedInsetStyle(...) }` then
conditionally adds `zIndex` — up to 4 distinct object shapes depending on pinned/active state
(`pinnedInsetStyle` itself returns either `{}` or `{position, insetInlineStart}`, a second source of
shape polymorphism). Measured a monomorphic alternative (every field always present, `undefined`
when unused) at realistic full-swap cell counts (544 cells/tick, workplan's own React Scan capture
count, 500 ticks):

```
current (conditional shape, {} spread): 6.08ms total, 12.17us/tick
monomorphic (always-present fields, undefined when unused): 3.97ms total, 7.94us/tick
```

35% faster in isolation, but the absolute saving is ~4.2μs/tick against a 16,600μs (60fps) frame
budget — three orders of magnitude below the noise floor of anything that actually matters for
frame timing. **Rejected**: the code-clarity/API cost of forcing every CSS property to always be
present (with the attendant risk of an `undefined` value behaving unexpectedly for some CSS
property in some browser) isn't justified by a saving this small. Documented per the workplan's
"adopt only measured wins" rule — this is the negative-result case, not a false lead.

### 2.2 Confirmed negligible: per-tick allocations in `use-row-window.ts`

`readSnapshot`, `computeWindow`, and their column-window counterparts each allocate one small object
per scroll tick — not per cell, per tick. Measured at 10,000 simulated ticks (already an order of
magnitude more than one real scroll gesture would produce):

```
readSnapshot + computeWindow per tick: 0.988ms total / 10000 ticks = 0.099us/tick
```

At a sustained 120-tick/sec fling this is ~12μs/sec of a 1,000,000μs/sec budget. Object pooling or
reuse here would add real code complexity (mutable shared objects instead of pure functions
returning fresh immutable snapshots — the exact pattern the existing doc comments in
`use-row-window.ts` explicitly rely on for correctness, e.g. `snapshotsEqual`'s reference-independent
comparison) to eliminate an unmeasurable cost. **No action taken.**

### 2.3 Confirmed no better bound: clipboard `serializeCells` at bulk scale

Measured a full-column copy (100,000 rows × 1 column — a real "click header, Ctrl+C" gesture) and a
full-grid select-all copy (100,000 rows × 8 columns) through the real escaping pipeline
(`serialize-cells.ts`'s regex chains for TSV quoting + HTML entity/whitespace escaping):

```
serializeCells: 100.000 cells (1 column) -> 83.6ms
text payload: 2332.9KB, html payload: 8083.8KB

serializeCells: 100.000 cells x 8 cols (select-all) -> 332.1ms
```

This is a one-shot, explicitly user-triggered action (Ctrl+C), not a per-frame or per-scroll cost —
a 330ms block on a bulk select-all copy is a UX blip, not a regression, and is already algorithmically
O(cells) with no better bound possible (every selected cell's text must be visited and escaped
exactly once to build the clipboard payload). **No action taken** — flagged here only because the
workplan named clipboard serialize explicitly in the census scope.

### 2.4 `Uint32Array` for `viewIndex` — measured at 100k (workplan-requested) and 1M (PLAN §4.6's own threshold)

`viewIndex: number[]` is rebuilt by `buildViewIndex`'s decorate-sort-undecorate pattern on every
sort/filter change, and read randomly on every row-window commit (`data[viewIndex[i]]`). PLAN §4.6
already flags `Uint32Array` as worth evaluating above 1M rows; the workplan asked to measure at
100k too rather than assume the flag's threshold is exactly right.

**100k rows:**
```
build number[]: 169.05ms total, 16.9050ms/iteration
build Uint32Array: 148.54ms total, 14.8537ms/iteration
read via number[]: 1.96ms total, 0.3918ms/iteration
read via Uint32Array: 2.37ms total, 0.4737ms/iteration
```
Build is marginally faster (dominated by the sort itself, not the array representation); random
reads are **~20% slower** with `Uint32Array` (V8's typed-array element access has function-call-like
overhead per read vs a plain tagged-pointer array read, at this element count the gap doesn't close).
Memory saved: ~390KB (781KB → 391KB) — negligible next to the tens-of-MB grid footprint measured in
the heap table below. **Net rejection at 100k**: no dimension wins meaningfully, one dimension
(reads, the actually-hot path) measurably regresses.

**1M rows:**
```
build number[]: 4094.64ms total, 409.4636ms/iteration
build Uint32Array: 10041.16ms total, 1004.1163ms/iteration
read via number[]: 27.80ms total, 5.5604ms/iteration
read via Uint32Array: 23.61ms total, 4.7215ms/iteration
```
Reads become ~15% faster at this scale, but **build is 2.4x slower** (1004ms vs 409ms) — the extra
copy-out pass from the decorated intermediate array into the typed array dominates at 1M elements.
A full second of main-thread blocking on every sort/filter application is a worse regression than
the read-side win offsets, especially since `TypedArray.prototype.sort()` is not stable and can't
carry a position tiebreaker inline, so the decorate-sort-undecorate step (and its copy-out cost) is
unavoidable for either representation under the existing stable-sort contract.

**Rejected at both scales.** PLAN §4.6's own "evaluate above 1M" framing turns out to still be a
rejection once actually measured with the real decorate-sort-undecorate shape (not a synthetic
sort) — the win exists in principle for pure random-access read-only workloads, but `viewIndex` is
not read-only: it's rebuilt on every sort/filter, and that rebuild cost dominates.

---

## 3. Heap-profile script + retained-heap numbers

New opt-in script: **`scripts/heap-profile.mjs`**, wired as **`npm run perf:heap`** (not in CI, not
referenced by any test/gate). Uses Playwright + raw CDP (`HeapProfiler.takeHeapSnapshot`,
`HeapProfiler.collectGarbage`) against the `/dev` page's already-running dev server (`GRIDCN_DEV_URL`
env var overrides the default `http://localhost:3000/dev`). Drives the page's own row-count
`<select>` (`1,000 / 100,000 / 1,000,000` — the `/dev` page's `ROW_OPTIONS`; the workplan's
"10 rows" floor isn't a selectable option there, so 1,000 is the smallest tier actually measurable
without modifying the dev page) and its `key={rowCount}`-forced remount for clean mount/unmount
cycles. For each row count it snapshots: after mount, after a 60-tick scroll burst (irregular
733px stride to avoid resonating with row height), and after 5 full mount/unmount cycles (leak
check). Snapshot bytes are summed from the raw `.heapsnapshot` node table (`self_size` per node) —
no full graph-parser dependency, chunks are joined once (not `+=`'d) to survive the ~1GB string
length ceiling at 1M rows.

**Important methodology note:** the first run was against the (already-running, per the task's own
constraint) **dev-mode** server and showed alarming mount-cycle deltas (+272% at 1k rows, +204% at
100k). Investigating before trusting the number: `next.config.mjs` has `reactStrictMode: true`
(double-invokes effects), the `/dev` page itself lazy-imports and enables `react-scan` in a
`useEffect` (`app/dev/page.tsx:329`, an instrumentation library that hooks every fiber commit and
keeps its own history), and Next dev/Fast Refresh maintain growing module-registry state across a
session independent of the grid's own behavior — all dev-only confounds unrelated to the grid's
production memory behavior. Built and profiled against a **production build** instead
(`next build && next start -p 3099`, a separate port so the user's dev server on :3000 was never
touched or restarted) for the numbers below, which are clean:

| Rows | After mount | After scroll burst | After 5 mount/unmount cycles | Mount-cycle delta |
|---|---|---|---|---|
| 1,000 | 13.70MB | 16.24MB | 14.88MB | +1.18MB (8.6%) |
| 100,000 | 29.82MB | 32.65MB | 31.28MB | +1.46MB (4.9%) |
| 1,000,000 | 179.88MB | 182.54MB | 180.53MB | +0.65MB (0.4%) |

**Reading:** retained heap scales sub-linearly with row count (13.7MB → 29.8MB → 179.9MB for a
1,000x → 1,000,000x row increase — the windowed-rendering architecture is working as intended,
retained heap tracks the rendered window plus the `data` array itself, not a per-row DOM/fiber
cost). The mount-cycle delta **shrinks in relative terms as row count grows** (8.6% → 4.9% → 0.4%)
and stays under 1.5MB absolute at every scale across 5 full mount/unmount cycles — no leak signal
(a real per-cycle leak would show constant or growing absolute megabytes per cycle, compounding
linearly with cycle count; this doesn't). The small positive delta that remains is consistent with
one-time JIT/lazy-module costs (first mount pays compilation costs later cycles don't re-pay) rather
than an accumulating leak, but this script only ran 5 cycles as scoped — a longer soak (50+ cycles)
would be the next escalation if a future regression report suggests otherwise.

**Not run:** a matched dev-mode comparison table (would require documenting react-scan's own
retained-instrumentation-state as a separate confound, out of scope for this audit) — the production
numbers above are the trustworthy ones and are what's reported.

---

## 4. Content-visibility revisit (9b) — rejected, real bug found

Delegated to a focused subagent for root-cause isolation (revert-before-finish, no registry
changes retained). Full finding:

**The tablecn-comparison report's 32px painted-pixel offset is a real layout bug, not a probe
artifact and not a benign uniform shift.** `content-visibility: auto`, while an element is in the
browser's "skipped contents" state, implies `contain: size layout style paint` on that element (per
the CSS Containment / content-visibility spec). gridcn's row (`row.tsx`) uses
`gridTemplateColumns: "subgrid"` — a subgrid axis cannot be independently size-contained, since its
track sizes are defined by the *parent* grid, not local content. Chromium's fallback when this
conflict occurs is to treat the row as a standalone/implicit grid instead, splitting its own
children's tracks evenly rather than inheriting the true per-column widths from `body.tsx`'s
`template`.

Instrumented directly (2 columns, pinned "id" 120px + "email" 200px, total 320px):

| | Header row `gridTemplateColumns` | Data row `gridTemplateColumns` | Pinned body cell rect (`right`) | Pinned header cell rect (`right`) |
|---|---|---|---|---|
| Baseline | `120px 200px` | `120px 200px` | 121 | 121 (match) |
| With row-level `content-visibility: auto` | `120px 200px` (headers never virtualize/skip) | **`160px 160px`** | **161** | 121 (**40 CSS px drift ≈ 32 device px at the test's DPR**) |

Header and body genuinely disagree with each other post-change — this rules out the "benign global
shift, fix the probe" theory (a uniform shift would keep header/body in agreement, just both
differing from an old expectation; they don't agree here, which is the definition of a real bug).
The shadow itself is correctly anchored throughout (it measures header cells, which never change) —
it's the pinned **body** cell underneath that visibly moves.

**Remediation attempts (both rejected):**
- **`contain-intrinsic-size` hint** (tried `auto 36px`, matching the `default` density row height):
  does not fix it. This property only supplies the row's *placeholder outer box* size while skipped
  — it has no effect on how the row's *internal* subgrid tracks resolve, so it can't override the
  containment-vs-subgrid conflict.
- **Scoping `content-visibility` off pinned-adjacent rows / excluding pinned cells from the c-v box:**
  not structurally feasible. Pinned cells are plain sibling children of the same row `<div>` as
  unpinned cells (`row.tsx`), positioned via `position: relative` + calculated `insetInlineStart`
  (`columns/pinned-inset-style.ts`) — not a separate wrapper element or separate row. There is no
  DOM boundary corresponding to "the row minus its pinned cells" to attach or withhold
  `content-visibility` from without a much larger structural change (splitting each row into
  multiple column-range-spanning elements — a different architecture, not a scoping tweak).

**Why tablecn's version of this technique doesn't transfer:** tablecn's rows use plain flex
children, not CSS Grid subgrid (confirmed in the original comparison doc's "Scroll handling"
section) — the conflict is specific to gridcn's subgrid-based column-alignment architecture, which
is itself a deliberate, valuable design (it's what keeps header/body columns perfectly aligned
without per-cell width duplication). Adopting `content-visibility: auto` on rows as proposed would
trade a real, measured fps win for a real, user-visible pinned-column misalignment bug — not
acceptable under the workplan's own "ALL suites pass" gate for adoption.

**Verdict: rejected as currently scoped.** If the fps win is still wanted in the future, it would
require replacing subgrid-based row layout with per-cell absolute/inline positioning driven by the
already-computed `layout.trackLefts`/`trackRights` values (`layout-context.ts`) — a real
architecture change with its own design doc and full perf-suite re-verification, not a same-day
follow-up to this audit. No code changes were made to pursue this; recommend treating candidate #1
from the original comparison doc (the velocity-overscan settle reset, already landed in `9f0200b`)
as the correct scope boundary for this cycle.

**Cleanup verified:** the investigating subagent confirmed `git status --porcelain -- registry/
public/r/` was empty after its work, and the real `pin-shadow.browser.test.tsx` suite (4 tests)
passes at HEAD.

---

## 5. UI-visibility sweep (workplan 8 remainder)

Swept via a dedicated subagent using the `agent-browser` harness against the already-running dev
server (`http://localhost:3000/dev` + `/dev/examples`), at 1280px/800px × light/dark for all 7
surfaces named in the workplan. No node process was started, stopped, or restarted by the sweep.

| Surface | 1280 light | 1280 dark | 800 light | 800 dark | Notes |
|---|---|---|---|---|---|
| Toolbar | PASS | PASS | PASS | PASS | No wrapping/clipping. |
| Sort-list button + popover | PASS | PASS | PASS | PASS | Add/remove, up/down reorder (correctly disabled at list ends), badge count, Clear all all verified. Lives on `/dev/examples`' dedicated demo, not the main `/dev` toolbar — expected, it's an opt-in add-on. |
| Filter popover (AND/OR join + `isBetween`) | PASS | PASS | PASS | PASS | Item-8's fix holds — `isBetween`'s two side-by-side spinbuttons are never starved, including with German labels active at 800px. |
| Columns menu | PASS | PASS | PASS | PASS | |
| Import dialog | PASS | PASS | PASS | PASS | Mapping-step grid is intentionally horizontally scrollable when source columns overflow — by design (882740c), not a bug. |
| Export dialog | PASS | PASS | PASS | PASS | |
| Context menu + header dropdown | PASS | PASS | PASS | PASS | |
| Keybindings dialog | PASS | PASS | PASS | PASS | Long shortcut list fits without dialog overflow. |
| Pagination footer | PASS | PASS | PASS (after fix) | PASS (after fix) | See fix below. |

**Fix made (add-on lane):** `registry/default/blocks/data-grid-pagination/pagination-footer.tsx` —
added `flex-wrap` to the footer's outer row and its inner controls group. Root cause of the initial
800px-clipping screenshot was actually a false positive (an unrelated demo section on the same
`/dev/examples` page was forcing page-wide horizontal scroll, skewing the footer's own measurement);
isolated, the footer already fit at 800px with no change needed. The `flex-wrap` addition was kept
anyway as safe, zero-regression defensive hardening for consumers who embed the footer in a
genuinely narrow container or with long page-size labels — confirmed pixel-identical at 1280px
before/after, and all 5 existing `pagination-footer.browser.test.tsx` tests still pass.

**Content gap noted, not fixed (outside add-on-lane authority — dev-page demo content, not a
component file):** `app/dev/page.tsx`'s `GERMAN_LABELS` override has no translation for the newer
`isBetween` filter-operator key, so it falls back to English inside an otherwise-German popover.
Cosmetic content gap, not a layout regression.

**Core-lane issues found:** none. No breakage in `registry/default/blocks/data-grid/` (core) across
any of the 7 surfaces at any width/theme combination.

---

## 6. Gate results

All run on this machine, this session, with the adopted fixes (§1.1, `store.tsx`) and the
UI-sweep's pagination-footer fix (§5) both in the working tree.

```
npx tsc --noEmit
  -> clean, no output, exit 0

npx vitest run --project=unit
  Test Files  54 passed (54)
       Tests  988 passed (988)

node scripts/verify-registry.mjs
  All items match the filesystem.

npx vitest run --project=browser
  Test Files  19 passed (19)
       Tests  230 passed (230)
```

**Perf suite isolated 3x** (`perf.browser.test.tsx` alone, per the gate's explicit instruction):

```
Run 1: 1 passed (1)
Run 2: 1 passed (1)
Run 3: 1 passed (1)
```

**Load-sensitivity note (matches the workplan's own standing follow-up):** earlier in this session,
`perf.browser.test.tsx`'s `bestSwap >= 15fps` assertion failed intermittently (measured
13.6-13.8fps) while a concurrent UI-sweep subagent was driving heavy `agent-browser`/Playwright
automation on the same machine. Isolating the test file reproduced the failure identically against
BOTH the pre-fix and post-fix `store.tsx` (confirmed via `git stash`), and a temporary local
production server this audit had started on port 3099 (now stopped) added further load —
conclusively a machine-load artifact, not a regression from any change in this audit. Once that
load cleared, 3/3 isolated runs and 2 full-suite runs (19/19, 230/230 each) passed cleanly. Per the
workplan's explicit instruction ("do NOT lower floors"), the floor was left untouched — this section
records the transient failure honestly rather than silently omitting it.

---

## Files changed this audit

- `registry/default/blocks/data-grid/store.tsx` — `searchMatchRows` field + `buildSearchMatchRows()`
  + `computeRowCellState` O(1) lookup (adopted fix, §1.1).
- `scripts/heap-profile.mjs` — new opt-in heap-profile script (§3).
- `package.json` — added `"perf:heap": "node scripts/heap-profile.mjs"` script entry.
- `registry/default/blocks/data-grid-pagination/pagination-footer.tsx` — defensive `flex-wrap`
  hardening from the UI-visibility sweep (§5; add-on lane, not core).
- No registry.json changes needed (`scripts/` is outside the registry item tree;
  `node scripts/verify-registry.mjs` confirmed clean).
- No changes retained from the content-visibility investigation (rejected, reverted by the
  investigating subagent).
