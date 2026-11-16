# Fetch hygiene for 2.0: load delay, abort, concurrency, eviction, revalidation, page prefetch

Decision record for drafts S2 and S3 of `research/server-side-review-2026-10.md` and a page prefetch, on the
one engine of `research/api-cohesion-2.0.md` (D2, D3, D6). Files: `registry/default/blocks/data-grid-server/*`.

## 0. Verified state of the engine

| Concern | Today | Where |
|---|---|---|
| `refresh()`, `retry()`, `status`, `loading`, `error`, `evict`, `getLoadedRanges` | exist in both modes (evict, getLoadedRanges: scroll only) | `scroll-blocks.ts`, `use-data-grid-server-rows.ts` |
| One commit of `data` per frame | exists (`commitOnFrame`), pinned by the 100k browser test | `scroll-blocks.ts:194`, `*.scroll.browser.test.tsx:300` |
| Abort | on spec change, count change (all but the landing block), refresh, unmount only | `abortRequests`, `abortRequestsExcept` |
| Rendered rows that move | start every uncovered block at once, no cap, no delay | `onRenderedRowsChange` |
| Loaded rows | kept until a spec change, count change, refresh, or manual `evict` | `core.loaded` |
| Manual `evict` | ignores the refresh guard; an in-flight block in the range still lands | `evict` |
| Sequential source | one request at a time by construction | `onRenderedRowsChange` (`inFlight.size > 0` returns) |
| Pages mode | one request per state; a newer state aborts the older one | `usePagesRows` effect |
| Interval refresh, page prefetch | none | |

## 1. Terms (add to `GLOSSARY.md` first)

- **wanted range**: the rendered rows grown by `overscan` on each side and rounded out to blocks (`expandRange`).
- **keep range**: the wanted range grown by one more block on each side. Abort and eviction act outside it only;
  the extra block stops abort and refetch churn when the rendered rows sit on a block edge.
- **eviction**: unloading loaded rows back to holes. **revalidation**: a `refresh()` the hook runs on a timer.
- **prefetch**: the pages-mode request for the page after the current one, made before the user asks for it.
  Docs say "rendered rows", never "visible window" (the glossary replaces it).

## 2. S2: scroll-mode fetch limits

New options on `UseDataGridServerRowsScrollOptions` only. All optional; the hook still works with `{ mode, getRowId, fetchRows }`.

| Option | Default | Reason |
|---|---|---|
| `loadDelay` | `100` (ms) | longer than the 16-50 ms a thumb drag spends on each block, shorter than the ~150 ms where a delay reads as lag |
| `maxConcurrentFetches` | `3` | the wanted range at the defaults spans up to 3 blocks, so a resting view loads in one round trip; leaves 3 of the 6 HTTP/1.1 sockets per origin for saves and filter values |
| `maxLoadedRows` | `10_000` | 200 blocks of 50; 10% of the 100k target; far above any keep range, so eviction never touches what the user sees |

Validation (options are developer input; bad values fall back, never throw), in one pure `readFetchLimits(options, blockSize)`:
- `loadDelay`: finite number, floored, clamped to `[0, 2000]`; anything else is `100`. `0` keeps today's synchronous start.
- `maxConcurrentFetches`: finite number, floored, clamped to `[1, 16]`; anything else is `3`.
- `maxLoadedRows`: `Infinity` turns eviction off; a finite number is floored and raised to at least `blockSize`;
  `NaN`, a negative number, or a non-number is `10_000` with a dev warning once per instance (a proven misuse).
- Read the values live (`live.current.options`) on each use, like `blockSize` today.

### 2.1 Load delay (per block, not per scroll)

A block of the wanted range starts when it has stayed in the wanted range for `loadDelay` ms without a break.
`core.wanted: Map<blockStart, since>` holds the uncovered blocks of the current wanted range. Each rendered-rows
report drops the entries that left the wanted range, adds new ones with `now`, and arms one timer for the earliest
due entry. The timer starts the due blocks that are still uncovered, within the concurrency cap.
- A thumb drag never rests on a block for 100 ms, so it starts no request until it stops. A slow wheel scroll keeps
  the next block in the overscan continuously, so that block starts 100 ms after it enters: nothing starves.
