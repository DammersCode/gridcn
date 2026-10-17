# Spec: variable row heights, known heights (W6-13, FEAT-10)

## Goal

Rows can have different heights that the consumer knows up front (`getRowHeight(row)`), and text in
chosen columns wraps inside them. Windowing, hit-testing, scroll-into-view, and paging use exact
prefix offsets. A grid without `getRowHeight` keeps today's arithmetic path, byte for byte. Measured
auto-height (render, then measure) stays out.

## Current state (verified)

Every vertical computation assumes one `rowHeight`:

| Site | Fixed-height math |
|---|---|
| `windowing/use-row-window.ts:61-81` (`computeWindow`) | `start = floor((scrollTop − dataRowTop) / rowHeight)`, `end = ceil(…)`, velocity rows `= velocityPx / rowHeight`, `windowTop = start × rowHeight` |
| `body.tsx:176-177` | `effectiveWindowTop = windowTop − (start − effectiveStart) × rowHeight` |
| `body.tsx:267` | canvas `gridAutoRows: rowHeight px`; rows placed by `gridRowStart = viewRow − effectiveStart + 1` (`body.tsx:244-252`) |
| `root.tsx:366` | `contentHeight = effectiveHeaderHeight + rowCount × rowHeight + pinnedBottomHeight` |
| `interaction/use-grid-interaction.ts:136-139` (`rowAtY`), `:146-174` (`pointerToCoord`) | `row = floor(y / rowHeight)` |
| `interaction/use-grid-interaction.ts:179-210` (`scrollCellIntoView`) | `cellTop = row × rowHeight` |
| `interaction/use-grid-interaction.ts:390-395` (page keys) | `visibleRows = floor(clientHeight / rowHeight) − 4` |
| `data-grid-fill/fill-tracker.tsx:12-32` | builds its own `InteractionLayout` with `rowHeight` |

Overlays place by grid lines, not pixels (`overlays.tsx`, `RangeOverlay`), so they follow whatever
row tracks the canvas defines. The off-window active row sits at its true implicit track today: with
uniform `gridAutoRows` the empty tracks between it and the window have the right height.

## Decisions

1. **One geometry object.** `RowGeometry` answers `offsetOf`, `heightOf`, `indexAt`, and `total`.
   The uniform implementation is arithmetic (no arrays); the variable one is a `Float64Array`
   prefix of length `n + 1` with binary-search `indexAt`. Every site in the table reads geometry
   instead of `rowHeight`. Rejected: an estimated-height virtualizer that corrects while scrolling —
   the scrollbar and `scrollTo` jump, and "known heights" makes estimates unnecessary.
2. **Heights live in the store, offsets in the root.** The store keeps `rowHeights: Float32Array |
   null` in data-index space, filled from `getRowHeight` on a data swap and updated only for touched
   rows on `updateCells`/`commitCellEdit`/row ops; its identity changes only when some height
   changed. The root builds the view-space prefix with `useMemo([viewIndex, rowHeights, rowHeight])`.
   Rejected: compute everything in the root — it would need every row object on every stream tick
   to find changed heights (O(n) per tick).
3. **Explicit row tracks for the window.** In variable mode the canvas sets
   `gridTemplateRows` to the window's heights (≤ `MAX_RENDERED_ROWS` = 200 entries,
   `use-row-window.ts:37`), built in the body's window memo. Rejected: `gridAutoRows: auto` with a
   per-row height style — the browser then sizes tracks from content, a layout cost on every window
   shift.
4. **The off-window active row sits next to the window.** It renders in a track directly above or
   below the window instead of at its true offset. The window already covers the viewport plus
   overscan, so the row stays out of sight; its only job is to keep focus. Rejected: true offset —
   the empty tracks between it and the window would need exact heights, up to 100k entries.
5. **`getRowHeight` is a sync prop (recompute phase); `wrap` is a column flag.** The store reads
   `getRowHeight` to maintain heights. Pinned bands keep the fixed `rowHeight`. Rejected: a root
   prop — W5-12 puts derived-state inputs in the store.
6. **Scroll anchoring.** When a height above the viewport changes, the root keeps the first visible
   row at the same screen position by adjusting `scrollTop` by the offset delta in a layout effect.
   Rejected: no anchoring — a streaming tick that grows a row above the viewport jumps the content.

## API

```ts
// DataGridSyncProps
getRowHeight?: (row: TData, dataRowIndex: number) => number;  // px; pass a stable reference

// ColumnDef
wrap?: boolean;  // text wraps and clamps to the lines that fit the row height

// data-grid-sdk
export type RowGeometry = {
  count: number;
  total: number;                         // px of all data rows
  uniform: number | null;                // the fixed height, or null in variable mode
  offsetOf(viewRow: number): number;     // top edge, px from data row 0
  heightOf(viewRow: number): number;
  indexAt(y: number): number;            // view row containing y, clamped to [0, count − 1]
};
// DataGridRootContextValue: rowGeometry: RowGeometry  (rowHeight stays: pinned bands, skeleton)
// InteractionLayout: rowGeometry replaces rowHeight
```

A lazy hole has no row: it takes the root `rowHeight`. A `getRowHeight` result that is not a finite
number ≥ 1 falls back to `rowHeight` and dev-warns once per grid.

## Behavior

