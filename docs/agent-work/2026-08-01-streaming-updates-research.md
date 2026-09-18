# Streaming / continuous value updates — measurement report

Workplan item #72, part 1-2. Research + measurement only; no production source was changed.

Date: 2026-08-01. Machine quiet (no other lanes). All scratch harnesses deleted after the runs.

## TL;DR

The grid is **already fast at streaming updates — as long as no sort is active.** A controlled
`data` replacement that changes 1 or 200 cells at 100k rows costs **~0.5 ms** in a production
build, and the memoization regime is doing its job: only **4 DOM mutations per single-cell tick**,
and the store's own work is **0.25-0.37 ms**.

The problem is a **cliff, not a slope**. Turn on one sort column and the same tick goes to
**56 ms** — a 35x jump — because every data-identity change rebuilds the whole 100k view index,
including a full `Intl.Collator` sort. At 10 updates/s a sorted 100k grid spends **56 % of the
main thread** re-sorting rows that did not move.

So the direct-update API's value is **not** "avoid re-rendering cells" (that is already solved).
It is **"avoid rebuilding derived state that the update could not have invalidated"** — and,
secondarily, avoiding the O(n) array copy the controlled contract forces on the consumer.

## Method

Two measurement environments, both real Chromium:

1. **Vitest browser mode** (dev build) — used for the isolated store/algorithm microbenchmarks
   and the decomposition work, where relative cost is what matters.
2. **Production build on `:3005`, driven via agent-browser** — used for every headline number.
   Prod-only for headlines per the measurement discipline in
   `docs/agent-work/2026-07-18-fling-smoothness-report.md`.

Discipline applied:

- `performance.now()` in this Chromium is clamped to **0.1 ms**. Single-tick timings below ~1 ms
  are therefore quantized; every sub-ms figure below comes from **timing a batch of 100-200 ticks
  and dividing**, not from timing one tick.
- The dev/prod gap is large and was the main trap (see "The 12 ms that wasn't"). Headline numbers
  are prod.
- A/B arms (sorted vs unsorted) were **paired inside one page load** and run in both orders, per
  the bimodality warning in the fling report.
- Medians, not means; 5 batches per arm unless noted.

Dataset for all runs: 100k rows, 8 columns, `getRowId: r => r.id`, ~17 rows / 136 cells mounted
in the window.

## Headline: production numbers

Measured in one production page load, arms interleaved and repeated in both orders.

| Scenario (100k rows, prod build) | ms / tick | Notes |
| --- | --- | --- |
| Controlled `data` replace, 1 visible cell | **0.46** | batched timing; 0.456 / 0.460 / 0.457 across 3 runs |
| Controlled `data` replace, per-tick incl. paint | **1.4-1.6** | timed individually, so includes layout/paint |
| Same, **with one active sort column** | **56.3 / 56.9** | reproducible, reversible in the same launch |
| Unsorted again after turning sort off | **1.4** | proves the 56 ms is the sort, not drift |

FPS under simultaneous slow scroll (8 px/frame) plus an update every frame:

| Arm | FPS |
| --- | --- |
| Scroll only | 414-427 |
| Scroll + 20-cell update every frame | 275-289 |

Ratio ~0.67. Even at one update per frame, the unsorted grid stays far above 60 fps — updates are
**not** a scroll-smoothness problem today. (These are synthetic scroll-event loops, not vsync-paced
frames, so treat them as a JS-cost ratio rather than a literal refresh rate.)

## Where the cost actually is

Isolated algorithm costs at 100k rows (prod build, browser):

| Operation | ms |
| --- | --- |
| `data.slice()` (the copy the controlled contract forces) | 0.10 |
| `computeViewIndex`, no sort/filter | 0.20 |
| `computeViewIndex`, no sort, with `prevViewIndex` reuse | 0.20 |
| **`computeViewIndex`, one sort column** | **26.2** |
| `computeViewIndex`, one filter | 2.9 |
| `computeSearchMatches`, search inactive | ~0.00 (early exit) |
| `computeSearchMatches`, search active | 2.3 |
| Targeted patch of 20 cells (copy + spread touched rows) | 0.10 |
| One-time `rowId -> dataIndex` map build | 10.1 |

And the same through a real store's `_syncProps`:

| `_syncProps` tick | ms |
| --- | --- |
| 1k rows | <0.1 |
| 10k rows | <0.1 |
| 100k rows | **0.25-0.37** |
| 100k rows **with an active sort** | **28-29** |

### Contribution breakdown for one sorted 100k tick

`computeViewIndex` is called unconditionally whenever `syncInputsEqual` fails, and a new `data`
array reference always fails it (`create-store.ts` `_syncProps`, `types.ts` `syncInputsEqual`).
Inside, `buildViewIndex` (`sort-filter/build-view-index.ts`) does, per tick:

- allocate a fresh `[0..n)` index array — 100k entries;
- build a `Map<number,string>` of sort keys by calling `getText` for all 100k rows;
- allocate 100k `{row, position}` decoration objects;
- `Array.sort` with an `Intl.Collator` comparator — ~1.7M comparisons at n=100k;
- map back to a plain index array.

