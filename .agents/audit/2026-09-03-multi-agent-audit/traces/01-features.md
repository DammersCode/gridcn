# Trace — features audit agent

- Task id: `ses_f9993fbcaffetN6daLN5SW43tY` (opencode task tool, type `general`)
- Mandate: read-only, research only; features dimension
- Input prompt: see orchestrator session 2026-09-03 (reproducible from the task
  description in the orchestrator log; the prompt carried the governing-doc paths,
  the settled-decisions register, the hard rules, and the 6-task checklist)
- Returned: raw report below, unedited.

---

All verification complete. Here is the report.

## Features audit — 2026-09-03

Scope: branch dev, HEAD a4a303a (+b620e4a audit scaffold). All evidence below is from files read or git commands run during this audit. No instruction-injection content found in any repo file read.

### Shipped vs open (PLAN.md §3)

**v1 — Excel core**

| feature | status | evidence |
|---|---|---|
| Typed rows: `TData`, required `getRowId`, stable `id` | SHIPPED | `registry/default/blocks/data-grid/store/types.ts` (ColumnDefOf, getRowId); `columns/column-helpers.ts` `defineColumns`; quick-start.mdx |
| Controlled data + id-keyed ops batches | SHIPPED | `DataGridSyncProps.onDataChange` (store/types.ts), DataOp ops; one-batch-per-gesture in `clipboard/use-grid-clipboard.ts:262`, `store/commit.ts` |
| Cell editing (Enter/F2/typing, Esc, click-away; single-click-never-edits per 2026-07-03 user decision) | SHIPPED | `interaction/use-grid-interaction.ts:535` (isComposing gate), inline editors in `cell.tsx`; dblclick-only activation tests |
| Cell types text/number/checkbox/select/date, per-column/cell readOnly, value pipeline | SHIPPED | `cell-types/{text,number,checkbox,select,date}.tsx`; `validate`/`readOnly` on ColumnDef (types.ts:321); checkbox uses shadcn `ui/checkbox` (workplan #43 done) |
| Date specifics: ISO value/clipboard, `displayFormat`+locale, Popover+Calendar editor, pinned default locale | SHIPPED | `cell-types/date.tsx:70` (locale pinned en-US, SSR fix #26); Popover/Calendar registry deps |
| Selection: anchor+range+stack, row/col channels (CompactSelection), overlay-painted | SHIPPED | `selection/compact-selection.ts`, `selection/select-all-progression.ts`; `overlays.tsx` `data-grid-selection-overlay`; zero-render probes |
| Full keyboard map, Ctrl+Arrow boundaries, two-stage Ctrl+A | SHIPPED | `keyboard/default-keymap.ts`; `selection/select-all-progression.ts` (exported selection/index.ts:15, workplan #38 f27e1d4) |
| Clipboard: TSV + HTML w/ raw attrs, HTML-first parse, tiling, hooks | SHIPPED | `clipboard/serialize-cells.ts`, `parse-clipboard.ts`, `processPaste` (data-grid.tsx:273, use-grid-clipboard.ts:262); clipboard.mdx |
| Fill handle + series inference + Ctrl+D/R + `onFillPattern` | SHIPPED as **add-on** (user decision 2026-07-18, workplan #48 — intentionally cut from core) | `blocks/data-grid-fill/` (use-data-grid-fill.tsx, detect-series.ts:86, use-fill-handle.ts:220); fillDown/fillRight no-op without add-on (root.tsx:210-218) |
| Undo/redo opt-in `useDataGridHistory` + `useDataGridState` | SHIPPED | `blocks/data-grid-history/`; undo-redo.mdx |
| IME safety, a11y (role=grid, aria indices, roving tabindex, focus survives scroll-out) | SHIPPED | `interaction/use-grid-interaction.ts:535`; row.tsx aria-rowindex + `ariaRowIndexOffset`; accessibility.mdx (honest-claims variant, #67) |
| i18n labels object (user request 2026-07-03) | SHIPPED | `labels.ts:204-217` (DataGridLabels/DEFAULT_LABELS), `deepMergeLabels` (:430), `useDataGridLabels` (store/hooks.ts:89); i18n.mdx + i18n-demo (Arabic/RTL, #95) |

**v1 — table features**

| feature | status | evidence |
|---|---|---|
| Multi-column sort, numeric-aware per cell type, controlled escape hatch | SHIPPED | `sort-filter/build-view-index.ts` + cell-type `compare` now wired (workplan #85, 31251fd — prior audit HIGH fixed); sorting-filtering-search.mdx |
| Filtering: operators incl. gt/lt, isBetween, isAnyOf; toolbar UI; controlled | SHIPPED | `types.ts:380` operator union; `data-grid-toolbar/operators-for-column-type.ts:27`, `filter-value-input.tsx:118` (isAnyOf, 99b4dd8); AND/OR join |
| Search: quick-search, match highlight, next/prev | SHIPPED | toolbar `search.tsx` (+ `captureFindShortcut` default true, workplan #54 shipped); searchMatches in store/compute.ts; perf guards #6d |
| Column resize (dbl-click autosize), reorder, pin L/R, visibility | SHIPPED | `columns/use-column-resize.ts`, reorder (dnd-kit-free native), pin-offsets.ts; columns.mdx |
| Pinning UX: header dropdown menu (ghost chevron), `enableColumnPinning`, `pinnable?: false` | SHIPPED | core `headerMenu` slot (data-grid.tsx, header-cell.tsx:138); `DataGridHeaderDropdown` (context-menu/header-dropdown.tsx:24); data-grid.tsx:295 |
| Row ops: add/delete/duplicate (keys mod+shift+f/x), marker column | SHIPPED | `actions.insertRow/deleteRows/duplicateRows` (types.ts:521-530); row-op keybindings added in #88 (20227b3) |
| `rowMarkers: none|number|checkbox|both`, runtime-switchable, select-all | SHIPPED | `rows/marker-header.tsx`, `marker-cell.tsx`; row-markers-demo; columns.mdx |
| Selection configurability flags | SHIPPED | `enableRowSelection/enableColumnSelection/enableRangeSelection/enableMultiRange` (data-grid.tsx:283-289, forwarded :440-443) |
| Mouse-selection hardening: plain drag paints range, click vs drag, no native text selection | SHIPPED | `interaction/use-grid-interaction.ts` drag-select matrix (browser tests scroll-drag.browser.test.tsx, row-markers.browser.test.tsx) |
| Context menus (cell + header, Base UI) | SHIPPED | `blocks/data-grid-context-menu/`; pinned-row/marker fixes #84 (f48f45d); columns.mdx |
| Sticky header; pinned rows top/bottom; frozen-edge shadows | SHIPPED — pinned rows as **add-on** (user decision 2026-07-18) | `blocks/data-grid-pinned-rows/` + `rowBands` seam (root.tsx); `windowing/use-pin-shadow-edges.ts` (pixel-probe tests #3/#9b) |
| Validation: per-cell-type + per-column, `data-invalid`, invalid can't commit, Standard Schema + `validateRow` | SHIPPED | `validation/validate-cell.ts:4` (fn\|StandardSchemaV1, vendored types.ts:12), `validateRow` (types.ts:56, 1767247); async bulk #79 (96544c6) |

**v1 — data IO**

| feature | status | evidence |
|---|---|---|
| Export xlsx/csv (lazy SheetJS, configurable delimiter, view/full scope) | SHIPPED | `blocks/data-grid-io/export-grid.ts`, `useDataGridExport`; `scope: "selection"` added 925978c |
| Import xlsx/csv (papaparse, delimiter detection + preview) via `fromText` | SHIPPED | `parse-import-file.ts`, `build-imported-rows.ts` (validates through cell types, async-aware #79) |
| IO hook + toolbar Import/Export buttons | SHIPPED (naming differs from PLAN) | PLAN's `useDataGridIO` is split into `useDataGridExport`/`useDataGridImport` + `DataGridExportButton`/`DataGridImportButton` (data-grid-io.ts:3-20) |

Intentional cuts/changes respected: fill/pinned-rows/presence moved core→add-ons (2026-07-18 user decisions, workplan #48); `useDataGridIO` renamed; edit-activation supersedes click-to-edit (2026-07-03); column virtualization *promoted* from v2 in phase 3b and built (`windowing/use-column-window.ts`); PLAN §8 item 1 "core ... fill handle" wording is stale (fill is an add-on).

### Specced but not (fully) built

All 27 specs in `docs/agent-work/specs/`:

| spec file | status | what's missing | evidence |
|---|---|---|---|
| 2026-07-16-scroll-rendering-architecture-design.md | IMPLEMENTED | — (DOM architecture kept; all fix phases landed; canvas/row-pooling rejected per register with measured gates) | `windowing/use-scroll-snapshot.ts`; workplan #44 DONE a1d157f, #9 DONE 7e290dd |
| 2026-07-17-lazy-loading-pagination-design.md | IMPLEMENTED | — | `data-grid-lazy/use-data-grid-lazy-rows.ts:72` (onRowWindowChange), `data-grid-pagination`; commits 3e3041d/e2f4748/e3738d6; lazy-loading.mdx |
| 2026-07-17-pagination-composable-design.md | IMPLEMENTED | — | composable parts in `data-grid-pagination/pagination-footer.tsx` (54a71a3); pagination.mdx |
| 2026-07-17-paper-docs-theme.md | IMPLEMENTED, then SUPERSEDED | superseded by workplan #76 (grid-style theme, `--radius` 0, 5e78ef4) — docs chrome only | `app/global.css` (radius scale lines 147-152; warmed oklch tokens from #5) |
| 2026-07-17-presence-highlights-design.md | IMPLEMENTED (superseded shape) | original core `presenceHighlights` prop removed by extraction (BREAKING pre-1.0, deliberate); now add-on API | `data-grid-presence/use-data-grid-presence.ts:34`; commit cfcaee7/567c918 |
| 2026-07-17-webgpu-hero-shader-design.md | IMPLEMENTED (amended to Canvas-2D per spec's own amendment) | — | `components/hero-shader.tsx`; commits cf4a435, ade6942; `app/(home)/page.tsx:97` |
| 2026-07-18-benchmark-page-design.md | IMPLEMENTED | — (incl. parity-matrix refinement from the amendment) | `app/dev/benchmark/_lib/parity.ts` (PARITY_MATRIX), `parity-view.tsx`; v1 a6877a6 |
| 2026-07-18-empty-state-design.md | IMPLEMENTED | — | `labels.ts:369` ("No rows"), root.tsx:146-148 + :486 precedence; test column-ux.browser.test.tsx:331 |
| 2026-07-18-events-state-design.md | IMPLEMENTED | — | `initialColumnLayout`/`onColumnLayoutChange` (types.ts:146-153), `getValues()`/`getRowIds()` (types.ts:183-185, ef013a8); events-state.mdx |
| 2026-07-18-fill-extraction-design.md | IMPLEMENTED | — | `blocks/data-grid-fill/` (14 files), `useDataGridFill`, `fillHandlers` slot; d9f263e/74b64ec |
| 2026-07-18-loading-state-design.md | IMPLEMENTED | redesign follow-up #96 CANCELLED by user (slim bar kept, c917b8c) | `data-grid.tsx:349` `loading?`; `test/loading-state.browser.test.tsx` |
| 2026-07-18-presence-extraction-design.md | IMPLEMENTED | — | `overlayPlugins` provider prop (identity-guardrailed, root.tsx); data-grid-presence block |
| 2026-07-18-standard-schema-validation-design.md | IMPLEMENTED | — | vendored `StandardSchemaV1` (types.ts:12), `CellValidate` union (validate-cell.ts:4), conformance type-tests (data-grid.type-test.ts:196-231); d320b6a |
| 2026-07-18-two-stage-select-all-design.md | IMPLEMENTED | — | `selection/select-all-progression.ts` (region flood → whole grid); f27e1d4 |
| 2026-07-18-uncontrolled-data-design.md | IMPLEMENTED | — | `defaultData?` (types.ts:40), store owns array; quick-start.mdx |
| 2026-08-01-async-bulk-validation-design.md | IMPLEMENTED | — | `runValidateBatch` (validation/validate-batch.ts:30), per-surface generation guards (`bulk-generation.ts:49`); 96544c6 |
| 2026-08-01-cell-errors-api-design.md | IMPLEMENTED | — | `cellErrors` map + `setCellErrors`/`clearCellErrors` (types.ts:334-339, :499-500); 19c2aa2; colon-safe key #85 |
| 2026-08-01-direct-update-api-design.md | IMPLEMENTED | — | `updateCells`/`updateRows`/`reconcileView` (types.ts:522-525), `useDataGridViewStale` (hooks.ts:225); 744aece/9f2e72d; streaming-updates.mdx |
| 2026-08-01-import-dialog-config-design.md | IMPLEMENTED | — | `ImportDialogOptions` (match-import-column.ts:11), quick-skip X (import-dialog.tsx:256, `skipColumnQuick` label); 8b8c660 |
| 2026-08-01-incremental-sort-design.md | IMPLEMENTED | — | `sort-filter/incremental-view-index.ts` (O(k log n), 256-row fallback); 952cdb7 |
| 2026-08-01-pinned-rows-extraction-design.md | IMPLEMENTED | — | `rowBands` provider seam (root.tsx), `data-grid-pinned-rows` block, `useDataGridAggregate` (#91, b75838f); 4a3019b |
| 2026-08-01-rtl-support-design.md | IMPLEMENTED | bidi shaping/portaled content by-design (register: browser's job + explicit `dir` on portals) — not code | `direction?` prop (data-grid.tsx:277), `windowing/direction.ts` central helpers; 2dc410e + #95 bdi fixes |
| 2026-08-01-url-pagination-design.md | IMPLEMENTED | — | `use-data-grid-url-pagination.ts:41` + composition browser test; 987bbf6 |
| 2026-08-03-manual-install-docs.md | IMPLEMENTED | — | `components/manual-install.tsx` + `install-command.tsx` Manual tabs; installation.mdx:33; 3bed048/33ea174/3414134 |
| 2026-08-13-landing-caption-background-design.md | IMPLEMENTED | — | landing page keeps single pill (app/(home)/page.tsx:139-144); demo component has no embedded instruction text (grep: none in data-grid-demo.tsx) |
| 2026-08-20-test-infra-evaluation.md | NOT STARTED (spec-only) | the spec IS the deliverable; awaiting user decision on its 3 questions (workplan #100 "decision pending") | workplan:1271-1279 |
| 2026-08-20-validate-row.md | IMPLEMENTED | — | `validateRow` (types.ts:56), ownership-scoped clearing; 1767247 |

No spec has partial implementation with code missing.

### Registry items

PLAN §8 items 1-8 vs folders / registry.json (36 items total) / public/r (36 payloads + registry.json; name sets verified in sync, zero missing/extra):

| item | folder | registry.json | public/r payload | notes |
|---|---|---|---|---|
| 1. data-grid (core) | blocks/data-grid | ✓ registry:block | ✓ data-grid.json | deps zustand-only per PLAN |
| 2. data-grid-history | blocks/data-grid-history | ✓ | ✓ | — |
| 3. data-grid-toolbar | blocks/data-grid-toolbar | ✓ | ✓ | — |
| 4. data-grid-context-menu | blocks/data-grid-context-menu | ✓ | ✓ | also ships `DataGridHeaderDropdown` (PLAN §3 pinning UX) |
| 5. data-grid-io | blocks/data-grid-io | ✓ | ✓ | — |
| 6. data-grid-url-state | blocks/data-grid-url-state | ✓ | ✓ | — |
| 7. data-grid-keybindings | blocks/data-grid-keybindings | ✓ | ✓ | — |
| 8. data-grid-demo + examples | examples/data-grid-demo.tsx (example, not a block folder) | ✓ registry:example | ✓ data-grid-demo.json | 23 example items total, all with payloads; item 8 is examples, not a block — consistent, just not a folder-per-component item |

Beyond PLAN §8, 5 extra block items exist and are fully wired (fill, pinned-rows, presence, lazy, pagination, sort-list — from workplan #48/#6/#16): all have folders, registry.json entries, and payloads.

### Docs coverage gaps

29 mdx pages (meta.json nav: Getting Started / Features / Add-ons / Reference). Mapping verified against shipped features:

- Shipped features with **no page of their own** (covered as sections — acceptable): `data-grid-sort-list` (sorting-filtering-search.mdx:129-143), keybindings dialog (selection-keyboard.mdx:81-86), context menus (columns.mdx:29-51), `loading?` (api-reference + lazy-loading.mdx), row markers (columns.mdx / selection-keyboard.mdx).
- Docs describing features that don't exist / are partial: **none found.** The three false `compare` claims from the 2026-08-02 audit (custom-cell-types.mdx:57/:97, sorting-filtering-search.mdx:12) were corrected in #85 (31251fd); recipes.mdx's broken `sortable: false` pattern corrected in #103; "There is no aggregation API" text replaced around `useDataGridAggregate` (#91).
- Stale claim: PLAN.md §8 item 1 still lists "fill handle" inside core — source/README/docs all say add-on; PLAN is the only stale artifact.

### Workplan items still open

Items with no DONE marker verified still open at HEAD:

1. **#34** — Filter/sort popover global shortcuts (Ctrl+Shift+F/S, Backspace removes last row) — "awaiting user interest" (line 399).
2. **#67** — Human NVDA + VoiceOver pass — "OPEN (user/manual)" (line 768); a11y matrix cells still "Not yet performed".
3. **#100** — Test-infra evaluation spec — "PROPOSED, decision pending" (line 1279); user decision on 3 questions (config-only split D + tiny Playwright layer C recommended).
4. **#103** — Core gaps recorded from playground work: no pre-sorted-data mode, suppressed sort blanks `aria-sort` (a11y), toggleSort cycle not reusable, lazy hook has no `invalidate` — "USER DECISION whether to build any" (line 1292).
5. **Backlog** — lint rule forbidding raw `rect.left`/`scrollLeft` outside `windowing/direction.ts` (RTL risk; line 1176, also #71 caveat line 987 "no lint rule yet").
6. **Awaiting user input** (line 1179): skill installs (user-optional npx commands). Note: the search-icon and React-Scan profiling-repro entries in this section are **stale** — both were explicitly DROPPED by the user in the #48 addendum (line 849).
7. Process notes (not feature items): #96 loading redesign CANCELLED by user (recorded, not open); #99's "STILL OPEN" 2 feature gaps (isAnyOf, row-settled validation) are **resolved** — handled by user in 2c94add/99b4dd8/1767247; #104 react-compiler merge was a user decision and **is merged** (a4a303a).

Many older "IN FLIGHT" markers (#4, #5, #8, #22, #27, #28, #40-#43, #47, #51, #52, #54) are stale — each verified landed (demo/example files, docs pages, or source symbols exist); the workplan was not re-annotated after landing.

### Consciously deferred (v2 / register)

From PLAN.md §3 v2 roadmap (stale entries struck): ~~column virtualization (built, phase 3b)~~, ~~RTL (shipped 2026-08-01)~~, ~~i18n of labels (shipped)~~, ~~presence/collab highlights (shipped as add-on)~~ — remaining: row DOM slot-recycling (row-identity conflict), variable/auto row heights, row grouping + aggregation, summary rows, cell merging, more cell types (multi-select/url/currency/percent/long-text), column groups, row drag reorder, in-grid find panel, formula adapter interface, two-way TanStack Query/DB recipes (server-side recipe exists; two-way not).

From register NOT YET / WAITING / PARKED: pinned rows keyboard-navigable/selectable (v1 scope cut); screen-reader conformance verification (no manual pass); RTL bidi shaping/portals (browser's job + explicit `dir`); content-visibility revisit (PARKED, highest-value perf lever, blocked by pin-shadow probe); github-stars badge no-op until repo is public; CHANGELOG paused pre-release.

### Gaps worth a decision

1. **Test-infra spec (#100)** — adopt D+C (project split/serial/retry + capped Playwright layer for WebKit/Firefox clipboard/download/RTL)? Awaiting user.
2. **#103 core gaps** — pre-sorted-data mode, aria-sort when sort suppressed, toggleSort reusability, lazy `invalidate`: build any?
3. **Global filter/sort shortcuts (#34)** — Ctrl+Shift+F/S parity with tablecn; needs keybindings-dialog integration design.
4. **content-visibility revisit** — register's "highest-value revisit" (up to 5x fps) parked only because of the pin-shadow probe; decision to fund the probe adaptation.
5. **RTL lint guard** — raw physical-coordinate access outside `direction.ts` is unenforced (backlog since #71).
6. **Manual screen-reader pass (#67)** — the only a11y claim still unverified; blocks any WCAG conformance statement.
7. **PLAN.md §8 staleness** — core/fill boundary text contradicts shipped modularity; worth a one-line edit at next docs pass.
