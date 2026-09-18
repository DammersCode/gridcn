# Phase 6c/6d Fix Specs — root causes diagnosed by the planner, 2026-07-04

Every issue below was reproduced/diagnosed at source level. Implementers: follow the fix EXACTLY; each has acceptance tests. Do not re-diagnose.

## 1. Pin-right floats into the dead gap (wide viewports)

**Root cause** (`pinned-inset-style.ts` line 27): the pin-right inset anchors to `var(--grid-viewport-width)` unconditionally. When total column width < viewport width, the pinned cell floats at the viewport's right edge leaving a dead gap after the last column. diceui's correct rule: pin-right floats only when content actually overflows.

**Fix:**
- `root.tsx`: add `"--grid-content-width": `${totalWidth}px`` to `viewportStyle` (totalWidth already in scope).
- `pinned-inset-style.ts` pin-right formula becomes:
  `calc(var(--grid-scroll-left, 0px) + min(var(--grid-viewport-width), var(--grid-content-width)) - var(--grid-pin-right-${index}) - var(--grid-track-right-${index}))`
- `use-column-window.ts`: `viewEnd` currently subtracts `pinnedRightWidth` from the viewport edge; clamp the effective right edge to `min(clientWidth, contentWidth)` in the same way so the window math matches the visual anchor (verify with the existing marker-width tests still green).

**Acceptance (browser):** (a) 8 columns, 1400px-wide container, last column pinned right → its left edge is flush with the previous column's right edge (no gap, rect delta < 1px); (b) 100 columns (content overflows), same pin → cell's right edge flush with the grid's right edge at any scrollLeft; existing pinned-left tests untouched.

## 2. Overlays don't paint over pinned columns (+ the "highlight in the empty area" artifact)

**Root cause** (`overlays.tsx` + `cell.tsx`): overlays are grid-placed inside the canvas which translates by `-scrollLeft`; pinned CELLS counter-offset via `pinnedInsetStyle` and carry `zIndex: 1` with opaque `bg-background`. Consequences: (a) an overlay segment covering a pinned column renders at the column's TRACK position (which is under/behind other content or in the visual gap — the user's screenshot artifact), not at its pinned screen position; (b) even when geometrically overlapping, pinned cells paint OVER the overlay (z 1 vs auto).

