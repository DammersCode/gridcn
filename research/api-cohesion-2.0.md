# API cohesion for 2.0.0: the server and data surface

Status: decided, not implemented. Scope: every public name a consumer touches to feed rows from a
server, track a request, select over a result, and save a change. 2.0.0 is a major, so each
decision below breaks freely when the result is one shape instead of three.

Modes (`research/parity-matrix.json`): L local, PC client pages, PS server pages, Z lazy rows
(window and cursor), C controlled state, SS server sort, FS server filter, API write-through.

## 1. Findings

Paths are relative to `registry/default/blocks/`.

### 1.1 Vocabulary

| Concept | Spellings today | Evidence |
|---|---|---|
| Size of the result | `total: number` (lazy option), `total: number \| undefined` (infinite result, pager controls), `total?: number` (server answer, URL pagination), `totalRowCount: number \| null` (provider, all `gridProps`), `count: number \| undefined` (selected rows), `total: number \| null` vs `count: number \| undefined` (labels) | `data-grid-lazy/use-data-grid-lazy-rows.ts:27`, `data-grid-lazy/use-data-grid-infinite-rows.ts:59,64,250`, `data-grid-server/use-data-grid-server-rows.ts:25`, `data-grid-pagination/use-data-grid-pagination.ts:19`, `data-grid-url-state/use-data-grid-url-pagination.ts:18`, `data-grid/store/types.ts:193`, `data-grid/store/selected-rows.ts:17-18`, `data-grid/labels.ts:299,301` |
| More rows exist | `hasNextPage` (server answer, pager, infinite result), `nextCursor !== null` (infinite answer) | `use-data-grid-server-rows.ts:27`, `use-data-grid-infinite-rows.ts:29,66` |
| Rows per request | `pageSize` = page shown (pagination, server), `pageSize` = fetch rounding unit (lazy), `pageSize` = rows per fetch and skeleton count (infinite), `limit` (infinite ctx), `maxFetchRows` (lazy and infinite), `batchSize` (range math) | `use-data-grid-lazy-rows.ts:43,50`, `use-data-grid-infinite-rows.ts:19,40,44`, `use-data-grid-lazy-rows.ts:287` |
| Quick search text | `searchText` (provider), `search` (`ServerSpec`), `search` = value-list query (`fetchFilterValues`) | `data-grid/store/types.ts:291`, `data-grid-lazy/server-spec.ts:7`, `data-grid/types.ts:653` |
| View row count | `useDataGridRowCount()` returns `viewIndex.length`, not the row count of the glossary | `data-grid/store/hooks.ts:429` |
| Busy flag | `isLoading` (lazy, infinite), `loading` (server rows, root) | `use-data-grid-lazy-rows.ts:86`, `use-data-grid-infinite-rows.ts:69`, `use-data-grid-server-rows.ts:82` |
| Save | `onSave`, `WriteAck`, `WriteRejection`, `onWriteRejected`, `RowWriteStatus`, `useDataGridRowWriteStatus`, `useDataGridPendingWriteCount`, `clearWriteStatus` | `data-grid/store/types.ts:116,121,927`, `data-grid/store/write-ack.ts:4,19,22,29`, `data-grid/store/hooks.ts:684,689` |

### 1.2 Fetch contract

| Hook | Request | Answer | Spec | Abort |
|---|---|---|---|---|
| `useDataGridLazyRows` | `{ start, end, signal, spec }` | `TData[]` (exact length) | `spec` option, reset in render | reset and unmount only |
| `useDataGridInfiniteRows` | `{ cursor, start, limit, signal, spec }` | `{ rows, nextCursor }` | `spec` option, reset in layout effect | reset and unmount |
| `useDataGridServerRows` | `{ spec, page, pageSize, signal }` | `{ rows, total?, hasNextPage? }` | owned by the hook, `defaultSpec` only | newer request and unmount |

Evidence: `use-data-grid-lazy-rows.ts:15-23,36`, `use-data-grid-infinite-rows.ts:13-30`,
`use-data-grid-server-rows.ts:10-28`. Three answer shapes for one job.

### 1.3 Error, retry, refresh

- Lazy and infinite have no `error` and no `status`; a failed window stays a skeleton with no
  message, no Retry button, and no announcement (`use-data-grid-lazy-rows.ts:266-271`). Only
  `onError` reports it. The root error state (`data-grid/root.tsx:136-140`) is unreachable for them.
