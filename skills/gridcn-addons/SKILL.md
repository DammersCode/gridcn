---
name: gridcn-addons
description: "gridcn add-ons (fill, undo/redo, pinned rows, presence, comments, toolbar, header filter, find & replace, context menu, keybindings, sort list, saved views, URL state, import/export): install and wiring. Use when adding an add-on, combining several in one grid, or when an installed add-on renders nothing."
metadata:
  gridcn-version: "2.0.0"
---

Each gridcn add-on is a separate registry item that installs into your own project paths (default
`components/data-grid-<name>/*`, per your `components.json` aliases). This skill carries the wiring
rules the docs don't spell out as a procedure: which hook output goes where, and the gotchas that
fail silently instead of erroring.

Scope: installing add-ons and wiring their outputs. Choosing between scroll loading and pagination, or server-side sort and filter → `gridcn-data-source`.

## 1. Install

Run one command per add-on (or join several in one call):

```
npx shadcn add @gridcn/<item>
```

| Add-on | Item name | Extra npm dep |
|---|---|---|
| Fill handle | `data-grid-fill` | none |
| Pinned rows | `data-grid-pinned-rows` | none |
| Lookup cell | `data-grid-lookup` (installs `use-debounce` too) | none |
| Presence | `data-grid-presence` | none |
| Cell comments | `data-grid-comments` | none |
| Undo & redo | `data-grid-history` | none |
| Toolbar | `data-grid-toolbar` (installs `use-debounce` too) | `@dnd-kit/react`, `@dnd-kit/dom` |
| Context menu | `data-grid-context-menu` | none |
| Keybindings dialog | `data-grid-keybindings` | none |
| Sort list | `data-grid-sort-list` | `@dnd-kit/react`, `@dnd-kit/dom` |
| URL state | `data-grid-url-state` | `nuqs` |
| Saved views | `data-grid-views` | none |
| Import / export | `data-grid-io` (installs `dropzone` too) | `hucre` (lazy-loaded), `papaparse`; dev: `@types/papaparse` |
| Server rows (pages or scroll) | `data-grid-server` (installs `data-grid-pagination` too) | none |
| Pagination | `data-grid-pagination` | none |
| Find & replace | `data-grid-find-replace` (installs `use-debounce` too) | none |
| Status bar | `data-grid-status-bar` | none |

The `@gridcn` registry serves the current deploy of the public repository `DammersCode/gridcn`;
the same items install from its GitHub registry path (`DammersCode/gridcn/<item>`), the source
of record for the files. The core `data-grid` item must already be installed; every add-on
depends on it, and some also install another gridcn item (see the table). Done when the CLI reports the new files under `components/data-grid-<name>/`
and installs the npm dep from the table (check `package.json`), and in a Git project you have
reviewed every file `git status` lists as new or modified before the first run: the install
copies remote source into your code and rewrites existing files.

## 2. Wire the output at the right seam

Add-ons hand you a `DataGridPlugin` object; it goes on the provider's `plugins` prop, so the hook
must run in the component that renders `<DataGridProvider>`, above it, not inside it:

