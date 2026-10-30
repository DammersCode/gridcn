# Selection over a server result

## Problem

Checked rows are view-row state, remapped by row id when the view rebuilds. A row that leaves
`data` drops out: a page change, a lazy eviction, or a server filter or sort change loses the
check. `keepHiddenCheckedRows` is ignored under `sortMode="server"` and `filterMode="server"` and
while a lazy source holds unloaded rows. Select-all checks the loaded rows and the skeleton rows,
and "all N matching" has no representation, so a bulk action over a server result has no valid
selection.

## Decision

One new provider prop, `totalRowCount?: number | null`, says that `data` is a window of a larger
result of that size (`null`: size unknown). It switches on two things.

1. Remembered checks. With `keepCheckedRows` and `totalRowCount`, a checked row that leaves `data`
   is remembered by row id (the `hiddenCheckedRowIds` set) and checked again when it returns. This
   works in every mode: client or server pagination, lazy rows, `sortMode="server"`,
   `filterMode="server"`. `keepHiddenCheckedRows` is not needed. Without `totalRowCount`, nothing
   changes.
2. Select all matching. `actions.selectAllMatching()` checks every row of the result. The store
   holds `allMatching` plus the ids the user unchecked. Rows that load later show as checked
   unless excluded.

`useDataGridSelectedRows()` reads the selection as a value:

```ts
type SelectedRows =
  | { mode: "ids"; ids: readonly string[]; excludedIds: readonly []; count: number }
  | { mode: "allMatching"; ids: readonly []; excludedIds: readonly string[]; count: number | undefined };
```

- `ids`: the checked loaded rows plus the remembered ones. Unloaded rows have no id and are left out.
- `excludedIds`: remembered exclusions plus the unchecked loaded rows of the view.
- `count` in `allMatching`: `totalRowCount - excludedIds.length`, `undefined` when the size is unknown.

## Rules

- Row operations on checked rows (delete, duplicate, move, and their menu items) do nothing while
  `allMatching` is on. The grid does not hold the rows. The consumer reads the selection and calls its
  own endpoint. `onBeforeDeleteRows` is not called.
- Escape, `clearSelection()`, `setSelection(null)`, an empty controlled `selection`, and the header
  checkbox set to off clear `allMatching` and the exclusions.
- The remembered set holds at most `MAX_HIDDEN_CHECKED_ROWS` (100,000). In ids mode the rows beyond
  the cap are dropped and a development warning names it. In `allMatching` mode an overflow of
  exclusions clears `allMatching` instead, because dropping an exclusion would select more rows.
- A lazy skeleton row stays checked in `allMatching` and cannot be excluded: it has no id.
- Never spread a selection channel; the carry walks view rows once per rebuild, only while
  `allMatching` is on or hidden ids exist.
- `selectAllMatching()` without `totalRowCount` or `keepCheckedRows` is a no-op with a development
  warning.
- The status bar and live region count loaded checked rows; `useDataGridHiddenCheckedCount()` is `0`
  while `allMatching` is on.

## Modes

| Mode | Behavior |
|---|---|
| Local array, client pagination | no `totalRowCount`: unchanged. With it (data is the whole result), the same rules apply |
| Server pagination | pass `totalRowCount={total}`; checks survive a page change; `allMatching` available |
| Lazy, known total | pass `totalRowCount={total}`; checks survive an eviction |
| Lazy, unknown total (infinite) | pass `totalRowCount={null}`; `count` is `undefined` in `allMatching` |
| `sortMode` or `filterMode` `"server"` | remembered checks stay on (they used to be ignored) |
| Controlled `selection` | still carries the visible rows only |

## Server contract

For a bulk action the consumer sends the request spec it already holds (sort, filter, search),
and then `excludedIds` in `allMatching` mode, or `ids` in `ids` mode. The server evaluates the spec
and applies the action to every matching row except the excluded ones. Bounds: at most
100,000 ids from the grid; the server bounds them again and validates the filter tree.

## Tests

Unit (store): remembered checks across a data swap, a window with holes, `sortMode="server"`;
`selectAllMatching` rows and exclusions across a swap, uncheck then swap, overflow, clears;
`useDataGridSelectedRows` shapes; row operations gated; no-op without the prop.
Browser: a paginated grid keeps a check across pages; the demo's "select all matching" button.