- `retry` means "re-request the last window, failed or not" in lazy and infinite
  (`use-data-grid-lazy-rows.ts:298-301`) and "repeat the failed request, else no-op" in server rows
  (`use-data-grid-server-rows.ts:144-146`).
- `reset` (lazy, infinite) drops rows; `refresh` (server rows) keeps them. No hook has both.
- Server rows `retry` and `refresh` are new closures each render (`:144-147`), lazy ones are stable.

### 1.4 Save path

- Order is `onDataChange`, then `onSave`, then plugin observers (`data-grid/store/data-write.ts:112-152`);
  a refusal reverts through `onDataChange` with `source: "rollback"`, then calls `onWriteRejected`
  (`data-write.ts:486-507`). The order is sound and stays.
- `onWriteRejected` gets no error object: a rejected promise is flattened to `message` per row
  (`write-ack.ts:38-40`), so the consumer cannot read a status code or a typed error.
- The name mixes "write" and "save" for one concept (glossary rows "write acknowledgement",
  "write status", "save").

### 1.5 Defaults

- `keepCheckedRows` silently becomes `true` when `totalRowCount` is set
  (`data-grid/store/compute.ts:874`); the JSDoc admits it (`store/types.ts:167-172`). Setting a
  count changes click semantics. AGENTS.md: booleans default `false`.
- `sortMode` and `filterMode` default `"client"`. Server rows sets both
  (`use-data-grid-server-rows.ts:164-165`); lazy and infinite `gridProps` set neither, so a lazy
  grid sorts holes on the client unless the consumer remembers both props and mounts
  `DataGridLazyGuard`.
- Server rows forces `headerClickBehavior: "sort"` (`:166`), a UX choice inside a data hook.
- Pagination `reconcilePage` defaults `false` (`use-data-grid-pagination.ts:53`); every server
  caller wants `true` (server rows passes it, `:149`).

### 1.6 Other trip points

1. Lazy and infinite return `onDataChange` beside `gridProps` (`use-data-grid-lazy-rows.ts:82`,
   `use-data-grid-infinite-rows.ts:62`); server rows puts it inside. A forgotten `onDataChange`
   drops every edit.
2. Server rows has no controlled `page`, `pageSize`, or `spec`, so `useDataGridUrlPagination` cannot
   drive it, and a URL-restored spec arrives through `onSortChange` after the first fetch has
   started (`use-data-grid-server-rows.ts:99-103,116-119`).
3. Server rows rebuilds every provider callback each render (`:160-183`); the provider syncs config
   on each identity change.
4. Lazy resets during render: `reset()` aborts controllers and sets state from the render body
   (`use-data-grid-lazy-rows.ts:179-188`). A discarded concurrent render aborts live fetches.
5. Lazy never validates `total`: `Array(-1)` or `Array(NaN)` throws (`:153,174`), and a hostile
   count sizes the sparse array without a bound.
6. Infinite trusts `nextCursor`: a server that answers the same cursor again appends the same rows
   forever with duplicate row ids (`use-data-grid-infinite-rows.ts:147-156`).
7. `DataGridLazyGuard` warns once per app, not per grid (`data-grid-lazy/lazy-guard.tsx:17`), and
   warns on a search change (`:41`) although quick search never filters.
8. Pagination client mode takes `pageSize` as a one-time seed (`use-data-grid-pagination.ts:29,155`)
   while server mode takes it controlled; the result names the pager `controls`, server rows names
   it `pager`. Its dev warning is per app (`:95`).
9. A bulk action over "all matching" needs the spec, and the docs tell the reader to send "the spec
   you already hold" (`content/docs/recipes/data-fetching/server-side.mdx:120-123`). The value
   should carry it.
10. `ServerSpec` lives in `data-grid-lazy`, so `data-grid-server` depends on the lazy item for a
    core type (`use-data-grid-server-rows.ts:6`); `EMPTY_SPEC` duplicates `EMPTY_SERVER_SPEC` (`:89`).

## 2. Decisions

### D1. One vocabulary

