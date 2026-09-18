# Plan 001: `computeRowEditsBatch` resolves columns by id in O(1)

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If anything
> in the "STOP conditions" section occurs, stop and report — do not improvise. When
> done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 037d895..HEAD -- registry/default/blocks/data-grid/store/commit.ts registry/default/blocks/data-grid/store/create-store.ts`
> If either file changed, compare the "Current state" excerpt against the live code;
> on a mismatch, STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `037d895`, 2026-09-03

## Why this matters

`computeRowEditsBatch` is the single funnel for every bulk cell write in the grid:
`deleteSelection` (whole-grid delete), `applyCellUpdates` (paste, fill, streaming
streams), and the async validation path all build a per-cell write list and pass it
here. Today it resolves each write's column with a linear
`s.visibleColumns.find((c) => c.id === write.columnId)` — per WRITE. A full-grid
delete on the reference workload (100k rows × 20 columns) is 2M writes × 20 scans ≈
40M comparisons before a single row is touched. This is the shared root cause of the
two new HIGH perf findings; plan 002 adds the bounds on top of this fix.

## Current state

- `registry/default/blocks/data-grid/store/commit.ts:141-168` — `computeRowEditsBatch`:

```ts
export function computeRowEditsBatch(
  s: DataGridStoreState,
  writes: { viewRow: number; columnId: string; value: unknown }[],
): { nextData: readonly unknown[]; ops: DataOp<unknown>[] } | null {
  const rowEdits = new Map<number, RowEdit>();

  for (const write of writes) {
    const dataRowIndex = s.viewIndex[write.viewRow];
    if (dataRowIndex === undefined) continue;
    const column = s.visibleColumns.find((c) => c.id === write.columnId);   // <- O(cols) per write
    if (!column) continue;
    // ... dedupe (Map rowEdits), readOnly skip, Object.is no-op skip, setCellValue ...
  }
```

- Precedent for the hoisted map (same shape, different purpose):
  `registry/default/blocks/data-grid/store/create-store.ts:641` — `applyCellUpdates`
  already builds `const idByCol = new Map(s.visibleColumns.map((c, i) => [c.id, i]))`
  for its selection math. Column ids are unique (dev guardrail warns on duplicates —
  PLAN.md §4.2), so a `Map<id, column>` is total.
- Convention: pure module, unit-tested, colocated tests
  (`commit.test.*` exists next to the file — extend it).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests (filter) | `pnpm test -- commit` | exit 0, commit tests matched |
| Tests (full) | `pnpm test` | exit 0 |
| Typecheck | `pnpm types:check` | exit 0 |
| Lint | `pnpm lint` | exit 0 |
| Registry rebuild | `pnpm registry:build && pnpm registry:verify` | exit 0 |

## Scope

**In scope:**
- `registry/default/blocks/data-grid/store/commit.ts`
- `registry/default/blocks/data-grid/store/commit.test.*` (colocated test file — find it via `glob registry/default/blocks/data-grid/store/*.test.*`)

**Out of scope (do NOT touch, even though they look related):**
- `deleteSelection`'s write-materialization loop (create-store.ts:597-616) — plan 002
- the paste path (use-grid-clipboard.ts) — plan 002
- the `idByCol` map at create-store.ts:641 — different map (id→index), already O(1)
- any change to `DataOp` / `RowEdit` shapes or op ordering — this plan is a
  lookup-only change; op output must be byte-identical

## Git workflow

- Work on `dev` (or branch `fix/001-hoist-column-map` if the operator prefers); commit
  per step with conventional messages (e.g. `perf(store): hoist column lookup in
  computeRowEditsBatch`). No co-author trailer. Do not push.

## Steps

### Step 1: Hoist the map

In `computeRowEditsBatch`, before the write loop, build:

```ts
const columnById = new Map(s.visibleColumns.map((column) => [column.id, column] as const));
```

and replace the `.find` with `const column = columnById.get(write.columnId);`
(keep the `if (!column) continue;` guard — it still protects against writes naming a
hidden/removed column).

**Verify**: `pnpm types:check` → exit 0.

### Step 2: Correctness regression test (behavior is identical)

In the colocated commit test file, add a case mirroring the existing
`computeRowEditsBatch` tests (use one as the structural pattern): a mixed write list —
duplicate writes to the same row/column (last wins, `prev` = value before the batch),
a readOnly column write (skipped), a no-op write (Object.is equal, skipped), a write
to an unresolvable viewRow — asserting the produced `ops` array matches expectations
exactly (same shape as the existing assertions in that file).

**Verify**: `pnpm test -- commit` → all pass, including the new case.

### Step 3: Timing-guard test (the regression this plan exists to prevent)

Model on `registry/default/blocks/data-grid/sort-filter/view-index-perf.test.ts`
(read its ceiling style first — it asserts wall-clock ceilings on synthetic large
data, not constants). New test in the same file location pattern (a
`commit-perf.test.ts` next to the module): build 100k rows × 20 columns (cheap
literal data), generate 200k writes spanning all rows, run `computeRowEditsBatch`,
assert wall-clock time below a ceiling. Measure the time on the NEW code first, set
the ceiling at ~5× that (order-of-magnitude guard, per the view-index-perf style).

**Verify**: `pnpm test -- commit-perf` → passes. Re-run once more to confirm it is not
flakey on this machine.

### Step 4: Full gate

**Verify**: `pnpm test` → exit 0; `pnpm lint` → exit 0;
`pnpm registry:build && pnpm registry:verify` → exit 0 (the module ships in the core
payload).

## Test plan

- New: correctness case (Step 2), timing guard (Step 3) — both in the colocated test
  files under `registry/default/blocks/data-grid/store/`.
- Existing `store.test.tsx` delete/paste tests must pass untouched (they are the
  behavior-invariance proof).

## Done criteria

- [ ] `pnpm types:check` exits 0
- [ ] `pnpm test` exits 0, incl. the new correctness + timing tests
- [ ] `grep -n "visibleColumns.find" registry/default/blocks/data-grid/store/commit.ts` returns no matches
- [ ] `pnpm registry:build && pnpm registry:verify` exit 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated to DONE + commit SHA

## STOP conditions

- The `.find` at commit.ts:150 is gone or its surroundings differ from the excerpt
  (drift).
- Step 2's op assertions cannot be made identical to the pre-change output (run
  `git stash` and capture the old output for the same input if in doubt) — that means
  the hoist changed semantics; report.
- Column ids turn out to be non-unique in any test fixture (the dev guardrail should
  warn — if it doesn't, report instead of picking a `.find` fallback).

## Maintenance notes

- Plan 002's guards depend on this map being the only column resolution in the write
  path — future bulk write paths (e.g. a future row-delete op) must reuse
  `computeRowEditsBatch`, never re-introduce per-write `.find`.
- Reviewers: check that any new caller of `computeRowEditsBatch` passes writes with
  view-space `viewRow` (the `viewIndex` indirection at the top of the loop is the
  data/view-space boundary — PLAN.md §4.3 coordinate rule).
