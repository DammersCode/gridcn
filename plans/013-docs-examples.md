# Plan 013: Docs examples — one live example per feature, collapsible IA, library mappings

> **Executor instructions:** Work the windows in order. Each window is self-contained: read its
> scope, run the RED check (documents the current state), implement, run the GREEN checks,
> commit with the given message. Honor the STOP conditions. Update the Status table row when
> done. This plan touches `content/docs/**`, `registry/default/examples/**`, `registry.json`,
> `components/registry-examples.tsx`, `package.json` (devDeps only). It never touches
> `registry/default/blocks/` core source — new demos are new files only.

Provenance: user request 2026-09-22 (one example per feature; collapsible docs navigation;
validation examples with/without libraries; ORM + data-fetching library examples; deep library
research; same-day refinements: split Data & Integrations by supply mode × fetching library,
dedicated row/column drag & drop examples, server-side examples + niko-table.com example-catalog
audit, row action-buttons column, Kbd-grouping visual fix, feature-placement audit — add-on
docs scattered across feature guides, e.g. the context menu and keybindings, full docs
prose/structure audit —
tab-split long pages, compress over-explained prose, dedup repeated facts). Library research:
`research/docs-examples-libraries.md` (read before windows 4/5/8); prose audit:
`research/docs-prose-audit.md` (read before window 10).
Fumadocs v16 sidebar facts (verified in `node_modules/fumadocs-core@16.15.11`): subdirectories of
`content/docs/` become natively collapsible sidebar folders; each folder may carry its own
`meta.json` (`title`, `icon`, `collapsible` (default true), `defaultOpen`, `pages`,
`pagesIndex`). **Do not set `root: true`** in a folder meta.json — that turns the group into a
sidebar version tab. The root `meta.json` stays flat: a single `"examples"` string embeds the
folder. Embed pattern for live demos: `<ComponentPreview name="<registry:example name>" />`
(Preview/Code tabs; the code tab shows the exact `shadcn add` output).

## Scope

In scope:
- New top-level **Examples** section (collapsible subgroups) in the docs nav + hub pages.
- One focused docs page + live demo per feature (matrix below).
- New registry examples: column layout, column drag & drop, row ops, row action buttons,
  cross-field validation, lazy + React Query, lazy + SWR, pagination + React Query,
  pagination + SWR, server-side remote data, row drag & drop (window 9). Validation demo
  extension with Zod/Valibot/ArkType columns.
- Library mapping content (validation, data fetching, ORM recipes, i18n) per
  `research/docs-examples-libraries.md`.
- Kbd grouping polish (window 6a): one keycap per binding — grouped keys render as a single
  unit, consistent with ungrouped keys, and identical in docs, runtime dialog, and consumer
  apps.
- Feature-placement audit (window 6b): every add-on block gets exactly one canonical docs
  home; feature guides keep core behavior only and link out. Known findings: the context-menu
  add-on (content split across the columns, row-operations, and clipboard guides) and the
  keybindings add-on (installed inside the selection-keyboard guide) have no page of their own.
- Prose & structure audit (window 10): tab-split long guide/add-on pages, compress
  over-explained sections, dedup cross-page facts to one canonical copy each (fleet audit
  2026-09-22: `research/docs-prose-audit.md`).
- Cross-links: omnibus guide pages (columns, row-operations, editing-cell-types, …) get a
  "See example" link to the new pages; `playground.mdx` links updated for moved pages.

Deferred — do NOT touch:
- Core block sources (`registry/default/blocks/data-grid/**`) and any behavior change.
- `api-reference.mdx`, `events-state.mdx` rewrites (link-outs only).
- URL redirects for moved pages (not needed at this traffic; note in the W6 commit body).
- Any new add-on block, i18n library adoption, date-library demos.

## Target navigation tree

