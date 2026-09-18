# Audit follow-up workplan — 2026-09-03

Forward queue from the 2026-09-03 multi-agent audit (read-only pass; nothing here is
implemented yet). Sources: `docs/agent-work/2026-09-03-audit-{features,performance,bugs}.md`,
traces in `.agents/audit/2026-09-03-multi-agent-audit/traces/`.

Supersedes the 08-02 audit fix queue (that queue is fully worked through — all verified
findings fixed, verdicts in the bugs report). Planning discipline per the `improve` skill:
each plan is self-contained (executor has zero context), carries verification gates,
hard boundaries, and STOP conditions. Planned at `a4a303a` (dev), 2026-09-03.

> **Full handoff plans:** the condensed queue below was expanded into ten
> self-contained executor plans — `plans/001-hoist-column-map.md` …
> `plans/010-hoist-cell-subscriptions.md` (index: `plans/README.md`). Each carries the
> drift check, verified file/line references, step-by-step instructions with
> per-step verification, test plan, done criteria, and STOP conditions. **Execute
> from `plans/`, not from this file** — this file is the queue/overview only.
> (005's decision was vetted further during the expansion: accept the
> `aria-selected` churn + guard it, rather than imperative writes — see
> `plans/005-selection-churn-invariant.md`.)

## Execution order & status

| Plan | Title | Priority | Effort | Risk | Depends on | Status |
|---|---|---|---|---|---|---|
| 001 | Hoist the column map in `computeRowEditsBatch` (kills the 40M-scan in delete/paste/applyCellUpdates) | P1 | S | LOW | — | TODO |
| 002 | Bulk clear fast path + paste-target bound (the two new HIGHs) | P1 | M | MED | 001 | TODO |
| 003 | Rect-scope copy cap (extend `MAX_COPY_CELLS` to rect scope) | P1 | S | LOW | — | TODO |
| 004 | Undo/redo: replace O(n²) row lookup with one rowId→index map per `applyChange` | P1 | M | LOW-MED | — | TODO |
| 005 | `aria-selected` vs zero-render invariant — decision + fix + render-count test | P2 | M | MED (user-visible a11y behavior) | — | TODO (user review recommended) |
| 006 | Spec-gap keyboard/selection bindings: Alt+Arrow, primary+Enter, outside-click clear + `onSelectionCleared` | P2 | S–M | LOW | — | TODO |
| 007 | Lazy rows: short `fetchRows` resolution must not mark the range complete | P3 | S | LOW | — | TODO |
| 008 | Editor keystroke-to-paint timing test (unenforced §4.6 budget) | P3 | M | LOW | — | TODO |
| 009 | Glide spec doc fix (`mod+shift+Arrow` wording) + store-barrel surface decision | P3 | S | LOW | — | TODO |
| 010 | Hoist per-cell store subscriptions (actions/cellTypes via layout context) | P3 | S/M | LOW | 005 | TODO |

## 001 — Hoist the column map in `computeRowEditsBatch`

- **Why:** `computeRowEditsBatch` (registry/default/blocks/data-grid/store/commit.ts:141-168)
  resolves each write's column with `s.visibleColumns.find((c) => c.id === write.columnId)`
  — a linear scan PER WRITE. A full-grid delete (100k×20 = 2M writes) = ~40M comparisons;
  paste and `applyCellUpdates` share the path. The 08-02 audit fixed the per-CELL
  *copy* resolution; the write side was never audited.
- **Current state:** commit.ts:147-151 loops `writes`, calls `.find` each iteration.
  `applyCellUpdates` (create-store.ts:641) already builds an `idByCol` Map for its own
  selection math — precedent for the hoist.
- **Steps:** (1) Build `Map<columnId, {column, index}>` once at the top of
  `computeRowEditsBatch`; replace the `.find`. (2) Keep dedupe/readOnly/no-op semantics
  byte-identical (the `Object.is` check at :161 must run on the same values).
- **Verify:** `pnpm test -- commit` (colocated store tests) + new unit test: 100k writes
  against 20 columns, assert column resolution is O(writes) not O(writes×cols) —
  mirror the pattern in `sort-filter/view-index-perf.test.ts` (assert a timing ceiling,
  not a constant).
