# Spec: controlled selection and column layout (W5-11, API-R7)

Decision record for making the selection and the column layout controllable in `CellRef` terms.
Today the selection is reachable only through a view-space event (`onSelectionChange(next:
GridSelection)`, `store/types.ts:196`) and the layout only through a seed plus an event
(`defaultColumnLayout`/`onColumnLayoutChange`, `store/types.ts:181-188`). Neither can be restored,
synced to a second view, or driven by the app.

## Decisions — selection

### 1. `SelectionState` is the public selection value

New exported type in the block-root `types.ts`, next to `CellRef`:

```ts
export type CellRange = { anchor: CellRef; focus: CellRef };
export type SelectionState = {
  range: CellRange | null;              // primary range: anchor = gesture start, focus = opposite corner
  rangeStack: readonly CellRange[];     // earlier Ctrl/Cmd-click ranges, oldest first
  rowIds: readonly string[];            // row channel, view order
  columnIds: readonly string[];         // column channel, view order
};
```

- The active cell is not part of it. The cursor moves on every arrow key; controlling it would push
  every keystroke through the consumer's render. It stays uncontrolled with `onActiveCellChange`.
- `GridSelection` (view space, `types.ts:123`) stays the internal and hook-level shape. Overlays,
  `useDataGridRowCellState`, clipboard, and fill keep reading it; the hot path is unchanged.
- Rejected: one `CellRef[]` per selected cell — O(cells) per drag step and per emit.
- Rejected: `{ viewRowIndex }` ranges — they are positional and cannot survive a sort.

### 2. Props

| Prop (`DataGridSyncProps`) | Semantics |
|---|---|
| `selection?: SelectionState` | Controlled value. Applied whenever its identity changes and it is not an echo (rule 4). |
| `defaultSelection?: SelectionState` | Seeds the store once at creation. With `selection` set too, `selection` wins and dev mode warns once (the `data`/`defaultData` rule). |
| `onSelectionChange?: (next: SelectionState, details: SelectionChangeDetails) => void` | `details` (`getValues`, `getRowIds`, `store/types.ts:253`) stays lazy. |
| ~~`onSelectionCleared`~~ | Removed. An empty `next` (`range === null`, both channels empty) is the cleared signal; rule 3 guarantees it fires once per transition. |

### 3. When `onSelectionChange` fires

- Only from the existing store subscription (`provider.tsx:26-33`) on a `state.selection` identity
  change, AND only when the derived `SelectionState` differs structurally from the last known
  value (the last emitted value, or the last applied controlled/default value).
- Never when the store applies a controlled `selection` or `defaultSelection` (no feedback loop).
- The W3-04 action bail-outs stay the first guard: `extendToAt`/`extendSelection` keep returning the
  same selection on an equal range, `selectRow`/`selectColumn` skip `set`
  (`create-store.ts:349-372`). A stationary drag fires nothing.
- The structural compare is the second guard: a view rebuild that re-projects the same identities
  (rule 6) creates a new view-space object but fires nothing.

### 4. Echo and fast path (the 60 fps drag rule)

Per drag step the internal work must equal today's: one `set`, one `DataGridOverlays` render.

- Derivation is cached per channel identity: `rowIds` is reused while `selection.rows`,
  `viewIndex`, and `data` keep their identity (same for `columnIds` with `selection.columns` and
  `visibleColumns`). A range-drag step derives two corner refs: O(1).
- The structural compare reuses that cache: unchanged channel → reference-equal arrays; ranges
  compare four ids each.
- Echo: `props.selection === lastKnown` skips the selection path entirely (no resolve).
- `_syncProps` gains a whole-sync early return: when every changed prop is an echo
  (`selection`, `columnLayout`), it returns without `set`. Today every sync calls `set` with a
  fresh state object (`create-store.ts:716-819`), which re-runs every store selector; a controlled
  echo per drag step would multiply that.
- The parent re-render that the consumer's own `setState` causes is the same render an uncontrolled
  consumer that stores the selection pays today; the grid adds nothing on top.

### 5. Gesture-first controlled semantics

A gesture writes the store at once and emits; the `selection` prop overrides the store whenever
its identity changes. A consumer that ignores the callback keeps the gesture's selection.

- Rejected: strict controlled (the `sortState` model, `store/types.ts:134-142`). Composite
  gestures read their own write back in the same tick (fill's `selectCellAt` then `extendToAt`,
  `use-fill-handle.ts:275-276`; `_moveActiveCell` extend), and the effect-based sync
  (`provider.tsx:262`) paints the drag one frame late. Open question 1 records the product choice.
