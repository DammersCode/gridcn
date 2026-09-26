# Server-mode sort/filter/search wiring

Contents: [`data-grid-lazy`](#data-grid-lazy) · [`data-grid-pagination` (server mode)](#data-grid-pagination-server-mode)

Both variants share the same shape: hold the spec outside the grid's store, send it to the fetch, and pass the grid's own `sortState`/`filterState` as a stable empty array so it never re-sorts/re-filters the loaded slice client-side. Omitting them means the grid sorts locally.

## `data-grid-lazy`

```tsx
"use client";

import { useState } from "react";
import { DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, type SortSpec } from "@/components/data-grid/data-grid";
import { useDataGridLazyRows, DataGridLazyGuard } from "@/components/data-grid-lazy/data-grid-lazy";

const EMPTY_SORT: SortSpec[] = [];

function OrdersGrid() {
  const [sorts, setSorts] = useState<SortSpec[]>([]);

  const lazy = useDataGridLazyRows<Order>({
    total: 100_000,
    getRowId: (row) => row.id,
    fetchRows: (start, end, signal) => api.orders({ start, end, sorts, signal }),
  });

  const onSortChange = (next: SortSpec[]) => {
    lazy.reset(); // already-fetched windows hold the old order; drop them before refetching
    setSorts(next);
  };

  return (
    <DataGridProvider
      data={lazy.gridProps.data}
      getRowId={lazy.gridProps.getRowId}
      onDataChange={lazy.onDataChange}
      sortState={EMPTY_SORT}
      onSortChange={onSortChange}
      headerClickBehavior="sort"
    >
      <DataGridLazyGuard hasHoles={lazy.unloadedCount > 0} />
      <DataGridRoot onRowWindowChange={lazy.gridProps.onRowWindowChange}>
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
    </DataGridProvider>
  );
}
```

Rules that make this work, and break silently if skipped:

- **Header clicks sort only with `headerClickBehavior="sort"`.** The default `"select"` selects the column, and `onSortChange` never fires.
- **`sortState` must stay a stable empty array reference (`[]`), never omitted.** Passing it at all is what puts sorting into controlled mode, so a header click reports through `onSortChange` instead of sorting locally. Echoing the spec back into `sortState` re-sorts the fetched window among itself and hides the server's actual order.
- **`filterState` follows the same rule** for filtering — pass it controlled-empty and hold the real filter spec yourself.
- **`searchText` cannot be moved server-side at all.** It only highlights and navigates matches already in `data`; a search over a partial lazy array highlights only the loaded part, full stop. There is no controlled escape hatch for it — build a separate server search UI if full-dataset search is required.
- **A sort or filter change must call `lazy.reset()` before (or as part of) updating the spec.** Already-fetched windows hold rows in the old order/set; without the reset they keep serving stale data until evicted some other way. Remounting the provider on a key derived from the spec also clears them, but also resets selection/edit/scroll state — heavier.
- **The header's sort indicator, `aria-sort`, and `DataGridSortList` go blank** once `sortState` is controlled-empty. Render the active sort from your own `sorts` state. `toggleSort` still derives its next direction from the (empty) store, so re-derive the asc → desc → none cycle against your own spec instead of relying on it.
- `DataGridUrlState` cannot be mounted on this grid — it writes URL sort/filter/search into the store on mount, which conflicts with keeping the spec outside the store.

## `data-grid-pagination` (server mode)

```tsx
"use client";

import { useEffect, useState } from "react";
import { DataGrid, type SortSpec } from "@/components/data-grid/data-grid";
import { useDataGridPagination, DataGridPaginationBar } from "@/components/data-grid-pagination/data-grid-pagination";

const EMPTY_SORT: SortSpec[] = [];

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
        sortState={EMPTY_SORT}
        onSortChange={onSortChange}
        headerClickBehavior="sort"
      />
      <DataGridPaginationBar {...pager.controls} />
    </>
  );
}
```

Rules:

- The grid only ever receives the fetched page (`rows`), so sort/filter/search on it are inherently page-local unless the spec (`sorts` here) is sent to the fetch and rendered from your own state. The lazy-loading rules above apply unchanged: `sortState={EMPTY_SORT}`, never the echoed spec (echoing it re-sorts the page on the client and flashes a page-local order before the server page lands), and `headerClickBehavior="sort"`.
- The `useEffect`'s `stale` flag is required in server mode: a page-2 response arriving after a page-3 request has already fired must not clobber page 3's rows.
- `reconcilePage: true` only fires your `onPageChange` once when `total` shrinks below the current page; it never sets state itself. Without it, the bar visually clamps but your `page` state can still request an out-of-range page.
- A sort, filter, or search change must call `onPageChange(1)` by hand — the pagination hook has no visibility into filter/search wiring, uncontrolled or through `useDataGridUrlPagination`.
- Merge edits back into the full dataset by row id in `onDataChange`; do not replace the whole dataset with the page-sliced array.
- `useDataGridUrlPagination` (from `data-grid-url-state`) composes only with this server mode, spreading `{ page, pageSize, onPageChange, onPageSizeChange }` from `url` in place of local state above — client mode's `pageSize` seeds once and cannot take a pushed URL value.