| Concept | 2.0 name | Type |
|---|---|---|
| Size of the result | `totalRowCount` | `number \| null` (`null` = unknown), in every option, answer, result, pager, label, and `DataGridSelectedRows.count` |
| More rows after this block | `hasMore` in an answer; `hasNextPage` only on the pager controls (a page concept) | `boolean` |
| Keyset position | `cursor` in a request, `nextCursor` in an answer (`null` ends the source) | `TCursor` |
| Rows per page shown | `pageSize` (pages mode, pagination) | `number` |
| Rows per scroll request | `blockSize` (aligns and caps a request; replaces lazy `pageSize`, infinite `pageSize`, `limit`, `maxFetchRows`) | `number`, default 50 |
| Row range | `RowRange = { start, end }`, end exclusive, in core | replaces `Range` |
| Spec | `ServerSpec = { sorts, filters, searchText }` in core | `search` renamed |
| Value-list query | `fetchFilterValues({ columnId, query, filters, signal })` | `search` renamed |
| Callbacks | `onX` fires after the fact: `onLoaded`, `onError`, `onSaveRejected`; a prop handler stays `onRetry` | |

`useDataGridRowCount` leaves the barrel (D7); it named the view count with the glossary word.

Migration: `**Breaking:** one name for the size of a result: \`total\` is \`totalRowCount\` (\`number | null\`, \`null\` for unknown) in \`useDataGridPagination\`, \`DataGridPaginationControls\`, \`useDataGridUrlPagination\`, and every \`fetchRows\` answer; \`DataGridSelectedRows.count\` and \`labels.statusBar.allSelected\` take \`null\` instead of \`undefined\`. \`ServerSpec.search\` is \`searchText\`, the \`fetchFilterValues\` context field \`search\` is \`query\`, and the \`Range\` type is \`RowRange\` from \`data-grid\`.`

Files: `GLOSSARY.md` (row count, block, request, answer), `data-grid/types.ts`, `data-grid/labels.ts`,
`data-grid/store/selected-rows.ts`, `data-grid-pagination/*`, `data-grid-url-state/use-data-grid-url-pagination.ts`,
`data-grid-toolbar` (value-list caller), demos, docs, skills (`skills/gridcn-data-source/**`).

Risk: wide rename; the type checker finds every site. `null` vs `undefined` in labels breaks a
custom label silently at runtime (`count === undefined` never true): the migration line names it.

### D2. One fetch contract

```ts
/** What `fetchRows` receives in every mode. */
export type ServerRowsRequest<TCursor = never> = {
  spec: ServerSpec;
  /** Index of the first requested row in the result. */
  start: number;
  /** One past the last requested row; `end - start` is the limit. */
  end: number;
  /** Sequential scroll only: the `nextCursor` of the block before; `undefined` for the first block. */
  cursor: TCursor | undefined;
  /** Aborted when a newer request replaces this one, on a spec change, and on unmount. */
  signal: AbortSignal;
};
/** Pages mode adds the page address; `start` is `(page - 1) * pageSize`. */
export type ServerRowsPageRequest = ServerRowsRequest & { page: number; pageSize: number };

export type ServerRowsAnswer<TData, TCursor = never> = {
  /** At most `end - start` rows, in order from `start`; extra rows are dropped with a dev warning. */
  rows: TData[];
  /** Row count of the result. Omitted keeps the last known count; `null` declares it unknown. */
  totalRowCount?: number | null;
  /** Rows exist after this block. Default: `rows.length === end - start`. Ignored with a count. */
  hasMore?: boolean;
  /** Cursor sources: passed back as `cursor`. `null` ends the source. */
  nextCursor?: TCursor | null;
};
```

Every mode validates the answer the same way (one `readAnswer` helper): `rows` must be an array;
`totalRowCount` must be a safe non-negative integer, else `null` with a dev warning; a count above
`MAX_ROW_COUNT` (10,000,000) clamps with a dev warning; `rows` clamp to `end - start`.

Migration: `**Breaking:** \`fetchRows\` takes \`{ spec, start, end, cursor, signal }\` (plus \`page\` and \`pageSize\` in pages mode) and resolves \`{ rows, totalRowCount?, hasMore?, nextCursor? }\` in every mode. Rename \`total\` to \`totalRowCount\` and \`hasNextPage\` to \`hasMore\` in your answer; compute a limit as \`end - start\`.`

Files: `data-grid-server/use-data-grid-server-rows.ts`, new `data-grid-server/read-answer.ts`
(+ test), demos `data-grid-server-side-demo`, `data-grid-server-filter-demo`, docs.

Risk: a consumer answer typed loosely (`any`) passes the type check with `total`; the dev warning
"answer has `total`, expected `totalRowCount`" fires once per hook instance during 2.0.x.

