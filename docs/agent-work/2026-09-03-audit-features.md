# Features audit — 2026-09-03

Read-only audit (branch `dev`, HEAD `a4a303a`), one dimension of the 2026-09-03
multi-agent audit (tracking: `.agents/audit/2026-09-03-multi-agent-audit/`).
Scope: what is shipped, what is specced-but-unbuilt, what is missing, docs coverage,
open workplan items. Companion reports: `2026-09-03-audit-performance.md`,
`2026-09-03-audit-bugs.md`.

Headline: **all 27 specs in `docs/agent-work/specs/` are implemented** (one is a
spec-only evaluation awaiting a user decision). PLAN.md §3 is fully shipped, with
four deliberate carve-outs (fill handle, pinned rows, presence moved to add-ons;
`useDataGridIO` split into `useDataGridImport`/`useDataGridExport`). PLAN.md itself
is the one stale artifact: its §3 checklist, §8 item 1, and v2 roadmap have not been
updated since those carve-outs landed.

## Shipped vs open (PLAN.md §3)

### v1 — Excel core

| feature | status | evidence |
|---|---|---|
| Typed rows: generic `TData`, required `getRowId`, stable `id` | SHIPPED | `store/types.ts` (ColumnDefOf, getRowId); `columns/column-helpers.ts` `defineColumns`; quick-start.mdx |
| Controlled data + id-keyed ops batches (one ops array per gesture) | SHIPPED | `onDataChange` in `store/types.ts`; single-batch paste in `clipboard/use-grid-clipboard.ts:268` |
| Cell editing (type/Enter/F2/Esc/click-away; single-click-never-edits) | SHIPPED | `interaction/use-grid-interaction.ts:535` (isComposing gate); dblclick-only activation tests |
| Cell types text/number/checkbox/select/date + value pipeline + readOnly | SHIPPED | `cell-types/{text,number,checkbox,select,date}.tsx`; checkbox via shadcn Checkbox (workplan #43) |
| Date specifics: ISO value/clipboard, `displayFormat`+locale, Popover+Calendar editor | SHIPPED | `cell-types/date.tsx:70` (pinned locale, SSR fix #26) |
| Selection: anchor+range+stack, row/col channels (RLE), overlay-painted | SHIPPED | `selection/compact-selection.ts`, `selection/select-all-progression.ts`; `overlays.tsx` |
| Full keyboard map, Ctrl+Arrow data boundary, two-stage Ctrl+A | SHIPPED (two spec'd bindings missing — see bugs report N2/N3) | `keyboard/default-keymap.ts` |
| Clipboard: TSV+HTML, HTML-first parse, tiling, `processPaste` hooks | SHIPPED | `clipboard/serialize-cells.ts`, `parse-clipboard.ts`, `use-grid-clipboard.ts:262` |
| Fill handle + series inference + Ctrl+D/R + `onFillPattern` | SHIPPED **as add-on** (user decision 2026-07-18, workplan #48) | `blocks/data-grid-fill/` (detect-series.ts:86); `fillDown/fillRight` no-op without it (root.tsx:210-218) |
| Undo/redo `useDataGridHistory` + `useDataGridState` | SHIPPED (scale cost found — bugs report N1) | `blocks/data-grid-history/` |
| IME safety, a11y (role=grid, aria indices, roving tabindex, focus survival) | SHIPPED | `row.tsx` aria-rowindex + offset; accessibility.mdx (honest-claims matrix, #67) |
| i18n labels object (user request 2026-07-03) | SHIPPED | `labels.ts:204-217`, `deepMergeLabels` (:430), `useDataGridLabels` (hooks.ts:89); i18n.mdx + Arabic/RTL demo (#95) |

### v1 — table features

| feature | status | evidence |
|---|---|---|
| Multi-column sort, numeric-aware per cell type, controlled escape hatch | SHIPPED | `sort-filter/build-view-index.ts` + cell-type `compare` wired (workplan #85, 31251fd — prior audit HIGH fixed) |
| Filtering: operators (contains/equals/gt-lt/isBetween/isAnyOf), toolbar UI, AND/OR join | SHIPPED | `types.ts:380`; `data-grid-toolbar/operators-for-column-type.ts:27`, `filter-value-input.tsx:118` (isAnyOf, 99b4dd8) |
| Search: highlight + next/prev | SHIPPED | `toolbar/search.tsx`; `MAX_SEARCH_MATCHES` cap (compute.ts) |
| Column resize (dbl-click autosize), reorder, pin L/R, visibility | SHIPPED | `columns/use-column-resize.ts`, `pin-offsets.ts`; columns.mdx |
| Pinning UX: header dropdown (ghost chevron), `enableColumnPinning`, `pinnable?: false` | SHIPPED | `header-cell.tsx:138` `headerMenu` slot; `DataGridHeaderDropdown` (context-menu add-on) |
| Row ops add/delete/duplicate + row-op keybindings | SHIPPED | `insertRow/deleteRows/duplicateRows` (types.ts:521-530); `mod+shift+f/x` (default-keymap.ts:52-53) |
| `rowMarkers: none|number|checkbox|both`, runtime-switchable, select-all | SHIPPED | `rows/marker-header.tsx`, `marker-cell.tsx`; row-markers-demo |
| Selection configurability flags (enableRow/Column/Range/MultiRange) | SHIPPED | `data-grid.tsx:283-289` |
| Mouse-selection hardening (plain drag paints range, click vs drag, no native text selection) | SHIPPED | `use-grid-interaction.ts` drag-select matrix; browser tests scroll-drag/row-markers |
| Context menus (cell + header) | SHIPPED | `blocks/data-grid-context-menu/`; pinned-row/marker target fixes (#84, f48f45d) |
| Sticky header; pinned rows top/bottom (add-on); frozen-edge shadows | SHIPPED | `blocks/data-grid-pinned-rows/` + `rowBands` seam (root.tsx); `use-pin-shadow-edges.ts` (pixel-probe tests) |
| Validation: per-cell/column `validate`, `data-invalid`, Standard Schema async bulk, `validateRow` | SHIPPED | `validation/validate-cell.ts:4`, `validate-batch.ts:30`; `validateRow` (types.ts:56, 1767247) |

### v1 — data IO

| feature | status | evidence |
|---|---|---|
| Export xlsx/csv (lazy SheetJS, configurable delimiter, view/full/selection scope) | SHIPPED | `data-grid-io/export-grid.ts`; `scope: "selection"` (925978c) |
| Import xlsx/csv (papaparse, delimiter detection + preview, multi-sheet notice) via `fromText` | SHIPPED | `parse-import-file.ts:47` (sheetNames), `build-imported-rows.ts` (chunked + AbortSignal) |
| IO hook + toolbar Import/Export buttons | SHIPPED (PLAN's `useDataGridIO` split) | `useDataGridExport`/`useDataGridImport` + `DataGridExportButton`/`DataGridImportButton` (data-grid-io.ts:3-20) |

## Specced but not (fully) built

All 27 specs, checked for implementation by symbol grep in `registry/`:

| spec | status | note |
|---|---|---|
| 2026-07-16-scroll-rendering-architecture | IMPLEMENTED | workplan #44/#9 landed; canvas/row-pooling rejected per register (measured gates) |
| 2026-07-17-lazy-loading-pagination | IMPLEMENTED | `data-grid-lazy/use-data-grid-lazy-rows.ts:72`; lazy-loading.mdx |
| 2026-07-17-pagination-composable | IMPLEMENTED | composable footer parts (54a71a3) |
| 2026-07-17-paper-docs-theme | SUPERSEDED | replaced by workplan #76 grid-style theme (docs chrome only) |
| 2026-07-17-presence-highlights | IMPLEMENTED (extracted) | core prop removed by deliberate pre-1.0 breaking extraction; add-on API |
| 2026-07-17-webgpu-hero-shader | IMPLEMENTED (amended to Canvas-2D per its own amendment) | `components/hero-shader.tsx` |
| 2026-07-18-benchmark-page | IMPLEMENTED | `app/dev/benchmark/_lib/parity.ts` |
| 2026-07-18-empty-state | IMPLEMENTED | `labels.ts:369`, root.tsx:146-148 |
| 2026-07-18-events-state | IMPLEMENTED | `initialColumnLayout`/`onColumnLayoutChange`, `getValues()`/`getRowIds()` |
| 2026-07-18-fill-extraction | IMPLEMENTED | `blocks/data-grid-fill/` (14 files) |
| 2026-07-18-loading-state | IMPLEMENTED | redesign follow-up #96 CANCELLED by user (slim bar kept) |
| 2026-07-18-presence-extraction | IMPLEMENTED | `overlayPlugins` seam (root.tsx, identity-guardrailed) |
| 2026-07-18-standard-schema-validation | IMPLEMENTED | vendored `StandardSchemaV1` (types.ts:12); conformance type-tests |
| 2026-07-18-two-stage-select-all | IMPLEMENTED | `selection/select-all-progression.ts` (f27e1d4) |
| 2026-07-18-uncontrolled-data | IMPLEMENTED | `defaultData?` (types.ts:40) |
| 2026-08-01-async-bulk-validation | IMPLEMENTED | `runValidateBatch` + per-surface generation guards (bulk-generation.ts:49) |
| 2026-08-01-cell-errors-api | IMPLEMENTED | `cellErrors` + `setCellErrors`/`clearCellErrors`; colon-safe keys (#85) |
| 2026-08-01-direct-update-api | IMPLEMENTED | `updateCells`/`updateRows`/`reconcileView`, `useDataGridViewStale` |
| 2026-08-01-import-dialog-config | IMPLEMENTED | `ImportDialogOptions` (match-import-column.ts:11) |
| 2026-08-01-incremental-sort | IMPLEMENTED | `sort-filter/incremental-view-index.ts` (O(k log n), 256-row fallback) |
| 2026-08-01-pinned-rows-extraction | IMPLEMENTED | `rowBands` seam + `useDataGridAggregate` (#91) |
| 2026-08-01-rtl-support | IMPLEMENTED | `direction?` prop; bidi shaping/portals by design (register) |
| 2026-08-01-url-pagination | IMPLEMENTED | `use-data-grid-url-pagination.ts:41` + composition browser test |
| 2026-08-03-manual-install-docs | IMPLEMENTED | `components/manual-install.tsx`; installation.mdx |
| 2026-08-13-landing-caption-background | IMPLEMENTED | single pill kept (app/(home)/page.tsx:139-144) |
| 2026-08-20-test-infra-evaluation | **NOT STARTED (spec-only)** | the spec IS the deliverable; 3 open questions, decision pending (workplan #100) |
| 2026-08-20-validate-row | IMPLEMENTED | 1767247 |

No spec has partial implementation with missing code.

## Registry items (PLAN §8)

36 items in `registry.json` = 36 payloads in `public/r/` = name sets verified in sync.
All 8 PLAN §8 items present (folder + manifest + payload). Five extra block items beyond
PLAN §8 are fully wired: `data-grid-fill`, `data-grid-pinned-rows`, `data-grid-presence`,
`data-grid-lazy`, `data-grid-pagination`, `data-grid-sort-list`.

Staleness: PLAN §8 item 1 still lists the fill handle inside the core item — source,
README, and docs all say add-on. PLAN.md is the only stale artifact.

## Docs coverage gaps

29 mdx pages (nav verified). No docs page describes a non-existent feature (the three
false `compare` claims from the 08-02 audit were corrected in #85; the `sortable: false`
recipe broken in #103; the "no aggregation API" text replaced around `useDataGridAggregate`).

Shipped features that have no page of their own (covered as sections — acceptable,
flagged for a future docs pass): `data-grid-sort-list` (sorting-filtering-search.mdx:129-143),
keybindings dialog (selection-keyboard.mdx:81-86), context menus (columns.mdx:29-51),
`loading?` (api-reference + lazy-loading.mdx), row markers (columns.mdx / selection-keyboard.mdx).

## Workplan items still open (2026-07-17-qa-workplan.md)

| # | item | state |
|---|---|---|
| #34 | Filter/sort popover global shortcuts (Ctrl+Shift+F/S) | awaiting user interest |
| #67 | Human NVDA + VoiceOver pass | OPEN (user/manual); a11y matrix cells "not yet performed" |
| #100 | Test-infra evaluation spec | PROPOSED, decision pending (D+C recommended in the spec) |
| #103 | Core gaps from playground: pre-sorted-data mode, `aria-sort` blanked when sort suppressed, `toggleSort` not reusable, lazy `invalidate` | USER DECISION whether to build any |
| backlog | Lint rule forbidding raw `rect.left`/`scrollLeft` outside `windowing/direction.ts` (RTL risk, open since #71) | open |

Stale IN-FLIGHT markers (#4, #5, #8, #22, #27, #28, #40-#43, #47, #51, #52, #54) verified
landed — the workplan was not re-annotated after landing. The workplan is treated as a
historical record; the forward queue lives in `plans/2026-09-03-audit-followups.md`.

## Consciously deferred (v2 / register)

- Row DOM slot-recycling (conflicts with row-identity invariant, PLAN §3 v2)
- Variable/auto row heights, row grouping+aggregation, summary rows, cell merging, column groups
- More cell types (multi-select, url, currency, percent, long-text), row drag reorder, in-grid find panel
- Formula adapter interface, two-way TanStack Query/DB recipe (server-side recipe exists)
- Pinned rows keyboard-navigable/selectable (v1 scope cut, register)
- Screen-reader conformance verification (register: NOT YET VERIFIED)
- `content-visibility: auto` revisit — PARKED, register's "highest-value revisit", blocked by the pin-shadow pixel probe
- github-stars badge (no-op until repo is public); CHANGELOG (paused pre-release)

## Gaps worth a decision (carried to the follow-up workplan)

1. Test-infra spec (#100) — adopt D+C?
2. #103 core gaps — build any of the four?
3. Global filter/sort shortcuts (#34) — needs keybindings-dialog integration design.
4. `content-visibility` revisit — fund the pin-shadow probe adaptation?
5. RTL lint guard — still unenforced since #71.
6. Manual screen-reader pass (#67) — the only unverified a11y claim; blocks any WCAG statement.
7. PLAN.md §8/§v2 staleness — fixed in this audit's PLAN.md update commit.
