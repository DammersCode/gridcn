---
name: gridcn-data-source
description: "gridcn data sources: pick plain data, pagination, lazy loading, or streaming, and wire it. Use when connecting a grid to a backend or to a dataset too large for one payload, or when sort, filter, or search must run on the server."
---

Pick exactly one loading strategy for the dataset, then make every sort/filter/search path see the full dataset, not just what happened to load.

## 1. Pick the strategy

Answer in order, stop at the first match:

1. The whole dataset fits in one payload? Pass plain `data` to `DataGridProvider`/`DataGrid`. No add-on.
2. The user needs bookmarkable, bounded pages (page 2 in the URL, a fixed page size)? Use `data-grid-pagination`.
3. Otherwise (one continuous dataset, too large to fetch up front, infinite-scroll feel): use `data-grid-lazy`.

Live value ticks (prices, statuses) are a separate question: streaming (`updateCells`/`updateRows`) layers on top of whichever base the tree picked. It never replaces it.

Record which strategy was picked and why (one sentence) before writing code — this is the completion record step 5 checks for.

**Do not combine lazy loading and pagination.** Both the lazy-loading and pagination docs state they are not supported together. If both a continuous-scroll feel and bookmarkable pages seem needed, pagination is the one to keep — it's the one that gives pages.

## 2. Wire the chosen strategy

- Plain data: pass `data`/`onDataChange` as usual. No further steps here.
- `data-grid-lazy`: install per https://gridcn.vercel.app/docs/lazy-loading.md, wire `useDataGridLazyRows` + `DataGridLazyGuard` + `onRowWindowChange`.
- `data-grid-pagination`: install per https://gridcn.vercel.app/docs/pagination.md. Decide client mode (`useDataGridPagination({ data, pageSize })`, hook slices) vs. server mode (`{ page, pageSize, total, onPageChange }` fully controlled, you fetch).
- Streaming on top of either: wire `useDataGridActions().updateCells`/`updateRows` per https://gridcn.vercel.app/docs/streaming-updates.md. Skip this step if nothing needs live value pushes.

Completion for this step: the grid renders and the chosen hook's `gridProps`/`controls` are spread onto the provider/root exactly as the relevant doc's usage example shows.

## 3. Put sort/filter/search on the server if the grid is lazy or paged

A lazy or paged grid's uncontrolled sort/filter/search only ever sees the rows currently loaded (the sparse array's loaded ranges, or the current page slice) — never a warning, never an error, just a wrong-looking result over part of the dataset. `searchText` is worse: it never narrows rows at all, only highlights matches already in `data`, on any grid.

Decide per gesture, for the chosen strategy:

- **Full dataset must be searchable/sortable/filterable** → move that gesture server-side: hold the spec in your own state, send it to your fetch call, and pass the grid's `sortState`/`filterState` as controlled (lazy) or leave sort/filter to your own UI (paged server mode). Full wiring, including the exact controlled-prop rules and reset-on-spec-change requirement, is in `references/server-mode.md` — read it before writing this code.
- **Page/window-local result is acceptable and disclosed to the user** → leave it uncontrolled, but say so in the completion record (step 5) rather than leaving it undecided.

For `data-grid-lazy` specifically, mount `<DataGridLazyGuard hasHoles={lazy.unloadedCount > 0} />` inside `<DataGridProvider>` regardless of which path is chosen. It only dev-warns (`[data-grid-lazy] sort/filter/search changed while rows are still unloaded...`) when an uncontrolled gesture fires over holes — it does not block the gesture or fix production behavior, so step 3's server-side decision still has to be made by hand for the paths that need full coverage.

## 4. Handle the gotchas for the chosen strategy

Applies to `data-grid-lazy`:

- A sort/filter spec change must call `lazy.reset()` before the refetch runs, or already-fetched windows keep serving the old order/set.
- `DataGridUrlState` (from `data-grid-url-state`) cannot mount on a lazy grid — it writes URL sort/filter/search into the store on mount, which re-sorts the partial `data` client-side. Keep that spec in your own state instead.
- With `sortState` controlled empty, the header's sort indicator and `aria-sort` go blank and `DataGridSortList` shows nothing active — render the active sort from your own state, and re-derive the asc/desc/none cycle yourself since `toggleSort` reads the (empty) store state.

Applies to `data-grid-pagination`:

- A filter or search change that can shrink the result set must call `onPageChange(1)` yourself (client or server mode) — the pager does not do this for you, uncontrolled or via `useDataGridUrlPagination`.
- Server mode: guard against stale responses (a slower page-2 fetch resolving after a faster page-3 one must not overwrite page-3's rows) and pass `reconcilePage: true` if a shrunk `total` should clamp `page` back for you (it fires your `onPageChange` once; it never sets your state itself).
- Selection survives a page change by index, not by row identity — it will point at different rows on the new page unless you key the provider by page or clear the selection in `onPageChange`.
- Merge a page's edited slice back into the full dataset by row id in `onDataChange` — replacing the whole dataset with just the page's slice silently drops every other row.
- `useDataGridUrlPagination` only composes with pagination's server mode; client mode's `pageSize` seeds once from local state and can't take a pushed URL value.

Applies to streaming on top of either:

- A pagination grid silently drops `updateCells`/`updateRows` patches addressed to rows not on the current page (client or server mode) — no error, no verdict entry for it beyond the batch simply not touching that row. Either apply the feed to the full dataset/fetched page before it reaches `data`, or accept that only on-page rows update live.
- A lazy grid instead reports a `hole` skip reason in the batch verdict (`actions.updateCells(...)` return value) for a patch addressed to an unloaded row — check the verdict if silent loss there matters.

## 5. Done when

- The picked strategy (plus streaming, if used) is written down with its one-sentence reason, and lazy+pagination are not both mounted on the same grid.
- Every sort/filter/search path either runs server-side against the full dataset (spec held outside the store, grid's `sortState`/`filterState` controlled per `references/server-mode.md`) or is a deliberate, disclosed page/window-local result — never an accidental partial one.
- `DataGridLazyGuard` is mounted on every `data-grid-lazy` grid.
- Pagination's stale-response race, `onPageChange(1)` on filter/search change, and id-keyed edit merge are all handled if pagination is in play; `lazy.reset()` on spec change is handled if lazy loading is in play.

## Reference

- `references/server-mode.md` — server-mode wiring for lazy loading and pagination, side by side.
- Full docs: `https://gridcn.vercel.app/docs/lazy-loading.md`, `/docs/lazy-loading-advanced.md`, `/docs/pagination.md`, `/docs/streaming-updates.md`, `/docs/events-state.md`.
