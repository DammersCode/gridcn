# Not part of 2.0

Internal record. Each item below came out of the 2.0 review as an API improvement or a perf idea and is not built in 2.0. The current behavior stays the documented behavior. Plans 008 and 010 are marked deferred in `plans/README.md`.

| Item | Idea |
|---|---|
| Required `getRowId` for row types without `id` | Conditional type on `DataGridSyncProps`; risks loose row inference |
| Unique-value check in column `validate` | `ctx.getRows()` or a `unique` flag |
| jsdom viewport fallback | Option or test helper for `clientHeight` 0 |
| `OverlayRect` for overlay plugins; `clampRect` and `renderedRowStart` aliases | Shared overlay primitive, clearer ctx names |
| `defineCommands<Row>()` | Infer command keys without module augmentation |
| `data-row-changed`, `ColumnDef.align` | Shorter changed-row recipe |
| `useShortcutLabel` | Hydration-safe shortcut labels |
| One warning prefix | `[<item>]` everywhere |
| `settled` on `SelectionChangeDetails` | Distinguish drag ticks from the final change |
| `useDebounce({ delayMs })` | Options object beside the number overload |
| `createDataGridHooks<TData>()`, readonly `useDataGridViewIndex` | Typed store hooks |
| Sequential source eviction | Unload rows from the front |
| `onSave(change, { actions })` | Actions without a grid ref |
| `setColumnOrder` returns boolean | Tell a no-op from a move |
| `ColumnDef.sortIndicator` | Sort arrow on node headers |
| `actions.resetColumnLayout()` | One-call reset to column defs |
| `defineColumns<TRow, ExtraTypes>()` | Custom cell types without augmentation |
| `MarkerHeaderRenderCtx` `ariaLabel` and `toggleAll()` | Complete marker header ctx |
| `useDataGridRowTargets()` | Public row-target resolution |
| `RowActionResult` from `reorderRows` and `moveRowsBy` | Uniform row action results |
| `direction` on `DataGridProvider` | One locale record feeds provider and root |
| `SaveRejection.keep` | Keep the value and mark the cell |
| Progress for held bulk validation | Pending-batch state and attribute |
| `toolbar` prop on `<DataGrid>` | Render inside the provider before the root |
| Keyboard column move and resize | `moveColumnStart`, `moveColumnEnd`, header-menu items |
| Tab hand-off at the last cell | Actions that return Tab to the browser |
| Persistent or chunked data and view structure | Removes the array copies on a live edit at 100k rows |
| Date editor lazy-load | Accepted cost, see `perf-mount.md` |
| Sort keys for date, select, checkbox, url, longText; coalesced `immediate` ticks | Accepted, see `perf-sort-1m.md` |
| Header override, async `formatCell`, import `valueMode: "raw"`, print `source` and `css`, import `validateRow` | See `io-hooks-2.0.md` |
| Server import preview, streaming XLSX writer, server search | See `io-server-scope.md` |
