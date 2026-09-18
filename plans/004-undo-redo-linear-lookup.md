# Plan 004: `applyChange` applies undo/redo ops in O(n + k log k)

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If anything
> in the "STOP conditions" section occurs, stop and report — do not improvise. When
> done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 037d895..HEAD -- registry/default/blocks/data-grid/interaction/history.ts registry/default/blocks/data-grid-history/use-data-grid-history.ts`
> If either changed, compare against the "Current state" excerpts; on a mismatch, STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (undo/redo semantics — vanished-row skip, insert ordering, id-keying — must be byte-identical)
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `037d895`, 2026-09-03

## Why this matters

Undo/redo re-applies a batch by locating each op's row. `applyChange`
(interaction/history.ts:52-83) runs `result.findIndex((row) => getRowId(row) ===
op.rowId)` per update/delete op, and the `getRowId` it receives
(use-data-grid-history.ts:88) does `dataRef.current.indexOf(row)` — O(n) — for EVERY
row examined. One op whose row sits near the end (or has vanished → full scan) costs
~n×n element comparisons; a k-op undo on n rows approaches k·n². Undoing a 1,000-row
import on a 100k-row grid is a multi-second main-thread freeze. Small undos near the
top of the data match early and stay cheap — which is why normal use never shows it
and no test catches it (`history.test.ts` uses ≤5-row arrays).

## Current state

- `registry/default/blocks/data-grid/interaction/history.ts:52-83` — `applyChange`:

```ts
export function applyChange<TData>(
  data: readonly TData[],
  change: DataChange<TData>,
  getRowId: (row: TData) => string,
): TData[] {
  let result = data.slice();
  const inserts: Extract<DataOp<TData>, { type: "insert" }>[] = [];
  for (const op of change.ops) {
    switch (op.type) {
      case "update": {
        const idx = result.findIndex((row) => getRowId(row) === op.rowId);   // O(n) per op
        if (idx === -1) break;
        result[idx] = op.row;
        break;
      }
      case "delete": {
        const idx = result.findIndex((row) => getRowId(row) === op.rowId);   // O(n) per op
        if (idx === -1) break;
        result = result.slice(0, idx).concat(result.slice(idx + 1));          // O(n) per delete
        break;
      }
      case "insert":
        inserts.push(op);
        break;
    }
  }
  for (const op of [...inserts].sort((a, b) => a.index - b.index)) {
    const at = Math.min(op.index, result.length);
    result = result.slice(0, at).concat([op.row], result.slice(at));          // O(n) per insert
  }
  return result;
}
```

  Semantics pinned by the doc comment at :36-51 and by `history.test.ts`: ops are
  id-keyed; a vanished rowId is skipped silently (PLAN.md §11a: "History skips ops
  whose row ids vanished — silently, by design"); op indices are SNAPSHOT positions
  (positions in the pre-batch array); inserts apply in ascending-index order.
- `registry/default/blocks/data-grid-history/use-data-grid-history.ts:86-88`:

```ts
  // applyChange (core) only takes a 1-arg getRowId; it re-derives each row's real index via its own
  // findIndex scan over dataRef.current, so an index-based getRowId still resolves correctly here.
  const findRowId = useCallback((row: TData) => getRowIdRef.current(row, dataRef.current.indexOf(row)), []);