That is ~26 ms of the ~28 ms store tick. The `prevViewIndex` content-equality reuse **does not
help**: it runs *after* the rebuild, so it saves the subscriber re-render but pays the full sort
cost first. This is the single dominant contributor and the whole justification for the API.

For comparison, the contributors that turned out **not** to matter:

- **Row-memo busting** — no. Only touched rows get new identities; `useDataGridRow` is per-row and
  `DataGridRow` is memoized. Measured: **4 DOM mutation records per single-cell tick** across a
  136-cell window.
- **Subscriber fan-out** — no. `_syncProps` tick at 100k measured **0.3 ms with 0, 30, 70, and 140
  row subscribers** — flat. The per-row `useDataGridRowCellState` comparator is doing its job.
- **`checkDevGuardrails`** — no. 0.001 ms with an early exit, 0.14 ms worst case (full scan), and
  it is dev-only anyway.
- **Full-column sweep** — does not exist on this path.
- **GC pressure** — modest but real: a 100k-row array copy churns ~0.8 MB of pointers per tick,
  ~0.8 GB per 1000 ticks. `performance.memory` showed no steady-state growth (the copies are
  short-lived and collected), so this is throughput cost, not a leak. 1000 copies took 64 ms total.

### The 12 ms that wasn't

Worth recording so the next lane does not re-derive it. In the **dev** build, every controlled tick
at 100k rows measured ~12 ms and scaled cleanly with row count (0.39 / 1.10 / 11.84 ms at
1k / 10k / 100k), which looks exactly like a real O(n) regression. It is not:

- plain React holding the same 100k array in `useState`: **0.016 ms**;
- `useEffect` keyed on that array plus a real `_syncProps` call: **0.26 ms**;
- the store's `_syncProps` alone with the full prop object: **0.25 ms**;
- but the real `DataGridProvider` with inert children: **5.26 ms**, and the full grid **12.1 ms**.

The store work and the React work each measure a fraction of a millisecond, yet the assembled
provider costs 5-12 ms. The gap is React **dev-mode instrumentation** over a component whose props
include a 100k-element array. In the production build the same tick is **0.46 ms** — a ~26x
difference. Prebuilding the arrays outside the timed window did not change the dev number (12.5 ms),
confirming it is not the consumer's `slice()`.

**Rule for the build lane: never quote a dev-mode number for this work.** The sorted-path cliff, by
contrast, is real and survives the production build at full size.

## What this means for the API design

1. The win is **skipping `computeViewIndex`/`computeSearchMatches`**, not skipping renders. Any
   design that still funnels through `_syncProps` on a new `data` identity keeps the 56 ms cliff.
2. A store-level targeted patch measured **0.09-0.10 ms** for 20 cells against the same 100k store,
   versus **28 ms** for the equivalent `_syncProps` path with a sort active — a measured **317x**
   on that arm, and ~4x on the unsorted arm (0.37 -> 0.09 ms).
3. The unsorted path is already good enough that the API's headline benefit must be stated honestly
   as **"makes sorted/filtered streaming viable"**, plus removing the O(n) copy the controlled
   contract imposes on the consumer.
4. Because untouched rows keep identity and the row/cell memo layers already prove correct under
   streaming, the API can safely bypass the derived-state recompute without touching the render path.

## Reference check (part 2)

Full write-up in the design spec's "Prior art" section (MUI X and Glide verified against vendored
source in `references/`; AG Grid and react-data-grid from official docs). The short version
informing our design:

- Every library that supports streaming at scale offers an **imperative, id- or coordinate-keyed,
  batched** update entry point separate from the declarative data prop.
- **Nobody makes per-update re-sorting cheap; they all avoid or defer it.** AG Grid's cell-level
  change-detection path explicitly does not sort/filter/group and requires an explicit
  `refreshClientSideRowModel`. MUI X does re-sort the whole dataset on every flush — and
  consequently its own docs must recommend `throttleRowsMs` for high-frequency updates. Glide does
  not sort at all (the consumer owns ordering).
- Glide's damage-region model (`updateCells([{cell: [col, row]}])` -> internal `damage()`) is the
  cleanest separation in the field: the write and the invalidation declaration are two different
  things. We borrow the separation but key by **row id**, not coordinates, because our data lives
  inside the grid and the whole point is surviving an active sort.
- react-data-grid has no invalidation API at all and documents that changing the array reference
  alone still costs viewport recalculation — our current position, and consistent with our measured
  0.46 ms/tick floor.

## Reproducing

Both harnesses were deleted. To rebuild them:

- Store/algorithm microbenchmarks: a `*.browser.test.tsx` in
  `registry/default/blocks/data-grid/test/` calling `createDataGridStore` and the `store/compute.ts`
  exports directly; time batches of 100+ iterations, take medians. Run with
  `npx vitest run --project=browser <file> --reporter=verbose`.
- Prod headline numbers: a page under `app/dev/` rendering `<DataGrid>` at 100k rows that exposes a
  `window.__probe` with a `flushSync`-driven tick loop and a `setSorted` toggle; `npx next build`,
  `npx next start -p 3005`, drive with agent-browser `eval`. Kill the server PID afterwards.
