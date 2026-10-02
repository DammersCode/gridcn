# Spec: one config home (W5-12, API-R11)

Decision record for moving every behavior prop into the store. Today the grid's configuration
lives in two places: `DataGridSyncProps` (`store/types.ts:33-241`, read by the store) and
`DataGridRootProps` (`root.tsx:70-148`, read by the root's render). Surfaces outside the root
(context menu, keybindings dialog, global shortcuts, `useDataGridClipboard`, commands) need two of
the root props, so the root mirrors them into the store from mount effects (`_registerReadOnly`,
`_registerKeymap`, `root.tsx:293-305`). The wrapper `DataGrid` hand-forwards about 70 props
(`data-grid.tsx:463-616`), and the provider hand-lists its 48 sync props twice
(`provider.tsx:131-230` and the deps at `provider.tsx:274-323`). W3-07's type guard
(`data-grid.type-test.ts:110-120`) covers only the first of those three lists.

Lands after W5-11 (its props are in the partition below) and before W5-13 (plugins merge into the
store-held `keymap` and read the store-held `readOnly`).

## Decisions

### 1. The partition rule

`DataGridRoot` keeps a prop only when the root's own DOM element or geometry is its sole reader:
scroll-root classes, track sizes, overscan, direction, `aria-busy`. Everything else (behavior,
events, render slots) is a sync prop. One line of rationale: the store is the only place every
surface (cells, add-ons outside the root, commands, the imperative handle, plugins) can read.

### 2. Every current prop and its new home

Root props that move to `DataGridSyncProps`:

| Prop | Read after the move |
|---|---|
| `readOnly` | `state.readOnly`; root's `aria-readonly` via `useDataGridReadOnly()`; `useGridInteraction`/`useGridClipboard` lose their `readOnly` option (`root.tsx:276,281`) and read the store at event time, as `use-grid-clipboard.ts:371` already does |
| `keymap` | `state.keymap` = `DEFAULT_KEYMAP` merged with the prop inside `_syncProps`; root reads `useDataGridKeymap()` |
| `emptyState`, `loadingState` | root render, one `useShallow` selector |
| `renderHeaderMenu`, `renderMarker`, `renderMarkerHeader`, `getRowClassName`, `getCellClassName` | root selects them with the same selector and keeps them in the context memo (`root.tsx:428-480`), so the row/cell hot path reads exactly what it reads today |
| `onCellClick`, `onRowClick`, `onRowWindowChange` | read at event time through `storeApi.getState()` (the W5-05 pattern of `onCellDoubleClick`); removed from the root context and from `DataGridCell`'s props (`cell.tsx:55-57`, `body.tsx:301-302`) |

Root props that stay on `DataGridRootProps`: `className`, `rowHeight`, `density`, `headerHeight`,
`columnOverscan`, `direction`, `loading`, `children`.

Sync props that stay sync (unchanged): `data`, `defaultData`, `columns`, `getRowId`,
`onDataChange`, `validateRow`, `cellTypes`, `processCellForClipboard`, `processCellFromClipboard`,
`processPaste`, `sanitizeClipboardFormulas`, `rowMarkers`, `enableRowSelection`,
`enableColumnSelection`, `enableRangeSelection`, `enableMultiRange`, `enableColumnResize`,
`enableColumnReorder`, `enableRowReorder`, `enableColumnPinning`, `headerClickBehavior`, `labels`,
`createRow`, `duplicateRow`, `commands`, `sortState`, `onSortChange`, `filterState`,
`onFilterChange`, `joinOperator`, `onJoinOperatorChange`, `searchText`, `onSearchTextChange`,
`defaultColumnLayout`, `onColumnLayoutChange`, `onColumnResizing`, `onSelectionChange`,
`onActiveCellChange`, `onEditStart`, `onEditEnd`, `onValidationError`, `onCellDoubleClick`,
`onCellContextMenu`.

Sync props owned by neighboring items: `selection`, `defaultSelection`, `columnLayout` (added by
W5-11); `onSelectionCleared` (removed by W5-11); `onUndo`, `onRedo`, `overlayPlugins`, `rowBands`
(replaced by `plugins` in W5-13).

Wrapper-only props: `store` (a provider prop) and `ref` (the imperative handle).

Rejected: `loading` as a sync prop — only the root's skeleton, bar, and `aria-busy` read it.
Rejected: `direction` as a sync prop — it is the root element's `dir`; interaction reads it from
the root context, which is below the provider anyway.

### 3. The render-time `_register*` mirrors go away

- Delete `_registerReadOnly` and `_registerKeymap` (`store/types.ts:811-813`,
  `create-store.ts:830-835`) and the two root effects (`root.tsx:293-305`). The props reach the
  store through `_syncProps` like every other sync prop; no mount/unmount reset is needed because
  the store lives exactly as long as the provider.
- `validateKeymap`/`validateSharedBindings` (dev only) move into `_syncProps`, run when the keymap
  prop identity changes.
- `state.keymap` keeps its identity while the prop's entries are `===`-equal (the R-38 rule for
  `cellTypes`), so an inline `keymap={{ … }}` literal does not churn the root's interaction memos.
