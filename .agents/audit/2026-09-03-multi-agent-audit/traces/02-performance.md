# Trace — performance audit agent

- Task id: `ses_f9993685cffeYOkNW0ClZRvigC` (opencode task tool, type `general`)
- Mandate: read-only, research only; performance dimension
- Input prompt: carried PLAN.md §4.6/§4.1/§4.2, the full 08-02 audit (verified + 65-row tail),
  the 07-17 perf audit + fling-smoothness report, the settled-levers register, hot-path file
  list, the 4-task checklist (prior findings, fresh pass, test guards, budgets)
- Returned: raw report below, unedited. Orchestrator vetted P1–P5 against source
  (create-store.ts:597-616, commit.ts:147-150, use-grid-clipboard.ts:130-131/154-279,
  row.tsx:126, cell.tsx:247/330, hooks.ts:526-580) — all confirmed.

---

## Performance audit — 2026-09-03

Read-only source audit at HEAD `b620e4a`. No files were modified and no test/build/dev-server commands were run.

### Prior-audit perf findings: verdicts

| finding + prior location | verdict | current evidence |
|---|---|---|
| Sync Standard Schema in `updateCells` burns a stream generation — `docs/agent-work/2026-08-02-optimization-audit.md:14` | FIXED | Token increment is now only in the async branch: `registry/default/blocks/data-grid/store/create-store.ts:676-678`. |
| `useDataGridAllRowsSelectedState` O(rowCount) selector — `docs/agent-work/2026-08-02-optimization-audit.md:62` | FIXED | Now O(range/row-channel runs), not O(rowCount): `registry/default/blocks/data-grid/store/hooks.ts:634-668`; guard at `registry/default/blocks/data-grid/test/store.test.tsx:1677`. |
| Cell-type `compare` never wired into sorting — `docs/agent-work/2026-08-02-optimization-audit.md:98` | FIXED | `compute.ts:189-212` wires `accessor.compare`; `sort-filter/build-view-index.ts:87-104` and `sort-filter/incremental-view-index.ts:22-25` consume it; guard at `registry/default/blocks/data-grid/store/sort-compare.test.tsx:47`. |
| Scroll-tick layout thrash — `docs/agent-work/2026-08-02-optimization-audit.md:258` | FIXED | One `readGeometry` per tick before writes: `registry/default/blocks/data-grid/windowing/use-scroll-snapshot.ts:48-56,174-182`. |
| `serializeCopyScope` per-cell copy + missing cap — `docs/agent-work/2026-08-02-optimization-audit.md:293` | PARTIALLY FIXED | Rows/columns copy now hoists resolution and caps at `MAX_COPY_CELLS`: `registry/default/blocks/data-grid/clipboard/use-grid-clipboard.ts:75,86-116`. Rect copy remains uncapped: `use-grid-clipboard.ts:60-66,130-131`. New finding below. |
| `useDataGridFill` returned fresh component identity — `docs/agent-work/2026-08-02-optimization-audit.md:309` | FIXED | Stable tracker component via `useMemo`: `registry/default/blocks/data-grid-fill/use-data-grid-fill.tsx:63-66`. |
| rowId-native presence adapter was O(n) per store change — `docs/agent-work/2026-08-02-optimization-audit.md:443` | FIXED | `useDataGridRowIdToViewRow()` keys on `viewIndex`/`data`/`getRowId` identity only: `registry/default/blocks/data-grid/store/hooks.ts:377-392`; docs updated at `content/docs/multiplayer-presence.mdx:138-144`. |
| `applyCellUpdates`/`deleteSelection` did not reconcile view/search — 65-row table at `docs/agent-work/2026-08-02-optimization-audit.md:640` | FIXED | Both paths now call `reconcileAfterWrite`: `registry/default/blocks/data-grid/store/create-store.ts:616-626,631-651`. |
| `useDataGridRowHasError` prefix-match false positives — 65-row table at `docs/agent-work/2026-08-02-optimization-audit.md:637` | FIXED | Exact per-column key probes: `registry/default/blocks/data-grid/store/hooks.ts:204-212`. |
| `pruneCellErrors` mis-splits colon-bearing ids — 65-row table at `docs/agent-work/2026-08-02-optimization-audit.md:691` | FIXED | Tries every colon split against live rowIds: `registry/default/blocks/data-grid/store/compute.ts:57-62,94-109`; guard at `registry/default/blocks/data-grid/store/validate-row.test.tsx:90`. |
| `cellErrors` key helper not public — 65-row table at `docs/agent-work/2026-08-02-optimization-audit.md:672` | FIXED | `cellErrorKey` exported: `registry/default/blocks/data-grid/store/index.ts:23`. |
| `insertRow`/`duplicateRows` did not prune `cellErrors` — 65-row table at `docs/agent-work/2026-08-02-optimization-audit.md:687` | FIXED | Prune call present on row-shape paths: `registry/default/blocks/data-grid/store/create-store.ts:773,792,821,876`. |
| `parseClipboardText` char-by-char concatenation — 65-row table at `docs/agent-work/2026-08-02-optimization-audit.md:652` | FIXED | Run-based slice append: `registry/default/blocks/data-grid/clipboard/parse-clipboard.ts:55-124`; perf guard at `registry/default/blocks/data-grid/clipboard/parse-clipboard-perf.test.ts`. |
| Import validated every cell with no chunking/cancellation — 65-row table at `docs/agent-work/2026-08-02-optimization-audit.md:656` | FIXED | Large imports chunk and honor `AbortSignal`: `registry/default/blocks/data-grid-io/build-imported-rows.ts:7-11,60-62,110-131`; dialog wiring at `registry/default/blocks/data-grid-io/import-dialog.tsx:105`. |
| `useDataGridState` passed a fresh `getRowId` each render — 65-row table at `docs/agent-work/2026-08-02-optimization-audit.md:694` | FIXED | Stable callback: `registry/default/blocks/data-grid-history/use-data-grid-state.ts:47`; guard at `registry/default/blocks/data-grid-history/use-data-grid-state.test.ts:70-76`. |
| Streaming heap test silently no-oped when `performance.memory` unavailable — 65-row table at `docs/agent-work/2026-08-02-optimization-audit.md:675` | FIXED | Test now fails loudly if heap API is unavailable: `registry/default/blocks/data-grid/test/streaming.browser.test.tsx:227-229`. |
| `isBulkBatchCurrent` rebuilds full rowId set — 65-row table at `docs/agent-work/2026-08-02-optimization-audit.md:638` | WONTFIX / UNCHANGED | Still rebuilds the full rowId `Set` per resolved async batch: `registry/default/blocks/data-grid/validation/bulk-generation.ts:49-55`. |
| Async `updateCells` builds column maps 3× per batch — 65-row table at `docs/agent-work/2026-08-02-optimization-audit.md:688` | WONTFIX / UNCHANGED | `patchesNeedAsyncCheck`, `prevalidatePatches`, and `computeCellPatchBatch` each build a `columnsById` map: `registry/default/blocks/data-grid/store/commit.ts:209,268,289`. |
| `useScrolledEdges` unconditional DOM attr writes — 65-row table at `docs/agent-work/2026-08-02-optimization-audit.md:641` | REFUTED / UNCHANGED | Reads geometry from snapshot; attribute writes remain, but prior refutation still applies: `registry/default/blocks/data-grid/windowing/use-scrolled-edges.ts:40-51`. |
| `DataGridMarkerCell` unmemoized — 65-row table at `docs/agent-work/2026-08-02-optimization-audit.md:642` | REFUTED / UNCHANGED | Still an unmemoized function component: `registry/default/blocks/data-grid/rows/marker-cell.tsx:27`. |
| `DataGridHeaderCell` unmemoized — 65-row table at `docs/agent-work/2026-08-02-optimization-audit.md:643` | REFUTED / UNCHANGED | Still an unmemoized function component: `registry/default/blocks/data-grid/header-cell.tsx:49`. |
| `DataGridOverlays` allocates rect arrays per render — 65-row table at `docs/agent-work/2026-08-02-optimization-audit.md:644` | REFUTED / UNCHANGED | Rect arrays still built inline per render: `registry/default/blocks/data-grid/overlays.tsx:204-228`. |
| `computeWindow` repeats work in render-phase memo — 65-row table at `docs/agent-work/2026-08-02-optimization-audit.md:645` | REFUTED / UNCHANGED | Render-phase `useMemo` still calls `computeWindow`: `registry/default/blocks/data-grid/windowing/use-row-window.ts:178-184`. |
| `cumulativeRights` allocates per horizontal scroll tick — 65-row table at `docs/agent-work/2026-08-02-optimization-audit.md:646` | REFUTED / UNCHANGED | Still allocates a full-length array: `registry/default/blocks/data-grid/windowing/use-column-window.ts:24-32`. |
| `useElementDimensions` writes a ref during render — 65-row table at `docs/agent-work/2026-08-02-optimization-audit.md:647` | REFUTED / UNCHANGED | Ref write during render remains: `registry/default/blocks/data-grid/windowing/use-scroll-snapshot.ts:308-314`. |
| `body.tsx` gridRowStart effect runs unconditionally — 65-row table at `docs/agent-work/2026-08-02-optimization-audit.md:648` | REFUTED / UNCHANGED | `useLayoutEffect` still writes `gridRowStart` for every mounted row on every body render: `registry/default/blocks/data-grid/body.tsx:170-178`. |
| Search re-scans all rows × visible columns — 65-row table at `docs/agent-work/2026-08-02-optimization-audit.md:651` | REFUTED / UNCHANGED | Full scan still occurs, bounded by `MAX_SEARCH_MATCHES = 1000`: `registry/default/blocks/data-grid/sort-filter/find-search-matches.ts:13-33`, `registry/default/blocks/data-grid/store/compute.ts:371`. |
| Custom sort comparator value-decoration lead from 2026-08-20 dismissal notes — `docs/agent-work/2026-08-02-optimization-audit.md:630` | NOT RE-OPENED | Custom comparator path still calls `rawCellValue` per comparison, but the prior dismissal treated decoration as a regression, not a win: `registry/default/blocks/data-grid/store/compute.ts:195-211`, `registry/default/blocks/data-grid/sort-filter/build-view-index.ts:91-104`. |