**Fix — pin-aware overlay segmentation** (all in `overlays.tsx`, plus small prop threading):
- Overlays receive the `pins` array + per-index track/pin data (already available via `DataGridOverlaysProps` extension from the root; thread `pins: readonly ("left"|"right"|undefined)[]`).
- Helper `splitRectByPinZones(rect, pins)`: visible columns are ordered pinned-left block, unpinned middle, pinned-right block (store guarantees this). Return up to 3 sub-rects: the intersection of `rect` with each zone's contiguous index range.
- Render each sub-rect as today (grid-line placement) BUT: pinned-zone segments additionally get `pinnedInsetStyle(zonePin, firstColIndexOfSegment, trackLeft(firstCol), trackRight(firstCol))` — the whole contiguous segment shares that single offset because pinned tracks are contiguous — and `zIndex: 2` (above pinned cells' z1, below header layer).
- Apply the same segmentation/offset to: `RangeOverlay` rects, column/row channel bands, `FillPreviewOverlay`, the active-cell ring (when its column is pinned: add the inset; keep its z 10), and the `FillHandle` (when the range's corner column is pinned).

**Acceptance (browser):** with ID pinned left and 100 columns scrolled horizontally: (a) select a range spanning ID+Name → both parts highlighted; the ID part's overlay rect equals the pinned ID cell rect (getBoundingClientRect, ±1px) and stays put while scrollLeft changes; (b) pin a column right, select cells in it → highlight paints exactly over the pinned cells at the viewport edge, NOT over its track position; (c) row band (marker click) paints across pinned + unpinned + pinned-right without gaps; (d) render-count probe still shows zero row re-renders on selection change.

## 3. Resize handle: wrong position + no hover affordance

**Root cause** (`header-cell.tsx` line 125): `inset-block-start-0` and `inset-inline-end-0` are NOT Tailwind utilities (real ones: `top-0`, `end-0`) — the handle is `absolute` with no offsets, so it renders at its flow position after the label (reads as "left side"). No hover styling exists.

**Fix** (`header-cell.tsx`): handle className →
`"absolute end-0 top-0 z-10 h-full w-2 cursor-col-resize touch-none after:absolute after:inset-y-1.5 after:end-[2px] after:w-[3px] after:rounded-full after:bg-primary after:opacity-0 after:transition-opacity hover:after:opacity-60 data-[resizing]:after:opacity-100"`
plus set `data-resizing` on the handle while a drag is active (useColumnResize already tracks drag state — expose a boolean or toggle the attribute imperatively in onPointerDown/handleEnd).

**Acceptance (browser):** handle rect's right edge within 2px of the header cell's right edge; `:hover` computed opacity of the ::after > 0 (or class assertion via data-resizing during drag); resize drag + dblclick autosize still pass existing tests.

## 4. Double drop indicator on column reorder

**Root cause** (`header-cell.tsx` lines 109-110): the indicator is per-cell inset box-shadows (`data-drop-before` → left edge, `data-drop-after` → right edge). The before-edge of column N and after-edge of column N-1 describe the same boundary; transitions between them (and the border between headers) read as two lines.

**Fix:** delete both inset-shadow classes and the `data-drop-before/after` attributes; render ONE `<div data-grid-drop-indicator>` in the header layer (`header.tsx`), `absolute top-0 h-full w-[2px] bg-primary z-20 pointer-events-none`, positioned at the drop boundary: `insetInlineStart: trackLeft(overCol)` for 'before' / `trackRight(overCol)` for 'after' (header layer already translates with -scrollLeft, so raw track coords are correct; if the boundary column is pinned, apply the same pinned offset logic as spec 2). Rendered only while `reorderState != null`.

**Acceptance (browser):** during a reorder drag exactly ONE `[data-grid-drop-indicator]` element exists; its x position equals the boundary track edge (±1px); zero `data-drop-before/after` attributes remain in the DOM.

## 5. Cell alignment: checkbox centering + number/date right-align (align never consumed)

**Root cause** (`cell.tsx` lines 148-157): `cellType.align` is never read. Content is wrapped in an inline `<span className="overflow-hidden text-ellipsis whitespace-nowrap">` that doesn't stretch — the checkbox Cell's own `size-full justify-center` has no width to center within.

**Fix** (`cell.tsx`):
- Resolve `const align = cellType.align ?? "left"`.
- Container: add `justify-start`/`justify-center`/`justify-end` per align.
- Wrapper span: add `w-full min-w-0` plus `text-center`/`text-end` per align (keeps truncation for text); for the editing branch nothing changes.
- Delete the `isNumberOrDate` special-case and derive `tabular-nums` from `align === "right"` OR keep per-type — simplest: keep the data-type check for tabular-nums, add the alignment mapping separately.

**Acceptance (browser):** checkbox input's center x within 2px of the cell's center x at default and comfortable densities; number cell text right-aligned (text node's right edge within padding of the cell's right edge); text cells unchanged (left).

## 6. Search performance (FPS drops typing + stepping at 100k rows)

**Root causes** (store.tsx + toolbar/search.tsx):
1. `setSearch` rebuilds `viewIndex` (line ~790) — search currently FILTERS rows. Every debounced keystroke: O(rows×cols) `buildViewIndex` + the entire row window remounts (new view identities) → the dominant frame cost. Per PLAN §3, quick-search must HIGHLIGHT + NAVIGATE, not filter.
2. `useDataGridSearchMatches` computes `findSearchMatches` (O(rows×cols)) inside the hook per subscriber (line ~1299) instead of once in the store.
3. Matches for a common term at 100k rows = a 100k-entry array (badge, stepping math all churn it).

**Fix:**
- `store.tsx`: remove `searchText` from `computeViewIndex` entirely (search no longer affects viewIndex; keep filters/sorts). `setSearch(text)` now: sets `searchText`, computes `searchMatches: SearchMatch[]` + `searchMatchSet: Set<string>` (key `"${viewRow}:${columnId}"`) ONCE via `findSearchMatches` with a new `maxMatches` cap (default 1000, early-exit), stores both + `searchMatchesCapped: boolean`. Recompute matches inside `_syncProps`/`setSorts`/`setFilters` only when `searchText !== ""`. Delete the hook-side computation; `useDataGridSearchMatches()` returns the state slice; add `useDataGridIsSearchMatch(coord): boolean` (primitive Set lookup) and `useDataGridSearchCapped()`.
- `lib/sort-filter/find-search-matches.ts`: add optional `maxMatches` param, early-exit loop (no behavior change when omitted). Unit tests for cap + exit.
- `cell.tsx`: subscribe `useDataGridIsSearchMatch(coord)` → `data-search-match` attr + class `data-[search-match]:bg-amber-200/60 dark:data-[search-match]:bg-amber-400/25` (deliberate non-token amber: search-highlight convention, documented one-liner). Active match (the one navigation sits on) needs no extra state — the active-cell ring marks it.
- `toolbar/search.tsx`: consume state matches; badge shows `1000+` when capped; stepping = pure index arithmetic + `selectCell` + `scrollToCell` (verify NO findSearchMatches call in the step path — add a unit spy test).
- Keep the 200ms input debounce.

**Acceptance:** unit — setSearch computes matches once (spy on findSearchMatches: exactly 1 call per setSearch; 0 calls when stepping); viewIndex identity UNCHANGED by setSearch; cap honored. Browser — typing "user" at 100k rows leaves the rendered row set identical (no remount: capture a cell element reference before/after, assert same node), matched window cells get data-search-match, badge "1000+"; FPS probe (the dev-page scripted scroll probe pattern) while typing 5 chars and stepping 10 matches stays ≥ 90% of the idle baseline.

## 7. Deprecated `document.execCommand` (hardening seed, do now while in the file)

`use-grid-clipboard.ts` (+ context-menu copy path): keep `execCommand("copy")` ONLY as the final guarded fallback when `navigator.clipboard` is unavailable/rejected, wrapped with a one-line comment naming it a legacy fallback, and make sure the fallback can't double-fire our own copy handler (re-entrancy guard). No other deprecated DOM APIs may be introduced.

## 8. Scroll mount-cost regression (32 → 10 FPS on the synthetic window-swap probe, diagnosed 2026-07-04)

**Symptom:** the dev-page probe (scrollTop += 800/frame, replaces the full row window every frame) measured 32 FPS at Phase 6a, 10 FPS after 6b+polish — with react-scan disabled and no search active. Per-cell mount cost or per-shift re-render breadth regressed.

**Hypotheses (verify BOTH, fix what's confirmed):**
- H1 — per-cell subscription count: `cell.tsx` mounts ~5 separate zustand subscriptions per cell (`useDataGridIsCellActive`, `useDataGridIsCellEditing`, `useDataGridCellInitialText`, `useDataGridIsSearchMatch`, …). Consolidate into ONE `useDataGridCellState(coord)` returning `{ isActive, isEditing, initialText, isSearchMatch }` via a single subscription (`useShallow` on the 4-tuple — genuinely fresh object, correct use). Keep `useDataGridActions` (stable, no re-render).
- H2 — row memo break: verify `DataGridRow` memo still bails for unchanged rows during a window shift — audit every prop `body.tsx`/`row.tsx` passes for per-render identity churn introduced by the polish work (pinTrack object, renderedUnpinnedRange, windowedColumns, handler closures). Memoize whatever churns. Prove with a render-count probe test: scrolling one window step re-renders ONLY newly-mounted rows (existing test pattern in data-grid.test.tsx).

**Acceptance:** (a) unit render-count test as above; (b) browser perf test that is machine-independent: measure the probe FPS twice in the same run — full-window-swap scroll (800px/frame) vs near-idle scroll (8px/frame) — assert ratio ≥ 0.5 (before the regression the two were near-equal; at 10-vs-32 the ratio is ~0.3); (c) manual: dev-page probe back to ≥ ~28 FPS at 8 columns in headless Chromium.

## Ordering & ownership for the implementation workflow

Task A (core visuals): specs 3, 4, 5 — files: header-cell.tsx, header.tsx, use-column-reorder.ts (state only if needed), cell.tsx (+ browser tests).
Task B (pinned correctness): specs 1, 2 — files: pinned-inset-style.ts, root.tsx, use-column-window.ts, overlays.tsx (+ browser tests). Depends on nothing from A; run after A to serialize header.tsx edits? A touches header.tsx/header-cell.tsx; B touches overlays/root — DISJOINT except header.tsx (B: no). A ∥ B safe on files EXCEPT both add browser tests to data-grid.browser.test.tsx — put A's tests in column-ux.browser.test.tsx and B's in a NEW pinned.browser.test.tsx to keep them parallel-safe.
Task C (search perf): spec 6 + 7 — files: store.tsx, lib/sort-filter/find-search-matches.ts, cell.tsx (one attr — CONFLICT with A's cell.tsx edit → run C AFTER A), toolbar/search.tsx, use-grid-clipboard.ts.
Then the queued UX tasks (columns-menu redesign, header menu + icons, i18n labels) follow as Task D/E per PLAN §3 seeds.