```
---[Sparkles]Getting Started---   (unchanged)
index, installation, quick-start, playground

examples/                         NEW folder — one "examples" entry in root meta.json
├── meta.json                     { title: "Examples", icon: "Blocks", defaultOpen: true,
│                                   pages: [foundations, columns, rows, validation, data,
│                                            addons, appearance] }
├── foundations/                  { title: "Foundations", icon: "Box" }
│   ├── index.mdx                 hub (Cards linking to the pages)
│   ├── minimal-grid.mdx          data-grid-minimal-demo (existing)
│   ├── editable-grid.mdx         data-grid-demo (existing hero)
│   ├── cell-types.mdx            data-grid-cell-types-demo (existing)
│   └── custom-cells.mdx          data-grid-custom-cell-demo (existing)
├── columns/                      { title: "Columns & Pinning", icon: "Columns3" }
│   ├── index.mdx
│   ├── pinning.mdx               data-grid-pinning-demo (existing)
│   ├── custom-headers.mdx        data-grid-custom-headers-demo (existing)
│   ├── row-markers.mdx           data-grid-row-markers-demo + data-grid-custom-markers-demo
│   ├── drag-reorder.mdx          NEW demo data-grid-column-drag-demo
│   ├── filtering.mdx             data-grid-sorting-filtering-demo (faceted/range focus)
│   └── column-layout.mdx         NEW demo data-grid-column-layout-demo
├── rows/                         { title: "Rows & Selection", icon: "Rows3" }
│   ├── index.mdx
│   ├── row-operations.mdx        NEW demo data-grid-row-ops-demo
│   ├── actions.mdx               NEW demo data-grid-actions-demo
│   ├── drag-reorder.mdx          NEW demo data-grid-row-reorder-demo  (window 9)
│   └── streaming.mdx             data-grid-streaming-demo (existing)
├── validation/                   { title: "Editing & Validation", icon: "ShieldCheck" }
│   ├── index.mdx
│   ├── validation.mdx            data-grid-validation-demo (extended: +Zod/Valibot/ArkType)
│   ├── async-validation.mdx      same demo, async section (SKU pending state)
│   ├── server-errors.mdx         data-grid-cell-errors-demo (existing)
│   └── cross-field.mdx           NEW demo data-grid-cross-field-demo
├── data/                         { title: "Data & Integrations", icon: "Database" }
│   ├── index.mdx
│   ├── lazy/                     { title: "Lazy Loading" }
│   │   ├── plain.mdx             data-grid-lazy-demo (existing)
│   │   ├── react-query.mdx       NEW demo data-grid-lazy-react-query-demo
│   │   └── swr.mdx               NEW demo data-grid-lazy-swr-demo
│   ├── pagination/               { title: "Server Pagination" }
│   │   ├── client.mdx            data-grid-pagination-demo (existing)
│   │   ├── react-query.mdx       NEW demo data-grid-pagination-react-query-demo
│   │   └── swr.mdx               NEW demo data-grid-pagination-swr-demo
│   ├── server-side.mdx           NEW demo data-grid-server-side-demo
│   │                             (sort+filter+search+page → one query; shareable via URL state)
│   ├── large-data.mdx            data-grid-large-data-demo + data-grid-performance-demo
│   │                             (closes the "demo not embedded in docs" gap)
│   └── orm/                      { title: "ORM & Data Sources" }  — recipes, no live demos
│       ├── drizzle.mdx           recipe (flagship)
│       ├── prisma.mdx            recipe
│       └── supabase.mdx          recipe (short)
├── addons/                       { title: "Add-ons", icon: "Puzzle" }
│   ├── index.mdx
│   ├── fill.mdx                  data-grid-fill-patterns-demo (+ hero demo mention)
│   ├── pinned-rows.mdx           data-grid-pinned-rows-demo
│   ├── presence.mdx              data-grid-presence-demo
│   ├── undo-redo.mdx             data-grid-history-demo
│   ├── toolbar.mdx               data-grid-sorting-filtering-demo
│   ├── context-menu.mdx          data-grid-context-menu-demo
│   ├── keybindings.mdx           data-grid-keybindings-demo (closes the not-embedded gap)
│   ├── url-state.mdx             data-grid-url-state-demo
│   ├── import-export.mdx         data-grid-io-demo
│   └── sort-list.mdx             data-grid-sort-list-demo
└── appearance/                   { title: "Appearance & i18n", icon: "Palette" }
    ├── index.mdx
    ├── styling.mdx               data-grid-styling-patterns-demo + data-grid-conditional-styling-demo
    ├── loading-states.mdx        data-grid-loading-demo
    └── i18n-rtl.mdx              data-grid-i18n-demo + library mapping section

---[LayoutGrid]Features---        (unchanged — conceptual guides; gain "See example" links)
---[Blocks]Add-ons---             (removed — content moved to examples/addons, W6)
---[BookOpen]Reference---         (unchanged)
```

## Example matrix (status legend: E = existing demo, page only; N = new registry demo)

