# W5-12 — migrations

Call-site migrations for the moved props (`readOnly`, `keymap`, `onCellClick`, `onRowClick`,
`onRowWindowChange`): from `DataGridRoot`/root context to `DataGridProvider`/store. All DONE.

| Surface | Old | New | Status |
|---|---|---|---|
| Harnesses (14 store/test files) | `Partial<DataGridProviderProps<Row>>` | `Partial<DataGridSyncProps<Row>>` | done |
| `read-only-writes.test.tsx`, `read-only-registration.test.tsx` | `_registerReadOnly` / registration-effect timing | `_syncConfig` / config-phase timing | done (rewritten) |
| `external-store.test.tsx` | `store` + sync props on the provider | `store` alone; sync props on `useDataGridStoreProps` | done |
| `use-grid-interaction.test.tsx`, `dispatch-command.test.ts` | `readOnly` as a hook option | `readOnly` as a provider prop | done |
| Context-menu / fill / keybindings / lazy browser tests | props on `DataGridRoot` | props on `DataGridProvider` | done |
| Examples (8 demo files) | props on `DataGridRoot` | props on `DataGridProvider` | done |
| Docs pages (6 pages) | `DataGridRoot` placement in prose + examples | `DataGridProvider` placement | done |
| Agent skills (`gridcn-addons`, `gridcn-data-source`) | "keymap on the root", lazy example on the root | keymap on the provider; lazy example on the provider | done |

Rules applied at each site:

- `onRowWindowChange` moved with the `data`/`onDataChange` wiring (provider-level concern), so
  every lazy composition puts it on `DataGridProvider` next to `data`.
- `keymap` moved to `DataGridProvider`; `DataGridRoot` keeps its className/render slots only.
- Tests that only need the store flag use `store.setState({ readOnly: true })`; tests that need
  the flip semantics (edit cancel, layout-phase timing) go through `_syncConfig`.
- `useDataGridStoreProps` accepts the moved props, so external-store consumers pass them there —
  no runtime change for them, only the type now rejects sync props next to `store`.

Unmigrated on purpose: `data-grid.type-test.ts` assertions of the old shape (replaced by the
decision-5 assertions), and the historical spec text in `research/config-home-spec.md` (it
describes the pre-move code with line references — a decision record, not live docs).