### D3. One request-state shape

```ts
export type DataSourceState = {
  status: "loading" | "error" | "ready"; // error wins over loading
  loading: boolean;          // any request of the current spec in flight
  error: unknown;            // the latest unresolved failure of the current spec, else null
  retry: () => void;         // repeats the failed requests only; no-op without an error; stable
  refresh: () => void;       // refetches what is in view and keeps it on screen until the answer lands; stable
};
```

Options on every data hook: `onError?: (error: unknown) => void`, `onLoaded?: (range: RowRange) => void`.
`rootProps = { loading, error, onRetry: retry }` rides in `gridProps`, so a lazy grid gets the
error bar and the Retry button with no wiring (an a11y fix: the bar is `role="alert"`).
`reset()` leaves the public API: a spec change and a count change reset by themselves; scroll-mode
`refresh()` evicts every block outside the rendered rows and refetches the rendered ones in place.

Migration: `**Breaking:** the data hooks return \`status\`, \`loading\`, \`error\`, \`retry\`, and \`refresh\`. \`isLoading\` is \`loading\`; \`reset()\` is removed, call \`refresh()\`. \`retry()\` repeats failed requests only.`

Files: `data-grid-server/use-data-grid-server-rows.ts`, the scroll engine (D6), lazy docs and demos.

Risk: in-place refresh in scroll mode can overwrite a row with a pending save or an open edit.
Rule: a refreshed block skips rows with write status `"saving"` and the row under an edit session
(read the store after the await). Tested in step 7.

### D4. Save naming and order

```ts
onSave?: (change: DataChange<TData>) => void | Promise<SaveAck<TData>>;
onSaveRejected?: (ctx: { change: DataChange<TData>; rejected: readonly SaveRejection<TData>[]; error: unknown }) => void;
// error: the rejection reason of the onSave promise, or null when it resolved `{ rejected }`.
type SaveAck<TData> = void | { rejected?: readonly SaveRejection<TData>[] };
type RowSaveStatus = "saving" | "failed";
useDataGridRowSaveStatus(rowId); useDataGridPendingSaveCount(); actions.clearSaveStatus();
```

Order stays and becomes part of the `onSave` JSDoc: `onDataChange` → `onSave` → plugin observers;
on a refusal: revert through `onDataChange` (`source: "rollback"`, `reverts`) → write status →
`onSaveRejected`. `onSave` never sees `"rollback"` or `"stream"`. `DataChange.reverts` keeps its name.

Migration: `**Breaking:** one word for saving: \`onWriteRejected\` is \`onSaveRejected\` and its context adds \`error\`; \`WriteAck\`, \`WriteRejection\`, \`RowWriteStatus\`, \`useDataGridRowWriteStatus\`, \`useDataGridPendingWriteCount\`, and \`clearWriteStatus\` are \`SaveAck\`, \`SaveRejection\`, \`RowSaveStatus\`, \`useDataGridRowSaveStatus\`, \`useDataGridPendingSaveCount\`, and \`clearSaveStatus\`.`

Files: `data-grid/store/write-ack.ts`, `data-write.ts`, `types.ts`, `hooks.ts`, `provider.tsx:114-115`,
`data-grid/data-grid.ts` barrel, `GLOSSARY.md` ("save acknowledgement", "save status"),
`research/write-ack-spec.md`, docs (`server-round-trip.mdx`, `server-side.mdx`, `tanstack-query.mdx`).

Risk: none in behavior. `error` holds a consumer value; it is passed, never rendered.

### D5. Mode defaults

- `sortMode` and `filterMode` stay two props, default `"client"` (server sort over local rows with
  client filter is a real case). Every data hook's `providerProps` sets both to `"server"`.
- `keepCheckedRows` defaults `false` with no coupling: `compute.ts:874` reads
  `props.keepCheckedRows ?? false`. The data hooks set `keepCheckedRows: true` in `providerProps`.
  `selectAllMatching()` keeps its dev warning when either piece is missing.
- The data hooks drop `headerClickBehavior`; the consumer sets it.

Migration: `**Breaking:** \`keepCheckedRows\` no longer turns on when \`totalRowCount\` is set; pass \`keepCheckedRows\` yourself, or use \`useDataGridServerRows\`, whose \`gridProps\` set it. The hook no longer sets \`headerClickBehavior: "sort"\`; pass it to keep sorting on a header click.`

