# Spec: one config home (W5-12, API-R11)

Decision record for moving the behavior props that outside surfaces need into the store. Today the
grid's configuration lives in two places: `DataGridSyncProps` (`store/types.ts:33-241`, read by
the store) and `DataGridRootProps` (`root.tsx:70-148`, read by the root's render). Surfaces outside
the root (context menu, keybindings dialog, global shortcuts, `useDataGridClipboard`, commands)
need two of the root props, so the root mirrors them into the store from mount effects
(`_registerReadOnly`, `_registerKeymap`, `root.tsx:293-305`). The wrapper `DataGrid` hand-forwards
about 70 props (`data-grid.tsx:463-616`), and the provider hand-lists its 48 sync props twice
(`provider.tsx:131-230` and the deps at `provider.tsx:274-323`). W3-07's guard
(`data-grid.type-test.ts:110-120`) checks only the declared keys of `DataGridProps`; nothing checks
the runtime forwarding in `DataGrid` or the provider's two lists.

Lands BEFORE W5-11 (W5-11's `selection`/`columnLayout` ride the recompute phase of decision 6) and
before W5-13 (plugins merge into the store-held `keymap` and read the store-held `readOnly`).

## Decisions

### 1. The partition rule

A prop moves into the store when a surface outside `DataGridRoot`'s subtree reads it, or when it
is read at event time. A value read only while the root subtree renders stays a root prop. One line
of rationale: render-time slots already reach every reader through the root context without a
store round trip; config that outside surfaces or event handlers need belongs where they can read
it.

### 2. Every current prop and its home

Root props that move to `DataGridSyncProps`:

| Prop | Read after the move |
|---|---|
| `readOnly` | `state.readOnly`; root's `aria-readonly` via `useDataGridReadOnly()`; `useGridInteraction`/`useGridClipboard` lose their `readOnly` option (`root.tsx:276,281`) and read the store at event time, as `use-grid-clipboard.ts:371` already does |
| `keymap` | `state.keymap` = `DEFAULT_KEYMAP` merged with the prop in the config sync; root reads `useDataGridKeymap()` |
| `onCellClick`, `onRowClick`, `onRowWindowChange` | read at event time through `storeApi.getState()` (the W5-05 pattern of `onCellDoubleClick`); removed from the root context and from `DataGridCell`'s props (`cell.tsx:55-57`, `body.tsx:301-302`) |

Root props that stay on `DataGridRootProps` (`DataGridRoot<TData>` keeps its type parameter):
`className`, `rowHeight`, `density`, `headerHeight`, `columnOverscan`, `direction`, `loading`,
`emptyState`, `loadingState`, `renderHeaderMenu`, `renderMarker`, `renderMarkerHeader`,
`getRowClassName`, `getCellClassName`, `children`. The render slots keep their dev identity
warnings in the root (`root.tsx:322-345`, minus the `onCellClick`/`onRowClick` ones).

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

Rejected: render slots as sync props — only the root subtree reads them at render time, and a store
round trip would add a commit of latency to every slot change for no reader that needs it.

### 3. The render-time `_register*` mirrors go away

- Delete `_registerReadOnly` and `_registerKeymap` (`store/types.ts:811-813`,
  `create-store.ts:830-835`) and the two root effects (`root.tsx:293-305`). The props reach the
  store through the config sync (decision 6); no mount/unmount reset is needed because the store
  lives exactly as long as the provider.
- `validateKeymap`/`validateSharedBindings` (dev only) move into the config sync and run when the
  keymap changes.
- Keymap identity: `state.keymap` keeps its identity while the prop has the same action keys and
  the same binding strings in the same order, so an inline `keymap={{ … }}` literal does not
  re-sync or churn the root's interaction memos.
- When `readOnly` turns true, the config sync cancels an open edit session (`cancelEditing`, so
  `onEditEnd` fires with `cancel`). Today a session opened before the flip can still commit.
- `_registerScrollToCell` (and R-47's focus registration) stay: they carry the root's DOM
  implementation, not consumer config.

### 4. No hand-maintained lists

- `DataGrid` splits its props with one key list, `DATA_GRID_ROOT_PROP_KEYS` (root.tsx, `as const
  satisfies readonly (keyof DataGridRootProps)[]`), and spreads the rest into
  `<DataGridProvider {...syncProps}>` (or `store` alone, decision 5).
- `useGridStoreCore` drops the 48-name destructure, the 48-name init object, and the 48-entry deps
  list. Its two sync effects (decision 6) have no deps arrays: each shallow-compares its slice of
  the incoming props with the last synced slice held in a ref (inside the effect, so no render-time
  ref access) and syncs only on a difference. Seed-only keys (`defaultData`,
  `defaultColumnLayout`, `defaultSelection`) are excluded. Cost: about 60 `===` checks per provider
  render.
- Rejected: a codegen script that writes the lists — tooling for what a spread already solves.

### 5. The type-level guarantee that replaces the drift guard

```ts
type ExternalStoreProps = { store: StoreApi<DataGridStoreState> } & { [K in keyof DataGridSyncProps]?: never };
type OwnedStoreProps<TData> = DataGridSyncProps<TData> & { store?: undefined };
export type DataGridProviderProps<TData> = (ExternalStoreProps | OwnedStoreProps<TData>) & { children: ReactNode };
export type DataGridProps<TData> = (ExternalStoreProps | OwnedStoreProps<TData>) &
  DataGridRootProps<TData> & { ref?: Ref<DataGridApi<TData>> };
```

- An external store drives its own sync through `useDataGridStoreProps`; sync props next to it
  would be silently ignored (`provider.tsx:245-270` skip all sync work for an external store), so
  the union makes them a type error. Dev mode warns once when an untyped caller passes both.
- `DataGridProps` is built from the two homes, so no prop can be declared on one surface and
  forgotten on the wrapper. `data-grid.type-test.ts:110-120` becomes three assertions:
  - Disjoint: `Extract<keyof DataGridSyncProps<Row>, keyof DataGridRootProps<Row>>` is `never`.
  - Exhaustive: `Exclude<keyof DataGridRootProps<Row>, (typeof DATA_GRID_ROOT_PROP_KEYS)[number] |
    "children">` is `never` (a new root prop not in the split list would leak into the provider).
  - The `satisfies` clause rejects a list entry that is not a root prop.

### 6. Two-phase sync, SSR, and hydration

- Config phase: a `useLayoutEffect` calls a new `_syncConfig(props)` for the props that feed no
  derived state: `readOnly`, `keymap`, `commands`, `labels`, the `enable*` flags,
  `headerClickBehavior`, `rowMarkers`, `sanitizeClipboardFormulas`, and every `on*`, `process*`,
  `validateRow`, `createRow`, `duplicateRow`. No view, search, or column recompute runs. The store
  holds the new config before the browser paints or dispatches the next event, so a `readOnly`
  flip blocks a keydown that arrives right after the commit.
- Recompute phase: the passive effect keeps `_syncProps` for the inputs of derived state: `data`,
  `columns`, `getRowId`, `cellTypes`, `sortState`, `filterState`, `joinOperator`, `searchText`,
  and (W5-11) `selection`, `columnLayout`. Their cost (up to the O(n log n) view rebuild) stays off
  the layout-effect path.
- SSR: the store is created in the provider's `useState` initializer from the full init props
  (`create-store.ts:236` spreads `...init`), so the server render and the first client render see
  `readOnly` and `keymap`. Today both reach the store only in a mount effect. The visible gap is the
  fill handle: its overlay reads `useDataGridReadOnly()` (`data-grid-fill/use-data-grid-fill.tsx:83`)
  and paints in a read-only grid until the effect runs. The context menu, global shortcuts, and the
  keybindings dialog read the store only after mount, so they show no first-paint difference. The
  toolbar reads no `readOnly` today.
- No new hydration mismatch: server and client build the store from the same props, and `useId`
  is unchanged. `useLayoutEffect` does not run on the server and React 19 no longer warns about it.
- Rejected: writing the store during render — a React rule violation and a React Compiler bail-out.

### 7. React Compiler

- `DataGrid` becomes a key split plus JSX. Its rest object is new per render, so the provider
  element re-renders whenever `DataGrid` renders; the provider's work is then the two shallow
  compares, the same order of work as today's 48-dep effect. Under the compiler the root element
  still memoizes on its own props.
- The provider effects have no deps arrays, so the `exhaustive-deps` suppression at
  `provider.tsx:273` goes away.
- Moving `onCellClick`/`onRowClick` off `DataGridCell`'s props removes two inputs from the
  memoized cell.
- Gate: `pnpm lint` (the R-34 compiler bail-out check) and `pnpm test:compiler` add no new
  bail-out for `root.tsx`, `store/provider.tsx`, or `data-grid.tsx`.

## Migration

| Old | New |
|---|---|
| `<DataGridRoot readOnly keymap onCellClick onRowClick onRowWindowChange>` | Same props on `<DataGridProvider>` (manual composition) (**Breaking**) |
| `<DataGrid …>` | Unchanged prop names |
| `<DataGridProvider store={store} …syncProps>` | `store` alone; pass every sync prop, including the moved ones, to `useDataGridStoreProps` (**Breaking**: a type error) |
| `useDataGridStoreProps(props)` | Also takes `readOnly`, `keymap`, `onCellClick`, `onRowClick`, `onRowWindowChange` |
| `DataGridRootContextValue` `readOnly`, `onCellClick`, `onRowClick`, `onRowWindowChange` (sdk) | Removed; read the store (**Breaking**, sdk) |
| `DataGridCellProps` `onCellClick`, `onRowClick` | Removed; the cell reads the store at click time (**Breaking**) |
| `_registerReadOnly`, `_registerKeymap` (internal) | Removed |

## Test plan

- Type test: the three assertions in decision 5; `// @ts-expect-error` on
  `<DataGridRoot readOnly />`; `// @ts-expect-error` on `<DataGridProvider store={s} readOnly>`.
- Unit, SSR: `renderToString(<DataGrid readOnly … />)` with a probe child shows
  `useDataGridReadOnly() === true` and `aria-readonly` in the first render (the
  `binding-label.test.tsx` `renderToString` pattern).
- Unit: `readOnly` flips to true and a keydown dispatched before passive effects flush writes
  nothing (no `onDataChange`); an editor open during the flip is cancelled with `onEditEnd`
  `cancel`.
- Unit: `<DataGridProvider keymap={…}>` with no root mounted — `useDataGridKeymap()` returns the
  merged map, so the keybindings dialog outside the root shows the custom binding.
- Unit: an inline `keymap` literal with equal entries keeps `state.keymap` identity across
  re-renders; a re-render with an equal props set calls neither `_syncConfig` nor `_syncProps`
  (spies); a config-only change calls `_syncConfig` and not `_syncProps`.
- Unit: an untyped caller passing `store` and `readOnly` gets one dev warning.
- Unit: manual composition with `readOnly` on the provider blocks edit, delete, paste, fill, and
  the context menu's Cut.
- Unit: changing `onCellClick` identity re-renders no cell (the `renderCell` probe of
  `scroll-drag.browser.test.tsx`), and the next click calls the new callback.
- Browser: the a11y, keybindings, context-menu, and scroll-drag wasted-render suites stay green.
- Compiler: `pnpm test:compiler` and the bail-out baseline unchanged.
