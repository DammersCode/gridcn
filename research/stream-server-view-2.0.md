# Push updates into a server-ordered view (S5), and the S6 check

Decision record for draft S5 of `research/server-side-review-2026-10.md`, on the engine of
`research/api-cohesion-2.0.md` (D2, D3, D6) and `research/fetch-hygiene-2.0.md`. Files:
`registry/default/blocks/data-grid/store/*`, `row.tsx`, `data-attributes.ts`, `registry/default/blocks/data-grid-server/*`.

## 0. Verified state

| Concern | Today | Where |
|---|---|---|
| Push of cell values | `updateCells` / `updateRows` by row id, one `set()`, `source: "stream"`, never reaches `onSave` | `store/data-write.ts:1019-1102`, `data-write.ts:124` |
| Push under a server sort or filter | `viewSorts` / `viewFilters` are empty in server modes, so `resolveReorder` ends at `"never"`: the value lands in place, `viewStale` stays `false`, no signal | `data-write.ts:1056`, `touchesViewInputs` at `data-write.ts:239` |
| Push of a delete | no stream path: `deleteRowsById` tags `"row-operation"`, runs `onBeforeDeleteRows`, reaches `onSave` (an echo to the server) | `data-write.ts:615-623,1150` |
| Push of an insert | no path: an `insert` operation needs a data index the client cannot know under a server sort | `types.ts:193` |
| Push on a `readOnly` grid or a read-only column | silent no-op / skip reason `"readonly"` | `data-write.ts:1021`, `commit.ts:329` |
| Push to a row with a save in flight | lands; a later rollback reverts only cells that still hold the written value, so the push wins | `interaction/rollback.ts:48-65` |
| Push to an unloaded row | skip reason `"unknown-row"` (hole: no row id) | `commit.ts:312` |
| Refresh guard | ignores `"stream"` for structural and unacknowledged tracking; a pushed row is not protected, so an in-flight answer older than the push overwrites it | `refresh-guard.tsx:60-72` |
| Hook merge | pages: `setSettled(rows)`; scroll: `applyChange` replay, any non-update operation refreshes the rendered blocks on the next frame; sequential: `followRowOperations` shifts the offset | `use-data-grid-server-rows.ts:418`, `scroll-blocks.ts:920-950` |
| Foreign `data` sync | clears `viewStale` | `create-store.ts:1078` |

## 1. S6 is complete

No S6 work remains. Evidence:

- Per-block failure state: `core.failed` keyed by block (`scroll-blocks.ts:162,598`); the failed block returns to holes.
- `retry()` repeats the failed blocks only, through the `owed` queue behind the concurrency cap
  (`scroll-blocks.ts:796-809`; tests `scroll.test.tsx:238`, `sequence.test.tsx:254`, `hygiene.test.tsx:319`).
- A failure outside the keep range is forgotten and the error clears (`scroll-blocks.ts:697-703`; `hygiene.test.tsx:133,144`).
- The root renders `ErrorBar` (`role="alert"`, Retry button, text node only) as a full-body state with zero rows and a slim
  bar with rows (`root.tsx:679-702,806-822`); `rootProps` rides in `gridProps` (`scroll-blocks.ts:972`); browser tests
  `scroll.browser.test.tsx:179,201`; pages `use-data-grid-server-rows.test.ts:97`; prefetch failure is silent (`prefetch.test.tsx:215`).
- Parity row `error-state` is `supported` in PS, Z, C, SS, FS, API.

Kept as is: a failed block's rows render as skeletons, like loading rows. The bar names the failure; a per-row error state
adds a render branch to every cell.

## 2. Decisions

### 2.1 Who evaluates

The server. In server modes the client never tests a pushed row against a sort, filter, or search. The client knows only
which columns the spec reads, from `sortState`, `filterState`, and `searchText` in the store.

### 2.2 Stale rows (core, every server mode)

A **stale row** is a loaded row that a push changed in a column the server spec reads. "Reads" means:

