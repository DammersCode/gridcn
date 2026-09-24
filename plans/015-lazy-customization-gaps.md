# Plan 015 — Lazy customization gaps (customizability evaluation)

> **Status: DONE** — merged as PR #44 on 2026-09-24 (merge commit `efd4988`). Actual commits:
> T1 `73ddca5`, T2 (this plan) `7a13aa7`, T3 `b22c525`, two-axis review fixes `2449b30`,
> status `ec01086`, review follow-ups `4ae93f0`, JSDoc alignment `eadeac2`.

Branch: `feat/lazy-customization` (worktree `C:\Users\dahe\AppData\Local\Temp\opencode\gridcn-lazy-customization`).
Precondition: `main` @ `c06bd47`. All anchors (file:line) are valid at that commit.
Each executor: branch check + anchor drift check before starting (AGENTS.md rules).
Push nothing — local until the user asks. No `Co-Authored-By` trailer.

## Gap list (what the evaluation found missing)

The evaluation of the lazy-loading docs against the TanStack Virtual docs (virtualization, data
fetching, pagination, infinite loading; see `research/tanstack-virtual-study.md`) identified six gaps.
Three of them get implemented in this plan, one is documented, two are explicitly skipped:

| # | Gap | Decision |
|---|-----|----------|
| G1 | No cap on rows per fetch request (e.g. 30k visible on a 4k monitor, or a giant overscan, produces one huge request) | **Implement: `maxFetchRows` option** (T1) |
| G2 | Rows stay in memory forever after load; no way to free them (streaming/total-change) | **Implement: `evict(range)` + `reset()`** (T1) |
| G3 | No public API for "which ranges are loaded"; consumers must track it themselves | **Implement: `getLoadedRanges()`** (T1) |
| G4 | No success callback (e.g. to mark the server-side cache as loaded) | **Implement: `onLoaded` option** (T1) |
| G5 | No documented memory model (what stays, what is freed) | **Document in docs** (T3, docs section) |
| G6 | Per-row data identity (e.g. TanStack Virtual's `data` pattern) | **Skip** (see "Explicitly skipped") |

### Decisions & rationale

**G1 — `maxFetchRows?: number`:**
- Semantics: a gap wider than `maxFetchRows` is split into consecutive chunks of at most
  `maxFetchRows` rows; each chunk is fetched independently (own dedup, abort, and failure).
  Chunk boundaries follow the gap start, not `batchSize` boundaries (deliberate simplification;
  `batchSize` alignment only makes sense for scroll reuse, which is secondary here).
- Why not "page size" / "batch size": `batchSize` already exists and aligns fetches to grid
  boundaries; the gap is *how big a single request may be*. Separate concerns, separate options.
- Default: undefined = no cap (backward compatible).
- The chunk-splitting logic goes in `range-math.ts` as a pure function (`chunkRange`) — testable
  without the hook.

**G2 — `evict(range)` + `reset()`:**
- `evict(range: Range)`: unmarks the intersecting loaded ranges, aborts any in-flight fetch for that
  range, and fires `onRowWindowChange` for the newly unloaded part — if visible, the user sees
  skeletons again and the fetch re-fires. In-flight wins over evict (aborting the fetch and
  immediately re-fetching the same range is a no-op loop; the abort is kept because the
  bookkeeping must not mark a dying fetch as loaded).
- `reset()`: evicts all loaded ranges + clears the cache (full re-fetch on next visibility). For
  streaming/total-change use cases.
- Both are part of the hook's result (like `onRowWindowChange`), not on `gridProps` — the grid
  itself does not need to know about them.
- Rationale for abort on evict: a fetch that is evicted mid-flight must not mark its range as
  loaded on settle (otherwise a stale "loaded" range survives). The `entry` map in
  `use-data-grid-lazy-rows.ts` already holds the controller per range; reuse it.

**G3 — `getLoadedRanges(): readonly Range[]`:**
- Returns the currently loaded ranges (the hook's internal bookkeeping, `rangesRef`), sorted by
  start, as a plain array snapshot. Not reactive — callers read it on demand (e.g. in their own
  fetch handler to skip already-loaded parts).
- Why a function and not a reactive value: the loaded state changes on every fetch settle; making
  it reactive would re-render every consumer on every range write. On-demand read = zero render
  cost. The hook already exposes the same principle via `unloadedCount` being a *number* (cheap to
  re-render on), not the ranges themselves.

**G4 — `onLoaded?: (range: Range) => void`:**
- Fired once per range when a fetch resolves successfully and the range is marked loaded (not on
  abort, not on error, not when the response wrote fewer rows than the range — that case is
  already dev-warned and the missing part stays unloaded).
- Passes the actual loaded range (what `rangesRef` now contains for that write — can be smaller
  than the requested range if the response was short? No: on short response the unwritten part is
  *not* marked loaded, so `onLoaded` fires with the written part only. Keep it simple: pass the
  requested range that is now fully loaded — i.e. only fire when `written === requested`).
  → **Decision:** only fire `onLoaded` when the response wrote the full requested range.
  Short responses stay silent (the dev warning already covers them).
- Why a callback and not an event on the grid: the grid is not involved; the lazy hook owns the
  fetch lifecycle. Consumers (e.g. the react-query demo) wire it in their own handler.

**G5 — memory model (docs):**
- Section in `lazy-loading.mdx`: rows stay in the consumer's state until evicted; the grid
  renders only the visible window; `evict`/`reset` are the release valves; `unloadedCount`
  reflects the gap, not memory. No new jargon; condition-before-command phrasing.

**G6 — per-row data identity: skip.**
- Reason: the hook's contract is "the consumer owns the rows" (`data` is passed by the consumer);
  TanStack's `data` pattern (per-item metadata) is a virtualization-library concern, not a
  data-fetching concern. gridcn already gives consumers `getRowId` + `data`; a `data`-per-row
  channel would duplicate `getRowId` semantics without a concrete use case from the evaluation.
  If a real case appears (e.g. per-row fetch state for infinite loading), that is a new plan.

## Explicitly skipped (with reason)

- **Infinite-scroll "load more" API** (TanStack-style `endReached`): the grid already fires
  `onRowWindowChange` with the full visible range; a consumer implementing load-more derives the
  trigger from that (the react-query demo shows the pattern). A dedicated `endReached` callback
  would be a second, redundant signal. Revisit if the pattern proves hard to derive in practice.
- **Prefetch beyond overscan** (`count`/lookahead tuning): `overscan` is already the documented
  knob and the study recommends tuning it, not adding a second prefetch axis.

## Task 1 — Hook API (code)

Files:
- `registry/default/blocks/data-grid-lazy/range-math.ts` (new: `chunkRange`)
- `registry/default/blocks/data-grid-lazy/use-data-grid-lazy-rows.ts`
- `registry/default/blocks/data-grid-lazy/index.ts` (barrel — only if new exports)
- `registry/default/blocks/data-grid-lazy/use-data-grid-lazy-rows.test.ts`
- `registry/default/blocks/data-grid-lazy/range-math.test.ts` (new)
- `registry/default/examples/data-grid-lazy-demo.tsx` (demo: expose `maxFetchRows` + an
  "Evict loaded rows" button as the visible surface for G2/G3 — small, one control each)

Steps:
1. RED: add unit tests for `chunkRange` (gap exactly at the cap, above, below; `maxFetchRows`
   smaller than a single row → clamp to 1) and for the hook: `evict` unmarks + re-fires the window;
   `reset` clears everything; `getLoadedRanges` reflects the bookkeeping; `onLoaded` fires only on
   full-range success (not on short response, not on error, not on abort).
2. Implement `chunkRange(gap: Range, max: number): Range[]` in `range-math.ts` — pure, no deps.
   Integrate into the fetch path in `use-data-grid-lazy-rows.ts` where the requested range is
   built: replace the single `fetchRows` call with one call per chunk; per-chunk `entry`
   bookkeeping (dedup/abort/failure independent — an aborted chunk leaves its rows unloaded, the
   next visibility re-fetches).
3. Implement `evict`, `reset`, `getLoadedRanges`, `onLoaded` in the hook; wire `onLoaded` into
   `handleFulfilled` after the full-range check.
4. Barrel: `chunkRange` is internal (not in the barrel) — the public surface is the hook only.
5. Demo: `maxFetchRows` constant in the demo's fetch handler (visible in the code, no UI slider —
   keep the demo minimal); "Evict loaded rows" button calling `evict` on the full loaded span.
6. GREEN: `npx vitest run registry/default/blocks/data-grid-lazy --project unit`
7. Payload: `pnpm registry:build` (the hook + demo changed) + EOL normalize + `pnpm registry:verify`.
8. Commit: `feat(data-grid-lazy): add reset, evict, getLoadedRanges, onLoaded, and maxFetchRows`

STOP: `onLoaded` semantics drift from "only full-range success"; `evict` starts mutating
consumer data (it must not — only the hook's bookkeeping); the demo grows beyond one button + one
constant.

## Task 2 — Audit + punch list (read-only)

Scope: everything the hook + docs claim now, against the code.

1. JSDoc audit on every new/changed public member (`maxFetchRows`, `evict`, `reset`,
   `getLoadedRanges`, `onLoaded`, plus the touched `fetchRows`/`onError`): behavior stated,
   no "now/new", no toolchain-visible behavior, JSDoc well-formed.
2. Docs contract audit: `content/docs/lazy-loading.mdx` + `lazy-loading-advanced.mdx` — every
   claim in the new sections exists in the code (names, defaults, firing conditions).
3. Demo consistency: the demo's `maxFetchRows` value + evict button match the documented API
   (prop names, call shapes).
4. Registry surface: the barrel exports only what the docs teach (the hook); `chunkRange` stays
   internal — grep `content/docs` for `chunkRange` must find nothing.
5. Perf invariants: the chunk path introduces no per-row objects/closures in hot paths; the
   `entry` map stays bounded (one entry per in-flight chunk); no new JSON.stringify anywhere.
6. Output: a punch list below (this plan file, append) with findings; fix only what is in the
   diff's own scope, defer the rest with a reason.

Commit (only if fixes were needed): `fix(data-grid-lazy): apply audit follow-ups`

## Task 3 — Docs + validation sweep

Files:
- `content/docs/lazy-loading.mdx` (new section "Tuning the fetch window" for G1; extend the
  "Memory and retention" guidance for G2/G3/G5; mention `onLoaded` in the success-path paragraph)
- `content/docs/lazy-loading-advanced.mdx` (evict/reset for streaming/total-change)
- `content/docs/examples/data/lazy/*.mdx` (behavior reference: point the react-query example at
  `onLoaded` if its code uses it — only if Task 1 demo/docs actually use it; otherwise a one-line
  mention in the main page)
- `content/docs/api-reference.mdx` (hook options table + result members)

Steps (simple-english skill applies — run its self-check before done):
1. Write the new sections: one short paragraph per option, condition-before-command, no rejected
   alternatives, no "now/new/currently".
2. `pnpm types:check && pnpm lint && pnpm lint:typed`.
3. `npx vitest run registry --exclude "**/*.browser.test.*" --project unit --coverage`.
4. `npx vitest run --project browser` (flakes: one rerun of the failing file, then debug).
5. `pnpm test:compiler`, `pnpm build` (stop any dev server first), `pnpm registry:build` +
   `node scripts/normalize-payload-eol.mjs` + `git add public/r` + `pnpm registry:verify`.
6. CHANGELOG entry under `## Unreleased` (user-facing: new options/members).
7. Commit: `docs(data-grid-lazy): document fetch-window tuning and memory retention`

## Gates (per AGENTS.md, all green before done)

1. `pnpm types:check`
2. `pnpm lint`
3. `pnpm lint:typed`
4. `npx vitest run registry --exclude "**/*.browser.test.*" --project unit --coverage`
5. `npx vitest run --project browser`
6. `pnpm test:compiler`, `pnpm build`, `pnpm registry:build` + EOL normalize + `pnpm registry:verify`

## Expected commits

1. `feat(data-grid-lazy): add reset, evict, getLoadedRanges, onLoaded, and maxFetchRows`
2. `fix(data-grid-lazy): apply audit follow-ups` (only if the audit found in-scope fixes)
3. `docs(data-grid-lazy): document fetch-window tuning and memory retention`
