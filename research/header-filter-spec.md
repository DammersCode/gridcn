# Spec: header filter popover and set filter (W6-08, FEAT-4)

Status: implemented in 1.2.0.

## Goal

Each column header gets a filter button that opens a popover with a distinct-values ("set")
filter: search, a select-all checkbox, a virtual list of values with row counts, Apply and Clear.
`isAnyOf` works for text, number, and date columns, not only `select`, and a filtered header
shows a `data-filtered` indicator. Today `isAnyOf` is offered only for `select`
(`data-grid-toolbar/operators-for-column-type.ts:13-19`), its values come only from
`options.choices` (`filter-value-input.tsx:186-198`), and no distinct-values computation exists.

Written against the API after Wave 5: W5-01 header parts, W5-04 menus as data, W5-06 type-driven
filter capabilities, W5-12 render slots on `DataGridRoot`.

## Decisions

1. **A render slot, not a menu item.** New root render slot `renderHeaderFilter?: (ctx: { column,
   index }) => ReactNode`, placed by `header-cell.tsx` before the menu trigger; the toolbar add-on
   ships `DataGridHeaderFilter` for it. Rationale: `GridMenuItemSpec` has no custom-content slot
   (`data-grid-context-menu/menu-items.tsx:47-71`), and a list with search does not fit a menu.
   Rejected: a "Filter…" header menu item that opens a dialog — two steps for the common case.
2. **Exclusion lists: new operator `isNoneOf`.** The popover stores the shorter list: checking
   from "none" stores `isAnyOf [checked]`; unchecking from "all" stores `isNoneOf [unchecked]`.
   Rationale: "all but two" stays a two-entry filter, fits the URL bound (1,000 entries for columns
   without `choices`, Wave R decision), and keeps new values visible as data grows. Rejected:
   always `isAnyOf` — a 5,000-value column with one value unchecked cannot be shared by URL.
3. **Values come from the rows that pass every other filter.** The list is computed when the
   popover opens, over `data` filtered by all filters except this column's. Rationale: every
   listed value leads to rows; the column's own filter does not hide its own unchecked values.
   Rejected: all `data` (lists dead values); rejected: the current view (unchecked values vanish).
4. **Values group by the matcher's key.** Key = `String(raw).toLowerCase()`, with `null`/`undefined`
   → `""` (`store/compute.ts:325-331`, `sort-filter/matches-filter.ts:35-40`); label =
   `displayText` of the first raw value seen; `""` shows as "(Blanks)". Rationale: the list never
   offers a distinction the filter cannot make. Rejected: grouping by raw value — two entries
   (`"Berlin"`, `"berlin"`) that one filter entry always matches together.
5. **Own fixed-height virtual list.** A ~60-line windowed list (28 px rows, overscan 8) in the
   toolbar add-on. Rationale: no new dependency; rows have one height. Rejected: rendering every
   value — 10k checkbox items freeze the popover. Rejected: a new virtualization dependency.

## API

```ts
// core types.ts
type FilterOperator = /* existing */ | "isNoneOf";                  // value: string[]
// DataGridRootProps (W5-12 render slot)
renderHeaderFilter?: (ctx: { column: AnyColumnDef; index: number }) => ReactNode;
// GRID_ATTR (data-attributes.ts)
filtered: "data-filtered";                                         // on role="columnheader"
// core hook
useDataGridIsColumnFiltered(columnId: string): boolean;
// data-grid-sdk: the other-filters row predicate for add-ons
createRowFilter(state, filters: readonly FilterSpec[]): (dataIndex: number) => boolean;

// data-grid-toolbar
export function DataGridHeaderFilter(props: { column: AnyColumnDef; index: number }): ReactNode;
export function distinctColumnValues(state, columnId, opts?: { maxValues?: number }):
  { values: { key: string; label: string; count: number }[]; capped: boolean };
```

`SET_FILTER_OPERATORS = ["isAnyOf", "isNoneOf"]` (`cell-types/capabilities.ts`) joins the
`filter.operators` of `text`, `number`, `date`, and `select`, and the name fallback.

## Behavior

- **Button.** Hidden until hover or focus like the menu trigger (`header-cell.tsx:143-159`),
  always visible while the column is filtered. Shown only for `filterable !== false` columns. It
  stops propagation, so a press never sorts or selects the column.
- **Popover.** Search (debounced 150 ms, plain case-insensitive `includes` on the label), a
  select-all checkbox for the matching subset, the list sorted by `cellType.compare` on the raw
  value (else label collation), counts per value. Apply writes; Escape or an outside press
  discards; Clear removes every filter of this column. Apply is disabled while nothing is checked
  (an empty `isAnyOf` matches nothing by design, `matches-filter.ts:35-36`) and while the stored
  list would exceed 1,000 entries (message shown).
