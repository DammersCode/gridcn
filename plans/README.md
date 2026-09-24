# Implementation Plans — 2026-09-03 audit follow-ups

Generated from the 2026-09-03 multi-agent audit (findings:
`docs/agent-work/2026-09-03-audit-{features,performance,bugs}.md`; queue overview:
`docs/agent-work/plans/2026-09-03-audit-followups.md`). Execute in the order below
unless dependencies say otherwise. Each executor: read the plan fully before starting,
honor its STOP conditions, and update your row when done.

Every plan is self-contained — the executor has not seen the audit session. All plans
were planned at commit `037d895` (2026-09-03, branch `dev`); source state of the
in-scope files is unchanged since the audit HEAD `a4a303a` (doc-only commits in between).

Completed plan files are deleted from `plans/` — the status tables below are the standing
record of what landed (commit SHAs point at `main`).

## Execution order & status

| Plan | Title | Priority | Effort | Risk | Depends on | Status |
|------|-------|----------|--------|------|------------|--------|
| 001 | `computeRowEditsBatch` resolves columns in O(1) (hoisted map) | P1 | S | LOW | — | DONE (2dcf6e2) |
| 002 | Bound the full-selection delete and the tiled paste | P1 | M | MED | 001 | DONE (bafe2a5) |
| 003 | Rect-scope copy respects `MAX_COPY_CELLS` | P1 | S | LOW | — | DONE (2f98246) |
| 004 | `applyChange` applies undo/redo ops in O(n + k log k) | P1 | M | MED | — | DONE (693fddd) |
| 005 | Scope the selection zero-render invariant + guard it (accept the `aria-selected` churn) | P2 | S | LOW | — | DONE (39cd2d6 + ec1464f) |
| 006 | Implement the three spec'd-but-missing behaviors (Alt+Arrow, mod+Enter, outside-click clear + `onSelectionCleared`) | P2 | M | LOW-MED | — | DONE (67d7688) |
| 007 | Lazy rows: short `fetchRows` resolution must not mark the range complete | P3 | S | LOW | — | DONE (on main since the repo import: short responses mark only the written rows loaded and re-fetch the gap; test `marks only actually written rows loaded` in `use-data-grid-lazy-rows.test.ts`) |
| 008 | Editor keystroke-to-paint timing test (unenforced §4.6 budget) | P3 | M | LOW | — | TODO |
| 009 | Glide spec doc fix + store-barrel public-surface decision | P3 | S | LOW | — | DONE (67d7688 + 723d50c) |
| 010 | Hoist per-cell store subscriptions (actions/cellTypes via root context) | P3 | S/M | LOW | 005 | TODO |

Status values: TODO | IN PROGRESS | DONE (commit SHA) | BLOCKED (reason) | REJECTED (rationale).

## Other plans (not 2026-09-03 audit follow-ups)

