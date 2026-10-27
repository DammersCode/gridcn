# Changelog

All notable changes to gridcn are documented here. Since gridcn ships through the shadcn registry
rather than npm, there is no package semver — this file, plus each item's stable file layout, is
the upgrade story. Re-run `npx shadcn add @gridcn/<item>` to pick up changes; the CLI diffs and
prompts before overwriting files you've edited.

The format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

- **Breaking:** `labels.contextMenu` keys `pinLeft` and `pinRight` are renamed to `pinStart` and `pinEnd`, and the defaults now read "Pin to start" and "Pin to end". The start side is the `pin: "left"` zone, the end side the `pin: "right"` zone; in a left-to-right page start is left and end is right, in a right-to-left page the reverse. Overrides and translations move to the new keys. The menu item ids `pin-left` and `pin-right` and the column `pin` values are unchanged.
- The URL `pins` part of `data-grid-url-state` writes `id:s` and `id:e` pairs (start/end) instead of `id:l` and `id:r`. Links with the old codes `l` and `r` still read. A link written by this version loses its pins on a deployment with an older version.
- The grid's live region announces the number of checked rows after a row check or uncheck, for example "3 rows checked" (`labels.grid.rowsChecked`). This covers `toggleRow`, the marker checkboxes, the header checkbox, and Shift+click and marker range drags. The count includes the rows a cell range covers, as the marker checkboxes show them.
- The live region waits 500 ms after the last change before it reads. A marker range drag is read once, with its final count. Row move announcements arrive 500 ms after the move; before, they arrived at once.
- New grid prop `announceResults`, default `false`. After a filter, sort, or join operator change, the live region announces the number of rows in the view, for example "42 rows" (`labels.grid.resultsCount`). It stays quiet with `sortMode="server"`, and a lazy source counts its loaded rows only.
- New docs demo `data-grid-announcements-demo` on the Accessibility page. A line on the page mirrors the text the live region speaks.

## 1.2.2 - 2026-10-25

- The status line of the header filter reads "N of M selected" from left to right in a right-to-left page.
- Autosize reads the horizontal padding of a mounted cell, so a column fits its widest value under a spacing scale or preset that changes the cell padding. Before, the width added a fixed 20 px.
- The docs have live demos for `keepCheckedRows` with `keepHiddenCheckedRows`, the delete confirmation (`onBeforeDeleteRows`), touch gestures, and the URL column layout (`widths` and `pins`). The URL state demo also has the header menu and the columns menu.
- Shift+click on a row marker, on its number or its checkbox, checks the rows from the anchor row to the clicked row. Each Shift+click replaces the previous Shift range, so the range grows and shrinks (click 1, Shift+click 5, Shift+click 3 checks rows 1 to 3). Rows outside the range keep their state, and when the anchor row is unchecked the range unchecks its rows. Ctrl/Cmd+Shift+click keeps the current range and adds the next one. Shift+click without an anchor starts at the active row. A sort or a filter ends the range, and the header checkbox and Escape clear the anchor.
- **Breaking:** a drag that starts on a row marker checkbox no longer unchecks the other checked rows: it checks (or, from a checked checkbox, unchecks) only the rows it crosses. A Ctrl/Cmd+drag on a row marker shrinks when the pointer moves back, and Shift+drag on a marker keeps the rows outside its range, like Shift+click. `SelectLineOptions` loses `replaceFromLast`.
- **Breaking:** after `selectRow` (Shift+Space) or `toggleRow` (Ctrl+Shift+Space), Shift+ArrowUp and Shift+ArrowDown check or uncheck rows and move the active row, instead of replacing the row check with a cell range. After a click on a cell, the keys extend the cell range as before.
- New keymap actions `extendRowsToStart`, `extendRowsToEnd`, `extendRowsPageUp`, and `extendRowsPageDown` on Shift+Home, Shift+End, Shift+PageUp, and Shift+PageDown. After a row check they move the end of the checked range; without one they do nothing and the key is not handled. The keybindings dialog lists them.
- `actions.checkRowRange(target, { commit })` checks the span from the anchor row to `target`.
- Right-to-left pages: the find and replace panel docks to the inline-end corner of the grid, the pagination chevrons mirror, and the context menu shortcut keycaps sit at the inline end. The header filter counts align to the inline end.
- `DataGridSearch` is an input group: the search icon leads and the match count trails inside the field. The field is `w-72` wide, up from `w-56` for the input alone.
- The import dialog draws the header row toggle with the shared `Checkbox` and `Label`, and announces a file error with `role="alert"`. `data-grid-io` declares the `checkbox` and `label` registry dependencies.
- Forced-colors mode: the active cell, a search match, and a cell error keep a visible outline, and a cell error exposes its message through `aria-description`.
- The header filter puts "Select all" in the search field as a labeled checkbox before the search input, with the indeterminate state when only some of the listed values are checked. The popover opens with focus in the search input, and Select all acts on the text typed so far. Before, "Select all" was a row of its own under the search field. `data-grid-toolbar` now declares the `input-group` and `checkbox` registry dependencies.
- The header filter lists the counts in a fixed-width, right-aligned column with tabular numerals.
- The status line of the header filter reads "N of M selected" (checked values of listed values) through the new label `toolbar.headerFilterSelectedCount`. Before, it showed the number of values. **Breaking:** the label `toolbar.headerFilterValueCount` is removed. Move a custom text to `headerFilterSelectedCount`.
- The header filter value list draws its checks with the shared `Checkbox`, so they follow the theme radius and colors.
- The checkbox cell box and the long text popup follow the theme radius. Before, both had square corners. The cell editors inherit the corner of their cell.
- The quick-search match tint works without the `search-highlight` theme color: it falls back to a light `primary` tint. The `data-grid` item now declares `--search-highlight` in `cssVars`.
- The find and replace panel uses the Popover surface: the `rounded-lg` corner and a ring instead of a border.
- The search match fallback tint is stronger than the selection fill in light and dark. **Breaking:** the documented color variable is `--search-highlight`. Move a color that you set on `--color-search-highlight` to `--search-highlight` (the old name still works as a fallback).

## 1.2.1 - 2026-10-25

- Sorting is faster. In the browser, a text sort at 100k rows takes about 25% less time (68 ms to 51 ms). The row order is unchanged.
- **Breaking:** `DataGridRowCellState` has the new fields `editingError` and `editingRejectionCount`, and `DataGridCellProps` has the new optional props `editingError` and `editingRejectionCount`. A caller that passes `isEditing` to `DataGridCell` must forward both from `useDataGridRowCellState`; without them the cell loses the live validation error and the commit-guard re-arm. Each cell holds fewer store subscriptions.

## 1.2.0 - 2026-10-24