- The map holds at most the blocks of one wanted range (about 5 at the defaults).
- These requests skip the delay: block 0 (it already waits one tick), `refresh()`, `retry()`, the refetch after the
  first answer or a count change (`refire`), and the refresh after local row operations. The user did not move for them.
- A block waiting for its delay is not a request: `loading` stays as it is (D3: "a request is in flight"); skeletons show.

### 2.2 Abort what left the keep range

On each rendered-rows report, every in-flight random-access block that does not intersect the keep range is aborted
and removed from `core.inFlight`. An abort is not a failure (`fail` already returns on `signal.aborted`); the slot stays
uncovered and refetches when it is wanted again.
- A block that `refresh()` started in place still holds old rows. On abort, those rows are evicted (2.4 rule), so a later
  view refetches them instead of showing them stale forever.
- A failed block outside the keep range leaves `core.failed`; `error` clears when `failed` is empty. The error bar
  reports what the user is looking at; scrolling back requests the block again.
- Update the `ServerRowsRequest.signal` JSDoc: "Aborted when a newer request replaces this one, when its block leaves
  the rendered rows by more than `overscan` plus one block, on a spec change, and on unmount."

### 2.3 Concurrency cap

At most `maxConcurrentFetches` random-access requests are in flight. A block the rendered rows want over the cap is not
started; when a request settles, the hook re-runs the rendered-rows check (`windowRef(core.lastWindow)`), which picks
the uncovered blocks nearest the centre of the rendered rows first.
`refresh()` and `retry()` blocks are not gaps (refresh keeps old rows, so they count as loaded). They go into
`core.owed: RowRange[]`, which drains before the uncovered blocks, nearest first. Queued owed blocks count as loading.

### 2.4 Bounded cache with least-recently-viewed eviction

- `core.viewed: Map<blockIndex, stamp>`: each rendered-rows report stamps the blocks of the keep range with `++tick`;
  a landing block without a stamp gets the current tick. Entries go with eviction and with every reset.
- Eviction runs inside `commit`, in the same `setRows` updater as the landing blocks, so it adds no commit. When
  `sumRangeSizes(core.loaded) > maxLoadedRows`, a pure `pickEvictions({ loaded, viewed, keep, blockSize, cap })`
  returns whole blocks outside the keep range, oldest stamp first, until the count is at or below the cap.
- Protected slots stay in `data` inside an evicted block (slot granularity) and move from `core.loaded` to `core.stale`, so the
  next window fetches the block whole on the block grid and the answer replaces or moves the row. Eviction counts `loaded` plus
  `stale`, so a kept row goes once nothing protects it. A slot is protected when its row id is in:
  the refresh-guard rule set (`protectedRows()` = saves in flight plus the edit session, and `savedSince(oldestMark)`
  = saves logged for an open request), the **unacknowledged changes** set, or the active cell's row.
- Unacknowledged changes: the guard plugin adds the row id of every `update` and `insert` op it sees (not `stream`, not
  `rollback`), and drops it when that row's save leaves `"saving"` or when a landed block writes the row's server copy.
  A grid with no `onSave` therefore never loses an edit to eviction; the set grows only with human edits.
- The cap is soft: when the keep range plus protected slots exceed it, the cache stays above it.
- Checked rows survive: `checkedRowsLifetime: "across-filters"` stores ids, and `totalRowCount` gives the count. Undo entries over an
  evicted row are no-ops (the existing `undo-redo.mdx` rule).

### 2.5 Manual `evict(range)`

`evict` applies the same protection and aborts the in-flight blocks it covers. This removes the documented quirk
"an in-flight request that started before the evict still lands". The outside ranges of `refresh()` use the same protection, so a
revalidation tick keeps the active row and the unacknowledged edits too.

### 2.6 Sequential sources

- `loadDelay` applies: the next block starts once the rendered rows have stayed within `overscan` of the loaded end
  for `loadDelay` ms. One `wanted` entry, keyed by `seq.offset`. A landed block re-checks the rendered rows as today;
  when they still rest near the end, the entry is already due and the chain goes on at once.
- `maxConcurrentFetches` has no effect: the chain holds one request by construction.
- No abort on leave: the chain needs the block, and a restart would request the same one.
- No eviction: a cursor chain cannot refetch an arbitrary range. A finite `maxLoadedRows` that the consumer passed
  logs one dev warning when the first answer makes the source sequential. Memory stays bounded by `MAX_ROW_COUNT`.