### New findings

| severity | file:line | mechanism | cost at 100k×20 | effort | confidence |
|---|---|---|---|---|---|
| HIGH | `registry/default/blocks/data-grid/store/create-store.ts:597-616` + `registry/default/blocks/data-grid/store/commit.ts:147-150` | `deleteSelection()` materializes one write object per selected cell. Full row/column/grid selections are expanded by `selectionRects` (`registry/default/blocks/data-grid/selection/line-ops.ts:35-47`). `computeRowEditsBatch` then does `visibleColumns.find` per write. Full-grid delete = ~2M writes + ~40M linear column scans + per-cell `getCellValue`/`setCellValue`/`clearValue`. Fix risk: M (needs a bulk/cap/fast path while preserving one `onDataChange`). | M | CONFIRMED |
| HIGH | `registry/default/blocks/data-grid/clipboard/use-grid-clipboard.ts:154-157,188-221,250-265` | Paste tiles a parsed row to the target range height, builds one candidate per target cell, then calls `applyCellUpdates` → `computeRowEditsBatch` (same `visibleColumns.find` per write). No paste-side cell cap exists. Pasting 1×20 into a 100k-row range = ~2M candidates/writes + ~40M column scans. Fix risk: M (add paste-target cap or bulk fast path). | M | CONFIRMED |
| MEDIUM | `registry/default/blocks/data-grid/clipboard/use-grid-clipboard.ts:60-66,130-131` | Rect-scope copy bypasses `MAX_COPY_CELLS`. The comment says rect is “bounded by what the user dragged”, but two-stage Ctrl+A creates a full-grid rect via `selectionForRect(wholeGrid, active)` in `registry/default/blocks/data-grid/selection/select-all-progression.ts:91-103`. Full-grid copy = ~2M `toText`/`getCellValue` calls + TSV/HTML string build. Fix risk: S (extend cap to rect scope or special-case full-grid select). | S | CONFIRMED |
| MEDIUM | `registry/default/blocks/data-grid/row.tsx:126` + `registry/default/blocks/data-grid/cell.tsx:247` + `registry/default/blocks/data-grid/store/hooks.ts:526-531,573-580` | Selection membership is passed into `DataGridCell` as `isSelected` and rendered as `aria-selected`. `useDataGridRowCellState` recomputes `selectedColRangesForRow` for mounted rows, so a range drag that changes membership re-renders affected cells. This contradicts the PLAN “selection drag re-renders zero cells” invariant and the accessibility doc claim. Cost: up to all mounted cells (~544 in the reference full-swap window) can re-render per drag frame when selection membership changes across the visible band. Fix risk: M (imperative `aria-selected` writes or a selection-membership overlay/a11y model that avoids cell prop churn). | M | CONFIRMED |
| LOW | `registry/default/blocks/data-grid/cell.tsx:102,111,168` | Each mounted cell subscribes to `useDataGridActions()`, `useDataGridCellEditingError(coord)`, and `useDataGridCellTypes()`. Actions/cellTypes are stable references, so this does not normally re-render cells, but every store notification still runs ~3 selector callbacks per mounted cell (~1.6k selectors at ~544 cells). Fix risk: S/M (hoist actions/cellTypes via context or refs; keep per-cell error scoping). | S/M | PLAUSIBLE |

