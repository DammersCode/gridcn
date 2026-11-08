# Selection over a server result

## Problem

Checked rows are view-row state, remapped by row id when the view rebuilds. A row that leaves
`data` drops out: a page change, a lazy eviction, or a server filter or sort change loses the
check. The memory of hidden checks (`checkedRowsLifetime="across-filters"`) is ignored under `sortMode="server"` and `filterMode="server"` and
while a lazy source holds unloaded rows. Select-all checks the loaded rows and the skeleton rows,
and "all N matching" has no representation, so a bulk action over a server result has no valid
selection.

## Decision

One new provider prop, `totalRowCount?: number | null`, says that `data` is a window of a larger
result of that size (`null`: size unknown). It switches on two things.

1. Remembered checks. With `checkedRowsLifetime="across-filters"` and `totalRowCount`, a checked row that leaves `data`
   is remembered by row id (the `hiddenCheckedRowIds` set) and checked again when it returns. This
   works in every mode: client or server pagination, lazy rows, `sortMode="server"`,
   `filterMode="server"`. Without `totalRowCount`, nothing
   changes.
2. Select all matching. `actions.selectAllMatching()` checks every row of the result. The store
   holds `allMatching` plus the ids the user unchecked. Rows that load later show as checked
   unless excluded.

`useDataGridSelectedRows()` reads the selection as a value:

```ts
type SelectedRows =
  | { mode: "ids"; ids: readonly string[]; groups: readonly SelectedGroup[]; excludedIds: readonly []; count: number; spec: ServerSpec }
  | { mode: "allMatching"; ids: readonly string[]; groups: readonly SelectedGroup[]; excludedIds: readonly string[]; count: number | null; spec: ServerSpec };
```

2.0 widens the type for server grouping (`research/server-grouping-spec.md`): `ids` in both modes
(`[]` in `allMatching`), `groups: []`, and `spec` in both modes. `readSelectedRows` adds `groups: []`
and ids-mode `spec`; `ids`, `excludedIds`, `count`, and every writer keep their behavior.

- `ids`: in `ids` mode, the checked loaded rows plus the remembered ones (unloaded rows have no id);
  in `allMatching` mode, explicit checks that override a group entry (empty until group checks ship).
- `excludedIds`: remembered exclusions plus the unchecked loaded rows of the view (inferred from
  gaps in the row channel, `store/selected-rows.ts:41-58`).
- `count` in `allMatching`: `totalRowCount - excludedIds.length`, `null` when the size is unknown.

## Rules

- Row operations on checked rows (delete, duplicate, move, and their menu items) do nothing while
  `allMatching` is on. The grid does not hold the rows. The consumer reads the selection and calls its
  own endpoint. `onBeforeDeleteRows` is not called.
- A change of `filterState` or `searchText`, and a programmatic `deleteRows`, also leave `allMatching` (the selection meant the old result).
- A `totalRowCount` that is negative or not finite is treated as `null`.
- Escape, `clearSelection()`, `setSelection(null)`, an empty controlled `selection`, and the header
  checkbox set to off clear `allMatching` and the exclusions.
- The remembered set holds at most `MAX_HIDDEN_CHECKED_ROWS` (100,000). In ids mode the rows beyond
  the cap are dropped and a development warning names it. In `allMatching` mode an overflow of
  exclusions clears `allMatching` instead, because dropping an exclusion would select more rows.
- A lazy skeleton row stays checked in `allMatching` and cannot be excluded: it has no id.
- Never spread a selection channel; the carry walks view rows once per rebuild, only while
  `allMatching` is on or hidden ids exist.
- `selectAllMatching()` without `totalRowCount` or `checkedRowsLifetime="across-filters"` is a no-op with a development
  warning.
- The status bar and live region count loaded checked rows; `useDataGridHiddenCheckedCount()` is `0`
  while `allMatching` is on. Under server grouping they read `count` instead
  (`research/server-grouping-spec.md` decision 10).

## Modes

| Mode | Behavior |
|---|---|
| Local array, client pagination | no `totalRowCount`: unchanged. With it (data is the whole result), the same rules apply |
| Server pagination | pass `totalRowCount={total}`; checks survive a page change; `allMatching` available |
| Lazy, known total | pass `totalRowCount={total}`; checks survive an eviction |
| Lazy, unknown total (infinite) | pass `totalRowCount={null}`; `count` is `null` in `allMatching` |
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

## Grouped selection (input for server grouping step 8, first slice: 2.0 only if #71 merges)

Under `groupMode="server"` the stored rule replaces the inference. Writer map while all matching is on:

- Relative writes move loaded leaf ids into or out of `excludedIds`: every `checkRowRange` step
  (Shift+click, Shift+Arrow/Home/End/PageUp/PageDown, marker drag; they adopt the current channel as
  base, `create-store.ts:276,1294,1366,1372`) and toggles (Ctrl/Cmd press, checkbox click,
  Ctrl+Shift+Space `toggleRow`; plain Space is `edit`, `default-keymap.ts:57`).
- `setAllRowsSelected(true)` (header checkbox, `toggleAllRows` Mod+Shift+E) removes the loaded view ids
  from `excludedIds` and keeps remembered ones (`create-store.ts:1381-1385`); `false` clears.
  `selectAllMatching()` clears exclusions.
- Writes that replace or clear the channel end all matching and apply as ids mode: plain press, tap,
  Shift+Space (`selectRow` without `additive`), `selectAll` Ctrl/Cmd+A
  (`select-all-progression.ts:71-77`), a plain column select (header click, Ctrl+Space; Ctrl+ and
  Shift+header keep the row channel, `selection/line-ops.ts:22-27`), Escape, `setSelection`, and a
  controlled `selection` that changes the channel (an equal echo changes nothing:
  `create-store.ts:1425,1007-1013`).
- Tests: one `selected-rows.test.ts` case per writer; `server-selection.test.tsx:195` rewritten to use
  a gesture; `select-all.browser.test.tsx` and `checked-rows.browser.test.tsx` stay green.
