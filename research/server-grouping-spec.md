# Spec: server grouping (gap G)

## Goal

A scroll-mode server grid groups its result by a column. The server computes the groups, their row
counts, and their aggregates; the grid shows group rows and fetches a group's rows when the user
expands it, with every row-id rule, write rule, and bound of flat scroll mode. The same `groupBy`,
`expanded`, and `aggregates` props drive local and server grouping, and one set of group renderers
serves both.

Builds on `research/row-grouping-spec.md` (#71) and `research/tree-data-spec.md` (#68), which leave
server grouping out (`row-grouping-spec.md:20`, `tree-data-spec.md:110-111`). It amends their key
rule, labels, and reducers (decisions 3 and 6, applied in `row-grouping-spec.md` decisions 5 and 6
and its API block). `research/server-pivot-spec.md` builds on this spec, which is the source for
every shared type.

## Scope boundary

| 2.0 contract | First slice (after #71) | Later slices | Out |
|---|---|---|---|
| `ServerSpec` fields, request fields, answer types, `SelectedRows` shape, answer validation, strips | one `groupBy` level in scroll mode; counts; built-in aggregates; grand totals; expand and collapse as requests; leaf checks; URL `group` param | multi-level groups; pages mode over top-level groups; server tree; group checks; `expanded` in URL and views; `groupBy` in views | sequential sources; group footer rows; sort by an aggregate; expand all over a server; row operations while grouped; grouping with tree data |

## Current state (verified)

- No `groupBy`, `getParentId`, `viewEntryAt`, `viewTree`, or `ExpandedState` exists under
  `registry/default/blocks`.
- `ServerSpec` is `{ sorts, filters, searchText }`; `serverSpecKey` is a `JSON.stringify` without
  `filterId` (`data-grid/server-spec.ts:7-18`). `readAnswer` throws without a `rows` array, cuts rows
  to `end - start`, clamps counts to `MAX_ROW_COUNT` (10,000,000) (`read-answer.ts:4,54-88`).
- Scroll mode keys `loaded`, `pending`, `failed`, `displaced`, `cleared`, the refresh guard, and
  `writeBlocks` by absolute data index; landings commit on the next frame (`scroll-blocks.ts:238-265`).
  Edits replay on the one rows array (`:605-612`). A count change wipes every block (`:366-372`); a
  spec change drops every block and fetches block 0 a tick later (`:483-500`); `refresh()` evicts
  blocks outside the rendered rows plus `overscan` and refetches the rest in place (`:555-578`);
  dedupe skips an in-flight key (`:410`) and a landing checks only `signal.aborted` (`:441`).
  Rendered-row changes never abort (`:458-478`). No concurrency or cache cap. Hole ids carry the
  prefix `__lazy-unloaded-` (`store/compute.ts:88-93`).
- The core's data sync runs in the provider's passive effect and only when a recompute key changes
  (`store/provider.tsx:238-249`). `pluginsListEqual` compares `name`, `Overlay`, `rowBands`,
  `onDataChange`, `commands`, `keymap`, `Mount` (`store/plugins.ts:31-41`). `DataGridPlugin` is on the
  consumer barrel (`data-grid.tsx:36`).
- Selection: `selectAllMatching` checks `[0, viewIndex.length)` (`create-store.ts:1395`);
  `remapRowChannel` calls `rows.toArray()` (`compute.ts:134-154`); `readSelectedRows` puts every
  unchecked loaded row into `excludedIds` (`selected-rows.ts:43-48`); the checked count reads
  `selection.rows.length` (`announcements.ts:11-14`, `create-store.ts:115-117`); the header tri-state
  reads every view row (`allRowsSelectedState`, `hooks.ts:707-712`); row markers read `rows.hasIndex` (`hooks.ts:443-448`).
- The `rowId -> dataIndex` cache costs 10.1 ms at 100k rows (`row-index.ts:6-12`).
- Pinned-row reducers count `""`, sum `[1, "5"]` to `"15"`, and give `undefined` for no input
  (`data-grid-pinned-rows/use-data-grid-aggregate.ts:21-44`); they map `viewIndex` straight to `data`
  (`:71`). Export walks `viewIndex` and skips holes (`export-grid.ts:71-79`).
- The root is `role="grid"` (`root.tsx:596,604,608`); rows carry `aria-rowindex` only (`row.tsx:86-99`).
  Row operations over unloaded rows are no-ops (`data-write.ts:612`). Compression is specified, not
  built (`research/scroll-height-compression.md:10`).

## Decisions

1. **One fetch contract.** Groups come from the same `fetchRows`; a request names the group whose
   children it reads (`groupPath`) and their kind (`childKind`). Rejected: a `fetchGroups` callback —
   two abort paths and two error states.
2. **`groupBy` and `aggregates` are optional `ServerSpec` fields, omitted when empty.** The
   `serverSpecKey` replacer drops them when empty, so ungrouped keys stay byte-equal. The reset key
   leaves out `aggregates` (decision 7). Expanded state is not in the spec. Rejected: a `GroupSpec`
   beside the spec — a bulk action needs one value that names the result.
3. **Group rows reuse the client model.** Same `GroupNode`, ids, `viewEntryAt`, `viewTree`,
   `ExpandedState`, toggle, keys, and treegrid ARIA (`row-grouping-spec.md` decisions 1-4).
   `GroupNode.count` is the group's `totalRowCount`; `GroupNode.label` (also on `GroupLabelCtx`;
   default label "<label> (<count>)") is `label ?? toDisplayText(key) ?? toText(key)`; it adds
   `childCount` and `status` (`"loading" | "failed" | undefined`). Rejected: a server-only group row.
4. **`groupMode: "client" | "server"` (default `"client"`); the layout is keyed by the data array.**
   Under `"server"` the core never buckets rows. The hook's plugin carries a stable
   `groupLayout: (data: readonly unknown[]) => GroupLayout | undefined`, typed on
   `DataGridSdkPlugin = DataGridPlugin & { groupLayout? }` in `data-grid-sdk.ts`, the surface the server
   add-on imports (`scroll-blocks.ts:5`); the consumer barrel gains nothing (type test). Each re-layout
   makes a new `data` array, and the hook files its layout in a `WeakMap` under that array. The core's
   data sync calls `groupLayout(data)` in the same pass, so data and layout land in one store write,
   whatever the effect order, StrictMode, or the compiler do; on `undefined` it keeps the last layout
   and warns once in development. The getter's identity never changes, so `pluginsListEqual` stays
   true. `GroupLayout` maps `(listId, offset)` to `{ path, key, label, childCount, count, aggregates,
   status }` and holds each list's failed block ranges. A request that starts, fails, or settles files a
   new layout with a new `data` array in that frame's one commit;
   the core builds every group id itself from validated `(columnId, key)` pairs, so no plugin can hand
   it a forged id. `groupMode="server"` without the getter is a dev error and renders ungrouped.
   Rejected: a public `serverGroups` prop (exposes the engine's map). Rejected: a layout value on the
   plugin (`pluginsListEqual` ignores it). Rejected: a getter over a ref or an effect-written store
   (the core's effect runs first; a discarded render leaves the ref ahead).
5. **`totalRowCount` is the result's row count: leaves only.** Group rows and holes are view rows. The
   view row count drives scroll height and `aria-rowcount`. Rejected: the view row count — the pager,
   status bar, and selection count would jump on every toggle.
6. **One key rule: the raw stored value.** `GroupKey = string | number | boolean | null`;
   `keyText = toSafeText(key)`; `null` and `""` are the empty group. A select groups by stored value, a
   decimal by the exact number, so both modes give the same ids. Rejected: server-made ids — a forged
   id could collide with another group or a band id.
7. **A spec change keeps expanded ids; an aggregates change keeps everything.** A sort, filter, or
   search change keeps `expanded`, drops every child list, aborts all requests, and scrolls to the
   first row; a group reopens when its row loads. An `aggregates` change marks the group-row blocks
   stale, aborts and requeues the in-flight group-row requests inside the rendered rows plus
   `overscan`, evicts
   nothing, and keeps lists, scroll position, and checks. Rejected: keep the scroll offset on a spec
   change — old offsets name other rows.
8. **A malformed answer fails its block; a stale key yields to the newest block.** A wrong kind, a bad
   key, a key repeated inside one answer, a bad count, or a leaf id with a reserved prefix fails the
   block with a dev warning naming key and field; `retry()` repeats it. When the same raw key (type and
   value) sits in an older loaded block of the list, only that row of the older block becomes a hole
   and the block turns stale, so other open groups in it keep their rows. A block displaced this way
   refetches at most once per spec; a second conflict on the same raw key fails the newer block with
   the dev warning, so an off-by-one paging server cannot loop. An equal `keyText` from a
   different raw key (`1` and `"1"`, `null` and `""` from a server that does not merge them) fails the
   newer block. Rejected: drop the bad row — later positions shift and `aria-posinset` lies.
9. **Scroll mode only; strips elsewhere.** Pages mode warns once and strips `groupBy`, `aggregates`,
   and `pivot` from the request spec, `gridProps`, and `selected.spec` (a grouping server would answer
   `{ groups }`, and `readAnswer` throws, `read-answer.ts:60`). Until the first slice ships, scroll mode
   strips them the same way. Rejected: pages over flattened rows — the server must know the expanded
   state.
10. **Checks are a rule; the row channel is a cache.** The store holds all matching, group entries,
    `ids`, and `excludedIds`. The row channel holds every leaf view row, loaded or hole, whose rule
    state is checked; group rows never join it. Every re-layout rebuilds it over all view rows (the
    flat-mode carry cost); a landing that does not re-lay out patches its own rows; scrolling does no
    work. Row markers, copy of checked rows (`use-grid-clipboard.ts:37`), and controlled `selection`
    read the channel. The checked count and the header tri-state read the rule: the count is
    `selected.count`; the header is checked only in all matching with `excludedIds` and `groups` empty.
    A rebuild never announces and never calls `onSelectionChange`. Rejected: rendered rows only — copy
    and count would cover the screen. Rejected: the run channel as the source — rows an expand reveals
    land in `excludedIds`.

## Wire contract

```ts
// data-grid/server-spec.ts (additive)
export type GroupKey = string | number | boolean | null;
export type GroupPathSegment = { columnId: string; key: GroupKey };
export type ServerAggregate = { columnId: string; reducer: "sum" | "avg" | "min" | "max" | "count" };
export type ServerSpec = {
  sorts: readonly SortSpec[]; filters: readonly FilterNode[]; searchText: string;
  /** Column ids, outermost first. Omitted when the grid is not grouped. */
  groupBy?: readonly string[];
  /** One built-in reducer per column, from the grid's `aggregates` record. Omitted when empty. */
  aggregates?: readonly ServerAggregate[];
};

// data-grid-server/read-answer.ts: fields added to every request
export type ServerRowsRequest<TCursor = never> = {
  spec: ServerSpec; start: number; end: number; cursor: TCursor | undefined; signal: AbortSignal;
  /** The group whose children this request reads, outermost first; `[]` for the top level. */
  groupPath: readonly GroupPathSegment[];
  /** `"groups"` while `groupPath` is shorter than `spec.groupBy`, else `"rows"`. `"rowChildren"` is reserved; the grid never sends it. */
  childKind: "groups" | "rows" | "rowChildren";
};
export type ServerGroupsAnswer = {
  /** At most `end - start` group rows of one level, in order from `start`. */
  groups: readonly ServerGroupRow[];
  /** Group rows under the parent. Required in the first answer of a level. */
  groupCount?: number;
  /** Top level: the row count of the result, required. */
  totalRowCount?: number;
  /** Top level: aggregates over the whole result, by requested column id. */
  totals?: Readonly<Record<string, unknown>>;
};
export type ServerGroupRow = {
  key: GroupKey;
  label?: string;
  /** Direct children; on the last level, result rows. */
  childCount: number;
  /** Result rows under this group; equals `childCount` on the last level. */
  totalRowCount: number;
  aggregates?: Readonly<Record<string, unknown>>;
};
// With `groupBy`, fetchRows resolves ServerRowsAnswer<TData> | ServerGroupsAnswer, picked by `childKind`.
```

For `groupBy: ["region"]`: the top level is `groupPath: []`, `childKind: "groups"`, answered with
`groups`, `groupCount`, `totalRowCount`, `totals`; the rows of EU are `groupPath: [{ columnId:
"region", key: "EU" }]`, `childKind: "rows"`, answered with `rows` and `totalRowCount`. An ungrouped
request carries `groupPath: []`, `childKind: "rows"`. Blocks align to `[k * blockSize, (k + 1) *
blockSize)` from a group's first child. The server filters rows before grouping, applies `groupPath`
as equality filters, and merges `null` and `""` into one empty group.

Built-in reducers, the same on server and client (`row-grouping-spec.md` decision 6 owns the client
alignment): `count` counts values other than `null`, `undefined`, `""`; `sum`, `avg`, `min`, `max`
use finite numbers only; no counted value gives `null` (`count` gives `0`).

### Server checks

Requests are untrusted input to the consumer's server, like the filter tree (`server-side.mdx:58-61`).
The server checks: `groupBy` names allowed columns, at most 4, no repeats; `childKind` agrees with
`groupPath` (`"groups"` shorter than `groupBy`, `"rows"` equal length, `"rowChildren"` refused);
`groupPath` columns follow `groupBy` in order; keys are `GroupKey`s of at most 1,024 characters;
`aggregates` names allowed columns, one each, closed reducers; keys and ids reach the query as
parameters. The server recipe and the ORM recipes mirror this, with a recipe test for both kinds.

### Bounds on untrusted answers

`readGroupsAnswer` (beside `readAnswer`) applies decision 8:

- The kind matches `childKind`; `groups` is cut to `end - start` with a dev warning.
- `key`: a string of at most 1,024 characters (`scroll-sequence.ts:9`), a finite number, a boolean,
  or `null`. A child list keeps `keyText → (block, raw key)`; a landing replaces the keys at the
  offsets it overwrites; an evicted block removes its keys.
- Counts are safe non-negative integers clamped to `MAX_ROW_COUNT`; the top level must carry
  `totalRowCount`; on the last level `childCount === totalRowCount`, except under `spec.pivot`, where
  it must be `0` (pivot spec). The view row count clamps to `MAX_ROW_COUNT`.
- `label` is cut to 1,024 characters. `aggregates` and `totals` read only requested ids
  (`Object.hasOwn`); a value is a finite number or `null`, else `null` with one dev warning per column.
- A leaf id starting with `__group:`, `__pinned-`, or `__lazy-unloaded-` fails its block.
- Newest wins for counts and totals; parent counts are not checked against child sums. A short block
  leaves the rest unloaded.

## First slice: engine

- **Child lists.** The top level and each open group own a child list `{ listId, groupId, path,
  childKind, childCount, blocks, pending, failed, keys }`. Blocks, pending writes, failures, and
  displaced rows are stored by offset inside the list. The layout lists the open lists in view order
  with their start rows; a view row resolves to `(list, offset)` by binary search.
- **Commit.** One commit per frame lays `data` and the view index out from the lists. A block that
  lands for list B before a toggle above B writes into B at B's new start.
- **Re-layouts.** A toggle, a restored expansion opening on landing, a move, and a list resize each
  run the same path: re-lay out, shift the anchors below by the offset, rebuild the row channel,
  invalidate the `rowId -> dataIndex` cache, and, when the change lies above the first rendered row,
  shift `scrollTop` by its height change, up or down, so the rows on screen stay in place. A landing or
  status change that changes no layout only patches its rows.
- **Edits.** `onDataChange` applies each operation to the list holding the row id, through a
  `rowId → (list, offset)` index updated per landed or evicted block and per closed list; offsets do
  not move on a re-layout. It covers edit, paste, fill, cut, undo, redo, rollback, `updateCells`.
- **Anchors in a closing list** (collapse, controlled `expanded`, count drop): the active cell moves to
  the group row; an edit session cancels; a range clips to the rows that stay, or becomes the group
  row; cut marks and flashes drop. No anchor update walks every view row or calls `toArray`.
- **Moves.** When decision 8 makes a group's old row a hole and that group is open, its list follows
  the group id to the new row in the same commit and keeps its blocks; one group id never owns two
  lists.
- **Counts.** A top-level `groupCount` change drops the top-level blocks only; open lists stay as
  restored expansions (blocks dropped, ids kept). A list's count change drops that list's blocks only.
  A `totalRowCount` change drops nothing. Flat mode's full wipe does not run.
- **Requests.** An expand reserves `childCount` skeleton rows and fetches that list's blocks in the
  rendered rows plus `overscan`. In-flight keys are `(listId, blockStart)`. At most 6 in flight; the
  rest queue, newest rendered rows first; a queued block that leaves the rendered rows plus `overscan`
  drops. A scroll aborts in-flight blocks that left them; a collapse aborts and dequeues its list; a
  spec change aborts all and empties the queue.
- **Stale blocks.** A stale block inside the rendered rows plus `overscan` refetches in place at once;
  outside, when it enters them. A dropped queued refetch keeps the mark.
- **Eviction.** A collapse drops the list. Scrolling, `refresh()`, and `evict` never evict the group
  row of an open list. At most `MAX_EXPANDED_GROUPS` (10,000) open lists; a further expand is refused
  with a dev warning and `labels.grouping.tooManyOpen`.
- **Expanded state.** `mode: "expanded"` normalizes to collapsed with one dev warning; `expandAll` is a
  no-op. An expanded id whose row is not loaded counts as collapsed until it loads.
- **Errors.** A failed block shows the error and a Retry button in its first skeleton row.
  `retry()` queues the failed blocks inside the rendered rows plus `overscan`; the others fetch when
  they scroll in.
- **Hook result.** `refresh()` refetches in place the blocks inside the rendered rows plus `overscan`,
  evicts other blocks except those holding an open list's group row, which stay and turn stale.
  `evict`, `getLoadedRanges`, `onLoaded`, and `unloadedCount` use view rows at call or landing time.
  `server.totals` is the newest top-level `totals` or `null`.

## Selection and row ids

- Group ids: `__group:` plus `encodeURIComponent(columnId)=encodeURIComponent(keyText)` per level,
  joined by `/`. Reserved row-id prefixes: `__group:`, `__pinned-`, `__lazy-unloaded-`. Every
  view-row reader moves to `viewEntryAt`.
- 2.0 type shape (also in `research/server-selection-spec.md`): `readSelectedRows` adds `groups: []`
  in both modes and `spec` in ids mode; `ids`, `excludedIds`, and `count` stay the same until step 8:

```ts
export type SelectedGroup = { groupId: string; path: readonly GroupPathSegment[]; checked: boolean };
export type DataGridSelectedRows =
  | { mode: "ids"; ids: readonly string[]; groups: readonly SelectedGroup[]; excludedIds: readonly []; count: number; spec: ServerSpec }
  | { mode: "allMatching"; ids: readonly string[]; groups: readonly SelectedGroup[]; excludedIds: readonly string[]; count: number | null; spec: ServerSpec };
// `ids` in allMatching and `groups` both stay [] until group checks ship.
```

- Step 8 rule, first match wins: id in `ids`; id in `excludedIds`; the deepest `groups` entry whose `path`
  prefixes the row's group path; else `mode === "allMatching"`. `readSelectedRows` returns the rule
  and never infers exclusions from unchecked rows.
- Channel writes follow the writer map in `server-selection-spec.md` ("Grouped selection"), skipping
  holes and group rows; group rows have no checkbox.
- Bounds: `ids` plus `excludedIds` ≤ 100,000 (ids past it drop with a warning; an exclusion overflow
  clears all matching), `groups` ≤ 1,000. A filter, search, or `groupBy` change clears all matching and
  group entries (`create-store.ts:1087`). Row operations on checked rows no-op in all matching.
- Bulk action: the consumer sends `selected.spec`, `ids`, `excludedIds`, `groups`; the server runs the
  "Server checks", checks each `groups[].path` against `groupBy`, ignores `groupId`, bounds lists and
  body size, then applies the rule.

## Other behavior (first slice)

- **Sort and filter.** `groupMode="server"` requires `sortMode` and `filterMode` `"server"` (dev
  error otherwise). A sort on the `groupBy` column orders groups; other sorts order rows in a group;
  without one, key order ascending, empty key last. Filters run before grouping. `groupMode="client"`
  under a server mode ignores `groupBy` with one warning. Wherever grouping is unavailable, the header
  and context menus hide "Group by column" and "Ungroup".
- **100k rows.** `data` has view-row-count length; loaded group rows are negative view-index entries;
  the rest are holes. Group rows use the base `rowHeight`, so compression applies unchanged once built.
  Targets (`server-groups.perf.test.ts`, budgets once measured) at 100k view rows, 10k groups, 1,000
  open: a re-layout ≤ 16 ms; a landing of 50 or a status change without re-layout ≤ 4 ms; closing a list with 5,000
  loaded rows ≤ 8 ms; `readGroupsAnswer` of 50 groups ≤ 0.5 ms; ≤ 6 requests per scroll frame.
- **Totals.** `server.totals` feeds gap H's provided aggregates in a pinned bottom band; pinned
  aggregates under server grouping read it, never loaded rows. Group rows never enter a band.
- **Accessibility.** `role="treegrid"`; `aria-level`, `aria-setsize` (the list's server count), and
  `aria-posinset` (offset + 1) on every row, skeletons included; `aria-expanded` and `aria-busy` on
  group rows. One live-region text per toggle ("<label> expanded, <n> rows", "<label> collapsed"),
  plus "<label> failed to load". `announceResults` counts `totalRowCount`. Tree keys on the group
  column; Retry is a labelled button reachable by Enter on its row.
- **Client counterpart.** `groupBy`, `defaultGroupBy`, `onGroupByChange`, `groupColumn`,
  `aggregates`, `expanded`, `defaultExpanded`, `onExpandedChange` are the same props. The scroll hook
  takes `groupBy` and `aggregates` through its spec pair and its own `expanded` pair, and its
  `gridProps` carries all of them with `groupMode` and the plugin, so `<DataGrid {...server.gridProps}
  columns={columns} />` stays the common case. A function reducer drops from the request with a warning.
- **URL and views.** `useDataGridUrlState` adds a `group` param (encoded ids, at most 4 raw segments,
  validated against live columns). `expanded` stays out of the URL and views in the first slice.
  `useDataGridViews` persists `groupBy` later (hook point).
- **Writes.** A save that changes a leaf's `groupBy` value refreshes the affected lists in place;
  a refusal reverts. Row operations no-op while grouped (dev warning); `updateCells` writes into its
  list and leaves totals until `refresh()`. `readOnly` blocks every write path; toggles stay.
- **Export and print.** Outside pivot mode both cover loaded leaf rows through `viewEntryAt`, without
  group rows or holes (gap I). In pivot mode the pivot rows export (pivot spec).

## Later slices: constraints

Each later slice decides its mechanics in its own spec at start. It must respect:

- **Multi-level groups:** child lists nest; collapse aborts descendant lists; the request, key, count,
  and selection rules above hold per level; the 16 ms re-layout target holds.
- **Pages mode:** pages over top-level groups only; the strip of decision 9 is removed in the same
  change; `aria-setsize` stays result-wide.
- **Server tree:** uses the reserved `childKind: "rowChildren"` with a new `parentRowId` field and a
  `getChildCount` option; never mixes with grouping.
- **Group checks:** fill `groups` with the rule above; the header and count keep reading the rule.
- **`expanded` in URL and views:** opt-in only (ids hold data values), 256 ids, 16,384 characters.
- **Views `groupBy`:** `useDataGridViews` persists it, validated against the registry like sorts.

## Feasibility verdict

Feasible after #68 and #71 land. Steps 1-3 ship in 2.0 regardless; the first slice (steps 4-11)
ships in 2.0 only if #71 merges before the freeze, else in 2.1 with no break. Child-list storage,
re-layouts with anchors, and the rule-based selection are the risky parts.

## Minimal scope proposal

| Item | 2.0 | Later |
|---|---|---|
| Types, `childKind` union, `serverSpecKey` replacer (step 1) | yes | |
| `SelectedRows` type shape, behavior unchanged (step 2) | yes | |
| Rule-based selection under `groupMode="server"` (step 8) | first slice (2.0 if #71 merges) | group checks |
| `readGroupsAnswer`, pages and scroll strips (step 3) | yes | |
| First slice (steps 4-11) | if #71 is merged | |
| Multi-level, pages mode, server tree, group checks, `expanded` URL, views `groupBy` | | yes |

## Risks

- Child-list storage replaces absolute-index storage; a toggle between landing and commit and an edit
  before a landing in another list get their own tests.
- Restored expansions and moves above the view shift positions; the `scrollTop` fix needs a browser
  test with a fast scrollbar drag.
- `data` of view-row-count length costs at 10M what flat mode costs; targets are set at 100k only.
- The key, label, and reducer changes alter #71's client behavior and the shipped pinned-rows totals.
- Against the unreleased shape, `SelectedRows` gains `groups` in both modes and `spec` in ids mode,
  and `ids` in all matching widens from `readonly []`; behavior does not change.

## Test plan

- `read-groups-answer.test.ts`: wrong kind; long and object keys; bad counts; missing top-level count;
  repeat inside an answer; same raw key in an older block (only that row clears, block stale); a
  second conflict on the same key fails the newer block (no loop);
  `1`/`"1"` and `null`/`""` fail the newer block; pivot last-level exception; `__proto__` and
  non-number aggregates; reserved-prefix leaf ids.
- `server-spec.test.ts`: ungrouped key equals 1.x; empty `groupBy` drops; reset key ignores
  `aggregates`. `aggregate-reducers.test.ts`: the reducer definitions; pinned totals follow.
  `server-checks.test.ts`: both kinds pass; mismatched kind, `"rowChildren"`, long key fail.
- `use-data-grid-server-rows.page-reset.test.tsx` (extend, step 3): pages mode and scroll mode strip
  and warn; step 11 inverts the scroll case for `groupBy` and `aggregates`.
- `use-data-grid-server-rows.groups.scroll.test.tsx` (server path): expand and collapse; toggle
  between landing and commit; an edit, undo, redo, and rollback survive a landing in another list;
  moves keep lists; restored expansions; anchors in a closing list (active cell to the group row,
  edit session cancels, range clips, cut marks and flashes drop); a status change files a new layout;
  `gridProps.sortMode` and `gridProps.filterMode` are `"server"`; count changes per level; request cap, queue drop, abort, dedupe; stale blocks and
  `refresh()`; an `aggregates` change aborts and requeues; eviction keeps open group rows; hook ranges
  in view rows; spec change; `mode: "expanded"`; open-list cap; failed blocks and `retry()`;
  StrictMode; unmount; a `group` URL param; group ids as row ids; live-region texts; an off-by-one
  paging server stops after one refetch.
- `use-data-grid-server-rows.groups-selection.test.tsx`: expand after `selectAllMatching()`; each
  gesture; overflows; marker, header tri-state, copy, count, and controlled `selection` agree with the
  rule; no announcement or `onSelectionChange` from a rebuild.
- `use-data-grid-server-rows.groups-save.test.tsx`: `groupBy` save refresh; rollback; row operations
  no-op; `updateCells`; a `readOnly` grid refuses every grouped write path and still toggles.
- `group-mode.test.tsx`: missing modes or getter; client grouping under server modes; menu items
  hidden; `undefined` from the getter keeps the layout. Type test: consumer `DataGridPlugin` rejects
  `groupLayout`.
- `tests/parity/grouping.parity.test.tsx` (L, PC, C, API): ids, labels ("Open", not `s_open`), ARIA,
  copy text. Step 2: a type test and a regression run of the existing selection tests; only the
  shape assertions gain `groups` and `spec` (`store/server-selection.test.tsx:240,247,259`: line 240 gains `groups` and `spec`, lines 247 and 259 gain `groups`). Step 8: the writer tests of `server-selection-spec.md`
  ("Grouped selection"). `group-param.test.ts`; export and print tests (extend).
- Browser `server-groups.browser.test.tsx`: keys (LTR, RTL); setsize and posinset on skeletons; Retry
  by Enter; axe; moves, restored expansions, and a controlled collapse above the view keep the
  rendered rows in place.
- Perf `server-groups.perf.test.ts`: the targets above.

## Parity-matrix impact

| Row | L | PC | PS | Z | C | SS | FS | API |
|---|---|---|---|---|---|---|---|---|
| `grouping` | S | S | G `G2` "Pages mode strips `groupBy`." | S | S | S | S | S |
| `tree-data` (new, with #68) | S | S | G `G3`* | G `G3`* | S | G `G3`* | G `G3`* | S |
| `row-check`, `row-ids`, `counts`, `row-ops`, `streaming`, `error-state`, `loading`, `announce`, `server-rows`, `url-state` | = | = | = | S, evidence added | = | = | = | = |
| `export` | = | = | = | G I, note added | = | = | = | = |
| `print`, `pinned-rows` | = | = | = | = | = | = | = | = |

- `grouping` options: `groupBy`, `defaultGroupBy`, `onGroupByChange`, `groupColumn`, `groupMode`,
  `aggregates`, `expanded`, `defaultExpanded`, `onExpandedChange`. L, PC, C, API cite the grouping
  parity test; Z, SS, FS cite the groups scroll test (it asserts `sortMode` and `filterMode`) and
  `group-mode.test.tsx`; the row `note` says SS and FS group only through
  the scroll hook (supported cells render no note, `verify-parity.mjs:103`). PS track `G2`.
- `tree-data` options: `getParentId`, `treeColumn`, `expanded`, `defaultExpanded`, `onExpandedChange`
  (#68 adds the pair, `tree-data-spec.md:64-66`; `grouping` lists it too); L, PC, C, API cite
  `tests/parity/tree-data.parity.test.tsx`; *the `G3` cells note "Server tree data follows."
- Z evidence: `row-check` → groups-selection test; `row-ops`, `streaming` → groups-save test; the rest
  → groups scroll test (all run scroll mode). `group-param.test.ts` joins `url-state` L. `export` Z
  note: "outside pivot mode, group rows are excluded".

## Steps

1. Glossary: new terms (group row, group path, child list, grand total, reserved row-id prefixes)
   and amended "block", "spec", "request, answer", "checked row", "result count", mirrored in
   `terms.mdx` with `<NewBadge />`. Additive types (with pivot spec step 1, which adds `pivot`);
   `serverSpecKey` replacer; type tests; CHANGELOG
   `### Added`; `data-grid` and `data-grid-server` payloads.
2. `DataGridSelectedRows` type shape (`readSelectedRows` adds `groups: []` and ids-mode `spec`; every
   writer unchanged; type test, selection-test regression, the `server-selection.test.tsx:240,247,259`
   assertion); edit the existing Unreleased CHANGELOG entries (the shape in the selection entry, the
   `spec` note in the `checkedRowsLifetime` entry), no new **Breaking** line (the shape is unreleased);
   same commit: `lazy-loading.mdx`, `recipes/data-fetching/server-side.mdx`, `selection-keyboard.mdx`
   (sections already new since v1.3.0), the
   server selection demo, `skills/gridcn-data-source/SKILL.md`; `data-grid` payload (and the demo's).
3. `readGroupsAnswer`; pages and scroll strips with the warning and their test in `page-reset`;
   "Server checks" in the recipe with `<NewBadge />`; CHANGELOG; `data-grid-server` payload;
   `registry:verify`; `test:e2e-install`.
4. After #71: reader migration to `viewEntryAt`.
5. Core `groupMode` (added to the `grouping` row's options in the same commit), the data-keyed getter,
   core-built ids, dev errors, menu hiding.
6. Child lists, commit, re-layout path, edit index, anchors, moves, counts.
7. Requests, cap, abort, stale blocks, eviction, errors, status in the layout, hook result.
8. Rule-based selection under `groupMode="server"`: the writer map and its tests
   (`server-selection-spec.md`, "Grouped selection"), channel cache.
9. Spec and `aggregates` change rules; restored expansions and the `scrollTop` fix.
10. Treegrid ARIA, announcements, totals, write rules.
11. URL `group` param; demo `data-grid-server-grouping-demo` and its `components/registry-examples.tsx`
    entry; docs (new page; `<NewBadge />` in `server-side.mdx`, `lazy-loading.mdx`,
    `accessibility.mdx`, `addons/url-state.mdx`, `addons/pinned-rows.mdx`; `addons/views.mdx` is the
    views block's); parity rows; CHANGELOG; payloads; `test:e2e-install`; budgets measured; remove
    the scroll strip of `groupBy` and `aggregates` and invert its test (`pivot` keeps its strip until
    the pivot slice).

## Open questions

1. Ship the first slice in 2.0.0? Recommendation: steps 1-3 regardless; the slice only if #71 merges
   before the freeze.
2. Keep expanded groups across a spec change? Recommendation: yes; ids are value-derived.
3. `expanded` in URL or views by default? Recommendation: no; group ids carry data values.
