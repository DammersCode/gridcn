# Not part of 2.0

Internal record. Each item below came out of the 2.0 review as an API improvement or a perf idea and is not built in 2.0. The current behavior stays the documented behavior. Plans 008 and 010 are marked deferred in `plans/README.md`.

| Item | Idea |
|---|---|
| Required `getRowId` for row types without `id` | Conditional type on `DataGridSyncProps`; risks loose row inference |
| jsdom viewport fallback | Option or test helper for `clientHeight` 0 |
| `OverlayRect` for overlay plugins; `clampRect` and `renderedRowStart` aliases | Shared overlay primitive, clearer ctx names |
| `defineCommands<Row>()` | Infer command keys without module augmentation |
| One warning prefix | `[<item>]` everywhere |
| `useDebounce({ delayMs })` | Options object beside the number overload |
| `defineColumns<TRow, ExtraTypes>()` | Custom cell types without augmentation |
| `useDataGridRowTargets()` | Public row-target resolution |
| `RowActionResult` from `reorderRows` and `moveRowsBy` | Uniform row action results |
| `direction` on `DataGridProvider` | One locale record feeds provider and root |
| Tab hand-off at the last cell | Actions that return Tab to the browser |
| Persistent or chunked data and view structure | Removes the array copies on a live edit at 100k rows. Stage 0 measured the copy at about 90% of the tick, but the prototype accessor turns the state object into dictionary mode (reads 40 to 70% slower); see `perf-row-storage.md` |
| Sort keys for date, select, checkbox, url, longText; coalesced `immediate` ticks | Accepted, see `perf-sort-1m.md` |
| Header override, async `formatCell`, import `valueMode: "raw"`, print `source` and `css`, import `validateRow` | See `io-hooks-2.0.md` |
| Server import preview, streaming XLSX writer, server search | See `io-server-scope.md` |
| "Not" toggle and a summary sentence in the filter group header | `FilterGroup` has no negation in the model, the server spec, or the query layer; the toggle needs all three |

## Built after the review

| Item | Where it lives |
|---|---|
| Sequential (cursor) source eviction | `use-data-grid-server-rows.sequence-eviction.test.tsx`; a cursor scroll source evicts past `maxLoadedRows` like a random access one |
| Row grouping on the client, in `useDataGridServerRows` (scroll and pages), and in the query layer (`fetchRows` with `groupBy`) | `row-grouping-spec.md`, `server-grouping-spec.md`, `orm-query-layer-spec.md` |
| Root filter join (`filterJoin`) on the client, the server spec, URL state, and saved views | `filter-root-join.md` |

Chunked row storage stays stopped at stage 0: the copy is about 90% of a live edit tick at 100k rows, and the prototype accessor reads 40 to 70% slower (`perf-row-storage.md`).
