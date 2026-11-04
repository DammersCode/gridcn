# Spec: server pivot (gap S11)

## Goal

A server grid shows its result as a pivot: rows are groups by a row-key column (`groupBy`), columns
are generated from the distinct values of a pivot column, and each cell is an aggregate of the rows in
that row group and that pivot key. The server computes everything; the grid validates the answer,
generates bounded columns with stable ids, and renders read-only aggregate cells.

Pivot builds on `research/server-grouping-spec.md` ("spec A"): its `ServerSpec` fields, request
fields, `ServerGroupsAnswer`, group rows and ids, child lists, data-keyed `groupLayout` getter,
`totalRowCount` rule, collision policy, and bounds. Spec A is the source for every shared type.

## Scope boundary

| 2.0 | First slice (after spec A's first slice) | Later slices | Out |
|---|---|---|---|
| reserve the `__pivot:` and `__pivotgroup:` column-id prefixes; additive pivot types (`PivotSpec`, `ServerSpec.pivot`, answer fields), stripped like `groupBy` | scroll mode; 1 row-key level; 1 pivot column; 1-4 values; built-in reducers; read-only cells; copy, find, export, print; `pivot` in URL | 2-3 pivot columns; multi-level row keys with subtotals; up to 8 values; pivot sort; checkable pivot rows; client pivot; pages mode; header menu | function reducers; formulas; drill-down; editing pivot cells; a pivot panel UI |

## Current state (verified)

- No `pivot` identifier exists under `registry/default/blocks`; client grouping leaves pivoting out
  (`row-grouping-spec.md:16`).
- Column groups: `ColumnGroupDef` with a required `header`, ids unique across groups and columns
  (`types.ts:1005`); `computeHeaderRows` (`columns/column-groups.ts:245`); depth cap 8, 500
  columns at depth 3 in 1 ms (`column-groups-spec.md:118,127`). Column virtualization: `root.tsx:444`.
- `computeVisibleColumns` (`store/compute.ts:551`) drops hidden ids (`:558-561`) and builds
  `state.visibleColumns`, which 28 non-test files read: export and print (`export-grid.ts:98,117`,
  `print-grid.ts:84`), find (`plan-replace.ts:134,171-180`, which reads `data[dataIndex]`), headers,
  autosize, keyboard movement, ranges, copy. The column chooser lists the registry with
  `checked={!hidden}` (`data-grid-toolbar/columns-menu.tsx:33-37,79`).
- Layout: `normalizeColumnLayout` keeps registry ids, takes given `hidden` and pins as authoritative,
  and keeps pins on column defs (`compute.ts:606-643,614-620`); widths are a record by id (`:622-629`).
  `computeColumnLayout` emits a complete `order` from the registry (`:569-583`); the sync writes the
  result back (`create-store.ts:971-990`); `defaultColumnLayout` applies once (`compute.ts:645-657`).
  URL apply validates sorts against the registry (`use-data-grid-url-state.ts:79,153-156`) and calls
  `setColumnLayout` (`:181`); the URL writer serializes the whole snapshot (`:215-216`).
- Views (working tree): 50 views (`view-state.ts:4`), a 1,000,000-character document (`:6`), a
  100,000-character file (`:9`), 1,000 entries per layout list (`:16`), 200-character ids (`:17`),
  registry ids only (`:140-141`, sorts `:153`, filters `:201`; registry from
  `use-data-grid-views.ts:115,122`). Save refuses a document over the limit, measured on the whole
  serialized document (`use-data-grid-views.ts:204`); load throws over it (`view-storage.ts:53`).
- Export filters holes (`export-grid.ts:79`) and builds headers from `columnLabelText` (`:116-117`);
  CSV neutralizes formula-like text, headers included (`:52,173-174`); XLSX writes strings as string
  cells (`:25-28`). `blockSize` has no upper bound (`scroll-blocks.ts:190-192`).

## Decisions

1. **Pivot is spec A grouping with generated columns.** Pivot rows are group rows of the one
   `groupBy` level; the level is not expandable (`childCount: 0`, no `aria-expanded`), so a pivot never
   fetches result rows. Rejected: a separate pivot row model.
2. **`pivot` is an optional `ServerSpec` field, omitted when absent.** It requires `groupBy`. It is a
   different answer shape over the same result: bulk actions ignore it for row membership. The
   `serverSpecKey` replacer drops it when absent. Rejected: a request field — caches and the reset key
   must see it.
3. **Every group answer carries the column set; cells map by generated id.** Each answer, at every
   block, sends `pivotColumns` and `pivotCells` aligned to its own list. The grid builds ids and copies
   each kept cell through a `Map<id, heldIndex>` into the held set; a held id missing from the answer
   reads `null`. Rejected: align block k to block 0's set — a stateless server cannot, `refresh()`
   refetches blocks in any order (`scroll-blocks.ts:573-578`), and a same-length set with 2026 in and
   2024 out would show 2025's numbers under 2024. Rejected: `cells: Record<key, value>`.
4. **The held set travels in spec A's `groupLayout(data)`.** The first answer of a spec that lands
   defines the held set; `refresh()` rebuilds it from the first refreshed answer and remaps every
   block it keeps by id (old index → id → new index, O(kept cells)). Every held-set or count change
   comes with a new `data` array (landing, refresh, spec change), so the layout getter rule of spec A
   decision 4 holds and columns and rows land in one store write. The core builds generated ids from
   the descriptors, as it builds group ids. Rejected: mark kept blocks unloaded until refetched — a
   refresh would blank the rows on screen.
5. **At most `MAX_PIVOT_COLUMNS` = 500 kept columns; past it, cut and say so.** 500 is the measured
   header budget (depth 3 ≤ 1 ms) and leaves room under the views cap of 1,000 entries per layout list
   (`view-state.ts:16`) with the source columns. The server cuts first (`pivotOmitted`); the grid cuts
   too. Rejected: an error — a wide but valid result would show nothing.
6. **Generated ids are value-derived.** `__pivot:` + `encodeURIComponent(pivotColumnId)=
   encodeURIComponent(keyText)` + `|` + `encodeURIComponent(valueColumnId)=reducer`; every separator
   is percent-encoded inside a segment, so no value forges another id; `keyText` follows spec A
   decision 6. Rejected: server-made column ids.
7. **Source columns stay in the registry; `computeVisibleColumns` applies the pivot flag.** Under
   `pivot`, `state.visibleColumns` is the `groupBy` column plus the generated columns, so export,
   print, find, copy, ranges, keys, autosize, and `aria-colcount` see no source column. The `groupBy`
   column is the group column (whatever `groupColumn` says) and cannot be hidden while pivot is on; a
   hidden one shows. `hiddenColumns` stays untouched otherwise. Reader sets:

   | Reader | Set under `pivot` |
   |---|---|
   | Column chooser | the pivot set: the `groupBy` column (not hideable) and every generated column, hidden ones included |
   | Filter menu, header filters, URL and view filters | the registry |
   | Sort list, header sort, the request's `sorts` | `groupBy` and pivot columns |
   | Layout normalizer, URL layout, views layout | the registry plus the held set (`order`: registry ids only); other `__pivot:` ids go to the pending layout ("Columns and layout") |

   A sort on another column stays in `sortState` (URL and views validate sorts against the registry,
   so apply order never matters): it is not sent, not shown in the sort list, and returns when pivot
   turns off; turning pivot on fires no `onSortChange`. Every sort write under pivot (header toggle,
   sort list) keeps these hidden entries after the shown ones, and `onSortChange` gets the merged
   list (`toggleSort` replaces the whole list today, `create-store.ts:1533-1537`). Rejected: drop source columns from the registry — filters
   and layout of source columns would be lost. Rejected: drop such sorts — turning pivot off would
   lose them.
8. **The core generates the columns** from the consumer's `columns` and the held set. Rejected: hand
   them to the consumer — every pivot grid would repeat the same props.
9. **Reserved column-id prefixes.** `__pivot:` and `__pivotgroup:` are reserved. A consumer column or
   group id with either prefix drops in every build, with a dev error in development. 2.0 reserves
   them so the first slice breaks nobody.

## Wire contract

```ts
// data-grid/server-spec.ts (additive to spec A)
export type PivotSpec = {
  /** Columns whose distinct values become generated columns. The first slice takes 1. */
  columnIds: readonly string[];
  /** One aggregate per (columnId, reducer). The first slice takes 1-4. */
  values: readonly ServerAggregate[];
};
export type ServerSpec = { /* spec A fields */ pivot?: PivotSpec };

// data-grid-server/read-answer.ts (additive to spec A's ServerGroupsAnswer and ServerGroupRow)
export type ServerGroupsAnswer = {
  /* spec A fields */
  /** The generated columns of the whole result, key-major (all values of a key adjacent). Required under `spec.pivot`. */
  pivotColumns?: readonly PivotColumnAnswer[];
  /** Distinct generated columns the server left out past its own cap. */
  pivotOmitted?: number;
};
export type PivotColumnAnswer = { path: readonly GroupKey[]; valueIndex: number };
export type ServerGroupRow = {
  /* spec A fields */
  /** One value per entry of this answer's `pivotColumns`; `null` when no row falls into the cell. */
  pivotCells?: readonly (number | null)[];
};

// data-grid-sdk.ts: spec A's GroupLayout, additive
type GroupLayout = {
  /* spec A fields */
  pivot?: { descriptors: readonly { path: readonly GroupKey[]; valueIndex: number }[]; omitted: number; newCount: number };
};
// each (listId, offset) entry adds `pivotCells: Float64Array` in held-set order, NaN for null
```

Requests are spec A's top-level requests with `spec.pivot`; `childKind` is `"groups"`.
`totalRowCount` is the result's row count (source rows); `groupCount` sizes the pivot rows. Reducers
follow spec A. Filters on any registry column apply. Pages mode strips `pivot` (spec A decision 9);
scroll mode strips it too until step 5 removes that strip.

### Server checks

Added to spec A's "Server checks": `pivot` requires `groupBy`; `columnIds` are allowed columns,
distinct, not in `groupBy`, at most 3; `values` name allowed columns, at most 8, closed reducers,
numeric columns for `sum`, `avg`, `min`, `max`; a sort on the pivot column orders its keys; the server
applies its own distinct-key cap and reports the cut as `pivotOmitted`; keys and ids reach the query as
parameters. Step 7 adds this to the recipe and to `server-checks.test.ts`.

### Normalization and bounds

Normalization (before the request): `columnIds` known, distinct, not in `groupBy`; `values` with
known columns, repeated `(columnId, reducer)` pairs dropped, numeric columns only for `sum`, `avg`,
`min`, `max`. First slice: `groupBy.length` 1, `columnIds.length` 1, at most 4 `values`; extras drop
with one dev warning. When nothing valid remains, `pivot` resolves to `null` with one dev warning and
`onPivotChange` does not fire. Under `pivot` the hook clamps `blockSize` to 200.

`readPivotAnswer` runs after spec A's `readGroupsAnswer`; "fails" fails the block (spec A decision 8):

- The pivot level must send `childCount: 0` (spec A's stated exception); fails.
- `pivotColumns` holds at most 5,000 entries; 5,001 or more fails before any walk. Each `path` has
  exactly `columnIds.length` keys of spec A's key types and 1,024-character cap; each `valueIndex` is
  in range; fails.
- A repeated generated id inside one answer fails (keys `1` and `"1"` share `keyText`), as spec A.
- A generated id over 2,048 characters is valid data (long CJK keys): it counts as omitted, its cell
  index is skipped, one dev warning per spec.
- The walk keeps ids in held-set order up to 500 and counts the rest as omitted.
- `pivotCells` has exactly `pivotColumns.length` entries; fails. Only kept indices are read, into a
  `Float64Array` of kept length. A value is a finite number or `null`, else `null` with one warning.
- `pivotOmitted` is a safe non-negative integer clamped to `MAX_ROW_COUNT`, else `0` with a warning.
- Counts: `omittedPivotColumnCount` is the newest answer's `pivotOmitted` plus that answer's grid cut.
  An id not in the held set counts as new only while the held set has fewer than 500 ids, else as
  omitted; new ids live in a set capped at 5,000 ("5,000+"); a `refresh()` or spec change clears it.

## Columns and layout

- **Columns.** One `ColumnDef` per held id: `header` the key's display text with one value, the value
  label (`labels.pivot.value`, "Sum of Amount") with several; the value column's numeric type (`count`
  uses `number`); `readOnly`, `sortable: false`, `filterable: false`; an internal `pivotIndex`.
- **Header groups.** With one value, one header row. With several, one `ColumnGroupDef` per key
  (`id` `__pivotgroup:` + the segment; `header` and `headerText` its display text,
  `labels.pivot.empty` for the empty key) over its value columns, grouped at first occurrence so groups
  stay contiguous in any order.
- **Order.** Generated columns always follow held order (server order: key order ascending, or a
  `sorts` entry on the pivot column). They are `reorderable: false` in the first slice, so generated
  ids never enter `order` (completion would append them at the end, `compute.ts:530-543`). Moving
  generated columns is a later slice.
- **Notes.** The core renders "+N more columns" (`labels.pivot.omitted`) and "N new columns; refresh to
  show" (`labels.pivot.newColumns`) from the layout counts, as plain text beside the grid, outside
  the header row and outside any live region; the grid's announcer sends one live-region text per spec.
- **Source-column layout.** Source columns stay in the registry, so their widths, order, pins, and
  hidden state survive pivot on and off.
- **Skeleton set.** After a spec change the previous held set stays as skeleton columns until the new
  set lands; skeleton headers show no key text, carry `aria-busy="true"` and
  `labels.pivot.loadingColumn`.
- **Pending layout.** Entries for `__pivot:` ids absent from the set move to a pending layout instead
  of dropping, fed by `defaultColumnLayout`, `columnLayout`, `setColumnLayout`, and views: at most
  1,000 entries per part, oldest dropped first; matching entries apply when a set lands; the
  `columnLayout` snapshot and `onColumnLayoutChange` include them.
- **URL.** The URL writer filters `__pivot:` ids out of every layout part; URL apply merges and keeps
  current and pending `__pivot:` entries against authoritative `hidden` and pins
  (`compute.ts:614-620,631-632`).
- **Saved views need** (the views block builds it): accept `__pivot:` ids absent from the registry
  and pass them to the pending layout; a 2,048-character cap for `__pivot:` ids (200 elsewhere); at most
  10,000 serialized characters of generated entries per view; when a list is over 1,000 entries or the
  budget is reached, generated entries drop first and source entries never; drops count in `dropped`;
  persist `pivot`.

## Cells

- Display: `toDisplayText ?? toText` of the generated column's type, through `toSafeText`; `null` (NaN
  in storage) is an empty cell; `0` is `0`. Plain display elements with `role` and `aria-readonly`.
