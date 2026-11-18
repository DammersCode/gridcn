# Not toggle of a filter group

A filter group can be negated: `NOT (a AND b)`. The menu shows a "Not" toggle in the group header.

## Shape

- `FilterGroup` gains optional `not?: boolean`. Absent or `false` is an ordinary group. Writers store `not` only as `true`; no key means off. Existing specs, links, and saved views read the same.
- The top level is not negatable. A negated group around the entries gives `NOT (root entries)`, with the join of the group.
- No new store state, prop, or action: `not` rides in `filterState`, so `setFilters`, `filterState`, `defaultFilterState`, and `onFilterStateChange` carry it.

## Evaluation

- A negated group matches a row when its children, combined by its `join`, do not match. A NULL or empty cell is the empty text the leaf tests already read, so the leaf is `false` and the negation is `true`. `NOT (name equals "x")` keeps rows with an empty name.
- An empty group of either join is no filter, negated or not, on the client and in the query layer. A group whose only child is an empty group is not empty: the child matches every row, so the negation matches none.
- Quick search never filters and `rowScope` ANDs on top, so negation never reaches them.
- Header value filter and distinct values: the list is narrowed by the other top-level entries through the same row test, so a negated group narrows like any other group. A set row inside a negated group counts as any other filter; the header filter writes its own top-level entry.

## Modes

| Mode | Behavior |
| --- | --- |
| Local array, client pagination, lazy source with client filter | `makeFilterNodeTest` negates the group test. The incremental view update and the group view use the same test. |
| Controlled `filterState` | `not` is part of the tree. An equal tree skips the rebuild as before. |
| `sortMode`/`filterMode="server"`, server pagination, scroll mode | The grid never filters. `ServerSpec.filters` carries `not: true` on the group. `serverSpecKey` ignores `not: false`. A change of `not` resets the page and drops stale rows like any filter change. |

## Server contract

- Request: a group may carry `not: true`. The server evaluates `rowScope AND (filters)` with the group negated.
- `parseServerSpec` accepts `not` as a boolean. Another type throws a `ServerSpecError` at path `filters[i].not`. It returns `not: true` only. Filter count, group count, and depth limits are unchanged.
- Query layer: `Predicate` gains `{ t: "not"; item }`. `parseQuery` reads `not === true`, never throws on other values (as it does for `join`). Rendering: `((body) IS NOT TRUE)`, which is true when the body is false or NULL. A NULL cell makes a leaf `NULL` in SQL, so `NOT (body)` alone would drop that row, while the client keeps it. Conformance runs on SQLite and PGlite through both adapters against the client oracle, with NULL cells in the fixture.

## URL state and saved views

- URL: a negated group opens with `[notand` or `[notor`. An unnegated group keeps `[and` / `[or`. An older reader drops a `[not…` subtree (unknown join), so an old reader shows fewer filters, never a wrong one.
- A negated group that loses a child is dropped whole: on read (a dropped segment, a missing close, a list cut at its bound, a failed sanitize, a hidden or removed column) and on write (a term the reader would drop). Fewer terms inside a negation can narrow or widen the result the wrong way.
- Saved views keep `not: true` on the group. A view without it loads as before. `captureViewState` and the sanitizer keep `not` only when `true`.

## Menu

- The group header holds a toggle button before the add buttons. It shows `labels.toolbar.filterGroupNot` ("Not"), sets `aria-pressed`, and has the aria-label `labels.toolbar.filterGroupNotAriaLabel`.
- The summary sentence follows the state: "Any of the following are true…", "All of the following are true…", "None of the following are true…" (not + or), "Not all of the following are true…" (not + and). Labels `filterGroupNone` and `filterGroupNotAll`.
- The toggle edits the group through `updateNode`; off removes the key.

## Parity

Rows `filter`, `url-state`, `saved-views`, and `server-query` in `research/parity-matrix.json` name `not` in notes and evidence.
