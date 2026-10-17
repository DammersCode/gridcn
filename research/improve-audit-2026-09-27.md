# Improve audit — API & performance research fleet (2026-09-27)

Status: **RESEARCH** — findings are captured, not yet planned. Audit HEAD: `b36ae5a`
(branch `chore/apache-2-license`).

## Method

Four parallel read-only advisor agents (`improve` skill, standard effort), one per axis:
performance, correctness/bugs, API direction/features, architecture/tech-debt/DX.
Each agent read the audit playbook, audited `registry/default/blocks/` only, and returned
structured findings.

Raw output: 26 findings (6 perf, 5 bugs, 6 API, 9 arch) plus rejected candidates.
The main agent independently opened the cited code for the findings marked **Vetted**
before presentation. Findings marked **Pending** carry the subagent's evidence as-is and
need independent verification — that is the point of this file.

## How to verify a finding

1. Read the cited `file:line` locations (audit HEAD `b36ae5a`, or the current tree if the files are unchanged since).
2. Check the **Claim** against what is actually there.
3. Where the Verify step names a command, run it (all commands here are read-only).
4. Report one of: **CONFIRMED** (claim holds at the cited lines) / **REFUTED** (paste the actual line content) / **MOVED** (file changed, cite the new location).

Vetting flags:
- **Vetted** — main agent opened the cited code and confirmed the claim.
- **Pending** — subagent report only; verify before planning.

---

## Findings

### Performance

#### PERF-01 — `withFilterIds` defeats the `_syncProps` sync-skip guard for a controlled `filterState`
- **Vetted**: YES (opened `compute.ts`, `types.ts`, `create-store.ts`)
- **Evidence**:
  - `registry/default/blocks/data-grid/store/compute.ts:163-165` — `withFilterIds` runs `filters.map(...)`, returning a fresh array every call even when every filter already has a `filterId`.
  - `registry/default/blocks/data-grid/store/create-store.ts:1067` — `_syncProps` runs `withFilterIds(props.filterState)` on every sync.
  - `registry/default/blocks/data-grid/store/types.ts:749-761` — `syncInputsEqual` compares `filterState` by reference only (`===`).
  - `registry/default/blocks/data-grid/store/create-store.ts:1126-1132` — `unchanged === false` forces the full `computeViewIndex` + `computeSearchMatches` + `computeVisibleColumns` rebuild.
- **Claim**: A consumer with a controlled `filterState` prop pays a full filter+sort+search rebuild on every unrelated re-render of the owning component, because the fresh array always fails the reference-equality guard the echo mechanism exists for.
- **Verify**: confirm the three call sites above; the documented skip contract is at `store/types.ts:730-734`; the controlled `filterState` pattern is documented in `content/docs/recipes.mdx`.
- **Impact**: the repo's measured data-echo cliff (~56 ms at 100k rows, per the comment at `create-store.ts:1077-1079`) is re-paid per owner render for the filter channel.
- **Effort**: S. **Risk**: LOW (identity-preserving; `withFilterIds` tests guard it). **Confidence**: HIGH.
- **Fix sketch**: in `withFilterIds`, return the input array unchanged (same reference) when no filter is missing a `filterId`.

#### PERF-02 — `selectLine` re-materializes the whole channel instead of using RLE slice ops
- **Vetted**: PENDING
- **Evidence**:
  - `registry/default/blocks/data-grid/selection/select-line-options.ts:33` — `CompactSelection.fromArray(channelLike.toArray())` on every call (materializes + re-sorts the whole channel).
  - `select-line-options.ts:35,42` — second `channel.toArray()` in the `replaceFromLast`/`extendFromLast` branches.
  - Per-frame callers: `registry/default/blocks/data-grid/interaction/use-grid-interaction.ts:700-701` (marker/header drag → `selectRow`/`selectColumn` every rAF).
- **Claim**: every drag frame over an existing selection pays O(k log k) over the entire pre-existing channel; `replaceFromLast` only needs the last member, available as O(1) `CompactSelection.last()` (`selection/compact-selection.ts:123-128`).
- **Verify**: read `select-line-options.ts` in full; confirm `compact-selection.ts` exposes `last()`/slice ops usable from the action layer.
- **Impact**: marker drag over a 50k-row selection = two 50k `toArray()` passes + a 50k sort per frame.
- **Effort**: S (M if the `CompactSelectionLike` structural-typing edge cases demand care). **Risk**: LOW-MED (selection semantics must stay identical; `select-line-options.test.ts` guards). **Confidence**: HIGH for the allocation, MED for real-world magnitude.
- **Fix sketch**: narrow to `CompactSelection` via `instanceof`, use slice ops directly; keep the `fromArray(toArray())` round-trip only as the non-instance fallback.

#### PERF-03 — selection actions never bail out of `set` when the derived selection is unchanged
- **Vetted**: PENDING
- **Evidence**:
  - `registry/default/blocks/data-grid/selection/selection-ops.ts:25-33` — `extendTo` always allocates a new `GridSelection` with no content comparison.
  - `registry/default/blocks/data-grid/selection/extend-selection.ts:86-91` — fresh `newRange` even when clamped and nothing moved.
  - `registry/default/blocks/data-grid/store/create-store.ts:321-329` — `extendTo` always calls `set`; zustand v5 `set` notifies unconditionally.
  - Per-frame call site: `interaction/use-grid-interaction.ts:687-703` (`runDragFrame` calls `extendTo`/`selectRow`/`selectColumn` on every rAF, including stationary-pointer frames).
