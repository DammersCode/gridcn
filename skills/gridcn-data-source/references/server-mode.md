# Server-mode sort/filter/search wiring

Contents: [Scroll mode](#scroll-mode-data-grid-server) · [`data-grid-pagination` (server mode)](#data-grid-pagination-server-mode)

Both variants share the same shape: hold the spec outside the grid's store, send it to the fetch, and set `sortMode="server"` so the grid never re-sorts the loaded slice client-side, and pass `filterState` as a stable empty array so it never re-filters it. Without them the grid sorts and filters locally.

## Scroll mode (`data-grid-server`)

```tsx
"use client";

import { DataGrid } from "@/components/data-grid/data-grid";
import { useDataGridServerRows } from "@/components/data-grid-server/data-grid-server";

function OrdersGrid() {
  const server = useDataGridServerRows<Order>({
    mode: "scroll",
    getRowId: (row) => row.id,
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
- **The hook owns the spec and sets `sortMode="server"` and `filterMode="server"`.** The grid tracks the spec (header cycle, `aria-sort`, sort indicator, `DataGridSortList`, filter menu, header filters) and never reorders or filters `data`. Pass `fetchFilterValues` to list column values from your server.
- **The quick-search box never narrows the view.** It highlights and navigates matches already in `data`. The hook sends `searchText` in `spec` to `fetchRows`.
- **A changed spec starts the blocks over.** `fetchRows` receives the spec of its request. Control it with `spec` and `onSpecChange` (for example from URL state); a content change restarts, an equal spec does not.
- **Return `totalRowCount` for random access.** A first answer with a cursor, or with neither a count nor a cursor, makes the source sequential: resolve `{ rows, nextCursor }` or `{ rows, hasMore }`.
- **`server.refresh()` refetches the rendered blocks in place** and applies one rule: a landing block replaces every row it carries, except a row with a pending cell edit or a save that was in flight at any moment since the request was sent, which keeps its local value; a block shows each id once (the first row of a repeated id in an answer wins) and leaves no hole in its loaded range; rows that moved on the server can mix with older rows until the next refresh settles. The guard that applies it mounts through `gridProps.plugins`: a `plugins` prop of your own replaces it, so write `plugins={[...server.gridProps.plugins, mine]}` (pages mode has the same guard). Call it after the `onSave` promise settles, because a row that still shows "saving" keeps its local value and misses server-computed fields. `server.retry()` repeats the failed blocks.
- `DataGridUrlState` mounts on this grid through a controlled `spec`/`onSpecChange` pair; the store keeps the URL spec and never re-sorts or re-filters the partial `data`.

## `data-grid-pagination` (server mode)

```tsx
"use client";

import { useEffect, useState } from "react";
import { DataGrid, type SortSpec } from "@/components/data-grid/data-grid";
import { useDataGridPagination, DataGridPaginationBar } from "@/components/data-grid-pagination/data-grid-pagination";

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

  const { pager } = useDataGridPagination({
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
        getRowId={(row) => row.id}
        sortMode="server"
        onSortChange={onSortChange}
        headerClickBehavior="sort"
      />
      <DataGridPaginationBar {...pager} />
    </>
  );
}
```

Rules:

- The grid only ever receives the fetched page (`rows`), so sort/filter/search on it are inherently page-local unless the spec (`sorts` here) is sent to the fetch and rendered from your own state. The lazy-loading rules above apply unchanged: `sortMode="server"`, and `headerClickBehavior="sort"`.
- The `useEffect`'s `stale` flag is required in server mode: a page-2 response arriving after a page-3 request has already fired must not clobber page 3's rows.
- The hook fires your `onPageChange` once with the clamped page when `totalRowCount` shrinks below the current page, and never while the count is 0. It never sets state itself.
- A sort, filter, or search change must call `onPageChange(1)` by hand — the pagination hook has no visibility into filter/search wiring, uncontrolled or through `useDataGridUrlPagination`.
- Merge edits back into the full dataset by row id in `onDataChange`; do not replace the whole dataset with the page-sliced array.
- `useDataGridUrlPagination` (from `data-grid-url-state`) composes only with this server mode, spreading `{ page, pageSize, onPageChange, onPageSizeChange }` from `url` in place of local state above — client mode's `defaultPageSize` seeds once and cannot take a pushed URL value.

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
- Treat the whole tree as untrusted input. On the server, check depth (at most 2), group count (at most 16), row count (at most 64), that `columnId` names an allowed column, that `operator` is a known operator, and that every `join` is `"and"` or `"or"`. Cap the request body size.
- Never build SQL by string concatenation. Bind `value` as a parameter, or escape it with the ORM or driver.
- Send the tree to the same request as the sort spec and the page or window. Return the filtered `total`.

## No row count (cursor or "has more" APIs)

- Scroll: `useDataGridServerRows({ mode: "scroll", getRowId, fetchRows: ({ cursor, start, end, signal }) => ... })`. Resolve `{ rows, nextCursor }`; `nextCursor: null` ends the source; any other value (including `0`) means more. Without a cursor, resolve `{ rows, hasMore }`; `hasMore: false` ends the source. The hook keeps the first `end - start` rows of a longer answer. Blocks load in order, one at a time. A spec change restarts at block 0 by itself; `refresh()` refetches from the first block and keeps rows with a pending save. `evict` does nothing.
- Pagination: `useDataGridPagination({ page, pageSize, totalRowCount: null, hasNextPage, onPageChange })`. `pager.totalRowCount` is `null`; keep one cursor per page in your state and drop them when the page size, sort, or filter changes.
- Select-all covers loaded rows and skeletons; send "all matching" bulk actions to your own endpoint.
