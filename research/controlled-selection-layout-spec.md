# Spec: controlled selection and column layout (W5-11, API-R7)

Decision record for making the selection and the column layout controllable in `CellRef` terms.
Today the selection is reachable only through a view-space event (`onSelectionChange(next:
GridSelection)`, `store/types.ts:196`) and the layout only through a seed plus an event
(`defaultColumnLayout`/`onColumnLayoutChange`, `store/types.ts:181-188`). Neither can be restored,
synced to a second view, or driven by the app.

Lands after W5-12 (its two-phase sync carries `selection` and `columnLayout` in the recompute
phase) and depends on R-56 (the lazy view inverse, decision 6).

## Decisions — selection

### 1. `SelectionState` is the public selection value

New exported types in the block-root `types.ts`, next to `CellRef`:

```ts
export type CellRange = { start: CellRef; end: CellRef };   // opposite corners
export type SelectionState = {
  anchor: CellRef | null;               // the primary range's anchor; may lie inside the range
  range: CellRange | null;              // primary range
  rangeStack: readonly CellRange[];     // earlier Ctrl/Cmd-click ranges, oldest first
  rowIds: readonly string[];            // row channel, view order
  columnIds: readonly string[];         // column channel, view order
};
```

- `anchor` maps `GridSelection.current.cell`. It is not always a corner: Ctrl+A puts the active cell
  as the anchor inside the region or whole-grid rect (`selectionForRect(rect, active)`,
  `selection/select-all-progression.ts:67-73`). When a value is resolved, an anchor outside its
  range resets to `range.start`.
- The active cell is not part of it. The cursor moves on every arrow key; controlling it would push
  every keystroke through the consumer's render. It stays uncontrolled with `onActiveCellChange`.
- `GridSelection` (view space, `types.ts:123`) stays the internal and hook-level shape. Overlays,
  `useDataGridRowCellState`, clipboard, and fill keep reading it; the hot path is unchanged.
- Rejected: one `CellRef[]` per selected cell — O(cells) per drag step and per emit.
- Rejected: `{ viewRowIndex }` ranges — they are positional and cannot survive a sort.

### 2. Props

| Prop (`DataGridSyncProps`) | Semantics |
|---|---|
| `selection?: SelectionState` | Controlled value. Applied when its identity changes, it is not an echo (decision 4), and it differs structurally from the grid's current value. |
| `defaultSelection?: SelectionState` | Seeds the store once. With `selection` set too, `selection` wins and dev mode warns once (the `data`/`defaultData` rule). |
| `onSelectionChange?: (next: SelectionState, details: SelectionChangeDetails) => void` | `details` (`getValues`, `getRowIds`, `store/types.ts:253`) stays lazy. |
| ~~`onSelectionCleared`~~ | Removed. An empty `next` (`range === null`, both channels empty) is the cleared signal; decision 3 makes it fire once per transition. |

`selection`, `defaultSelection`, `columnLayout`, and `defaultColumnLayout` resolve inside
`createDataGridStore` (`create-store.ts:86`), so the server render and the first client paint
show them.

### 3. When `onSelectionChange` fires

- Only from the existing store subscription (`provider.tsx:26-33`) on a `state.selection` identity
  change, AND only when the derived `SelectionState` differs structurally from the grid's last
  known value (the last emitted value, or the last applied controlled or default value).
- Derivation and the compare run only when `onSelectionChange` is set or `selection` is
  controlled. Otherwise the subscription returns at once; `api.getSelection()` derives on demand.
- Never when the store applies a controlled `selection` or `defaultSelection` (no feedback loop).
- The W3-04 action bail-outs stay the first guard: `extendToAt`/`extendSelection` keep returning the
  same selection on an equal range, `selectRow`/`selectColumn` skip `set`
  (`create-store.ts:349-372`). A stationary drag fires nothing.
- The structural compare is the second guard: a view rebuild that re-projects the same identities
  (decision 6) creates a new view-space object but fires nothing.

### 4. Echo and fast path (the 60 fps drag rule)

Per drag step the internal work must equal today's: one `set`, one `DataGridOverlays` render.

- Derivation is cached per channel identity: `rowIds` is reused while `selection.rows`,
  `viewIndex`, and `data` keep their identity (same for `columnIds` with `selection.columns` and
  `visibleColumns`). A range-drag step derives three refs: O(1).
- In-flight queue: the store closure keeps every emitted value that no prop has confirmed yet, in
  emit order. A prop equal (`===`) to a queued value is an echo: it and every older entry leave the
  queue, and nothing applies. A consumer that lags several steps behind a drag therefore never
  snaps the selection back to an older step. Any other new prop identity applies only when it
  differs structurally from the current value, so an inline literal equal to the current value
  applies nothing. Rejected: a single last-emitted check — a consumer one step behind would
  re-apply a stale step mid-drag.
