# Spec: plugin system (W5-13, API-R5)

Decision record for one `plugins` prop that replaces the per-add-on wiring. Today every add-on that
reaches into the grid has its own seam: `overlayPlugins` and `rowBands` (`store/types.ts:165,173`),
`onUndo`/`onRedo` (`store/types.ts:67-69`), a tracker element the consumer must render inside the
root (`FillHandleTracker`, `data-grid-fill/fill-tracker.tsx:60-63`), and two store registrations
(`_registerFillHandlers`, `_registerPresenceViewSpaceActive`, `store/types.ts:815-821`). A third
party cannot add a seam, so it cannot write an add-on.

Order: W5-12 → W5-11 → W6-05 → W5-13 (decision 9).

## Decisions

### 1. The type

New sync prop `plugins?: readonly DataGridPlugin<TData>[]` on `DataGridSyncProps`. Types in the
block-root `types.ts`, exported from the consumer barrel:

```ts
export type DataGridPlugin<TData = unknown> = {
  name: string;                                   // unique per grid
  Overlay?: ComponentType<OverlayPluginCtx>;      // a component, rendered by DataGridOverlays
  rowBands?: PluginRowBands;
  onDataChange?(next: readonly TData[], change: DataChange<TData>, ctx: DataGridPluginCtx<TData>): void;
  commands?: Record<string, GridCommand<TData>>;  // W5-10 commands
  keymap?: Keymap;                                // binds this plugin's own commands only
  Mount?: ComponentType;                          // rendered inside DataGridRoot
};
export type PluginRowBands = { top?: readonly unknown[]; bottom?: readonly unknown[]; render(ctx: RowBandRenderCtx): ReactNode };
export type DataGridPluginCtx<TData> = { api: DataGridApi<TData> };
```

- `Overlay` is a component: `DataGridOverlays` renders `<p.Overlay key={p.name} {...ctx} />`.
  Today `OverlayPlugin` is a plain function that calls hooks inside `DataGridOverlays`' render
  (`overlays.tsx:251-258`), so adding or removing an overlay between renders changes the hook order,
  and `DataGridOverlays` sits in the compiler bail-out baseline
  (`scripts/compiler-bailouts.baseline.json`, entry `overlays.tsx`). With components it leaves the
  baseline.
- `PluginRowBands.render` is called as a plain function during the root's render and must not call
  hooks; a band that needs state renders a component inside the returned node.
- Method syntax on `onDataChange`/`render` keeps a typed plugin assignable to the store's erased
  `DataGridPlugin<unknown>` (the `GridCommand` bivariance rule).
- `RowBandRenderCtx` (`layout-context.ts:95`) gains `rowOffset`: the rows that earlier plugins put
  in the same band.
- `Mount` takes no props; it reads the grid through hooks (`useDataGridApi()`, root context).
- Rejected: per-cell members (`renderCell`, `cellClassName`). They would iterate plugins on the hot
  path; columns, cell types, and `getCellClassName` already cover cells.

### 2. Resolution

`createDataGridStore` resolves `plugins` at creation, so the server render has the band heights and
`aria-rowcount`. Later changes sync in W5-12's config phase (no view recompute). Resolution writes
one store field, `state.plugins` (`{ list, overlays, bands, mounts, observers }`), and merges the
plugin commands and keymaps into `state.commands` and `state.keymap` (W5-12 made both
store-held). Everything downstream reads these resolved fields, never the raw array.

### 3. Order and conflicts

Array order is precedence and visual order:

- Overlays paint in array order (a later plugin on top), all after the built-in range layers and
  before the active-cell ring (the existing rule at `overlays.tsx:251-258`).
- Top bands stack from the header down in array order; bottom bands stack top to bottom in array
  order. `aria-rowindex` stays contiguous across segments.
- `Mount`s render in array order after the root's `children`; observers run in array order.

Conflicts:

