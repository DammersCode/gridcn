# Plan 003: Rect-scope copy respects `MAX_COPY_CELLS`

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If anything
> in the "STOP conditions" section occurs, stop and report — do not improvise. When
> done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 037d895..HEAD -- registry/default/blocks/data-grid/clipboard/use-grid-clipboard.ts registry/default/blocks/data-grid/clipboard/use-grid-clipboard.copy-cap.test.ts`
> If either changed, compare against the "Current state" excerpts; on a mismatch, STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW (truncation is already the accepted copy semantics for the other scopes)
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `037d895`, 2026-09-03

## Why this matters

`serializeCopyScope` caps the `rows` and `columns` copy scopes at `MAX_COPY_CELLS`
(200_000 cells), but the `rect` scope is uncapped — justified in its comment as
"bounded by what the user dragged". Two-stage Ctrl+A (select-all progression)
produces a whole-grid RECT selection, so Ctrl+A + Ctrl+C on a 100k-row grid serializes
~2M cells (2M `toText`/`getCellValue` calls + a multi-MB TSV/HTML string build) inside
the `copy` event handler — a tab freeze the cap's own doc comment says it exists to
prevent ("bounding the worst case (a Ctrl+A copy on a 100k-row grid) to a few
seconds").

## Current state

- `registry/default/blocks/data-grid/clipboard/use-grid-clipboard.ts:59-66` —
  `serializeRect` (uncapped row loop over `serializeRowSlice`).
- `:68-75` — `MAX_COPY_CELLS` + its doc comment (the rationale to preserve).
- `:124-140` — `serializeCopyScope`:

```ts
/**
 * ... "rows" and "columns" scopes are capped at {@link MAX_COPY_CELLS}; "rect" (an
 * explicit drag-selected range) is left uncapped since its size is already visually
 * bounded by what the user dragged.
 */
