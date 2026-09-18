# Performance audit — 2026-09-03

Read-only audit (branch `dev`, HEAD `a4a303a`), one dimension of the 2026-09-03
multi-agent audit. Scope: re-verify the 2026-08-02 optimization audit's perf findings
against current source, fresh pass over the hot paths, test-guard inventory,
PLAN.md §4.6 budget enforcement check. Companion: `2026-09-03-audit-bugs.md`,
`2026-09-03-audit-features.md`.

Headline: **every verified HIGH/MEDIUM from the 08-02 audit is fixed** (stream
generation, O(rowCount) marker selector, `compare` wiring, scroll-tick thrash,
fill-tracker identity, presence adapter, TSV parse allocation, import chunking,
heap-test no-op). Two new HIGHs found, both in the bulk-write funnel:
`deleteSelection` and paste have **no cell-count bound** and share a
per-write `visibleColumns.find` O(cols) scan in `computeRowEditsBatch`.
The "selection drag re-renders zero cells" budget is violated by the a11y
`aria-selected` prop path (cells whose membership flips re-render).

## Prior-audit perf findings: verdicts

| finding (prior location: 2026-08-02-optimization-audit.md) | verdict | current evidence |
|---|---|---|
| Sync Standard Schema burns a stream generation (HIGH, :14) | FIXED | token bump only in the async branch: `store/create-store.ts:676-687` |
| `useDataGridAllRowsSelectedState` O(rowCount) per store write (HIGH, :62) | FIXED | O(range runs): `store/hooks.ts:634-668`; guard `test/store.test.tsx:1677` |
| Cell-type `compare` never wired (HIGH, :98) | FIXED | `store/compute.ts:189-212`; guard `store/sort-compare.test.tsx:47` |
| Scroll-tick layout thrash (MEDIUM, :258) | FIXED | one hoisted `readGeometry` before writes: `windowing/use-scroll-snapshot.ts:48-56,174-182` |
| `serializeCopyScope` O(rows×cols) per-cell + no cap (MEDIUM, :293) | PARTIALLY FIXED | rows/columns hoisted + `MAX_COPY_CELLS = 200_000` (:75, :86-116); **rect scope still uncapped — new finding P3 below** |
| `useDataGridFill` fresh tracker identity per render | FIXED | `useMemo`: `data-grid-fill/use-data-grid-fill.tsx:63-66`; `fill-tracker-identity.browser.test.tsx` |
| rowId-native presence adapter O(n) per store change | FIXED | `hooks.ts:377-392` keys on identity; docs multiplayer-presence.mdx:138-144 |
| `applyCellUpdates`/`deleteSelection` missing view/search reconcile | FIXED | `reconcileAfterWrite` on all write paths: `create-store.ts:616-626,631-651` |
| `useDataGridRowHasError` prefix false-positives | FIXED | exact key probes: `hooks.ts:204-212` |
| `pruneCellErrors` colon mis-parse | FIXED | every-colon-split probe: `compute.ts:57-62,94-109`; guard `store/validate-row.test.tsx:90` |
| `cellErrorKey` not public | FIXED | exported `store/index.ts:23` |
| `insertRow`/`duplicateRows` didn't prune `cellErrors` | FIXED | `create-store.ts:773,792,821,876` |
| `parseClipboardText` char-by-char `+=` | FIXED | run-based slice flush: `clipboard/parse-clipboard.ts:55-124`; `parse-clipboard-perf.test.ts` |
| Import validated every cell, no chunking/cancellation | FIXED | chunked + `AbortSignal`: `data-grid-io/build-imported-rows.ts:7-11,60-62,110-131` |
| `useDataGridState` fresh `getRowId` per render | FIXED | stable callback: `data-grid-history/use-data-grid-state.ts:47`; guard `use-data-grid-state.test.ts:70-76` |
| Streaming heap test no-op'd without `performance.memory` | FIXED | loud fail: `test/streaming.browser.test.tsx:227-229` |
| `isBulkBatchCurrent` rebuilds full rowId Set | WONTFIX (accepted) | `validation/bulk-generation.ts:49-55` — per-batch (not per-tick) cost; left as-is |
| Async `updateCells` builds column maps 3× per batch | WONTFIX (accepted) | `commit.ts:209,268,289` — batch-rare path |
| `useScrolledEdges` / marker-cell / header-cell / overlays / computeWindow / cumulativeRights / ref-in-render / body gridRowStart / search full-scan (10 items from the 65-row tail) | REFUTED (unchanged, prior refutation stands) | see `docs/agent-work/2026-08-02-optimization-audit.md:637-652` — snapshot reads, cheap-to-resolve layout, bounded by `MAX_SEARCH_MATCHES` |