- `sortMode="server"`: a column of an active sort entry.
- `filterMode="server"`: a column of the filter tree, and every column while `searchText` is not empty (the server may filter by search).

`updateCells` / `updateRows` under a server spec:

| `reorder` | Behavior |
|---|---|
| `"defer"` (default) | Values land in place. Touched rows join the stale set; `viewStale` is `true` while the set is not empty. |
| `"immediate"` | As `"defer"`, then a reshape on the next frame (bypasses `reshapeDelay`). Without the hook: dev warning once per grid, marks only. |
| `"never"` | Values land in place, no mark. |

Reason for the default: it is the client-mode default too; a row that jumps mid-read is worse than a marked row.

- The row element (`role="row"`) gets `data-row-stale=""`, registered in `data-attributes.ts`. No default style: the
  consumer styles it (`[&_[data-row-stale]]:text-muted-foreground`). The row selects `staleRowIds.has(rowId)`; a batch
  that adds no new id keeps the set's identity, so a ticker re-renders only patched rows.
- A stale id leaves the set when: a foreign `data` sync delivers a different row object for that id, or the id leaves
  `data` (page change, eviction, delete); the spec changes; `reconcileView()` runs with no reshape handler. The prune
  replaces today's "foreign sync clears `viewStale`" in server modes and costs O(stale rows).
- `reconcileView()` under a server spec calls the reshape handler that the server-rows hook registers through its guard
  plugin (internal store field, not a prop). With a handler the marks stay until the answers re-deliver the rows; the
  streaming docs' "Re-sort" bar works unchanged on a server grid. A failed reshape keeps the marks and shows the error bar.
- Client modes (L, PC) keep today's `defer` / `immediate` / `never` behavior exactly.

### 2.3 Reshape (server-rows hook)

A **reshape** is a `refresh()` that the hook runs after a push, so the server places the rows again. The request is the
plain refresh request: `{ spec, start, end, cursor, signal }` (+ `page`, `pageSize`). The server sees no new field.

| Trigger | Without `reshapeDelay` | With `reshapeDelay` |
|---|---|---|
| Stale row from a `"defer"` push | no request (marks only) | one reshape after the delay |
| Stream delete (2.5), `reshape()` call, `"immediate"` push, `reconcileView()` | one reshape on the next frame | after the delay; `"immediate"` and `reconcileView()` on the next frame |

- Option `reshapeDelay?: number` on both modes (ms, off by default, at least 250; a lower value clamps with a dev warning
  once). Off by default because a refetch per feed burst is server load the consumer decides on.
- The delay is a throttle, not a debounce: the first trigger starts the timer, later triggers join it, so a steady feed
  reshapes at most once per delay. A debounce never fires under a steady feed.
- Busy rule from revalidation: a timer that fires while a request is open waits and runs once when it settles. A trigger
  during the reshape request starts the next timer.
- The timer waits while the document is hidden and runs once on the next `visibilitychange` to visible.
- A reshape restarts the revalidation clock (every refresh does). A spec change, page size change, or `refresh()` call
  cancels the pending timer: they refetch anyway.
- Result field `reshape: () => void`, stable. It is the only push path for inserts (2.6). Calls in one frame join.
- Sequential sources: a reshape follows the revalidation tick rule (skipped while the rendered rows end beyond 10 blocks).

### 2.4 Pushes and the refresh guard

A push is not a save: it never enters `savedAt`, `structural`, or `unacknowledged`.

