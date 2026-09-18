# Direct / bulk value-update API — design

Workplan item #72, part 3. Design draft for a future build lane. No production code was changed to
produce this document.

Evidence base: `docs/agent-work/2026-08-01-streaming-updates-research.md`. Read that first; every
"measured" number below comes from it.

## 1. Problem statement

Streaming consumers (tickers, live refreshes) currently have exactly one way to push values in:
replace the whole controlled `data` array. That forces the consumer to allocate an O(n) copy per
tick and forces the store to treat every tick as "everything might have changed".

Measured consequence at 100k rows, production build:

- No sort active: **~0.46 ms/tick**. Fine. Not the problem.
- **One sort column active: ~56 ms/tick.** At 10 updates/s that is 56 % of the main thread spent
  re-sorting rows that did not move; at 100 updates/s it is unachievable.

The dominant contributor is `computeViewIndex` -> `buildViewIndex`, which rebuilds the entire
100k-row index — including a full `Intl.Collator` sort — on every `data` identity change, because
`syncInputsEqual` (correctly, given what it knows) treats a new array reference as "inputs changed".

Secondary contributors, in order: an active filter (2.9 ms), an active search (2.3 ms), the
consumer's own array copy (0.10 ms). Everything else measured flat or negligible — notably the
row/cell memo regime, which is **already correct** under streaming (4 DOM mutations per single-cell
tick, subscriber fan-out flat from 0 to 140 subscribers).

**Design goal: let a caller say "these specific cells changed" so the store can skip derived-state
work the update provably could not have invalidated.**

## 2. Prior art

**MUI X** (verified against vendored source at `references/mui-x`, v9.10.1).
`apiRef.current.updateRows(updates: GridRowModelUpdate[])` — imperative, id-keyed, accepts **partial
row objects** shallow-merged into the existing model (`gridRowsUtils.ts:343-361`), with an
`_action: 'delete'` sentinel for removal. Community plan throws above one row per call; Pro/Premium
lift it. Internally it builds a new rows cache — an O(total rows) object spread **per call**
regardless of how many rows you touched — then calls `throttledRowsChange`. The flush publishes
`rowsSet`, which triggers `applySorting` (full re-sort) and `updateFilteredRows` (full re-filter)
over the whole dataset; there is no partial sort. `throttleRowsMs` (Pro/Premium only, default 0, so
synchronous by default) reduces flush *frequency* with trailing-edge coalescing but does not make
the flush incremental. Their own docs name this as the high-frequency-update remedy. **Takeaway: the
payload shape is good and worth copying; the invalidation strategy is the thing to beat.**

**AG Grid** (desk research against current official docs; API names verified there, internals not).
Two paths with **opposite defaults** — the most useful data point in this section:

- *Transactions*: `api.applyTransaction({add, addIndex, update, remove})` (synchronous) and
  `api.applyTransactionAsync(tx, cb)` (queued, coalesced into a batch flushed after
  `asyncTransactionWaitMillis`, default 50 ms, forceable via `api.flushAsyncTransactions()`). Row
  identity via the initial `getRowId` option — without it AG compares `===` against the original
  objects, which their docs call significantly slower at scale. **By default a transaction DOES
  re-apply grouping/filtering/sorting, so rows move immediately.** The opt-out is
  `suppressModelUpdateAfterUpdateTransaction: true`, explicitly motivated by "prevent data moving
  while the user is in an edit state" — but it silently does nothing if the transaction carries any
  `add` or `remove`.
- *Change detection* (`rowNode.setDataValue`/`updateData`, edits): the grid refreshes only the
  affected cells and explicitly will **not** sort, filter, or group, on the stated rationale that
  moving rows during editing is bad UX. Recovery is the explicit `api.refreshClientSideRowModel(step?)`.

**Takeaway: "a value change refreshes the cell but does not move the row until an explicit refresh"
is established prior art — it is AG's documented behavior for cell-level updates specifically, which
is precisely our streaming case.** Their transaction path chose the opposite default, so this
supports our `"defer"` default for cell patches without claiming AG defers everything. (Names I
could not verify and therefore do not rely on: `suppressSortRefresh`, `deltaSort` — legacy or
nonexistent.)

