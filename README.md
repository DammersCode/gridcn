# gridcn

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub Stars](https://img.shields.io/github/stars/DammersCode/gridcn?style=flat-square)](https://github.com/DammersCode/gridcn)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue?logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19%2B-blue?logo=react)](https://react.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-4%2B-blue?logo=tailwindcss)](https://tailwindcss.com/)

An editable, composable data grid for the [shadcn/ui](https://ui.shadcn.com) ecosystem. Real DOM
cells, styled with your shadcn tokens. Distributed through the
[shadcn registry](https://ui.shadcn.com/docs/registry).

Range selection, clipboard paste, and a fill handle are in the core, under the
[MIT license](./LICENSE).

## Install

This repository doubles as a [shadcn GitHub registry](https://ui.shadcn.com/docs/registry/github)
— no npm package, no namespace setup:

```bash
npx shadcn@latest add DammersCode/gridcn/data-grid
```

Install add-ons the same way, for example `npx shadcn add DammersCode/gridcn/data-grid-toolbar`.
Append `#<branch|tag|sha>` to the item name to pin a ref. The [installation docs](https://github.com/DammersCode/gridcn/blob/main/content/docs/installation.mdx)
cover the full setup, framework notes, and known problems.

Alternative: the repository also ships pre-built registry payloads in `public/r/`. When the
documentation site is hosted (for example on Vercel), you can register the `@gridcn` namespace
pointing at that host and install with `npx shadcn add @gridcn/data-grid`.

## What it can do

- **Range selection** — anchor plus rectangular range, ctrl-click multi-range, row and column
  selection, keyboard extension (Shift+Arrow, Shift+Ctrl+Arrow, Ctrl+A).
- **Clipboard** — native copy, cut, and paste in TSV and HTML table formats. Pastes to and from
  Excel, Google Sheets, Apple Numbers, LibreOffice, and other spreadsheets.
- **Editing** — typed cell editors (text, number, checkbox, date, select), custom cell types,
  autocomplete-style series fill through the fill-handle add-on.
- **Validation** — pass a function or any [Standard Schema](https://standardschema.dev) library
  (Zod, Valibot, ArkType). Sync and async, on single edits and on bulk paste, fill, and import.
- **Server errors** — paint an API rejection on the exact cell with `setCellErrors`. The error
  clears when the user commits a fix.
- **Streaming updates** — `updateCells` applies live value patches without a full re-render.
  Sorted grids stay fast: an incremental sort keeps the order correct at 100k rows.
- **Virtualization** — CSS Grid with windowed row rendering. Smooth at 100k rows, with a
  no-blank-rows guarantee that a real-browser test suite enforces.
- **Typed columns** — `defineColumns<TData>()` infers value types and per-cell-type `options`
  from your data shape. A typo in a column id is a compile error.
- **Controlled and uncontrolled** — selection, sort, filter, and column state work uncontrolled
  by default. Pass the matching value plus `on*Change` props to control them.
- **RTL** — a `direction` prop (or `dir="rtl"` on the page) mirrors layout, pinning, pointer
  math, and keyboard semantics.
- **i18n** — every user-facing string lives in one typed `labels` object with English defaults.
  Deep-merge your own.
- **Styling** — themed through your existing shadcn CSS tokens plus a few `--grid-*` variables.
  See the [styling guide](https://github.com/DammersCode/gridcn/blob/main/content/docs/styling-theming.mdx)
  (or the hosted docs site once it is deployed).

## Add-ons

The core `data-grid` item is the engine: range selection, keyboard, editing, cell types,
clipboard, validation. Everything else is a separate registry item that depends only on the core:

| Item | Adds |
| --- | --- |
| `data-grid-fill` | Fill handle — drag-to-tile with series inference, mod+D/mod+R keyboard fill |
| `data-grid-presence` | Multiplayer presence — remote users' live selections as named, colored highlights |
| `data-grid-pinned-rows` | Pinned top/bottom row bands (for example, a totals row) |
| `data-grid-history` | Undo/redo |
| `data-grid-toolbar` | Search, filter, and column-visibility toolbar |
| `data-grid-sort-list` | Sort button plus popover: add, remove, and reorder multi-column sorts |
| `data-grid-context-menu` | Cell, header, and row context menus |
| `data-grid-keybindings` | Keyboard-shortcuts reference dialog |
| `data-grid-io` | CSV/XLSX import and export |
| `data-grid-url-state` | Sort, filter, search, and pagination state synced to the URL |
| `data-grid-lazy` | Lazy row loading — fetch rows on demand as the viewport scrolls |
| `data-grid-pagination` | Composable pagination footer (`DataGridPaginationBar` plus parts) |

## Docs

Full documentation — quick start, editing and cell types, selection and keyboard reference,
recipes, and the API reference — is this repository's [Fumadocs](https://fumadocs.dev) site
(`content/docs/`). It can be hosted for free on Vercel:

1. Push the repository to GitHub.
2. Import the repository at [vercel.com/new](https://vercel.com/new) — the Next.js framework
   preset is auto-detected; no environment variables are needed.
3. Deploy. The free Hobby plan serves the site at `https://<project>.vercel.app`, which also
   serves the hosted registry payloads at `/r/{name}.json` (the optional `@gridcn` namespace
   points there).

## Updating

Re-run `npx shadcn add DammersCode/gridcn/<item>`. The CLI shows a diff and asks before it
overwrites files that you edited.

## Contributing and development

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the repository structure rules and
[DEVELOPMENT.md](./DEVELOPMENT.md) for local development, the test gates, benchmarking, the
registry build, and consumer-install troubleshooting.

## Credits

gridcn builds on and learns from several open-source projects. Thank you.

- [shadcn/ui](https://ui.shadcn.com) — the registry distribution system (`registry.json`, the
  `shadcn` CLI) that ships gridcn, and the UI primitives (`button`, `input`, `select`, `popover`,
  `dropdown-menu`, `context-menu`, `calendar`, and more) that its chrome composes.
- [Base UI](https://base-ui.com) — the headless, accessible primitives underneath the shadcn
  components gridcn builds on (`@base-ui/react`).
- [diceui](https://diceui.com) (MIT, (c) 2024 Sadman Sakib) — toolbar/filter/sort-list UX patterns
  and the FPS meter are adapted from it.
- [tablecn](https://github.com/sadmann7/tablecn) (MIT, (c) Sadman Sakib) — the aligned-row layout
  of the filter and sort popovers, and the join-column pattern, are adapted from it.
- [@dnd-kit](https://dndkit.com) — drag-to-reorder in the filter and sort-list popovers
  (`data-grid-toolbar`, `data-grid-sort-list`). Column drag-to-reorder in the core grid uses
  native pointer events instead, with no dependency.
- [lucide](https://lucide.dev) (ISC) — the icon set of the grid's chrome: menus, sort indicators,
  pagination, markers, and dialogs.
- [PapaParse](https://www.papaparse.com) (MIT) — the CSV parsing behind `data-grid-io`'s import.
- [nuqs](https://nuqs.dev) (MIT) — the searchParams-based URL sync that
  `data-grid-url-state` builds on.
- [Standard Schema](https://standardschema.dev) (MIT) — the vendor-neutral validation interface a
  cell's `validate` option accepts: any validator that implements it (zod, valibot, and more).
- [Zustand](https://zustand.docs.pmnd.rs) — the state store underneath the core grid and every
  add-on that needs its own local store (for example, `data-grid-presence`).
- [Fumadocs](https://fumadocs.dev) — the documentation site: content layer, search, and page
  layout.

## License

[MIT](./LICENSE). Behavior specs from other data grids are inspiration only — no code
derivation.
