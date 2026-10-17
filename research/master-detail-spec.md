# Spec: master-detail rows (W6-14, FEAT-11)

## Goal

A data row can open a full-width detail panel directly below it (`renderDetail`), with a known
height. The panel holds any React content: a form, a chart, or a nested grid. It scrolls with its
row, stays horizontally fixed to the viewport, and never leaks its keys, clicks, or clipboard
events into the host grid.

Written against the API after Wave 5, W6-12 (`ExpandedState` and its echo plumbing), and W6-13
(`RowGeometry`, explicit window tracks).

## Current state (verified)

- One canvas grid item per data row; rows are placed by `gridRowStart = viewRow − effectiveStart
  + 1`, written imperatively (`body.tsx:244-252`). After W6-13 the canvas has explicit
  `gridTemplateRows` for the window in variable mode.
- Overlays place by row lines relative to `windowStart` (`overlays.tsx:109-128`, `RangeOverlay`;
  plugin overlays get `windowStart` in `OverlayPluginCtx`), so a non-data track between two rows
  would shift every overlay below it.
- The root's `onKeyDown` dispatches for any key that bubbles from inside the root unless the target
  is an `INPUT`/`SELECT`/`TEXTAREA`, a cell editor, or outside the root
  (`interaction/use-grid-interaction.ts:837-909`). A key from a `contenteditable` or a custom widget
  inside the root reaches grid bindings: `Delete` would clear host cells.
- `useGridClipboard` listens on the root (`root.tsx:281`); a `copy` inside nested content would copy
  the host selection.
- `onRootPointerDown` clears the selection on a press outside cells (`use-grid-interaction.ts:1069`).
- The context menu resolves its target from the event target (`data-grid-context-menu/context-menu.tsx:89-108`).
- `aria-rowindex = viewRow + 2 + pinnedTopCount` (`row.tsx:94`) assumes one DOM row per view row.

## Decisions

1. **The detail is its own grid row in its own track.** It renders as a sibling `role="row"` placed
   in the track after its data row; the window's track list interleaves `rowHeight(row)` and
   `detailHeight(row)` for open rows. Rejected: a second line inside the data row element — a
   `role="row"` may hold only cells, and a full-width cell next to data cells breaks
   `aria-colindex`.
2. **Selection space does not change.** Detail rows are not view rows: `viewIndex`, `ViewCoord`,
   `CellRef`, `SelectionState`, clipboard, and fill never see them. A range across open rows renders
   as one overlay segment per run of data tracks. Rejected: detail rows as navigable view rows —
   every selection, paste, and fill path would need a "not a data row" branch.
3. **Known height only.** `detailHeight: number | (row) => number`, clamped to [1, 10,000] px;
   taller content scrolls inside the panel with `overscroll-behavior: contain`. Rejected: measured
   height — W6-13 keeps measured auto-height out.
4. **Open state reuses `ExpandedState`.** `detailExpanded` takes the W6-12 type and its
   gesture-first echo rules; "all open" is one O(1) value. Rejected: a new `string[]` shape — two
   expansion APIs with different semantics in one grid.
5. **Hard event isolation.** The host ignores every key, pointer, click, double-click, context-menu,
   and clipboard event whose target is inside its own `[data-grid-detail]` element, except the two
   detail keys in decision 6. Rejected: the current editor-input check — it misses
   `contenteditable` and custom widgets, and a nested grid's keys would move the host cursor.
6. **Keyboard: one toggle key plus focus hand-off.** New built-in action `toggleDetail`, default
   `alt+Enter`, toggles the active row's detail. Opening by keyboard moves focus to the detail cell;
   `Escape` that the content leaves unhandled (`!event.defaultPrevented`) or `alt+Enter` inside the
   detail returns focus to the row's active cell (`alt+Enter` also closes). Rejected: arrow keys on a
   toggle column — W6-12 uses those keys for tree expand and collapse.
7. **The panel is horizontally fixed.** The detail cell spans `1 / -1`; its inner panel offsets by
   `var(--grid-scroll-left)` with width `var(--grid-viewport-width)`, so it stays in view while the
   columns scroll (logical insets mirror it in RTL). Rejected: one panel per pin zone — the content
   is one component.

## API

