---
name: gridcn-addons
description: "gridcn add-ons (fill, undo/redo, pinned rows, presence, toolbar, context menu, keybindings, sort list, URL state, import/export): install and wiring. Use when adding an add-on, combining several in one grid, or when an installed add-on renders nothing."
---

Each gridcn add-on is a separate registry item that installs into your own project paths (default
`components/data-grid-<name>/*`, per your `components.json` aliases). This skill carries the wiring
rules the docs don't spell out as a procedure: which hook output goes where, and the gotchas that
fail silently instead of erroring.

Scope: installing add-ons and wiring their outputs. Choosing between lazy loading and pagination, or server-side sort and filter → `gridcn-data-source`.

## 1. Install

Run one command per add-on (or join several in one call):

```
npx shadcn add @gridcn/<item>
```

| Add-on | Item name | Extra npm dep |
|---|---|---|
| Fill handle | `data-grid-fill` | none |
| Pinned rows | `data-grid-pinned-rows` | none |
| Presence | `data-grid-presence` | none |
| Undo & redo | `data-grid-history` | none |
| Toolbar | `data-grid-toolbar` | `@dnd-kit/react` |
| Context menu | `data-grid-context-menu` | none |
| Keybindings dialog | `data-grid-keybindings` | none |
| Sort list | `data-grid-sort-list` | `@dnd-kit/react` |
| URL state | `data-grid-url-state` | `nuqs` |
| Import / export | `data-grid-io` (installs `dropzone` too) | `xlsx`, `papaparse` (lazy-loaded) |
| Lazy loading | `data-grid-lazy` | none |
| Pagination | `data-grid-pagination` | none |

The core `data-grid` item must already be installed; every add-on depends only on it. Done when the
CLI reports the new files under `components/data-grid-<name>/` and installs the npm dep from the
table (check `package.json`).

## 2. Wire the output at the right seam

Four add-ons return a value a **provider prop** needs, so their hook must run in the component that
renders `<DataGridProvider>`, above it, not inside it:

| Add-on | Hook | Returns | Goes on |
|---|---|---|---|
| Fill | `useDataGridFill({})` | `{ plugin, FillHandleTracker }` | `plugin` → `overlayPlugins` on the provider; `FillHandleTracker` renders as a child inside `DataGridRoot` |
| Presence | `useDataGridPresence()` | `{ plugin, setPresenceHighlights, ... }` | `plugin` → `overlayPlugins` on the provider |
| Pinned rows | `useDataGridPinnedRows({ topRows?, bottomRows? })` | `{ rowBands }` | `rowBands` prop on the provider |
| Undo & redo | `useDataGridState(rows, { getRowId })`, or `useDataGridHistory` to compose with your own `data`/`setData` | provider props | spread onto the provider (`data`, `onDataChange`, `onUndo`, `onRedo`) |

Everything else mounts as a plain child component, inside the provider:

