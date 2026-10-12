# W5-12 — one config home: status

Plan 016 work item W5-12 (API-R11), spec `research/config-home-spec.md`.

## State

DONE — implementation complete, all local gates green (final unit+coverage rerun in progress),
docs and CHANGELOG written. Awaiting the commit (this bundle plus the plan-status record).

## What landed

- `readOnly`, `keymap`, `onCellClick`, `onRowClick`, `onRowWindowChange` moved from
  `DataGridRootProps` to `DataGridSyncProps`; the store is the single config home.
- Two-phase provider sync: layout effect → `_syncConfig` (no recompute), passive effect →
  `_syncProps` (derived-state inputs). No hand-maintained prop lists; `DataGrid` splits its props
  with `DATA_GRID_ROOT_PROP_KEYS` and spreads the rest into the provider.
- `_registerReadOnly`/`_registerKeymap` and their root mount effects removed; interaction and
  clipboard read `state.readOnly` at event time; cells read `onCellClick`/`onRowClick` from the
  store at click time.
- Type-level guarantee: `DataGridProviderProps`/`DataGridProps` union
  (`ExternalStoreProps | OwnedStoreProps<TData>`); sync prop next to `store` is a type error plus
  a once-only dev warning for untyped callers.
- SSR/first paint: `readOnly` and `keymap` seed the store at creation (closes R-93).
- A `readOnly` flip syncs in the layout phase before passive effects flush (closes R-100) and
  cancels an open edit session (`onEditEnd` `cancel`).
- Keymap identity: `state.keymap` keeps identity while action keys and binding strings are equal
  in the same order (`mergeKeymap` + `keymapContentEqual`).
- Test plan items implemented in `test/config-home.test.tsx` (5 tests) plus the three
  `data-grid.type-test.ts` assertions and two `@ts-expect-error` guards.
- All harnesses, add-on tests, examples, docs, and agent skills migrated to the new placement.
- CHANGELOG `## Unreleased → Changed` breaking entry.

## Open

- Commit the bundle (see `05-gates-and-next-steps.md`).
- Record W5-12 as done in `plans/016-improve-audit-followups.md` status table (with R-93 and
  R-100) in a docs commit.
- Next queue item: W5-11 (controlled selection and layout, spec
  `research/controlled-selection-layout-spec.md`).

## Files

- `01-decisions.md` — spec decisions and the implementation decisions made in-flight.
- `02-changes.md` — file-by-file change log.
- `03-migrations.md` — call-site migrations (harnesses, tests, add-ons, examples, docs, skills).
- `04-tests.md` — spec test-plan coverage, the jsdom onCellClick diagnosis, browser-suite handoff.
- `05-gates-and-next-steps.md` — gate results and what runs before the commit.