```ts
// DataGridRootProps (render slot, W5-12 rule)
renderDetail?: (ctx: DetailRenderCtx<TData>) => ReactNode;  // pass a stable reference
export type DetailRenderCtx<TData> = { row: TData; rowId: string; viewRowIndex: number; close(): void };

// DataGridSyncProps
detailHeight?: number | ((row: TData) => number); // default 240; geometry input (recompute phase)
hasDetail?: (row: TData) => boolean;              // default: every loaded row
detailToggleColumn?: string;                      // default: first visible column (config phase)
detailExpanded?: ExpandedState;                   // recompute phase
defaultDetailExpanded?: ExpandedState;            // default { mode: "collapsed", ids: [] }
onDetailExpandedChange?: (next: ExpandedState) => void;

// GridActions: toggleDetail (default keymap: alt+Enter)
// DataGridActions
setDetailExpanded(next: ExpandedState): void;
toggleDetail(rowId: string): void;

// RowGeometry (W6-13) additions
detailOf(viewRow: number): number;        // detail px, 0 when closed
ariaIndexOf(viewRow: number): number;     // 1-based offset including open details above
// OverlayPluginCtx additions (sdk)
rowTracks(rect: GridRect): { gridRowStart: number; gridRowEnd: number }[]; // data-track runs
```

Store state: `detailOpen: Uint8Array | null` in data-index space, rebuilt from `detailExpanded` and
the row-id map on a data swap (O(n)), updated in O(1) per toggle. The root's geometry builder reads
it, so a toggle rebuilds one prefix (O(n)).

## Behavior

- **Rendering.** The body maps each window row to one or two tracks and writes both
  `gridRowStart`s in its layout effect. The detail row mounts only while its data row is in the
  window. A detail that holds focus stays mounted when it scrolls out (the active-row rule), so typing
  in a detail form never loses focus.
- **Toggle UI.** `detailToggleColumn`'s cell renders a chevron button for rows where `hasDetail`
  is true; when that column is also W6-12's tree column, the chevron follows the tree toggle.
- **Overlays.** `DataGridOverlays` and every plugin overlay place rects through `rowTracks`, which
  splits a rect at open details (window-bounded loop). Fill (W5-13 plugin) and presence switch to it.
- **Pointer.** A pointer over a detail row maps to no cell; a range or fill drag over it extends to
  the data row above (`pointerToCoord` via `indexAt` on units).
- **Selection and CellRef.** Unchanged. `api.scrollTo(ref)` scrolls the data row into view, not its
  detail.
- **Sort and filter.** Open state is id-keyed and survives sorting; a filtered-out row's detail
  returns open with the row. A data swap prunes ids not in `data`.
- **Editing.** Independent: the host edit session stays open while a detail toggles. A key typed in a
  detail never starts or commits a host edit (decision 5).
- **Clipboard and fill.** Copy, cut, paste, and fill act on data rows only. Copy inside a detail is the
  detail's own business; the host ignores it.
- **readOnly.** Toggling stays available (view state). The detail content owns its own read-only
  state; `DetailRenderCtx` carries no write API.
- **Commands and plugins.** `toggleDetail` dispatches like any built-in; consumers can rebind it.
  Plugins read `detailOpen` through `DataGridReadState`.
- **Nested grids.** A gridcn inside a detail is supported: own provider and store, own instance id;
  global shortcuts and search capture already scope to the focused grid.
- **Pinned rows, column groups, tree data.** Bands are unaffected; group headers are unaffected; a
  tree row can have a detail. W6-15 group rows never have one.
- **Lazy loading.** Holes have no row, so no detail.

## Security

- Decision 5 closes a write path: today a `Delete` keypress in a `contenteditable` inside the grid
  root runs `deleteContents` on the host selection. The isolation check is one `closest()` per event
  against this grid's own detail attribute (`[data-grid-detail="<instanceId>"]`), so a nested grid's
  own details do not confuse the host.
- `detailHeight` results that are not finite fall back to the default; the clamp keeps the prefix
  bounded. The W6-13 15M px total-height warning covers "all open" on large data.
- `renderDetail` output is React content; no HTML strings are injected by the grid.

## Performance

- Closed details cost nothing per row: `detailOf` reads one bitmap entry while the prefix builds.
- Toggle: one O(n) prefix rebuild; budget ≤ 3 ms at 100k rows (W6-13 prefix budget).
- Window: the track list grows to at most 2 × window rows; built in the existing window memo.
- Overlay splitting is O(open details in the window) per overlay render.
- Event isolation adds one `closest()` per host event, never per cell or per scroll tick.
- Budgets (browser): scrolling 100k rows with 1,000 open details (each a static 200 px panel) keeps
  the `perf.browser` FPS ratio within its bar; opening a detail with a nested 1,000-row grid paints
  in ≤ 2 frames on the perf machine.