- Write paths (edit start, commit, paste, fill, cut, `deleteSelection`, `updateCells`, undo, redo) skip
  group rows and `readOnly` columns; each path gets a test.
- Copy, find, export, and print read pivot cells through one `viewEntryAt` → `pivotCells` branch: find
  today reads `data[dataIndex]` (`plan-replace.ts:171-180`) and group rows cover only the label
  (`row-grouping-spec.md:127`). Copy writes the displayed text; find matches it; replace skips it.

## Performance and memory

- Cells rendered are rendered rows × columns in view (about 30 × 20 at 500 generated columns).
  `computeHeaderRows` runs only when the set or layout changes.
- Memory: 8 bytes per kept cell; at most 2,000,000 kept cells (16 MB) under pivot, past which the
  blocks farthest from the rendered rows evict. With one row-key level there are no open lists, so
  every block can evict and the budget holds.
- Targets (`pivot.perf.test.ts`, budgets once measured): `readPivotAnswer` of 200 rows × 500 cells
  ≤ 6 ms; 5,000 descriptors with ids built ≤ 5 ms; 5,001 rejected ≤ 0.1 ms; `buildPivotColumns` of
  500 ids ≤ 3 ms; `refresh()` remap of about 3 kept blocks ≤ 5 ms; 100k pivot rows × 500 columns stay
  under the budget at the `perf.browser` FPS bar; find over 1,000 rows × 500 columns ≤ 100 ms.