- **Claim**: during any range/row/column drag (and held arrow keys at an edge) the selection content stops changing while every frame still allocates a selection, notifies the store, re-runs every windowed row's selector, and re-renders `DataGridOverlays` with zero visual change.
- **Verify**: read the three sites; confirm zustand v5 `set` notifies on content-identical state (notification is reference-based on the updated slice).
- **Impact**: wasted per-tick allocation + selector sweep + overlay render at 60 fps on the grid's most common gesture.
- **Effort**: S. **Risk**: LOW (early-return only when rect + channels + `lastHighlighted*` are content-identical; render-count tests guard). **Confidence**: HIGH.
- **Fix sketch**: compare derived content in the store actions and skip `set` when identical; `extendSelection` returns the previous reference when corners are equal.

#### PERF-04 — `useDataGridRowIdToViewRow` rebuilds its O(n) Map on every streaming tick
- **Vetted**: PENDING
- **Evidence**:
  - `registry/default/blocks/data-grid/store/hooks.ts:384-399` — Map built in `useMemo` keyed on `[viewIndex, data, getRowId]`.
  - `store/commit.ts:308` — `updateCells` produces `s.data.slice()` (new identity) per tick, so the memo rebuilds every tick.
  - Doc comment at `hooks.ts:376-380` claims the O(n) build is paid "never per keystroke, selection step, or streaming tick" — contradicted by `data` in the key.
  - In-tree consumer on the tick path: `registry/default/blocks/data-grid-presence/use-data-grid-presence.ts:118`.
- **Verify**: read `hooks.ts:370-400` and the tick write path in `commit.ts`; confirm `data` identity changes per `updateCells`.
- **Impact**: O(n) `getRowId` sweep + full Map reallocation per tick for presence/streaming apps; fresh 100k-entry Map allocation per tick at 100k rows.
- **Effort**: M. **Risk**: MED (the store already solves the inverse-map staleness via `store/row-index.ts` rebase/invalidate — mirror that). **Confidence**: HIGH for the rebuild, MED for magnitude.
- **Fix sketch**: maintain `rowId → viewRow` in the store with the same rebase/invalidate discipline as `rowIndexCache`; or at minimum correct the doc comment.

#### PERF-05 — CI runs one serial job; the compiler mirror re-runs the entire unit+browser suite
- **Vetted**: YES (read `ci.yml` end-to-end; `package.json:12` `test:compiler`)
- **Evidence**: `.github/workflows/ci.yml:11-76` — single job `ci`, all steps serial: typecheck, lint, typed lint, unit+coverage, browser, then `pnpm test:compiler` (= `vitest run --project=unit-compiled --project=browser-compiled`, the same suites a second time), then build + registry verification.
- **Claim**: every PR pays the full suite twice plus typecheck/lint/build in series on one runner.
- **Verify**: read `ci.yml`; confirm `vitest.config.ts` defines the `unit-compiled`/`browser-compiled` projects as mirrors of the unit/browser projects.
- **Impact**: wall time dominated by serialization; the browser project alone is ~2 min.
- **Effort**: S (workflow YAML only). **Risk**: LOW. **Confidence**: HIGH.
- **Fix sketch**: fan out to parallel jobs (typecheck, lint, unit, browser, compiler mirror, build+registry-verify), each with the existing pnpm cache.

#### PERF-06 — `rowValidationKeys` is never pruned when rows are deleted (unbounded churn leak)
- **Vetted**: PENDING (low-confidence, investigate)
- **Evidence**:
  - `registry/default/blocks/data-grid/store/create-store.ts:221` — `rowValidationKeys = new Map<string, string[]>()` per store instance.
  - Entries set at `:259`, deleted only when a re-run's verdict comes back empty (`:250`).
  - Row-shifting paths (`deleteRows` ~`:920-944`, `duplicateRows` ~`:945-988`, `_syncProps` data replacement ~`:1091-1094`) prune `cellErrors` via `pruneCellErrors` but never `rowValidationKeys`.
- **Verify**: grep `rowValidationKeys` in `store/create-store.ts`; confirm no deletion path outside `:250`.
- **Impact**: one map entry per validated-then-deleted row, retained for the store's lifetime.
- **Effort**: S. **Risk**: LOW. **Confidence**: LOW (leak certain; magnitude depends on churn).
- **Fix sketch**: prune entries for rowIds absent from `data` on the same paths that call `pruneCellErrors`.

### Bugs / correctness

#### BUG-01 — date `fromText` accepts calendar-invalid ISO dates
- **Vetted**: YES (opened `cell-types/date.tsx`)
- **Evidence**:
  - `registry/default/blocks/data-grid/cell-types/date.tsx:17` — the `/^\d{4}-\d{2}-\d{2}$/` fast path assigns the input straight to `isoDate`, bypassing validity checks.
  - `date.tsx:19-21` — the `Number.isNaN` guard exists only in the else branch.
  - `date.tsx:34-38` — `isoDatePartToLocalDate` feeds the bad parts to `new Date(year, month-1, day)`, which rolls over (`2026-13-45` → 2027-01-14).
  - Commit path: `date.tsx:156-157` (editor commits `fromText` on Enter); paste path via `use-grid-clipboard.ts:246`.
- **Claim**: calendar-invalid dates (`2026-13-45`, `2026-02-30`) commit through typing and pasting, persist, then render as a different date than stored; string-based `compare` orders them inconsistently with the rolled-over display.
- **Verify**: trace `toIsoDatePart` (`date.tsx:13-31`); confirm the ISO branch has no calendar validation; confirm `new Date(2026, 12, 45)` rolls over in Node.
- **Effort**: S. **Risk**: LOW. **Confidence**: HIGH.
- **Fix sketch**: in the ISO branch, validate the calendar date (e.g. `Number.isNaN(Date.parse(trimmed))` — the ES spec validates month/day range for ISO date strings — or a round-trip through `isoDatePartToLocalDate`) and return `null` on mismatch.