| Page | Group | Demo (registry item) | Status | New dep | Notes |
|---|---|---|---|---|---|
| minimal-grid | foundations | data-grid-minimal-demo | E | — | quick-start minimum |
| editable-grid | foundations | data-grid-demo | E | — | hero: every cell type + fill + clipboard |
| cell-types | foundations | data-grid-cell-types-demo | E | — | all built-ins + read-only + renderCell |
| custom-cells | foundations | data-grid-custom-cell-demo | E | — | currency custom cell, GridCellTypes augmentation |
| pinning | columns | data-grid-pinning-demo | E | — | pin L/R, resize, autosize, hide, flex (reorder → drag-reorder page) |
| custom-headers | columns | data-grid-custom-headers-demo | E | — | |
| row-markers | columns | data-grid-row-markers-demo, data-grid-custom-markers-demo | E | — | both modes + custom renderers |
| column-layout | columns | data-grid-column-layout-demo | **N** | — | defaultColumnLayout + onColumnLayoutChange + localStorage |
| drag-reorder (columns) | columns | data-grid-column-drag-demo | **N** | — | enableColumnReorder: header drag, pin-zone scoped, setColumnOrder programmatic |
| filtering | columns | data-grid-sorting-filtering-demo | E | — | faceted = `isAnyOf` multi-value, range = `isBetween`; DIY counts snippet |
| row-operations | rows | data-grid-row-ops-demo | **N** | — | insert/duplicate/delete on selection + context menu + shortcuts |
| actions | rows | data-grid-actions-demo | **N** | — | renderCell actions column: inline edit + delete buttons + dropdown (edit/duplicate/delete), pinned right |
| drag-reorder (rows) | rows | data-grid-row-reorder-demo | **N** | — | marker drag + programmatic reorderRows; **BLOCKED: window 9** |
| streaming | rows | data-grid-streaming-demo | E | — | |
| validation | validation | data-grid-validation-demo | E+ext | zod, valibot, arktype | +3 Standard-Schema library columns |
| async-validation | validation | (same demo) | E | — | pending state, supersede, bulk |
| server-errors | validation | data-grid-cell-errors-demo | E | — | setCellErrors ring/tint/tooltip |
| cross-field | validation | data-grid-cross-field-demo | **N** | — | validateRow |
| lazy (plain) | data/lazy | data-grid-lazy-demo | E | — | windowed fetch without a lib |
| lazy + React Query | data/lazy | data-grid-lazy-react-query-demo | **N** | @tanstack/react-query | useInfiniteQuery: window → page, 10k rows, fake API |
| lazy + SWR | data/lazy | data-grid-lazy-swr-demo | **N** | swr | useSWRInfinite analog |
| pagination (client) | data/pagination | data-grid-pagination-demo | E | — | client slice + server-mode explainer |
| pagination + React Query | data/pagination | data-grid-pagination-react-query-demo | **N** | @tanstack/react-query | server mode: page/sort/pageSize as queryKey, refetch per page |
| pagination + SWR | data/pagination | data-grid-pagination-swr-demo | **N** | swr | same contract, useSWR key per page |
| server-side | data | data-grid-server-side-demo | **N** | @tanstack/react-query | sort+filter+search+page as query params; SWR as CodeBlockTabs; URL-state shareable section |
| large-data | data | data-grid-large-data-demo, data-grid-performance-demo | E | — | virtualization + FPS proof |
| orm/drizzle | data/orm | recipe | R | none | server code + grid wiring, marked "recipe" |
| orm/prisma | data/orm | recipe | R | none | same shape |
| orm/supabase | data/orm | recipe | R | none | short |
| fill | addons | data-grid-fill-patterns-demo | E | — | |
| pinned-rows | addons | data-grid-pinned-rows-demo | E | — | aggregates |
| presence | addons | data-grid-presence-demo | E | — | |
| undo-redo | addons | data-grid-history-demo | E | — | |
| toolbar | addons | data-grid-sorting-filtering-demo | E | — | search/filter/sort-list/columns menu |
| context-menu | addons | data-grid-context-menu-demo | E (page new in W6) | — | canonical add-on home; content currently scattered across columns + row-operations + clipboard guides |
| keybindings | addons | data-grid-keybindings-demo | E (page new in W6) | — | canonical add-on home; content currently in the selection-keyboard guide; closes not-embedded gap |
| url-state | addons | data-grid-url-state-demo | E | — | |
| import-export | addons | data-grid-io-demo | E | — | |
| sort-list | addons | data-grid-sort-list-demo | E | — | |
| styling | appearance | data-grid-styling-patterns-demo, data-grid-conditional-styling-demo | E | — | |
| loading-states | appearance | data-grid-loading-demo | E | — | |
| i18n-rtl | appearance | data-grid-i18n-demo | E | — | + next-intl/react-i18next mapping section |

## Competitor example reference (niko-table.com, fetched 2026-09-22)

Their example catalog → our mapping:

| niko-table example | gridcn |
|---|---|
| Simple / Basic / Search / Inline Edit | foundations + validation pages (covered) |
| Row Selection / Row Context Menu | selection guide + context-menu add-on page (covered) |
| Column Pinning / Column Resize | columns group (covered) |
| Row DnD / Column DnD | rows/columns drag-reorder pages (planned here; rows blocked on W9) |
| Actions column (Edit/Delete/dropdown) | rows/actions page (planned here via `renderCell` — no new core feature needed) |
| Virtualization / Infinite Scroll (± virtualized) | data/lazy + large-data (covered) |
| Faceted / Advanced / Inline Filter | columns/filtering page (planned here: `isAnyOf` + `isBetween`) |
| Server-Side (± Nuqs) | data/server-side page (planned here, incl. the URL-state shareable section) |
| Drizzle ORM (± Nuqs) | data/orm recipes (planned here, incl. the URL-state variant) |
| Row Expansion / Tree / Grouping / Aside | **out of scope** — v1 non-goals (PLAN.md §1: no grouping; no row spans/tree) |
| Persistence / Dynamic Columns | column-layout page covers persistence; dynamic columns stay a guide topic |

What they have that we do NOT copy: live facet counts baked into the filter UI (that would be a
toolbar add-on feature, not a docs gap — the filtering page shows a DIY app-side counts snippet
instead).

## Status

**DONE** — all windows landed on main (per-window SHAs were not tracked; the work spanned the
`content/docs/**` + `registry/default/examples/**` history after 2026-09-22). Two intentional
deviations from the target tree: add-ons became a top-level `content/docs/addons/` section with
live demos instead of `examples/addons` (decision recorded in `863bea7`), and W9 landed after the
`feat/row-reorder` merge (rows/drag-reorder.mdx).

| Window | Scope | Status |
|---|---|---|
| 0 | Examples folder tree + meta.jsons + root meta + hubs | DONE |
| 1 | Foundations (4 pages, existing demos) | DONE |
| 2 | Columns & Pinning (6 pages + column-layout + column-drag demos) | DONE |
| 3 | Rows (row-ops + actions demos, 4 pages) | DONE |
| 4 | Validation (demo extension + 4 pages + cross-field demo) | DONE |
| 5 | Data & Integrations (5 new demos, 3 recipe pages, 8 pages) | DONE |
| 6 | Kbd grouping polish + feature-placement audit (context-menu + keybindings pages) | DONE |
| 7 | Add-ons (10 pages, live demos — landed as `content/docs/addons/` top-level section) | DONE |
| 8 | Appearance & i18n (3 pages) | DONE |
| 9 | Row drag & drop (demo + page under rows/) | DONE |
| 10 | Prose & structure audit (tabs + compression + dedup, `cb8117f`) | DONE |