## Export and print

Pivot mode is the one case where group rows export (spec A points here): export and print keep pivot
entries in `exportDataIndices` and read `pivotCells` by `pivotIndex`. A new `buildPivotExportHeaders`
joins key text and value label with " / " ("2025 / Sum of Amount"); print uses it. CSV neutralizes a
key such as `=cmd`; XLSX writes it as a string cell (tested). Bounds: `maxRows`, 500 columns,
`MAX_CELL_TEXT`. Gap I's async `source` gets the spec with `pivot` and maps answers by id.

## Modes and API

| Mode | First slice |
|---|---|
| L, PC | `pivot` ignored with one dev warning (gap) |
| PS | stripped (gap) |
| Z, C, SS, FS | supported through the scroll hook (server sort and filter required) |
| API | n/a: pivot cells are read-only aggregates |

```ts
// DataGridSyncProps (recompute phase)
pivot?: PivotSpec | null;
defaultPivot?: PivotSpec | null;
onPivotChange?: (next: PivotSpec | null) => void;
// useDataGridServerRows({ mode: "scroll" }) result, additive
omittedPivotColumnCount: number;
newPivotColumnCount: number;
// gridProps adds pivot and onPivotChange, wired to the spec pair; the held set rides in groupLayout(data)
```

The common case stays `useDataGridServerRows({ mode: "scroll", getRowId, fetchRows, defaultSpec: {
groupBy: ["region"], pivot: { columnIds: ["year"], values: [{ columnId: "amount", reducer: "sum" }] }
} })` with `<DataGrid {...server.gridProps} columns={columns} />`.