| Case | Rule | Why |
|---|---|---|
| Two plugins with the same `name` | Dev error; the later plugin is ignored | `name` is the React key and the identity; two fills would bind the pointer twice |
| Two plugins with the same command name | The later plugin wins; dev-warns once with both names | Same rule as the keymap merge |
| Consumer `commands` vs a plugin command | The consumer wins, silently | The app owner's explicit choice |
| Plugin command named after a built-in action | Dropped, dev-warns, unless the action is pluggable (decision 4) | A plugin never replaces core behavior |
| Plugin `keymap` entry for a name not in its own `commands` | Dropped, dev-warns | A plugin cannot rebind copy, paste, or navigation |
| Plugin binding equal to any `DEFAULT_KEYMAP` or consumer binding | That binding is dropped, dev-warns | A plugin never takes a key the grid or the app already uses, so `mod+c` stays copy |
| Merge order of keymaps | `DEFAULT_KEYMAP` ← plugin keymaps (array order) ← consumer `keymap` | The consumer always wins |

The custom-commands tie rule (spec 5c: the more specific binding wins, a non-default binding beats
a default) applies to consumer bindings only. Plugins never win a tie, because their colliding
bindings are already dropped. Rejected: first plugin wins — it inverts the precedence that the
keymap merge and object spread both use.

### 4. Pluggable built-in actions

`undo`, `redo`, `fillDown`, `fillRight` keep their `DEFAULT_KEYMAP` bindings
(`keyboard/default-keymap.ts:52-55`) and their `preventDefault` (so mod+R never reloads the page),
but lose their built-in bodies. A command with that name, from a plugin or from the consumer,
implements them without the shadow warning (`create-store.ts:706-715` exempts the four). Without
one the key is a no-op, as today without the add-on.

- Deletes `state.onUndo?.()`/`state.onRedo?.()` (`use-grid-interaction.ts:453-462`) and the
  `fillDown`/`fillRight`/`cancelFillDrag` parameters of `useGridInteraction`/`dispatchGridAction`
  (`use-grid-interaction.ts:75-80,234-238,443-452`) and of the global-shortcut layer
  (`use-data-grid-global-shortcuts.ts:34,95-97`). Commands already run before the built-in switch
  (`use-grid-interaction.ts:244`), so global shortcuts reach plugin commands with no new path.
- Escape mid-drag: fill's `Mount` adds a capture `keydown` listener on the grid container while a
  drag is active and cancels the drag; the built-in `cancel` still clears the selection, as today.
  Rejected: a plugin pre-dispatch hook on every key — per-key plugin iteration for one add-on.
- `when: (ctx) => !ctx.readOnly` on the fill and history commands only keeps the key free for the
  browser in a read-only grid. The write guard is the store: `commitChange`, `applyCellUpdates`,
  `commitCellEdit`, `commitCellValueAt`, and every other write action no-op when `readOnly` is
  set. Most data-write actions already check it (`data-write.ts:327,349,371,406,504,552,578,624`);
  `commitCellEdit` (236) and `commitCellValueAt` (306) do not and gain the check. Today undo runs in
  a read-only grid (`use-grid-interaction.ts:453-456` has no `readOnly` check); this closes that.

### 5. What a plugin can reach

Plugins are trusted code: the consumer installs their source through shadcn and reviews it like
their own. Nothing in a browser realm isolates a plugin from the page, so the handle is an API
contract, not isolation. The contract keeps a correct plugin from breaking store invariants by
accident and keeps every data write behind the store's guards (readOnly, validation, controlled
mode, `onDataChange`).

A plugin gets the imperative handle: `DataGridPluginCtx.api`, `GridCommandCtx.api`, and
`useDataGridApi()` inside `Mount`/`Overlay`. The handle changes (**Breaking** for W5-09's
`DataGridApi`):

| Member | Today | After |
|---|---|---|
| `store` | the zustand `StoreApi` with `setState` (`types.ts:673`, `store/api.ts:23`) | a runtime wrapper `{ getState, subscribe }`; `setState` does not exist on it |
| `getState()` type | full state | `DataGridReadState`: no `on*` consumer callbacks, no internals (`dataWrite`, `scrollToCellImpl`) |
| `actions` | the full object incl. `_syncProps`, `_register*` | public actions only (below) |

