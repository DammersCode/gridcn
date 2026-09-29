# Spec: imperative API handle (W5-09, API-R1)

Motivation: today, code outside the provider's subtree reaches the grid only by lifting the
store (`useDataGridStoreProps`), which duplicates every sync prop between the hook call and the
rendered grid. A stable imperative handle covers that case without prop duplication: one
object with the actions, the raw store, non-reactive state reads, and the two DOM gestures
(scroll, focus).

## Decisions

1. **`DataGridApi<TData>`** — new exported type (defined in `data-grid.tsx` next to
   `DataGridProps`, since that file is the consumer surface and the ref prop):

   | Member | Semantics |
   |---|---|
   | `actions: DataGridActions` | the same stable object `useDataGridActions` returns. |
   | `store: StoreApi<DataGridStoreState>` | the same object `useDataGridStoreApi` returns (row-agnostic; `getRow` is the typed read). |
   | `scrollTo(ref: CellRef)` | the existing `useDataGridScrollToCell` closure — unresolvable refs dev-warn once per grid and no-op. |
   | `focus()` | focuses the active cell's DOM element (the `[data-active]` cell inside the scroll container); with no active cell it focuses the scroll container, whose focus onboarding seeds (0,0) as the active cell (the seeded cell then takes DOM focus — the same landing a Tab-in gets). No-op while an edit session is open — focusing the cell would blur the editor input and commit it. |
   | `startEditing(ref: CellRef)` | delegates to `actions.startEditing` (same guards). |
   | `stopEditing()` | delegates to `actions.cancelEditing` — discards the draft, emits no change. Committing is the editor's job (`actions.commitCellEdit` for the direct path). |
   | `getSelection(): GridSelection` | non-reactive snapshot of the current selection. |
   | `setSelection(ref: CellRef \| null)` | single-cell selection via `actions.selectCell`; `null` clears via `actions.clearSelection`. |
   | `getRow(viewRowIndex: number): TData \| undefined` | non-reactive `data[viewIndex[viewRowIndex]]` — the same read `useDataGridRow` performs. |
   | `getViewRowIds(): readonly string[]` | non-reactive row id per view row, in view order. |

2. **`useDataGridApi<TData>(ref?)`** — the single source of the handle. Called under
   `DataGridRoot` (it needs the root context's scroll container for `focus()`; outside the root
   `useDataGridRootContext` throws, which is the correct failure). Returns a `DataGridApi` that
   is memoized over only stable references (store api, actions, container ref, the scrollTo
   closure) — one object per grid, stable across re-renders. The optional `ref` argument is
   assigned imperatively via `useImperativeHandle`, so consumers of manual composition
   (`DataGridProvider` + `DataGridRoot`) get the same handle without a wrapper component.
   Exported from the `data-grid` barrel.

3. **`<DataGrid ref>`** — `DataGridProps<TData>` gains `ref?: Ref<DataGridApi<TData>>`
   (React 19 ref-as-prop). `DataGrid` renders a module-private null capture component inside
   `DataGridRoot` (a sibling of `children`/the default header+body) that calls
   `useDataGridApi<TData-erased>(ref)`; the `TData` → `unknown` erasure is the same boundary as
   the erased row/click callbacks in the same file. `DataGridApi` is therefore generic only for
   `getRow`; `store` and the selection reads stay row-agnostic.

4. **Out of scope:**
   - `scrollToAt` (positional variant) — `useDataGridScrollToCellAt` already exists for that
     caller; add it to the handle when a consumer needs it.
   - Setting an arbitrary `GridSelection` — the channel/range mechanics belong to the actions
     the handle already exposes.
   - `useDataGridStoreProps` stays — it remains the store-ownership path (external stores),
     not the imperative-access path.
   - Committing an edit through the handle — `stopEditing` cancels; committing stays with the
     editor and `commitCellEdit`.

## Impact

- `registry/default/blocks/data-grid/data-grid.tsx` — type, hook, capture component, `ref`
  prop forwarding; barrel exports `DataGridApi` and `useDataGridApi` (no new registry files,
  so `registry.json` is untouched — only the `data-grid` payload content changes).
- Tests: unit tests under `test/` — ref stability across re-renders, non-reactive reads under a
  sorted view, `setSelection`/`getSelection`, `startEditing`/`stopEditing`, `focus()` landing
  on the active cell (jsdom `document.activeElement`) and on the root before any cell is
  active, `focus()` no-op while editing, `scrollTo` through the handle.
- Docs: `api-reference.mdx` (the `DataGridProps` AutoTypeTable picks up `ref` automatically;
  hooks list and "Other exported types" gain the new entries) + a short "Imperative handle"
  section there. CHANGELOG `### Added` entry.

## Execution order

types + hook + capture in `data-grid.tsx` → tests (unit, jsdom) → gates → docs →
CHANGELOG → registry pipeline (`data-grid` payload) → e2e-install → commit.