## Selection, accessibility, URL, security

- **Selection.** Pivot rows cannot be checked; under pivot the header checkbox is disabled,
  `selectAllMatching()` is a no-op with a dev warning, and the checked count is 0. A `pivot` change
  clears checks and ranges. Cell ranges and copy work.
- **Accessibility.** `role="grid"` (no row expands). Header group cells are `role="columnheader"` with
  `aria-colspan`; a generated leaf header has `aria-label` with its full name ("2025, Sum of Amount").
- **URL.** `useDataGridUrlState` adds `pivot` (pivot column ids) and `pivotValues`
  (`columnId:reducer`, closed reducers), raw segments capped, validated against the registry and
  types; generated layout stays out of the URL.
- **Security.** Ids are encoded, deduplicated, and bounded (5,000 read, 500 kept, 2,048 characters).
  Cells are typed arrays read by index; held ids live in a `Map`. Generated ids key the `columnWidths`
  record (`compute.ts:622-629`); that is safe because every one starts with `__pivot:`, which no
  prototype key matches. Text renders as text nodes.

## Later slices: constraints

Each later slice decides its mechanics in its own spec at start. It must respect:

- **2-3 pivot columns or up to 8 values:** key-major descriptor order; header groups per path prefix
  at first occurrence; the 500-column cap and the depth cap of 8.
