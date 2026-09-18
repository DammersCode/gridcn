# Plan 008: Editor keystroke-to-paint timing test (the unenforced §4.6 budget)

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If anything
> in the "STOP conditions" section occurs, stop and report — do not improvise. When
> done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 037d895..HEAD -- registry/default/blocks/data-grid/test/perf.browser.test.tsx registry/default/blocks/data-grid/cell.tsx`
> If either changed, compare against the "Current state" notes; on a mismatch, STOP.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: LOW (test-only)
- **Depends on**: none
- **Category**: tests (perf budget enforcement)
- **Planned at**: commit `037d895`, 2026-09-03

## Why this matters

PLAN.md §4.6 budgets: "Keystroke-to-paint < 16ms while editing at 10k+ rows
(uncommitted editor state stays local to the editor; commit is one immutable
update)". The 2026-09-03 perf audit's budget table marks this budget **unenforced** —
no timing test exists around F2/typing/Enter. Every other §4.6 budget has a guard
(scroll: `perf.browser.test.tsx`; search: `store-search-perf.test.ts`; streaming:
`streaming.browser.test.tsx`; mount: `data-grid.browser.test.tsx:59-113`). A future
regression in the editor path (a new per-keystroke store write, a re-render of the
visible band on each character) would ship silently.

## Current state

- `registry/default/blocks/data-grid/test/perf.browser.test.tsx:70-117` — the
  full-swap-vs-idle FPS probe: the structural exemplar for this repo's browser perf
  tests (how it mounts a grid with demo data, how it times, how it asserts a
  ceiling). READ IT FIRST and copy its mounting/timing scaffolding.
- `registry/default/blocks/data-grid/test/data-grid.browser.test.tsx` — the browser
  test patterns for driving keyboard input and reading cell DOM state (search for
  how existing tests type into an editor — the edit-lifecycle tests dispatch real
  key events; reuse that helper, don't hand-roll event dispatch).
- `registry/default/examples/demo-data.ts` — the shared demo data builder the perf
  tests use (verify by reading the imports of `perf.browser.test.tsx`).
- The budget's mechanism (why it holds today): the editor holds uncommitted text in
  its OWN state (cell.tsx editor swap — PLAN.md §4.4), so a keystroke re-renders at
  most the editor; the commit (Enter) is one store write → one immutable update.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Browser tests (filter) | `pnpm test -- perf.browser` | exit 0 |
| Tests (full) | `pnpm test` | exit 0 |
| Lint | `pnpm lint` | exit 0 |

## Scope

**In scope:**
- `registry/default/blocks/data-grid/test/perf.browser.test.tsx` (extend) — or a new
  `edit-keystroke-perf.browser.test.tsx` in the same folder if the existing file's
  describe structure makes extension awkward (match the repo's colocated test layout;
  one file per concern is the norm — prefer the NEW file to keep the FPS probe
  untouched)

**Out of scope:**
- ANY behavior change in the editor/cell/store — this plan adds a guard, nothing else.
  If the guard reveals a real budget violation, STOP and file it as a finding instead
  of fixing it here.

## Git workflow

- Branch `test/008-keystroke-paint-guard` or `dev`; conventional commit
  (`test(grid): keystroke-to-paint budget guard for the editor path`). No co-author
  trailer. Do not push.

## Steps

### Step 1: Measure the baseline (before asserting)

Write the test to MEASURE first: 10k-row grid (the budget's "10k+" floor — use the
demo-data helper), focus a mid-grid cell, F2 (or type to activate — use the same
activation the repo's edit tests use; single-click never edits, per the 2026-07-03
decision), then dispatch 50 keystrokes (a1z9…), and for each keystroke record
`performance.now()` at dispatch and the time of the next `requestAnimationFrame`
callback (the paint boundary in Chromium). Log the per-keystroke deltas
(median, p95, max) to the test output. Run it twice on this machine and note the
numbers in a comment at the top of the test (baseline + date, per the repo's
perf-doc convention).

**Verify**: the test runs and prints numbers (assertions commented out for now).

### Step 2: Assert the budget

Assert **median < 16ms** (the budget) and **p95 < 32ms** (two frames — the budget is
a median-style guarantee; a single frame of jank under headless load is tolerated,
ten are not). Exclude the first 3 keystrokes (warm-up: editor mount, font/layout
settling) from the statistics. Use the median-of-runs pattern if the raw numbers are
noisy (the flake triage rule — commit 91f4b3a: environmental flake → record it in the
perf doc, never relax the bar): run the 50-keystroke sequence 3 times and take the
median of the 3 medians.

**Verify**: `pnpm test -- perf.browser` (or the new file's filter) → green and stable
across 3 consecutive runs on this machine. If it is not stable, apply the
median-of-runs pattern; if still unstable, STOP and report with the variance numbers.

### Step 3: The commit-path assertion

After the 50 keystrokes, press Enter (commit). Assert the commit is ONE store write:
reuse the existing render-count probe pattern (`test/data-grid.test.tsx:556-613` —
read how it counts renders in the UNIT project; in the browser project, count via the
same mechanism the existing browser perf tests use, or via a subscribed store spy
that counts `set`-induced selection/data identity changes — whichever the repo's
browser tests already use for "one onDataChange"-style assertions). The point: the
Enter commit must not re-render the visible band (uncommitted text lived in the
editor; the commit updates one row object).

**Verify**: `pnpm test` (the new file) → green.

### Step 4: Full gate

**Verify**: `pnpm test` exit 0; `pnpm lint` exit 0. No registry rebuild needed
(test-only change — verify with `git status` that no `registry/` source file changed
before skipping it).

## Test plan

- New: the keystroke-to-paint median/p95 guard (Step 2) + the commit single-write
  assertion (Step 3), in one browser test file.
- Untouched: every existing perf/test file.

## Done criteria

- [ ] `pnpm test` exits 0; the new guard is stable across 3 consecutive runs
- [ ] The test's header comment records the measured baseline (machine, date, median/p95)
- [ ] The budget table's "unenforced" row is now enforced — update
  `docs/agent-work/2026-09-03-audit-performance.md`? NO — the audit report is a
  historical snapshot; instead note the new guard in `DEVELOPMENT.md`'s benchmarking
  section (one line, next to the other perf guards) — check DEVELOPMENT.md first and
  match its structure
- [ ] `git status` shows test file(s) + at most the DEVELOPMENT.md line
- [ ] `plans/README.md` status row updated to DONE + commit SHA

## STOP conditions

- The median on this machine is already > 16ms (the budget is violated TODAY) — do
  NOT tune the test to pass; STOP and report the numbers as a new P1 finding.
- The repo's existing browser tests have no reusable key-input helper and hand-rolled
  dispatch fights the editor's IME/composition guards (`use-grid-interaction.ts:535`
  gates on `isComposing`) — STOP and report rather than bypassing the IME guard.
- Headless Chromium cannot measure the paint boundary reliably here (rAF timestamps
  quantized to 0 or wildly inconsistent) — use the `PerformanceObserver` paint-entry
  pattern instead if available; if that also fails, STOP and report.

## Maintenance notes

- This guard protects the EDITOR path only — scroll, search, and streaming have their
  own guards (see the audit's budget table). A new budget added to PLAN §4.6 should
  get a sibling guard here.
- Reviewers: the ceiling assertions are order-of-magnitude guards with recorded
  baselines — when the baseline legitimately moves (new React, new machine in CI),
  re-measure and update the comment, keep the 16ms median bar.
