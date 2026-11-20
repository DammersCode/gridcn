# Glossary

The words gridcn uses. Use them in code, comments, docs, skills, messages, and commit messages.
Add a term here before you introduce it. `scripts/verify-vocabulary.mjs` (run by `pnpm lint`)
rejects the "Do not use" words that it can check.

`content/docs/(learn)/terms-help/terms.mdx` is the reader-facing subset. This file is the source: edit it first, then
mirror the change there.

## Data

| Use | Meaning | Do not use |
|---|---|---|
| operation (`ops` in code) | One record of a change to one row: `insert`, `update`, `delete`, or `move`. `DataChange.ops` holds a batch. Write "operations (`ops`)" at first use on a page. | op, ops (in prose) |
| row operation | The `source` value `"row-operation"` marks a change from an insert, duplicate, delete, or move of rows. | row-op |
| change | One `onDataChange` call: a batch of operations plus its `source`. | |
| row id | The stable id of a row: its `id` field, or the value that `getRowId` returns. Selection, editing, undo, and redo address rows by it. | id-keyed (write "by row id") |
| view index | A row's position in the sorted and filtered list the user sees, on the shown page of a paged grid. With `groupBy`, an entry below 0 names a group row. | view space, display index |
| data index | A row's position in your `data` array. | |
| frame reorder | The `reorder: "frame"` value of `updateCells`: the values write at once, and one re-place at the next animation frame covers every patched row. | batched reorder |
| row group | The rows that share one group key under `groupBy`. Not a column group and not a filter group. | |
| group row | The view row that heads a row group. It holds no data. A `viewIndex` entry below 0 names it. | |
| group key | The stored value that the rows of a row group share. `null`, `undefined`, and `""` form one empty key. | |
| group path | The group keys from the outermost level down to one row group: one `{ columnId, key }` per level. A server request names the group whose children it reads with `groupPath`. | |
| group level | The place of a group column in `groupBy`. The first column is level 0. | |
| child list | The rows or the groups that a server grid holds for one open row group, or for the top level. One request reads one child list, named by `groupPath`. | |
| expanded state | `{ mode, ids }`: the row groups that differ from `mode`, named by group id. It decides which groups show their rows. | |
| checked row | A row whose marker checkbox is on, kept in the row channel of the selection. | ticked row |
| data mode | One way the grid gets its rows: local array, client pagination, server pagination (pages mode), scroll mode, controlled state, server sort, server filter, or write-through to your own API. `research/parity-matrix.json` lists each feature against each data mode. | source kind |
| checked rows lifetime | How long the checked rows last: `'until-click'`, `'until-cleared'`, or `'across-filters'`. Set by the prop `checkedRowsLifetime`. | keep checks, remember checks |
| hidden checked row | A checked row that a filter, a page change, or a window move takes out of the view. `checkedRowsLifetime="across-filters"` remembers it by row id, outside the row channel. The grid's row operations never act on it. | invisible check, filtered-out selection |
| block move | Moving several rows so they land next to each other in their current order: `reorderRows(rows, to)`. `moveRowsBy(rows, delta)` shifts each row and keeps the gaps. | bulk move |
| commit | Check a value with `validate` and write it to the data. | |
| controlled / uncontrolled | `data` puts the state in your code. `defaultData` seeds the grid once. | |
| spec | What the user chose: sort, filter, and search text. `ServerSpec` (`{ sorts, filters, searchText }`) carries it to `fetchRows`; the page or the row range travels beside it. The mode decides who applies it. | |
| request, answer | What `fetchRows` receives (`spec`, `start`, `end`, `cursor`, `signal`, plus `page` and `pageSize` in pages mode) and what it resolves (`rows`, `totalRowCount`, `hasMore`, `nextCursor`). The hook validates every answer. | response, payload |
| block | The fixed-size slice of rows that scroll mode requests: `[k * blockSize, (k + 1) * blockSize)`. Block 0 is always the first request. While grouped, a block is a slice of one child list. | page (pages mode only), chunk |
| pages mode | `useDataGridServerRows` with `mode: "pages"`, the default: the server answers one page per request. The data modes matrix and the sidebar call it "Server pagination". | |
| scroll mode | `useDataGridServerRows({ mode: "scroll" })`: the hook fetches the blocks the rendered rows need. A first answer with `totalRowCount` and no `nextCursor` gives random access: the grid shows that many rows. Any other first answer gives a sequential source. | lazy mode |
| sequential source | A scroll-mode source whose first answer carries `nextCursor`, or neither a count nor a cursor. `useDataGridServerRows({ mode: "scroll", source: "sequential" })` asks for it. Blocks load in order, one at a time; the grid shows the loaded rows plus one block of skeleton rows until `nextCursor: null` or `hasMore: false` ends it. | infinite rows, open-ended source |
| wanted range | The rendered rows grown by `overscan` on each side and rounded out to blocks. Scroll mode loads the blocks of it. | |
| keep range | The wanted range grown by one more block on each side. Scroll mode aborts and evicts only blocks outside it. | |
| eviction | Unloading loaded rows back to holes, so a hole renders as a skeleton again. `maxLoadedRows` and `evict()` do it. | purge |
| revalidation | A `refresh()` that the hook runs on a timer (`revalidateIntervalMs`). | polling, auto-refresh |
| prefetch | The pages-mode request for the page after the current one, made before the user asks for it (`prefetchNextPage`). | preload |
| row range | `RowRange`: `{ start, end }` over rows, `end` excluded. A scroll-mode request asks for one. | range (a range is a cell selection) |
| value query | The text a `fetchFilterValues` request carries as `query`. The server lists the values that match it. | value search |
| server grid | A grid with `sortMode="server"` and `filterMode="server"`. Your backend applies the spec and the grid shows the answer. | |
| server mode | How a feature behaves when your server holds the rows, the sort, or the filter: `sortMode` or `filterMode` `"server"`, or `useDataGridServerRows`. The heading of that section on a feature page. | |
| result | Every row that matches the spec on the server. `data` holds the loaded rows of it. | result set, dataset |
| sort locale | The BCP 47 tag that orders text compares in a client sort, text range filters, and filter value lists. The `sortLocale` prop sets it, then `locale`, then `"en-US"`. | |
| row count | The size of the result. `totalRowCount` names it on the pager, the pagination hooks, URL pagination, and the provider prop that the hook's `gridProps` carries. `null` means unknown. | row total, count |
| paged view | A grid with `pageSize` or `defaultPageSize`. `data` stays whole. The sorted and filtered list is the full view, and `viewIndex` holds the shown page of it. `fullViewOf(viewIndex)` returns the full view. | sliced data, page slice |
| all matching | The whole result as the target of a bulk action. `selectAllMatching()` turns it on and the status bar offers it. | select everything |
| gate | A prop function that the grid calls before it acts, for example `processPaste` or `createRow`. It returns a value or a promise. | hook (for props), interceptor |
| gate pending | The state of a gate whose promise has not settled. `useDataGridGatePending()` reads the gate names; the root carries `data-gate-pending`. | gate busy, gate loading |
| seed | The initial value a `default*` prop gives once, at mount. | |
| push | A change that your code writes from the server: `updateCells`, `updateRows`, or `deleteRows` with `source: "stream"`. A push is not a save: it never reaches `onSave`. | stream update (in prose), live update |
| push verdict | The `UpdateCellsVerdict` that `updateCells` and `updateRows` return: the count of cells the call wrote, and the patches it skipped with a reason. | |
| stale row | A loaded row that a push changed in a column the server spec reads. It keeps its place and carries `data-row-stale` until the server places it again. | outdated row |
| reshape | A `refresh()` that asks the server to place pushed rows again. `reshape()` runs one, and `reshapeDelayMs` runs one after a push (off by default). | re-sort request |

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
| rendered rows | The rows currently in the DOM. `onRenderedRowsChange` reports their range. The identifiers `windowStart` and `clampRectToWindow` call this range the window. | visible window |
| overscan | Extra rows or columns drawn beyond the viewport edge. | |
| grid origin | The row that anchors the rows canvas. It trails the first rendered row and moves only when the rendered rows drift far from it. | |
| jump | A scroll of more than the viewport height plus 1,600 px in one scroll tick. After a jump, the grid mounts only the base overscan. | |