| Add-on | Component(s) | Mounts |
|---|---|---|
| Toolbar | `DataGridToolbar` + children | sibling of `DataGridRoot`, inside the provider |
| Context menu | `DataGridContextMenu` (wraps `DataGridRoot`), `DataGridHeaderDropdown` (passed to `DataGridRoot`'s `renderHeaderMenu`) | inside the provider; `DataGridContextMenu` throws if mounted outside it |
| Keybindings | `DataGridKeybindingsDialog` (inside provider), `DataGridKeybindingsShortcut` (inside `DataGridRoot`) | see split — the `?` shortcut needs the root's container |
| Sort list | `DataGridSortList` | inside `DataGridToolbar` |
| URL state | `DataGridUrlState` | inside the provider, under an app-level `NuqsAdapter` |
| Import/export | `DataGridImportButton`, `DataGridExportButton` | inside `DataGridToolbar` |
| Lazy loading | `useDataGridLazyRows` (owns `data`) + `DataGridLazyGuard` | hook above the provider; `DataGridLazyGuard` inside the provider |
| Pagination | `useDataGridPagination` + `DataGridPaginationBar` | standalone — does not read the store, works inside or outside the provider |

`keymap` (remapping or the keybindings dialog's source of truth) is a prop of `DataGridRoot` (or the
`DataGrid` wrapper), never of `DataGridProvider`.

## 3. Combine multiple add-ons in one grid

- **One `overlayPlugins` array for everything.** Fill and presence (and any custom overlay plugin)
  each hand you a `plugin`. Put every plugin in a single array with a stable identity:
  ```tsx
  const overlayPlugins = useMemo(() => [fill.plugin, presence.plugin], [fill.plugin, presence.plugin]);
  ```
  A fresh array literal on every render trips a dev-mode guardrail (see step 4). The guardrail
  compares identity, so a shallow-equal new array still warns.
- **Toolbar child order** (the gridcn convention — matters for consistency, not correctness):
  `DataGridSearch` → `DataGridFilterMenu` → `DataGridSortList` → `DataGridColumnsMenu` →
  `DataGridImportButton` → `DataGridExportButton` → your own utility buttons, in that order.
- **URL state**: exactly one `NuqsAdapter` for the whole app — never nest a second one closer to the
  grid. Wrap the grid in `<Suspense>` if the page is statically prerendered (Next.js requirement,
  since the adapter calls `useSearchParams()`). Never mount `DataGridUrlState` on a `data-grid-lazy`
  grid — it writes URL sort/filter/search into the store on mount, which re-sorts the lazy grid's
  partial `data` client-side; keep that spec in your own state instead and hand it to `fetchRows`.
- **Lazy loading + pagination are mutually exclusive.** Neither exists for render performance
  (virtualization already covers that); pick lazy for one continuous infinite-scroll dataset, or
  pagination for bookmarkable pages. Using both together is unsupported.
- **Presence**: call `useDataGridPresence()` exactly once per grid. A second call mints a separate
  store whose `setPresenceHighlights` writes into nothing the grid reads; share the first call's
  return values as props instead.
- **Pinned rows**: keep `topRows`/`bottomRows` referentially stable (`useMemo`/`useState`, not a
  fresh `[value]` literal per render) — an unstable array makes the returned `rowBands` churn every
  render and the grid dev-warns on it.
- **Totals row**: `rowBands` is needed above the provider, but the aggregate is read inside it. Hold
  the totals in `useState`, render `<DataGridAggregateReporter specs={...} onChange={setTotals} />`
  inside the provider, and pass `useMemo(() => [totals], [totals])` as `bottomRows`.
- **Undo/redo choice**: reach for `useDataGridState` only when you actually want history — it
  replaces the core's uncontrolled `defaultData` with a controlled echo loop. If nothing needs undo,
  skip the add-on. Already own the array via your own state? Use `useDataGridHistory` instead — it
  takes `data`/`setData` like `useState`'s tuple and composes with any state source.

## 4. When an add-on renders nothing or has no effect

- Check the browser console first. Two dev-only warnings name most silent failures:
  - `overlayPlugins array identity changed since the last render; pass a stable reference...` — an
    inline `[plugin]` array literal in JSX; wrap it in `useMemo`.
  - `useDataGridAggregate` (and the reporter) warns once for a spec key that matches no column or for
    a sparse (lazy) `data` array, rather than throwing.
- **Fill/keyboard fill does nothing**: without the add-on installed, `Ctrl/Cmd+D`/`+R` are genuine
  no-ops (the actions exist in core's keymap, but nothing handles them). A `readOnly` grid also
  disables fill entirely, regardless of `disabled`.
- **Toolbar piece invisible**: each toolbar child is independent — confirm it's actually rendered as
  a child of `<DataGridToolbar>`, not just imported.
- **Context menu right-click does nothing**: `DataGridContextMenu` must wrap content that is inside
  `DataGridProvider`; outside it, it throws immediately rather than silently failing.
- **`?` shortcut or keybindings dialog inert**: `DataGridKeybindingsShortcut` must be inside
  `DataGridRoot` (it reads the root's container element); the dialog itself only needs the provider.
- **URL param has no visible effect**: a URL-applied sort with no visible arrow is expected in the
  default `headerClickBehavior` config — the sync still works; add `data-grid-sort-list` or
  `headerClickBehavior="sort"` for a visible affordance.
- **Fill, pinned rows, or presence inert**: confirm the hook's `plugin`/`rowBands` actually reaches
  the provider prop. Nothing errors when it does not.

## Done when

The add-on's item folder exists under your components path, its npm dependency (if any) is in
`package.json`, its output is wired at the location named in the table above, the browser console
shows no dev warning, and its documented visible behavior confirms it (drag the fill handle, undo a
paste, see the pinned band render, see a remote presence highlight, click a toolbar button, right-click
a cell/header, press `?`, drag a sort row, reload the page and see the URL state restored, import or
export a file, scroll a lazy grid past the first window, or change pages).

## Docs

Each add-on's full reference (props, edge cases, worked examples) is at
`https://gridcn.vercel.app/docs/addons/<page>.md` (or `/docs/<page>.md` for lazy-loading, pagination,
overlay-plugins, global-shortcuts) — read the relevant one before writing non-trivial wiring:

- Fill: `/docs/addons/fill.md` · Pinned rows: `/docs/addons/pinned-rows.md`
- Presence: `/docs/addons/presence.md`, `/docs/addons/broadcasting-presence.md`
- Undo & redo: `/docs/addons/undo-redo.md` · Toolbar: `/docs/addons/toolbar.md`
- Context menu: `/docs/addons/context-menu.md` · Keybindings: `/docs/addons/keybindings.md`
- Sort list: `/docs/addons/sort-list.md` · URL state: `/docs/addons/url-state.md`
- Import/export: `/docs/addons/import-export.md` · Lazy loading: `/docs/lazy-loading.md`
- Pagination: `/docs/pagination.md` · Overlay plugin seam: `/docs/overlay-plugins.md`
- Global shortcuts (undo/redo outside the grid): `/docs/global-shortcuts.md`
- Install & dependency table: `/docs/installation.md`