**Glide Data Grid** (verified against vendored source at `references/glide-data-grid`). Canvas-based,
so data never lives in the grid: the consumer owns storage behind a `getCellContent` callback and
calls `DataEditorRef.updateCells(damageList)` — an array of `{cell: [col, row]}` coordinates — which
forwards straight to the internal `gridRef.current.damage(damageList)`. The grid repaints exactly
those coordinates and recomputes nothing else. Their `rapid-updates` story pushes 5000 damaged cells
per animation frame this way. **Takeaway: the cleanest separation in the field — the write and the
invalidation declaration are two separate things, and the invalidation is a coordinate list.**

**react-data-grid** (desk research against the official README). No transaction or invalidation API
at all: updates are purely controlled `rows` prop replacement. `onRowsChange` is outbound-only (the
grid telling you about internal edits), and `DataGridHandle` exposes only `element`, `scrollToCell`,
and `setActivePosition` — nothing for data. Invalidation granularity is therefore plain React memo:
their documented guidance is "create a new array but reuse unchanged row objects," and they warn
that changing the array reference alone still triggers viewport/layout recalculation. **Takeaway:
this is exactly our current structural position — and their documented floor (array-reference change
always costs something) matches what we measured at 0.46 ms/tick.**

Common thread: **every library that supports streaming at scale exposes an imperative, id-keyed,
batched entry point separate from the declarative data prop, and none of them re-sorts synchronously
per update.**

## 3. Proposed API

### 3.1 Store action

```ts
/** One targeted cell write, addressed by STABLE ROW ID (never a view or data index). */
export type CellPatch = {
  rowId: string;
  columnId: string;
  value: unknown;
};

/** Options for {@link DataGridActions.updateCells}. */
export type UpdateCellsOptions = {
  /**
   * How this batch interacts with an active sort/filter. Default `"defer"`.
   * - `"defer"`   — values update in place; rows keep their current view position. The view
   *                 reconciles on the next natural recompute (sort/filter/search change, or an
   *                 explicit `reconcileView()`).
   * - `"immediate"`— rebuild the view index now. Correct ordering, full O(n log n) cost.
   * - `"never"`   — like `"defer"` but never marks the view stale (for columns that are not
   *                 sort/filter inputs — the caller asserts this).
   */
  reorder?: "defer" | "immediate" | "never";
  /** DataChange source tag; defaults to `"stream"`. */
  source?: DataChange<unknown>["source"];
  /** Skip per-column `validate`. Default false. */
  skipValidation?: boolean;
};

updateCells(patches: readonly CellPatch[], options?: UpdateCellsOptions): void;

/** Whole-row variant: shallow-merges a partial row, MUI-style. Same options. */
updateRows(updates: readonly { rowId: string; changes: Record<string, unknown> }[], options?: UpdateCellsOptions): void;

/** Forces the deferred view reconcile (re-sort/re-filter) that `reorder: "defer"` postponed. */
reconcileView(): void;

/** True when ≥1 deferred patch has landed since the last reconcile — for a "re-sort" affordance. */
// exposed as a hook: useDataGridViewStale(): boolean
```

Three lines, for the exec summary: **`updateCells(patches, opts)` takes rowId-keyed
`{rowId, columnId, value}` patches, applies them to `data` in one `set()`, and skips
`computeViewIndex`/`computeSearchMatches` entirely. Sort/filter reconciliation defaults to
`"defer"` (rows hold position, a `viewStale` flag flips) with `"immediate"` available per call.
It works in both controlled and uncontrolled mode, emitting one batched `DataChange` through
`onDataChange` exactly like every other mutation path.**

### 3.2 Why rowId-keyed, not coordinate-keyed