## Structure

| Use | Meaning | Do not use |
|---|---|---|
| saved view | A named copy of the sort, filters, search, and column layout, kept by `data-grid-views` in a storage adapter. It holds no rows and no selection. Not the view index. | |
| add-on | An optional registry item you install, such as `data-grid-fill`. It ships hooks and components. | addon, extension |
| core | The `data-grid` item. Add-ons build on it. | |
| hosted registry | The `@gridcn` registry that serves the most recent deployment of `main`. | |
| pinned release | A release installed with `#<ref>` on the GitHub registry path. | fixed release |
| plugin | A runtime `DataGridPlugin` object in the `plugins` prop. Many add-ons install one; not every add-on does. | |
| row marker | The narrow column at the start side that shows a row number, a checkbox, or a drag handle. | gutter |
| drag handle | The control you drag to reorder a row or a sort entry. | grip |
| cell type | The kind of value a column holds, for example `text` or `number`. | column type |
| accessor | The `accessorKey` or `accessorFn` that reads a column's value from a row. | |
| band | A fixed strip of rows above or below the body, such as pinned rows. A group row never enters a band. | |
| aggregate row | A pinned row that `aggregateRow` or `serverAggregateRow` declares. The band computes its values and reads them by column id. | totals source |
| server aggregate | A value for a band that a server computes for the whole result of the current spec. | |
| lookup | A cell type whose options a server searches as the user types. It stores a value and a label. | |
| column group | A named set of columns, or of other groups, that share one header above their own headers. `columnGroups` defines it. | column span, super header |
| header row | One level of the header block. Group levels come first, and the column headers fill the last row. | |
| start side, end side | The two ends of the inline axis. The start side is the `pin: "start"` zone, the end side the `pin: "end"` zone; in a left-to-right page start is left and end is right, in a right-to-left page the reverse. | left side, right side (for pin sides), pinned left, pinned right |

