# Server-side review: DX of the new server API and remaining server gaps (2026-10)

Date: 2026-10-30. Scope: the lazy-paging-gaps branch. This file changes no source.

Baseline: `research/gap-analysis-2026-10.md` (gap-analysis branch) and
`research/server-connection-audit.md`. The baseline gaps J, D, F, K, E, I, H, J2, A, M, G and L-U
are not repeated. Where this review sharpens one, it says so. The branch builds J, D, F (pages and
infinite rows), K (write acknowledgement), the filter half of A, and server filtering (#94).

Mode codes: **L** local array, **PC** client pagination, **PS** server pagination, **Z** lazy rows
(including infinite rows), **C** controlled sort, filter and search state, **SS**
`sortMode="server"`, **FS** `filterMode="server"`, **API** own API (write-through through
`onDataChange`).

Paths are relative to the worktree root. `blocks/` means `registry/default/blocks/`, `examples/`
means `registry/default/examples/`, `docs/` means `content/docs/`.

## 1. DX findings (Part A)

### 1.1 How big is a typical server grid

The flagship demo `examples/data-grid-server-side-demo.tsx` needs about 75 lines of wiring for a
paged server grid with sort, filter and search: a `RemoteStateBridge` component (`:51-83`) that
exists only because the spec hooks work inside the provider while `data` sits outside it, page and
page-size state, a pager, the provider with 7 server props, and the write-through
(`:94-157`). The lazy server-filter demo (`examples/data-grid-server-filter-demo.tsx:21-38`) needs
a hand-written race counter, a separate probe request for the new total, a state pair and a manual
`lazy.reset()`. The keyset pager (`examples/data-grid-open-ended-demo.tsx:81-111`) keeps its own
page-to-cursor map, loading flag and abort controller.

A plain server grid needs these props today: `data`, `getRowId`, `sortMode`, `filterMode`,
`headerClickBehavior`, `onSortChange`, `onFilterChange`, `onSearchTextChange` (or the bridge),
`totalRowCount`, `keepCheckedRows`, `loading`, `onDataChange`, and for lazy rows also
`onRenderedRowsChange`. That is 11 to 13 props plus a pager hook plus fetch state. It exceeds the
25-line target by a factor of three. Proposal: see Draft S1 in section 3 (one server-rows hook that
returns `gridProps` and `pager`), which brings the common case to about 15 lines.

### 1.2 Must-fix

| # | Finding | Evidence | Proposal |
|---|---|---|---|
| MF1 | The rollback of a refused write is sent to the consumer's `onDataChange` with `source: "rollback"`. The docs sample sends every change to the server, so it writes the reverted (old) value back to a server that just refused the new one. With another user's newer value on the server, this overwrites it. The demo does the same. | `blocks/data-grid/store/data-write.ts:127,418`; `docs/recipes/data-fetching/server-round-trip.mdx:137-140,157`; `examples/data-grid-write-ack-demo.tsx:51` | The sample and the demo start with `if (change.source === "rollback") return;`. The docs state the rule in one line under Strategy C. Better: pass the rollback to the store and to plugin observers only, and to the consumer only when `data` is controlled; then the sample needs no guard. Decide in the K spec. |
| MF2 | Two hooks in one add-on use the name `fetchRows` with different contracts. Lazy: positional `fetchRows(start, end, signal)` returning `TData[]`, `batchSize`, `onError(error, range)`. Infinite: `fetchRows({ cursor, start, limit, signal })` returning `{ rows, nextCursor }`, `pageSize`, `onError(error)`. A reader who learns one writes the other wrong. The positional form breaks the ctx-object rule of AGENTS.md. | `blocks/data-grid-lazy/use-data-grid-lazy-rows.ts:25,30,39`; `blocks/data-grid-lazy/use-data-grid-infinite-rows.ts:12-19,35,41` | One ctx shape for both: `fetchRows({ start, end, signal, spec })`, plus `cursor` for infinite. One size name (`pageSize`). One `onError({ error, range })`. Breaking for lazy; ship it in the same release as infinite rows. |
| MF3 | The server docs contradict the selection feature. The server hub says that a page change or refetch drops a checked row, but `totalRowCount` keeps it. The lazy page says select-all "never means every matching row" and in the next paragraph says `totalRowCount` selects every matching row. The callout under it still teaches placeholder ids. | `docs/recipes/data-fetching/server-side.mdx:87-88`; `docs/lazy-loading.mdx:414-428`; `docs/selection-keyboard.mdx:171-203` | Rewrite both places to one story: without `totalRowCount`, checks are per window; with it, checks are by row id and "all matching" exists. Keep the placeholder-id callout only for the case without `totalRowCount`. |
| MF4 | The server hub does not teach the new server features. `docs/recipes/data-fetching/server-side.mdx` never names `totalRowCount`, `selectAllMatching`, `useDataGridSelectedRows`, `useDataGridInfiniteRows`, `hasNextPage` or the write acknowledgement. A reader who starts at the hub builds a grid without them. | `docs/recipes/data-fetching/server-side.mdx:16-25,68-106` | Add three short sections to the hub: "Row count and unknown totals", "Selection and bulk actions", "Saving and refusals". Each has one sample and a link to the reference page. Add `totalRowCount` to "The contract" step 4. |

### 1.3 Should-fix

| # | Finding | Evidence | Proposal |
|---|---|---|---|
| SF1 | The row count goes in twice. The pager gets `total`, and the provider gets `totalRowCount={pager.controls.total ?? null}`. The lazy hook gets `total` and its `gridProps` leave out `totalRowCount`. The infinite hook returns `total` outside `gridProps`. | `docs/pagination.mdx:177`; `docs/selection-keyboard.mdx:168`; `blocks/data-grid-lazy/use-data-grid-lazy-rows.ts:58`; `blocks/data-grid-lazy/use-data-grid-infinite-rows.ts:49-57` | Each server hook returns `totalRowCount` in its `gridProps` (`null` for an open-ended infinite source). The server pager returns a `gridProps` object too. |
| SF2 | Cross-window selection needs two props: `selectAllMatching()` is a dev-warning no-op without `keepCheckedRows`. `keepCheckedRows` also changes what row operations act on, which is a separate concern. | `blocks/data-grid/store/types.ts:163,178,907` | `totalRowCount` alone turns on the id-based memory and "all matching". Keep `keepCheckedRows` for the cell-click behavior only. |
| SF3 | One count, three names: `total` (pager, lazy, infinite result), `totalRowCount` (provider), `count` (selected rows). "More rows exist" has two names: `hasNextPage` (pager) and `hasMore` (infinite). | `blocks/data-grid-pagination/use-data-grid-pagination.ts:19-21`; `blocks/data-grid-lazy/use-data-grid-infinite-rows.ts:57-59` | Pick `totalRowCount` and `hasNextPage` for every server surface and add both to `GLOSSARY.md`. The infinite result gets `hasNextPage`. |
| SF4 | The pager picks client or server mode from the presence of a `data` key, while sort and filter use an explicit `"client" \| "server"` value. `pageSize` is a one-time seed in client mode and a controlled value in server mode: the same name with two meanings, which breaks the `value`/`defaultValue` rule. | `blocks/data-grid-pagination/use-data-grid-pagination.ts:27-36,42-45,65-69` | Client mode takes `defaultPageSize`. Optionally a `mode: "server"` field, so the type error names the mode. |
| SF5 | A spec change does not reset the server page. With `filterMode="server"` and server pagination, a filter change on page 9 keeps page 9. `reconcilePage` (default `false`) clamps only when `total` shrinks below the page. | `blocks/data-grid-pagination/use-data-grid-pagination.ts:48-53`; `docs/recipes/data-fetching/server-side.mdx:77` (the docs tell the reader to do it) | The server-rows hook (Draft S1) resets to page 1 on every spec change. Without it, the docs show the reset in the sample. |
| SF6 | No error state and no retry in any server hook. Lazy and infinite rows expose `onError` only. A failed infinite fetch stops the chain until the window moves. The keyset demo swallows errors with `() => {}`, so on a real error its "Fetching…" text never clears. The root has `loading` and `emptyState`, but no error state. | `blocks/data-grid-lazy/use-data-grid-infinite-rows.ts:31,41`; `blocks/data-grid-lazy/use-data-grid-lazy-rows.ts:39`; `examples/data-grid-open-ended-demo.tsx:91-98`; `blocks/data-grid/root.tsx:107-114` | Each hook returns `error` and `retry()`. The root takes `error` and `errorState` (like `emptyState`). Fix the demo. Sharpens baseline N (now verified: there is no error presentation). |
| SF7 | Under `filterMode="server"`, an empty server response with an active filter shows the `"no-data"` empty state, because the reason comes from `data.length`. `announceResults` announces the page or loaded count, not the result size. The status bar never reads `totalRowCount`, so it shows "25 rows" for a result of 10,000, and in `allMatching` mode it counts loaded checks only. | `blocks/data-grid/root.tsx:648`; `blocks/data-grid/store/types.ts:180-184`; `docs/selection-keyboard.mdx:203` ("the status bar and the live region count the loaded checked rows") | The empty-state reason is `"filtered"` when a filter or search is active and the mode is `"server"`. Announcements and the status bar use `totalRowCount` and `useDataGridSelectedRows().count` when set. Sharpens baseline L. |
| SF8 | `fetchFilterValues` values are labels only (`{ label, count }`). The value is matched by its lower-cased label, so a code column (a status code shown as a name, a foreign key) cannot filter by value, and two values that differ only in case merge. | `blocks/data-grid/types.ts:644`; `blocks/data-grid-toolbar/server-filter-values.ts:32-34` | `FilterValue = { value: string; label?: string; count?: number }`. The spec carries `value`. The dedupe key is `value`, case-sensitive. |
| SF9 | Async gates have no `AbortSignal` and no pending state. The hub says "show a busy state while a gate is pending", but the grid exposes no gate-pending state. Escape or unmount cannot cancel the request. | `docs/recipes/data-fetching/server-side.mdx:103-104`; `blocks/data-grid/store/hooks.ts:684` (only `useDataGridPendingWriteCount`) | Gates receive `{ signal }` as a trailing ctx (`createRow(index, { signal })`). The root carries `aria-busy` and `data-gate-pending` while a gate runs; a hook reads it. |
| SF10 | Write status is visual only, and only with consumer CSS. A `saving` row has no `aria-busy`, a refusal makes no live-region announcement, and the grid ships no default look for `data-write-status`. | `blocks/data-grid/row.tsx:101-102`; `examples/data-grid-write-ack-demo.tsx:54` | `aria-busy` on saving rows, a `labels.grid.writeRejected` announcement, and a default token-based style (muted while saving, destructive tint when failed). |
| SF11 | The `allMatching` selection value has no spec. A bulk action must read filters and search from other hooks at the same moment. If they come from another render, the request applies to the wrong set. | `blocks/data-grid/store/selected-rows.ts:12-19`; `docs/selection-keyboard.mdx:189-195` | Add `filters`, `searchText` and `sorts` to the `allMatching` shape, read from the same store snapshot. In `ids` mode, document that a remembered id can fall outside the current filter. |

### 1.4 Nice

| # | Finding | Evidence | Proposal |
|---|---|---|---|
| N1 | `sortMode="server"` still needs `headerClickBehavior="sort"`, or a header click selects the column and the sort never reaches the server. | `docs/recipes/data-fetching/server-side.mdx:24-25` | Make `"sort"` the default when `sortMode="server"`, or a dev warning when `onSortChange` is set and the behavior is `"select"`. |
| N2 | The infinite demo computes the loaded count as `data.length - unloadedCount`. | `examples/data-grid-open-ended-demo.tsx:67` | Return `loadedCount`. |
| N3 | `readSelectedRows` in `allMatching` mode walks the whole view and builds two sets on every selection change, and `rows.toArray()` builds a full array. At 100k lazy rows this runs on each check. | `blocks/data-grid/store/selected-rows.ts:28,37-45` | Keep the exclusion set incremental in the store and read it in O(changes). |
| N4 | `fetchFilterValues` is one function for the whole grid. A column cannot opt out without `choices`, and a column with its own endpoint must switch on `columnId`. | `blocks/data-grid/store/types.ts:192-197` | Per-column `options.fetchFilterValues` that wins over the root one. |
| N5 | The server-filter demo calls `lazy.reset()` after a `total` change, which already resets the hook. | `examples/data-grid-server-filter-demo.tsx:36-37`; `docs/recipes/data-fetching/server-side.mdx:82-83` | Remove the call, or make the server-rows hook own the reset. |
| N6 | `onDataChange` gets no signal, so a superseded acknowledged write cannot cancel its request. | `blocks/data-grid/store/types.ts:108` | Pass `{ signal }` in `change`, aborted when a newer write supersedes every op of the change. |

## 2. New server-side gaps (Part B), ranked

Method: the public documentation of five widely used data grids (two community, three
commercial) lists these server capabilities: a server row model with block loading, lazy group and
tree loading, server grouping, aggregation and pivot, row transactions and push updates with an
optional reshape after the push, a data-source interface with a request cache and a cache time
limit, background revalidation by interval, keep-previous-rows during a refetch, error callbacks
for fetch and update, request throttling, a cap on concurrent requests and on cached blocks,
retry of failed loads, loading overlays, a row-count estimate for unknown totals, and a selection
state of "all except these ids". The names below are our own requirements.

### 2.1 Capability check

S = supported, D = documented, T = tested, M = demo.

| Capability | gridcn | Evidence |
|---|---|---|
| Paged server rows | SDTM | `blocks/data-grid-pagination/`, `docs/pagination.mdx` |
| Lazy block loading | SDTM | `blocks/data-grid-lazy/use-data-grid-lazy-rows.ts` |
| Infinite / cursor rows, unknown total | SDTM | `use-data-grid-infinite-rows.ts`, `data-grid-open-ended-demo` |
| Pages without a total | SDTM | `use-data-grid-pagination.ts:54-57` |
| Lazy group and tree children | no | baseline G |
| Server grouping and aggregation | no | baseline G, H |
| Server pivot | no | new, P2 below |
| Transactions by id (add, update, remove) | SDT | `commitChange`, `deleteRowsById`, `updateCells` verdict |
| Push merge into a server-sorted or server-filtered view (reshape) | no | new, S5 |
| Push batching window | no | new, part of S5 |
| Optimistic write with per-op refusal and rollback | SDTM | `blocks/data-grid/store/write-ack.ts`, `data-grid-write-ack-demo` |
| Conflict on write (version check, server row wins) | no | new, S4 |
| Request dedupe of in-flight ranges | SDT | `use-data-grid-lazy-rows.ts:141-142` |
| Cancel requests for windows that scrolled away | no | new, S2 (abort only on reset and unmount: `use-data-grid-lazy-rows.ts:153,177`) |
| Load debounce during a fast scroll, concurrency cap | no | new, S2 |
| Bounded block cache with automatic eviction | no | new, S2 (`evict` is manual: `use-data-grid-lazy-rows.ts:80-87`) |
| Request cache with time limit across spec revisits | D | recipe with a query library only (`docs/lazy-loading-advanced.mdx:10`) |
| Keep rows visible during a refetch (refresh in place) | no for lazy | new, S3 (`reset()` drops every row to skeletons) |
| Background revalidation by interval | no | new, S3 |
| Prefetch of the next page | no | new, P2 |
| Retry of failed loads and an error state | partial | lazy retries on window move; no `retry()`, no error state (SF6) |
| Loading overlay, skeleton rows | SDM | `root.tsx:108-114`, skeleton rows |
| Server export | no | baseline I |
| Server quick search | n/a | decided: search highlights only; the spec goes to the server |
| Server-provided set filter values | SDTM | `fetchFilterValues`, `data-grid-server-filter-demo` |
| Filter values with a value distinct from the label | no | SF8 |
| Custom filter vocabulary | no | baseline Q |
| Column and view state saved on a server | recipe | baseline T |
| Row count display over a server result | partial | pager yes; status bar and announcements no (SF7) |
| Selection "all except these ids" over server data | SDTM | `selected-rows.ts`, `data-grid-server-selection-demo` |
| One data-source contract for the whole server grid | no | new, S1 |

### 2.2 Ranked gaps

| Id | Gap | P | Size | Modes | Reason |
|---|---|---|---|---|---|
| S1 | One server data source: a hook that owns the spec, paging or windows, totals, reset, abort, loading and error, and returns `gridProps` and `pager` | P0 | M | PS, Z, C, SS, FS, API | the typical server grid is 75 lines and five demos each re-implement races and resets (1.1) |
| S0 | Rollback echo reaches the consumer's save path (MF1) | P0 | S | API, all server modes | a refused write writes the old value back to the server |
| S2 | Lazy fetch hygiene: debounce during a fast scroll, abort fetches for windows that left the view, concurrency cap, bounded block cache with automatic eviction | P1 | M | Z | a scrollbar drag over 100k rows starts a fetch per passed window and keeps them all; memory grows without bound |
| S3 | Refresh in place: refetch loaded ranges or the page while the old rows stay visible, optional interval revalidation | P1 | S | PS, Z | after a write or a push, `reset()` blanks the view to skeletons |
| S4 | Write conflicts: a refusal that carries the server's current row, applied instead of the old value | P1 | S | API | reverting to the old value is wrong when another user changed the row |
| S6 | Error state and retry across server hooks and the root (SF6, sharpens N) | P1 | S | PS, Z | a failed fetch has no visible state and no retry path |
| S7 | Server counts in empty state, announcements and status bar (SF7, sharpens L) | P1 | S | PS, Z, FS | wrong empty text and wrong counts on server data |
| S8 | Filter value distinct from label, per-column value source (SF8, N4) | P1 | S | FS, PS, Z | code and foreign-key columns cannot use server set filters |
| S5 | Push updates into a server-ordered view: mark rows that may no longer match, optional reshape refetch, batching window | P2 | M | SS, FS, Z, PS | a pushed change under server sort or filter stays in place with no signal |
| S9 | Gate cancellation and gate pending state (SF9) | P2 | S | API, all | a gate cannot be cancelled and has no busy signal |
| S10 | Prefetch the next server page | P2 | S | PS | page changes always wait for the round-trip |
| S11 | Server pivot | P2 | L | PS, Z | depends on G (grouping) first; keep as a follow-up |

## 3. Draft issues (P0 and P1)

### Draft S1: One server data source for the grid

**Problem.** A server grid wires 11 to 13 provider props, a pager, its own fetch state, a race
guard and a reset rule. The flagship demo needs a bridge component because the spec lives in the
store and `data` lives outside the provider. Every demo re-implements stale-response handling.

**Proposal.** `useDataGridServerRows<TData>(options)`:

```ts
const server = useDataGridServerRows<Order>({
  getRowId: (row) => row.id,
  fetchRows: ({ spec, page, range, cursor, signal }) => api.orders({ ...spec, page, range, cursor, signal }),
  paging: "pages", // or "scroll"
});

<DataGridProvider {...server.gridProps} columns={columns}>
  <DataGridRoot><DataGridHeader /><DataGridBody /></DataGridRoot>
  <DataGridPaginationBar {...server.pager} />
</DataGridProvider>
```

`fetchRows` resolves `{ rows, totalRowCount?, nextCursor? }`. `gridProps` holds `data`, `getRowId`,
`sortMode: "server"`, `filterMode: "server"`, the controlled sort, filter and search pairs,
`totalRowCount`, `loading`, `error`, `onRenderedRowsChange` and `onDataChange`. The hook owns the
spec, so it works outside the provider and no bridge is needed. A spec change aborts the request,
goes to page 1 or resets the windows, and keeps the old rows visible until the response arrives.
The result also has `retry()`, `refresh()`, `status` and `error`. The lazy and infinite hooks stay
as the lower layer.

**Client and server.** PS, Z (window and cursor), C (the hook is the controlled owner), SS and FS
(always `"server"`), API (`onDataChange` composes with an optional `save` that returns a
`WriteAck`, and skips rollbacks). L and PC: not used; the docs keep the local path.

**Constraints.** Request shape: `{ spec: { sorts, filters, search }, page, pageSize }` or
`{ spec, range }` or `{ spec, cursor, limit }`, plus `signal`. The spec is untrusted on the server;
the docs repeat the bound check. Response rows are bounded by the requested size (warn on a longer
response, as lazy does). Read the store again after each await. One options object; `getRowId` and
`fetchRows` are the only required fields. New term in `GLOSSARY.md` before the code.

### Draft S0: Keep a rollback out of the consumer's save path

**Problem.** A refused acknowledged write is reverted through `onDataChange` with
`source: "rollback"`. The documented sample and the demo send every change to the server, so the
revert writes the old value to the server.

**Proposal.** Decide one of two contracts in the K spec: (a) the docs and demo guard with
`change.source === "rollback"`, or (b) an acknowledged grid with uncontrolled `data` delivers the
rollback to the store and plugins only; controlled `data` still gets it, and the sample guard is
shown for that case. Prefer (b).

**Client and server.** API in every mode. L: unchanged when `onDataChange` returns no promise.

**Constraints.** History and lazy merge must still see the rollback. Changelog entry. Test: an
acknowledged refusal never calls the save function a second time.

### Draft S2: Lazy fetch hygiene

**Problem.** Lazy fetches abort only on reset and unmount. A fast scrollbar drag starts one fetch
per window it passes, all of them land, and the loaded rows are never released unless the consumer
calls `evict`.

**Proposal.** Options on `useDataGridLazyRows`: `loadDelay` (ms the window must rest before a
fetch, default about 100), abort for in-flight fetches whose range has left the window plus
overscan, `maxConcurrentFetches` (default 2), and `maxLoadedRows` with least-recently-viewed
eviction outside the window.

**Client and server.** Z only. Infinite rows take the debounce and the concurrency cap; eviction
stays out because a cursor chain cannot refetch a range.

**Constraints.** An evicted row with a pending acknowledged write or an open edit is never evicted.
Checked rows survive eviction through `totalRowCount`. Timers and controllers are cleaned up on
reset and unmount. Unit tests with fake timers.

### Draft S3: Refresh in place

**Problem.** After a write, a push or an external change, the only lazy path is `reset()`, which
turns every row into a skeleton. A paged grid refetches with no way to keep the rows on screen
unless the consumer brings a query library.

**Proposal.** `refresh()` on the lazy and server-rows hooks refetches the loaded ranges (or the
page) and swaps each range when its response lands. `revalidateInterval` (ms, default off) calls
it on a timer while the document is visible.

**Client and server.** Z, PS. L: not used.

**Constraints.** A refreshed range never overwrites a cell with a pending acknowledged write or an
open edit. Abort on reset. A changed `totalRowCount` after a refresh falls back to `reset()`.

### Draft S4: Write conflicts

**Problem.** A refusal reverts to the value from before the edit. When the server refused because
another user changed the row, the reverted value is stale too.

**Proposal.** `WriteRejection` takes an optional `row` (the server's current row). With it, the
grid applies the server row instead of the old value, as one `rollback` change, and
`onWriteRejected` reports `reason: "conflict"`.

**Client and server.** API in every mode. The server sends the current row with a 409 or 412.

**Constraints.** The row passes the same id check as `commitChange`: a different `getRowId` result
is dropped with a dev warning. Bounded by `MAX_WRITE_REJECTIONS`.

### Draft S6: Error state and retry for server data

**Problem.** Lazy and infinite rows report errors through `onError` only. The root has no error
presentation. A failed infinite fetch waits for the next window move.

**Proposal.** Hooks return `error` and `retry()`. The root takes `error?: unknown` and
`errorState?: ReactNode | ((ctx: { error, retry }) => ReactNode)`: a full-body state with zero
rows, a slim bar under the header with rows present (the same rule as `loading`).

**Client and server.** PS, Z. L: unused.

**Constraints.** The error text renders as a text node. The live region announces the failure once
per error. Semantic tokens only.

### Draft S7: Server counts in empty state, announcements and the status bar

**Problem.** With server filtering, an empty response shows the "no data" state. The live region
and the status bar count the rows the grid holds and the loaded checks only.

**Proposal.** The empty-state reason is `"filtered"` when the mode is `"server"` and a filter or
search is active. With `totalRowCount`, announcements say "N rows" from it (or "at least N" when
it is `null`), and the status bar shows the result size and `useDataGridSelectedRows().count`.

**Client and server.** FS, SS, PS, Z. L and PC: unchanged.

**Constraints.** Pinned locale formatting for server and client render. Labels in `labels`.

### Draft S8: Filter values with a value and a label

**Problem.** `fetchFilterValues` returns labels only and matches them in lower case. A code column
cannot filter by code, and values that differ in case merge.

**Proposal.** `FilterValue = { value: string; label?: string; count?: number }`. The set filter
stores `value`, shows `label`, and dedupes on `value`. A column option `fetchFilterValues` wins
over the root one.

**Client and server.** FS, PS, Z. L: the loaded-rows list fills `value` from the cell value.

**Constraints.** Bounds as today (1,000 entries, 1,000 characters). URL state validates against
the known values (links to baseline N2). Breaking for `FilterValue`; changelog entry.

## 4. Where gridcn is already ahead

- Write acknowledgement per cell: a refusal reverts only the refused cells, and only while the cell
  still holds the refused value, so a newer edit survives. History drops the reverted entry. The
  grids reviewed report an update error but revert the whole row or nothing.
- "All matching except these ids" is bounded (100,000 ids) and leaves the mode instead of dropping
  an exclusion, so it never selects more rows than the user chose. It ends on every filter or
  search change, so a stale selection cannot reach a bulk action.
- Row operations over unloaded rows are no-ops with a dev warning, so a delete never misses rows
  the server holds.
- Server set-filter values are aborted per search, sanitized as untrusted input and bounded; the
  column's own filter is left out of the request.
- One promise contract for every gate (`T | Promise<T>`), with a pending gate blocking a second
  gesture and every result dropped after a `readOnly`, row or spec change.
- `sortMode` and `filterMode` are separate, so a backend that sorts but does not filter (or the
  reverse) connects without a workaround.
- Pages without a total and a cursor chain both ship, with a demo for each.
- `updateCells` returns a verdict per cell (applied, skipped, pending), which push sources can act
  on.
