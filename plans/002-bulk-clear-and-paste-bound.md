# Plan 002: Bound the full-selection delete and the tiled paste

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If anything
> in the "STOP conditions" section occurs, stop and report — do not improvise. When
> done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 037d895..HEAD -- registry/default/blocks/data-grid/store/create-store.ts registry/default/blocks/data-grid/clipboard/use-grid-clipboard.ts`
> If either file changed, compare the "Current state" excerpts against the live code;
> on a mismatch, STOP. (Plan 001 may already have landed in
> `store/commit.ts` — that is expected and fine.)

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (op semantics and the one-`onDataChange`-per-gesture invariant must hold)
- **Depends on**: 001 (timing guards measure against the map-based write loop)
- **Category**: perf
- **Planned at**: commit `037d895`, 2026-09-03

## Why this matters

Two HIGH findings from the 2026-09-03 audit, both at the reference workload
(100k rows × 20 columns):

1. **Full-selection delete is unbounded.** `deleteSelection`
   (create-store.ts:597-616) materializes one write object per selected cell — a
   whole-row/whole-column/whole-grid selection expands to ~2M writes — and the inner
   loop calls `cellType.clearValue(column.options)` per cell (2M calls) to build each
   value. With plan 001's O(1) column lookup the rest is linear, but the 2M
   `clearValue` calls and 2M write objects remain pure overhead: the same clear value
   is computed once per column and reused for every row.
2. **Pasting into a large range is unbounded.** `applyParsedPaste`
   (use-grid-clipboard.ts:250-279) tiles a single pasted row down to the target range
   height (`tileToHeight`, :154-157; height = current range height via `targetHeight`,
   :176-179). Two-stage Ctrl+A makes the range the whole grid, so pasting 1×20 tiles to
   100k rows → ~2M candidates (each a `getRowId` call + `fromText` parse) → ~2M writes.
   `MAX_COPY_CELLS` (:75) bounds copies; nothing bounds pastes. A partial paste that is
   not surfaced would be a silent data-loss-class bug — the cap must truncate
   predictably (first rows kept, the anchor is the target's top-left) and warn in dev.

## Current state

- `registry/default/blocks/data-grid/store/create-store.ts:597-616` — `deleteSelection`:

```ts
deleteSelection() {
  const s = get();
  if (s.readOnly) return;
  const rects = selectionRects(s.selection, s.viewIndex.length, s.visibleColumns.length);
  if (rects.length === 0) return;

  const writes: { viewRow: number; columnId: string; value: unknown }[] = [];
  for (const rect of rects) {
    for (let viewRow = rect.y; viewRow < rect.y + rect.height; viewRow++) {
      for (let col = rect.x; col < rect.x + rect.width; col++) {
        const column = s.visibleColumns[col];
        if (!column) continue;
        const cellType = s.cellTypes[column.type ?? "text"];
        if (!cellType) continue;
        writes.push({ viewRow, columnId: column.id, value: cellType.clearValue(column.options) });
      }
    }
  }

  const batch = computeRowEditsBatch(s, writes);   // commit.ts — O(1) column lookup after plan 001
  // ... one onDataChange + set() — the batch invariant this plan must preserve ...
```

- `registry/default/blocks/data-grid/clipboard/use-grid-clipboard.ts:149-158` —
  `tileToHeight` is "Exported for direct unit testing; not part of the public hook
  surface" — the precedent for extracting a testable pure helper.
- `registry/default/blocks/data-grid/clipboard/use-grid-clipboard.ts:250-279` —
  `applyParsedPaste` pipeline: parse (done by caller) → `tileToHeight` →
  `processPaste` hook (consumer may reshape; returns `false` to veto) →
  `buildPasteCandidates` → `resolveBulkWrites` → single `applyCellUpdates("paste")`.
- `registry/default/blocks/data-grid/is-dev.ts` — dev-only guard, the repo's
  dev-guardrail pattern (PLAN.md §4.2).
- Existing tests that must stay green untouched: `test/store.test.tsx:1270-1288`
  (delete = one onDataChange + one ops batch), `clipboard/use-data-grid-clipboard.test.tsx:120-220`
  (paste supersede/one-batch), `clipboard/use-grid-clipboard.copy-cap.test.ts`
  (cap behavior for copy).
- `MAX_COPY_CELLS` doc comment (:68-74) records the accepted truncation semantics:
  "truncated to the rows that fit — no spreadsheet accepts a clipboard payload this
  large anyway". Paste truncation follows the same surface decision (silent + dev
  warn; a UI label is a later add-on concern — the io add-on's `previewTruncated`
  label at `labels.ts:177` is the model if one is ever wanted).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests (filter) | `pnpm test -- clipboard` | exit 0 |
| Tests (filter) | `pnpm test -- store` | exit 0 |
| Tests (full) | `pnpm test` | exit 0 |
| Typecheck | `pnpm types:check` | exit 0 |
| Lint | `pnpm lint` | exit 0 |
| Registry rebuild | `pnpm registry:build && pnpm registry:verify` | exit 0 |

## Scope

**In scope:**
- `registry/default/blocks/data-grid/store/create-store.ts` (deleteSelection only)
- `registry/default/blocks/data-grid/clipboard/use-grid-clipboard.ts` (cap only)
- Colocated test files for both (+ a new `delete-perf` guard file if the store
  fixture pattern makes a separate file natural — match the repo's colocated layout)

**Out of scope:**
- `computeRowEditsBatch` internals (plan 001's territory)
- `DataOp` / `RowEdit` shapes, op ordering, `onDataChange` signature — the batch
  invariant (one onDataChange, one ops array per gesture) is load-bearing and must be
  byte-identical in shape
- `tileToHeight` semantics, `processPaste` hook contract, copy-side cap

## Git workflow

- Branch `fix/002-bulk-clear-paste-bound` or `dev`; conventional commits per step
  (`fix(store): hoist clearValue in deleteSelection`, `fix(clipboard): cap the tiled
  paste target`). No co-author trailer. Do not push.

## Steps

### Step 1: Hoist `clearValue` out of the delete row loop

In `deleteSelection`, before the rect loops, resolve each visible column's clear value
ONCE:

```ts
const resolvedCols = s.visibleColumns.map((column) => {
  const cellType = s.cellTypes[column.type ?? "text"];
  return cellType ? { columnId: column.id, value: cellType.clearValue(column.options) } : null;
});
```

Inner loop becomes `const rc = resolvedCols[col]; if (!rc) continue;
writes.push({ viewRow, columnId: rc.columnId, value: rc.value });`. The write list,
`computeRowEditsBatch` call, `ops`, and the `set()` are otherwise untouched.

**Verify**: `pnpm test -- store` → exit 0, `store.test.tsx:1270-1288` (delete batch
invariant) green untouched.

### Step 2: Delete timing guard

Model on `sort-filter/view-index-perf.test.ts` (ceiling style) and the store fixture
pattern in `test/store.test.tsx` (read how it builds a store with N rows — reuse that
helper, do not hand-roll a parallel fixture). New test: 100k rows × 20 columns,
whole-grid selection (two-stage Ctrl+A state, or `selectionRects`'s input directly),
call `actions.deleteSelection()`, assert (a) exactly one `onDataChange` call with one
ops batch (same assertion style as store.test.tsx:1270-1288), (b) wall-clock ceiling —
measure first, set ceiling at ~5×.

**Verify**: `pnpm test -- store` → green; run twice to confirm it is not flakey.

### Step 3: Extract a testable paste-truncation helper

Next to `tileToHeight` in use-grid-clipboard.ts, add (exported for direct unit testing,
same doc-comment style):

```ts
/** Max cells a single paste may touch — same rationale/precedent as MAX_COPY_CELLS. */
export const MAX_PASTE_CELLS = 200_000;

/** Truncates a paste grid to the first rows that fit under `maxCells` (row-summed).
 *  Below the cap it returns the input unchanged (same reference when possible). */
export function truncatePasteGrid(cells: string[][], maxCells: number): string[][];
```

Keep the FIRST rows (the paste anchor is the target's top-left — dropping head rows
would silently skip the user's intended first rows). Ragged rows are row-summed
(`reduce` over `row.length`).

**Verify**: `pnpm types:check` → exit 0.

### Step 4: Apply the cap in `applyParsedPaste` + dev warn

After `finalCells` is computed (i.e. AFTER `processPaste`, so a consumer hook cannot
re-expand a capped grid past the bound):

```ts
const capped = truncatePasteGrid(finalCells, MAX_PASTE_CELLS);
if (capped.length < finalCells.length) {
  if (isDev()) console.warn(`gridcn: paste truncated to ${capped.length} of ${finalCells.length} rows (MAX_PASTE_CELLS)`);
}
const candidates = buildPasteCandidates(s, capped, target);
```

**Verify**: `pnpm test -- clipboard` → exit 0, incl. the existing one-batch paste tests.

### Step 5: Paste cap tests

- Unit (pure, model on `use-grid-clipboard.copy-cap.test.ts`'s structure):
  `truncatePasteGrid` — below cap returns identical content; at/over cap keeps the
  first rows; ragged row-summing.
- Hook-level (extend `use-data-grid-clipboard.test.tsx`): fakeState with a 100k-row
  range selection (the fakeState pattern from the copy-cap test builds the store
  state; `viewIndex` identity array), paste 1 row × 20 cols → assert the resulting
  writes/candidates cover only the first `MAX_PASTE_CELLS / 20` rows and that
  `console.warn` was called (vi.spyOn). The one-`applyCellUpdates` invariant must hold
  (the existing assertion style at :120-220).

**Verify**: `pnpm test -- clipboard` → green.

### Step 6: Full gate

**Verify**: `pnpm test` exit 0; `pnpm lint` exit 0; `pnpm types:check` exit 0;
`pnpm registry:build && pnpm registry:verify` exit 0.

## Test plan

- New: delete timing guard (Step 2), `truncatePasteGrid` unit cases (Step 5),
  hook-level capped-paste + warn (Step 5).
- Must stay green untouched: `store.test.tsx:1270-1288` (delete one-batch),
  `use-data-grid-clipboard.test.tsx:120-220` (paste supersede/one-batch),
  `copy-cap.test.ts` (copy cap semantics unchanged).

## Done criteria

- [ ] `pnpm test` exits 0 incl. the new guards; one-batch invariants green
- [ ] Whole-grid delete at 100k×20 is under its ceiling (order-of-magnitude faster than pre-001+002; the guard proves it)
- [ ] 1×20 paste into a 100k-row range is truncated to the cap, warns in dev, keeps head rows
- [ ] `pnpm registry:build && pnpm registry:verify` exit 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated to DONE + commit SHA

## STOP conditions

- The delete one-batch assertion (store.test.tsx:1270-1288) fails after Step 1 — the
  hoist changed op output; report with the diff instead of "fixing" the test.
- `processPaste` tests show a consumer hook relying on receiving an UNTILED/uncapped
  grid — check `test/` for `processPaste` usage first (Step 4 order was chosen so the
  hook sees the tiled-but-uncapped grid; if a test pins otherwise, report).
- The store fixture pattern in store.test.tsx cannot build 100k rows within a
  reasonable test budget (>30s to set up) — use 50k and halve the ceiling
  proportionally, and note the deviation in the test comment.

## Maintenance notes

- `MAX_PASTE_CELLS` and `MAX_COPY_CELLS` are deliberate siblings; if one is tuned,
  review the other and the doc comment that cross-references the precedent.
- If a UI surfacing for the paste truncation is ever wanted (toast/label), the io
  add-on's `previewTruncated` label pattern (labels.ts:177) is the model — keep core
  dependency-free (PLAN.md §8 modularity).
- Reviewers: the cap sits AFTER `processPaste` on purpose — a future hook change that
  moves truncation before the hook would let consumers re-expand past the bound.
