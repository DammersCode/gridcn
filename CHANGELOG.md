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
