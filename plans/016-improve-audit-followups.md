# Plan 016 — 2026-09-27 improve-audit follow-ups

Source: `research/improve-audit-2026-09-27.md` (26 findings), re-verified at `b36ae5a` by five
independent verifier agents, plus two fresh scans (add-on bugs, docs-vs-code drift) that
added 17 findings. A second round under the decision rule below added a security review (6), an extensibility/API review (12), and a feature-gap scan (12); spot checks confirmed every security finding and the API review's doc errors. Spot checks by the planning session confirmed NEW-1/2/3/6 and DOC-01/03/04.

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
| API-04 | Spreadsheet parity | Spreadsheet apps have no arrow stepping; the no-op option itself is confirmed |
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

## Wave R — review fixes for W2–W4 (run before continuing W5)

Source: independent review of W2, W3, and W4 on 2026-09-29 (four reviewers, one per wave, each in its own worktree at the wave's last commit). Every fix was re-run with the fix reverted: all tests fail without their fix. The gaps below are sub-points that were missed, regressions the fixes introduced, and new findings. The planning session re-checked every R1 item and R-08, R-09, R-11, R-28 at `497fc45`.

Decisions (maintainer rule: secure, performant, feature-rich; breaking changes welcome):
- A throwing or rejecting validator blocks the edit with its message, on `onInvalid: "warn"` columns too.
- `isAnyOf` URL lists are bounded by `max(choices.length, 64)` for a column with `choices`, and by 1,000 for a column with missing or empty `choices`.
- Clipboard formula neutralizing becomes a grid prop that the native Ctrl+C/Ctrl+X path and the context menu honor.
- XLSX over a limit is rejected like CSV, never truncated; the import button and dialog take an `importLimits` prop.
- Keybindings `bindingTokens` is removed in favor of `formatShortcut` (**Breaking**).
- W3-04 (`onSelectionChange` fires only on real changes, `CompactSelectionLike.equals`) gets a **Breaking** CHANGELOG entry.
- `useDataGridInstanceId` moves to the `data-grid-sdk` barrel; `formatShortcutToken` stays internal (no add-on imports it).
- The edit-time row-op guards stay until R-01 is proven, then R-35 lifts them.
- An ISO datetime with an offset stores its local calendar day.
- Date text that names two months, or has a time part outside the time grammar that shifts the day, is rejected.
- Server-mode pagination does not reconcile while `total` is 0.
- The edit remap collapses a multi-cell range to the edited cell.
- A failed clipboard write disables Cut and Copy for the next menu open.
- One custom toolbar hosting the searches of two grids is unsupported.
- AGENTS.md comment rules apply to registry source, scripts, tests, and config alike.
- The compiler bail-out check collects React Compiler `CompileError` events on Babel 7.29 and fails on any bail-out outside a committed per-function allowed baseline (function plus category and reason), and on stale baseline entries. The compiler stops at the first failing pass, so a later-pass reason behind an earlier one stays invisible.
- The `ci` aggregator always runs and fails unless every needed job succeeded, so a fork PR shows a failing `ci` until a maintainer runs it; the other jobs keep the author gate.

Execution order (one implementer at a time on the branch, so blocks never collide in shared files such as `create-store.ts` and `CHANGELOG.md`; reviewers stay read-only in their own worktrees): R1 → R4 critical (R-36…R-43) → R5 (io + hucre) → R2 → R3 → R6 (data integrity and readOnly) → R7 (spec-writing findings) → remaining R4 → R-35 → W5-12 → W5-11 → W6-05 → W5-13.

A single implementer works through the execution order.

### R1 — security and data integrity (first)

| # | Source | Change | Effort | Risk |
|---|--------|--------|--------|------|
| R-01 | W4-01 | `_syncProps` remaps the open editor against the OLD data: `remapEditing(s, nextViewIndex, …)` resolves the rowId with `rowIndexCache.resolve(s.data, …)` (`create-store.ts` `remapEditing`, `_syncProps` call). The editor stays on the wrong row after a consumer `data` swap, and the rebuilt index cache holds the old map, so the next `updateCells`/`validateRow` writes to the wrong row. Fix: pass `nextData` and `props.getRowId` into `remapEditing`. Tests: drop, reorder (commit lands on the right row), insert above (remap down), and replace + Escape + value write + `updateCells` (no stale index), each with ONE sync; fix the existing "drops the edited row" test, which passes only through a second sync | S | MED |
| R-02 | W2-18 | `+` missing from `FORMULA_LEAD_CHARS` (`clipboard/serialize-cells.ts:10`): `+HYPERLINK(...)` and `+1+cmd\|...` pass unchanged. Add `+`; `+5` stays exempt. Tests for both payloads; add `+` to the docs callout, JSDoc, and CHANGELOG lists; put `**Breaking:**` at the start of the CHANGELOG entry without backticks | XS | LOW |
| R-03 | W2-19 | Sparse two-cell XLSX (A1 + CV1000000, 15.7 KB) still builds 100M cells (43.5 s, 2 GB): `clampedSheetRange` sizes from real cells and `defval` fills the rectangle. Add `maxCells` (default 5M) to the limits; compute the real extent and reject when rows > `maxRows`, cols > `maxColumns`, or rows × cols > `maxCells` before `sheet_to_json`; read with `sheetRows: maxRows + 1` to detect overflow; reject instead of truncating (matches CSV and the docs); same `maxCells` for CSV; parse only the selected sheet (`sheets:`). `DataGridImportButton`/`DataGridImportDialog` take `importLimits`, which also feeds Dropzone `maxSize`; export `DEFAULT_IMPORT_LIMITS` from the io barrel (the CHANGELOG already claims it). Tests with the real library and a forged sparse file; a browser test that fails without the Dropzone `maxSize` wiring | S-M | LOW |
| R-04 | W3 review | Cut can delete different cells than it copied: when `viewIndex`/`visibleColumns` change during the awaited clipboard write (sort, filter, lazy fetch, hide), the unchanged selection reference points at other rows (`use-data-grid-clipboard.ts` `cut`). Capture the rowIds and columnIds at copy time and delete by identity. Test: sort during a pending write | S | LOW |
| R-05 | W2-18 + review | Clipboard formula opt-in is unreachable: `useGridClipboard` (root) and the context menu call the hook without options, so the CHANGELOG claim is false. Add a grid prop `sanitizeClipboardFormulas` read by both paths; also neutralize the HTML `<td>` text (spreadsheet apps paste HTML first) and accept the sanitized form in the raw check; give public `rowsToCsv` a `sanitizeFormulas = true` parameter | S | LOW |
| R-06 | W3-01 | **Done (`62e28e5`); R-62 replaces the pinned package with hucre.** Pin the mirror in `registry.json`: `"@e965/xlsx@0.20.3"` (bare name installs the latest from a third-party publisher) | XS | LOW |
| R-07 | W2-02 | A function-form `validate` that throws still sticks the editor: `runValidateSync` (`validate-cell.ts`) has no try/catch. Catch and return `{ error: message }`, which also covers `updateCells`. Test for the function form | S | LOW |

### R2 — correctness gaps and regressions (easiest first)

| # | Source | Change | Effort | Risk |
|---|--------|--------|--------|------|
| R-08 | W2-01 | **Import dialog part moved to R-67.** Regression: Base UI `SelectValue` skips `placeholder` when `children` is a function, so an empty checkbox/select filter value renders blank (`filter-value-input.tsx`). Use Base UI's `items` prop on `<Select>` (labels without mounting, native placeholder) in all label-mapping selects; apply the same to the import dialog's delimiter and mapping selects (`import-dialog.tsx`, still raw `<SelectValue />`). Regression test; CHANGELOG entry | S | LOW |
| R-09 | W2-05 | Regression: `search.tsx` reads and writes a ref during render, so the React Compiler bails out of `DataGridSearch`. Use the `useState` previous-value pattern | XS | LOW |
| R-10 | W2-09 | `use-column-resize.ts` returns before `stopPropagation`, so a second touch on the handle selects the column and arms a reorder. Move the guard below the two calls. Reorder hooks: tear down `pendingRef` on `lostpointercapture`/`blur` so a lost non-mouse `pointerup` cannot wedge the gesture | XS-S | LOW |
| R-11 | W2-17 | Round-trip regression: a value with U+00A0 or `\r` fails the raw check (innerHTML writes `&nbsp;`), and tabs turn into spaces. Compare against `escapeHtmlText(raw)` with `&nbsp;` normalization | XS | LOW |
| R-12 | W3-03 + review | Number stepping: no-op while `pending` and during IME composition; without `decimals`, round to the step's decimals (`0.1` steps show `0.30000000000000004` today); test the default step of 1 | XS | LOW |
| R-13 | W2-03 + review | `reconcilePage` in server mode still rewrites a deep link while `total` is 0 (`use-data-grid-pagination.ts`); client mode with empty data passes an unclamped page ("page 3 of 1") | XS | LOW |
| R-14 | W2-16 | `isAnyOf` cap of 64 permanently truncates legitimate shared links (write-back rewrites them). Bound by the column's `choices`; cap parsed sorts at 64 (dev-warning spam) | S | LOW |
| R-15 | W2-08 | **Moved to R-65.** A delimiter re-parse of the previous file can overwrite a newer file's preview (`use-data-grid-import.ts`: `loadFile` has no generation check). Give `loadFile` its own generation or clear `currentFileRef` at its start. Test | S | LOW |
| R-16 | W4 review | While editing, `activeCell` is remapped but `selection.current.cell` is not: the range paints on another row, and Shift+Arrow after Escape extends from the wrong row. Remap the selection with the active cell | S | LOW |
| R-17 | W4-02 | `useDataGridRowIdToViewRow` keeps the Map identity but still subscribes to `data`, so its host (presence overlays) re-renders on every tick; the CHANGELOG claims otherwise. Replace the hook with a store selector cached in a module-level `WeakMap` keyed on `viewIndex` (reused while `rowIdentityVersion` and `getRowId` match), so the React Compiler cannot drop a dependency and the host does not subscribe to `data` | S | LOW |
| R-18 | W3 review | Context-menu Cut ignores `"failed"` (no feedback); a throwing `execCommand` rejects unhandled (no catch in the fallback); `cut()` in a readOnly grid resolves `"ok"`. Catch and return `false`, surface `"failed"` through a label, return the copy result without delete when readOnly | S | LOW |
| R-19 | review | Fill series corrupts IDs with more than 15 digits (`ID 1234…890` fills `…7000`, 400 digits fill `xNaN`): return null (tile) above 15 digits or use BigInt | XS | LOW |
| R-20 | review | Date `fromText` still rolls over non-ISO inputs (`Feb 30, 2026`, `02/30/2026`, `2026-02-30T10:00Z` → `2026-03-02`): reject when the parsed date's components differ from the input's | S | LOW |
| R-21 | review | **Moved to R-66.** CSV import allocates ~1.15 GB for a 49 MB file of delimiters before the column check: count columns per line without allocating, or `Papa.parse` with `step` and `abort()` on overflow | S | LOW |
| R-22 | review | Lazy merge drops an edit to a row evicted between commit and merge (`applyChange` skips the missing id): dev warning, or write `op.row` at its snapshot index | S | LOW |
| R-23 | review | Flash keys are `${viewRow}:${columnId}` (`create-store.ts` flash), so a sort or reorder leaves a flash on the wrong row for up to 1.4 s. Key by rowId | S-M | LOW |
| R-24 | review | The view-space presence dev warning fires only for row ops and immediate `updateCells`; add it to sort, filter, join, and consumer data swaps | S | LOW |
| R-25 | W3-05 review | Custom toolbars lose mod+F scope unless they carry `data-grid-instance`: accept `[data-grid-toolbar]` inside the provider, or document it | XS | LOW |
| R-26 | W4 review | `useDataGridEditing` hides the `rowId`/`columnId` anchor; widen its return type (W5-08 may absorb it) | XS | LOW |

### R3 — tests, exports, docs, CHANGELOG, comments, process

| # | Source | Change | Effort | Risk |
|---|--------|--------|--------|------|
| R-27 | W4-02, W2-12 | Missing guard tests: same-length id swap, lazy hole fill, and `reorderRows` must rebuild the rowId Map (today all bumps can be removed and the suite stays green); id-less reference-stable controlled `filterState` keeps `viewIndex` and `filterId`s; `withFilterIds(allWithIds)` returns the same array | XS | LOW |
| R-28 | W2-11, W3-05 | Barrel surface: move `useDataGridInstanceId` and `formatShortcutToken` to `data-grid-sdk`; remove keybindings `bindingTokens` (docs use `formatShortcut`, **Breaking**); CHANGELOG notes that `mod` matches Cmd on iPhone/iPad | S | LOW |
| R-29 | reviews | CHANGELOG: **Breaking** for W3-04 (incl. `CompactSelectionLike.equals`), W3-05 instance id, W2-14 pageSize fallback, W2-01 entry, W2-02 wording; delete the stale "`options.step` is `@reserved`" line; merge the duplicate Added/Changed/Fixed blocks inside `## Unreleased` | S | LOW |
| R-30 | reviews | Docs: the mirror paragraph splits the `installation.mdx` dependency table (rows render as text); `papaparse` is not lazy-loaded (`import-export.mdx`, installation table); url-pagination clamps "once `total` is positive", not "on mount" (JSDoc + `url-state.mdx`); `columns.mdx` names only `DataGridRoot` for `renderHeaderMenu`; "(grip focused)" in the sort/filter key tables; SSR note for `formatShortcut` (compute after mount); stale `GRID_ATTR.toolbar` JSDoc in `data-attributes.ts` | S | LOW |
| R-31 | reviews | Comments (AGENTS.md): history comments in `vitest.config.ts`; stale "commit re-reads the shifted viewIndex" guard comments and the false "stale entries are harmless" line in `create-store.ts`; multi-line `//` and pointer comments in `use-column-resize.ts`, reorder hooks, `select-line-options.ts`, `search.tsx`, `filter-value-input.tsx`, `use-async-validate.ts`, `create-store.ts` (`lastPropsFilterState`), `detect-series.ts`, `fill.test.ts`, `use-data-grid-url-pagination.ts`, the CI aggregator; `remapEditing` JSDoc; misplaced `oxlint-disable-next-line` in `hooks.ts`; stale comment in `binding-label.test.ts`; 35-word JSDoc in `date.tsx` | S | LOW |
| R-32 | W3-09 | Coverage: raise `parse-clipboard.ts`, `autosize-column.ts`, `build-imported-rows.ts` from 85 to 90; the key guard also rejects keys that match an `exclude` glob | XS | LOW |
| R-33 | W3-10 | CI: keep main's top-level `permissions: contents: read` when merging (PR #52); cache `~/.cache/ms-playwright`; add `timeout-minutes`; confirm the `ci` aggregator on the first PR run (the ruleset requires context `ci`) | XS | LOW |
| R-34 | process | A source-only comment commit (`49db63f`) left three payloads stale, and commits `26e7afd`…`13a742e` were made with `types:check` red (missing `FilterSpec` import, fixed later inside the unrelated `90b25f4`). Add `verify-payload-content` to the lint gate (or a pre-commit hook) and a React Compiler bail-out check over `registry/**` (new `CompileError`s fail; `use-column-resize`, reorder hooks, `filter-value-input`, `use-data-grid-lazy-rows.ts`, `use-fill-handle.ts`, and `use-data-grid-url-state.ts` already bail out, each a whole-file bail-out on Babel 7.29) | S | LOW |
| R-35 | W4 review | After R-01 is merged and green: lift the edit-time guards (`insertRows`/`deleteRows`/`duplicateRows`/`reorderRows` no-ops and the `updateCells` immediate→defer downgrade), so streaming re-sorts and row ops apply live during an edit. Browser tests for each path with an open editor | M | MED |
| R-75 | R2 review | `isDev()` (`is-dev.ts`) reads `globalThis.process?.env?.NODE_ENV`. Browser bundles without a `process` global (Vite) treat production as dev, so dev warnings and dev-only O(n) scans run in production. Use the literal `process.env.NODE_ENV` that bundlers replace, with a safe fallback, and verify with a real Vite and Next production build. Verification: `is-dev.test.ts` bundles `is-dev.ts` with esbuild `define: { "process.env.NODE_ENV": '"production"' }` and runs it in a context without `process` (fails against the old implementation) | S | MED |
| R-76 | R2 review | `pnpm test:compiler` runs babel-plugin-react-compiler on `@babel/core` 8.0.5 (via `@rolldown/plugin-babel`). It silently skips every component with a destructuring default (`search.tsx`, `filter-menu.tsx`, `root.tsx`, `menu-items.tsx`, `pagination-footer.tsx`, `sort-list.tsx`, the pagination, url-pagination, and pinned-rows hooks). Pin Babel 7.29 for the compiler pass (Next uses 7), and make R-34's bail-out check run on Babel 7 | S | MED |
| R-77 | R2 review | The view-space presence warning ignores column reorder and hide, though `range` uses view columns | XS | LOW |
| R-78 | R2 review | A touch row reorder cannot carry a row past the rendered window: the origin grip unmounts during autoscroll and the gesture cancels | S | LOW |
| R-79 | R2 review | Echo detection (`create-store.ts` `_syncProps`, `isEcho`) still trusts `lastEmittedData` after a foreign sync. Repro: a controlled `insertRows` emits N1, the consumer syncs a refetched X, then late-adopts N1. The view keeps X's `viewIndex` (a row disappears), `rowIdentityVersion` is not bumped, and the rowId map lacks the new row. Clear `lastEmittedData` in the non-echo branch, or require `nextData === s.data`. Test with that repro | S | LOW-MED (data integrity) |
| R-80 | R2 review | Number stepping with `decimals` pulls `min`/`max` inward with `Math.ceil`/`Math.floor(bound * 10 ** decimals)`, so float error moves the bound (`max: 0.29`, `decimals: 2` clamps to 0.28; `number.tsx` `clampToDecimals`). Round the scaled bound to an epsilon first, or compare against `roundToDecimals(bound)`. Test with `max: 0.29` | XS | LOW |


### R4 — W5-01…W5-10 review fixes

Source: independent review of W5-01…W5-10 on 2026-09-30 (four reviewers at `ba57d84`). The planning session re-checked R-36, R-37, R-38, R-39.

Decisions (maintainer rule):
- Event payloads and editor props carry `CellRef` identity (`rowId`, `columnId`) next to the view coordinate; `onActiveCellChange` fires when the identity under the cursor changes.
- Pinned rows get ids through `getRowId`; when it throws or returns a non-string or empty id, the row gets the band id `__pinned-top-<index>`/`__pinned-bottom-<index>`. Lazy holes use the placeholder ids, so every ctx `rowId` is a `string`.
- `filter.valueInput` accepts the built-in enum or a component (`CellTypeValueInput | ComponentType<FilterValueInputProps>`).
- `onValidationError` also fires for `updateCells` (source `"stream"`), so consumers handle every rejection in one place.
- Built-in `text` and `number` editors use `useCellEditor`.
- `renderHeaderCell` replaces the cell's contents inside a grid-owned cell (placement and ARIA stay with the grid).
- Add-on-only names move to `data-grid-sdk` (**Breaking**); the imperative handle replaces store lifting for imperative access in the docs.
- `GridCommand.run` receives the imperative api and a `CellRef`; commands can opt in to run while editing.
- A clamp that moves `activeCell` into a shrunken view collapses the selection onto the clamped cell.
- A lazy row that loads under the cursor fires `onActiveCellChange` (the record under the cursor changed).
- A column hide, reorder, or pin that puts another column under the cursor fires `onActiveCellChange`.
- `CellEditorProps` `rowId`/`columnId` are required (**Breaking**).
- The command ctx carries `viewColumnIndex` next to `viewRowIndex`.
- A key from an editor belongs to the edit: an `INPUT`/`SELECT`/`TEXTAREA`, anything inside `[data-grid-cell-editor]`, or a key that reached the grid through a portal never dispatches a grid binding; while an edit session is open only `"editing"`/`"always"` commands dispatch. The global shortcut layer is off while an edit session is open.
- The grid keydown dedupes a doubled native event per grid (a ref, not a module-level set), so a nested grid never suppresses its host.
- A filter, hidden column, or data change that drops the edited cell cancels the edit and clears the cursor even when other rows remain (documented); an `"editing"` command bound to Enter, Escape, or Tab never runs from the built-in editors.
- Keymap ties resolve per binding: on a specificity tie a binding that is not one of the action's defaults beats a default, a repeated default counts as a default, and off macOS `ctrl` and `mod` share one signature in the shared-binding warning (**Breaking** against 0.1.0).

| # | Source | Change | Effort | Risk |
|---|--------|--------|--------|------|
| R-36 | W5-09 | `api.startEditing()` opens an editor on a `readOnly` grid and Enter commits through `onDataChange`: `startEditingAt` returns when `s.readOnly` (and when the cell type has `activate`), like the keyboard path. Test | XS | LOW |
| R-37 | W5-06 | `select` filters broken: `toSearchText` was wired into `getText`, which also feeds the filter matcher, empty check, and default sort, so `isAnyOf`/`equals` on a value≠label column match nothing (and shared URL filters stop matching). Keep `getText` raw; add `getSearchText` used only by search; resolve one text function per column when the accessor builds and memoize value→label per `choices` (WeakMap) — fixes the 3× filter/search slowdown at 100k rows. Regression test; label-search CHANGELOG entry **Breaking** | S | MED |
| R-38 | W5-03 | `resolveCellTypes` builds a new registry on every `_syncProps`, so any `cellTypes` prop defeats the sync-skip guard: controlled edits re-sort immediately, every sync rebuilds the view, every cell re-renders. Memoize per provided object and reuse `s.cellTypes` when shallow-equal (covers inline literals). Test: controlled echo with `cellTypes` keeps the deferred order | S | LOW |
| R-39 | W5-04 | A disabled menu item with a tooltip still runs `onClick` (`menu-items.tsx`): pass `undefined` when disabled; browser test | XS | LOW |
| R-40 | W5-09 | `api.getViewRowIds()` throws on lazy holes: skip or map holes like `useDataGridRowIds`; test with sparse data | XS | LOW |
| R-41 | W5-05 | `onEditEnd` does not fire when a session ends by remap-cancel (filter/hide/sort/data swap), stale-anchor discard, or `startEditingAt` over an open session: fire `cancel` whenever `editing` goes from set to null outside commit/cancel (provider subscription), end the old session in `startEditingAt`. Tests incl. async `rejected` | S | LOW |
| R-42 | W5-08 | ctx types promise `rowId: string` but pinned-row cells and lazy-hole markers pass `undefined` (`rowId!` in `cell.tsx`, `marker-cell.tsx`); context menu on a skeleton cell sends `undefined`. Pinned rows resolve ids through `getRowId`, markers read the grid's `getRowId` (placeholder ids), the context-menu target selector excludes skeleton cells. Tests | S | LOW |
| R-43 | W5-03 | Unknown-type dev warning is wrong both ways: it checks the raw prop, not the merged registry (false positive for built-ins with any custom `cellTypes`; silent for `null` removals). Check the resolved registry | XS | LOW |
| R-44 | W5-02 | Documented `useDataGridSelector<TData>(…)` does not compile (two type parameters; unannotated infers `{}`). Ship `createDataGridSelector<TData>()` (or document the annotated parameter form) and add it to the type tests; fix `api-reference.mdx` and CHANGELOG | S | LOW |
| R-45 | W5-05/W5-08 | Events in `CellRef` terms (**Breaking**): `onActiveCellChange`, `onEditStart`, `onEditEnd` carry `{ rowId, columnId, viewRowIndex, viewColumnIndex }`; `onActiveCellChange` fires when a sort moves another record under the cursor; `CellEditorProps` get `rowId`/`columnId`; clamp or clear `activeCell` when a view rebuild shrinks the view (the JSDoc already claims a clamp) | S-M | MED |
| R-46 | W5-10 | Commands: `run(ctx)` with `ctx = { api, cell: CellRef \| null, viewRowIndex, row, readOnly }`; opt-in `scope: "grid" \| "editing" \| "always"` dispatched from the editor keydown too; dev warning for bindings shared across actions and consumer keymap entries win ties; shadow check against the full built-in action set (`editReplace`); end-to-end keydown test through `<DataGrid commands keymap>`; `KEYBINDING_CATEGORIES satisfies readonly CommandGroup[]` | S-M | LOW-MED |
| R-47 | W5-09 | `useDataGridApi()` throws outside `DataGridRoot` (toolbar siblings get a misleading error): register `focusImpl` in the store like `scrollToCellImpl`, build the handle from the store so it works anywhere under the provider, add `ref` to `DataGridProvider`; `focus()` scrolls an off-window active cell into view first; a test that `scrollTo` actually scrolls | S-M | LOW |
| R-48 | W5-06 | Typed filter input: `filter-value-input.tsx` still switches on the type name for gt/equals — use `valueInput`; `valueInput` accepts a component; consolidate the remaining name switches into `capabilities.ts`; custom types without `toSearchText` fall back to `toText`; `select.compare` sorts by label with one shared collator; tests for `numeric`, `filter.match`, `filter.operators`, `valueInput`, and the type's `validate` on paste/fill/import | S | LOW |
| R-49 | W5-03 | Built-in `TextEditor`/`NumberEditor` move onto `useCellEditor` (number keeps stepping via a wrapped `onKeyDown`); the hook returns `aria-label`, `aria-busy`, `dir="auto"`; every editor ignores Enter/Escape during IME composition | S | LOW |
| R-50 | W5-01 | `renderHeaderCell` renders inside a grid-owned header cell (placement, pinned inset, `role`, `aria-colindex` stay with the grid); stop exposing resize/reorder plumbing as `HeaderCellRenderCtx`; move the orphaned `DataGridHeader` JSDoc | S | LOW |
| R-51 | W5-02/W5-10 | Barrel: move `useDataGridStoreApi`, `useDataGridCommands`, `DataGridStoreState`, `GRID_ATTR`, `gridAttrSelector`, `createHistory`, `setCellValue`, `useDataGridColumnFeatureFlags`, `useDataGridSearchMatches`, `useDataGridSearchCapped`, `TEXT_FILTER_OPERATORS`, `COMPARISON_FILTER_OPERATORS`, `DataGridFilterOperatorLabels` to `data-grid-sdk` unless the docs teach them (**Breaking**); correct the CHANGELOG "moved" list (`GridDirection` stays) | S | LOW |
| R-52 | W5-05 | `onValidationError` for `updateCells` (source `"stream"`); tests for fill, async paste/fill, and async `rejected` | S | LOW |
| R-53 | reviews | Docs: imperative access via the handle instead of store lifting (`api-reference.mdx`, `editing-cell-types.mdx` server-errors example, cell-errors demo); `CellRef` no-op/warn behavior for filtered/paged rows next to `CellRef` + correct warning text + CHANGELOG wording; `row-operations.mdx` `renderMarker` ctx lists `rowId`; `keybindings.mdx` IDE wording; header dropdown `getHeaderMenuItems` override; recipe codec turns `0` into `null`; stale `render*MenuItems` descriptions in `registry.json`/payload; "checkbox" → "types with `activate`" in `onEditStart` docs | S | LOW |
| R-54 | reviews | CHANGELOG: **Breaking** for `RowClickCtx.rowIndex` → `viewRowIndex`, sdk `BulkCandidate`/`BulkWrite` renames, skeleton clicks no longer firing `onCellClick`/`onRowClick`, label search; typed selector under Added; one marker style `**Breaking:**` everywhere (the upgrade skill greps for it) | S | LOW |
| R-55 | reviews | Tests: W5-07 shared-state invariant (held async `updateCells` + consumer data swap must not overwrite); W5-08 refs (written row under sort, hidden column, filtered row, `extendTo`/`pushRange`/`scrollToCell` with refs, `rowId`/`columnId` in every ctx); W5-04 header dropdown override | S | LOW |
| R-56 | reviews | Perf: ref resolution with a cold cache scans for the one rowId instead of rebuilding the Map (292 ms at 1M rows) and keeps a lazy view-inverse keyed on `viewIndex` identity; pass `rowId` from `body.tsx` instead of two extra selectors per row; resolve menu specs inside the menu content, not per render | S | LOW |
| R-57 | reviews | Misc: `onCellDoubleClick`/`onCellContextMenu` ignore events from editors and portal popovers; declare `use-sync-external-store` (needed by `zustand/traditional`) or use `useStore`; rename `DataGridCell` `rowIndex`/`columnIndex` to `viewRowIndex`/`viewColumnIndex`; add `cell.tsx`, `body.tsx`, `context-menu.tsx` to R-34's compiler bail-out list; comment nits (pointers in `create-store.ts`, `use-cell-editor.ts`, `context-menu.tsx`, `use-fill-handle.ts:221`, `cell.tsx:189`, barrel JSDoc length, `events-state.mdx` indent); the W5-08 spec wrongly says flashes are rowId-keyed (R-23 fixes the code) | S | LOW |
| R-58 | R1 implementer | `_syncProps` prunes `cellErrors` and validation keys with the old `getRowId` (`create-store.ts` prune calls use `s.getRowId`); use `props.getRowId` when the consumer swaps it together with `data` | XS | LOW |
| R-59 | R1 implementer | **Superseded by R-62** (hucre checks the real cell box). XLSX overflow is detected only through a cell in row `maxRows + 1`; a file whose row `maxRows + 1` is empty but has data after it is still truncated silently (bounded, not a DoS). Detect overflow from the sheet's real row count, not one sentinel row | S | LOW |
| R-60 | R1 implementer | **Moved to R-64.** The import drop zone never shows its size limit: `import-dialog.tsx` passes `description`, which replaces the Dropzone's "up to N MB" caption. Show the limit | XS | LOW |
| R-61 | R1 implementer | With `sanitizeClipboardFormulas` on, the `execCommand` fallback writes text only, so pasting back into gridcn keeps the `'` prefix; strip the marker on paste when the payload came from gridcn, or document it | S | LOW |
| R-81 | R3/R4 review | Perf: 31 functions ship uncompiled, including the hot paths `DataGridBody`, `DataGridCellImpl`, `useGridInteraction`, `DataGridOverlays`, the windowing hooks, and `DataGridContextMenu` (see `scripts/compiler-bailouts.baseline.json`). Remove the bail-out reasons in the hot paths, measure them with the perf suite, and shrink the baseline | M | MED |
| R-82 | io review | `.xls` has no sparse mode, so dense row padding is the same pattern as the hucre dense-reader issue. Measure it and bound it | S | LOW |
| R-83 | io review | A part-size rejection shows the generic "too many cells" or "file too large" import message; name the cause | XS | LOW |
| R-84 | io review | Perf: the sparse xlsx path builds the cell map and then the full string grid (about 210 B per cell, double hucre's); stream into the grid | S | LOW-MED |

### R5 — data-grid-io consolidation: switch to hucre

Source: `research/xlsx-library-evaluation.md` (2026-09-30). SheetJS has no decompression cap: a 311 KB xlsx inflates to 300 MB (2.6 s, 505 MB heap) inside `XLSX.read`, before any gridcn limit runs; hucre stops the same file with `ZipError` after 366 ms and rejects a forged A1 + XFD1048576 extent in 16 ms (both re-run by the planning session). hucre reads 3.5–4.7× and writes 1.1–2.3× faster, the lazy chunk drops from ~160 KB to ~40 KB gzip, MIT license, SLSA provenance.

Why its own block: every io item touches the same four files (`parse-import-file.ts`, `export-grid.ts`, `import-dialog.tsx`, `use-data-grid-import.ts`). Running them in one block, in this order, avoids merge collisions with other waves. Order in the queue: after the critical R4 items (R-36…R-43), before the rest of R2/R3/R4 and before W6-03 (print uses `buildExportRows`) and W6-05 (commitChange rewrites the io import flow).

Supersedes R-06 (pin moves to hucre) and R-59 (hucre rejects over-limit sheets on the real box, no sentinel row); takes over the io parts of R-08 (import dialog selects), R-15, R-21, R-60.

Decisions:
- Pin `hucre` to the exact version `1.1.0` in `registry.json` and `package.json`; upgrades are deliberate (v2 is breaking and in review upstream).
- Keep the library behind the two existing seams (`parseImportFile`, `buildXlsx`), so a later switch stays a two-file change.
- Legacy `.xls`: the real 97–2003 binary format (BIFF8) stays supported; HTML-, SpreadsheetML-2003-, and BIFF5-flavoured `.xls` files are rejected with a clear error (**Breaking**, documented). `.xls` values come back without number formatting.
- New import limit `maxDecompressedBytes` (default 512 MiB) next to the existing limits.

| # | Source | Change | Effort | Risk |
|---|--------|--------|--------|------|
| R-62 | evaluation | Replace `@e965/xlsx` with `hucre@1.1.0` (exact pin) in `package.json`, lockfile, `registry.json` (`data-grid-io`), payloads, docs dependency tables. Import: `readXlsx(bytes, { sheets, maxRows: maxRows + 1, maxTotalCells: maxCells, maxDecompressedBytes, readStyles: true })` + `formatValue` for display text (round General-format floats to 15 significant digits); sheet list + selection unchanged; delete the forged-dimension workaround (`realSheetExtent`, clamped range); `.xls` via hucre's BIFF8 reader under the same limits. Map hucre's limit errors to gridcn's existing messages (match by error class, pin the text in tests). Export: `buildXlsx` writes string cells only (never formulas), sheet name from `workbookName`. Tests: port the four test files; real-library tests for the zip bomb (311 KB → rejected), forged extent, sparse two-cell file, over-limit rows/columns/cells (rejected, never truncated), formatted text (dates, currency, percent, scientific), a BIFF8 `.xls`, and an HTML-disguised `.xls` rejected. CHANGELOG **Breaking** (library, `.xls` flavours, formatting edge cases); `verify-demo-install` and `test:e2e-install` green | M | MED |
| R-63 | evaluation | `maxDecompressedBytes` (default 512 MiB) in `ImportLimits`/`DEFAULT_IMPORT_LIMITS`, passed to hucre, documented in the "Import limits" table | XS | LOW |
| R-64 | R-60 | Show the size limit in the import drop zone (the dialog's `description` hides the Dropzone caption) | XS | LOW |
| R-65 | R-15 | Delimiter re-parse must not overwrite a newer file's preview: generation check in `loadFile` (or clear `currentFileRef` at its start). Test | S | LOW |
| R-66 | R-21 | CSV: enforce `maxRows`/`maxColumns`/`maxCells` while parsing (papaparse `step` + `abort()`), so a 49 MB delimiter file cannot allocate ~1 GB first. Test | S | LOW |
| R-67 | R-08 | Import dialog delimiter and column-mapping selects show labels (Base UI `items` prop), not raw values (`\t`, `fullName`, `__skip__`). Browser test | S | LOW |
| R-68 | R4 implementer | Restarting an edit on the same cell carries the old draft and any in-flight async validation into the new session (the editor does not remount; the async guard only advances on unmount or `cancelPending`): key the editor or bump the async generation per session | S | LOW |
| R-69 | R4 implementer | `CheckboxEditor` is dead code since `startEditing` skips `activate` types: remove it (and its tests) or keep it only as documented raw-store fallback | XS | LOW |
| R-70 | R5 implementer | Sparse xlsx reads still cost ~125 B per real cell (5M minimal cells from a 160 KB file → 637 MB): lower the `maxDecompressedBytes` default to 256 MiB and reject before parsing when the sheet part's declared size implies more cells than `maxCells` allows; measure and document the memory ceiling in the "Import limits" table | S | LOW |
| R-71 | R5 implementer | Report upstream to hucre (issue with reproducer, no code here): dense reader pads rows before its cell-box check (107 KB → 3.7 GB), and parts declared larger than the max string length are stream-parsed up to the cap. Pin stays at 1.1.0 until fixed | XS | LOW |
| R-72 | R5 implementer | `.xls` (BIFF8) parses every sheet, so one oversized sheet rejects the workbook even when another sheet is selected: parse only the selected sheet if hucre allows it, else document | S | LOW |
| R-73 | R5 implementer | Audit hucre's `formatValue` against hostile number-format strings (ReDoS, long patterns); cap the format-string length gridcn passes | S | LOW |
| R-74 | R5 implementer | `scripts/normalize-payload-eol.mjs` keeps EOL-only changes of every embedded file when one file in the same payload really changed; normalize per embedded file | S | LOW |

### R6 — data integrity and readOnly (from the spec review)

Source: the spec advisor review of W5-11, W5-12, and W5-13 on 2026-10-02. R6 runs before R7 and the rest of R4. R-93 lands with W5-12 and R-94 with W5-13.

| # | Source | Change | Effort | Risk |
|---|--------|--------|--------|------|
| R-85 | spec review | Row-channel checks stay on view positions across sort, filter and data swaps (`setSorts`/`toggleSort`/`setFilters` leave `selection.rows` alone), so `deleteRows`/`duplicateRows` (shortcut, context menu) and `getRowIds()` act on records the user did not check. Remap the row channel by record identity on every view rebuild. Test: check rows, sort, deleteRows deletes only the checked records. | S | HIGH |
| R-86 | spec review | Undo/redo run in a read-only grid (`use-grid-interaction.ts` ~453-462 has no readOnly check; history writes through `setData`). Guard both. | XS | MED |
| R-87 | spec review | `commitCellEdit` and `commitCellValue(At)` lack the store readOnly guard (`data-write.ts`): an editor open when readOnly turns true commits on Enter; `actions.commitCellValue` writes in a read-only grid. Guard them; cancel the session when the flag turns on. | S | MED |
| R-88 | spec review | A column added to `columns` after any reorder, or missing from a restored `defaultColumnLayout.order`, never renders (`computeVisibleColumns`, compute.ts ~396-407). Append missing ids in def order. | S | MED |
| R-89 | spec review | Writes from inside `onDataChange` are lost: all nine emit sites call `onDataChange` before `set` (data-write.ts ~227,287,317,377,444,529,565,595,653). Emit after `set`. | S | MED |
| R-90 | spec review | `defaultColumnLayout` is applied without normalizing: pins on `pinnable: false` columns, unclamped widths, unknown ids kept (`applyDefaultColumnLayout`). | XS | LOW |
| R-91 | spec review | `onColumnLayoutChange` fires on no-op `setColumnPin`/`setColumnHidden`/`commitColumnWidth`; `setColumnHidden` stores unknown ids. | XS | LOW |
| R-92 | spec review | `useDataGridActions()` (consumer barrel) exposes `_registerReadOnly`/`_syncProps`; `_registerReadOnly(false)` lifts readOnly for menu and clipboard. Hide internals now (W5-13 closes fully). | XS | LOW |
| R-93 | spec review | SSR/first paint render the fill handle in a read-only grid (store mirrors readOnly only after mount). | in W5-12 | LOW |
| R-94 | spec review | Overlay plugins call hooks inside `DataGridOverlays`' loop: a changing list throws on the hook count; compiler bail-out. | in W5-13 | LOW |
| R-100 | R6 re-review | A descendant of `DataGridRoot` can still write in the readOnly flip commit: child layout effects run before the parent's (`root.tsx` ~294). W5-12's render-time sync closes it. | in W5-12 | LOW |

### R7 — found during spec writing

Source: the Wave 6 spec writing on 2026-10-02. R7 runs before the remaining R4 work. Status: DONE (`9036d58`, `eb8e44c` + `6e07b42`, `bd14b04`, `63278cf`).

| # | Source | Change | Effort | Risk |
|---|--------|--------|--------|------|
| R-95 | spec writing | `data-grid-url-state` imports `data-grid-pagination` but `registry.json` (~951-953) does not declare it in `registryDependencies`; an install misses files. Fix + `test:e2e-install` | XS | MED |
| R-96 | spec writing | `data-grid-io` uses `lucide-react` (`export-button.tsx:4`) but does not declare it. Fix + `test:e2e-install` | XS | LOW |
| R-97 | spec writing | Delete/Backspace typed in a `contenteditable` (or other non-input editable) inside the grid clears host cells; the grid's key handling must ignore events from editable descendants that are not the cell editor. Test | S | MED |
| R-98 | spec writing | `registry/default/examples/fake-remote-server.ts:115-128` and `content/docs/recipes.mdx:61-63` apply `move` ops one at a time, which gives a wrong order for multi-move batches (snapshot-index semantics). Fix with `applyChange` semantics | S | LOW |
| R-99 | spec writing | `buildExportRows` builds every row before applying `maxRows` (export cost); cap early | XS | LOW |
| R-101 | R6 re-review | The active cell stays on its view column position when a column is hidden, reordered, or pinned, so a delete after hiding a column to its left clears a different column. Decision: the active cell follows its column id (and its row id), like the selection channels. Test | S | MED |
| R-102 | R7 implementer | The grid root's copy/cut/paste listeners (`use-grid-clipboard.ts` ~390-445) take over clipboard events from a `contenteditable` or other non-input editable inside the grid (same class as R-97). Ignore events from editable descendants that are not the cell editor. Browser test | S | MED |
| R-103 | R7 implementer | The `minRow === Infinity` branch in `applyCellUpdates` (`data-write.ts` ~441) is unreachable (a non-null batch only writes visible columns). Delete it | XS | LOW |

## Wave 5 — API foundation (breaking welcome, spec first where marked)

Source: extensibility review 2026-09-27 (API-R1…R12). Ordered by dependency; W5-01…W5-06 are independent of each other.

W5 decisions (spec review 2026-10-02):
- W5-11 `selection` is gesture-first: a gesture applies at once and emits; a changed `selection` prop that differs from the grid's value overrides it. Strict control paints drags a frame late and breaks same-tick composite gestures.
- `columnLayout` is gesture-first too; resize frames never wait for the consumer.
- Echo detection uses an in-flight queue of emitted values; a matching prop is an echo (drops itself and older entries); any other prop applies only when it differs structurally.
- `SelectionState = { range: { start, end } | null, anchor, rangeStack, rowIds, columnIds }`; the anchor may lie inside the range (Ctrl+A).
- The row channel follows record identity; rows that leave the view leave the selection (**Breaking**).
- A range survives a view rebuild only if it covers the same records; otherwise it collapses onto the active cell.
- A range collapses onto the active cell when a view rebuild changes the records it covers.
- The selection's column channel follows column identity.
- An omitted part of a controlled layout stays uncontrolled (same rule as `setColumnLayout`).
- Saved and controlled layouts are normalized: missing ids appended in def order, unknown ids dropped.
- W5-12 syncs in two phases: config props (readOnly, keymap, commands, labels, enable*, callbacks…) in a layout effect via `_syncConfig`; recompute inputs in the passive effect.
- Render-only slots (emptyState, loadingState, renderHeaderMenu, renderMarker, renderMarkerHeader, getRowClassName, getCellClassName) stay `DataGridRoot` props.
- `DataGridProviderProps` is a union: `store` excludes sync props.
- When `readOnly` turns true, the open edit session cancels; every store write action no-ops on `readOnly` (the guard lives in the store).
- Plugins are trusted code; the handle is a contract, not isolation. Runtime `api.store` wrapper without `setState`; `_` actions live outside the state.
- Plugin overlays are components keyed by plugin name.
- Plugin bindings never win against a default or consumer binding.
- `onDataChange` and plugin observers run after the store write.
- `onDataChange` emits are queued FIFO after the outermost store write.
- `readOnly` registers in a layout effect.
- `useDataGridHistory` takes `readOnly`.
- The commit event order is `onActiveCellChange` → `onDataChange` → `onEditEnd`.
- W6-05 `commitChange` comes before W5-13 (no-op on readOnly, emit after set, row-op guards, pass-through for source "history").
- Execution order: W5-12 → W5-11 → W6-05 → W5-13 (after R-47, R-51, R-52, R-56). W6-05 moves out of Wave 6 into this order.

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
| W5-11 | API-R7 | Controlled selection and layout: `selection`/`defaultSelection`/`onSelectionChange(next: SelectionState)` in `CellRef` terms; controlled `columnLayout` (`defaultColumnLayout` stays the seed); drop `onSelectionCleared`. Absorbs the `setColumnLayout` action. W3-04 bail-outs must hold on the drag path | L | MED | yes: `research/controlled-selection-layout-spec.md` |
| W5-12 | API-R11 | One config home: every behavior prop (`readOnly`, `keymap`, `commands`, labels, events) is a sync prop; render-only slots stay `DataGridRoot` props, which keeps DOM/layout props too; `DataGridProps = DataGridSyncProps & DataGridRootProps` by spread (no ~60 hand-forwarded props, W3-07's guard becomes structural) | M | MED | yes: `research/config-home-spec.md` |
| W5-13 | API-R5 | Plugin system: `plugins={[fill.plugin, history.plugin, pinnedRows.plugin]}` with `DataGridPlugin = { name, overlay?, rowBands?, onDataChange?, commands?, keymap?, Mount? }`, where `overlay` is an `Overlay` component; bands concatenate; replaces the per-add-on wiring and the `_register*` actions, except `_registerScrollToCell`, which stays; third parties can write add-ons | L | MED | yes: `research/plugin-system-spec.md` |

## Wave 6 — features

Source: feature gap scan 2026-09-27 (FEAT-1…12) plus the former W5 features. **W6-01…W6-04 are small and independent — they can run in parallel with Wave 5.** The rest build on Wave 5.

Wave 6 is tracked as GitHub issues and worked one issue at a time after Wave 5; each spec is a draft and is checked against the code at pickup.

W6 decisions (recommendations accepted):
- Status bar: hidden for a single cell.
- `autosizeOnMount` is off by default.
- Print ignores on-screen widths.
- W6-04: search works on raw digits, and the editor edits the raw value.
- Bulk reorder: key bursts are separate undo entries.
- `widths` is not in the default URL layout parts.
- Header filter: no condition row, with per-value counts.
- Find/replace: limit of 10,000 cells per click, visible (filtered-in) rows only.
- Column-group export header rows come as a follow-up.
- Touch: no long-press drag; the fill handle is hidden on coarse pointers.
- Tree: a matching parent does not show non-matching children; deleting a parent re-roots its children; lazy children come later.
- Variable heights: no measured auto-height.
- Master-detail: several rows can be open; keyboard open moves focus in; no auto-grow.
- Grouping: new groups start collapsed; copy includes group rows as text; `groupKey` comes later.

| # | ID | Feature | Effort | Risk | Prerequisites | Issue | Spec |
|---|----|---------|--------|------|---------------|-------|------|
| W6-01 | FEAT-1 | Add-on `data-grid-status-bar`: sum/avg/count/min/max of the selected cells, capped with "≈" | S | LOW | W3-04 | #58 | `research/status-bar-spec.md` |
| W6-02 | FEAT-2 | `autosizeColumns({ columnIds?, sampleRows?, includeHeader? })` over view rows via canvas `measureText`, one `onColumnLayoutChange`; optional `autosizeOnMount`. Today autosize measures only mounted cells (`autosize-column.ts:5-13`) | S | LOW | — | #59 | `research/autosize-columns-spec.md` |
| W6-03 | FEAT-6 | `printGrid()` / `<DataGridPrintButton>` in io: static table from `buildExportRows` in a hidden iframe, `window.print()` (also gives PDF) | S-M | LOW | — | #60 | `research/print-spec.md` |
| W6-04 | FEAT-3 | `number.options.format: Intl.NumberFormatOptions` (currency, percent, compact; `toText` stays raw); new `url` cell type (href allow-list `http`/`https`/`mailto` only) and `longText` (popover editor) | S-M | LOW | W3-03 | #61 | `research/cell-types-format-url-longtext-spec.md` |
| W6-05 | API-02 | Generic write action `actions.commitChange(change)`: `applyChange` when uncontrolled, `onDataChange` in both modes, row-op guards, one undo entry; io import uses it; runs in the Wave 5 order before W5-13 (no-op on readOnly, emit after set, pass-through for source "history") | M-L | MED | W5-07 | — | — |
| W6-06 | API-01 | Bulk row reorder: batch `reorderRows` (one `move` batch, one undo entry), then multi-row drag from the grip, keyboard reorder | M + L | MED | W2-09, W5-07, spec | #62 | `research/bulk-row-reorder-spec.md` |
| W6-07 | API-03 | Column layout in the URL: per-part opt-in (`order`, `hidden`, `widths`, `pins`; default `order` + `hidden`), write-back at the gesture commit point | M | LOW-MED | W5-11 | #63 | `research/column-layout-url-spec.md` |
| W6-08 | FEAT-4 | Per-column header filter popover + distinct-values ("set") filter with search and virtual list; `isAnyOf` for text/number/date; `data-filtered` header indicator | M | LOW-MED | W2-01, W2-07, W5-04 | #64 | `research/header-filter-spec.md` |
| W6-09 | FEAT-5 | Find & replace (mod+H): replace / replace all through `fromText` + validation, readOnly skipped, one undo entry, new change source `"replace"` | M | MED | W6-05, W4-01 | #65 | `research/find-replace-spec.md` |
| W6-10 | FEAT-7 | Column groups / multi-level headers: `columnGroups` prop, header tracks with `grid-column: span`, pin splits groups per band, `aria-colspan` | M-L | MED | W5-11, spec | #66 | `research/column-groups-spec.md` |
| W6-11 | FEAT-8 | Touch / coarse pointer: tap select, double-tap edit, long-press range, corner handles, larger hit areas under `(pointer: coarse)` | M-L | MED | W2-09 | #67 | `research/touch-input-spec.md` |
| W6-12 | FEAT-9 | Tree data: `getParentId(row)`, controlled `expandedRowIds`, `treeColumn` indent/toggle, filter keeps ancestors | L | MED-HIGH | W5-07, W5-08, W4-01, spec | #68 | `research/tree-data-spec.md` |
| W6-13 | FEAT-10 | Variable row heights (known heights): `getRowHeight(row)`, per-column `wrap`, prefix-offset window math; measured auto-height stays out | L | HIGH | perf suite, plan 010 | #69 | `research/variable-row-heights-spec.md` |
| W6-14 | FEAT-11 | Master-detail / expandable full-width rows (`renderDetail`, `detailHeight`) | XL | HIGH | W6-12, W6-13 | #70 | `research/master-detail-spec.md` |
| W6-15 | FEAT-12 | Row grouping + aggregation (reopens the PLAN v1 non-goal) | XL | HIGH | W6-12, spec | #71 | `research/row-grouping-spec.md` |

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
| W2 | DONE (19 items, commits `7d12104`…`0776df0`); review 2026-09-29: 2 security bypasses and 2 regressions → Wave R |
| W3 | DONE (10 items, commits `3f120da`..`ca1e972` + compliance `49db63f`); review 2026-09-29: docs/CHANGELOG gaps, stale payloads at `49db63f` → Wave R |
| W4 | DONE (W4-01 `66e1eed`, W4-02 `a76bffa`); review 2026-09-29: W4-01 remaps against stale data on consumer data swaps → R-01 |
| WR | R1 DONE (R-01 `0c3579a`, R-02 `4f993b5`, R-03 `bb001d4`, R-04 `23d9296`, R-05 `d72dc18`, R-06 `62e28e5`, R-07 `bd66943`; all gates green incl. e2e install); R4 critical part DONE (R-36 `1564871`, R-37 `eecf2a1`, R-38 `d12c5ee` + `814c49d`, R-39 `f95e36b`, R-40 `468c620`, R-41 `4085797`, R-43 `1dc30e6`; all gates green incl. compiler mirror and e2e install); R5 DONE (R-62 `44eae8f`, R-63 `f41161f`, R-64 `330add5`, R-65 `b3d1197`, R-66 `61800b3`, R-67 `30ed183`, R-68 `6cdee5f`, R-69 `48bb4ff` (kept as the documented store-session fallback), audit follow-up `93a53b0`; all gates green incl. compiler mirror and e2e install); R2 DONE (R-08…R-26 item commits `12d798b`…`d81ecd6`, review fix loops `f35a28c`…`ff33aa7`; all gates green incl. compiler mirror and e2e install); R3 DONE (R-80 `e34a23e`, R-77 `cc261ad`, R-27 `ccbb0eb`, R-75 `e2e5557`, R-76 `b176e2e`, R-34 `f4e5cf7`, R-33 `db38118`, R-32 `81a8df7`, R-28 `57dc429`, R-29 `2500f7d`, R-30 `ba4e168`, R-31 `c2b283e`, audit pin `5d500ce`; all gates green incl. compiler mirror, e2e install, and a clean production audit; R-27's rowId-map guard sub-point, R-31's misplaced-oxlint-disable sub-point (removed by the rowId-map rework), and R-31's stale binding-label comment (file deleted in R-28) were already resolved at review time; R-33's `ci` aggregator confirmation is external — first PR run on GitHub). The R3 "all gates green" claim was false on a clean install: a stale hoisted `vite` hid that `is-dev.test.ts` imported an undeclared dependency, so types:check, ts5, build, and the unit gate failed and the coverage thresholds never ran; R-78 and R-79 were skipped. R3 review fixes DONE: clean install `6edb3f6` (esbuild guard for `isDev`), pnpm overrides `ebb82d1`, compiler bail-out baseline `c236db0`, R-80 `4e962af`, R-77 `780640a`, R-29 `cc72c84`, R-31 `ea80c25`, R-30/R-28 nits `d11b6ce` + `17ac944` + `a78c32d`, R-32 `4f47841`, R-33 `70aa20d`. R4 DONE after review: R-42 `389b129` + `5dfd088`, R-44 `a1f18da` + `d28c522`, R-45 `95a95c4` + `a1abbdc`, R-46 `d66b810` + `e464c4e`; all gates green on a clean install incl. compiler mirror, e2e install, and a clean production audit. Final R3/R4 review loop DONE: popup editor keys `53c99bb`, global shortcuts off while editing `e472767`, per-grid keydown dedupe `a890d20`, selection cleared with the cursor `e259f94`, docs `7c2904a`, normalized default bindings `56d1f9e`, `ci` aggregator always runs `73f4597`, compiler baseline with reasons `9558067`, decimal rounding `d9dd0a7`, docs/CHANGELOG nits `467749b`, pinned `getRowId` swap test `f72d2c9`; all gates green incl. compiler mirror, e2e install, and a clean production audit. io lane DONE: R-70, R-72, R-73, R-74 (`97cd570`, `d8f1f37`, `3d2bba9`, `19cf8a0`, `ab04426`, `27529fb`, `f74b268`; `f74b268` replaced the custom part resolver from `ab04426` with hucre's per-entry cap); R-71 drafted, waiting for the maintainer to post it upstream. io follow-ups DONE: R-82 `e04b5ad` + `3e81ed5` + `df2e564`, R-83 `31d908c`; R-84 closed after measurement with no code change (the docs ceiling `a4e4805`). R-47 DONE (`4b6ae33`). R6 DONE (R-85…R-92: `74c5e04`, `83ea038`, `f70f86e`, `b19b679`, `a9cacbd`, `fa8049c`, `8bdf2be`, `6e1ebd1`, `d4e6719`; review fix loop `fc2b416`…`aab8a41`; re-review fix loop DONE (emit validated before queuing `fe34a74`, throwing emit drains the queue `37c8003`, range check by position `f2dcdf0`, range dropped on column change `7198ab6`, linear select-all region `902c275`, cut cancelled by a cleared selection `f2c5feb`, docs `4abdc3e`; the `minRow === Infinity` branch of `applyCellUpdates` is unreachable, so it has no test); R-93 stays with W5-12, R-94 with W5-13). R7 DONE (R-95 + R-96 `9036d58`, R-97 `eb8e44c` + `6e07b42`, R-98 `bd14b04`, R-99 `63278cf`; R-95's new `scripts/verify-registry-dependencies.mjs` runs in `pnpm lint` and also fixed the `@base-ui/react`, `zustand`, and demo shadcn component gaps). R7 follow-ups DONE: R-101 `7326eac` (the active cell follows its record and column; a range that changed records collapses onto it), R-102 `47fa2fa`, R-103 `2976076`. R4 remainder DONE: R-58 `004014c`, R-52 `c8ca260`, R-48 `c6a1744`, R-49 `0999db9`, R-50 `c23b883`, R-51 `2b18aae`. Block review fix loop DONE: async cut kept when a sort keeps the range `1e29fe7`, clamp wording `e04a805`, clipboard and api focus scoped to the owning grid (nested grids, shadow roots) `0b54b37`, stream rejections resolve only their own view rows `a465fac`, select sort by cached label ranks `5b06d8e` + `3365533`, keyCode 229 as IME composition `90fa6f8`, filter value reset by operator `dcb0241`, interactive header contents keep their clicks `d231573`, docs nits and the barrel type guard `86cb4e9`, empty-value coverage `38afaa9`, dev warning when `getRowId` returns other ids on the same data array (sampled first and last loaded rows) `63949b5`. R-35 DONE (`cff89b2` — row ops and immediate re-sorts apply live under an open edit session; the edit re-anchors via `remapEditing`, or cancels with `onEditEnd: "cancel"` when its row leaves; all gates green incl. the new `row-ops-editing.browser.test.tsx`). R-93 and R-100 closed with W5-12; R-94 closed with W5-13; TODO: R-53…R-57, R-61, R-78, R-81 |
| W5 | W5-12 DONE (`3a372ea`), W5-11 DONE (`f81f324`), W5-13 DONE (+R-94, `ec5dc9c`), W5-08 DONE (`497fc45`), W5-05 DONE (`1db6369`); all gates green; W5-06 TODO (spec for W5-06) |
| W6 | W6-01 DONE (`f3b0626`), W6-02 DONE (`d66bbde`), W6-03 DONE (`c88a7d0`), W6-04 DONE (`081ccf7`), W6-05 DONE (`a426c59`); all gates green incl. e2e install |