- `_registerScrollToCell` (and R-47's focus registration) stay: they carry the root's DOM
  implementation, not consumer config.
- The dev identity warnings for the render slots (`root.tsx:322-345`) move to
  `checkDevGuardrails` (`store/commit.ts:64`); the `onCellClick`/`onRowClick` warnings are deleted
  because an event-time read cannot re-render anything.

### 4. No hand-maintained lists

- `DataGrid` splits its props with one key list, `DATA_GRID_ROOT_PROP_KEYS` (root.tsx, `as const
  satisfies readonly (keyof DataGridRootProps)[]`), and spreads the rest into
  `<DataGridProvider {...syncProps} store={store}>`.
- `useGridStoreCore` drops the 48-name destructure, the 48-name init object, and the 48-entry deps
  list. Its sync effect has no deps array: it shallow-compares the incoming sync props with the
  last synced object held in a ref (inside the effect, so no render-time ref access) and calls
  `_syncProps` only on a difference. Seed-only keys (`defaultData`, `defaultColumnLayout`,
  `defaultSelection`) are excluded from the compare. Cost: about 60 `===` checks per provider
  render.
- Rejected: a codegen script that writes the lists — tooling for what a spread already solves.
- Rejected: `DataGridRoot` reading every prop and pushing the sync ones up — the root sits below the
  provider, so the first render would still miss them.

### 5. The type-level guarantee that replaces the drift guard

```ts
export type DataGridProps<TData> = DataGridSyncProps<TData> &
  DataGridRootProps & { store?: StoreApi<DataGridStoreState>; ref?: Ref<DataGridApi<TData>> };
```

`DataGridProps` is the intersection, so no prop can be declared on one surface and forgotten on
the wrapper. `data-grid.type-test.ts:110-120` becomes three assertions:

- Disjoint: `Extract<keyof DataGridSyncProps<Row>, keyof DataGridRootProps>` is `never` (a key in
  both homes would be ambiguous in the split).
- Exhaustive: `Exclude<keyof DataGridRootProps, (typeof DATA_GRID_ROOT_PROP_KEYS)[number] |
  "children">` is `never` (a new root prop not in the split list would leak into the provider).
- The `satisfies` clause rejects a list entry that is not a root prop.

`DataGridRoot` loses its `TData` parameter: no root prop is row-typed after the move.

### 6. SSR and hydration

- The store is created in the provider's `useState` initializer from the full init props
  (`create-store.ts:236` spreads `...init`), so the server render and the first client render see
  `readOnly`, `keymap`, and every slot. Today `readOnly` and `keymap` reach the store only in a
  mount effect: the server HTML and the first client paint run with `readOnly: false` and the
  default keymap (the fill handle shows in a read-only grid, the context menu enables Cut and
  Delete, the keybindings dialog lists the defaults). This change removes that first-paint gap.
- No new hydration mismatch: server and client build the store from the same props, and `useId`
  is unchanged.
- A later prop change reaches the store one commit late through the effect, the same latency
  `columns` and `sortState` have today. For the moved render slots this latency is new.
  Rejected: syncing in `useLayoutEffect` — it blocks paint with the O(n log n) view rebuild for
  every sync prop. Rejected: writing the store during render — a React rule violation and a
  React Compiler bail-out.

### 7. React Compiler

- `DataGrid` becomes a key split plus JSX. Its rest object is new per render, so the provider
  element re-renders whenever `DataGrid` renders; the provider's work is then the shallow compare,
  the same order of work as today's 48-dep effect. Under the compiler the root element still
  memoizes on its own props, so the tree below the provider does not re-render.
- The provider effect has no deps array, so the `exhaustive-deps` suppression at
  `provider.tsx:273` goes away.
- Moving `onCellClick`/`onRowClick` off `DataGridCell`'s props removes two inputs from the
  memoized cell, which the compiler and `memo` both compare.
- Gate: `pnpm lint` (the R-34 compiler bail-out check) and `pnpm test:compiler` add no new
  bail-out for `root.tsx`, `store/provider.tsx`, or `data-grid.tsx`.

## Migration

| Old | New |
|---|---|
| `<DataGridRoot readOnly keymap emptyState loadingState renderHeaderMenu renderMarker renderMarkerHeader getRowClassName getCellClassName onCellClick onRowClick onRowWindowChange>` | Same props on `<DataGridProvider>` (manual composition) (**Breaking**) |
| `<DataGrid …>` | Unchanged prop names |
| `DataGridRoot<TData>` | `DataGridRoot` (not generic) (**Breaking**) |
| `useDataGridStoreProps(props)` | Also takes the moved props; pass the same object you pass to the provider |
| `DataGridRootContextValue` `readOnly`, `onCellClick`, `onRowClick`, `onRowWindowChange` (sdk) | Removed; read the store (**Breaking**, sdk) |
| `DataGridCellProps` `onCellClick`, `onRowClick` | Removed; the cell reads the store at click time (**Breaking**) |
| `_registerReadOnly`, `_registerKeymap` (internal) | Removed |

## Test plan

- Type test: the three assertions in decision 5; `// @ts-expect-error` on
  `<DataGridRoot readOnly />`; `DataGridSyncProps<Row>["getRowClassName"]` keeps the row type
  (replaces `data-grid.type-test.ts:292-301`).
- Unit, SSR: `renderToString(<DataGrid readOnly … />)` with a probe child shows
  `useDataGridReadOnly() === true` and `aria-readonly` in the first render (the
  `binding-label.test.tsx` `renderToString` pattern).
- Unit: `<DataGridProvider keymap={…}>` with no root mounted — `useDataGridKeymap()` returns the
  merged map, so the keybindings dialog outside the root shows the custom binding.
- Unit: a re-render with an equal props set does not call `_syncProps` (spy); an inline `keymap`
  literal with equal entries keeps `state.keymap` identity.
- Unit: manual composition with `readOnly` on the provider blocks edit, delete, paste, fill, and
  the context menu's Cut.
- Unit: changing `onCellClick` identity re-renders no cell (the `renderCell` probe of
  `scroll-drag.browser.test.tsx`), and the next click calls the new callback.
- Browser: the a11y, keybindings, context-menu, and scroll-drag wasted-render suites stay green.
- Compiler: `pnpm test:compiler` and the bail-out baseline unchanged.