- State reads return the store's live objects (`data`, `selection`, `columns`). They must not be
  mutated; the docs say so, and no copy is made (a copy per read would cost O(n) on the hot path).
- The `_` actions move out of `state.actions` into a store-private table reached through an
  internal accessor (`getInternalActions(store)` in `store/`, exported from neither barrel). Its
  users today are all in the core block: the provider (`_syncProps`, `_subscribeEditEnd`), the
  root (`_registerScrollToCell`), `body.tsx` (`_pruneFlashingCells`), the interaction hook
  (`_moveActiveCell`), and both clipboard hooks (`_deleteCellsById`). So `getState().actions`,
  `useDataGridActions()`, and `api.actions` expose public actions only.
- Who holds `setState`: the store module, and the consumer through `useDataGridStoreProps`
  (`provider.tsx:112`, the store-ownership path). `useDataGridStoreApi` (sdk after R-51) returns
  the read-only wrapper.
- Consumer events stay store-fired. Fill fires `onValidationError` itself today
  (`data-grid-fill/use-fill-handle.ts:250`), and so does paste (`clipboard/use-grid-clipboard.ts:353`);
  both move into `applyCellUpdates(updates, source, rejected?)`, which fires the event after the
  write (the R-52 pattern for `updateCells`).
- Trusted write paths: `applyCellUpdates` takes writes the caller already validated
  (`resolveBulkWrites`), and `updateCells({ skipValidation: true })` skips `validate`. Both still
  honor `readOnly` and the per-column read-only checks; a plugin that uses them owns the validation.
- Enough for the shipped add-ons: fill reads selection, data, columns, and cell types and writes
  through `applyCellUpdates`, `flashCells`, `selectCellAt`, `extendToAt`; history writes through
  `commitChange`; pinned rows only render; presence reads and subscribes.
- Rejected: plugins get `setState` — one faulty plugin corrupts the view index or selection for
  everyone. Rejected: a worker or iframe sandbox — overlays and bands must render inside React.

### 6. Hot path

- No per-cell or per-row plugin iteration (decision 1).
- Overlays: one resolved array of components in `DataGridOverlays`; the same cost as
  `overlayPlugins` today.
- Bands: concatenated once per registry change; the root reads one memoized object
  (`useDataGridRowBands`, `store/hooks.ts:204`) and sums segment counts for heights and
  `aria-rowcount`.
- Keys: commands and keymaps merge once per registry change; dispatch stays one map lookup.
- Observers: O(plugins) per data-change emission (per gesture or stream tick, never per cell). One
  helper `emitDataChange(s, next, change)` replaces the nine `s.onDataChange?.()` sites in
  `store/data-write.ts` (227, 287, 317, 377, 444, 529, 565, 595, 653). It runs AFTER the store
  `set`, so an observer that reads the store or writes again (`commitChange`) sees the committed
  state: first the consumer callback, then each observer inside its own try/catch, so a throwing
  plugin logs and does not stop the others. Today every site calls `onDataChange` before `set`
  (for example `data-write.ts:227-228`, `316-318`).

### 7. Identity across renders

- `_syncConfig` compares the incoming list entry by entry: same `name` and every member `===`.
  An equal list reuses `state.plugins` and the merged `commands`/`keymap`, so no store field
  changes identity and nothing re-renders (the R-38 rule for `cellTypes`). Inline
  `plugins={[fill, history, pinned]}` is fine, and so is an inline plugin literal with stable
  members.
- A member that changes rebuilds only what it feeds (a new `rowBands` rebuilds `bands`).
- `Mount` or `Overlay` identity change remounts the component (state lost); dev warns once per
  plugin.
- A plugin instance attaches to one grid. A module `WeakMap` from plugin object to store records
  the attachment; a second grid resolving the same object is a dev error. History, for example,
  keeps one stack, and two grids would interleave their changes.
- History takes `ctx.api` from the `onDataChange` call that recorded the entry, and undoes through
  that grid's `commitChange`.
- The add-on hooks return memoized plugin objects. Pinned rows' `rowBands` changes when its rows
  change, which is a real change.

### 8. Add-on mapping

