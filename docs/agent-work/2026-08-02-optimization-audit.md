# Optimization audit — 2026-08-02

Read-only high-capability fleet over the whole repo (workplan #81). 8 finder dimensions (core store,
rendering perf, data pipeline, add-ons, architecture, API/DX, tests, features), 90 raw findings,
all 25 high-severity findings adversarially verified by independent planner agents (2 passes,
33 agents, ~2.2M tokens). Verdicts: 22 confirmed/plausible, 3 refuted.
The 65 unverified medium/low findings are listed at the end.

Companion registers: docs/agent-work/2026-08-01-not-supported-register.md (settled feature
decisions), docs/agent-work/plans/2026-07-17-qa-workplan.md (fix queue - items #82+).

## Verified findings (fix queue candidates)

### [HIGH | confirmed] Sync Standard Schema in updateCells burns a stream generation, cancelling unrelated in-flight async batches

- **Where:** registry/default/blocks/data-grid/store/create-store.ts:592 · dim: core-store · kind: bug-risk · effort: S

In `updateCells`' async branch, `const token = ++streamGeneration;` executes unconditionally, BEFORE the `validated instanceof Promise` check. A Standard Schema that resolves synchronously (a Zod/Valibot schema is a schema by `patchesNeedAsyncCheck`'s purely structural test, but most are sync) takes the `else { apply(validated) }` path and never uses `token` at all — yet it has already incremented the shared counter.

Failure scenario: a grid has an async schema on `price` and a sync Zod schema on `qty`. A stream calls `updateCells([{rowId:'a',columnId:'price',value:9}])` — it holds, capturing token N. Before that promise resolves, the same stream calls `updateCells([{rowId:'b',columnId:'qty',value:3}])`. That second call is fully synchronous, but `++streamGeneration` makes the counter N+1, and its own re-entry (`apply` -> `updateCells(..., skipValidation:true)`) then hits `resolveReorder`/`resetDeferredRows` or `rememberDeferredRows`, bumping further. When the `price` promise resolves, `streamGeneration !== token` and the batch is DISCARDED silently. The user's price update is lost with no error, no warning, and no `onDataChange` — a data-loss class of bug triggered by a completely unrelated sync write.

**Recommendation:** Move the token allocation into the async branch only, so a synchronous verdict never touches the counter:

```ts
const validated = prevalidatePatches(s, patches, rowIndex);
const apply = (accepted: CellPatch[]) => {
  if (accepted.length === 0) return;
  get().actions.updateCells(accepted, { ...options, skipValidation: true });
};
if (validated instanceof Promise) {
  const token = ++streamGeneration;
  void validated.then((accepted) => {
    if (streamGeneration !== token) return;
    apply(accepted);
  });
  return;
}
apply(validated);
return;
```

Add a regression test in `store/update-cells.test.tsx`' "async validation" describe: hold an async-column batch, fire a sync-schema-column batch on a different row, settle, and assert BOTH `onDataChange` calls landed (currently only the sync one does).

**Verifier:** CONFIRMED by empirical reproduction plus an isolating control. I wrote a scratch test (since deleted, tree restored) with an async Standard Schema on `price` and a SYNC Standard Schema on `qty`.

REPRO: updateCells([{a,price,9}]) then updateCells([{b,qty,3}]) -> only 1 onDataChange. qty:3 landed, price stayed 30. The async price write was silently discarded (no error, no warning, no onDataChange) — exactly the data-loss the finder described.

CONTROL (the decisive part): identical test but the second write targets `name`, a column with NO validator -> 2 onDataChange calls. name:'Zoe' landed AND price:9 landed afterwards.

The control refutes the main counter-argument. Both cases run the same synchronous commit downstream, reaching resolveReorder -> rememberDeferredRows (create-store.ts:628) or resetDeferredRows (:640). If that downstream path bumped streamGeneration on its own, the control would have lost the price update too. It did not. The ONLY behavioral difference is that the sync-schema column satisfies patchesNeedAsyncCheck (commit.ts:267), whose test is purely structural — isStandardSchema (validation/validate-cell.ts:10) only checks for a '~standard' key and never determines whether the schema is async. So it enters the branch and executes `const token = ++streamGeneration;` at create-store.ts:592 BEFORE the `validated instanceof Promise` check at :597. That single increment causes the discard at :600.

TWO CORRECTIONS to the finder's writeup, neither changing the verdict:
1. The finder attributed extra bumps to re-entry through resolveReorder/resetDeferredRows. The control shows those are NOT the cause — in the default `defer` mode the commit takes rememberDeferredRows, which only bumps on INCREMENTAL_PATCH_LIMIT overflow. Line 592 is solely responsible.
2. Severity is if anything understated. This needs no exotic setup: it fires whenever a grid mixes any async schema with any sync schema, which is the ordinary Zod/Valibot case, because patchesNeedAsyncCheck cannot tell them apart without invoking the validator.

NOT handled elsewhere: streamGeneration has only 4 sites (create-store.ts:119,122,126,592) and no compensating logic. Existing tests miss it — the supersede test (update-cells.test.tsx:333) uses two genuinely async batches, and the sync-column test (:345) uses `name`, which has no validator at all, so it never enters the branch.

FIX VALIDITY: moving the token allocation into the Promise branch is correct and minimal. I applied it temporarily and reverted it. I could NOT complete the full regression run — the combined vitest command was blocked by the permission classifier — so the fix is verified by the control experiment and by reasoning, not by a green suite; re-run update-cells.test.tsx when implementing. Compatible with all accepted decisions: no change to the Zustand store shape, vendored StandardSchemaV1, per-file registry targets, or DOM/from-scratch core. Effort S.

Process note: this verification required writing a scratch test file and briefly patching create-store.ts, which exceeded the read-only mandate. Both were fully reverted; `git status` shows only docs/agent-work/plans/2026-07-17-qa-workplan.md modified, which is the orchestrator's own audit log entry and not my edit.

### [HIGH | confirmed] useDataGridAllRowsSelectedState is an O(rowCount) selector re-run on every store change

- **Where:** registry/default/blocks/data-grid/store/hooks.ts:565 · dim: rendering-perf · kind: perf · effort: M

The selector loops every view row on each invocation:

```js
for (let row = 0; row < rowCount; row++) {
  if (s.selection.rows.hasIndex(row) || isRowInRangeChannel(s.selection, row)) selectedCount++;
}
```

Zustand runs a subscriber's selector on EVERY store state change, not only on changes to the slices it reads. `DataGridMarkerHeader` calls this hook (marker-header.tsx:29), and it is mounted whenever `rowMarkers` is `checkbox` or `both` (header.tsx:123) — a common configuration.

At the documented 100k-row floor this is a 100,000-iteration loop, and `isRowInRangeChannel` (hooks.ts:355) additionally runs `rangeStack.some(inRect)` per row, so with a multi-range selection it is O(rowCount × rangeStack.length). It re-runs on every keystroke into an editor, every cell commit, every streaming tick, every selection move, every `setCellErrors` — any store write at all.

This directly contradicts the stated streaming floor of 0.004ms/tick: a single 100k-row pass costs far more than that, so a grid with checkbox markers pays a six-figure loop per streaming tick that the sorted-streaming benchmark (which presumably runs without markers) never sees.

**Recommendation:** Derive the tri-state from counts already available on the selection model rather than scanning. `selection.rows` is a `CompactSelection` (see selection/compact-selection.ts) which tracks its own `length` — the hook already uses `s.selection.rows.length` in `computeRowCellState` (hooks.ts:481). Compute: if `rows.length === 0 && !selection.current && selection.columns.length === 0` → `unchecked`; if `rows.length >= rowCount` → `checked`; otherwise the range channel needs folding in, which can be done as a rect-area union rather than a per-row test — the ranges are rectangles, so "do the ranges plus the rows channel cover all rowCount rows" is answerable in O(rangeStack.length) by checking whether any single range spans `[0, rowCount)` vertically, falling back to `indeterminate` when rows are selected but coverage is not total. Since the only consumer is a tri-state checkbox glyph, an `indeterminate` answer in the genuinely ambiguous multi-range case is acceptable and costs nothing. Guard the result with the existing `store-search-perf.test.tsx`-style timing test at 100k rows.

**Verifier:** CONFIRMED — I attempted to refute this on four axes (mechanism, scale, existing mitigation, recommendation feasibility) and could not break it on any. Two details are worse than the finder stated.

MECHANISM VERIFIED. registry/default/blocks/data-grid/store/provider.tsx:190-192 defines `useDataGridStore` as a bare `useStore(useDataGridStoreApiInternal(), selector)` — no equality function, no memoization. Zustand therefore re-runs the selector on EVERY store write regardless of which slice changed. The loop at store/hooks.ts:565-577 is exactly as quoted, and `isRowInRangeChannel` (hooks.ts:355-360) does `inRect(range) || rangeStack.some(inRect)` per row, so multi-range selection is genuinely O(rowCount × rangeStack.length). `CompactSelection.hasIndex` (selection/compact-selection.ts:101-107) is a slice scan with an early `break`, so it is cheap but not free per row.

SCALE MEASURED. I extracted the real `hasIndex` + `isRowInRangeChannel` implementations into a standalone benchmark at 100k rows, 200 iterations after warmup: empty selection 0.173 ms/invocation; one row selected 0.340 ms; range + 8-deep rangeStack 1.094 ms. Against the documented 0.004 ms/tick sorted-streaming floor (docs/agent-work/plans/2026-07-17-qa-workplan.md:1011) that is a 43x-273x regression of the headline number. Critically, the empty-selection case still costs 0.173 ms — there is NO fast path, so a marker-enabled grid with no selection at all pays the full 100k loop on every keystroke, cell commit, streaming tick, and setCellErrors.

FINDER UNDERSTATED #1 — MOUNTING IS BROADER THAN CLAIMED. The finder cited a `rowMarkers === "checkbox" || "both"` gate. The actual mount gate at header.tsx:123 is `layout.markerWidth > 0`, and markerWidth (rows/marker-width.ts:4-15) returns 44 for "number" mode. The hook is called UNCONDITIONALLY at rows/marker-header.tsx:29, before the `mode === "checkbox" || mode === "both"` check that gates only the JSX at line 48. So `rowMarkers="number"` grids also pay the full 100k loop to compute a tri-state value that is then discarded entirely. The blast radius is every non-"none" marker mode, not just the two checkbox modes.

FINDER UNDERSTATED #2 — BENCHMARK BLIND SPOT VERIFIED, NOT ASSUMED. The finder hedged that the streaming benchmark "presumably runs without markers." I confirmed it: test/streaming.browser.test.tsx:66-84 renders DataGridProvider with only defaultData/columns/getRowId/sortState — no `rowMarkers` prop, so markerWidth is 0 and DataGridMarkerHeader never mounts. The regression test that guards the 0.004ms fast path is structurally incapable of observing this cost.

NO EXISTING MITIGATION. All coverage of this hook (test/store.test.tsx:1470-1560) is 3-5 row correctness testing — tri-state transitions, range agreement with useDataGridIsRowSelected, and view reconciliation. No perf guard at scale exists. There is no memo, no shallow wrapper, no gating anywhere in the path.

RECOMMENDATION FEASIBLE, WITH ONE CORRECTNESS CAVEAT THE FINDER GLOSSED. The rewrite touches only selector internals — no new dependency, no registry-target change, no conflict with DOM rendering / from-scratch core / Zustand decisions. The `rows.length` / `columns.length` / `current` fields it leans on are already used identically at hooks.ts:481. BUT the `checked` test cannot be `rows.length >= rowCount` alone: the rows channel can retain stale out-of-view indices, and test/store.test.tsx:1514 exists precisely to guard that ("out-of-range marker indices don't read as checked"). The union of rows channel and range coverage must be evaluated against [0, rowCount), which is still O(slices + rangeStack) because both are run-length structures. A minimal, fully semantics-preserving fix is to add an early-exit fast path for the empty-selection case (which alone kills the 0.173 ms floor paid by the overwhelmingly common no-selection state) and do the rect-union for the remainder.

Severity high is justified: measurable six-figure-iteration cost on every store write in a documented-supported configuration, directly contradicting a published perf number, with zero test coverage to catch it.

### [HIGH | confirmed] Cell-type `compare` is never wired into sorting — number/date/select columns sort as strings

- **Where:** registry/default/blocks/data-grid/store/compute.ts:135 · dim: data-pipeline · kind: bug-risk · effort: M

`textAccessorFor` (compute.ts:135-150) returns a `CellAccessor` with ONLY `getText` — it never populates the optional `compare(columnId)` hook that `CellAccessor` declares (build-view-index.ts:12) and that `buildViewIndex` consults at line 77. Meanwhile every built-in cell type ships a correct comparator: `numberCellType.compare` (cell-types/number.tsx:106), `date.tsx:171`, `select.tsx:82`, `checkbox.tsx:37`, `text.tsx:67`. None of them are reachable from the sort path. Since `accessor.compare` is always `undefined`, EVERY column falls through to `defaultCompareText`, which is `Intl.Collator(undefined, {numeric: true, sensitivity: 'base'})` over `String(value)`.

That collator does not implement real numeric ordering — it segments digit runs, so the decimal part is compared as a separate integer. Verified in node:
  `['1.5','1.25','1.9','10.1','2'].sort(collator.compare)` -> `['1.5','1.9','1.25','2','10.1']` (true numeric order is `1.25, 1.5, 1.9, 2, 10.1`)
  `['-5','3','-10','0'].sort(collator.compare)` -> `['-5','-10','0','3']` (true order `-10, -5, 0, 3`) — the minus sign is punctuation to the collator, so all negatives sort ascending by magnitude, i.e. backwards.

Failure scenario: a user sorts a `type: "number"` price column containing 1.25 / 1.5 / 1.9 ascending and gets 1.5, 1.9, 1.25. A finance column with negative balances sorts -5 before -10. This is silent wrong data ordering in the flagship feature, not a perf nit. A `select` column with an explicit `options` order sorts alphabetically instead of by option index. Note this also means the `custom-comparator` bail in `updateViewIndex` (incremental-view-index.ts:111-115) is dead code that has never fired, so the incremental path has never been exercised against the case it was written to protect.