export function serializeCopyScope(s: DataGridStoreState, scope: CopyScope): string[][] {
  if (scope.kind === "rect") return serializeRect(s, scope.rect);   // <- uncapped
  if (scope.kind === "rows") { ... serializeDisjointRows (capped at :92-93) ... }
  return serializeDisjointRows(s, allViewRows(s), scope.columns);
}
```

- `:92-93` — the existing cap mechanics to mirror:
  `const maxRows = cols.length === 0 ? rows.length : Math.max(1, Math.floor(MAX_COPY_CELLS / cols.length));`
- `registry/default/blocks/data-grid/selection/select-all-progression.ts:91-103` —
  two-stage Ctrl+A ends with a whole-grid rect (`selectionForRect(wholeGrid, active)`);
  this is why the "visually bounded" rationale fails.
- `registry/default/blocks/data-grid/clipboard/use-grid-clipboard.copy-cap.test.ts:100`
  — the guard that today ASSERTS rect scope is not capped (must be flipped).
- Fidelity guard that must stay green: `clipboard/parse-clipboard-diff.test.ts`
  (diffs serialized output against reference spreadsheets — it exercises SMALL grids,
  far below the cap, so truncation never touches it; verify that premise by reading
  its data size before shipping).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests (filter) | `pnpm test -- clipboard` | exit 0 |
| Tests (full) | `pnpm test` | exit 0 |
| Typecheck | `pnpm types:check` | exit 0 |
| Lint | `pnpm lint` | exit 0 |
| Registry rebuild | `pnpm registry:build && pnpm registry:verify` | exit 0 |

## Scope

**In scope:**
- `registry/default/blocks/data-grid/clipboard/use-grid-clipboard.ts`
- `registry/default/blocks/data-grid/clipboard/use-grid-clipboard.copy-cap.test.ts`

**Out of scope:**
- The paste cap (plan 002), `serializeDisjointRows` internals, TSV/HTML serialization
  (`serialize-cells.ts`), the copy cap's value itself

## Git workflow

- Branch `fix/003-rect-copy-cap` or `dev`; conventional commits (e.g.
  `fix(clipboard): cap rect-scope copy at MAX_COPY_CELLS`). No co-author trailer.
  Do not push.

## Steps

### Step 1: Cap the rect branch

In `serializeCopyScope`, apply the same row-truncation to the rect branch (mirror the
:92-93 arithmetic, using `scope.rect.width` as the column count):

```ts
if (scope.kind === "rect") {
  const maxRows = Math.max(1, Math.floor(MAX_COPY_CELLS / Math.max(1, scope.rect.width)));
  return serializeRect(s, { ...scope.rect, height: Math.min(scope.rect.height, maxRows) });
}
```

(Below the cap the rect is byte-identical to today's output — the cap only binds
above 200k cells.)

**Verify**: `pnpm types:check` → exit 0.

### Step 2: Update the rationale comment

Replace the :124-129 doc comment: all three scopes are capped at `MAX_COPY_CELLS`;
note that two-stage Ctrl+A produces a whole-grid rect (cite
`selection/select-all-progression.ts`) so the rect scope needs the cap exactly like
the others. Keep the existing precedent sentence about the cap's purpose.

**Verify**: `pnpm lint` → exit 0.

### Step 3: Flip the guard test + add the whole-grid case

In `use-grid-clipboard.copy-cap.test.ts`:
- Find the test at ~line 100 that asserts rect scope is uncapped (search for
  "rect") and flip it: a rect larger than `MAX_COPY_CELLS / width` rows truncates to
  exactly `floor(MAX_COPY_CELLS / width)` rows, top-down.
- Add the whole-grid case: fakeState with enough rows (use a small `MAX_COPY_CELLS`
  override if the export permits parameterization — if not, build a rect with
  `height` set so `height × width > MAX_COPY_CELLS` using the real constant and a
  matching fakeState row count; 200k fake rows is fine for a pure serialization
  test if fast, otherwise construct the rect mathematically without materializing
  200k rows — `serializeRect` reads `s.viewIndex`/`s.data` per row, so the fakeState
  MUST contain the rows; if materializing 200k rows is slow (>10s), keep the test at
  the smallest width where the cap binds and assert the row count, not the content).
- Keep the existing below-cap byte-identity tests untouched.

**Verify**: `pnpm test -- clipboard` → green, incl. the fidelity diff test
(`parse-clipboard-diff.test.ts` — confirm it still passes; see STOP conditions).

### Step 4: Full gate

**Verify**: `pnpm test` exit 0; `pnpm lint` exit 0; `pnpm registry:build &&
pnpm registry:verify` exit 0.

## Test plan

- Updated: the rect-cap guard (Step 3), whole-grid case (Step 3).
- Untouched: all rows/columns-scope cap tests, `parse-clipboard-diff.test.ts`.

## Done criteria

- [ ] `pnpm test` exits 0; rect-scope copy above the cap truncates top-down
- [ ] `git diff` shows the flipped assertion at copy-cap.test.ts:~100 and the new case
- [ ] Ctrl+A + Ctrl+C on a 100k-row grid is bounded to ≤200k cells (asserted by test, not by hand)
- [ ] `pnpm registry:build && pnpm registry:verify` exit 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated to DONE + commit SHA

## STOP conditions

- `parse-clipboard-diff.test.ts` fails — it would mean the diff fixture is above the
  cap (unexpected; read its data size). Do not relax the fixture to fit the cap.
- `CopyScope`'s rect variant does not expose `width`/`height` as planned (read the
  type first — the shape may differ; adapt the arithmetic, not the semantics).

## Maintenance notes

- All three copy scopes now share one cap constant — a future "cap by bytes instead
  of cells" change must touch all three branches (or better, centralize the
  truncation in one helper and have the branches call it).
- Reviewers: check that the truncation is top-down (keeps the anchor rows) — bottom-up
  truncation would copy the WRONG end of a whole-grid selection.
