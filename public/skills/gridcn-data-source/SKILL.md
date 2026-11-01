---
name: gridcn-data-source
description: "gridcn data sources: pick plain data, server pages, scroll loading, or streaming, and wire it. Use when connecting a grid to a backend or to a dataset too large for one payload, or when sort, filter, or search must run on the server. Triggers: server-side filtering or sorting, `filterMode`, `sortMode`, `fetchFilterValues`, nested filter groups sent to an API, async gates with a server check."
metadata:
  gridcn-version: "1.3.0"
---

Pick exactly one loading strategy for the dataset, then make every sort/filter/search path see the full dataset, not just what happened to load.

Scope: where rows come from and where sort, filter, and search run. Wiring other add-ons → `gridcn-addons`.

## 1. Pick the strategy

Answer in order, stop at the first match:

1. The whole dataset fits in one payload? Pass plain `data` to `DataGridProvider`/`DataGrid`. No add-on.
2. The user needs bookmarkable, bounded pages (page 2 in the URL, a fixed page size)? Use `data-grid-pagination`.
3. Otherwise (one continuous dataset, too large to fetch up front, infinite-scroll feel): use `data-grid-server` in scroll mode (`useDataGridServerRows({ mode: "scroll" })`).

Live value ticks (prices, statuses) are a separate question: streaming (`updateCells`/`updateRows`) layers on top of whichever base the tree picked. It never replaces it.

Record which strategy was picked and why (one sentence) before writing code — this is the completion record step 5 checks for.

**Do not combine scroll loading and pagination.** Both the lazy-loading and pagination docs state they are not supported together. If both a continuous-scroll feel and bookmarkable pages seem needed, pagination is the one to keep — it's the one that gives pages.

## 2. Wire the chosen strategy

- Plain data: pass `data`/`onDataChange` as usual. No further steps here.
- `data-grid-server`: for a paged server grid, `useDataGridServerRows({ getRowId, fetchRows: ({ spec, page, pageSize, start, end, signal }) => ... })` (resolve `{ rows, totalRowCount }` or `{ rows, hasMore }`) owns the spec, page, and page size unless you control them (`spec`/`onSpecChange`, `page`/`onPageChange`, `pageSize`/`onPageSizeChange`; a `useDataGridUrlPagination()` result spreads in); put your `onDataChange` and `getRowId` in its options; spread `server.gridProps` onto `DataGrid` and `server.pager` onto `DataGridPaginationBar`. It aborts stale requests, goes to page 1 on a spec change, keeps the last rows on error, and returns `status`, `loading`, `error`, `retry()`, `refresh()`. It does not set `headerClickBehavior`; pass `"sort"` yourself. `DataGridRoot` shows the error state (`error`, `onRetry`, `errorState`). For a counted result that scrolls, pass `mode: "scroll"`: `fetchRows({ spec, start, end, signal })` resolves `{ rows, totalRowCount }`, the first request is block 0 (`[0, blockSize)`), the hook fetches `blockSize` blocks (default 50) around the rendered rows, spread `server.gridProps` (it carries `onRenderedRowsChange`, the error bar, and Retry), and it also returns `unloadedCount`, `getLoadedRanges()`, `evict(range)`; `retry()` repeats failed blocks only and `refresh()` refetches the rendered blocks in place. The grid warns in development when a client sort or filter changes over unloaded rows.
- Scroll mode with a next cursor and no row count (keyset, "has more"): `useDataGridServerRows({ mode: "scroll", getRowId, fetchRows: ({ cursor, start, end, signal }) => ... })` resolves `{ rows, nextCursor }` (or `{ rows, hasMore }` without a cursor); `nextCursor: null` ends the source, and a spec change restarts it by itself. Install per https://gridcn.vercel.app/docs/lazy-loading.md.
- `data-grid-pagination`: install per https://gridcn.vercel.app/docs/pagination.md. Decide client mode (`const { pageData, pager } = useDataGridPagination({ data, defaultPageSize })`, hook slices) vs. server mode (`{ page, pageSize, totalRowCount, onPageChange }` fully controlled, you fetch; pass `totalRowCount: null` with `hasNextPage` when the server sends no count).
- Streaming on top of either: wire `useDataGridActions().updateCells`/`updateRows` per https://gridcn.vercel.app/docs/streaming-updates.md. Skip this step if nothing needs live value pushes.

