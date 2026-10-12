# W5-12 — changes

File-by-file change log. Paths relative to the repo root.

## Core (`registry/default/blocks/data-grid/`)

- `store/types.ts` — `readOnly`, `keymap`, `onCellClick`, `onRowClick`, `onRowWindowChange` added
  to `DataGridSyncProps`; JSDoc of the store-state `readOnly`/`keymap` updated (synced, seeded at
  creation). `ExternalStoreProps`, `OwnedStoreProps<TData>`, and the
  `DataGridProviderProps<TData>` union added. Internal actions: `_syncConfig` replaces
  `_registerReadOnly`/`_registerKeymap`.
- `store/create-store.ts` — `_syncConfig` implemented: config slice writes (commands shadow
  warning, labels, `enable*`, `headerClickBehavior`, `rowMarkers`, `sanitizeClipboardFormulas`,
  all `on*`/`process*`/`validateRow`/`createRow`/`duplicateRow`), keymap merge with
  content-equality guard, `readOnly` seed and open-edit cancel on flip to true. Store seeds
  `readOnly`/`keymap` from init props at creation (SSR). `_registerReadOnly`/`_registerKeymap`
  deleted.
- `store/provider.tsx` — `useGridStoreCore` rewritten: two-phase sync (slice key sets +
  compile-time exhaustiveness), `sliceChanged` shallow compare, `lastConfig`/`lastRecompute`
  refs, two no-deps effects (layout → `_syncConfig`, passive → `_syncProps`). `exhaustive-deps`
  suppression removed. Dev warning for `store` + sync props routed through
  `warnExternalStoreSyncPropsOnce` (commit.ts).
- `store/commit.ts` — `checkDevGuardrails` slimmed to the recompute slice;
  `warnExternalStoreSyncPropsOnce` added (once-only, React-Compiler-safe location).
- `store/hooks.ts` — JSDoc of `useDataGridReadOnly`/`useDataGridKeymap` updated (provider prop,
  SSR seed, event-time readers).
- `store/index.ts` — exports `ExternalStoreProps`, `OwnedStoreProps`.
- `keyboard/default-keymap.ts` — `mergeKeymap` (prop merged over `DEFAULT_KEYMAP`) and
  `keymapContentEqual` (identity guard: same action keys, same binding strings, same order).
- `keyboard/index.test.ts` — `mergeKeymap` and `keymapContentEqual` branch coverage (the file
  holds a 90% branch bar; the first coverage run of the final state was red at 75% on
  `default-keymap.ts`): absent/empty keymap keeps `DEFAULT_KEYMAP`'s reference, merge keeps
  untouched defaults, content equality true/false on key-set size, key order, binding-list
  length, binding string, and an explicit `undefined` binding.
- `keyboard/index.ts` — exports the two helpers.
- `keyboard/use-data-grid-global-shortcuts.ts` — `readOnly` option removed; reads `state.readOnly`.
- `root.tsx` — `keymap`, `readOnly`, `onCellClick`, `onRowClick`, `onRowWindowChange` removed
  from `DataGridRootProps`; the `_registerReadOnly`/`_registerKeymap` effects and their identity
  warning effect removed; `aria-readonly` and interaction wiring read the store via
  `useDataGridReadOnly()`/`useDataGridKeymap()`; `DATA_GRID_ROOT_PROP_KEYS` added (15 keys,
  `as const satisfies`).
- `layout-context.ts` — `readOnly`, `onCellClick`, `onRowClick`, `onRowWindowChange` removed from
  the context value.
- `data-grid.tsx` — `DataGridProps<TData>` = union & root props & ref; `DataGrid` becomes a key
  split (`DATA_GRID_ROOT_PROP_KEYS`) plus rest-spread into `<DataGridProvider>` (replaces the
  ~70 hand-forwarded props); import list slimmed.
- `body.tsx` — `onRowWindowChange` no longer threaded; read from `storeApi.getState()` at fire
  time.
- `row.tsx` — moved props no longer threaded to cells.
- `cell.tsx` — `onCellClick`/`onRowClick` removed from `DataGridCellProps`; `onClick` reads them
  from `storeApi.getState()` at click time; `gridReadOnly` JSDoc corrected (source is the store).
- `interaction/use-grid-interaction.ts` — `readOnly` option removed; the dispatch snapshot reads
  `state.readOnly` at event time.
- `clipboard/use-grid-clipboard.ts` — `readOnly` option removed (store read at event time, as
  before).
