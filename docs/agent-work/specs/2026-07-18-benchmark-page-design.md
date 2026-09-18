# Benchmark page design (workplan #42 build)

> **Amended 2026-07-18 (user, after v1 landed as a6877a6):** (a) benchmark scenarios must
> SIMULATE real usage — every grid gets the same rich cell mix (select/dropdown, date, checkbox,
> number formatting) as close to identical as each library allows; where parity is impossible,
> that limitation is written down and RENDERED IN the benchmark UI (per-grid, per-column parity
> notes + a parity matrix on the runner). (b) Glide Data Grid is REMOVED from the comparison —
> canvas rendering is too far from our approach (already settled by the 2026-07-16 canvas eval);
> its dep + pages are deleted. (c) Complicated benchmark coding work may use high-capability agents.
> Additional advisor addendum: v1's dev-mode 1k numbers for gridcn (100% frames <30fps at
> medium/fling, 273 long tasks) look implausible vs the CI perf gate — the refinement must
> validate on a PROD build (next build + start) and audit the rAF-paced driver for fairness to
> the CSS-var scroll architecture before any number is trusted.

Human-testable, dev-only comparison of gridcn against feature-comparable grids. Research basis:
2026-07-18 benchmark research (competitor licensing, metrics, prior art). Nothing here ships to
the registry or the public docs — /dev route + devDependencies only.

## Competitor set (decided)

| Column | Package | Why |
|---|---|---|
| gridcn | (ours, /dev pattern) | baseline |
| MUI X DataGrid | @mui/x-data-grid (MIT tier) | closest MIT feature match |
| react-data-grid | react-data-grid | real MIT DOM grid with selection/clipboard |
| Glide Data Grid | @glideapps/glide-data-grid | canvas renderer — the alternative-architecture data point (DOM metrics N/A-flagged) |
| TanStack assembled | @tanstack/react-table + @tanstack/react-virtual | thin reference build (virtual rows + minimal range selection), labeled "what raw TanStack gives you", per the core-strategy decision doc |

Excluded: AG Grid Community (range selection + clipboard are Enterprise-only → fails the
feature bar; may be added later as a clearly-footnoted scroll-only column), Handsontable
(free tier is non-commercial — not a real alternative for our consumers; not benchmarked).
All new packages are devDependencies. verify-registry must stay green (nothing enters
registry.json / public/r).

## Pages

- `/dev/benchmark` — runner + results: picks dataset size (1k/100k/1M — reuse ROW_OPTIONS
  pattern), runs the scripted scenarios per grid sequentially (each grid mounted in isolation,
  one at a time, to avoid cross-grid interference), renders one results table (grid × metric),
  with copy-as-markdown. Also links to the per-grid pages for hands-on driving.
- `/dev/benchmark/<grid>` — one page per grid, SAME seeded dataset (seeded LCG, 100k×8 default:
  text/number/select/date mix matching the /dev shapes) and equivalent 8 columns, mounted alone.
  Human can scroll/fling/click/drag-select/Ctrl+C directly.

## Metrics (per grid, per run; median of N where sensible)

1. Mount time — performance.now() around mount → role=grid visible.
2. Scroll fling — scripted scrollTop deltas at 3 speed tiers (reuse perf.browser.test.tsx's
   measureScrollFps shape): avg fps, worst 100ms-window fps, % frames <30fps.
3. Interaction latency — synthetic click → next painted frame (performance.mark/rAF).
4. JS heap — performance.memory.usedJSHeapSize deltas in-page (after mount / after scroll
   burst / after 5 mount-unmount cycles). The CDP heap-profile script (scripts/heap-profile.mjs
   pattern) may be extended separately as an opt-in npm script; NOT required for the page.
5. DOM node count — scoped querySelectorAll length at rest + during scroll (Glide: N/A note).
6. Long-task count during the scroll burst (PerformanceObserver).

Honesty rules baked into the UI: per-grid caveat line (canvas vs DOM; assembled-baseline
label; feature-parity notes per grid), seeded dataset id + run environment shown with results,
and a visible note that headed (non-headless) Chrome is the meaningful environment for fps.

## Implementation notes

- Keep competitor demo code minimal-but-fair: same columns, editing on where the grid supports
  it, selection enabled where supported; no per-grid tuning beyond documented defaults.
- The runner drives scenarios via plain in-page JS (no Playwright dependency in the app);
  results are client-side only. No CI wiring — this is a human tool (perf.browser.test.tsx
  remains the CI gate).
- The five grids must NOT be imported into the main /dev bundle — dynamic import per page so
  the dev route stays fast.
- Dataset module shared from one file (seeded; no Math.random at module scope).

## Out of scope

Publishing results to the docs site; automated CI benchmarking; AG Grid/Handsontable columns;
server-mode comparisons. A written comparison report can follow once a human has driven it.