- `_syncProps` gains a whole-sync early return: when every changed prop is an echo or a
  structurally equal value (`selection`, `columnLayout`), it returns without `set`. Today every
  sync calls `set` with a fresh state object (`create-store.ts:716-819`), which re-runs every store
  selector; a controlled echo per drag step would multiply that.
- The parent re-render that the consumer's own `setState` causes is the same render an uncontrolled
  consumer that stores the selection pays today; the grid adds nothing on top.

### 5. Gesture-first controlled semantics

A gesture writes the store at once and emits; the `selection` prop overrides the store whenever
it applies (decision 4). A consumer that ignores the callback keeps the gesture's selection. The
same model holds for `columnLayout` (decision 8).

- Rejected: strict controlled (the `sortState` model, `store/types.ts:134-142`). Composite
  gestures read their own write back in the same tick (fill's `selectCellAt` then `extendToAt`,
  `use-fill-handle.ts:275-276`), and a round trip through the consumer per drag step paints the
  drag late. The open question below records the product choice.
- An applied value with an `anchor` moves `activeCell` to the anchor (a normal cursor move:
  `onActiveCellChange` fires). Without an anchor the cursor stays.

### 6. Identity across view rebuilds

A new `remapSelection(s, nextViewIndex, nextVisibleColumns, nextData)` in `create-store.ts`, a
sibling of `remapEditing` (`create-store.ts:133-164`), runs on view rebuilds only: `_syncProps`,
`toggleSort`, `setSorts`, `setFilters`, `setJoinOperator`, `setColumnOrder`, `setColumnPin`,
`setColumnHidden`, and immediate `updateCells`. It replaces the positional row clamp at
`create-store.ts:783-785`.

Row ops keep their own selection rules: insert and duplicate shift the selection
(`offsetSelectionForRows`, `data-write.ts:543,608`), reorder follows the moved row
(`reorderSelectionForRow`, `data-write.ts:658`).

- Row channel: follows identity. Old view rows → rowIds (old view) → new view rows (new view
  inverse). Rows that left the view leave the selection. **Breaking**: today the channel stays on
  the same view positions, so a sort leaves other records checked, and a later `deleteRows` on the
  checked rows deletes records the user never checked.
- Column channel: follows `columnId`; a hidden column leaves it.
- Ranges: a range stays when its view rect still covers the same records as a set (and the same
  column ids); otherwise every range collapses onto the active cell (after the R-45 clamp). A
  Ctrl+A whole-grid range therefore survives a sort. Rejected: corner identity — after a sort the
  rectangle between the two corner records silently absorbs unselected records, and Delete/Cut
  would hit them. Rejected: positional ranges — the emitted ids change although the user did
  nothing.
- Nothing moved → the selection object keeps its identity (no event, no overlay render).
- Cost: a range checks its covered rows directly, O(range height). The view inverse (R-56's lazy
  one, keyed on `viewIndex` identity) is built only for a non-empty row channel. Immediate
  `updateCells` remaps only the rows it moved. `resolveCellRef`'s `indexOf` (`row-index.ts:61`) is
  O(n) per ref and is not used here.

### 7. Resolving a controlled value

`resolveSelectionState(s, value): GridSelection` (store helper, also behind `actions.setSelection`):

- Corner refs resolve through the row-index cache plus the view inverse. A range with an
  unresolvable corner is dropped; unresolvable `rowIds`/`columnIds` are dropped; an unresolvable or
  outside anchor resets to `range.start`. The store holds the resolvable subset and fires nothing;
  dev mode warns once per grid (the `resolveRefOrWarn` convention, `data-write.ts:78`).
- Lazy holes: emitted refs carry the placeholder id (`holeRowId`, `compute.ts:82`; R4 decision).
  A placeholder that no longer resolves (the hole loaded) falls back to its data index, so it stays
  positional. A hole loading inside the selection fires nothing (decision 6: nothing moved).
- Unknown shape (non-array channels, non-string ids): ignored with a dev warning, never thrown.

## Decisions — column layout

### 8. Props and state

| Prop / state | Semantics |
|---|---|
| `columnLayout?: Partial<ColumnLayout>` | Controlled, gesture-first (decision 5), with the decision 4 echo queue. An omitted part stays uncontrolled: the store keeps its current value for it. |
| `defaultColumnLayout?: Partial<ColumnLayout>` | Unchanged seed (`compute.ts:438`), now `Partial` to match its runtime handling. |
| `onColumnLayoutChange?: (next: ColumnLayout)` | Unchanged signature; fires only at commit points on a real change (decision 10). |
| `state.columnLayout: ColumnLayout` | New: the current layout snapshot, recomputed at every layout write. Its identity is the echo token and the plug point for add-ons. |
| `actions.setColumnLayout(parts: Partial<ColumnLayout>)` | New: each given part replaces that part, omitted parts keep the current value; one commit. |