- `data-grid.type-test.ts` — the drift guard replaced with the three spec assertions (disjoint
  sync/root keys; exhaustive `DATA_GRID_ROOT_PROP_KEYS` list; the `satisfies` clause) plus
  `@ts-expect-error` on `DataGridRootProps { readOnly }` and on a sync prop next to `store`;
  `onCellClick`/`onRowClick` typed-assertion moved to `DataGridSyncProps<Row>`.

## New tests

- `test/config-home.test.tsx` — 5 tests: SSR `renderToString` (`useDataGridReadOnly()` and
  `aria-readonly` on first paint); `readOnly` flip before passive effects flush writes nothing
  and cancels an open edit; `useDataGridKeymap` with no root (provider-only mount returns the
  merged map); keymap identity across re-renders + `_syncConfig`/`_syncProps` spies (equal props
  sync nothing; config-only change syncs config only); `onCellClick` identity change reaches the
  next click.

## Harness and store tests (migrated, behavior unchanged)

14 harness files: `Partial<DataGridProviderProps<Row>>` → `Partial<DataGridSyncProps<Row>>`
(plus import renames). `store/autosize.test.tsx`, `store/cell-errors.test.tsx`,
`store/cell-type-behavior.test.tsx`, `store/column-layout.test.tsx`,
`store/external-store.test.tsx`, `store/flash-cells.test.tsx`, `store/on-invalid.test.tsx`,
`store/read-only-writes.test.tsx`, `store/row-channel-identity.test.tsx`,
`store/stream-validation-error.test.ts`, `store/update-cells.test.tsx`,
`clipboard/use-data-grid-clipboard.test.tsx`, `interaction/dispatch-command.test.ts`,
`interaction/use-grid-interaction.test.tsx`.

- `store/read-only-writes.test.tsx` — rewritten for the two-phase timing: the passive-phase write
  is blocked because the config phase (layout) already holds the flag; provider-flip semantics
  covered via `_syncConfig`.
- `test/read-only-registration.test.tsx` — rewritten: no more registration effect; asserts the
  config-phase timing instead.
- `test/events.test.tsx`, `test/row-ops.test.tsx`, `test/store.test.tsx`,
  `test/row-ops-editing.browser.test.tsx` — `readOnly`/moved callbacks moved to the provider in
  test composition. `test/row-ops.test.tsx` "is a no-op while readOnly" additionally rewritten
  to a compiler-sound shape (direct `DataGridProvider` in the wrapper body instead of a
  factory-built component type; see `04-tests.md`).
- `test/config-home.test.tsx` onCellClick test — prop-driven wrapper (a no-props wrapper is
  compiler-cached at first render; see `04-tests.md`).

## Add-ons (tests only; add-on source unchanged)

- `data-grid-context-menu/`: `context-menu.browser.test.tsx` (readOnly + keymap to the provider),
  `menu-items.test.tsx` (readOnly to the provider).
- `data-grid-fill/`: `test/fill.browser.test.tsx` (readOnly to the provider),
  `use-fill-handle.test.tsx` (harness + `setState`).
- `data-grid-keybindings/keybindings.browser.test.tsx` (keymap to the provider).
- `data-grid-lazy/data-grid-lazy.browser.test.tsx` (2× `onRowWindowChange` to the provider).

## Examples

`data-grid-cell-errors-demo.tsx` (provider store-only), `data-grid-events-demo.tsx` (3 callbacks
to the provider), `data-grid-keybindings-demo.tsx` (keymap to the provider),
`data-grid-lazy-demo.tsx` / `data-grid-lazy-react-query-demo.tsx` /
`data-grid-lazy-swr-demo.tsx` (`onRowWindowChange` to the provider),
`data-grid-playground-demo.tsx` (readOnly + `onRowWindowChange`, 3 grids),
`data-grid-row-ops-demo.tsx` (readOnly to the provider).

## Payloads

`public/r/*.json` — rebuilt after the final source state and EOL-normalized
(`scripts/normalize-payload-eol.mjs`); `pnpm lint` verifies content match against source.

## Docs, skills, CHANGELOG

- `content/docs/`: `api-reference.mdx` (root-only callout), `events-state.mdx` (typed callbacks
  in split composition; `onRowWindowChange` placement), `lazy-loading.mdx` (two examples +
  placement sentence), `addons/keybindings.mdx` (three examples + placement sentence),
  `editing-cell-types.mdx` (composed-grid `readOnly` example), `agent-skills.mdx` (skill
  description).
- `skills/gridcn-addons/SKILL.md` (keymap placement rule),
  `skills/gridcn-data-source/references/server-mode.md` (lazy example).
- `CHANGELOG.md` — `## Unreleased → Changed` breaking entry.
