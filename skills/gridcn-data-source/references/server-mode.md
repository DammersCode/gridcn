# Server-mode sort/filter/search wiring

Contents: [Scroll mode](#scroll-mode-data-grid-server) · [`data-grid-pagination` (server mode)](#data-grid-pagination-server-mode)

Both variants share the same shape: hold the spec outside the grid's store, send it to the fetch, and pass `totalRowCount` so `sortMode` and `filterMode` default to `"server"` and the grid never re-sorts or re-filters the loaded slice. Without a count, set `sortMode="server"` and `filterMode="server"` yourself. Without them the grid sorts and filters locally. `useDataGridServerRows` sets both in `gridProps`.

## Scroll mode (`data-grid-server`)

```tsx
"use client";

import { DataGrid } from "@/components/data-grid/data-grid";
import { useDataGridServerRows } from "@/components/data-grid-server/data-grid-server";

function OrdersGrid() {
  const server = useDataGridServerRows<Order>({
    mode: "scroll",
    fetchRows: async ({ start, end, signal, spec }) => {
      const answer = await api.orders({ start, end, sorts: spec.sorts, filters: spec.filters, search: spec.searchText, signal });
      return { rows: answer.rows, totalRowCount: answer.total };
    },
  });

  return <DataGrid {...server.gridProps} columns={columns} headerClickBehavior="sort" />;
}
```

Rules that make this work, and break silently if skipped:

- **Header clicks sort only with `headerClickBehavior="sort"`.** The default `"select"` selects the column, and the spec never changes.
- **The hook owns the spec and sets `sortMode="server"` and `filterMode="server"`.** The grid tracks the spec (header cycle, `aria-sort`, sort indicator, `DataGridSortList`, filter menu, header filters) and never reorders or filters `data`. Pass `fetchFilterValues` to list column values from your server. Each value is `{ value, label?, count? }`: the filter stores `value` (a code or id) and the list shows `label`. To name a server filter vocabulary, list `{ id, label, input?, match? }` objects in the column's `filter.operators`; with `filterMode="server"` the spec carries the `id` and the grid never calls `match`.
- **The quick-search box never narrows the view.** It highlights and navigates matches already in `data`. The hook sends `searchText` in `spec` to `fetchRows`.
- **A changed spec starts the blocks over.** `fetchRows` receives the spec of its request. Control it with `spec` and `onSpecChange` (for example from URL state); a content change restarts, an equal spec does not.
- **Return `totalRowCount` for random access.** A first answer with a cursor, or with neither a count nor a cursor, makes the source sequential: resolve `{ rows, nextCursor }` or `{ rows, hasMore }`.
- **`server.refresh()` refetches the rendered blocks in place** and applies one rule: a landing block replaces every row it carries, except a row with a pending cell edit or a save that was in flight at any moment since the request was sent, which keeps its local value, while a row with a pending delete is gone (the answer's copy is dropped, its slot stays empty) and a protected row the answer lacks, such as a pending insert, returns to its own slot when no answer row sits there, else is hidden until a counted source refreshes when no pending insert or delete is left (a pages refresh appends it at the page end, so the page can exceed `pageSize`; a sequential refresh that ends first may drop it until its save settles); a block shows each id once (the first row of a repeated id in an answer wins) and leaves no hole in its loaded range; rows that moved on the server can mix with older rows until the next refresh settles. The guard that applies it mounts through `gridProps.plugins`: a `plugins` prop of your own replaces it, so write `plugins={[...server.gridProps.plugins, mine]}` (pages mode has the same guard). Pass `onSave` to the hook, not to `DataGrid`: `refreshAfterSave` (default `"settled"`) calls `refresh()` once after every save in flight settles, because a row that still shows "saving" keeps its local value and misses server-computed fields. Do not call `refresh()` from `onSave` yourself. `server.retry()` repeats the failed blocks.
- **Scroll mode limits the fetches.** A block starts after it stays in the wanted range for `loadDelayMs` ms (default 100; block 0, `refresh()`, `retry()`, and the refetch after a count change skip it). At most `maxConcurrentFetches` requests run (default 3). A request aborts when its block leaves the rendered rows by more than `overscan` plus one block, so pass `signal` to your client. `maxLoadedRows` (default 10,000; `Infinity` turns it off) unloads the least recently viewed blocks; rows with an open edit, a pending save, or an unsaved change, and the row under the active cell, stay. A sequential source uses `loadDelayMs` only.
- **`revalidateIntervalMs` refreshes on a timer** (ms, at least 1000) while the page is visible, in both modes. A tick waits for a request in flight. **`prefetchNextPage: true`** loads the next page in pages mode and shows it with no request; a refresh, a spec or page size change, a local insert, delete, or move, or the start of a save drops it.
- **Pushes into a server grid.** `updateCells`/`updateRows`/`deleteRows(ids, { source: "stream" })` never reach `onSave`. A push that changes a column of the sort, the filter, or (with a search text) any column leaves the row in place, sets `data-row-stale` on it, and sets `viewStale`; the server places it again on a reshape. `reshapeDelayMs` (ms, at least 250, off by default) makes the hook reshape (a `refresh()`) once per delay after a stale push; `server.reshape()` and a push delete reshape on the next frame, or after `reshapeDelayMs` when it is set; `reconcileView()` and `reorder: "immediate"` always reshape on the next frame. Call `server.reshape()` when the server reports an inserted row. A `"stream"` push writes into `readOnly` grids, columns, and rows; other sources keep the read-only checks. A row that an answer delivered with a pushed value laid over it (a push made while the request was open, or between its landing and its render) stops being stale and can sit in the wrong place until the next reshape places it; a later push to it marks it again. A push to a row with a save in flight skips with `saving`, and a `"stream"` call takes at most 100,000 patches (`limit`).
- `DataGridUrlState` mounts on this grid through a controlled `spec`/`onSpecChange` pair; the store keeps the URL spec and never re-sorts or re-filters the partial `data`.

## `data-grid-pagination` (server mode)

```tsx
"use client";

import { useEffect, useState } from "react";
import { DataGrid, type SortSpec } from "@/components/data-grid/data-grid";
import { useDataGridServerPager, DataGridPaginationBar } from "@/components/data-grid-pagination/data-grid-pagination";

function OrdersGrid() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sorts, setSorts] = useState<SortSpec[]>([]);
  const [rows, setRows] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let stale = false; // a slower earlier-page response must not overwrite a later page's rows
    api.orders({ page, pageSize, sorts }).then((res) => {
      if (stale) return;
      setRows(res.rows);
      setTotal(res.total);
    });
    return () => { stale = true; };
  }, [page, pageSize, sorts]);

  const { pager } = useDataGridServerPager({
    page,
    pageSize,
    totalRowCount: total,
    onPageChange: setPage,
    onPageSizeChange: setPageSize,
  });

  const onSortChange = (next: SortSpec[]) => {
    setSorts(next);
    setPage(1);
  };

  const onFilterOrSearchChange = () => {
    pager.onPageChange(1); // useDataGridUrlPagination needs the same manual reset
  };

  return (
    <>
      <DataGrid
        data={rows}
        columns={columns}
        totalRowCount={total}
        onSortChange={onSortChange}
        onFilterChange={onFilterOrSearchChange}
        onSearchTextChange={onFilterOrSearchChange}
        headerClickBehavior="sort"
      />
      <DataGridPaginationBar {...pager} />
    </>
  );
}
```

Rules:

- The grid only ever receives the fetched page (`rows`), so sort/filter/search on it are inherently page-local unless the spec (`sorts` here) is sent to the fetch and rendered from your own state. The rules above apply unchanged: `totalRowCount` makes both modes `"server"`, and header clicks sort only with `headerClickBehavior="sort"`.
- The `useEffect`'s `stale` flag is required in server mode: a page-2 response arriving after a page-3 request has already fired must not clobber page 3's rows.
- The hook fires your `onPageChange` once with the clamped page when `totalRowCount` shrinks below the current page, and never while the count is 0. It never sets state itself.
- With your own fetch state, a sort, filter, or search change must call `onPageChange(1)` by hand. A `DataGridProvider` with `pageSize` and `useDataGridServerRows` go back to page 1 by themselves.
- With server pages, `data` holds one page, so `onDataChange` and `onSave` act on that page only. A `DataGridProvider` with `pageSize` keeps all of `data`, so no merge is needed.
- `useDataGridUrlPagination` (from `data-grid-url-state`) spreads `{ page, pageSize, onPageChange, onPageSizeChange }` from `url` in place of the local state above. It also works with `DataGridProvider` paging and `useDataGridServerRows`.

## Send filters to the API

`filterState` is a `FilterNode[]`: each node is a `FilterSpec` (`{ columnId, operator, value }`) or a `FilterGroup` (`{ join: "and" | "or", filters: FilterNode[] }`). Map it like this:

```text
top-level nodes       -> combined with AND (the top level has no join of its own)
FilterSpec            -> one predicate: column, operator, value
FilterGroup           -> a parenthesized predicate list joined by its own join
nested FilterGroup    -> one more level of parentheses; depth is capped at 2
empty group           -> matches every row (emit no predicate)
```

- `value` is one string, an inclusive `[min, max]` tuple for `isBetween`, or a `string[]` for `isAnyOf` and `isNoneOf`.
- Treat the whole tree as untrusted input. On the server, run `parseServerSpec(body, { columns, limits })` from `data-grid-server`: it checks the shape, column ids, operators, value shapes, and tree size, drops unknown keys, and throws `ServerSpecError` (with `path`) on a bad spec. Without it, check depth (at most 2), group count (at most 16), row count (at most 64), that `columnId` names an allowed column, that `operator` is a known operator, and that every `join` is `"and"` or `"or"`. Cap the request body size.
- Never build SQL by string concatenation. Bind `value` as a parameter, or escape it with the ORM or driver.
- Send the tree to the same request as the sort spec and the page or window. Return the filtered row count as `totalRowCount`.

## No row count (cursor or "has more" APIs)

- Scroll: `useDataGridServerRows({ mode: "scroll", fetchRows: ({ cursor, start, end, signal }) => ... })`. Send `end - start` as the page size: the rows past it are dropped and the next cursor skips them. Resolve `{ rows, nextCursor }`; `nextCursor: null` ends the source; any other value (including `0`) means more. Without a cursor, resolve `{ rows, hasMore }`; `hasMore: false` ends the source. The hook keeps the first `end - start` rows of a longer answer. Blocks load in order, one at a time. A spec change restarts at block 0 by itself; `refresh()` refetches from the first block and keeps rows with a pending save. `evict` does nothing.
- Pagination: `useDataGridServerRows({ mode: "pages" })` keeps the cursor chain: resolve `{ rows, nextCursor }`, and each page request carries the `cursor` of the page before. Do not keep the chain in your own state. Only with your own fetch and `useDataGridServerPager({ page, pageSize, totalRowCount: null, hasMore, onPageChange })` keep one cursor per page in your state and drop them when the page size, sort, or filter changes. `pager.totalRowCount` is `null` there.
- Select-all covers loaded rows and skeletons; send "all matching" bulk actions to your own endpoint.