| Case | Rule | Reason |
|---|---|---|
| Push to a row whose save is in flight (`saveStatus` `"saving"`) | skip, new reason `"saving"`, all modes | the same row-level rule as an answer; the feed cannot order its event against our save |
| Push to a row under an open edit session | lands; the editor keeps its draft (today's contract) | a feed never pulls the grid from the user |
| Push while a request is open | the guard records the pushed cells by row id; when an answer that holds the row lands, the pushed cells overlay the answer's row | the answer can predate the push; overlay costs no request, a re-request loops under a steady feed |
| Push of a stream delete while a request is open | the id goes into `deleted` (`trackDeletes`), so the answer's copy is dropped; `pruneIds` clears it at the landing | an older answer must not bring a deleted row back |
| Push to an evicted or unloaded row | skip `"unknown-row"`; the next block brings the server value | no buffer for rows the client does not hold |
| Duplicate patches in one batch | last patch per cell wins (`commit.ts:283`) | unchanged |
| A row id twice in `data` | the first row wins (row index) | unchanged |

The overlay record is a `Map<rowId, Map<columnId, value>>`, written only while a request is open and dropped when none is
open (as `savedAt`). Limit: an answer that overlays a pushed sort column removes the stale mark (new row object); the
next push or reshape marks it again.

### 2.5 Stream deletes

`deleteRowsById(rowIds, options?: { source?: "row-operation" | "stream" })`, default `"row-operation"`. A `"stream"`
delete skips `onBeforeDeleteRows`, `onSave`, and history (history skips `"stream"`), unchecks the rows, and removes them
from the remembered checked rows. `"all matching"` keeps its `excludedIds`; the server owns that row count.

### 2.6 Inserts

No client placement in server modes: the client cannot know the position. The consumer calls `server.reshape()` when the
server reports a new row. Client modes keep `commitChange` with an `insert` operation, as today.

### 2.7 Row count

The server owns `totalRowCount`. The client never changes it for a push; the reshape answer carries it. Between a stream
delete and its reshape, the row count can be off by the deleted rows. Sequential sources keep their loaded-length
adjustment (`followRowOperations`), which tracks the number of loaded rows only.

Offset sequential sources: a pushed insert or delete shifts server positions, so a block can repeat or skip a row until
the next refresh. This is the documented exception for local row operations; cursor sources are not affected.

### 2.8 Bounds on pushed data

Pushed data is untrusted network input.

- `MAX_STREAM_PATCHES = 100_000` per `"stream"` call (`updateRows` counts expanded patches; `deleteRowsById` counts ids).
  The rest skip with new reason `"limit"`; dev warning once per grid. Other sources keep their own bounds (find and replace).
- Row and column ids resolve through `Map` lookups only: a non-string id or `__proto__` skips as `"unknown-row"` /
  `"unknown-column"`. `validate` runs unless `skipValidation`. Display, copy, and export read through `toSafeText`.

### 2.9 Read-only grids and columns

A `"stream"` batch writes into a `readOnly` grid, a read-only column, and a read-only row. Reason: `readOnly` stops user
edits; the server stays the source of truth, and read-only live views are the main push consumers. `source: "edit"` or
any user source keeps every read-only check. Undo and redo of `"stream"` entries (only with `recordSources`) keep the
read-only check, because the user starts them.

### 2.10 Pages mode

Pushes update the current page in place and mark stale rows. A reshape refetches the current page with the current
spec; a row that the server moves to another page leaves it, and the active cell follows the row-id anchor rules. A
stream delete leaves the page one row short until its reshape. A reshape drops the prefetch (refresh does); a stale push
alone does not. A push to a prefetched page's row is skipped (`"unknown-row"`); the prefetch expiry bounds that age.

### 2.11 Accessibility

No announcement per push: a feed at 100 updates per second floods the reader. One polite announcement when `viewStale`
turns `true`, at most once per 30 s per grid, in every mode: label `grid.viewStale`, "Some rows changed and may no
longer match the sort or filter." `data-row-stale` carries no ARIA state.

### 2.12 Batching of pushes

The grid adds no timer to `updateCells`: the store write stays synchronous, so a later read sees the push, and deferring
the hook's React state behind the store lets a re-render hand the store an older `data`. The docs show a frame buffer
that calls `updateRows` once per frame with the messages of that frame. `reshapeDelay` batches the network side.

## 3. Modes

| Mode | Touched | Behavior |
|---|---|---|
| L | yes | `"saving"` skip, `"limit"`, read-only write-through, stale announcement. Stale rows: n/a, the client sorts itself. |
| PC | yes | as L |
| PS | yes | stale rows, reshape, overlay, stream delete reshape, prefetch drop |
| Z | yes | random access: as PS, a stream delete replaces today's next-frame refresh with the reshape rule; sequential: offset shift, revalidation skip rule |
| C | yes | stale rows and prune on the consumer's own `data`; `reconcileView()` clears marks; the consumer refetches |
| SS | yes | sort columns mark |
| FS | yes | filter columns mark; any column with `searchText` |
| API | yes | `onSave` never sees `"stream"` (unchanged), stream deletes stay out of `onSave` |

## 4. Races (each gets a test)

| Race | Rule |
|---|---|
| Spec change with a reshape timer pending | timer cancelled; the spec change clears the marks and refetches |
| Spec change with pushes in the same tick | pushes land in the old rows; the new answer replaces them; overlay applies to pushes after the new request started |
| Unmount | timer, frame, and visibility listener removed |
| StrictMode double mount | one reshape per delay; handler registered once (the guard plugin's `Mount`) |
| Push during refresh, revalidation, retry, or prefetch | overlay (2.4); stream delete via `deleted` |
| Push after eviction | `"unknown-row"`; eviction prunes the stale ids |
| Push with an async `validate` held | today's supersession rule; the overlay records the accepted cells when they commit |
| Reshape fails | marks stay, error bar, `retry()` repeats the reshape's blocks |

## 5. Tests (fake timers, `requestAnimationFrame` faked, input dispatched synchronously)

Core, client path and server path:

1. Server sort: a push to the sort column sets `data-row-stale` and `viewStale`; a push to another column does not.
2. Server filter: a filter column marks; with `searchText`, any column marks; with no filter, nothing marks.
3. `"never"` marks nothing; `"immediate"` without the hook marks and warns once.
4. Prune: a new row object for the id unmarks, the same object keeps the mark, a removed id unmarks, a spec change clears.
5. `reconcileView()`: no handler clears; with handler calls it once, marks stay until re-delivered.
6. Client sort regression: `defer`, `immediate`, and `never` give today's order and flags.
7. A push to a `"saving"` row skips with `"saving"`, lands after the save settles (client data and `onSave` mock).
8. 100,001 stream patches: the last skips with `"limit"`, one warning.
9. Stream delete: no `onBeforeDeleteRows`, no `onSave`, no history entry, row unchecked.
10. Read-only: stream lands in a `readOnly` grid and column; `source: "edit"` skips.
11. Announcement: once on the transition, silent for 30 s, again after.

Hook, server path:

12. Pages, delay 1000: pushes at 0, 400, 900 ms give one request at 1000 ms; a push during it starts the next timer.
13. No delay: stale pushes send nothing; a stream delete sends one request next frame; three `reshape()` calls in one frame send one.
14. Scroll random: the reshape request equals the refresh request (spec, `start`, `end`); stream delete follows the delay.
15. Sequential: stream delete shifts the offset by one; a reshape beyond 10 blocks is skipped.
16. Overlay: push after the request started survives the answer; push before it was sent loses to the answer.
17. Stream delete during an in-flight answer that holds the row: the row stays gone.
18. Spec change cancels the timer; unmount clears it; StrictMode sends one request per delay; hidden document defers.
19. `reshapeDelay: 100` clamps to 250 and warns once.

Browser: `data-grid-server-side-demo` shows `data-row-stale` on a pushed row and moves it after the reshape.

## 6. Docs, changelog, parity, demo

- `GLOSSARY.md` first: **push** (a change your code writes from the server: `updateCells`, `updateRows`, or
  `deleteRowsById` with `source: "stream"`), **stale row**, **reshape**.
- `content/docs/streaming-updates.mdx`: a section "Server-sorted and filtered views" under its heading with
  `<NewBadge />`; verdict list rows `saving` and `limit`; the read-only paragraph; the frame buffer sample.
- Server rows pages (`lazy-loading.mdx`, `examples/data/server-side.mdx`): rows `reshapeDelay` and `reshape` in the
  props tables; a "Pushes" section with the trigger table. `row-operations.mdx`: `deleteRowsById` options row.
- `CHANGELOG.md` `## Unreleased`:
  - `**Breaking:** \`updateCells\` and \`updateRows\` skip a row whose save is in flight, with reason \`"saving"\`. Push the value again after the save settles.`
  - `**Breaking:** a \`source: "stream"\` batch writes into a \`readOnly\` grid and into read-only columns and rows. Pass \`source: "edit"\` to keep the read-only checks.`
  - `**Breaking:** a \`source: "stream"\` call takes at most 100,000 patches; the rest skip with reason \`"limit"\`.`
  - Added: under a server sort or filter, a push that changes a column the spec reads marks the row with
    `data-row-stale` and sets `viewStale`; `reconcileView()` asks `useDataGridServerRows` to refetch.
  - Added: `reshapeDelay` and `reshape()` on `useDataGridServerRows`; `deleteRowsById(ids, { source: "stream" })`.
  - Added: one live-region announcement when the view turns stale.
- Parity: row `streaming` gets the new test paths for PS, Z, C, SS, FS. New row `push-reshape`, options
  `reshapeDelay`: L and PC `n/a` ("the client sorts and filters itself"), PS, Z, SS, FS, API `supported`, C `supported`
  (marks only, the consumer refetches). Then `node scripts/verify-parity.mjs --write`.
- Demo: extend `data-grid-server-side-demo` (no new demo): a "Live updates" switch that pushes price changes every
  500 ms from a feed child inside the provider, a "Delete on server" button (stream delete), a `reshapeDelay` select
  (off, 1 s), and the stale row style on the root `className`. Check it with `--radius 0` and `1rem`, a tinted primary,
  and a larger base font.

## 7. Non-goals

- A client sort or filter test of pushed rows in server modes.
- Client placement of pushed inserts; buffering pushes for unloaded rows or for the prefetched page.
- A push transport (socket, server-sent events) or a merge-by-id buffer helper in the library.
- Re-marking a row stale when the overlay keeps a pushed sort value.
- A per-row failed state for S6.

## 8. Implementation order (each step test-first, all gates green before the next)

1. `GLOSSARY.md` terms (6).
2. Core spec columns: `serverSpecColumns(s)` and the server branch of `resolveReorder` / `touchesViewInputs`; the stale
   set, `viewStale` from it, the prune on foreign syncs, the spec-change clear. Tests 1-4, 6.
3. `data-row-stale` on `row.tsx`, registered in `data-attributes.ts`; 100k scroll perf test unchanged (`ccc daemon stop` first).
4. Internal reshape handler slot; `reconcileView()` and `"immediate"` in server modes; dev warning. Tests 3, 5.
5. `"saving"` skip (test 7), then `MAX_STREAM_PATCHES` (test 8), then read-only write-through (test 10): one commit each.
6. `deleteRowsById` options (test 9).
7. Stale announcement and `grid.viewStale` label (test 11).
8. Hook: `useReshape` in `fetch-hygiene.ts` (throttle, busy wait, visibility, clamp), `reshapeDelay`, `reshape()`,
   handler registration in the guard plugin, stream delete trigger replacing the next-frame refresh. Tests 12-15, 18-19.
9. Guard overlay and stream deletes in `deleted` (tests 16-17); property test in `refresh-guard.property.test.tsx` gains a push action.
10. Docs, `CHANGELOG.md`, parity row, demo and its browser test, `pnpm registry:build`,
    `node scripts/normalize-payload-eol.mjs`, `pnpm registry:verify`, `pnpm test:e2e-install`.