## New findings

### P1 [HIGH | CONFIRMED] `deleteSelection` has no bound: full-grid delete = ~2M writes + ~40M column scans

- **Where:** `store/create-store.ts:597-616` (writes materialized per cell from `selectionRects`),
  `store/commit.ts:147-150` (`visibleColumns.find` per write)
- **Mechanism:** a selection rect is expanded to one write object per cell
  (100k rows × 20 cols = 2M writes); `computeRowEditsBatch` then resolves the column
  with a linear `s.visibleColumns.find((c) => c.id === write.columnId)` **per write**
  (2M × 20 = 40M comparisons) plus per-cell `getCellValue`/`setCellValue`/`Object.is`.
  A whole-row or whole-column selection (header/marker click) triggers the same path.
- **Impact at 100k×20:** seconds of main-thread freeze on Delete after Ctrl+A;
  the 2M-element `ops` array is additionally retained by history (capacity 100)
  and re-scanned by the undo path (see bugs report N1).
- **Effort M** (bulk fast path / cap while keeping the one-`onDataChange` invariant),
  risk M (op semantics must stay identical).
- **Fix direction (review-only, not implemented):** hoist the `columnId → index` map
  once in `computeRowEditsBatch` (fixes the 40M scans for delete AND paste AND
  `applyCellUpdates` — S alone), and decide a delete bound for row/column-channel
  selections (Excel deletes whole rows/columns; a cap with a confirmation-free
  truncation would be wrong — see follow-up plan 001/002 for the options).

### P2 [HIGH | CONFIRMED] Paste into a large range has no cell-count bound

- **Where:** `clipboard/use-grid-clipboard.ts:154-157` (`tileToHeight`), `:188-221`
  (`buildPasteCandidates`), `:250-279` (`applyParsedPaste`), then `applyCellUpdates`
  → `computeRowEditsBatch` (same per-write `.find`)
- **Mechanism:** a single pasted row tiles down to the target range's height
  (`targetHeight` = current range height). Two-stage Ctrl+A makes the range the
  whole grid; pasting 1×20 then tiles to 100k rows → ~2M candidates (each with a
  `getRowId` call + `fromText` parse) → ~2M writes → ~40M column scans. No cap
  exists on the paste side (`MAX_COPY_CELLS` bounds copies only).
- **Impact at 100k×20:** tab freeze + large transient allocation; same shared
  `.find` root cause as P1.