### Hot-path test guards: covered vs uncovered

| hot path | guard evidence | status |
|---|---|---|
| Smooth scroll / no blanks | `registry/default/blocks/data-grid/test/perf.browser.test.tsx:70-117` (full-swap vs idle FPS), `registry/default/blocks/data-grid/test/scroll-drag.browser.test.tsx:83-140` (random thumb-drag blank detector), `registry/default/blocks/data-grid/test/data-grid.browser.test.tsx:207-226` (zero-blank sticky viewport) | Covered |
| Selection drag re-renders zero cells | `registry/default/blocks/data-grid/test/data-grid.test.tsx:556-613` (row identity/row subscription), `registry/default/blocks/data-grid/test/data-grid.test.tsx:885-904` (active-cell move only), `registry/default/blocks/data-grid/test/pinned.browser.test.tsx:205` (selection re-renders overlays, not row identity) | Uncovered for selection membership / `aria-selected` cell renders; current source also violates the stated invariant. |
| Keystroke-to-paint < 16ms while editing | No timing guard found around F2/typing/Enter commit. Existing timing tests cover scroll, parse, view-index, and streaming paths, not editor keystroke-to-paint. | Uncovered |
| Paste/fill/delete = one `onDataChange` | Paste: `registry/default/blocks/data-grid/test/data-grid.browser.test.tsx:1034-1048,1057-1075`, `registry/default/blocks/data-grid/test/async-validation.browser.test.tsx:177`. Fill: `registry/default/blocks/data-grid-fill/test/fill.browser.test.tsx:114,148,177,252,273`. Delete: `registry/default/blocks/data-grid/test/store.test.tsx:1270-1288`. | Covered for one `onDataChange`; not directly covered for “one commit render” or full-selection CPU cost. |
| Mount cost independent of row count | `registry/default/blocks/data-grid/test/data-grid.test.tsx:38-49` (content size + windowed rows), `registry/default/blocks/data-grid/test/data-grid.browser.test.tsx:59-113` (1k/10k/10k×100 quick windowed mounts) | Covered |
| Streaming update cost / heap | `registry/default/blocks/data-grid/test/streaming.browser.test.tsx:216-236` (per-tick cost + heap growth), `registry/default/blocks/data-grid/test/streaming.browser.test.tsx:245-262` (DOM mutation cap) | Covered |
| Search computed once + capped | `registry/default/blocks/data-grid/test/store-search-perf.test.tsx:46-100` (one `findSearchMatches` per `setSearch`, 1000 cap) | Covered |
| Sort/filter algorithmic guard at 100k | `registry/default/blocks/data-grid/sort-filter/view-index-perf.test.ts:52-131` (filter/sort ceilings at 100k rows) | Covered |
| Copy cap | `registry/default/blocks/data-grid/clipboard/use-grid-clipboard.copy-cap.test.ts:35-100` | Partial: rows/columns scopes covered; line `100` explicitly asserts rect-scope copy is not capped. |

### Budgets vs enforcement

| budget | PLAN source | enforcement | verdict |
|---|---|---|---|
| Smooth scroll, no blank flashes | `PLAN.md:119` | `perf.browser.test.tsx`, `scroll-drag.browser.test.tsx`, `data-grid.browser.test.tsx` | Enforced |
| Keystroke-to-paint < 16ms while editing | `PLAN.md:120` | No editor keystroke timing test found | Unenforced |
| Selection drag re-renders zero cells | `PLAN.md:121` | Row-identity and active-move tests exist, but no selection-membership cell render-count guard; current `aria-selected` prop path re-renders cells | Unenforced and violated |
| Paste/fill/delete = one `onDataChange` + one commit render | `PLAN.md:122` | `onDataChange` count tests exist for paste/fill/delete; no full-selection CPU/cap guard and no direct commit-render count assertion | Partially enforced |
| Mount cost independent of row count | `PLAN.md:123` | Windowed-row and quick-mount tests | Enforced |

Settled levers from `docs/agent-work/2026-08-01-not-supported-register.md` were not re-reported: row pooling, velocity-overscan cap cuts, deferred commit behavior, and parked `content-visibility` work were treated as closed.