#### BUG-02 — import preview: superseded parses can overwrite newer state and clear the spinner
- **Vetted**: PENDING
- **Evidence**:
  - `registry/default/blocks/data-grid-io/use-data-grid-import.ts:163-189` — `setDelimiter` awaits `parseImportFile` then writes `setPreview` with no generation guard (unlike `setSheetName`, token at `:195`, checked at `:200` and `:223`).
  - `use-data-grid-import.ts:142-148` — `loadFile`'s `finally { setIsParsing(false) }` runs even for a superseded/aborted parse.
  - `use-data-grid-import.ts:113` — `loadFile` bumps `sheetGenerationRef` but never checks it after the await.
- **Claim**: rapid successive delimiter switches or file picks: a slower older parse resolves last and overwrites the preview's rows/mapping with stale results; `isParsing` can read false mid-parse.
- **Verify**: read `use-data-grid-import.ts:95-230`; confirm the guarded-finally pattern exists in `setSheetName` and is absent from `setDelimiter`/`loadFile`.
- **Effort**: S. **Risk**: LOW. **Confidence**: HIGH.
- **Fix sketch**: in `setDelimiter`, capture `const generation = ++sheetGenerationRef.current` before the await and bail when stale; in `loadFile`'s `finally`, clear `isParsing` only when `parseControllerRef.current === controller`.

#### BUG-03 — search badge shows an out-of-range index for one frame after a search change
- **Vetted**: YES (opened `data-grid-toolbar/search.tsx`)
- **Evidence**:
  - `registry/default/blocks/data-grid-toolbar/search.tsx:86-88` — `matchIndex` reset to 0 in a `useEffect` that runs after the render where `matches` changed.
  - `search.tsx:191-195` — the badge renders `matchIndex + 1` against the new, smaller `matches.length` in that same pre-effect render.
- **Claim**: when a new query has fewer matches than the previous navigation index (e.g. 6 → 3), the badge transiently renders "7 of 3"; `aria-live="polite"` may announce it.
- **Verify**: read `search.tsx:80-95` and `:184-197`; confirm the reset is effect-only.
- **Effort**: S. **Risk**: LOW. **Confidence**: HIGH.
- **Fix sketch**: clamp at read time: `const safeIndex = matches.length === 0 ? 0 : Math.min(matchIndex, matches.length - 1)`; keep the effect as the true reset.

#### BUG-04 — second pointerdown during a drag leaks the first gesture's document listeners
- **Vetted**: PENDING
- **Evidence**:
  - `registry/default/blocks/data-grid/columns/use-column-reorder.ts:110-114` — `cleanupRef.current = () => {...}` replaces the in-flight gesture's cleanup without calling it.
  - `use-column-reorder.ts:74` and `:97-105` — the second pointerdown overwrites `pendingRef`, so gesture 1's `handleUp` early-returns on pointerId mismatch and never tears itself down.
  - `registry/default/blocks/data-grid/rows/use-row-reorder.ts:129,169-178` — identical shape, plus a `keydown` (Escape) listener in the leaked set.
  - `registry/default/blocks/data-grid-fill/use-fill-handle.ts:309` — the fill add-on already solved this correctly (reuse guard), showing the fix pattern lives in-tree.