- A non-echo value with a `range` moves `activeCell` to `range.anchor` (a normal cursor move:
  `onActiveCellChange` fires). Without a `range` the cursor stays.

### 6. Identity across sort, filter, data swaps, and column moves

A new `remapSelection(s, nextViewIndex, nextVisibleColumns, nextData)` in `create-store.ts`, a
sibling of `remapEditing` (`create-store.ts:133-164`), runs at every viewIndex/visibleColumns
rebuild (`_syncProps`, `toggleSort`, `setSorts`, `setFilters`, `setJoinOperator`, the column
actions, row ops, immediate `updateCells`). It replaces the positional row clamp at
`create-store.ts:783-785`.

- Row channel: follows identity. Old view rows → rowIds (old view) → new view rows (new view
  inverse). Rows that left the view leave the selection. **Breaking**: today the channel stays on
  the same view positions, so a sort leaves other records checked.
- Column channel: follows `columnId`; a hidden column leaves it.
- Ranges: kept when nothing under them moved (every covered view row keeps its data index, every
  covered column keeps its id); otherwise every range collapses onto the active cell (after the
  R-45 clamp). Rejected: corner identity — after a sort the rectangle between the two corner
  records silently absorbs unselected records, and Delete/Cut would hit them. Rejected: positional
  ranges — the emitted ids change although the user did nothing, and a controlled consumer cannot
  express "same position".
- Nothing moved → the selection object keeps its identity (no event, no overlay render).
- Cost: O(selected rows + view length) for the inverse, only when a channel is non-empty; the
  rebuild that triggers it is already O(n log n). The view inverse is R-56's lazy one (keyed on
  `viewIndex` identity); `resolveCellRef`'s `indexOf` (`row-index.ts:61`) is O(n) per ref and is
  not used here.

### 7. Resolving a controlled value

`resolveSelectionState(s, value): GridSelection` (store helper, also behind `actions.setSelection`):

- Corner refs resolve through the row-index cache plus the view inverse. A range with an
  unresolvable corner is dropped; unresolvable `rowIds`/`columnIds` are dropped. The store holds the
  resolvable subset and fires nothing; dev mode warns once per grid (the `resolveRefOrWarn`
  convention, `data-write.ts:78`).
- Lazy holes: emitted refs carry the placeholder id (`holeRowId`, `compute.ts:82`; R4 decision).
  A placeholder that no longer resolves (the hole loaded) falls back to its data index, so it stays
  positional. A hole loading inside the selection fires nothing (rule 6: nothing moved).
- Unknown shape (non-array channels, non-string ids): ignored with a dev warning, never thrown.

## Decisions — column layout

### 8. Props and state

| Prop / state | Semantics |
|---|---|
| `columnLayout?: Partial<ColumnLayout>` | Controlled. Applied on identity change unless it is an echo. An omitted part means "the column defs decide" (def width, pin, `hidden`, `columns` order). |
| `defaultColumnLayout?: Partial<ColumnLayout>` | Unchanged seed (`compute.ts:438`), now `Partial` to match its runtime handling. |
| `onColumnLayoutChange?: (next: ColumnLayout)` | Unchanged signature; fires only on a real change (rule 10). |
| `state.columnLayout: ColumnLayout` | New: the committed snapshot. Replaced only at commit points; its identity is the echo token and the plug point for add-ons. |
| `actions.setColumnLayout(parts: Partial<ColumnLayout>)` | New: each given part replaces that part of the committed layout, omitted parts keep the current value; one commit. |

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
  `columnOrder`, so a layout saved before a column was added hides that column forever.
- Widths go through `clampColumnWidth`; a pin on a `pinnable: false` column is dropped.
- Size is bounded by the column count, so a hostile URL cannot allocate past it.

### 10. Write-back points

One internal `commitLayout(s, nextParts)`: normalize → structural compare with
`s.columnLayout` → equal: no `set`, no event → else write `columnWidths`/`columnOrder`/
`hiddenColumns`/column pins and the snapshot in one `set`, then fire `onColumnLayoutChange` once.
Every commit site calls it:

| Gesture | Action (`create-store.ts`) |
|---|---|
| Resize release, header double-click autosize (`use-column-resize.ts:90,124`), context-menu autosize | `commitColumnWidth` (426) |
| Width reset | `resetColumnWidth` (434) |
| Reorder drop | `setColumnOrder` (441) |
| Pin / unpin | `setColumnPin` (454) |
| Show / hide (columns menu, context menu) | `setColumnHidden` (470) |
| App / URL / restore | `setColumnLayout` (new) |

