# Spec: filter groups (issue #84)

Status: implemented in 1.3.0.

## Goal

Build "(Name contains A or B) and Country = X" in the filter menu. One global `joinOperator` made
every row share one connector, and header-filter value rows under `or` widened the result.

## Decisions

1. **Groups, not per-row connectors.** `filterState` is a tree: `FilterNode = FilterSpec | FilterGroup`,
   `FilterGroup = { filterId?, join: "and" | "or", filters: FilterNode[] }`. The top level always
   combines with `and`; `or` exists only inside a group. Each level shows one connector once.
   Rejected: a connector per row. Precedence stays invisible, a drag reorder changes the meaning, the
   row order is a second source of truth, and the header filter still widens.
2. **Depth cap 2.** A group may hold one more group; the menu, the URL parser, and `withFilterIds`
   share `MAX_FILTER_GROUP_DEPTH`. A deeper tree has no use that two levels cannot express.
3. **Evaluation.** A row survives when every top-level node matches. A group matches when every child
   (`and`) or any child (`or`) matches. Any `join` other than `"or"` evaluates as `and`. An empty group
   matches every row. Each leaf compiles once into `makeFilterTest`; a group compiles to one closure.
   The top level keeps the `indices.filter` narrowing loop, so a flat list runs the code it ran before.
4. **Breaking API.** `joinOperator`, `defaultJoinOperator`, `onJoinOperatorChange`,
   `actions.setJoinOperator`, `useDataGridJoinOperator`, and `DataGridReadState.joinOperator` are gone.
   Migration: `const filters = join === "or" ? [{ join: "or", filters: oldFilters }] : oldFilters`.
   A `FilterSpec[]` stays a valid `filterState`.
5. **Header filter owns the top-level set rows of its column.** It reads and writes only the
   top-level `isAnyOf`/`isNoneOf` rows. Because the top level is `and`, it always narrows. Set rows
   of the same column inside a group belong to the menu. Distinct values count the rows that pass
   every other top-level node. Header "Clear" removes the column's rows at every level and drops
   emptied groups.
6. **Menu.** The top level shows "Where" then static "and". A group is a bordered, indented box with
   its own row cell, grip, and remove button; its header holds "Match [any|all] of the following".
   A new group starts with one new row and the opposite join of its parent. Removing a group's last
   row removes the group. Reorder works among siblings only. The badge counts leaf rows.
7. **URL.** Legacy `col:op:value` segments stay. A group is an open segment `[or` or `[and`, closed by
   a `]` segment: `filter=country:equals:X,[or,name:contains:A,name:contains:B,]`. `[` and `]` are
   always percent-encoded inside ids and values. The parser is a linear stack; a deeper opener drops
   that subtree, a stray `]` is dropped, an unclosed group closes at the end, empty groups are
   dropped. Caps: 256 raw segments, 64 leaf rows, 16 groups. A legacy `join=or` is read only: when the
   tree has no group, the top-level rows wrap in one `or` group. Write-back clears `join`. A flat
   `and` list serializes byte-identically.
8. **Server contract.** The request carries `filters` as a tree and no `join`. A server validates the
   untrusted body before it builds a query: depth <= 2, <= 64 leaves, allowed column ids,
   `join` in `{and, or}`.

## Out of scope

Dragging a row between levels. Deeper nesting. A per-row connector.
