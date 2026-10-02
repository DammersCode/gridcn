# Spec: tree data (W6-12, FEAT-9)

## Goal

Rows form a hierarchy through `getParentId(row)`. The grid shows parents with an indent and an
expand toggle in one column, sorts siblings among themselves, keeps the ancestors of filter
matches, and exposes the structure as an ARIA treegrid. Every view row stays a data row, so
editing, selection, clipboard, and fill keep their meaning.

Written against the API after Wave 5: `CellRef`, controlled-state echo rules (W5-11), the two-phase
sync (W5-12), commands and plugins.

## Current state (verified)

- `viewIndex` is a flat `number[]` of data indices built by `computeViewIndex`
  (`store/compute.ts:532-547`) → `buildViewIndex` (`sort-filter/build-view-index.ts:81-168`):
  filter, then a stable multi-column sort over all rows.
- Streaming patches use `incrementalViewIndex` (`store/compute.ts:569-596`), which re-inserts
  touched rows by binary search into one flat order.
- Every view rebuild remaps the cursor, the edit session, and the row channel
  (`store/create-store.ts:136-190`: `remapEditing`, `clampCursor`, `remapRowChannel`).
- `reorderRows` no-ops while a sort or filter owns the order (`store/data-write.ts:627-636`).
- The root is `role="grid"` (`root.tsx:491`); two places find the grid by that role:
  `keyboard/use-data-grid-global-shortcuts.ts:73` and `data-grid-context-menu/context-menu.tsx:102`.
- Rows render `aria-rowindex` only (`row.tsx:94`); no `aria-level`, `aria-expanded`,
  `aria-setsize`, or `aria-posinset` anywhere.

## Decisions

1. **Tree is a view transform in core.** With `getParentId` set, the view build becomes: filter →
   add ancestors of matches → sort each sibling list → depth-first flatten that skips collapsed
   subtrees. `viewIndex` stays data indices. Rejected: an add-on that flattens `data` before the
   grid sees it — every expand would replace `data`, re-running the whole sync and losing the
   streaming fast path.
2. **Expanded state is "mode plus exceptions".** `ExpandedState = { mode: "collapsed" | "expanded";
   ids: readonly string[] }` lists the parents that differ from `mode`. Expand all and collapse all
   are O(1) and the emitted value stays small. Rejected: a plain list of expanded ids — expand-all on
   a 100k-parent tree emits 100k ids.
3. **Controlled expanded state is gesture-first** (the W5 rule for `selection`): a toggle applies at
   once and emits; a changed `expanded` prop that differs structurally overrides; the in-flight echo
   queue drops echoes. Rejected: strict control — a toggle would wait a render for the consumer.
4. **Filters keep ancestors and auto-reveal.** A match keeps its whole ancestor path, and while any
   filter is active those ancestors render expanded without changing `expanded`. When the filters
   clear, the user's expanded state applies again. Rejected: respect collapse under a filter — matches
   inside collapsed parents would be invisible and the filter would look empty.
5. **Malformed hierarchies degrade to roots.** A parent id that resolves to no row, a self-parent, or
   a cycle makes the affected row a root, with one dev warning per grid. The walk is iterative.
   Rejected: throw — server data shapes the hierarchy, and one bad row must not take the grid down.
6. **Expand and collapse keys live on the tree column.** In the tree column cell, ArrowRight on a
   collapsed parent expands it; ArrowLeft on an expanded parent collapses it; ArrowLeft on any other
   row moves to its parent row (same column). Everywhere else the arrows move the cursor. The rule
   runs on the logical `moveRight`/`moveLeft` actions, so RTL mirrors it. Rejected: new bindings
   such as `alt+Arrow` — those are the retain-move defaults.

## API

