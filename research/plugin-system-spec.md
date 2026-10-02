# Spec: plugin system (W5-13, API-R5)

Decision record for one `plugins` prop that replaces the per-add-on wiring. Today every add-on that
reaches into the grid has its own seam: `overlayPlugins` and `rowBands` (`store/types.ts:165,173`),
`onUndo`/`onRedo` (`store/types.ts:67-69`), a tracker element the consumer must render inside the
root (`FillHandleTracker`, `data-grid-fill/fill-tracker.tsx:60-63`), and two store registrations
(`_registerFillHandlers`, `_registerPresenceViewSpaceActive`, `store/types.ts:815-821`). A third
party cannot add a seam, so it cannot write an add-on.

Depends on W5-12 (decision 9) and on W6-05's `commitChange` (decision 9).

## Decisions

### 1. The type

New sync prop `plugins?: readonly DataGridPlugin<TData>[]` on `DataGridSyncProps`. Types in the
block-root `types.ts`, exported from the consumer barrel:

```ts
export type DataGridPlugin<TData = unknown> = {
  name: string;                                   // unique per grid
  overlay?: OverlayPlugin;                        // unchanged type (overlays.tsx:177)
  rowBands?: PluginRowBands;
  onDataChange?(next: readonly TData[], change: DataChange<TData>, ctx: DataGridPluginCtx<TData>): void;
  commands?: Record<string, GridCommand<TData>>;  // W5-10 commands
  keymap?: Keymap;                                // binds this plugin's own commands only
  Mount?: ComponentType;                          // rendered inside DataGridRoot
};
export type PluginRowBands = { top?: readonly unknown[]; bottom?: readonly unknown[]; render(ctx: RowBandRenderCtx): ReactNode };
export type DataGridPluginCtx<TData> = { api: DataGridApi<TData> };
```

- Method syntax on `onDataChange`/`render` keeps a typed plugin assignable to the store's erased
  `DataGridPlugin<unknown>` (the `GridCommand` bivariance rule).
- `RowBandRenderCtx` (`layout-context.ts:95`) gains `rowOffset`: the rows that earlier plugins put
  in the same band.
- `Mount` takes no props; it reads the grid through hooks (`useDataGridApi()`, root context).
- Rejected: per-cell members (`renderCell`, `cellClassName`). They would iterate plugins on the
  hot path; columns, cell types, and `getCellClassName` already cover cells.

### 2. Resolution

`_syncProps` resolves `plugins` into one store field, `state.plugins`:
`{ list, overlays, bands, mounts, observers }`, and merges the plugin commands and keymaps into
`state.commands` and `state.keymap` (W5-12 made both store-held). Everything downstream reads
these resolved fields, never the raw array.

### 3. Order and conflicts

Array order is precedence and visual order:

- Overlays paint in array order (a later plugin on top), all after the built-in range layers and
  before the active-cell ring (`overlays.tsx:251-258`, unchanged rule).
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
| Merge order of keymaps | `DEFAULT_KEYMAP` ← plugin keymaps (array order) ← consumer `keymap` | The consumer always wins |
| One key bound to two actions | The existing shared-binding warning and tie rule (custom-commands spec 5c) | Unchanged |

Rejected: first plugin wins — it inverts the precedence that the keymap merge and object spread
both use.

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
- The fill and history commands carry `when: (ctx) => !ctx.readOnly`. Today undo runs in a
  read-only grid (`use-grid-interaction.ts:453-456` has no `readOnly` check); this closes that.

### 5. What a plugin can reach (security)

A plugin is third-party code in the grid's JavaScript realm. Nothing in a browser realm sandboxes
it: it can import any module. The surface is therefore a contract plus freezing, and it is chosen
so that (a) a correct plugin cannot break store invariants, (b) one plugin cannot tamper with what
another plugin or the consumer receives, and (c) every data write keeps the consumer's guards
(readOnly, validation, controlled mode, `onDataChange`).

