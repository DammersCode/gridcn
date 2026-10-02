# Spec: status bar add-on (W6-01, FEAT-1)

## Goal

A new add-on `data-grid-status-bar` shows count, sum, average, minimum, and maximum of the selected
cells under the grid. Users read totals of a range without exporting it. Above a cell cap the
values are computed over the first cells only and say so with a "≈" mark.

Written against the API after Wave 5 (W5-02 sdk split, W5-11 selection, W5-12 store-held config).

## Decisions

1. **Add-on, not core.** A component placed inside `DataGridProvider` next to `DataGridRoot` (the
   toolbar placement), plus a headless hook. Rationale: grids that never show totals pay nothing.
   Rejected: a `DataGridRoot` slot — the bar is layout the consumer places, like the pagination bar.
2. **Numbers are detected by value, not by type name.** A cell counts as numeric when its raw
   value is a finite `number`. Rationale: custom numeric types work without a registry flag;
   `CellType.numeric` means tabular-nums rendering and `date` declares it (`types.ts:393-394`).
   Rejected: a new `CellType.aggregatable` member — one more field every type has to declare.
3. **Compute off the drag path.** The hook computes after the selection settles: at once for up to
   5,000 cells, else on a 150 ms trailing timer. Over `MAX_STATUS_CELLS` (200,000, the
   `MAX_COPY_CELLS` value at `clipboard/use-grid-clipboard.ts:79`) it stops at the cap and sets
   `approximate`. Rationale: a 60 fps range drag never walks 200k cells per frame. Rejected:
   time-sliced exact totals — cancellation on every drag step and stale values while dragging.

## API

```ts
// data-grid-status-bar/use-data-grid-selection-stats.ts
export type SelectionStats = {
  cells: number;          // selected cells, each counted once
  count: number;          // non-empty cells (cellType.isEmpty false)
  numeric: number;        // cells with a finite number value
  sum: number | null; avg: number | null; min: number | null; max: number | null; // null when numeric === 0
  approximate: boolean;   // the cap stopped the walk
};
export function useDataGridSelectionStats(): SelectionStats;

// data-grid-status-bar/status-bar.tsx
export type StatusBarAggregate = "count" | "sum" | "avg" | "min" | "max";
export type DataGridStatusBarProps = {
  aggregates?: readonly StatusBarAggregate[];        // default all five, in this order
  formatValue?: (value: number, aggregate: StatusBarAggregate) => string;
  locale?: string;                                   // default "en-US"
  labels?: Partial<DataGridStatusBarLabels>;
  className?: string;
  children?: ReactNode;                              // extra items, rendered after the aggregates
};
```

Core: `DataGridStatusBarLabels` under `labels.statusBar` (`labels.ts`, the `labels.pagination`
pattern, `labels.ts:212-226`); `selectionRects` (`selection/line-ops.ts:35`) joins the
`data-grid-sdk` barrel.

## Behavior

- **Which cells.** The union of every channel: primary range, range stack, row channel, column
  channel (`selectionRects`, `line-ops.ts:35-48`). A cell in two rects counts once: a rect skips a
  cell that an earlier rect contains. Hidden columns, filtered rows, lazy holes (`row ===
  undefined`), and pinned band rows are never in the view, so they never count.
- **Shown values.** The bar renders nothing while fewer than 2 cells are selected. `count` always
  shows; `sum`, `avg`, `min`, `max` show only when `numeric > 0`. With `approximate`, every value
  gets a "≈" prefix and the bar's `title` says "From the first 200,000 cells".
- **Formatting.** When every numeric cell comes from one column, sum, avg, min, and max use that
  column's `toDisplayText` (W6-04 `format` shows currency). Otherwise `formatValue`, default
  `Intl.NumberFormat(locale, { maximumFractionDigits: 4 })` built once per `locale` (prop,
  default `"en-US"`, the date type's SSR-safe default).
- **Sum.** Compensated (Neumaier) summation, so 0.1 + 0.2 shows 0.3.
- **Recompute triggers.** `selection`, `viewIndex`, `visibleColumns`, and `data` identity. A
  streaming `updateCells` tick recomputes only while the selection is non-empty and goes through
  the same 150 ms timer above 5,000 cells.
- **Sort / filter / editing / readOnly.** Sort and filter change the view; W5-11 remaps the
  selection by identity, and the stats follow. The bar reads committed values only (no draft).
  It writes nothing, so readOnly has no effect.
- **Plugins.** None needed; the bar reads the store through `useDataGridSelector`.

## Security

No untrusted input: the bar reads the grid's own data. `formatValue` output renders as text (React
escapes it). The cap bounds the walk on a forged whole-grid selection (`setSelection` from a URL).

## Performance

- No per-cell work in the grid: the bar subscribes outside the cells, so a drag step renders the
  overlays plus one small bar.
- Walk cost: one `getCellValue` and one `isEmpty` per selected cell, at most 200,000 per settle.
- At 100k rows a Ctrl+A on 10 columns is 1M cells: capped walk, one pass, under 50 ms (perf test).

## Accessibility

The bar is `role="status"` with `aria-live="polite"` and `aria-atomic="true"`. Its text changes
only when a computation finishes, so a drag does not flood the screen reader. Each value has a
visible label ("Sum 1,234"); no meaning sits in color.

## Files

- Add `registry/default/blocks/data-grid-status-bar/`: `data-grid-status-bar.ts` (barrel),
  `status-bar.tsx`, `use-data-grid-selection-stats.ts`, `compute-selection-stats.ts` (pure), tests.
- Change core `labels.ts` (`DataGridStatusBarLabels`, `DEFAULT_LABELS.statusBar`),
  `data-grid-sdk.ts` (`selectionRects`).
- `registry.json`: new item (registryDependencies `DammersCode/gridcn/data-grid`); new demo
  `data-grid-status-bar-demo`.

## Docs, registry, CHANGELOG

- New page `content/docs/addons/status-bar.mdx` (add-on page structure from AGENTS.md); add-ons
  index and `meta.json` entry; `i18n.mdx` lists `labels.statusBar`.
- CHANGELOG `### Added`: the add-on and `labels.statusBar`.

## Test plan

- Unit `compute-selection-stats.test.ts`: overlapping rects count once; row plus column channel
  overlap; non-number values count but do not sum; `null`/empty cells do not count; lazy holes
  skipped; Neumaier sum; cap sets `approximate` and stops at 200,000.
- Unit hook: no computation while fewer than 2 cells are selected; one computation after a
  25-step drag over 10k cells (timer); a stationary drag computes nothing (W3-04 bail-outs keep
  the selection identity, `selection/selection-ops.ts:25-29`).
- Browser: Shift+click range shows Sum/Avg/Min/Max; one-column currency formatting; "≈" on a
  capped select-all; `role="status"` present.
- Perf: Ctrl+A at 100k rows × 10 columns: capped walk under the recorded budget; the
  `scroll-drag` wasted-render probe stays flat with the bar mounted.

## Dependencies

W3-04 (selection bail-outs, done), W5-02 (sdk), W5-11 (identity remap), W6-04 (optional: column
`format`).

## Open product questions

1. Should the bar show while one cell is selected (count 1)? Recommendation: no — it adds noise for
   the most common state; consumers who want it pass `children`.
