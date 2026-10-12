# W5-12 — decisions

The seven spec decisions live in `research/config-home-spec.md` (partition rule, prop homes,
removing the `_register*` mirrors, no hand-maintained lists, the type-level guarantee, two-phase
sync / SSR / hydration, React Compiler). This file records the decisions made while implementing,
where the spec left the shape open.

## Provider sync shape

- `useGridStoreCore` drops the 48-name destructure, init object, and deps list. Two effects with
  no deps arrays: layout → `_syncConfig`, passive → `_syncProps`. Each shallow-compares its slice
  of the incoming props against the last synced slice held in a ref inside the effect, and syncs
  only on a difference. Seed-only keys (`defaultData`, `defaultColumnLayout`) are excluded.
- The slice key sets are checked for exhaustiveness at compile time
  (`_syncSliceExhaustive` in `store/provider.tsx`), so a new sync prop is a type error until a
  slice claims it.
- `syncProps` crosses into the store through one cast (`syncProps as DataGridSyncProps<TData>`)
  with a comment naming why it is safe (the union types the owned branch as the sync props).

## Dev warning placement

- The once-only warning for an untyped caller passing `store` plus sync props
  (`warnExternalStoreSyncPropsOnce`) lives in `store/commit.ts`, not `store/provider.tsx`:
  calling it from the provider's render path would be a new React Compiler bail-out.

## Root / wrapper

- `DataGrid` splits with `DATA_GRID_ROOT_PROP_KEYS` (`as const satisfies
  readonly (keyof DataGridRootProps)[]`, 15 keys including `children`) and spreads the rest into
  `<DataGridProvider>`. `DataGridProps<TData> = (ExternalStoreProps | OwnedStoreProps<TData>) &
  DataGridRootProps<TData> & { ref? }`.
- The root reads `useDataGridKeymap()` and `useDataGridReadOnly()` for its `aria-readonly` and
  interaction wiring; the render slots keep their dev identity warnings in the root, minus the
  `onCellClick`/`onRowClick` ones (those props no longer exist on the root).
- `DataGridCellProps.gridReadOnly` stays a prop (threaded from the root) — the cell is memoized
  and reading the store would add a subscription; the root's dev guardrail covers its identity.

## Test decisions

- `config-home.test.tsx` asserts the semantic contract (next click calls the new `onCellClick`
  callback after an identity change) but not the no-cell-re-render property. Under jsdom the
  column window's scroll-settle timers recompute `windowedColumns` during `await setTimeout(0)`,
  which changes the root's `contextValue` identity and re-renders the cell — pre-existing
  windowing machinery W5-12 does not touch, and by design in a real browser (a real scroll
  re-renders cells). The no-re-render property is covered by the browser wasted-render suites
  (a11y, keybindings, context-menu, scroll-drag), which the spec's test plan keeps green.
  Full diagnosis: `04-tests.md`.
- The read-only-writes harness tests drive `_syncConfig(toInternalSyncProps(...))` directly where
  the session-cancel semantics matter, and `store.setState({ readOnly: true })` where only the
  store flag matters.

## Docs and skills

- Every doc page and agent skill that taught the old placement (`readOnly`/`keymap`/`onCellClick`
  /`onRowClick`/`onRowWindowChange` on `DataGridRoot`) was updated to the new placement in the
  same commit. See `03-migrations.md`.
