# Checked rows lifetime

Status: 2.0. One prop, `checkedRowsLifetime`, replaces `keepCheckedRows`, `keepHiddenCheckedRows`, and `rememberCheckedRows`.

## Values

| Value | Meaning |
|---|---|
| `'until-click'` (default without a checkbox row marker and without `totalRowCount`) | A cell or column selection clears the checked rows. |
| `'until-cleared'` (default when `rowMarkers` shows a checkbox) | Checks stay across cell and column selections. Only Escape, Ctrl+A, a click on a row number, marker and header checkboxes, `clearSelection()`, and row deletes change them. Row operations act on the checked rows only. |
| `'across-filters'` | `'until-cleared'`, and a checked row that leaves the view is remembered by row id and checked again when it returns. |

## Mapping from 1.x

- Neither prop: `'across-filters'` with `totalRowCount`, else `'until-cleared'` when `rowMarkers` shows a checkbox (`'checkbox'`, `'both'`, or a `reorder-` mode with one), else `'until-click'`. An explicit value wins.
- `keepCheckedRows`: `'until-cleared'`.
- `keepCheckedRows` and `keepHiddenCheckedRows`: `'across-filters'`.
- `keepHiddenCheckedRows` alone had no effect in 1.x; drop it.

## Modes

- Client grid: `'across-filters'` remembers rows a client filter or a page change hides.
- Server grid (`totalRowCount`): `'across-filters'` remembers in every mode, and `actions.selectAllMatching()` needs it. `useDataGridServerRows` and the scroll hook set it.
- `sortMode="server"` or `filterMode="server"` without `totalRowCount`, or a lazy source with unloaded rows: `'across-filters'` behaves like `'until-cleared'` and warns once in development per instance.
- The remembered ids and "all matching" exist only under `'across-filters'`, so a cell click never has to release them. The select-all banner shows only under `'across-filters'`. Removing `totalRowCount` or changing the lifetime ends "all matching".
