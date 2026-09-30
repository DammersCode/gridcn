# Changelog

All notable changes to gridcn are documented here. Since gridcn ships through the shadcn registry
rather than npm, there is no package semver — this file, plus each item's stable file layout, is
the upgrade story. Re-run `npx shadcn add @gridcn/<item>` to pick up changes; the CLI diffs and
prompts before overwriting files you've edited.

The format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Added

- **Custom keymap commands (`data-grid`):** the `DataGridProvider`/`DataGrid` `commands` prop
  accepts `Record<string, GridCommand>` — consumer actions behind `keymap` bindings that name
  no built-in action. Each `GridCommand` (`{ run, when?, label?, group? }`) receives
  `GridCommandCtx` (`{ actions, cell, row, readOnly }` — `cell` in view space, `row` the active
  cell's data row) and may gate itself with `when`; `label` and `group` set its row in the
  keybindings dialog. A command name shadowing a built-in action wins over the built-in; an
  unbound-and-unhandled name is a no-op (both warn once in dev). `GridActions` is now an
  interface you can extend by declaration merging (like `GridCellTypes`), `GridAction` is
  `keyof GridActions`, and `useDataGridCommands` returns the current `commands` map. `GridCommand`,
  `GridCommandCtx`, and `CommandGroup` are exported from the `data-grid` barrel; the
  `data-grid-keybindings` dialog lists custom commands with their label and group. See
  [Keybindings: Custom commands](/docs/addons/keybindings#custom-commands).
- **Imperative grid handle (`data-grid`):** `DataGrid` accepts a `ref`, and a new
  `useDataGridApi(ref?)` hook (call it under `DataGridRoot` for manual composition) return the
  same stable `DataGridApi` object for the grid's lifetime. Members: `actions` (the
  `useDataGridActions` object), `store` (the `useDataGridStoreApi` store), `scrollTo(ref)`
  (stable-`CellRef` scroll), `focus()` (lands on the active cell; no-op while an edit session is
  open), `startEditing(ref)` / `stopEditing()` (the latter discards the draft, `cancelEditing`
  semantics), `getSelection()` (non-reactive snapshot), `setSelection(ref | null)` (single-cell
  selection or clear), `getRow(viewRowIndex)` and `getViewRowIds()` (non-reactive reads in view
  order; `getViewRowIds` gives `undefined` for an unloaded lazy row). `DataGridApi` and `useDataGridApi` are exported from the `data-grid` barrel.
- **Cell-type-driven behavior:** five new optional fields on `CellType`. `numeric` declares
  tabular-nums digit rendering (declared by `number` and `date`). `toSearchText(value, options)`
  supplies the quick-search text for a stored value (the default is the type's `toText`; `select`
  declares it, so select columns now search the choice label). `validate` is the default validator
  for columns of the type when the column declares none — every validation path resolves
  `column.validate ?? cellType.validate` (single-cell commit, paste, fill, `updateCells`, import).
  `activate(value, options)` gives the cell an in-place edit gesture instead of an editor —
  Enter/F2, a stationary click, and a double-click commit `activate(value, options)` directly,
  with no edit session (declared by `checkbox` as the toggle). `filter` (`{ operators?,
  match?, valueInput? }`) declares the type's filter capabilities — the filter menu's operator
  list (ahead of the type-name default, behind the column's `filterOperators`), a raw-value
  match predicate (same contract as the column's `filterMatch`), and the filter row's value
  widget (`"text" | "number" | "date" | "boolean" | "choices"`). `CellTypeFilter` and
  `CellTypeValueInput` are exported from the `data-grid` barrel, along with the operator arrays
  `TEXT_FILTER_OPERATORS` and `COMPARISON_FILTER_OPERATORS` for declaring custom lists.
- **Grid event API:** six new optional props on `DataGrid`/`DataGridProvider`. `onActiveCellChange(next)`
  fires when the active cell becomes a different cell or is cleared (`null`). `onEditStart(coord)`
  fires before an edit session opens and may return `false` to veto the edit. `onEditEnd(event)`
  fires with `{ coord, result: "commit" | "cancel" | "rejected" }` — `rejected` fires per refused
  commit attempt while the session stays open. Each session ends with exactly one `commit` or
  `cancel`: a filter, hidden column, or data change that drops the edited cell, and a second
  `startEditing` over an open session (which ends the old session first), report `cancel`.
  `onValidationError(event)` fires after a bulk paste or fill settles, only when at least one
  cell was rejected by validation:
  `{ source: "paste" | "fill", rejected: [{ rowId, columnId, viewRowIndex, value, message }] }`.
  `onCellDoubleClick` and `onCellContextMenu` fire on the matching cell gesture with the
  `CellClickCtx` shape plus the native `MouseEvent`; both are pure notifications, not veto points.
  Payload types `GridEditEndEvent`, `GridValidationErrorEvent`, and `GridBulkValidationError` are
  exported from the `data-grid` barrel.
- **Menu resolvers (`data-grid-context-menu`):** the context menu and the header dropdown are now
  data. `DataGridContextMenu.getCellMenuItems(ctx, defaults)` and
  `DataGridContextMenu.getHeaderMenuItems(ctx, defaults)` receive the built-in item set as a
  `GridMenuItemSpec[]` array (`defaults`) and return the complete item set — filter it by the
  stable built-in ids (`cut`, `copy`, `paste`, `clear-contents`, `insert-row-above`,
  `insert-row-below`, `duplicate-rows`, `delete-rows`; `sort-asc`, `sort-desc`, `clear-sort`,
  `pin-left`, `pin-right`, `unpin`, `hide-column`, `autosize`), reorder it, extend it, or build
  a custom set. `getHeaderMenuItems` applies to the right-click header menu AND to every
  `DataGridHeaderDropdown` rendered inside the wrapper; `DataGridHeaderDropdown` also accepts
  `getHeaderMenuItems` directly (it overrides the wrapper's resolver for that dropdown).
  `GridMenuItemSpec` (item: `id`, `label`, `icon`, `shortcut`, `disabled`, `destructive`,
  `tooltip`, `onClick`; separator: `id`, `separator: true`) and the ctx/resolver types are
  exported from the add-on barrel. A `disabled` item never runs its `onClick`, with or without a
  `tooltip`.
- **Custom cell-type helpers:** `defineCellType(key, type)` adds a compile-time check at the
  definition — the key must be a registered cell-type key (your `GridCellTypes` augmentation)
  and the type's value/options must match that key's declared shape; it costs nothing at runtime
  and returns the entry as-is. `useCellEditor(props, codec)` is the text-input editor primitive
  the built-in `text` and `number` editors are built from: it owns the draft state (seeded from
  `initialText`, or `codec.toDraft(value)`), the end-caret focus, the one-shot commit guard
  (re-armed when `rejectionCount` rises), and the Enter/Escape/blur bindings, and returns
  `{ ref, value, onChange, onKeyDown, onBlur, readOnly }` to spread onto an input. `CellEditorCodec`
  is its `{ toDraft, toValue }` codec type.
- **Typed `options` on cell components:** `CellRenderProps` and `CellEditorProps` carry an
  `options` prop typed as the type's declared `TOptions` (a third type parameter on both). Cell
  and editor components destructure it directly instead of casting `column.options`; the
  built-ins no longer cast.

- **Composition parts take props:** `DataGridHeader` accepts `className` for its header-layer
  element and `renderHeaderCell`, a per-column header cell slot. The slot is called with the
  column context — every built-in header cell prop — and `Default`, the built-in cell for that
  column pre-wired with exactly those props. Return `Default` to keep the built-in cell or a
  custom node to replace it. `DataGridBody` accepts `className` for its rows-canvas element.
- **`emptyState` accepts a function:** it receives `{ reason }`. The reason is `"no-data"` when
  the data array is empty and `"filtered"` when rows exist but none are in view. A plain node
  still works.
- **New `loadingState` prop:** it replaces the built-in loading presentation while `loading` is
  true — the skeleton (zero rows in view) or the indeterminate bar under the header (rows
  present). Its function form receives `{ reason: "no-data" | "rows-present" }`.

- **Shortcut label API:** `data-grid` exports `isMacPlatform()`, `formatShortcut(binding)`, and
  `formatShortcutToken(segment)` so consumer UI can render shortcut labels that match the grid's
  own keycaps (glyphs on macOS and iOS, word names elsewhere). The keybindings and context-menu
  add-ons now use this shared API; on macOS the keybindings chips render `⇧` for Shift.

- **Agent skills:** `npx skills add DammersCode/gridcn` installs five skills for Claude Code,
  Cursor, Codex, and other agents: `gridcn-performance`, `gridcn-custom-cell-type`,
  `gridcn-data-source`, `gridcn-addons`, and `gridcn-upgrade`. The
  [Agent Skills](https://gridcn.vercel.app/docs/agent-skills) page describes each one.
- **Column lines:** a 1px line separates columns in the header, the body, the marker column, and
  pinned row bands. A right-pinned column draws its line on the start side, so the line marks the
  pinned band edge. `--grid-column-border` sets the color (default `--color-border`;
  `transparent` hides the lines).
- **Row insert-above and delete-rows shortcuts:** `insertRowAbove` (`mod+shift+u`) and
  `deleteRows` (`mod+shift+Backspace`) join `insertRowBelow` and `duplicateRow` in
  `DEFAULT_KEYMAP`; the context menu's Insert row above and Delete row(s) items now show their
  shortcuts too.
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
- **Number stepping:** `number` columns step with ArrowUp/ArrowDown in the editor — by
  `options.step` (default 1), clamped to `min`/`max` and rounded to `decimals`. A cleared draft
  steps from the committed value.
- **`DataGrid` wrapper `renderHeaderMenu` prop:** the batteries-included `DataGrid` now forwards
  `DataGridRoot`'s `renderHeaderMenu` header-menu slot (the barrel also exports the
  `HeaderMenuRenderer` type). A compile-time guard pins the wrapper's prop surface against
  `DataGridRootProps`, so a future root prop the wrapper fails to forward is a build error.
- **Clipboard outcomes for programmatic copy/cut:** `useDataGridClipboard`'s `copy()` and `cut()`
  now resolve to `"ok"` (the async Clipboard API accepted the write), `"fallback"` (the legacy
  `execCommand` text-only path reported success), `"failed"` (both paths failed), or
  `"no-selection"` (nothing was selected). `**Breaking:**` `cut()` now awaits the write and only
  clears the selection when it succeeded and the selection is unchanged — a failed cut keeps the
  selection and writes no `onDataChange`.
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
- **Context menu item slots:** `DataGridContextMenuProps` accepts `renderCellMenuItems` and
  `renderHeaderMenuItems` render props. The cell slot receives `{ row, columnId, canInsertRow,
  canDuplicateRow }`, the header slot `{ columnId, scrollRoot }`; the returned items replace the
  built-in set, so consumers own which items show, their order, and their gating.
- **Column layout reset and clamped width writes:** the store gains `resetColumnWidth(id)` —
  drops the width override, restores the column to flex distribution, and fires
  `onColumnLayoutChange` once. `setColumnWidth`/`commitColumnWidth` now clamp to the column's
  `minWidth`/`maxWidth` (and the 32px floor) at write time, so a persisted width is always a
  renderable one.
- **Layout tuning props:** `DataGridRoot` and `DataGrid` accept `headerHeight` (default `36`)
  and `columnOverscan` (column-window overscan, default `1`). The 150px default column width and
  the 32px resize floor are now documented.
- **Global shortcuts beyond undo/redo:** `DataGridGlobalShortcuts` takes one `true` flag per action
  (`<DataGridGlobalShortcuts selectAll deleteRows />`); no flag keeps undo and redo, any flag enables
  exactly the flagged actions. The flags come from the new `DataGridGlobalShortcutActions`
  interface: the core offers `selectAll` and the row actions, `data-grid-history` adds `undo`/`redo`,
  and `data-grid-fill` adds `fillDown`/`fillRight`, so an add-on's flags exist only once it is
  installed. Each flag runs the grid's own keymap dispatch, like its in-grid binding.
- **Dropzone:** a dependency-free `dropzone` item (drag and drop or click, accept/size/count checks,
  a compact variant). The `data-grid-io` import dialog uses it to choose a file, and its compact
  variant replaces the file during column mapping.
- **Typed aggregate reducers:** `useDataGridAggregate` and its `AggregateReducer`/`AggregateSpecs`
  types accept a `TData` type parameter, so a typed reducer no longer needs a cast. An aggregate
  spec key that matches no column now logs a development warning instead of silently reducing
  nothing.
- **Presence entry lifecycle:** `useDataGridPresence` gains `removePresenceHighlight(id)` (removes
  one entry; no-op when nothing matches) and `clearPresenceHighlights()` (peer disconnect / room
  empty) beside the snapshot `setPresenceHighlights`.
- **Presence rect budget is configurable:** `useDataGridPresence` accepts `maxRects` (default
  `MAX_RESOLVED_RECTS`, now exported from the barrel) and `onExcessRects(entry, kept, total)`,
  fired once per entry when a range's fragments exceed the budget (the development warning still
  fires in dev).
- **Re-applying URL state:** `useDataGridUrlState` now returns `{ applyFromUrl }` (the
  `UseDataGridUrlStateResult` type is exported). The mount apply still runs once; call
  `applyFromUrl()` when the URL changed outside the grid's own writes — back/forward, a framework
  `setSearchParams`, or a query-only route change.
- **URL pagination gains `total` and resolved `pageSizeOptions`:** passing `total` clamps an
  out-of-range deep-linked `page` to the last page on mount and writes the clamped value back to
  the URL. The hook's result carries the resolved `pageSizeOptions` (so the bar's page-size select
  and the URL allow-list stay the same list), and the pagination barrel exports
  `DEFAULT_PAGE_SIZES`.
- **Custom fill series detection:** `useDataGridFill` accepts `detectSeries` (a
  `SeriesDescriptor`-returning detector replacing the built-in one; `null` falls back to
  tiling), and `generateFill` accepts the same detector through `GenerateFillOptions.detect`.
  Date series remain undetected by the built-in detector — that is what the option is for.
- **Raw-value filter predicates and per-column operator lists:** `ColumnDef` gains
  `filterMatch(value, filter)` — a per-column predicate over the cell's RAW value (not its
  stringified form) that replaces the built-in matcher for that column — and `filterOperators`
  (the operator list the filter menu offers for the column). `DataGridFilterMenu` accepts
  `operatorsForColumn(column)`; resolution order is that prop, then the column's
  `filterOperators`, then the built-in default for the cell type.
- **Compile-time URL operator drift guard:** a type test pins the URL-state add-on's filter
  operator set against the core `FilterOperator` union — a new core operator fails the type gate
  instead of silently dropping out of URL round-trips.
- **CSS hooks for the remaining hard-coded visuals:** `--grid-flash-duration` (default `1.2s`,
  `0s` turns the pulse off), `--grid-flash-intensity` (`24%`), and `--grid-flash-color` (primary)
  tune the write pulse after paste, fill, and replace; `--grid-loading-sweep-duration` (`1.2s`) the
  loading bar; `--presence-label-foreground` (white) the presence name chip. The dropzone root
  carries `data-drag-active` and `data-disabled`, and `GRID_ATTR.pagination` names the pagination
  footer's `data-grid-pagination` attribute. The styling guide gains "Override recipes" for the
  selection, active cell, marker cell, invalid cell, and search match. Defaults are unchanged.
- **Docs example for pinning all four sides:** `data-grid-pinning-all-sides-demo` (Examples → Rows &
  Selection → Pinning) combines pinned left/right columns with pinned top/bottom row bands.
- **Docs examples for menu slots and operator lists:** `data-grid-context-menu-slots-demo` shows
  `renderCellMenuItems`/`renderHeaderMenuItems`; `data-grid-filter-operators-demo` shows
  `operatorsForColumn`, `ColumnDef.filterOperators`, and `DataGridSortList`'s `allColumns`.

### Changed

- **Breaking:** flash keys are row-id keyed (`data-grid`, `data-grid-sdk`). `flashCellKey(rowId,
  columnId)` takes a row id where it took a view row index, so a sort, filter, or reorder moves the
  write-pulse with its row instead of leaving it on another record for up to 1.4 s. The store's
  `flashingCells` holds the new keys. The `data-grid-sdk` barrel also exports `rowIdAtViewRow(state,
  viewRow)` to resolve the id for a view row.
- **Breaking:** `data-grid-io` reads and writes Excel files with `hucre` instead of
  `@e965/xlsx` (SheetJS). The registry item pins `hucre@1.1.0`; re-adding the item replaces the
  dependency. SheetJS inflated every part of an xlsx without a size cap, so a 311 KB file grew to
  300 MB before any import limit ran. hucre caps each inflated part at the new
  `maxDecompressedBytes` import limit (default 512 MiB, in `DEFAULT_IMPORT_LIMITS`, `importLimits`,
  and the `parseImportFile` options; rejected as `errorFileTooLarge`) and reads only the selected
  sheet, sized by its real cells. A sheet over
  `maxRows`, `maxColumns`, or `maxCells` is rejected, never truncated, also when its far rows sit
  behind empty rows. Changed results:
  - `.xls` accepts only Excel 97-2003 (BIFF8) workbooks. An HTML table, Excel 2003 XML, or Excel
    5.0/95 workbook saved as `.xls` is rejected with the new `labels.io.errorUnsupportedExcelFormat`
    message (`ImportErrorKey` gains `"errorUnsupportedExcelFormat"`). `.xls` cells come in without
    number formats: dates as ISO dates, numbers as their value. Every sheet of an `.xls` workbook
    must stay within `maxCells`.
  - The file content, not the extension, picks the reader: an xlsx renamed to `.xls` imports.
  - xlsx display text differs from SheetJS in edge cases: a General number keeps up to 15
    significant digits (`123456789012345`, not `1.23457E+14`), the built-in short date shows a
    four-digit year (`1/15/2024`), and error cells come in as their code (`#DIV/0!`, not empty).
  - xlsx exports are compressed (a 50k x 20 export drops from about 45 MB to about 7 MB), and a
    `workbookName` that Excel rejects as a sheet name (over 31 characters, `[ ] : * ? / \`, or
    `History`) rejects the export.
  - The lazy import chunk drops from about 160 KB to about 69 KB gzip, the export chunk to about
    66 KB; they share 50 KB.
- **Breaking:** quick search matches the cell type's display text; filters match the stored
  value. Search reads the type's `toSearchText`, else its `toText`, so a `select` column searches
  the choice label and a `number` column with `decimals` searches the rounded value. A column
  without a declared type searches the raw `String(value)`. Filters, the empty check, and the
  default sort read the raw value: `equals` and `isAnyOf` on a `select` column take choice
  values, so shared URL filters keep matching. Select label lookups are cached per `choices`
  array; pass a new array to change the choices.
- **`CellRef` is the public cell coordinate (Breaking):** `CellCoord` is renamed to
  `ViewCoord` (same `{ col, row }` shape — view space, not a `data` index). The cell actions
  `selectCell`, `setActiveCell`, `extendTo`, `pushRange`, `startEditing`, and `commitCellValue`
  now take a `CellRef` (`{ rowId, columnId }`) — the stable identity that survives sorting,
  filtering, and pagination — and each gains an `*At` variant that takes a `ViewCoord`
  (`selectCellAt`, `setActiveCellAt`, `extendToAt`, `pushRangeAt`, `startEditingAt`,
  `commitCellValueAt`). `useDataGridScrollToCell` now takes a `CellRef`; a new
  `useDataGridScrollToCellAt` takes a `ViewCoord`. A `CellRef` that no longer resolves (row
  removed from `data`, column hidden) is a no-op with one console warning per grid in
  development.
- **Cell contexts carry row and column identity (Breaking):** `renderCell` (and `Cell`
  components) rename `rowIndex` to `viewRowIndex` and add `rowId` and `columnId`. The
  `getCellClassName` ctx gains `rowId` and `columnId`. `CellClickCtx` (used by `onCellClick`,
  `onCellDoubleClick`, and `onCellContextMenu`) renames `rowIndex`/`columnIndex` to
  `viewRowIndex`/`viewColumnIndex` and adds `rowId`/`columnId`; `RowClickCtx` (used by
  `onRowClick`) adds `rowId`. The context menu's `getCellMenuItems` ctx renames `row` to
  `viewRowIndex` and adds `rowId`. `GridBulkValidationError` rejected entries add `rowId` and
  rename `viewRow` to `viewRowIndex`, as do `applyCellUpdates` entries.
- **Select quick search matches the choice label, not the stored value:** a `select` column's
  stored values are opaque choice ids; quick search now uses the option's `label` (its
  `toSearchText`). Custom types can declare their own `toSearchText` for the same control.
- **`resolveBulkWrites` returns the rejected cells too (Breaking, `data-grid-sdk`):** the
  validation tail of paste and fill now returns `{ writes, rejected }` (`BulkResolution`)
  instead of a plain write array — `rejected` carries every cell the validators refused, with its
  `message`, and feeds the new `onValidationError`. `buildPasteWrites` and `buildFillWrites`
  follow the same shape (the latter now returns `{ resolution, filled }`).
- **`renderCellMenuItems` / `renderHeaderMenuItems` replaced by menu resolvers (Breaking):** the
  two render-slot props of `DataGridContextMenu` are removed. Pass `getCellMenuItems` /
  `getHeaderMenuItems` instead — they return a `GridMenuItemSpec[]` item list (item-level
  control) instead of a React node (whole-set replacement only), and the header resolver also
  reaches the header dropdown.
- **`cellTypes` merges over the built-ins (Breaking):** the `cellTypes` prop previously REPLACED
  the whole registry — extending the built-ins required spreading them back in
  (`cellTypes={{ ...cellTypes, myType }}`). It now merges over them: unnamed built-ins keep
  working, a key that names a built-in replaces that built-in, and a key set to `null` removes a
  type (columns that then use the removed key fall back to the built-in `text` type and get the
  development warning). The warning checks the merged registry, so a column of a built-in type
  never warns when `cellTypes` names only custom types. Prop type is
  `Record<string, AnyCellType | null>`.
- **`gridcn-custom-cell-type` agent skill:** it now teaches the `cellTypes` merge semantics,
  `defineCellType`, `useCellEditor`, and the typed `options` prop instead of the old
  spread-the-built-ins pattern and the `column.options` cast.
- **Core barrel split into a consumer API and an add-on SDK (Breaking):** `data-grid` is now
  the consumer surface — components, props and ctx types, the state hooks, and the op/validation
  engines the docs teach. Add-on-internal seams move to a new `data-grid-sdk` module in the same
  install: `GRID_LAYER`/`cellLayer`/`GridLayer`, `pointerToCoord`/`InteractionLayout`, the
  direction math (`applyInlineScrollDelta` and friends, `GridDirection`), `useDataGridRootContext`
  /`DataGridRootContextValue`, `useDataGridStoreApi`, `useDataGridContainer`, `isDev`, the
  validation engine (`runValidateSync`, `runValidatePending`, `runValidateBatch`,
  `resolveBulkWrites`, `useBulkGeneration` and the bulk types), `combineRects`,
  `getSelectedViewRows`, `flashCellKey`, `measureColumnAutosizeWidth`, `GridColumnLayout`, and
  `WindowedColumn`. Add-ons import them from `data-grid-sdk`; consumer code that imported any of
  these from `data-grid` must switch to `data-grid-sdk`.
- **Typed raw store access:** `useDataGridSelector<TData>(selector, eq?)` hands the selector
  `state` with `state.data` typed as `readonly TData[]`; `eq` (default `Object.is`) controls
  re-renders.
  `useDataGridRow<TData>(viewRowIndex)` returns the typed row at a view index (unannotated it
  stays `unknown`, as before).
- **`useDataGridRowIdToViewRow` keeps its map across streaming ticks:** the `rowId -> view row`
  map now keys on a store-internal row-identity version (bumped only when rows move:
  insert/delete/duplicate/reorder, or a consumer `data` replacement) instead of the `data` array
  itself — value-only `updateCells` ticks no longer force the O(n) map rebuild, so consumers of
  the map stop re-rendering per tick. `getRowId` must return stable ids across value-only writes
  (row ids are identity, not content).
- **Selection changes fire only on real changes:** repeated `extendTo` at the same coord (a
  stationary drag), a clamped `extendSelection` at a grid edge, and a `selectRow`/`selectColumn`
  re-fire that leaves both channels and `lastHighlighted*` unchanged no longer replace the
  selection object. `onSelectionChange` and selection-keyed re-renders now fire only when the
  selection content actually changed.
- **`data-grid-io` swaps `xlsx` for `@e965/xlsx`:** the add-on's SheetJS dependency moves from
  `xlsx@0.18.5` to the community mirror `@e965/xlsx@0.20.3` (byte-identical sources, SLSA v1
  provenance, zero npm-audit vulnerabilities). The npm `xlsx` line stopped at 0.18.5 with two
  unpatched high-severity advisories. The API is unchanged; installers now add `@e965/xlsx`,
  pinned to `0.20.3` in the registry item, instead of `xlsx`.
- **Breaking:** CSV export neutralizes formula-like cells (`data-grid-io`): `exportGrid` now
  prefixes formula-like cells — leading `=`, `+`, `-`, `@`, TAB, or CR, plain numbers exempt —
  with a single quote, so Excel, LibreOffice, and Sheets open them as text instead of running them
  (a CSV carrying `=HYPERLINK("http://x")` no longer opens as a live formula). Pass
  `sanitizeFormulas: false` to `exportGrid` for the previous raw output. XLSX exports are
  unaffected: string cells never run as formulas. `rowsToCsv(rows, delimiter, sanitizeFormulas)`
  applies the same neutralization by default; pass `false` as the third argument for raw fields.
  `data-grid` exports the `sanitizeFormulaCell(value)` helper.
- **Clipboard formula sanitizing (`data-grid`):** the new `sanitizeClipboardFormulas` prop on
  `DataGrid` and `DataGridProvider` (default `false`) applies the same neutralization to
  Ctrl+C/Ctrl+X and the context menu's Copy and Cut, in both the `text/plain` and the `text/html`
  payload. A paste back into gridcn still restores the raw value. `useDataGridClipboard`'s
  `sanitizeFormulas` option overrides the prop for custom copy UI.

- **`overlayPlugins` identity warning names the real cost:** the dev warning ends with "or every
  render re-syncs the provider props into the store". `DataGridOverlays` does not re-render for a
  shallow-equal array.

- **Checkbox cells toggle on the first click:** a click on a checkbox cell's box toggles it, even
  when the cell was not active. A click elsewhere in the cell still selects it first. The box
  carries `data-grid-checkbox`.
- **Edge shadows on every scrollable side:** the grid shows its edge shadow on each side where
  content lies beyond the visible area, with or without pinned columns or rows. The shadow sits at
  the grid edge, or at the pinned band boundary when a band is pinned. Before, it appeared only at
  pinned bands. CSS variables configure them: `--grid-scroll-shadow` (edge shadow color;
  `transparent` hides them and keeps pinned-band shadows) and `--grid-shadow-size` (strip size,
  default `8px`). A shadow at a pinned band carries `data-pinned`. Each shadow spans only the
  scrolling area between the pinned bands, so shadows never cross the header, a pinned band, or
  each other.
- **Empty checkbox cells:** a checkbox cell with a `null` or `undefined` value renders nothing
  instead of an unchecked box. Pinned summary rows without a checkbox value stay blank.
- **All-sides pinning example:** the Average and Total rows leave Department, Location, and Active
  blank.
- **Context menu shortcut keycaps:** the cell menu shows each shortcut as `Kbd` keycaps (`Ctrl`
  `Shift` `U`, or `⌘` `⇧` `U` on macOS) instead of a `+`-joined string. The add-on ships
  `components/ui/kbd.tsx`.
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
  pair; the custom cell-types page states what Tab actually does in built-in editors; and the
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
- **Header-menu autosize commits:** the column menu's autosize now writes through
  `commitColumnWidth`, so it fires `onColumnLayoutChange` like the core double-click autosize,
  and the item is gated on the same `resizable`/resize-enable flags as the gesture.
- **Global shortcut dispatch:** the window layer now dispatches every enabled action through the
  grid's own keymap path (`dispatchGridAction`) instead of a hardcoded undo/redo branch — same
  guards, same scrolling, and `fillDown`/`fillRight` work globally when enabled.
- **Docs consistency:** the custom-cell-types page states the `cellTypes` registry's type
  erasure (per-key safety comes from `defineColumns` + `GridCellTypes` augmentation) and what a
  plain `ColumnDef` does or does not cross-check; the columns and events-state pages agree on
  what fires `onColumnLayoutChange` (drag release, double-click autosize, and menu autosize); the
  fill page documents `onFill.values` as the computed target-strip pattern (not a copy of the
  source range) and the `detectSeries` option; the sorting/filtering page documents
  `filterMatch`/`filterOperators`.

### Fixed

- **Selection follows the edited row on every view change (`data-grid`):** a controlled `sortState`,
  `filterState`, join, or search change and a consumer data replacement now move the selection
  with the edited cell too, not only the grid's own sort and filter actions. A multi-cell range
  collapses to the edited cell when its row moves.
- **`useDataGridEditing` return type (`data-grid`):** the hook's type now includes the `rowId`,
  `columnId`, and `session` fields the store always carried, next to `coord` and `initialText`.
- **Custom toolbars keep the mod+F capture (`data-grid-toolbar`):** a toolbar you build yourself
  that holds the `DataGridSearch` and carries the `data-grid-toolbar` attribute now scopes mod+F
  to its grid without a `data-grid-instance` attribute.
- **View-space presence warning covers every view change (`data-grid`, `data-grid-presence`):** the
  one-time development warning now also fires when a sort, filter, join operator change, or
  consumer data replacement rebuilds the view while a view-space presence entry is active. It
  used to cover only row operations and immediate `updateCells`.
- **Lazy rows warn about dropped edits (`data-grid-lazy`):** in development,
  `useDataGridLazyRows().onDataChange` warns once when a change targets a row that `evict()`
  removed before the merge. The edit is not written into another row.
- **Date cells reject rolled-over dates (`data-grid`):** typed, pasted, or imported non-ISO dates
  such as `Feb 30, 2026`, `02/30/2026`, and `2026-02-30T10:00Z` are rejected instead of landing
  on `2026-03-02`, also when they carry a time part. Text without a day, such as `Jul 2026` or
  `2026`, is rejected too. A datetime with an offset stores its local calendar day.
- **Fill keeps long identifiers intact (`data-grid-fill`):** a series whose number has more than 15
  digits tiles instead of extrapolating. `ID 1234567890123456789` no longer fills as `â€¦7000`, and
  a 400-digit number no longer fills as `xNaN`.
- **Context-menu Cut and Copy report failures (`data-grid-context-menu`, `data-grid`):** when the
  clipboard write fails, the menu disables Cut and Copy and shows the new
  `labels.contextMenu.clipboardFailed` tooltip ("clipboard access failed â€” use Ctrl+C or
  Ctrl+X"). A throwing `document.execCommand("copy")` resolves the copy as `'failed'` instead of
  rejecting.
- **Selection follows the edited row (`data-grid`):** while a cell is in edit mode, a sort, filter,
  or data change that moves its row moves the selection with the active cell. The range no longer
  paints on another record, and Shift+Arrow after Escape extends from the edited cell.
- **Pagination keeps deep links while data loads (`data-grid-pagination`):** server mode with
  `reconcilePage` no longer rewrites your page while `total` is `0`, so a deep link survives the
  first fetch. Client mode with an empty dataset shows page 1 of 1 instead of an out-of-range
  page such as "page 3 of 1"; your controlled page is left as it is.
- **Number editor stepping (`data-grid`):** ArrowUp and ArrowDown step by the column's `step`
  (default 1) and round the result to the finer precision of the draft and the step, so `0.1`
  steps read `0.3` instead of `0.30000000000000004`. The arrows do nothing while an async
  validation is pending or an IME composition is active.
- **Clipboard round trip keeps tabs, carriage returns, and non-breaking spaces (`data-grid`):** a
  cell copied from the grid and pasted back keeps its exact value when it holds a carriage
  return or a non-breaking space next to a tab. The HTML payload writes a carriage return as a
  character reference, which the HTML parser otherwise turns into a newline.
- **Resize and reorder gestures survive touch edge cases (`data-grid`):** a second touch on a
  column resize handle no longer selects the column or arms a reorder. A column or row reorder
  ends instead of blocking the next drag when the window blurs or when the element that held the
  pointer capture left the document.
- **Empty filter value selects show the placeholder (`data-grid-toolbar`):** an empty checkbox
  or select filter value shows the "Value" placeholder instead of a blank trigger. The filter
  row's selects pass their labels through the `items` prop of `Select`.
- **Restarted edit sessions start clean (`data-grid`):** a second `startEditing` on the cell that is
  already being edited opens the editor on the stored value (or the new `initialText`) instead of
  the old session's draft, and drops the old session's pending async validation instead of
  committing it into the new session. `editing` carries a `session` id, unique per started
  session; `useDataGridCellState` returns it as `editSession`.
- **Import dialog select labels (`data-grid-io`):** the delimiter and column-mapping selects show
  their labels ("Tab", the grid column's header, "— Skip —") instead of the raw values (`\t`,
  the column id, `__skip__`) before their popup first opens.
- **CSV import limits run before the parse (`data-grid-io`):** `parseImportFile` counts the rows
  and the fields of each CSV row without building them and rejects a file over `maxRows`,
  `maxColumns`, or `maxCells` before papaparse runs. A 49 MB file of delimiters used to allocate
  about 1.15 GB first, because papaparse builds a whole row before any callback sees it. The
  delimiter guess reads the first MiB of the file.
- **Import preview races (`data-grid-io`):** a delimiter or sheet re-parse started while a newer
  file loads no longer overwrites that file's preview, and a superseded file load that still
  resolves no longer replaces the newer file's preview.
- **Import drop zone size limit (`data-grid-io`):** the empty drop zone in the import dialog shows
  the size limit next to "No file chosen" (for example "No file chosen — up to 50 MB"). The dialog's
  description used to hide the Dropzone's own size caption. The text comes from the new
  `labels.io.maxFileSize(bytes)` label and follows `importLimits.maxFileBytes`.
- **An inline `cellTypes` literal no longer rebuilds the view on every render:** the grid reuses
  its resolved cell-type registry while the prop's entries keep their identity. A controlled
  `onDataChange` echo keeps its deferred sort order, an unrelated sync skips the view rebuild,
  and cells do not re-render.
- **`startEditing` honors `readOnly` and `activate`:** `actions.startEditing`/`startEditingAt`
  and the imperative handle's `startEditing` open no edit session on a `readOnly` grid or on a
  cell whose type declares `activate` (such as `checkbox`), the same gate as the keyboard edit
  gestures. Before, a programmatic call opened an editor on a `readOnly` grid, and its commit wrote
  through `onDataChange`.
- **Cut clears exactly the copied cells:** Ctrl+X and `useDataGridClipboard().cut()` (the context
  menu's Cut) capture the copied rows and columns by id and clear exactly those cells. A sort,
  filter, or data change during the clipboard write no longer clears whichever rows moved into the
  old view positions; a copied row that left the view stays untouched. A multi-range selection or
  a copy truncated at the copy cap clears only the cells that were copied.
- **An open edit stays bound to its row across view changes:** the store's edit session now anchors
  on the row's id and column id, not on its view position. A re-sort, filter, column reorder, or a
  consumer data swap that moves the edited row re-anchors the editor to the row's new view
  position, and the typed draft survives the move. When the row (or column) leaves the view the
  edit is cancelled and the typed value is discarded — it is never written into a row that is no
  longer visible, and a validation that resolves after the cancel no longer commits. A consumer
  data swap resolves the edited row in the new array, so later `updateCells` calls by `rowId`
  write to the right row.
- **`validateRow` no longer wipes a reused rowId's consumer errors:** the store's per-row record of
  which `cellErrors` entries its own `validateRow` verdicts own is now pruned whenever a row leaves
  `data` — a new row reusing a deleted row's id keeps its consumer `setCellErrors` entries across
  the next `validateRow` run instead of having them cleared.
- **Lazy rows no longer drop a just-landed fetch (`data-grid-lazy`):** `useDataGridLazyRows`'
  `onDataChange` now re-applies the change's ops to the latest sparse state instead of replacing
  the array with the grid's post-op snapshot — a snapshot taken before an in-flight fetch resolved
  no longer evicts the rows that fetch just wrote (row ops that change length apply cleanly too).
- **`mod+F` with several grids on one page:** `DataGridSearch`'s find-shortcut capture now scopes
  to the grid that holds focus (each provider stamps its root and toolbar with a `useId`-derived
  `data-grid-instance` marker) — pressing `mod+F` in grid A no longer moves focus into grid B's
  search input.
- **Import limits (`data-grid-io`):** `parseImportFile` now bounds every import against a memory/CPU
  DoS — a 16 KB xlsx with two far-apart cells used to build 100M cells. Files above 50 MB are
  rejected before they are read. A file with more than 1,000,000 rows, 1,000 columns, or
  5,000,000 cells (rows times columns) is rejected, never truncated: for xlsx/xls the real cell
  extent of the selected sheet is checked before any conversion, and only that sheet is parsed;
  CSV is checked after the parse. Both failure kinds surface with their own error messages
  (`errorFileTooLarge`, `errorTooManyCells`). `parseImportFile` accepts `maxFileBytes`,
  `maxRows`, `maxColumns`, and `maxCells`; `DataGridImportButton` and `DataGridImportDialog`
  accept the same fields as `importLimits`, whose `maxFileBytes` also sets the drop zone's
  `maxSize`. The `data-grid-io` barrel exports `DEFAULT_IMPORT_LIMITS` and the `ImportLimits`
  type; `useDataGridImportPreview` takes the limits as its third argument.

- **Pasted HTML:** the `data-gridcn-raw` cell attribute is now trusted only when it is the grid's
  own serialization of that cell (it renders back to the cell's exact innerHTML) — a crafted
  clipboard payload can no longer smuggle a value the user did not see into a paste.
- **URL state hardening:** the `filter` URL param parses at most 64 filters and reads at most 256
  raw segments. Each `isAnyOf` list holds at most as many entries as its column has `choices`
  (but never fewer than 64), or 1000 for a column with missing or empty `choices`. The `sort`
  URL param keeps one direction per column (first segment wins) and at most 64 sorts — a
  hand-edited URL can no longer express an unbounded view state. `parseFilterState` takes an
  optional `maxChoices` option, a function from a column id to its bound.
- **URL pagination hardening:** a URL `pageSize` is now gated by the pager's default size list
  (10/25/50/100) even when `pageSizeOptions` is omitted, and a URL `page` beyond 1,000,000
  falls back to 1 — an unbounded `?pageSize=` or `?page=` can no longer force a huge fetch.
- **Drag listener leaks:** a second pointer pressing a reorder grip, row-reorder marker, or resize
  handle while a gesture is in flight no longer arms a second document listener set, and an
  unmounted column-resize drag drops its document listeners.
- **Import dialog race conditions:** an aborted or superseded file load no longer clears the
  parsing state of a newer load, and `setDelimiter` re-parses with the parsing state, a generation
  guard against stale results, and a surfaced error instead of an unhandled rejection.
- **Missing documented keybindings:** `Backspace` and `Delete` on a focused `DataGridSortList` /
  `DataGridFilterMenu` row grip now remove that row, as the docs already stated.
- **Sort list row remounted on a column change:** `DataGridSortList` rows are keyed by their
  index, so changing a row's column updates it in place instead of remounting it and dropping the
  select's focus.
- **Search badge showed an out-of-range index for a frame:** when the match list shrinks (new
  search term, data change), `DataGridSearch` resets the match index during render instead of in a
  post-commit effect, so the badge never paints a stale count like "2/1".
- **Calendar-invalid ISO dates committed:** `date` cell input now rejects ISO-shaped but
  calendar-invalid values like `2026-02-30`, `2026-13-45`, and `2026-02-29` (a UTC round-trip
  probe, not `Date.parse`), so they can no longer commit; real leap days like `2024-02-29` still
  pass.
- **Deep-linked page lost while data loads:** `useDataGridUrlPagination({ total })` no longer
  clamps or rewrites `?page=` while `total` is 0, so a deep link survives until the real total
  arrives; `useDataGridPagination` client mode keeps a controlled page the same way on an empty
  dataset.
- **Validator crash on edit commit:** a cell `validate` that throws, or whose promise rejects,
  now rejects the edit with the error message and clears the pending state, instead of leaving the
  editor stuck read-only with no message. This covers the function form and `updateCells` (the
  patch is skipped as `invalid`), and a throwing validator blocks the edit on an
  `onInvalid: "warn"` column too.
- **Docs: stable `overlayPlugins` in the fill and presence examples:** the examples and the `plugin`
  JSDoc of `useDataGridFill` and `useDataGridPresence` memoize the `overlayPlugins` array. The inline `[plugin]` literal they showed trips the core's
  identity-stability dev warning on every re-render.
- **Checkbox drag toggled the start cell:** a press on a checkbox cell dragged across other rows
  selects the range and no longer toggles the cell where the drag started, also when the drag
  ends back on that cell.
- **Async import merge:** the import dialog waits for a Promise returned by `onImport`. It closes
  after the merge succeeds, and a rejection keeps it open with the retry message.
- **`updateCells` verdict with schema validation:** a rejected patch shows up in `skipped` with
  reason `invalid`, and every `patchIndex` points into the array passed to `updateCells`.
- **URL pagination with a late `total`:** an out-of-range `?page=` is clamped in the URL once
  `total` arrives, not only when it is known on mount.
- **`applyFromUrl()` and removed params:** a sort, filter, join, or search param that is gone
  from the URL clears its state on re-apply. On mount, a missing param keeps the initial state.
- **XLSX export:** `exportGrid` builds the table once per XLSX export instead of twice.
- **Presence `maxRects`:** a fractional or negative value still caps the painted rects.
- **Row insert and duplicate under sort or filter:** the active cell stays on its row, and the
  selection collapses onto it, instead of pointing at an unrelated row.
- **Stale sheet re-parse:** a slow sheet re-parse can no longer overwrite the preview of a
  newly chosen file (generation guard on file load and reset).
- **Global shortcut ownership on config change:** flipping the `undo`/`redo` flags (or passing a
  new inline config) no longer drops the grid's multi-grid focus ownership — the grid id is now
  minted once per mount, so the global binding stays live with focus already inside the grid.
- **Stale view-space presence warning:** the dev warning fires once per grid instead of once per
  page, and `insertRows`, `deleteRows`, and `duplicateRows` trigger it too.
- **`defineColumns` on TypeScript 5.x:** callback parameters such as `renderCell`'s `{ value,
  rowIndex }` are typed again instead of implicit `any` (a `strict` build failed). An unknown
  column key still fails to compile, as "Expected 2 arguments" naming the key.
- **Composable fill detection:** the built-in `detectSeries` accepts the `readonly string[]` a custom
  `detectSeries` callback receives, so a custom detector can fall back to it without a cast.
- **Visible pin shadow after install:** the `data-grid` item ships `--grid-pin-shadow` as `cssVars`
  for light and dark mode, and the grid falls back to a light-mode value when the variable is
  missing. Before, a fresh install rendered the pinned-column and pinned-row shadow invisible.
- **Reduced motion in lazy skeleton cells:** the per-cell loading shimmer of `data-grid-lazy` holes
  respects `prefers-reduced-motion`, like the whole-grid loading skeleton.
- **Vite type-check:** the core grid no longer reads `process.env` directly, so `tsc -b` passes in a
  Vite project whose `tsconfig.app.json` lacks `@types/node`.
- **Demo npm dependencies:** `data-grid-context-menu-slots-demo` declares `lucide-react` and
  `data-grid-validation-demo` declares `sonner`, so a fresh install gets both packages.
- **Registry npm dependencies:** `data-grid`, `data-grid-toolbar`, `data-grid-sort-list`,
  `data-grid-context-menu`, and `data-grid-pagination` declare `lucide-react`, so a fresh install
  gets the icon package the components import.
- **Inline fill callbacks:** `useDataGridFill`'s `onFill` and `detectSeries` may be inline
  functions; a new identity no longer re-creates the fill handlers on every render.

### Added

- Coverage thresholds (branch-level, ~85-90% floor) enforced in CI for every pure-lib module —
  selection math, `CompactSelection`, clipboard parse/serialize, fill/series inference, sort/filter
  matching, keymap matching, history, url-state serializers, CSV/XLSX import/export helpers, and
  context-menu target resolution.
- `LICENSE` (Apache License 2.0).
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
- **Breaking:** Multiplayer presence extracted out of core into a new `data-grid-presence` add-on.
  Core's `presenceHighlights` state/prop, `setPresenceHighlights` action,
  `useDataGridHighlights` hook, and the `PresenceHighlight` type are all removed — install
  `@gridcn/data-grid-presence` and call its `useDataGridPresence()` hook instead. Core gains one new
  seam in exchange: `overlayPlugins` on `DataGridProvider`/`DataGrid`, a generic overlay-plugin slot
  `DataGridOverlays` renders after its built-in range/band layers (but before the local active-cell
  ring) — `data-grid-presence` is the first consumer, `data-grid-fill` (below) the second.
- **Breaking:** The fill handle extracted out of core into a new `data-grid-fill` add-on, reusing
  the overlay-plugin seam the presence extraction built. README/docs positioning updated: core is
  now range selection + Excel clipboard + editing engine; the fill handle is its own free add-on,
  one `npx shadcn add @gridcn/data-grid-fill` away. Removed from
  core: `useFillHandle`, `FillHandleHandlers`, `FillPatternArgs`, the `fillPreview`/`setFillPreview`
  store state, `DataGridRoot`'s `onFillPattern` prop, and `DataGridOverlays`'s `fillHandleHandlers`
  prop — install the add-on and call its `useDataGridFill()` hook instead (`onFillPattern` is now
  an option to that hook). `GridAction`'s `fillDown`/`fillRight` and their `DEFAULT_KEYMAP` bindings
  stay in core (two string literals are cheaper surface than a fully extensible-action mechanism);
  without the add-on both keys are silent no-ops, matching every other optional-callback seam.
- **Breaking:** Pinned rows extracted out of core into a new `data-grid-pinned-rows` add-on.
  Unlike presence/fill (which register into the `overlayPlugins` paint
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
