# Plan 010: Hoist per-cell store subscriptions (actions/cellTypes via the root context)

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If anything
> in the "STOP conditions" section occurs, stop and report — do not improvise. When
> done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 037d895..HEAD -- registry/default/blocks/data-grid/cell.tsx registry/default/blocks/data-grid/layout-context.ts registry/default/blocks/data-grid/root.tsx`
> If any changed, compare against the "Current state" excerpts; on a mismatch, STOP.

## Status

- **Priority**: P3
- **Effort**: S/M
- **Risk**: LOW
- **Depends on**: 005 (its render-count guard is the baseline this plan must not move)
- **Category**: perf (selector-invocation reduction)
- **Planned at**: commit `037d895`, 2026-09-03

## Why this matters

Every mounted cell calls three store hooks: `useDataGridActions()`,
`useDataGridCellEditingError(coord)`, `useDataGridCellTypes()`
(cell.tsx ~:102/111/168). Actions and cellTypes are STABLE references (the actions
object "never re-renders" per PLAN.md §4.2; cellTypes is a resolved sync prop), so
this causes no re-renders — but every store notification still runs ~2 selector
callbacks per mounted cell for nothing: ~544 cells per full-swap window ≈ ~1.1k
useless selector invocations per streaming tick on the hottest path in the codebase.
The repo already solved this exact problem for the className hooks: they are routed
through the root context precisely because "a render that doesn't change any field
here hands out the identical value reference, so cell.tsx's direct
useDataGridRootContext() read doesn't re-render either, keeping this off the
memoized DataGridRow/DataGridCell hot path" (layout-context.ts:156-163 — the
documented precedent).

## Current state

- `registry/default/blocks/data-grid/cell.tsx` — `DataGridCellImpl` (memoized at
  :330) calls `useDataGridActions()` (~:102), `useDataGridCellEditingError(coord)`
  (~:111), `useDataGridCellTypes()` (~:168); line numbers are approximate at
  plan time — re-verify by reading the file during the drift check.
- `registry/default/blocks/data-grid/layout-context.ts:132-173` —
  `DataGridRootContextValue` (the fields, and the :156-163 comment documenting the
  stable-reference contract for the className hooks).
- `registry/default/blocks/data-grid/root.tsx` — creates the context value
  `useMemo`'d on real deps (the layout-context comment at :156-163 says so — find
  the `useMemo` and the `DataGridRootContext.Provider` by reading the file).
- `registry/default/blocks/data-grid/store/hooks.ts` — `useDataGridActions` returns
  the stable `s.actions` (never a fresh object); `useDataGridCellTypes` returns
  `s.cellTypes` (identity-stable unless the consumer re-configures).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests (filter) | `pnpm test -- data-grid.test` | exit 0 (the render-count probes) |
| Tests (filter) | `pnpm test -- streaming` | exit 0 (the per-tick cost guard) |
| Tests (full) | `pnpm test` | exit 0 |
| Typecheck | `pnpm types:check` | exit 0 |
| Lint | `pnpm lint` | exit 0 |
| Registry rebuild | `pnpm registry:build && pnpm registry:verify` | exit 0 |

## Scope

**In scope:**
- `registry/default/blocks/data-grid/cell.tsx` (drop the two stable-ref subscriptions)
- `registry/default/blocks/data-grid/layout-context.ts` (two new context fields)
- `registry/default/blocks/data-grid/root.tsx` (provide the two values)

**Out of scope:**
- `useDataGridCellEditingError` — it is genuinely per-cell (coord-keyed, changes
  per cell) and narrow; keep it as a subscription (the audit's LOW finding keeps
  this one deliberately).
- `DataGridRow`'s subscriptions, header-cell subscriptions, the overlay components
- ANY render behavior — plan 005's render-count guard must show IDENTICAL numbers

## Git workflow

- Branch `perf/010-hoist-cell-subscriptions` or `dev`; conventional commit
  (`perf(grid): serve actions/cellTypes to cells via the root context`). No
  co-author trailer. Do not push.

## Steps

### Step 1: Add the fields to the root context

In `layout-context.ts`, extend `DataGridRootContextValue` with:

```ts
/** The grid's stable actions object (PLAN §4.2 — never re-created; cells read it here instead of subscribing). */
actions: DataGridActions;
/** The resolved cell-type registry — identity-stable unless the consumer re-configures `cellTypes`. */
cellTypes: DataGridStoreState["cellTypes"];
```

(import the types — match the file's existing import style; `DataGridActions` from
`./store`, the state type from `./store/types` — verify what root.tsx already imports).
Extend the :156-163 doc comment to cover these two fields (same stable-reference
contract wording).

**Verify**: `pnpm types:check` → exit 0 (root.tsx's context value now missing the
fields — fix in Step 2 before running the gate; a types error here is expected).

### Step 2: Provide them from root.tsx

In the context-value `useMemo` (find it in root.tsx): source `actions` from
`useDataGridActions()` (call it ONCE in the root component body — its result is
stable, so adding it to the memo deps is a no-op for re-creation) and `cellTypes`
from the store value root.tsx already reads (or `useDataGridCellTypes()` once in
the root body). Add both to the `useMemo` dependency array.

**Verify**: `pnpm types:check` → exit 0.

### Step 3: Drop the per-cell subscriptions

In `cell.tsx`: remove the `useDataGridActions()` and `useDataGridCellTypes()` calls;
read both off `useDataGridRootContext()` (the cell already calls it — the
layout-context comment at :163 says so; if it doesn't, add the call). Keep
`useDataGridCellEditingError(coord)` exactly as-is.

**Verify**: `pnpm test -- data-grid.test` → exit 0 — CRITICALLY, the render-count
probes (and plan 005's membership-flip guard, if landed) must show the SAME numbers
as before this change (this plan removes selector INVOCATIONS, not renders; if any
render count moved, STOP — a render behavior changed).

### Step 4: Verify the streaming tick is unchanged-or-better

Run the streaming guard: `pnpm test -- streaming`. The per-tick cost assertion
(`test/streaming.browser.test.tsx:216-236`) must pass unchanged. (The selector
invocation reduction may or may not be visible in that number — do not chase a delta;
the goal is "no regression", not a measured win.)

**Verify**: `pnpm test -- streaming` → green, unchanged assertions.

### Step 5: Full gate

**Verify**: `pnpm test` exit 0; `pnpm lint` exit 0; `pnpm types:check` exit 0;
`pnpm registry:build && pnpm registry:verify` exit 0 (three core files changed).

## Test plan

- No new tests — this plan is a no-render-behavior change; the EXISTING guards
  (render-count probes, streaming tick guard, the full browser suite) are the test
  plan. A regression that shows up as a render-count change or a streaming-tick
  regression is caught by them.
- If the repo has a "wasted-render probe" (the docs' project-status page mentions
  one — find it in `test/` and include it in Step 5's run).

## Done criteria

- [ ] `pnpm test` exits 0 with all render-count numbers identical to pre-change
- [ ] `grep -n "useDataGridActions\|useDataGridCellTypes" registry/default/blocks/data-grid/cell.tsx` returns no matches
- [ ] `pnpm registry:build && pnpm registry:verify` exit 0
- [ ] `git status` shows exactly the three in-scope files
- [ ] `plans/README.md` status row updated to DONE + commit SHA

## STOP conditions

- `root.tsx`'s context `useMemo` re-creates the value on more deps than the
  layout-context comment claims (read the actual deps) — if `actions`/`cellTypes`
  are NOT identity-stable in practice (e.g. cellTypes is re-resolved per render
  somewhere in root), the context value would churn on unrelated renders and
  re-render every cell: STOP and report with the offending dep.
- Any render-count test moves — STOP (see Step 3).
- `useDataGridCellTypes` turns out to be called by OTHER components in the hot path
  with per-column args (read the hook's signature before removing it from cell.tsx —
  if it takes args, the "stable reference" premise is wrong; STOP).

## Maintenance notes

- The root context is now the delivery channel for everything a cell needs that is
  grid-stable (layout, className hooks, actions, cellTypes, interaction handlers,
  direction) — a future "the cell needs grid-stable value X" change should extend
  this context, NOT add a per-cell store subscription. The :156-163 comment is the
  design rationale; keep it current.
- Reviewers: the dependency array of the root `useMemo` is the load-bearing detail —
  a future field added without its (stable) dep would either churn the value (all
  cells re-render) or go stale (cells read old actions). Both are visible in the
  render-count tests, which is why Step 3's "identical numbers" check exists.