```ts
// types.ts
export type ExpandedState = { mode: "collapsed" | "expanded"; ids: readonly string[] };

// DataGridSyncProps
getParentId?: (row: TData, dataRowIndex: number) => string | null | undefined; // recompute phase; null/undefined/"" = root
treeColumn?: string;                    // column id with indent + toggle; default: first visible column (config phase)
expanded?: ExpandedState;               // recompute phase
defaultExpanded?: ExpandedState;        // seed; default { mode: "collapsed", ids: [] }
onExpandedChange?: (next: ExpandedState) => void;

// DataGridActions
setExpanded(next: ExpandedState): void;
toggleExpanded(rowId: string): void;
expandAll(): void;                      // { mode: "expanded", ids: [] }
collapseAll(): void;
reveal(rowId: string): void;            // expands every ancestor so the row enters the view

// hooks (consumer barrel)
useDataGridRowTreeMeta(viewRowIndex): { level: number; expanded: boolean | null; posInSet: number; setSize: number } | null;
```

Store state: `treeIndex` (data space: `parentOf`, `depth`, `childCount` as `Int32Array`, rebuilt
when `data`, `getRowId`, or `getParentId` change) and `viewTree` (view space: `level`, `posInSet`,
`setSize` as `Int32Array`, built with `viewIndex`). Both are `null` without `getParentId`.

## Behavior

- **Rendering.** `DataGridRow` reads `useDataGridRowTreeMeta` (one subscription per row, like
  `useDataGridRowCellState`) and passes `treeLevel`/`expanded` only to the tree column's cell. That
  cell renders an indent of `min(level − 1, 31) × 1rem` and a toggle button (parents only). Other
  cells get no new props.
- **Selection and CellRef.** Collapsing removes descendants from the view; per W5-11 they leave the
  row channel and ranges collapse when their records change. Collapsing a parent whose descendant
  holds the cursor moves the cursor to that parent (same column), so focus never lands on an
  unrelated row. `api.scrollTo(ref)` on a hidden row no-ops with the existing dev warning; `reveal`
  is the documented way in.
- **Sort.** Sorts order siblings; the hierarchy holds. Header sort and `setSorts` work unchanged.
- **Filter and search.** Decision 4. Quick search never filters, so it finds only visible rows;
  `reveal` brings a match into view.
- **Editing.** An edit whose row collapses away cancels (W4-01 rule). A write to the column that
  feeds `getParentId` moves the row to its new parent on the next view rebuild, exactly when a write
  to a sort column re-sorts today.
- **Streaming.** `updateCells` `"defer"` writes in place. `"immediate"` falls back to the full
  rebuild in tree mode (`incrementalViewIndex` returns `null` with bail reason `"tree"`). A touched
  row whose parent id changed rebuilds `treeIndex`; otherwise it stays.
- **Row ops.** `insertRow`/`duplicateRows` place the new row by its parent id (`createRow` and
  `duplicateRow` set it). `reorderRows` no-ops in tree mode with a dev warning, like an active sort.
  `deleteRows` deletes exactly the selected records; their children become roots (decision 5).
- **Clipboard, fill, readOnly.** Unchanged: they work on view rows in view order. Collapsed rows are
  not copied or filled.
- **Commands and plugins.** `toggleExpanded`, `expandAll`, `collapseAll`, `reveal` are plain actions;
  a consumer binds them through `commands`. Plugins read `viewTree` through `DataGridReadState`.
- **Lazy loading.** Tree mode with lazy holes is not supported: holes render as roots with a dev
  error. Server-side child loading is out of scope.

## Security

- No recursion: depth, cycle detection (visited marks), and flattening are iterative, so a
  100k-deep chain from server data cannot overflow the stack.
- Indent is capped at 31 levels; deeper rows keep their true `aria-level`.
- A controlled `ExpandedState` from a URL or storage is normalized: unknown ids drop, `ids` is
  deduplicated and capped at the parent count.

## Performance

- `treeIndex` build: `n` `getParentId` calls plus id lookups through the row-index cache, O(n).
- View build: sort per sibling list, O(n log n) total; flatten O(n). Sorted child lists are cached on
  `(data, sortState, filterState, treeIndex)` identity, so a toggle only re-flattens.
- Budgets at 100k rows, 10k parents (new `sort-filter/tree-view-perf.test.ts`, measured baseline +
  20 %): full build with one sort ≤ flat `buildViewIndex` × 1.3; expand or collapse ≤ 8 ms;
  `expandAll` ≤ 12 ms.