### 2.7 Cleanup

`dropBlocks` (spec change, count change) and unmount clear: the delay timer, `wanted`, `owed`, `viewed`, every
controller, `cancelFrame`, `cancelQueuedRefresh`. The delay timer lives on `core` and is cleared in the spec effect's
cleanup, so a StrictMode double mount leaves no timer and starts each block once. After unmount, `vi.getTimerCount()` is `0`.

## 3. S3: `revalidateInterval` (both modes)

| Option | Default | Reason |
|---|---|---|
| `revalidateInterval` | off (`undefined`) | a timer that requests on its own is a server cost the consumer opts into |

- Validation: a finite number above 0, clamped to `[1000, 2_147_483_647]` (a floor against a typo such as `10`; the
  ceiling is the `setTimeout` limit, above which the browser fires at once). Anything else is off, with a dev warning
  when the value was not `undefined`.
- One shared `useRevalidation({ interval, refresh, busy })` in `server-state.ts`. It chains `setTimeout`, never
  `setInterval`. The clock restarts on every `refresh()` (manual or timed) and on a spec change.
- No overlap: a tick that finds `loading` true waits until it turns false, then runs once. Ticks never stack.
- Visibility: on `visibilitychange` to hidden the timer stops. On visible, a tick that is due runs at once; otherwise the
  timer re-arms for the rest of the interval. No `document` (server render): no timer.
- An error does not stop it: the tick runs `refresh()`, which clears failures and refetches the rendered rows. The
  1000 ms floor bounds the load on a failing server.
- Pages mode: `refresh()` refetches the page and keeps the rows (exists). Scroll random access: `refresh()` refetches the
  rendered blocks and drops every other loaded row (exists), so revalidation also keeps the cache small.
- Sequential: a refresh walks from block 0 to the rendered rows. A tick is skipped (not deferred) while the rendered
  rows plus `overscan` end beyond `MAX_SEQUENTIAL_REVALIDATE_BLOCKS = 10` blocks, so one tick costs at most 10 requests.
- The refresh guard protects saves and the edit session as for a manual refresh. `readOnly` changes nothing: no write.
- Revalidation is not a dataset change; the undo stack is not cleared. `onLoaded` fires for each landed block.

## 4. Page prefetch (pages mode)

| Option | Default | Reason |
|---|---|---|
| `prefetchNextPage` | `false` | each page view costs a second request; rate-limited APIs must opt in (AGENTS: positive boolean, default `false`) |

- Trigger: the current page's answer landed without an error, and page `p + 1` exists (`p * pageSize < totalRowCount`, or
  `hasMore` when the count is `null`). The prefetch starts on the next tick after the landing.
- Request: identical to a page request: `{ spec, page: p + 1, pageSize, start: p * pageSize, end: (p + 1) * pageSize,
  cursor: undefined, signal }`. The server cannot tell them apart and needs no change.
- Cache: one entry `{ view, controller, protectedAtStart, mark, answer?, landedAt? }`, keyed by the pages `view` string
  (`specKey|page|pageSize`). One page ahead only; the entry holds at most `pageSize` rows (`readAnswer` clamps).
- Navigation to `p + 1` (pager, controlled `page`, URL state): a landed entry is adopted in the same render, with no
  `loading` flash and no request; an in-flight entry is adopted as the request (no second request, `loading` until it
  lands). Adoption runs the normal landing: `readAnswer`, `keepProtectedRows` with the entry's own guard
  (`protectedAtStart ∪ savedSince(mark) ∪ protectedRows()`), count and `hasMore` update, `onLoaded`. Then `p + 2` prefetches.
- The entry is dropped (and aborted when in flight) on: navigation to any other page, a spec change, a page-size
  change, `refresh()` or a revalidation tick (it re-prefetches after the refreshed page lands), a local insert, delete,
  or move (server pages shift), and unmount.
- Age: a landed entry older than `revalidateInterval` when set, else 30 s, is dropped at navigation and the page
  fetches normally.
- Error: a failed prefetch is silent: no `error`, no `onError`, no retry. The entry goes; navigation fetches normally and
  reports its own failure. The user never asked for that page.
- Count and `hasMore` of an unadopted entry are ignored; the pager shows the current page's answer only.
- Guard bookkeeping: `usePagesRows` assumes one open request (`pruneSaves(markAtStart)` / `pruneSaves(null)`). With a
  prefetch, prune to the oldest open mark across the page request and the prefetch, as scroll mode does (`oldestMark`).
