# Root join of the filter list

The top level of `filterState` combines with `"and"` or `"or"`. Groups keep their own `join`.

## Shape

- `filterState` stays a bare `FilterNode[]`. The root join is a second controlled pair: `filterJoin` / `onFilterJoinChange` plus the one-shot `defaultFilterJoin` (`"and"` | `"or"`, default `"and"`).
- Action `setFilterJoin(join)`. Store state `filterJoin`.
- An empty list is no filter, whatever the join. One entry reads the same under both joins.

## Evaluation

- Client: `viewFilters(mode, filters, join)` evaluates the list as one `or` group when `join` is `"or"` and the list holds two or more entries. `buildViewIndex` takes the same `filterJoin` option.
- Quick search never filters. `rowScope` ANDs on top: `rowScope AND (root filters joined by or)`.
- Header filters edit their own top-level entry (a set entry for their column). The join does not change. Under `"or"` that entry widens the result like any other root entry.

## Modes

| Mode | Behavior |
| --- | --- |
| Client | The store evaluates the join. |
| Controlled `filterJoin` | The prop wins; the grid emits `onFilterJoinChange` and waits. A sync skips the rebuild when the value is unchanged. |
| `sortMode`/`filterMode="server"` | The grid tracks the join and never filters. `ServerSpec.filterJoin` carries `"or"`. |
| Pagination, lazy source | A join change resets the page to 1 and drops stale rows, like a filter change. |

## Server contract

- Request: `ServerSpec` gains optional `filterJoin`. It is present only when `"or"`; absent means `"and"`. `serverSpecKey` includes it.
- Response: unchanged. The server evaluates `rowScope AND (root filters joined by filterJoin)`.
- Bounds: `parseServerSpec` accepts only `"and"` or `"or"` for `filterJoin` and throws a `ServerSpecError` at path `filterJoin` otherwise. The filter count and depth limits are unchanged.
- Query layer (`data-grid-server-query`): the root `combine` uses `spec.filterJoin === "or" ? "or" : "and"`. Conformance runs on SQLite and PGlite through both adapters against the client oracle.

## URL state and saved views

- URL: the root join is the `join` param when `"or"`. `"and"` is omitted. An old link with a flat list and `join=or` loads as `filterJoin: "or"` with that list, the same result as before. A link with groups and `join=or` keeps its previous meaning (one `or` wrapper is not added: the root join reads `"or"` directly). Values other than `and` or `or` are dropped.
- Saved views keep `filterJoin` beside `filters`. A view without it loads as `"and"`.

## Parity

Rows `filter`, `url-state`, `saved-views`, and `server-query` in `research/parity-matrix.json` name the join in their notes and evidence.