| Plan | Title | Priority | Effort | Risk | Depends on | Status |
|------|-------|----------|--------|------|------------|--------|
| 011 | OSS readiness: GitHub registry, Vercel docs hosting, publish checklist | P2 | M | MED | — | IN PROGRESS (work carried on `dev`; owner-side release steps open) |
| 012 | API audit ADOPT set (P1-A, P2, P3, P6-code, P7 a-c, P8 b/c/d, P9 a-e + docs batch) | P1 | L | MED | — | DONE (all windows; full unit + browser suites green; two-axis code review applied in d69e7df + 527526b) |
| 013 | Docs examples: per-feature live examples, collapsible Examples IA, library mappings (Zod/Valibot/ArkType, React Query/SWR, Drizzle/Prisma recipes) | P2 | L | LOW | W8 only: `feat/row-reorder` merge | IN PROGRESS (most windows landed on main — feature folders under `content/docs/examples/` incl. `data/lazy`, `data/orm`, `data/pagination`; W7 add-ons not landed; the in-file status table is stale) |
| 015 | Lazy loading customization: fetch-window tuning (`maxFetchRows`), memory retention (`evict`/`reset`/`getLoadedRanges`), `onLoaded`, docs + validation sweep | P2 | L | MED | — | DONE (merged as PR #44, merge `efd4988`; commits `73ddca5` → `eadeac2` incl. review fixes `4ae93f0`; full unit/browser/compiler suites green) |

## Dependency notes

- **002 requires 001**: 002's timing guards run against the map-based write loop; without
  001 the delete-path ceiling test measures the 40M-scan regression it exists to kill.
- **010 after 005**: 005 establishes the sanctioned-re-render model (membership flips only);
  010 must not change render behavior — it removes selector *invocations*, not renders.
  Sequence them so 010's render-count assertions compare against 005's guarded baseline.
- Everything else is independent; 001/003/004 can run in parallel on separate branches.

## Repo facts every executor needs

- Stack: React 19, TypeScript strict (no `any` in public API), Zustand vanilla
  (`zustand/vanilla` `createStore`, one store per grid instance), vitest 4 with
  `unit` (jsdom) and `browser` (Playwright Chromium) projects.
- Product code: `registry/default/blocks/<item>/` — the shadcn-registry source that
  consumers copy. Core barrel: `registry/default/blocks/data-grid/data-grid.tsx`
  (the ONLY public entry; `scripts/verify-import-boundaries.mjs` — part of `pnpm lint` —
  forbids deep-path cross-item imports and core→add-on imports).
- Conventions (PLAN.md §12 + CONTRIBUTING.md): conventional small commits
  (`feat:`, `fix:`, `test:`, `docs:`, `chore:`), one-line why-comments only, JSDoc on
  every exported symbol, `DataGrid*` component prefix, kebab-case files,
  `use-*` hook files. No `Co-Authored-By` trailers. Do not push unless instructed.
- The grid never mutates consumer data; every write funnels through
  `computeRowEditsBatch` (store/commit.ts) → one `onDataChange` per gesture.
- Perf invariants (PLAN.md §4.6): no JSON.stringify equality anywhere; never introduce
  per-row/per-cell wrapper objects or row-bound closures; document-level listeners only
  during an active drag (or while a selection exists — 006 documents that extension).
- Any change inside `registry/` requires `pnpm registry:build && pnpm registry:verify`
  before done (payload gate fails loudly on alias drift — `scripts/fix-registry-imports.mjs`).

## Commands every executor needs

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests (unit + browser) | `pnpm test` | exit 0 |
| Tests (filter) | `pnpm test -- <filter>` | exit 0; filter matched ≥1 test file (check the run header) |
| Typecheck | `pnpm types:check` | exit 0 |
| Lint | `pnpm lint` | exit 0 |
| Registry rebuild (after registry/ changes) | `pnpm registry:build && pnpm registry:verify` | exit 0 |

Timing-guard test pattern (used by 001/002/004/008): model on
`registry/default/blocks/data-grid/sort-filter/view-index-perf.test.ts` — plain unit
test, large synthetic data, wall-clock ceiling with a generous multiple (the guard
catches order-of-magnitude regressions, not constant factors). Flake rule
(docs/agent-work/2026-07-17 perf triage, commit 91f4b3a): an environmental flake is
recorded in the perf doc — the bar is never relaxed.

## Findings considered and rejected (do not re-audit)

From the 2026-09-03 re-verification — prior refutations stand, verified unchanged at
`037d895`: `useScrolledEdges` attr writes (snapshot reads); `DataGridMarkerCell` /
`DataGridHeaderCell` unmemoized (cheap render, no churn); `DataGridOverlays` per-render
rect arrays (bounded by the window); `computeWindow` render-phase memo;
`cumulativeRights` per-tick allocation (column window is small); `useElementDimensions`
ref-in-render; `body.tsx` gridRowStart useLayoutEffect; search full-scan (bounded by
`MAX_SEARCH_MATCHES = 1000`); custom-comparator value decoration (2026-08-20 dismissal:
regression risk, not a win). WONTFIX accepted: `isBulkBatchCurrent` rowId-set rebuild
(per-batch, not per-tick); async `updateCells` triple column-map build (batch-rare path).
Settled levers (register, do not re-explore): row pooling, velocity-overscan cuts,
deferred commits, `content-visibility: auto` (parked — revisit only after the
pin-shadow probe adaptation).