- **Multi-level row keys:** spec A's multi-level constraints; open lists pin their group rows, so the
  cell budget must cap open lists under pivot and the `refresh()` remap covers every kept block.
- **Pivot sort:** a structured `pivotSort: { path, valueIndex, direction }`; no server parses ids.
- **Moving generated columns:** a stored move must survive `refresh()`, a held-set change, and a view
  reload, which plain `order` completion does not give.
- **Checkable pivot rows:** spec A's group rule; the header checkbox then maps to it.
- **Client pivot:** the same descriptors, `pivotCells`, and caps from the client buckets.

## Feasibility verdict

Not feasible for 2.0.0: pivot needs spec A's first slice, which waits on #71. After it, the first
pivot slice is 6 commit-sized steps (steps 2-7); layout persistence and the per-answer id map are the risky
parts. 2.0 ships the reserved prefixes and the additive types (stripped); the rest is additive.

## Minimal scope proposal

| Item | 2.0 | Later |
|---|---|---|
| Reserve `__pivot:` and `__pivotgroup:`; additive pivot types, stripped (step 1) | yes | |
| First slice (steps 2-7) | no | after spec A's first slice |
| Later slices (constraints above) | no | yes |

Recommendation: keep pivot a spec until spec A's first slice has shipped for one release.

## Risks

- Long generated ids bloat saved layouts; views must implement the id cap, list caps, and budget.
- The pending layout is a second home for layout entries; each feed gets a round-trip test.
- Inconsistent sets between answers show `null` cells and the new-columns note, never wrong values.
- The cell budget evicts blocks the user scrolled past; scrolling back refetches them.

## Test plan

- `read-pivot-answer.test.ts`: path length; long and object keys;
  `valueIndex` range; 501 cut; 5,001 and 10M-entry arrays rejected without a walk; `1`/`"1"` repeat;
  id over 2,048 omitted; `pivotCells` length; non-number cells; `pivotOmitted` bad values; pivot level
  `childCount` not 0.
- `pivot-id-map.test.ts`: same-length different set maps by id; block k before block 0; refresh remap;
  the same 800 ids in every block count 300 omitted, never new; new-id cap.
- `build-pivot-columns.test.ts`: id encoding with `/`, `=`, `|`; one value and several (key groups at
  first occurrence on a shuffled order); empty key; types per reducer; reserved prefixes drop.
- `pivot-layout.test.tsx`: pivot on, resize, pivot off for source and generated columns,
  uncontrolled and controlled; a generated column cannot be dragged; after `refresh()`, a pivot sort
  flip, and a view save and reload, generated columns keep held order and `order` holds none of them;
  skeleton set; pending layout per feed, cap, apply, snapshot; URL writer emits no `__pivot:` id; URL
  apply merge.
