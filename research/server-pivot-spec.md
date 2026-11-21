# Spec: server pivot (gap S11, #99)

## Goal

A server grid shows its result as a pivot. The rows are the groups of 1 to 4 `groupBy` columns. The
columns come from the distinct keys of one pivot column. Each cell is an aggregate of the rows of
one row group that hold one key. The server computes every cell. The grid checks the answer, makes
bounded generated columns with stable ids, and shows read-only pivot cells.

Pivot builds on `research/server-grouping-spec.md` ("spec A"): group rows, group ids, `keyText`
(spec A decision 6), child lists, the `totalRowCount` rule, and the bounds on group answers. Spec A
decision 9 ("strips elsewhere") is stale: server grouping runs in scroll mode and in pages mode.

## Current state (verified)

- The grid has no pivot code: no `pivot` identifier outside tests under `registry/default/blocks`,
  except the layer refusal below.
- The layer refuses a filled `spec.pivot` with `unsupported`: `rejectPivot`
  (`data-grid-server-query/parse-query.ts:100`), called at `:195` and `:231`.
- `ServerSpec` has `groupBy` and `aggregates` (`data-grid/server-spec.ts:14,16`).
  `ServerAggregate` is `{ columnId, reducer }` with closed reducers (`:20`).
- The hook passes the server layout as the `groupLayout` prop (`ServerGroupLayout`,
  `data-grid/group-types.ts:70`, and `gridProps.groupLayout` in
  `data-grid-server/use-data-grid-server-rows.ts:161`). A slot holds `childCount` and `aggregates`
  (`group-types.ts:54-64`).
- `group-row.tsx` renders one read-only aggregate cell per virtualized column
  (`data-grid/rows/group-row.tsx:219`). The label covers the columns up to the first column with an
  `aggregate` (`groupLabelSpan`, `:46`).
- `GroupsPlan` (`data-grid-server-query/plan.ts:44`) runs through `selectGroups` and `countGroups`
  (`data-grid-server-query/create-grid-query.ts:66-67,263-264`) in all 4 adapters. The level
  direction comes from a sort on the group column (`parse-query.ts:207`).
- Limits: `maxGroupAggregates` 32 and `maxGroupKeyLength` 1,024
  (`data-grid-server-query/limits.ts:65-66`). The grid side has the same 32
  (`data-grid-server/parse-server-spec.ts:59`).
- Decimal aggregates: `aggregateValue` (`create-grid-query.ts:417`) converts every reducer over a
  number column with `Number()`. Digits past 15 significant digits are lost.
- PostgreSQL `native` columns group on `col::text` (`subject`,
  `data-grid-server-query/render-sql.ts:38`), so raw order and key order can differ.
- Capabilities: Drizzle and Kysely set `groupBy: true`
  (`data-grid-server-query-drizzle/create-drizzle-grid-query.ts:80`,
  `data-grid-server-query-kysely/create-kysely-grid-query.ts:63`). Supabase sets
  `groupBy: rpc !== undefined` (`data-grid-server-query-supabase/create-supabase-grid-query.ts:179`),
  and its `grid-query.sql` has a `groups` kind (`grid-query.sql:336`). Prisma groups with `groupBy`
  and refuses more than `maxGroupRows` (default 10,000) pairs
  (`data-grid-server-query-prisma/create-prisma-grid-query.ts:138,160`).
- Column groups: `computeHeaderRows` (`data-grid/columns/column-groups.ts:256`).
  `computeVisibleColumns` (`data-grid/store/compute.ts:607`).

## Modes

| Mode | Behavior |
|---|---|
| L, PC (local array, client pagination) | `gap` `S11-L`: "Pivot needs a server." The client buckets are a separate engine. |
| PS (pages mode) | Supported through `useDataGridServerRows`. One page is one block of pivot rows. |
| Z (scroll mode) | Supported through `useDataGridServerRows`. |
| C, SS, FS (controlled state, server sort, server filter) | Supported: a pivot grid is a server grid. The server applies the filters of every registry column and the sort of the `groupBy` and pivot columns. |
| API (own API) | `n/a`: pivot cells are read-only aggregates. No write reaches the API. |

What the server receives and sends:

- **Request:** a groups request (`childKind: "groups"`) with `spec.pivot`. The server evaluates
  the filters, the group keys, the pivot keys, and every cell.
- **Answer:** the group rows, `pivotColumns`, `pivotOmitted`, and `pivotCells` per group row.
- **Bounds:** the request is bounded by the layer's limits ("Refusals"). The answer is bounded by
  the grid ("Answer checks").

## Decisions

1. **Pivot rows are group rows.** They are the group rows of 1 to 4 `groupBy` levels. A pivot row
   above the innermost level opens and lists the pivot rows of the next level. The hook writes
   `childCount: 0` into each innermost slot, which shows no toggle and no `aria-expanded`. No request
   with `childKind: "rows"` leaves under pivot.
   - Keys: the grid does not offer `GROUP_ROW_ACTIONS` on an innermost pivot row. Enter and Space
     then fall to `edit`, which a pivot row refuses. ArrowRight and ArrowLeft fall to `moveRight` and
     `moveLeft`.
2. **The values are `spec.aggregates`.** One parser, the `reducer === column.aggregate` rule, and
   `maxGroupAggregates` 32 apply. Issue #99 says 20. The docs state the difference.