Files: `data-grid/store/compute.ts:874`, `store/types.ts:166-172`, server hook, server demos
(`headerClickBehavior="sort"` added), `content/docs/selection-keyboard.mdx`.

Risk: a hand-rolled server grid with `totalRowCount` and no `keepCheckedRows` loses checks across
pages after the upgrade. The dev warning of `selectAllMatching` and the migration line cover it.

### D6. Scroll mode in `useDataGridServerRows`; the lazy hooks go

```ts
const server = useDataGridServerRows<Order>({
  getRowId: (row) => row.id,
  fetchRows: ({ spec, start, end, signal }) => api.orders({ ...spec, offset: start, limit: end - start, signal }),
  mode: "scroll", // default "pages"
});
<DataGrid {...server.gridProps} columns={columns} />
```

Options (one object; `getRowId` and `fetchRows` required):

```ts
type UseDataGridServerRowsOptions<TData, TCursor = never> = {
  getRowId: (row: TData, index: number) => string;
  fetchRows: (req: ServerRowsPageRequest | ServerRowsRequest<TCursor>) => Promise<ServerRowsAnswer<TData, TCursor>>;
  mode?: "pages" | "scroll";
  spec?: ServerSpec; defaultSpec?: Partial<ServerSpec>; onSpecChange?: (next: ServerSpec) => void;
  // pages mode
  page?: number; defaultPage?: number; onPageChange?: (page: number) => void;
  pageSize?: number; defaultPageSize?: number; onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: readonly number[];
  // scroll mode
  blockSize?: number; // default 50
  overscan?: number;  // default 30
  // every mode
  onDataChange?: (next: readonly TData[], change: DataChange<TData>) => void; // after the hook merged
  onError?: (error: unknown) => void;
  onLoaded?: (range: RowRange) => void;
};
```

Overloads type `fetchRows`'s request and `pager` by `mode`. The controlled pairs let
`useDataGridServerRows({ ...useDataGridUrlPagination(), fetchRows, getRowId })` work as written.

Scroll mode picks its fetch order from the answers, one rule per row of this table:

| Answer carries | Behavior | Replaces |
|---|---|---|
| `totalRowCount` (a number), no `nextCursor` | random access: `data` is sparse with `totalRowCount` slots; rendered rows plus `overscan` round out to `blockSize` blocks; each gap fetches block by block | `useDataGridLazyRows` |
| `nextCursor` (with or without a count) | sequential: loaded rows plus one block of skeletons; the next block starts when the rendered rows come within `overscan` of the end; a count, when sent, feeds `totalRowCount` only | `useDataGridInfiniteRows` (cursor) |
| neither | sequential by offset while `hasMore` | `useDataGridInfiniteRows` (offset) |

The first request is always block 0. A changed count resets the blocks, like a `total` change today.
A `nextCursor` equal (`Object.is`) to the cursor just sent ends the chain with a dev warning (bounds
finding 6). A sequential source stops at `MAX_ROW_COUNT` loaded rows with a dev warning.

Return:

```ts
type UseDataGridServerRowsResult<TData> = DataSourceState & {
  gridProps: ServerRowsProviderProps<TData> & ServerRowsRootProps;
  providerProps: ServerRowsProviderProps<TData>; // data, getRowId (hole-safe), onDataChange,
  // onRenderedRowsChange (scroll), sortMode/filterMode "server", keepCheckedRows: true,
  // sortState/onSortChange, filterState/onFilterChange, searchText/onSearchTextChange, totalRowCount
  rootProps: ServerRowsRootProps;                // loading, error, onRetry
  spec: ServerSpec;
  totalRowCount: number | null;
  pager: DataGridPaginationControls;             // pages mode only (overload)
  unloadedCount: number;                         // scroll mode: skeleton slots
  getLoadedRanges: () => readonly RowRange[];    // scroll mode, stable
  evict: (range: RowRange) => void;              // scroll mode, stable
};
```

Every callback in `providerProps` is stable; the object identity changes only with its values.
The spec and count resets run in one layout effect, never in render (finding 4).

`useDataGridLazyRows` and `useDataGridInfiniteRows` are removed, not wrapped. Reasons: a wrapper
keeps two contracts alive and two doc pages in sync; the controlled `spec` pair covers a consumer
that owns its spec (TanStack Query, SWR) because `fetchRows` can call `queryClient.fetchQuery`
exactly as the demos do; aligned blocks give stable query keys (`[spec, start]`). The
`data-grid-lazy` registry item is deleted. `ServerSpec`, `serverSpecKey`, and `RowRange` move to
`data-grid`. `DataGridLazyGuard` becomes a core dev warning, once per grid: a client sort or filter
change while `data` holds holes. A search change no longer warns.