- `pivot-registry.test.tsx`: first-slice normalization; `pivot` normalizing to `null` without
  `onPivotChange`; URL and view apply keep a filter on a source column; a source-column sort stays in
  `sortState`, is not sent, survives a click on the `groupBy` header (merged into `onSortChange`), and
  returns when pivot turns off;
  `visibleColumns` is the pivot set; the chooser lists hidden generated columns and they can be
  unhidden; the `groupBy` column cannot be hidden; `groupColumn` naming a source column is ignored.
- `pivot-cells.test.tsx`: find hits a pivot cell, replace skips it, copy gives displayed text; every
  write path is refused on read-write and read-only grids.
- `use-data-grid-server-rows.pivot.scroll.test.tsx` (controlled `spec`, `sortMode` and `filterMode`
  `"server"`): request shape; `blockSize` clamp; held set in `groupLayout(data)`; `refresh()` while
  scrolled past block 0; spec change with old-set blocks in flight; cell budget; StrictMode; unmount;
  counts and notes; header checkbox disabled and `selectAllMatching()` no-op; pages mode strips
  `pivot`; the scroll strip of `pivot` is gone (the `page-reset` case inverted in step 5).
- `tests/parity/pivot.parity.test.tsx` (L, PC, API): local `pivot` warns and renders ungrouped.
- Export and print tests (extend): pivot rows, flat headers, `=cmd` in CSV and XLSX. `pivot-param.test.ts`.
- Views tests (when the views block adds pivot): 50 pivot views at the generated budget, measured on
  the serialized document, save and reload; over-budget entries drop, generated first.
- `reserved-column-prefix.test.tsx` (2.0): drop in every build; dev error in dev only.
- Browser `pivot.browser.test.tsx`: header groups with pins at `--radius 0` and `1rem`; 500-column
  horizontal scroll; header names; axe. Perf: the targets above.

## Parity-matrix impact

- New row `pivot`, options `pivot`, `defaultPivot`, `onPivotChange`, row `note` "Pivot works through
  the scroll hook only" (supported cells render no note). Step 3 adds it with Z, C, SS, FS
  `unverified` ("Scroll test lands with the hook step"); step 5 flips them to `supported`, citing the
  pivot scroll test (it runs a controlled `spec` with `sortMode` and `filterMode` `"server"`). L, PC:
  `gap` `S11-L`, "Client pivot follows." PS: `gap` `G2`, "Pages mode strips `pivot`." API: `n/a`,
  "Pivot cells are read-only aggregates; no write reaches the API."
- `export`: Z stays `gap` I; the note adds "pivot rows export with flat headers". `print`: unchanged.
- `url-state`: L evidence adds `pivot-param.test.ts`. `columns`: note on generated columns and the
  pending layout (`pivot-layout.test.tsx`).

## Steps

1. (2.0, with spec A step 1) Reserve the prefixes (drop in every build with a dev error, the prefix
   test, CHANGELOG **Breaking**); the additive pivot types (`PivotSpec`, `ServerSpec.pivot`, answer
   fields) and the `serverSpecKey` replacer, stripped by spec A step 3; glossary; `data-grid` and
   `data-grid-server` payloads.
2. Glossary (value column, generated column, held set, pivot cell, skeleton set, pending layout);
   `readPivotAnswer` with the id map and its tests.
3. `buildPivotColumns`; core `pivot` props with first-slice normalization; the `computeVisibleColumns`
   flag and reader sets; parity row with Z, C, SS, FS `unverified`.
4. Skeleton set, pending layout, held order, URL filter and merge, sort merge; pivot cells; write paths.
5. Hook: `spec.pivot`, `blockSize` clamp, held set in `groupLayout(data)`, refresh remap, cell budget,
   counts and notes, selection under pivot; remove the scroll strip of `pivot` and invert its
   `page-reset` case; Z, C, SS, FS flip to `supported`.
6. Header `aria-label`, skeleton headers; export, print, find, copy through `viewEntryAt`; perf.
7. URL params; pivot "Server checks" in the recipe and `server-checks.test.ts`; demo
   `data-grid-server-pivot-demo` with its `components/registry-examples.tsx` entry; docs; CHANGELOG;
   payloads; `test:e2e-install`.

## Open questions

1. Ship pivot in 2.0.0? Recommendation: no, apart from the reserved prefixes and the stripped types.
2. Is 500 the right column cap? Recommendation: yes; it matches the header budget and the views list cap.
3. Keep a source-column sort in `sortState` while pivot is on? Recommendation: yes; it is not sent,
   not shown, and comes back when pivot turns off.