3. **Every answer carries its own column list.** Cells map by generated id, never by position. A
   held id that an answer lacks reads `null`.
4. **The held set rides on `ServerGroupLayout.pivot`.** The first landing after a spec change or
   `refresh()` sets it. Until that landing, the previous held set stays, so the header never shows
   the source columns between two pivot specs. With equal generated ids the object stays; a new
   `omitted` makes a new object over the same `columns` array.
5. **The core builds the generated columns.** It memoizes them on the held `columns` array, so a
   new `omitted` keeps the column defs and the visible columns. They never enter `spec.aggregates`.
   The generated widths of ids that leave the held set drop.
6. **Generated ids derive from values.** See "Generated columns".
7. **Distinct keys are data, so the server cuts them.** Past the cap, the layer keeps the first keys
   in key order and answers `pivotOmitted`. The layer refuses only a bad request.
8. **Checks are off under pivot.** The header checkbox is disabled. `selectAllMatching()` is a
   no-op with a dev warning.

## Wire contract

```ts
// data-grid/server-spec.ts (additive)
export type ServerSpec = {
  /* existing fields */
  /** Present only under pivot. Needs `groupBy` and `aggregates`. The first slice takes 1 column id. */
  pivot?: { columnIds: readonly string[] };
};

// data-grid-server/read-groups-answer.ts (additive)
export type ServerGroupsAnswer = {
  /* existing fields */
  /** Under `spec.pivot`: the generated columns of the whole result, key-major. Required there. */
  pivotColumns?: readonly { path: readonly GroupKey[]; valueIndex: number }[];
  /** Generated columns the server cut past its cap. */
  pivotOmitted?: number;
};
export type ServerGroupRow = {
  /* existing fields */
  /** One value per entry of this answer's `pivotColumns`; `null` when no value counted. */
  pivotCells?: readonly (number | null)[];
};

// data-grid/group-types.ts (additive)
export type ServerGroupLayout = {
  /* existing fields */
  /** The held set. Present under pivot. */
  readonly pivot?: {
    readonly columnId: string;
    readonly values: readonly ServerAggregate[];
    readonly columns: readonly { path: readonly GroupKey[]; valueIndex: number }[];
    readonly omitted: number;
  };
};
// ServerGroupSlot adds `pivotCells?: Float64Array`: held order, NaN for null.
```

- `path` holds one key per `columnIds` entry. `valueIndex` indexes `spec.aggregates`.
- Key-major order: all values of one key are adjacent.
- Key order: a `spec.sorts` entry on the pivot column sets the direction, else ascending. The
  empty key sorts last, as `NULLS LAST` does for group keys.
- Text keys order by the database collation. The client pivot orders them by the client collator,
  so the cut can keep other text keys there.
- `totalRowCount` is the row count of the result. `groupCount` sizes the pivot rows.
- The `serverSpecKey` of a spec without `pivot` stays the same.
- Under pivot the hook clamps the block size and the page size to 200 groups, so one page holds
  at most 40,000 cells.
- The hook sends `pivot` with 1 to 4 `groupBy` levels. With more, it sends no `pivot` and warns once
  in development. Each level's group rows carry the cells of their subtree, and a child answer's
  `pivotColumns` hold the keys of its subtree. So only a top-level answer sets the held set; a child
  answer maps its cells into it by generated id.

### Answer checks (grid, `readPivotAnswer`)

A failed check fails the block, as spec A decision 8 does.

- `pivotColumns` holds at most 5,000 entries. With 5,001 or more, the block fails before any walk.
- Each `path` has exactly `columnIds.length` keys of the `GroupKey` types, each at most 1,024
  characters. Each `valueIndex` is in range. Else the block fails.
- Two entries with the same generated id fail the block (keys `1` and `"1"` share a `keyText`).
- A generated id over 2,048 characters counts as omitted, with one dev warning per spec.
- The walk keeps ids in held order up to 200 and counts the rest as omitted.
- `pivotCells` has exactly `pivotColumns.length` entries, else the block fails. Only kept indices
  are read. A cell is a finite number or `null`. Any other value reads `null` with one dev warning.
- `pivotOmitted` is a safe non-negative integer, else `0` with one dev warning.
- One place computes the omitted count. It is the newest answer's `pivotOmitted`, plus the ids of
  that answer that the 200 cap cuts or that the held set lacks.

## Generated columns

- **Id:** `__pivot:` + `encodeURIComponent(pivotColumnId)` + `=` + `encodeURIComponent(keyText)` +
  `|` + `encodeURIComponent(valueColumnId)` + `=` + reducer. Each segment percent-encodes its
  separators, so no key forges another id. `keyText` follows spec A decision 6.
- **Header group id:** `__pivotgroup:` + the key segment. With 2 or more values, each key gets one
  header group over its value columns. With 1 value, the header row holds the key text.
- **Definition:** one `ColumnDef` per held id. It is read-only and fixed: no sort, filter, move, or
  pin. It carries an internal `pivotIndex` and an `aggregate`, so `groupLabelSpan` stays 1. Its cell
  type is the cell type of the value column. A `count` column uses `number`.
- **Visible set:** under pivot, `visibleColumns` is the `groupBy` column plus at most 200 generated
  columns. Source columns stay in the registry, so their widths, order, pins, and hidden state
  survive pivot on and off.