The omitted-part rule is the same for the prop and the action, so `columnLayout={{ widths }}`
controls only widths and a user reorder survives.

`_syncProps` must destructure `selection`, `defaultSelection`, `columnLayout`, and
`defaultColumnLayout` out of its `...props` spread (`create-store.ts:787`): `state.selection` and
`state.columnLayout` are store-owned shapes, not the props.

The plan's "absorbs the `setColumnLayout` action" names an action that does not exist yet (no
`setColumnLayout` anywhere in `registry/`); this spec adds it as the imperative twin of the prop.

### 9. One normalizer

`normalizeColumnLayout(columns, parts)` in `store/compute.ts` runs for `defaultColumnLayout`,
`columnLayout`, `setColumnLayout`, and (W6-07) URL input:

- Unknown column ids are dropped from every part; `order` gets missing ids appended in def order.
  Today `computeVisibleColumns` (`compute.ts:396-407`) does not render a column missing from
  `columnOrder`, so a saved layout from before a column was added hides that column forever.
- Widths go through `clampColumnWidth`; a pin on a `pinnable: false` column is dropped.
- Size is bounded by the column count, so a hostile URL cannot allocate past it.

### 10. Write-back points

`state.columnLayout` is recomputed at every layout write, including a `columns` swap in
`_syncProps` (which re-seeds def-hidden ids and drops runtime pins today, `create-store.ts:741-746`),
so it is always current. Only commit points fire the event, through one internal
`commitLayout(s, nextParts)`: normalize → structural compare with the always-current
`s.columnLayout` → equal: no `set`, no event → else write `columnWidths`/`columnOrder`/
`hiddenColumns`/column pins and the snapshot in one `set`, then fire `onColumnLayoutChange` once.

| Gesture | Action (`create-store.ts`) |
|---|---|
| Resize release, header double-click autosize (`use-column-resize.ts:90,124`), context-menu autosize | `commitColumnWidth` (426) |
| Width reset | `resetColumnWidth` (434) |
| Reorder drop | `setColumnOrder` (441) |
| Pin / unpin | `setColumnPin` (454) |
| Show / hide (columns menu, context menu) | `setColumnHidden` (470) |
| App / URL / restore | `setColumnLayout` (new) |

- `setColumnWidth` (per drag frame, 420) stays live-only: it writes `columnWidths`, fires
  `onColumnResizing`, and never fires the event.
- Today `setColumnHidden`/`setColumnPin` fire even when nothing changed; the compare fixes that.
- A controlled apply runs the same normalize + write without the event. In controlled mode a new
  `columns` array re-applies the controlled parts over the new defs.

### 11. How Wave 6 plugs in

- W6-02 `autosizeColumns({ columnIds?, sampleRows?, includeHeader? })`: measures, then calls
  `setColumnLayout({ widths: { ...current.widths, ...measured } })` — one commit, one event. The
  mounted-cell measurer it replaces lives in the context-menu add-on
  (`data-grid-context-menu/autosize-column.ts`), not in core.
- W6-07 URL layout: the url-state add-on subscribes to `state.columnLayout` and writes the opted-in
  parts when they change (it compares parts, so a live drag frame that touches only widths writes
  nothing for an `order` + `hidden` link); on load and history navigation it calls
  `setColumnLayout(parsedParts)`. The normalizer bounds the input.
- W6-10 column groups: group contiguity and pin splitting live in `normalizeColumnLayout` and
  `reorderColumnIds`, so gestures, the prop, `setColumnLayout`, and URL input all obey them.

## Imperative handle

`DataGridApi` (`types.ts:669`, `store/api.ts:40-49`): `getSelection(): SelectionState` (derived on
demand); `setSelection(next: SelectionState | null)` (`null` clears). New
`actions.setSelection(next)`; it emits like a gesture. A single-cell selection stays
`actions.selectCell(ref)`.

## Migration

