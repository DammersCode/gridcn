# Scroll & Rendering Architecture — Evaluation and Fix Design

**Date:** 2026-07-16
**Status:** awaiting user review
**Validation:** 12-agent workflow — 3 code readers, 3 independent design proposals (fix-DOM / canvas-pivot / hybrid row-pool), 2 judges (perf-engineer lens + product-owner lens), 4 adversarial verifiers on the bug root-causes. Both judges independently ranked **A-fix-DOM > C-hybrid > B-canvas**.

## Decision

Keep the DOM sticky-viewport + transform architecture. Do **not** pivot to a glide-style canvas renderer. Fix the four verified defects that cause the reported symptoms, in five phases.

## Why not canvas (the question that triggered this evaluation)

Canvas's structural guarantee ("a fully painted bitmap can never blank") is real, but it solves a problem the evidence does not show DOM failing at:

- The current architecture already implements the MUI "controlled virtualizer" pattern (`research/mui-controlled-virtualizer.md`), which has the same worst-case as canvas: one frame of stale-but-painted content, never a hard blank — *when implemented completely*. Ours is incomplete (see defects below), which is why blanking still occurs.
- The perf baseline (`perf.browser.test.tsx`, 100k rows) passes at ratio 0.447 against a 0.3 hard floor. The blanking the user sees comes from fixable implementation defects, not an architectural ceiling.
- Canvas is this product's own documented pitfall #1 (`research/landscape.md`): it kills Tailwind theming (theme becomes a computed-style probe), turns copy-paste TSX cells into imperative draw callbacks, requires a shadow-DOM a11y mirror (a parity-bug generator), loses find-in-page, and invalidates the entire browser-mode test suite. For a shadcn-registry product this is a category change, disqualifying independent of perf.
- The editing half of the user's idea (cheap render path + rich DOM editor only when editing) is **already how the grid works**: cells render a lightweight display component; the `Editor` component mounts only for the single editing cell (`cell.tsx`).

Escalation path if DOM is ever measured insufficient: Approach C (fixed row-pool with imperative content swap) is the documented fallback — gated on the real-drag perf test below, not adopted now.

## Verified root causes

| # | Symptom | Root cause | Verdict |
|---|---|---|---|
| 1 | Shift+ArrowDown "stops selecting", grid doesn't scroll | `moveAndScroll` (`use-grid-interaction.ts:449-456`) scrolls `activeCell` into view — but the extend branch of `_moveActiveCell` (`store.tsx:1039-1052`) correctly keeps `activeCell` pinned at the anchor and only advances `lastHighlightedRow/Col`. The anchor is always already visible → scroll-into-view no-ops from the 2nd keypress on → the row window freezes → the selection keeps growing in state with nothing to paint it on. `lastHighlightedRow/Col` is written but read by nothing. | CONFIRMED (2 verifiers) |
| 2 | FPS drop on fast scrollbar drag | Two independent `flushSync` commits per scroll tick (`use-row-window.ts:330` + `use-column-window.ts:163`); `windowStart` prop defeats `DataGridRow`'s memo so **all** ~30 rows re-render on every 1-row shift; `DataGridCell` is unmemoized so ~450 cells cascade. A full-window scrollbar jump ≈ 1000–2000 synchronous component ops inside one scroll event. | CONFIRMED |
| 3 | Blank background during fast drag | Fixed `overscan = 1` row/col — cannot cover a multi-row scrollTop jump in one native scroll event; plus the final scrollend commit is a plain async `forceUpdate`, leaving one un-gated blanking window. | CONFIRMED |
| 4 | "Multiple box" | Hypothesized overlay-clamp mechanism was **refuted** (the disjoint-window clamp defect is real but produces *truncation*, not duplicate boxes). Actual mechanism unknown — most likely a stale `rangeStack` entry; needs a browser repro before fixing. | REFUTED — needs repro |

## Design

