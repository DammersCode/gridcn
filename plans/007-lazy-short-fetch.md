# Plan 007: Lazy rows — a short `fetchRows` resolution must not mark the range complete

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If anything
> in the "STOP conditions" section occurs, stop and report — do not improvise. When
> done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 037d895..HEAD -- registry/default/blocks/data-grid-lazy/use-data-grid-lazy-rows.ts registry/default/blocks/data-grid-lazy/range-math.ts registry/default/blocks/data-grid-lazy/use-data-grid-lazy-rows.test.ts`
> If any changed, compare against the "Current state" excerpts; on a mismatch, STOP.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug (edge case)
- **Planned at**: commit `037d895`, 2026-09-03

## Why this matters

`handleFulfilled` (use-data-grid-lazy-rows.ts:123-133) marks the WHOLE requested
range as loaded even when `fetchRows` resolves with fewer rows than `[start, end)`.
The trailing holes are then considered loaded: they are never re-fetched, `pendingCount`
(derived from `loadedRangesRef` at :185) undercounts, and skeleton rows can persist
permanently. Trigger: the dataset shrinks between the window report and the fetch
resolution, or a contract-violating `fetchRows` returns a short array. Severity is low
because the docs contract says `fetchRows` "fetches rows `[start, end)`" — but a
silent permanent skeleton is a much worse failure mode than a retry.

## Current state

- `registry/default/blocks/data-grid-lazy/use-data-grid-lazy-rows.ts:112-150`:

```ts
const handleFulfilled = (fetched: TData[]) => {
  if (controller.signal.aborted) return;
  loadedRangesRef.current = mergeRanges([...loadedRangesRef.current, range]);   // <- whole range, unconditionally
  setRows((prev) => {
    const next = prev.slice();
    for (let i = 0; i < fetched.length && range.start + i < next.length; i++) {
      next[range.start + i] = fetched[i];
    }
    return next;
  });
};
```

- The retry machinery already exists for FAILURES: `handleRejected` (:134-139) leaves
  the range unloaded so "the next onRowWindowChange covering them naturally retries —
  refetch on next visibility" (its comment). `onRowWindowChange` (:152-161) computes
  `gaps = subtractRanges(expanded, covered)` and fetches each gap — so marking only
  the fetched prefix leaves a gap that the existing machinery re-fetches. No new
  fetch logic is needed.
- `registry/default/blocks/data-grid-lazy/range-math.ts` — `mergeRanges`/
  `subtractRanges`/`expandRange`/`rangeSize` (pure, unit-tested).
- `registry/default/blocks/data-grid/is-dev.ts` — the dev-guardrail helper (import it
  via the same relative/alias path the other lazy files use — check their imports).
- Test exemplar: `use-data-grid-lazy-rows.test.ts` (renderHook + act + waitFor,
  stubbed `fetchRows` — the file header at :1-13 shows the imports).
- Docs: `content/docs/lazy-loading.mdx` — the `fetchRows` contract line.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests (filter) | `pnpm test -- lazy` | exit 0 |
| Tests (full) | `pnpm test` | exit 0 |
| Typecheck | `pnpm types:check` | exit 0 |
| Lint | `pnpm lint` | exit 0 |
| Registry rebuild | `pnpm registry:build && pnpm registry:verify` | exit 0 |

## Scope

**In scope:**
- `registry/default/blocks/data-grid-lazy/use-data-grid-lazy-rows.ts`
- `registry/default/blocks/data-grid-lazy/use-data-grid-lazy-rows.test.ts`
- `content/docs/lazy-loading.mdx` (one contract line)

**Out of scope:**
- `range-math.ts` (if the prefix-merge needs no new math — it doesn't: a shorter
  range merges fine; verify, and if you are wrong STOP)
- the `totalCount` handling, abort semantics, dedup/in-flight bookkeeping

## Git workflow

- Branch `fix/007-lazy-short-fetch` or `dev`; conventional commit
  (`fix(lazy): mark only fetched rows as loaded on a short resolution`). No
  co-author trailer. Do not push.

## Steps

### Step 1: Mark only what arrived

In `handleFulfilled`, replace the unconditional whole-range merge with a prefix
merge of what actually resolved:

```ts
const handleFulfilled = (fetched: TData[]) => {
  if (controller.signal.aborted) return;
  const loadedCount = Math.min(fetched.length, range.end - range.start);
  const loaded = { start: range.start, end: range.start + loadedCount };
  if (loaded.end > loaded.start) {
    loadedRangesRef.current = mergeRanges([...loadedRangesRef.current, loaded]);
  }
  if (loadedCount < range.end - range.start) {
    if (isDev()) console.warn(`gridcn: fetchRows resolved short — ${loadedCount} of ${range.end - range.start} rows for [${range.start}, ${range.end}); the missing tail stays pending and refetches on next visibility`);
  }
  setRows(/* unchanged — already writes only fetched.length rows */);
};
```

An empty resolution (`fetched.length === 0`) marks nothing loaded and warns — the
range stays pending (same as a failure) and retries on next visibility.

**Verify**: `pnpm types:check` → exit 0; `pnpm test -- lazy` → existing tests green.

### Step 2: Tests

In `use-data-grid-lazy-rows.test.ts` (follow the existing stubbed-`fetchRows` pattern):

1. Short resolution: `fetchRows` resolves with N/2 rows for a requested range of N →
   `pendingCount` reflects only the fetched half as loaded; the tail rows are still
   holes.
2. Retry: after the short resolution, trigger the next visibility window covering the
   tail (call the returned `gridProps.onRowWindowChange` with a range covering the
   tail) → `fetchRows` is called again for the unfetched tail (assert the call args).
3. Empty resolution: resolves `[]` → nothing loaded, warn fired
   (`vi.spyOn(console, "warn")`), range refetches on next visibility.
4. Full resolution (existing behavior) still passes untouched.

**Verify**: `pnpm test -- lazy` → green, 4 new/updated cases.

### Step 3: Docs line

In `content/docs/lazy-loading.mdx`, at the `fetchRows` contract, one line: resolving
with fewer rows than requested marks only the returned rows as loaded; the missing
tail stays pending and refetches on the next visibility (and warns in dev).

**Verify**: `pnpm lint` → exit 0 (mdx linted).

### Step 4: Full gate

**Verify**: `pnpm test` exit 0; `pnpm lint` exit 0; `pnpm types:check` exit 0;
`pnpm registry:build && pnpm registry:verify` exit 0.

## Test plan

- New: the four cases in Step 2 (short, retry, empty, full-untouched).
- Untouched: every existing lazy test (dedup, abort-on-unmount, sync-throw guard).

## Done criteria

- [ ] `pnpm test` exits 0 incl. the new cases
- [ ] A short resolution leaves the tail pending (asserted, not assumed)
- [ ] `pnpm registry:build && pnpm registry:verify` exit 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated to DONE + commit SHA

## STOP conditions

- `mergeRanges` cannot represent a prefix of an in-flight range without corrupting
  the bookkeeping (e.g. the in-flight key and loaded ranges interact) — read the
  `inFlightRef`/`loadedRangesRef` interaction in `onRowWindowChange` first; if a
  prefix merge would double-fetch the prefix on the next window, STOP and report.
- The existing tests pin the current (whole-range) behavior for short resolutions —
  that would mean the behavior was deliberate; STOP and report instead of flipping a
  test.

## Maintenance notes

- The contract line in the docs and the dev-warn must stay in sync — a future
  "retry immediately instead of on next visibility" change needs both.
- Reviewers: the retry must come from the EXISTING gap machinery (subtractRanges in
  `onRowWindowChange`), not a new timer/retry loop — a retry loop would fight the
  abort/dedup bookkeeping.
