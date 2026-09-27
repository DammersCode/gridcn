# Plan 016 — 2026-09-27 improve-audit follow-ups

Source: `research/improve-audit-2026-09-27.md` (26 findings), re-verified at `b36ae5a` by five
independent verifier agents, plus two fresh scans (add-on bugs, docs-vs-code drift) that
added 17 findings. A second round under the decision rule below added a security review (6), an extensibility/API review (12), and a competitor feature-gap scan (12); spot checks confirmed every security finding and the API review's doc errors. Spot checks by the planning session confirmed NEW-1/2/3/6 and DOC-01/03/04.

Decision rule (maintainer, 2026-09-27): take the recommended option; the repo must be secure, performant, and feature-rich/extensible; breaking changes are welcome — record them with the **Breaking** CHANGELOG marker, no compatibility shims.

Order rule: **easiest first**. Waves run in order; items inside a wave are independent and
can ship as separate small commits or PRs. Every item keeps the AGENTS.md gates and gets a
CHANGELOG entry only when it changes registry behavior, props, or API.

Legend — Effort: XS (<30 min), S (<2 h), M (half day+), L (spec + multi-day).
Risk = what can break when the change lands.

## Verdict summary (what the audit got wrong)

| ID | Audit claim | Verified verdict |
|----|-------------|------------------|
| PERF-01 | re-render cost | CONFIRMED, worse: kills the controlled-data echo fast path on every `updateCells` tick |
| PERF-03 | wasted per-frame `set` | CONFIRMED, worse: `onSelectionChange` fires at 60 fps on a stationary drag |
| PERF-06 | leak | CONFIRMED; documented as harmless but a reused rowId wipes consumer errors; fix in W3-08 |
| BUG-01 | fix via `Date.parse` | Fix sketch WRONG: V8 accepts `2026-02-30`. Use a UTC round-trip probe |
| BUG-02 | stale preview overwrite | PARTIAL: only `isParsing` reset + `setDelimiter` gaps are real |
| BUG-05 | fix via result check | Fix sketch has no effect: `writeToClipboard` never reports failure; real fix in W3-02 |
| API-02 | io unusable uncontrolled | PARTIAL: overstated, the documented path is controlled `data`; hand-built ops remain |
| API-04 | Excel parity | Excel has no arrow stepping; the no-op option itself is confirmed |
| API-06 | context menu users blocked | PARTIAL: `DataGridContextMenu` needs composition anyway; forwarded plus drift guard in W3-07 |
| ARCH-01 | 22 stale gates | CONFIRMED, worse: gates never enforced since the initial commit; `*-index.ts` exclude hides the view pipeline |
| ARCH-03 | 6 items | PARTIAL: `lucide-react` gap in 5 items is real; `@base-ui/react` is moot |
| ARCH-04 | shared drag primitive | DROP the primitive; add the missing guards per site (folds into W2-09) |
| ARCH-05 | import `isMacPlatform` from core barrel | Premise WRONG: not on the barrel. Becomes a documented public shortcut-label API instead (W2-11) |
| ARCH-07 | HIGH value | LOW: blob stays in history; clutter removal only |
| ARCH-09 | split store | Only the data-write cluster, as prerequisite W5-07 |

---

## Wave 1 — docs, config, metadata (no runtime code)

