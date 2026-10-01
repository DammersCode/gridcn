<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./public/brand/lockup-on-dark.svg">
    <img alt="gridcn" src="./public/brand/lockup-on-light.svg" height="56">
  </picture>
</p>

<p align="center">A composable, high-performance data grid for React, styled with your shadcn tokens and shipped through the <a href="https://ui.shadcn.com/docs/registry">shadcn registry</a>.</p>

<p align="center">
  <a href="https://github.com/DammersCode/gridcn/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/DammersCode/gridcn/actions/workflows/ci.yml/badge.svg"></a>
  <a href="./LICENSE"><img alt="license" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg"></a>
  <img alt="React 19+" src="https://img.shields.io/badge/React-19%2B-blue?logo=react">
  <img alt="Tailwind CSS 4+" src="https://img.shields.io/badge/Tailwind%20CSS-4%2B-blue?logo=tailwindcss">
  <a href="https://skills.sh"><img alt="Agent skill" src="https://skills.sh/b/DammersCode/gridcn"></a>
  <a href="https://github.com/DammersCode/gridcn/stargazers"><img alt="stars" src="https://img.shields.io/github/stars/DammersCode/gridcn.svg?style=social"></a>
</p>

<p align="center"><a href="https://gridcn.vercel.app"><b>Documentation</b></a> · <a href="https://gridcn.vercel.app/docs/quick-start">Quick start</a> · <a href="https://gridcn.vercel.app/docs/api-reference">API reference</a></p>

---

Range selection, spreadsheet clipboard, typed cell editors, validation, and windowed rendering at 100k+ rows. The code lands in your project, so you own every line. The core grid is the engine; every other feature is an add-on that depends only on the core.

## Features