- **State.** Apply calls `setFilters`: it replaces this column's `isAnyOf`/`isNoneOf` entry and
  keeps every other filter, including condition filters on the same column (AND under the
  grid's join). Controlled `filterState` works unchanged through `onFilterChange`. Opening the
  popover reads an existing set entry and pre-checks it.
- **Toolbar.** The filter menu shows the entry as a normal row. Its `isAnyOf` value input for a
  column without `choices` uses the same set list, so values outside `choices` are no longer
  dropped on toggle (`filter-value-input.tsx:132-138`).
- **Sort / selection / editing / readOnly.** Sorting does not change the list. Applying rebuilds
  the view; W5-11 remaps the selection by identity; W4-01 cancels an edit whose row leaves the
  view. Filtering is not a data write, so it works in a read-only grid.
- **Lazy grids.** Values come from loaded rows only; the popover says "From loaded rows".
- **Plugins.** None; the add-on uses the slot and public actions.

## Security

- Labels render as React text. Search is `includes`, never a `RegExp`, so no ReDoS.
- Distinct collection stops at `maxValues` (default 100,000 keys; `capped` shows "Too many values
  — refine the search"). The stored list is capped at 1,000 entries. The URL codec parses
  `isNoneOf` with the `isAnyOf` bound (`data-grid-url-state/filter-param.ts:17-23,72-83`) and adds
  it to `FILTER_OPERATORS` (`filter-operators.ts:4-19`).

## Performance

- Cells: no new work. Header cells add one boolean selector each (`useDataGridIsColumnFiltered`).
- Open: one pass over `data` with the other filters (matchers built once,
  `sort-filter/build-view-index.ts:93`) plus one `Map` insert per passing row. Budget: under 50 ms
  at 100k rows with two other filters.
- Matching: `isNoneOf` uses the same lowercased `Set` as `isAnyOf` (`matches-filter.ts:116-120`),
  O(1) per row; the incremental view index path takes it like `isAnyOf`.

## Accessibility

- Button: `aria-label={labels.toolbar.headerFilterAriaLabel(columnLabel, filtered)}` ("Filter
  Name", "Filter Name, filtered"), `aria-haspopup="dialog"`, `aria-expanded`.
- Popover: `role="dialog"` with a label; list `role="listbox" aria-multiselectable="true"` with
  `aria-activedescendant`; options carry `aria-selected`, `aria-setsize`, `aria-posinset` (the
  list is virtual). Keys: ArrowUp/Down, Home/End, Space toggles, Enter applies, Escape closes.
- A polite status line announces the visible value count after a search.

## Files

- Core: `types.ts` (`isNoneOf`), `sort-filter/matches-filter.ts`, `sort-filter/incremental-view-index.ts`,
  `cell-types/capabilities.ts` + `text.tsx`/`number.tsx`/`date.tsx`/`select.tsx` operators,
  `header-cell.tsx` (slot, `data-filtered`), `header.tsx`, `root.tsx`, `data-attributes.ts`,
  `store/hooks.ts`, `data-grid-sdk.ts` (`createRowFilter`), `labels.ts` (`filterOperators.isNoneOf`,
  toolbar header-filter strings).
- Toolbar: add `header-filter.tsx`, `set-filter-list.tsx`, `distinct-values.ts` (+ tests); change
  `operators-for-column-type.ts`, `filter-value-input.tsx`, barrel; `registry.json` adds
  `checkbox` to `registryDependencies` (`:769-777`).
- url-state: `filter-operators.ts`, `filter-param.ts`.

## Docs, registry, CHANGELOG

- `addons/toolbar.mdx`: a "Header filter" section (slot wiring, behavior, keys);
  `sorting-filtering-search.mdx`: `isAnyOf`/`isNoneOf` for text, number, date; `url-state.mdx`:
  `isNoneOf` bound; `examples/columns/filtering.mdx` faceted example uses the header filter.
- CHANGELOG `### Added`: `renderHeaderFilter`, `DataGridHeaderFilter`, `isNoneOf`,
  `data-filtered`, `useDataGridIsColumnFiltered`; `### Changed`: `isAnyOf` on text, number, date;
  `### Fixed`: the toolbar `isAnyOf` input dropping values outside `choices`.

## Test plan

- Unit `distinct-values.test.ts`: case-merged keys; blanks; counts; other filters applied, own
  filter ignored; `maxValues` cap; lazy holes skipped; select label, formatted date label.
- Unit matcher: `isNoneOf` (empty list matches all rows, case-insensitive); URL round trip and
  bound.
- Unit store: Apply replaces only this column's set entry; condition filters on the same column
  stay; shorter-list rule (`isAnyOf` vs `isNoneOf`); 1,001-entry list blocked.
- Browser: open, search, select-all of the subset, Apply filters the view; Escape discards;
  `data-filtered` and the visible button while filtered; keyboard-only flow; a 10k-value list
  scrolls with fewer than 40 option nodes mounted; header press on the button never sorts.
- Perf: popover open at 100k rows with two other filters under the recorded budget.

## Dependencies

W2-01, W2-07 (done), W5-04 (menus), W5-06 (type-driven operators), W5-12 (render slot home),
W5-11 (selection remap on filter).

## Open product questions

1. Should the popover also hold a condition row (operator + value) above the list?
   Recommendation: no — the toolbar filter menu owns conditions; the popover stays one task.
2. Should the list show counts? Recommendation: yes — they come free with the distinct pass and
   show which values matter.