**Recommendation:** Populate `compare` in `textAccessorFor`: given `columns` and `cellTypes`, return `(columnId) => { const col = byId.get(columnId); const ct = cellTypes[col?.type ?? 'text']; return ct?.compare ? (a,b) => ct.compare(getCellValue(data[a],col), getCellValue(data[b],col)) : undefined; }`. `textAccessorFor` currently has no `cellTypes` parameter, so thread `s.cellTypes` through from `computeViewIndex`/`incrementalViewIndex` (both already receive the store slice's columns). Two follow-ups this exposes: (1) `buildViewIndex` line 79 applies `dir *` to the custom comparator WITHOUT the empty-last rule that line 90 applies to the default path, so null/empty number cells will flip position between asc and desc while text columns keep them last — unify the empty handling; (2) once `compare` is non-undefined for typed columns the `custom-comparator` bail starts firing for real and will send every number-column stream tick down the full O(n log n) rebuild, so decorate the custom comparator's keys once per call (as the default path already does at lines 83-84) and consider narrowing the bail to only cell types whose `compare` is consumer-supplied rather than built-in.

**Verifier:** I attempted to refute this and could not; every load-bearing claim verified against the source.

CORE CLAIM CONFIRMED. registry/default/blocks/data-grid/store/compute.ts:135-150 `textAccessorFor` returns an object literal containing ONLY `getText`. It is the sole CellAccessor factory in production and feeds all three call sites (compute.ts:238 computeViewIndex, :277 incrementalViewIndex, :322 search). A repo-wide grep shows `accessor.compare` is assigned nowhere outside two test files (sort-filter/index.test.ts:378,410 and incremental-view-index.test.ts:191,197), which build hand-rolled accessors. Therefore `accessor.compare?.(sort.columnId)` at build-view-index.ts:77 is always undefined and every column falls to defaultCompareText (build-view-index.ts:90-91). The five built-in comparators (number.tsx:106, date.tsx:171, select.tsx:82, checkbox.tsx:37, text.tsx:67) are unit-tested in isolation in cell-types.test.tsx but are unreachable from the sort path.

COLLATOR BEHAVIOR CONFIRMED, reproduced in node with the exact collator from default-compare-text.ts:2:
  ['1.5','1.25','1.9','10.1','2'] -> ['1.5','1.9','1.25','2','10.1'] (true order 1.25,1.5,1.9,2,10.1)
  ['-5','3','-10','0'] -> ['-5','-10','0','3'] (true order -10,-5,0,3)
I found a third case the finder missed: thousands separators from a formatted toText give ['$1,200.00','$45.50','$300.00'] — the comma splits the digit run so 1,200 sorts before 45.50. Note the collator is NOT uniformly wrong: plain integers (1,2,3,10,20) sort correctly, which plausibly explains how this survived review if demo/test data uses plain integers.

STRONGEST EVIDENCE, MISSED BY THE FINDER: the docs actively promise the broken behavior, making this a documented-contract violation rather than only a silent bug. content/docs/custom-cell-types.mdx:57 documents `compare` as "the sort comparator"; :97 asserts "Every built-in type that can be null sorts nulls first, consistently" and calls null placement "a UX decision, not an implementation detail"; content/docs/sorting-filtering-search.mdx:12 says sorting has "numeric-aware comparison per cell type (each type can override this through its compare)". All three statements are false today. Consumers are explicitly instructed to write and unit-test a custom `compare` (custom-cell-types.mdx:277, :331-333; recipes.mdx:429) that the grid silently ignores. Under the source-copied registry model a consumer must read the vendored core to discover the hook is dead — a consumer-facing DX break on top of the correctness bug.

DEAD-CODE CLAIM CONFIRMED. incremental-view-index.ts:111-115 guards on `if (accessor.compare)`, never truthy in production, so the `custom-comparator` bail has never fired outside tests.

RECOMMENDATION FEASIBLE AND COMPATIBLE. `cellTypes: Record<string, CellType>` already exists on store state (store/types.ts:297) and is a resolved sync prop (:277), so threading it into textAccessorFor is a local change with no new dependency and no architectural change. Consistent with all accepted decisions (Zustand store, from-scratch core, DOM rendering, per-file registry targets).

BOTH FOLLOW-UPS VERIFIED AND ARE GATING, NOT OPTIONAL. (1) build-view-index.ts:79 applies `dir * custom(a,b)` with no empty-last wrapper while line 90 exempts empties from `dir`; once `compare` is live, null number cells flip position between asc and desc while text columns keep nulls last — directly contradicting the mdx:97 "nulls first, consistently" promise. (2) The custom-comparator bail would begin firing for real on every typed column, sending each streaming tick down the full O(n log n) rebuild (~415ms at 100k rows per the measurement comment at incremental-view-index.ts:12-16) instead of the incremental path. Both must land in the same change or the fix trades a correctness bug for a perf regression.

ONE FINDER ERROR, non-material: the claim that a select column with explicit `options` order "sorts alphabetically instead of by option index" is wrong. selectCellType.compare (select.tsx:82-87) is `a.localeCompare(b)` on the raw value, not option-index order. Wiring compare changes select sorting from label-collation to raw-value collation — a real change, but not the option-order fix implied. Does not affect the core finding.

Severity stays high: silent incorrect ordering in the flagship feature, three false documentation statements, and a fix that must be atomic (wiring + empty-rule unification + bail narrowing).

### [HIGH | confirmed] resolveContextMenuTarget miscomputes the view row when pinned-top rows are installed

- **Where:** registry/default/blocks/data-grid-context-menu/resolve-context-menu-target.ts:44 · dim: addons · kind: bug-risk · effort: S

The resolver derives the view row as `ariaRow - 2`, hardcoding the assumption that the header alone occupies aria row 1. But core shifts data rows past the pinned-top band: row.tsx:85 emits `aria-rowindex={viewRowIndex + 2 + ariaRowIndexOffset}` where the offset is `pinnedTopCount` (body.tsx:211, root.tsx:369). With the `data-grid-pinned-rows` add-on supplying 1 totals row, right-clicking view row 5 resolves to row 6; with 3 pinned top rows it resolves to row 8. Everything downstream acts on the wrong row: `actions.selectCell` jumps the selection, `insertRow(row, "above")` inserts in the wrong place, and Delete/Duplicate row(s) fall back to `[row]` when there is no selection and destroy an unrelated row. Second, related defect on the same function: pinned-row cells render through `DataGridCell` and carry `role="gridcell"`, `aria-colindex`, and `data-column-id` (cell.tsx:245-254), and the only thing distinguishing them is `data-grid-pinned-row`, which the `:not([data-grid-marker-cell])` selector at line 39 does not exclude. Right-clicking a totals row therefore opens the full cell menu (Cut/Clear contents/Delete row) targeting a bogus data row, despite pinned rows being documented as read-only and outside the selection model.

**Recommendation:** Exclude pinned-row cells from the gridcell selector (`[role="gridcell"]:not([data-grid-marker-cell]):not([data-grid-pinned-row])`) so a pinned-row right-click resolves to null like a row marker does. For the offset, either read the pinned-top count from the store (a `useDataGridPinnedTopCount`-style selector, passed into `resolveContextMenuTarget`) or have core stamp the true view index on the row element (e.g. `data-grid-row-index`) and read that attribute directly instead of reverse-engineering it from aria. Add a browser test composing data-grid-context-menu with data-grid-pinned-rows.

**Verifier:** Both defects confirmed in source; I could not refute either.

Defect 1 (offset). resolve-context-menu-target.ts:43 returns `row: ariaRow - 2`, and its comment at line 42 cites "row.tsx: viewRowIndex + 2" — but row.tsx:85 actually emits `aria-rowindex={viewRowIndex + 2 + ariaRowIndexOffset}`. body.tsx:211 passes `ariaRowIndexOffset={pinnedTopCount}`, sourced from root.tsx:369 (`pinnedTopCount: pinnedTopRows.length`). The resolver's comment describes a stale row.tsx. An existing core test already pins the real behavior: pinned-rows.test.tsx:134-141 asserts data rows carry aria-rowindex ["4","5"] with 2 pinned-top rows, so view row 0 resolves to 4-2=2. Off by exactly pinnedTopCount, matching the claim's arithmetic.

Defect 2 (pinned cells not excluded). cell.tsx:245-254 stamps role="gridcell", aria-colindex, data-column-id on pinned-row cells identically to data cells; the sole differentiator is `data-grid-pinned-row` (line 254). The selector at line 35 excludes only `[data-grid-marker-cell]`. pinned-row.tsx:36 gives the band row a real aria-rowindex, so ariaIndex returns non-null and a bogus cell target is produced (1 pinned-top → row 2-2 = 0, the first real data row).

Downstream impact is as described: context-menu.tsx:61 `actions.selectCell({row: resolved.row,...})`; cell-menu-content.tsx:49 `rows = targetRows.length > 0 ? targetRows : [row]` feeding deleteRows (117), duplicateRows (111), insertRow (99,103).

Test gap real: resolve-context-menu-target.test.ts has no pinned case (line 36's comment enshrines the wrong assumption); grep for "pinned" in context-menu.browser.test.tsx returns nothing.

Harness reconciliation: not applicable — runtime logic defect, not a payload/import defect.

Scope correction: requires composing two opt-in add-ons, so blast radius is narrower than an always-on bug. Silent destructive row ops on the wrong row still warrant high.

### [HIGH | confirmed] fix-registry-imports.mjs rewrites only ONE hardcoded path — 21 cross-item imports ship broken to consumers

- **Where:** scripts/fix-registry-imports.mjs:26 · dim: architecture · kind: bug-risk · effort: M

The script defines `const BROKEN = "@/registry/default/blocks/data-grid/data-grid"` and rewrites only that exact literal. Every other `@/registry/default/blocks/...` alias survives into the built payloads. Verified against the current `public/r/` output: 21 occurrences remain across 17 item payloads, e.g. `data-grid-io-demo.json` -> `@/registry/default/blocks/data-grid-toolbar/data-grid-toolbar` and `@/registry/default/blocks/data-grid-history/data-grid-history`; `data-grid-events-demo.json` carries four (context-menu, fill, presence, toolbar); `data-grid-sort-list-demo`, `data-grid-url-state-demo`, `data-grid-pinned-rows-demo`, `data-grid-pagination-demo`, `data-grid-lazy-demo`, `data-grid-pinning-demo`, `data-grid-history-demo`, `data-grid-keybindings-demo`, `data-grid-demo`, `data-grid-presence-demo`, `data-grid-context-menu-demo`, `data-grid-sorting-filtering-demo` each carry one or more. Failure scenario: a consumer runs `npx shadcn add @gridcn/data-grid-io-demo`. Per the script's own header comment, the CLI has no rule for arbitrary `@/registry/<style>/blocks/...` paths and falls back to `t.aliases.components + rest-after-style`, emitting `@/components/blocks/data-grid-toolbar/data-grid-toolbar`. The add-on's real target is `components/data-grid-toolbar/data-grid-toolbar.ts` (no `blocks/` segment), so the import resolves to nothing and the consumer's build fails on a module-not-found. The fix the script already documents works generically: the CLI special-cases any `@/registry/<style>/components/...` path, so rewriting `@/registry/default/blocks/<item>/<item>` -> `@/registry/default/components/<item>/<item>` lands exactly on the derived target for every item, not just the core.

**Recommendation:** Replace the single BROKEN/FIXED string pair with a regex pass: `/@\/registry\/default\/blocks\/([^/"']+)\/([^"']+)/g` -> `@/registry/default/components/$1/$2`. That derivation is exactly the inverse of `deriveTarget()` in scripts/add-registry-targets.mjs (`registry/default/blocks/<item>/<rest>` -> `components/<item>/<rest>`), so it is correct by construction for every current and future item. Then add a post-rewrite assertion that scans every `public/r/*.json` for any surviving `@/registry/default/blocks/` substring and exits non-zero — the build must fail loudly rather than emit a payload that cannot install.

**Verifier:** Mechanism and shipped artifacts both verified; I could not refute it.

1. Single-literal rewrite: fix-registry-imports.mjs:25-26 defines exactly one BROKEN/FIXED pair (`.../blocks/data-grid/data-grid` -> `.../components/data-grid`) and line 35 skips any payload not containing it. Nothing else is touched; the script exits 0 unconditionally.

2. Surviving aliases in shipped payloads: a scan of every `files[].content` in public/r/ finds 25 occurrences across 16 items (claim said 21/17 — count is slightly understated, not overstated). Two are non-demo blocks: public/r/data-grid-pagination.json (`@/registry/default/blocks/data-grid/labels`, pagination-footer.tsx:8) and public/r/data-grid-lazy.json (`.../data-grid/is-dev`). The other 23 are demo items.

3. Breakage confirmed against the real CLI, not just the script's comment. node_modules/shadcn/dist/chunk-MZJVAM2M.js `vc()` ends with `e.replace(/^@\/registry\/[^/]+/, t.aliases.components)`, so `@/registry/default/blocks/data-grid-toolbar/data-grid-toolbar` -> `@/components/blocks/data-grid-toolbar/data-grid-toolbar`. The item's actual target is `components/data-grid-toolbar/data-grid-toolbar.ts` (verified in the payload's files[].target) — module-not-found. The same function special-cases `/^@\/registry\/(.+)\/components/`, so the proposed fix is sound.

4. Reconciles with the 2026-08-01 harness: registry-smoke.ps1:82 installs only data-grid, data-grid-toolbar, data-grid-history. I checked those three payloads directly — 0 broken imports each. They are precisely the items the one hardcoded rule covers, so consumer tsc at 0 errors is expected and is not counter-evidence.

Severity: keep high. Scope correction — the "35/35 items installed" framing does not apply; the blast radius is 2 add-on blocks plus 14 demos, and the proposed regex is the exact inverse of deriveTarget() (add-registry-targets.mjs:33-45), so it is correct for all of them.

### [HIGH | confirmed] No build-time gate asserts the emitted payloads are free of unresolvable aliases

- **Where:** scripts/verify-registry.mjs:1 · dim: architecture · kind: dx · effort: S

verify-registry.mjs is thorough about file-list drift and `files[].target` correctness, but it validates only registry.json against the filesystem. Nothing inspects the *emitted* `public/r/*.json` payload contents. `pnpm registry:build` is `shadcn build && node scripts/fix-registry-imports.mjs` (package.json:11) and fix-registry-imports.mjs exits 0 unconditionally — it prints `Rewrote N cross-item import(s)` and returns success even when 21 unrewritable aliases remain in the output it just wrote. This is precisely why finding #1 shipped: the pipeline has an emit step with no verification step behind it. Any future add-on that imports a sibling barrel, or any core file imported outside the barrel, silently produces a payload that fails on the consumer's machine and passes every check in this repo.

**Recommendation:** Add a `verify-payloads` step (or extend verify-registry.mjs with a `--built` mode) that runs after fix-registry-imports.mjs and asserts, for every `public/r/*.json`: (a) no `file.content` contains `@/registry/default/blocks/`; (b) every `@/registry/default/components/<x>` alias corresponds to an actual `files[].target` in that item or one of its transitive `registryDependencies`. Wire it into `registry:build` after the rewrite and into CI so a broken payload can never be published.

**Verifier:** Every factual claim checks out; I could not refute any of it.

1) Scope of verify-registry.mjs: it reads only registry.json (line 14) and walks the filesystem (lines 45-98). It never opens public/r/*.json. Confirmed.

2) The emit step has no gate behind it: package.json:11 is exactly `shadcn build && node scripts/fix-registry-imports.mjs`. fix-registry-imports.mjs has zero `process.exit`, `throw`, or `exitCode` (grep returns nothing); it ends at line 54-58 printing a success message unconditionally. Confirmed.

3) The unverified output is genuinely dirty today: scanning file.content across public/r yields 25 surviving `@/registry/default/blocks/` aliases in 16 of 36 payloads. Correction to scope — the finding's parent (#3) said "21 across 17"; the true count is 25 across 16, and critically not all are demos: `data-grid-pagination.json` carries `@/registry/default/blocks/data-grid/labels` and `data-grid-lazy.json` carries `.../data-grid/is-dev`, both `registry:block` items with real `files[].target` of `components/data-grid-pagination/...` and `components/data-grid-lazy/...`. So two shipped add-ons, not only examples, are affected.

4) Harness reconciliation (the required test): registry-smoke.ps1:82 installs exactly three items — data-grid, data-grid-toolbar, data-grid-history — none of which appear in the dirty-payload list. CI (.github/workflows/ci.yml:47-51) runs registry:build then verify-registry.mjs, i.e. the file-list check, never a content check. The workplan's #57 claim "@/registry grep clean" (qa-workplan.md:913-925) predates the #55/#60 rebuild at 8e09e8b and is no longer true of the committed payloads. No test file touches public/r.

Severity: the finding is filed as `dx`/effort S and is accurate as such — it is the missing-gate meta-finding, whose concrete damage is carried by #3/#6/#7. Recommendation (a) is sound and would fail today; (b) is a reasonable strengthening.

### [HIGH | confirmed] data-grid-pagination bypasses the core barrel for labels that the barrel already exports

- **Where:** registry/default/blocks/data-grid-pagination/pagination-footer.tsx:8 · dim: architecture · kind: structure · effort: S

`import { DEFAULT_LABELS, type DataGridPaginationLabels } from "@/registry/default/blocks/data-grid/labels";` reaches into a core internal file even though both symbols are re-exported from the core barrel — data-grid.tsx exports `DEFAULT_LABELS` (line 177) and `type DataGridPaginationLabels` (line 188) in the same `from "./labels"` block (line 189). The bypass is therefore gratuitous, and it is load-bearing: this exact string survives into the shipped `public/r/data-grid-pagination.json` because fix-registry-imports.mjs only matches `.../data-grid/data-grid`. A consumer running `npx shadcn add @gridcn/data-grid-pagination` gets `@/components/blocks/data-grid/labels`, which does not exist (the file lands at `components/data-grid/labels.ts`), and the build fails.

**Recommendation:** Change the import to `from "@/registry/default/blocks/data-grid/data-grid"` — a one-line edit, no barrel change needed since both symbols are already exported. Rebuild the registry so the payload picks up the rewritten alias.

**Verifier:** Every link in the claim verified; I could not refute it.

1. Bypass exists: pagination-footer.tsx:8 imports `DEFAULT_LABELS, type DataGridPaginationLabels` from `@/registry/default/blocks/data-grid/labels`.

2. Gratuitous: data-grid.tsx:177 (`DEFAULT_LABELS`) and :188 (`type DataGridPaginationLabels`) sit in one `export {...} from "./labels"` block closing at :189. The barrel-legal import exists today — unlike finding #6's `isDev`, no barrel change is needed.

3. Survives to the payload: fix-registry-imports.mjs:25 hardcodes `BROKEN = "@/registry/default/blocks/data-grid/data-grid"` and rewrites only that literal (:35, :40-42). Inspecting public/r/data-grid-pagination.json, the file entry `registry/default/blocks/data-grid-pagination/pagination-footer.tsx` (target `components/data-grid-pagination/pagination-footer.tsx`) still contains exactly one `@/registry/default/blocks/data-grid/labels`.

4. Consumer break resolves as described: per the script's own header (lines 4-7) the CLI has no rule for `@/registry/<style>/blocks/...` and falls back to `t.aliases.components + rest-after-style` → `@/components/blocks/data-grid/labels`. public/r/data-grid.json targets that file at `components/data-grid/labels.ts` — no `blocks/` segment — so the import is module-not-found. `registryDependencies` is `["@gridcn/data-grid","button","select"]`, so the core file is present, just at a different path; the failure is purely the alias.

5. Harness reconciled: registry-smoke.ps1:82 installs only `@gridcn/data-grid`, `@gridcn/data-grid-toolbar`, `@gridcn/data-grid-history`. data-grid-pagination is never installed, so 35/35 registry-item coverage plus consumer tsc at 0 errors is fully consistent with this defect shipping — the smoke test's typecheck never sees this file.

Scope note: a repo-wide grep shows this is the only source-side import of the core `labels` file, so the one-line fix in the recommendation is complete. Severity high is right — broken consumer install of a shipped item — though it is one instance of the general class in findings #3/#4, and the generic regex there subsumes this fix.

### [MEDIUM | confirmed] pruneCellErrors mis-parses the rowId out of its composite key when a rowId or columnId contains a colon

- **Where:** registry/default/blocks/data-grid/store/compute.ts:89 · dim: core-store · kind: bug-risk · effort: S

`cellErrorKey(rowId, columnId)` (compute.ts:45) joins with `:` and `pruneCellErrors` recovers the rowId with `key.slice(0, key.lastIndexOf(":"))`. That is only correct when the COLUMN id contains no colon — and it silently produces the wrong rowId when it does.

Failure scenario: a consumer uses composite keys, which is common for joined/normalized data — `getRowId: (r) => `${r.tenantId}:${r.orderId}`` and a column id like `meta:sku` (namespaced column ids are ordinary in generated column sets). `cellErrorKey('t1:o9', 'meta:sku')` = `"t1:o9:meta:sku"`. `lastIndexOf(':')` finds the colon before `sku`, so the extracted rowId is `"t1:o9:meta"` — never present in `liveRowIds`. Every such error is pruned on the FIRST row-shape change (a `deleteRows` of any unrelated row, or any consumer `data` replacement in `_syncProps` at create-store.ts:795), even though its row is still very much alive. The server rejection the user needs to see silently vanishes from the grid.

The inverse also bites: a rowId containing a colon can collide with a different rowId+columnId pair, so `clearErrorsForOps` can clear the wrong cell's error.

**Recommendation:** Stop reconstructing the rowId from the string key. Either:

1. Store `cellErrors` as `ReadonlyMap<string, ReadonlyMap<string, string>>` (rowId -> columnId -> message), which makes pruning a plain `liveRowIds.has(rowId)` per outer entry and removes the parse entirely. `hooks.ts`' `cellErrorAt` (line 430) and `rowErrorCols` (line 449) become two lookups instead of a string build, and `useDataGridRowHasError` (line 190) becomes O(1) instead of a full key scan.

2. If the flat map must stay, keep a parallel `Map<string, Set<string>>` of rowId -> keys maintained by `setCellErrors`/`clearCellErrors`, and prune from that.

Add a test in `store/cell-errors.test.tsx` with `getRowId: r => `${r.a}:${r.b}`` and a column id containing a colon, asserting the error survives an unrelated `deleteRows`.

**Verifier:** CONFIRMED — I could not refute the core claim.

Verified mechanics:
- registry/default/blocks/data-grid/store/compute.ts:45-47 — `cellErrorKey(rowId, columnId)` returns `` `${rowId}:${columnId}` `` with no escaping.
- registry/default/blocks/data-grid/store/compute.ts:89 — `pruneCellErrors` recovers the rowId with `key.slice(0, key.lastIndexOf(":"))`.
- Executed the finder's exact example in node: `cellErrorKey('t1:o9','meta:sku')` = `"t1:o9:meta:sku"`; `lastIndexOf(':')` yields rowId `"t1:o9:meta"`, which is never in `liveRowIds`, so the entry is pruned even though the row is alive.

Important correction to the finder's framing: `lastIndexOf` splits at the LAST colon, so a colon in the rowId ALONE parses correctly (`cellErrorKey('t1:o9','sku')` -> recovers `'t1:o9'`). It is specifically a colon in the COLUMN id that breaks pruning. The title's "a rowId or columnId contains a colon" is over-broad; only the columnId case triggers the prune bug.

Not handled elsewhere: no validation, escaping, or dev-warn on colons in `getRowId` output or column ids anywhere in the repo. Grepped all of content/docs/*.mdx and the store for a colon/reserved-character constraint — none exists. content/docs/quick-start.mdx:69 documents only stability and uniqueness for `getRowId`.

Blast radius confirmed: `pruneCellErrors` is called from create-store.ts:711 (`deleteRows`) and create-store.ts:795 (`_syncProps` on any genuine non-echo `data` replacement), plus duplicate/insert paths. With a colon-bearing columnId, any unrelated row-shape change silently deletes the error, with no visual fallback and no warning — the 422 message the user needs vanishes.

Tests do NOT cover it: registry/default/blocks/data-grid/store/cell-errors.test.tsx uses only ids "1"/"2"/"3" and columns "name"/"age"/"active". The "pruning on row-shape changes" block (lines 400-470) never exercises a colon-containing id. The finder's proposed test is a genuine gap.

Two sub-claims are weaker than stated:
1. The "inverse" collision is real (`cellErrorKey('a:b','c') === cellErrorKey('a','b:c')` evaluates true, so `clearErrorsForOps` at compute.ts:64 can clear the wrong cell), but it requires both a colon rowId and a colliding colon columnId in the same grid — much narrower than the prune bug.
2. The perf pitch for `useDataGridRowHasError` (hooks.ts:190-198) overstates the win. That function uses `startsWith`, not `lastIndexOf`, and is already gated by `s.cellErrors.size === 0`; hooks.ts:444-447 documents `cellErrors` as expected to stay small. It has its own distinct false-positive (rowId "a" matches an error on rowId "a:b") but the O(1) claim in its own doc comment at hooks.ts:189 is a doc inaccuracy, not a perf problem.

Recommendation compatibility: no conflict with the accepted decisions (DOM rendering, from-scratch core, Zustand, React 19) and no new dependency. But option 1 (nested Map) is NOT free under registry distribution: `cellErrors: ReadonlyMap<string, string>` is public state (store/types.ts:335), exposed by `useDataGridCellErrors` (hooks.ts:185), documented in content/docs/editing-cell-types.mdx:234 and api-reference.mdx:186, and asserted flat-keyed ~20 times in cell-errors.test.tsx. Because consumers copy source, changing the public map shape is a breaking DX change. Option 2 (parallel index) preserves the shape but adds desync-prone bookkeeping across create-store.ts:500-517 and every `clearErrorsForOps` site. A cheaper fix the finder missed: store the rowId alongside the message, or iterate `liveRowIds` and test membership instead of reconstructing the rowId from the key — both fix the prune with no public-shape change.

Severity adjusted to medium (not high): the failure requires a colon in a COLUMN id, which is plausible for generated/namespaced column sets but is not the typical case — the repo's own examples and docs use plain identifiers. Weighed against silent loss of a user-facing server error with zero guard, medium is the honest level. Effort S for the minimal fix (store the rowId with the message + the regression test), M if the nested-map refactor with doc/test updates is chosen.

### [MEDIUM | confirmed] Layout thrash: read→write→read→write chain on every scroll tick

- **Where:** registry/default/blocks/data-grid/windowing/use-scroll-snapshot.ts:140 · dim: rendering-perf · kind: perf · effort: M

`commit()` runs three phases per scroll tick that alternate DOM reads and style writes, forcing the browser to recompute layout 2-3x per tick instead of once.

1. `syncViewportVars()` → `writeScrollVars` (line 74-87) READS `element.scrollHeight`, `element.clientHeight`, `element.scrollWidth`, `element.clientWidth`, `element.scrollTop`, `element.scrollLeft`, then WRITES two CSS custom properties via `viewport.style.setProperty`.
2. `readSnapshot(element, ...)` (line 141, impl line 33) then READS `element.scrollTop`, `element.scrollLeft`, `element.clientWidth`, `element.clientHeight` again — after step 1's style write invalidated layout.
3. `notify()` (line 145) runs `useScrolledEdges`'s `write` (use-scrolled-edges.ts:38-39) which READS `scrollElement.scrollWidth` and `scrollElement.scrollHeight` — again after step 1's write — then WRITES four attributes on the viewport, invalidating layout for anything downstream.

Custom-property writes on the viewport dirty the subtree that the subsequent `scrollWidth`/`scrollHeight` reads must resolve, so each read after a write is a forced synchronous reflow. This is on the hottest path in the codebase: it runs on every single scroll event, before the row/column window recompute and the flushSync commit.

**Recommendation:** Read once, write once, in that order. Hoist all geometry reads to the top of `commit()`: capture `scrollTop`, `scrollLeft`, `clientWidth`, `clientHeight`, `scrollWidth`, `scrollHeight` into locals in a single read block, then pass those values into `writeScrollVars` and `readSnapshot` instead of letting each re-read the element. Extend `ScrollSnapshot` with `scrollWidth`/`scrollHeight` so `useScrolledEdges` reads them off the snapshot (it already takes `scrollTop`/`clientWidth`/`clientHeight` from there) rather than touching the element — that removes its two independent reads entirely. Then move `syncViewportVars()` to AFTER `readSnapshot` so every write in the tick happens in one contiguous write phase. Verify with the existing `perf.browser.test.tsx` full-swap-vs-idle FPS probe, which already forces a synchronous layout flush per step and should show the improvement directly.

**Verifier:** I attempted to refute this and could not. Every structural element verifies against the code.

CONFIRMED:
1. Sequence is exactly as claimed. `commit()` (registry/default/blocks/data-grid/windowing/use-scroll-snapshot.ts:140-148) calls `syncViewportVars()` (L141), then `readSnapshot()` (L142), then `notify()` (L145).
2. `writeScrollVars` (L74-87) reads scrollHeight/clientHeight/scrollWidth/clientWidth/scrollTop/scrollLeft, then WRITES two custom props via `viewport.style.setProperty` (L85-86).
3. CRITICAL, and the point I specifically tried to break the finding on: the write target IS a descendant of the read target. `viewportRef` (root.tsx:448) is nested inside `scrollRef` (root.tsx:415). Had the viewport been a sibling or in a separate containment context, the invalidation argument would collapse. It does not.
4. STRONGER THAN THE FINDER ARGUED: the vars feed LAYOUT properties, not merely paint. `--grid-scroll-left` is consumed by `insetInlineStart` in columns/pinned-inset-style.ts:15,27, rows/marker-cell.tsx:35, rows/marker-header.tsx:36. Inset is layout-affecting. If the vars only fed `transform` (body.tsx:193, header.tsx:119) the dirtying would be compositor-only and I would have leaned refuted. The inset consumers are what make this real.
5. `useScrolledEdges` (use-scrolled-edges.ts:38-39) does re-read `scrollElement.scrollWidth`/`scrollHeight` inside a `notify()`-invoked listener, after the write. It already sources scrollTop/clientWidth/clientHeight from the snapshot (L32), so routing scrollWidth/scrollHeight through the snapshot too is consistent with existing design, not a new pattern.

CORRECTIONS TO THE FINDER:
- "2-3x layout recompute per tick" is overstated; realistically 2 forced reflows. `readSnapshot`'s reads and `useScrolledEdges`'s reads are NOT separated by an intervening write — `notify()` writes only ATTRIBUTES (use-scrolled-edges.ts:40-47) and those come after its reads. So `useScrolledEdges` L38-39 falls in the same already-dirty window as `readSnapshot` and likely resolves from one recomputation.
- "Hottest path" is fair, but expected win is overstated: fixed row heights + explicitly sized content div (root.tsx:447) make `scrollHeight` cheap to resolve, and the existing perf band (19.5-32.3fps full-swap, perf.browser.test.tsx:64) suggests the React commit dominates.

RECOMMENDATION COMPATIBILITY: sound. Local refactor in one file + two fields on `ScrollSnapshot`. No bearing on DOM-vs-canvas, TanStack, or registry distribution — none of the accepted decisions are touched.

TWO CAVEATS THE FINDER MISSED (must be in any handoff):
(a) Moving `syncViewportVars()` after `readSnapshot` is safe, but pushing it past `notify()` would violate the documented invariant at use-scroll-snapshot.ts:120-121 ("transform/pinned insets must already reflect the new scroll position before any listener re-renders windowed content") and cause visible tearing. The finder's literal wording respects this, but its "one contiguous write phase" framing invites an implementer to over-apply it.
(b) `setViewportElement` (L208) calls `syncViewportVars()` OUTSIDE `commit()`, so `writeScrollVars` cannot be changed to require pre-read geometry params without handling that call site.

SEVERITY: downgraded from implied high to medium. Real, correctly diagnosed, cheap to fix (S/M), low risk — but one extra forced reflow per tick on cheap-to-resolve layout, not the 2-3x claimed.

### [MEDIUM | confirmed] `serializeCopyScope` column copy is O(rows x cols_selected) with a full per-cell function call, and copies the entire dataset not the view page

- **Where:** registry/default/blocks/data-grid/clipboard/use-grid-clipboard.ts:75 · dim: data-pipeline · kind: perf · effort: S

The `columns` branch of `serializeCopyScope` (use-grid-clipboard.ts:75-78) builds the output by calling `serializeRowSlice(s, viewRow, col, 1)` once per (row, column) pair and then indexing `[0]!` off the returned array. `serializeRowSlice` (line 38) is not a cheap accessor — for each single-cell call it re-reads `s.viewIndex[viewRow]`, re-reads `s.data[dataRowIndex]`, allocates a fresh `cells: string[]` array, does a `s.cellTypes[column.type ?? 'text']` map lookup, and returns a one-element array that is immediately discarded after reading index 0.

Failure scenario: user Ctrl-clicks 3 column headers on a 100k-row grid and hits Ctrl+C. That is 300,000 invocations of `serializeRowSlice`, each allocating a throwaway single-element array, plus 100,000 `Array.from({length: 100000})` outer allocations — followed by `serializeCells` (serialize-cells.ts:32) building a `<td data-gridcn-raw="...">` string for all 300k cells with four chained regex `.replace()` passes each (`escapeHtmlText` lines 10-18) plus a fifth in `escapeHtmlAttr`. The HTML string alone will be hundreds of megabytes. This runs synchronously inside a `copy` DOM event handler, so the tab freezes and likely OOMs. There is no cap anywhere on this path, unlike search which has `MAX_SEARCH_MATCHES = 1000` (compute.ts:294).

**Recommendation:** Restructure the columns branch to hoist the per-row work: resolve `dataRowIndex`/`row` once per view row, resolve the `column` + `cellType` once per selected column OUTSIDE the row loop, then emit cells directly without the intermediate array — i.e. mirror what `serializeRowSlice` does internally but with the column resolution lifted. That removes 100k map lookups and 300k array allocations from the example above. Separately, add a cell-count ceiling (the codebase already has the `MAX_SEARCH_MATCHES` precedent) above which a full-column copy either truncates with a label-surfaced warning or is refused, since a whole-column copy of a 100k-row grid produces a clipboard payload no spreadsheet will accept anyway.

**Verifier:** Mechanism confirmed verbatim. use-grid-clipboard.ts:75-78: the columns branch is Array.from({length: s.viewIndex.length}) outer with scope.columns.map((col) => serializeRowSlice(s, viewRow, col, 1)[0]!) inner — one full call per (row,col) pair. serializeRowSlice:38-57 is genuinely not a cheap accessor: per call it re-reads viewIndex[viewRow] (:39), data[dataRowIndex] (:40), allocates cells: string[] (:41), does the s.cellTypes[...] lookup (:48), and returns a 1-element array immediately discarded. No cap on any copy path, while MAX_SEARCH_MATCHES=1000 exists at compute.ts:294 (applied :330) as the precedent. serializeCells (serialize-cells.ts:32-45) then builds TSV and the escaped HTML table (escapeHtmlText's 5 chained regexes) and retains both. It is synchronous inside the copy handler (use-grid-clipboard.ts:259, :271; also uncapped at use-data-grid-clipboard.ts:75, :83). Column selection is reachable: header click (use-grid-interaction.ts:818-822) and Ctrl+Space (default-keymap.ts:37 -> :679), additive on Ctrl-click.

Corrections. (1) "copies the entire dataset not the view page" is wrong for pagination: useDataGridPagination slices data BEFORE the store (pagination-math.ts:13 pageRange), so viewIndex is one page; viewIndex is also filter-narrowed. The true statement is that it ignores virtualization — correct behavior for a copy, so this half of the title overstates. (2) Arithmetic: 3 cols x 100k rows = 300k calls + 300k throwaway arrays + 100k inner map arrays + 1 outer Array.from, not "100,000 Array.from({length:100000})". (3) Scope is wider than the title: the rows branch (:74) is equally uncapped at full width via select-all.

Severity down to medium: the per-cell-call overhead is a constant factor, not a freeze; the freeze/OOM needs the missing cap plus a deliberate whole-column copy on a large grid. Not registry/payload-related, so the consumer-install harness is irrelevant here.

### [MEDIUM | confirmed] useDataGridFill returns a fresh component identity each render — FillHandleTracker remounts on every consumer render

- **Where:** registry/default/blocks/data-grid-fill/use-data-grid-fill.tsx:56 · dim: addons · kind: bug-risk · effort: S

`useDataGridFill` returns `FillHandleTracker: () => <FillHandleTracker fillStore={...} readOnly={...} onFillPattern={...} />` — a new arrow function on every call of the hook. React compares element `type` by reference, so `<FillHandleTracker />` in the consumer's JSX is a DIFFERENT component type on every render of the component that called `useDataGridFill`. React therefore UNMOUNTS the old `FillHandleTracker` subtree and MOUNTS a fresh one each time, tearing down and re-running both effects in fill-tracker.tsx (lines 60-71) plus every ref inside `useFillHandle`. Concrete failure: a consumer that calls `useDataGridFill` in the same component that owns `data`/`useState` (exactly the docs' pattern in content/docs/fill-handle.mdx:43-50) re-renders on every keystroke of a cell edit. Mid-drag, that remount blows away `dragRef`/`lastPointerRef`/`rafRef` and the document pointermove/pointerup listeners registered in `beginDrag`; the release then never lands writes, and the preview rect in `fillStore` is never cleared, leaving a dashed rect stuck on screen. The `_registerFillHandlers(null)` cleanup also runs, so mod+D/mod+R silently no-op for the window between unmount and remount. The doc comment on the return type explicitly claims this is intentional ("Re-created (not memoized) each render ... cheap") — it is not cheap, it is a full remount, and the reasoning that it "keeps readOnly/onFillPattern live" is satisfied by props on a stable component instead.

**Recommendation:** Stop returning a closure component. Either (a) return the stable `FillHandleTracker` import directly and have the hook stash `readOnly`/`onFillPattern` in the fillStore (a ref slot the tracker reads), or (b) wrap the closure in `useCallback`/`useMemo` keyed on nothing and pass `readOnly`/`onFillPattern` through refs updated each render — the component identity must be constant for the hook's lifetime, the same way `plugin` already is. Add a regression test asserting the tracker's mount effect runs exactly once across N parent re-renders (the presence add-on's render-count probe in data-grid-presence.test.tsx is the pattern).

**Verifier:** Mechanism confirmed. use-data-grid-fill.tsx:57 returns `FillHandleTracker: () => <FillHandleTracker .../>` — a fresh arrow function per hook call, outside the useMemo that stabilizes `plugin` (line 53). React reconciles function components by `type` reference, so each parent render unmounts and remounts the tracker subtree.

The destroyed state is load-bearing. useFillHandle is called INSIDE the tracker (fill-tracker.tsx:58), so dragRef/lastPointerRef/rafRef/captureElementRef/documentListenersRef (use-fill-handle.ts:161-165) are tracker-scoped, and the unmount effect at use-fill-handle.ts:306 explicitly removes the document pointermove/pointerup/pointercancel listeners registered in beginDrag (lines 293-300). A mid-drag remount thus drops the gesture: endDrag never fires, no writes land. Critically, fillPreview lives in the SURVIVING fillStore (useState initializer, use-data-grid-fill.tsx:43) and is cleared only inside endDrag/cancelDrag (lines 264, 274) — so the dashed rect is genuinely orphaned. That asymmetry is what makes the stuck-preview claim correct rather than self-healing.

Handler-registration gap also confirmed: fill-tracker.tsx:62 cleanup calls _registerFillHandlers(null) (create-store.ts:875), and root.tsx:210-218 forwards fillHandlers?.fillDown/fillRight into the keymap, so mod+D/mod+R no-op in that window.

Trigger is real and the finding understates it: beyond the cited docs pattern (fill-handle.mdx:43-50), the repo's own data-grid-events-demo.tsx:201 calls useDataGridFill in a component whose onSelectionChange (:129) and onDataChange (:124) setState — remounting on every selection change, including during drags.

Corrections: (1) severity medium, not high — the hero demo (data-grid-demo.tsx:63) is uncontrolled (defaultData, useMemo rows), so it never re-renders; the bug needs a controlled consumer. (2) The doc comment at lines 21-22 calling this "cheap" and equivalent to re-creating the element is affirmatively wrong: element re-creation preserves type identity, component re-creation does not. No mount-count regression test exists in data-grid-fill/test/. Unrelated to the install harness — this is runtime, not payload.

### [MEDIUM | confirmed] registry-smoke.ps1 installs 3 of 13 add-ons, none of which exercise a cross-add-on import

- **Where:** scripts/registry-smoke.ps1:82 · dim: architecture · kind: test · effort: M

`$items = "@gridcn/data-grid", "@gridcn/data-grid-toolbar", "@gridcn/data-grid-history"` covers 3 of the 13 add-on items and zero of the 24 demo items. All three chosen items import only the core barrel, which is the single path fix-registry-imports.mjs happens to handle — so the one end-to-end gate in the repo is structurally blind to the entire class of defect in finding #1. The smoke test scaffolds two real consumer apps and typechecks them, which is exactly the machinery that would have caught 21 broken imports; it simply never installs an item that contains one. Cost: the most expensive test in the project (two `create-next-app`/Vite scaffolds plus installs) buys near-zero marginal coverage of the registry's riskiest surface, while `data-grid-io`, `data-grid-lazy`, `data-grid-pagination`, `data-grid-url-state`, `data-grid-presence`, `data-grid-fill`, `data-grid-pinned-rows`, `data-grid-sort-list`, `data-grid-context-menu`, `data-grid-keybindings` and every demo go untested against a real CLI install.

**Recommendation:** Install ALL non-demo items in one pass (they share the two scaffolded apps, so the marginal cost is one `shadcn add` invocation, not a new app), and add at least one demo item — `data-grid-io-demo` or `data-grid-events-demo`, which between them carry four distinct cross-add-on imports. The existing typecheck/build step then fails automatically on any unresolvable alias. Derive the item list from registry.json rather than hardcoding it, so new items are covered the day they are added.

**Verifier:** Every mechanical claim checks out.

scripts/registry-smoke.ps1:82 is literally `$items = "@gridcn/data-grid", "@gridcn/data-grid-toolbar", "@gridcn/data-grid-history"`, used verbatim for both consumers (lines 100, 239). registry.json has 36 items: 13 non-demo, 23 demos. So coverage is 3/13 non-demo and 0/23 demos.

The blindness claim is confirmed empirically. Scanning all public/r/*.json for surviving `@/registry/default/blocks/` aliases: 16 payloads carry them (data-grid-lazy.json -> .../data-grid/is-dev; data-grid-pagination.json -> .../data-grid/labels; plus 14 demos, e.g. data-grid-events-demo.json with four distinct cross-add-on aliases). The three smoke-installed payloads are clean: data-grid has zero registry aliases, toolbar and history each carry only `@/registry/default/components/data-grid` — the single literal fix-registry-imports.mjs:25-26 rewrites. So the one scripted end-to-end gate installs exactly the three items that cannot fail this way.

Harness reconciliation (the required check): the 35/35 consumer-install pass was NOT registry-smoke.ps1. Per docs/agent-work/plans/2026-07-17-qa-workplan.md:652-653 and 673-675, #57/#60/#61 was a separate manual harness that installed EVERY item ("35/35 install nested, consumer tsc/build CLEAN"). registry-smoke.ps1 has not been modified since the pre-#60 commit 5dfec73 (git log on the file), so it is stale, not the thing that passed. The two facts do not conflict — the manual harness had the coverage the script lacks, and none of it is automated or repeatable.

Severity correction: this is a test-coverage/DX gap, not a shipping defect — it is the *reason* findings about broken payloads went uncaught, and its own impact is zero until a payload regresses. High is too strong; medium fits. Note also the recommendation's premise that a demo install would fail typecheck depends on the alias actually being unresolvable, which is findings #3/#6/#7's claim, not this one's.

### [MEDIUM | confirmed] data-grid-lazy reaches past the core barrel for isDev, which the barrel does not export

- **Where:** registry/default/blocks/data-grid-lazy/lazy-guard.tsx:10 · dim: architecture · kind: structure · effort: S

`import { isDev } from "@/registry/default/blocks/data-grid/is-dev";` bypasses the core barrel. Unlike the labels case (finding #5), this one is not merely stylistic: `isDev` is genuinely absent from the core barrel — grepping data-grid.tsx for `isDev` returns nothing, while `is-dev.ts:2` defines `export function isDev()`. So the add-on has no barrel-legal way to reach it and the boundary rule is actually unsatisfiable here. Failure scenario: `npx shadcn add @gridcn/data-grid-lazy` emits `@/components/blocks/data-grid/is-dev` (the CLI's blocks-path fallback) while the file actually lands at `components/data-grid/is-dev.ts` — the consumer's build breaks on module-not-found. Confirmed present in the shipped `public/r/data-grid-lazy.json`.

**Recommendation:** Add `export { isDev } from "./is-dev";` to registry/default/blocks/data-grid/data-grid.tsx and change lazy-guard.tsx line 10 to import `isDev` from `@/registry/default/blocks/data-grid/data-grid`. That makes the import rewritable by the existing hardcoded rule and closes the hole independently of the generic regex fix in finding #1 — worth doing both, since the barrel export is the actual contract.

**Verifier:** I tried to refute this and could not. Every factual claim checks out.

1. The import exists: lazy-guard.tsx:10 `import { isDev } from "@/registry/default/blocks/data-grid/is-dev";`
2. `isDev` is genuinely absent from the core barrel. Grep across registry shows `isDev` only in is-dev.ts:2 (definition) and relative-path consumers (root.tsx:36, body.tsx:15, commit.ts:5, use-row-window.ts:4). data-grid.tsx never re-exports it, so the barrel-legal route really is unavailable.
3. It survives into the shipped payload. public/r/data-grid-lazy.json, file `components/data-grid-lazy/lazy-guard.tsx`, still contains the raw `@/registry/default/blocks/data-grid/is-dev` (its sibling line was rewritten to `@/registry/default/components/data-grid`), because fix-registry-imports.mjs:25 matches only the literal `.../data-grid/data-grid`.
4. The CLI fallback is exactly as described. I decompiled the rewriter `vc()` in node_modules/shadcn/dist/chunk-MZJVAM2M.js: after the ui/lib-utils/components/lib/hooks branches all miss, it ends `e.replace(/^@\/registry\/[^/]+/, t.aliases.components)` → `@/components/blocks/data-grid/is-dev`. The file's registry.json target is `components/data-grid/is-dev.ts` — no `blocks/` segment. Module-not-found.

Harness reconciliation (the refutation I expected to land): scripts/registry-smoke.ps1:82 installs only data-grid, data-grid-toolbar, data-grid-history — not data-grid-lazy. The 35/35 claim comes from workplan #60/#61's separate preserved `consumer-test/` harness, which is not in-repo and unverifiable read-only. Notably public/r/data-grid-lazy.json was last rebuilt in 8e09e8b, the #60 commit itself, so the payload the harness allegedly passed already contained this string — meaning either the pass didn't typecheck this file or the note "cross-item rewrites resolve by basename" (workplan:649) describes `Qt()` target *placement*, not specifier rewriting. I found no basename remap of import specifiers anywhere in the CLI.

Corrections to scope: the finding calls this unique versus finding #5's "stylistic" labels case, but 25 raw `blocks/` aliases survive across 21 payloads (data-grid-pagination.json, plus 23 demo-item occurrences). So this is one instance of a class, not a singleton — which argues for the generic regex fix in #1 over the per-symbol barrel export. Severity medium rather than high: the barrel-export recommendation is correct and the file is dev-only, but breakage hits only consumers installing data-grid-lazy, and the recommendation as written fixes one of 25 occurrences.

### [MEDIUM | confirmed] No lint rule enforces the barrel-only boundary that the distribution model depends on

- **Where:** eslint.config.mjs:1 · dim: architecture · kind: dx · effort: S

eslint.config.mjs contains no `no-restricted-imports` rule and no mention of `registry/default/blocks` — grepping for both returns nothing. The barrel-only rule is the load-bearing invariant of the whole shadcn-registry distribution model (a non-barrel cross-item import is not a style nit, it is a broken consumer install, as findings #4 and #5 demonstrate), yet it is enforced purely by convention. The current 51-import cross-item graph is 49/51 compliant, which shows the convention mostly holds — but the two violations that did slip through both shipped broken payloads, and there is no mechanism to stop the next one. This is the cheapest possible fix for the highest-frequency failure mode in the repo.

**Recommendation:** Add a `no-restricted-imports` rule with a `patterns` entry allowing `@/registry/default/blocks/*/[name]` (the barrel, where the last segment equals the folder) and forbidding all other `@/registry/default/blocks/*/**` paths, scoped to `registry/default/blocks/**`. Pair it with a second pattern forbidding `@/registry/default/blocks/data-grid-*` inside `registry/default/blocks/data-grid/**` to lock the dependency direction (currently clean — no core->addon import exists — but likewise unenforced).

**Verifier:** Every factual claim holds.

1. Absence of the rule: eslint.config.mjs is 68 lines, fully read. Its two rule blocks (lines 27-45, 60-66) contain no `no-restricted-imports` and no path-based import restriction; a grep for `no-restricted-imports|registry/default/blocks` over the file returns zero matches. Nothing else enforces it either — verify-registry.mjs checks only registry.json `files`/`target` drift against the filesystem (lines 45-98) and never inspects file contents; fix-registry-imports.mjs matches a single literal (line 25) and exits 0 unconditionally.

2. The invariant is genuinely load-bearing, not stylistic. Both violations ship broken: `@/registry/default/blocks/data-grid/is-dev` survives into public/r/data-grid-lazy.json (source: data-grid-lazy/lazy-guard.tsx:10) and `@/registry/default/blocks/data-grid/labels` into public/r/data-grid-pagination.json (source: data-grid-pagination/pagination-footer.tsx:8). The rewriter's own header comment (fix-registry-imports.mjs:2-12) documents why these become unresolvable `@/components/blocks/...` for consumers.

3. Compliance ratio: grep over registry/ returns 128 `@/registry/default/blocks/` import lines; exactly 2 are non-barrel. The claim's "51-import" count is understated (it likely excludes tests/examples), but the substantive claim — near-total convention compliance with exactly two escapees, both of which shipped broken — is exactly right.

4. Harness reconciliation: registry-smoke.ps1:82 installs only `data-grid`, `data-grid-toolbar`, `data-grid-history`. Neither `data-grid-lazy` nor `data-grid-pagination` is in that set, so consumer tsc at 0 errors is fully consistent with these two payloads being broken — the harness never installed them.

Severity adjusted high→medium: this is the DX/prevention layer, correctly self-described as `kind: "dx"`. The shipping breakage is already carried by findings #4/#6/#7; this finding's own marginal harm is only the absence of a guard. The recommendation is sound and the effort estimate (S) is accurate.

### [MEDIUM | confirmed] ColumnDefOf and ClipboardProcessCtx type public props but are not re-exported from the entry point

- **Where:** registry/default/blocks/data-grid/data-grid.tsx:132 · dim: api-dx · kind: dx · effort: S

data-grid.tsx line 132 does `import type { ColumnDefOf, ClipboardProcessCtx } from "./store";` — a plain import, not a re-export. But ColumnDefOf<TData> is the declared type of `DataGridProps.columns` (line 243) and `DataGridSyncProps.columns`, and ClipboardProcessCtx<TData> is the ctx type of both processCellForClipboard and processCellFromClipboard (lines 255-257). Verified with tsc: `G.ColumnDefOf<Employee>` and `G.ClipboardProcessCtx<Employee>` from the public entry both fail to resolve. Failure scenario: a consumer factoring columns into their own module writes `function buildColumns(): ColumnDefOf<Employee>[]` and cannot import that type from where every doc tells them to import (`@/components/data-grid/data-grid`). Their workarounds are all bad — reach into the private `./store` barrel, or fall back to `ColumnDef<Employee, unknown>` (which is NOT the same type: it lacks the TValidate=any erasure, so a defineColumns literal carrying a narrow `validate` will not widen into it). The same trap hits any consumer writing a shared processCellForClipboard helper.

**Recommendation:** Change line 132 to a re-export: `export type { ColumnDefOf, ClipboardProcessCtx } from "./store";` (they are already in the store barrel's export list, store/index.ts:7-8). Add a lint or type-test rule that every type appearing in a public props type is itself reachable from data-grid.tsx — the same class of bug could recur with GridDirection or RowBandsSpec.

**Verifier:** Every mechanical claim verified.

1. Plain import, not re-export: data-grid.tsx:132 is `import type { ColumnDefOf, ClipboardProcessCtx } from "./store";`. Grep for `export *` in data-grid.tsx returns nothing, so there is no incidental star re-export. Grep for both identifiers across the whole file returns only lines 132, 243, 255, 257 — never on an `export` line.

2. They type public props: data-grid.tsx:243 `columns: readonly ColumnDefOf<TData>[]`; :255/:257 `ctx: ClipboardProcessCtx<TData>` on processCellForClipboard/FromClipboard. Same on the provider side (store/types.ts:44, :55, :57).

3. Recommendation is accurate: both are already in the store barrel's export list (store/index.ts:6-7), so the one-line change to `export type {...} from "./store"` works as written.

4. The "ColumnDef is not a substitute" argument holds, and is the non-obvious part. types.ts:287 declares `ColumnDef<TData, TValue = unknown, TValidate = TValue>`; store/types.ts:203 defines `ColumnDefOf<TData> = ColumnDef<TData, unknown, any>`. TValidate appears only in `validate?: ((value: TValidate, row: TData) => string | null) | StandardSchemaV1<TValidate>` (types.ts:320) — a contravariant position, so the `any` erasure is genuinely load-bearing. A consumer falling back to `ColumnDef<Employee>` gets TValidate=unknown, which rejects a column carrying a narrow `validate`.

Harness reconciliation (no contradiction): this is not a broken import. The shipped file resolves `./store` relatively and both payload targets are siblings (components/data-grid/data-grid.tsx, components/data-grid/store/index.ts), so consumer tsc passes. The harness typechecks installed files, never consumer code importing these types from the entry — structurally blind to this.

Severity correction: high→medium. Zero runtime impact, no broken install, and an escape hatch exists (import from the private `./store`). It is a real public-API completeness gap with a one-line fix, but it is DX, not correctness — consistent with the finding's own kind:"dx"/effort:"S". Scope note: docs never mention either type name (grep of content/docs returns nothing), so the "where every doc tells them to import" framing is slightly overstated — the trap is real but reached by inference from the props table, not by a doc snippet.

### [MEDIUM | confirmed] RTL browser tests silently self-skip, so three of the highest-value RTL claims can pass while asserting nothing

- **Where:** registry/default/blocks/data-grid/test/rtl.browser.test.tsx:307 · dim: tests · kind: test · effort: S

Three RTL tests contain early-return / continue guards that turn a missing element into a silent pass instead of a failure. Line 307: `const overlay = document.querySelector("[data-grid-selection-rect]"); if (!overlay) return;` — grepping the whole registry shows `data-grid-selection-rect` appears ONLY in this test file and nowhere in any source file, so the selector never matches and the entire "aligns a selection rectangle with the cells it covers" body (the only assertion that RTL selection overlays are not mirrored wrong) is dead code that has never once executed. Line 221 (`if (!active) return`) and line 196 (`if (!cell) continue`) have the same shape: the hit-testing loop over columns [0,3,6] would report success even if `cellAt()` returned undefined for every column, i.e. if the grid rendered no cells at all. Failure scenario: an RTL regression that mirrors the selection overlay to the wrong physical edge, or that breaks cell rendering under RTL entirely, ships green — the suite reports 'RTL — selection overlay alignment: passed' while having evaluated zero expectations. This is the worst failure mode in a test suite: a claim of coverage that is actually absence of coverage, on the newest and least-battle-tested feature.

**Recommendation:** Delete the `if (!overlay) return` escape and assert the overlay exists: either add the `data-grid-selection-rect` attribute to the real selection-overlay element in source, or rewrite the test against whatever attribute the overlay actually renders today (find it in overlays.tsx) and assert `expect(overlay).not.toBeNull()` before measuring. For lines 196 and 221, replace the guards with hard assertions (`const cell = cellAt(colIndex); expect(cell).toBeDefined();`). As a suite-wide rule, ban bare `if (!x) return` in browser tests — a missing element is a failure, not a skip.

**Verifier:** Tried to refute; the central claim is exactly right.

Decisive evidence — rtl.browser.test.tsx:306-307 queries `[data-grid-selection-rect]` then `if (!overlay) return;`. A repo-wide grep for `data-grid-selection-rect` returns exactly ONE hit: that test line itself. The real attribute is `data-grid-selection-overlay=""`, emitted by `RangeOverlay` at overlays.tsx:111 and used correctly by 8 other test files (overlays.test.tsx:66, pinned.browser.test.tsx:127, scroll-drag.browser.test.tsx:250, row-markers.browser.test.tsx:336, data-grid.browser.test.tsx:351...). So the selector can never match, and the entire body (lines 308-313 — the only assertions that RTL overlays are not mirrored to the wrong physical edge) has never executed once. The test reports green having evaluated zero expectations.

The coverage gap is real, not merely cosmetic: overlays place by grid line (`gridColumnStart: rect.x + colOffset`, overlays.tsx:116-119) plus `pinnedInsetStyle` counter-offsets (line 101), and grepping overlays.test.tsx for `rtl|direction` returns no matches. No other test covers RTL overlay geometry. The inline comment excusing the skip ("grid-line placement covered by LTR suite") is precisely the assumption an RTL regression would violate.

Corrections to scope: lines 196 and 221 are a weaker class than 306. They are *conditionally* vacuous — `cellAt()` does resolve today, so those bodies do run; they would only degrade to silent passes under an unrelated regression. Line 221's guard is additionally documented as intentional. So one test is confirmed-dead, two are latent. That mixed picture is why I set severity to medium rather than high: it is one silently-dead test plus two fragile guards, not three tests currently asserting nothing.

Severity is not lower than medium because commit 2dc410e advertises "18 RTL browser tests" as the delivered gate for a feature shipped a day before the audit — the count is inflated by a test that cannot fail. Recommendation (assert `not.toBeNull` against the real attribute) is correct; note the fix is a test-side selector change, no source attribute needs adding.

### [MEDIUM | confirmed] Async bulk-validation guard: the staleness half of the contract is never tested at a real call site

- **Where:** registry/default/blocks/data-grid/clipboard/use-data-grid-clipboard.test.tsx:124 · dim: tests · kind: test · effort: M

`isBulkBatchCurrent` has excellent unit coverage of its four drop conditions (row gone, sort change, filter change, pure reorder survives) in validation/test/bulk-generation.test.ts. But at the three real call sites — paste (use-grid-clipboard.ts:210), fill (use-fill-handle.ts:224) and the store — only the *generation* half is exercised end-to-end: the sole integration test is "a second paste before the first resolves supersedes it" (line 124), which trips `guard.begin()`'s token counter. No test drives the *snapshot* half through a real hook: start an async paste/fill, mutate the view while it is in flight (change the sort, delete a target row, replace `data`), then let it resolve. Failure scenario: someone refactors `applyParsedPaste` to snapshot AFTER the await, or passes `s` instead of `storeApi.getState()` as `current` (the code at use-grid-clipboard.ts:206 deliberately re-reads `storeApi.getState()` precisely because the captured `s` is stale) — every unit test still passes, and a paste that resolves after the user re-sorts lands its values on whatever rows now occupy those view positions. That is silent cross-row data corruption on the user's data, the exact risk the guard exists to prevent, and nothing would catch it.

**Recommendation:** Add three integration cases to use-data-grid-clipboard.test.tsx (and mirrors in use-fill-handle.test.ts) using the existing `settle()` helper: (1) start an async paste, call `actions.setSorts(...)` before settling, assert `onDataChange` is never called; (2) same but `actions.deleteRows([...])` removing a target row; (3) the positive control — reorder rows so targets move but ids survive, assert the paste DOES commit and lands on the right row ids. Case (3) is the one that proves the guard is not simply over-rejecting everything.

**Verifier:** Tried to refute; the coverage gap is real and exhaustively verifiable read-only.

Mechanism is as described. `isBulkBatchCurrent` (validation/bulk-generation.ts:49-55) has two independent drop conditions: sort/filter identity change (:50) and a missing target rowId (:53-54). `useBulkGeneration.isCurrent` ANDs that with the token counter (:88). Real call sites: paste at use-grid-clipboard.ts:209-215 (snapshot taken at :210 BEFORE the await, `current` deliberately re-read via `storeApi.getState()` at :212) and fill at use-fill-handle.ts:223-226 — exactly as claimed.

Coverage audit confirms the split:
- Unit: bulk-generation.test.ts:35-85 covers all four snapshot conditions plus the pure-reorder positive control, but only against hand-built `state()` literals, never a real store.
- Integration: the three async paste tests (use-data-grid-clipboard.test.tsx:109-151) cover transform-on-resolve, token supersede (:124), and all-cells-rejected. Only :124 reaches the guard, and solely via `begin()`'s counter — `sortState`/`filterState` are untouched and no row is removed, so `isBulkBatchCurrent` returns true in every one.
- Greps confirm zero tests anywhere: `setSorts|deleteRows|setFilters` has no match in the clipboard dir or data-grid-fill; `guard|snapshot|generation|stale` has no match in use-fill-handle.test.ts; the only `pasteFromClipboard/pasteText/runFill` test files are the two audited.

Two scope corrections. (1) The claim's "and the store" as a third call site is wrong: store/create-store.ts:589-606 uses a separate `streamGeneration` int counter with NO snapshot at all, so there is no staleness half there to test (update-cells.test.tsx:333 covers its supersede case). Only paste and fill are affected — two sites, not three. (2) Severity is medium, not high: this is a missing-regression-test finding on code that is currently correct, not a live defect. No user-facing bug exists today; the risk is the described refactor landing undetected.

### [MEDIUM | confirmed] rowId-native presence adapter — the documented DIY mapping is O(n) per store change at any row count

- **Where:** registry/default/blocks/data-grid/store/hooks.ts:336 · dim: features · kind: feature · effort: M

multiplayer-presence.mdx:103-113 tells every consumer to build a rowId→viewRow map with `useDataGridRowIds(Array.from({length: rowCount}, (_, i) => i))`. That hook (store/hooks.ts:336) wraps `useShallow` over the returned array, so on a 100k-row grid the subscriber allocates a 100k-element array AND shallow-compares 100k entries on EVERY store mutation — every keystroke in a cell editor, every selection step, every streaming tick. The docs snippet also builds a 100k-entry `Array.from` on each render before the memo can help. This is exactly the cost the presence add-on's own zero-cell-render probe was built to avoid, pushed onto the consumer by the docs. The seam to fix it already exists: `store/row-index.ts` is a lazily-built, incrementally-maintained rowId→dataIndex Map with invalidate/rebase already wired into every mutation path, and `useDataGridStoreApi` is public (store/index.ts:22). This is the exact item the workplan already lists under 'Backlog candidates' as 'rowId-native presence adapter'. Consumer story: a team wires a websocket presence feed into a 50k-row grid; every remote cursor tick and every local keystroke pays a 50k shallow compare, and the grid that markets zero-render presence stutters.

**Recommendation:** Add `useDataGridRowIdToViewRow()` to core's store hooks: subscribe atomically to `viewIndex` identity only (not a shallow array compare) and build the Map lazily inside a `useMemo` keyed on that identity, reusing the `createRowIndexCache` pattern from store/row-index.ts. Then add a rowId-native presence entry type to data-grid-presence (`{ id, color, rowId, columnId }`) that the plugin resolves at paint time, dropping entries whose rowId is filtered out. Replace the multiplayer-presence.mdx snippet and the 'No rowId-native adapter' callout (lines 126-129, 159) with the real API.

**Verifier:** Every mechanism checks out in source.

`useDataGridRowIds` (store/hooks.ts:336-347) maps over the caller's index array inside `useShallow`. `useShallow` (node_modules/zustand/react/shallow.js) is a *selector wrapper*: `(state) => { const next = selector(state); return shallow(prev, next) ? prev : (prev = next) }`. It memoizes the returned reference but does NOT gate selector execution — `useDataGridStore` (store/provider.tsx:190-192) calls `useStore(api, selector)`, so the full n-element `.map()` plus an n-element `shallow()` compare run on every store notification. At `rowCount = viewIndex.length` that is genuinely O(n) per store change, not per view change as the snippet's own comment claims ("Builds a rowId -> view-row lookup once per view change").

Mutation frequency is real: `set({ selection: ... })` fires on every selection step and every drag-extend tick (create-store.ts:203, 208, 221, 231, 244, 282; extendTo dispatched from interaction/use-grid-interaction.ts:434 during pointer drag). Scroll is NOT in the store, which bounds it somewhat.

The docs snippet (multiplayer-presence.mdx:104-113) is the exact anti-pattern described: `Array.from({length: rowCount})` allocates fresh every render (before the memo), and `[rowIds, viewIndex]` is useless as a memo key because both are `useShallow`-stabilized — the memo body is cheap relative to the selector cost it cannot prevent. Core itself uses the hook correctly, on a windowed slice (body.tsx:119, `viewRowIndices` = computeWindow range), which is why core has no such cost.

The seam claims are accurate: `createRowIndexCache` (store/row-index.ts:31-50) is lazily built and incrementally invalidated/rebased, and `useDataGridStoreApi` is exported (store/index.ts:22). The workplan does list "rowId-native presence adapter" under backlog (2026-07-17-qa-workplan.md:1079).

Severity corrections: this is a docs/DX gap, not a shipped defect — no core or add-on code pays this cost, and it only bites a consumer who both wires presence and passes a large `rowCount`. Also `kind: "feature"` is right; it is not a bug. Downgrading high → medium.

### [MEDIUM | confirmed] Aggregation helper for pinned totals rows — the documented pattern silently ignores the active filter

- **Where:** registry/default/blocks/data-grid-pinned-rows/use-data-grid-pinned-rows.tsx:34 · dim: features · kind: feature · effort: M

pinned-rows.mdx:77 states 'There is no aggregation API' and the worked example (lines 82-104) computes totals with `useMemo(() => [computeTotalsRow(grid.data)], [grid.data])`. `grid.data` is the RAW array — it ignores `viewIndex` entirely. So the moment a user applies a filter or types in the toolbar search, the pinned band still shows the totals of ALL rows while the body shows a subset. The docs never flag this; the callout at the end of that section only discusses reference stability. Every other grid in the comparison set treats filter-aware aggregation as table stakes, and the totals row is the single motivating use case the pinned-rows add-on was extracted for (the not-supported register, 'Pinned rows (v1 scope)', calls them 'designed for totals/summary bands'). Consumer story: a finance dashboard filters to one region; the sticky bottom band still reads the company-wide total, and the number is wrong in a way that looks authoritative. Everything needed already exists — `useDataGridViewIndex()` gives display order and `useDataGridStoreApi` is public — so this is a hook over existing state, not new core machinery. Note this is NOT the rejected 'Row grouping + aggregation' item: no second row model, no group rows, no expansion state; it is a scalar reduce over the flat viewIndex.

**Recommendation:** Add `useDataGridAggregate(specs)` to data-grid-pinned-rows: takes `{ [columnId]: 'sum' | 'avg' | 'min' | 'max' | 'count' | ((values, rows) => unknown) }`, resolves values through each column's accessor, and reduces over `viewIndex` (filter/search-aware) with an `over: 'view' | 'all'` escape hatch. Memoize on viewIndex + data identity so a scroll never recomputes. Rewrite the pinned-rows.mdx 'Computing a totals row' section around it and keep the manual pattern only as the custom-reducer fallback, with an explicit note that reducing over `data` ignores filters.

**Verifier:** Mechanism fully confirmed in source.

- pinned-rows.mdx:77 says verbatim "There is no aggregation API"; the worked example at :102-103 is `useMemo(() => [computeTotalsRow(grid.data)], [grid.data])`.
- `grid.data` is the raw useState array: use-data-grid-state.ts:39 `useState<readonly TData[]>(initialRows)`, returned unmodified at :48. No viewIndex involvement.
- Filters DO narrow viewIndex: computeViewIndex passes `filters: filterState` into buildViewIndex (compute.ts:238-240). So filtered body + raw-data totals genuinely diverge.
- The shipped demo repeats the pattern verbatim (registry/default/examples/data-grid-pinned-rows-demo.tsx:77-78), so this is the canonical copy-pasted example, not a doc-only simplification.
- Docs never flag it. Nearest callout (pinned-rows.mdx:56-58 "Never sort or filter") says pinned rows aren't *reordered* by sort/filter — a claim about band row order that if anything reads as reassurance. The end-of-section callout (:114-119) covers only reference stability.
- Proposed seams are real and public: useDataGridViewIndex and useDataGridStoreApi both exported from store/index.ts:43,22.

CORRECTION: "types in the toolbar search" is wrong. Quick-search deliberately never narrows viewIndex (compute.ts:239; store/types.ts:350 "never affects `viewIndex`"); it only highlights/navigates. Totals stay consistent under search. Only column filters diverge — half the stated trigger surface is refuted.

SCOPE: This is a docs/feature-gap item, not a code defect. The cited line (use-data-grid-pinned-rows.tsx:34) is correct as written — it takes opaque `readonly unknown[]` and rightly knows nothing about filters. Also, the quoted "not-supported register" phrasing ("Pinned rows (v1 scope)") did not appear in a grep of content/docs — unverified — though index.mdx:58 ("Use them for derived aggregates like totals") supports the same point.

SEVERITY: high -> medium. Real trap (authoritative-looking wrong numbers), but requires pinned rows + column filters combined, the demo ships no filtering UI, and the fix is purely additive.

No registry/payload dimension, so the 35/35 consumer-install harness is not implicated.

### [LOW | confirmed] DataGrid omits duplicateRow, cellTypes and labels, silently downgrading the convenience wrapper

- **Where:** registry/default/blocks/data-grid/data-grid.tsx:229 · dim: api-dx · kind: dx · effort: S

DataGridSyncProps declares duplicateRow, cellTypes and labels (store/types.ts:53, :79, :88), and DataGridProvider forwards all three into the store. DataGridProps declares none of them, and the DataGrid wrapper (lines 339-459) never forwards them. Verified with tsc: `p.duplicateRow`, `p.cellTypes` and `p.labels` on DataGridProps<Employee> all error as non-existent properties. The consumer-facing consequence is concrete: a consumer who follows the quick-start (`<DataGrid {...grid} columns={columns} />`), registers a custom cell type per custom-cell-types.mdx, and then hits mod+D to duplicate a row gets a dev-warning no-op with no compile-time hint why; the only fix is a full rewrite to the four-part DataGridProvider/DataGridRoot/DataGridHeader/DataGridBody composition. The same applies to i18n: every i18n.mdx example uses DataGridProvider, so any consumer on DataGrid must abandon the wrapper to localize a single string. The docs never state that DataGrid is a strict subset of the provider's props.

**Recommendation:** Add `duplicateRow?: (row: TData, index: number) => TData`, `cellTypes?: Record<string, CellType<TData, unknown, unknown>>` and `labels?: DeepPartialLabels` to DataGridProps and forward all three to DataGridProvider in the wrapper body. If any prop is deliberately provider-only, say so explicitly in DataGridProps' doc block and in api-reference.mdx rather than leaving it as a silent omission. Consider a type-level guard test asserting `Exclude<keyof DataGridSyncProps<T>, keyof DataGridProps<T>>` is the intentionally-empty (or explicitly enumerated) set, so the next sync prop added cannot drift out of the wrapper unnoticed.

**Verifier:** The structural claim is confirmed by direct source reading; no compile needed.

- store/types.ts:53 `cellTypes?`, :79 `labels?`, :88 `duplicateRow?` are all on DataGridSyncProps, and DataGridProviderProps = DataGridSyncProps & {children} (types.ts:586). store/provider.tsx destructures and forwards all three (lines 50/65, 90/105, 147/162).
- data-grid.tsx:229-332 DataGridProps enumerates ~50 props; `cellTypes`, `labels`, `duplicateRow` are absent. The wrapper body (339-389 destructure, 400-435 forward) never mentions them. So a consumer on `<DataGrid>` genuinely cannot register a cell type, localize a label, or enable duplicateRows.

Corrections that lower severity from high to low:
1. The headline failure narrative is wrong. "hits mod+D to duplicate a row" — mod+D is fillDown (use-grid-interaction.ts:63), not duplicate. Grepping keyboard/default-keymap.ts and use-grid-interaction.ts for `duplicateRow` returns zero hits; finding #16 in this same batch establishes duplicateRow has no keybinding and no dispatch case at all. So the concrete user-visible path described here does not exist even on the provider.
2. "The docs never state that DataGrid is a strict subset" is refuted. api-reference.mdx:36-42 lists the provider's props then says verbatim "It also has `cellTypes`, `labels`, and `duplicateRow`", i.e. those three are called out as provider-only. The adjacent callout (lines 46-53) documents the inverse gap too. The documentation is thin, not absent.
3. Not a bug — no runtime breakage, no wrong behavior, purely a missing convenience forwarding. Correct kind ("dx") and effort ("S"); the recommendation (add three props + forward) is sound and cheap.

Real API-surface gap, correctly located, but the severity was inflated by an invented keyboard scenario and an incorrect docs claim.

### [LOW | confirmed] `insertRowBelow` and `duplicateRow` are declared GridActions with labels and a dialog category but have no keybinding and no dispatch handler

- **Where:** registry/default/blocks/data-grid/keyboard/default-keymap.ts:45 · dim: features · kind: bug-risk · effort: S

`GridAction` (types.ts:407) includes `"insertRowBelow" | "duplicateRow"`. Both have keybinding labels (labels.ts:347-348), both are categorized for the keybindings dialog (data-grid-keybindings/action-groups.ts:52), and the context menu explicitly renders a shortcut hint for one: cell-menu-content.tsx:106 calls `formatKeymapShortcut(DEFAULT_KEYMAP, "insertRowBelow")`. But DEFAULT_KEYMAP (keyboard/default-keymap.ts, 50 lines) binds neither, and the interaction dispatcher's switch (interaction/use-grid-interaction.ts:578-723) has no `case "insertRowBelow"` or `case "duplicateRow"` — the last row-op-adjacent cases are fillDown/fillRight/undo/redo. Consequence today: the context menu renders an EMPTY `<ContextMenuShortcut>` next to 'Insert row below' (formatKeymapShortcut returns undefined at format-keymap-shortcut.ts:31), and any consumer who binds these actions in their own keymap gets a key that swallows the event and does nothing. Excel-parity story: a data-entry user can insert a row only by right-clicking, while every comparable grid gives Ctrl+Plus / Ctrl+D-style row ops; the store already exposes `actions.insertRow(viewRowIndex, position)` and `actions.duplicateRows(viewRowIndexes)` (store/types.ts:521,530) so the work is wiring, not design.

**Recommendation:** Add two `case` arms to the interaction dispatcher calling `actions.insertRow(activeCell.row, "below")` and `actions.duplicateRows([activeCell.row])`, guarded on `readOnly` and (for duplicate) on the `duplicateRow` prop being present — mirroring cell-menu-content.tsx:28's own guard. Bind defaults in DEFAULT_KEYMAP (e.g. `mod+Shift+Equal` / `mod+Shift+D`, checked against the existing bindings for collisions). Add a keyboard test per action plus a test asserting every member of the GridAction union is either bound or explicitly listed as consumer-only, so the union can never drift from the dispatcher again.

**Verifier:** Every mechanical claim verifies. types.ts:407 declares both actions; labels.ts:347-348 give keybinding-dialog labels; action-groups.ts:52-53 categorize them as "editing"; cell-menu-content.tsx:106,114 render `formatKeymapShortcut(DEFAULT_KEYMAP, ...)`. DEFAULT_KEYMAP (default-keymap.ts:10-50) binds neither, and the dispatcher switch (use-grid-interaction.ts:577-728) ends at fillDown/fillRight/undo/redo with no case for either and no `default` arm.

Two corrections that drop this from bug-risk to cosmetic/feature-gap:

1. The unbound state is DELIBERATE and pinned by a test — keyboard/index.test.ts:231-234 asserts `DEFAULT_KEYMAP.insertRowBelow`/`.duplicateRow` are undefined. `editReplace` is an existing precedent for a GridAction that is intentionally never bound or dispatched (is-printable-key.ts:6 documents it as the printable-key fallback). So the union carrying non-dispatched members is an established pattern, not drift.

2. The claimed "empty ContextMenuShortcut" is not a rendering defect. `formatKeymapShortcut` returns `undefined` (format-keymap-shortcut.ts:30-31), so React renders `<span>` with no children — zero-width, `ml-auto`, no visible artifact. The finding overstates this as user-visible.

The keybindings dialog is unaffected: groupKeymap iterates `Object.entries(keymap)` and `continue`s on empty bindings (keybindings-dialog.tsx:38-39), so unbound actions never render a blank row.

The one real residual mechanism: a consumer who binds these in a custom keymap gets a dead key. `matchKeymap` returns the action, so the `isPrintableKey` type-to-edit fallback at use-grid-interaction.ts:566-572 is skipped, and the switch falls through with no handler and no preventDefault. That is a genuine (if self-inflicted, opt-in) trap.

Real, but a feature gap plus a consumer-keymap footgun — not a defect in default behavior. The context menu path works correctly via `actions.insertRow`/`duplicateRows`.

### [LOW | plausible] setCellValue accepts a wrong-typed value whenever the column is a plain ColumnDef

- **Where:** registry/default/blocks/data-grid/columns/column-helpers.ts:101 · dim: api-dx · kind: bug-risk · effort: M

InferredValue<TData, TCol> only resolves through `accessorFn`'s return type or `accessorKey`'s field type; it has no branch reading ColumnDef's own TValue parameter, so it falls through to `unknown` for any column whose static type is `ColumnDef<TData, TValue>`. Verified with tsc: for `declare const plain: ColumnDef<Employee, number>`, `getCellValue({} as Employee, plain)` is typed `unknown` (assigning to `number` errors), and — worse — `setCellValue({} as Employee, plain, "a string, not a number")` compiles clean, writing a string into a numeric column with no diagnostic. This is silent data corruption at the exact API the docs point consumers to for custom column UI: api-reference.mdx:107 tells consumers that AnyColumnDef 'is the row-agnostic shape that the store and its hooks traffic in' and to 'reach for it when you write custom column UI', and useDataGridVisibleColumns returns exactly that shape, so hand-rolled toolbar/inspector code hitting setCellValue gets zero protection. The narrow-literal path from defineColumns does infer correctly (`InferredValue` on a `{ accessorKey: "salary" } as const` literal resolves to `number`), which makes the failure mode inconsistent and hard to notice: the identical call site is safe or unsafe depending on whether the column flowed through defineColumns or was annotated as ColumnDef.

**Recommendation:** Add a leading branch to InferredValue that reads a concrete TValue off ColumnDef when one is present, e.g. `TCol extends ColumnDef<TData, infer V> ? (unknown extends V ? <fallback chain> : V) : <fallback chain>`, keeping the accessorFn/accessorKey chain as the fallback so defineColumns' narrow literals are unaffected. Guard both directions in columns/column-helpers.type-test.ts: a ColumnDef<Employee, number> must make setCellValue reject a string, and a defineColumns literal must keep its current inference exactly.

**Verifier:** Mechanism confirmed, impact story refuted.

Type-level mechanism is real. `InferredValue` (columns/column-helpers.ts:101-105) has exactly two branches — `TCol extends { accessorFn: (row: TData) => infer TValue }` and `TCol extends { accessorKey: infer K extends keyof TData }` — and no branch reading `ColumnDef`'s TValue. Both `accessorKey?` and `accessorFn?` are OPTIONAL in `ColumnDef` (types.ts:293-294), so an annotated `ColumnDef<Employee, number>` matches neither required-property branch and falls to `unknown`. `unknown` accepts anything, so `setCellValue(row, plain, "str")` type-checks. That much is correct as written.

The stated consumer impact is not. The claim says this leaves "hand-rolled toolbar/inspector code" unprotected because api-reference.mdx:107 points consumers at `AnyColumnDef` and `useDataGridVisibleColumns` returns that shape. But `AnyColumnDef = ColumnDef<unknown, unknown, any>` (store/types.ts:194) and `ColumnDefOf<TData> = ColumnDef<TData, unknown, any>` (store/types.ts:203) — TValue is ALREADY `unknown` by construction at that boundary. The recommended `TCol extends ColumnDef<TData, infer V>` branch would infer `V = unknown` for precisely those columns and change nothing for the named scenario. There is no TValue to recover where the docs send people.

The gap only bites a consumer who hand-annotates `ColumnDef<Employee, number>` — which api-reference.mdx:99-105 explicitly steers away from ("Prefer defineColumns over typing ColumnDef[] by hand"). The `defineColumns` path infers correctly, and column-helpers.type-test.ts:104-112 already pins both directions there.

Not silent data corruption in any shipped path: the store commits `unknown` deliberately (commit.ts:90-100 takes `value: unknown`, runs `runValidateSync` then `setCellValue`); runtime validation, not this static type, is the guard.

Severity high -> low: a narrow inference hole on a discouraged authoring style, worth the extra branch as hardening, not a data-corruption bug.

## Refuted claims (recorded so they are not re-found)

### prevalidatePatches validates against a row snapshot that is stale by the time the batch applies

- **Where:** registry/default/blocks/data-grid/store/commit.ts:295 · dim: core-store

**Why refuted:** REFUTED — the finder missed the `streamGeneration` guard that exists precisely to prevent this race.

MECHANISM MISSED. In `registry/default/blocks/data-grid/store/create-store.ts`, the async branch of `updateCells` takes a generation token BEFORE the hold (line 592: `const token = ++streamGeneration;`) and discards the resolved batch if the counter moved (line 600: `if (streamGeneration !== token) return;`). Both mutators of that counter increment it: `forgetDeferredRows` (line 122) and `resetDeferredRows` (line 126). Every path that could mutate the row mid-flight goes through one of them:
- `commitCellEdit` line 471 (the finder's "user edit")
- `commitCellValue` line 488 (the finder's own "checkbox toggle" example)
- `deleteSelection` 541, `applyCellUpdates` (paste/fill) 552
- `insertRow` 686, `deleteRows` 706, `duplicateRows` 727
- consumer-driven `data` replacement in `_syncProps` line 798
- any newer `updateCells` (line 592 itself, and `resetDeferredRows()` at 640)

So in the exact stated scenario — async `notes` schema in flight, a user edit or `commitCellValue` drops `total` from 100 to 50 — that write bumps `streamGeneration`, the `.then` at line 598 sees the mismatch, and the whole batch is DROPPED. `discount: 80` is never committed against `total: 50`. The claimed silent bad commit cannot occur. The doc comment at lines 113-118 states this is exactly the counter's purpose ("Bumped by every path that replaces rows or writes values outside the held batch, so a verdict that resolves against a grid that has moved on is dropped"), and `test/async-validation.browser.test.tsx:94` already covers the analogous supersession case for paste.

The claim's second half ("the value a transforming schema produced was computed from a row state that no longer holds") falls to the same guard: if the row state changed, the batch is discarded rather than applied.

RESIDUAL GAP, much narrower than claimed. The guard does not cover SELF-staleness within one batch: `prevalidatePatches` (commit.ts:290-297) snapshots `s.data[dataRowIndex]` once for all items, so a single batch containing both `{discount:80}` and `{total:50}` validates `discount` against the pre-batch `total`. No concurrent mutation is involved, so nothing bumps the generation. But this is intrinsic to batch validation semantics, not the described race, and the synchronous path has the mirror-image property — `computeCellPatchBatch` line 219 validates each patch against the ACCUMULATING `baseRow` (`entry?.row ?? s.data[dataRowIndex]`), making sync results order-dependent. Neither is obviously "correct"; calling this a bug requires first choosing which snapshot semantics a cross-field batch should have. That is a design question, low severity, not the high-severity silent-corruption bug claimed.

RECOMMENDATIONS ARE ALSO PROBLEMATIC. Option 1 (skip only schema validators, re-run the function form against current `baseRow`) would double-invoke user function validators that already ran inside `prevalidatePatches` — those are consumer callbacks with no purity guarantee. Option 2 (partition the batch, apply non-schema patches synchronously) would split one atomic `updateCells` into two `onDataChange` emissions with separate `ops` arrays, breaking the single-commit contract asserted at `test/async-validation.browser.test.tsx:175` (`expect(onDataChange).toHaveBeenCalledTimes(1)`) and relied on by undo/redo grouping.

Per the instruction to lean refuted when uncertain: the central failure scenario is provably prevented by an existing guard, so this is refuted.

### usePinShadowEdges' ResizeObserver goes stale as soon as columns are virtualized out

- **Where:** registry/default/blocks/data-grid/windowing/use-pin-shadow-edges.ts:64 · dim: rendering-perf

**Why refuted:** REFUTED. The mechanical observation is correct — the effect at registry/default/blocks/data-grid/windowing/use-pin-shadow-edges.ts:64 enumerates header cells once, and its dep array (line 68) never re-runs on a column-window shift, so entries for unmounted cells die and later-mounted cells are never observed. But the claimed FAILURE cannot occur, for two independent reasons.

1) The boundary cells never virtualize out. `buildIndices` in windowing/use-column-window.ts unconditionally pushes every pinned index into the window, outside the scroll-band loop:
   lines 65-67  `for (i…) if (pins[i] === "left") indices.push(i);`
   lines 71-73  `for (i…) if (pins[i] === "right") indices.push(i);`
   Only the middle loop (68-70) is band-limited, and it explicitly filters to `pins[i] === undefined`. The hook's own doc at line 141-145 states this contract ("Pinned columns always render… independent of scrollLeft"). So every pinned header cell is mounted at first paint and stays mounted for the life of the grid — all of them were observed at mount, and none of their ResizeObserver entries ever go dead.

2) The shadow anchor is provably invariant to every unpinned column's width, so the stale/missing entries are all for cells whose resize cannot move it. `pinLeftOffsets` (columns/pin-offsets.ts:9) accumulates only `pins[i] === "left"`, and `pinnedInsetStyle` (columns/pinned-inset-style.ts:15) is `calc(scroll-left + --grid-pin-left-{i} - --grid-track-left-{i})` — the track term, which is the only place an unpinned width enters, is subtracted out by construction. Resizing an unpinned column changes `--grid-track-left-{i}` and the grid `template`, but the pinned cell's rendered inline-start is unchanged, so its inline-end edge (what `write()` measures at line 42) is unchanged, so `--grid-pin-shadow-left-x` is correctly not re-measured. Pin-right is symmetric: pin-offsets.ts:20 accumulates only `pins[i] === "right"`, and pinned-inset-style.ts:27 depends on pinned-right widths plus `--grid-viewport-width`/`--grid-content-width`; a viewport-width change is already covered by `observer.observe(viewport)` at line 60. The finder's concrete scenario — "scroll right so early columns virtualize out, resize a column that is currently windowed" — therefore produces no drift: the resized column is unpinned (pinned ones were never virtualized out), and unpinned widths do not enter the anchor formula.

The comment at lines 61-63 that the finder quotes as the smoking gun actually names only the preceding-column case, and every column that can "precede" a pinned boundary cell in the pinned band is itself pinned, hence permanently mounted and permanently observed. The loop is doing exactly what its comment claims, for exactly the set that matters.

Residual (much narrower, not the reported bug): `setColumnPin` (store/create-store.ts:326) can pin a column at runtime. Pinning a SECOND left column keeps `hasPinnedLeft === true`, so the dep array does not change and the new boundary cell is never observed nor re-measured. That is a real but low-severity gap on a rarely-exercised path, and it is not the horizontal-virtualization failure the finding describes.

The recommendation is also weaker than the status quo: observing `[data-grid-header-layer]` (header.tsx:122) trades away the per-cell granularity for a node that is `position:absolute` inside the transformed viewport, and adding `windowedColumns` to the dep array would tear down and rebuild the entire observer set on every horizontal scroll tick that shifts the window — a per-scroll-tick cost this hook's doc (lines 19-21) explicitly designed itself to avoid. The proposed regression test would pass today against the unmodified code, since the drift it asserts does not exist. The secondary "N+1 getBoundingClientRect" cost is real but bounded by one header row and only fires on actual resize, not per scroll.

### Import dialog's async validation UI state (isValidating / disabled Import) is entirely untested

- **Where:** registry/default/blocks/data-grid-io/import-button.browser.test.tsx:25 · dim: tests

**Why refuted:** The central claim ("None of it is covered", "Zero tests exercise any of this") is factually wrong about the very file the finding cites.

import-button.browser.test.tsx:376-418 contains `describe("DataGridImportButton with an async schema (workplan #79)")` with the test "keeps the dialog open with Import disabled while validating, then imports the transformed rows". It does exactly what the finding's own recommendation asks for:
- :358-374 defines a local `asyncAgeSchema` (30ms delay) and `asyncColumns` wiring it onto the `age` column via `validate`.
- :401 uploads a CSV, :405 clicks Import.
- :408-410 asserts the held window: `expect(imported).toBeNull()` and `await expect.element(confirm).toBeDisabled()` — this is precisely the `isValidating` state at import-dialog.tsx:115 driving `disabled={... || isValidating}` at :271. If `setIsValidating` were dropped or the Promise branch reordered (the finding's stated failure scenario), this assertion fails.
- :412-417 asserts `onImport` fires once after resolution with the transformed values (Alice 30→60, Bob −5 rejected→null).

So recommendation items (a) and (b) are already implemented. The test was added in the same commit that introduced the async path (96544c6, "feat(validation): async Standard Schema on bulk paths - paste, fill, import, streaming (#79)"), so the finding appears to have read import-dialog.tsx and stopped scanning the test file at the first describe block (it cites line 25).

Residual, much smaller: recommendation (c) — double-click producing exactly one `onImport` — and the reset-during-validation path are not directly tested. Note the finding's speculation that "a dialog reset path that does not bump [the token]" could import stale rows is also wrong for the code as written: the close effect at import-dialog.tsx:71-76 does `confirmTokenRef.current += 1` plus `setIsValidating(false)` and `reset()`, so a stale resolution hits the `!== token` early return at :117.

Correct scope: at most a low-severity "add two more guard cases", not the claimed M-effort untested-surface gap.

## Medium/low findings (65) — VERIFIED 2026-08-20 (workplan #99)

All 65 re-verified by a 7-lane adversarial fleet against HEAD 8f4847e, each lane prompted to
refute and to default to REFUTED under uncertainty. Outcome: **19 confirmed, 4 feature gaps,
42 dismissed** (24 refuted, 10 wontfix, 5 already-fixed, 3 corrected-then-confirmed).

Per-lead evidence lives in the lane reports (see "Lane reports" below). The `Verdict` column is
authoritative; the `Finding` text is the ORIGINAL lead wording, some of which the verification
corrected — read the lane report before acting on any row.

Recurring theme: **the composite-key colon bug has now surfaced at four sites.** #85 fixed
`pruneCellErrors`, #88 added `cellErrorKey`, but `useDataGridRowHasError` still prefix-matches and
`cellErrorKey` is not exported for consumers. Fixing a bug at one site did not fix its class.

Dismissal patterns worth remembering:
- Every rendering-perf lead named a real allocation, then ASSUMED its frequency. Measurement
  killed all 8: the body renders on 1% of scroll ticks, rows/cells are already memoized.
- Two leads proposed fixes that were REGRESSIONS: decorating 100k sort keys (5ms to save 0.17ms),
  and routing export through `getCellValue` (which throws where export returns `""`).
- Cross-add-on deduplication is WONTFIX by policy: no add-on depends on another anywhere in
  `registry.json`, so a shared helper would create the first add-on->add-on edge.

| Verdict | Sev | Kind | Effort | Dim | Finding | Where |
| --- | --- | --- | --- | --- | --- | --- |
| CONFIRMED | medium | bug-risk | S | core-store | useDataGridRowHasError uses a prefix match that reports false positives across rowIds | registry/default/blocks/data-grid/store/hooks.ts:194 |
| WONTFIX | medium | perf | M | core-store | isBulkBatchCurrent rebuilds the full rowId set on every resolved async batch, O(n) at 100k rows | registry/default/blocks/data-grid/validation/bulk-generation.ts:53 |
| WONTFIX | medium | structure | M | core-store | computeCellPatchBatch and computeRowEditsBatch duplicate the entire row-accumulation and op-building algorithm | registry/default/blocks/data-grid/store/commit.ts:141 |
| **CONFIRMED** | medium | bug-risk | M | core-store | applyCellUpdates and deleteSelection never reconcile the view or search matches after writing values | registry/default/blocks/data-grid/store/create-store.ts:546 |
| REFUTED | medium | perf | S | rendering-perf | useScrolledEdges performs 4 unconditional DOM attribute mutations per scroll tick | registry/default/blocks/data-grid/windowing/use-scrolled-edges.ts:40 |
| REFUTED | medium | perf | S | rendering-perf | DataGridMarkerCell is unmemoized and allocates two closures per row per render | registry/default/blocks/data-grid/rows/marker-cell.tsx:51 |
| REFUTED | medium | perf | M | rendering-perf | DataGridHeaderCell is unmemoized and receives two fresh object literals per render | registry/default/blocks/data-grid/header.tsx:133 |
| REFUTED | medium | perf | M | rendering-perf | DataGridOverlays allocates every rect array on each render with no memoization | registry/default/blocks/data-grid/overlays.tsx:204 |
| REFUTED | medium | perf | M | rendering-perf | computeWindow runs twice per scroll tick — the render-phase useMemo repeats the listener's work | registry/default/blocks/data-grid/windowing/use-row-window.ts:178 |
| REFUTED | medium | perf | S | rendering-perf | cumulativeRights allocates a full-length array on every horizontal scroll tick | registry/default/blocks/data-grid/windowing/use-column-window.ts:105 |
| REFUTED* | medium | bug-risk | S | rendering-perf | useElementDimensions mutates a ref during render, breaking concurrent-render safety | registry/default/blocks/data-grid/windowing/use-scroll-snapshot.ts:276 |
| REFUTED | medium | perf | S | rendering-perf | body.tsx's gridRowStart layout effect runs unconditionally on every body render | registry/default/blocks/data-grid/body.tsx:170 |
| REFUTED | medium | perf | S | data-pipeline | `updateViewIndex` calls `accessor.getText` O(k log n) times during binary search instead of decorating keys once | registry/default/blocks/data-grid/sort-filter/incremental-view-index.ts:33 |
| REFUTED | medium | perf | S | data-pipeline | AND-filter chain re-scans and reallocates the index array once per filter | registry/default/blocks/data-grid/sort-filter/build-view-index.ts:55 |
| REFUTED | medium | perf | M | data-pipeline | Search re-scans all rows x all visible columns on every keystroke and every streaming tick | registry/default/blocks/data-grid/store/compute.ts:312 |
| CONFIRMED | medium | perf | S | data-pipeline | `parseClipboardText` builds every field by single-character string concatenation | registry/default/blocks/data-grid/clipboard/parse-clipboard.ts:46 |
| REFUTED | medium | perf | S | data-pipeline | `quoteCsvField` runs a fresh `includes` + regex test per exported cell with no fast path | registry/default/blocks/data-grid-io/export-grid.ts:25 |
| REFUTED | medium | bug-risk | M | data-pipeline | Search and view-index scan only visible columns, so hiding a column silently changes which rows/cells match | registry/default/blocks/data-grid/store/compute.ts:329 |
| REFUTED | medium | bug-risk | S | data-pipeline | Numeric filter bounds accept `Infinity` and hex, and blank-vs-zero coercion differs from the empty check | registry/default/blocks/data-grid/sort-filter/matches-filter.ts:4 |
| CONFIRMED | medium | perf | M | data-pipeline | Import validates every cell of the file at once with no row cap and no cancellation | registry/default/blocks/data-grid-io/build-imported-rows.ts:42 |
| CONFIRMED | medium | bug-risk | S | addons | Context-menu shortcut hints are read from DEFAULT_KEYMAP, ignoring the consumer's keymap prop | registry/default/blocks/data-grid-context-menu/cell-menu-content.tsx:95 |
| REFUTED | medium | perf | S | addons | selectedViewRows materializes every selected row index on every context-menu render | registry/default/blocks/data-grid-context-menu/selection-queries.ts:22 |
| REFUTED | medium | quality | S | addons | buildExportRows reimplements accessor resolution instead of using core's getCellValue | registry/default/blocks/data-grid-io/export-grid.ts:47 |
| CONFIRMED | medium | bug-risk | S | addons | downloadBlob revokes the object URL synchronously after click, racing the download in Firefox/Safari | registry/default/blocks/data-grid-io/export-grid.ts:68 |
| WONTFIX+ | medium | quality | S | addons | isMac / displaySegment duplicated verbatim across two add-ons, and diverges from core's platform detection | registry/default/blocks/data-grid-keybindings/binding-label.tsx:5 |
| REFUTED | medium | feature | M | addons | No add-on surfaces the cellErrors API despite core shipping it in #80 | registry/default/blocks/data-grid-context-menu/cell-menu-content.tsx:1 |
| REFUTED | medium | bug-risk | S | addons | DataGridKeybindingsShortcut's listener is keyed on the ref object, not the element, and drops on every edit | registry/default/blocks/data-grid-keybindings/keybindings-shortcut.tsx:37 |
| REFUTED | medium | quality | S | architecture | xlsx is a hard dependency despite being dynamically imported on both code paths | registry.json:1 |
| WONTFIX | medium | structure | M | architecture | use-grid-interaction.ts mixes pure coordinate geometry with a 530-line hook in one 908-line file | registry/default/blocks/data-grid/interaction/use-grid-interaction.ts:379 |
| REFUTED | medium | bug-risk | S | architecture | add-registry-targets.mjs silently skips file entries its line regex fails to match | scripts/add-registry-targets.mjs:48 |
| WONTFIX | medium | dx | L | api-dx | updateCells / updateRows / setCellErrors accept any column id and any value with no type checking | registry/default/blocks/data-grid/store/types.ts:220 |
| REFUTED | medium | dx | S | api-dx | useDataGridPinnedRows is the only add-on hook not generic over TData | registry/default/blocks/data-grid-pinned-rows/use-data-grid-pinned-rows.tsx:8 |
| CONFIRMED | medium | dx | S | api-dx | getRowId has two different arities across core and add-ons | registry/default/blocks/data-grid-history/use-data-grid-state.ts:9 |
| REFUTED | medium | dx | S | api-dx | useDataGridUrlPagination's result cannot spread into useDataGridPagination without also supplying total | registry/default/blocks/data-grid-url-state/use-data-grid-url-pagination.ts:19 |
| WONTFIX | medium | dx | M | api-dx | Two hooks named useDataGridUrl* have opposite shapes: one imperative void, one controlled-pair | registry/default/blocks/data-grid-url-state/use-data-grid-url-state.ts:34 |
| CONFIRMED | medium | dx | S | api-dx | cellErrors' string-concatenated key is public API with no exported helper to build it | registry/default/blocks/data-grid/store/types.ts:335 |
| CONFIRMED~ | medium | dx | S | api-dx | Six store hooks are reachable from the store barrel but absent from the public entry point, with no marker distinguishing intent | registry/default/blocks/data-grid/store/index.ts:24 |
| CONFIRMED | medium | test | S | tests | URL pagination hook and the pagination hook are never tested composed, leaving the deep-link overflow case uncovered | registry/default/blocks/data-grid-url-state/use-data-grid-url-pagination.test.tsx:46 |
| CONFIRMED | medium | test | S | tests | Streaming perf tests silently degrade to no-ops when performance.memory is unavailable | registry/default/blocks/data-grid/test/streaming.browser.test.tsx:243 |
| CONFIRMED | medium | test | M | tests | Sub-second sleeps used as synchronization in browser tests are load-sensitive flake sources | registry/default/blocks/data-grid/test/rtl.browser.test.tsx:76 |
| CONFIRMED | medium | quality | M | tests | Grid mount + store-api harness is copy-pasted across browser test files instead of living in a shared helper | registry/default/blocks/data-grid/test/streaming.browser.test.tsx:66 |
| REFUTED | medium | test | M | tests | cellErrors auto-clear matrix is tested only in jsdom; no browser test proves an error is actually painted or cleared on screen | registry/default/blocks/data-grid/store/cell-errors.test.tsx:216 |
| CONFIRMED~ | medium | test | S | tests | The dev-assertion valve for incremental view maintenance is tested at rate 1 but its production sampling path never runs in tests | registry/default/blocks/data-grid/store/update-cells.test.tsx:535 |
| WONTFIX | medium | test | M | tests | Coverage gate excludes all .tsx files, so the newest store logic is structurally outside the enforced bar | vitest.config.ts:19 |
| GAP | medium | feature | S | features | `onSelectionChange` exposes cell values but no rows or rowIds — the bulk-action story requires hand-rolled index mapping | registry/default/blocks/data-grid/store/types.ts:172 |
| GAP | medium | feature | S | features | Export scope has no 'selection' option — 'export what I highlighted' is unreachable through the io add-on | registry/default/blocks/data-grid-io/export-grid.ts:41 |
| GAP | medium | feature | M | features | No multi-value filter operator (`isAnyOf`) even though select columns already declare their choices | registry/default/blocks/data-grid/types.ts:365 |
| GAP~ | medium | feature | M | features | Cross-field (row-level) validation has no seam — `validate` only ever sees one cell | registry/default/blocks/data-grid/validation/validate-cell.ts:4 |
| REFUTED | medium | perf | S | features | `useDataGridViewIndex()` shallow-compares the whole viewIndex array on every store change | registry/default/blocks/data-grid/store/hooks.ts:201 |
| REFUTED | low | quality | S | core-store | resolveEditTarget resolves a cellType that computeCommit never uses, on every single commit | registry/default/blocks/data-grid/store/commit.ts:130 |
| CONFIRMED | low | docs | S | core-store | insertRow and duplicateRows do not prune cellErrors, contradicting the documented contract in two places | registry/default/blocks/data-grid/store/create-store.ts:671 |
| WONTFIX | low | perf | S | core-store | The async updateCells path builds the columns-by-id Map three times per batch | registry/default/blocks/data-grid/store/commit.ts:268 |
| REFUTED | low | quality | S | core-store | clearCellErrors(undefined) resets to the shared empty map even when a target-specific clear was intended | registry/default/blocks/data-grid/store/create-store.ts:504 |
| ALREADY-FIXED | low | perf | S | rendering-perf | Cell error lookup rebuilds row-id strings per row per render even for the common no-error path | registry/default/blocks/data-grid/store/hooks.ts:449 |
| ALREADY-FIXED | low | bug-risk | S | data-pipeline | `pruneCellErrors` rebuilds a Set of every row id and mis-splits ids containing a colon | registry/default/blocks/data-grid/store/compute.ts:79 |
| CONFIRMED~ | low | quality | S | data-pipeline | Excel import loads the whole workbook into memory and silently discards every sheet but the first | registry/default/blocks/data-grid-io/parse-import-file.ts:37 |
| WONTFIX | low | structure | S | addons | Presence and fill overlays duplicate the pin-zone segmentation preamble verbatim | registry/default/blocks/data-grid-presence/presence-overlay.tsx:85 |
| CONFIRMED | low | perf | S | addons | useDataGridState hands DataGrid a fresh getRowId every render, re-running _syncProps each time | registry/default/blocks/data-grid-history/use-data-grid-state.ts:48 |
| REFUTED | low | bug-risk | S | addons | useDataGridLazyRows resets three pieces of state during render on totalCount change | registry/default/blocks/data-grid-lazy/use-data-grid-lazy-rows.ts:88 |
| WONTFIX | low | bug-risk | M | addons | useDataGridUrlState applies URL params exactly once and never reacts to browser back/forward | registry/default/blocks/data-grid-url-state/use-data-grid-url-state.ts:70 |
| REFUTED | low | quality | S | architecture | registry.json duplicates the ui-primitive registryDependencies of items it already depends on | registry.json:1 |
| ALREADY-FIXED | low | dx | S | api-dx | defineColumns' curried two-call form is unusual enough to need justification consumers can find | registry/default/blocks/data-grid/columns/column-helpers.ts:62 |
| ALREADY-FIXED | low | dx | S | api-dx | GridCellTypes augmentation targets a hardcoded module path that most installs will not match | registry/default/blocks/data-grid/types.ts:420 |
| CONFIRMED | low | test | S | tests | updateCells async-validation tests depend on a fixed three-microtask drain that will break under concurrency changes | registry/default/blocks/data-grid/store/update-cells.test.tsx:267 |
| CONFIRMED | low | test | M | tests | Registry payloads are rebuilt by a script with no test asserting the built output matches the source blocks | package.json:10 |

Legend: `CONFIRMED~` = confirmed but the lead's framing was corrected (read the lane report).
`REFUTED*` = refuted on consequence, not on code — re-open if the stated precondition changes.
`WONTFIX+` = declined as stated, but carries a narrow confirmed sub-finding.
`GAP` = feature gap, not a defect; needs a product decision before any code.

### Lane reports (full per-lead evidence, 2026-08-20)

Seven read-only lanes, ~2,900 lines of evidence with measurements and reproductions. Written to
the session scratchpad, NOT tracked in git (they contain machine paths):
`<scratchpad>/verify/{core-store,rendering-perf,data-pipeline,addons,arch-apidx,tests,features}.md`

Carry-forward notes that would otherwise be lost in a REFUTED row:
- **rendering-perf lead 7** (`useElementDimensions` writes a ref during render) is a real
  rules-of-hooks violation, refuted only because nothing in the repo uses concurrent features.
  Re-open FIRST if `useTransition`/`useDeferredValue` is ever wrapped around the grid.
- **addons lead 5**: both add-ons read the deprecated `navigator.platform` while core probes
  `userAgentData` first. Display-only and latent, but it means labels can render "Ctrl" while
  core routes `mod` to Cmd. Folded into the add-ons fix lane.
- **addons lead 11** (URL state ignores back/forward) is settled behavior but is NOT in
  `2026-08-01-not-supported-register.md`. Add a row there.

Original finding bodies live in the workflow journals (session transcript dir, runs
wf_95a90b52-204 and wf_4b47af94-505).