- **Sort merge:** under pivot the request's `sorts` carry only the `groupBy` and pivot column
  entries. Other entries stay in `sortState` and return when pivot turns off.
- **Prefix guard:** only under pivot, a consumer column or group id that starts with `__pivot:` or
  `__pivotgroup:` drops, with a dev error. Without pivot, such ids work as before, so this is not
  Breaking.
- **URL and views:** the URL writer and saved views drop `__pivot:` ids. Layout `order` holds no
  generated id.
- **Labels:** `labels.pivot` names the value label ("Sum of Amount"), the empty key, and the
  "+N more columns" note. A generated leaf header has an `aria-label` with its full name
  ("2025, Sum of Amount").

## Cells and memory

- **Display:** a pivot cell shows the text of the generated column's cell type through
  `toSafeText`. NaN shows an empty cell, and `0` shows `0`.
- **Decimal cells:** cells are numbers, read through `aggregateValue`, like group aggregates. The
  docs state the loss of digits past 15 significant digits.
- **Readers:** copy, export, print, find, and autosize read a pivot cell through one
  `pivotCellText`. Replace skips pivot cells. Every write path refuses them.
- **Storage:** the hook maps each answer's cells by generated id into one `Float64Array` per slot.
- **Budget:** at most 1,000,000 held cells. Their `byteLength` stays at or below 8,000,000 B.
  Past it, the group blocks evict oldest first; a block under the rendered rows stays. The
  eviction counts cells, not groups.
- Step 0 measured 10,000 × 200 cells at exactly 16,000,000 B, so the budget has no headroom. The
  descriptors add about 354 B per group (3.54 MB at 10,000 groups). Step 10 measures the real total
  and lowers the cap if the total misses its budget.

## Refusals (layer)

- `unsupported`:
  - the adapter lacks `capabilities.pivot`
  - more than 1 pivot column
  - any rows request under pivot
  - a non-numeric value column with a reducer other than `count`
  - a `time` pivot column: phase 1 reads a stored instant at millisecond precision, so a finer
    stored instant would match no key and its cells would stay empty
- `limit-exceeded`:
  - more aggregates than `maxPivotColumns`
  - a stored key over `maxGroupKeyLength` (1,024 characters)
- `invalid-request`:
  - no `groupBy`
  - no aggregates
  - the pivot column inside `groupBy`
- `unknown-column`: a `serverOnly` pivot column, or one that the column map lacks.

A stored key that has no exact test drops from the keys, and its columns count in `pivotOmitted`:
a native enum value outside `choices`, or a number over `maxNumberLength` or the column's digits.
The stored data is not the request, so the layer neither refuses the request nor shows a key whose
cells would read as `FALSE`.

Open: issue #99 asks for "a 400". The route maps a `QueryError` to an HTTP status. The layer
answers these codes.

## Layer SQL

- **Capability:** `AdapterCapabilities.pivot?` defaults to off, so third-party executors decline.
  Drizzle and Kysely set it on.
- **Plan:** `GroupsPlan.pivot?: { column; keys; omitted }`.
- **Parse:** one pivot parser replaces `rejectPivot` in both callers.
  - `parseRows` (`parse-query.ts:195`) takes `spec.pivot` on a groups request and refuses it on a
    rows request.
  - `parseAggregates` (`:231`) checks `spec.pivot` with the same parser, then ignores it: band
    totals over the whole result do not depend on pivot.
  - A values request reads its own `filters`, not the spec, so pivot does not reach it.
- **Limit:** the new `maxPivotColumns` (keys × aggregates) defaults to 200, and a larger value
  reads as 200, the generated columns the grid keeps. The kept key count is
  `floor(maxPivotColumns / aggregates.length)`.
- **Order:** phase 1 runs alone. Phase 2 and the counts start after it, so a failed phase 1 starts
  no other query.

Prisma: pivots through the object API. Phase 1 is one `groupBy` on the pivot field of at most
`maxGroupRows` keys; `''` and NULL fold into the empty key in code. Phase 2 is up to four calls:
`groupBy [level, pivot]` over the page's non-blank keys and the kept key tests, `groupBy [pivot]`
for the blank group, `groupBy [level]` for the blank key, and `aggregate` for both blank, so the
database reduces every cell. A page over 40,000 group and key pairs, or more pivot keys than
`maxGroupRows`, is `limit-exceeded`; a PostgreSQL enum pivot column and a SQLite decimal `sum`,
`min`, or `max` are `unsupported`. `tests/server-query/prisma/pivot.test.ts` compares every answer
with Kysely on the same engine; a 200-group page of 40,000 pairs over 100,000 rows takes 73 to 105 ms.

Supabase: `capabilities.pivot` is `rpc !== undefined`. Supabase is unreleased, so the branch needs
no re-install note.

### Phase 1: keys

Phase 1 is one query on the pivot column, over the same scoped `where` as the page. It returns
the keys in key order with `count(*) OVER ()` as the total key count, under `LIMIT keptKeys + 1`.
The total feeds `pivotOmitted`. A separate key-count query misses the budget (step 0). Step 3
names the executor call that returns the keys and the total in one round trip.

Prisma: no phase 1 (declined).

Supabase: the `groups` kind of `grid-query.sql` gets a `pivot` branch that runs the same folded
query in SQL, with the cap in SQL.

### Phase 2: cells