A plugin gets the imperative handle and nothing else: `DataGridPluginCtx.api`,
`GridCommandCtx.api`, and `useDataGridApi()` inside `Mount`/`overlay`. The handle narrows
(**Breaking** for W5-09's `DataGridApi`):

| Member | Today | After |
|---|---|---|
| `store` | `StoreApi<DataGridStoreState>` with `setState` (`types.ts:673`, `store/api.ts:23`) | `DataGridReadStore = { getState(): DataGridReadState; subscribe(listener) }` |
| `getState()` type | full state | `DataGridReadState`: no `actions`, no `on*` consumer callbacks, no internals (`dataWrite`, `scrollToCellImpl`) |
| `actions` | the full object incl. `_syncProps`, `_register*` | `DataGridPublicActions` (no `_` members), built once per store, `Object.freeze`d |
| the handle | plain object | `Object.freeze`d |

- No code outside `store/` calls `setState` today (zero non-test hits), so the read-only store
  costs no internal capability. `useDataGridStoreApi` (sdk after R-51) returns the same
  `DataGridReadStore`; only `store/` holds the writable `StoreApi`.
- A plugin cannot call `onDataChange` with forged data: consumer events stay store-fired. Fill
  fires `onValidationError` itself today (`data-grid-fill/use-fill-handle.ts:250`), and so does
  paste (`clipboard/use-grid-clipboard.ts:353`); both move into
  `applyCellUpdates(updates, source, rejected?)`, which fires the event after the write (the R-52
  pattern for `updateCells`).
- Enough for the shipped add-ons: fill reads selection, data, columns, and cell types and writes
  through `applyCellUpdates`, `flashCells`, `selectCellAt`, `extendToAt`; history writes through
  `commitChange`; pinned rows only render; presence reads and subscribes.
- Limit, stated in the docs: a plugin that casts past the types reaches the internals at runtime.
  The consumer installs plugin source through shadcn and reviews it like their own code.
- Rejected: plugins get `setState` — one faulty plugin corrupts the view index or selection for
  everyone. Rejected: a worker or iframe sandbox — overlays and bands must render inside React.

### 6. Hot path

- No per-cell or per-row plugin iteration (decision 1).
- Overlays: one resolved array in `DataGridOverlays`' existing loop; the same cost as
  `overlayPlugins` today.
- Bands: concatenated once per registry change; the root reads one memoized object
  (`useDataGridRowBands`, `store/hooks.ts:204`) and sums segment counts for heights and
  `aria-rowcount`.
- Keys: commands and keymaps merge once per registry change; dispatch stays one map lookup.
- Observers: O(plugins) per data-change emission (per gesture or stream tick, never per cell).
  One helper `emitDataChange(s, next, change)` replaces the nine `s.onDataChange?.()` sites in
  `store/data-write.ts` (227, 287, 317, 377, 444, 529, 565, 595, 653): it calls the consumer, then
  each observer inside its own try/catch, so a throwing plugin logs and does not stop the others.

### 7. Identity across renders

- `_syncProps` compares the incoming list entry by entry: same `name` and every member `===`.
  An equal list reuses `state.plugins` and the merged `commands`/`keymap`, so no store field
  changes identity and nothing re-renders (the R-38 rule for `cellTypes`). Inline
  `plugins={[fill, history, pinned]}` is fine, and so is an inline plugin literal with stable
  members.
- A member that changes rebuilds only what it feeds (a new `rowBands` rebuilds `bands`).
- `Mount` identity change remounts the component (state lost); dev warns once per plugin.
- The add-on hooks return memoized plugin objects. Pinned rows' `rowBands` changes when its rows
  change, which is a real change.

### 8. Add-on mapping

| Add-on | Today | Plugin members | Hook result |
|---|---|---|---|
| fill | `plugin` in `overlayPlugins`, `<FillHandleTracker />` in the root, `_registerFillHandlers` | `overlay`; `Mount` (the pointer engine, Escape cancel); `commands` `fillDown`/`fillRight` (they read the handlers from the fill store the `Mount` writes) | `useDataGridFill(opts)` → `{ plugin }` |
| history | `onDataChange`/`onUndo`/`onRedo` pass-through, `data`/`setData` options | `onDataChange` (records; skips its own emissions); `commands` `undo`/`redo` via `actions.commitChange(inverse)`, source `"history"` | `useDataGridHistory({ capacity, recordSources, datasetKey })` → `{ plugin, canUndo, canRedo, historySize, undo, redo, clear, record }` |
| pinned-rows | `rowBands` prop | `rowBands` | `useDataGridPinnedRows({ topRows, bottomRows })` → `{ plugin }` |
| presence | `plugin` in `overlayPlugins`, `_registerPresenceViewSpaceActive` | `overlay`; `Mount` (dev only: subscribes to `viewIndex`/`visibleColumns` and warns once when rows or columns move under a view-space entry) | `useDataGridPresence()` → `{ plugin, setPresenceHighlights, … }` |

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
with its 17 call sites (`create-store.ts:216-222`). `_registerScrollToCell` stays: it carries the
root's DOM implementation, not add-on wiring.

### 9. Dependencies

- W5-12: `plugins` is a sync prop; plugin keymaps merge into the store-held `keymap`; the command
  ctx reads the store-held `readOnly`; the root renders `Mount`s from the store.
- W6-05 `actions.commitChange(change)`: history needs one write path that works in controlled and
  uncontrolled grids and keeps the store's guards. The plan places W6-05 in Wave 6 after W5-13;
  move it before W5-13. Rejected: keeping history's `setData` option — controlled-only, and the
  write bypasses `readOnly` and the row-op guards.
- R-47 (handle anywhere under the provider), R-51 (`useDataGridStoreApi` in the sdk), and R-52
  (store-fired `onValidationError`) land first.

## Migration

| Old | New |
|---|---|
| `overlayPlugins={[fillPlugin, presencePlugin]}` | `plugins={[fill.plugin, presence.plugin]}` (**Breaking**) |
| `<FillHandleTracker />` inside `DataGridRoot` | Delete it (**Breaking**) |
| `rowBands={pinned.rowBands}` | `plugins={[pinned.plugin]}` (**Breaking**) |
| `useDataGridHistory({ data, setData, getRowId })` plus `onDataChange={h.onDataChange} onUndo={h.undo} onRedo={h.redo}` | `useDataGridHistory({ … })` plus `plugins={[h.plugin]}`; keep your own `onDataChange` (**Breaking**) |
| `onUndo`/`onRedo` with your own undo | `commands={{ undo: { run }, redo: { run } }}` (**Breaking**) |
| `RowBandsSpec` (`topRows`, `bottomRows`, `renderBand`) | `PluginRowBands` (`top`, `bottom`, `render`); ctx gains `rowOffset` (**Breaking**) |
| `DataGridApi.store: StoreApi` | `DataGridReadStore` (**Breaking**) |
| `DataGridApi.actions` with `_` members | Frozen public actions (**Breaking**) |
| `useDataGridFillHandlers` | Removed (**Breaking**) |

## Test plan

Unit (`test/plugins.test.tsx`):

- Order: overlays, bands, `Mount`s, and observers follow the array order.
- Conflicts: every row of the decision 3 table, including the dev message.
- Identity: an inline array of stable plugins over 10 re-renders causes no store notification from
  the plugin fields; an inline plugin literal with stable members does the same.
- Bands: two plugins with 1 and 2 top rows give a 3-row band height, a matching `aria-rowcount`,
  `rowOffset` 1 for the second segment, and contiguous `aria-rowindex`.
- Observers: run after the consumer's `onDataChange`; a throwing observer logs and the next runs.
- Surface: `Object.isFrozen(api)` and `Object.isFrozen(api.actions)`; type tests
  (`// @ts-expect-error`) for `api.store.setState` and for `onDataChange` on `DataGridReadState`.
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

## Execution order

W6-05 → types and resolution in `_syncProps` → frozen read-only handle → pluggable built-ins and
the `emitDataChange` helper → the four add-ons → demos and docs (`overlay-plugins.mdx` becomes a
plugins page, plus the four add-on pages) → tests → gates → CHANGELOG (**Breaking**) → registry
pipeline → e2e install.