Glide uses coordinates because its data lives outside the grid. Ours lives inside, and the whole
point is surviving an active sort — under which view coordinates are exactly what a streaming
producer cannot know. Row ids are also what our `DataOp` already uses ("Ops are id-keyed so history
survives sort/filter (never index-keyed)", `types.ts:129`), so this is consistent with the existing
contract rather than a new addressing scheme.

Cost: id -> data-index resolution. Measured **10.1 ms** to build a 100k-entry `Map` once. That must
be a **cached index maintained by the store**, invalidated on insert/delete/data-replacement — not
rebuilt per call, or we reintroduce an O(n) per-tick cost and lose the whole benefit. This is the
single most important implementation detail in this document.

### 3.3 Controlled vs uncontrolled — the decision

**Decision: support both, with the same semantics as every other mutation action already in the
store.** Not uncontrolled-only.

Justification: this is not a new problem. `commitCellEdit`, `applyCellUpdates`, `deleteSelection`,
`insertRow`, `deleteRows`, and `duplicateRows` all already face it, and they all resolve it the same
way — compute `nextData`, call `s.onDataChange?.(nextData, change)`, then `set({data: nextData})`.
In controlled mode the consumer's own `data` prop then flows back through `_syncProps`; because the
store already holds the identical array, `syncInputsEqual` fails on identity but the subsequent
`computeViewIndex` returns the previous array via its content-equality reuse, so subscribers do not
re-render. Inventing a different ownership rule for `updateCells` would make it the one mutation
path that behaves unlike the rest.

The honest caveat that must be documented: **in controlled mode the round-trip is only as cheap as
the consumer makes it.** If the consumer stores the array in React state and re-renders, they pay
`_syncProps` — and with a sort active, `computeViewIndex` runs and the 56 ms cliff returns. So the
controlled contract needs an explicit escape: `_syncProps` must recognize an array it just emitted
itself and skip the recompute. Concretely, the store stamps the array identity it produced; on the
next sync, `nextData === lastEmittedData` means "this is my own echo" -> reuse `viewIndex`,
`searchMatches`, and `visibleColumns` wholesale. Without this, the controlled path keeps the cliff
and the API only helps uncontrolled consumers. **This is a required part of the build, not an
optimization.**

Uncontrolled (`defaultData`) mode has no round-trip at all and gets the full benefit immediately.

### 3.4 Sort/filter interaction — the decision

**Decision: default `"defer"`. Rows keep their view position when an updated value would change
their sort order; a `viewStale` flag flips; `reconcileView()` (or any natural sort/filter/search
change) resolves it.**

Justification, in priority order:

1. **Measured necessity.** `"immediate"` costs 26 ms of `buildViewIndex` at 100k rows and cannot be
   made cheap without an incremental sort (see Risks). Defaulting to it would mean the API's
   headline scenario — streaming under a sort — is still broken, which is the entire reason the API
   exists.
2. **Prior art supports it for cell-level updates specifically.** AG Grid's change-detection path —
   its cell-level update path, the direct analogue of ours — explicitly does not sort/filter/group,
   on the stated rationale that moving rows during editing is bad UX; recovery is an explicit
   `refreshClientSideRowModel`. (Its *transaction* path defaults the other way, so this is support,
   not unanimity.) MUI X, by contrast, re-sorts the entire dataset on every flush and its own docs
   then have to recommend `throttleRowsMs` to make high-frequency updates survivable. We prefer the
   design that does not need a throttle to be usable.
3. **UX.** A row jumping out from under the pointer mid-interaction is worse than a stale ordering,
   especially for a ticker where "the price cell updates in place" is the expected behavior. A
   visible "re-sort" affordance driven by `viewStale` gives the user control.

`"immediate"` stays available per call for correctness-critical batches. `"never"` is the fast path
for the common ticker case where the streaming column is not a sort or filter input — the store can
verify this cheaply (is `columnId` in `sortState` or `filterState`?) and should **downgrade
`"defer"` to `"never"` automatically** when no touched column participates in the active sort or
filter, so the flag does not flip spuriously.

Search: `searchMatches` genuinely can go stale on a value change. Since search never narrows
`viewIndex` (it only highlights — `compute.ts:179`), a stale highlight is cosmetic. Recompute it on
the deferred reconcile, not per patch. Measured cost when active: 2.3 ms — worth deferring.

### 3.5 Validation

Follow the existing bulk pattern exactly: `computeRowEditsBatch` runs `runValidateSync` per write
and **silently skips** cells that fail, rather than aborting the batch or surfacing an error
(`commit.ts:140-186`, and `validation/validate-cell.ts:40`). A streaming batch must never reject
wholesale because one value was bad, and it has no UI surface to report a rejection to.
`skipValidation: true` is offered because per-cell validation on a 200-cell/tick stream is pure
overhead when the producer is trusted (e.g. a server feed that already validated).

Async Standard Schema validators are already documented as unsupported on bulk paths and warn
(`validate-cell.ts:62`); streaming inherits that, unchanged.

### 3.6 Undo / history

**Decision: streaming changes are excluded from history by default.**

`useDataGridHistory`'s `onDataChange` pushes **every** change unconditionally
(`use-data-grid-history.ts:53-60`). At 100/s a stream would evict the entire user-meaningful undo
stack within seconds — capacity is finite and oldest entries drop. That is a correctness bug, not a
tuning problem.

Mechanism: add `"stream"` to the `DataChange["source"]` union (`types.ts:146`) and have
`useDataGridHistory` skip `source === "stream"` by default, with an opt-in
(`recordSources?: DataChange["source"][]`) for consumers who genuinely want it. Callers who want a
streaming batch to be undoable pass an explicit `source: "edit"` (or similar) via
`UpdateCellsOptions.source`.

This is an add-on change plus one union member in core; it does not alter any existing source's
behavior.

### 3.7 Invalidation strategy — what must bust and what must NOT

Must bust:

- `data` (new array identity — required; the row-level subscription in `useDataGridRow` reads
  `s.data[dataRowIndex]`, so touched rows need new identities to re-render).
- Touched row objects (new identity via `setCellValue`, exactly as `computeRowEditsBatch` does).
- The cached `rowId -> dataIndex` map: **only** on insert/delete/whole-array replacement. A value
  patch never changes it.

Must **NOT** bust (these are the zero-render contracts the measurements confirmed are working, and
breaking any of them re-introduces cost the API exists to remove):

- `viewIndex` identity — unchanged under `"defer"`/`"never"`. This is the whole optimization.
- `visibleColumns`, `columnWidths`, `columnOrder`, `hiddenColumns` — untouched by a value write.
- `selection`, `activeCell`, `editing` — **`updateCells` must not move the selection.** Note
  `applyCellUpdates` deliberately *does* move it (paste's anchored-expand result,
  `create-store.ts:436-455`); streaming must not inherit that. This is the main reason to add a new
  action rather than reuse `applyCellUpdates`.
- `searchMatchSet` / `searchMatchRows` identity under `"defer"` — a stale highlight is acceptable;
  reallocating these forces every row's `useDataGridRowCellState` comparator to re-run.
- `labels`, `keymap`, `cellTypes`, `overlayPlugins`, `rowBands` — untouched.
- The scroll CSS-var path — completely independent; streaming must never trigger a window recompute.

Untouched rows keep object identity, so `DataGridRow`'s memo and `useDataGridRow`'s per-row
subscription drop them without a render. Measured today: 4 DOM mutations per single-cell tick. That
number is the regression bar.

## 4. Projected improvement

From the measured cost breakdown:

| Scenario, 100k rows | Today | Projected | Basis |
| --- | --- | --- | --- |
| 20 cells, no sort | 0.46 ms | ~0.10-0.15 ms | measured targeted patch 0.09-0.10 ms |
| 20 cells, **one sort column** | **56 ms** | **~0.15 ms** | skips the 26 ms `buildViewIndex`; measured store-arm A/B was 28 ms -> 0.09 ms (**317x**) |
| 200 cells, no sort | ~0.5 ms | ~0.2 ms | patch cost scales with touched cells, not row count |

The headline claim for the build lane: **streaming under an active sort goes from ~18 ticks/s
maximum (56 ms each, saturating the main thread) to comfortably >100 ticks/s.** The unsorted case
improves ~3-4x but was already acceptable — do not oversell it.

Caveat carried forward from the research doc: the 317x figure is a store-level arm. End-to-end will
be lower because paint and the consumer's own work remain. The sorted end-to-end number (56.3 ms,
prod) is the one to beat, and beating it requires the controlled-mode echo detection in §3.3.