| Add-on | Hook | Returns | Goes on |
|---|---|---|---|
| Fill | `useDataGridFill()` | `{ plugin }` | `plugin` → `plugins` on the provider (the `Mount` member runs the drag engine inside the root) |
| Presence | `useDataGridPresence()` | `{ plugin, setPresenceHighlights, ... }` | `plugin` → `plugins` on the provider |
| Comments | `useDataGridComments({ currentUser?, readOnly?, enableResolve?, onCommentSave?, onLocalChange?, fetchComments? })` | `{ plugin, applyRemote, openComments, getCommentMenuItems, ... }` | `plugin` → `plugins` on the provider (with `useDataGridServerRows`, its `plugins` option); `getCommentMenuItems` → `getCellMenuItems` of `DataGridContextMenu`; `Shift+F2` opens the popover |
| Pinned rows | `useDataGridPinnedRows({ topRows?, bottomRows?, status? })`; a totals row is `aggregateRow(specs, { cells?, scope? })` or `serverAggregateRow({ fetchAggregates, cells?, refreshAfterSave? })` in `topRows`/`bottomRows` | `{ plugin }` | `plugin` → `plugins` on the provider |
| Keybindings | `useDataGridKeybindings({ className? })` | `{ plugin, open, close }` | `plugin` → `plugins` on the provider (`?` opens the dialog; rebind with `keymap={{ openKeybindings: [...] }}`) |
| Find & replace | `useDataGridFindReplace({ scope?, replaceAllLimit?, processReplace?, className? })` | `{ plugin, open, close }` | `plugin` → `plugins` on the provider (`Mod+F` opens the panel with Find only, `Shift+Alt+Enter` with Replace; `open("find" \| "replace")` opens it from code) |
| Undo & redo | `useDataGridState(rows, { getRowId })` | spreadable `{ data, getRowId, onDataChange, plugins, history }` | spread the result onto the provider |
| Undo & redo, own state | `useDataGridHistory({ capacity?, datasetKey?, recordSources?, onSkip? })` | `{ plugin, undo, redo, ... }` | `plugin` → `plugins`; keep your own `data` and `onDataChange` echo (the grid's `getRowId` prop addresses the operations) |

Everything else mounts as a plain child component, inside the provider:

| Add-on | Component(s) | Mounts |
|---|---|---|
| Toolbar | `DataGridToolbar` + children | sibling of `DataGridRoot`, inside the provider |
| Header filter | `DataGridHeaderFilter` (passed to `DataGridRoot`'s `renderHeaderFilter`: `renderHeaderFilter={(ctx) => <DataGridHeaderFilter {...ctx} />}`) | inside the provider; part of `data-grid-toolbar`, no `DataGridToolbar` needed |
| Context menu | `DataGridContextMenu` (wraps `DataGridRoot`), `DataGridHeaderDropdown` (passed to `DataGridRoot`'s `renderHeaderMenu`) | inside the provider; `DataGridContextMenu` throws if mounted outside it |
| Keybindings dialog (custom placement) | `DataGridKeybindingsDialog` (controlled `open`, own trigger) | inside the provider; `useDataGridKeybindings` is the default wiring |
| Sort list | `DataGridSortList` | inside `DataGridToolbar` |
| URL state | `DataGridUrlState` (option `spec` lists the synced parts `"sort"`, `"filter"`, and `"search"`; the default is `["sort"]`, and `[]` turns it off) | inside the provider, under an app-level `NuqsAdapter` |
| URL state, column layout | `DataGridUrlState` option `layout` | syncs column order and hidden columns; `"widths"` and `"pins"` add more |
| Saved views | `DataGridViews`, or `useDataGridViews()` for your own UI | inside the provider, e.g. in `DataGridToolbar` |
| Saved views, options | `storage` (a `localStorage` key or a storage object), `value`/`onValueChange` | mount `DataGridUrlState` beside it, and a URL with params wins over the default view |
| Import/export | `DataGridImportButton`, `DataGridExportButton` | inside `DataGridToolbar` |
| Server rows (scroll mode) | `useDataGridServerRows({ mode: "scroll" })` (owns `data`) | hook above the provider; spread `server.gridProps` |
| Pagination, client | `defaultPageSize` on the provider + `DataGridPaginationBar` | the bar reads the pager from the provider; `useDataGridPager()` returns `{ pager }` for your own controls |
| Pagination, server | `useDataGridServerPager` + `DataGridPaginationBar {...pager}` | spread `pager` and the bar works outside the provider too |

`keymap` (remapping or the keybindings dialog's source of truth) is a prop of `DataGridProvider` (or
the `DataGrid` wrapper), never of `DataGridRoot`.

## 3. Combine multiple add-ons in one grid

- **One `plugins` array for everything.** Fill, presence, pinned rows, and history (and any custom
  plugin) each hand you a `plugin`. Put every plugin in one array:
  ```tsx
  import { DataGrid, defineColumns } from "@/components/data-grid/data-grid";
  import { useDataGridFill } from "@/components/data-grid-fill/data-grid-fill";
  import { useDataGridPinnedRows } from "@/components/data-grid-pinned-rows/data-grid-pinned-rows";

  type Row = { id: string; item: string; price: number };

  const columns = defineColumns<Row>()([
    { id: "item", header: "Item", accessorKey: "item" },
    { id: "price", header: "Price", accessorKey: "price", type: "number" },
  ]);
  const rows: Row[] = [{ id: "1", item: "Pen", price: 2 }];
  const bottomRows = [{ id: "total", item: "Total", price: 2 }];

  function PricesGrid() {
    const fill = useDataGridFill();
    const pinnedRows = useDataGridPinnedRows({ bottomRows });
    return <DataGrid defaultData={rows} columns={columns} plugins={[fill.plugin, pinnedRows.plugin]} />;
  }
  ```
  An inline array literal is fine: the grid compares the list entry-wise (same length, same `name`,
  every member identity-equal), so a fresh array with stable members re-resolves nothing.
  `useDataGridState` takes a `plugins` option, and its returned `plugins` holds them, then the
  history plugin: `useDataGridState(rows, { getRowId, plugins: [fill.plugin] })`, then spread the result.
- **Toolbar child order** (the gridcn convention — matters for consistency, not correctness):
  `DataGridSearch` → `DataGridFilterMenu` → `DataGridSortList` → `DataGridColumnsMenu` →
  `DataGridImportButton` → `DataGridExportButton` → your own utility buttons, in that order.
- **Find & replace + toolbar search**: with both mounted, `Mod+F` in the grid opens the find panel and the toolbar search yields to it; the Find field and the toolbar search show the same text.
- **URL state**: exactly one `NuqsAdapter` for the whole app — never nest a second one closer to the
  grid. `DataGridUrlState` brings its own `<Suspense>`; wrap the component that calls
  `useDataGridUrlPagination` or `useDataGridUrlState()` in one if the page is statically prerendered (Next.js requirement,
  since the adapter calls `useSearchParams()`). On a scroll-mode grid, mount
  `DataGridUrlState` only with both `sortMode="server"` and `filterMode="server"` (a grid with `totalRowCount` has both by default); otherwise it
  re-sorts and re-filters the partial `data` client-side.
- **Scroll mode + pagination are mutually exclusive.** Neither exists for render performance
  (virtualization already covers that); pick scroll mode for one continuous result that scrolls without pages, or
  pagination for bookmarkable pages. Using both together is unsupported.
- **Presence**: call `useDataGridPresence()` exactly once per grid. A second call mints a separate
  store whose `setPresenceHighlights` writes into nothing the grid reads; share the first call's
  return values as props instead.
- **Comments**: call `useDataGridComments()` once per grid. It works with no options: comments are
  anonymous and stay on the client. For a server pass `currentUser: { id }` and `onCommentSave`; use
  `readOnly: !session` while a session loads. To keep comments in the browser use controlled
  `comments` + `onCommentsChange` (load stored data in an effect, never from `defaultComments`). `onCommentSave` answers nothing (stored as sent), `{ comment }`, `{ rejected: { reason: "stale", current } }`,
  or throws. Forward `onLocalChange` to your channel and feed arriving changes to `applyRemote`; the add-on drops
  its own echo by `writeId`. Comments are keyed by row id and column id, so keep `getRowId` stable.
- **Pinned rows**: the hook compares a plain row object by its own values and an `aggregateRow` or `serverAggregateRow` by content, so an inline `[aggregateRow(...)]` keeps the plugin. A reducer function with a new identity reduces again; define it at module scope to skip that work.
- **Server totals**: on a pages, scroll, or own-API grid put `serverAggregateRow({ fetchAggregates: ({ spec, signal }) => … })` in `bottomRows`. The band sets its own `status`, requests again on a filter or quick-search change, and fetches again after the pending saves settle (`refreshAfterSave: false` opts out). Pin one `serverAggregateRow` in one place only. To read the result outside the band, render `<DataGridServerAggregateReporter … onChange={setTotals} />` (start the state from `PENDING_SERVER_AGGREGATE`; it refreshes after saves like the band, `refreshAfterSave: false` opts out).
- **Lookup cell**: register `cellTypes={{ lookup: lookupCellType }}`, set `type: "lookup"` and `options: { fetchOptions }` on the column. No `declare module` block is needed; type `fetchOptions` with `LookupOptions<Row>`.
- **Totals row**: put `aggregateRow({ price: "sum" }, { cells: { id: "total", item: "Total" } })` in `bottomRows`. The band reads each value by column id, so no `accessorKey` has to match. `DataGridAggregateReporter` stays for a read outside the band.
- **Undo/redo choice**: reach for `useDataGridState` only when you actually want history — it
  replaces the core's uncontrolled `defaultData` with a controlled echo loop. If nothing needs undo,
  skip the add-on. Own the array via your own state, or let the grid own it with `defaultData`? Use `useDataGridHistory` — its
  plugin observes the grid's changes (your `onDataChange` echo stays the single write target) and
  `undo`/`redo` apply the inverted batch through the grid's `commitChange`; an update with `cells` writes only those cells onto the current row.
- **Undo over missing rows**: an undo or redo that needs a row missing from `data` applies nothing. Rows not loaded yet (holes, or rows of another server page) keep the entry and report `"rows-not-loaded"` to `onSkip`. Rows that are gone drop the entry and report `"rows-gone"`. An `onSave` refusal of an undo puts the entry back. Pass `datasetKey` to clear the stacks on a dataset swap.

## Async gates

- `processPaste`, `processCellFromClipboard`, `validateRow`, `onBeforeEditStart`, `createRow`, `duplicateRow`, `onBeforeDeleteRows`, and the import `mapColumn` and `createRow` accept a promise. The grid holds the gesture until it settles, then writes once. A pending gate blocks a second gesture of its kind, and the grid drops a result for a row that left `data`.
- `actions.commitChange` runs `validateRow` for the rows it inserts or updates (every source except `"stream"`), so an import applied through it needs no extra validation.
- Every gate gets an `AbortSignal` as its last argument (`processPaste({ cells, target, signal })`, `validateRow(row, rowId, { signal })`, `onBeforeEditStart(cell, { signal })`, `createRow(index, { signal })`, `duplicateRow(row, index, { signal })`, `onBeforeDeleteRows({ rowIds, hiddenCount, signal })`). Pass it to `fetch`. It aborts when a newer run replaces the gate, when the result cannot apply, and on unmount.
- `useDataGridGatePending()` returns the names of the gates that wait for a promise. The grid root carries `data-gate-pending` meanwhile.
- `gateTimeoutMs` on `DataGridProvider` (one number, or one per gate name; off by default) aborts a gate whose promise never settles. `onGateAborted({ gate, reason })` reports each stop (`"timeout"`, `"changed"`, `"superseded"`, `"cancelled"`, `"reset"`).
- Row actions return `{ ok: true }` or `{ ok: false, reason }`; `onRowActionSkipped({ action, reason })` on the provider reports every skip of an insert, duplicate, delete, or move (`action: "moveRows"`), from a shortcut, a drag, a menu item, or a call.

## Bounds and failure reporting

- A paste or copy is capped at 200,000 cells. Do not parse unbounded clipboard input in `processPaste`.
- An import is bounded by `importLimits` (`maxFileBytes`, `maxRows`, `maxCells`, and more). Lower the limits to fit your data. Do not raise them without a memory budget: a raised `maxCells` raises the peak memory of a workbook parse.
- A grid that holds one page or some loaded blocks exports only those rows. For the whole server result pass `options={{ source }}` to `DataGridExportButton` (or `source` to `exportGrid`): `source({ spec, signal })` returns an array or an async iterable of batches, and your server applies `spec`. Bound it with `maxRows` and `maxBytes`. A `DataGridProvider` with `pageSize` holds every row, so its export, print, and totals cover every page; pass `scope: "page"` to `exportGrid`, `printGrid`, or `aggregateRow` for the shown page only.
- Without `onImport`, an import confirm appends the rows as one undoable `"import"` change. On a server or counted grid, `onImport(rows, { signal })` must send the rows to the server and then call `server.refresh()`. Never append imported rows to `data` of a grid that has a `totalRowCount`.
- To send an export somewhere else, pass `output(file, { fileName, format, signal })` (it replaces the download); shape the file with `columns` (ids, hidden allowed) and a sync `formatCell` that may return a number, boolean, or `Date` for typed xlsx cells. `exportRows` is the building block for custom formats.
- Import hooks, in order: `parseFile`, `importDefaults.defaultHeaderRow` (a number is the header row index), `processImportRows`, `processCellFromText`, `onImport(rows, { signal, rejected, fileName, sheetName, mapping })`, `onImportError`. Hook results are re-checked against `importLimits`; `csvEncoding` takes only labels from `IMPORT_CSV_ENCODINGS`.
- `useDataGridFindReplace({ processReplace })` can edit or veto (`false`) the plan before it is written.
- Find & replace searches loaded rows only; on a counted or server-mode grid the panel says so.
- Pass `onError` to `DataGridExportButton`. A throwing export is reported there. Without it, only a dev warning appears.
- History `rollback(change)` is cell-level. It reverts only the cells that still hold the change's value and skips cells edited since.

## 4. When an add-on renders nothing or has no effect

- Check the browser console first. Dev-only warnings name most silent failures:
  - `plugin "X" is already attached to another grid; a plugin instance attaches to one grid — pass a
    fresh plugin object (the add-on hook's result) to each grid` — the same plugin object on two
    grids; the second grid drops it and keeps the rest of its list.
  - `two plugins named "X"; the later one is ignored — the name is the plugin's React key and its
    identity` — a duplicate `name` in one `plugins` array.
  - `plugins "A" and "B" both define command "C"; the later plugin wins` — a command-name conflict
    between two plugins.
  - `useDataGridAggregate` (and `aggregateRow`, and the reporter) warns once for a spec key that matches no column or
    for a sparse (scroll mode) `data` array, rather than throwing.
- **Fill/keyboard fill does nothing**: without `data-grid-fill`, the grid binds no `Mod+D` or
  `Mod+R`. Install the add-on and add `useDataGridFill().plugin` to `plugins`. A `readOnly` grid also
  disables fill entirely, regardless of `disabled`.
- **Toolbar piece invisible**: each toolbar child is independent — confirm it's actually rendered as
  a child of `<DataGridToolbar>`, not just imported.
- **Context menu right-click does nothing**: `DataGridContextMenu` must wrap content that is inside
  `DataGridProvider`; outside it, it throws immediately rather than silently failing.
- **`?` shortcut or keybindings dialog inert**: `useDataGridKeybindings().plugin` must be in the
  provider's `plugins`; a `keymap` entry `openKeybindings: []` removes the key.
- **URL param has no visible effect**: a URL-applied sort shows the arrow on a string header in
  every `headerClickBehavior` mode. If nothing changes, check that the column is sortable and that
  the URL hook's props reach the provider.
- **Fill, pinned rows, or presence inert**: confirm the hook's `plugin` actually reaches the
  provider's `plugins` prop. Nothing errors when it does not.

## Done when

The add-on's item folder exists under your components path, its npm dependency (if any) is in
`package.json`, its output is wired at the location named in the table above, the browser console
shows no dev warning, and its documented visible behavior confirms it (drag the fill handle, undo a
paste, see the pinned band render, see a remote presence highlight, press `Shift+F2` on a cell and add a comment, click a toolbar button, right-click
a cell/header, press `?`, drag a sort row, reload the page and see the URL state restored, import or
export a file, scroll a scroll-mode grid past the first block, or change pages).

## Docs

Each add-on's full reference (props, edge cases, worked examples) is at the pages below. Append `.md` to a path for raw markdown on `https://gridcn.vercel.app`. Read the relevant one before writing non-trivial wiring:

- Fill: `/docs/clipboard-undo/fill-handle.md` · Pinned rows: `/docs/rows-pages-menus/pinned-rows.md`
- Presence: `/docs/rows-live-data/show-presence.md`, `/docs/rows-live-data/broadcast-your-selection.md`
- Comments: `/docs/rows-pages-menus/add-comments.md`, `/docs/add-options/server/comments-options.md`
- Undo & redo: `/docs/clipboard-undo/undo-redo.md` · Toolbar: `/docs/sort-filter-search/toolbar.md`
- Context menu: `/docs/rows-pages-menus/context-menu.md` · Keybindings: `/docs/selection-shortcuts/shortcut-remapping.md`
- Find & replace: `/docs/sort-filter-search/find-replace.md`
- Sort list: `/docs/sort-filter-search/sorting.md` · URL state: `/docs/sort-filter-search/url-state.md`
- Import/export: `/docs/import-export/export.md` · Scroll loading: `/docs/scroll-mode/load-rows-while-scrolling.md`
- Pagination: `/docs/server-pagination/load-rows-page.md` · Plugin seam: `/docs/plugins/plugin-shape.md`
- Global shortcuts (undo/redo outside the grid): `/docs/selection-shortcuts/global-shortcuts.md`
- Install & dependency table: `/docs/learning-path/install-gridcn.md`

## Do not

- Do not put `format` in `DataGridExportButton`'s `options`. The type omits it. Pass `formats` (default `["xlsx", "csv"]`); with one format, such as `formats={["csv"]}`, a click exports at once.
- Do not pass view indexes to `deleteRows`, `duplicateRows`, or `setRowChecked`. They take stable row ids. The `At` actions (`deleteRowsAt`, `duplicateRowsAt`, `setRowCheckedAt`) take view row numbers; `viewIndex(n)` and `viewIndexes([...])` brand them.
- Do not mount `DataGridUrlState` on a scroll-mode grid without both server modes, or nest a second `NuqsAdapter`.
- Do not call `useDataGridPresence()` twice for one grid.
- Do not combine scroll mode and `data-grid-pagination` on one grid.