Migration:
`**Breaking:** \`useDataGridLazyRows\` and \`useDataGridInfiniteRows\` and the \`data-grid-lazy\` item are removed. Use \`useDataGridServerRows({ mode: "scroll", getRowId, fetchRows })\` and spread \`gridProps\`; answer \`{ rows, totalRowCount }\` for a counted source or \`{ rows, nextCursor }\` for a cursor source. Pass your spec as \`spec\` and \`onSpecChange\` if you keep it outside the hook. \`DataGridLazyGuard\` is removed; the grid warns in development by itself. Import \`ServerSpec\` and \`serverSpecKey\` from \`data-grid\`.`

Files: `data-grid-server/*` (new `scroll-blocks.ts`, `scroll-sequence.ts`, ported tests from
`data-grid-lazy/*.test.ts*` and `range-math.ts`), `data-grid/` (spec, range, hole warning),
`registry.json` (delete item, `data-grid-server` deps), `components/registry-examples.tsx`, five
lazy demos and the playground, docs `lazy-loading.mdx`, `lazy-loading-advanced.mdx`,
`examples/data/lazy/*`, `recipes/data-fetching/*`, `api-reference.mdx`, `events-state.mdx`,
`addons/undo-redo.mdx`, redirects for removed URLs, skills, parity rows `lazy-fetch`,
`unknown-total`, `server-rows`, `error-state`, `loading` (their evidence paths name deleted files;
`node scripts/verify-parity.mjs --write` fails until they move).

Risks:
- Perf at 100k: the sparse write copies `rows` once per landed block (`use-data-grid-lazy-rows.ts:257-263`
  today). Keep it, batch blocks that land in one frame into one `setRows`. A perf test pins 100k rows
  with a fast thumb drag: one commit per frame at most.
- A block boundary splits a server page the consumer cached by its own size: document `blockSize`.
- Races: every answer checks `signal.aborted` and the current spec key before it writes; tests
  cover spec change mid-flight, count change mid-flight, unmount mid-flight, StrictMode double mount.
- The drafts S2 (load delay, concurrency cap, eviction) and S3 (refresh in place) land on this
  one engine instead of two.

### D7. Barrel exports that go

Rule (AGENTS.md "Registry exports"): docs never call it and no other item needs it from the barrel.
Measured with a scratch script over `content/docs`; cross-item users import the module file.

| Item | Remove | Note |
|---|---|---|
| `data-grid-lazy` | the whole item | D6 |
| `data-grid-pagination` | `pageCount`, `clampPage`, `pageRange`, `pageWindow`, `DEFAULT_PAGE_SIZES` | `data-grid-url-state` and `data-grid-server` import `pagination-math.ts` directly; the URL demo inlines the sizes |
| `data-grid` | `useDataGridRowCount`, `useDataGridHasActiveCell`, `useDataGridIsSearchMatch`, `useDataGridIsRowSelected`, `useDataGridIsRowChannelSelected`, `useDataGridIsRowCellSelected`, `useDataGridAllRowsSelected`, `useDataGridHeaderClickBehavior`, `useDataGridRowMarkers`, `useDataGridSelectionConfig`, `deepMergeLabels`, `measureTextWidths` | no use outside the core except `useDataGridSelectionConfig` in `data-grid-context-menu/menu-items.tsx` (deep import) |
| `data-grid-server` | none; add `ServerRowsRequest`, `ServerRowsPageRequest`, `ServerRowsAnswer`, `DataSourceState` (renames of the context and page types) | |

Kept although undocumented: `useDataGridRowCellState`, `useDataGridCellEditingError`,
`useDataGridRowId` (the changelog teaches them for a custom body); they get a docs row instead.

Migration: `**Breaking:** removed from the barrels: \`pageCount\`, \`clampPage\`, \`pageRange\`, \`pageWindow\`, and \`DEFAULT_PAGE_SIZES\` from \`data-grid-pagination\`; \`useDataGridRowCount\`, \`useDataGridHasActiveCell\`, \`useDataGridIsSearchMatch\`, \`useDataGridIsRowSelected\`, \`useDataGridIsRowChannelSelected\`, \`useDataGridIsRowCellSelected\`, \`useDataGridAllRowsSelected\`, \`useDataGridHeaderClickBehavior\`, \`useDataGridRowMarkers\`, \`useDataGridSelectionConfig\`, \`deepMergeLabels\`, and \`measureTextWidths\` from \`data-grid\`. Read the same values with \`useDataGridSelector\`.`