## Repo facts (window-specific)

- New registry demo checklist (every **N** item): (1) `registry/default/examples/<name>.tsx`,
  (2) new `registry:example` entry in `registry.json` (name, title, description, author "gridcn",
  `registryDependencies`, `files`, `dependencies` when the demo imports a third-party lib),
  (3) static import entry in `components/registry-examples.tsx` (the `RegistryExampleName`
  union — TS-enforced), (4) `pnpm registry:build && pnpm registry:verify`, (5) docs page with
  `<ComponentPreview name="<name>" />`.
- EOL gotcha: `pnpm registry:build` can produce CRLF-only diffs in unrelated payloads
  (`data-grid-fill.json`, `data-grid-playground-demo.json`, `data-grid-toolbar.json` so far) —
  restore those with `git restore --source=HEAD -- <file>`, commit only real content diffs.
- Docs pages: frontmatter `title`/`description`/`icon` (lucide icon string — registered via
  `lucideIconsPlugin()`), relative links, kebab-case filenames.
- Fumadocs components available in MDX: `Card`/`Cards`, `Callout`, `CodeBlockTabs` (default
  map); `Tabs`, `Accordion`, `Steps` (Steps already wired in `components/mdx.tsx`).
- New devDeps land in `package.json` devDependencies (pnpm), and ALSO in the demo's registry
  `dependencies` array when the example file imports them (consumer gets them via `shadcn add`).

## Window 0 — Examples folder tree + nav

1. RED: `content/docs/` is flat (31 files, no subdirectories); root `meta.json` has four
   `---[Icon]…---` separators, no collapsible groups.
2. Create `content/docs/examples/` with subfolders `foundations/ columns/ rows/ validation/
   data/ data/lazy/ data/pagination/ data/orm/ addons/ appearance/`. Per-folder `meta.json`
   per the tree above (folders without an index page may omit `pages`; `orm` has no demo,
   pages only).
3. Root `meta.json`: insert `"examples"` after `playground`, before the Features separator.
   Remove the `---[Blocks]Add-ons---` separator AND its 9 pages from the root list NOW only if
   window 6 has landed; otherwise keep the Add-ons section until W6 (execute W0's meta change
   for the Add-ons section together with W6 to avoid a broken nav state).
4. Hub `index.mdx` per subfolder: 2–3 sentence intro + `<Cards>` linking the folder's pages.
   Frontmatter `title` must match the folder meta title.
5. GREEN: `pnpm types:check` (fumadocs-mdx typegen over the new tree), `pnpm build`, manual:
   sidebar shows "Examples" as a collapsible group, subgroups collapse/expand, hubs link.
6. `Commit: docs: add the collapsible Examples section to the docs nav`
7. STOP if typegen/build fails on the folder meta.json shape (then: `loader` transformer in
   `lib/source.ts` is the sanctioned fallback — record which, and stop).

## Window 1 — Foundations

1. RED: no `examples/foundations/` pages.
2. Create the 4 pages (matrix: minimal-grid, editable-grid, cell-types, custom-cells). Each:
   frontmatter, 1-paragraph "what this shows", `<ComponentPreview name="…" />`, "What's in the
   demo" bullets (feature → prop mapping), `shadcn add` line for the demo item, "Related" links
   (quick-start / the matching guide page).
3. GREEN: `pnpm build`; manual: all four pages render live preview + code tab with the registry
   source.
4. `Commit: docs: add Foundations examples (minimal, hero, cell types, custom cells)`
5. STOP if `ComponentPreview` cannot resolve a name (import map missing — add it in
   `components/registry-examples.tsx`).

## Window 2 — Columns & Pinning

1. RED: pinning/headers/markers knowledge lives in `columns.mdx` (omnibus); column layout and
   column drag have no dedicated demos; row drag has no demo (branch-only, window 9).
2. New demo `data-grid-column-layout-demo`: `defaultColumnLayout` + `onColumnLayoutChange`
   persisted to `localStorage` (hide/pin/width survive reload); toolbar columns menu to change
   state. Registry item + import map + `pnpm registry:build && pnpm registry:verify`.
3. New demo `data-grid-column-drag-demo`: `enableColumnReorder` + per-column `reorderable`;
   drag a header with the grip (pin-zone scoped), plus "move left/right" buttons wired to
   `actions.setColumnOrder` for the programmatic path. Registry item + import map.
4. Pages: `pinning.mdx` (embed data-grid-pinning-demo; sections: pin left/right, resize,
   autosize, hide/show, flex fill — reorder defers to the drag-reorder page),
   `drag-reorder.mdx` (embed the column-drag demo; drag vs programmatic; link the rows
   drag-reorder page once it lands), `filtering.mdx` (embed data-grid-sorting-filtering-demo;
   faceted = `isAnyOf` multi-value, range = `isBetween` numeric/date; DIY per-option counts as
   an app-side snippet; niko-table faceted-filter reference), `custom-headers.mdx`,
   `row-markers.mdx` (both demos), `column-layout.mdx`.