- Memory: six `Int32Array`s of length n (≈ 2.4 MB at 100k).
- No per-cell work: only the tree column cell receives tree props.

## Accessibility

- The root becomes `role="treegrid"`. `use-data-grid-global-shortcuts.ts:73` and
  `context-menu.tsx:102` switch from `[role="grid"]` to the grid's instance attribute
  (`gridAttrSelector("instance")`), so both roles match.
- Each row: `aria-level`, `aria-setsize`, `aria-posinset` (required because only the window is in
  the DOM), and `aria-expanded` on parents.
- The toggle is a `button` with `tabIndex={-1}` and a label from `labels.tree.expand` /
  `labels.tree.collapse`, so a screen reader's virtual cursor can activate it.
- Keys per decision 6 are listed in the keybindings dialog under navigation.

## Files to add or change

- Add `data-grid/store/tree-index.ts` (build, cycle and orphan handling) and
  `data-grid/sort-filter/build-tree-view.ts` (filter with ancestors, sibling sort, flatten).
- `types.ts`, `store/types.ts`, `store/create-store.ts` (state, actions, `_syncProps`, echo queue,
  cursor rule on collapse), `store/compute.ts` (`computeViewIndex` dispatch,
  `incrementalViewIndex` bail), `store/hooks.ts` (`useDataGridRowTreeMeta`).
- `row.tsx`, `cell.tsx` (tree column only), new `rows/tree-toggle.tsx`, `root.tsx` (role),
  `interaction/use-grid-interaction.ts` (decision 6), `labels.ts` (`tree` group).
- `keyboard/use-data-grid-global-shortcuts.ts`, `data-grid-context-menu/context-menu.tsx`: selector.
- `data-grid-keybindings`: list the tree keys.

## Docs, registry, CHANGELOG

- New page `content/docs/tree-data.mdx` and example `data-grid-tree-data-demo`;
  `accessibility.mdx` (treegrid), `selection-keyboard.mdx` (keys), `row-operations.mdx` (reorder
  off, delete leaves roots).
- CHANGELOG `### Added`. No breaking change for grids without `getParentId`.
- Payloads: `data-grid`, `data-grid-context-menu`, `data-grid-keybindings`; `test:e2e-install`.

## Test plan

- Unit `tree-index.test.ts`: roots, nesting, orphans, self-parent, 2- and 3-cycles, 100k-deep chain
  without stack overflow, parent change on a stream tick.
- Unit `build-tree-view.test.ts`: sibling sort with multi-sort and empty-last; filter keeps ancestors
  and auto-reveals; collapsed subtrees skipped; `ExpandedState` modes; posinset/setsize.
- Unit `tree-data.test.tsx`: controlled echo (no apply, no emit); inline literal equal to current
  state applies nothing; toggle emits once; collapse moves the cursor to the parent; row channel
  drops hidden rows; `reorderRows` no-op; delete leaves children as roots; `reveal`; read-only grid
  still toggles (view state, not data).
- Browser: arrow keys on the tree column (LTR and RTL); toggle click; axe clean on the treegrid;
  global shortcuts and context menu still find the grid.
- Perf: the budgets above.

## Dependencies

- W5-07 (store split), W5-08 (`CellRef`), W4-01 (editor bound to its row), W5-11 (echo queue and
  identity remap), W5-12 (sync phases).
- W6-14 reuses the expanded-state plumbing; W6-15 reuses `viewTree`, the treegrid ARIA, the keys,
  and the toggle.

## Open product questions

1. Does a filter match on a parent also show its non-matching children? Recommendation: no; a filter
   shows matches and their paths only. A `includeDescendants` filter option can follow if users ask.
2. Does deleting a parent delete its descendants? Recommendation: no; delete removes exactly the
   selected records, and children become roots. Silent cascading deletes lose data the user did not
   select.
3. Should tree mode support lazy (server-side) children? Recommendation: a separate item after this
   one, with a `hasChildren` hint and a per-parent fetch.