Risk: an installed consumer copy of an add-on that deep-imports one of them breaks on the next
`shadcn add`; `pnpm test:e2e-install` catches it in the repo.

### D8. The rest

1. `useDataGridPagination` client mode: `defaultPageSize` (seed) plus an optional controlled
   `pageSize`/`onPageSizeChange` pair, `defaultPage` plus `page`/`onPageChange`. Server mode:
   `{ page, pageSize, totalRowCount, hasNextPage?, onPageChange, onPageSizeChange? }`;
   `hasNextPage` is read only when `totalRowCount` is `null`. `reconcilePage` is removed and always
   on. The result is `{ pageData, pager }`. Dev warnings once per instance.
2. `DataGridSelectedRows` in `"allMatching"` mode adds `spec: ServerSpec`, the spec the grid held
   when the value was read (all matching ends on a filter or search change already,
   `create-store.ts:1087`). The bulk action sends `selected.spec` and `selected.excludedIds`.
3. `ServerRowsProviderProps.onDataChange` takes `(next, change)`; the consumer's own handler goes
   into the `onDataChange` option, never over the spread (a spread override drops the merge).
4. `getRowId` passes through the hook only; the hook's `gridProps.getRowId` is hole-safe. A dev
   warning fires once when the provider's `getRowId` differs from the hook's while holes exist.

Migration: `**Breaking:** \`useDataGridPagination\` returns \`pager\` instead of \`controls\`; client mode takes \`defaultPageSize\` for the first size; \`reconcilePage\` is removed and a page out of range always calls \`onPageChange\` once with the clamped page. \`DataGridSelectedRows\` in \`"allMatching"\` mode carries \`spec\`.`

Files: `data-grid-pagination/use-data-grid-pagination.ts`, `pagination-footer.tsx:61`,
`data-grid/store/selected-rows.ts`, `hooks.ts:661-676`, docs `pagination.mdx`, `selection-keyboard.mdx`.

Risk: always-on reconcile fires `onPageChange` for a consumer that relied on the clamped display
only; it fires once per (page, clamped) pair and never while the count is 0, as today.

## 3. Steps

Each step is one commit: tests first (red), then code, then docs, `CHANGELOG.md` `## Unreleased`
entry, `<NewBadge />` on changed sections, parity row and `node scripts/verify-parity.mjs --write`,
skills grep, all gates. "Client" and "server" name the path each test covers.

1. **Core spec types and vocabulary (D1 part).** Move `ServerSpec`, `serverSpecKey`, `RowRange`
   into `data-grid`; rename `search` to `searchText`; `fetchFilterValues` `search` to `query`;
   glossary rows. Lazy and server import from core. Tests: `serverSpecKey` ignores `filterId`
   (move test); value-list request carries `query` (client: loaded-row list unaffected; server:
   `fetchFilterValues` mock). Type test: `ServerSpec` from `data-grid`.
2. **`keepCheckedRows` default and `null` counts (D5, D1 labels, D8.2).** Tests: a client grid
   with `totalRowCount` and no `keepCheckedRows` clears checks on a cell click; with
   `keepCheckedRows` keeps them across a page change (server pages) and a lazy window change;
   `allSelected(null)` text; `useDataGridSelectedRows()` "allMatching" carries the current spec and
   `count: null` for an unknown size.
3. **Save naming (D4).** Rename, add `error` to the context. Tests: a rejected `onSave` promise
   passes its reason as `error`; a `{ rejected }` answer passes `error: null`; order
   `onDataChange` → `onSave` → observer → (rollback) `onDataChange` → `onSaveRejected` (spy order);
   `readOnly` grid: no revert, warning once. Client (local `data`) and server (`onSave` mock) paths.
4. **Pagination vocabulary (D1, D8.1, D7 pagination).** `totalRowCount`, `pager`,
   `defaultPageSize`, reconcile always on, URL pagination `totalRowCount`, barrel cleanup.
   Tests: client slice with `defaultPageSize`; server reconcile fires once on a shrinking count and
   never at 0; `totalRowCount: null` shows "Page N"; URL clamp with a count.
