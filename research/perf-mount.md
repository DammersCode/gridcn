# Mount speed

Decision record for the mount-speed work: what we measure, the baseline, what we changed, what we tried and dropped, and what is left.

## What "mount speed" means here

A user sees a grid when its rows are painted, and uses it when the DOM stops changing. Three numbers per mount:

- **Rows painted** (`rowsPaintedMs`): from the start of `root.render()` to the first frame that has data cells in the DOM. The harness waits for a `requestAnimationFrame`, then a `MessageChannel` task, so the stamp lands after the frame. It is quantized to the 60 Hz frame, so read differences under about 8 ms as noise.
- **Settled** (`settledMs`): the last DOM mutation of the mount, after a 100 ms quiet window.
- **Main-thread work** (`taskMs`, `scriptMs`, `layoutMs`, `styleMs`): CDP `Performance.getMetrics` deltas around one mount. These do not depend on frame alignment.

React's Profiler adds `commits` and `reactMs` (sum of `actualDuration`). Hydration on the docs site is measured on the server-rendered bench page: `hydrationMs` is the time from first contentful paint to the grid's first effect, minus the time spent generating the rows.

## Harness

- Page: `app/dev/mount-bench` (`?rows=&variant=plain|markers&mode=mount|hydrate`). The seeded dataset is `app/dev/benchmark/_lib/dataset.ts`; eight columns of mixed types, `markers` adds checkbox row markers. The grid is 500 px tall and as wide as the viewport.
- Script: `scripts/perf-mount.mjs`. Cold = first mount in a fresh browser context. Warm = mounts three and later in one page. `--url a,b` runs two builds, alternating which one goes first on each pass, so machine load and slot order hit both equally. `--throttle 4` slows the CPU.
- Production build with `next build --profile --no-mangling` (Profiler reports in production, function names survive for CPU profiles), `GRIDCN_DEV_PAGES=1` (the dev pages are 404 on a production build otherwise), `GRIDCN_DIST_DIR` (two builds side by side). Commands are in the script header.
- Page text in the grid's fonts renders before the grid mounts. Without it, a cold run charged about 25 ms of first-use font decoding to the first layout.

Noise floor (A/A, the same build twice, 1,000 rows, 12 runs): cold -2 % and warm +5 % on rows painted. A first version of the harness kept both variants open in one browser for the warm runs; the second slot ran about 35 % faster. The alternating order removed that.

Machine: Intel Core i7-13850HX (20 cores, 28 threads), 64 GB, Windows 11, headless Chromium 153, other agent sessions running on the same machine during the runs (absolute numbers are inflated; ratios are what to read).

## Baseline: where the time went

At 1,000 rows, warm, from a Chrome trace of one mount (about 17 ms in total):

| Step | Cost |
| --- | --- |
| Commit 1: guess window of 30 rows x 8 columns, because the scroll element is not attached yet | 4 ms |
| Forced style recalculation (`getComputedStyle(root).direction`) over that DOM | 4 ms |
| Forced layout (`clientWidth`, `scrollHeight` in the scroll store) over that DOM | 2.5 ms |
| Commit 2: element attached, window shrinks to 14 rows (16 of the 30 rows are thrown away) | 1.7 ms |
| Commit 3: dimensions arrive in a passive effect | 0.8 ms |
| Final style, layout, paint | 2.5 + paint |

Cold adds first-time costs on top (compiling the code, filling caches); the guess DOM made the first forced layout the largest single item.

## Changes

1. A client-only mount renders **no data rows in its first commit**. The server render and the hydration render keep the 30-row preview, chosen with `useSyncExternalStore(getServerSnapshot)` so the hydration render matches the server HTML. The forced reads now run over the header only.
2. The scroll element is measured in the same layout effect that attaches it, and the DOM direction is read there too (was a passive effect). RTL pages get the direction before the first paint.
3. `autosizeOnMount` waits until the grid is measured, so it runs after the rows exist. The measure context falls back to the root's font when no body cell is mounted.

Tests: `test/mount-commits.test.tsx` (zero data cells in the first commit; visible rows after; server preview of 30 rows; hydration without a recoverable error), `test/mount.browser.test.tsx` (rows in the DOM by the first frame; autosize from real cells; hydration in Chromium), `use-row-window.test.ts` (server preview versus client mount).

## Results

Production build with the Profiler (`--profile --no-mangling`), headless Chromium 153, 1280x800, 12 runs per cell, median with the median absolute deviation. A = commit `4d88b37b` sources, B = this branch. First painted rows and cells at first paint are identical in both builds (15 rows including the header, 112 cells for 14 data rows x 8 columns); the final DOM is identical too (`rowsFirstPaint`, `cellsFirstPaint`, `cellsSettled` do not move). A/A noise floor with the final harness (same build twice, 1,000 rows): cold -1 %, warm +5 %.

Time to first painted rows (ms), plain variant:

| Rows | Cold before | Cold after | Warm before | Warm after |
| --- | --- | --- | --- | --- |
| 100 | 70.9 ± 2.3 | 38.3 ± 1.2 (-46 %) | 49.1 ± 1.0 | 24.0 ± 1.0 (-51 %) |
| 1,000 | 70.1 ± 1.4 | 38.9 ± 0.8 (-45 %) | 48.6 ± 1.8 | 23.3 ± 0.8 (-52 %) |
| 10,000 | 69.2 ± 0.7 | 38.7 ± 0.9 (-44 %) | 49.3 ± 1.2 | 25.6 ± 1.4 (-48 %) |

