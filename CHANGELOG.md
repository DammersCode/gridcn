# Changelog

All notable changes to gridcn are documented here. Since gridcn ships through the shadcn registry
rather than npm, there is no package semver — this file, plus each item's stable file layout, is
the upgrade story. Re-run `npx shadcn add @gridcn/<item>` to pick up changes; the CLI diffs and
prompts before overwriting files you've edited.

The format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Added

- Manual install without the CLI: the Manual tab of the installation docs now links every core
  source file (and folder) to its page in the GitHub repository, so the source folder can be
  copied straight from GitHub into `components/` — the same payload the CLI installs.

### Changed

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

### Added

- Coverage thresholds (branch-level, ~85-90% floor) enforced in CI for every pure-lib module —
  selection math, `CompactSelection`, clipboard parse/serialize, fill/series inference, sort/filter
  matching, keymap matching, history, url-state serializers, CSV/XLSX import/export helpers, and
  context-menu target resolution.
- `LICENSE` (MIT).
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
  handle is its own free MIT add-on, one `npx shadcn add @gridcn/data-grid-fill` away. Removed from
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