Completion for this step: the grid renders and the chosen hook's `gridProps`/`pager` are spread onto the provider/root exactly as the relevant doc's usage example shows.

## 3. Put sort/filter/search on the server if the grid scrolls or pages

A scroll or paged grid's uncontrolled sort/filter/search only ever sees the rows currently loaded (the sparse array's loaded ranges, or the current page slice) — never a warning, never an error, just a wrong-looking result over part of the dataset. `searchText` is worse: it never narrows rows at all, only highlights matches already in `data`, on any grid.

Decide per gesture, for the chosen strategy:

- **Full dataset must be searchable/sortable/filterable** → move that gesture server-side: hold the spec in your own state, send it to your fetch call, set `sortMode="server"` plus `onSortChange` and `filterMode="server"` plus `onFilterChange`, in scroll and paged server mode alike, and set `headerClickBehavior="sort"` so header clicks reach `onSortChange`. Full wiring, including the exact controlled-prop rules and reset-on-spec-change requirement, is in `references/server-mode.md` — read it before writing this code.
- **Page-local or range-local result is acceptable and disclosed to the user** → leave it uncontrolled, but say so in the completion record (step 5) rather than leaving it undecided.

`useDataGridServerRows` sets both server modes and owns the spec, so its grids take this path by default. A hand-wired grid with a sparse `data` array gets a one-time development warning from the core when a client sort or filter changes over unloaded rows; it does not block the gesture or fix production behavior.

## 4. Handle the gotchas for the chosen strategy

Applies to scroll mode:

- `useDataGridServerRows` sends `spec` to `fetchRows` and starts the blocks over when its content changes; the hook owns it unless you pass `spec` and `onSpecChange`. `retry()` repeats the failed blocks; `onError(error)` has no range. `refresh()` refetches the rendered blocks in place.
- `DataGridUrlState` (from `data-grid-url-state`) mounts on a scroll grid through a controlled `spec`/`onSpecChange` pair, or with both `sortMode="server"` and `filterMode="server"`. Fetch the rows for the restored spec.
- Every answer carries `totalRowCount` for a counted source; a changed count starts the blocks over.
- With `sortMode="server"` the header indicator, `aria-sort`, and `DataGridSortList` track the spec and the grid never reorders `data`; a controlled-empty `sortState` is the old workaround and blanks them.

Applies to `data-grid-pagination`:

- A sort, filter, or search change must call `onPageChange(1)` yourself (client or server mode) — the pager does not do this for you, uncontrolled or via `useDataGridUrlPagination`.
- Server mode: guard against stale responses (a slower page-2 fetch resolving after a faster page-3 one must not overwrite page-3's rows) and expect the hook to call your `onPageChange` once with the clamped page when a shrunk `totalRowCount` leaves `page` out of range (it never sets your state itself).
- Checked rows, the cell range, and the active cell follow row ids only while the rows stay in `data`; a page change drops those whose rows leave. Key the provider by page or clear the selection in `onPageChange` to clear everything.
- Merge a page's edited slice back into the full dataset by row id in `onDataChange` — replacing the whole dataset with just the page's slice silently drops every other row.
- `useDataGridUrlPagination` only composes with pagination's server mode; client mode's `defaultPageSize` seeds once from local state and can't take a pushed URL value.

Applies to streaming on top of either:

- A pagination grid silently drops `updateCells`/`updateRows` patches addressed to rows not on the current page (client or server mode) — no error, no verdict entry for it beyond the batch simply not touching that row. Either apply the feed to the full dataset/fetched page before it reaches `data`, or accept that only on-page rows update live.
- A scroll grid instead reports a `hole` skip reason in the batch verdict (`actions.updateCells(...)` return value) for a patch addressed to an unloaded row — check the verdict if silent loss there matters.

## 5. Done when

- The picked strategy (plus streaming, if used) is written down with its one-sentence reason, and scroll loading and pagination are not both mounted on the same grid.
- Every sort/filter/search path either runs server-side against the full dataset (spec sent to the fetch, `sortMode="server"` and `filterMode="server"` per `references/server-mode.md`) or is a deliberate, disclosed page/range-local result — never an accidental partial one.
- Pagination's stale-response race, `onPageChange(1)` on filter/search change, and row-id-based edit merge are all handled if pagination is in play; the hook's spec handling covers scroll loading.

## Reference

- `references/server-mode.md` — server-mode wiring for scroll loading and pagination, side by side, and how to send a filter tree to an API.
- Full docs: `https://gridcn.vercel.app/docs/lazy-loading.md`, `/docs/lazy-loading-advanced.md`, `/docs/pagination.md`, `/docs/streaming-updates.md`, `/docs/events-state.md`.

## Do not

- Do not mount scroll mode and `data-grid-pagination` on one grid.
- Do not sort a scroll grid on the client. `useDataGridServerRows` sets `sortMode="server"` and sends the spec to `fetchRows`.
- Do not guess the row count when the server has none. Use `useDataGridServerRows({ mode: "scroll" })` with `nextCursor` or `hasMore`, or `hasNextPage` (pagination). Return the count as `totalRowCount` from `fetchRows`; do not hard-code it.
- Do not build your own spinner for block fetches. `server.rootProps` carries `loading`, `error`, and `onRetry` for `DataGridRoot`.
- Do not rely on the quick-search box to search server-side. It only highlights rows already in `data`. Send `searchText` to your fetch.

## Selection over a server result

- A grid whose `data` is a page or a loaded window needs `totalRowCount={total}` (or `null` when unknown) plus `keepCheckedRows`. Checks then survive page changes, evictions, and server sort or filter changes, by row id.
- "Select all N matching": `actions.selectAllMatching()`. Read the selection with `useDataGridSelectedRows()`: `{ mode: "ids", ids }` or `{ mode: "allMatching", excludedIds, count }`. Send it with the request spec (sort, filter, search) to your own endpoint.
- While `allMatching` is on, Delete rows, Duplicate row, and Move rows skip the checked rows. The grid does not hold them.

## Saving and refusals

- Send changes to the server from `onSave(change)`, not from `onDataChange`. `onDataChange` keeps your state in step and returns nothing; the revert of a refusal reaches it with `source: "rollback"` exactly once.
- Return a promise from `onSave`: resolve with nothing to accept, with `{ rejected: [{ rowId, columnId?, message?, current? }] }` to refuse rows or cells (`current` is the row as the server holds it now), or reject to refuse the whole change. The grid marks rows `saving` (`data-save-status`), reverts only the refused entries, and calls `onSaveRejected({ change, rejected })` for the toast.
- `onSave` never receives `source: "rollback"` or `source: "stream"`. Undo and redo (`"history"`) reach it.

## Selection UI and text inputs

- Ctrl+A is a range action and never checks rows; the header checkbox reads the checked rows only. With `totalRowCount`, `DataGridStatusBar` shows the banner "Select all N matching" once every row of the page is checked; do not build your own button.
- `inputDebounceMs` on the provider (default 200, `0` = each keystroke) sets the wait of the toolbar search, filter value inputs, set-filter search, and find & replace. For your own debounced text input use `useDebouncedInput` from the `use-debounce` item (commits on blur, Enter, and unmount; waits for an IME composition).
- To wait for typing to pause in `useDataGridServerRows`, wait inside `fetchRows`: `await delay(300, signal)`.
