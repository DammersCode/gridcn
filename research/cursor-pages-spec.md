# Cursor pages without a total

## Problem

Scroll mode of `useDataGridServerRows` follows a cursor chain. Pages mode does not: a pager over a
keyset API keeps the page-to-cursor map and the "has next" flag in the consumer, in every demo.

## Decision

The chain lives in pages mode of `useDataGridServerRows`. `useDataGridPagination` stays a view
over `page`, `pageSize`, and `hasNextPage`; it never talks to the server.

No new option. A pages request carries `cursor`, the same field scroll mode uses, and an answer with
`nextCursor` makes the source a cursor source:

```ts
const server = useDataGridServerRows<Order, string>({
  getRowId: (row) => row.id,
  fetchRows: async ({ cursor, pageSize, spec, signal }) => {
    const res = await api.orders({ after: cursor, limit: pageSize, spec, signal });
    return { rows: res.items, nextCursor: res.next ?? null };
  },
});
```

## Chain rules

- Page 1 has cursor `undefined`. An answer for page `p` that carries `nextCursor` stores it as the
  cursor of page `p + 1`. Storing it drops every later cursor (they hung off the old one).
- `nextCursor: null` means no next page (`hasNextPage` is false). Any other value, `0` included, means more.
- The chain resets when the sort, filter, search text, or page size changes. The page resets to 1 (as
  for every pages source).
- `refresh` and `retry` repeat the current page with its stored cursor; the chain survives.
- A page is reachable when its cursor is known. The pager shows the pages up to the furthest known
  one, and no last page or count. A controlled `page` (URL state, `defaultPage`) beyond the known
  chain snaps back to the furthest known page and calls `onPageChange`.
- Back and forward within the chain reuse the stored cursors; each move fetches again.
- A cursor answer's `totalRowCount` feeds `totalRowCount`, but the pager stays count-free.
- Stale answers drop: a newer request, a spec change, or unmount aborts the request and ignores its answer.
- A rejected request sets `error` and keeps the last rows; `retry` repeats it. The chain is untouched.
- An answer without `nextCursor` keeps the existing behavior (`hasMore`, `totalRowCount`).

## Modes

| Mode | Behavior |
|---|---|
| Local array, client pagination | unchanged |
| Pages, counted | unchanged |
| Pages, cursor | this spec |
| Scroll, cursor | unchanged (sequential blocks) |
| `sortMode="server"` | the hook always sets it; `spec` goes in the request and resets the chain |

## Server contract

- Request: the consumer's own (`cursor`, `pageSize`, `spec`). The grid sends nothing itself.
- Response: `rows` and `nextCursor`. A non-array `rows` is a failed request. The cursor stays in the
  hook; nothing renders it.

## Demos

- `data-grid-open-ended-demo`: scroll and pages, both through the hook, no hand-kept chain.
- `data-grid-cursor-react-query-demo`: `useInfiniteQuery`, infinite scroll and pager.
- `data-grid-cursor-swr-demo`: `useSWRInfinite`, infinite scroll and pager.

React Query and SWR own the cache; the grid hook is not used there. The pager variants read the page
from `data.pages[page - 1]`; the next page fetches with `fetchNextPage` / `setSize`. Jumping past the
loaded pages is not offered, same as the hook.

## Tests

Unit: first request has no cursor, chain forward, back, reset on spec/pageSize, refresh keeps the
cursor, `nextCursor: null`, snap-back of a controlled page, error and retry, stale drop.