| Old | New |
|---|---|
| `onSelectionChange(next: GridSelection, details)` | `onSelectionChange(next: SelectionState, details)` (**Breaking**) |
| `onSelectionCleared()` | `onSelectionChange`, test `next.range === null && !next.rowIds.length && !next.columnIds.length` (**Breaking**) |
| `GridSelection.current.cell` (anchor) | `SelectionState.anchor` |
| — | `selection`, `defaultSelection`, `actions.setSelection` |
| `api.getSelection(): GridSelection` | `api.getSelection(): SelectionState` (**Breaking**) |
| `api.setSelection(ref \| null)` | `api.setSelection(state \| null)`; one cell: `actions.selectCell(ref)` (**Breaking**) |
| Row channel stays on view positions across sort/filter | Row channel follows record identity (**Breaking**) |
| Ranges stay on view positions across a row move | A range stays only while it covers the same records, else collapses onto the active cell (**Breaking**) |
| `broadcasting-presence.mdx:60-72` sends `selection.current?.range` (view space) | Send `next.range` (refs) for the rowId-native form, or map the range's rows through `details.getRowIds()` |
| `data-grid-events-demo.tsx:133` `(selection: GridSelection, details)` | `(selection: SelectionState, details)`; log `anchor`/`range` |
| `data-grid-column-layout-demo.tsx:114-115` seed + persist | Same seed path; the demo text drops "NOT controlled" and points to `columnLayout` |
| `defaultColumnLayout: ColumnLayout` | `defaultColumnLayout: Partial<ColumnLayout>`, normalized (missing ids appended, unknown ids dropped) |
| — | `columnLayout`, `actions.setColumnLayout`, `state.columnLayout` |
| `onColumnLayoutChange` fired on a no-op pin/hide | Fires only on a real change (**Breaking**) |

## Test plan

Unit (`test/controlled-selection.test.tsx`, `test/controlled-layout.test.tsx`):

- Echo: a consumer that feeds back each emitted value causes zero store notifications for that sync
  (a `store.subscribe` spy) and no view recompute.
- Lagging consumer: emit steps 1..5, then pass step 2, then step 5 — no snap-back, no apply.
- An inline literal structurally equal to the current selection or layout applies nothing.
- Stationary `extendToAt` fires nothing; N distinct drag steps fire N events.
- No `onSelectionChange` and no `selection`: the subscription derives nothing (derive spy).
- A Ctrl+A selection with an inside anchor survives a controlled round trip with the same anchor.
- `rowIds` keeps its array identity across a range drag while the row channel is unchanged.
- Sort with a row-channel selection: the same records stay checked and nothing fires; check rows,
  sort, then `deleteRows` on the checked rows deletes only the checked records. Filter that drops
  one checked row: one event without it. Sort under a partial range: one event, collapsed onto the
  active cell. Sort under a Ctrl+A whole-grid range: no event. A data swap that moves nothing keeps
  the selection identity. Insert and reorder keep their `offsetSelectionForRows` /
  `reorderSelectionForRow` results.
- Controlled value naming a hidden column or a missing row: the resolvable subset applies, no event,
  one dev warning. `defaultSelection` seeds once; both props set: `selection` wins, one warning.
- Lazy: a placeholder ref resolves to its data index; a hole that loads fires nothing.
- Layout: every write-back point in decision 10 fires once; a no-op pin/hide/width fires nothing;
  controlled echo writes nothing; a non-echo prop applies without an event; normalization (unknown
  ids dropped, missing ids appended, clamped widths, unpinnable pins); `setColumnLayout` replaces
  parts and fires once; a `columns` swap followed by a pin fires exactly once; `{ widths }`-only
  control keeps a user reorder; a new `columns` array keeps controlled pins.
- SSR: `renderToString` with `defaultSelection` and `columnLayout` paints them in the first render.
- Type test: `SelectionState` assignability; `onSelectionCleared` absent from `DataGridProps`.

Browser:

- Controlled drag-select over 20 cells: the `renderCell` probe (`scroll-drag.browser.test.tsx`
  pattern) counts the same cell renders as the uncontrolled baseline whose `onSelectionChange`
  stores the value in state; only `DataGridOverlays` renders per step.
- Controlled resize drag: `onColumnResizing` per frame, `onColumnLayoutChange` once at release, no
  snap-back after the echo.

Perf (`store/selection-perf.test.ts`, the `commit-perf.test.ts` pattern; budgets = measured
baseline + 20 %, recorded in the test):

- 1,000 controlled drag steps at 100k rows: mean store work per step (set + derive + echo sync).
- Sort at 100k rows with a 1,000-row channel selection: `remapSelection` overhead.
- Immediate `updateCells` ticks at 100k rows with a 1,000-row channel selection: remap of the moved
  rows only.
- Select-all at 1M rows: one emission (O(n) `rowIds`), measured once.

## Open product questions

1. Gesture-first vs strict controlled `selection` and `columnLayout` (decision 5). Recommendation:
   gesture-first. Strict control breaks same-tick composite gestures and paints drags late; the
   consumer can still override any gesture by passing a new value.
