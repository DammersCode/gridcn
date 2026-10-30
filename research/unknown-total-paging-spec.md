# Unknown total and cursor paging

## Problem

Server pagination (`useDataGridPagination({ page, pageSize, total })`) and the lazy hook
(`useDataGridLazyRows({ total })`) both need the row count. A keyset or "has more" API returns a
page and a next cursor, never a count, so it cannot connect.

## Decision

- Pagination: server options take `hasNextPage` instead of `total`. No total means no "of z", no
  last page, no page count.
- Lazy: a second hook, `useDataGridInfiniteRows`, for an open-ended source. `useDataGridLazyRows`
  keeps its positional `fetchRows(start, end, signal)` and its known `total`. The infinite hook
  takes `fetchRows({ cursor, start, limit, signal })` and returns `{ rows, nextCursor }`.

Two hooks because the contracts differ: a known total fetches any range in any order, a cursor
chain fetches one page after the other. One hook with both would need a union of two
`fetchRows` shapes.

## Pagination (server options)

```ts
type UseDataGridPaginationServerOptions =
  | { total: number; hasNextPage?: never; /* page, pageSize, onPageChange, ... */ }
  | { total?: undefined; hasNextPage: boolean; /* same */ };
```

`DataGridPaginationControls` changes:

| Field | Known total | Unknown total |
|---|---|---|
| `total` | `number` | `undefined` |
| `pageCount` | `ceil(total / pageSize)`, at least 1 | `page`, plus 1 when `hasNextPage` (the pages the user can reach) |
| `hasNextPage` (new) | `page < pageCount` | the option |

Footer with an unknown total:

- The range label is `labels.rangeUnknown(page)`, "Page 3". There is no "x-y of z".
- Next is disabled when `hasNextPage` is false. Last is disabled (no last page is known).
- The numbered buttons run to `pageCount`, so they show one page ahead while `hasNextPage` is true.
- `reconcilePage` never clamps the upper bound; the lower bound (1) still applies.
- `clampPage(page, undefined, size)` clamps to 1 only.

`useDataGridUrlPagination({ total })` already accepts an omitted `total` and then clamps nothing.

Page size change in server mode: unchanged; the consumer resets its cursor chain on any
`onPageChange` or `onPageSizeChange` (a cursor belongs to one sort, filter and page size).

## Infinite lazy rows

```ts
const rows = useDataGridInfiniteRows<Order, string>({
  getRowId: (row) => row.id,
  fetchRows: async ({ cursor, start, limit, signal }) => {
    const page = await api.orders({ after: cursor, limit, signal });
    return { rows: page.items, nextCursor: page.next ?? null };
  },
});
```

- `nextCursor: null` ends the source. Any other value, including `0`, means more rows exist.
  A "has more" flag API returns `hasMore ? start + rows.length : null`.
- The first call gets `cursor: undefined`.
- `limit` is the `pageSize` option (default 50, capped by `maxFetchRows` when given). The server may
  return fewer or more rows; an empty page ends the source (a dev warning explains).
- Pages load one at a time, in order. A fetch starts when the rendered window comes within
  `overscan` rows (default 30) of the end of the loaded rows and none is in flight.
- The grid gets `loaded rows` plus `pageSize` skeleton rows while `hasMore`, so the scroll height
  grows in steps. At the end the skeletons go away and the length is exact.
- Result: `{ gridProps, onDataChange, total, hasMore, unloadedCount, isLoading, reset }`.
  `total` is `undefined` while `hasMore`, then the final count. `unloadedCount` is the skeleton count.
- `reset()` aborts the fetch, drops rows and cursor, and requests the first page again. The
  consumer calls it when sort, filter, or search changes (the spec lives in the consumer's
  request, like known-total lazy).
- A rejected fetch calls `onError(error)`, stops the chain, and retries when the window next
  reports. No automatic loop.
- No `evict`, no `getLoadedRanges`: a cursor chain cannot refetch an arbitrary range.
- Edits go through `onDataChange` like the known hook; inserts and deletes change the loaded length.

Memory ceiling: the hook keeps every loaded row. A consumer that expects millions of rows pairs it
with its own cap (stop returning `nextCursor`).

## Modes

| Mode | Behavior |
|---|---|
| Local array | unchanged |
| Client pagination | unchanged (`data.length` is the total) |
| Server pagination, known total | unchanged |
| Server pagination, unknown total | `hasNextPage` option, footer above |
| Lazy, known total | unchanged |
| Lazy, unknown total | `useDataGridInfiniteRows` |
| Controlled sort and filter state, `sortMode` and `filterMode` `"server"` | the consumer holds the spec, sends it in the request, and calls `reset()` (infinite) or resets its cursor (pagination) when it changes |

## Server contract

- Request: the consumer's own (cursor, limit, sort, filter, search). The grid sends nothing.
- Response: rows and a next cursor, or rows and `hasNextPage`.
- Bounds on untrusted input: the hook reads `rows` (array) and `nextCursor`; a non-array `rows` is
  treated as a failed fetch. The grid never sends the cursor anywhere itself.

## Select-all without a total

Select-all checks the loaded rows and the skeletons, so a bulk action over "all" cannot mean "all
matching". The docs say so. A bulk delete over skeletons is a no-op (see
`lazy-row-op-guard-spec.md`).

## Tests

- Pagination: controls shape, footer labels, Next, Last, page window, reconcile, URL composition.
- Infinite hook: first fetch, cursor chain, one in flight, end, empty page, reset, abort,
  error and retry, edits, `unloadedCount`, no-arg compile check.
- Browser: scroll to the end loads further pages; demo renders.