## Selection and input

| Use | Meaning | Do not use |
|---|---|---|
| active cell | The one cell that has focus and receives typing. | focused cell, cursor |
| anchor | The cell where a selection started. | |
| range | A rectangle of selected cells. | |
| filter menu | The toolbar menu where the user builds filters from filter rows and filter groups. `DataGridFilterMenu` is the built-in one. | filter builder |
| quick search | The toolbar search that highlights matches and never filters rows. | |
| find and replace | The add-on panel that finds text through the quick search and replaces it in one match or in all matches. A replace writes one change with the source `"replace"`. | search and replace |
| export source | The function that returns the rows of the whole result for an all-rows export. It gets the `spec` and a `signal`. | |
| import check | The server answer to `checkImport`: the rows it refuses and the counts it reports, read before `onImport` runs. `parseImportRows` is the query-layer side. | import validation (that is `validate`), dry run |
| set filter | A filter that keeps or drops rows by a list of values. It uses the `isAnyOf` or `isNoneOf` operator. | value filter |
| filter node | One entry of `filterState`: a filter row or a filter group. | filter item, filter entry |
| filter join | How the top-level entries of `filterState` combine: `and` (default) or `or`. `filterJoin` sets it. A filter group has its own join. | top-level connector |
| filter group | A box of filter nodes that match together. Its join is `and` (every child must match) or `or` (any child). A group holds one more group at most. `not: true` negates it: it matches the rows its children do not match. The top level of `filterState` combines with the filter join. | filter bracket, nested filter, join operator |
| custom operator | A filter operator a column registers in `filter.operators` with an `id`, a `label`, an `input` shape, and an optional `match`. A server vocabulary uses it to name its own filters. | custom filter type, plugin operator |
| set values | The list of values that a header filter or an `isAnyOf` input offers. They come from the loaded rows, or from `fetchFilterValues` when the grid has it. Each has a `value` (what the filter stores) and a `label` (what the list shows). | value list, facet list, distinct list |
| header filter | The filter button in a column header. It opens a popover with the set filter of that column. `renderHeaderFilter` places it, and `DataGridHeaderFilter` is the built-in one. | column filter popup |
| tap | A touch press that lifts within 10 px and under 500 ms. A tap selects; two taps on one cell edit. | click (for touch) |
| long-press | A touch press held for 500 ms without moving more than 10 px. It opens the context menu. | press and hold, tap and hold |
| selection handle | One of the two circles at the corners of a touch selection. Dragging one extends the range. | range handle |
| coarse pointer | An input whose `(pointer: coarse)` media query matches, such as a finger. Hit areas grow under it. | touch mode |
| live region announcement | The text the grid's live region reads to a screen reader: a row move, the number of checked rows, or the result count. The region waits 500 ms after the last change. | |
| result count | The number of rows in the view after a filter or sort change. `announceResults` turns its announcement on. | |

## Writing