### Phase 0 — Real-drag perf harness (prerequisite, both judges required this)
The existing perf test drives synthetic `dispatchEvent('scroll')` ticks and cannot reproduce thumb-drag timing. Add a browser-mode test that simulates realistic scrollbar-drag input: variable inter-event timing, multi-row per-event deltas, plus a blank-detection assertion (sample the viewport for unrendered track area after each tick). Establish baseline **before** any fix so every phase is measured, not assumed. Also add a rapid Shift+ArrowDown-past-window-boundary repro test (real browser, per the browser-testing gate — jsdom missed the last freeze).

### Phase 1 — Keyboard fix (ships first, independent)
- Derive the scroll target in `moveAndScroll`: `opts.extend ? {row: lastHighlightedRow, col: lastHighlightedCol} : activeCell`. Consider exposing this as an explicit "focus edge" selector so body.tsx's off-window escape hatch and any future consumer use the same concept instead of overloading `activeCell`.
- Fix the confirmed clamp defect: `DataGridOverlays` receives `rowCount = viewRowIndices.length` over a possibly disjoint window; clamp the range overlay against the true contiguous `[start,end)` instead.
- Reproduce the "multiple box" with the Phase 0 keyboard test; diagnose (`rangeStack` suspected) and fix what the repro shows.

### Phase 2 — One commit per tick
- Merge row- and column-window recomputation into a single listener on the shared element store: one `{rowStart,rowEnd,colStart,colEnd}` struct, one `flushSync`. Structurally removes the double synchronous commit. Must not disturb `useElementDimensions` / `useScrolledEdges` independent bail-outs (unit-cover this).
- Gate the final scrollend commit with `flushSync` too (closes the async-commit blanking window).

### Phase 3 — Stop wasted renders
- Remove `windowStart` from `DataGridRow`'s memo surface: compute the `gridRowStart` style in the parent map and pass a memo-stable row; only rows whose `viewRowIndex` changed re-render.
- Wrap `DataGridCell` in `memo()` with an audited comparator (`row`, `columnIndex`, `column`, `gridReadOnly`); active/editing/search state stays on the cell's own store subscription. Add a prop-by-prop re-render test so the comparator can't silently go stale.

### Phase 4 — Velocity-aware overscan
- Overscan in pixels, sized from observed per-tick scroll delta (`ceil(delta/rowHeight) + 1`), biased in scroll direction, decaying back to 1 over a few idle ticks. Covers multi-row jumps so the transform never points past rendered content.
- Prefer stale-over-blank: when a jump momentarily exceeds overscan, keep the previous window's rows mounted until the replacement commit lands rather than tearing down first.
- Dev-only invariant: assert rendered row count matches `computeWindow`'s expectation on every commit.

## Guarantees (stated honestly)

- **No solid blanking** at scrollbar-drag speed; residual worst case is a single self-correcting frame of stale-but-painted rows under a first-tick hard fling — the same contract MUI and canvas grids ship. Not "zero artifacts, full stop."
- **60fps wheel/drag** for the perf-test shape (100k rows, standard cells); degrades gracefully with heavy custom `renderCell`, not catastrophically.
- **Shift+Arrow extension follows the edge** through the same scroll pipeline as mouse/wheel; OS key-repeat bursts may under-shoot by a row for one keypress and self-correct.

## Effort

~7–9 days total across 5 independently shippable phases (0: 1–1.5d, 1: 0.5–1d, 2: 2–3d, 3: 1–1.5d, 4: 2–3d), each gated by the Phase 0 harness plus the existing ratio test.

## Rejected alternatives

- **B — Canvas renderer + DOM editor overlay** (glide-style): strongest no-blank guarantee, but 15–19 phases, destroys the Tailwind/copy-paste/a11y/test-suite value proposition, and solves an unproven ceiling. Judge scores 4/10 and 2/10.
- **C — Hybrid row-pool with imperative tier-1 writes**: biggest single perf lever, but introduces a dual render-path consistency bug class and breaks the row-identity invariant (PLAN §4.2). Kept as the measured fallback if Phase 2–4 fail the Phase 0 harness. Judge scores 6.5/10 and 6/10.