| # | ID | Change | Effort | Risk |
|---|----|--------|--------|------|
| W1-01 | ARCH-07 | `git rm` the tracked scratch PNG at the repo root | XS | LOW |
| W1-02 | ARCH-06 | Add `pnpm types:check:ts5` to `ci.yml` after Typecheck; list it in `CONTRIBUTING.md:21-24` | XS | LOW |
| W1-03 | DOC-01 | `useState<readonly Row[]>` in `quick-start.mdx:118`, `addons/undo-redo.mdx:72`, `editing-cell-types.mdx:285`, `examples/validation/server-errors.mdx:20` (snippets fail to type-check today) | XS | LOW |
| W1-04 | DOC-02 + API-05 | Add `move` op and `"app"` source to `events-state.mdx:52-67` and `api-reference.mdx:190`; add `case "move"` to `recipes.mdx:47-63`; replace the hand-rolled `applyOpsLocally` (`recipes.mdx:181,204-207`) with `applyChange(rows ?? [], change, getRowId)`; add a short "Op engine" section (snapshot indices, missing-id skip, `invertChange`) to `api-reference.mdx` | S | LOW |
| W1-05 | DOC-04 | README: fill handle is the `data-grid-fill` add-on, not core (`README.md:13`); drop the "value plus `on*Change`" claim for selection/column state (`README.md:57-58`) | XS | LOW |
| W1-06 | DOC-05 | `addons/undo-redo.mdx:161`: `setData: (next) => lazy.onDataChange(next, { ops: [], source: "history" })` | XS | LOW |
| W1-07 | DOC-06 | `addons/pinned-rows.mdx:78`: annotate `TOTALS_SPECS: AggregateSpecs` | XS | LOW |
| W1-08 | DOC-07 | `CHANGELOG.md:107-109`: props live on `DataGridRoot`/`DataGrid`, not the provider; document the 150px default width and 32px resize floor in `columns.mdx` + `ColumnDef.width` JSDoc | S | LOW |
| W1-09 | DOC-08 | Add `"app"` to the `recordSources` list in `streaming-updates.mdx:149` and the JSDoc at `use-data-grid-history.ts:25` | XS | LOW |
| W1-10 | DOC-09 | `examples/appearance/i18n-rtl.mdx:64`: move `direction` to `<DataGridRoot>` | XS | LOW |
| W1-11 | DOC-10 | `addons/url-state.mdx:89-90`: snippet with a child component calling `useDataGridUrlState({ prefix })` and wiring `applyFromUrl` to `popstate` | S | LOW |
| W1-12 | ARCH-03 | Declare bare `lucide-react` on `data-grid`, `data-grid-toolbar`, `data-grid-context-menu`, `data-grid-pagination`, `data-grid-sort-list`; fix the "exactly one npm dependency" line in `installation.mdx`. Registry payload change: run `registry:build`, EOL normalize, `test:e2e-install` | S | LOW |
| W1-13 | API-R docs | Correct docs that state wrong facts: `CellCoord` is view space, not data space (`types.ts:83`, `api-reference.mdx:188`); remove the "no separate `onActiveCellChange`" claim (`events-state.mdx:102-103`: `setActiveCell` and Alt+Arrow change only `activeCell`); fix `PLAN.md:79` (per-cell-type validation) and `PLAN.md:170` (every part accepts `className`) | XS | LOW |

Gate for docs-only items: `pnpm build`. W1-12 changes payloads — full pre-push list.

## Wave 2 — small isolated code and security fixes (S, LOW risk, one test each)