- **Effort M**, risk M (tiling is documented behavior; the bound must truncate or
  refuse with a surfaced label, not silently drop — same surface pattern as the
  copy cap's truncation).

### P3 [MEDIUM | CONFIRMED] Rect-scope copy bypasses `MAX_COPY_CELLS`

- **Where:** `clipboard/use-grid-clipboard.ts:130-131` (rect → `serializeRect`, uncapped;
  the :127-128 comment justifies it as "bounded by what the user dragged")
- **Mechanism:** two-stage Ctrl+A produces a whole-grid **rect** selection
  (`selection/select-all-progression.ts:91-103`), so Ctrl+A + Ctrl+C on a 100k-row
  grid serializes ~2M cells with no cap — exactly the case the cap's own doc comment
  says it exists to bound.
- **Effort S** (apply the cap to rect scope, or special-case the full-grid rect),
  risk LOW (truncation is already the accepted copy semantics).
- Guard exists and documents the gap: `use-grid-clipboard.copy-cap.test.ts:100`
  asserts rect scope is NOT capped.

### P4 [MEDIUM | CONFIRMED] Selection membership re-renders cells (a11y `aria-selected` vs zero-render budget)

- **Where:** `row.tsx:126` (`isSelected={isActive || colRangesContain(cellState.selectedColRanges, index)}`),
  `cell.tsx:247` (`aria-selected={isSelected || undefined}`),
  `store/hooks.ts:526-531,573-580` (per-row `useDataGridRowCellState` with content equality)
- **Mechanism:** `DataGridRow`/`DataGridCell` are memoized (row.tsx:52, cell.tsx:330),
  but a range drag that changes a cell's membership flips `isSelected` on the
  boundary cells → prop change → those cells re-render on the drag frame. With a
  large band being dragged, the whole visible band can churn. `aria-selected` on
  `role="gridcell"` is a WAI-ARIA grid requirement, so this is a deliberate
  a11y/perf tension, not an accident.
- **Impact:** violates PLAN.md §4.6 "Selection drag re-renders zero cells"; the
  existing render-count tests guard row *identity* and active-cell moves, not
  membership flips (see budget table).
- **Effort M, decision required:** (a) accept + document the tradeoff and add a
  membership-flip render-count test; (b) imperative `aria-selected` writes via the
  cell's existing ref (zero re-renders, a11y preserved). Follow-up plan 004 carries
  the decision with a recommendation.

### P5 [LOW | PLAUSIBLE] Three store subscriptions per mounted cell

- **Where:** `cell.tsx:102,111,168` (`useDataGridActions()`, `useDataGridCellEditingError`, `useDataGridCellTypes`)
- **Mechanism:** all three return stable references, so no re-renders result — but
  every store notification runs ~3 selector callbacks per mounted cell (~544 cells
  per full-swap window ≈ 1.6k invocations per tick).
- **Effort S/M** (hoist actions/cellTypes via the layout context), risk LOW.

## Hot-path test guards

| hot path | guard | status |
|---|---|---|
| Smooth scroll / no blanks | `test/perf.browser.test.tsx:70-117`, `scroll-drag.browser.test.tsx:83-140`, `data-grid.browser.test.tsx:207-226` | covered |
| Selection drag zero cell re-renders | `data-grid.test.tsx:556-613,885-904`, `pinned.browser.test.tsx:205` | **uncovered for membership flips; current source violates the invariant (P4)** |
| Keystroke-to-paint <16ms while editing | — | **uncovered: no editor keystroke timing test exists** |
| Paste/fill/delete = one `onDataChange` | `data-grid.browser.test.tsx:1034-1075`, `fill.browser.test.tsx:114-273`, `store.test.tsx:1270-1288` | covered for count; **not for full-selection CPU cost (P1/P2)** |
| Mount cost independent of row count | `data-grid.test.tsx:38-49`, `data-grid.browser.test.tsx:59-113` | covered |
| Streaming tick cost + heap | `test/streaming.browser.test.tsx:216-262` | covered |
| Search once-per-text + cap | `test/store-search-perf.test.tsx:46-100` | covered |
| Sort/filter algorithmic cost at 100k | `sort-filter/view-index-perf.test.ts:52-131` | covered |
| Copy cap | `clipboard/use-grid-clipboard.copy-cap.test.ts:35-100` | partial: rows/columns only (P3) |
| Undo/redo cost at scale | — | **uncovered: `history.test.ts` uses ≤5-row arrays (linked to bugs N1)** |

## Budgets vs enforcement (PLAN.md §4.6)

| budget | enforcement | verdict |
|---|---|---|
| Smooth scroll, no blank flashes | perf/scroll-drag/zero-blank browser tests | **enforced** |
| Keystroke-to-paint <16ms while editing | no editor timing test | **unenforced** |
| Selection drag re-renders zero cells | row-identity + active-move tests only | **unenforced and violated (P4)** |
| Paste/fill/delete = one `onDataChange` + one commit render | onDataChange-count tests | **partially enforced** (no full-selection CPU guard, no commit-render count) |
| Mount cost independent of row count | windowed-row + quick-mount tests | **enforced** |

Settled levers from `docs/agent-work/2026-08-01-not-supported-register.md`
(row pooling, velocity-overscan cuts, deferred commits, parked `content-visibility`)
were not re-reported.