5. `columns.mdx` (guide): add a "See examples" link list at top.
6. GREEN: `pnpm registry:verify`, `pnpm types:check`, `pnpm build`; manual: column-layout demo
   persists across a manual reload; column drag moves within the pin zone.
7. `Commit: feat(registry): add the column layout and column drag examples`
8. `Commit: docs: add Columns & Pinning examples`
9. SKIP + note in Status if `reorderRows` is not on main yet (window 9 owns it):
   `git merge-base --is-ancestor $(git rev-list -n1 main -- registry/default/blocks/data-grid/store/types.ts) …` —
   simpler: `git grep -l reorderRows main -- registry/ | wc -l` → 0 means skip.

## Window 3 — Rows & Selection

1. RED: row ops documented only in `row-operations.mdx`; no dedicated demo (context-menu demo
   shows the menu items only); no action-buttons column pattern.
2. New demo `data-grid-row-ops-demo`: 8-row dataset; toolbar buttons + context-menu items for
   insert (above/below), duplicate, delete on the current selection; a side panel showing the
   last `onDataChange` payload (op kind, affected row ids) so the op-shape contract is visible;
   disabled state when `readOnly`. Registry item + import map + build/verify.
3. New demo `data-grid-actions-demo`: an actions column (`pin: "right"`, `readOnly`,
   `renderCell`) with two inline shadcn Buttons (Edit → `actions.startEditing` on the row's
   first editable cell; Delete → `actions.deleteRows`) + a `DropdownMenu` "more" button with
   Edit/Duplicate/Delete items; verify the exact `renderCell` callback signature and the
   `startEditing` action name in `types.ts`/`store` before wiring. No new core feature — pure
   `renderCell` composition over existing actions. Registry item + import map.
4. Pages: `row-operations.mdx` (embed demo; sections per op with shortcuts `mod+shift+F` /
   `mod+shift+X` / delete; link the guide for op semantics), `actions.mdx` (embed the actions
   demo; the two patterns: inline buttons vs dropdown; when to use which), `streaming.mdx`
   (embed data-grid-streaming-demo; defer/immediate auto-sort switch).
5. `row-operations.mdx` (guide): add the "See example" link.
6. GREEN: `pnpm registry:verify`, `pnpm build`; manual: all three ops work from menu AND
   toolbar; the actions column's buttons edit/delete the right row (by id, not index).
7. `Commit: feat(registry): add the row operations and row action buttons examples`
8. `Commit: docs: add Rows examples (row operations, actions, streaming)`

## Window 4 — Editing & Validation

1. RED: `data-grid-validation-demo` covers fn / Standard Schema / async / onInvalid-warn but no
   per-library columns; `validateRow` has no demo; `setCellErrors` demo exists but has no
   example page.
2. devDeps: `zod`, `valibot`, `arktype` (current majors, check 2026-09). Extend
   `data-grid-validation-demo.tsx`: three new columns — `Zod Score` (`z.number().int().min(0).max(100)`),
   `Valibot Code` (`v.pipe(v.string(), v.minLength(3))`), `ArkType Tag` (`a.$("string").check(v => v.length < 12)`) —
   same value shapes as the existing columns so one dataset serves all; add the three libs to
   the demo's registry `dependencies`. `pnpm registry:build && pnpm registry:verify`.
3. New demo `data-grid-cross-field-demo`: two columns (Start, End) + `validateRow` rejecting
   End < Start; error surfaces on commit like sync validation. Registry item + import map.
4. Pages: `validation.mdx` (sync: fn form, then Standard Schema with a `CodeBlockTabs` per
   library — no-lib / Zod / Valibot / ArkType; the adapter paragraph for Yup/Joi; link
   `research/docs-examples-libraries.md` §1 via the i18n-style "Which library" callout),
   `async-validation.mdx` (pending state, supersede, bulk paths), `server-errors.mdx`
   (embed data-grid-cell-errors-demo; setCellErrors/clearCellErrors, auto-clear),
   `cross-field.mdx` (embed the new demo; validateRow contract).
5. `editing-cell-types.mdx` (guide): "See examples" link list at the validation section.
6. GREEN: `pnpm registry:verify`, `pnpm types:check`, `pnpm build`; manual: each library column
   rejects a bad value with the library's own message; cross-field commit is blocked with the
   row-level message.
7. `Commit: chore(dev): add zod, valibot, arktype for the validation examples`
8. `Commit: feat(registry): extend the validation demo with Standard Schema library columns`
9. `Commit: feat(registry): add the cross-field validation example`
10. `Commit: docs: add the Editing & Validation examples`
11. SKIP the onInvalid("warn") page content if `onInvalid` is not on main yet (branch-only;
    lands with the cell-error PR — add the section then).

## Window 5 — Data & Integrations

1. RED: no query-library or ORM coverage in docs; `data-grid-large-data-demo` not embedded
   anywhere; pagination/lazy demos exist but no example pages.
2. devDeps: `@tanstack/react-query` (v5), `swr` (v2).
3. New demo `data-grid-lazy-react-query-demo`: `useInfiniteQuery` feeding `useDataGridLazyRows`
   (`onRowWindowChange` → page parameter; fake API `setTimeout` 300 ms, 10 000 rows, page size
   50); QueryClientProvider wrapper inside the demo file. Registry item
   (dependencies: `@tanstack/react-query`).
