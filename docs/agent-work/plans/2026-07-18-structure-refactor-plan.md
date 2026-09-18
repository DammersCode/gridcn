# gridcn structure refactor — execution plan

Status: proposals reviewed against `CONTRIBUTING.md` and the actual files (LOC counts,
duplicate-barrel exports, direct-import call sites all spot-checked; see per-section notes).
This runs as **one mechanical lane, AFTER the current core-surgery queue** (workplan
`docs/agent-work/plans/2026-07-17-qa-workplan.md` #53 Standard Schema validation → presence
extraction → fill extraction). Do not start this lane until those three land — the store split
and the fill/selection barrel cleanup both touch files that presence/fill extraction will also
touch, and doing this first would mean rebasing a mechanical move through active surgery.

No behavior changes anywhere in this plan. Every move preserves every currently-importable
export at its current or a barrel-re-exported path. `scripts/verify-registry.mjs` is the
acceptance gate for every step.

---

## 1. Summary table

| # | Move | Why | Churn cost | Priority |
|---|------|-----|------------|----------|
| A | `data-grid/store.tsx` → `store/` (6 files + barrel) | 2251-LOC file mixes 4 unrelated concerns (types, pure compute, action-closure factory, public hooks); every other domain already gets this treatment | High — 7 files replace 1, largest single registry.json entry, but zero call-site edits (barrel-stable) | High |
| B | Delete 5 divergent duplicate barrels (`selection.ts`, `fill.ts`, `clipboard.ts`, `sort-filter.ts`, `keymap.ts`) | Two barrels per domain violates rule 6; actively causing import drift (same file importing same domain via two paths) | Low — pure deletion + ~10 import-specifier edits | High |
| C | Merge 8 confetti files in `selection/` into 2 concept files | 8 files at 7–24 LOC each, all same-domain single-op helpers, well under rule-5 threshold | Low — internal only, no external consumers of the 8 files | Med |
| D | Split `windowing/use-row-window.ts` (586 LOC) into 3 files | Mixes scroll-snapshot subsystem, velocity-estimation subsystem, and row-windowing hook; other files already treat scroll-snapshot as independent | Med — 4 files (3 + test) repoint direct imports in 3 consumer files | Med |
| E | Merge `columns/column-label-text.ts` + `columns/encode-template.ts` | Two <15-LOC single-function files, no shared logic but both trivial | Low — 5 direct-import call sites need path swap (these are legitimate rule-6 leaf exceptions) | Low |
| F | Merge `data-grid-context-menu/use-has-create-row.ts` + `use-has-duplicate-row.ts` → `has-row-op.ts` | Two identical-shape 7-LOC hooks, textbook rule-5 confetti | Low — 1 consumer file (`context-menu.tsx`) | Low |
| G | Merge `data-grid-context-menu/is-cell-in-selection.ts` + `selected-view-rows.ts` → `selection-queries.ts` | Small, same-domain (GridSelection) helpers; judgment call, not a clear violation | Low — 2 consumer files, tests merge | Low (optional) |
| — | `rows/`, `cell-types/`, `sort-filter/` non-barrel files, `keyboard/` non-barrel files | Already well-shaped, no oversized/mixed-concern file | None | REJECTED (no action needed) |
| — | `data-grid-toolbar/filter-menu.tsx` split | Container+row tightly coupled, row not independently used/tested, mirrors accepted `sort-list.tsx` pattern | None | REJECTED |
| — | `data-grid-io/use-data-grid-import.ts` split | Single cohesive hook under soft cap, no mixed concerns | None | REJECTED |
| — | `data-grid-sort-list/sort-list.tsx` split | Same reasoning as filter-menu.tsx | None | REJECTED |
| — | `data-grid-lazy/use-data-grid-lazy-rows.ts` split | Single cohesive hook, range math already factored out | None | REJECTED |
| — | Add domain subfolders to the 9 flat block roots (`data-grid-io`, `-toolbar`, `-context-menu`, `-pagination`, `-keybindings`, `-lazy`, `-history`, `-sort-list`, `-url-state`) | Nothing large/numerous enough to force grouping per rules 1–2 | None | REJECTED |

