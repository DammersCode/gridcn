# API Gap Sweep — Full Registry Audit (2026-09-24)

Method: a fleet of read-only advisors audited every core feature and all 12 add-ons with the
plan-015 gap taxonomy (the evaluation that produced the `data-grid-lazy` API of PR #44):
(a) missing customization surface, (b) doc lie (docs promise what the code lacks),
(c) opaque state a consumer demonstrably needs, (d) missing lifecycle primitives
(reset/clear, missing callback counterpart), (e) type-safety hole, (f) cross-feature
friction, (g) DX friction. `data-grid-lazy`'s own API was already audited in plan 015 and is
not re-audited here; its cross-feature combinations ARE in scope.

Evidence format: `file:line` verified against the tree at audit time (2026-09-24). Line
numbers drift — re-verify when working a gap.

Weighting:
- **P1** — blocks real use / corrupts data / accessibility violation. Work first.
- **P2** — most consumers hit it (customization, doc lies on the documented surface).
- **P3** — polish, discoverability, hardening.
- **Size** — **S** = doc/JSDoc fix or one-line guard (+ test); **M** = additive API
  (option/callback/method) + tests; **L** = cross-cutting behavior change or new primitive.

Duplicates: `PIN-G1` ≡ `XFE-G2` (same aggregate-over-sparse-lazy issue, reported from both
sides) — work once. `FIL-G3` is the lazy side of fill. `COL-G2` is the lazy side of
per-row callbacks.

---

## Master gap list (work list)

Sorted by priority, then area. `UX`/`DX` = where the impact lands (X = impact present).

### P1

| ID | Area | Gap | Size | UX | DX |
|---|---|---|---|----|----|
| COL-G1 | Columns | def-level `hidden: true` is permanent: `setColumnHidden(id,false)` and the columns menu cannot re-show it; both lie about it | M | X | X |
| COL-G2 | Columns × lazy | Lazy hole rows invoke consumer callbacks with `row: undefined`; the documented `readOnly: (row) => row.locked` pattern throws while scrolling | S | X | X |
| ROW-G1 | Row ops | Insert/delete/duplicate under an active sort or filter leave the view stale with no flag (wrong rows shown) | M | X | X |
| ROW-G3 | Row ops | Insert/delete/duplicate never rebuild `viewIndex` even unsorted; the controlled-echo path masks the repair (same root as ROW-G1) | M | X | X |
| EDT-G1 | Streaming × editing | `reorder: "immediate"` streaming moves the row out from under an open editor; the edit lands on a different record (docs promise the opposite) | S | X | X |
| IO-G1 | IO × lazy | Export walks lazy holes: `accessorFn(undefined)` crash or thousands of blank rows, silently | M | X | X |
| A11-G1 | Accessibility | `aria-sort` (and the visual indicator) gated on `headerClickBehavior`; the default grid announces no sort state to screen readers | S | X | — |
| TYP-G1 | Type surface | `BindingChips`/`bindingTokens` missing from the keybindings barrel; the docs teach the internal path | S | — | X |

### P2

| ID | Area | Gap | Size | UX | DX |
|---|---|---|---|----|----|
| COL-G3 | Columns × context-menu | Menu autosize bypasses the commit point (`onColumnLayoutChange` doesn't fire) and the resize gating; docs disagree with each other | S | X | X |
| COL-G4 | Columns | No `resetColumnWidth`/`resetColumnLayout` (reset = full remount); programmatic width writes skip min/max clamping | M | X | X |
| COL-G5 | Cell types | `cellTypes` registry seam is fully type-erased (`AnyCellType`); the erasure is not documented at consumer level | S | X | X |
| EDT-G2 | Selection × editing | A single-cell edit commit collapses the entire selection model (range + channels wiped), undocumented | L | X | X |
| EDT-G3 | Editing | Async-commit `pending` state is unreadable outside the editor (no store field, no hook) | S | — | X |
| ROW-G2 | Row ops | Docs show `duplicateRow: (row) => TData`; the real signature takes `(row, index)` | S | — | X |
| ROW-G4 | Row ops | Row ops run with an open editor (only `reorderRows` guards); programmatic ops shift rows under the editor | S | X | X |
| ROW-G5 | Row ops | Keyboard `duplicateRow` duplicates only the active row; the menu item with the same shortcut label duplicates the whole selection | S | X | X |
| SRF-G1 | Sorting | No per-column sort comparator; customization only at cell-type granularity; locale hardcoded | M | — | X |
| SRF-G2 | Filtering | Filter operator set closed; matching runs on text only; custom numeric types get text-only operators in the menu | L | X | X |
| SRF-G4 | Sorting/filtering | Sort-list/filter-menu manage only visible columns (doc claims the opposite); filters on hidden columns orphan as raw-id rows | M | X | X |
| STR-G1 | Streaming | `updateCells` returns `void`: unknown ids, rejected cells, superseded batches all silent | M | — | X |
| STR-G2 | Streaming × validation | Async `validate` holds and silently drops/supersedes `updateCells` batches; contract undocumented | S | X | X |
| CLP-G1 | Clipboard | Doc lie: `processPaste` signature omits the `target: CellCoord` argument | S | — | X |
| CLP-G2 | Clipboard | 200k-cell copy/paste caps are undocumented; copy truncation is unobservable (not even dev-warned) | S | X | X |
| GSK-G1 | Global shortcuts | Global-shortcut action set is a closed two-action union (`undo`/`redo`); no other action can be registered | M | X | X |
| STT-G1 | State surface | `searchText`/`onSearchTextChange` controlled pair absent from `events-state.mdx` | S | — | X |
| PAG-G1 | Pagination | Server mode clamps the displayed page but never reconciles the consumer's page state | M | X | X |
| PIN-G1 | Pinned-rows × lazy | `useDataGridAggregate` on a lazy (sparse) grid crashes or silently aggregates a partial range (= XFE-G2) | S | X | X |
| PIN-G2 | Pinned-rows × pagination | Pinned aggregates silently become page-local under pagination; combination undocumented | S | X | X |
| TOL-G1 | Toolbar | Per-column-type operator set hardcoded; no extension seam (custom numeric types get text-only operators) | M | X | X |
| CTX-G1 | Context menu | No way to customize the menu item set (both menus are hardcoded JSX) | M | X | — |
| FIL-G1 | Fill | Series detection hardcoded (3 patterns, no dates); `onFill` can veto but cannot rewrite values | M | X | X |
| FIL-G2 | Fill | `fill.mdx` misdescribes `onFill`'s `values` (source range vs the computed fill pattern) | S | — | X |
| FIL-G3 | Fill × lazy | Fill over lazy rows silently skips unloaded cells (partial fill, selection looks full) | S | X | X |
| HIS-G1 | History × lazy | No composition story; undo degrades unsafely on a sparse array (hole-tolerant `getRowId` required, evicted rows = silent no-ops) | S | X | X |
| HIS-G2 | History | No way to tie the stack to dataset identity; undo after a dataset swap resurrects stale rows | M | X | X |
| KEY-G1 | Keybindings | Keymap is a closed action set, but the add-on's docs/JSDoc promise "consumer-added actions" | S | — | X |
| KEY-G2 | Keybindings | The shortcuts dialog advertises undo/redo/fill bindings that no-op when the add-ons are absent | M | X | X |
| IO-G2 | IO | Import rejects cells silently (replaced by `clearValue()`); no per-cell rejection report | M | X | X |
| IO-G5 | IO | Stale sheet re-parse overwrites a newly chosen file's preview (generation guard incomplete) | S | X | X |
| IO-G6 | IO | `onImport` is fire-and-forget; async merge failures are invisible (dialog already closed) | M | X | X |
| URL-G1 | URL-state | No URL→store direction after mount; external URL writes (back/forward, deep-link into mounted grid) are dead | M | X | X |
| URL-G2 | URL-state × pagination | `pageSizeOptions` constrains only URL parsing; the bar's select diverges (three different values possible) | S | X | X |
| PRE-G1 | Presence | Snapshot-only writes: no `remove`/`clear`/TTL; a dropped peer paints a permanent ghost | M | X | X |
| XFE-G1 | URL-state × lazy | `DataGridUrlState` silently re-sorts/re-filters a lazily fetched grid (violates the lazy spec pattern); only a dev warn | S | X | X |
| XFE-G3 | Context-menu/IO × selection | Both re-derive the selected-row set from core selection internals with no shared core selector (silent mis-target risk) | M | X | X |
| XFE-G4 | Presence × streaming | View-space presence highlights go stale under `reorder: "immediate"` streaming | S | X | — |
| TYP-G2 | Type surface | 11 of 13 blocks have zero type tests; the lazy PR #44 API (reset/evict/getLoadedRanges/onLoaded/maxFetchRows) has no type coverage | M | — | X |
| TYP-G3 | Type surface | `createFilterMatcher` documented in the API reference but absent from the public barrel | S | — | X |

### P3

| ID | Area | Gap | Size | UX | DX |
|---|---|---|---|----|----|
| COL-G6 | Columns | Plain `ColumnDef<TData,TValue>` never cross-checks `accessorKey` against `TValue` (only `defineColumns`) | S | — | X |
| COL-G7 | Cell types | `any` third type param on `CellRenderProps`/`CellEditorProps`/`CellClassNameCtx` (deliberate; cast convention undocumented) | S | — | X |
| COL-G8 | Cell types | `CellSpan` + `displayText` off the public barrel; docs point at the internal path | S | — | X |
| COL-G9 | Columns | Hardcoded layout defaults: 150px column width, 36px header height, column-window overscan — undiscoverable, unexposed | M | X | X |
| COL-G10 | Cell types | Doc inconsistencies: Tab-during-edit contract vs built-in editors; `data-type` missing on untyped columns; number editor seeds without `decimals` | S | X | X |
| EDT-G4 | Editing | The edit stash is re-seeded on every render (wider than the documented seed-at-open contract) | S | X | X |
| EDT-G5 | Editing | Space is a fourth, undocumented edit trigger (and it is not type-to-replace) | S | X | X |
| SRF-G3 | Search | Quick search hardcoded: 200ms debounce, 1000-match cap, substring, visible columns only (only `debounceMs` worth exposing) | S | X | X |
| GSK-G2 | Global shortcuts | Flipping `undo`/`redo` props drops multi-grid ownership until the next focusin | S | X | — |
| I18-G1 | i18n | Date editor placeholder `yyyy-mm-dd` bypasses `labels` (i18n.mdx claims every string is overridable) | S | X | X |
| I18-G2 | i18n | "Consumer-added GridAction" labels advertised but untypeable (closed type alias, no merging seam) | S | — | X |
| A11-G2 | Accessibility | `accessibility.mdx` omits the implemented `aria-sort` and `aria-readonly` | S | — | — |
| STR-G3 | Streaming | `updateCells` on a readOnly grid is a silent no-op, undocumented | S | — | X |
| STR-G4 | Streaming | No observable in-flight streaming state / no abort for held batches (SKIP for now) | S | — | X |
| STR-G5 | Streaming | `CellPatch` column ids and values are untyped strings; typos compile, then skip silently | M | — | X |
| CLP-G3 | Clipboard | Programmatic `copy()`/`cut()` fire-and-forget with a silent TSV-only fallback (lossless payload dropped) | S | X | X |
| CLP-G4 | Clipboard | Paste skips readOnly cells silently; docs only mention validation rejection | S | — | X |
| PAG-G2 | Pagination | Client mode: page size is a one-shot seed with no `onPageSizeChange` (asymmetric with server mode) | S | — | X |
| PAG-G3 | Pagination | Server mode: page-size select silently no-ops when `onPageSizeChange` is omitted | S | X | X |
| PAG-G4 | Pagination | Default footer layout doesn't expose `windowSize` | S | — | X |
| PIN-G3 | Pinned-rows | `AggregateSpecs` keys untyped: a typo'd column id is silently ignored | S | X | X |
| CTX-G2 | Context menu | `formatBinding` JSDoc claims a consumer export the barrel doesn't provide | S | — | X |
| FIL-G4 | Fill | Barrel over-exports pipeline internals whose JSDoc says "not public"; `UseFillHandleOptions` references unexported `FillStoreApi` | S | — | X |
| FIL-G5 | Fill | In-progress fill-drag state is opaque (SKIP for now; upgrade: `fillDragActive`) | S | — | X |
| FIL-G6 | Fill | Core JSDoc still references the removed `onFillPattern` prop | S | — | X |
| HIS-G3 | History | Stack depth/entries unobservable beyond `canUndo`/`canRedo` (`historySize` one-liner; entry inspection SKIP) | S | X | X |
| IO-G3 | IO | Export button swallows async failures; no export lifecycle (`onError`) | S | X | X |
| IO-G4 | IO | Import surface half-hardcoded: formats, delimiters, preview cap 10, exact-only header matching (SKIP a registry; cheap props: `accept?`, `previewRowCount?`) | S | X | X |
| IO-G7 | IO | Parsing is uncancelable (no `AbortSignal` on `parseImportFile`) | S | X | X |
| IO-G8 | IO | XLSX export is download-only and text-only; no `buildXlsx` escape hatch (sheet name hardcoded) | M | X | X |
| IO-G9 | IO | Export delimiter is a loose `string`; import is the typed `CsvDelimiter` union (round-trip mismatch) | S | — | X |
| IO-G10 | IO | Docs overclaim duplicate-mapping protection (true for the dialog UI only; the hook path allows duplicates) | S | X | X |
| IO-G11 | IO | Export has no scale guard (one synchronous map) while import has chunking | M | X | X |
| URL-G3 | URL-state | Operator set matches core exactly but has no drift guard (a future 15th operator silently drops out of URL round-trips) | S | — | X |
| URL-G4 | URL-state | Page-size change always resets page to 1; the justifying comment is wrong (client mode keeps first row) | S | X | X |
| URL-G5 | URL-state | Out-of-range deep-linked `page` stays raw in the URL (`?page=999` renders clamped) | S | X | X |
| PRE-G2 | Presence | 1024-rect budget hardcoded; excess silently dropped in production (dev-only warn) | S | X | X |
| PRE-G3 | Presence | Payload type guards (`isRowIdPresenceHighlight`/…) not on the public barrel | S | — | X |
| XFE-G5 | URL-state × pagination | Page reset on pageSize change: url-pagination resets to 1, client mode keeps the first visible row — undocumented inconsistency | S | X | X |
| TYP-G4 | Type surface | Stale comment points to a presence type test that does not exist | S | — | X |
| TYP-G5 | Type surface | `useDataGridAggregate` reducer loses row/value types; the docs' own example requires a cast | M | — | X |
| TYP-G6 | Type surface | `BuildImportedRowsOptions.columns` carries `any` (SKIP for now; track with COL-G5/G7) | S | — | X |
| TYP-G7 | Type surface | Lazy JSDoc links to non-exported constants; the 30/50 defaults are invisible in generated docs | S | X | X |

Totals: 83 unique gaps (84 findings, PIN-G1 ≡ XFE-G2 merged) — P1: 8, P2: 37, P3: 38.
Size: S: 44, M: 26, L: 2 (EDT-G2 full parity, SRF-G2 full custom operators).

---

## Suggested work order (clusters)

1. **P1 batch (data integrity + a11y):** COL-G1, COL-G2, ROW-G1+ROW-G3 (one work item),
   EDT-G1, IO-G1, A11-G1, TYP-G1. Six of eight are S/M; none requires a new concept.
2. **Lazy × add-on cluster** (docs + guards; the lazy-loading page becomes the hub):
   IO-G1 (P1), PIN-G1/XFE-G2, FIL-G3, HIS-G1, XFE-G1 (COL-G2 is in the P1 batch).
   One pass over `lazy-loading.mdx` + `lazy-loading-advanced.mdx` documents the whole matrix
   (supported: presence, fill-with-skip; unsupported: pagination, aggregates; guarded:
   sort/filter/search — dev-only).
3. **Row-ops view bookkeeping:** ROW-G1/G3 (viewIndex rebuild + echo fix), ROW-G4 (editor
   guard), ROW-G5 (keyboard duplicates selection), ROW-G2 (doc signature).
4. **Doc-lie cluster (all S, cheap wins):** CLP-G1, FIL-G2, FIL-G6, KEY-G1, I18-G1,
   A11-G2, STT-G1, COL-G10, COL-G3 (docs part), CTX-G2, TYP-G7, URL-G4, IO-G10, EDT-G5,
   STR-G2, STR-G3, CLP-G4, XFE-G4, XFE-G5, PAG-G3 (dev-warn part).
5. **Barrel/type-surface cluster (S):** TYP-G1 (P1), TYP-G3, COL-G8, PRE-G3, COL-G5 (docs),
   COL-G7 (docs), TYP-G4, FIL-G4.
6. **Additive API primitives (M, plan per item):** SRF-G1, SRF-G2 (narrow first step),
   TOL-G1, STR-G1, PAG-G1, PRE-G1, HIS-G2, FIL-G1, CTX-G1, URL-G1, URL-G2 (S), IO-G2,
   IO-G6, IO-G8, IO-G11, COL-G4, EDT-G2, GSK-G1, KEY-G2, XFE-G3, TYP-G2, STR-G5,
   COL-G9, TYP-G5.
7. **Polish sweep (P3 remainder):** everything else, batched by file to minimize churn.

## Detail: Core — Columns & cell types (COL)

### COL-G1 — Def-level `hidden: true` is permanent (P1, M)
`computeVisibleColumns` filters on the def-level flag AND the runtime hidden set
(`!c.hidden && !hidden.has(c.id)`) while `setColumnHidden` only mutates the set. A column
whose `ColumnDef` says `hidden: true` can never be re-shown; the columns menu checkbox reads
only the set and flips to "shown" while the column stays hidden; the `onColumnLayoutChange`
snapshot reports it visible.
Evidence: `registry/default/blocks/data-grid/store/compute.ts:249-259` (filter + seeding 244-246);
`store/create-store.ts:425-441`; `types.ts:408` (JSDoc "toggle at runtime");
`content/docs/columns.mdx:173`; `data-grid-toolbar/columns-menu.tsx:32-45`;
`store/hooks.ts:258-260`; `compute.ts:266-283,295-303`; `test/store.test.tsx:1880-1890`.
Fix: user intent wins over the def — drop `!c.hidden` from `computeVisibleColumns` and
re-seed def-hidden ids only when the `columns` prop identity changes (in `_syncProps`,
`create-store.ts:1026`), or track a `userShownIds` set. Add the missing store test.

### COL-G2 — Lazy holes invoke consumer callbacks with `row: undefined` (P1, S)
Skeleton rows render the full `DataGridCell`, which unconditionally evaluates function-form
callbacks with `row === undefined`: `column.readOnly(row)`, `getRowClassName(row, …)`, and
the function forms of `getCellClassName`/`column.cellClassName`. The documented
row-permission pattern `readOnly: (row) => row.locked` throws a TypeError during render when
scrolling into an unloaded window — the grid crashes. The interaction-layer copies no-op on
holes; the render path is the only unguarded one.
Evidence: `data-grid/cell.tsx:127-129,159,189-192`; `row.tsx:86,95,116-140`;
`content/docs/editing-cell-types.mdx:101`; `recipes.mdx:290-305`; `lazy-loading.mdx:76,107`.
Fix: skip function-form callbacks when `row === undefined` in `cell.tsx` (the skeleton cell
is inert anyway — store entry points already no-op on holes, `cell.tsx:153-157`) and
`row.tsx:95`; browser test (lazy grid + function-form callbacks, scroll without throwing);
document the undefined contract in `lazy-loading.mdx`.

### COL-G3 — Menu autosize bypasses the commit point (P2, S)
The header menu's autosize writes through `setColumnWidth` (fires only
`onColumnResizing`), while the core double-click autosize commits through
`commitColumnWidth` (fires `onColumnLayoutChange`). No `resizable: false`/
`enableColumnResize` gating on the menu item; hide-only with no restore. Docs disagree:
`columns.mdx:227-228` promises `onColumnLayoutChange` on "a drag release or an autosize";
`events-state.mdx:277-278` scopes it to double-click.
Evidence: `data-grid-context-menu/header-menu-content.tsx:81,86`;
`store/create-store.ts:392-401`; `columns/use-column-resize.ts:114-117`; `header-cell.tsx:67,157`.
Fix: pass `actions.commitColumnWidth` to `autosizeColumn` (measurement already clamps); gate
the item on the same flags; test that `onColumnLayoutChange` fires on menu autosize.

### COL-G4 — No column-layout reset primitive; width writes skip clamping (P2, M)
No `resetColumnWidth`/`resetColumnLayout`: `setColumnWidth(id, width)` cannot clear an
override; a flex column that was manually resized keeps its override and is permanently
excluded from flex distribution; `defaultColumnLayout` is mount-only; the shipped demo
resets by `localStorage.removeItem` + `key` remount. Additionally `setColumnWidth`/
`commitColumnWidth` write the raw width — clamping to `minWidth`/`maxWidth` (32px floor)
happens only in the gesture path and at render time, so `commitColumnWidth(id, 10)` on a
`minWidth: 80` column persists 10 while rendering 80.
Evidence: `store/types.ts:513-528`; `store/create-store.ts:392-401`; `layout-context.ts:63-64`;
`types.ts:397-399`; `columns/use-column-resize.ts:8-9,51-55`;
`columns/resolve-column-width.ts:5-8`; `examples/data-grid-column-layout-demo.tsx:68,83,110`;
`events-state.mdx:281-285`.
Fix: clamp in the store actions (reuse `resolveColumnWidth` + 32px floor); add
`resetColumnWidth(id)` (drop override, restore flex, fire `onColumnLayoutChange` once);
consider `resetColumnLayout()`.

### COL-G5 — `cellTypes` registry seam is fully type-erased (P2, S)
`cellTypes?: Record<string, AnyCellType>` with `AnyCellType = CellType<any, any, any>`;
`useDataGridCellTypes()` (documented for tooling) returns `Record<string, CellType>` with
erased value/options types. Nothing checks a registered entry against a declared key's shape;
a mistyped entry degrades to the runtime fallback or silently wrong value types.
Evidence: `data-grid.tsx:296,148`; `store/types.ts:239-247`; `store/hooks.ts:29-37`;
`custom-cell-types.mdx:191-209`.
Fix: document the erasure (per-key safety comes from `defineColumns` + `GridCellTypes`
augmentation; the registry is untyped; unresolvable keys dev-warn and fall back to text);
type-test pinning the `AnyCellType` contract and the hook's return type.

### COL-G6 — Plain `ColumnDef` never cross-checks `accessorKey` vs `TValue` (P3, S)
Accessor↔value cross-checking exists only on `TypedColumnDef`/`defineColumns`
(`KeysMatching`, `columns/column-helpers.ts:4-14,21-30`). A hand-written
`ColumnDef<Product, number | null>` with `accessorKey: "name"` compiles — exactly the
fallback path `custom-cell-types.mdx:193-209` steers users to when augmentation is not
available.
Fix: state the consequence in the docs, or add a single-column `defineColumn<TData, K>()`.

### COL-G7 — `any` third type param on consumer prop types (P3, S)
`column: ColumnDef<TData, TValue, any>` on `CellRenderProps`/`CellEditorProps`/
`CellClassNameCtx` (`types.ts:183-186,195-199,271-273`) — deliberate (commented: `unknown`
re-poisons `validate`'s union), but `column.options` is `any` in every custom cell type and
the docs' own example casts it (`data-grid-custom-cell-demo.tsx:69,85`).
Fix: accept (decision record is the code comment) — or name the cast convention in the docs.

### COL-G8 — `CellSpan`/`displayText` off the public barrel (P3, S)
Both are exported only from the internal `cell-types/index.ts:10-11`;
`custom-cell-types.mdx:46,98-99` references `displayText()` via the internal path; the
shipped custom-cell demo hand-rolls the span instead of using `CellSpan`.
Fix: export `displayText` and `CellSpan` from the barrel; repoint the docs.

### COL-G9 — Hardcoded, undocumented layout defaults (P3, M)
Default column width 150px in one expression with no JSDoc
(`columns/resolve-column-width.ts:5`); `HEADER_HEIGHT = 36` module constant with no prop or
CSS variable (`root.tsx:46,178,391,487-498` — `density` resizes data rows only);
`useColumnWindow`'s `overscan` option (default 1, tested) is never passed by `DataGridRoot`
(`use-column-window.ts:14` vs `root.tsx:303-308`); the 32px gesture floor is undocumented
(`use-column-resize.ts:8-9`).
Fix: `headerHeight?: number` prop (thread through layout + header render); JSDoc the 150px
default and the 32px floor; optional `columnOverscan?: number`.

### COL-G10 — Doc inconsistencies at the editor boundary (P3, S)
1. `custom-cell-types.mdx:157-161` tells custom editors Tab means `commit({dx:1,dy:0})`
   (move right); the built-in editors bind only Enter/Escape — Tab is native blur, committing
   in place (`cell-types/text.tsx:25-32`, `number.tsx:55-62`; `default-keymap.ts:48`).
   `editing-cell-types.mdx:20-35` documents the real contract.
2. `data-type={column.type}` (`cell.tsx:271`) — React omits it when the column has no `type`,
   so `[data-type="text"]` selectors never match default columns
   (`styling-theming.mdx:146,191`). Stamp `column.type ?? "text"`.
3. The number editor seeds its draft with `toText(value)` (no options) while the cell display
   uses `toText(value, options)` — `decimals: 2`, value `1.2345`: cell shows `1.23`, editor
   `1.2345` (`cell-types/number.tsx:31,45,61`). Seed with options.

## Detail: Core — Selection / Editing / Row ops / Streaming / Clipboard

### EDT-G1 — `reorder: "immediate"` moves the row out from under an open editor (P1, S)
`updateCells` has no `s.editing` guard, unlike `reorderRows` which refuses to run while an
edit session is open ("an open editor pins a view coordinate the move would silently
invalidate"). An immediate re-sort remounts the row at the edited view slot with a different
row; the open editor silently re-anchors (the unmount blur can commit the old draft into the
new row's cell). The streaming docs promise the opposite.
Evidence: `store/create-store.ts:726-791` (immediate branch 779-790) vs `:894-900`
(reorderRows guard + rationale); `store/types.ts:365,536-537`; `body.tsx:276-280`
(row key = row id); `content/docs/streaming-updates.mdx:154-157`.
Fix: in `updateCells`'s `"immediate"` branch, downgrade to `"defer"` when `s.editing` is
non-null — one-line guard mirroring `reorderRows`'s.

### EDT-G2 — Edit commit collapses the entire selection model (P2, L)
`commitCellEdit` writes `selection: selectCellPure(nextActiveCell)`; `selectCell` wipes
`rangeStack` and the row/column channels. Editing any cell of a multi-cell selection
(Excel's normal flow) destroys the range at commit and fires `onSelectionChange` with the
1×1 result — undocumented.
Evidence: `store/create-store.ts:543-550,555-563`; `selection/selection-ops.ts:15-22`;
`events-state.mdx:92-93` (trigger list omits edit commits); `store/provider.tsx:17-20`.
Fix: minimal — document the collapse. Full Excel parity (L): on commit, move `activeCell`
within the existing range instead of replacing the selection.

### EDT-G3 — Async-commit `pending` is unreadable outside the editor (P2, S)
`pending` lives in a per-cell `useState` inside `useAsyncValidate`
(`interaction/use-async-validate.ts:28,52-69`); `useDataGridEditing()` returns only
`{coord, initialText}` (`store/hooks.ts:181-189`); no `editingPending` in the store
(`store/types.ts:318-488`).
Fix: write `editingPending: boolean` into the store from `useAsyncValidate` (set on commit,
cleared on resolve/cancel/unmount); surface via `useDataGridEditing()` or a
`useDataGridEditingPending()` hook.

### EDT-G4 — Edit stash re-seeds on every render (P3, S)
`pendingValueRef.current = value` runs unconditionally on every `DataGridCell` render
(`cell.tsx:196-197`); any mid-edit re-render (stream tick, search toggle, flash pulse,
`cellError` landing) resets the stash to the last-committed value — the documented contract
is "seeded at editor open" (`types.ts:254-263`).
Fix: re-seed only on the `isEditing` false→true transition (effect keyed on `isEditing`),
or gate the assignment with `if (!isEditing)`.

### EDT-G5 — Space is a fourth, undocumented edit trigger (P3, S)
`edit: ["Enter", "F2", " "]` (`keyboard/default-keymap.ts:45`); keymap matching runs before
the printable-key fallback and Space is not "printable" (`is-printable-key.ts:9-13`), so
Space opens the full editor instead of type-to-replacing. The docs list exactly three
triggers with the word "only" (`editing-cell-types.mdx:9-16`).
Fix: one-line doc fix (list Space under `edit`), or drop `" "` if accidental.

### ROW-G1 — Row ops under an active sort/filter leave the view stale (P1, M)
`insertRows`/`deleteRows`/`duplicateRows` write `data` but never recompute `viewIndex`/
`searchMatches` and never set `viewStale`. Under an active sort or filter the stale
`viewIndex` maps to wrong rows and a wrong row count (`rowCount` IS `viewIndex.length`),
and the controlled-echo path — the pattern the streaming docs recommend — deliberately
preserves that stale array. A row inserted under a sorted view disappears from or corrupts
the displayed order until the next sort/filter/search change; nothing tells the user.
Evidence: `store/create-store.ts:818-850` (insert), `:851-867` (delete), `:868-893`
(duplicate) — all set only `data/cellErrors/selection/activeCell`; contrast `:443-481`
(sort actions recompute) and `:768-790` (updateCells bookkeeping); echo path `:985,1021-1023,
1057-1060`; `store/hooks.ts:397-399`; `keyboard/default-keymap.ts:58` (Ctrl/Cmd+Shift+F is
the default insert binding); `row-operations.mdx` has no mention.
Fix: in the three row-op actions, when `s.sortState.length > 0 || s.filterState.length > 0`,
recompute `viewIndex` (+ search matches) in the same `set()`; at minimum set `viewStale` and
dev-warn like `reorderRows` does.

### ROW-G2 — Docs show `duplicateRow: (row) => TData`; the real signature takes an index (P2, S)
The enable-props table in `row-operations.mdx` omits the second parameter of the required
callback (`(row, index)`).
Fix: doc fix (show the full signature + what `index` is).

### ROW-G3 — Row ops never rebuild `viewIndex` even unsorted; the echo path blocks repair (P1, M)
The three row-op actions write `data` only, set `lastEmittedData`, and the `_syncProps` echo
check (`isEcho && echoOnly` masks the data diff) treats their emitted array as "never moved
a row" and skips `computeViewIndex`. No other path rebuilds it (`reconcileView` is gated on
`viewStale`, which row-ops never set), so after an insert/delete the view count, windowing,
and `aria-rowcount` stay at the old size until a sort/filter/search/column change triggers a
rebuild — in BOTH controlled and uncontrolled mode.
Evidence: `store/create-store.ts:842-849,861-866,892` (no `viewIndex` in `set`); `:838/859/880`
(`lastEmittedData`); `:985,1019-1029` (echo skip); `:804` (`reconcileView` gate);
`interaction/use-grid-interaction.test.tsx:149-152` (test comment admits the gap);
`row-operations.mdx:9` ("works in both controlled and uncontrolled"); `hooks.ts:397-399` +
`body.tsx:66-76` + `root.tsx:452` (rowCount drives window/aria).
Fix: rebuild `viewIndex` (+searchMatches) inside the three actions (identity splice
unsorted, `computeViewIndex` otherwise, mirroring `setColumnHidden` `:432-439`), and/or
don't stamp `lastEmittedData` on row-op echoes. (Same work item as ROW-G1.)

### ROW-G4 — Row ops run with an open editor (P2, S)
`reorderRows` returns `false` while `s.editing` ("the commit path re-reads the shifted
viewIndex for the same coord"); the other row-ops have no such guard, so a programmatic/
remote row-op (websocket, toolbar outside the grid, `useDataGridStoreProps` escape hatch)
shifts rows under a pinned `editing.coord`, and the pending edit commits to the shifted row
or drops out of range.
Evidence: `create-store.ts:898-900` (guard + comment) vs `:818-850/:851-866/:868-892`
(none); `:543` + `commit.ts:164-177` (commit re-resolves coord); `cell-types/text.tsx:55`
(blur commits); `test/row-ops.test.tsx:425-434` (reorder-only test).
Fix: same guard (no-op + dev-warn) or `cancelEditing()` before the shift; list the condition
in `row-operations.mdx`.

### ROW-G5 — Keyboard `duplicateRow` duplicates only the active row (P2, S)
The keymap action dispatches `duplicateRows([state.activeCell.row])`
(`interaction/use-grid-interaction.ts:766`) while the cell-menu "Duplicate row(s)" item acts
on every selected view row and renders `formatKeymapShortcut(keymap, "duplicateRow")` next
to it (`data-grid-context-menu/cell-menu-content.tsx:52-53,117,120`;
`keyboard/default-keymap.ts:59`) — the advertised shortcut performs a narrower action than
the item it labels.
Fix: in the `duplicateRow` keymap case, duplicate the selected view rows (same
`selectedViewRows` query the menu uses, `cell-menu-content.tsx:20`), falling back to the
active row; keep the menu's shortcut label.

### STR-G1 — `updateCells` has no error or result surface (P2, M)
Returns `void`; grid-level readOnly, unknown row/column ids, per-column readOnly,
equal-value no-ops, validation failures, and superseded held batches are all dropped with no
return value, callback, or log (dev or otherwise). A feed with one typo'd `columnId`
silently stops updating rows.
Evidence: `store/types.ts:594`; `store/create-store.ts:728,743`; `store/commit.ts:240,326`.
Fix: return a batch verdict `updateCells(patches, options?): { applied; skipped; dropped }`
(additive — void callers ignore it); `dropped` counts superseded held batches and rejected
cells.

### STR-G2 — Async `validate` holds and silently drops `updateCells` batches (P2, S)
With an async column schema the batch is held until resolution; a failing cell is dropped
silently, an all-failing batch commits nothing, and any newer `updateCells` or row-moving
path supersedes the held batch silently. The docs describe only the synchronous skip.
Evidence: `store/create-store.ts:732-750`; `store/update-cells.test.tsx:270-312`;
`streaming-updates.mdx:159-161` (no async note, unlike `clipboard.mdx:93-98`).
Fix: doc fix — callout in `streaming-updates.mdx` stating the hold/supersede/drop contract
(parity with the clipboard docs); no API change (parity with paste is deliberate).

### STR-G3 — `updateCells` on a readOnly grid is a silent no-op (P3, S)
Grid-level `readOnly` makes every batch a silent no-op; the docs only mention per-column
readOnly skips. Evidence: `store/create-store.ts:728`; `streaming-updates.mdx:40`.
Fix: one line in `streaming-updates.mdx`; optionally a dev-only warn like `insertRows`.

### STR-G4 — No observable in-flight streaming state / no abort (P3, S — SKIP for now)
`viewStale` is the only streaming signal; a consumer cannot see that an async batch is
pending or count in-flight ticks; on unmount mid-stream a held batch still resolves and
fires `onDataChange` into a dead store (inert, no DOM effect).
Evidence: `store/hooks.ts` (no streaming hook; `useDataGridSearchCapped` at `:323` is the
in-house precedent); `store/create-store.ts:741-745`.
Fix: SKIP — add `useDataGridStreamPending(): boolean` only when a live-indicator consumer
asks.

### STR-G5 — `CellPatch` ids and values are untyped strings (P3, M)
`columnId: string`, `value: unknown`, `RowPatch.changes: Record<string, unknown>`
(`store/types.ts:265-278`); no column-id utility type anywhere in the block, so a mistyped
id is a compile-clean runtime skip.
Evidence: `store/types.ts:265-278`; `store/update-cells.test.tsx:108-115`.
Fix: make the patch types generic over the column registry (e.g.
`CellPatch<TData, TColumnId>` inferred from `defineColumns` output); keep `string` as the
unconstrained default.

### CLP-G1 — Doc lie: `processPaste` signature omits `target` (P2, S)
Docs show `processPaste(cells: string[][])`; the real prop is
`(cells: string[][], target: CellCoord) => string[][] | false`, called with the paste
anchor. A consumer written to the doc's signature compiles but can never see the anchor.
Evidence: `content/docs/clipboard.mdx:64-67`; `store/types.ts:73`;
`clipboard/use-grid-clipboard.ts:285`.
Fix: doc fix — show `target: CellCoord` (the paste's top-left cell) + one sentence on when
the callback runs (after tiling, before the cap).

### CLP-G2 — 200k-cell copy/paste caps undocumented and unobservable (P2, S)
Copy truncates to `MAX_COPY_CELLS` with no warning at all (not even dev); paste truncates
with a dev-only `console.warn`. `clipboard.mdx` never mentions either cap — a Ctrl+A copy on
a 100k-row grid silently copies only the first N rows.
Evidence: `clipboard/use-grid-clipboard.ts:76,93,134` (copy cap), `:166,289-292` (paste cap);
`clipboard.mdx:84-98`.
Fix: document both caps in Known limitations; dev warn on copy truncation (parity with
paste); optional `useDataGridClipboardCapped()` following the `useDataGridSearchCapped`
precedent (`store/hooks.ts:323`).

### CLP-G3 — Programmatic `copy()`/`cut()` fire-and-forget with silent TSV-only fallback (P3, S)
`copy`/`cut` return `void`; the async Clipboard API failure falls back to
`execCommand("copy")` which writes `text/plain` only — dropping the `text/html`/
`data-gridcn-raw` payload that makes round-trips lossless — with no feedback and no docs
mention. In a non-secure context, a copy back into gridcn silently degrades to display text.
Evidence: `clipboard/use-data-grid-clipboard.ts:15,31-39,44-59`.
Fix: return `Promise<"ok" | "fallback" | "no-selection">` (additive) + one doc line.

### CLP-G4 — Paste skips readOnly cells silently (P3, S)
Paste silently skips readOnly columns (and per-row readOnly predicates); the docs' paste
semantics list only mentions validation rejection.
Evidence: `clipboard/use-grid-clipboard.ts:231`; `clipboard.mdx:42`.
Fix: one bullet in the paste-semantics list: "readOnly cells are skipped."

## Detail: Core — Sorting / Filtering / Search / Shortcuts / i18n / A11y / State

### SRF-G1 — No per-column sort comparator (P2, M)
The comparator resolution chain is documented in-code as "column-level comparator (none
exists today) > cell-type `compare` > default text" (`store/compute.ts:209`). The only
customization point is `CellType.compare` (`types.ts:326`), so customizing a sort for one
column requires registering a full cell type. Default behavior — empty-last-in-both-
directions, numeric-aware `Intl.Collator(undefined, { numeric: true, sensitivity: "base" })`
(`sort-filter/build-view-index.ts:85,113-118`; `default-compare-text.ts:2`) — is hardcoded,
including the locale.
Fix: additive `ColumnDef.sortCompare?: (a: TData, b: TData) => number`, consulted first in
the accessor chain (`compute.ts:209` is the reserved slot). One doc line in
`sorting-filtering-search.mdx`.

### SRF-G2 — Filter operator set closed and value-blind (P2, L)
`FilterOperator` is a closed 14-member union (`types.ts:441-455`) with an exhaustive
`never` switch in the matcher, so a custom operator is structurally impossible
(`sort-filter/matches-filter.ts:80-83`). All matching runs on `accessor.getText()` — the
raw `String(value)` — so a predicate can never inspect the typed value
(`matches-filter.ts:30`). The toolbar's per-column operator set is keyed on literal
built-in type names: a consumer-registered numeric type (e.g. `currency`) gets only text
operators (`data-grid-toolbar/operators-for-column-type.ts:23-29`), and `DataGridFilterMenu`
has no prop to override the set per column (`filter-menu.tsx:256,323`).
Fix: additive `matchFilter?(value: unknown, filter: FilterSpec) => boolean` (grid-level prop
or `ColumnDef.filterMatch`) consulted before the built-in matcher, plus
`ColumnDef.filterOperators?: FilterOperator[]` for the menu. Narrower first step: make
`operatorsForColumnType` honor a cell-type flag (e.g. `cellTypes[key].orderable === true`).

### SRF-G3 — Quick search is hardcoded (P3, S)
`SEARCH_DEBOUNCE_MS = 200` with no prop (`data-grid-toolbar/search.tsx:28,117`);
`MAX_SEARCH_MATCHES = 1000` caps match collection and is not on the public barrel
(`store/compute.ts:388,424`); matching is case-insensitive substring only
(`find-search-matches.ts:20,26`); the searched set is exactly the visible columns
(`store/compute.ts:419-424`, documented at `sorting-filtering-search.mdx:49`).
Fix: `DataGridSearch` gains `debounceMs?: number` (default 200). SKIP the rest: cap and
semantics are documented, and a custom search predicate is already reachable via
`useDataGridSearchMatches`.

### SRF-G4 — Sort-list/filter-menu only manage visible columns; hidden-column filters orphan (P2, M)
`DataGridSortList` builds its options from `useDataGridVisibleColumns()`
(`data-grid-sort-list/sort-list.tsx:59-61,132`), so a hidden column cannot be added to the
sort through the UI — yet the doc says the add-on is "useful when columns are hidden or
narrow". Filters on hidden columns, once set programmatically or via a restored layout,
orphan as raw-id filter rows with no column context.
Fix: option to source options from all columns (`allColumns?: boolean`, default false) +
doc correction; handle/validate orphaned filter rows in the filter menu.

### GSK-G1 — Global-shortcut action set is a closed two-action union (P2, M)
`GlobalShortcutAction` is hardcoded `"undo" | "redo"`
(`data-grid/keyboard/global-shortcuts.ts:10,24`); the gate + `matchKeymap` machinery is
action-generic but consumers can never register another action (e.g. `selectAll`) on the
window layer. Dispatch is hardcoded (`use-data-grid-global-shortcuts.ts:55-56`).
Fix: widen to a `GridAction` subset (`actions?: readonly GridAction[]`, keep the mod-prefix
guard).

### GSK-G2 — Flipping `undo`/`redo` props drops multi-grid ownership (P3, S)
The effect re-runs on `enabled` change, assigns a fresh `gridId`, and cleanup nulls
`lastFocusedGrid`; with focus already inside the grid, `ownsFocus` is false until a new
`focusin`, so the global binding dies silently until re-focus.
Evidence: `use-data-grid-global-shortcuts.ts:28,50,64,66`.
Fix: assign `gridId` once per container via `useRef`, not per effect run.

### I18-G1 — Date editor placeholder bypasses `labels` (P3, S)
`placeholder="yyyy-mm-dd"` is hardcoded in the date editor
(`data-grid/cell-types/date.tsx:151`); i18n.mdx:7 claims every user-facing string lives in
`DataGridLabels`.
Fix: add a label (e.g. `grid.datePlaceholder`) and read it in the editor.

### I18-G2 — "Consumer-added GridAction" labels advertised but untypeable (P3, S)
`labels.ts:133` and i18n.mdx:128-133 promise a humanized fallback for consumer-added
actions (the test casts a fake action, `data-grid-keybindings/action-labels.test.ts:35`),
but `GridAction` is a closed `type` alias and `Keymap` is
`Partial<Record<GridAction, …>>` (`types.ts:477,504`) — no declaration-merging seam exists,
unlike `GridCellTypes`.
Fix: make custom actions expressible (interface-mergeable action union à la
`GridCellTypes`), or delete the "consumer-added" wording (see also KEY-G1).

### A11-G1 — `aria-sort` gated on `headerClickBehavior`; default hides sort state from AT (P1, S)
Both `aria-sort` and the visual indicator render only when
`headerClickBehavior === "sort"` (`data-grid/header-cell.tsx:120,137`); the default
resolves to `"select"` (`store/compute.ts:487`), so a sorted column in a default-config grid
announces no sort state to screen readers — against the WAI-ARIA grid pattern.
Fix: render `aria-sort` whenever `column.sortable !== false` (`"none"` when unsorted); keep
the visual arrow gated on click behavior.

### A11-G2 — `accessibility.mdx` omits implemented `aria-sort`/`aria-readonly` (P3, S)
The "Grid semantics" tab lists roles and the index model but never mentions `aria-sort`
(implemented, `header-cell.tsx:120`) or `aria-readonly` (`root.tsx:455`).
Evidence: `content/docs/accessibility.mdx:14-51`.
Fix: one line each in the semantics tab, noting the `headerClickBehavior` coupling.

### STT-G1 — `searchText`/`onSearchTextChange` controlled pair missing from events-state.mdx (P2, S)
The page promises "every callback the grid fires" and its 9-row table omits the search pair
entirely, even though it is a full controlled pair (same convention as `sortState`) with a
live fire site.
Evidence: `content/docs/events-state.mdx:16-28`; `store/types.ts:131-134`; fire site
`store/create-store.ts:516`.
Fix: add a table row + one line: "same controlled-pair convention as `onSortChange`".

## Detail: Add-on — Pagination / Pinned-rows / Toolbar / Sort-list

### PAG-G1 — Server mode clamps the displayed page but never reconciles the consumer's page state (P2, M)
In server mode the hook computes `clampedPage = clampPage(page, total, pageSize)` purely
for display: `controls.page` shows the clamped value while the consumer's own `page` state
— and the fetch effect keyed on it — stays at the stale, out-of-range page. When `total`
shrinks or `pageSize` grows past the current page, the bar shows "page 12 of 12" while the
grid fetches page 99. No callback, option, or doc tells the consumer.
Evidence: `data-grid-pagination/use-data-grid-pagination.ts:75-85` (clamp local to
`controls`; consumer `onPageChange` passed through verbatim `:82`);
`use-data-grid-pagination.test.ts:106-110` (asserts only the clamped display);
`pagination.mdx:103-121` (server-mode example has no shrink handling);
`examples/data-grid-pagination-swr-demo.tsx:53-56`, `data-grid-pagination-react-query-demo.tsx:48-51`
(manual `setPage(1)` workarounds).
Fix: additive `reconcilePage?: boolean` (default `false`) on the server options — an effect
fires `onPageChange(clampPage(page, total, pageSize))` exactly once when the clamp differs.
Minimal alternative: document the reconciliation pattern in `pagination.mdx`.

### PAG-G2 — Client mode: page size is a one-shot seed with no observation callback (P3, S)
`UseDataGridPaginationClientOptions` has no `onPageSizeChange`; `pageSize` seeds `useState`
exactly once (`:93`) and later option changes are ignored. Persisting page size
(localStorage/URL) or driving it from a density control in client mode requires wrapping
`controls.onPageSizeChange` — an undocumented workaround asymmetric with server mode.
Evidence: `use-data-grid-pagination.ts:21-28,93,119-124`; `pagination.mdx:214-217`.
Fix: add `onPageSizeChange?: (pageSize: number) => void` to client options, fired after the
internal `setPageSize` (mirrors server mode).

### PAG-G3 — Server mode: page-size select silently no-ops when `onPageSizeChange` is omitted (P3, S)
Server mode defaults the missing `onPageSizeChange` to `() => {}` (`:37,83`), so the
footer's rows-per-page select renders looking fully functional but does nothing. The no-op
is even enshrined by a test (`use-data-grid-pagination.test.ts:129-133`) with no dev-time
signal.
Fix: dev-warn once when the no-op is actually invoked (the bar is the only caller, so the
warn is precise), or let the select disable itself when a consumer flag marks the size as
uncontrolled.

### PAG-G4 — Default footer layout doesn't expose `windowSize` (P3, S)
`DataGridPaginationBarProps` (controls + `className` + `labels` + `children`) has no
`windowSize`; the default layout renders `<DataGridPaginationPages />` with the hardcoded 5
(`pagination-footer.tsx:32-43,73`). A 7-wide window requires hand-composed `children`.
Fix: add `windowSize?: number` to the bar props, forwarded when `children` is absent.

### PIN-G1 — `useDataGridAggregate` on a lazy (sparse) grid crashes or silently undercounts (P2, S)
The aggregate resolves every row through `getCellValue`, which property-accesses `undefined`
for lazy holes (`accessorKey` columns) and calls `accessorFn(undefined)` for accessor
columns — so a totals band on a `data-grid-lazy` grid throws during render (scope "view")
or silently sums only the loaded rows (scope "all" — `Array#map` skips holes).
`DataGridLazyGuard` dev-warns on sort/filter/search over partial data, but nothing guards
aggregation; no doc mentions the combination. (Same gap as XFE-G2.)
Evidence: `data-grid-pinned-rows/use-data-grid-aggregate.ts:41,50-60`;
`data-grid/columns/column-helpers.ts:108-117`;
`data-grid-lazy/use-data-grid-lazy-rows.ts:139` (sparse array); `lazy-guard.tsx:19-46`
(guard covers only sort/filter/search); no "pinned"/"aggregate"/"totals" in
`lazy-loading.mdx`/`lazy-loading-advanced.mdx` (grep-verified).
Fix: docs first — one line each in `pinned-rows.mdx` and `lazy-loading.mdx` marking the
combination unsupported (posture like pagination × lazy). Code: skip `undefined` rows in
`computeAggregate` + dev-warn when holes are detected, mirroring the lazy guard.

### PIN-G2 — Pinned-row aggregates silently become page-local under pagination (P2, S)
`scope: "view"` (default) reduces over `viewIndex` — under client-mode pagination the
grid's data IS the page slice, so a "Total" band on a paginated grid sums the 25 visible
rows while the footer says "1–25 of 240". Neither page mentions the other
(`pinned-rows.mdx` has no pagination caveat; `pagination.mdx` doesn't list aggregates).
`scope: "all"` doesn't help — the grid's `data` IS the slice.
Evidence: `use-data-grid-aggregate.ts:52`; `pagination.mdx:38` (grid only ever receives
`pager.pageData`); `pinned-rows.mdx:105-112`.
Fix: doc notes in both pages: under pagination, aggregates cover the page slice only;
dataset-wide totals must be fetched server-side or computed from the full dataset outside
the grid and pinned as a static band row.

### PIN-G3 — `AggregateSpecs` keys untyped: a typo'd column id is silently ignored (P3, S)
`AggregateSpecs = Record<string, AggregateReducer>` and `computeAggregate` does
`if (!column) continue;` for unknown ids (`use-data-grid-aggregate.ts:16,55-57`). A typo in
a spec key yields an empty band cell with no warning.
Fix: one-time dev-warn on unknown spec keys (style of the `rowBands` identity guard in
`store/commit.ts:83-85`); or one doc sentence.

### TOL-G1 — Per-column-type operator set hardcoded with no extension seam (P2, M)
`operatorsForColumnType` maps the literal strings `"number"`/`"date"`/`"select"` to fixed
operator lists; everything else (including consumer-registered custom cell types) falls
through to the text-only list (`data-grid-toolbar/operators-for-column-type.ts:3-29`).
`DataGridFilterMenu` exposes no prop to override the operator list per column
(`filter-menu.tsx:256,323`), so a custom numeric column cannot be filtered with `gt`/`lt`
from the menu even though the core's `FilterOperator` union already supports it — the menu
is strictly less capable than the API it fronts.
Fix: additive `DataGridFilterMenuProps.operatorsForColumn?: (column: AnyColumnDef) =>
FilterOperator[]` (default = current `operatorsForColumnType(column?.type)`), threaded to
`FilterRow`; document in `toolbar.mdx`/`sorting-filtering-search.mdx`. (Complements SRF-G2;
the two can land together.)

## Detail: Add-on — Context-menu / Fill / History / Keybindings

### CTX-G1 — No way to customize the context menu's item set (P2, M)
Both menu surfaces are hardcoded JSX: the cell menu renders a fixed Cut/Copy/Paste/Clear/
Insert/Duplicate/Delete list and the header menu a fixed Sort/Pin/Hide/Autosize list.
`DataGridContextMenuProps` is only `{ className?, children? }` — no slot to add, remove,
reorder, or conditionally gate an item. Row-op visibility is derived solely from
`createRow`/`duplicateRow` presence and `readOnly`, which consumers cannot override.
Evidence: `data-grid-context-menu/context-menu.tsx:18-21`; `cell-menu-content.tsx:76-128`;
`header-menu-content.tsx:48-91`; `has-row-op.ts:5-11`; docs promise only this fixed set
(`addons/context-menu.mdx:51-61`, `row-operations.mdx:92-108`) — a surface gap, not a doc
lie.
Fix: additive render slots on the wrapper: `renderCellMenuItems?: (ctx: { row: number;
columnId: string; canInsertRow: boolean; canDuplicateRow: boolean }) => ReactNode` and
`renderHeaderMenuItems?: (ctx: { columnId: string; scrollRoot: HTMLElement | null }) =>
ReactNode` (default = built-in set). Cheaper fallback: document a "bring your own menu"
recipe using the exported core hooks.

### CTX-G2 — `formatBinding` JSDoc claims a consumer export the barrel doesn't provide (P3, S)
The JSDoc says `formatBinding` is "Exported for native-shortcut labels (Ctrl/Cmd+C/X/V) that
live outside `DEFAULT_KEYMAP`", implying consumers can use it. It is not on the barrel
(`data-grid-context-menu.ts:3-4` exports only the two components), and no doc ever teaches
importing it. Evidence: `format-keymap-shortcut.ts:23-27`.
Fix: reword the JSDoc to "used by the menu's own shortcut hints; module-private" (or export
it and teach it if the need is real).

### FIL-G1 — Series detection hardcoded; `onFill` cannot rewrite values (P2, M)
`detectSeries` supports exactly three patterns (arithmetic, zero-padded, prefix+number) and
`generateFill` calls it directly (`data-grid-fill/detect-series.ts:92-96`,
`generate-fill.ts:61-66`) — no custom detector. Date series (`2026-01-01, 2026-01-02 →
2026-01-03`) are the most common spreadsheet fill need and are not detected. The only
interception point, `onFill`, can veto (`preventDefault`) but cannot transform `values`
(`use-fill-handle.ts:31-38,222-224`).
Fix: additive `UseDataGridFillOptions.detectSeries?: (values: readonly string[]) =>
SeriesDescriptor | null` (default = built-in; `SeriesDescriptor` is already exported,
`data-grid-fill.ts:5`), threaded `useFillHandle` → `buildFillCandidates` → `generateFill`.
Doc: "Custom series detection" section + state the date-series limitation explicitly.

### FIL-G2 — `fill.mdx` misdescribes `onFill`'s `values` (P2, S)
The doc's code comment says `values` "is the source range serialized to text (same shape a
copy would produce)". It is actually the *computed fill pattern* for the target strip
(`strip.height × strip.width`, extrapolated or tiled), produced before validation.
Evidence: `content/docs/addons/fill.mdx:122` vs `use-fill-handle.ts:223`; pinning test
`test/fill.browser.test.tsx:119-135`.
Fix: doc fix — "values is the pattern being written into the target strip
(strip.height × strip.width), before validation".

### FIL-G3 — Fill over lazy (unloaded) rows silently skips those cells (P2, S)
With `data-grid-lazy` installed, a fill strip can cover unloaded rows (skeleton holes).
`buildFillCandidates` skips every cell whose data row is `undefined`, applies only the
loaded cells, and still expands the selection over the whole strip — no error, no dev
warning, nothing in the docs. The skipped cells load later un-filled.
Evidence: `use-fill-handle.ts:98-101` + selection expansion `:245-247`;
`data-grid-lazy/use-data-grid-lazy-rows.ts:139,283-286`; no `lazy` mention in
`addons/fill.mdx` (grep-verified).
Fix: doc callout in `fill.mdx` ("on a lazy grid, filling stops at loaded rows; unloaded
cells are skipped silently") + a dev-mode `console.warn` in `buildFillCandidates` when a
strip cell was skipped for being unloaded.

### FIL-G4 — Fill barrel over-exports pipeline internals (P3, S)
The barrel exports `readRectAsText`, `buildFillCandidates`, `buildFillWrites`,
`UseFillHandleOptions`, `FillHandleHandlers` — no doc teaches any of them, in-tree
consumers use deep relative imports, and `buildFillCandidates`' JSDoc explicitly says
"not part of the public hook surface" (`use-fill-handle.ts:81-82`). The exported
`UseFillHandleOptions` has a required `fillStore: FillStoreApi` field whose type is not
exported from the barrel, so the public type references an unnameable symbol.
Evidence: `data-grid-fill.ts:1-8`; `use-fill-handle.ts:41-49`; `fill-store.ts:24`.
Fix: drop the test-only exports from the barrel per the repo's "docs don't teach it → not
exported" rule (grandfathered, flagged for cleanup; do not add more), or fix the JSDoc.

### FIL-G5 — In-progress fill-drag state is opaque (P3, S — SKIP for now)
The drag preview rect and "drag active" fact live in a per-hook private Zustand store that
`useDataGridFill` creates internally (`fill-store.ts:27-38`, `use-data-grid-fill.tsx:43`);
the consumer gets no `isDragging`/`onFillDragStart`/`onFillDragEnd` surface
(`UseDataGridFillResult`, `use-data-grid-fill.tsx:14-26`).
Fix: SKIP — one boolean on the result (`fillDragActive` via `useSyncExternalStore` on the
internal store) when a real consumer need appears.

### FIL-G6 — Core JSDoc still references the removed `onFillPattern` prop (P3, S)
The `OnCellClick` JSDoc in core types says "never a veto point (contrast
`onFillPattern`'s `preventDefault()`)" — `onFillPattern` was removed when fill was
extracted to the add-on (now `onFill` on `useDataGridFill`).
Evidence: `data-grid/types.ts:230`; removal recorded in `CHANGELOG.md:120-126`.
Fix: `onFillPattern` → `onFill`.

### HIS-G1 — History × lazy has no composition story; undo degrades unsafely on a sparse array (P2, S)
`useDataGridState` (the quick-start) owns a dense array and cannot compose with
`data-grid-lazy`'s sparse windowed `data` at all; `useDataGridHistory` is composable in
theory but entirely undocumented for this case (neither `addons/undo-redo.mdx` nor
`lazy-loading.mdx` mentions the other). If a consumer wires `useDataGridHistory` against
the lazy sparse array, `undo()` runs `applyChange(dataRef.current, …)`, which calls the
consumer's `getRowId` on every element including `undefined` holes — the documented
`(row) => row.id` form throws; with a hole-tolerant id, ops whose rows were evicted are
skipped silently, leaving permanent no-op entries with `canUndo` still true.
Evidence: `data-grid-history/use-data-grid-history.ts:95-107,76-77`;
`data-grid/interaction/history.ts:64-65`;
`data-grid-lazy/use-data-grid-lazy-rows.ts:139,283-286`; `addons/undo-redo.mdx` (no lazy
section); `lazy-loading.mdx:103-108,209-210`.
Fix: doc fix — a "With data-grid-lazy" section in `undo-redo.mdx` covering the fan-out
wiring, the hole-tolerant `getRowId` requirement, the evicted-row silent no-op, and calling
`history.clear()` on `lazy.reset()`/dataset swap. Optional: once-per-lifetime dev warning
in `undo()` when `dataRef.current.some((r) => r === undefined)`.

### HIS-G2 — No way to tie the stack to dataset identity (P2, M)
The only clearing mechanism is a manual `clear()`; nothing links history to a dataset
change. `applyChange` silently skips `update`/`delete` ops for vanished ids, but `insert`
ops — including the inverted "undo a row delete" — are applied unconditionally
(`data-grid/interaction/history.ts:78-81,146-184,216-227`), so undoing a delete after the
dataset was replaced re-inserts old rows into the new dataset.
Evidence: `use-data-grid-history.ts:109-112` (manual `clear` only);
`addons/undo-redo.mdx:20-24,53-54`.
Fix: additive `datasetKey?: string | number` on both hooks — clear both stacks when it
changes between renders (`useEffect` + prev-key ref; skip the initial render). Make
`datasetKey` the primary "dataset changed" guidance; keep `clear()` for imperative resets.

### HIS-G3 — Stack depth and entries unobservable beyond `canUndo`/`canRedo` (P3, S)
The core `History` type exposes `size` (`data-grid/interaction/history.ts:211-212`), but
neither `UseDataGridHistoryResult` nor `UseDataGridStateResult.history` surfaces it, and
there is no way to read entries or their labels back.
Evidence: `use-data-grid-history.ts:38-57`; `use-data-grid-state.ts:15-40`;
`addons/undo-redo.mdx:117-118`.
Fix: one-line pass-through `historySize: number` on both results. SKIP full entry
inspection (upgrade path if a "what can I undo" UI appears).

### KEY-G1 — Keymap is a closed action set, but the docs/JSDoc promise "consumer-added actions" (P2, S)
`GridAction` is a closed union and in-grid dispatch is a hardcoded `switch`
(`types.ts:477-493,504`; `use-grid-interaction.ts:584-769`), so consumers can remap, add
second bindings to, or disable existing actions — but cannot add a new action with a
handler. Yet the keybindings add-on repeatedly documents "consumer-added actions": the
dialog's JSDoc (`keybindings-dialog.tsx:63-69`), the category/label fallbacks
(`action-groups.ts:3,13-14,67-70`; `action-labels.ts:9-11`; `labels.ts:133-134`). The
fallback code paths are dead unless the union is extended by a future core release; the
test suite proves it with a forced cast (`action-groups.test.ts:15-17,34-36`).
Fix: doc/JSDoc fix — replace "consumer-added actions" with "actions added to `GridAction`
by a future core release". API extension SKIP — declaration merging can't extend a type
alias and the dispatch switch is core-internal; upgrade path is a `registerGridAction`
seam if real demand appears.

### KEY-G2 — The keybindings dialog advertises bindings that no-op when the add-ons are absent (P2, M)
`groupKeymap` lists every action with bindings in the effective keymap, with no awareness
of whether a handler exists (`keybindings-dialog.tsx:38-41`). `undo`/`redo`/`fillDown`/
`fillRight` are bound in `DEFAULT_KEYMAP` always (`default-keymap.ts:52-55`) and dispatch
no-ops when `onUndo`/`onRedo`/the fill handlers aren't installed — so a grid with no
history add-on still shows "Undo: Ctrl+Z" in its own shortcuts dialog.
Fix: make the dialog rows handler-aware (read which actions have handlers from the store
and skip the rest), or document the dialog as "keymap reference" rather than "active
bindings".

## Detail: Add-on — IO / URL-state / Presence

### IO-G1 — Export walks lazy holes: silent empty rows or a crash (P1, M)
`buildExportRows` resolves each row as `state.data[dataRowIndex]` with no hole check. On a
lazy grid `data` is a genuinely sparse array, and every scope can include unloaded rows:
`'view'` walks `viewIndex` (which spans all `total` rows, holes included), `'all'` walks
the whole array, and `'selection'` can include holes (select-all selects unloaded rows).
`accessorKey` columns survive via `?.` and export as empty cells; `accessorFn` columns call
`accessorFn(undefined)` and will typically throw mid-export.
Evidence: `data-grid-io/export-grid.ts:66-85` (`row = state.data[dataRowIndex]` :74;
`accessorFn(row)` :78; `?.[column.accessorKey]` :80);
`data-grid-lazy/use-data-grid-lazy-rows.ts:139,295`; `lazy-loading.mdx:276-284`;
no io mention in either lazy docs page (grep-verified).
Fix: additive guard in `buildExportRows`: skip (or dev-warn on) `row === undefined` before
`accessorFn`, plus a one-line note on `import-export.mdx` ("export covers only loaded rows")
and a pointer in `lazy-loading.mdx`. Upgrade path: an `onlyLoaded` option.

### IO-G2 — Import rejects cells silently: no report of what was cleared (P2, M)
Every mapped import cell runs `column.validate`; a rejected value is replaced by
`cellType.clearValue()` and the row is kept (`build-imported-rows.ts:162`;
`build-imported-rows.test.ts:94-107`). `onImport(rows)` hands back only the built rows — no
per-cell rejection list, no count, no callback (`import-dialog.tsx:46-47`). A file with 3
invalid emails imports "successfully" with 3 silently emptied cells.
Evidence: `addons/import-export.mdx:114-118` (Confirm step, no validation mention);
`editing-cell-types.mdx:213-225` (partial coverage).
Fix: additive — `buildImportedRows` returns (or an optional param collects)
`{ rows, rejected: { rowIndex, importColumnIndex, gridColumnId }[] }` — or an
`onCellRejected` callback; `DataGridImportDialog` surfaces the count (label keys for io
errors already exist). Doc: one sentence in the Confirm step.

### IO-G3 — Export button swallows failures; no export lifecycle (P3, S)
`DataGridExportButton` calls `void exportGrid(...)` for both formats with no catch
(`export-button.tsx:42,45`). `exportGrid` is async and can reject (SheetJS dynamic
`import("xlsx")` failing, a throwing cell-type `toText`) — the failure becomes an unhandled
rejection with zero UI signal. No `onError`/`onExport` prop on the button or the hook.
Fix: optional `onError?: (error: unknown, format: "xlsx" | "csv") => void` on
`DataGridExportButtonProps` (default: dev-warn); catch in the two `onClick` handlers.

### IO-G4 — Import surface half-hardcoded (P3, S — mostly SKIP)
Accepted file types fixed to csv/tsv/xlsx/xls (`parse-import-file.ts:25-33`), the dialog's
`accept` fixed (`import-dialog.tsx:155`), delimiters fixed to `,`/`;`/`\t`
(`import-dialog.tsx:29-33`), preview capped at a fixed 10
(`use-data-grid-import.ts:11`), header matching exact with no alias tier
(`match-import-column.ts:38-50`).
Fix: SKIP a format-registry API. Cheap additive props if wanted: `accept?: string` and
`previewRowCount?: number`. Fuzzy matching: skip — `mapColumn` is the rename map and is
documented (`import-export.mdx:158`).

### IO-G5 — Stale sheet re-parse overwrites a newly chosen file's preview (P2, S)
`setSheetName`'s generation guard only guards against newer *sheet* switches; `loadFile`
and `reset` never bump `sheetGenerationRef`, so a slow in-flight sheet parse from file A
lands after file B loaded and clobbers B's preview (B's filename over A's sheet rows +
recomputed mapping).
Evidence: `use-data-grid-import.ts:95-101,103-136` (no bump), `:175,180,202-204`
(guard is sheet-switch-only).
Fix: increment `sheetGenerationRef.current` in `loadFile` and `reset`.

### IO-G6 — `onImport` is fire-and-forget; async merge failures invisible (P2, M)
`finish` calls `onImport(rows)` synchronously then closes the dialog
(`import-dialog.tsx:91-98,123-134` — only the *build* is awaited, not the merge). If the
consumer's merge is async (server upsert) and rejects, the user believes the import
succeeded.
Fix: accept `onImport: (rows) => void | Promise<void>` — hold the pending state until
settled, surface rejection in the dialog.

### IO-G7 — Parsing is uncancelable (P3, S)
`parseImportFile` takes no `AbortSignal` (`parse-import-file.ts:44-55,63-67`); a large
CSV/XLSX keeps reading+parsing to completion when the dialog closes or the user re-picks a
file (contrast: the *build* step is abortable).
Fix: `parseImportFile(file, options, signal?)`, check `signal?.aborted` after
`arrayBuffer()`/`text()` awaits.

### IO-G8 — XLSX export is download-only and text-only (P3, M)
SheetJS glue is inline and unexported (`export-grid.ts:123-128`) — no
`buildXlsx(state, options): Promise<Blob>` — so "export to server" or typed number/date
cells require re-implementing the glue (CSV has exported `buildExportRows`/`rowsToCsv`;
xlsx has nothing); sheet name hard-coded `"Sheet1"`.
Fix: export `buildXlsx` mirroring `exportGrid`'s CSV primitives; optional `workbookName`.

### IO-G9 — Export delimiter is a loose `string`; import is the typed `CsvDelimiter` union (P3, S)
A multi-char `csvDelimiter` "works" in `quoteCsvField` but produces a file the importer's
single-char auto-detect can't round-trip (`export-grid.ts:12` vs
`parse-import-file.ts:4`).
Fix: type `ExportGridOptions.csvDelimiter` as `CsvDelimiter` (already exported from the
barrel, `data-grid-io.ts:6`).

### IO-G10 — Docs overclaim duplicate-mapping protection (P3, S)
"a duplicate mapping cannot be created" is true for the dialog UI only
(`addons/import-export.mdx:126-129,168-171`); the hook path the docs recommend for custom
UIs (`setMapping`) accepts two source columns on one grid column
(`use-data-grid-import.ts:210-216` — no dedupe), and `buildImportedRows` writes both
(later mapping wins, silently, `build-imported-rows.ts:89-99`).
Fix: scope the doc sentence to the dialog, or dedupe in `setMapping`/`buildImportedRows`
(dev-warn on dup).

### IO-G11 — Export has no scale guard while import has one (P3, M)
`buildExportRows` is one synchronous map with no chunking/yield and no row cap
(`export-grid.ts:66-85`); a 200k-row grid freezes the main thread on export (import got
`IMPORT_CHUNK_THRESHOLD_ROWS` + chunking for exactly this, `build-imported-rows.ts:7-11,
104-136`).
Fix: `maxRows?` option and/or chunked build with optional `onProgress`.

### URL-G1 — No URL→store direction after mount; external URL writes are dead (P2, M)
nuqs updates the params on popstate/route changes, but the apply-effect runs once (empty
deps) and only the store→URL direction exists afterwards
(`data-grid-url-state/use-data-grid-url-state.ts:78-102` mount-only, `:104-130` write-only);
back/forward, `setSearchParams`, or SPA query-only route changes are ignored, and the next
store action re-writes the URL "winning". Documented design, but no escape hatch.
Evidence: `addons/url-state.mdx:75-77`.
Fix: additive `applyFromUrl(): void` in the result (re-runs the mount logic) and/or
`trackExternal?: boolean`.

### URL-G2 — `pageSizeOptions` constrains only URL parsing; the bar's select diverges (P2, S)
The composition spreads `{...url}` which lacks `pageSizeOptions`
(`use-data-grid-url-pagination.ts:14-15,76-79`), so the bar always offers the pager's
default `[10,25,50,100]` (`use-data-grid-pagination.ts:7,36,74-76`); a customized URL
allow-list then rejects bar choices (UI shows 25, URL carries 25, hook returns the fallback
default — three different values).
Fix: include resolved `pageSizeOptions` in `UseDataGridUrlPaginationResult` so one spread
propagates.

### URL-G3 — Operator set matches core exactly but has no drift guard (P3, S)
`FILTER_OPERATORS` (14 values) equals the core `FilterOperator` union today;
`satisfies FilterOperator[]` checks membership only, not completeness — a future 15th core
operator compiles fine and silently drops out of URL round-trips.
Evidence: `filter-operators.ts:4-19` vs `types.ts:441-455`.
Fix: exhaustiveness type-test (`Record<FilterOperator, true>` coverage of the set) in the
block's type-test file.

### URL-G4 — Page-size change always resets page to 1, and the comment is wrong (P3, S)
`onPageSizeChange` nulls the page param unconditionally
(`use-data-grid-url-pagination.ts:67-74`); its comment says "like the pagination add-on's
own page-size clamp", but client mode preserves the first visible row
(`use-data-grid-pagination.ts:119-124`) and server mode has no clamp at all.
Fix: document reset-to-1 as intentional in `url-state.mdx`; correct the comment.

### URL-G5 — Out-of-range deep-linked `page` stays raw in the URL (P3, S)
`?page=999` renders clamped to the last page, but the URL keeps `999` until the user next
navigates; the shared link and the rendered view disagree, and the stale page "revives" if
the dataset later grows.
Evidence: `use-data-grid-pagination.ts:75` (clamp lives in the pager);
`use-data-grid-url-pagination.ts:57-58,60-65` (only write path is `onPageChange`);
`use-data-grid-url-pagination.browser.test.tsx:36-40`.
Fix: normalize on mount — write the clamped value back when it differs from the raw param.

### PRE-G1 — Snapshot-only writes; no per-entry lifecycle or staleness handling (P2, M)
The sole writer is whole-list `setPresenceHighlights` (`data-grid-presence/presence-store.ts:107-110`);
no `removePresenceHighlight(id)`, no `clearPresenceHighlights()`, no TTL/`lastSeen`
(entries carry no timestamp, so the add-on cannot detect a dropped socket), and
`useDataGridPresence()` takes no options at all (`use-data-grid-presence.ts:41-58`). A peer
whose connection dies without a leave paints a permanent ghost; the documented mitigation
is read-filter-re-set per leave (`presence.mdx:94-105`); two sockets clobber each other's
snapshots.
Fix: additive `removePresenceHighlight(id)`, `clearPresenceHighlights()`, optional `ttl`
eviction or a `lastSeen` field.

### PRE-G2 — 1024-rect budget hard-coded and silent in production (P3, S)
`MAX_RESOLVED_RECTS` is a const (`presence-overlay.tsx:14-15,144-158`); excess fragments
are dropped with a **dev-only** warning (`use-data-grid-presence.ts:77-82` → `warnDev`). In
production a remote selection exceeding the budget is truncated with no consumer-visible
signal.
Fix: additive `maxRects` option + `onExcessRects(entry, kept, total)` callback.

### PRE-G3 — Payload type guards aren't on the public entry (P3, S)
`isRowIdPresenceHighlight`/`isRowIdRangePresenceHighlight` are defined and exported from
`presence-store.ts:75-89` but omitted from the barrel (`data-grid-presence.ts:1-9`), so a
consumer parsing an untrusted remote JSON payload (the documented receive path) can't
type-narrow which of the three forms they got without re-implementing the discriminants.
Fix: add the two guards to the barrel (they ARE the payload contract).

## Detail: Cross-feature matrix (XFE)

| Pair | Supported? | Documented? | Finding |
|---|---|---|---|
| lazy × pagination | No | Yes (as unsupported) | `lazy-loading.mdx:18` + `pagination.mdx:16-18` ("using the two together is not supported"); client slice over a sparse array (`use-data-grid-pagination.ts:107-110`) while the lazy hook treats the window as absolute indices (`use-data-grid-lazy-rows.ts:261-273`) → every page fetches global `[0,pageSize)`; playground enforces exclusive modes (`data-grid-playground-demo.tsx:591-594`) |
| lazy × url-state | No (sort/filter/search) | No | `<DataGridUrlState>` applies URL specs straight into the store on mount (`use-data-grid-url-state.ts:97-100`), violating lazy's "keep `sortState` empty" rule (`lazy-loading.mdx:241-250`) → client-side sort/filter over a partial array; only net is the dev-only guard (`lazy-guard.tsx:41-45`) — **XFE-G1** |
| lazy × pinned-rows | No | Partially (demo only) | `computeAggregate` scope "all" maps the sparse `data` — `Array#map` skips holes → silent undercount (`use-data-grid-aggregate.ts:52,41`); scope "view" feeds `undefined` into `getCellValue` → TypeError for accessorKey columns (`column-helpers.ts:116`); disabled only in the playground — **XFE-G2** (= PIN-G1) |
| lazy × presence | Yes (graceful) | No | rowId→viewRow map skips holes (`hooks.ts:388-389`) → entries for unloaded rows dropped silently, painted once the range loads (`presence-overlay.tsx:114-115,130`); enabled in the playground's lazy subtree; `presence.mdx` documents only the filtered-out case (129-131) |
| lazy × fill | — | — | known (FIL-G3) |
| lazy × history | — | — | known (HIS-G1) |
| lazy × io | — | — | known (IO-G1) |
| pagination × url-state | Yes (server mode only) | Yes | clean — standalone URL-backed controlled pair (`use-data-grid-url-pagination.ts:41-79`); page reset on `pageSize` change (`:70-71`) vs client-mode keep-first-row (`use-data-grid-pagination.ts:119-124`) undocumented — **XFE-G5** |
| history × io | Yes | Yes (one line + demo) | clean — import routes through the consumer's `onDataChange` with `source: "import"`, which history records by default (`use-data-grid-history.ts:26-35`; `data-grid-io-demo.tsx:54-65`) → one undo entry for a whole-dataset replace; dialog never writes the store (`import-dialog.tsx:52-57`) |
| toolbar × sort-list × core sort | Yes | Yes | clean — all surfaces read/write the same store `sortState` via `actions.setSorts` (`sort-list.tsx:94-139`; `header-menu-content.tsx:50-59`; `sorting-filtering-search.mdx:24-26`); sync documented (`sort-list.mdx:32-34`) |
| context-menu × selection | Yes | Behavior yes, seam no | `selection-queries.ts:4-28` re-derives selected rows from `GridSelection` (`types.ts:110-126`) with view-index semantics (`compute.ts:556`); a channel-semantics change (view index → rowId) still typechecks (structural `CompactSelectionLike`, `types.ts:121-126`) and silently mis-targets row ops (`cell-menu-content.tsx:52-53,117,123`) and the right-click gesture (`context-menu.tsx:64`); io duplicates the derivation (`export-grid.ts:43`) — **XFE-G3** |
| pinned-rows × sorting/filtering | Yes (by design) | Yes | clean — bands are a separate array outside the viewIndex/sort/filter/selection machinery (`use-data-grid-pinned-rows.tsx:23-31`; `pinned-rows.mdx:55-57`); aggregates follow sort/filter via scope "view" default (`use-data-grid-aggregate.ts:20-21`) |
| presence × streaming | Yes | Partially | rowId-native entries track reorders (`presence.mdx:129-131`); view-space `range` goes stale when `reorder: "immediate"` moves rows in-call (`streaming-updates.mdx:80-81`) — documented caveat covers only sender/receiver divergence (`presence.mdx:148-153`); playground drives presence with view-space entries — **XFE-G4** |
| keybindings × global-shortcuts | Yes | Yes | clean — global layer reads the effective keymap from the store (`use-data-grid-global-shortcuts.ts:17,45`), so remapped undo/redo follow (`global-shortcuts.mdx:77-78`) |
| sort-list/filter-menu × lazy | Yes (guarded) | Yes | guard covers every store-committed change (header click, sort-list `sort-list.tsx:96`, filter menu `filter-menu.tsx:104-128`, search `search.tsx:117`, programmatic actions, url-state mount — all route through the store the guard watches, `lazy-guard.tsx:37-46`); misses: dev-only (`:41`), warns once per app via module flag (`:17`), can't block the gesture, can't distinguish the supported controlled-server path from a misconfiguration (`:25-29`) |

### XFE-G1 — URL-applied view state silently re-sorts a lazily fetched grid (P2, S)
`DataGridUrlState` writes URL sort/filter/join/search into the store on mount, but the
lazy pattern requires those to stay out of the store; the result is a client-side
sort/filter over a partial array, and the only signal is a dev console warning.
Evidence: `use-data-grid-url-state.ts:97-100`; `lazy-loading.mdx:241-250`; `lazy-guard.tsx:41-45`.
Fix: doc callout on `lazy-loading.mdx` ("Sorting a lazy grid") and `url-state.mdx` stating
`DataGridUrlState` is incompatible with lazy and the spec must stay in consumer state.

### XFE-G2 — Pinned-row aggregates over a sparse lazy array: silent undercount or a throw (P2, S)
= PIN-G1 (see there). One work item.

### XFE-G3 — Context-menu and io each re-derive the selected-row set from core internals (P2, M)
`selectedViewRows`/`isCellInSelection` (context-menu) and a duplicate `selectedViewRows`
(io export) read the `GridSelection` public shape through a structural `CompactSelectionLike`;
if the rows/columns channels change semantics (view indices → row ids) both add-ons compile
fine and silently act on wrong or empty row sets.
Evidence: `selection-queries.ts:4-28`; `export-grid.ts:43`; `types.ts:110-126`;
`cell-menu-content.tsx:52-53,123`.
Fix: export one core selector (e.g. `getSelectedViewRows(state): number[]`, alongside
`compute.ts`'s `getSelectedRowIds`) from the core barrel and have both add-ons consume it.

### XFE-G4 — Presence view-space highlights go stale under `reorder: "immediate"` streaming (P2, S)
A raw `range` (view-space) presence entry pins to positions; a streaming feed with
`reorder: "immediate"` moves rows in the same call, so the highlight lands on different
rows — the documented caveat only names sender/receiver divergence, not the receiver's own
feed reordering its view.
Fix: doc fix in `presence.mdx` (use rowId-native entries for live feeds) + dev-warn when a
view-space entry is active and `reorderRows`/`updateCells(immediate)` runs.

### XFE-G5 — Page reset on pageSize change is inconsistent across the pagination surfaces (P3, S)
`use-data-grid-url-pagination` resets the page param to 1 on every page-size change
(`:70-71`); client mode of the pagination hook keeps the first visible row
(`use-data-grid-pagination.ts:119-124`); server mode has no clamp (PAG-G1). Three surfaces,
three behaviors, none documented.
Fix: one documented decision — align url-pagination with client-mode keep-first-row, or
document the reset-to-1 as the URL-state contract (URL-G4).

## Detail: Type-safety / barrel / payload sweep (TYP)

Per-block table (audit result — all 13 registry.json payloads verified entry-by-entry against
disk; JSDoc defaults spot-checked and matching):

| Block | Options/Result exported? | any on public seams | type tests? | payload ok? |
|---|---|---|---|---|
| data-grid (core) | Yes — full surface | 3 known (COL-G7 prop 3rd-params; `AnyColumnDef` erasure documented) | 4 (data-grid, column-helpers, builtin-augmentation, key-syntax) | ok (98/98) |
| data-grid-context-menu | Yes (`DataGridContextMenuProps`, `DataGridHeaderDropdownProps`) | 0 | none | ok (10/10) |
| data-grid-fill | Yes (`UseDataGridFillOptions/Result`, `FillArgs`) — over-export known (FIL-G4) | 0 | none | ok (11/11) |
| data-grid-history | Yes, `<TData>` generic options/results | 0 | 1 (getRowId arity) | ok (3/3) |
| data-grid-io | Yes (export/import options + results, dialog/button props) | 1 — `BuildImportedRowsOptions.columns` is `ColumnDef<TData, unknown, any>[]` (documented; TYP-G6) | none | ok (10/10) |
| data-grid-keybindings | Yes, EXCEPT `BindingChips`/`bindingTokens` that the docs teach (TYP-G1) | 0 | none | ok (7/7 incl. bundled `components/ui/kbd.tsx`) |
| data-grid-lazy | Yes (`UseDataGridLazyRowsOptions/Result<TData>`, `Range`, guard props) | 0 | none (PR #44 API = runtime tests only; TYP-G2) | ok (4/4) |
| data-grid-pagination | Yes (client/server options, `DataGridPaginationControls`, bar props) | 0 | none | ok (4/4) |
| data-grid-pinned-rows | Yes (band props + aggregate options/reports) | 0 (reducer params are `unknown[]`, see TYP-G5) | none | ok (5/5) |
| data-grid-presence | Yes (highlight union, entry, `PresenceStoreApi`, hook result) | 0 | none — stale comment claims one exists (TYP-G4) | ok (4/4) |
| data-grid-sort-list | Yes (`DataGridSortListProps`) | 0 | none | ok (2/2) |
| data-grid-toolbar | Yes (4 component props + `operatorsForColumnType`/`operatorLabel`/`operatorHasValue`) | 0 | none | ok (7/7) |
| data-grid-url-state | Yes (props, param serializers, `DEFAULT_URL_PAGE_SIZE`, url-pagination hook) | 0 | none | ok (9/9) |

Internal erasures (not public signatures): `as unknown as` at `store/create-store.ts:87,1007`
(COL-G5 class), `cell.tsx:220,247` (Editor/Cell casts), `as never` at
`data-grid-io/import-dialog.tsx:110`, `as [GridAction, ...]` at
`data-grid-keybindings/keybindings-dialog.tsx:38` (KEY-G1 symptom).

### TYP-G1 — `BindingChips`/`bindingTokens` missing from the keybindings barrel (P1, S)
The docs' "Binding chips" section imports `BindingChips` from
`@/components/data-grid-keybindings/binding-label` — an internal file
(`content/docs/addons/keybindings.mdx:63,59`); the barrel exports only dialog/shortcut/
categories/labels (`data-grid-keybindings.ts:1-6`). Works (the file ships in the payload)
but breaks the "barrel = import surface" contract.
Fix: `export { BindingChips, bindingTokens } from "./binding-label"` in the barrel + repoint
the doc import.

### TYP-G2 — 11 of 13 blocks have zero `*.type-test.ts`; the lazy PR #44 API has no type coverage (P2, M)
The only type tests are core (4 files) + history (1). `useDataGridLazyRows`' new API
(`reset`/`evict`/`getLoadedRanges`/`onLoaded`/`maxFetchRows`, `UseDataGridLazyRowsOptions/
Result<TData>`, the exported `Range`) has thorough runtime tests but no compile-time pin of
the result/option shapes; same for fill/io/presence/pagination/pinned-rows/toolbar/
context-menu/sort-list/url-state.
Evidence: `data-grid-lazy/` (only `range-math.test.ts`, `use-data-grid-lazy-rows.test.ts`,
`data-grid-lazy.browser.test.tsx`); `use-data-grid-lazy-rows.ts:50-95`;
`lib/registry-items.type-test.ts` covers registry items, not API shapes.
Fix: add one `data-grid-lazy/*.type-test.ts` asserting `UseDataGridLazyRowsResult<Row>`
shapes (`Equal<>` on reset/evict/getLoadedRanges/onLoaded signatures, `Range` identity);
extend to the other add-ons when their signatures next change.

### TYP-G3 — `createFilterMatcher` documented in the API reference but absent from the public barrel (P2, S)
`api-reference.mdx:213` lists it under "Other exported types" with "(from `sort-filter`)"
— a pointer at an internal domain barrel (`sort-filter/index.ts:3`); the public barrel
re-exports only `SearchMatch` from that domain (`data-grid.tsx:256`).
Fix: `export { createFilterMatcher } from "./sort-filter"` in the barrel (it's genuinely
useful and docs-teach it) — or strike the paragraph if it's meant internal-only.

### TYP-G4 — Stale comment points to a presence type test that does not exist (P3, S)
The header of `data-grid.type-test.ts:7-8` claims `PresenceHighlight`'s "own type-test
lives in the `data-grid-presence` add-on"; no such file exists in that block, so
presence's discriminated-union entry shape has no compile-time coverage and the pointer
misleads future readers.
Fix: add a small presence type test (entry union assignability, discriminator behavior) or
fix the comment to say coverage is runtime-only.

### TYP-G5 — `useDataGridAggregate` custom reducer loses row/value types (P3, M)
`AggregateReducer`'s function form is `(values: readonly unknown[], rows: readonly
unknown[]) => unknown` (`use-data-grid-aggregate.ts:13`) — `rows` is not typed as the grid's
row type, and the documented example writes `values as number[]`
(`addons/pinned-rows.mdx:135`).
Fix: make `useDataGridAggregate<TData>` generic over rows and type `values`/`rows`
accordingly (store read is `unknown[]` internally — one boundary cast); update the doc
example to be cast-free.

### TYP-G6 — `BuildImportedRowsOptions.columns` carries `any` (P3, S — SKIP)
The exported options type declares `columns: readonly ColumnDef<TData, unknown, any>[]`
(`build-imported-rows.ts:18-20,32`, with an inline eslint-disable); the documented
rationale (TValidate bivariance erasure) is sound, but a consumer passing typed columns gets
no per-column value checking at this seam.
Fix: SKIP for now — resolving means fixing the `ColumnDef` 3rd-param erasure (COL-G5/COL-G7
family) repo-wide; track with those.

### TYP-G7 — Lazy JSDoc links to non-exported constants (P3, S)
`overscan`/`batchSize` docs say "default {@link DEFAULT_OVERSCAN}"/
"{@link DEFAULT_BATCH_SIZE}", but both constants are module-private
(`use-data-grid-lazy-rows.ts:8-10,26-29`) — consumer-facing API docs show dead links and no
numbers.
Fix: state the numbers in the JSDoc ("default 30" / "default 50") or export the two
constants from the lazy barrel.

---

## Verified clean (checked, not gaps)

- **Selection/column state readability:** fully readable via hooks
  (`useDataGridVisibleColumns`/`useDataGridAllColumns`/`useDataGridIsColumnHidden`/
  `useDataGridColumnWidth(s)`/`useDataGridColumnFeatureFlags`, `store/hooks.ts`); no opaque
  state beyond the findings above.
- **Built-in cell types:** exhaustive pipeline + editor-lifecycle coverage (93 cases in
  `cell-types/cell-types.test.tsx`: never-throw `fromText`, clamping, StrictMode
  double-invoke cancel, double-commit guards, SSR-deterministic date formatting).
- **Builtin augmentation decoupling:** proven at compile time
  (`cell-types/builtin-augmentation.type-test.ts`, `data-grid.type-test.ts:47-58,190`).
- **Checkbox has no edit mode by design:** click/Enter/Space toggle directly through the
  interaction layer (`cell-types/checkbox.tsx:15-24`), documented
  (`editing-cell-types.mdx:38-41`), test-pinned.
- **Documented-and-tested column behaviors:** flex + manual-resize exclusion
  (`test/column-ux.browser.test.tsx:572-597`), pinned-zone-only reorder
  (`columns.mdx:36-38`), autosize's viewport-only measurement with a warn Callout
  (`columns.mdx:27-32`), stable-identity guardrails on `getRowClassName`/
  `getCellClassName` (`root.tsx:273-301`, `performance.mdx:31-37`).
- **URL-state param semantics:** `FILTER_OPERATORS` == core `FilterOperator` (14/14);
  `sort-param` matches `SortSpec` (array order = priority, order-preserving round-trips);
  `join`/`page` omit-at-default and never throw on garbage; one uniform `prefix` override
  supported (`prefixed-key.ts:1-4`).
- **Presence × lazy/streaming:** rowId-native entries re-resolve at paint time against the
  current `rowIdToViewRow`/`visibleColumns` — lazy-evicted, filtered-out, or not-yet-
  loaded rows are dropped silently and correctly; zero-cell-render contract test-verified
  (`data-grid-presence.test.tsx:50-241`).
- **Clipboard:** paste coercion is per-target-column `fromText` + `validate` as documented
  (`use-grid-clipboard.ts:233-239,241`); single-row tiling and one-paste-one-
  `onDataChange` match code (`:159-163,297`); TSV delimiter intentionally fixed
  (Excel/Sheets interop, `serialize-cells.ts:1-7`); RTL safe (HTML parsing reads DOM source
  order, `parse-clipboard.ts:36-38`).
- **Streaming docs:** defer/immediate/never table, perf numbers, hidden-column patches, and
  controlled-mode echo behavior all match the code.
- **Registry payloads:** all 13 items' file lists match disk; no stale or missing files.
