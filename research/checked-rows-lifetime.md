# Checked rows lifetime

Status: 2.0. One prop, `checkedRowsLifetime`, replaces `keepCheckedRows`, `keepHiddenCheckedRows`, and `rememberCheckedRows`.

## Values

| Value | Meaning |
|---|---|
| `'until-click'` (default) | A cell or column selection clears the checked rows. |
| `'until-cleared'` | Checks stay across cell and column selections. Only Escape, marker and header checkboxes, `clearSelection()`, and row deletes change them. Row operations act on the checked rows only. |
| `'across-filters'` | `'until-cleared'`, and a checked row that leaves the view is remembered by row id and checked again when it returns. |

## Mapping from 1.x

- Neither prop: `'until-click'`.
- `keepCheckedRows`: `'until-cleared'`.
- `keepCheckedRows` and `keepHiddenCheckedRows`: `'across-filters'`.
- `keepHiddenCheckedRows` alone remembered the rows a filter hid, and a cell click released them and the checks. No value keeps that mix: pick `'across-filters'` (checks stay on a cell click) or `'until-click'` (no memory).

## Modes

- Client grid: `'across-filters'` remembers rows a client filter or a page change hides.
- Server grid (`totalRowCount`): `'across-filters'` remembers in every mode, and `actions.selectAllMatching()` needs it. `useDataGridServerRows` and the scroll hook set it.
- `sortMode="server"` or `filterMode="server"` without `totalRowCount`, or a lazy source with unloaded rows: `'across-filters'` behaves like `'until-cleared'` and warns once in development per instance.
- `totalRowCount` alone no longer turns the memory on. The remembered ids and "all matching" exist only under `'across-filters'`, so a cell click never has to release them.