Mount cost does not depend on the row count: only the viewport rows mount, and the view index of 10,000 rows costs well under a millisecond.

Time until the DOM stopped changing (`settledMs`, ms): 1,000 rows cold 65.6 -> 37.1 (-43 %), warm 40.4 -> 17.2 (-58 %). This is the closest number to "interactive": the grid has its rows, its layout, and its listeners.

Work behind the numbers, 1,000 rows (ms unless noted):

| | Cold before | Cold after | Warm before | Warm after |
| --- | --- | --- | --- | --- |
| Main-thread task (`taskMs`) | 78.4 | 48.5 | 51.3 | 25.9 |
| Script | 57.6 | 35.1 | 34.2 | 15.5 |
| React render + commit (Profiler) | 25.0 | 17.3 | 10.5 | 4.8 |
| Style recalculation | 7.1 | 4.3 | 7.0 | 4.0 |
| Layout | 3.9 | 2.7 | 2.5 | 1.4 |
| Commits (mount + updates) | 3 | 3 | 3 | 3 |

Other conditions, 1,000 rows, rows painted (ms):

| Condition | Before | After |
| --- | --- | --- |
| Plain production build, no Profiler, cold | 38.3 | 21.9 (-43 %) |
| Plain production build, no Profiler, warm | 51.4 | 17.8 (-65 %) |
| Row markers (checkbox column), cold | 90.1 | 51.5 (-43 %) |
| Row markers, warm | 61.3 | 31.0 (-49 %) |
| 4x CPU throttle, cold | 634 | 369 (-42 %) |
| 4x CPU throttle, warm | 1,039 | 474 (-54 %) |

Hydration of the server-rendered page (1,000 rows): 102 ms before, 103 ms after (10,000 rows: 103 and 109). No change within the noise. No hydration error in any run, and `renderToString` plus `hydrateRoot` pass in jsdom and in Chromium. The server HTML is 332 KB for the 30-row preview (80 % of it is class names).

Bundle: the core import (`data-grid.tsx`, React external, esbuild minified) is 563.6 KB / 189.4 KB gzip before and 563.9 KB / 189.5 KB gzip after. The change adds 0.3 KB.

Validity review (Opus, read-only): VALID WITH CAVEATS. Headless Chromium has no real raster, so "painted" means "the main thread finished the first frame with cells". Frame alignment adds noise to both builds alike. The first harness showed warm runs slower than cold runs for the baseline because garbage from earlier mounts landed in the measurement; the harness now unmounts and collects garbage before each measured mount, and warm is now faster than cold as expected. The plain production build (no Profiler) confirms the direction and size of the effect. Dev-mode React numbers are not used: dev React runs about three times slower and has its own warnings, so only production builds count here.

Comparison to the external figures the maintainer shared (1,000 rows: 70 ms before, 47 ms after, conditions unknown): our baseline lands at 70 ms in the same units (ms to first painted rows, cold, 8 columns, 500 px tall grid), and the result is 39 ms with the Profiler build and 22 ms without it. The conditions of the other benchmark are unknown, so this is an orientation only.

## Tried and dropped

- **Moving the search-match classes out of every cell.** Each cell carries about 1.1 KB of class names, mostly the `data-[search-match]:` variants, which is also 80 % of the 332 KB server HTML for 30 rows. A build without them showed no change in rows painted, style or layout time (A/B, 12 runs, within the A/A noise). A stylesheet rule could not carry the `dark:` and `forced-colors:` variants without hard-wiring a selector, so the idea stays dropped.
- **One commit fewer.** Commit 2 exists because the row and column window hooks attach their element in a layout effect that runs before the scroll element's ref is set. Handing the element down by context removes that commit, but commit 2 now renders no rows and costs 0.5 to 1.6 ms. The refactor of three hooks does not pay for itself.
- **Avoiding `getComputedStyle` for the direction.** Reading the parent's direction would skip a forced style pass over the new subtree, but the browser needs that style pass before the layout read anyway. The work moves, it does not go away.
- **Smaller server preview.** Fifteen rows instead of thirty would halve the 332 KB server HTML and the cells hydrated, but a React render of 112 cells costs about 3 ms, so the hydration gain is about 3 %. It also changes the server output, so it stays at 30.
- **Hand-drawn row-marker checkboxes.** Against the project rule. The profile shows the Base UI checkbox is not a hot spot at 14 rows (`markers` variant: no function above 0.4 ms self time).

## Not done, with evidence

- **Bundle.** The core import (`data-grid.tsx`, React external, esbuild minified) is 564 KB, 190 KB gzip. Of that, 250 KB is gridcn code, 156 KB `@base-ui/react`, 40 KB `react-day-picker`, 26 KB `tailwind-merge`, and 22 KB `date-fns`. The date picker and its dependencies (about 67 KB, 22 KB gzip) load on the critical path although only a date cell editor needs them. Loading the editor on first use is the largest bundle lever. It changes how an editor opens (a Suspense boundary and focus hand-off), so it needs its own spec and tests.
- **Cold JavaScript.** The cold profile is flat: `tailwind-merge` (`cn` on the long cell class string, about 4 ms cold, cached afterwards), store creation (about 1.5 ms), and first-time execution of the React reconciler. No single function is above 3 ms.
- **Hydration.** The docs page spends 55 ms in module evaluation (`instantiateModule`) and about 270 ms of native parse and compile time on the way to the grid's hydration, none of which is grid code. The grid's own hydration is 100 to 130 ms at 1,000 rows with a 30-row preview.