| Use | Meaning | Do not use |
|---|---|---|
| override | A prop or callback that replaces default behavior. | escape hatch |
| paste result | The value `pasteFromClipboard` resolves: `"ok"` (a paste started), `"permission-denied"` (the browser denied the clipboard read), `"empty"` (the clipboard held no text), or `"refused"` (the grid started no paste). | paste outcome |
| blocking rule | A column rule that stops the commit of a value it rejects. It is the default of `validationMode`. | |
| soft rule | A column rule that commits the value it rejects and flags the cell. `validationMode: "warn"` turns it on. | |
| save acknowledgement | The answer of `onSave`: nothing (accepted), `{ rejected }` (named rows or cells refused), or a rejected promise (everything refused). `onCommentSave` answers a comment save the same way: nothing, `{ comment }`, `{ rejected }`, or a throw. | write result |
| save status | `"saving"` while an `onSave` promise is pending and `"failed"` after a refusal. `useDataGridRowSaveStatus` reads it. | save state |
| save conflict | A refused save for which the server sent its current row. `resolveSaveConflict` decides whether the row becomes the server's row, stays as it is, or becomes a merged row. | edit conflict |
| id swap | Replacing the client id of a row with the id the server assigned, through `actions.replaceRowId`. | rekey, rename id |
| save | Sending a change to a server through `onSave`, or a comment write through `onCommentSave`. A save is accepted or refused; a refusal is reverted. | persist, sync |
| Standard Schema | The shared validator interface that Zod and Valibot implement. | |

## Comments

| Use | Meaning | Do not use |
|---|---|---|
| comment marker | The corner shape on a commented cell: filled for an unresolved comment, a ring for resolved comments only. Not the row marker. | comment badge, comment flag |
| anonymous comment | A comment with no `author`. It comes from a write with no `currentUser`. Anyone can edit and delete it by default. | guest comment |
| comment author | The `author` of a comment: a snapshot of the writer with an `id`, and optionally a `name` and a `color`. The identity is `author.id`. | commenter |
| comment address | The pair `rowId` and `columnId` that names the cell of a comment. A comment never holds a view index. | cell key |
| comments popover | The non-modal dialog that lists the comments of one cell and holds the composer. `Shift+F2`, the comment marker, or the "Comments…" menu item opens it. | comment panel, comment thread |
| optimistic write | A comment write that the popover shows at once, at `baseVersion + 1`, before `onCommentSave` answers. A refusal reverts it. | pending edit |
| unresolved comment | A comment with `resolved: false`. A cell with one unresolved comment counts as unresolved. | open comment |
| resolved comment | A comment with `resolved: true`. `hideResolved` hides the comment marker of a cell that has only resolved comments. | closed comment |
| comment draft | Text in the composer, an edit, or a delete confirm that the user has not submitted. It stays when the popover closes. | unsaved comment |
| comment conflict | The state of a comment write that a newer version from another client made stale. The popover offers the text again with Retry, Discard, or Save my version. Not the save conflict of a row. | collision |
| orphaned comments | The comments of a deleted row. They stay in the store, and `onOrphanedComments` reports them. | dangling comments |
| write id | The random id (`writeId`) that the add-on puts on each comment write. A record with the pending write id is the echo of that write. | request id |
| tombstone | The record of a deleted comment: an id, an address, and a version, with no text. It blocks an older upsert for 10 minutes. | deleted marker |
| echo | A record that comes back through `applyRemote`, a fetch answer, or the `comments` prop with the write id of a pending write. It confirms the write. | reflection, loopback |

## Server query layer

| Use | Meaning | Do not use |
|---|---|---|
| query plan | The checked form of a server request: a filter predicate, an order, a row range, and the columns to read. An ORM adapter runs it. | |
| column map | The list of columns a server request can name, from `defineColumnMap`. It is the allow-list and the projection. | schema, whitelist |
| ORM adapter | The add-on that runs a query plan with one ORM, such as `createDrizzleGridQuery`. Write "ORM adapter" for it and "driver adapter" for the Prisma database driver layer. | |
| driver adapter | The Prisma layer that connects the client to a database driver. It is not an ORM adapter. | |
| row scope | `rowScope`: equalities on `serverOnly` columns that every query of a factory adds with AND, such as the tenant. | tenant filter |
| blank operand | The empty value (`""`, `["", ""]`, `[]`) of a filter row that the user has not filled in. The query layer gives it the meaning the grid gives it. | empty value |
| native fragment | A piece of SQL in the type of one ORM, such as the `sql` fragment of Drizzle. `where(plan)`, `orderBy(plan)`, and `customOperators` use it. | |
| keyset cursor | The opaque string of key texts and a plan hash that resumes a page after the last row. | offset cursor |
| resume predicate | The OR form that selects the rows after a keyset cursor's row. | |
| plan hash | The digest of a parsed plan's filter and order. A keyset cursor with another plan hash is stale. | |
| key test | The `key` test: a raw comparison in the sort order of the database. | |
| id list test | The `ids` test: exact primary-key membership, bound as one parameter. | |
| validated change | What `validateChange` returns: the writes with scoped `where`s, and the refusals. | |
| write refusal | One refused row or cell of a validated change, in the shape of a `SaveRejection`. | |