4. New demo `data-grid-lazy-swr-demo`: same contract with `useSWRInfinite` (key per window,
   `j` param), 10 000 rows. Registry item (dependencies: `swr`).
5. New demo `data-grid-pagination-react-query-demo`: `useDataGridPagination` server mode;
   `useQuery` with `queryKey: ["rows", page, pageSize, sort, filter]` fetching the page from
   the same fake API; the invalidation story for server edits. Registry item
   (dependencies: `@tanstack/react-query`).
6. New demo `data-grid-pagination-swr-demo`: same contract with `useSWR(["rows", page,
   pageSize], fetchPage)`. Registry item (dependencies: `swr`).
7. New demo `data-grid-server-side-demo`: the full remote contract in one grid — toolbar
   sort/filter/search + server pagination folded into one `useQuery`
   (`queryKey: ["rows", page, pageSize, sorts, filters, search]` → fake API); the SWR variant
   as a `CodeBlockTabs` section in the page (one-line key/queryFn delta, no second demo).
   Registry item (dependencies: `@tanstack/react-query`).
8. Pages: `lazy/plain.mdx` (embed data-grid-lazy-demo; link the two library pages as "bring
   your own fetcher"), `lazy/react-query.mdx` (windowed fetch in words: viewport → window →
   query page → sparse rows), `lazy/swr.mdx` (revalidate-on-focus note),
   `pagination/client.mdx` (client slice vs server mode), `pagination/react-query.mdx` +
   `pagination/swr.mdx` (page as cache key; refetch on page/sort change), `server-side.mdx`
   (embed the server-side demo; the shareable-state section wraps the fetch in
   `DataGridUrlState` — link the add-on page), `large-data.mdx` (embed BOTH large-data and
   performance demos; the virtualization explainer links `virtualization.mdx`).
9. Recipes (docs-only, each marked with a `Callout` "Recipe — not a shadcn registry example;
   requires a server"): `orm/drizzle.mdx` (Drizzle schema → route handler: sort/filter/page →
   rows; client: server-mode pagination; the Drizzle + `DataGridUrlState` shareable-state
   variant; Kysely one-liner), `orm/prisma.mdx` (same shape, Prisma query),
   `orm/supabase.mdx` (short: `supabase.from().select()` + range).
10. GREEN: `pnpm registry:verify`, `pnpm build`; manual: scroll the lazy demos — windows fetch
    (network tab or console log), no full reload; the pagination + server-side demos refetch on
    page/sort/filter change.
11. `Commit: feat(registry): add lazy, pagination, and server-side demos for TanStack Query and SWR`
12. `Commit: docs: add the Data & Integrations examples and ORM recipes`

## Window 6 — Kbd grouping polish + docs feature-placement audit

### 6a. Kbd grouping polish