5. **Server rows: one contract, controlled pairs, stable callbacks (D2, D3, D5, D8.3-4).** Request
   `{ spec, start, end, cursor, signal, page, pageSize }`, answer via `readAnswer`; `spec`,
   `page`, `pageSize` pairs; `onError`, `onLoaded`, `onDataChange` options; `keepCheckedRows: true`;
   drop `headerClickBehavior`; stable `retry`/`refresh`. Tests: provider callback identity stable
   across renders; a URL-restored spec issues one request (`DataGridUrlState` +
   `useDataGridUrlPagination` spread); hostile answers (`totalRowCount: -1`, `NaN`, `1e12`, 10k
   rows for a page of 25, non-array rows) clamp or error; newer request aborts the older one.
6. **Scroll mode, random access (D6 part).** Port the lazy engine into `data-grid-server`
   (`scroll-blocks.ts`) with `blockSize` alignment, layout-effect resets, batched block writes, the
   error state and `retry` of failed blocks. Port `use-data-grid-lazy-rows.test.ts` and the browser
   tests. New tests: first request is block 0; a count change resets; StrictMode double mount
   fetches each block once; error bar and Retry render for a failed block (browser, `role="alert"`);
   100k-row thumb drag commits at most one `setRows` per frame (perf test, `ccc daemon stop` first).
   Server: SS and FS with checked rows across windows. Client: a client sort over holes warns once
   per grid (the new core warning).
7. **Scroll mode, sequential (D6 part) and refresh in place (D3).** Port the infinite engine
   (`scroll-sequence.ts`) for `nextCursor` and `hasMore` answers; repeated-cursor guard;
   `MAX_ROW_COUNT` stop. `refresh()` keeps visible rows, skips `"saving"` rows and the edited row.
   Tests: cursor chain ends at `null`; same cursor twice ends with one warning; empty page ends;
   refresh during a pending save keeps the saved value; spec change mid-chain drops the old chain.
8. **Remove `data-grid-lazy` (D6).** Delete the item, the two hooks, and `DataGridLazyGuard`;
   migrate five demos, the playground, docs pages, redirects, `registry.json`,
   `components/registry-examples.tsx`, skills, parity evidence paths. Gates plus
   `pnpm registry:build`, `node scripts/normalize-payload-eol.mjs`, `pnpm registry:verify`,
   `pnpm test:e2e-install --smoke`.
9. **Core barrel cleanup (D7 core).** Remove the listed hooks and helpers; deep import in
   `data-grid-context-menu`. Test: `scripts/verify-source-rules.mjs` or a barrel snapshot test
   lists the public names, so a later addition is a visible diff.
10. **Release notes pass.** Group every `**Breaking:**` line of this spec under the 2.0 summary
    list at the top of `## Unreleased`, by area, with the replacement.

Order rationale: steps 1-4 are renames with no engine change, so a bisect isolates behavior
changes to 5-7. Step 8 runs only after 6 and 7 pass every ported test, so no mode loses coverage.

## 4. Review brief applied

- Performance: stable provider props (5), batched block writes with a frame-budget test (6).
- Bounds: one `readAnswer` for rows, counts, and cursors; `MAX_ROW_COUNT` caps sparse and
  sequential growth; `onSaveRejected.error` is never rendered.
- Races: each `await` re-reads the spec key and `signal`; resets run in a layout effect.
- Accessibility: scroll mode gains the root error bar (`root.tsx:681`, `role="alert"`) and Retry.
- Styling: no new UI; demos add `headerClickBehavior`. Docs: the lazy pages merge into one
  "Server rows" page; the table in `server-side.mdx:78-84` becomes a `mode` table.

## 5. Known limits of the scroll engine

- `applyChange` (`data-grid/interaction/history.ts`) maps every row to its id on each edit, which is O(count) on a sparse source. A cheaper edit path needs an id index that skips holes; it also serves undo and redo, so it belongs to a core change, not to the server hook.
- A `getRowId` that differs between the provider and the hook needs no dev warning: the core never calls `getRowId` on a hole, so the hook's hole-safe `getRowId` is not required by the provider.
- A sequential cursor chain remembers up to 10,000 returned cursors, and keys an object cursor by its JSON when it is at most 1,024 characters. A longer chain or a larger cursor relies on the `Object.is` check against the cursor just sent.