| # | ID | Change | Effort | Risk |
|---|----|--------|--------|------|
| W2-01 | NEW-6 | Selects show raw values: pass a label children function to `<SelectValue>` at `data-grid-pagination/pagination-footer.tsx:105`, `data-grid-toolbar/filter-value-input.tsx:209,224` (pattern: `sort-list.tsx:294`) | S | LOW |
| W2-02 | NEW-2 | Async validator throw/reject leaves the editor stuck: try/catch around `validate()` and a rejection handler in `interaction/use-async-validate.ts:46-67` → `setPending(false)` + `setEditingError` (pattern: `validate-batch.ts:47-55`) | S | LOW |
| W2-03 | NEW-3 | `useDataGridUrlPagination({ total })` wipes `?page=` while data loads: skip normalize/clamp until `total > 0` (`use-data-grid-url-pagination.ts:67-80`); same guard in `use-data-grid-pagination.ts:146-157` | S | LOW |
| W2-04 | BUG-01 | Calendar-invalid ISO dates commit (`cell-types/date.tsx:17`): validate with a UTC probe (`setUTCFullYear(y, m-1, d)` round-trip; not `Date.parse`, not `new Date(y,…)`). Test: `02-30`, `13-45`, `2026-02-29` → null; `2024-02-29` ok | S | LOW |
| W2-05 | BUG-03 | Search badge shows "6 of 3" for a frame (`data-grid-toolbar/search.tsx:86-88`): reset the index during render when `matches` identity changes, not in an effect | S | LOW |
| W2-06 | NEW-5 | Sort-list row loses focus on column change: key rows by index or a stable local id (`sort-list.tsx:198`; pattern `filter-menu.tsx:236`) | S | LOW |
| W2-07 | DOC-03 | Backspace/Delete on a sort/filter row is documented but missing: add the handler (`sort-list.tsx:262`, `filter-menu.tsx:311`) calling `onRemove(index)` | S | LOW |
| W2-08 | BUG-02 | Import: `finally` clears `isParsing` only when `parseControllerRef.current === controller` (`use-data-grid-import.ts:146`); `setDelimiter` copies the `setSheetName` pattern (generation guard, `isParsing`, `setError` instead of rethrow) | S | LOW |
| W2-09 | BUG-04 + ARCH-04 | Drag listener leaks: `if (pendingRef.current) return;` at the top of pointerdown in `use-column-reorder.ts` and `use-row-reorder.ts`; `use-column-resize.ts` gets a cleanup ref + unmount teardown + ignore a second pointer while `dragRef` is set | S | LOW |
| W2-10 | ARCH-08 | Duplicate-column-id warning fires 3+ times: dedup in the provider with a per-instance `Set` (pattern `warnedColumnTypes`, `commit.ts:23-37`); drop the duplicate check from `defineColumns` (`column-helpers.ts:72-82`) | S | LOW |
| W2-11 | ARCH-05 | One public shortcut-label API: export `isMacPlatform` and a `formatShortcut` token formatter from the core barrel and document them on the keybindings page (consumers render labels that match the grid); both add-on copies import it and are deleted; one Mac regex; Shift renders `⇧` on Mac everywhere. Tests: Mac+Shift label, iPhone/iPad platform | S | LOW |
| W2-12 | PERF-01 | `withFilterIds` returns its input when every filter has an id (`compute.ts:163-165`); `_syncProps` reuses `s.filterState` when `props.filterState` is the same reference (mirror `lastPropsColumns`). Test: stable controlled filter + echo keeps `viewIndex` identity (`update-cells.test.tsx:828` block) | S | LOW |
| W2-13 | PERF-02 | `selectLine` (`select-line-options.ts:33-42`): compute `last` before materializing; narrow with `instanceof CompactSelection`; keep `fromArray(toArray())` only as fallback | S | LOW |
| W2-14 | SEC-05 | URL `pageSize` unbounded when `pageSizeOptions` is omitted (`?pageSize=100000000`): pass `resolvedPageSizeOptions` to both `parsePageSize` calls (`use-data-grid-url-pagination.ts:66,76`); cap `parsePage` | XS | LOW |
| W2-15 | SEC-03 | ReDoS in fill series detection: `PREFIX_NUMBER_RE = /^(.*?)(\d+)(\D*)$/` (`data-grid-fill/detect-series.ts:8`) is quadratic (20k chars = 317 ms, 200k ≈ 32 s). Replace with a linear scan for the last digit run | S | LOW |
| W2-16 | SEC-06 | URL `filter`/`sort` segment count unbounded (`filter-param.ts:118`, `sort-param.ts:190`): cap filters (64), dedupe sorts by column, cap `isAnyOf` list length | S | LOW |
| W2-17 | SEC-04 | Pasted HTML: `data-gridcn-raw` overrides the visible cell text (`parse-clipboard.ts:5-6`); trust it only when it matches the node text | S | LOW |
| W2-18 | SEC-01 | CSV/formula injection: `quoteCsvField` (`export-grid.ts:36-40`) never neutralizes leading `= + - @ \t \r`. New `sanitizeFormulas` export option, **default on** (prefix `'`, plain numbers exempt); same opt-in for clipboard text. **Breaking** for CSV round-trips. XLSX export is safe (string cells) | S | LOW |
| W2-19 | SEC-02 | Import DoS: a 16 KB XLSX with a forged `<dimension>` builds 100M cells (33 s, 1.56 GB). Add `maxFileBytes`/`maxRows`/`maxColumns` (defaults 50 MB / 1M / 1,000), `sheetRows` + clamped `range` for SheetJS, size check before `arrayBuffer()`/`text()`, Dropzone `maxSize`, clear error | S-M | LOW |

## Wave 3 — decided changes that need care (S–M)