- Scroll analogue: not needed. `overscan` already loads 30 rows ahead on both sides, and a sequential source starts its
  next block within `overscan` of the end. A direction-aware prefetch is a non-goal.

## 5. Modes, server contract, untrusted input

| Mode | S2 limits | `revalidateInterval` | `prefetchNextPage` |
|---|---|---|---|
| L, PC (rows in memory) | n/a | n/a | n/a |
| PS (server pages) | n/a: one request per page, a newer page aborts the older | refreshes the page | supported |
| Z random access | supported | refreshes the rendered blocks | n/a (`overscan`) |
| Z sequential | `loadDelay` only | refreshes up to 10 blocks deep | n/a |
| C (controlled spec, page) | a spec change resets every timer | clock restarts on a spec change | adopts on a controlled page change |
| SS, FS | a sort or filter change is a spec change: full reset | same | entry dropped |
| API (saves) | eviction keeps protected rows | guard applies | adoption applies the guard |

The request and answer shapes do not change (D2); `readAnswer` validates every answer, including a prefetch. What the
server sees: fewer requests during a drag, more aborted requests (a client disconnect mid-response is normal, not an
error to log), revalidation and prefetch requests identical to ordinary ones. All new bounds sit on developer options
(section 2, 3); the answer bounds (`end - start` rows, `MAX_ROW_COUNT`) stay as they are.

## 6. Races and edge cases (each gets a test)

| Case | Rule |
|---|---|
| Spec change while blocks wait for the delay or run | `dropBlocks` clears `wanted` and the timer, aborts all; nothing from the old spec lands |
| Count change mid-flight | the landing block survives (`abortRequestsExcept`); `wanted`, `owed`, `viewed` reset |
| Eviction during an edit session | the edited row stays in `data`, stale |
| Save in flight on an evicted block | the row stays; it is evicted on a later pass once the save settles |
| Edit with no `onSave` | the row stays in `data` (unacknowledged change) until a landed block replaces it |
| Active cell scrolled far away | its row stays in `data`; scrolling back refetches the block and keeps the active cell |
| Refresh block aborted on leave | its old rows are evicted under the protection rule |
| Revalidation tick during navigation or refresh | waits for `loading` false, runs once |
| Prefetch lands after the user moved two pages | the entry was aborted on navigation; nothing lands |
| Unmount, StrictMode double mount | no timer, listener, or controller left; one request per block |

## 7. Tests (fake timers, synchronous input; `vi.useFakeTimers()` with `requestAnimationFrame` faked)

Unit, pure: `fetch-hygiene.test.ts` for `readFetchLimits` (every invalid value, clamps, `Infinity`), `pickEvictions`
(LRV order, keep range, protected slots, soft cap), and the `wanted` scheduler (due time, drop on leave).
Unit, hook (`use-data-grid-server-rows.hygiene.test.tsx`):
- 20 synchronous reports across 100k rows inside 100 ms start no request; resting starts only the wanted blocks.
- A slow scroll (one row per 20 ms) starts the next block 100 ms after it enters the overscan.
- An in-flight block outside the keep range aborts (`signal.aborted`); a block inside does not.
- At most `maxConcurrentFetches` in flight; a settle starts the nearest waiting block; refresh blocks queue and drain first.
- Loaded rows never exceed `maxLoadedRows` outside the keep range; the rows of the edit session, a save in flight, a save
  logged for an open request, an unacknowledged change, and the active cell survive; checked count is unchanged.
- `evict` aborts covered in-flight blocks and keeps protected rows.
- Sequential: delay applies, no abort, no eviction, dev warning for a passed `maxLoadedRows`.
- Every row of section 6.
Unit, `revalidate.test.tsx` (both modes): fires at the interval, no overlap with an in-flight refresh, stops when hidden,
runs once on visible when due, clamps, skips a deep sequential tick, cleans up on unmount.
Unit, `prefetch.test.tsx`: prefetch after landing, adoption with zero requests and no loading render, in-flight adoption,
every drop trigger, silent error, age limit, guard on adoption, controlled and URL page.
Browser, 100k (extend `scroll.browser.test.tsx:300`): the 90-frame thumb drag at default options starts at most 8
requests, ends with no skeletons, keeps at most one commit per frame (existing bound), and `getLoadedRanges()` sums to at
most `maxLoadedRows` after a second drag pass with `maxLoadedRows: 2000`.

