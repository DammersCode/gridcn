# Bugs audit — 2026-09-03

Read-only audit (branch `dev`, HEAD `a4a303a`), one dimension of the 2026-09-03
multi-agent audit. Scope: re-verify the 2026-08-02 optimization audit's bug
findings, fresh adversarial pass (index-space mixing, editing lifecycle, keyboard
map vs `research/glide-behavior-spec.md`, clipboard, fill, selection, history,
data integrity, a11y, cross-addon interaction), test-gap pass.

Headline: **every verified bug finding from the 08-02 audit is fixed** — including
both gating follow-ups of the `compare`-wiring fix (empty-last unification,
incremental-path bail). Fresh pass found **one new HIGH (undo/redo O(n²) row
lookup)** and four low-severity spec-gap/edge-case findings (N2–N5). The fill
pipeline, TSV/HTML round-trip, selection math, IME guard, a11y index-space, and
commit immutability came back clean.

## Prior-audit bug findings: verdicts

### Named priorities

| # | prior finding | verdict | evidence |
|---|---|---|---|
| 1 | streamGeneration token burned by sync-schema `updateCells` (data-loss class) | **FIXED** | bump only inside `if (validated instanceof Promise)`: `create-store.ts:676-687`; supersede tests `update-cells.test.tsx:334,362` |
| 2 | Cell-type `compare` never wired into sorting | **FIXED** | `store/compute.ts:189-212` (`textAccessorFor` wires `accessor.compare`; empty-last honored via `isEmptyCell`) |
| 2a | Gating follow-up: empty-last rule not applied to custom comparators in full rebuild | **FIXED** | `sort-filter/build-view-index.ts:91-105` wraps custom comparators with the empties map; `isEmptyCell` at :22-24 honors `accessor.isEmpty` |
| 2b | Gating follow-up: custom-comparator bail defeated the incremental path | **FIXED** | `incremental-view-index.ts:22-46,52` — resolved `accessor.compare` now rides the incremental path through `compareOnColumn` with the same empty-last rule |
| 3 | `resolveContextMenuTarget` `ariaRow - 2` wrong with pinned rows / pinned-row cells not excluded | **FIXED** | `data-grid-context-menu/resolve-context-menu-target.ts:25-30` prefers the `data-grid-row-index` stamp (`row.tsx:86`, `data-attributes.ts:20`); pinned-row cells excluded via `:not(...)` selector (~:51) |
| 4 | `pruneCellErrors` mis-parses colon-bearing ids | **FIXED** | every-colon-position probe against live rowIds: `compute.ts:57-62,94-109`; `cellErrorKey` exported (`store/index.ts:23`) |
| 5 | pagination label import bypassed the barrel → broken consumer alias | **FIXED** | `pagination-footer.tsx:8` imports from the core barrel |
| 6 | No build-time gate on payload alias drift | **FIXED** | `scripts/fix-registry-imports.mjs` generic regex + fail-loud `process.exit(1)` (:26-27,62-85); `scripts/verify-payload-content.mjs` runs in CI (`ci.yml:53`); scan of `public/r/*.json`: zero surviving deep aliases |

### Tail items (08-02 audit's 65-row table)