| # | ID | Change | Effort | Risk |
|---|----|--------|--------|------|
| W3-01 | ARCH-02 | Replace `xlsx@0.18.5` (2 HIGH advisories) with `@e965/xlsx@0.20.3` in `package.json`, `registry.json` (`data-grid-io` deps) and the two dynamic imports (`parse-import-file.ts:50`, `export-grid.ts:125`); name the mirror and its provenance in the io docs dependency table. Gate: `pnpm audit --prod` shows no HIGH, `registry:build`, `test:e2e-install`. Evidence below | S | LOW |
| W3-02 | BUG-05 | Safe context-menu Cut (**Breaking**): `execCommandCopyFallback` returns `execCommand`'s boolean; `writeToClipboard` returns `"failed"` when both paths fail; `cut()` awaits the write and deletes only on success and only if the selection is unchanged. Return type becomes `"ok" \| "fallback" \| "failed" \| "no-selection"`. Test: write rejects + `execCommand` false → `"failed"`, no `onDataChange` | S | LOW |
| W3-03 | API-04 | `number.options.step`: implement ArrowUp/ArrowDown stepping in `NumberEditor` (`step ?? 1`, `clampNumber`, `roundToDecimals`, `preventDefault`); drop the stale `@reserved` comment; docs line `editing-cell-types.mdx:57`. Browser test: step, clamp at min/max, decimals | S | LOW |
| W3-04 | PERF-03 | Selection bail-out: `extendTo`/`extendSelection` return `s` on an equal range; `selectRow`/`selectColumn` skip `set` when channel `.equals()`, other channel same ref, `lastHighlighted*` and `activeCell` unchanged. `onSelectionChange` fires only on real changes (CHANGELOG). Test: repeated `extendTo(sameCoord)` fires nothing | S | LOW-MED |
| W3-05 | NEW-4 | Two grids on a page: Ctrl/Cmd+F focuses the wrong search (`search.tsx:53-56,98-116`). Scope the check to this grid's own root/toolbar via a per-provider id | S-M | LOW |
| W3-06 | NEW-7 | Lazy rows: `onDataChange` replaces the whole array and can drop a just-landed fetch (`use-data-grid-lazy-rows.ts:283-286`) → functional merge `setRows(prev => …)`; check row ops that change length | S | LOW-MED |
| W3-07 | API-06 | Forward `renderHeaderMenu` on `DataGrid` and add an `Exclude<keyof DataGridRootProps, keyof DataGridProps>` drift guard in `data-grid.type-test.ts` so the wrapper never falls behind again | S | LOW |
| W3-08 | PERF-06 | Prune `rowValidationKeys` after each `pruneCellErrors` (one helper, six sites); fixes the reused-rowId edge case that wipes a consumer's `setCellErrors` entry | S | LOW |
| W3-09 | ARCH-01 | Coverage gates: delete the `registry/**/*-index.ts` exclude; remap the 22 stale `perFile` keys (mapping below); drop keys with no equivalent; throw in `vitest.config.ts` when a threshold key matches no file; add branch tests for `detect-series.ts` (88.9%), `column-format-helpers.ts` (87.5%), `key-syntax.ts` (89.3%) and the view-index files | M | LOW (gate red until tests land) |
| W3-10 | PERF-05 | CI fan-out: parallel jobs (checks, unit, browser, unit-compiled, browser-compiled, build+registry). Keep a job named `ci` as aggregator (`needs:` all, `if: always()`, fail on any non-success) because ruleset 23674840 requires the `ci` check; author gate on every job. ~12 min → ~4 min | S | MED (misconfigured aggregator passes on skip) |

## Wave 4 — invasive fixes (M, MED risk)

| # | ID | Change | Effort | Risk |
|---|----|--------|--------|------|
| W4-01 | NEW-1 | Editor bound to its row: store `rowId`/`columnId` in `editing`, remap `coord` wherever `viewIndex`/`visibleColumns` rebuild (`_syncProps`, `setSorts`, `setFilters`, `setJoinOperator`); when the row leaves the view, cancel the edit (the typed value is discarded, never written into a hidden row); a pending async validation drops its result | M | MED |
| W4-02 | PERF-04 | Store `rowIdentityVersion` bumped at every `rowIndexCache.invalidate()` site (`create-store.ts:899,933,962,1020,1092`); `useDataGridRowIdToViewRow` keys on it instead of `data`. Test: an `updateCells` tick keeps the Map identity | M | MED (missed bump = presence on wrong rows) |