## 8. Docs, changelog, parity, demo

- `content/docs/lazy-loading.mdx`: options rows (`loadDelay`, `maxConcurrentFetches`, `maxLoadedRows`,
  `revalidateInterval`); behavior bullets for delay, abort, cap; rewrite "Memory & retention" around `maxLoadedRows`
  and the protection rule, keep `evict` for a custom policy, drop the in-flight quirk bullet; sequential section: delay
  yes, eviction no, revalidation depth.
- `content/docs/recipes/data-fetching/server-side.mdx`: pages section gets `prefetchNextPage` and `revalidateInterval`.
- `content/docs/addons/undo-redo.mdx` (scroll section): revalidation needs no `clear()`; eviction makes entries no-ops.
- `content/docs/lazy-loading-advanced.mdx`: pass `signal` to the query library so aborted blocks cancel.
- `CHANGELOG.md` under Unreleased, server data hooks:
  - `**Breaking:** scroll mode starts a block only after it stays in view for \`loadDelay\` ms (default 100); pass \`loadDelay: 0\` for the old timing.`
  - `**Breaking:** scroll mode keeps at most \`maxLoadedRows\` loaded rows (default 10,000) and unloads the least recently viewed blocks; rows with an open edit, a pending save, or an unsaved change stay. Pass \`Infinity\` to keep every row.`
  - `Scroll mode aborts a block request when its rows leave the rendered rows plus overscan, and runs at most \`maxConcurrentFetches\` requests (default 3).`
  - `\`evict()\` aborts the requests it covers and keeps rows with an open edit or a pending save.`
  - `\`revalidateInterval\` refreshes the rows on a timer while the page is visible.`
  - `\`prefetchNextPage\` loads the next page in the background; the pager shows it with no request.`
- `research/parity-matrix.json`: new rows `fetch-limits` (`loadDelay`, `maxConcurrentFetches`, `maxLoadedRows`),
  `revalidate` (`revalidateInterval`), `page-prefetch` (`prefetchNextPage`), cells per section 5 with the test paths as
  evidence. Add `UseDataGridServerRowsOptions` (`use-data-grid-server-rows.ts`) to `OPTION_SOURCES` in
  `scripts/verify-parity.mjs` so pages options are checked too. Run `node scripts/verify-parity.mjs --write`.
- Demo: no new demo. `data-grid-lazy-demo` shows "requests started / aborted" and "loaded rows / cap";
  `data-grid-server-side-demo` turns on `prefetchNextPage` and offers a revalidate toggle. Rebuild payloads.

## 9. Implementation order (each step test-first, gates green before the next)

1. `GLOSSARY.md` terms (section 1).
2. `fetch-hygiene.ts`: `readFetchLimits`, `keepRange`, `pickEvictions`, the `wanted` scheduler as pure functions + tests.
3. Abort outside the keep range, failed blocks leave `failed`, signal JSDoc (2.2).
4. Load delay for random access, with the skip list and timer cleanup (2.1, 2.7).
5. Concurrency cap and the `owed` queue for refresh and retry (2.3).
6. Guard plugin: unacknowledged changes set and active-cell row; one `evictionProtected()` reader (2.4).
7. `maxLoadedRows` eviction inside `commit`; `evict` aborts and protects (2.4, 2.5).
8. Sequential: delay, dev warning for `maxLoadedRows` (2.6).
9. `useRevalidation` in `server-state.ts`, wired into both modes (3).
10. Pages guard bookkeeping to oldest open mark, then `prefetchNextPage` (4).
11. Browser 100k test update (7).
12. Parity rows and `OPTION_SOURCES`, docs, changelog, demos, payloads, skills check (8).

## 10. Non-goals

- Direction- or velocity-aware prefetch in scroll mode; prefetching more than one page, or the previous page.
- A `prefetch` flag or priority hint on the request; request deduplication across grids.
- Backoff or a retry policy for revalidation; revalidation on focus or on reconnect; a silent mode that hides `loading`.
- Eviction for sequential sources; eviction by byte size; keeping rows that undo entries reference.
- Caching across spec changes (a query library's job; `fetchRows` can call `queryClient.fetchQuery`).
