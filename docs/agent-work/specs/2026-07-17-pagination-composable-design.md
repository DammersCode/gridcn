# Composable pagination redesign (workplan #23)

## Decision

Replace the monolithic `DataGridPagination` footer with **composable parts**, shadcn-`Pagination`
style. This is an intentional **breaking change** to the `data-grid-pagination` add-on (user
approved). Consumers assemble the footer from parts; there is no all-in-one component anymore.

Next/Prev are **chevron-only** — page numbers come exclusively from the middle `Pages` part. (The
earlier "number on the next button" idea is dropped in favor of composition.)

## Parts (all in `pagination-footer.tsx`, exported via `data-grid-pagination.ts`)

A context carries the `DataGridPaginationControls` + merged labels so parts need no prop-drilling,
mirroring shadcn primitives that share state through a parent:

- `DataGridPaginationBar` — the parent. Props: `DataGridPaginationControls` + `className` +
  `labels?` + `children`. Renders the `border-t` footer flex row and provides the context. If
  `children` is omitted it renders the **default layout** (see below) so the common case is still
  one line — but the default is now built from the parts, not a separate monolith.
- `DataGridPaginationRange` — the "x–y of z" label (reads `range`/`rangeEmpty`).
- `DataGridPaginationPageSize` — the rows-per-page `Select`.
- `DataGridPaginationFirst` — jump to page 1 (`ChevronsLeft`), disabled on page 1.
- `DataGridPaginationPrev` — page − 1 (`ChevronLeft`), disabled on page 1.
- `DataGridPaginationPages` — the windowed numbered buttons (uses `pageWindow`; `windowSize` prop,
  default 5).
- `DataGridPaginationNext` — page + 1 (`ChevronRight`), disabled on last page.
- `DataGridPaginationLast` — jump to last page (`ChevronsRight`), disabled on last page.

Each part is a thin `Button` reading the shared context; each throws a clear error if rendered
outside `DataGridPaginationBar` (standard context-guard pattern).

### Default layout (when `<DataGridPaginationBar>` has no children)

```
[ Range ]              [ PageSize ]  [ First ][ Prev ][ Pages… ][ Next ][ Last ]
```

Same visual result as today's footer **plus** the new First/Last buttons — so a consumer who does
nothing gets the upgraded footer; a consumer who wants a custom arrangement passes children.

## Labels

`DataGridPaginationLabels` gains `firstPage` / `lastPage` (already added inline this session —
keep). Everything else unchanged. i18n docs page gets the two new keys.

## Migration (breaking)

Old: `<DataGridPagination {...pager.controls} />`
New: `<DataGridPaginationBar {...pager.controls} />` (identical one-liner, upgraded default) — or
compose parts as children. `DataGridPagination` export is **removed**; `DataGridPaginationProps`
renamed to `DataGridPaginationBarProps`. Update the demo, `pagination.mdx`, `api-reference.mdx`,
`lazy-loading.mdx`, and any snippet that referenced the old name. Add a short "Composition" section
to `pagination.mdx` showing a custom layout (e.g. First/Prev/Next/Last only, no numbers) so the new
capability is documented.

## Tests

Rewrite `pagination-footer.browser.test.tsx`:
- default `DataGridPaginationBar` (no children) renders range + all five nav controls + page-size,
  and paging works (port the existing 5 assertions to the new name).
- First/Last jump to ends and disable at their edge.
- a composed custom bar (children = just Prev + Next) renders only those and still pages.
- context guard: a part outside the bar throws.

## Scope / rules

- `registry/` add-on files only + the docs pages + demo. Payload rebuild after (`npx shadcn build`
  + `fix-registry-imports.mjs` + `verify-registry.mjs`, commit `public/r`).
- No new deps. shadcn tokens. Comments = non-obvious why only.
- Keep `useDataGridPagination`, `pagination-math.ts`, and the whole controls/labels data model
  exactly as-is — this is a presentation-layer refactor, not a state change.