| Add-on | Today | Plugin members | Hook result |
|---|---|---|---|
| fill | function plugin in `overlayPlugins`, `<FillHandleTracker />` in the root, `_registerFillHandlers` | `Overlay`; `Mount` (the pointer engine, Escape cancel); `commands` `fillDown`/`fillRight` (they read the handlers from the fill store the `Mount` writes) | `useDataGridFill(opts)` → `{ plugin }` |
| history | `onDataChange`/`onUndo`/`onRedo` pass-through, `data`/`setData` options | `onDataChange` (records; skips its own `source: "history"` emissions); `commands` `undo`/`redo` via `ctx.api.actions.commitChange(inverse)` | `useDataGridHistory({ capacity, recordSources, datasetKey })` → `{ plugin, canUndo, canRedo, historySize, undo, redo, clear, record }` |
| pinned-rows | `rowBands` prop | `rowBands` | `useDataGridPinnedRows({ topRows, bottomRows })` → `{ plugin }` |
| presence | function plugin in `overlayPlugins`, `_registerPresenceViewSpaceActive` | `Overlay`; `Mount` (dev only: subscribes to `viewIndex`/`visibleColumns` and warns once when rows or columns move under a view-space entry) | `useDataGridPresence()` → `{ plugin, setPresenceHighlights, … }` |

Stay plain components or hooks:

| Add-on | Why |
|---|---|
| context-menu | `DataGridContextMenu` wraps the grid element as the menu trigger; a `Mount` cannot wrap its parent. `DataGridHeaderDropdown` stays a `renderHeaderMenu` value. |
| keybindings, toolbar, sort-list, pagination bar, io buttons | UI the consumer places in their own layout |
| url-state | Owns controlled props (`sortState`, `filterState`, …); a plugin cannot own a prop |
| lazy | Owns `data`, `getRowId`, `onDataChange`, `onRowWindowChange` (`gridProps`); `DataGridLazyGuard` stays a component |
| global shortcuts | `DataGridGlobalShortcuts` is a placed component with its own config |
| pinned-rows aggregate | `DataGridAggregateReporter` feeds the band rows from inside the provider |

`useDataGridState` keeps its controlled quick-start shape and returns the history plugin as
`history.plugin`; `onUndo`/`onRedo` leave its spreadable result.

Core removals: `overlayPlugins`, `rowBands`, `onUndo`, `onRedo` (sync props and state,
`EMPTY_OVERLAY_PLUGINS`/`EMPTY_ROW_BANDS` in `store/compute.ts:124-127`, the two identity checks in
`store/commit.ts:87-95`); `fillHandlers`, `_registerFillHandlers`, `useDataGridFillHandlers`;
`presenceViewSpaceActive`, `_registerPresenceViewSpaceActive`, and `warnViewSpacePresenceStale`
(`create-store.ts:216-222`) with its 13 calls (8 in `create-store.ts`, 5 in `store/data-write.ts`).
`_registerScrollToCell` stays: it carries the root's DOM implementation, not add-on wiring.

### 9. Dependencies

- W5-12: `plugins` syncs in the config phase; plugin keymaps merge into the store-held `keymap`;
  the command ctx reads the store-held `readOnly`; the root renders `Mount`s from the store.