- A CTE `page` selects the page's group keys with the existing `GROUP BY ... ORDER BY ...
  LIMIT/OFFSET`.
- The outer query computes the aliases `p${i}` only over rows whose group key is inside the page.
  The outer `ORDER BY` has no `LIMIT`.
- **Bound:** a range on the group key expression: `groupKey(level) >= min(page.k) AND
  groupKey(level) <= max(page.k)`. The page is contiguous in key order, so the range is exact. The
  bound compares the key expression, never the raw column: `subject()` renders `col::text` for
  PostgreSQL `native` columns, where raw order differs from key order.
- **Empty group:** an explicit branch, `groupKey(level) IS NULL AND EXISTS (SELECT 1 FROM page
  WHERE k IS NULL)`. A range never matches NULL.
- **Cells:** `p${i}` is `SUM(CASE WHEN key = $k THEN col END)` for `sum`, and the same shape for
  `avg`, `min`, and `max`. The empty pivot key uses `IS NULL`. `count` uses `COUNT(CASE WHEN
  key = $k AND <non-blank value> THEN 1 END)`, the existing `count` rule.
- Keys reach the query as parameters: at most 200 aliases and 200 key parameters.
- Phase 2 is one statement, so `selectGroups(plan, page)` stays one executor call.
- A grouped request without pivot renders byte-equal SQL. The CTE applies only under pivot.
- The layer throws on a cell-count mismatch between the plan and the executor rows.

Prisma: no phase 2 (declined).

Supabase: the `pivot` branch uses the same page CTE, with
`FILTER (WHERE key::text IS NOT DISTINCT FROM keys->>i)` per cell and `'cells'` per row. It runs
through the PGlite path and the same oracle, with the same `search_path` and operator review.

### Per construct

- **Group bound (key-expression range, empty-group branch):**
  - Prisma: none (declined).
  - Supabase: the same range on the key expression and the same empty-group branch, in SQL.
- **Empty pivot key (`''` and NULL fold into one key):**
  - Prisma: cannot fold `''` into the empty key with `groupBy`. This is one reason it declines.
  - Supabase: `keys->>i` is NULL for the empty key, and `IS NOT DISTINCT FROM` matches it.
- **`count` cells:**
  - Prisma: none (declined).
  - Supabase: `count(<value>) FILTER (WHERE ...)` with the same non-blank rule.
- **Cut and `pivotOmitted`:**
  - Prisma: none (declined).
  - Supabase: the keys call carries the kept key count (`limit`) and the value count
    (`values`). The SQL keeps at most `max_pivot_columns / values` keys, so a wrapper cap below
    the core's cuts keys instead of raising, and it returns the total key count for
    `pivotOmitted`. The cells call raises only when keys × values exceed the cap.
- **Decimal cells:**
  - Prisma: none (declined).
  - Supabase: the client reads `'cells'` through the same `aggregateValue`, so decimal cells are
    numbers.
- **Refusals:**
  - Prisma: `unsupported` from the capability check, before the executor runs.
  - Supabase: the shared parser, so the same codes. Without `rpc`, `unsupported`.

### Measured (step 0, `.crew/rounds/pivot-spike.md`)

100,000 rows, 10,001 groups, 201 keys, offset 9,800, no index, fastest of 5 warm runs:

| Query | SQLite | PGlite |
|---|---|---|
| Plain `SUM(CASE ...)` × 200 over the offset page (rejected) | 1,502 ms | 654 ms |
| Page CTE with the key-expression range, `sum` / `count` | 82 / 71 ms | 47 / 81 ms |
| Full `fetchGroups`: folded phase 1, phase 2, group count | 138 ms | 118 ms |
| Non-pivot `fetchGroups` (baseline) | 53 ms | 80 ms |

The full fetch meets the 150 ms budget with about 30 ms to spare on PGlite. A separate key-count
query costs about 42 ms more and misses it. Not measured: multi-level `groupBy` under pivot,
decimal value columns, a selective `where`, PostgREST over HTTP, and `FILTER (WHERE ...)` in place
of `CASE`.

## Client parity gaps

| Id | Gap |
|---|---|
| `S11-L` | L and PC: pivot needs a server. Client buckets are a separate engine. |
| `S11-M` | Closed: the layer and the server hook take 1 to 4 levels with subtotals. |
| `S11-P` | Closed: Prisma pivots through the object API; it refuses a PostgreSQL native enum pivot column and SQLite decimal `sum`, `min`, and `max`. |
| `S11-UI` | Out of scope: a pivot chooser, a sort list, and menu items for pivot. |
| `S11-V` | Out of scope: widths of generated columns in saved views. |

The PR body lists these ids. No follow-up issue exists yet.

## Group-row readers (closed list)

Every site under `registry/default/blocks` that branches on a group row, outside tests,
`store/view-rows.ts`, `group-types.ts`, `data-grid-sdk.ts`, and the layer. The list is the output
of these patterns:

- Calls: `dataIndexAt(`, `dataIndexOf(`, `rowAtViewRow(`, `viewEntryAt(`, `groupIndexAt(`,
  `groupLayoutOfView(`, `recordKeyAt(`, `rowIdAtViewRow(`, `forEachDataIndex(`,
  `viewRowOfGroupId(`, `groupRowMetaAt(`, `leafViewOf(`.
- Fields and flags: `kind === "group"`, `childCount`, `.groupLayout`, `groupMode ===`,
  `GROUP_ROW_ACTIONS`, `childKind` (hook only), `aria-expanded` on a row.
- Sign tests on view entries: `< 0` and `>= 0`.
- Raw walks: `viewIndex[` and `of ... viewIndex`.
- Sites outside the patterns: the toggle, the header checkbox, and `selectAllMatching`.
- Dropped matches: `aria-expanded` on widgets that are not rows (the find panel, the import
  dialog, the lookup editor, the date editor), and the `childKind` types, JSDoc, and errors of the
  hook.

Paths are relative to `registry/default/blocks/`. Behavior codes:

- **R:** read the pivot cell through `pivotCellText` where the reader reads a data cell. This is a
  change.
- **W:** a write path. The group-row skip refuses every write on a pivot cell. No change. Test it.
- **T:** toggle. A pivot row has `childCount: 0`, so expand, collapse, and toggle do nothing.
- **K:** checks. Pivot rows cannot be checked.
- **N:** a count of data rows that reads 0 under pivot. This is a change.
- **S:** keeps the group-row skip or the group id. No change.

| Site | Code | Pivot behavior |
|---|---|---|
| `data-grid/clipboard/use-grid-clipboard.ts:59` | R | Copy of a rect (`serializeRowSlice`) writes the displayed pivot text. |
| `data-grid/clipboard/use-grid-clipboard.ts:118` | R | Copy of checked rows (`serializeDisjointRows`) writes the pivot text. |
| `data-grid/clipboard/use-grid-clipboard.ts:180` | W | Cut ids (`copyScopeCellIds`) skip pivot rows, so a cut clears nothing. |
| `data-grid/clipboard/use-grid-clipboard.ts:276` | W | Paste candidates skip pivot rows. |
| `data-grid/clipboard/use-grid-clipboard.ts:410` | W | Paste anchor on a pivot row is refused. |
| `data-grid/clipboard/use-grid-clipboard.ts:432` | W | Paste re-resolve skips pivot rows. |
| `data-grid/clipboard/use-data-grid-clipboard.ts:29` | S | Same-cell check by row id. Group ids work. |
| `data-grid-io/export-grid.ts:178` | R | Scope rows map to data indices. Under pivot, map pivot rows to their slots instead. |
| `data-grid-io/export-grid.ts:190` | R | `leafViewOf` drops group rows. Under pivot, export walks the pivot rows. |
| `data-grid-io/export-grid.ts:192` | R | The `>= 0` filter drops group rows. Keep pivot rows. Headers join with " / ". |
| `data-grid-io/print-grid.ts:89` | R | The print total comes from `exportDataIndices`. Count pivot rows. |
| `data-grid-find-replace/plan-replace.ts:179` | W | Replace skips pivot cells. |
| `data-grid-find-replace/result-walk.ts:11` | S | Hole walk. A pivot row is no hole. |
| `data-grid-find-replace/use-find-result-walk.ts:56` | S | Waits on holes only. |
| `data-grid-find-replace/find-replace-panel.tsx:270` | W | Replace of one match skips a pivot cell. |
| `data-grid-find-replace/find-replace-panel.tsx:314` | W | Replace-all re-resolve skips pivot cells. |
| `data-grid/store/compute.ts:930` | R | Quick-search `getText` reads the pivot text, so find matches pivot cells. |
| `data-grid/store/compute.ts:931` | R | Quick-search `getSearchText` reads the pivot text. |
| `data-grid/columns/autosize-columns.ts:108` | R | Autosize measures pivot text for generated columns. |
| `data-grid/store/compute.ts:1049` | R | `getRangeValues` (`onSelectionChange` values) reads pivot cells. Step 11 does not list it yet. |
| `data-grid-status-bar/use-data-grid-selection-stats.ts:50` | R | Selection stats sum pivot cells. Step 11 does not list it yet. |
| `data-grid/store/create-store.ts:1247` | R | Ctrl+Arrow edge detection (`isEmptyAt`) treats NaN as empty. Step 11 does not list it yet. |
| `data-grid/interaction/dispatch-grid-action.ts:476` | R | The same edge detection on the keyboard path. Step 11 does not list it yet. |
| `data-grid/rows/group-row.tsx:219` | R | A generated column cell shows the pivot cell, not `aggregates[column.id]`. |
| `data-grid/rows/group-row.tsx:46` | S | `groupLabelSpan` stays 1: generated columns carry `aggregate`. |
| `data-grid/rows/group-row.tsx:156` | S | The label span is clamped to the visible columns. |
| `data-grid/rows/group-row.tsx:169` | T | `aria-expanded` on a pivot row above the innermost level; none on an innermost row. |
| `data-grid/rows/group-row.tsx:194` | T | `DataGridGroupToggle` on a pivot row above the innermost level; none on an innermost row. |
| `data-grid/rows/group-toggle.tsx:30` | T | Rendered only where `expandable` is true. |
| `data-grid/interaction/dispatch-grid-action.ts:410` | S | Opens and closes a pivot row above the innermost level. On an innermost row `toggleGroup` does nothing (`data-grid/store/group-actions.ts:99`). |
| `data-grid/interaction/use-grid-interaction.ts:42` | T | `GROUP_ROW_ACTIONS` are offered on an expandable pivot row only. |
| `data-grid/interaction/use-grid-interaction.ts:445` | T | On an innermost pivot row Enter falls to `edit`, which the row refuses, and the arrows move. |
| `data-grid/interaction/dispatch-grid-action.ts:70` | S | A command gets no data row on a pivot row. |
| `data-grid/interaction/dispatch-grid-action.ts:436` | S | Open link needs a data row. Generated columns have no `href`. |
| `data-grid/store/group-actions.ts:30` | T | The active cell anchor on toggle of an expandable pivot row. |
| `data-grid/store/group-actions.ts:33` | T | `viewRowOfGroupId` on toggle of an expandable pivot row. |
| `data-grid/store/group-actions.ts:57` | S | Client tree only. |
| `data-grid/store/group-actions.ts:81` | T | The server expanded state opens pivot rows above the innermost level; the hook never lays an innermost row open. |
| `data-grid/store/group-actions.ts:99` | T | `toggleGroup` on an innermost pivot row does nothing. |
| `data-grid/store/group-actions.ts:111` | S | Server groups refuse client-only actions. |
| `data-grid/store/group-positions.ts:33` | S | One pass over the view rows: each open group owns its next `childCount` rows, so a sparse layout places every row. |
| `data-grid/store/group-positions.ts:56` | S | A group opens by the expanded state and `groupRowExpandable`, or when a deeper group row follows it. |
| `data-grid/store/group-positions.ts:76` | S | Position lookup, cached per view and expanded state. |
| `data-grid/store/group-positions.ts:79` | S | `aria-level`, `aria-posinset`, and `aria-setsize` from the parent's `childCount`; the top level counts its view rows. |
| `data-grid/store/group-positions.ts:92` | T | `groupRowMetaAt` reports `expandable` and `expanded: false` for an innermost pivot row. |
| `data-grid/store/hooks.ts:419` | T | `useDataGridGroupRow` returns the pivot row meta. |
| `data-grid/rows/marker-header.tsx:62` | K | The header checkbox is disabled under pivot. |
| `data-grid/store/create-store.ts:1295` | K | `selectAllMatching()` is a no-op with a dev warning under pivot. |
| `data-grid/store/selected-rows.ts:58` | K | Counts no checked pivot row. |
| `data-grid/store/selected-rows.ts:76` | K | Reads no checked pivot row. |
| `data-grid/store/selected-rows.ts:88` | K | Reads no checked pivot row. |
| `data-grid/store/selected-rows.ts:97` | K | Reads no checked pivot row. |
| `data-grid/store/hidden-checked-rows.ts:91` | K | Carries no pivot row. |
| `data-grid/store/hidden-checked-rows.ts:102` | K | Carries no pivot row. |
| `data-grid/store/hidden-checked-rows.ts:114` | K | Carries no pivot row. |
| `data-grid/store/hidden-checked-rows.ts:148` | K | Carries no pivot row. |
| `data-grid/store/selection-state.ts:89` | K | `deriveRowIds` returns no pivot row. |
| `data-grid/store/compute.ts:1076` | K | `getSelectedRowIds` returns no pivot row. |
| `data-grid/store/matching-total.ts:6` | K | The server total is `leafCount`. All matching is off under pivot. |
| `data-grid/store/matching-total.ts:9` | K | Client layout path. Not reached under pivot. |
| `data-grid-status-bar/status-bar.tsx:25` | N | The row count of a grouped view counts data rows only, so under pivot it reads 0. Count the pivot rows. |
| `data-grid-status-bar/status-bar.tsx:29` | N | The same count. |
| `data-grid-context-menu/context-menu.tsx:35` | S | The menu gets no data row on a pivot row. |
| `data-grid-context-menu/context-menu.tsx:36` | S | The same. |
| `data-grid-context-menu/context-menu.tsx:172` | T | The group-row menu offers expand and collapse on an expandable pivot row only. |
| `data-grid-context-menu/context-menu.tsx:173` | T | The same. |
| `data-grid-context-menu/menu-items.tsx:178` | S | Row id lookup. |
| `data-grid-context-menu/menu-items.tsx:195` | S | Expand all is client only. |
| `data-grid-context-menu/menu-items.tsx:222` | W | Server groups hide insert, duplicate, and delete, so a pivot row offers no write item. |
| `data-grid-context-menu/menu-items.tsx:307` | T | The group-by items offer nothing on a generated column. Other pivot menu items are `S11-UI`. |
| `data-grid-comments/comment-popover.tsx:71` | W | No comment on a pivot cell. |
| `data-grid-comments/comments-mount.tsx:68` | W | No comment on a pivot cell. |
| `data-grid-comments/comments-overlay.tsx:107` | S | Markers for data rows only. |
| `data-grid-comments/own-cell.ts:6` | W | Needs a data row. |
| `data-grid-fill/use-fill-handle.ts:45` | W | Fill flashes need written rows. None under pivot. |
| `data-grid-fill/use-fill-handle.ts:89` | W | Fill source text. No data row under pivot. |
| `data-grid-fill/use-fill-handle.ts:112` | W | Fill source row. No data row under pivot. |
| `data-grid-fill/use-fill-handle.ts:174` | W | Fill candidates skip pivot rows. |
| `data-grid/store/data-write.ts:244` | S | Grouped views take the full rebuild. |
| `data-grid/store/data-write.ts:298` | W | Write record lookup skips pivot rows. |
| `data-grid/store/data-write.ts:307` | W | Active record lookup skips pivot rows. |
| `data-grid/store/data-write.ts:424` | S | Grouped views take the full rebuild. |
| `data-grid/store/data-write.ts:569` | W | Server groups own the rows. Row operations refuse. |
| `data-grid/store/data-write.ts:631` | W | Insert position on a pivot row falls to the end, then server groups refuse it. |
| `data-grid/store/data-write.ts:672` | W | Duplicate skips pivot rows. |
| `data-grid/store/data-write.ts:714` | W | Move anchor skips pivot rows. |
| `data-grid/store/data-write.ts:1084` | W | Edit commit needs a data row. |
| `data-grid/store/data-write.ts:1279` | W | Insert on a group row is refused. |
| `data-grid/store/data-write.ts:1280` | W | The same refusal. |
| `data-grid/store/data-write.ts:1296` | W | Delete skips pivot rows. |
| `data-grid/store/data-write.ts:1342` | W | Delete of selected rows skips pivot rows. |
| `data-grid/store/data-write.ts:1343` | W | The same refusal. |
| `data-grid/store/commit.ts:239` | W | Edit start needs a data row. |
| `data-grid/store/commit.ts:262` | W | Commit needs a data row. |
| `data-grid/store/clear-writes.ts:14` | W | `clearContents` skips pivot rows. |
| `data-grid/validation/bulk-generation.ts:32` | W | Bulk writes skip pivot rows. |
| `data-grid/validation/bulk-generation.ts:73` | W | Bulk re-resolve skips pivot rows. |
| `data-grid/store/api.ts:86` | S | `getRow` returns `undefined` for a pivot row. |
| `data-grid/store/api.ts:92` | S | `getViewRowIds` walks the view. |
| `data-grid/store/api.ts:93` | S | `getViewRowIds` skips pivot rows. |
| `data-grid/store/hooks.ts:397` | S | `useDataGridRow` returns `undefined`. |
| `data-grid/store/hooks.ts:405` | S | Row id falls back to the group id. |
| `data-grid/store/hooks.ts:414` | S | Group id. |
| `data-grid/store/hooks.ts:427` | S | Row ids fall back to group ids. |
| `data-grid/store/hooks.ts:446` | S | Row id by view row. |
| `data-grid/store/hooks.ts:535` | S | Data row lookup. |
| `data-grid/store/hooks.ts:555` | S | Data row lookup. |
| `data-grid/store/hooks.ts:575` | S | Row id by view row. |
| `data-grid/store/hooks.ts:610` | S | Save status by row id. None on pivot rows. |
| `data-grid/store/hooks.ts:716` | K | Selected rows. None under pivot. |
| `data-grid/store/provider.tsx:25` | S | Active cell event carries the group id. |
| `data-grid/store/provider.tsx:52` | S | Record move by row id. |
| `data-grid/store/selection-state.ts:77` | S | `cellRefAtViewCoord` names the group id. |
| `data-grid/store/relayout-only.ts:13` | S | Row id per view row. |
| `data-grid/store/row-index.ts:73` | S | Indexes data rows only. |
| `data-grid/store/compute.ts:78` | S | Active cell anchor by row id. |
| `data-grid/store/compute.ts:80` | S | The same. |
| `data-grid/store/compute.ts:173` | S | Records across rebuilds. |
| `data-grid/store/compute.ts:180` | S | The same. |
| `data-grid/store/compute.ts:223` | S | The same. |
| `data-grid/store/compute.ts:225` | S | The same. |
| `data-grid/store/compute.ts:835` | S | Page slices keep the layout. |
| `data-grid/store/create-store.ts:173` | S | Holes test. |
| `data-grid/store/create-store.ts:279` | S | Takes the `groupLayout` prop with its `pivot`. |
| `data-grid/store/create-store.ts:365` | S | Range anchor by row id. |
| `data-grid/store/create-store.ts:432` | S | Active cell follows its record. |
| `data-grid/store/create-store.ts:437` | S | The same. |
| `data-grid/store/create-store.ts:438` | S | The same. |
| `data-grid/store/create-store.ts:510` | S | Rebuild diff of data rows. |
| `data-grid/store/create-store.ts:511` | S | The same. |
| `data-grid/store/create-store.ts:641` | S | Initial grouping. |
| `data-grid/store/create-store.ts:871` | S | Flashes keep by row id. |
| `data-grid/store/create-store.ts:978` | S | Relayout check. |
| `data-grid/store/create-store.ts:1073` | S | Takes the `groupLayout` prop with its `pivot`. |
| `data-grid/store/create-store.ts:1074` | S | Derived layout. |
| `data-grid/store/create-store.ts:1654` | S | Leaf view for the result count. |
| `data-grid/store/create-store.ts:1655` | S | The same. |
| `data-grid/store/sync-props.ts:397` | S | Syncs the `groupLayout` prop. The generated columns keep their identity while the held `columns` do. |
| `data-grid/store/sync-inputs.ts:48` | S | Equality of `groupMode`. |
| `data-grid/store/group-view.ts:40` | S | `groupMode` from the props. |
| `data-grid/store/group-view.ts:47` | S | Server layout path. |
| `data-grid/store/group-view.ts:143` | S | Layout patch check. |
| `data-grid/store/server-group-view.ts:52` | S | Count checks. A pivot row carries `childCount: 0`. |
| `data-grid/store/server-group-view.ts:66` | S | Copies `childCount`. Also copies `pivotCells`. |
| `data-grid/store/group-pages.ts:7` | S | Page starts of a grouped view. |
| `data-grid/store/group-pages.ts:14` | S | The same. |
| `data-grid/store/group-patch.ts:19` | S | Status patch. |
| `data-grid/store/group-readers.ts:9` | S | `leafViewOf`. |
| `data-grid/store/group-readers.ts:10` | S | Client tree only. |
| `data-grid/store/group-readers.ts:16` | S | Leaf count. |
| `data-grid/store/group-readers.ts:21` | S | Group rows. |
| `data-grid/store/group-state.ts:14` | S | `isGroupRowId`. |
| `data-grid/store/announcements.ts:13` | S | Counts loaded data rows. |
| `data-grid/store/announcements.ts:19` | S | Failed-group announcement. |
| `data-grid/store/announcements.ts:21` | S | The same. |
| `data-grid/store/announcements.ts:22` | S | The same. |
| `data-grid/use-load-announcement.ts:51` | S | Leaf view for the load announcement. |
| `data-grid/sort-filter/build-group-view.ts:105` | S | Client buckets only. |
| `data-grid/rows/use-class-name-revision.ts:28` | S | Row class names for data rows only. |
| `data-grid/body.tsx:123` | S | Selects the layout. |
| `data-grid/body.tsx:342` | S | Renders a group row. Under pivot every row. |
| `data-grid/root.tsx:277` | S | Grouped flag. |
| `data-grid-pagination/use-data-grid-pager.ts:27` | S | The pager counts groups. |
| `data-grid-pinned-rows/use-data-grid-aggregate.ts:52` | S | Band aggregates over leaves. No change. |
| `data-grid-server/refresh-guard.tsx:207` | S | Active row id. Group ids work. |
| `data-grid-server/use-group-blocks.ts:239` | T | Sends `spec.pivot`. Never `childKind: "rows"` under pivot. |
| `data-grid-server/group-lists.ts:80` | S | Child counts. They are `0` under pivot. |
| `data-grid-server/group-lists.ts:142` | T | Writes `childCount: 0` and `pivotCells` into the slot. |
| `data-grid-server/group-lists.ts:148` | T | Opens no child list under pivot, also under `expanded: "expanded"`, expand all, or restored ids. |
| `data-grid-server/parse-server-spec.ts:112` | S | `childKind` is `"groups"` at every pivot level. |

Count: 176 sites.

## Performance budgets

| Test | Measures | Budget |
|---|---|---|
| `read-pivot-answer-perf.test.ts` | 200 groups × 200 cells read and mapped. 5,001 descriptors refused | ≤ 3 ms. ≤ 0.1 ms |
| `pivot-columns-perf.test.ts` | 200 columns plus `computeHeaderRows` with 50 groups | ≤ 2 ms |
| `group-lists-perf.test.ts` (extend) | `layoutView` at 10,000 groups with cells. The cells' `byteLength` | the existing budget. ≤ 16,000,000 B |
| `pivot-store-perf.test.ts` | one landing at 10,000 rows × 200 columns | ≤ 16 ms |
| `pivot.perf.browser.test.tsx` | vertical and horizontal fling, 100,000 rows × 200 columns with eviction. Render count of one landing | long tasks ≤ 200 ms. Only the landed rows render again, no header cell |
| `pivot-readers.test.tsx` | find over 1,000 × 200 | ≤ 100 ms |
| `tests/server-query/pivot-perf.test.ts` | one full 200-group `fetchGroups`, SQLite and PGlite, 100,000 rows | ≤ 150 ms |

Step 0 measured parse plus fill of 200 × 200 cells at 1.06 ms.

## Tests

- Layer: `parse-query.pivot.test.ts` (every refusal. Another tenant's key never becomes a column. A
  `__proto__` key), `render-groups.test.ts` (SQL without pivot is byte-equal. At most 200 aliases),
  `tests/server-query/pivot.test.ts` against the client oracle (`''` and NULL, `1` and `"1"`,
  descending keys, scope, cut, 4-level subtotals, rows refused), and the Prisma decline.
- Supabase: plan-shape snapshots over a capturing `fetch`, hostile JSON, and the PGlite run of the
  `pivot` branch.
- Grid: `read-pivot-answer.test.ts`, `build-pivot-columns.test.ts`, `pivot-registry.test.tsx`,
  `pivot-cells.test.tsx`, `pivot-readers.test.tsx` (CSV `=cmd`, XLSX string cell), and the hook
  tests `*.pivot.scroll.test.tsx` and `*.pivot.pages.test.tsx` (StrictMode, unmount, eviction).
- Paint: `expectNoPaintMismatch` on a pivot cell in the default, hovered, active, selected, and
  checked states. Radius 0 and 1rem.
- Every test without pivot stays unchanged.

## Parity matrix

New row `pivot`: Z, PS, C, SS, FS `supported` with the hook tests as evidence. L, PC `gap`
`S11-L`. API `n/a`, "Pivot cells are read-only aggregates." Step 13 writes it and runs
`node scripts/verify-parity.mjs --write`.

## Open questions

1. Issue #99 asks for "a 400" on a refusal. The layer answers `QueryError` codes. The route maps
   them to a status.
2. `S11-L`: create the follow-up issue for client pivot at the end of the series.