RED (verified on `docs/selection-keyboard` + source, 2026-09-22): `Kbd` carries no border of
its own (`bg-muted rounded-sm` only) — the keycap look (border + inset bottom shadow) comes
from the fumadocs typography plugin's `.prose kbd` rule (see the load-bearing block in
`app/global.css:88-100`, which only neutralizes the radius). `KbdGroup` renders a
`<kbd data-slot="kbd-group">` wrapping per-chip `<kbd>`s, so the plugin rule applies at both
levels: a grouped binding ("Ctrl ↑") shows a double border + double shadow. Outside prose (the
runtime dialog's `BindingChips`, `data-grid-keybindings/binding-label.tsx`) the plugin rule
does not apply at all, so the same chips render flat there — docs and dialog look different.
Both callers import `components/ui/kbd.tsx`, which the registry packs into the
data-grid-keybindings payload.

1. `Kbd` becomes self-contained: the keycap treatment (border, inset bottom shadow, radius,
   `bg-muted`, `h-5`, padding) moves into the component's own classes — the component, not the
   prose plugin, is the styling owner, so docs, dialog, and consumer apps render identically.
2. `KbdGroup` renders a `<span data-slot="kbd-group">` (not a `<kbd>` — the group is a
   container, not a key) carrying the single keycap treatment for the whole binding; inner
   `Kbd` chips go flat inside a group via `in-data-[slot=kbd-group]:` variants (no border, no
   shadow, transparent bg, no min-width, reduced padding; chips stay separated by the
   existing gap). A lone `Kbd` (ungrouped) is unchanged visually.
3. `app/global.css`: scope the load-bearing kbd rule to `kbd:not([data-slot="kbd"])` so the
   typography plugin no longer styles component-owned keys (keep the block's re-check comment).
4. `pnpm registry:build && pnpm registry:verify` (kbd.tsx lands in the
   data-grid-keybindings payload).
5. GREEN: `pnpm types:check`, `pnpm build`; manual on `docs/selection-keyboard`: grouped
   bindings render as ONE keycap with flat inner chips; single-key rows unchanged; the runtime
   keybindings dialog renders the same keycap look.
6. `Commit: fix(ui): make KbdGroup a single keycap and own the keycap styling`

### 6b. Feature-placement audit

RED (known findings, verified 2026-09-22): two add-ons have no docs page of their own.
The `data-grid-context-menu` content is scattered across feature guides:
- `columns.mdx` §"Pin left/right": the header dropdown + right-click menu installed by the
  add-on, including the add-on's `InstallCommand`
- `row-operations.mdx` §"Context menu": the row-op menu items, cross-linked to
  `/docs/columns#pin-leftright`
- `clipboard.mdx`: embeds `data-grid-context-menu-demo` + the `clipboard-read` permission
  callout
The `data-grid-keybindings` add-on (in-app keybindings dialog + binding display) is installed
inside a feature guide:
- `selection-keyboard.mdx` §"Show this table at runtime": the add-on's `InstallCommand` +
  component import for the `<DataGridKeybindingsDialog>`
Rule: each add-on block has exactly one canonical docs home (Add-ons or Data sections);
feature guides keep core behavior only and link out.

1. Systematic pass: for every add-on block in `registry.json`, `grep -rn "<block name>"
   content/docs app`; classify each hit — canonical page (keep), one-line link-out (keep),
   deep content (move). Record the placement table in the commit body.
2. Create `content/docs/context-menu.mdx` + `content/docs/keybindings.mdx` (canonical homes,
   still in the flat Add-ons section — W7 moves them):
   - context-menu: install command, header-menu items, row-op items, the `clipboard-read`
     permission note (moved from clipboard.mdx with a back-link), `<ComponentPreview
     name="data-grid-context-menu-demo" />`, i18n labels link.
   - keybindings: install command, the `<DataGridKeybindingsDialog>` (moved from
     selection-keyboard), binding display (`BindingChips`), the `keymap`/`labels` remapping
     surface, `<ComponentPreview name="data-grid-keybindings-demo" />`.
   Root meta.json: add both pages to the Add-ons section.
3. Slim the guides: `columns.mdx` §"Pin left/right" keeps the pin behavior, drops the menu-UI
   paragraph + install command → link; `row-operations.mdx` §"Context menu" keeps the
   op/visibility contract (which items appear under which props), drops the add-on install
   story → link; `clipboard.mdx` keeps the permission semantics, drops the demo embed → link;
   `selection-keyboard.mdx` keeps the selection model + the keyboard map table (core
   behavior), drops the add-on install + dialog story → link. Fix the
   `/docs/columns#pin-leftright` cross-link.
4. Every other block found with deep guide content in step 1: same treatment (move + link).
   `selection-keyboard.mdx` keeps the user-facing shortcuts table; add-on install stories move
   to the owning add-on page.
5. GREEN: `pnpm build`; manual: every add-on block has exactly one nav page carrying its
   install command; no feature guide installs an add-on it doesn't own.
6. `Commit: docs: give the context-menu add-on its own page and audit feature placement`

## Window 7 — Add-ons walkthroughs

1. RED: the add-on pages sit under the flat `---[Blocks]Add-ons---` section; keybindings and
   large-data demos are not embedded in any page.
2. Move/retitle the 7 existing add-on pages + the W6 context-menu and keybindings pages into
   `examples/addons/` (matrix rows: fill, pinned-rows, presence, undo-redo, toolbar,
   context-menu, keybindings, url-state, import-export — existing or from W6; sort-list — new
   page created here). Each gets its `ComponentPreview` where missing
   (keybindings ← data-grid-keybindings-demo).
3. Root `meta.json`: remove the Add-ons separator + 10 pages (incl. context-menu + keybindings
   from W6);
   folder `examples` already lists `addons`. Delete the old files. Update `playground.mdx`
   cross-links + any in-repo links to the old URLs (`grep -rn "docs/fill-handle\|docs/pinned-rows\|docs/multiplayer-presence\|docs/undo-redo\|docs/sorting-filtering-search\|docs/import-export\|docs/url-state\|docs/context-menu\|docs/keybindings\|docs/lazy-loading\|docs/pagination" content app registry`).
4. Check `app/llms.txt/route.ts` for docs URL listings — update moved slugs.
5. GREEN: `pnpm build`; manual: no dead internal links (spot-check the moved slugs + llms.txt).
6. `Commit: docs: move the add-on walkthroughs into the Examples section` (commit body: URL
   change list, no redirects at this stage)

## Window 8 — Appearance & i18n

1. RED: styling/loading/i18n knowledge spread across `styling-theming.mdx`, `i18n.mdx`; no
   example pages.
2. Pages: `styling.mdx` (embed styling-patterns + conditional-styling demos; token/
   data-attribute contract section links the guide), `loading-states.mdx` (embed
   data-grid-loading-demo; skeleton/empty/indeterminate), `i18n-rtl.mdx` (embed
   data-grid-i18n-demo; RTL section; "Which i18n library" mapping per
   `research/docs-examples-libraries.md` §4 — next-intl / react-i18next pull typed `labels`).
3. Guide pages `styling-theming.mdx`, `i18n.mdx`: "See example" links.
4. GREEN: `pnpm build`; manual: RTL demo flips arrows; both styling demos render.
5. `Commit: docs: add the Appearance & i18n examples`

## Window 9 — Row drag & drop (after `feat/row-reorder` merge)

Dependency: `enableRowReorder`, `rowMarkers="reorder"`, `actions.reorderRows` are on the
`feat/row-reorder` branch (agent work in progress), not on main.

1. RED (gate): `git grep -l reorderRows origin/main -- registry/ | wc -l` → must be ≥ 1 to start.
   Otherwise: mark window BLOCKED and stop (do not build against the branch).
2. New demo `data-grid-row-reorder-demo`: `enableRowReorder` + `rowMarkers="reorder"`; drag a
   row with the grip (drop indicator), plus a toolbar "move selection down" button wired to
   `actions.reorderRows` to show the programmatic path; a panel showing the `move` op from
   `onDataChange` (one undo step) and the selection remap after the move. Registry item +
   import map + build/verify.
3. Page `examples/rows/drag-reorder.mdx` (embed demo; marker-drag vs programmatic; the no-op
   guards: readOnly, open edit, active sort/filter, lazy holes — link the guide section).
4. `row-operations.mdx` (guide): add the reorder section link once merged.
5. GREEN: `pnpm registry:verify`, `pnpm build`; manual: drag reorder works; selection follows
   the moved rows; undo restores.
6. `Commit: feat(registry): add the row reorder example`
7. `Commit: docs: add the row reorder example`

## Window 10 — Prose & structure audit (tabs + compression + dedup)

Runs after W2–W5 have added their "See example" links to the guide pages — the restructuring
preserves those links. Full per-page findings (metrics, tab maps, line-range compressions,
dedup map): `research/docs-prose-audit.md`.

Rules:
- **Anchor safety:** Fumadocs Tabs do not auto-expand on hash navigation. Only tab H2
  sections with no inbound deep links — verify per page with
  `grep -rn "docs/<page>#<anchor>" content app registry` before tabbing. `events-state`
  (numbered §1–§9 anchors) and `recipes` (recipe anchors) stay FLAT.
- **Canonical copy:** each repeated fact keeps exactly one full copy + one-line links from
  the rest (dedup map in the research file).
- **Compression cuts** engine internals, "why" digressions, and repetitions — never contracts
  (prop semantics, gotchas, guard conditions).

Per-page actions (verdicts from the fleet audit):

| Page | Verdict | Action |
|---|---|---|
| editing-cell-types | SPLIT+COMPRESS | 2 tabs (Basics / Validation & errors); compress pipeline + validateRow prose |
| custom-cell-types | SPLIT+COMPRESS | 3 tabs (Contract / Checklist→Accordion / Example); cut pipeline duplication |
| overlay-plugins | COMPRESS | strip engine internals from intro + ctx section |
| selection-keyboard | SPLIT | 2 tabs (Mouse / Keyboard); demote a11y H2 to a Callout |
| row-operations | KEEP | minor: reorder no-op conditions → warn Callout |
| streaming-updates | KEEP | minor: demo walkthrough into the reorder table |
| accessibility | SPLIT+COMPRESS | 3 tabs inside "What the grid implements"; trim test matrix + axe callout |
| clipboard | KEEP | minor: 2 compressions |
| columns | SPLIT+COMPRESS | 4 tabs (Basics / Pin & headers / Row markers / Layout & state); "not controlled" ×3 → 2 sentences |
| styling-theming | SPLIT+COMPRESS | 4 tabs (CSS / Programmatic / Density & loading / Reference); delete subsumed "Styling whole rows" |
| i18n | SPLIT+COMPRESS | 3 tabs; German example → representative groups (api-reference holds the full shape) |
| performance | KEEP | — (canonical home of the stable-identity rule) |
| virtualization | COMPRESS | merge 7 H2s → 3 groups (header soup); delete regression-suite paragraph |
| fill-handle | KEEP | minor: seam-internals sentence → 1 line |
| pinned-rows | SPLIT+COMPRESS | 3 tabs (Basics / Totals / Details); compress reporter bridge |
| multiplayer-presence | SPLIT+COMPRESS | 2 pages (receiving / broadcasting websocket sketch); compress re-render + rendering internals |
| undo-redo | KEEP | — |
| sorting-filtering-search | SPLIT+COMPRESS | 4 tabs (Sorting / Filtering / Search / Controlled); delete the mod+F restatement |
| import-export | KEEP | minor: 2 compressions |
| url-state | KEEP | — (keeps the short pagination snippet; pagination owns the detail) |
| lazy-loading | SPLIT+COMPRESS | 2nd page `lazy-loading-advanced.mdx` from the React Query section; 3 tabs in the core page |
| pagination | SPLIT+COMPRESS | 3 tabs (Modes / Footer / URL state); delete the "Lazy vs pagination" H2 (dedup) |
| events-state | COMPRESS | no tabs (sacred anchors); 6 compressions per the research file |
| api-reference | COMPRESS | 4 tabs for the 14 "Add-on option types" H3s only (no inbound anchors) |
| recipes | KEEP | minor: 3 compressions |
| project-status / license | KEEP | — |

1. Per page: apply the split (Tabs / second page), then the compressions, then the dedup
   links. Second pages get frontmatter + a link from the original page's hub context.
2. GREEN: `pnpm build`; manual: every deep link still resolves; each tabbed page shows ≤3
   top-level headers; spot-check compressed sections for lost contracts.
3. `Commit: docs: restructure feature and add-on pages into tabs and trim over-explained prose`

## Gates to run before merging

| Gate | Command | Expected |
|---|---|---|
| Typecheck | `pnpm types:check` | exit 0 (fumadocs-mdx typegen over the new tree) |
| Build | `pnpm build` | exit 0 |
| Unit + browser tests | `pnpm test` | exit 0 (demo components are covered by existing patterns if they carry logic) |
| Lint | `pnpm lint` | exit 0 |
| Registry (after W2/W3/W4/W5/W6/W9) | `pnpm registry:build && pnpm registry:verify` | exit 0; no EOL-only payload diffs committed |
| Manual (each window) | `pnpm dev` | sidebar collapses; every example page shows live preview + code tab; playground page intact |
