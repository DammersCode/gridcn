# Server-mode sort/filter/search wiring

Contents: [`data-grid-lazy`](#data-grid-lazy) · [`data-grid-pagination` (server mode)](#data-grid-pagination-server-mode)

Both variants share the same shape: hold the spec outside the grid's store, send it to the fetch, and set `sortMode="server"` so the grid never re-sorts the loaded slice client-side, and pass `filterState` as a stable empty array so it never re-filters it. Without them the grid sorts and filters locally.

## `data-grid-lazy`

```tsx
"use client";

import { useState } from "react";
import { DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, type SortSpec } from "@/components/data-grid/data-grid";
import { useDataGridLazyRows, DataGridLazyGuard } from "@/components/data-grid-lazy/data-grid-lazy";

function OrdersGrid({ total }: { total: number }) {
  const [sorts, setSorts] = useState<SortSpec[]>([]);

  const lazy = useDataGridLazyRows<Order>({
    total, // fetch the count first
    getRowId: (row) => row.id,
    spec: { sorts, filters: [], search: "" }, // a changed spec drops the fetched windows and refetches
    fetchRows: ({ start, end, signal, spec }) => api.orders({ start, end, sorts: spec.sorts, signal }),
  });

  const onSortChange = (next: SortSpec[]) => setSorts(next);

  return (
    <DataGridProvider
      data={lazy.gridProps.data}
      columns={columns}
      getRowId={lazy.gridProps.getRowId}
      onDataChange={lazy.onDataChange}
      onRenderedRowsChange={lazy.gridProps.onRenderedRowsChange}
      sortMode="server"
      onSortChange={onSortChange}
      headerClickBehavior="sort"
    >
      <DataGridLazyGuard hasHoles={lazy.unloadedCount > 0} />
      <DataGridRoot>
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
    </DataGridProvider>
  );
}
```

Rules that make this work, and break silently if skipped:

- **Header clicks sort only with `headerClickBehavior="sort"`.** The default `"select"` selects the column, and `onSortChange` never fires.
- **`sortMode="server"` leaves the order to the server.** The grid tracks the spec (header cycle, `aria-sort`, sort indicator, `DataGridSortList`) and calls `onSortChange`, but never reorders `data`. Passing `sortState={sorts}` as well is allowed.
- **Set `filterMode="server"`** for filtering. The grid tracks the spec (filter menu, header filters, `data-filtered`) and calls `onFilterChange`, but never filters `data`. Hold the spec in your state, send it to `fetchRows`, and set `total` to the filtered count. Pass `fetchFilterValues` to list column values from your server.
- **The quick-search box never narrows the view.** It highlights and navigates matches already in `data`. To search the whole dataset, send `searchText` (read it with `useDataGridSearchText`, or use `searchText` with `onSearchTextChange`) to `fetchRows`.
- **Pass the spec to the hook (`spec: { sorts, filters, search }`).** A change of its content resets the hook and refetches the window in view; `fetchRows` receives the spec of its request. Without `spec`, call `lazy.reset()` on a sort change (a filter change resets through the new `total`; call `lazy.reset()` when `total` stays the same). Already-fetched windows hold rows in the old order/set; without a reset they keep serving stale data.
- `DataGridUrlState` mounts on this grid only with both `sortMode="server"` and `filterMode="server"`; the store then keeps the URL spec and never re-sorts or re-filters the partial `data`.

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

  const pager = useDataGridPagination({
    page,
    pageSize,
    total,
    onPageChange: setPage,
    onPageSizeChange: setPageSize,
    reconcilePage: true, // clamps page and fires onPageChange once if total shrinks under it
  });

  const onSortChange = (next: SortSpec[]) => {
    setSorts(next);
    setPage(1);
  };

  const onFilterOrSearchChange = () => {
    pager.controls.onPageChange(1); // useDataGridUrlPagination needs the same manual reset
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
      <DataGridPaginationBar {...pager.controls} />
    </>
  );
}
```

Rules:

- The grid only ever receives the fetched page (`rows`), so sort/filter/search on it are inherently page-local unless the spec (`sorts` here) is sent to the fetch and rendered from your own state. The lazy-loading rules above apply unchanged: `sortMode="server"`, and `headerClickBehavior="sort"`.
- The `useEffect`'s `stale` flag is required in server mode: a page-2 response arriving after a page-3 request has already fired must not clobber page 3's rows.
- `reconcilePage: true` only fires your `onPageChange` once when `total` shrinks below the current page; it never sets state itself. Without it, the bar visually clamps but your `page` state can still request an out-of-range page.
- A sort, filter, or search change must call `onPageChange(1)` by hand — the pagination hook has no visibility into filter/search wiring, uncontrolled or through `useDataGridUrlPagination`.
- Merge edits back into the full dataset by row id in `onDataChange`; do not replace the whole dataset with the page-sliced array.
- `useDataGridUrlPagination` (from `data-grid-url-state`) composes only with this server mode, spreading `{ page, pageSize, onPageChange, onPageSizeChange }` from `url` in place of local state above — client mode's `pageSize` seeds once and cannot take a pushed URL value.

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

- Lazy: `useDataGridInfiniteRows({ getRowId, fetchRows: ({ cursor, limit, signal }) => ... })`. Resolve `{ rows, nextCursor }`; `nextCursor: null` ends the source, any other value (including `0`) means more. Pages load in order. Call `rows.reset()` when the sort, filter, or search spec changes (it aborts and restarts at page 1). There is no `evict`.
- Pagination: `useDataGridPagination({ page, pageSize, hasNextPage, onPageChange })`. `controls.total` is `undefined`; keep one cursor per page in your state and drop them when the page size, sort, or filter changes.
- Select-all covers loaded rows and skeletons; send "all matching" bulk actions to your own endpoint.
