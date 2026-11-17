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
| Sequential source eviction | Unload rows from the front |
| `defineColumns<TRow, ExtraTypes>()` | Custom cell types without augmentation |
| `useDataGridRowTargets()` | Public row-target resolution |
| `RowActionResult` from `reorderRows` and `moveRowsBy` | Uniform row action results |
| `direction` on `DataGridProvider` | One locale record feeds provider and root |
| Tab hand-off at the last cell | Actions that return Tab to the browser |
| Persistent or chunked data and view structure | Removes the array copies on a live edit at 100k rows. Stage 0 measured the copy at about 90% of the tick, but the prototype accessor turns the state object into dictionary mode (reads 40 to 70% slower); see `perf-row-storage.md` |
| Sort keys for date, select, checkbox, url, longText; coalesced `immediate` ticks | Accepted, see `perf-sort-1m.md` |
| Header override, async `formatCell`, import `valueMode: "raw"`, print `source` and `css`, import `validateRow` | See `io-hooks-2.0.md` |
| Server import preview, streaming XLSX writer, server search | See `io-server-scope.md` |