| prior finding | verdict | evidence |
|---|---|---|
| `useDataGridRowHasError` prefix-matched column ids | FIXED | exact key probe: `hooks.ts:204-212` |
| `useDataGridAllRowsSelectedState` O(n) per marker render | FIXED | O(rangeStack): `hooks.ts:634-669` |
| No rowId-native presence adapter | FIXED | `hooks.ts:377-392` |
| Marker-header called the selection hook unconditionally | MOOT | hook is O(rangeStack) now |
| Context-menu shortcut hints ignored consumer keymap | FIXED | `useDataGridKeymap()`: `cell-menu-content.tsx:46` |
| `downloadBlob` revoked the object URL immediately (download race) | FIXED | 10s deferred revoke: `data-grid-io/export-grid.ts:97` |
| Excel import silently dropped sheets beyond the first | FIXED | `sheetNames` surfaced (`parse-import-file.ts:47`), `multiSheetNotice` (`import-dialog.tsx:73,201`); regression `parse-import-file.test.ts:98+` |
| `useDataGridFill` fresh tracker per render | FIXED | `useMemo` + identity browser test |
| RTL browser test self-skipped (false green) | FIXED | hard assertions via `gridAttrSelector`: `test/rtl.browser.test.tsx:201-202,327` |
| `ColumnDefOf` / `ClipboardProcessCtx` not re-exported | FIXED | `data-grid.tsx:137` |
| `DataGrid` wrapper dropped `duplicateRow`/`cellTypes`/`labels` props | FIXED | `data-grid.tsx:267,299,307,435,448,450` |
| `isDev` not on the barrel | FIXED | `data-grid.tsx:197`; lazy-guard imports from barrel |
| No lint boundary forcing barrel-only imports | FIXED | `eslint.config.mjs:104-112` `no-restricted-imports` |
| `registry-smoke.ps1` hardcoded smoke item list | FIXED | derives from registry.json (`scripts/registry-smoke.ps1:107-109`) |
| `getRowId` arity differed core vs history add-on | FIXED | unified (`use-data-grid-state.ts:9`); arity type-test |
| `insertRow`/`duplicateRows` left stale `cellErrors` | FIXED | `create-store.ts:773,792,821` |
| `applyCellUpdates`/`deleteSelection` missing reconcile | FIXED | `reconcileAfterWrite` on all four write paths (`create-store.ts:554,568,625,660`) |
| `serializeCopyScope` per-cell re-resolution + unbounded | FIXED (rows/columns) | hoisted + `MAX_COPY_CELLS` — rect scope still uncapped (perf report P3) |
| TSV parse char-by-char `+=` | FIXED | run-based flush + perf pin |
| `insertRowBelow`/`duplicateRow` had no default keybindings | FIXED | `mod+shift+f` / `mod+shift+x` (`default-keymap.ts:52-53`) |
| Paste batch could commit twice / lose position across reorder | FIXED | single `applyCellUpdates("paste")`; rowId re-resolve on held path; supersede tests `use-data-grid-clipboard.test.tsx:120-220` |
| Scroll snapshot read geometry twice per tick | FIXED | one hoisted `readGeometry` (`use-scroll-snapshot.ts:174-177`) |
| Streaming heap test no-op'd green | FIXED | loud fail (`streaming.browser.test.tsx:227-229`) |
| URL pagination page-size semantics | VERIFIED AS DOCUMENTED | client hook keeps first-visible row (`use-data-grid-pagination.ts:119-124`); URL hook resets page per workplan:1042; both tested |
| 6 store hooks exported from store barrel but absent from the public entry | **STILL OPEN (dx, low)** | `getFocusCell`, `useDataGridCellTypes`, `useDataGridFillHandlers`, `useDataGridActiveColumn`, `useDataGridOverlayPlugins`, `useDataGridRowBands` — reachable via `store/index.ts:24-39`, not re-exported by `data-grid.tsx`. Mostly internal provider seams; surface inconsistency only |

## New findings

### N1 [HIGH | mechanism CONFIRMED, magnitude PLAUSIBLE] Undo/redo row lookup is O(n²) per op at scale

- **Where:** `data-grid-history/use-data-grid-history.ts:88`
  (`findRowId = (row) => getRowIdRef.current(row, dataRef.current.indexOf(row))`) +
  `interaction/history.ts:57-70` (`applyChange`: `findIndex` per update/delete op,
  `slice+concat` per delete op)
- **Mechanism:** `findRowId` runs an O(n) `indexOf` for every row examined, and
  `applyChange` invokes it once per row inside `findIndex` for each op. One op
  whose row sits near the end (or has vanished → full scan) costs ~n×n element
  comparisons; a k-op batch approaches k·n². Plus `slice/concat` O(n) per delete op.
  The `indexOf` fires even for id-based `getRowId` that ignores its index argument
  (it exists to support index-based getRowId, per the comment at :86-87).
- **Failure scenario:** undo of a 1,000-row range edit or import on a 100k-row
  grid → multi-second main-thread freeze. Small undos near the top of the data
  match early and stay cheap — which is why normal use never shows it.
- **Effort M** (build a `rowId → index` map once per `applyChange`; keep the
  index-hint semantics for inserts), risk LOW-MED (undo must stay id-keyed and
  skip-vanished-row by design, PLAN §11a).
- **Test gap:** `history.test.ts` uses ≤5-row arrays; there is no 100k-row arm the
  way `streaming.browser.test.tsx` has for `updateCells`. The regression would land silently.

### N2 [LOW | CONFIRMED] `Alt+Arrow` — move active cell while retaining selection — specified but unbound

- Spec: `research/glide-behavior-spec.md:41`. Absent from `GridAction`
  (`types.ts:396-410`) and `DEFAULT_KEYMAP`. The matcher already supports `alt`
  (`keyboard/match-keymap.ts:47`, tested `keyboard/index.test.ts:246-269`).
- Effect: Excel users get plain move (selection collapses) instead of
  move-with-retained-selection. Effort S.

### N3 [LOW | CONFIRMED] `primary+Enter` — scroll active cell into view without moving — unbound

- Spec: `glide-behavior-spec.md:46`. The capability exists and is registered
  (`use-grid-interaction.ts:181,906`, `root.tsx:227` via `_registerScrollToCell`)
  but no keymap action binds it. Off-screen active cells (e.g. after a
  programmatic selection) can't be scrolled into view via the spec'd keystroke.
- Effort S.

### N4 [LOW | CONFIRMED] Click-outside-grid selection clear is half-implemented; `onSelectionCleared` missing