- Touch input. A touch press selects on release, not on press, so a scroll or a pan selects nothing. A tap selects a cell, a column header, or a row marker. A double-tap edits a cell. Pressing and holding for 500 ms opens the context menu of a cell or a header. The grid takes no pointer capture for a touch press and registers no non-passive touch or wheel listener.
- After a touch selection, two selection handles at the corners of the range extend it. The grid scrolls at the edges while a handle is dragged. Any key press hides the handles.
- **Breaking:** a touch press no longer selects on `pointerdown`. Code that reads the selection inside its own `pointerdown` handler sees it one event later.
- `DataGridRoot` sets `touch-action: manipulation`, so a double-tap does not zoom the page. The native touch `contextmenu` event is suppressed in favor of the grid's own long-press.
- A `click` that reaches a cell without a `pointerdown` on it, such as a screen reader activation, selects that cell.
- Under `@media (pointer: coarse)`, the column resize area, the header menu button, and the header filter button grow to at least 24 px and stay visible. A column drag handle appears in the header when column reorder is on.
- The `data-grid-fill` handle hides after a touch selection. The cell context menu lists Fill down and Fill right for a touch selection when the fill add-on is mounted. `labels.contextMenu` has the new keys `fillDown` and `fillRight`.
- `OverlayPluginCtx` has the new field `selectionPointer`. The `data-grid-sdk` entry exports `useDataGridSelectionPointer`.
- `useDataGridUrlState` and `<DataGridUrlState>` take a `layout` option and sync the column layout to the URL. The default `["order", "hidden"]` writes `cols` and `hide`; `"widths"` and `"pins"` add `widths` and `pins`; `[]` turns it off. A part is in the URL only while it differs from the layout the grid started with. The URL changes once per committed gesture, never per resize frame. A layout key over 16,384 characters is ignored, and at most 1,024 entries are read. Ids of removed columns are dropped. The `data-grid-url-state` item ships a new `layout-param.ts`.
- The URL `sort` param reads at most 256 raw segments. Before, a forged link with millions of commas was split in full.
- New add-on `data-grid-find-replace`. `useDataGridFindReplace` returns a `plugin` that mounts a find and replace panel, and `open(mode)` that opens it from code (`"find"` shows Find only, `"replace"` is the default). `Mod+F` opens the panel with Find only, `Ctrl+H` opens it with Replace, and a chevron button shows and hides the Replace field. With `DataGridSearch` mounted, `Mod+F` in the grid opens the panel, the Find field and the toolbar search show the same text, and the toolbar capture skips an event that a grid binding already handled. Replace and Replace all write through each column type's `fromText` and `validate` as one change that one undo reverts. `planReplace` is the pure planner behind the buttons. Its option `skip` leaves out the cells it names, and `ReplaceSkipReason` has the member `"no-occurrence"` for a cell without the find text. `labels.findReplace` has the label `toggleReplace`.
- **Breaking:** `DataChange.source` and the `onValidationError` event `source` have the new member `"replace"`. A `switch` on `change.source` without a default branch needs a case. `useDataGridHistory` records `"replace"` by default.
- `actions.setSearch(text, options)` takes `{ matchCase, wholeCell }`, and the store holds them as `searchOptions`. Both default to `false`.
- `GridActions` has the actions `openFindReplace` and `openFind`. A plugin binds them (`useDataGridFindReplace` binds `Ctrl+H` and `Mod+F`), and no default key is bound.
- The playground demo shows the header filter on every column that offers a set filter.
- `isAnyOf` and `isNoneOf` are filter operators of the `text`, `number`, `date` and `select` cell types. `SET_FILTER_OPERATORS` (from `data-grid-sdk`) lists them. The toolbar filter menu offers them for those columns. `long-text`, `url` and `checkbox` do not get them.
- **Breaking:** `FilterOperator` has the new member `isNoneOf`. It takes a `string[]` and matches rows whose cell text equals none of the entries, case-insensitively. An empty list matches every row. The URL codec writes it like `isAnyOf` (`status:isNoneOf:new|open`). An `isNoneOf` list over its bound (1,000 entries, or the column's number of choices) drops the whole filter segment instead of shortening it. An exhaustive `switch` over `FilterOperator` needs a new case.
- `DataGridRoot` takes a `renderHeaderFilter` slot. The slot renders in the header cell of each column that is not `filterable: false` and offers `isAnyOf` or `isNoneOf`. It stays hidden until hover or focus, and stays visible while the column has a filter. A press in the slot or in a popup marked `data-grid-header-filter-popup` never sorts, selects or reorders the column. Header cells carry `data-filtered` while their column has a filter, and autosize leaves room for the slot's button. The `openColumnFilter` key action (`Shift+Alt+ArrowUp`) clicks the `data-grid-header-filter-trigger` button of the active column.
- The `data-grid-toolbar` add-on exports `DataGridHeaderFilter`. Wire it with `renderHeaderFilter={(ctx) => <DataGridHeaderFilter {...ctx} />}`. Its button opens a popover with a search box, a select-all row, and a virtual list of the column's distinct values with row counts. The list counts the rows that pass every other filter. Apply replaces the column's `isAnyOf` and `isNoneOf` entries with the shorter of the checked and unchecked lists, using only operators the column offers, and keeps all other filters. Apply is disabled while nothing is checked or the stored list would pass 1,000 entries. Clear removes every filter of the column. Escape or a press outside discards the selection. `Shift+Alt+ArrowUp` opens the popover from the active cell and returns focus to the grid on close. `labels.toolbar` has the new `headerFilter*` strings.
- The header filter popover shows the hint "From loaded rows" when the grid holds unloaded lazy rows or sorts on the server. Change the text with the new `toolbar.headerFilterLoadedRowsOnly` label.
- The toolbar `isAnyOf` and `isNoneOf` value input of a column without `choices` (text, number, date) opens the same value list instead of an empty dropdown.
- The toolbar `isAnyOf` value input keeps checked values that are not in the column's `choices` when you toggle a choice. Before, a toggle dropped them.
- The `fake-remote-server` example matches `isAnyOf` without regard to case, like the grid, and supports `isNoneOf`. Before, any operator it did not know matched every row. The Drizzle and Prisma recipes map `isNoneOf` to `notInArray` and `notIn`.
- `DataGridProvider` takes a `columnGroups` prop. Each `ColumnGroupDef` has an `id`, a `header`, and `children` (column ids and nested groups). The header gets one row per group level, and a column outside a group spans all rows. A group keeps its columns together: reorder moves a column inside its group and moves a group as one block (`setColumnOrder` accepts a group id), and a saved, URL, or default `order` that splits a group is repaired. Pinning stays per column, so a group with columns in two pin zones shows one header cell per zone. A press on a group header selects its visible columns. Export and print write the column headers only.
- **Breaking:** the root context `headerHeight` is the height of the whole header block (`headerRowHeight` times `headerRowCount`). It stays the same without `columnGroups`. With groups, `aria-rowindex` of data rows and pinned rows grows by the number of group levels, and `aria-rowcount` includes the header rows. The context has the new fields `headerRowHeight`, `headerRowCount`, `headerRows`, and `columnGroupModel`.
- The `DataGridColumnsMenu` of `data-grid-toolbar` lists the members of a group under a heading with the group label.
- **Breaking:** `reorderRows(rows, to)` takes one view index or a list. A list moves as one block: the rows keep their order and land next to each other, the first at final index `to`. Duplicate indices count once. One call is one change with one `move` operation per moved row, and one undo entry. For each operation, `from` is the row's index before the batch and `to` is its index after it, so apply the operations together with `applyChange`. A server that applies them one at a time ends with the wrong order. A single index behaves as before.
- `actions.moveRowsBy(rows, delta)` shifts every listed row by `delta` and keeps the gaps between the rows. It does nothing when one row would leave the grid. It has the same guards, change shape, and return value as `reorderRows`.
- A drag from the drag handle of a checked row moves every checked row. A drag from an unchecked row moves that row alone and keeps the checks. Every dragged row dims while the drag runs. `RowReorderState` of `useRowReorder` has the new field `rows`, and `onReorder` receives the dragged rows instead of one index.
- `GridActions` has the actions `moveRowsUp` and `moveRowsDown`, bound to `Shift+Alt+PageUp` and `Shift+Alt+PageDown`. They move the checked rows one place, or the rows of the selected range, or the active row. They need `enableRowReorder` and a `reorder`-family `rowMarkers` mode, and do nothing on a `readOnly` grid or at the edge. The keybindings dialog lists both under editing.
- The live region announces a block move with `labels.markers.reorderRowsAnnouncement(count, position, total)`. The store holds the text as `rowMoveAnnouncement`, and `useDataGridRowMoveAnnouncement` reads it, so a key press and a `reorderRows` call announce like a drag.
- A move that leaves a selected range with its rows next to each other keeps the range. Otherwise the range collapses onto the active cell. The `reorderSelectionForRow` and `rowReorderMap` helpers are gone, replaced by `remapSelectionRows(selection, newIndexOf)`.
- Starting an edit no longer moves the cell text. The date and long text editors keep the text where it was (it jumped up by 7.5 px at the default row height), and the text, number and url inputs use the cell font size on narrow screens and have no tint in dark mode.
- The long text editor opens as a larger popover (400 px wide, 150 to 300 px high) over the cell, with its top-left corner on the cell's corner. The date popover starts at the cell's start edge. Neither plays an open animation.
- Fix: a click outside the grid, or in the empty space of the grid, no longer clears the checked rows. It clears the cell range and the column selection only. Before, a toolbar button outside the grid, such as Delete, ran after the checks were gone and acted on the active cell. Escape and the checkboxes still clear them. The store action `clearCellSelection` does the same clear.
- New grid prop `keepCheckedRows`, default `false`. A cell click, an arrow key, and a Shift or Ctrl click keep the checked rows. While any row is checked, Delete rows, Duplicate row, Move rows, and the cell context menu row items act only on the checked rows, not on the union with the range. Copy, cut, fill, and Delete stay on the cell range. `getSelectedViewRows` takes the option `checkedRowsOnly`. `useDataGridSelectionConfig` returns `keepCheckedRows`.
- New grid prop `keepHiddenCheckedRows`, default `false`. With `keepCheckedRows`, a checked row that a filter hides stays remembered by row id and is checked again when the filter lets it back in. Row operations, export, the clipboard, select all, and the controlled `selection` see the visible checked rows only. Escape, `clearSelection`, `setSelection(null)`, and unchecking all clear the hidden checks. While every checked row is hidden, Delete rows, Duplicate row, and Move rows do nothing. A server-sorted or lazy grid ignores the option. `useDataGridHiddenCheckedCount` returns the number of hidden checked rows, and `DataGridStatusBar` shows it through the new labels `labels.statusBar.hiddenChecked` and `labels.statusBar.hiddenCheckedOnly`.
- New grid prop `onBeforeDeleteRows({ rowIds, hiddenCount })`. It runs before every row delete the grid starts (the Delete rows shortcut, the context menu, `actions.deleteRows`, `actions.deleteRowsById`) and cancels the delete when it returns `false` or a promise of `false`. A pending promise blocks a second delete, and a stale result is dropped.
- New `settled` promise on the `updateCells` and `updateRows` verdict while `pending` is `true`. It resolves with the final verdict, or with nothing applied when a newer write supersedes the held batch.

## 1.1.0 - 2026-10-21

- In Firefox, lists longer than about 248,600 rows at 36 px no longer lose the end of the list. Rows stay visible after scrolling past about 8.9 million px.
- In Firefox, rows no longer disappear or stack on one line after scrolling more than 10,000 rows away from the active cell. An active row far outside the rendered rows is placed off-screen near them.
- A development build logs a warning once per grid when the row count times the row height passes 17,800,000 px. Firefox gives an element taller than about 17.9 million px a height of 0 and Chromium caps it at about 33.5 million px, so Firefox shows no scroll range above about 490,000 rows at 36 px, and Chromium cannot reach the rows past about 930,000.
- Starting an edit (typing, Enter, F2) on an active cell scrolled out of view scrolls the cell into view instead of jumping elsewhere.
- Pinned cells keep an opaque background under search-match, invalid and flash tints, so scrolled content no longer shows through.
- **Breaking:** data cells are transparent. The `bg-background`, `group-hover/row:bg-muted/50` and `transition-colors` classes of the data cell are gone. A `bg-*` class from `getCellClassName` or `cellClassName` hides the row hover tint. A root with `bg-card` or `bg-transparent` shows through unpinned cells. A `bg-*` class from `getRowClassName` is now visible on unpinned cells. Pinned and marker cells stay opaque.
- **Breaking:** the row hover tint follows the `data-hovered` attribute on the hovered row instead of the CSS `:hover` state. A pointer listener sets it, it stays frozen while the grid scrolls, and it moves to the row under the pointer when the scroll settles. Override the tint with `data-hovered:bg-*` instead of `hover:bg-*`. There is no hover fade.
- Scroll jumps farther than the overscan cap can cover no longer mount a leading overscan buffer, so the rendered rows stay few and commit once.
- **Breaking:** the plugin context field `windowStart` is now the grid origin, the row line the rows canvas is positioned from. It trails the first rendered row by up to 288 rows. Place a rect with `rect.y - windowStart + 1` and clamp only with `clampRowStart` and `clampRowEnd`.
- Vertical scroll ticks write one `translate` on the rows canvas instead of two inherited CSS variables, and a small window shift no longer rewrites the `gridRowStart` of every mounted row, which cuts style work on fast wheel flings.

## 1.0.0 - 2026-10-16

### Upgrading from 0.1.0

Re-run `npx shadcn add @gridcn/data-grid` (and each add-on you use) to replace the installed source. The list below names every **Breaking** entry of this release by area, with the replacement. The full entries stay under the sections that follow.

#### Core props and callbacks

- `overlayPlugins`, `rowBands`, `onUndo`, `onRedo`: removed. Pass add-ons, overlays, bands, observers, commands, and keymap entries through the `plugins` prop.
- `readOnly`, `keymap`, `onCellClick`, `onRenderedRowsChange`: on a manual `DataGridProvider` composition, set them on `<DataGridProvider>` instead of `DataGridRoot`. `DataGrid` prop names are unchanged. `DataGridCellProps` loses `onCellClick`; `DataGridRootContextValue` loses these props.
- `onRowClick` and `RowClickCtx`: removed. Use `onCellClick`, whose ctx carries `row`, `rowId`, and `viewRowIndex`.
- `onRowWindowChange`: now `onRenderedRowsChange`. The plugin ctx field `windowedColumns` is `renderedColumns`, the type `WindowedColumn` is `RenderedColumn`, and `components/data-grid/windowing/` is `components/data-grid/virtualization/`.
- `onColumnResizing` and `processPaste`: take one ctx object, `onColumnResizing({ columnId, width })` and `processPaste({ cells, target })`, instead of positional arguments.
- `onSelectionChange`: delivers `SelectionState` (`{ anchor, range, rangeStack, rowIds, columnIds }` in `CellRef` terms). Read `next.range.start`/`end` and `next.rowIds`/`next.columnIds`. `onSelectionCleared` is removed; an empty `next` is the cleared signal.
- `setSelection` takes a `SelectionState | null` and `getSelection` returns one. Selecting one cell stays `actions.selectCell(ref)`.
- `onDataChange`: fires after the grid stores the data. A write inside the handler starts from that data. Events arrive as `onActiveCellChange` and `onSelectionChange`, then `onDataChange`, then `onEditEnd`.
- `onColumnLayoutChange`: fires only on a real change. Calls that keep the current pin, visibility, order, or width no longer fire it.
- `cellTypes`: merges over the built-ins. Drop the `...cellTypes` spread; set a key to `null` to remove a type.
- `renderHeaderCell`: replaces only the contents of the grid-owned header cell. Its ctx is `{ column, index, width, headerClickBehavior, sortState }`. Remove your own `role` and `aria-colindex` handling.
- `renderCellMenuItems` and `renderHeaderMenuItems` on `DataGridContextMenu`: removed. Pass `getCellMenuItems` and `getHeaderMenuItems`, which return a `GridMenuItemSpec[]`.
- `CellEditorProps`: `rowId` and `columnId` are required. Pass both when you render an editor directly.
- `DataGridCell`: `rowIndex` is `viewRowIndex`, `columnIndex` is `viewColumnIndex`, and `rowId` is required.

#### Cell coordinates and contexts

- `CellCoord`: now `ViewCoord`. The actions `selectCell`, `setActiveCell`, `extendTo`, `pushRange`, `startEditing`, and `commitCellValue` take a `CellRef` (`{ rowId, columnId }`). Use the `*At` variants (`selectCellAt` and so on) for a `ViewCoord`. `useDataGridScrollToCell` takes a `CellRef`; `useDataGridScrollToCellAt` takes a `ViewCoord`.
- `renderCell`, `Cell` components, `onCellClick`, `onCellDoubleClick`, `onCellContextMenu`: `rowIndex` and `columnIndex` are `viewRowIndex` and `viewColumnIndex`, and the ctx adds `rowId` and `columnId`. `getCellClassName` adds `rowId` and `columnId`. `getCellMenuItems` renames `row` to `viewRowIndex` and adds `rowId`. `GridBulkValidationError`, `applyCellUpdates` entries, `BulkCandidate`, and `BulkWrite` rename `viewRow` to `viewRowIndex` and add `rowId`.
- `useDataGridRowId` and `useDataGridRowIds` return `__lazy-unloaded-<index>` for an unloaded lazy row, never `undefined`. `DataGridPinnedRow` takes a required `position`.
- `flashCells` takes `CellRef[]`. `flashCellKey` is removed. `rowIdAtViewRow(state, viewRow)` comes from `data-grid-sdk`.
- `useDataGridActions()` and `useDataGridStoreProps().actions` return only public actions. The `_`-prefixed internal actions are gone.

#### Hooks and exports

- `data-grid` splits into a consumer API and `data-grid-sdk`. Import `GRID_LAYER`, `cellLayer`, `pointerToCoord`, `useDataGridRootContext`, `useDataGridStoreApi`, `useDataGridCommands`, `createHistory`, `setCellValue`, the validation engine (`runValidateSync`, `resolveBulkWrites`, and related), `useDataGridInstanceId`, and the other add-on seams from `data-grid-sdk`.
- Removed from the `data-grid` barrel: `useDataGridEditingError`, `useDataGridRowHasError`, `useDataGridIsCellActive`, `useDataGridIsCellEditing`, `useDataGridCellInitialText`. Use `useDataGridCellState`, `useDataGridCellEditingError`, and `useDataGridRowCellState`.
- `data-grid-keybindings` no longer exports `bindingTokens`. Use `formatShortcut` from `data-grid`.
- `data-grid-fill` exports only `useDataGridFill`, `detectSeries`, `FillArgs`, and `SeriesDescriptor`. `useDataGridFill` returns `{ plugin }`: put it in `plugins` and drop `<FillHandleTracker />`.
- `data-grid-url-state` exports only the hooks and their option and result types. The URL param codecs are internal.
- `useDataGridHistory` takes `{ capacity?, datasetKey?, recordSources? }`. Remove `data`, `setData`, `getRowId`, and `readOnly`. `record(change, label?)` applies the change through the grid and registers it, so do not apply it to your own array first. `useDataGridState` takes `{ getRowId, capacity?, datasetKey? }` and returns `plugins`.
- `useDataGridImportPreview({ columnFallback, defaults, limits })` replaces the three positional arguments.
- `buildExportRows(state, scope, { text?, maxRows? })` replaces the positional `maxRows`. `text: "display"` exports display text.
- `buildImportedRows` returns `{ rows, rejected }`. `resolveBulkWrites` returns `{ writes, rejected }`, as do `buildPasteWrites` and `buildFillWrites` (`{ resolution, filled }`).
- `DataGridPagination` is replaced by `DataGridPaginationBar` plus `DataGridPaginationRange`, `DataGridPaginationPageSize`, `DataGridPaginationFirst`, `DataGridPaginationPrev`, `DataGridPaginationPages`, `DataGridPaginationNext`, and `DataGridPaginationLast`.

#### Add-on extractions

- Presence: `presenceHighlights`, `setPresenceHighlights`, `useDataGridHighlights`, and `PresenceHighlight` leave core. Install `@gridcn/data-grid-presence` and put `useDataGridPresence()` in `plugins`.
- Fill handle: `useFillHandle`, `FillHandleHandlers`, `FillPatternArgs`, and the `onFillPattern` prop leave core. Install `@gridcn/data-grid-fill`. `onFillPattern` is an option of `useDataGridFill()`.
- Pinned rows: `pinnedTopRows` and `pinnedBottomRows` leave core. Install `@gridcn/data-grid-pinned-rows` and put `useDataGridPinnedRows({ top?, bottom? })` in `plugins`.
- `data-grid-io` reads and writes Excel with `hucre` instead of SheetJS. Re-add the item to replace the dependency. `.xls` accepts only Excel 97-2003 workbooks, and an oversized sheet is rejected, never truncated.

#### Behavior changes

- Tab leaves the grid. Outside an edit, `Tab` and `Shift+Tab` move focus to the next or previous control. To keep cell navigation on Tab, set `keymap={{ moveRight: ["ArrowRight", "Tab"], moveLeft: ["ArrowLeft", "shift+Tab"] }}`.
- Keymap action renames: `retainMoveUp`, `retainMoveDown`, `retainMoveLeft`, and `retainMoveRight` are `moveUpKeepSelection`, `moveDownKeepSelection`, `moveLeftKeepSelection`, and `moveRightKeepSelection`. `editReplace` is `typeToReplace`. `deleteContents` is `clearContents`. Rename the keys in `keymap` and in `labels.keymap`.
- `DataChange.source`: `"row-op"` is `"row-operation"`, and `"rollback"` is a new value. Update `source` checks, `recordSources`, and exhaustive `switch` statements. `invertChange(change, source?)` takes the tag.
- A press on a `reorder` row-marker drag handle no longer selects or checks the row.
- Row operations and immediate re-sorts apply while an edit is open. The edit re-anchors, or cancels if its row is removed.
- The active cell, selected columns, and checked rows follow their record or column through sorts, filters, `data` swaps, and column changes. Selection changes fire only on real changes. A custom selection channel implements `CompactSelectionLike.equals`.
- `select` columns sort and quick-search by choice label. Quick search matches display text; filters match the stored value.
- Keymap ties resolve per binding: a binding that is not a default wins over a default one.
- `useDataGridClipboard().cut()` awaits the write and clears the selection only on success.
- CSV export prefixes formula-like cells with a single quote (`sanitizeFormulas: false` restores raw output) and starts with a UTF-8 BOM (`csvBom: false` removes it).
- `data-grid-io` `maxDecompressedBytes` defaults to 256 MiB, and an xlsx part is capped at `maxCells` times 10 bytes plus 1 MiB.
- Filter and pagination selects show labels, not raw values.
- `mod+F` in one grid no longer moves focus into another grid's search.
- A URL `pageSize` must be one of the pager's size options (10, 25, 50, 100 by default), and a URL `page` above 1,000,000 falls back to 1.
- Docs and comments say "virtualization" for "windowing", "operation" for "op", "drag handle" for "grip", and "override" for "escape hatch".

### Added

- **`url` cell links open with the mouse:** Ctrl+click (Cmd+click on macOS) and middle-click on the link open it in a new tab. A plain click selects the cell only.
- **Keyboard access to the column menu and row checking:** `openColumnMenu` (Shift+Alt+ArrowDown) opens the active cell's column menu and returns focus to the cell on close. `toggleRow` (Ctrl+Shift+Space) checks or unchecks the active row without replacing the other checked rows. `toggleAllRows` (Mod+Shift+E) does what the header checkbox does. The marker checkboxes and the menu trigger stay out of the Tab order.
- **Agent-readable docs (site):** `/docs/<page>.md` and `llms-full.txt` render props tables, install commands, callouts, and tabs as plain markdown instead of raw MDX components. `llms.txt` opens with a task index and lists the Add-ons overview and the skills. Each skill is served at `/skills/<name>/SKILL.md`, carries a `gridcn-version` stamp, and ends with a "Do not" list.
- **Detail panel recipe and demo (docs example):** `data-grid-detail-panel-demo` opens a non-modal side panel through `onCellClick` or a custom `openRow` command and keeps it on the active row through `onActiveCellChange`; focus stays in the grid. [Recipes](/docs/recipes/ui-patterns/detail-panel) covers the mouse, keyboard, and follow-the-active-row variants.
- **Default seeds for sort, filter, and search:** `defaultSortState`, `defaultFilterState`, `defaultJoinOperator`, and `defaultSearchText` seed the uncontrolled store once, so an initial sort no longer needs controlled state plus a callback.
- **`getRowId` is optional:** it defaults to the row's `id` field (string or number) and throws for a row without one.
- **`exportGrid` defaults to CSV:** `format` and the whole options argument are optional, as is the argument of `useDataGridExport().exportGrid`.
- **Options parameters are optional when every field is:** `useDataGridHistory()`, `useDataGridFill()`, and `filterFiles(files)` no longer need an empty `{}` argument.
- **Registry dependencies declare version ranges:** every npm package in `registry.json` now carries a range (caret for stable packages, tilde for `@dnd-kit/*`), so a fresh install no longer picks up a future major or a 0.x breaking minor. The exception is `hucre`, pinned exactly.
- **`use-sync-external-store` declared by the `data-grid` item:** the store's selector hook
  uses `zustand/traditional`, which imports `use-sync-external-store/shim` — a package the
  item now declares so strict package managers (pnpm) resolve it on a fresh install.
- **Plugin system (`data-grid`):** `DataGridProvider`/`DataGrid` take `plugins` —
  `readonly DataGridPlugin[]` — the single seam add-ons and consumer code use to extend the grid.
  A `DataGridPlugin` is a plain object with a `name` and optional members; array order is
  precedence and visual order. `Overlay` paints a `pointer-events-none` layer appended to the
  overlay stack after the built-in range layers and before the active-cell ring. `rowBands`
  contributes rows to the sticky top and bottom row bands: the root renders one segment per
  plugin in array order, and `RowBandRenderCtx` gains `rowOffset`, the rows earlier plugins
  placed in the same band. `onDataChange` is an observer that runs after the store write and
  after the consumer's own `onDataChange`; a throwing observer warns once and the remaining
  observers still run — the write is never rolled back. `commands` merges into the command map:
  the consumer's own `commands` win silently, and a built-in action name is dev-warned and
  dropped unless the action is pluggable. `keymap` binds the plugin's own commands only: an
  entry naming a command the plugin does not define, or a binding the default keymap or the
  consumer's `keymap` already owns, is dropped, dev-warned; merge order is the default keymap,
  the plugins in array order, then the consumer. `Mount` is a component rendered inside
  `DataGridRoot` after its children, with no props, reading the grid through `useDataGridApi` —
  the slot for engine work a paint-only overlay cannot do.
- **Entry-wise plugin identity (`data-grid`):** the grid compares the `plugins` list entry-wise —
  same length, the same `name` at each position, every member identity-equal — so a fresh
  `[plugin]` array per render re-resolves nothing, and the resolved `plugins`, `commands`, and
  `keymap` references stay stable across re-renders. A changed member re-resolves the list, and
  React remounts the plugin components whose type changed — dev-warned, naming the component. A
  plugin instance attaches to one grid: the same object on two grids dev-errors, and the second
  grid drops it and keeps the rest of its list.
- **The plugin's reach (`data-grid`):** every plugin ctx carries `api`, the imperative handle.
  `api.store` is a read-only wrapper — `getState`, `getInitialState`, `subscribe`, no
  `setState` — whose state reads return the store's live objects and omit the consumer's `on*`
  event callbacks and the core's internal slots (`DataGridReadState`). `api.actions` exposes
  the public actions only; the `_`-prefixed internal actions are not on it. The SDK's
  `useDataGridStoreApi` now returns that read-only wrapper (`DataGridStoreWrapper`), and the
  SDK re-exports `viewRowsMoved` and `visibleColumnsMoved`. `DataGridPlugin`, `PluginRowBands`,
  `DataGridPluginCtx`, `DataGridReadState`, and `DataGridStoreWrapper` are exported from the
  `data-grid` barrel. The `plugins` prop is typed `readonly DataGridPlugin<unknown>[]`, so a
  typed `DataGridPlugin<TData>` stays assignable.
- **Pluggable built-ins (`data-grid`):** `undo`, `redo`, `fillDown`, and `fillRight` are
  pluggable. The core keeps their keymap bindings and their `preventDefault` but hollows their
  bodies: the keys swallow the browser default (mod+R never reloads the page) and run nothing
  until a plugin — or the consumer's own `commands` — defines a command of that name. The
  first-party add-ons register through the seam: `data-grid-fill` (the drag engine moves from
  the `FillHandleTracker` child into the plugin's `Mount`; the hook returns `{ plugin }`),
  `data-grid-history` (the `onDataChange` observer records and the `undo`/`redo` commands back
  mod+Z/mod+Y; the hooks read the grid's `readOnly` flag instead of taking a `readOnly` option),
  `data-grid-presence` (the plugin's `Mount` dev-warns once when rows or columns move under an
  active view-space entry), and `data-grid-pinned-rows` (the bands live in the plugin's
  `rowBands` member; the hook returns `{ plugin }`).
- **`actions.commitChange` (`data-grid`):** the generic data-write action. Pass a `DataChange`
  and the grid applies all of its ops — `update`, `insert`, `delete`, `move` — in one write and
  fires `onDataChange` exactly once, so a history add-on records one undo entry per call. Ops
  resolve by row id through `applyChange`: an op whose row is gone is skipped, and a batch where
  no op applies writes and fires nothing. Row-moving ops run the row-operation view bookkeeping (view
  rebuild; the row channel and the cursor follow their records); update-only batches keep the
  selection and the cursor. Cell errors clear for the written cells, and errors of removed rows
  are pruned. No-op on a `readOnly` grid; a `source: "history"` change passes through without a
  second undo entry. Values are not revalidated — `updateCells` validates; the io add-on
  validates imported rows before `onImport` runs. The import demo now routes imported rows
  through `commitChange` as one `source: "import"` change.
- **Controllable selection (`data-grid`):** `DataGridProvider`/`DataGrid` take `selection`
  (controlled value) and `defaultSelection` (one-shot seed; with both set, `selection` wins and
  dev mode warns once). `onSelectionChange` now delivers the selection in stable `CellRef` terms
  as the new exported `SelectionState` — `{ anchor, range, rangeStack, rowIds, columnIds }`,
  with `CellRange` = `{ start: CellRef; end: CellRef }` — replacing the view-space
  `GridSelection` payload. Gestures are first: a gesture writes the store and fires the callback
  at once; the grid never waits for the consumer's re-render. A re-render that feeds a fired
  value back applies nothing — the store tracks its own emissions, so a consumer several drag
  steps behind never snaps the selection back — and a structurally equal inline literal applies
  nothing. An applied value resolves every ref against the current view: a range with an
  unresolvable corner and unresolvable `rowIds`/`columnIds` are dropped, an `anchor` outside its
  range resets to `range.start`, and the cursor moves to the `anchor` (a normal cursor move,
  `onActiveCellChange`); dev mode warns once per grid for the dropped refs. `onSelectionChange`
  fires only when the derived value differs structurally from the last emitted or applied value,
  so a view rebuild that re-projects the same identities fires nothing, and the callback and the
  controlled flag are the only things that run the derivation. The active cell is not part of the
  value (it moves on every arrow key); `onActiveCellChange` covers it.
- **Controllable column layout (`data-grid`):** `DataGridProvider`/`DataGrid` take
  `columnLayout` (`Partial<ColumnLayout>`), controlled and gesture-first like `selection`, with
  the same echo rule: each given part replaces that part, and an omitted part stays uncontrolled
  (`columnLayout={{ widths }}` controls only widths, and a user reorder survives).
  `defaultColumnLayout` is now `Partial<ColumnLayout>` (the seed is unchanged).
  `actions.setColumnLayout(parts)` replaces the given parts and commits once, like the gestures.
  The store gains `columnLayout`: the always-current snapshot the event fires, recomputed at
  every layout write.
- **Number format, `url`, and `longText` cell types (`data-grid`):** `number` gains
  `options.format` (`Intl.NumberFormatOptions`) and `options.locale` (default `"en-US"`) for
  display-only locale formatting — currency, percent, compact; `toText`, copy, export, sort, and
  the editor keep the raw value, and one `Intl.NumberFormat` is cached per options object. The new
  `url` cell type renders a safe link from the stored URL (`options.label` maps the URL to the
  shown text): only `http`, `https`, and `mailto` render as links — the grid routes every
  `CellType.href` result through the new exported `safeHref()`, so a type cannot widen the list —
  and `openLink` (new built-in action, default alt+Enter) opens the active cell's safe href via
  `window.open(…, "_blank", "noopener,noreferrer")`. The new `longText` cell type stores
  multi-line text verbatim, renders the first 500 characters with line breaks as spaces, and
  edits in a popover textarea (Enter commits and moves down, Shift/Alt+Enter insert a line break,
  Escape cancels, an outside press commits); `options.maxLength` (default 100,000) caps the
  stored text through the textarea and a type-level `validate`. New user-facing string:
  `labels.actions.openLink`.
- **Print and PDF (`data-grid-io`):** `printGrid(state, options)` prints the grid's rows as a
  plain paged table in a hidden, sandboxed iframe and opens the browser print dialog — its "Save
  as PDF" produces the PDF file, so no PDF library is needed. `useDataGridPrint()` wires it to the
  grid's store; `<DataGridPrintButton />` is the toolbar trigger. The scope follows export's
  (`"view"`, `"all"`, `"selection"`); the table holds the visible columns in view order and uses
  the cell type's display text, so formatted values print as they read on screen. A row cap
  (default 10,000, hard ceiling of 500,000 cells) ends the table with a "Printed N of M rows" note
  when it cuts the output. A lazy grid prints its loaded rows only. New user-facing strings:
  `labels.io.printButtonAriaLabel`, `labels.io.printTruncated`.
- **View-sampling autosize (`data-grid`):** `actions.autosizeColumns(options)` sizes columns to
  their content over the whole view, not the mounted rows: it samples `options.sampleRows` view
  rows (default 1000, clamped to [1, 10000]) evenly strided across the sorted/filtered view plus
  the mounted window's rows, measures the cell-type display text with canvas `measureText`, and
  commits every changed width in one write with one `onColumnLayoutChange`. `options.columnIds`
  narrows the pass (hidden, non-resizable, and unknown ids are skipped), `options.includeHeader`
  measures the header text too (default true). The header double-click, the header menu's
  "Autosize column", and the new "Autosize all columns" item (id `autosize-all`) all call the
  action. `DataGridProvider`/`DataGrid` take `autosizeOnMount` (`true` or the same options) to
  run one pass when the view first has rows — once per mount, and columns with a saved width
  keep it. New user-facing string: `labels.contextMenu.autosizeAll`.
- **Status bar add-on (`data-grid-status-bar`):** `<DataGridStatusBar />` shows count, sum,
  avg, min, and max of the selected cells under the grid; `useDataGridSelectionStats` is the
  headless hook. A cell is numeric when its raw value is a finite number; `count` counts the
  non-empty cells via the column's cell type `isEmpty`; sums use Neumaier-compensated
  summation. The bar renders nothing below 2 cells, computes at once for up to 5,000 selected
  cells and on a 150 ms trailing timer above, stops at 200,000 cells (`MAX_STATUS_CELLS`) and
  flags every value with `≈` plus a `title` when capped, and formats sum/avg/min/max through
  the single numeric column's `toDisplayText` when all numeric cells come from one column
  (otherwise `Intl.NumberFormat(locale, { maximumFractionDigits: 4 })`, overridable with
  `formatValue`). New user-facing strings live under `labels.statusBar`.
- **History respects a read-only grid (`data-grid-history`):** `useDataGridHistory` and
  `useDataGridState` take a `readOnly` option. When it is `true`, `undo` and `redo` do nothing,
  and `canUndo` and `canRedo` are `false`.
- **Typed store selectors (`data-grid`):** `createDataGridSelector<TData>()` returns a typed raw
  store selector hook. Create it once at module scope and name it `use…`, like any hook. `TData`
  types `state.data`, and the hook infers the result type from the selector, so the call takes no
  type argument. The hook takes `(selector, eq?)`; `eq` (default `Object.is`) controls
  re-renders. `useDataGridRow<TData>(viewRowIndex)` returns the typed row at a view index
  (unannotated it stays `unknown`, as before). Exported from the `data-grid` barrel.
- **Custom keymap commands (`data-grid`):** the `DataGridProvider`/`DataGrid` `commands` prop
  accepts `Record<string, GridCommand>` — consumer actions behind `keymap` bindings that name
  no built-in action. Each `GridCommand` (`{ run, when?, scope?, label?, group? }`) receives
  `GridCommandCtx` (`{ api, cell, viewRowIndex, viewColumnIndex, row, readOnly }` — `api` a
  `DataGridApi` handle with the methods `useDataGridApi` returns, `cell` a stable
  `{ rowId, columnId }` ref or `null`, `viewRowIndex`/`viewColumnIndex` the active cell's view
  position or `null`, `row` the active cell's data row) and may gate itself with `when`. `scope`
  selects when the command dispatches: `"grid"` (default) while no edit session is open,
  `"editing"` while an edit session is open (any editor, including the select list and the date
  calendar), `"always"` both. An `"editing"` command never takes over a grid binding. `label`
  and `group` set the command's row in the keybindings dialog. A command name shadowing any
  built-in action (including `typeToReplace`, which has no default binding) wins over the
  built-in; an unbound-and-unhandled name is a no-op (each case warns once in dev).
  `GridActions` is now an interface you can extend by declaration merging (like
  `GridCellTypes`), `GridAction` is `keyof GridActions`, and `useDataGridCommands`
  (`data-grid-sdk`) returns the current `commands` map. `GridCommand`, `GridCommandCtx`, and
  `CommandGroup` are exported from
  the `data-grid` barrel; the `data-grid-keybindings` dialog lists custom commands with their
  label and group. See
  [Keybindings: Custom commands](/docs/addons/keybindings#custom-commands).
- **Imperative grid handle (`data-grid`):** `DataGrid` and `DataGridProvider` accept a `ref`,
  and a new `useDataGridApi(ref?)` hook (call it anywhere under the provider, a toolbar sibling of
  `DataGridRoot` included) return the same stable `DataGridApi` object for the grid's lifetime.
  Members: `actions` (the `useDataGridActions` object), `store` (the `useDataGridStoreApi`
  store), `scrollTo(ref)` (stable-`CellRef` scroll), `focus()` (scrolls the active cell into view
  and lands on it; no-op while an edit session is open), `startEditing(ref)` / `stopEditing()` (the latter discards the draft, `cancelEditing`
  semantics), `getSelection()` (a non-reactive `SelectionState` snapshot, stable `CellRef`
  terms), `setSelection(next: SelectionState | null)` (applies a whole selection in stable
  `CellRef` terms or clears with `null`; a single cell stays `actions.selectCell(ref)`),
  `getRow(viewRowIndex)` and `getViewRowIds()` (non-reactive reads in view
  order; `getViewRowIds` gives an unloaded lazy row its placeholder id). `DataGridApi` and
  `useDataGridApi` are exported from the `data-grid` barrel.
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
  widget (`"text" | "number" | "date" | "boolean" | "choices"`, or a component that receives
  `FilterValueInputProps` and renders for every operator with a value). `CellTypeFilter`,
  `CellTypeValueInput`, and `FilterValueInputProps` are exported from the `data-grid` barrel. The
  operator arrays `TEXT_FILTER_OPERATORS` and `COMPARISON_FILTER_OPERATORS`, for declaring custom
  lists, are on `data-grid-sdk`.
- **Grid event API:** six new optional props on `DataGrid`/`DataGridProvider`. `onActiveCellChange(next)`
  fires when the active cell becomes a different cell, when it follows its record or column to
  another view position (a sort, filter, data change, column hide, reorder, or pin), when another
  record comes under it (a lazy row load, or a clamp), or when it is cleared (`null`); a
  value-only write does not fire it. The payload is a `ViewCellRef`
  (`{ rowId, columnId, viewRowIndex, viewColumnIndex }`). `onEditStart(cell)` fires before an edit
  session opens with the target cell's `ViewCellRef` and may return `false` to veto the edit.
  `onEditEnd(event)` fires with a `GridEditEndEvent`
  `{ rowId, columnId, viewRowIndex, viewColumnIndex, result: "commit" | "cancel" | "rejected" }` —
  `rejected` fires per refused commit attempt while the session stays open. A view rebuild that
  removes the active cell's row or column clamps the active cell to the nearest in-view cell and
  collapses the selection onto it (or clears the active cell and the selection's current range when the view empties),
  and `onActiveCellChange` fires for the move. Each session ends with exactly one
  `commit` or `cancel`: a filter, hidden column, or data change that drops the edited cell, and a
  second `startEditing` over an open session (which ends the old session first), report `cancel`.
  `onValidationError(event)` fires after a bulk paste, a fill, or an `updateCells` call settles,
  only when at least one cell was rejected by validation:
  `{ source: "paste" | "fill" | "stream", rejected: [{ rowId, columnId, viewRowIndex, value, message }] }`
  (`"stream"` for `updateCells` and `updateRows`; `viewRowIndex` is `-1` for a row outside the view).
  `onCellDoubleClick` and `onCellContextMenu` fire on the matching cell gesture with the
  `CellClickCtx` shape plus the native `MouseEvent`; both are pure notifications, not veto points.
  Payload types `ViewCellRef`, `GridEditEndEvent`, `GridValidationErrorEvent`, and
  `GridBulkValidationError` are exported from the `data-grid` barrel.
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
  (re-armed when `rejectionCount` rises), and the Enter/Escape/blur bindings (Enter and Escape
  during IME composition do nothing), and returns
  `{ ref, value, onChange, onKeyDown, onBlur, readOnly, "aria-label", "aria-busy", dir }` to spread
  onto an input: the column label, `aria-busy` while `pending`, and `dir="auto"`. `CellEditorCodec`
  is its `{ toDraft, toValue }` codec type.
- **Typed `options` on cell components:** `CellRenderProps` and `CellEditorProps` carry an
  `options` prop typed as the type's declared `TOptions` (a third type parameter on both). Cell
  and editor components destructure it directly instead of casting `column.options`; the
  built-ins no longer cast.

- **Composition parts take props:** `DataGridHeader` accepts `className` for its header-layer
  element and `renderHeaderCell`, a per-column header contents slot. The slot is called with
  `{ column, index, width, headerClickBehavior, sortState }` and `Default`, the built-in contents
  (label, sort indicator, header menu trigger). Return `Default` to keep them or a custom node to
  replace them; the grid keeps the header cell element, its placement, ARIA, gestures, and resize
  handle. `DataGridBody` accepts `className` for its rows-canvas element.
- **`emptyState` accepts a function:** it receives `{ reason }`. The reason is `"no-data"` when
  the data array is empty and `"filtered"` when rows exist but none are in view. A plain node
  still works.
- **New `loadingState` prop:** it replaces the built-in loading presentation while `loading` is
  true — the skeleton (zero rows in view) or the indeterminate bar under the header (rows
  present). Its function form receives `{ reason: "no-data" | "rows-present" }`.

- **Shortcut label API:** `data-grid` exports `isMacPlatform()` and
  `formatShortcut(binding, isMac?)` so consumer UI can render shortcut labels that match the
  grid's own keycaps (glyphs on macOS and iOS, word names elsewhere). `isMac` defaults to
  `isMacPlatform()`. `mod` matches Cmd on iPhone and iPad, so their labels render the `⌘` glyph.
  The keybindings and context-menu add-ons use this shared API; on macOS the keybindings chips
  render `⇧` for Shift. `BindingChips` renders word names during server rendering and switches
  to glyphs after hydration, so a Mac client hydrates without a mismatch.

- **Agent skills:** `npx skills add DammersCode/gridcn` installs five skills for Claude Code,
  Cursor, Codex, and other agents: `gridcn-performance`, `gridcn-custom-cell-type`,
  `gridcn-data-source`, `gridcn-addons`, and `gridcn-upgrade`. The
  [Agent Skills](https://gridcn.vercel.app/docs/agent-skills) page describes each one. The page
  table carries a copy button per row: it copies the single-skill command
  (`npx skills add DammersCode/gridcn@<skill>`, runner prefix follows the site's package-manager
  choice) so one skill installs without the other four.
- **Docs site version and status display:** the top navigation and the docs sidebar show the
  current gridcn version (read from the repository `package.json`); a docs page frontmattered
  `status: new` shows a "new" badge next to its sidebar entry.
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
  (the binding chips the keybindings page teaches); the `data-grid-presence` barrel exports the `isRowIdPresenceHighlight` /
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
  `"no-selection"` (nothing was selected).
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
- **Docs examples for menu resolvers and operator lists:** `data-grid-context-menu-slots-demo` shows
  `getCellMenuItems`/`getHeaderMenuItems`; `data-grid-filter-operators-demo` shows
  `operatorsForColumn`, `ColumnDef.filterOperators`, and `DataGridSortList`'s `allColumns`.

- Coverage thresholds (branch-level, ~85-90% floor) enforced in CI for every pure-lib module —
  selection math, `CompactSelection`, clipboard parse/serialize, fill/series inference, sort/filter
  matching, keymap matching, history, url-state serializers, CSV/XLSX import/export helpers, and
  context-menu target resolution.
- `LICENSE` (Apache License 2.0).
- `data-grid-lazy` add-on: `useDataGridLazyRows` + `DataGridLazyGuard` for fetching rows on demand
  as the viewport scrolls, instead of loading the full dataset up front.
- `data-grid-sort-list` add-on: toolbar sort button + popover for adding/removing/reordering
  multi-column sorts (drag handle or ArrowUp/ArrowDown while focused), mirroring the filter menu's UX.
- Filter and sort popovers: drag-to-reorder (and keyboard ArrowUp/ArrowDown)
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
  `keymap.typeToReplace` (even `[]`) to take the action over and suppress the implicit fallback.
  `typeToReplace` is a first-class remappable keymap action — a printable binding (e.g. a letter)
  seeds the typed char, a non-printable binding (e.g. F3) starts a plain edit.

### Changed

- **Breaking:** `useDataGridClipboard`'s `cut()` now awaits the write and only clears the selection
  when it succeeded and the selection is unchanged — a failed cut keeps the selection and writes no
  `onDataChange`.
- **Breaking: `retainMoveUp`, `retainMoveDown`, `retainMoveLeft`, and `retainMoveRight` keymap actions are now `moveUpKeepSelection`, `moveDownKeepSelection`, `moveLeftKeepSelection`, and `moveRightKeepSelection` (`data-grid`).** They move the active cell and keep the selection. Rename them in any `keymap` override. The matching `labels.keymap` keys are renamed the same way (`moveUpKeepSelection`, `moveDownKeepSelection`, `moveLeftKeepSelection`, `moveRightKeepSelection`).
- **Breaking: `editReplace` keymap action is now `typeToReplace` (`data-grid`, `data-grid-keybindings`).** It matches the name the docs use. Rename it in any `keymap` override. Rename the matching key in a `labels` override too.
- **Breaking: `deleteContents` keymap action is now `clearContents` (`data-grid`).** It matches the "Clear contents" menu item. Rename it in any `keymap` override. Rename the matching key in a `labels` override too.
- **Breaking: `source: "row-op"` is now `"row-operation"` (`data-grid`).** Update any `DataChange.source` check or `recordSources` list that names it.
- **Breaking: vocabulary pass (`data-grid`, `data-grid-lazy`, docs):** the prop `onRowWindowChange` is now `onRenderedRowsChange`, the plugin context field `windowedColumns` is `renderedColumns`, the type `WindowedColumn` is `RenderedColumn`, and the install path `components/data-grid/windowing/` is `components/data-grid/virtualization/`. Update imports and re-run `npx shadcn add @gridcn/data-grid`. Docs, skills, and comments say "virtualization" instead of "windowing", "operation" instead of "op", "drag handle" instead of "grip", and "override" instead of "escape hatch". `GLOSSARY.md` lists the words, and `pnpm lint` rejects the old ones.
- **Breaking:** a press on the row-marker drag handle (`reorder`, `reorder-number`, `reorder-checkbox`, `reorder-both`) no longer selects or checks the row. Dragging reorders and leaves the selection as it was; a stationary press does nothing. Shift and Ctrl/Cmd on the drag handle no longer select. The drag handle zone is now a fixed 20px column (the whole cell in `reorder`) with a `grab` cursor, and the checkbox's extended hit area no longer overlaps it.
- **Small API gaps closed (`data-grid`, `data-grid-io`):** `EMPTY_SELECTION_STATE` is exported for a controlled `selection`; `actions.deleteRowsById(ids)` deletes rows by the ids `getRowIds()` returns; `DataGridExportButton` takes `formats` (a single format exports on click); `ColumnDef.renderCell`, `FilterSpec`, and the `select` choices have fuller JSDoc. The `columnLayout` persistence snippet in the columns docs reads `localStorage` in an effect, so it no longer crashes server rendering.
- **Breaking: `DataChange.source` gains `"rollback"` (`data-grid`, `data-grid-history`):** `useDataGridHistory().rollback(change)` reverts a failed optimistic save with `source: "rollback"` (distinct from `"history"`, which marks undo and redo) and drops the entry from the undo stack. `invertChange(change, source?)` takes the tag, and `createHistory` gains `discard(change)`. An exhaustive `switch` over `DataChange.source` needs the new case.
- **`sortMode="server"` for server-side sorting (`data-grid`):** the grid tracks the sort spec (header click cycle, `aria-sort`, sort indicator, `onSortChange`) and never reorders `data`, so a lazy grid no longer keeps `sortState` empty and reimplements the cycle. Default `"client"` is unchanged.
- **Breaking: Tab leaves the grid.** Outside an edit, `Tab` and `Shift+Tab` move focus to the next or previous focusable element instead of moving the active cell, so the grid is no keyboard trap. The `commitRight`/`commitLeft` actions no longer move the active cell. Bind Tab to `moveRight`/`moveLeft` (`keymap={{ moveRight: ["ArrowRight", "Tab"], moveLeft: ["ArrowLeft", "shift+Tab"] }}`) to keep cell navigation on Tab.
- **Breaking:** `onColumnResizing` and `processPaste` take one ctx object (`data-grid`): `onColumnResizing({ columnId, width })` and `processPaste({ cells, target })` replace the positional arguments.
- **Breaking:** `useDataGridImportPreview` takes one options object (`data-grid-io`): `useDataGridImportPreview({ columnFallback, defaults, limits })` replaces the three positional arguments. `UseDataGridImportPreviewOptions` is exported.
- **Breaking:** `DataGridCell`'s view-index props are renamed (`data-grid`): `rowIndex` is
  `viewRowIndex` and `columnIndex` is `viewColumnIndex`, the view-space names every cell ctx
  already uses. Custom compositions that render `DataGridCell` pass the new names.
- **Breaking:** one `plugins` seam replaces the overlay and row-bands seams (`data-grid`): the
  `overlayPlugins`, `rowBands`, `onUndo`, and `onRedo` props are removed. Register add-ons — and
  custom overlays, bands, observers, commands, and keymap entries — through the `plugins` prop
  (see the plugin-system entry under Added). `FillHandleTracker`, `OverlayPlugin`,
  `RowBandsSpec`, `useDataGridFillHandlers`, `useDataGridOverlayPlugins`, and
  `useDataGridRowBands` are removed from the add-on barrels. `useDataGridFill` returns
  `{ plugin }` — the plugin's `Mount` renders the drag engine inside `DataGridRoot`, so the
  `<FillHandleTracker />` child goes away. `useDataGridPinnedRows` returns `{ plugin }` instead
  of `{ rowBands }`.
- **Breaking:** `useDataGridHistory` takes `{ capacity?, datasetKey?, recordSources? }`
  (`data-grid-history`): the `data`, `setData`, `getRowId`, and `readOnly` options are removed —
  the plugin observes the grid's writes, the hooks read the grid's `readOnly` flag, and the
  grid's `getRowId` prop addresses the ops. `record(change, label?)` now applies the op batch
  to the grid through `commitChange` (`source: "app"`) AND registers it as one entry — do not
  apply the change to your own array first; the grid's `onDataChange` echo updates it.
  `useDataGridState` takes `{ getRowId, capacity?, datasetKey? }` (its `readOnly` option is
  removed) and still returns the spreadable `{ data, getRowId, onDataChange, plugins, history }`;
  the provider wiring moves from the `onUndo`/`onRedo` props to the history `plugin` in
  `plugins`. `DataGridApi.store` is now the read-only wrapper — no `setState`, public actions
  only (see the plugin-system entry under Added).
- **Breaking:** `onSelectionChange` delivers the stable `SelectionState`, and
  `onSelectionCleared` is gone (`data-grid`). The payload is now `{ anchor, range, rangeStack,
  rowIds, columnIds }` in `CellRef` terms (the new props are in the entry under Added): code
  that read the view-space `next.current.range` rect re-reads `next.range`'s `{ start, end }`
  `CellRef` corners, and the `next.rows`/`next.columns` channels become `next.rowIds`/
  `next.columnIds` id arrays. `onSelectionCleared` is removed — an empty `next`
  (`range: null`, both channels empty) is the cleared signal, and `onSelectionChange` fires it
  once on the non-empty-to-empty transition.
- **Breaking:** `setSelection` takes a `SelectionState`, and `getSelection` returns one
  (`data-grid`). The imperative handle's `setSelection(next: SelectionState | null)` applies a
  whole selection — a range, a range stack, and the row and column channels — in stable
  `CellRef` terms, or clears it with `null`, and emits like a gesture. Selecting a single cell
  stays `actions.selectCell(ref)`. `getSelection()` returns the derived `SelectionState`
  (empty fields when nothing is selected), not a view-space snapshot.
- **Breaking:** one config home (`data-grid`): `readOnly`, `keymap`, `onCellClick`,
  `onRowClick`, and `onRenderedRowsChange` move from `DataGridRoot` to `DataGridProvider`. They
  are sync props: the provider (or `useDataGridStoreProps` for an external store) feeds them to
  the store, and every reader reads the store - the root's `aria-readonly` and keymap through
  `useDataGridReadOnly()` and `useDataGridKeymap()`, interaction and clipboard at event time,
  and the cell's click handlers at click time. `DataGrid` prop names are unchanged. Manual
  composition moves the five props to `<DataGridProvider>`; `DataGridCellProps` loses
  `onCellClick` and `onRowClick`, and the SDK's `DataGridRootContextValue` loses all five -
  read the store instead. A sync prop next to `store` is a type error (`DataGridProviderProps`
  and `DataGridProps` union the two ownership shapes), and dev mode warns once when an untyped
  caller passes both. `readOnly` and `keymap` now seed the store at creation, so SSR and the
  first client paint see them: the fill handle no longer paints in a read-only grid before mount
  effects run. A `readOnly` flip syncs before passive effects flush, so a keydown right after
  the commit is already blocked, and an open editor cancels with `onEditEnd` `cancel`. `keymap`
  keeps its state identity while the action keys and binding strings are equal in the same
  order, so an inline `keymap={{ ... }}` literal neither re-syncs nor churns the interaction
  memos.
- **Breaking:** `buildExportRows` takes an options object instead of a positional `maxRows`
  (`data-grid-io`). `buildExportRows(state, scope, { text?: "export" | "display"; maxRows? })`:
  `maxRows` now lives in the object, and `text: "display"` emits the cell type's display text
  (`toDisplayText ?? toText`) instead of the export text (`toText`) — the mode print uses. Cell
  values are read through `getCellValue`; a column with neither `accessorKey` nor `accessorFn`
  (already a development warning) now throws on read instead of exporting empty cells.
- **Autosize measures the view sample, not the mounted rows (`data-grid`):** the header
  double-click and the header menu's "Autosize column" previously measured only the rendered,
  windowed cells — a column whose widest value sat off-screen fit the visible rows, and a long
  dataset could make it shrink. Both now run the store's `autosizeColumns` action, which samples
  the whole view (see the autosize entry under Added).
- **Breaking:** row ops and immediate re-sorts apply live while an edit session is open
  (`data-grid`). `insertRows`, `deleteRows`, `duplicateRows`, `reorderRows`, and an
  `updateCells` batch with `reorder: "immediate"` no longer no-op (or defer) under an open
  editor: the op applies and the open edit re-anchors to its row's new view position, keeping
  its draft while the row stays in the rendered window. A row op that removes the edited row
  cancels the session — the draft is dropped and `onEditEnd` fires with `result: "cancel"`.
  Before, the row ops were no-ops with a development warning, and an immediate re-sort
  deferred until the session ended.
- **Breaking:** `renderHeaderCell` replaces the contents of a grid-owned header cell
  (`data-grid`). Its `ctx` is `{ column, index, width, headerClickBehavior, sortState }`; the
  resize, reorder, select, and sort plumbing is gone from it. Before, the slot replaced the whole
  header cell element, so a custom cell had to place itself and set its own `role` and
  `aria-colindex`.
- **Breaking:** `select` columns sort by choice label (`data-grid`). The built-in `select` type's
  `compare` orders the labels with a numeric-aware, case-insensitive collation. A cell type's
  `compare` receives the column's `options` as a third argument. Before, `select` columns sorted
  by the stored value.
- **Breaking:** `onColumnLayoutChange` fires only on real changes (`data-grid`). `setColumnPin`
  with the current pin, `setColumnHidden` with the current visibility, `setColumnOrder` with a
  drop that keeps the order, and `commitColumnWidth` with the last committed width no longer fire
  it. `setColumnHidden` ignores a column id that `columns` does not define. Before, each call fired
  the callback, and an unknown id went into `hidden`.
- **Breaking:** the active cell follows its record and its column (`data-grid`). A sort, filter,
  consumer `data` swap, or a column hide, reorder, or pin moves the active cell with its record and
  column, and `onActiveCellChange` fires with the new view position. The grid clamps the active
  cell only when its row or column leaves the view. Before, the active cell stayed on its view
  position, so a Delete after hiding a column to its left cleared a different column.
- **Breaking:** selected columns follow their column (`data-grid`). The column channel
  (`selection.columns`, header selection) moves with each column on `setColumnOrder`,
  `setColumnHidden`, `setColumnPin`, and a new `columns` array. A column that leaves the view
  leaves the selection. `setColumnWidth` and `commitColumnWidth` ignore a column id that
  `columns` does not define. Before, the selection stayed on column positions, and an unknown id
  got a width entry.
- **Breaking:** checked rows follow their records (`data-grid`). The row channel
  (`selection.rows`, the marker checkboxes) moves with each record when a sort, filter, join
  operator, consumer `data` swap, `updateCells` reorder, or a row insert or duplicate under a sort
  or filter changes the view. A record that leaves the view leaves the selection, and it stays
  unchecked when it comes back. When a rebuild puts other records or other columns under the
  cursor range, the grid collapses the range onto the active cell. A clamp that moves the active
  cell collapses the selection onto it; a clamp in place drops the range. A row
  operation and `getRowIds()` never reach a record that was not selected. Without checked rows or
  a range, `deleteRows` and the row shortcuts act on the active cell's row.
  Before, the checks and the range stayed on view positions, so a sort moved them onto other
  records, and a row insert or duplicate under a sort cleared the checks.
- **Breaking:** `useDataGridActions()` and `useDataGridStoreProps().actions` return only the
  public actions (`data-grid`). The `_`-prefixed internal actions, such as `_registerReadOnly` and
  `_syncProps`, are gone from both the `DataGridActions` type and the returned object. The
  imperative handle's `actions` follows the same rule. The raw store (`store.getState().actions`,
  store selectors) still holds the internal actions.
- **Breaking:** `onDataChange` fires after the grid stores the new data (`data-grid`). A write
  action called inside the handler, such as `updateCells`, starts from that data, and the grid
  keeps both changes. A write that an `onActiveCellChange` or `onSelectionChange` handler makes
  during a write emits after it, in gesture order. Before, the outer write overwrote the inner
  one. A commit's events arrive in the order `onActiveCellChange` and `onSelectionChange`, then
  `onDataChange`, then `onEditEnd`; before, `onDataChange` came first.
- **Breaking:** keymap ties resolve per binding (`data-grid`). When two actions bind the same
  combo with the same number of modifiers, a `keymap` binding that is not one of the action's
  default bindings wins; a tie between default bindings keeps the earlier action (Enter: `edit`
  before `commitDown`). A `keymap` entry that repeats a default binding counts as the default,
  whatever its modifier order or key case.
  Before, the first action in keymap order won every tie. Off macOS, `ctrl` and `mod` bindings
  of the same key count as one shared combo for the development warning.
- **Breaking:** `CellEditorProps` has required `rowId` and `columnId` props (`data-grid`). A
  custom editor receives the stable ids of the edited cell. Code that renders an editor component
  directly must pass both props.
- **Breaking:** the write-pulse follows its row (`data-grid`, `data-grid-sdk`). `flashCells` takes
  `CellRef[]` (`{ rowId, columnId }`) instead of opaque string keys, so a sort, filter, or reorder
  moves the pulse with its row instead of leaving it on another record for up to 1.4 s.
  `flashCellKey` is no longer exported, and the store's `flashingCells` holds row-id keys. The
  `data-grid-sdk` barrel exports `rowIdAtViewRow(state, viewRow)` to resolve the id for a view row.
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
- **Breaking:** `CellRef` is the public cell coordinate. `CellCoord` is renamed to
  `ViewCoord` (same `{ col, row }` shape — view space, not a `data` index). The cell actions
  `selectCell`, `setActiveCell`, `extendTo`, `pushRange`, `startEditing`, and `commitCellValue`
  now take a `CellRef` (`{ rowId, columnId }`) — the stable identity that survives sorting,
  filtering, and pagination — and each gains an `*At` variant that takes a `ViewCoord`
  (`selectCellAt`, `setActiveCellAt`, `extendToAt`, `pushRangeAt`, `startEditingAt`,
  `commitCellValueAt`). `useDataGridScrollToCell` now takes a `CellRef`; a new
  `useDataGridScrollToCellAt` takes a `ViewCoord`. A `CellRef` that no longer resolves (row
  removed from `data`, column hidden) is a no-op with one console warning per grid in
  development.
- **Breaking:** every cell context has a string `rowId` (`data-grid`, `data-grid-pinned-rows`,
  `data-grid-context-menu`). `useDataGridRowId` and `useDataGridRowIds` return the placeholder
  id `__lazy-unloaded-<index>` for an unloaded lazy row instead of `undefined`; a `renderMarker`
  ctx on such a row carries the same id. A pinned row's cell ctx `rowId` comes from `getRowId`.
  If `getRowId` throws on a pinned row or returns an empty or non-string value, the row gets the
  band id `__pinned-top-<index>` or `__pinned-bottom-<index>`.
  `DataGridPinnedRow` takes a required `position` prop (`"top" | "bottom"`), and
  `DataGridCellProps.rowId` is required. Skeleton cells of an unloaded row fire no click
  events (`onCellClick`, `onRowClick`, `onCellDoubleClick`), and a right-click opens no
  context menu.
- **Breaking:** cell contexts carry row and column identity. `renderCell` (and `Cell`
  components) rename `rowIndex` to `viewRowIndex` and add `rowId` and `columnId`. The
  `getCellClassName` ctx gains `rowId` and `columnId`. `CellClickCtx` (used by `onCellClick`,
  `onCellDoubleClick`, and `onCellContextMenu`) renames `rowIndex`/`columnIndex` to
  `viewRowIndex`/`viewColumnIndex` and adds `rowId`/`columnId`; `RowClickCtx` (used by
  `onRowClick`) renames `rowIndex` to `viewRowIndex` and adds `rowId`. The context menu's `getCellMenuItems` ctx renames `row` to
  `viewRowIndex` and adds `rowId`. `GridBulkValidationError` rejected entries add `rowId` and
  rename `viewRow` to `viewRowIndex`, as do `applyCellUpdates` entries and the sdk's
  `BulkCandidate`/`BulkWrite` types.
- **Breaking:** `select` quick search matches the choice label, not the stored value
  (`data-grid`). A `select` column's stored values are opaque choice ids; quick search now
  uses the option's `label` (its `toSearchText`). Custom types can declare their own
  `toSearchText` for the same control.
- **Breaking:** `resolveBulkWrites` returns the rejected cells too (`data-grid-sdk`). The
  validation tail of paste and fill now returns `{ writes, rejected }` (`BulkResolution`)
  instead of a plain write array — `rejected` carries every cell the validators refused, with its
  `message`, and feeds the new `onValidationError`. `buildPasteWrites` and `buildFillWrites`
  follow the same shape (the latter now returns `{ resolution, filled }`).
- **Breaking:** `renderCellMenuItems` / `renderHeaderMenuItems` are replaced by menu resolvers.
  The two render-slot props of `DataGridContextMenu` are removed. Pass `getCellMenuItems` /
  `getHeaderMenuItems` instead — they return a `GridMenuItemSpec[]` item list (item-level
  control) instead of a React node (whole-set replacement only), and the header resolver also
  reaches the header dropdown.
- **Breaking:** `cellTypes` merges over the built-ins. The `cellTypes` prop previously REPLACED
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
- **Breaking:** the core barrel is split into a consumer API and an add-on SDK. `data-grid` is now
  the consumer surface — components, props and ctx types, the state hooks, and the op/validation
  engines the docs teach. Add-on-internal seams move to a new `data-grid-sdk` module in the same
  install: `GRID_LAYER`/`cellLayer`/`GridLayer`, `pointerToCoord`/`InteractionLayout`, the
  direction math (`applyInlineScrollDelta` and friends; the `GridDirection` type stays on
  `data-grid`), `useDataGridRootContext`/`DataGridRootContextValue`, `useDataGridStoreApi`,
  `DataGridStoreState`, `useDataGridCommands`, `useDataGridColumnFeatureFlags`,
  `useDataGridSearchMatches`, `useDataGridSearchCapped`, `useDataGridContainer`, `isDev`,
  `GRID_ATTR`/`gridAttrSelector` and their `GridAttr*` types, `createHistory` with `History` and
  `HistoryOptions`, `setCellValue`, `TEXT_FILTER_OPERATORS`, `COMPARISON_FILTER_OPERATORS`,
  `DataGridFilterOperatorLabels`, the validation engine (`runValidateSync`,
  `runValidatePending`, `runValidateBatch`, `resolveBulkWrites`, `useBulkGeneration` and the bulk
  types), `combineRects`, `getSelectedViewRows`, `measureColumnAutosizeWidth`,
  `GridColumnLayout`, and `RenderedColumn`. Add-ons import them from `data-grid-sdk`; consumer
  code that imported any of these from `data-grid` must switch to `data-grid-sdk`.
  `useDataGridStoreProps` stays on `data-grid`.
- **`useDataGridRowIdToViewRow` keeps its map across streaming ticks:** the `rowId -> view row`
  map now keys on a store-internal row-identity version (bumped only when rows move:
  insert/delete/duplicate/reorder, or a consumer `data` replacement) instead of the `data` array
  itself — value-only `updateCells` ticks no longer force the O(n) map rebuild, so consumers of
  the map stop re-rendering per tick. `getRowId` must return stable ids across value-only writes
  (row ids are identity, not content).
- **Breaking:** selection changes fire only on real changes: repeated `extendTo` at the same
  coord (a stationary drag), a clamped `extendSelection` at a grid edge, and a
  `selectRow`/`selectColumn` re-fire that leaves both channels and `lastHighlighted*` unchanged no
  longer replace the selection object. `onSelectionChange` and selection-keyed re-renders now fire
  only when the selection content actually changed. `CompactSelectionLike` gains
  `equals(other)`: a custom selection channel in a selection's `rows` or `columns` must implement
  it.
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
  family the press location decides the behavior: a drag from the drag handle zone (drag handle plus
  cell background; the whole cell in `reorder` mode) reorders the row; the number and checkbox
  glyphs stay row-select surfaces (click selects/toggles, drag selects a range); a stationary
  drag handle press does nothing, and Shift or Ctrl/Cmd on the drag handle no longer selects.
  Custom-rendered markers (a `renderMarker` without the built-in marker attributes) are
  selection-only and never reorder.
- **Toolbar on narrow screens:** `DataGridToolbar` now scrolls horizontally when its controls
  outgrow the container (mobile viewports) instead of clipping the last controls.
- **Simplified install:** `npx shadcn add @gridcn/<item>` now resolves the hosted `@gridcn`
  registry directly — the separate `npx shadcn registry add "@gridcn=…"` step is no longer needed.
  The GitHub registry path (`npx shadcn add DammersCode/gridcn/<item>#<ref>`) remains the way to
  pin a tag, branch, or commit.
- **Breaking:** byte-level output change. CSV exports now start with a UTF-8 BOM by default, so
  Excel detects UTF-8 (without it, umlauts and other non-ASCII characters opened as mojibake).
  Opt out with `csvBom: false` on `exportGrid`. Related additions: `.tsv` files are now accepted on import
  (the import dialog's `accept` includes them), `IMPORT_CANCELLED_MESSAGE` is re-exported from the
  `data-grid-io` barrel, and `useDataGridState`'s `history` object now exposes `clear` (empties
  both undo/redo stacks).
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
  (row count, virtualization, `aria-rowcount`) immediately and respect the active sort/filter, so a
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
  `DataGridUrlState` as incompatible with lazy grids;
  the custom-cell-types page states the `cellTypes` registry's type
  erasure (per-key safety comes from `defineColumns` + `GridCellTypes` augmentation) and what a
  plain `ColumnDef` does or does not cross-check; the columns and events-state pages agree on
  what fires `onColumnLayoutChange` (drag release, double-click autosize, and menu autosize); the
  fill page documents `onFill.values` as the computed target-strip pattern (not a copy of the
  source range) and the `detectSeries` option; the sorting/filtering page documents
  `filterMatch`/`filterOperators`.
- **Streaming verdicts:** `updateCells` and `updateRows` now return a verdict —
  `{ applied, skipped, pending }`. `skipped` names every patch that was not written, with its
  index in the patch list and a reason (`unknown-row`, `unknown-column`, `hole`, `readonly`,
  `invalid`, `no-op`); `pending` is `true` while an async schema holds the batch (its outcome is
  not reportable on the return value).
- **Breaking:** import rejects are reported. `buildImportedRows` now returns `{ rows, rejected }`
  instead of the row array, which breaks code that called it directly and read the array.
  `rejected` (`ImportRejectedCell[]`) lists every cell that failed its column's `validate` and was
  cleared, with the data row, the source column, and the grid column. The import dialog shows
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
- **Breaking:** the `data-grid-keybindings` entry point no longer exports `bindingTokens` — the
  core's `formatShortcut` (from the `data-grid` entry point) returns the same tokens. The
  `data-grid` entry point no longer exports `useDataGridInstanceId`; it is on the `data-grid-sdk`
  surface the first-party add-ons import.

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
  `RenderedColumn` from its barrel, since the add-on's moved `DataGridPinnedRow` needs both.

- **Breaking:** the `data-grid-io` `maxDecompressedBytes` default drops from 512 MiB to 256 MiB
  (`DEFAULT_IMPORT_LIMITS`), and an xlsx part is also capped at `maxCells` times 10 bytes plus
  1 MiB (about 51 MiB at the default); a part over the cap is rejected with `errorFileTooLarge`
  before it is read. hucre's sparse read keeps every cell it finds, so a 234 KB file of 10 million
  styled empty cells (`<c s="0"/>`) used to peak at 1.6 GB. A sheet at the new cap peaks near
  0.9 GB. The cap covers the shared strings too, so a sheet with more than about 51 MiB of XML
  or text needs a higher `maxCells` in `importLimits`.
- The `checkbox` cell type's display renders a lightweight `span` instead of the full base-ui
  `Checkbox` control (`data-grid`): the display cell is never interactive (the interaction layer
  toggles the value; the box receives no events and was never focusable), so the span carries
  `role="checkbox"`, `aria-checked`, the `data-grid-checkbox` attribute, the same 16px box and
  check icon, and skips the control's state machine and per-row effect work. No API change; the
  element under a checkbox cell is a `span` instead of a `button`.

### Removed

- **Breaking:** `onRowClick` and `RowClickCtx` are removed (`data-grid`); use `onCellClick`, whose
  ctx carries `row`, `rowId`, and `viewRowIndex`. `OnRowClick` leaves the type exports too.
- **Breaking:** five unused hooks leave the `data-grid` barrel (`data-grid`):
  `useDataGridEditingError`, `useDataGridRowHasError`, `useDataGridIsCellActive`,
  `useDataGridIsCellEditing`, `useDataGridCellInitialText`. They were undocumented and have no
  first-party caller; cell-level reads use `useDataGridCellState` and
  `useDataGridCellEditingError`, and row-level error presence uses `useDataGridRowCellState`.
- **Breaking:** the `data-grid-fill` entry no longer exports the fill-engine internals —
  `computeFillTarget`, `generateFill`, `fillDirection`, `rectRelativeTo`, and the
  `AllowedFillDirections`, `ComputeFillTargetOptions`, `FillDirection`, and `GenerateFillOptions`
  types. The surface is `useDataGridFill`, `detectSeries`, `FillArgs`, and `SeriesDescriptor`.
- **Breaking:** the `data-grid-url-state` entry no longer exports the URL param codecs —
  `serializeSortState`/`parseSortState`, `serializeFilterState`/`parseFilterState`,
  `serializeJoinOperator`/`parseJoinOperator`, `serializePage`/`parsePage`,
  `serializePageSize`/`parsePageSize`, `DEFAULT_URL_PAGE_SIZE`, `FILTER_OPERATORS`, and
  `prefixedKey`. `useDataGridUrlState`, `useDataGridUrlPagination`, and `DataGridUrlState` use
  them internally; the surface keeps those hooks and the `Use*Options`/`Use*Result` types.
- `data-grid`: the internal `components/data-grid/clipboard/index.ts` barrel is no longer installed.
  Import `useDataGridClipboard` from `@/components/data-grid/data-grid`.

### Fixed

- **A refused pointer capture no longer breaks a fill-handle drag:** the handle captures the pointer through `safeSetPointerCapture`, so an unknown or already released pointer id degrades to a document-level drag instead of throwing.
- **Fill detects a series over a very large selection:** series detection no longer spreads every value into `Math.max`, which threw `RangeError` for selections of about 100k cells or more.
- **Global shortcuts skip the Safari IME confirming key:** `useDataGridGlobalShortcuts` no longer runs undo or redo for a keydown with `keyCode` 229 and `isComposing` false.
- **Pasting after a select-all of a very large grid no longer fails:** the paste target reads the first selected row or column instead of spreading every index into `Math.min`, which threw `RangeError` at around a million selected rows.
- **Paste ignores a plain-text clipboard payload far too large for the paste cap:** text above about 256 characters per allowed cell (at least 1 MiB) yields no cells, like an oversized HTML payload, instead of being scanned in full.
- **Grid key handling skips the Safari IME confirming key:** a keydown with `keyCode` 229 and `isComposing` false no longer reaches grid-level commands and navigation, matching the editors.
- **Hostile cell values no longer crash display or copy:** a value whose string conversion throws (a null-prototype object, a proxy with a throwing `toString`) renders as empty text in `text`, `select`, and `date` cells. Copy uses that value's safe text when a cell type's `toText` throws. Export reports a throwing `toText` through `onError`.
- **Duplicate column ids warn once per grid instance:** the development warning for duplicate column ids no longer fires on every render.
- **Consumer TypeScript infers `closest`'s type parameter:** the parameter is explicit, so TypeScript 5.9 infers it in consumer code.
- **Cell values that cannot be stringified no longer unmount the grid:** the `text`, `url`, `select`, `number`, `longText`, and `date` cell types, and the view pipeline behind filter, sort, empty check, and quick search, read an empty string for a null-prototype object or a deeply nested array instead of throwing.
- **URL state keeps sort and filter for a column the user shows again:** a URL spec is dropped only while its column is currently hidden, not for every column defined with `hidden: true`.
- **Paste cell cap applies inside one row:** a clipboard row wider than the 200,000-cell paste cap stops parsing at the cap, in both the plain-text and HTML parsers, and a first row over the cap is cropped instead of dropping the whole paste.
- **`reorderRows` under `sortMode="server"`:** a server sort no longer blocks row reordering; insert and duplicate follow the same rule.
- **History rollback restores re-created rows and multi-op rows:** `rollback(change)` reverts a whole-row update when the consumer re-created the row objects, and reverts every update op a change holds for one row.
- **Unstable `columns` identity warning sees nested values (`data-grid`):** an inline `columns` literal with `options.choices` or a JSX `header` now triggers the dev warning; the comparison goes up to four levels deep into plain objects, arrays, and elements.
- **`useDataGridState` matches `DataGrid` (`data-grid-history`):** `getRowId` and the options argument are optional (the grid default applies), and `history.rollback` is exposed next to `undo`, `redo`, and `record`.
- **`DataGridLazyGuard` respects `sortMode="server"` (`data-grid-lazy`):** a sort change no longer warns when the server owns the order, and the warning points to `sortMode="server"` instead of controlled `sortState`.
- **Streamed writes under `sortMode="server"` no longer flag the view stale (`data-grid`):** `updateCells` into the server-sorted column left `viewStale` true and offered a re-sort the grid cannot perform.
- **`useDataGridHistory().rollback` is cell-level (`data-grid-history`):** a rollback reverts only the cells that still hold the failed change's value, so later edits to other cells of the same row survive. Rolling back a change the user already undid writes nothing, and a `rollback` called synchronously inside `onDataChange` leaves no undo entry.
- **Tab out of a cell editor keeps focus on the next control:** when Tab commits a `text`, `number`, or `select` edit, the grid no longer pulls focus back to the edited cell, so focus lands on the next control after the grid.
- **A cancelled row reorder no longer commits:** when the browser cancels the pointer mid-drag (for example a touch turning into a scroll), the grid drops the reorder instead of moving the row.
- **A checkbox press that barely moves keeps the row selection:** pressing a marker checkbox and moving the pointer within the same row no longer replaces the selection with that row, so the following click toggles the row on instead of off. The range drag starts once the pointer reaches another row.
- **Marker checkboxes and the header menu trigger are not tab stops:** with `rowMarkers` checkbox modes, Tab from a cell now leaves the grid instead of landing on the next row's checkbox, and Shift+Tab no longer lands on "Select all rows".
- **Number cell parsing runs in linear time:** a long digit run followed by a letter in an imported or pasted number cell no longer freezes the page.
- **`EMPTY_SELECTION_STATE` is frozen:** the exported shared default (and its arrays) can no longer be mutated by a consumer, which used to corrupt the grid's own cleared-selection value.

- **Dragging from a row marker checkbox keeps the first row selected:** a drag that starts on the checkbox (`checkbox`, `both`, and their `reorder-` variants) and ends on another row no longer toggles the first row off on release.
- **Columns identity warning fires only for a rebuilt array:** the dev-mode "columns array identity changed" warning now fires only when the new array equals the previous one (same ids and values) — a locale switch or a toggle that swaps the column list no longer warns.
- **Cell error message meets contrast:** the error popup under an invalid cell uses the page background instead of a tinted one, which lifts the text above the 4.5:1 minimum.
- **Marker column header has an accessible name:** it renders a visually hidden label, set by the new `labels.markers.columnHeader` (default "Row markers"). The actions demo labels its header cell too.
- **Loading bar sits outside the grid element:** the visual bar is `aria-hidden` and a visually hidden `role="progressbar"` renders next to the grid, so axe no longer reports `aria-required-children` on `role="grid"` while `loading` is true.
- **Demos render the same text on server and client:** the lazy-loading, events, and related demos format numbers and times with an explicit `en-US` locale, which removes the hydration mismatch (React error #418) on servers whose default locale differs from the browser.
- **Text, URL, and select cells tolerate non-string values:** `toText`, `toDisplayText`, and `href` convert a number or boolean from a JSON API with `String()` instead of throwing, and strings behave as before.
- **Presence validates remote colors:** a peer's `color` that the browser does not parse as a CSS color falls back to a default instead of reaching the overlay styles unchecked.
- **XLSX export cuts oversized cell text:** `buildXlsx` and `exportGrid` cut cell text to Excel's 32,767-character limit, so Excel no longer offers to repair the file. Print already cut at the same limit.
- **URL state ignores excluded columns:** sort and filter specs from the URL are dropped (with a dev warning) when the column is `sortable: false`, `filterable: false`, or `hidden: true`, so a crafted link can no longer filter by a column the grid excludes.
- **Number cell rejects non-decimal input:** `fromText` returns `null` for `Infinity`, `1e999` (overflow), and hex, octal, or binary text such as `0x10`, instead of storing `Infinity` or a surprising integer. Decimal and scientific notation still parse.
- **Drags survive a refused pointer capture (`data-grid`):** range, row, column, row-reorder and column-resize drags no longer abort when the browser rejects `setPointerCapture` (an unknown pointer id from synthetic test events, or a detached element). The drag falls back to its document-level listeners.

- **Checkbox cells have an accessible name (`data-grid`):** the `checkbox` display box carries an `aria-label` from its column header, which clears axe's `aria-toggle-field-name` violation.

- **Autosize samples the whole row range (`data-grid`):** `autosizeColumns` spreads its sample rows evenly across the view and always includes the last row, so wide values in the final rows no longer go unmeasured.

- **Status bar caps the walk on lazy holes (`data-grid-status-bar`):** the 200,000-cell cap counts every visited cell, not only loaded ones, so a selection over unloaded rows stops early and reports `approximate`. A sum that overflows to infinity reports `Infinity` with no average instead of `NaN`.

- **`deleteRows` keeps the cursor on an open edit (`data-grid`):** when the edited row survives a `deleteRows` call, the active cell and selection stay on the edit cell. Before, Escape after such a delete left the grid with no active cell and dead arrow keys.

- **A `null` selection anchor no longer warns (`data-grid`):** a selection value with a `range` and a `null` `anchor` resets the anchor to `range.start` silently. The false warning also used up the one-per-grid warning for a real unresolvable value.

- **Large selections resolve in one pass (`data-grid`):** `setSelection`, the controlled `selection` prop, and `defaultSelection` look up many row ids with one index build instead of one full scan per id. Resolving 2,000 ids over 100k rows no longer makes about 100 million `getRowId` calls.

- **Plugins attach on mount (`data-grid`):** a plugin object is claimed when the grid mounts and released when it unmounts. A plugin no longer logs a false "already attached" warning under `<StrictMode>`, and re-mounting a grid with the same plugin object keeps the plugin. A second live grid with the same plugin object is still refused and warned.

- **Touch select drags survive auto-scroll past the rendered window (`data-grid`):** a
  selection drag (cell range, row marker, or column header) that reaches a viewport edge
  auto-scrolls the grid; the pressed element unmounts the moment the scroll moves it out of
  the rendered window, and the browser releases its pointer capture on unmount — which
  cancelled the touch pointer and silently ended the drag. Once the edge auto-scroll engages,
  the drag hands its capture to the grid's scroll element, which outlives the drag, so a touch
  select drag now reaches cells and rows past the initial window as on mouse. When that
  handoff has happened, the press's release-time resolution (a checkbox press toggling on
  release back on the pressed cell) runs on the true pointerup coordinate, because the
  capture-retargeted `click` no longer reaches the pressed cell; without the handoff the
  existing click-based path is untouched.
- **Touch row-reorder drags survive auto-scroll past the rendered window (`data-grid`):** a
  browser implicitly captures a touch pointer on the pressed element and releases it when that
  element unmounts — the drag handle's row unmounts the moment auto-scroll moves it out of the window,
  which silently killed the drag's document-level tracking. The gesture now takes pointer capture
  on the grid's scroll element the instant it arms, so the drag reaches rows past the initial
  window on touch as on mouse.
- **`onCellDoubleClick`/`onCellContextMenu` ignore editor-owned events (`data-grid`):** a
  double-click or right-click inside the cell's open editor — the inline text/number input,
  or the portaled date/select/long-text popover — no longer fires the consumer's events.
- **The currency recipe's codec preserves `0`:** `toValue` and `fromText` built the value with
  `Number(draft) || null`, so a typed `0` — falsy — became `null`. They now parse the trimmed
  draft and reject only `NaN`, so `0` commits as a value.
- **The server-error examples use the imperative handle, not store lifting:** the cell-errors
  demo and the server-error examples in the docs call
  `gridRef.current?.actions.setCellErrors` for the async `onDataChange` follow-up — the
  rejection lands long after mount — instead of lifting the store with
  `useDataGridStoreProps`, which stays for a store that must live outside the provider's
  render. The context-menu catalog description names `getCellMenuItems` and
  `getHeaderMenuItems`.
- **IME composition keeps the editor open (`data-grid`):** Enter and Escape that confirm or
  cancel an IME composition no longer commit or cancel the edit in the text, number, and date
  editors, or in an editor built on `useCellEditor`. This includes the confirming Enter that
  Safari sends with `keyCode` 229.
- **A new `getRowId` with new `data` prunes errors by the new ids (`data-grid`):** when the
  consumer replaces `getRowId` and `data` in the same render, the grid drops `cellErrors` entries
  and `validateRow` bookkeeping for row ids that the new `getRowId` does not return. Before, the
  grid read the ids with the old `getRowId`, so a stale entry could stay and a later `validateRow`
  run could clear a consumer error on a reused id. A `getRowId` change needs a new `data` array:
  in development, the grid warns once when a new `getRowId` returns other ids for the first or
  last loaded row while `data` keeps its array.
- **Ctrl+A is linear in the row count (`data-grid`):** the first press finds the data region by
  growing each edge to its limit, so a 100k-row grid with an empty neighbour column selects at
  once. Before, the growth rescanned that column for every added row.
- **Export with `maxRows` builds only the capped rows (`data-grid-io`):** `exportGrid`,
  `buildXlsx`, and `buildExportRows` (new optional `maxRows` argument) run the cell accessors
  for at most `maxRows` rows. Before, they built every row, then cut the result.
- **Server examples apply a move batch in the right order:** the fake remote server and the
  "Translate ops into API calls" recipe handle the `move` ops of a batch together, with
  `applyChange` semantics. Before, moves applied one at a time put rows in the wrong order.
- **Keys typed in a `contenteditable` inside the grid stay there (`data-grid`):** the grid
  ignores key events from an editable element, such as a `contenteditable` in a custom cell, that
  is not its own cell editor. Before, Delete and Backspace in such an element also cleared the
  selected cells.
- **Clipboard events from an editable element inside the grid stay there (`data-grid`):** the
  grid ignores `copy`, `cut`, and `paste` events from an input or a `contenteditable` in a custom
  cell, also inside a shadow root. Before, the grid copied its selection instead, a cut cleared
  the selected cells, and a paste wrote into the grid.
- **A grid nested in a cell owns its own clipboard and focus (`data-grid`):** a `copy`, `cut`, or
  `paste` inside a nested grid reaches only the nested grid, and the host's `api.focus()` never
  lands on the nested grid's active cell. Before, one paste wrote into both grids.
- **Registry items declare every dependency they import:** `data-grid-url-state` depends on
  `data-grid-pagination`. `data-grid` and `data-grid-context-menu` declare `@base-ui/react`,
  `data-grid-context-menu` declares `zustand`, and `data-grid-io` declares `lucide-react`.
  Several demos declare the `button`, `input`, `select`, and `dropdown-menu` components they
  use. An install no longer misses these files and packages.
- **A held fill or paste stays silent in a read-only grid (`data-grid`, `data-grid-fill`):** when
  the grid turns read-only while an async validation holds a fill or paste, the late result writes
  nothing and fires no `onValidationError`. Before, the rejected cells still fired the event.
- **`defaultColumnLayout` is normalized (`data-grid`):** the grid drops layout entries for column
  ids that `columns` does not define, clamps each width to the column's `minWidth`/`maxWidth`, and
  ignores a pin on a `pinnable: false` column. A `hidden: true` column that the saved `order` does
  not list stays hidden, and a layout part with the wrong shape is ignored. Before, a saved layout
  applied these entries as they were, showed such a column, and a malformed part threw.
- **Columns missing from the column order render after a column reorder (`data-grid`):** a column that the column order
  does not list follows the listed columns in `columns` order. This covers a column added to
  `columns` after a reorder and a column missing from a restored `defaultColumnLayout.order`.
  `onColumnLayoutChange` reports the completed order. Before, such a column never rendered.
- **A late-adopted `onDataChange` array applies in full (`data-grid`):** when a controlled
  consumer passes a refetched `data` array and then adopts an array the grid emitted earlier, the
  grid rebuilds its view from that array. Before, the grid took the array for its own echo, kept
  the refetched view, and rows disappeared.
- **A read-only grid rejects edit commits (`data-grid`):** `commitCellEdit`, `commitCellValue`,
  and `commitCellValueAt` do nothing in a `readOnly` grid. When `readOnly` turns on, the grid
  cancels an open edit session (`onEditEnd` reports `cancel`). The store takes the new `readOnly`
  in the same commit, before any passive effect runs. Before, Enter in an editor that was open
  when `readOnly` turned on wrote the value, `actions.commitCellValue` wrote in a read-only grid,
  and writes went through until the passive effects ran.
- **Undo and redo stay off in a read-only grid (`data-grid`):** in a `readOnly` grid, the undo
  and redo shortcuts no longer call `onUndo`/`onRedo`, in the grid and through
  `DataGridGlobalShortcuts`. Before, Ctrl+Z wrote the history entry back into the data.
- **Global shortcuts wait for an open edit session (`data-grid`):** while a cell editor is open,
  `DataGridGlobalShortcuts` ignores keys. Before, Ctrl+Z in a select list undid an earlier grid
  edit, and an opted-in `selectAll` fired.
- **Enter in a popup editor commits once (`data-grid`):** Enter on a select option commits the
  value and closes the editor. Before, the same keystroke reached the grid and reopened the
  editor, so `onEditStart` fired twice.
- **Development checks stay out of production builds (`data-grid`):** dev warnings and dev-only
  checks no longer run in production builds whose bundler provides no `process` global, such as
  Vite.
- **Selection follows the edited row (`data-grid`):** while a cell is in edit mode, a sort,
  filter, join, or search change (the grid's own or a controlled prop) and a consumer data
  replacement that moves its row move the selection with the active cell. The range no longer
  paints on another record, and Shift+Arrow after Escape extends from the edited cell. A
  multi-cell range collapses to the edited cell when its row moves.
- **`useDataGridEditing` return type (`data-grid`):** the hook's type now includes the `rowId`,
  `columnId`, and `session` fields the store always carried, next to `coord` and `initialText`.
- **Custom toolbars keep the mod+F capture (`data-grid-toolbar`):** a toolbar you build yourself
  that holds the `DataGridSearch` and carries the `data-grid-toolbar` attribute now scopes mod+F
  to its grid without a `data-grid-instance` attribute.
- **View-space presence warning covers every view change (`data-grid`, `data-grid-presence`):** the
  one-time development warning now also fires when a sort, filter, join operator change, or
  consumer data replacement moves rows while a view-space presence entry is active. It also fires
  when a column reorder, hide, or pin, or a consumer `columns` swap, moves or removes a visible
  column. A same-order refetch, a lazy page load, and a column unhidden at the end do not warn.
  The warning used to cover only row operations and immediate `updateCells`.
- **Lazy rows warn about dropped edits (`data-grid-lazy`):** in development,
  `useDataGridLazyRows().onDataChange` warns once when a change targets a row that `evict()`
  removed before the merge. The edit is not written into another row.
- **Date cells reject rolled-over dates (`data-grid`):** typed, pasted, or imported non-ISO dates
  such as `Feb 30, 2026`, `02/30/2026`, and `2026-02-30T10:00Z` are rejected instead of landing
  on `2026-03-02`, also when they carry a time part. Text without a day, such as `Jul 2026` or
  `2026`, is rejected too, and so is text that names two months (`Mar 30, 2026 10:00 Feb`). A
  datetime with an offset stores its local calendar day. The time part follows a fixed grammar, so
  long whitespace runs no longer make parsing slow.
- **Fill keeps long identifiers intact (`data-grid-fill`):** a series whose number has more than 15
  digits tiles instead of extrapolating. `ID 1234567890123456789` no longer fills as `…7000`, and
  a 400-digit number no longer fills as `xNaN`. A series also tiles once an
  extrapolated value would need more than 15 digits.
- **Context-menu Cut and Copy report failures (`data-grid-context-menu`, `data-grid`):** when the
  clipboard write fails, the menu disables Cut and Copy and shows the new
  `labels.contextMenu.clipboardFailed` tooltip ("clipboard access failed — use Ctrl+C or
  Ctrl+X") the next time it opens. The open after that is back to normal, so the
  user can retry. A throwing `document.execCommand("copy")` resolves the copy as `'failed'`
  instead of rejecting.
- **Pagination keeps deep links while data loads (`data-grid-pagination`):** server mode with
  `reconcilePage` no longer rewrites your page while `total` is `0`, so a deep link survives the
  first fetch. Client mode with an empty dataset shows page 1 of 1 instead of an out-of-range
  page such as "page 3 of 1"; your controlled page is left as it is.
- **Number editor stepping (`data-grid`):** ArrowUp and ArrowDown step by the column's `step`
  (default 1) and round the result to the finer precision of the draft and the step, so `0.1`
  steps read `0.3` instead of `0.30000000000000004`. A step finer than the column's
  `decimals` steps by one unit of those decimals. The arrows do nothing while an async validation
  is pending or an IME composition is active.
- **Number cells with `decimals` stay inside `min` and `max` (`data-grid`):** typed, pasted, and
  imported text rounds to `decimals` first and then clamps to the bounds on the decimals grid.
  With `max: 0.125` and `decimals: 2`, typing `0.2` stores `0.12` instead of `0.13`. A bound that
  already sits on the decimals grid, such as `min: 0.28`, is reachable by stepping. Rounding works
  on the decimal digits, so `1.005` with `decimals: 2` stores `1.01`, and a value that rounds to
  zero stores `0`, never `-0`.
- **Clipboard round trip keeps tabs, carriage returns, and non-breaking spaces (`data-grid`):** a
  cell copied from the grid and pasted back keeps its exact value when it holds a carriage
  return or a non-breaking space next to a tab. The HTML payload writes a carriage return as a
  character reference, which the HTML parser otherwise turns into a newline.
- **Resize and reorder gestures survive touch edge cases (`data-grid`):** a second touch on a
  column resize handle no longer selects the column or arms a reorder. A column or row reorder
  ends instead of blocking the next drag when the window blurs or when the element that held the
  pointer capture left the document.
- **Breaking:** filter and pagination selects show labels, not raw values: the filter row's
  boolean and choice selects show the label (`labels.toolbar.filterValueTrue`/`filterValueFalse`,
  the choice's own label) instead of the stored value, and the pagination footer's page-size
  select shows `labels.pagination.pageSizeOption(size)` (default `25 / page`). An empty checkbox
  or select filter value shows the "Value" placeholder instead of a blank trigger. The selects
  pass their labels through the `items` prop of `Select`.
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
- **Breaking:** `mod+F` with several grids on one page: `DataGridSearch`'s find-shortcut capture
  now scopes to the grid that holds focus (each provider stamps its root and toolbar with a
  `useId`-derived `data-grid-instance` marker) — pressing `mod+F` in grid A no longer moves focus
  into grid B's search input.
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
  raw segments. Each `isAnyOf` list holds at most `max(number of choices, 64)` values for a
  column with `choices`, or 1000 values for a column with missing or empty `choices`. The `sort`
  URL param keeps one direction per column (first segment wins) and at most 64 sorts — a
  hand-edited URL can no longer express an unbounded view state. `parseFilterState` takes an
  optional `maxChoices` option, a function from a column id to its bound.
- **Breaking:** URL pagination hardening: a URL `pageSize` is now gated by the pager's default
  size list (10/25/50/100) even when `pageSizeOptions` is omitted, and a URL `page` beyond
  1,000,000 falls back to 1 — an unbounded `?pageSize=` or `?page=` can no longer force a huge
  fetch.
- **Drag listener leaks:** a second pointer pressing a reorder drag handle, row-reorder marker, or resize
  handle while a gesture is in flight no longer arms a second document listener set, and an
  unmounted column-resize drag drops its document listeners.
- **Import dialog race conditions:** an aborted or superseded file load no longer clears the
  parsing state of a newer load, and `setDelimiter` re-parses with the parsing state, a generation
  guard against stale results, and a surfaced error instead of an unhandled rejection.
- **Missing documented keybindings:** `Backspace` and `Delete` on a focused `DataGridSortList` /
  `DataGridFilterMenu` row drag handle now remove that row, as the docs already stated.
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
  now rejects the edit with the error message — a rejecting promise also clears the pending state,
  so the editor no longer stays stuck read-only. This covers the function form and `updateCells`
  (the patch is skipped as `invalid`), and a throwing validator blocks the edit on an
  `onInvalid: "warn"` column too.

- **Import dialog on a short viewport:** the dialog caps its height at 80vh and scrolls its
  content, so on a low window the mapping table and the footer stay reachable instead of
  clipping past the window edges.

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
- **Vite type-check:** the core grid declares the `process` global it reads in its own file, so
  `tsc -b` passes in a Vite project whose `tsconfig.app.json` lacks `@types/node`.
- **Demo npm dependencies:** `data-grid-context-menu-slots-demo` declares `lucide-react` and
  `data-grid-validation-demo` declares `sonner`, so a fresh install gets both packages.
- **Registry npm dependencies:** `data-grid`, `data-grid-toolbar`, `data-grid-sort-list`,
  `data-grid-context-menu`, and `data-grid-pagination` declare `lucide-react`, so a fresh install
  gets the icon package the components import.
- **Inline fill callbacks:** `useDataGridFill`'s `onFill` and `detectSeries` may be inline
  functions; a new identity no longer re-creates the fill handlers on every render.

- The empty-state row no longer renders a hardcoded "No data" literal that i18n consumers couldn't
  translate.

- **Number-format guard (`data-grid-io`):** an xlsx cell whose number format is longer than 255
  characters, has a fraction denominator of four or more placeholders (`# ?/????`), or makes
  hucre throw imports as its General text (the raw value) instead of its formatted text. hucre's
  format scan grew quadratically (about 5 s per cell at 100,000 characters) and its denominator
  search cost about a second per cell at nine placeholders. A format that throws no longer
  rejects the whole import.

- **Legacy xls bound (`data-grid-io`):** an `.xls` workbook is rejected with `errorTooManyCells` when
  its sheets together span more than `maxCells`, or when it holds more than half of `maxCells` plus
  100,000 records. The reader pads every sheet to a full rectangle and builds one object per record, and
  sheets can share one worksheet substream, so a 3 KB file with 50 such sheets peaked near 2.9 GB and
  a 50 MB file of empty records near 2.8 GB. The check reads the workbook's records in time linear in
  the file size before the reader runs, follows the OLE2 container the way the reader does, and
  rejects a workbook whose structure it cannot follow. A single sheet at the default limits peaks
  near 0.2 GB.

- **Part-size error (`data-grid-io`):** an xlsx part over the per-part cap (a worksheet or the shared
  strings, a ZIP64 marker included) is rejected with the new `labels.io.errorPartTooLarge` instead of
  `errorFileTooLarge`. The message says that a part of the file is too large to read safely and that
  the import limit can be raised. `ImportErrorKey` gains `"errorPartTooLarge"`, `parseImportFile`
  throws the error code `part-too-large`, and `labels.io` gains the key.
  `errorFileTooLarge` stays for a file over `maxFileBytes`.
- **A duplicate row id resolves to its first row (`data-grid`):** the row index map keeps the first row for an id that appears twice, so lookups by id no longer land on the last duplicate.
- **Clipboard parsing stops at the paste cell cap (`data-grid`):** the text parse ends once the cap is passed, and an HTML payload too large for the cap skips the DOM parse and falls back to the text, instead of building the whole grid before truncating.
- **Plugins re-resolve after a claim (`data-grid`):** when the resolved plugin list differs from the store state after a claim, the store takes the new list.
- **Links open only on a plain modifier-click:** a `url` cell opens its link only while the modifier is still held at click time, and a Ctrl+drag that starts on a link no longer opens it.
- **The keyboard-opened column menu behaves at the edges:** it scrolls the active column into view first, returns focus to the grid only when the keyboard opened it, and leaves focus on another control that you click while it closes.
- **Unchecking a row clears it from the cell range:** the range no longer shows the row as checked, and when the uncheck splits a range, the anchor's piece stays primary.
- **A cancelled pointer ends a drag without applying it:** `pointercancel` now cancels a column reorder and a fill drag, and ends a column resize without firing `onColumnLayoutChange`.

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