## 5. Perf targets for the build lane

Production build, 100k rows, 8 columns, measured with batched timing (per the research doc's
clamping note):

| Target | Bar |
| --- | --- |
| 100 scattered updates/s, no sort, idle | ≥55 fps sustained; ≤2 ms/tick |
| 100 scattered updates/s, **one sort column**, `reorder: "defer"` | ≥55 fps sustained; **≤3 ms/tick** |
| 20 updates/s + simultaneous slow scroll | ≥55 fps; no regression vs the scroll-only arm beyond 15 % |
| DOM mutations per single-cell tick | ≤6 (today: 4) — the wasted-render regression bar |
| `reorder: "immediate"` at 100k with a sort | may stay ~30 ms — documented, not a target |
| Memory | no steady-state heap growth over 10k ticks |

Explicit non-target: making `"immediate"` fast. That needs incremental sort maintenance and is out
of scope (see Risks).

## 6. Test strategy

Unit (jsdom, `--project=unit`):

- Patch application: id resolution, unknown `rowId` ignored, unknown `columnId` ignored, readOnly
  columns skipped, no-op values (`Object.is`) skipped, duplicate patches to the same cell dedupe
  last-write-wins — mirroring the existing `computeRowEditsBatch` test surface.
- One batched `DataChange` emitted per call with `source: "stream"`, id-keyed ops, correct `prev`.
- `viewIndex` identity **preserved** under `"defer"`/`"never"`; **changed** under `"immediate"` when
  ordering actually changes.