- **Windowing.** `start = indexAt(scrollTop − dataRowTop) − startOverscan`,
  `end = indexAt(scrollTop + clientHeight − dataRowTop) + 1 + endOverscan`, and the velocity
  overscan converts px to rows through `indexAt(edge ± velocityPx)` instead of a division.
  `windowTop = offsetOf(start)`. `MAX_RENDERED_ROWS` stays.
- **Rows.** `DataGridRow` gets `--grid-row-lines` = `floor((height − 8) / 20)` as a style variable
  (row-level, not per cell); a `wrap` cell uses `whitespace-normal` + `line-clamp` from it and
  aligns to the top.
- **Selection, CellRef, overlays.** Unchanged shapes; overlays follow the tracks. Range drag and
  fill drag resolve rows through `pointerToCoord` with `indexAt`.
- **Keyboard.** `pageUp`/`pageDown` move by the rows that fit: `indexAt(offsetOf(active) ±
  viewportHeight) − active`, at least 1. `scrollActiveIntoView` and `api.scrollTo` use `offsetOf`.
- **Sort and filter.** A new `viewIndex` rebuilds the prefix (O(n)); heights stay cached by data
  index.
- **Editing and streaming.** A write that changes a height updates that entry; the prefix rebuilds
  only when a height changed. A `"defer"` stream tick that changes no height rebuilds nothing.
- **Lazy loading.** `onRowWindowChange` keeps its view-row range contract; a hole that loads may
  change its height, which anchors (decision 6).
- **Pinned rows, header, plugins.** Bands stay fixed-height. Plugins read `rowGeometry` from the
  overlay ctx and the root context (fill's pointer engine switches to it).
- **Clipboard, fill, readOnly.** No change.

## Security

- `getRowHeight` is consumer code, but its result often comes from data: non-finite, negative, or
  zero results fall back (no `NaN` in the prefix, no infinite loop in `indexAt`), and each height
  is clamped to 10,000 px.
- Browsers cap element height (about 33.5M px in Chromium, about 17.9M px in Firefox). When `total`
  exceeds 15M px the grid dev-warns once: rows past the cap are unreachable by scrolling. Scroll
  scaling stays out of scope.

## Performance

- Uniform mode allocates no arrays; `computeWindow` keeps two divisions. A unit test asserts that no
  `Float64Array` is built without `getRowHeight`.
- Variable mode per scroll tick: two binary searches over `n + 1` offsets (17 steps at 100k).
- Budgets at 100k rows (new `windowing/row-geometry-perf.test.ts`, measured baseline + 20 %):
  prefix rebuild ≤ 3 ms; `getRowHeight` fill on a data swap with a trivial accessor ≤ 15 ms; a
  stream tick of 20 rows with unchanged heights ≤ 0.1 ms of geometry work.
- Browser: the `perf.browser` FPS ratio with mixed 36/72/108 px rows stays within the uniform bar;
  the blank-frame checks in `perf.browser.test.tsx` report no blank frames on a fling.

## Accessibility

No ARIA change. Wrapped text stays in the cell's text content; `line-clamp` hides overflow
visually only, so screen readers read the full value.

## Files to add or change

- Add `data-grid/windowing/row-geometry.ts` (`createUniformGeometry`, `createPrefixGeometry`).
- `windowing/use-row-window.ts`, `body.tsx`, `root.tsx`, `layout-context.ts`, `row.tsx`, `cell.tsx`
  (`wrap`), `interaction/use-grid-interaction.ts`, `keyboard/use-data-grid-global-shortcuts.ts`.
- `store/types.ts`, `create-store.ts`, `store/data-write.ts` (height maintenance on writes).
- `data-grid-fill` pointer engine (`fill-tracker.tsx` today, the fill `Mount` after W5-13).
- `data-grid-sdk.ts`: export `RowGeometry`.

## Docs, registry, CHANGELOG

- `virtualization.mdx`: "Variable row heights" section with the height cap warning;
  `columns.mdx`: `wrap`; `performance.mdx`: budgets; new example
  `data-grid-variable-heights-demo` under `examples/rows/`.
- CHANGELOG `### Added`; **Breaking:** `InteractionLayout.rowHeight` → `rowGeometry` (sdk).

## Test plan

- Unit `row-geometry.test.ts`: uniform vs prefix equivalence for equal heights; `indexAt` at every
  boundary (half-open); clamping; invalid heights fall back; 10,000 px clamp.
- Unit `use-row-window` with geometry: window edges, velocity overscan conversion, 200-row cap.
- Unit store: heights update only for touched rows; identity kept when no height changed; data swap
  refills; lazy hole fallback.
- Browser: mixed heights render with the right `gridTemplateRows`; click hit-testing at row edges;
  range drag with auto-scroll across tall rows; `pageDown`; `api.scrollTo` lands the row fully in
  view; anchoring when a row above grows; off-window active row keeps focus while scrolled away;
  `wrap` clamps; RTL.
- Perf: the budgets above; the existing fixed-height perf suite unchanged.

## Dependencies

- The perf suite (`test/perf.browser.test.tsx`, `test/scroll-drag.browser.test.tsx`) as the regression bar.
- Plan 010 (hoist per-cell subscriptions) lands first, so the row and cell hot path is settled
  before the canvas changes.
- R-81 (hot-path compiler bail-outs removed) before measuring the budgets.
- Feeds W6-14 (detail rows add per-row height) and W6-15 (group rows use the same geometry).

## Open product questions

1. Should the grid offer measured auto-height later? Recommendation: not in this item; known heights
   cover wrap-to-N-lines, and measuring needs a layout pass per rendered row on every window shift.
