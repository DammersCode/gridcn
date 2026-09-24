# Changelog

All notable changes to gridcn are documented here. Since gridcn ships through the shadcn registry
rather than npm, there is no package semver — this file, plus each item's stable file layout, is
the upgrade story. Re-run `npx shadcn add @gridcn/<item>` to pick up changes; the CLI diffs and
prompts before overwriting files you've edited.

The format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Added

- **Typed keymap binding strings:** the `keymap` prop's binding strings now use the exported
  `KeyBinding` type — a modifier prefix (`mod`, `ctrl`, `shift`, `alt`, in that order when
  combined) plus a typed key (letters, digits, `F1` to `F24`, named keys, a single printable
  character, or the literal space). The union still accepts any string, so existing keymaps keep
  compiling; a binding the matcher cannot match now warns in the browser console in
  development.
- **Global keyboard shortcuts (opt-in):** `DataGridGlobalShortcuts` keeps the effective keymap's
  undo/redo working while DOM focus is OUTSIDE the grid (custom toolbar, side panel, `body`).
  Mount the component inside `DataGridRoot`; limit the enabled actions with the `undo` and `redo`
  flags (both enabled by default). Keys come from the effective keymap, so `keymap` remaps apply
  to the global layer as well. A six-rule gate skips IME composition, already-handled events,
  editable targets (a field's native undo wins), any in-grid target, and grids that are not the
  last focused opted-in one (multi-grid tie-break). No new dependencies.
- Manual install without the CLI: the Manual tab of the installation docs now links every core
  source file (and folder) to its page in the GitHub repository, so the source folder can be
  copied straight from GitHub into `components/` — the same payload the CLI installs.
- **Lazy loading: window tuning and memory retention (`data-grid-lazy`):** `useDataGridLazyRows`
  accepts a new `maxFetchRows` option that caps the rows of a single `fetchRows` call (a wider
  gap is fetched as consecutive chunks, each deduped and aborted independently; non-integer
  values are rounded down) and an `onLoaded(range)` callback fired with the range actually
  written. The result gains three stable members: `reset()` (aborts in-flight fetches, drops all
  loaded rows, and re-requests the last reported window so the visible rows refetch — the same
  reset a `total` change performs), `evict(range)` (unloads a range so the next scroll into it
  refetches), and `getLoadedRanges()` (a non-reactive snapshot of the loaded ranges). A throwing
   `onLoaded` or `onError` is logged instead of escaping as an unhandled promise rejection. The
   demo gains an "Evict loaded rows" button that shows the eviction path live.
- **Hole-safe export (`data-grid-io`):** `buildExportRows`/`exportGrid` now skip unloaded rows
  (the holes of a `data-grid-lazy` sparse array) in every scope, so exporting a lazy grid no
  longer throws on `accessorFn` columns or writes blank rows.
- **Public barrel additions:** the `data-grid` barrel now exports `createFilterMatcher`
  (previously documented but only importable from the internal `sort-filter` path), `displayText`,
  and the `CellSpan` display primitive; the `data-grid-keybindings` barrel exports `BindingChips`
  and `bindingTokens` (the binding chips the keybindings page already teaches); the
  `data-grid-presence` barrel exports the `isRowIdPresenceHighlight` /
  `isRowIdRangePresenceHighlight` payload type guards for narrowing untrusted remote payloads.
- **`grid.datePlaceholder` label key:** the date editor's input placeholder now reads from
  `labels.grid.datePlaceholder` (default `"yyyy-mm-dd"`), so it participates in
  `DataGridLabels` localization like every other user-facing string.
- **Clipboard outcomes for programmatic copy/cut:** `useDataGridClipboard`'s `copy()` and `cut()`
  now resolve to `"ok"` (the async Clipboard API accepted the write), `"fallback"` (the legacy
  `execCommand` text-only path ran instead), or `"no-selection"` (nothing was selected).
- **Compile-time API pins:** new type tests pin `useDataGridLazyRows`' public options/result
  shapes (including the `Range` type used by `evict`/`getLoadedRanges`) and the
  `data-grid-presence` payload contract (entry union shapes, guard narrowing, malformed-payload
  rejection).
- **Column `sortCompare`:** a per-column option that compares whole data rows (not cell values),
  consulted before the cell type's `compare` and the default text compare. A non-zero result
  orders the pair; a zero, `NaN`, or thrown result defers to the default. `SortSpec` direction and
  the empty-cell-last rule still apply.
- **Search debounce tuning:** `DataGridSearch` accepts `debounceMs` (default `200`).
- **Toolbar menus can manage hidden columns:** `DataGridSortList` and `DataGridFilterMenu` accept
  `allColumns` (default `false`), which lists every column instead of only the visible ones. The
  default menu logs a development warning when a filter targets a column it cannot list.
- **Undo history dataset and stack size:** `useDataGridHistory` accepts `datasetKey` — a change
  clears both stacks (a dataset swap), and its result now exposes `historySize` (undo-stack
  length).
- **Pagination reconciliation and window:** `useDataGridPagination` accepts `reconcilePage`
  (default `false`) — when the current page is out of range, it calls the consumer's
  `onPageChange` with the clamped page. `DataGridPaginationBar` accepts `onPageSizeChange` (page-
  size changes from the footer select) and `windowSize` (number of page buttons around the
  current page; default `5`).
- **Export failure and scale controls:** `DataGridExportButton` accepts `onError(error, format)`
  for a failed export (without it, the failure logs a development-only warning). The export
  options gain `csvDelimiter` (`",""`, `";"`, `"\t"`; CSV only) and `maxRows` (truncates with a
  development warning). `buildXlsx(state, options)` is exported with `BuildXlsxOptions`
  (including `workbookName`) for server uploads or workbook inspection without a download.
- **Shared selected-view-row selector:** the `data-grid` barrel exports `getSelectedViewRows` —
  the single core derivation of the selected rows' view indices, now shared by the context menu
  and the IO export.
- **Typed streaming patches:** `CellPatch` and `RowPatch` accept an optional type argument — the
  columns' `id` union — so a typo'd column id fails to compile instead of skipping silently at
  runtime.

### Changed

- **Row reorder is now marker-gated and zone-based:** the drag-to-reorder gesture only arms from
  the `reorder`-family marker modes (`rowMarkers="reorder"`, `"reorder-number"`,
  `"reorder-checkbox"`, `"reorder-both"`) — plain `number`/`checkbox`/`both` markers are pure
  row-select surfaces, so a selection drag can never reorder by accident. Within the reorder
  family the press location decides the behavior: a drag from the grip zone (grip handle plus
  cell background; the whole cell in `reorder` mode) reorders the row; the number and checkbox
  glyphs stay row-select surfaces (click selects/toggles, drag selects a range); a stationary
  grip press selects the row without arming a reorder; Shift+drag from the grip always selects.
  Custom-rendered markers (a `renderMarker` without the built-in marker attributes) are
  selection-only and never reorder.
- **Toolbar on narrow screens:** `DataGridToolbar` now scrolls horizontally when its controls
  outgrow the container (mobile viewports) instead of clipping the last controls.
- **Simplified install:** `npx shadcn add @gridcn/<item>` now resolves the hosted `@gridcn`
  registry directly — the separate `npx shadcn registry add "@gridcn=…"` step is no longer needed.
  The GitHub registry path (`npx shadcn add DammersCode/gridcn/<item>#<ref>`) remains the way to
  pin a tag, branch, or commit.
- **Byte-level output change:** CSV exports now start with a UTF-8 BOM by default, so Excel detects
  UTF-8 (without it, umlauts and other non-ASCII characters opened as mojibake). Opt out with
  `csvBom: false` on `exportGrid`. Related additions: `.tsv` files are now accepted on import
  (the import dialog's `accept` includes them), `IMPORT_CANCELLED_MESSAGE` is re-exported from the
  `data-grid-io` barrel, and `useDataGridState`'s `history` object now exposes `clear` (empties
  both undo/redo stacks). `number`'s `options.step` is marked `@reserved` (accepted, no-op for now).
- Linting moved from ESLint to **oxlint** (`pnpm lint` — whole-repo, ~0.2s): the two structural
  import-boundary rules (barrel-only cross-item imports, core-never-imports-an-add-on) now run as
  `scripts/verify-import-boundaries.mjs` in the same script, and the type-checked `no-unsafe-*`
  gate on registry source stays a separate, slower `pnpm lint:typed` step (type-aware rules need
  TypeScript's type information, which a parser-only linter cannot see).
- Distribution: gridcn is now installable as a [shadcn GitHub registry](https://ui.shadcn.com/docs/registry/github) —
  `npx shadcn add DammersCode/gridcn/<item>`, no namespace registration or registry server needed.
  Same-repo `registryDependencies` use full GitHub item addresses. The hosted `@gridcn` namespace remains
  available from any host that serves the committed `public/r/` payloads (for example a Vercel deployment of
   the documentation site). The dead `gridcn.dev` links in the docs are replaced by the GitHub registry.
- **A11y:** sorted columns now expose `aria-sort` (`ascending`/`descending`/`none`) on the header
  whenever the column is sortable, independent of `headerClickBehavior` (whose default `select`
  previously hid the sort state from screen readers). The visual indicator stays gated on the
  click behavior as before.
- **Lazy grids:** function-form row/cell callbacks (`readOnly(row)`, `getRowClassName`, and the
  function forms of `getCellClassName` / `column.cellClassName`) are now skipped for unloaded
  (hole) rows instead of being called with `row: undefined`, so the documented
  `readOnly: (row) => row.locked` pattern no longer throws while scrolling into an unloaded
  window.
- **Row operations:** `insertRows` / `deleteRows` / `duplicateRows` now rebuild the view
  (row count, windowing, `aria-rowcount`) immediately and respect the active sort/filter, so a
  sorted grid no longer shows a stale row set after an insert/delete/duplicate. The three ops
  are now no-ops with a development warning while an edit session is open (matching
  `reorderRows`), and the keyboard `duplicateRow` binding duplicates the selected rows — falling
  back to the active row — instead of only the active one, matching the context-menu item that
  displays that shortcut.
- **Streaming:** `updateCells` with `reorder: "immediate"` now defers the view re-sort while an
  edit session is open, so a live feed can no longer pull the edited row out from under the open
  editor.
- **Breaking:** the `data-grid-fill` barrel no longer exports the pipeline internals
  `readRectAsText`, `buildFillCandidates`, `buildFillWrites`, `UseFillHandleOptions`, and
  `FillHandleHandlers` (never documented; `useDataGridFill` and `FillArgs` are unchanged).
- **`data-grid-lazy` JSDoc:** the `overscan` (30) and `batchSize` (50) defaults are now stated
  directly instead of linking to module-private constants.
- **Def-level `hidden: true` is now initial-only:** a column's def-level `hidden: true` seeds
  the hidden set, but `setColumnHidden(id, false)` (or the columns menu) can re-show it; the
  def flag re-applies only when a new `columns` array is passed. The toolbar menu checkbox and
  the `onColumnLayoutChange` snapshot now report the actual visibility instead of lying about
  re-shown def-hidden columns.
- **Edit draft survives mid-edit re-renders:** the pending edit value is re-seeded only while
  not editing, so a stream tick, search toggle, or cell-error re-render no longer resets an
  in-progress edit to the last-committed value (the documented "seeded at editor open"
  contract).
- **Number editor seeds from the displayed value:** the number editor now seeds its draft with
  the option-formatted text (`toText(value, options)`), so `decimals: 2` and value `1.2345`
  open the editor showing `1.23`, matching the cell display.
- **`data-type` attribute is always present:** cells now carry `data-type` with the column's
  type, defaulting to `text`, so `[data-type="text"]` selectors match default-typed columns.
- **Copy truncation warns in development:** copying a selection over the cell cap now warns
  once in the browser console (parity with the paste cap); the cap and the fallback behavior
  are unchanged.
- **Lazy grids and aggregates/fill/history degrade with a dev warning instead of silently or
  by throwing:** `useDataGridAggregate` over a sparse lazy array reduces the loaded rows only
  (a dev warning names the skipped holes — dataset-wide totals must come from the server or be
  computed outside the grid); a fill over unloaded rows warns once when it skips them; and
  `useDataGridHistory.undo()` warns once if it ran over a sparse data array (use a
  hole-tolerant `getRowId` and `clear()` on `lazy.reset()` or a dataset swap). The docs gained
  matching callouts (pinned-rows, fill, undo-redo, lazy-loading).
- **Docs consistency:** the clipboard page now documents `processPaste`'s real
  `(cells, target)` signature, the copy/paste cell caps, and the silent readOnly-cell skip;
  streaming-updates documents the async-validation hold/supersede contract and the readOnly
  no-op; Space is listed as an edit trigger; the accessibility page documents `aria-sort` and
  `aria-readonly`; events-state documents the `searchText`/`onSearchTextChange` controlled
  pair;   the custom cell-types page states what Tab actually does in built-in editors; and the
  url-state page documents the reset-page-to-1 contract on a page-size change and flags
  `DataGridUrlState` as incompatible with lazy grids.
- **Streaming verdicts:** `updateCells` and `updateRows` now return a verdict —
  `{ applied, skipped, pending }`. `skipped` names every patch that was not written, with its
  index in the patch list and a reason (`unknown-row`, `unknown-column`, `hole`, `readonly`,
  `invalid`, `no-op`); `pending` is `true` while an async schema holds the batch (its outcome is
  not reportable on the return value).
- **Import rejects are reported:** `buildImportedRows` now returns `{ rows, rejected }` instead
  of the row array — `rejected` (`ImportRejectedCell[]`) lists every cell that failed its column's
  `validate` and was cleared, with the data row, the source column, and the grid column. **Breaking**
  for code that called `buildImportedRows` directly and read the array. The import dialog shows
  the rejected-cell count and stays open until you close it.
- **Import merge lifecycle:** `DataGridImportDialog`'s `onImport` may return a Promise (e.g. a
  server upsert). The dialog stays pending until the promise settles; a rejection shows an error
  and the import can be retried. `parseImportFile` accepts an optional `AbortSignal` — the file
  read aborts when a newer file is chosen or the dialog resets.

### Fixed

- **Stale sheet re-parse:** a slow sheet re-parse can no longer overwrite the preview of a
  newly chosen file (generation guard on file load and reset).

### Added

- Coverage thresholds (branch-level, ~85-90% floor) enforced in CI for every pure-lib module —
  selection math, `CompactSelection`, clipboard parse/serialize, fill/series inference, sort/filter
  matching, keymap matching, history, url-state serializers, CSV/XLSX import/export helpers, and
  context-menu target resolution.
- `LICENSE` (GridCN Source Available License).
- `data-grid-lazy` add-on: `useDataGridLazyRows` + `DataGridLazyGuard` for fetching rows on demand
  as the viewport scrolls, instead of loading the full dataset up front.
- `data-grid-sort-list` add-on: toolbar sort button + popover for adding/removing/reordering
  multi-column sorts (drag handle or ArrowUp/ArrowDown while focused), mirroring the filter menu's UX.
- Multiplayer presence highlights: `presenceHighlights` prop paints other users' live selections as
  named, colored overlays, independent of the local selection.
- tablecn-parity filter and sort popovers: drag-to-reorder (and keyboard ArrowUp/ArrowDown)
  reordering for both the filter menu's rows and the sort-list's rows, with a live-region
  announcement on each move.
- Two-stage Ctrl+A (Excel/Sheets parity): the first press selects the active cell's contiguous data
  region, an immediate second press selects the whole grid; any selection change, active-cell move,
  or edit resets the progression back to stage one.
- The grid's empty-state text is now wired to `labels.grid.emptyState` (translatable), with the
  `emptyState` prop still taking precedence when provided.
- Type-to-replace (Excel parity): typing a printable key on an active cell now starts an edit
  seeded with the typed character (replace mode — the first character replaces the value, like
  Excel). Behavior change: printable keys without a keymap binding used to be no-ops; define
  `keymap.editReplace` (even `[]`) to take the action over and suppress the implicit fallback.
  `editReplace` is a first-class remappable keymap action — a printable binding (e.g. a letter)
  seeds the typed char, a non-printable binding (e.g. F3) starts a plain edit.

### Changed

- README rewritten to describe the actual shipped feature set (pinned rows, controlled props,
  styling API, url-state) and point to the docs site instead of the generic Fumadocs scaffold text.
- **Breaking:** `data-grid-pagination`'s `DataGridPagination` component was replaced by a composable
  `DataGridPaginationBar` plus standalone parts (`DataGridPaginationRange`, `DataGridPaginationPageSize`,
  `DataGridPaginationFirst`, `DataGridPaginationPrev`, `DataGridPaginationPages`,
  `DataGridPaginationNext`, `DataGridPaginationLast`), so consumers can rearrange or restyle the
  footer instead of accepting one fixed layout.
- **Breaking:** Multiplayer presence extracted out of core into a new `data-grid-presence` add-on
  (workplan #48). Core's `presenceHighlights` state/prop, `setPresenceHighlights` action,
  `useDataGridHighlights` hook, and the `PresenceHighlight` type are all removed — install
  `@gridcn/data-grid-presence` and call its `useDataGridPresence()` hook instead. Core gains one new
  seam in exchange: `overlayPlugins` on `DataGridProvider`/`DataGrid`, a generic overlay-plugin slot
  `DataGridOverlays` renders after its built-in range/band layers (but before the local active-cell
  ring) — `data-grid-presence` is the first consumer, `data-grid-fill` (below) the second.
- **Breaking:** The fill handle extracted out of core into a new `data-grid-fill` add-on (workplan
  #48 cut #2), reusing the overlay-plugin seam the presence extraction built. README/docs
  positioning updated: core is now range selection + Excel clipboard + editing engine; the fill
     handle is its own free add-on, one `npx shadcn add @gridcn/data-grid-fill` away. Removed from
  core: `useFillHandle`, `FillHandleHandlers`, `FillPatternArgs`, the `fillPreview`/`setFillPreview`
  store state, `DataGridRoot`'s `onFillPattern` prop, and `DataGridOverlays`'s `fillHandleHandlers`
  prop — install the add-on and call its `useDataGridFill()` hook instead (`onFillPattern` is now
  an option to that hook). `GridAction`'s `fillDown`/`fillRight` and their `DEFAULT_KEYMAP` bindings
  stay in core (two string literals are cheaper surface than a fully extensible-action mechanism);
  without the add-on both keys are silent no-ops, matching every other optional-callback seam.
- **Breaking:** Pinned rows extracted out of core into a new `data-grid-pinned-rows` add-on
  (workplan #48 cut #3). Unlike presence/fill (which register into the `overlayPlugins` paint
  seam), pinned rows affect band heights and `aria-rowcount`, so core needed a seam available
  SYNCHRONOUSLY at first render instead of a mount-effect registration: `DataGridProvider`/`DataGrid`
  gain `rowBands` (a `RowBandsSpec`), and `DataGridRoot`/`DataGridProvider`'s `pinnedTopRows`/
  `pinnedBottomRows` props are removed, along with `DataGridPinnedRow`/`DataGridPinnedRowBand` and
  their barrel exports — install `@gridcn/data-grid-pinned-rows` and call its
  `useDataGridPinnedRows({ top?, bottom? })` hook instead, passing its `rowBands` result straight
  into `rowBands`. v1 semantics are unchanged (separate arrays from `data`, readOnly by default, not
  navigable, excluded from sort/filter/selection). Core also now exports `DataGridCell` and
  `WindowedColumn` from its barrel, since the add-on's moved `DataGridPinnedRow` needs both.

### Fixed

- The empty-state row no longer renders a hardcoded "No data" literal that i18n consumers couldn't
  translate.

## 0.1.0

Initial build-out. Highlights, in rough chronological order:

- **Core engine** (`data-grid`): range selection (anchor + rectangular range, ctrl-click
  multi-range, row/column channels), full keyboard navigation and extension, Excel-style clipboard
  (TSV + HTML table, quoted/multiline cells), fill handle with series inference (arithmetic runs,
  zero-padded numbers, prefix+number sequences), built-in cell types (text, number, checkbox,
  select, date), typed `defineColumns<TData>()`.
- **Virtualization & scroll performance**: windowed row + column rendering, `isScrolling`-gated
  synchronous commits, velocity-aware overscan — smooth at 100k rows, verified with an FPS-probe
  regression harness.
- **Pinned rows**: `pinnedTopRows` / `pinnedBottomRows` sticky bands, pixel-aligned with pinned
  columns and column resize.
- **Controlled/uncontrolled**: sort, filter, and search all work uncontrolled by default, or fully
  controlled via matching value + `on*Change` props; a programmatic styling API alongside the
  CSS-token theming surface.
- **Add-ons** (each a separate registry item, depending only on `@gridcn/data-grid`):
  - `data-grid-history` — undo/redo.
  - `data-grid-toolbar` — search, filter, column visibility.
  - `data-grid-context-menu` — cell/header/row context menus.
  - `data-grid-keybindings` — keyboard-shortcuts reference dialog.
  - `data-grid-io` — CSV/XLSX import and export.
  - `data-grid-url-state` — sort/filter/search state synced to the URL via `nuqs`.
- **Registry distribution**: namespaced `@gridcn` registry, `npx shadcn build` + import-rewrite
  postbuild, cross-item `registryDependencies`, fresh-project install smoke tests (Next.js + Vite,
  including non-default import aliases).
- **Docs site**: Fumadocs-based site with a live hero demo and a feature page + live
  `<ComponentPreview>` per feature area, plus an auto-generated API reference.
- **i18n**: every user-facing string across core and add-ons routed through one typed `labels`
  object with English defaults and deep-merge overrides.