- **Done:** typecheck + full `pnpm test` green; perf unit test in place; no behavior change
  (all existing store/clipboard tests pass untouched).
- **STOP:** if `RowEdit` dedupe semantics depend on column *position* rather than id
  (they don't today — verify against commit.ts:153-168 first).

## 002 — Bulk clear fast path + paste-target bound

- **Why:** the two new HIGHs (perf report P1/P2). (a) `deleteSelection`
  (create-store.ts:597-616) materializes 2M writes for a full-grid/row/column
  selection; (b) paste tiles a 1-row paste to the target range height
  (use-grid-clipboard.ts:154-157,261) with no bound — Ctrl+A then paste = ~2M
  candidates + writes. 001 removes the scan factor; this plan removes the allocation
  factor and adds the bound.
- **Steps:**
  1. Delete: add a row-bulk fast path — when a rect covers ALL visible columns for a
     set of rows, build one row object per row (clear all columns in a single pass over
     the pre-resolved column array) instead of one write per cell. Ops stay
     per-cell-shaped (public `DataOp` shape does NOT change — D6: no public API change
     without user sign-off); only the internal write loop changes.
  2. Paste: cap the tiled target. Reuse the `MAX_COPY_CELLS` surface pattern
     (use-grid-clipboard.ts:68-75): when `tiledCells.length × cols` exceeds the cap,
     truncate to the rows that fit and surface it (labels object — add an i18n string,
     e.g. `pasteTruncated: (rows, total) => string`), matching the copy cap's
     truncate-with-label semantics. No silent drops.
  3. Tests: full-grid delete at 100k×20 (unit, timing ceiling — the §4.6 "one onDataChange
     + one commit render" invariant must keep holding: assert exactly one onDataChange
     and one ops batch); paste 1×20 into a 100k-row range (truncation asserted,
     label asserted); existing `store.test.tsx:1270-1288` delete tests untouched.
- **Verify:** `pnpm test -- clipboard store` + the new guards; `pnpm types:check`.
- **Done:** both paths bounded at 100k×20 with timing guards in the suite; one-batch
  invariant tests still green.
- **STOP:** if the bulk delete changes `ops` length for the full-row case in a way that
  breaks history round-trips (`interaction/history.test.ts`) — that means the op shape
  is load-bearing; report instead of improvising.

## 003 — Rect-scope copy cap

- **Why:** perf report P3. `serializeCopyScope` (use-grid-clipboard.ts:130-131) leaves
  rect scope uncapped "since its size is already visually bounded by what the user
  dragged" — but two-stage Ctrl+A produces a whole-grid rect
  (select-all-progression.ts:91-103). The existing guard
  (`use-grid-clipboard.copy-cap.test.ts:100`) explicitly asserts rect is uncapped and
  must be updated.
- **Steps:** apply the `MAX_COPY_CELLS` truncation to rect scope (same truncate-to-fitting
  rows + label-surfaced behavior as rows/columns scope); update the :127-128 comment;
  flip the test at copy-cap.test.ts:100 to assert the cap.
- **Verify:** `pnpm test -- clipboard` green incl. updated cap test; `pnpm registry:build`
  + `pnpm registry:verify` (the item ships to consumers — the payload gate must pass).
- **Done:** Ctrl+A + Ctrl+C on a 100k-row grid is bounded and labeled; no other copy
  path changes.
- **STOP:** if truncating a rect breaks the HTML/TSV round-trip diff test
  (`parse-clipboard-diff.test.ts`) — that test pins fidelity of the uncapped path.

## 004 — Undo/redo O(n²) row lookup

- **Why:** bugs report N1. `findRowId` (data-grid-history/use-data-grid-history.ts:88)
  runs `dataRef.current.indexOf(row)` (O(n)) per row examined, and `applyChange`
  (interaction/history.ts:52-83) calls it once per row inside `findIndex` for each
  update/delete op → k·n² for a k-op undo/redo on n rows. Invisible in normal use
  (small undos near the top); multi-second freeze for a 1,000-op undo at 100k rows.
- **Steps:**
  1. In `applyChange`, build `Map<rowId, index>` ONCE per call (one pass); update/delete
     ops look up the map (O(1) per op). Insert ordering semantics (snapshot indices,
     ascending apply — history.ts:36-51) are preserved exactly.
  2. Keep `findRowId` for the index-based `getRowId` support the comment at
     use-data-grid-history.ts:86-87 documents — but it must no longer be called per row
     examined. Option: `applyChange` receives `getRowId` and derives the map from it
     directly (already the case — the map build uses the same `getRowId` call that
     `findRowId` wraps, minus the `indexOf`).
  3. Tests: unit — a 50k-row array, undo a 500-op batch with rows near the END, assert
     wall-clock under the ceiling (mirror `streaming.browser.test.tsx`'s median-per-op
     pattern); the vanished-row-skip semantics (PLAN §11a) and insert-index
     round-trip tests in `interaction/history.test.ts` must pass untouched.
- **Verify:** `pnpm test -- history` + the new scale guard; `pnpm types:check`.
- **Done:** undo of a large batch at 100k rows is linear in (n + k), guarded by a test.
- **STOP:** if map-building changes the skip-vanished-row behavior (it must not — the
  map contains exactly the rows present; a missing id → skip, same as `findIndex -1`).

## 005 — `aria-selected` vs the zero-render invariant (DECISION)

- **Why:** perf report P4. Cells whose selection membership flips re-render on drag
  frames because `isSelected` is a prop (row.tsx:126 → cell.tsx:247
  `aria-selected={isSelected || undefined}`). `DataGridRow`/`DataGridCell` are memoized,
  so only membership-flipping cells churn — but with a large dragged band that is the
  whole visible band (~544 cells at the reference window). This violates PLAN §4.6
  "selection drag re-renders zero cells" and the accessibility doc's claim.
  `aria-selected` on `role="gridcell"` is WAI-ARIA-required, so this is a
  deliberate-tension decision, not a bug fix.
- **Options:**
  - (a) Accept + document: keep the prop path, restate the §4.6 budget as "no cell
    *content* re-renders on selection paint; membership-flip cells re-render", add a
    render-count test pinning the churn to membership flips only.
  - (b) Imperative writes: remove the `isSelected` prop from the cell render; write
    `aria-selected` on the cell's existing ref in an effect that watches the
    membership value (a cell already re-renders on value/edit/search changes — the
    effect piggybacks and writes the attribute directly, zero extra renders).
- **Recommendation: (b)** — it restores the invariant the perf docs and the a11y docs
  both promise, keeps the attribute correct, and touches one file (cell.tsx) + the
  membership source (hooks.ts row-cell-state already carries `selectedColRanges`).
- **Steps (if (b) is picked):** (1) `DataGridCellImpl` takes `selected: boolean` (value
  changes stop triggering React renders because the memo comparator can ignore it —
  pass it via a ref-updated context value OR an untracked subscription); (2)
  `useEffect` writes `cellRef.current?.setAttribute('aria-selected', ...)` on change and
  on unmount cleanup; (3) add the membership-flip render-count browser test
  (drag a range across the visible band; assert zero `DataGridCell` render counts via
  the existing render-count probe in `data-grid.test.tsx:556-613`); (4) update the
  a11y doc matrix (accessibility.mdx) — attribute presence verified by the browser test,
  render cost re-claimed.
- **User review recommended before implementation** (it changes a user-visible a11y
  attribute's rendering mechanism; D6 bar).
- **Verify:** `pnpm test -- browser` (new render-count test + existing a11y browser test
  `test/a11y.browser.test.tsx` must still see `aria-selected` on gridcells).
- **Done:** drag-churn render count = 0 for membership flips; axe/aria assertions green.
- **STOP:** if the effect-based attribute write races with React's own DOM for the
  attribute on value-change re-renders (visible flapping in the browser test) — fall
  back to (a) and report.

## 006 — Spec-gap keyboard/selection behaviors (N2/N3/N4)

- **Why:** three behaviors in `research/glide-behavior-spec.md` are specified but absent:
  Alt+Arrow move-retains-selection (:41), primary+Enter scroll-into-view without moving
  (:46), click-outside clears selection + fires `onSelectionCleared` (:108). The matcher
  already supports `alt` (match-keymap.ts:47, tested); `_registerScrollToCell` already
  exists (root.tsx:227); the outside-click handler exists but only fires for the grid's
  own gutter (use-grid-interaction.ts:876-887) and no `onSelectionCleared` callback exists.
- **Steps:** (1) add `moveRetainingSelection` action (move active cell, keep range
  anchored — Excel semantics: the range moves with the cell) + `alt+arrow*` bindings;
  (2) bind `primary+enter` (shift+Enter is taken by commit-and-move-up — verify the
  binding table in default-keymap.ts first) to the registered scroll-into-view;
  (3) widen the outside-click clear to any pointerdown outside the grid subtree (the
  interaction layer already has a container ref; use a document pointerdown listener
  active only while a selection exists — the PLAN §4.6 "no document listeners except
  during active drag" rule extends to "while a selection exists" — record that
  extension in the code comment); (4) add `onSelectionCleared?` to the provider props
  (ADDITIVE — no existing prop changes; fire when selection empties from any path,
  including outside-click and Delete-cleared-range); (5) keybindings-dialog entry for
  the two new bindings (it is generated from the keymap — single source of truth, no
  hardcoded list).
- **Verify:** `pnpm test -- keyboard interaction` + new browser tests for each behavior;
  `onSelectionCleared` fires exactly once per clear (regression against
  `store.test.tsx:2129-2137`'s "onSelectionChange does NOT fire on clear" — the new
  callback is distinct and must not disturb that).
- **Done:** all three spec'd behaviors pass browser tests; a11y + keymaps docs updated.
- **STOP:** if `primary+enter` collides with a consumer keymap override path (keymap
  override semantics are settled in PLAN §5 — verify before binding).

## 007 — Lazy rows: short `fetchRows` resolution (N5)

- **Why:** `handleFulfilled` (data-grid-lazy/use-data-grid-lazy-rows.ts:123-133) marks
  the WHOLE requested range loaded even when the fetch resolves with fewer rows than
  `[start, end)` — trailing holes persist forever, `pendingCount` undercounts.
- **Steps:** mark only the rows actually returned as loaded (merge per-row ranges, not
  the requested range); the leftover gap stays a hole and re-fetches on next visibility
  (the existing refetch-on-visibility path then handles it); dev-mode warn when a
  short resolution is detected (the repo's dev-guardrail pattern, `is-dev.ts`).
- **Verify:** new test in `use-data-grid-lazy-rows.test.ts` — stub `fetchRows` resolving
  short; assert the unfetched tail stays pending, re-fetches on next visibility, and
  `pendingCount` is correct; existing lazy tests untouched.
- **Done:** contract doc (lazy-loading.mdx) states the short-resolution behavior; test green.
- **STOP:** if the range bookkeeping (`mergeRanges`, range-math.ts) can't represent
  partial fills — that would mean a data-model change to the add-on; report first.

## 008 — Editor keystroke-to-paint timing test

- **Why:** PLAN §4.6 budget "Keystroke-to-paint < 16ms while editing at 10k+ rows" is
  unenforced — no timing test exists around F2/typing/Enter (perf report budget table).
- **Steps:** browser perf test modeled on `test/perf.browser.test.tsx`'s existing
  probe structure: mount the 10k-row demo grid, F2 into a cell, type 50 chars with
  per-keystroke rAF timestamps, assert median keystroke-to-paint < 16ms; commit path
  (Enter → one commit render) asserted via the existing render-count probe.
- **Verify:** `pnpm test -- project=browser` — the new guard passes at the budget;
  flake-handling per the 2026-07-17 triage rule (environmental flakes: record, don't
  relax the bar — see `docs/agent-work/2026-07-17-perf-audit.md`'s flake note).
- **Done:** the budget has a machine-checkable guard in CI.
- **STOP:** if the headless environment can't measure sub-frame timing reliably
  (known environmental flake class) — use the median-of-N pattern from
  `streaming.browser.test.tsx` and note it.

## 009 — Doc/surface hygiene

- (a) `research/glide-behavior-spec.md:52` — "grow to grid edge" contradicts :43's
  data-boundary mandate; gridcn implements data-boundary (correct per Excel). One-line
  spec correction (N6).
- (b) Store-barrel surface (bugs report, still-open dx item): `getFocusCell`,
  `useDataGridCellTypes`, `useDataGridFillHandlers`, `useDataGridActiveColumn`,
  `useDataGridOverlayPlugins`, `useDataGridRowBands` are exported from `store/index.ts`
  but not from the public `data-grid.tsx` entry. Decision: re-export the two
  consumer-facing ones (`useDataGridCellTypes`, `useDataGridActiveColumn`) and mark the
  four provider seams as `@internal` in JSDoc (they are the #48 extraction seams;
  consumers shouldn't need them). One commit, doc + two export lines.
- **Verify:** `pnpm types:check` + `pnpm lint`.
- **Done:** spec line corrected; surface consistent or documented as internal.

## 010 — Hoist per-cell store subscriptions (P5)

- **Why:** each mounted cell runs ~3 selector callbacks per store notification
  (`useDataGridActions()`, `useDataGridCellEditingError`, `useDataGridCellTypes` —
  cell.tsx:102,111,168). All stable references today (no re-renders), but at ~544
  cells per full-swap window that's ~1.6k invocations per tick on the hottest path.
- **Steps:** serve `actions` + `cellTypes` from the layout context (root.tsx already
  provides `DataGridRootContext`) — the cell reads context instead of subscribing;
  keep `useDataGridCellEditingError` (genuinely per-cell and already narrow).
- **Verify:** render-count tests unchanged; `pnpm test` green; the streaming tick
  timing guard (`streaming.browser.test.tsx:216-236`) must not regress.
- **Done:** selector invocations per tick drop measurably (log before/after in the
  streaming probe output if it supports it).
- **STOP:** if context re-creates the actions object per render (it must be the same
  stable `actions` object — verify root.tsx's context value memoization first).

## Decision items (user, non-blocking)

Carried from the features audit — these are product decisions, not fixes; defaults are
recorded per the audit's tracking doc (proceed with the recommendation if the user
doesn't answer):

1. **Test-infra spec (#100):** adopt D+C (vitest project split/serial/retry + capped
   Playwright layer for WebKit/Firefox clipboard/download/RTL). Default: adopt.
2. **#103 core gaps:** pre-sorted-data mode, `aria-sort` when sort suppressed,
   `toggleSort` reusability, lazy `invalidate`. Default: build `aria-sort` (a11y
   correctness) only; the other three wait for a driving use case.
3. **Global filter/sort shortcuts (#34),** Ctrl+Shift+F/S: default: defer — needs
   keybindings-dialog integration design and is parity-driven, not spec-driven.
4. **`content-visibility: auto` revisit:** the register's "highest-value revisit"
   (up to 5× fps), parked on the pin-shadow pixel probe. Default: schedule after P1–P3
   land (it interacts with the overlay/pin-shadow layer that 005 touches).
5. **RTL lint guard:** forbid raw `rect.left`/`scrollLeft` outside
   `windowing/direction.ts` (open backlog since #71). Default: add the eslint rule
   (the repo already uses `no-restricted-imports` — same mechanism).
6. **Manual screen-reader pass (#67):** the only unverified a11y claim; blocks any WCAG
   conformance statement. Default: schedule as a user-lane task (it is manual by nature).

## Considered and rejected (do not re-audit)

From the 2026-09-03 perf re-check — prior refutations stand, verified unchanged:
`useScrolledEdges` attr writes (snapshot reads), `DataGridMarkerCell`/`DataGridHeaderCell`
unmemoized (cheap render, no churn), `DataGridOverlays` per-render rect arrays (bounded),
`computeWindow` render-phase memo, `cumulativeRights` per-tick allocation (column-window
width is small), `useElementDimensions` ref-in-render, `body.tsx` gridRowStart
useLayoutEffect, search full-scan (bounded by `MAX_SEARCH_MATCHES = 1000`), custom-
comparator value decoration (treated as a regression risk, not a win, 2026-08-20
dismissal). WONTFIX accepted: `isBulkBatchCurrent` rowId-set rebuild (per-batch, not
per-tick), async `updateCells` triple column-map build (batch-rare path).