## Wave 5 — API foundation (breaking welcome, spec first where marked)

Source: extensibility review 2026-09-27 (API-R1…R12). Ordered by dependency; W5-01…W5-06 are independent of each other.

| # | ID | Change | Effort | Risk | Spec |
|---|----|--------|--------|------|------|
| W5-01 | API-R9 | Composition parts take props: `DataGridHeader({ className, renderCell(ctx, Default) })`, `DataGridBody({ className })` (`header.tsx:30`, `body.tsx:46` take none today); `emptyState` accepts `(ctx: { reason: "no-data" \| "filtered" }) => ReactNode`; new `loadingState` slot (`root.tsx:516-530`) | S-M | LOW | no |
| W5-02 | API-R12 | Split the core barrel: `data-grid.tsx` = consumer API; `data-grid-sdk.ts` = add-on internals (`pointerToCoord`, direction math, root context, bulk validation, `GRID_LAYER`, `isDev`). Add typed `useDataGridSelector<T>(fn, eq?)` and a typed `useDataGridRow` | M | LOW | no |
| W5-03 | API-R4 | Custom cell types: `defineCellType(key, type)`; `CellRenderProps`/`CellEditorProps` get typed `options`; `useCellEditor(props, codec)` owns seed focus, commit guard, rejection re-arm, Enter/Escape/blur; `cellTypes` merges over the built-ins (`null` removes one) instead of replacing (`store/types.ts:62-67`) | M | LOW | no |
| W5-04 | API-R10 | Menus as data: `getCellMenuItems(ctx, defaults)` / `getHeaderMenuItems(ctx, defaults)` returning `MenuItemSpec[]`, honored by the context menu and `DataGridHeaderDropdown`; replaces `render*MenuItems` (whole-set only today) | M | LOW | no |
| W5-05 | API-R6 | Events: `onActiveCellChange`, `onEditStart` (return `false` vetoes), `onEditEnd` (`commit`/`cancel`/`rejected`), `onValidationError` for bulk paste/fill rejections, `onCellDoubleClick`, `onCellContextMenu` | M | LOW | yes (firing order around async validate) |
| W5-06 | API-R3 | Behavior driven by the `CellType`, not the type name: `numeric`, `toSearchText`, `validate`, `activate` (checkbox toggle), `filter: { operators, match, ValueInput }`; built-ins declare them; resolution column → cell type → built-in. Removes the hardcoded switches (`cell.tsx:139`, `use-grid-interaction.ts:375-387`, `operators-for-column-type.ts:25-30`, `filter-value-input.tsx:163-190`) | M-L | MED | yes |
| W5-07 | ARCH-09 | Prerequisite for W5-08+: extract the data-write action cluster of `create-store.ts` into its own module; shared `let` state lives in a mutable context box (never by value). Behavior-preserving; `store.test.tsx`, `commit-perf.test.ts`, `delete-perf.test.ts` green | M | MED | no |
| W5-08 | API-R2 | `CellRef = { rowId, columnId }` as the public coordinate: actions (`selectCell`, `startEditing`, `scrollTo`) take refs, positional variants get an `*At` suffix; every ctx (render, click, className, marker, menu) carries `rowId` + `columnId` and one name `viewRowIndex`; `CellCoord` renamed `ViewCoord` and documented as view space | L | MED-HIGH | yes |
| W5-09 | API-R1 | Imperative handle: `<DataGrid ref>` + `useDataGridApi()` → `scrollTo`, `focus`, `startEditing`, `stopEditing`, `getSelection`, `setSelection`, `getRow`, `getViewRowIds`, `actions`, `store`. Replaces store lifting with duplicated props | M | LOW-MED | yes (short) |
| W5-10 | API-R8 | Custom commands: `commands?: Record<string, GridCommand>` (`run(api)`, `when`, `label`, `group`); `keymap` accepts custom command names; `GridAction` becomes an interface-mergeable registry like `GridCellTypes`; the keybindings dialog lists custom commands | M | LOW-MED | yes |
| W5-11 | API-R7 | Controlled selection and layout: `selection`/`defaultSelection`/`onSelectionChange(next: SelectionState)` in `CellRef` terms; controlled `columnLayout` (`defaultColumnLayout` stays the seed); drop `onSelectionCleared`. Absorbs the `setColumnLayout` action. W3-04 bail-outs must hold on the drag path | L | MED | yes |
| W5-12 | API-R11 | One config home: every behavior prop (`readOnly`, `keymap`, render slots, events) is a sync prop; `DataGridRoot` keeps only DOM/layout props; `DataGridProps = DataGridSyncProps & DataGridRootProps` by spread (no ~60 hand-forwarded props, W3-07's guard becomes structural) | M | MED | yes (short) |
| W5-13 | API-R5 | Plugin system: `plugins={[fill, history, pinnedRows]}` with `DataGridPlugin = { name, overlay?, rowBands?, onDataChange?, commands?, keymap?, Mount? }`; bands concatenate; replaces the per-add-on wiring and `_register*` actions; third parties can write add-ons | L | MED | yes |

## Wave 6 — features

Source: competitor gap scan 2026-09-27 (FEAT-1…12) plus the former W5 features. **W6-01…W6-04 are small and independent — they can run in parallel with Wave 5.** The rest build on Wave 5.

| # | ID | Feature | Effort | Risk | Prerequisites |
|---|----|---------|--------|------|---------------|
| W6-01 | FEAT-1 | Add-on `data-grid-status-bar`: sum/avg/count/min/max of the selected cells, capped with "≈" (AG Enterprise status bar, Excel) | S | LOW | W3-04 |
| W6-02 | FEAT-2 | `autosizeColumns({ columnIds?, sampleRows?, includeHeader? })` over view rows via canvas `measureText`, one `onColumnLayoutChange`; optional `autosizeOnMount`. Today autosize measures only mounted cells (`autosize-column.ts:5-13`) | S | LOW | — |
| W6-03 | FEAT-6 | `printGrid()` / `<DataGridPrintButton>` in io: static table from `buildExportRows` in a hidden iframe, `window.print()` (also gives PDF) | S-M | LOW | — |
| W6-04 | FEAT-3 | `number.options.format: Intl.NumberFormatOptions` (currency, percent, compact; `toText` stays raw); new `url` cell type (href allow-list `http`/`https`/`mailto` only) and `longText` (popover editor) | S-M | LOW | W3-03 |
| W6-05 | API-02 | Generic write action `actions.commitChange(change)`: `applyChange` when uncontrolled, `onDataChange` in both modes, row-op guards, one undo entry; io import uses it | M-L | MED | W5-07 |
| W6-06 | API-01 | Bulk row reorder: batch `reorderRows` (one `move` batch, one undo entry), then multi-row drag from the grip, keyboard reorder | M + L | MED | W2-09, W5-07, spec |
| W6-07 | API-03 | Column layout in the URL: per-part opt-in (`order`, `hidden`, `widths`, `pins`; default `order` + `hidden`), write-back at the gesture commit point | M | LOW-MED | W5-11 |
| W6-08 | FEAT-4 | Per-column header filter popover + distinct-values ("set") filter with search and virtual list; `isAnyOf` for text/number/date; `data-filtered` header indicator | M | LOW-MED | W2-01, W2-07, W5-04 |
| W6-09 | FEAT-5 | Find & replace (mod+H): replace / replace all through `fromText` + validation, readOnly skipped, one undo entry, new change source `"replace"` | M | MED | W6-05, W4-01 |
| W6-10 | FEAT-7 | Column groups / multi-level headers: `columnGroups` prop, header tracks with `grid-column: span`, pin splits groups per band, `aria-colspan` | M-L | MED | W5-11, spec |
| W6-11 | FEAT-8 | Touch / coarse pointer: tap select, double-tap edit, long-press range, corner handles, larger hit areas under `(pointer: coarse)` | M-L | MED | W2-09 |
| W6-12 | FEAT-9 | Tree data: `getParentId(row)`, controlled `expandedRowIds`, `treeColumn` indent/toggle, filter keeps ancestors | L | MED-HIGH | W5-07, W5-08, W4-01, spec |
| W6-13 | FEAT-10 | Variable row heights (known heights): `getRowHeight(row)`, per-column `wrap`, prefix-offset window math; measured auto-height stays out | L | HIGH | perf suite, plan 010 |
| W6-14 | FEAT-11 | Master-detail / expandable full-width rows (`renderDetail`, `detailHeight`) | XL | HIGH | W6-12, W6-13 |
| W6-15 | FEAT-12 | Row grouping + aggregation (reopens the PLAN v1 non-goal) | XL | HIGH | W6-12, spec |

## Rejected

- **ARCH-04 shared `usePointerDrag` primitive** — five lifecycles differ in capture, threshold, Escape, and commit semantics; a shared primitive is a config-heavy wrapper and adds risk to the most gesture-sensitive code. The real gaps land in W2-09.
- **Cell merge / rowSpan** — conflicts with rectangular selection, fill tiling, and clipboard; keep the PLAN non-goal.
- **Formulas** — never bundle HyperFormula (GPLv3); revisit a bring-your-own-engine adapter only after W6-10 and W6-12.
- **PDF export library** — W6-03 print covers PDF without a new supply-chain dependency.
- **Persisted undo across sessions, collaborative editing (OT/CRDT), cell comments, conditional-formatting UI** — docs recipes on existing primitives, not registry items.
- **Freezing the first N data rows** — conflicts with sort/filter; pinned-row bands cover the need.

---

## Verifier notes executors need

**ARCH-01 stale → current mapping** (branch % today in brackets):
`fill/compute-fill-target.ts` → `data-grid-fill/compute-fill-target.ts` [100];
`fill/detect-series.ts` → `data-grid-fill/detect-series.ts` [88.9];
`fill/fill-direction.ts` → `data-grid-fill/fill-direction.ts` [100];
`fill/fill.ts` → drop (0 branches);
`fill/generate-fill.ts` → `data-grid-fill/generate-fill.ts` [100];
`selection/{empty-selection,extend-to,push-range,select-cell}.ts` → `selection/selection-ops.ts` [100];
`selection/{select-row,select-column,selection-rects,selection-contains-cell}.ts` → `selection/line-ops.ts` [100];
`selection/grow-selection.ts` → `selection/extend-selection.ts` [95.5];
`selection/selection.ts` → drop;
`columns/encode-template.ts` → `columns/column-format-helpers.ts` [87.5];
`keyboard/keymap.ts` → `keyboard/key-syntax.ts` [89.3];
`clipboard/clipboard.ts` → drop;
`sort-filter/sort-filter.ts` → `sort-filter/build-view-index.ts` + `incremental-view-index.ts` (excluded today);
`data-grid-context-menu/format-keymap-shortcut.ts` → drop (`.tsx` excluded);
`data-grid-context-menu/is-cell-in-selection.ts` → `data-grid-context-menu/selection-queries.ts` [100];
`data-grid-context-menu/selected-view-rows.ts` → `data-grid/selection/selected-view-rows.ts` [100].

**ARCH-02 mirror check (`@e965/xlsx@0.20.3`, 2026-09-27):**
- All 24 code files are byte-identical to the official `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`; only `package.json` (name, repository URL, formatting) and `README.md` (mirror notice) differ. No install scripts, zero runtime dependencies.
- `npm audit`: 0 vulnerabilities. `npm audit signatures`: verified registry signature and verified attestation. deps.dev: no advisories, SLSA v1 provenance verified, built by GitHub Actions `e965/sheetjs-npm-publisher` (`.github/workflows/try-publish.yml`, commit `1c8cc59`), which republishes SheetJS releases from `git.sheetjs.com`.
- OSV: no entries for `@e965/xlsx`. OSV marks every `xlsx` version affected only because no patched version exists under that npm name; the advisories cover `<0.19.3` and `<0.20.2`.
- ~1.26M downloads/week, publisher repo active (last push 2026-04-05), Apache-2.0.
- Socket.dev not queried: API and site need a login/token.

**PERF-05 measured step times** (run 36326408358, 11m50s): unit+coverage 2m16, browser 2m42,
compiler mirror 4m44, build 1m02, rest < 1 min.

## Status

| Wave | Status |
|------|--------|
| W1 | DONE (13 items, commits `4d274fb`…`0114b28`, all gates green) |
| W2 | TODO (includes six security fixes W2-14…W2-19) |
| W3 | TODO (all decisions made) |
| W4 | TODO |
| W5 | TODO (API foundation; specs for W5-05, W5-06, W5-08…W5-13) |
| W6 | TODO (W6-01…W6-04 can run in parallel with W5) |