```

  The `indexOf` exists so an INDEX-BASED `getRowId(row, index)` (rowId = the index)
  resolves correctly; it fires for every row examined even for id-based getRowIds.
- Test exemplars: `registry/default/blocks/data-grid/interaction/history.test.ts`
  (semantic cases — vanished ids, insert ordering, round-trips through
  `invertChange`), and `registry/default/blocks/data-grid/sort-filter/view-index-perf.test.ts`
  (timing-ceiling style for the new scale guard).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests (filter) | `pnpm test -- history` | exit 0 |
| Tests (full) | `pnpm test` | exit 0 |
| Typecheck | `pnpm types:check` | exit 0 |
| Lint | `pnpm lint` | exit 0 |
| Registry rebuild | `pnpm registry:build && pnpm registry:verify` | exit 0 |

## Scope

**In scope:**
- `registry/default/blocks/data-grid/interaction/history.ts`
- `registry/default/blocks/data-grid-history/use-data-grid-history.ts`
- `registry/default/blocks/data-grid/interaction/history.test.ts` (extend; the
  characterization fuzz lives here)

**Out of scope:**
- `createHistory`/`invertChange` (stack management and op inversion are already O(1)/O(k))
- the store's write path (`onDataChange` op emission) — this plan only changes how
  an already-emitted change is RE-APPLIED
- any change to `DataOp`/`DataChange` shapes

## Git workflow

- Branch `fix/004-undo-redo-linear` or `dev`; conventional commits per step
  (`test(history): characterization fuzz for applyChange ordering`,
  `perf(history): O(n + k log k) applyChange`). No co-author trailer. Do not push.

## Steps

### Step 1: Characterization fuzz (MANDATORY — do this first)

Copy the CURRENT `applyChange` body verbatim into `history.test.ts` as
`applyChangeLegacy` (it must stay bit-identical to the committed implementation —
copy it from the drift-checked file, do not retype). Add a fuzz test:

- Seeded PRNG (fixed seed; a 3-line mulberry32-style helper in the test file is
  fine — do not add a dependency).
- 500 iterations: random `data` (n ∈ [1, 500], ids drawn from a pool of ~n/2 ids so
  duplicates and vanished-ids occur), random ops (k ∈ [0, 80]: updates referencing
  present/absent rowIds, deletes same, inserts with `index` ∈ [0, n+5] — indices
  ABOVE n exercise the clamp), some ops repeated.
- Assert `applyChange(data, change, idFn)` deep-equals
  `applyChangeLegacy(data, change, idFn)` for every iteration.
- Run it against the UNCHANGED implementation first (it must pass trivially — it is
  the same code) so the generator is proven to produce cases the implementation
  accepts.

**Verify**: `pnpm test -- history` → green, 500/500 iterations.

### Step 2: Rewrite `applyChange`

Replace the body (same signature, same doc comment — update only the complexity
line):

```ts
export function applyChange<TData>(data, change, getRowId) {
  // one rowId -> index map per call: update/delete ops are O(1) lookups, not scans.
  const indexById = new Map<string, number>();
  for (let i = 0; i < data.length; i++) indexById.set(getRowId(data[i]!), i);

  const updateById = new Map<string, TData>();          // last update wins (matches sequential findIndex)
  const deleteIndices = new Set<number>();
  const inserts: Extract<DataOp<TData>, { type: "insert" }>[] = [];
  for (const op of change.ops) {
    if (op.type === "insert") { inserts.push(op); continue; }
    const idx = indexById.get(op.rowId);
    if (idx === undefined) continue;                    // vanished row: skip silently (PLAN §11a)
    if (op.type === "update") updateById.set(op.rowId, op.row);
    else deleteIndices.add(idx);
  }

  // Single-pass: updates applied in place (unless the row is deleted — then the delete wins,
  // exactly like the sequential code where the later delete removes the updated row).
  const postDelete: TData[] = [];
  for (let i = 0; i < data.length; i++) {
    if (deleteIndices.has(i)) continue;
    postDelete.push(updateById.get(/* the row's id */ indexById.get(idOf(i))!) ?? data[i]!);
  }
```

  (The `updateById` keying needs the row's id — build `idByIndex: string[]` alongside
  `indexById` in the first loop; that is the cleanest wiring. Update-then-delete of
  the same rowId must drop the row: the delete check comes first in the pass above.
  Delete-then-update of the same rowId (a degenerate op list) must also drop the row
  — in the sequential code the update's `findIndex` runs against the array that
  still contains the row (updates and deletes both key off the ORIGINAL scan order in
  the same loop, so a delete later in `ops` removes a row an earlier update wrote to,
  and an update later in `ops` re-finds a row an earlier delete removed only if the
  delete hadn't processed yet — verify BOTH orderings against the fuzz before
  shipping; if the fuzz shows an ordering the simple pass gets wrong, STOP.)

```ts
  // Inserts: reproduce the sequential ascending application EXACTLY.
  // Sequential fact: an insert applied at position p pushes every later element (including
  // later inserts landing at >= p) right by one; two inserts at the SAME position end up in
  // the REVERSE of their application order (the later one lands on top). The sequential order
  // is the stable ascending sort of `inserts` — so the single-pass merge emits, at each
  // output position p, the queued inserts with index <= p, each equal-index run in REVERSE
  // (stable-sorted) order.
  const sorted = [...inserts].sort((a, b) => a.index - b.index);   // stable
  const out: TData[] = [];
  let qi = 0;
  for (let p = 0; p < postDelete.length; p++) {
    while (qi < sorted.length && sorted[qi]!.index <= p) {
      let j = qi;
      while (j < sorted.length && sorted[j]!.index === sorted[qi]!.index) j++;
      for (let t = j - 1; t >= qi; t--) out.push(sorted[t]!.row);
      qi = j;
    }
    out.push(postDelete[p]!);
  }
  while (qi < sorted.length) {                                    // clamped inserts (index > length)
    let j = qi;
    while (j < sorted.length && sorted[j]!.index === sorted[qi]!.index) j++;
    for (let t = j - 1; t >= qi; t--) out.push(sorted[t]!.row);
    qi = j;
  }
  return out;
}
```

  **The fuzz from Step 1 is the acceptance test for this step** — re-run it with
  `applyChangeLegacy` still in the file. 500/500 deep-equal is the done condition for
  the rewrite; if any iteration diverges, do NOT patch the algorithm ad hoc — capture
  the minimal diverging case (data length, ops) into a plain `it(...)` and report.

**Verify**: `pnpm test -- history` → green, fuzz included.

### Step 3: Remove the O(n) `indexOf` from `findRowId`

With `applyChange` building its own map (calling `getRowId(row)` with the loop
index available at map-build time — pass a 1-arg getRowId that receives the index
from the MAP BUILD, i.e. change `applyChange`'s `getRowId` parameter to
`(row: TData, index: number) => string` and update the doc comment accordingly),
`findRowId` simplifies to:

```ts
const findRowId = useCallback((row: TData, index: number) => getRowIdRef.current(row, index), []);
```

Check every `applyChange` call site (grep `applyChange(`) and update signatures.

**Verify**: `pnpm types:check` → exit 0; `pnpm test -- history` → green.

### Step 4: Scale timing guard

In `history.test.ts` (or a `history-perf.test.ts` alongside — match the repo layout):
100k-row array (cheap literals), a 500-op batch with updates/deletes/inserts
scattered through the END half of the array (worst case for the old code), assert
`applyChange` wall-clock under a ceiling (measure on the new code first, ~5× ceiling,
view-index-perf style).

**Verify**: `pnpm test -- history` → green; run twice (flake check).

### Step 5: Full gate

**Verify**: `pnpm test` exit 0; `pnpm lint` exit 0; `pnpm types:check` exit 0;
`pnpm registry:build && pnpm registry:verify` exit 0 (both files ship: core `data-grid`
payload and the `data-grid-history` add-on payload).

## Test plan

- New: characterization fuzz (Step 1 — KEEP in the repo permanently as a regression
  guard), scale timing guard (Step 4).
- Untouched: every existing `history.test.ts` case (vanished-row skip, insert
  ordering, `invertChange` round-trips) and the `use-data-grid-history` hook tests.

## Done criteria

- [ ] `pnpm test` exits 0, incl. fuzz (500 iterations) + scale guard
- [ ] `grep -n "findIndex" registry/default/blocks/data-grid/interaction/history.ts` returns no matches
- [ ] `grep -n "indexOf" registry/default/blocks/data-grid-history/use-data-grid-history.ts` returns no matches
- [ ] `pnpm registry:build && pnpm registry:verify` exit 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated to DONE + commit SHA

## STOP conditions

- The Step 1 fuzz fails on the UNCHANGED implementation (generator bug) — fix the
  generator, not the code.
- Any fuzz iteration diverges in Step 2 after a genuine (non-generator) attempt —
  reduce it to a minimal case and report; the sequential-ordering model in the plan
  may be incomplete for a degenerate op ordering the repo's emitter can actually
  produce (check `commit.ts` op emission before concluding it's unreachable).
- `applyChange` has other call sites beyond the history add-on (grep found them) —
  each caller's `getRowId` arity/semantics must be reconciled; if any caller passes
  an id function whose identity depends on array order in a way the map breaks, STOP.

## Maintenance notes

- The fuzz is the load-bearing guard for this function's semantics — keep it when
  refactoring; it is cheap (500 small cases) and catches exactly the class of bug
  this rewrite class has.
- The `index` convention (snapshot positions) is documented in the doc comment and is
  what makes the insert merge correct — a future emitter change (e.g. running
  "log-time" indices) invalidates the merge; the fuzz would not catch it if the
  emitter and applier drift together, so review any op-emission change against this
  file's comment.
- Reviewers: `updateById` last-write-wins and the delete-wins-over-update rule are
  the two subtle semantics — the existing history.test.ts cases plus the fuzz pin them.
