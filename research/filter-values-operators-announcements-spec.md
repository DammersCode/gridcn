# Filter values, custom operators, and server-refresh feedback (2.0)

Modes: L local, PC client pages, PS server pages, Z lazy rows, C controlled, SS server sort, FS server filter. Names follow `api-cohesion-2.0.md`.

## S8. Filter values with a value and a label

`FilterValue = { value: string; label?: string; count?: number }`. `value` is what a filter entry stores; `label` is what the list shows (default `value`).

- Set-filter list (header filter, `isAnyOf` input): checked keys come from `value` (lowercase); the row shows `label`; search matches the label on the client list, goes to the server as `query` in FS.
- `fetchFilterValues` answers `{ values: FilterValue[] }`. Bounds as before: string `value` and `label` cut at 1000 characters, one entry per lowercase `value`, at most `MAX_SET_FILTER_ENTRIES`; a non-string `value` drops the entry.
- `filterState`, the filter `ServerSpec`, and the URL param carry `value`, never `label`. No change to `filter-param.ts` encoding; tests pin the round trip with a value that differs from its label.
- Local mode (L, PC): cell text is the value and the label; unchanged.
- Server: `fetchRows` receives the code in `spec.filters`; `fetchFilterValues` receives the open filters with codes.

**Breaking:** `FilterValue.label` is `FilterValue.value`; `label` is optional display text.

## Q. Custom filter operators and a per-column comparator

```ts
type CustomFilterOperator = {
  id: string;
  label: string;
  input?: "none" | "single" | "range" | "list"; // value shape, default "single"
  match?: (text: string, filter: FilterSpec) => boolean; // local evaluator
};
```

- Provider prop `customFilterOperators`. `FilterOperator` is the built-in union or any string.
- A column offers a custom operator when its `filterOperators` (or the cell type's) lists the id.
- Filter row: the operator select shows `label`; `input` picks the value widget (`none` no input, `single` the cell type's input, `range` two inputs, `list` the set input).
- Local evaluation (L, PC, Z holes excluded): `match(text, filter)`; a throw fails the row. Without `match` the operator does not narrow rows and warns once in development. With `filterMode="server"` `match` is never called.
- Server (FS): the spec carries the operator id and value unchanged; the server maps its vocabulary.
- URL: `parseFilterState(raw, { customOperators })` and `serializeFilterState(filters, { customOperators })` read the value shape from `input`. An unregistered id drops the segment as before.
- `ColumnDef.filterCompare(a, b)` orders text for `gt`, `gte`, `lt`, `lte`, and `isBetween` instead of the numeric-then-text default. A throw or NaN falls back to the default order.

## L. Result announcements for server refreshes

With `announceResults`, the end of a load (`loading` true to false, no `error`) announces the result: `totalRowCount` when it is a number, else the loaded rows; zero reads "No results". The live region already waits 500 ms for the last announcement, so a typing run speaks once. A load that ends in `error` speaks `labels.grid.errorState`.

## N. Error overlay

The root error state (`error`, `onRetry`) is the overlay for a failed page or window fetch: `role="alert"`, Retry button, in pages mode and scroll mode. Tests pin both with a hook-shaped `gridProps`.

## Empty result

Zero rows with `reason: "filtered"` (client or server filter, or search) shows `labels.grid.noResults` ("No results"); `reason: "no-data"` keeps `labels.grid.emptyState`. The status bar escalation already reads `totalRowCount`; a test pins it.

**Breaking:** the default text of a filtered empty grid is "No results".