- `viewStale` flips only when a touched column participates in the active sort/filter, not otherwise.
- Selection/activeCell/editing untouched by `updateCells` (explicitly contrasted with
  `applyCellUpdates`, which moves selection by design).
- Controlled echo: `_syncProps` with the array the store just emitted reuses `viewIndex`.
- History: `source: "stream"` not recorded by default; recorded when opted in.
- The id-index cache: correct after insert/delete/duplicate/full replacement.

Browser (`--project=browser`) — required per the browser-testing gate (jsdom missed the 100k freeze):

- 100k rows, 100 updates/s, unsorted and sorted, asserting ms/tick against §5.
- Wasted-render probe: DOM mutation count per tick stays ≤6.
- Streaming + slow scroll concurrently, FPS floor.
- Streaming while a cell is in edit mode — the editor must not lose focus or content.

Follow the fling report's discipline: pair arms within one launch, medians over ≥5 launches for any
headline, prod build for headline numbers only.

## 7. Risks

1. **Stale ordering is user-visible.** Under `"defer"` with a sort on the streaming column, the
   displayed order silently drifts from the data. Mitigation: auto-downgrade to `"never"` when no
   touched column participates; expose `viewStale` so the UI can offer a re-sort. Residual risk:
   consumers who ignore the flag ship a subtly wrong-looking grid. Documentation burden is real.
2. **The id-index cache is a new invariant with real bug surface.** Every mutation path
   (insert/delete/duplicate/controlled replacement) must invalidate it correctly, or patches land on
   the wrong rows — a silent data-corruption class of bug, the worst kind here. Needs exhaustive
   unit coverage and arguably a dev-mode assertion that re-derives and compares.
3. **Controlled-mode echo detection is subtle.** Identity-stamping the emitted array is simple, but
   interacts with consumers who transform the array before storing it (map/filter/immer). Those
   consumers silently fall back to the slow path. Needs a documented "pass it through unchanged for
   the fast path" contract, and possibly a dev warning when the echo check fails repeatedly.
4. **`"immediate"` remains slow** — 26 ms at 100k. Incremental sort maintenance (binary-search
   reinsertion of moved rows) would fix it but is a substantially larger project with its own
   correctness risk around the stable-sort tiebreak (`buildViewIndex` relies on decorate-sort-
   undecorate with a position tiebreak). Explicitly out of scope; document the cost.
5. **API surface growth.** Three new actions plus a hook plus a `DataChange` source, on a store that
   already has a large action surface. `updateRows` is arguably redundant with `updateCells` — worth
   considering shipping only `updateCells` first and adding `updateRows` if demand appears. (Cutting
   it is the ponytail-correct call; MUI's partial-row shape is convenient but not load-bearing.)
6. **The unsorted win is small.** ~0.46 -> ~0.15 ms. If the build lane is justified on "streaming is
   slow" generally rather than "streaming under a sort is broken", it will underdeliver. The
   go/no-go should rest on whether sorted streaming is a real requirement.

## 8. Recommendation

Build it **if** streaming-under-sort is a real use case; the 56 ms -> ~0.15 ms projection is a
genuine capability change and no reasonable amount of tuning fixes it otherwise. If consumers only
ever stream into unsorted grids, the current path is already ~0.46 ms/tick in production and this is
not worth the id-cache risk surface.

Sequence, if green-lit: (1) id-index cache + `updateCells` with `"never"`/`"defer"` only, (2)
controlled-mode echo detection, (3) `viewStale` + `reconcileView`, (4) history source exclusion,
(5) `"immediate"` and optionally `updateRows`.
