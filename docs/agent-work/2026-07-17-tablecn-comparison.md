# gridcn vs tablecn — Rendering/Perf Comparison

**Date:** 2026-07-17
**Scope:** workplan item 14 — investigate why github.com/sadmann7/tablecn (MIT, Sadman Sakib)
feels smoother than gridcn at the same row count, with fewer FPS drops. Investigation + report
only; no gridcn source changed.

**Source:** tablecn cloned at `--depth 1` into a temporary local scratchpad (now also
available at `references/tablecn`, gitignored), commit at clone time,
license confirmed MIT (LICENSE.md, "Copyright (c) 2024 Sadman Sakib"). Its comparable
component is `src/components/data-grid/` (a *separate*, newer "data-grid" surface alongside its
older `data-table`), demoed at `src/app/data-grid/page.tsx` with a 10,000-row faker-seeded
dataset (`src/app/data-grid/lib/seeds.ts:167`, `Array.from({ length: 10000 }, ...)`) — there is
no 100k-row demo anywhere in the repo. `pnpm install` succeeded in 2m17s; `next dev -p 3001`
required a dummy `DATABASE_URL` env var (its `src/env.js` zod-validates env at config load even
for a page with no DB dependency) but otherwise ran unmodified.

## Executive summary

1. **Fixed, generous overscan (6 rows) + TanStack Virtual's mature commit-gating** vs our
   **overscan=1 + a velocity estimator that ramps up during a fling and decays slowly
   afterward** — ours renders far more rows than needed during and immediately after a fast
   scroll (measured: 12→59 DOM rows, 377 mounts/330 unmounts over one 2s medium-speed scroll,
   vs tablecn's 20→26 rows, 181/182 mounts, same test). This directly reproduces the workplan's
   "416 cell / 127 row renders" React Scan capture — it's real, not a synthetic artifact.
2. **CSS `content-visibility: auto` on every row** (`data-grid-row.tsx:214`) — the browser skips
   layout/paint/style for off-screen rows *at the CSS level*, on top of virtualization. We rely
   entirely on JS virtualization; we have zero `content-visibility` usage in the grid.
3. **Fixed row height in gridcn vs measured (variable) row height in tablecn** — this cuts the
   *other* way: tablecn's `measureElement` calls `getBoundingClientRect()` per mounted row per
   commit (real layout cost tablecn pays and we don't), which is why tablecn is NOT strictly
   faster everywhere (see Measured Numbers — tablecn degrades earlier under large synthetic
   jumps). Our fixed-height model is a genuine structural advantage we should not give up.

**Row pooling?** No. tablecn does not recycle row DOM/fiber. It uses `@tanstack/react-virtual`
(`useVirtualizer`), which — like our own windowing hooks — mounts/unmounts row components as the
window shifts; rows are absolutely positioned (`transform: translateY`) and keyed by row id via
normal React reconciliation, the same mount/unmount-at-the-edges model we use, just tuned with a
much larger static overscan and lighter per-commit React work. The row-pool idea (canvas-pivot
fallback, imperative content-swap into a fixed DOM pool) is **not what tablecn does** — it is not
the source of tablecn's smoothness. This is an important negative result for workplan item 14's
"evaluate row pooling against tablecn's approach" ask: there is nothing to benchmark against,
because tablecn didn't build it.

**Top adoption candidate:** tame the velocity-overscan decay (#1 below) — same category of fix
already planned in the architecture spec's Phase 4, but currently under-tuned (window balloons to
5x its resting size and doesn't shrink back promptly). Expected win: cuts per-tick row-mount
count roughly in half at fling speed, directly targets the React Scan evidence, no architecture
change, testable with the existing Phase 0 real-drag harness.

## Per-dimension findings

### Virtualizer

| | gridcn | tablecn |
|---|---|---|
| Library | Custom (`windowing/use-row-window.ts`, `use-column-window.ts`) | `@tanstack/react-virtual@^3.14.2` (`useVirtualizer`) — battle-tested, ~3 years of production hardening across the ecosystem |
| Row height model | **Fixed** per density preset (28/36/44px, `rows/density.ts`) — pure arithmetic, `start * rowHeight` | **Measured** (`estimateSize: () => rowHeightValue` then corrected via `measureElement`, `use-data-grid.ts:2325-2341`) — costs a `getBoundingClientRect()` per row per commit on Chrome/Chromium (skipped on Firefox: `measureElement: !isFirefox ? ... : undefined`) |
| Column virtualization | Yes — `use-column-window.ts`, binary-search windowed columns, pin-aware | **None.** tablecn renders every column for every visible row; no horizontal windowing. Its cell tree is therefore simpler in this one dimension when column count is small (its demo: ~7 columns) but would not scale the way our column-window does at 50-200 columns (workplan's own col-count dev control). |
| Overscan | `overscan=1` baseline, **velocity-adaptive** up to `VELOCITY_OVERSCAN_CAP_PX = 1600px` worth of rows during a detected fling, decaying 0.5x/tick afterward (`use-row-window.ts:337-371`) | **Fixed `overscan = 6`** (`use-data-grid.ts:50`) rows on every side, always — no velocity logic at all |
| Commit gating | Custom: shared `ElementStore` per scroll element, `requestFlush` collapses row+column window updates into one `flushSync` per tick (`use-row-window.ts:100-224`) | TanStack Virtual's own internal commit scheduling (opaque to us, but mature/widely-verified) |

Files: ours — `registry/default/blocks/data-grid/windowing/use-row-window.ts`,
`windowing/use-column-window.ts`, `rows/density.ts`. Theirs —
`src/hooks/use-data-grid.ts:2325-2341` (virtualizer config), `package.json:45`.

### Scroll handling (transform vs offset, DOM shape)

Both use the same fundamental technique — absolutely/fixed-positioned rows moved by
`transform: translate`, not `top`/`left` reflow:

- Ours: rows sit in a CSS Grid canvas (`display: grid`, `gridTemplateColumns: "subgrid"` per
  row), the whole canvas is `position: absolute` and moved by one `translate3d(...)` that also
  cancels native scroll (MUI "controlled virtualizer" pattern) — `body.tsx:169-181`. `gridRowStart`
  is written imperatively via `useLayoutEffect` straight to `style.gridRowStart`, bypassing React,
  specifically so `DataGridRow`'s memo isn't defeated by a per-tick prop (`body.tsx:157-167`,
  documented at length in `row.tsx`'s doc comment).
- Theirs: each row is `position: absolute` individually (not a shared grid canvas) with its own
  `transform: translateY(${virtualItem.start}px)` (or `top` when `adjustLayout` — a Firefox-only
  pinned-column workaround, `data-grid-row.tsx:218-224`), plus `will-change-transform`. Cells
  inside a row are a plain `flex` row, not CSS Grid — simpler layout engine work per row, no
  subgrid track resolution.

Neither approach recycles DOM. Both key rows by stable id and let React's reconciler mount/unmount
at the window edges.

### Memoization strategy

Both use `React.memo` with a **custom comparator** (not default shallow-compare) on row and cell,
and both derive per-row interactive state (focus/editing/selection) from primitives so a sibling
row's state change doesn't cascade — same design principle, independently arrived at:

- Ours (post-4b): one Zustand subscription per row (`useDataGridRowCellState`, `row.tsx:66`)
  derives `{activeCol, editingCol, searchMatchCols, selectedColRanges}` and passes primitives down
  to `DataGridCell`, which is `memo()`-wrapped with React's default shallow compare over those
  primitives plus `row`/`column`/`columnIndex` (`cell.tsx:252-258`).
- Theirs: `DataGridRow`'s memo comparator (`data-grid-row.tsx:47-149`) explicitly checks ~15
  conditions (row identity, `virtualItem.start`, per-row focus/editing derived from a shared
  `focusedCell`/`editingCell` object by comparing `rowIndex`, `cellSelectionKeys` Set identity,
  etc.) — functionally the same "narrow to primitives that matter to THIS row" goal, just written
  as an explicit long-form comparator instead of a derived-primitives-then-shallow-compare split.
  `DataGridCell`'s comparator (`data-grid-cell.tsx:18-46`) reads the cell's value from
  `row.original` directly rather than TanStack Table's `getValue()`, with an explicit comment that
  `getValue()` "is unstable and recreates on every render, breaking memoization" — a TanStack
  Table-specific gotcha we don't have (we don't wrap a third-party table library).

Neither codebase's row-level context/subscription model looks structurally faster than the
other's; both made the same core call (row subscribes once, cell reads primitives). This is not
where tablecn's edge comes from.

### DOM shape / CSS containment

This is where a real, adoptable gap exists:

- **`content-visibility: auto` per row** — tablecn's row className includes
  `[content-visibility:auto]` (`data-grid-row.tsx:214`). This tells the browser it may skip
  layout/style/paint entirely for a row that isn't near the viewport, independent of and in
  addition to JS virtualization — a second, browser-native layer of "don't do work for offscreen
  content." We have **no `content-visibility` usage anywhere in `registry/default/blocks/data-grid/`**
  (grep confirmed). Our root does use `contain: "content"` on the scroll root (`root.tsx:255`,
  `rootStyle`) and `contain: "layout paint"` / `"strict"` conditionally
  (tablecn's body: `data-grid.tsx:205`, `contain: adjustLayout ? "layout paint" : "strict"`) — so
  we already contain at the container level, just not per-row.
- **`will-change-transform`** on tablecn's rows (`data-grid-row.tsx:215`, skipped only in the
  Firefox `adjustLayout` branch) hints the compositor to promote each row to its own layer ahead
  of the animation. We don't set `will-change` on rows; our canvas-level single-transform
  architecture (one transform for the whole visible row set, not one per row) makes a per-row
  `will-change` a different trade-off — worth measuring, not assuming.
- Cell tree depth: ours nests one extra wrapper (`<div role=gridcell>` → `<span>` around content,
  `cell.tsx:236-247`) for text overflow/ellipsis handling that isn't editing; tablecn's simplest
  cell type (`ShortTextCell`) renders a single `contentEditable`-style div with `textContent` set
  imperatively (`data-grid-cell-variants.tsx:63-76`) — no separate display/edit component split at
  all for its plainest cell type. This is the apples-to-oranges caveat below, not a technique we
  should copy (their approach requires DOM-string round-tripping instead of React-controlled
  input state, which is its own class of bugs).

### Event handling

Both are per-cell React synthetic handlers (`onClick`/`onPointerDown`/`onDoubleClick`,
`useCallback`-wrapped) — **neither** uses event delegation to a single row/container listener.
Ours: `cell.tsx:112-123`. Theirs: `data-grid-cell-wrapper.tsx:51-91`. No difference here; this is
not a factor in the perceived smoothness gap.

### Sticky/pinned columns

Ours: CSS custom-property-driven inset offsets computed once in `layout-context.tsx`
(`useColumnLayout`), read via `calc()` in each cell's style, with a measured pin-shadow anchor
(`use-pin-shadow-edges.ts`) — no React re-render per scroll tick. Theirs: `getColumnPinningStyle`
(`lib/data-grid.ts`) computes `left`/`right` px inline per cell per render, plus a documented
Firefox-only fallback (`adjustLayout`) that switches from `transform` to `top` positioning because
Firefox apparently mis-composites transformed rows against sticky/pinned siblings — a workaround
we don't need because our pinned cells use CSS inset vars against a `position: sticky` viewport,
not per-row transforms. Not a source of the FPS gap (their workaround exists for Firefox
correctness, not Chrome performance), but worth noting as a robustness feature we might be missing
for our own Firefox users — out of scope for this report, flagging for a future item.

### Cell complexity (apples-to-oranges caveat)

**This caveat must gate every number below.** tablecn's demo cell types are simpler on average:
- Its plain-text cell edits via a `contentEditable`-pattern div with imperative `textContent`
  writes, not a controlled React input — cheaper to render (no controlled-input re-render loop)
  but a different (arguably riskier) correctness model.
- No visible per-cell selection-range overlay system as elaborate as ours (fill handle, range
  selection, pin-zone shadow segmentation) is exercised on the default `/data-grid` demo view we
  measured — we did not audit whether tablecn *has* a fill handle (its column header shows
  "Filter"/"Sort"/"Short"/"View" buttons, suggesting a real feature set, but the base cell render
  path is lighter).
- Our demo (`/dev`) renders 8 columns including a `select` and `date` type by default; tablecn's
  demo renders 6-7 columns (Name/Age/Email/Website/Notes/Salary) of mostly short-text/number/url.

A simpler cell tree scrolling faster is expected and does not by itself indicate a gridcn defect.

## Measured numbers (same machine, Chrome via CDP/agent-browser)

**Method:** gridcn's dev server (port 3000, already running, NOT restarted) at its native default
of 100,000 rows; tablecn's dev server (port 3001, started fresh for this investigation) at its
only available dataset, 10,000 rows — **row counts are NOT matched**; see caveat below. An
attempted same-page row-count control (switching gridcn's dev-page row selector to 10,000 for a
matched run) exposed a separate, minor bug in the dev harness itself (not gridcn's registry
source): the `<select>` and the "N rows × M columns" label both update to show 10,000, but
`aria-rowcount` and `scrollHeight` stay sized for the previous 100,000 — a state-sync bug in
`app/dev/page.tsx`'s own demo wiring, outside this report's scope to fix, noted here only so the
mismatch isn't mistaken for a measurement error. Matched-row-count testing was abandoned within
the time budget; all numbers below are native-row-count, both sides labeled.

An FPS sampler (rAF frame-delta histogram, 3 trials/condition) was injected via
`agent-browser eval`, scrolling each grid's `[role=grid]` container by repeated `scrollTop`
increments at 16ms cadence, at three jump-size tiers to characterize behavior across the speed
range, not just one point:

| Condition | gridcn (100k rows) avg fps | gridcn min-100ms-window fps | tablecn (10k rows) avg fps | tablecn min-100ms-window fps |
|---|---|---|---|---|
| Gentle (40-120px/tick, ≈wheel/trackpad speed) | 32.0 | 31.9 | 31.1 | 23.9 |
| Medium (500-800px/tick) | 29.9 (13.5% frames <30fps) | 16.0 | 13.0 (95.2% frames <30fps) | 8.0 |
| Hard (3000-5000px/tick, ≈scrollbar-teleport) | 17.9 (82.8% frames <30fps) | 10.6 | 10.7 (94.4% frames <30fps) | 6.4 |

**Honest reading of this table:** at gentle, wheel-like scroll speed — the speed most ordinary
scrolling happens at — **the two grids are statistically indistinguishable** (32.0 vs 31.1 fps).
At medium and hard synthetic jump speeds, **tablecn's numbers are worse than gridcn's**, not
better, which contradicts the "tablecn feels smoother" premise on its face. Root cause (verified,
not guessed): tablecn's `measureElement` callback runs `element.getBoundingClientRect()` — a
layout-forcing call — on every newly mounted row on every commit (`use-data-grid.ts:2330-2331`,
active on Chromium; only skipped on Firefox). A programmatic `scrollTop=` jump mounts many rows
in one commit, and CDP-driven synthetic jumps are more punishing to this pattern than the many
small, browser-coalesced native scroll events a real trackpad/wheel/scrollbar-drag produces. Real
native-scroll input (the Phase 0 harness the architecture spec calls for) would very likely narrow
or reverse this gap — **this report cannot confirm the user's "tablecn feels smoother" perception
with the synthetic-scroll method available here, and says so plainly rather than fabricating a
number that fits the premise.**

**What the measurements DO confirm, independent of the fps-race question:** row DOM mount/unmount
churn during a 2-second medium-speed scroll (`MutationObserver` on `[role=row]` additions/removals):

| | gridcn (100k) | tablecn (10k) |
|---|---|---|
| Rows in DOM at scroll start | 12 | 20 |
| Rows in DOM at scroll end | **59** | 26 |
| Total row mounts over 2s | **377** | 181 |
| Total row unmounts over 2s | **330** | 182 |
| Rows still in DOM after scroll settles | **59** (unchanged) | n/a (didn't grow) |

This is the workplan's "window-edge row mounts during scroll" concern, measured directly and
confirmed real: our rendered window balloons from 12 to 59 rows (nearly 5x its resting size) during
a sustained medium-speed scroll and **does not shrink back down** even after the scroll stops —
consistent with `VELOCITY_DECAY_FACTOR = 0.5`/tick only eroding the estimate while `isScrolling`
is true, combined with a settle commit that (by the code's own doc comment) "carries no new
positional delta by construction" and therefore doesn't itself trigger decay. tablecn's fixed
`overscan=6` never grows past a small, bounded row count (20→26, +30%) regardless of speed. **This
is the real, measured, adoptable difference** — independent of the inconclusive fps race above.

## Adoption candidates (ranked, none implemented)

### 1. Cap and/or actively decay the velocity-overscan window post-scroll (highest priority)
- **What:** Either (a) lower `VELOCITY_OVERSCAN_CAP_PX` and/or `VELOCITY_RAMP_TICKS` tuning so the
  window grows less aggressively, or (b) add an explicit reset-to-baseline on the `scrollend`/
  debounce settle commit (`use-row-window.ts`'s `onScrollEnd`/debounce-timeout path) instead of
  relying on decay-while-scrolling, so the window promptly shrinks back to `overscan=1` once the
  user stops. Directly targets the measured 59-rows-stuck-mounted result and the React Scan
  evidence (416 cell/127 row renders) already in the workplan.
- **Expected win:** cuts sustained-scroll row count and mount churn roughly in half or more at
  matched-decay, and eliminates the "still 59 rows mounted at rest" waste entirely if a settle
  reset is added — every one of those extra rows is live cell subscriptions and DOM nodes doing
  nothing once idle.
- **Risk:** low-medium. The current decay-only design is deliberate (see the long doc comment in
  `use-row-window.ts` around `VELOCITY_RAMP_TICKS`) — it exists specifically so a mid-fling pause
  doesn't erode the buffer before the next hard jump. A naive "always reset to overscan=1 on
  settle" could reintroduce a blank-frame risk on a very next immediate re-fling if the reset is
  too eager. Needs the Phase 0 real-drag harness (already planned in the architecture spec) to
  verify no blank-detector regression.
- **Verify:** re-run this report's mount-churn probe (`MutationObserver` on `[role=row]`) before/
  after; assert end-of-scroll DOM row count returns within ~1.5x of baseline within N ms of
  `scrollend`; keep the existing `perf.browser.test.tsx` ratio floor and the blank-detector test green.

### 2. Add `content-visibility: auto` to row root (`row.tsx`)
- **What:** add `content-visibility: auto` (with a `contain-intrinsic-size` matching `rowHeight`
  to avoid layout jank on first paint) to `DataGridRow`'s className, mirroring
  `data-grid-row.tsx:214`. A free, browser-native second layer of off-screen-work skipping on top
  of JS virtualization, since our windowed rows near the edge of the viewport (inside the overscan
  buffer but not actually visible) still pay full style/layout/paint cost today.
- **Expected win:** likely small at our current tight overscan=1 baseline (little truly-offscreen
  content is mounted at rest) but should compound nicely with fix #1's larger transient windows —
  the more rows a fling keeps mounted, the more this pays for itself. Needs measurement, not
  assumption, per the workplan's own rule.
- **Risk:** low. `content-visibility: auto` is well-supported in evergreen browsers; interacts
  with `contain` (we already set `contain: content` at the root) — verify no conflict/override
  between the root's `contain` and a per-row `content-visibility` (they operate at different
  levels: root contains layout for the scroll container, per-row content-visibility skips
  rendering work for rows outside the viewport entirely). Must verify focus/scrollIntoView/a11y
  tooling still finds off-screen-but-mounted rows via `role=row` queries (browser test).
- **Verify:** Chrome DevTools Performance panel or a Playwright CDP trace, before/after, comparing
  "Layout"/"Paint" time attributed to row elements during a scroll; existing browser-mode a11y
  tests must stay green (content-visibility can affect getBoundingClientRect timing for
  auto-hidden content in edge cases).

### 3. Consider `will-change: transform` on individual rows, measure, keep only if it wins
- **What:** tablecn promotes each row to its own compositor layer. Our architecture already
  transforms one shared canvas for the whole row set (a different, arguably cheaper trade-off —
  one composited layer instead of N), so this is NOT a clear win to port; it's explicitly flagged
  here as a "measure before adopting" candidate, not a recommendation.
- **Expected win:** unknown, possibly negative (many small compositor layers can cost more memory/
  compositing overhead than one large one; the canvas-pivot rejection doc already flags this class
  of trade-off).
- **Risk:** medium — could regress if our single-canvas-transform model is already the better
  choice, which the architecture spec's own reasoning suggests.
- **Verify:** A/B via the perf suite's existing ratio test; only adopt with a measured win, per
  house rules.

### Not recommended: row pooling / DOM recycling
tablecn does not do this (see Executive Summary). Adopting it purely because "tablecn is faster"
is not supported by evidence — tablecn doesn't use it, and this report's own measurements show
tablecn is not uniformly faster. The canvas-pivot-rejected doc's designated fallback (Approach C,
fixed row-pool with imperative content swap) remains a valid future escalation path if Phase 2-4
of the architecture spec's fixes plus candidates #1-2 above fail the real-drag perf harness — but
this investigation found no evidence from tablecn that pooling is necessary or that a competitor
proved it out. Re-evaluate only against that harness's own numbers, not against tablecn.

## Caveats (apples-to-oranges, stated for the record)

- **Row counts are not matched** (100k vs 10k) — tablecn ships no larger demo dataset. All
  same-machine numbers above are native-count, both sides labeled per row.
- **Cell complexity is not matched** — tablecn's plainest cell type uses a simpler
  contentEditable-style render than our Cell/Editor split; our demo includes select/date columns
  tablecn's demo doesn't exercise.
- **Column virtualization is not matched** — we window columns (built for 50-200+ column grids);
  tablecn renders all columns unconditionally (its demo has ~7). This makes our column dimension
  strictly more capable but also strictly more per-cell-render work at low column counts — a
  trade-off, not a defect.
- **Synthetic scroll input is not native scroll input** — the FPS-race numbers above are actively
  misleading if read as "which grid is faster," because tablecn's `measureElement` layout-forcing
  pattern is disproportionately punished by CDP-driven `scrollTop=` jumps in a way real
  trackpad/wheel/scrollbar-drag input likely would not replicate to the same degree. The
  architecture spec's own Phase 0 (real-drag harness, not yet built) is the correct instrument for
  a trustworthy fps comparison; this report does not have it and says so rather than presenting
  the jump-based numbers as a verdict.
- **tablecn's `/data-grid` demo required a workaround** (dummy `DATABASE_URL` env var to satisfy
  its zod env-validation at Next.js config load) that has nothing to do with its grid's runtime
  performance — noted only for reproducibility, not a finding.