- W5-11 lands before W6-05 and W5-13 (the plan's queue is W5-12 → W5-11 → W6-05 → W5-13).
- W6-05 `actions.commitChange(change)` is history's write path in controlled and uncontrolled
  grids. W6-05 must define: a no-op on `readOnly`; the emit after `set` (decision 6); the row-op
  guards (open editor, active sort/filter for moves, lazy holes); pass-through for
  `source: "history"` (the change is applied and emitted as given, never re-tagged). Rejected:
  keeping history's `setData` option — controlled-only, and the write bypasses `readOnly` and the
  row-op guards.
- R-47 (handle anywhere under the provider), R-51 (`useDataGridStoreApi` in the sdk), and R-52
  (store-fired `onValidationError`) land first.

## Migration

| Old | New |
|---|---|
| `overlayPlugins={[fillPlugin, presencePlugin]}` | `plugins={[fill.plugin, presence.plugin]}` (**Breaking**) |
| `OverlayPlugin` (a function called during `DataGridOverlays`' render) | `DataGridPlugin.Overlay`, a component taking `OverlayPluginCtx` props (**Breaking**) |
| `<FillHandleTracker />` inside `DataGridRoot` | Delete it (**Breaking**) |
| `rowBands={pinned.rowBands}` | `plugins={[pinned.plugin]}` (**Breaking**) |
| `useDataGridHistory({ data, setData, getRowId })` plus `onDataChange={h.onDataChange} onUndo={h.undo} onRedo={h.redo}` | `useDataGridHistory({ … })` plus `plugins={[h.plugin]}`; keep your own `onDataChange` (**Breaking**) |
| `onUndo`/`onRedo` with your own undo | `commands={{ undo: { run }, redo: { run } }}` (**Breaking**) |
| `RowBandsSpec` (`topRows`, `bottomRows`, `renderBand`) | `PluginRowBands` (`top`, `bottom`, `render`); ctx gains `rowOffset` (**Breaking**) |
| `DataGridApi.store: StoreApi` | `{ getState, subscribe }` wrapper (**Breaking**) |
| `useDataGridActions()` / `api.actions` / `getState().actions` with `_` members | Public actions only (**Breaking**) |
| `useDataGridStoreProps` | Unchanged: it keeps the writable store for the consumer that owns it |
| `useDataGridFillHandlers` | Removed (**Breaking**) |

## Test plan

Unit (`test/plugins.test.tsx`):

- Order: overlays, bands, `Mount`s, and observers follow the array order.
- Conflicts: every row of the decision 3 table, including the dev message; a plugin binding
  `mod+c` is dropped and copy still works.
- Identity: an inline array of stable plugins over 10 re-renders causes no store notification from
  the plugin fields; an inline plugin literal with stable members does the same; one plugin object
  passed to two grids is a dev error.
- Removing an overlay plugin between renders does not throw.
- Bands: two plugins with 1 and 2 top rows give a 3-row band height, a matching `aria-rowcount`,
  `rowOffset` 1 for the second segment, and contiguous `aria-rowindex`. An SSR render
  (`renderToString`) with pinned rows has the band heights.
- Observers: run after the store `set` and after the consumer's `onDataChange`; a throwing observer
  logs and the next runs; an observer that calls `commitChange` keeps its write.
- Surface: `api.store.setState` and `getState().actions._syncProps` are `undefined` at runtime;
  type tests (`// @ts-expect-error`) for `api.store.setState` and for `onDataChange` on
  `DataGridReadState`.
- Write guard: with `readOnly`, `commitChange`, `applyCellUpdates`, `commitCellEdit`, and
  `commitCellValueAt` write nothing and emit nothing.
- History: undo and redo in a controlled and an uncontrolled grid; its own emissions are not
  recorded; a read-only grid does not undo.
- Fill: mod+D/mod+R reach the plugin commands; read-only blocks them; without the plugin the keys
  are no-ops that still prevent the browser default.
- Presence: the `Mount` warns once on a sort under a view-space entry.

Browser:

- Fill drag with only `plugins={[fill.plugin]}` (no tracker element); Escape cancels mid-drag; the
  preview paints under the active-cell ring (`overlay-paint-order.browser.test.tsx`).
- Pinned bands from two plugins stack, stay sticky, and align with the columns.
- Perf: the `scroll-drag` wasted-render probes and the `perf.browser` FPS ratio stay within their
  bars with fill, presence, and pinned rows mounted.
- Compiler: `DataGridOverlays` leaves `scripts/compiler-bailouts.baseline.json`.

## Execution order

W6-05 → types and resolution (creation + `_syncConfig`) → internal-actions table and the read-only
handle → store write guards and the `emitDataChange` helper → pluggable built-ins → the four
add-ons → demos and docs (`overlay-plugins.mdx` becomes a plugins page, plus the four add-on pages)
→ tests → gates → CHANGELOG (**Breaking**) → registry pipeline → e2e install.