- Spec: `glide-behavior-spec.md:108` (click outside → clear selection + fire `onSelectionCleared`).
- Actual: (a) the clear fires only when the pointerdown target is the grid root
  element itself (`use-grid-interaction.ts:876-887` bails on
  `event.target !== event.currentTarget`) — a press anywhere else on the page keeps
  the selection; (b) `onSelectionCleared` does not exist anywhere in `registry/`
  (zero grep hits). `onSelectionChange` deliberately does not fire on clear
  (`test/store.test.tsx:2129-2137`).
- Effect: a consumer "N cells selected" toolbar chip has no clear hook; page-area
  clicks leave a stale selection. Effort S (new additive prop + widened clear).

### N5 [LOW | PLAUSIBLE] Lazy rows: a `fetchRows` that resolves short marks the whole range loaded

- **Where:** `data-grid-lazy/use-data-grid-lazy-rows.ts:123-133` (`handleFulfilled`
  unconditionally `mergeRanges` the full requested range, then writes only
  `fetched.length` rows); `pendingCount` derived from the same bookkeeping (:185).
- **Failure scenario:** dataset shrinks between window-report and resolution (or a
  contract-violating `fetchRows` returns fewer rows) → skeleton rows persist
  permanently in that range with no retry; `hasHoles`/`pendingCount` report complete.
- Contract-level (docs say `fetchRows` "fetches rows `[start, end)`"), so low.
  Effort S. **Decision:** recommend marking only the rows actually fetched (holes
  remain → natural retry on next visibility) over treating short success as complete.

### N6 [NOTE | CONFIRMED] Glide spec internal contradiction on `mod+shift+Arrow`

- Spec §2 line 52 says "grow to grid edge", line 43's note mandates Excel-style
  data-boundary jumps for `mod+Arrow`; gridcn applies the same `jumpToDataBoundary`
  to the shift variant (`default-keymap.ts:29-32`, `use-grid-interaction.ts:302`) —
  internally consistent, just not matching line 52's wording. Spec-doc correction
  only. Effort S (doc).

## Clean areas (fresh pass, no findings)

- Fill pipeline: Alt→forceCopy at release (`use-fill-handle.ts:270,293`),
  `onFillPattern` veto (:219-221), single `applyCellUpdates` batch (:230/233),
  supersede guard (:225-229), Escape-cancel (:274-278); fill-target math
  (`compute-fill-target.ts:34-81`)
- TSV/HTML clipboard round-trip: `data-gridcn-raw` raw-attr fidelity,
  `fieldPending` handles `""` empties, trailing-newline semantics match
  split-and-drop (`parse-clipboard.ts:124-126`)
- Import build: chunked + cancel + invalid-value clearing (`build-imported-rows.ts`)
- URL pagination: clamps, omit-at-default, replace-history, prefixing (all tested)
- Pagination math: first-visible-row preserved on size change
- Lazy dedup/abort bookkeeping: synchronous `inFlightRef` consult, abort on
  unmount/totalCount change, sync-throw guard
- Selection lib: two-stage Ctrl+A, Excel-contract grow/shrink, line-toggle
- Commit immutability (grid never mutates consumer data)
- A11y index-space: marker column documented out-of-data-space (`header.tsx:19-29`);
  `aria-rowindex`/`aria-rowcount` math consistent
- IME `isComposing` edit guard (`use-grid-interaction.ts:535`)
- Single-click-never-edits across all surfaces (dblclick/Enter/F2/typing only)

## Test gaps

| missing case | suggested location | linked finding | priority |
|---|---|---|---|
| Undo/redo cost at scale (100k rows, undo a 500-op batch, per-op median bar) + unit assertion that `findRowId` is not O(n) per op | `data-grid-history/` (browser perf arm) + `interaction/history.test.ts` | N1 | High |
| Alt+Arrow retain-selection move; primary+Enter scroll-into-view; page-area click clear + `onSelectionCleared` callback | `keyboard/index.test.ts` (matching), `use-grid-interaction.test.tsx` / browser test (behavior + callback) | N2, N3, N4 | Medium |
| `useDataGridLazyRows` short-fetch resolution (stub `fetchRows` resolves short → assert retry-on-next-visibility or documented contract) | `data-grid-lazy/use-data-grid-lazy-rows.test.ts` | N5 | Low |
| Editor keystroke-to-paint timing (budget <16ms) | browser perf test (perf report budget table) | perf budget | Medium |
| Full-selection delete/paste CPU guard (100k rows, whole-grid delete + 1×20 paste-into-100k, assert bounded) | `store.test.tsx` / browser perf | perf P1/P2 | High |

Covered with no gap (verified this pass): stream-generation supersede, paste
supersede/snapshot-drop, TSV quoted-empty round-trip + diff-vs-reference, TSV parse
perf pin, URL pagination read/write/clamp/identity, streaming heap hard-fail, fill
identity, fill pipeline unit+browser.