Ordering within the lane: **B → C → A → D → E → F → G**, i.e. delete/merge the smallest
leaf-level clutter first, do the big store split once the domain folders around it are already
settled, then the remaining independent small merges in any order. See §5 for the full
rationale (leaf-before-entry-file).

---

## 2. `store/` split — full detail

Target tree (replaces `registry/default/blocks/data-grid/store.tsx`, 2251 LOC):

```
registry/default/blocks/data-grid/store/
├── index.ts          (barrel, ~20 LOC)
├── types.ts           (~370 LOC)
├── compute.ts          (~540 LOC)
├── commit.ts           (~250 LOC)
├── create-store.ts     (~565 LOC)
├── provider.tsx         (~185 LOC)
└── hooks.ts            (~470 LOC)
```

Total ≈ 2400 LOC across 7 files (vs. 2251 in 1) — the small increase is import/re-export
boilerplate at the new file boundaries, not duplicated logic.

### `store/types.ts` (~370 LOC)
Pure type/declaration file, no runtime logic. Contents (current L61-430, plus the `SyncInputs`
block at L969-991 kept here since it's a type + its equality helper, not store-shape logic):
- Public sync-prop types: `DataGridSyncProps`, `SelectionChangeDetails`
- `InternalSyncProps`, `toInternalSyncProps`
- `AnyColumnDef`, `SelectLineActionOptions`
- `DataGridStoreState`, `DataGridActions`, `DataGridStore`, `DataGridProviderProps`
- `SyncInputs`, `syncInputsEqual`
- `CommitResult`, `RowEdit`

No imports from `./compute`, `./commit`, `./create-store` — this file sits at the bottom of the
in-folder dependency graph. `create-store.ts`, `compute.ts`, `commit.ts`, `provider.tsx`, and
`hooks.ts` all import from `./types`.

### `store/compute.ts` (~540 LOC)
Pure, store-shape-independent helper functions — no closure over `set`/`get`, callable and
testable standalone. Contents (current L432-943 minus the commit-batch builders that move to
`commit.ts`, plus L1571-1595):
- `searchMatchKey`, `EMPTY_*` sentinels
- `memoizedMergeLabels`
- `genFilterId`, `withFilterIds`, `filterIdCounter`
- `textAccessorFor`, `defHiddenColumnIds`
- `computeVisibleColumns`, `computeColumnLayout`, `applyInitialColumnLayout`
- `sameElements`, `computeViewIndex`
- `buildSearchMatchRows`, `computeSearchMatches`
- `nextDirection`, `toggleSortAdditive`
- `isColumnReadOnly`, `clampIndex`
- `resolveSelectionConfig`
- `columnFlag`, `pinZone`, `reorderColumnIds`
- `getRangeValues`, `makeSelectionChangeDetails`

Imports from `./types` only.

### `store/commit.ts` (~250 LOC)
The row-mutation batch-builder sub-concern, split out from `compute.ts` because it's a distinct
concept (row edits/insert/delete/duplicate as Commit objects, plus the dev-guardrail warnings
that gate them) even though it's also "pure helpers." Contents (current L659-901, L718-776):
- `computeCommit`, `resolveEditTarget`
- `warnDev`, `warnBothDataPropsOnce`, `checkDevGuardrails`
- `computeRowEditsBatch`, `computeInsertBatch`, `computeDeleteBatch`, `computeDuplicateBatch`

Imports from `./types`; may import specific helpers from `./compute` (e.g. `textAccessorFor`) —
check current internal call graph during extraction and import the specific function, not a
barrel (per the CONTRIBUTING.md cycle-check note).

### `store/create-store.ts` (~565 LOC)
`createDataGridStore` only (current L997-1561) — the Zustand store factory with the ~40-method
`actions` object inline. Imports helpers from `./compute` and `./commit`, types from `./types`.
This is the largest single function in the split and is *not* itself being broken up further —
it's one cohesive Zustand store definition, which is a legitimate single-symbol file per rule 5
("large... or genuinely standalone").

### `store/provider.tsx` (~185 LOC)
Mount/context/subscription wiring — a different concern from the read-hooks in `hooks.ts`
(lifecycle vs. data access). Contents (current L1563-1780):
- `DataGridStoreContext`
- `subscribeSelectionChange`
- `DataGridProvider` (component + prop destructuring)
- `useDataGridStoreApiInternal`, `useDataGridStore`, `useDataGridStoreApi`

Imports `createDataGridStore` from `./create-store`, types from `./types`.

### `store/hooks.ts` (~470 LOC)
Every remaining public `useDataGrid*` selector hook (~38 of them, current L1783-2251) — nothing
but Zustand selectors, the largest genuinely-standalone concern in the file. Imports
`useDataGridStore`/`useDataGridStoreApi` from `./provider`, types from `./types`.

### `store/index.ts` (~20 LOC)
Barrel re-exporting everything from `./types`, `./compute`, `./commit`, `./create-store`,
`./provider`, `./hooks` — so every existing `from "./store"` / `from "../store"` import continues
to resolve to the same symbol set with zero call-site edits.

### Import impact
28 internal files currently do `from "./store"` or `from "../store"` (`data-grid.tsx`, `row.tsx`,
`root.tsx`, `layout-context.ts`, `cell.tsx`, `body.tsx`, `header.tsx`, `header-cell.tsx`,
`columns/use-column-resize.ts`, `columns/pin-offsets.ts`, `columns/resolve-column-width.ts`,
`columns/pinned-inset-style.ts`, `clipboard/use-grid-clipboard.ts`,
`clipboard/use-data-grid-clipboard.ts`, `interaction/use-grid-interaction.ts`,
`fill/use-fill-handle.ts`, `rows/marker-cell.tsx`, `rows/marker-header.tsx`, plus their test
files, plus `test/store.test.tsx`) — all resolve unchanged via the directory barrel
(`./store` → `./store/index.ts`, both Node and TS resolve this automatically). **Zero call-site
edits required** — only the physical file split, confirmed against `CONTRIBUTING.md`'s
own barrel-stability guarantee (rule 5's "nothing that was previously importable stops being
importable").

Verify during extraction, not before: `test/store.test.tsx` (91 KB) may import internal
(non-exported) helpers directly from `../store` in ways that assume single-file colocation —
grep its imports before finalizing which symbols are barrel-only vs. need a direct
`../store/compute` style import.

### registry.json impact
Replace the single entry:
```json
{ "path": "registry/default/blocks/data-grid/store.tsx", "type": "registry:component" }
```
with 7 entries under `registry/default/blocks/data-grid/store/`: `index.ts`, `types.ts`,
`compute.ts`, `commit.ts`, `create-store.ts`, `provider.tsx`, `hooks.ts`. Re-run the registry
generator and `scripts/verify-registry.mjs`. This is the single largest registry.json diff in
the whole lane.

---

## 3. Every other adopted proposal — target layout

### B. Delete 5 divergent duplicate barrels
Verified: in all 5 domains, `index.ts` is the strict superset and `<domain-name>.ts` is a stale
subset (not the reverse, correcting the original scan note for `selection.ts` — `index.ts` has
`CompactSelection`, `rectRelativeTo`, `selectLine`, and the `selected-col-ranges-for-row` family
that `selection.ts` lacks; `clipboard.ts` lacks both clipboard hooks; `fill.ts` lacks
`useFillHandle`; `sort-filter.ts` and `keymap.ts` are pure identical subsets). No export folding
needed — `index.ts` in every domain already covers everything.

Delete:
- `data-grid/selection/selection.ts`
- `data-grid/fill/fill.ts`
- `data-grid/clipboard/clipboard.ts`
- `data-grid/sort-filter/sort-filter.ts`
- `data-grid/keyboard/keymap.ts`

Repoint these import specifiers from `<domain>/<domain-name>` to `<domain>` (index.ts):
- `store.tsx` (→ becomes `store/create-store.ts` or wherever the specific import lands post-move
  A — do this repoint as part of extracting that file, not twice)
- `overlays.tsx`
- `data-grid.tsx`
- `fill/use-fill-handle.ts` and `.test.ts` (currently imports selection via old path *and* fill
  via new path in the same file — both become `../selection` / `./` consistently)
- `interaction/use-grid-interaction.ts` and `.test.tsx`
- `root.tsx`
- `clipboard/use-grid-clipboard.test.ts`
- `test/store-search-perf.test.tsx`

registry.json: remove the 5 `files[].path` entries for the deleted files from the `data-grid`
item (pure deletion, no renames elsewhere).

### C. Merge selection/ 8 confetti files → 2 concept files
Target:
```
data-grid/selection/
├── selection-ops.ts   — emptySelection, selectCell, extendTo, pushRange (~50 LOC)
└── line-ops.ts        — selectRow, selectColumn, selectionRects, selectionContainsCell (~75 LOC)
```
Delete: `empty-selection.ts`, `select-cell.ts`, `extend-to.ts`, `push-range.ts`,
`select-column.ts`, `select-row.ts`, `selection-rects.ts`, `selection-contains-cell.ts` (8 files,
124 LOC combined).

Unchanged as-is (already correctly sized/standalone): `select-line-options.ts`, `rects.ts`,
`offset-selection-for-rows.ts`, `grow-selection.ts`, `select-all-progression.ts`,
`selected-col-ranges-for-row.ts`, `compact-selection.ts`.

Net: 17 files → 11 files in `selection/`, same total LOC, same exports (`index.ts`'s export
list unchanged — only source paths change). Confirmed via grep: no file outside `selection/`
deep-imports any of the 8 merge targets directly (all consumption is via `index.ts` or the
soon-to-be-deleted `selection.ts`), so this is zero-consumer-impact.

registry.json: 8 paths removed, 2 paths added for the `data-grid` item.

### D. Split `windowing/use-row-window.ts` (586 LOC → 3 files)
Target:
```
data-grid/windowing/
├── use-scroll-snapshot.ts   — getElementStore, useScrollSnapshot, useElementDimensions,
│                              useViewportElement, ScrollSnapshot type (~250 LOC)
├── velocity-estimator.ts    — createVelocityEstimator, updateVelocityEstimate,
│                              VELOCITY_OVERSCAN_CAP_PX, VelocityEstimator type (~80 LOC)
└── use-row-window.ts        — computeWindow, useRowWindow, RowWindow/UseRowWindowOptions
                               types only (~150-180 LOC)
```
Test split: move the "velocity estimator (Phase 4)" describe block out of
`use-row-window.test.ts` (743 LOC) into a colocated `velocity-estimator.test.ts`; the rest of
`use-row-window.test.ts` stays colocated (still 2+ files in `windowing/`, satisfies rule 3).

Direct (non-barrel) importers to repoint:
- `windowing/use-scrolled-edges.ts`: `getElementStore` → `./use-scroll-snapshot`
- `windowing/use-column-window.ts` + its test: `VELOCITY_OVERSCAN_CAP_PX` → `./velocity-estimator`;
  `ScrollSnapshot`-consuming code → `./use-scroll-snapshot`
- `root.tsx`: `useElementDimensions`/`useViewportElement` → `./use-scroll-snapshot` (via
  `windowing` barrel if already re-exported there, else add to `windowing/index.ts`)
- `test/scroll-drag.browser.test.tsx`: `VELOCITY_OVERSCAN_CAP_PX` → `velocity-estimator`
- `body.tsx`'s `useRowWindow` import is unaffected (stays in `use-row-window.ts`)

`windowing/index.ts`'s re-export lines change source file per symbol only — its public export
list is unchanged, so `data-grid.tsx`'s barrel and all external consumers are unaffected.

registry.json: 1 path becomes 3 (2 source + 1 new test) for the `data-grid` item.

### E. Merge `columns/column-label-text.ts` + `columns/encode-template.ts`
Target: `columns/column-format-helpers.ts` (name is a placeholder — pick anything that reads as
"small column-formatting leaf utilities"; mirrors the existing `pin-offsets.ts` /
`resolve-column-width.ts` precedent in the same folder), exporting `columnLabelText` and
`encodeTemplate`.

Delete: `column-label-text.ts`, `encode-template.ts`.

Repoint 5 direct-import call sites (these are legitimate rule-6 leaf exceptions — plain
functions with no React dependency, imported directly to avoid the domain barrel — keep them as
direct imports, just to the new filename):
- `cell-types/date.tsx`, `cell-types/number.tsx`, `cell-types/select.tsx`, `cell-types/text.tsx`,
  `header-cell.tsx` (columnLabelText)
- `layout-context.ts` (encodeTemplate)

`columns/index.ts`: change source path for both re-export lines only.

registry.json: 2 paths → 1 path for the `data-grid` item.

### F. Merge context-menu tiny hooks
Target: `data-grid-context-menu/has-row-op.ts` exporting `useHasCreateRow` and
`useHasDuplicateRow` (both identical-shape: `useStore(useDataGridStoreApi(), s => s.<prop> != null)`).

Delete: `use-has-create-row.ts`, `use-has-duplicate-row.ts`.

Update the two import lines in `context-menu.tsx` (confirmed sole consumer — no other file and
no barrel references either hook directly). No test files reference these hooks (none exist for
either), so no test moves.

registry.json: remove 2 entries, add 1, for the `data-grid-context-menu` item.

### G. Merge context-menu selection-geometry helpers (optional/lower value)
Target: `data-grid-context-menu/selection-queries.ts` exporting `isCellInSelection` and
`selectedViewRows`, with `selection-queries.test.ts` merging both existing test files (43 + 46
LOC).

Delete: `is-cell-in-selection.ts` (+ its test), `selected-view-rows.ts` (+ its test).

Update imports: `context-menu.tsx` (`isCellInSelection`), `cell-menu-content.tsx`
(`selectedViewRows`).

registry.json: 2 source + 2 test entries collapse to 1 source + 1 test entry.

This one is explicitly optional — each file already has its own non-trivial colocated test and a
clear standalone purpose; leaving it split is defensible. Included here because it's low-risk
and the builder is already touching this block for F, but skip it if time-boxing the lane.

---

## 4. REJECTED proposals (one-line reasons)

- **`rows/`, `cell-types/`, `sort-filter/` non-barrel files, `keyboard/` non-barrel files** —
  no oversized or mixed-concern file exists in any of these; scanner itself found nothing.
- **`data-grid-toolbar/filter-menu.tsx` split** — container + private row subcomponent are
  tightly coupled (shared type, row never used/tested standalone); matches the already-accepted
  `sort-list.tsx` pattern at the same size; rule 8's soft cap is for new code, not retrofits.
- **`data-grid-sort-list/sort-list.tsx` split** — identical reasoning to filter-menu.tsx.
- **`data-grid-io/use-data-grid-import.ts` split** — 161 LOC, single cohesive hook, already
  under the soft cap, parsing/matching already factored into sibling files.
- **`data-grid-lazy/use-data-grid-lazy-rows.ts` split** — 188 LOC, single cohesive hook, range
  math already factored out to `range-math.ts`.
- **Adding domain subfolders to `data-grid-io`, `-toolbar`, `-context-menu`, `-pagination`,
  `-keybindings`, `-lazy`, `-history`, `-sort-list`, `-url-state`** — all flat, largest file is
  365 LOC, none large/numerous enough to trigger rule 1/2's domain-grouping guidance; would be
  churn for its own sake.

---

## 5. Execution notes

### Ordering
Run in this order within the lane — **leaf moves before entry-file moves**, so that by the time
the store split (which touches the most import sites) happens, the domain folders it imports
from are already in their final shape and the store split's import repoints don't have to be
redone:

1. **B — delete 5 duplicate barrels.** Purely deletion + import-specifier fixes in ~10 files.
   Zero dependency on anything else in the lane. Do first because `store.tsx` (soon to be split
   in step A) is one of the ~10 files needing an import fix — better to fix it once, before the
   split, so step A starts from a clean single-barrel-per-domain baseline.
2. **C — merge 8 selection confetti files.** Independent of B's import-specifier fixes (touches
   different files inside `selection/`), but do after B so `selection/index.ts` is stable before
   its internal source files get reshuffled.
3. **A — the store/ split.** Do this once B and C have already settled the domain folders
   `store.tsx` imports from (`selection`, `fill`, `clipboard`, `sort-filter`, `keyboard` all have
   single stable barrels by now) — avoids touching store.tsx's import lines twice.
4. **D — windowing split.** Independent of A/B/C; can run any time after B (windowing doesn't
   import from the 5 duplicate-barrel domains). Placed here because it's the next-highest churn
   item and benefits from being done while the "split a big mixed-concern file" mental model
   from step A is still warm.
5. **E, F, G — remaining small merges.** Fully independent of each other and of A–D; run in any
   order, batch together as cleanup at the end of the lane.

### What stays import-stable via the public barrel
- `data-grid.tsx` (block-root barrel) is untouched by every move in this plan — no public API
  changes anywhere. All churn is internal-path-only.
- Step A (store split): all 28 current `from "./store"` / `from "../store"` importers resolve
  unchanged through `store/index.ts` — zero call-site edits.
- Step B (duplicate barrels): ~10 files get a specifier edit (`<domain>/<domain-name>` →
  `<domain>`), but the symbols themselves don't move — no barrel or public-API change.
- Step C, E, F, G: `index.ts` export lists are unchanged in every case (source path changes
  only) — confirmed no external consumer deep-imports the merge targets directly.
- Step D: `windowing/index.ts`'s public export list is unchanged; only per-symbol source paths
  shift, plus a few direct (non-barrel) importers get repointed per the list in §3.

### registry.json / tests / payload impact
- Run `scripts/verify-registry.mjs` after **every** numbered step above, not just at the end —
  it's the CI-enforced source of truth that registry.json's `files[]` matches disk, and catching
  drift per-step is cheaper than debugging a combined diff.
- Regenerate registry payloads (whatever `npm run` target builds the shippable registry JSON
  from `registry.json` + `registry/default/blocks/**`) after the full lane, not per-step — no
  need to rebuild payloads 7 times for one lane.
- Net registry.json entry delta across the whole lane: store.tsx 1→7 (+6), selection domain
  −5 deleted barrels +2 concept files −8 confetti files (net −11), fill/clipboard/sort-filter/
  keyboard domains −1 each (−4), windowing 1→3 (+2, +1 test), columns 2→1 (−1),
  data-grid-context-menu −2+1 (F) and optionally −4+2 (G, if done). Total item count for the
  `data-grid` registry entry drops overall despite the store split's +6, because B+C together
  remove more files than A adds.
- No test file *behavior* changes anywhere — only file moves and describe-block relocation
  (windowing's velocity-estimator tests). Every test still asserts the same things against the
  same (re-exported) symbols.
- No payload/consumer-facing change: `npx shadcn add data-grid` installs the same public surface
  before and after this lane. This is purely an internal-source-tree reorganization.

### Constraint: single mechanical lane, after core surgery
This entire plan executes as **one lane**, sequenced per the ordering above, with no
behavior-affecting work interleaved. It must not start until workplan items #53 (Standard
Schema validation), presence extraction, and fill extraction have all landed — those three
touch `store.tsx`, `selection/`, and `fill/` with real logic changes, and running this
mechanical reorganization concurrently would mean either rebasing file moves through active
logic changes or resolving merge conflicts in files that are being split in both directions.
Land the surgery queue first; then run this lane top-to-bottom in one pass, verifying the
registry after each step, with a single combined payload rebuild at the end.
