# Lazy row loading & Pagination — Design

**Date:** 2026-07-17 · **Status:** approved-in-principle by user ("you decide"), implementation queued
**Decision:** both ship as separate registry add-ons. Core gets exactly two small, generic extensions
(a row-window callback and skeleton rendering for missing rows); everything else stays out of the engine.

## Add-on 1: `data-grid-lazy` (virtual data fetching)

The scenario: 100k-row dataset, only rows 0–20 fetched. User flings to rows 80–100 → those rows
render as skeletons, the add-on fetches 80–100, cells fill in when the data lands.

### Core extensions (small, generic, no fetching logic in core)

1. **`onRowWindowChange?: (range: { start: number; end: number }) => void`** on the grid root —
   fired after a window commit with the rendered data-row range (the engine already computes this
   in `useRowWindow`; firing a callback post-commit costs nothing per the perf rules — no extra
   subscriptions, no render coupling). This is useful beyond lazy loading (analytics, prefetch).
2. **Skeleton rows for missing data**: `useDataGridRow` already returns `undefined` for holes;
   today cells render empty. Change: when the row object is `undefined`, `DataGridRow` renders
   skeleton cells — static shimmer blocks (CSS `animate-pulse`, no JS per frame, `aria-busy` on
   the row, marker column still shows the row number). Zero cost when data is complete; fits the
   phase-3 memo contract (an undefined→defined row flip is a normal row-content change).

### The add-on: `useDataGridLazyRows`

```ts
const lazy = useDataGridLazyRows({
  totalCount: 100_000,
  fetchRows: async (start, end) => api.rows(start, end), // inclusive-exclusive
  overscan?: number,   // extra rows per fetch beyond the visible range (default ~1 viewport)
  minBatch?: number,   // round ranges up so tiny scrolls don't spam requests
});
<DataGrid {...lazy.gridProps} columns={columns} />
```

- Maintains a sparse `data` array (length = totalCount, holes = unloaded) + `gridProps` =
  `{ data, getRowId, onRowWindowChange }`. Placeholder row ids are index-derived until loaded
  (documented: unstable identity for unloaded rows is fine — they carry no state).
- Range coalescing + in-flight dedup: never re-request a loading/loaded range; merge adjacent
  gaps; abort-on-unmount via AbortSignal passed to fetchRows.
- Errors: failed ranges revert to "unloaded" and refetch on next visibility; `onError` callback.

### Constraints (documented honestly)

- **Client-side sort/filter/search are incompatible with partial data** (you cannot sort rows you
  don't have). Lazy mode requires the controlled sort/filter/search props (server escape hatch,
  already shipped) — the add-on dev-warns if uncontrolled sort/filter actions fire while holes
  exist. Editing loaded rows works normally; clipboard/fill across unloaded ranges is blocked
  (readOnly-like skip, same mechanism as non-writable columns).

## Add-on 2: `data-grid-pagination`

Pagination is a UX/server-load pattern, not a perf need (virtualization already handles size), so
it is purely additive: **zero core changes**.

```tsx
const pager = useDataGridPagination({ data, pageSize: 50 });          // client mode: slices data
// or server mode: { page, pageSize, total, onPageChange } fully controlled, consumer fetches
<DataGrid data={pager.pageData} ... />
<DataGridPagination {...pager.controls} />
```

- `<DataGridPagination />`: footer bar — prev/next + windowed page numbers, page-size select,
  "x–y of z" range label. All strings via the `labels` object (new `pagination` group). shadcn
  `Button`/`Select`, existing tokens.
- Composes with `data-grid-url-state` (page/pageSize params, same prefix mechanism).
- Docs page explains **lazy vs pagination**: infinite-feel single surface → lazy; explicit pages,
  bookmarkable, bounded payloads → pagination. Using both together is not supported in v1.

## Phasing (after current QA lanes clear)

1. Core: onRowWindowChange + skeleton rows (+ browser tests: skeleton visible for holes, fires
   range callback on window commits, no perf-suite regression).
2. `data-grid-lazy` add-on + demo (simulated latency API) + docs page.
3. `data-grid-pagination` add-on + demo + docs page + labels group.
Registry entries, examples, dev-page sections, payload rebuild per phase; standard gates.
