# Test infrastructure evaluation — do we need more than Vitest?

Status: PROPOSED (decision pending). Workplan #100.

The question asked: our tests are "only Vitest" — would Playwright (or anything else) make them
more consistent, reliable, easier? This spec answers with an inventory of what we actually run,
the failure modes observed this cycle, the options, and a recommendation.

## 1. Correction to the premise

We are not "only Vitest" in the sense the question implies. The browser project already drives a
**real headless Chromium through the Playwright provider** (`@vitest/browser-playwright`,
`vitest.config.ts` browser project). Every `*.browser.test.tsx` — 36 files, ~370 tests — renders
real DOM, real CSS Grid/subgrid, real `userEvent` input in Chromium. Adopting "Playwright" would
not add browser realism we lack; we already have it for Chromium.

What we run today:

| Layer | Runner | Env | Count | What it covers |
|---|---|---|---|---|
| unit | Vitest project `unit` | jsdom | ~1,440 tests | pure lib modules (95-100% branch gate), store logic, hooks |
| browser | Vitest project `browser` | Chromium via Playwright provider | ~370 tests | rendering, interaction, a11y (axe), RTL, perf floors |
| registry | node scripts | — | 2 gates | manifest integrity + payload-content-vs-source |
| consumer smoke | `registry-smoke.ps1` | scaffolded Next + Vite apps | manual | install-and-compile of all 15 items |

## 2. Real failure modes observed this cycle (the actual reliability data)

1. **Load-sensitive perf tests.** `perf.browser.test.tsx` FPS-ratio failure — investigated
   2026-08-20, verdict **environmental**: passes 10/10 on a quiet machine (full-swap 41-42fps vs
   the 15fps floor, 2.75x margin), and the exact failure reproduces on demand by saturating all
   cores (13.3fps). Both metrics drop together with the ratio preserved — machine load, not a
   rendering regression. Triage rule: printed `idle` fps under ~120 (healthy: 173-193) means the
   host was loaded and the run is meaningless. `data-grid-playground-demo.test.tsx` `beforeAll`
   timeouts are the same class. Perf floors share a runner and machine with functional tests, so
   load turns into false reds — exactly what D1 (separate serial perf project) fixes.
2. **Chromium-only blind spot.** `project-status.mdx` documents Firefox/Safari as untested. This
   is not hypothetical: the `downloadBlob` synchronous-revoke bug (#99 B8) was precisely a
   Firefox/Safari race that no Chromium test could ever catch — two tests even pinned the buggy
   behavior as correct.
3. **Partial CSS in the harness.** Browser tests inject the live dev stylesheet by URL to assert
   on appearance; the chunk URL drifts and 404s. Documented recurring cost.
4. **Server components can't render in the harness** (`process is not defined`) — filesystem-
   reading docs components are untestable in the browser project.
5. **jsdom misleads on paint.** Two shipped bugs (overlay paint order, RTL glyph position) passed
   every jsdom/computed-style assertion while visibly broken. Mitigated by the pixel-screenshot
   discipline, not by the runner.
6. **One transient dual-React-copy cache error** in the browser project (two React patch
   versions in the pnpm store; stale Vite dep-optimize cache). Did not recur.

Failure modes 1 and 2 are runner/architecture problems. 3-6 are not solved by switching runners.

## 3. Options

### A. Status quo
Zero cost. Leaves the FF/Safari blind spot (one shipped bug already) and perf-vs-load flake.

### B. Wholesale move to Playwright Test
Rewrite ~370 component-harness tests as e2e page tests. **Rejected.** Playwright Test has no
component story comparable to `vitest-browser-react`'s render-a-fixture model; we would lose
direct store access (`StoreProbe`), lose the shared unit/browser config, and turn fast harness
tests into slow page tests. Cost is weeks; reliability gain over the Playwright provider we
already use is ~zero for Chromium.

### C. Additive Playwright Test layer (small, targeted)
Keep Vitest as the main harness. Add a `playwright.config.ts` + `e2e/` with a deliberately tiny
suite that does only what Vitest browser mode cannot:

1. **Cross-browser smoke on the browser-specific risk paths** — WebKit + Firefox on: clipboard
   copy/paste (real Clipboard API permissions differ per engine), file download (`downloadBlob`
   — the class of the already-shipped bug), file import picker, RTL rendering, one scroll pass.
   ~8-12 tests, tagged, run in CI on the three engines Playwright bundles.
2. **Real-app smoke against the built docs site** — `next start` the production build, visit
   3-4 doc pages, assert a demo grid mounts, edits a cell, opens the filter menu. This also
   covers server components (mode 4) because the real app renders them.
3. Trace-on-failure enabled — Playwright's trace viewer replaces manual screenshot archaeology
   for exactly the hardest failures we debug today.

`playwright` is already in devDependencies (the provider needs it), so the only new dependency
is `@playwright/test`. Estimated: S-M to stand up, ~10-15 tests, +2-4 min CI.

### D. Vitest-internal reliability fixes (no new tool)
1. **Split perf into its own project** (`perf`, include `**/perf*.browser.test.tsx` +
   `store-search-perf`), excluded from the default `browser` project. Run serially
   (`fileParallelism: false`), and in CI as a separate job so functional reds are never perf
   noise. Locally: `pnpm test:perf` when the machine is quiet.
2. **`retry: 1` for the browser project only** — interaction tests are dominated by real-timing
   waits; one retry converts rare timing blips into passes without hiding persistent failures
   (a genuinely broken test still fails twice). Perf project gets `retry: 0` — a perf floor that
   needs a retry is a finding, not a flake.
3. **Bundle the harness stylesheet** — import the app stylesheet through Vite in a shared test
   setup instead of fetching a hashed chunk URL from the dev server, ending failure mode 3.
   (Feasibility check needed: Tailwind v4 plugin in the vitest pipeline.)
4. **Pin the two React patch versions** to one (`pnpm.overrides`) to close failure mode 6.

## 4. Recommendation ("do we need this?")

**D yes, C yes-but-small, B no.**

- **D is needed** regardless of anything else: it addresses the two flake sources we hit *this
  week* with config-only changes. Do D first — items 1+2 are an hour of work.
- **C is justified narrowly** by one already-shipped cross-browser bug and a documented untested
  claim on the status page. Cap it: cross-browser smoke + docs-site smoke only. It is NOT a
  second test suite to grow by default — new tests go to Vitest unless they need another engine
  or the real app. Write that rule into the e2e README.
- **B is a rewrite with negative expected value.**
- Anything else (Cypress, WebdriverIO, Storybook test-runner): no — they duplicate what the
  Playwright provider already gives us, with a larger dependency footprint.

Sequencing: D1+D2 immediately (unblocks trustworthy CI signal), D3/D4 as follow-ups, C after the
perf investigation lands (its verdict may adjust how the perf project is shaped).

## 5. Decision needed

| # | Question | Recommendation |
|---|---|---|
| 1 | Adopt D (perf project split, browser retry, stylesheet bundling, React pin)? | yes |
| 2 | Adopt C (tiny Playwright Test layer: cross-browser + docs-site smoke)? | yes, capped |
| 3 | Anything beyond that? | no |