- `setColumnWidth` (per drag frame, 420) stays live-only: it writes `columnWidths`, fires
  `onColumnResizing`, never replaces the snapshot.
- Today `setColumnHidden`/`setColumnPin` fire even when nothing changed; the compare fixes that.
- Controlled apply runs the same normalize + write without the event.
- A new `columns` array in controlled mode re-applies the controlled layout over the new defs.
  Today a new array drops runtime pins (`create-store.ts:741`); uncontrolled mode keeps that rule.

### 11. How Wave 6 plugs in

- W6-02 `autosizeColumns({ columnIds?, sampleRows?, includeHeader? })`: measures, then calls
  `setColumnLayout({ widths: { ...current.widths, ...measured } })` — one commit, one event. The
  mounted-cell measurer it replaces lives in the context-menu add-on
  (`data-grid-context-menu/autosize-column.ts`), not in core.
- W6-07 URL layout: the url-state add-on subscribes to `state.columnLayout` identity (commit points
  only, never drag frames) and writes the opted-in parts; on load and history navigation it calls
  `setColumnLayout(parsedParts)`. The normalizer bounds the URL input.
- W6-10 column groups: group contiguity and pin splitting live in `normalizeColumnLayout` and
  `reorderColumnIds`, so gestures, the prop, `setColumnLayout`, and URL input all obey them.

## Imperative handle

`DataGridApi` (`types.ts:669`, `store/api.ts:40-49`): `getSelection(): SelectionState`;
`setSelection(next: SelectionState | null)` (`null` clears). New `actions.setSelection(next)`;
it emits like a gesture. A single-cell selection stays `actions.selectCell(ref)`.

## Migration

| Old | New |
|---|---|
| `onSelectionChange(next: GridSelection, details)` | `onSelectionChange(next: SelectionState, details)` (**Breaking**) |
| `onSelectionCleared()` | `onSelectionChange`, test `next.range === null && !next.rowIds.length && !next.columnIds.length` (**Breaking**) |
| — | `selection`, `defaultSelection`, `actions.setSelection` |
| `api.getSelection(): GridSelection` | `api.getSelection(): SelectionState` (**Breaking**) |
| `api.setSelection(ref \| null)` | `api.setSelection(state \| null)`; one cell: `actions.selectCell(ref)` (**Breaking**) |
| Row channel stays on view positions across sort/filter | Row channel follows row identity (**Breaking**) |
| Ranges stay on view positions across a row move | Ranges collapse onto the active cell (**Breaking**) |
| `defaultColumnLayout: ColumnLayout` | `defaultColumnLayout: Partial<ColumnLayout>`, normalized |
| — | `columnLayout`, `actions.setColumnLayout`, `state.columnLayout` |
| `onColumnLayoutChange` fired on no-op pin/hide | Fires only on a real change (**Breaking**) |

## Test plan

Unit (`test/controlled-selection.test.tsx`, `test/controlled-layout.test.tsx`):

- Echo: a consumer that feeds back each emitted value causes zero store notifications for that sync
  (a `store.subscribe` spy) and no view recompute.
- Stationary `extendToAt` fires nothing; N distinct drag steps fire N events.
- `rowIds` keeps its array identity across a range drag while the row channel is unchanged.
- Sort with a row-channel selection: the same records stay selected and nothing fires. Filter that
  drops one selected row: one event without it. Sort under a range: one event, collapsed onto the
  active cell. A data swap that moves nothing keeps the selection identity.
- Controlled value naming a hidden column or a missing row: the resolvable subset applies, no event,
  one dev warning. `defaultSelection` seeds once; both props set: `selection` wins, one warning.
- Lazy: a placeholder ref resolves to its data index; a hole that loads fires nothing.
- Layout: every write-back point in rule 10 fires once; a no-op pin/hide/width fires nothing;
  controlled echo writes nothing; a non-echo prop applies without an event; normalization (unknown
  ids, missing ids appended, clamped widths, unpinnable pins); `setColumnLayout` replaces parts and
  fires once; a new `columns` array keeps controlled pins.
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
- Select-all at 1M rows: one emission (O(n) `rowIds`), measured once.

## Open product questions

1. Gesture-first vs strict controlled `selection` (rule 5). Recommendation: gesture-first. Strict
   control breaks same-tick composite gestures and paints drags one frame late; the consumer can
   still override any gesture by passing a new value.