- **Range selection.** Anchor plus rectangular range, ctrl-click multi-range, row and column selection, and keyboard extension (Shift+Arrow, Shift+Ctrl+Arrow, Ctrl+A).
- **Spreadsheet clipboard.** Native copy, cut, and paste in TSV and HTML table formats, to and from Excel, Google Sheets, Apple Numbers, and LibreOffice.
- **Typed editing.** Text, number, checkbox, date, and select editors, plus custom cell types. The fill-handle add-on adds series fill.
- **Typed columns.** `defineColumns<TData>()` infers value types and per-cell-type `options` from your data shape. A typo in a column id is a compile error.
- **Validation.** A function or any [Standard Schema](https://standardschema.dev) library (Zod, Valibot, ArkType). Sync and async, on single edits and on bulk paste, fill, and import.
- **Server errors.** `setCellErrors` paints an API rejection on the exact cell. The error clears when the user commits a fix.
- **Streaming updates.** `updateCells` applies live value patches without a full re-render. An incremental sort keeps sorted grids correct and fast at 100k rows.
- **Virtualization.** CSS Grid with windowed row rendering. A real-browser test suite enforces the no-blank-rows guarantee at 100k rows.
- **Row operations.** Insert above or below, duplicate, and delete, each with a default key binding. Insert and duplicate need the `createRow` / `duplicateRow` props; the `data-grid-context-menu` add-on adds the menu entries.
- **Global shortcuts.** The opt-in `DataGridGlobalShortcuts` layer (inside `DataGridRoot`) keeps key bindings active while focus is outside the grid. Undo and redo by default; per-action flags enable more.
- **Controlled or uncontrolled.** Data, sort, and filter are uncontrolled by default. Pass `data`, `sortState`, or `filterState` with the matching `on*Change` callback to control them. Selection and column layout stay store-owned; `onSelectionChange` and `onColumnLayoutChange` observe them.
- **RTL and i18n.** A `direction` prop (or `dir="rtl"` on the page) mirrors layout, pinning, pointer math, and keyboard semantics. Every user-facing string lives in one typed `labels` object with English defaults.
- **Your theme.** Styled through your shadcn CSS tokens plus a few `--grid-*` variables, for example `--grid-column-border`. See the [styling guide](https://gridcn.vercel.app/docs/styling-theming).

## Install

```bash
npx shadcn add @gridcn/data-grid
```

The CLI resolves the `@gridcn` registry from the hosted site, so there is no setup step. Install add-ons the same way, for example `npx shadcn add @gridcn/data-grid-toolbar`.

To pin a tag, branch, or commit, use the GitHub registry path:

```bash
npx shadcn add DammersCode/gridcn/data-grid#v1.0.0
```

The [installation docs](https://gridcn.vercel.app/docs/installation) cover prerequisites, framework notes, and known problems.

## Example

This file renders an editable grid. `defaultData` seeds the grid once; after that, the grid owns the rows, so you need no state of your own:

```tsx
"use client";

import { DataGrid, defineColumns } from "@/components/data-grid/data-grid";

type Person = { id: string; name: string; age: number; active: boolean };

const columns = defineColumns<Person>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 160 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 90 },
  { id: "active", header: "Active", accessorKey: "active", type: "checkbox", width: 90 },
] as const);

const initialRows: Person[] = [
  { id: "1", name: "Ada Lovelace", age: 28, active: true },
  { id: "2", name: "Grace Hopper", age: 34, active: true },
];

export function PeopleGrid() {
  return (
    <DataGrid
      defaultData={initialRows}
      columns={columns}
      getRowId={(row) => row.id}
      className="h-[400px]"
    />
  );
}
```

The [quick start](https://gridcn.vercel.app/docs/quick-start) walks through the same example and the controlled variant.

## Add-ons

Each add-on is a separate registry item that depends only on the core `data-grid`:

| Item | Adds | Docs |
| --- | --- | --- |
| `data-grid-fill` | Fill handle: drag-to-tile with series inference, mod+D / mod+R keyboard fill | [Fill](https://gridcn.vercel.app/docs/addons/fill) |
| `data-grid-history` | Undo and redo | [Undo & redo](https://gridcn.vercel.app/docs/addons/undo-redo) |
| `data-grid-toolbar` | Search, filter, and column-visibility toolbar | [Toolbar](https://gridcn.vercel.app/docs/addons/toolbar) |
| `data-grid-sort-list` | Sort button plus popover: add, remove, and reorder multi-column sorts | [Sort list](https://gridcn.vercel.app/docs/addons/sort-list) |
| `data-grid-context-menu` | Cell, header, and row context menus | [Context menu](https://gridcn.vercel.app/docs/addons/context-menu) |
| `data-grid-keybindings` | Keyboard-shortcuts reference dialog | [Keybindings](https://gridcn.vercel.app/docs/addons/keybindings) |
| `data-grid-pinned-rows` | Pinned top and bottom row bands, for example a totals row | [Pinned rows](https://gridcn.vercel.app/docs/addons/pinned-rows) |
| `data-grid-presence` | Multiplayer presence: remote users' live selections as named, colored highlights | [Presence](https://gridcn.vercel.app/docs/addons/presence) |
| `data-grid-io` | CSV and XLSX import and export | [Import & export](https://gridcn.vercel.app/docs/addons/import-export) |
| `data-grid-url-state` | Sort, filter, search, and pagination state synced to the URL | [URL state](https://gridcn.vercel.app/docs/addons/url-state) |
| `data-grid-lazy` | Lazy row loading: fetch rows on demand as the viewport scrolls | [Lazy loading](https://gridcn.vercel.app/docs/lazy-loading) |
| `data-grid-pagination` | Composable pagination footer (`DataGridPaginationBar` plus parts) | [Pagination](https://gridcn.vercel.app/docs/pagination) |

## Agent skills

```bash
npx skills add DammersCode/gridcn
```

Five skills teach Claude Code, Cursor, Codex, and other coding agents the procedures and silent traps of gridcn: performance audits, custom cell types, data sources, add-on wiring, and upgrades. The [Agent Skills](https://gridcn.vercel.app/docs/agent-skills) page describes each one.

## Updating

Re-run the install command, for example `npx shadcn add @gridcn/data-grid` (or the GitHub path for pinned refs). The CLI shows a diff and asks before it overwrites files that you edited.

## Contributing

[CONTRIBUTING.md](./CONTRIBUTING.md) has the repository structure rules. [DEVELOPMENT.md](./DEVELOPMENT.md) covers local development, the test gates, benchmarking, the registry build, and consumer-install troubleshooting. The docs site source is in [`content/docs/`](./content/docs/).

## Credits

gridcn builds on and learns from several open-source projects. Thank you.

- [shadcn/ui](https://ui.shadcn.com): the registry distribution system (`registry.json`, the `shadcn` CLI) that ships gridcn, and the UI primitives (`button`, `input`, `select`, `popover`, `dropdown-menu`, `context-menu`, `calendar`, and more) that its chrome composes.
- [Base UI](https://base-ui.com): the headless, accessible primitives under the shadcn components (`@base-ui/react`).
- [diceui](https://diceui.com) (MIT, (c) 2024 Sadman Sakib): the toolbar, filter, and sort-list UX patterns and the FPS meter are adapted from it.
- [tablecn](https://github.com/sadmann7/tablecn) (MIT, (c) Sadman Sakib): the aligned-row layout of the filter and sort popovers, and the join-column pattern, are adapted from it.
- [@dnd-kit](https://dndkit.com): drag-to-reorder in the filter and sort-list popovers (`data-grid-toolbar`, `data-grid-sort-list`). Column reorder in the core grid uses native pointer events, with no dependency.
- [lucide](https://lucide.dev) (ISC): the icons of the grid's chrome: menus, sort indicators, pagination, markers, and dialogs.
- [PapaParse](https://www.papaparse.com) (MIT): the CSV parsing behind the `data-grid-io` import.
- [nuqs](https://nuqs.dev) (MIT): the searchParams-based URL sync under `data-grid-url-state`.
- [Standard Schema](https://standardschema.dev) (MIT): the vendor-neutral validation interface that a cell's `validate` option accepts (Zod, Valibot, and more).
- [Zustand](https://zustand.docs.pmnd.rs): the state store under the core grid and every add-on with its own local store (for example, `data-grid-presence`).
- [Fumadocs](https://fumadocs.dev): the documentation site: content layer, search, and page layout.

## License

[Apache License 2.0](./LICENSE) © [DammersCode](https://github.com/DammersCode). Behavior specs from other data grids are inspiration only, with no code derivation.