- **Claim**: a second pointer landing on another header/marker while a reorder drag is active leaks gesture 1's document listeners until unmount.
- **Verify**: read the pointerdown handlers in all three hooks; confirm the fill guard at `use-fill-handle.ts:309`.
- **Effort**: S. **Risk**: LOW (multi-touch only). **Confidence**: MED.
- **Fix sketch**: call the prior cleanup before replacing it, or no-op a new pointerdown while `dragStateRef.current` is armed (the fill handle's reuse guard is the template). Subsumed by ARCH-04 if that lands first.

#### BUG-05 — async `cut` clears the selection before the clipboard write settles
- **Vetted**: PENDING (investigate)
- **Evidence**:
  - `registry/default/blocks/data-grid/clipboard/use-data-grid-clipboard.ts:95-97` — `cut` starts `writeToClipboard(text, html)` (async) without awaiting it, then runs `actions.deleteSelection()` immediately.
  - `use-data-grid-clipboard.ts:42-48` — the write suspends on `navigator.clipboard.write`; the rejection fallback runs after the selection was already cleared.
- **Claim**: if the async write rejects and the legacy `execCommand` fallback also fails (no clipboard-write permission in a non-secure context plus blocked `execCommand`), the cut values are cleared from the grid and never reach the clipboard — silent data loss. The native `onCut` path (`use-grid-clipboard.ts:363-374`) writes synchronously and is unaffected.
- **Verify**: read `use-data-grid-clipboard.ts:40-100`; confirm the ordering (delete before the write settles) and the fallback chain.
- **Effort**: S. **Risk**: LOW (requires two consecutive clipboard failures). **Confidence**: LOW — investigate; awaiting the write and deleting only on success is the safe ordering.
- **Fix sketch**: `const result = await writeToClipboard(text, html); if (result !== "no-selection") actions.deleteSelection();` — or document the "clears even on write failure" parity with native cut.

### API / direction (features)

Grounded options to weigh — not ranked against bugs. Confidence reflects how grounded
the evidence is, not certainty it is the right call. Effort estimates are coarse.

#### API-01 — support bulk (multi-row) row reorder
- **Vetted**: PENDING (spike)
- **Evidence**:
  - `registry/default/blocks/data-grid/store/types.ts:680` (`deleteRows(viewRowIndexes: number[])`) and `:687` (`duplicateRows(viewRowIndexes: number[])`) take row arrays, while `:699` is `reorderRows(from: number, to: number)` — single row.
  - `registry/default/blocks/data-grid/rows/use-row-reorder.ts:20-21` — `draggingRow: number` (single-row by construction).
  - `content/docs/row-operations.mdx:62-64` documents only the single-row programmatic form.
- **Claim**: every other row op is batch-shaped; reorder is the one that is not. Bulk re-sequencing consumers must loop `reorderRows` (N undo entries, N view recomputes) or hand-build a `move`-op batch that only works in controlled mode.
- **Verify**: confirm the three `types.ts` signatures and the single-row gesture shape; check the `move` op shape (`types.ts:152-160`) and whether composed move ops round-trip through `invertChange`/`applyChange`.
- **Impact**: anyone whose grid is a ranking tool (a core spreadsheet use case).
- **Effort**: L (coarse). **Risk**: MED — the no-op matrix on `reorderRows` (sort/filter active, lazy holes, open editor) must generalize to N rows. **Confidence**: HIGH on the asymmetry, MED on whether multi-row *drag* is wanted (the programmatic batch half may be enough).
- **Fix sketch**: spike two parts: (1) `reorderRows` accepting `{ from: number; to: number }[]` emitting one `move`-op batch with one undo entry; (2) optionally drag a selected range from the grip. Keyboard reorder (absent per row-operations.mdx:78) can ride on the same op work as a follow-up.

#### API-02 — give the store an action to insert consumer-supplied rows (dataset-level write)
- **Vetted**: PENDING (spike)
- **Evidence**:
  - `registry/default/examples/data-grid-io-demo.tsx:54-65` — the shipped import demo hand-builds a whole-dataset `DataChange` (every row a `delete` op, every imported row an `insert` op).
  - `content/docs/addons/import-export.mdx:151-154` documents this as the consumer's job.
  - `store/types.ts:537-724` (`DataGridActions`) has `insertRows(viewRowIndex, count)` (built only by the `createRow` factory), `duplicateRows`, `deleteRows`, `reorderRows`, `updateCells`/`updateRows` — no insert-with-rows or dataset-replace.
- **Claim**: in uncontrolled grids (the quick-start path) `data-grid-io` is effectively unusable without switching to controlled mode; in controlled+history grids the consumer hand-rolls op batches the grid already knows how to express.
- **Verify**: read the demo and the docs section; confirm no `insertRowsWith`/`replaceRows` action exists on `DataGridActions`.
- **Impact**: closes both the uncontrolled-import dead end and the controlled hand-roll.
- **Effort**: M-L (coarse). **Risk**: MED — must respect the row-op guards (open editor, sort/filter, lazy holes) and keep `DataOp` index semantics correct for undo. **Confidence**: MED-HIGH — verify not already added (the sweep marked the history×io seam "clean", but that verdict covers undo wiring, not the missing core action).
- **Fix sketch**: `insertRowsWith(rows, viewRowIndex, position?)` mirroring `insertRows` (id-keyed insert ops, one batch, `source: "import"`), and document the io flow on top of it; decide whether `replaceRows` (full-dataset swap) ships too.

#### API-03 — sync column layout to the URL (url-state add-on)
- **Vetted**: PENDING (spike)
- **Evidence**:
  - `content/docs/addons/url-state.mdx:115-119` — an explicit warn callout: column widths/order/pins/hidden state are not part of the add-on; use `defaultColumnLayout` + `onColumnLayoutChange` (the hand-rolled localStorage recipe at `content/docs/columns.mdx:215-227`).
  - The core already provides the seed+change pair the other url-state params use (`store/types.ts:153-166`); the add-on's architecture is one param module per synced state (`data-grid-url-state/sort-param.ts`, `filter-param.ts`, `join-param.ts`, `page-param.ts`).
- **Claim**: a shared link carries sort/filter/search/page but not the column layout; the add-on's stated goal ("the view comes back exactly as it was", url-state.mdx:87) is incomplete.
- **Verify**: read the url-state docs callout and the four param modules; confirm no `layout` param exists.
- **Impact**: multi-grid SaaS apps must invent per-user localStorage keys today.
- **Effort**: M (coarse). **Risk**: LOW — additive param, omitted-at-default keeps old links parsing identically. **Confidence**: HIGH that the gap is real and acknowledged; MED that it is the next-wanted thing.
- **Fix sketch**: design/spike: serialize the user-overridden parts of `ColumnLayout` (widths/order/pins/hidden are already the minimal snapshot), mount-apply + `applyFromUrl()` semantics, debounced write-back on `onColumnLayoutChange` (resize drags fire per frame — only the commit point should write).

#### API-04 — decide `number.options.step`: implement arrow-key stepping or drop the option
- **Vetted**: PENDING
- **Evidence**:
  - `registry/default/blocks/data-grid/types.ts:552-553` — `step` is `@reserved`: "accepted but a no-op for now: stepping is editor-keyboard behavior and gets decided after P4 lands; do not rely on it."
  - P4 has since landed (`docs/agent-work/plans/2026-09-03-audit-followups.md`, `PLAN.md` aria-selected invariant) — the justification is stale.
  - `registry/default/blocks/data-grid/cell-types/number.tsx:79-85` — the number editor handles only Enter/Escape.
  - `content/docs/editing-cell-types.mdx:57` carries the no-op forward verbatim.
- **Claim**: a public column option that silently does nothing, whose own justification references a shipped plan. Stepping is the most expected keyboard behavior for a number cell (Excel parity); the fill add-on already knows the concept (`content/docs/addons/fill.mdx:81`).
- **Verify**: read the `@reserved` comment, the number editor's key handling, and the docs line.
- **Effort**: S (coarse). **Risk**: LOW — opt-in per column; default unchanged if `step` is left undefined. **Confidence**: HIGH (the no-op and the stale reference are directly readable).
- **Fix sketch**: implement stepping keyed off `options.step ?? 1` via ArrowUp/ArrowDown in `NumberEditor` (reusing `clampNumber`/`roundToDecimals`), or remove the option pre-1.0 with a changelog note. Either way the `@reserved` comment goes.

#### API-05 — document the op engine (`applyChange`/`invertChange`) and stop the recipe teaching a hand-rolled reducer
- **Vetted**: PENDING
- **Evidence**:
  - `registry/default/blocks/data-grid/data-grid.tsx:205` — exports `createHistory, applyChange, invertChange` from the core barrel, but no docs page mentions them (grep `content/docs` for `applyChange`: zero hits).
  - `content/docs/recipes.mdx:204-207` — the TanStack-Query recipe tells consumers: "applyOpsLocally is your own small reducer over DataOp[]".
  - The reducer `applyChange` already implements at O(n + k log n) with correct snapshot-index and duplicate-id semantics: `interaction/history.ts:40-56,150-177`.
- **Claim**: every consumer wiring optimistic server round-trips re-implements the reducer and its edge cases, and their optimistic cache and their undo stack can disagree on the same op batch.
- **Verify**: grep `content/docs` for `applyChange`; read the recipe section and `history.ts`'s application path.
- **Effort**: S (docs-only; the code ships). **Risk**: LOW. **Confidence**: HIGH.
- **Fix sketch**: add a short "Op engine" section to `api-reference.mdx` (guarantees, index convention, skip semantics) and replace the `applyOpsLocally` recipe with `applyChange(rows, { ops: change.ops, source: "app" }, getRowId)`.

#### API-06 — surface `renderHeaderMenu` on the `DataGrid` convenience wrapper
- **Vetted**: YES (grepped `root.tsx` + `data-grid.tsx`)
- **Evidence**:
  - `registry/default/blocks/data-grid/root.tsx:94` — `renderHeaderMenu?: HeaderMenuRenderer` on `DataGridRootProps` (forwarded at `:144,413,440`).
  - `registry/default/blocks/data-grid/data-grid.tsx` — zero occurrences of `renderHeaderMenu`; `DataGridProps` otherwise nearly covers root props.
  - `content/docs/addons/context-menu.mdx:28-35` — the add-on's documented wiring requires the composed form (`<DataGridRoot renderHeaderMenu={…}>`).
- **Claim**: a consumer using the one-line `DataGrid` wrapper who installs `data-grid-context-menu` gets right-click menus but cannot get the header dropdown without dropping to full composition.
- **Verify**: confirm the prop is on `DataGridRootProps` and absent from `DataGridProps`.
- **Effort**: S (forward one prop, as the wrapper already does for `renderMarker`/`renderMarkerHeader`). **Risk**: LOW. **Confidence**: HIGH.
- **Fix sketch**: add `renderHeaderMenu` to `DataGridProps` and forward it to `DataGridRoot`; one-line doc note. If the omission was deliberate, say so in the `DataGridProps` docs instead.

### Architecture / tech debt / DX

#### ARCH-01 — re-point the 22 stale per-file coverage gates in `vitest.config.ts`
- **Vetted**: YES (checked 6 stale paths on disk; confirmed new locations exist)
- **Evidence**:
  - `vitest.config.ts:36-99` — the `perFile` branch-threshold map names files that no longer exist, e.g. `data-grid/fill/compute-fill-target.ts` (:40), `fill/fill.ts` (:50), `fill/generate-fill.ts` (:52), `fill/detect-series.ts` (:44), `selection/empty-selection.ts` (:46), `selection/extend-to.ts` (:48), `selection/grow-selection.ts` (:53), `selection/push-range.ts` (:68), `selection/select-cell.ts` (:71), `selection/selection.ts` (:79), `keyboard/keymap.ts` (:56), `columns/encode-template.ts` (:47), `sort-filter/sort-filter.ts` (:81), `data-grid-context-menu/format-keymap-shortcut.ts` (:83), `data-grid-context-menu/is-cell-in-selection.ts` (:84), `data-grid-context-menu/selected-view-rows.ts` (:86) (and ~6 more).
  - The fill algorithm now lives at `registry/default/blocks/data-grid-fill/{fill,generate-fill,detect-series,fill-direction,compute-fill-target}.ts` and `encodeTemplate` at `columns/column-format-helpers.ts:9`.
  - Vitest silently skips `perFile` entries whose file never loads.
- **Claim**: the enforced ~95-100% branch bar (comment at `vitest.config.ts:28-31`, CI step "Unit + coverage" at `ci.yml:40-41`) no longer applies to the fill core algorithm, ~7 selection-op modules, the keymap matcher, and 3 context-menu modules. A branch can rot with CI still green.
- **Verify**: `Test-Path` the stale paths (they do not exist); confirm vitest's silent-skip by noting thresholds only appear for files present in the coverage report.
- **Effort**: S (remap to current paths, run the unit suite once). **Risk**: LOW — config-only; some re-mapped files may start below their 90% bar, so expect a few branch tests on first green. **Confidence**: HIGH.
- **Fix sketch**: remap each stale entry (fill/* → `data-grid-fill/`, encode-template → `column-format-helpers.ts`, context-menu/* → `selection-queries.ts`/`menu-shortcut.tsx`), delete entries with no current equivalent, rerun `npx vitest run registry --exclude "**/*.browser.test.*" --project unit --coverage` to green.

#### ARCH-02 — point the io add-on's `xlsx` dependency at a patched build; npm's 0.18.5 is unparchable
- **Vetted**: YES (`pnpm audit` run; 2 HIGH advisories confirmed)
- **Evidence**:
  - `package.json:44` pins `"xlsx": "^0.18.5"`; `pnpm audit` reports 2 HIGH advisories: "Prototype Pollution in sheetJS" and "SheetJS Regular Expression Denial of Service (ReDoS)" with no patched npm version.
  - Consumer code feeds it user-supplied files: `registry/default/blocks/data-grid-io/parse-import-file.ts:50` (`await import("xlsx")` on an uploaded workbook) and `export-grid.ts:125`.
- **Claim**: every consumer installing `data-grid-io` pulls the vulnerable library into their bundle, and the parser's input is exactly the untrusted-file surface the advisories target. Patched versions exist only on SheetJS's CDN.
- **Verify**: run `pnpm audit` (read-only); confirm the advisory "no patched npm version"; confirm the io payload declares `xlsx` in `registry.json`.
- **Effort**: S (change the dep to the CDN tarball convention, run `pnpm registry:build` + `test:e2e-install`, add one line to the io docs dependency table). **Risk**: LOW-MED — CDN availability couples consumer installs to SheetJS's host; keep npm 0.18.5 as the documented fallback. **Confidence**: HIGH.
- **Fix sketch**: swap the manifest entry to the CDN tarball (e.g. `xlsx@https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`), verify the io payload + e2e install, and document the provenance so the next maintainer doesn't "fix" it back to npm.

#### ARCH-03 — declare the undeclared runtime deps of six registry items; let e2e install bare blocks
- **Vetted**: PENDING
- **Evidence**:
  - `data-grid` declares only `zustand` yet ships `@base-ui/react/direction-provider` (`root.tsx:11`) and `lucide-react` (`columns/sort-indicator.tsx:3`, `header-cell.tsx`, `rows/marker-cell.tsx`); `data-grid-context-menu` declares nothing yet imports both; `data-grid-pagination` declares nothing yet imports lucide (`pagination-footer.tsx:4`); `data-grid-io`, `data-grid-sort-list`, `data-grid-toolbar` declare no lucide-react.
  - `scripts/verify-e2e-install.mjs`'s default items are exclusively demos (`VITE_DEFAULT_ITEMS`), so a bare `shadcn add DammersCode/gridcn/data-grid` is never exercised.
- **Claim**: the install contract for the documented primary path silently depends on the consumer's app already having lucide-react and on `@base-ui/react` arriving transitively. Holds today, but is one shadcn-CLI behavior change from a broken install, with no gate to catch it.
- **Verify**: compare each block item's `registry.json` `dependencies` against the npm imports in its shipped files; confirm the e2e defaults.
- **Effort**: S (add `lucide-react` to 6 items + `@base-ui/react` to 2, regenerate payloads, extend the e2e defaults with one bare block). **Risk**: LOW — strictly additive. **Confidence**: MED (metadata gap verified; live breakage currently masked).
- **Fix sketch**: declare the union of each block's non-registry npm imports, commit regenerated payloads, and make the e2e default include at least `data-grid` and one bare add-on.

#### ARCH-04 — consolidate the five hand-rolled pointer-drag lifecycles into one shared primitive
- **Vetted**: PENDING
- **Evidence**: the same gesture lifecycle (document `pointermove`/`pointerup`/`pointercancel` listeners with cleanup, pointer-capture bookkeeping, per-frame loop) is implemented in:
  - `registry/default/blocks/data-grid/interaction/use-grid-interaction.ts:661-767` (range/row/column drag, rAF loop)
  - `registry/default/blocks/data-grid-fill/use-fill-handle.ts:187-332` (near-identical structure)
  - `registry/default/blocks/data-grid/columns/use-column-resize.ts:63-94`
  - `registry/default/blocks/data-grid/columns/use-column-reorder.ts:76-114`
  - `registry/default/blocks/data-grid/rows/use-row-reorder.ts:169-176`
  - Drift already observable: the `lostpointercapture` end-fallback exists only in `use-column-resize.ts:89-94`; the explicit `releasePointerCapture` only in `use-grid-interaction.ts:718-730` and `use-fill-handle.ts:269-283`; the rAF-restart guard (`use-grid-interaction.ts:749-751`) is absent from the fill copy.
- **Claim**: each edge-case fix (stale capture, missed pointerup, dead rAF loop) must be rediscovered per copy — the lostpointercapture bug was already fixed in exactly one of the five.
- **Effort**: M (extract one `usePointerDrag`-style helper from core, export through the barrel, migrate the five call sites one per commit behind the existing browser suites). **Risk**: MED — touches the most gesture-sensitive code in the repo. **Confidence**: HIGH (all five sites read by the subagent).
- **Fix sketch**: one core module owns capture/listeners/teardown + optional rAF frame callback; port the lostpointercapture fallback and the rAF-restart guard into the shared loop so all five copies get both fixes. Subsumes BUG-04.

#### ARCH-05 — unify the three drifted Mac-detection / shortcut-glyph copies
- **Vetted**: YES (opened all three files)
- **Evidence**:
  - Core: `registry/default/blocks/data-grid/keyboard/platform.ts:2-7` — `/mac/i`, `mod` → Cmd only on macOS.
  - Add-on copy 1: `registry/default/blocks/data-grid-keybindings/binding-label.tsx:7-12` — `/mac|iphone|ipad/i`, `shift` rendered as the word "Shift", arrow glyphs.
  - Add-on copy 2: `registry/default/blocks/data-grid-context-menu/menu-shortcut.tsx:7-21` — same broader regex, `shift` rendered as "⇧", no arrow-glyph table.
  - Both copies carry `ponytail: duplicated from core ... — deliberate, no add-on may depend on another`, but the import-boundary rule forbids addon→addon imports, not addon→core-barrel — and `isMacPlatform` is already exported from `keyboard/index.ts:5`.
- **Claim**: real behavioral drift: on iPhone/iPad Safari the core keymap treats `mod` as Ctrl while both add-on label surfaces show ⌘; Shift renders as "Shift" in the keybindings dialog but "⇧" in the context menu of the same grid.
- **Verify**: read the three `isMac` implementations; confirm `isMacPlatform` is on the core barrel.
- **Effort**: S. **Risk**: LOW — display-only plus a platform regex; `menu-shortcut.test.ts` / `binding-label.test.ts` pin current behavior. **Confidence**: HIGH.
- **Fix sketch**: barrel-export the platform check and a token formatter; delete both local copies; pick one Shift/arrow glyph set for both surfaces.

#### ARCH-06 — add the documented TS 5.9 typecheck to CI and CONTRIBUTING
- **Vetted**: YES (read `ci.yml` end-to-end)
- **Evidence**:
  - `package.json:17` defines `types:check:ts5` (`npx -y -p typescript@5.9.3 tsc --noEmit`); AGENTS.md gate 1 makes it mandatory ("consumers run TypeScript 5.9, which infers some types differently from the repo's TypeScript 7").
  - `.github/workflows/ci.yml:31-32` runs only `pnpm types:check`; `CONTRIBUTING.md:22` omits it.
- **Claim**: a TS 5.9 inference regression in the public API (the `defineColumns` generic machinery at `data-grid.tsx:179` is exactly the kind of code that infers differently) passes CI and ships; only a maintainer running the local gate catches it.
- **Verify**: read `ci.yml` steps; confirm no `ts5` step; read the CONTRIBUTING gate list.
- **Effort**: S (one CI step + one line in CONTRIBUTING). **Risk**: LOW. **Confidence**: HIGH.
- **Fix sketch**: add the step after Typecheck in `ci.yml`; list both commands in CONTRIBUTING's pre-commit gate block.

#### ARCH-07 — remove the committed junk files from the repo root
- **Vetted**: YES (checked `git ls-files` + root listing; refined: the PNG is tracked, `dev-server.log` is untracked/gitignored)
- **Evidence**:
  - `UsersdaheAppDataLocalTempclaudec--repos-danny-gridcn…scratchpadlanding-light.png` (464,537 bytes) is tracked at the repo root (committed in `37620e0`); the PNG matches no ignore pattern.
  - `dev-server.log` (28,133 bytes) sits in the root but is untracked (`.gitignore` covers `*.log`).
- **Claim**: a 454 KB binary with a mangled machine-path name in every clone and diff stat; confuses contributors and registry tooling scans.
- **Verify**: `git ls-files | Select-String scratchpad` (tracked); `Test-Path dev-server.log` (untracked local clutter).
- **Effort**: S (one `git rm` commit). **Risk**: LOW (a quick grep shows no content/registry reference to the PNG). **Confidence**: HIGH.
- **Fix sketch**: `git rm` the PNG, commit `chore: drop committed scratch screenshot`.

#### ARCH-08 — stop double-firing the duplicate-column-id dev warning (two systems, zero dedup)
- **Vetted**: YES (opened both sites)
- **Evidence**:
  - `registry/default/blocks/data-grid/columns/column-helpers.ts:76` — `defineColumns` warns `[data-grid] duplicate column id "…"` on every call, per duplicate, no once-guard.
  - `registry/default/blocks/data-grid/store/commit.ts:61` — `checkDevGuardrails` (run from the sync effect) fires the same message via `warnDev` on every render, no once-guard.
  - Adjacent inconsistency: warning prefixes are mixed (`[data-grid]`, `[data-grid-io]`, `[data-grid-url-state]` vs bare `gridcn:` at `body.tsx:118`, `clipboard/use-grid-clipboard.ts:97`).
- **Claim**: a grid with a duplicate id logs the warning twice per render; dev-console spam trains users to ignore the library's warnings — the only feedback channel for the guardrails.
- **Verify**: read both sites; confirm neither has a once-guard.
- **Effort**: S. **Risk**: LOW — dev-only paths. **Confidence**: HIGH.
- **Fix sketch**: keep one site (the provider's `checkDevGuardrails`, which sees the resolved columns) or dedup both with the existing once-per-app `warnDev` style; standardize the `[data-grid]` prefix.

#### ARCH-09 — split `create-store.ts`'s 870-line `actions` literal into per-concern action groups
- **Vetted**: PENDING
- **Evidence**: `registry/default/blocks/data-grid/store/create-store.ts:314-1186` — one object literal holds all ~63 store actions inline inside the 1,179-line factory (repo median module is ~100-200 lines). Concerns are internally coherent and separable: selection/cursor (315-426), column layout width/order/hidden/pin (427-545), sort/filter/search (545-565), edit session + cell errors + flash (567-702), data writes insert/delete/duplicate/reorder/updateCells (704-1060, sharing `rowIndexCache` at :108 and the deferred-rows helpers at :133-158), and `_syncProps`/`_register*` (1061-1186). The pure logic these actions delegate to already lives in `selection/*`, `compute.ts`, and `commit.ts` — the literal is a wiring layer.
- **Claim**: every new store action lands in the repo's single largest file; reviewers diff 870 lines of interleaved concerns; the perf-critical data-write cluster most wants isolation.
- **Verify**: read the `actions` literal's boundaries; confirm the delegation targets exist.
- **Effort**: L. **Risk**: MED — behavior-preserving refactor; do it cluster-by-cluster with the 2,442-line `store.test.tsx` green after each extraction. **Confidence**: MED-HIGH (value is maintainability; single-maintainer repo, so leverage is real but not urgent).
- **Fix sketch**: extract `createSelectionActions(ctx)` / `createColumnLayoutActions(ctx)` / `createDataWriteActions(ctx)` / `createSyncActions(ctx)` taking `{ set, get, rowIndexCache, deferredRows, … }`, spread into the existing literal; start with the data-write cluster, leave selection/cursor last.

---

## Do not re-audit (settled)

Verifier and follow-up agents: these were deliberately excluded from the fleet's scope.
Do not re-report them.

- **The 83-gap API sweep is merged** (`research/api-gap-sweep.md`, spec commit `e95c8a2`;
  waves through `19acaae`). Its four documented SKIPs are intentional: STR-G4, FIL-G5,
  TYP-G6, IO-G4.
- **`plans/README.md` "considered and rejected"** (verified unchanged at `037d895`):
  `useScrolledEdges` attr writes; `DataGridMarkerCell`/`DataGridHeaderCell` unmemoized;
  `DataGridOverlays` per-render rect arrays; `computeWindow` render-phase memo;
  `cumulativeRights` per-tick allocation; `useElementDimensions` ref-in-render;
  `body.tsx` gridRowStart useLayoutEffect; search full-scan (bounded by
  `MAX_SEARCH_MATCHES = 1000`); custom-comparator value decoration. WONTFIX accepted:
  `isBulkBatchCurrent` rowId-set rebuild; async `updateCells` triple column-map build.
- **Settled levers (registered, do not re-explore)**: row pooling, velocity-overscan
  cuts, deferred commits, `content-visibility: auto`.
- **Open/known plans**: 008 (keystroke paint timing test, TODO), 010 (hoist per-cell
  store subscriptions, TODO), 011 (OSS readiness, DONE), 013 (docs examples, DONE),
  015 (lazy loading customization, DONE).
- **Intentional design (not bugs)**:
  - nuqs setters captured in refs, store→URL write-back effects depend ONLY on store
    state (the URL-G1 root-cause fix — listing the setters as deps stomps an external
    URL change).
  - Presence "rects" = contiguous row-runs × column-runs, NOT cells.
  - `columnOverscan` windowing.
  - lazy × pagination documented-unsupported; lazy × url-state documented-incompatible.
- **Rejected by the API-direction agent** (ungrounded or already covered): history
  stack-entry observability (sweep item HIS-G3), keyboard row reorder (folded into
  API-01), multi-select cell type (no in-repo signal), search navigation outside the
  toolbar (rebuildable from exported hooks), lazy × pagination composition (settled
  product decision), import → history wiring (sweep item, captured in API-02 instead).

## Status overview

| ID | Title (short) | Category | Vetted | Effort | Confidence |
|----|---------------|----------|--------|--------|------------|
| PERF-01 | `withFilterIds` defeats sync-skip guard | perf | YES | S | HIGH |
| PERF-02 | `selectLine` re-materializes whole channel per frame | perf | PENDING | S | HIGH (alloc) |
| PERF-03 | selection actions never bail on unchanged `set` | perf | PENDING | S | HIGH |
| PERF-04 | rowId→viewRow Map rebuilt per streaming tick | perf | PENDING | M | HIGH (rebuild) |
| PERF-05 | CI serial job; compiler mirror re-runs suites | perf/CI | YES | S | HIGH |
| PERF-06 | `rowValidationKeys` never pruned (leak) | perf | PENDING | S | LOW |
| BUG-01 | date `fromText` accepts calendar-invalid ISO | bug | YES | S | HIGH |
| BUG-02 | import preview: superseded parse overwrites state | bug | PENDING | S | HIGH |
| BUG-03 | search badge out-of-range index for one frame | bug | YES | S | HIGH |
| BUG-04 | 2nd pointerdown during drag leaks listeners | bug | PENDING | S | MED |
| BUG-05 | async `cut` clears before clipboard settles | bug | PENDING | S | LOW |
| API-01 | bulk (multi-row) row reorder | direction | PENDING | L | HIGH (asymmetry) |
| API-02 | store action to insert consumer-supplied rows | direction | PENDING | M-L | MED-HIGH |
| API-03 | sync column layout to the URL | direction | PENDING | M | HIGH (real, wanted?) |
| API-04 | `number.options.step` no-op: implement or drop | direction | PENDING | S | HIGH |
| API-05 | document op engine; fix TanStack-Query recipe | direction | PENDING | S | HIGH |
| API-06 | surface `renderHeaderMenu` on `DataGrid` wrapper | direction | YES | S | HIGH |
| ARCH-01 | 22 stale per-file coverage gates no-op the bar | DX/verify | YES | S | HIGH |
| ARCH-02 | xlsx 0.18.5: 2 HIGH advisories, no npm patch | security | YES | S | HIGH |
| ARCH-03 | 6 registry items under-declare runtime deps | DX/contract | PENDING | S | MED |
| ARCH-04 | consolidate 5 pointer-drag lifecycles | arch | PENDING | M | HIGH |
| ARCH-05 | unify 3 Mac-detection/shortcut-glyph copies | arch | YES | S | HIGH |
| ARCH-06 | TS 5.9 typecheck missing from CI + CONTRIBUTING | DX/verify | YES | S | HIGH |
| ARCH-07 | remove committed 454KB junk PNG | DX | YES | S | HIGH |
| ARCH-08 | duplicate-column-id dev warning double-fires | DX | YES | S | HIGH |
| ARCH-09 | split `create-store.ts` 870-line actions literal | arch | PENDING | L | MED-HIGH |

## Verifier dispatch (ready-to-paste prompt)

One agent per chunk of ~5-6 findings (independent, parallel, read-only). Paste this and
append the finding IDs to verify:

```
You are a read-only verifier for audit findings in C:\repos\danny\gridcn (audit HEAD
b36ae5a). Read research/improve-audit-2026-09-27.md, then verify ONLY the findings
listed below. For each: open the cited file:line locations, check the Claim against
the actual code, run the read-only commands the Verify step names, and report one of
CONFIRMED / REFUTED (paste the actual line content) / MOVED (cite the new location).
Do NOT modify any file. Do NOT fix anything. Return a table: ID | verdict | one-line
evidence. If a finding is CONFIRMED, also state whether the Fix sketch is still
accurate against the code.

Findings to verify: <IDs>
```