## Accessibility

- Detail row: `role="row"`, `aria-rowindex` from `ariaIndexOf`; one `role="gridcell"` with
  `aria-colindex="1"`, `aria-colspan` = visible column count (+1 with a marker column), `tabIndex={-1}`,
  and `aria-label` from `labels.detail.panel(rowLabel)`.
- Data rows take `aria-rowindex` from `ariaIndexOf` too; `aria-rowcount` adds the open details.
- The toggle is a `button` (`tabIndex={-1}`) with `aria-expanded` and `aria-controls` pointing at the
  detail cell id.
- `toggleDetail` is listed in the keybindings dialog; focus hand-off per decision 6.

## Files to add or change

- Add `data-grid/rows/detail-row.tsx`, `data-grid/rows/detail-toggle.tsx`.
- `types.ts` (`DetailRenderCtx`, `toggleDetail` in `GridActions`), `keyboard/default-keymap.ts`,
  `labels.ts` (`detail` group).
- `store/types.ts`, `store/create-store.ts` (state, actions, echo queue reuse from W6-12).
- `windowing/row-geometry.ts` (`detailOf`, `ariaIndexOf`, unit heights), `body.tsx` (track map,
  focused-detail retention), `row.tsx`, `root.tsx` (`aria-rowcount`, `renderDetail` slot),
  `overlays.tsx` (`rowTracks`).
- `interaction/use-grid-interaction.ts` (isolation, `toggleDetail`, pointer mapping),
  `clipboard/use-grid-clipboard.ts` (isolation).
- `data-grid-context-menu/resolve-context-menu-target.ts` (detail targets resolve to `null`).
- `data-grid-fill`, `data-grid-presence`: overlays through `rowTracks`.

## Docs, registry, CHANGELOG

- New page `content/docs/master-detail.mdx` with example `data-grid-master-detail-demo` (detail
  with a form and one with a nested grid); `accessibility.mdx`; `selection-keyboard.mdx`
  (`alt+Enter`); `overlay-plugins.mdx` (`rowTracks`).
- CHANGELOG `### Added`; **Breaking:** overlay plugins must place rows through `rowTracks` (a plugin
  that computes `gridRowStart` from `windowStart` misplaces rects once a detail is open).
- Payloads: `data-grid`, `data-grid-fill`, `data-grid-presence`, `data-grid-context-menu`;
  `test:e2e-install`.

## Test plan

- Unit `row-geometry-detail.test.ts`: unit heights, `detailOf`, `ariaIndexOf`, `indexAt` inside a
  detail returns its owner; clamps and fallbacks.
- Unit `master-detail.test.tsx`: toggle emits once; controlled echo; "all open" mode; open state
  survives sort and filter; data swap prunes ids; `hasDetail` false hides the toggle; read-only grid
  still toggles; `toggleDetail` key.
- Unit isolation: `Delete` in a `contenteditable` inside a detail writes nothing to the host; arrow
  keys inside a nested grid move only the nested cursor; `copy` inside a detail does not copy the
  host selection; a press inside a detail keeps the host selection; context menu does not open for
  the host.
- Browser: track placement with mixed open details; range overlay splits around a detail; fill drag
  across a detail; focus hand-off (`alt+Enter` in, `Escape` out); focused detail stays mounted after
  scrolling away; horizontal scroll keeps the panel fixed (LTR and RTL); axe clean.
- Perf: the budgets above.

## Dependencies

- W6-12 (`ExpandedState`, echo plumbing, toggle component, toggle column rules).
- W6-13 (`RowGeometry`, explicit window tracks, height clamps and warnings).
- W5-13 (overlay plugin ctx), W5-12 (render slot and sync-prop homes), R-57 (cell events ignore
  portal content).

## Open product questions

1. Several open details at once, or one at a time? Recommendation: several; a consumer who wants one
   at a time passes a controlled `detailExpanded` that keeps only the last id.
2. Should opening a detail by keyboard move focus into it? Recommendation: yes (decision 6); the
   reader opened it to use it, and `Escape` returns.
3. Should the detail height grow to its content? Recommendation: no, known heights only; content
   scrolls inside the panel.
