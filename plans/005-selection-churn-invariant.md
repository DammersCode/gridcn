# Plan 005: Scope the selection zero-render invariant + guard it (accept the `aria-selected` churn)

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If anything
> in the "STOP conditions" section occurs, stop and report — do not improvise. When
> done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 037d895..HEAD -- registry/default/blocks/data-grid/cell.tsx registry/default/blocks/data-grid/row.tsx registry/default/blocks/data-grid/store/hooks.ts PLAN.md`
> If any changed, compare against the "Current state" excerpts; on a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (no behavior change — this plan adds a guard and corrects two documents)
- **Depends on**: none
- **Category**: perf (invariant scoping) + docs
- **Planned at**: commit `037d895`, 2026-09-03

## Why this matters

PLAN.md §4.6 promises "Selection drag re-renders zero cells (overlay-only
invariant — enforce with a render-count test)". The 2026-09-03 audit (perf finding
P4) found the invariant is violated: a cell whose SELECTION MEMBERSHIP flips
re-renders, because `isSelected` is a React prop feeding `aria-selected`
(row.tsx:126 → cell.tsx:247). `aria-selected` on `role="gridcell"` is a WAI-ARIA
requirement, so this is a deliberate a11y/perf tension, not an accident.

**Vetting decision (recorded here so a future executor doesn't re-litigate it):**
the naive fix — imperative `aria-selected` writes via a per-cell store
subscription — was REJECTED: it reintroduces ~544 store subscriptions per windowed
band (one per mounted cell), exactly what the per-row subscription consolidation
(`useDataGridRowCellState`, hooks.ts:563-571, "spec 4b") eliminated (~544
subscribe/unsubscribe cycles per full-swap tick → ~68). The churn itself is
bounded: `DataGridRow`/`DataGridCell` are memoized (row.tsx:52, cell.tsx:330), and the
row-level content-equality comparator (hooks.ts:550-561) means only cells whose
`isSelected` actually changed this frame re-render — a smooth drag flips only the
newly-covered/shrunk boundary cells per frame; the worst case (a single jump that
flips a whole band at once) flips that band exactly once. Accepting the churn and
GUARDING it is the correct resolution: the a11y attribute stays correct, the
zero-render budget is restated precisely, and the guard makes the bound provable.

## Current state

- `registry/default/blocks/data-grid/cell.tsx:247` — `aria-selected={isSelected || undefined}`.
- `registry/default/blocks/data-grid/row.tsx:126` —
  `isSelected={isActive || colRangesContain(cellState.selectedColRanges, index)}`.
- `registry/default/blocks/data-grid/store/hooks.ts:550-580` —
  `rowCellStateEqual` + `useDataGridRowCellState` (per-row subscription, content
  equality; the doc comment at :563-571 explains the consolidation rationale — the
  plan's rejection note references it).
- `registry/default/blocks/data-grid/cell.tsx:330` / `row.tsx:52` —
  `memo(DataGridCellImpl)` / `memo(function DataGridRow(...))`.
- Render-count test exemplar: `registry/default/blocks/data-grid/test/data-grid.test.tsx:556-613`
  (row identity/subscription probe) and `:885-904` (active-cell move re-renders only
  the affected cells) — read both before writing the new tests.
- Documents to correct: `PLAN.md` §4.6 (the "Selection drag re-renders zero cells"
  bullet) and `content/docs/accessibility.mdx` (find the row/cell selection a11y
  section — it claims overlay-only selection rendering).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests (filter) | `pnpm test -- data-grid.test` | exit 0 |
| Tests (full) | `pnpm test` | exit 0 |
| Typecheck | `pnpm types:check` | exit 0 |
| Lint | `pnpm lint` | exit 0 |
| Registry rebuild | `pnpm registry:build && pnpm registry:verify` | exit 0 (only if a registry/ file changes — hooks.ts comments count) |

## Scope

**In scope:**
- `registry/default/blocks/data-grid/test/data-grid.test.tsx` (new render-count cases)
- `PLAN.md` (§4.6 bullet only)
- `content/docs/accessibility.mdx` (one-line correction)
- `registry/default/blocks/data-grid/store/hooks.ts` (doc comment on
  `useDataGridRowCellState` only — no logic change)

**Out of scope:**
- ANY change to `aria-selected` mechanics, `isSelected` props, selection model, or
  memoization (a11y behavior must be byte-identical)
- the overlay paint path

## Git workflow

- Branch `docs/005-selection-invariant-guard` or `dev`; conventional commits:
  `test(grid): render-count guard for selection membership flips` then
  `docs: scope the selection zero-render invariant (2026-09-03 audit P4)`.
  No co-author trailer. Do not push.

## Steps

### Step 1: The membership-flip render-count test

In `test/data-grid.test.tsx`, following the probe pattern at :556-613 (a render
counter on the cell component; read how it counts and how it scopes the selection),
add two cases:

1. **Smooth drag is cheap:** with a N-row × M-column visible band, select a 1×M row
   at the top, then extend the selection down by one row (the
   `extendDown` action / shift+ArrowDown via the existing keyboard test helpers —
   mirror :885-904's action-driving pattern). Assert total `DataGridCellImpl` render
   increments across the visible band ≤ `M + 4` (the newly-covered row's M cells +
   slack for the active-cell move) and row renders ≤ 2.
2. **A whole-band jump flips the band once:** from no selection, select the whole
   visible band (select-all progression to the visible rect — use the store action
   the existing select-all tests use). Assert total cell render increments ≤
   `bandRows × M + bandRows` (each cell flips at most once) and that a SUBSEQUENT
   unrelated store write (e.g. a search-text set that changes nothing in the band)
   adds ZERO cell renders (the content-equality comparator holds).

Tune the constants from the measured baseline (run once, read the actual numbers,
set the assertion at ~1.5× the measured value with a comment naming the measured
baseline and date). The assertion shape is what matters — a future regression that
makes EVERY cell re-render on a one-row extend (e.g. losing memo or the comparator)
must fail test 1 loudly.

**Verify**: `pnpm test -- data-grid.test` → green; re-run twice (render counters can
be timing-sensitive — confirm stability on this machine; if flaky, use the
median-of-3 pattern if the existing probe has one, otherwise STOP and report).

### Step 2: Restate PLAN.md §4.6

Replace the bullet "Selection drag re-renders zero cells (overlay-only invariant —
enforce with a render-count test)." with:

"Selection PAINT re-renders zero cell content — ranges paint through grid-line
overlays. The one sanctioned exception is `aria-selected` (WAI-ARIA gridcell
requirement): a cell re-renders only when its own selection membership flips,
bounded by the flip count and enforced by the render-count tests in
`test/data-grid.test.tsx` (2026-09-03 audit P4)."

**Verify**: `git diff PLAN.md` shows only that bullet changed.

### Step 3: Correct accessibility.mdx

In the selection a11y section, one line: membership changes update `aria-selected`
on the affected cells (a bounded, guarded re-render — see Performance
`/docs/performance` for the invariant wording). Keep existing claims that remain
true.

**Verify**: `pnpm lint` exit 0 (mdx is linted); `git diff content/docs/accessibility.mdx`
shows a minimal change.

### Step 4: hooks.ts comment

Extend the `useDataGridRowCellState` doc comment (hooks.ts:563-571) with one line:
"selection membership flips are the one sanctioned cell re-render (aria-selected —
PLAN.md §4.6, 2026-09-03 audit P4)."

**Verify**: `pnpm types:check` exit 0; `pnpm registry:build && pnpm registry:verify`
exit 0 (comment-only registry change, but the gate is cheap).

### Step 5: Full gate

**Verify**: `pnpm test` exit 0; `pnpm lint` exit 0.

## Test plan

- New: the two render-count cases (Step 1) — the guard this plan exists to add.
- Untouched: every existing a11y/render test (this plan changes no behavior).

## Done criteria

- [ ] `pnpm test` exits 0, incl. the two new render-count cases, stable across re-runs
- [ ] PLAN.md §4.6 bullet restated; accessibility.mdx line added
- [ ] `pnpm registry:build && pnpm registry:verify` exit 0
- [ ] `git status` shows no source behavior changes (test file + 3 docs + 1 comment)
- [ ] `plans/README.md` status row updated to DONE + commit SHA

## STOP conditions

- The render counter at :556-613 cannot attribute renders to `DataGridCellImpl`
  (the probe may count rows or use a different mechanism) — adapt the probe to the
  cell component following the SAME pattern; if the existing pattern cannot be
  extended without changing behavior, STOP and report.
- Measured baseline shows a one-row extend re-rendering far more than `M + 4` cells
  (the audit's model is wrong — the churn is bigger than bounded-by-flips) — do not
  tune the assertion to hide it; STOP and report with the numbers (this reopens the
  plan-005 decision).

## Maintenance notes

- This plan's guard is the reference for plan 010 (hoisting per-cell subscriptions):
  010 must keep these render counts identical while cutting selector invocations.
- If a future feature adds another per-cell a11y attribute driven by store state,
  extend the restated invariant in the same bullet rather than creating a second
  exception — one sanctioned exception is auditable, three are not.
- Reviewers: the assertion constants carry measured baselines in comments — a
  machine-upgrade that changes React's memo timing legitimately shifts them; re-measure
  and update the comment, do not loosen blindly.
