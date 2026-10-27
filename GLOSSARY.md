# Glossary

The words gridcn uses. Use them in code, comments, docs, skills, messages, and commit messages.
Add a term here before you introduce it. `scripts/verify-vocabulary.mjs` (run by `pnpm lint`)
rejects the "Do not use" words that it can check.

`content/docs/terms.mdx` is the reader-facing subset. This file is the source: edit it first, then
mirror the change there.

## Data

| Use | Meaning | Do not use |
|---|---|---|
| operation (`ops` in code) | One record of a change to one row: `insert`, `update`, `delete`, or `move`. `DataChange.ops` holds a batch. Write "operations (`ops`)" at first use on a page. | op, ops (in prose) |
| row operation | The `source` value `"row-operation"` marks a change from an insert, duplicate, delete, or move of rows. | row-op |
| change | One `onDataChange` call: a batch of operations plus its `source`. | |
| row id | The stable id from `getRowId`. Selection, editing, undo, and redo address rows by it. | id-keyed (write "by row id") |
| view index | A row's position in the sorted and filtered list the user sees. | view space, display index |
| data index | A row's position in your `data` array. | |
| checked row | A row whose marker checkbox is on, kept in the row channel of the selection. | ticked row |
| hidden checked row | A checked row that the current filter hides. `keepHiddenCheckedRows` remembers it by row id, outside the row channel. The grid's row operations never act on it. | invisible check, filtered-out selection |
| block move | Moving several rows so they land next to each other in their current order: `reorderRows(rows, to)`. `moveRowsBy(rows, delta)` shifts each row and keeps the gaps. | bulk move |
| commit | Check a value with `validate` and write it to the data. | |
| controlled / uncontrolled | `data` puts the state in your code. `defaultData` seeds the grid once. | |
| seed | The initial value a `default*` prop gives once, at mount. | |

## Keyboard actions

| Use | Meaning | Do not use |
|---|---|---|
| `clearContents` | Empties the selected cells. | deleteContents |
| `typeToReplace` | Typing over a cell replaces its value. | editReplace |
| `moveUpKeepSelection` (and Down, Left, Right) | Moves the active cell and keeps the selection. | retainMove* |

## Rendering

| Use | Meaning | Do not use |
|---|---|---|
| virtualization | Draw only the rows and columns in view, plus overscan. | windowing, windowed, row window |
| rendered rows | The rows currently in the DOM. `onRenderedRowsChange` reports their range. | visible window |
| overscan | Extra rows or columns drawn beyond the viewport edge. | |
| grid origin | The row line the rows canvas is positioned from. It trails the first rendered row. | |
| jump | A scroll farther than the viewport plus the largest velocity buffer. | |

## Structure

| Use | Meaning | Do not use |
|---|---|---|
| add-on | An optional registry item you install, such as `data-grid-fill`. It ships hooks and components. | addon, extension |
| plugin | A runtime `DataGridPlugin` object in the `plugins` prop. Many add-ons install one; not every add-on does. | |
| row marker | The narrow column at the left edge that shows a row number, a checkbox, or a drag handle. | gutter |
| drag handle | The control you drag to reorder a row or a sort entry. | grip |
| cell type | The kind of value a column holds, for example `text` or `number`. | column type |
| accessor | The `accessorKey` or `accessorFn` that reads a column's value from a row. | |
| band | A fixed strip of rows above or below the body, such as pinned rows. | |
| column group | A named set of columns, or of other groups, that share one header above their own headers. `columnGroups` defines it. | column span, super header |
| header row | One level of the header block. Group levels come first, and the column headers fill the last row. | |

## Selection and input

| Use | Meaning | Do not use |
|---|---|---|
| active cell | The one cell that has focus and receives typing. | focused cell, cursor |
| anchor | The cell where a selection started. | |
| range | A rectangle of selected cells. | |
| quick search | The toolbar search that highlights matches and never filters rows. | |
| find and replace | The add-on panel that finds text through the quick search and replaces it in one match or in all matches. A replace writes one change with the source `"replace"`. | search and replace |
| set filter | A filter that keeps or drops rows by a list of values. It uses the `isAnyOf` or `isNoneOf` operator. | value filter |
| header filter | The filter button in a column header. It opens a popover with the set filter of that column. `renderHeaderFilter` places it, and `DataGridHeaderFilter` is the built-in one. | column filter popup |
| tap | A touch press that lifts within 10 px and under 500 ms. A tap selects; two taps on one cell edit. | click (for touch) |
| long-press | A touch press held for 500 ms without moving more than 10 px. It opens the context menu. | press and hold, tap and hold |
| selection handle | One of the two circles at the corners of a touch selection. Dragging one extends the range. | range handle, drag handle |
| coarse pointer | An input whose `(pointer: coarse)` media query matches, such as a finger. Hit areas grow under it. | touch mode |
| live region announcement | The text the grid's one `role="status"` region reads to a screen reader: a row move, the number of checked rows, or the result count. The region waits 500 ms after the last change. | toast, aria message |
| result count | The number of rows in the view after a filter, sort, or join operator change. `announceResults` turns its announcement on. | match count (that is the quick search) |

## Writing

| Use | Meaning | Do not use |
|---|---|---|
| override | A prop or callback that replaces default behavior. | escape hatch |
| Standard Schema | The shared validator interface that Zod and Valibot implement. | |
