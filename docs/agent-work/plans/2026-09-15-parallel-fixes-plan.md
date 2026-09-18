# 2026-09-15 — Parallel fixes: hero animation, GitHub registry, manual install, version bumps

User requests (2026-09-15):
1. Landing ("start screen") animation runs too fast on high-refresh displays.
2. Verify the GitHub registry path actually works (`https://ui.shadcn.com/docs/registry/github` — `npx shadcn add DammersCode/gridcn/<item>`).
3. Home-screen animation stops permanently after switching tabs and coming back — find why, fix it.
4. The Manual install tab for the core shows a folder tree with no code and no links — "a folder structure without files is useless". Make manual setup usable without the install command: link to the GitHub source (per-file, copyable) and/or provide the code like shadcn's "Copy and paste the following code into your project".
5. Bump deps to newest stable / LTS.

Execution: git worktrees, one parallel agent per lane, gates per lane, full gate suite on the merge.

## Root causes (verified in source)

### A1. Fast on high fps — `components/hero-shader.tsx:338`
`state.t += 1 / 60` advances one fixed 60 Hz step **per rAF frame**. On a 144 Hz display the
rAF loop runs 144×/s, so time (and everything driven by `state.t`: ghost band positions,
selection re-picks at line 283) runs 2.4× too fast. The same per-frame assumption drives the
scroll speed (`state.off += state.speed + state.mom`, 0.35 px/frame) and every lerp
(`* 0.04`, `* 0.94`, `* 0.08`, `* 0.3/0.06`), so drag/flick feel is also refresh-rate dependent.

Fix: frame-rate-independent timing.
- Track `lastNow` in `frame()`; `dt = clamp((now - lastNow) / 1000, 0, 0.1)` (cap absorbs the
  hidden-tab gap on resume); `state.t += dt`.
- Convert per-frame units to per-second units (×60) and scale motion by `dt`:
  `state.off += (state.speed + state.mom) * dt * 60`.
- Lerp coefficients become exponential decay with the same 60 Hz feel at 60 Hz:
  `1 - Math.exp(-λ·dt)` where `λ = -ln(1 − perFrame) · 60`, and keeps-fractions become
  `Math.exp(ln(keep) · 60 · dt)`.
- Extract the math into a pure `components/hero-shader-timing.ts`
  (`frameDelta`, `lerpStep(perFrame, dt)`, `decayStep(keepPerFrame, dt)`) with a unit test in
  `tests/hero-shader-timing.test.ts` asserting 60 Hz vs 144 Hz equivalence over a simulated
  second (that's the runnable check — no hero test exists today; jsdom can't cover the canvas,
  the tab-switch case is verified manually in the browser during the gate phase).

### A2. Stops after tab switch — `components/hero-shader.tsx:205-209`
`onVisibilityChange` does `intersectionObserver.observe(canvas)` when the tab becomes visible
again — but the canvas was **already observed** (line 204). Re-calling `observe()` on an
already-observed target is a no-op and does not re-fire the callback, so `state.visible` stays
`false` forever and `frame()` early-returns at line 330. The canvas is `position: fixed inset-0`
(always intersecting), so the IO never rescues it.

Fix: `state.visible = document.hidden ? false : true` in the handler. Keep the IO (it still
covers real intersection changes) — do not re-observe.

### B. GitHub registry
- Repo root `registry.json` + `files[].path` matching real repo files = the documented GitHub
  registry shape (verified against the shadcn docs 2026-09-15). Same-repo `registryDependencies`
  use the full `DammersCode/gridcn/<item>` address, which the docs require.
- **The real problem: the default branch `main` is 65 commits behind `dev`.** `npx shadcn add
  DammersCode/gridcn/data-grid` (no ref) installs from `main` — i.e. stale code. The
  mechanism works; the content served is outdated. CI already runs
  `npx shadcn@latest registry validate DammersCode/gridcn#${{ github.sha }}` per push, but
  only for pushed SHAs.
- Verification plan (lane D):
  1. `npx shadcn registry validate DammersCode/gridcn#main` + `list` against the current
     remote (proves the mechanism today).
  2. End-to-end consumer smoke: scratch app in `%TEMP%` (Next.js), `shadcn init`, then
     `shadcn add DammersCode/gridcn/data-grid` + one add-on (`data-grid-fill`), then
     typecheck/build the scratch app.
  3. After the final merge (dev → main, if approved): re-run 1–2 against `main` so the shipped
     registry is proven, not assumed.

### C. Manual install (core)
`components/manual-install.tsx` (tree mode) renders fumadocs `File`/`Folder` — `File` is a plain
`div` (no href support in fumadocs-ui 16.15.8), and the step text "Copy the source folder into
your project" names no source. Add-ons already render per-file collapsed code blocks (correct,
keep).

Fix (core/tree mode only):
- Derive the GitHub source folder per file from the payload's own `files[].path`
  (`registry/default/blocks/<item>/...`) — no hardcoded mapping.
- Each tree file row becomes a link to
  `https://github.com/DammersCode/gridcn/blob/<branch>/<path>` (small local `LinkedFile`
  with the same `itemVariants` styling; fumadocs `File` can't take an href). Folders link to
  the GitHub `tree/` page.
- The step gets a primary link: open the source folder on GitHub and copy it into
  `components/` — the no-CLI path the user asked for ("Copy the source folder into your
  project" must state where the folder comes from).
- `content/docs/installation.mdx`: align the surrounding prose (GitHub source link).
- Branch for links: `gitConfig.branch` (`main`) in `lib/shared.ts` — the registry serves main.
- Open question (asked of user 2026-09-15): inline all 89 core files as copy blocks instead of
  linking (spec 2026-08-03 rejected this on page-weight grounds, ~600 KB highlighted HTML;
  default = links).

### D. Version bumps (all within-major, from `pnpm outdated` 2026-09-15)
| Package | From | To |
|---|---|---|
| next | 16.3.4 | 16.3.5 |
| react / react-dom | 19.2.8 | 19.3.0 |
| @types/react / @types/react-dom | 19.2.18 / 19.2.7 | 19.3.0 |
| fumadocs-core / fumadocs-ui | 16.15.8 | 16.15.11 |
| fumadocs-mdx | 15.4.0 | 15.4.1 |
| fumadocs-typescript | 5.4.0 | 5.4.1 |
| vitest + @vitest/browser, browser-playwright, coverage-v8 | 5.0.0 | 5.0.1 |
| oxlint | 1.82.0 | 1.83.0 |
| lucide-react | 1.42.0 | 1.46.0 |
| @babel/core | 8.0.1 | 8.0.5 |
| @tanstack/react-virtual | 3.14.11 | 3.14.13 |
| @types/node | 26.5.0 | 26.5.1 |

CI `.github/workflows/ci.yml` node 22 → 24 (current active LTS; local runtime is v24.15.0).
This lane is the riskiest (React/Next/fumadocs minors) — it exists to run the full gate suite
and fix fallout. Files: `package.json`, `pnpm-lock.yaml`, `ci.yml` — disjoint from A/B/C.

## Lanes, files, gates

| Lane | Branch/worktree | Files (disjoint) | Gate before commit |
|---|---|---|---|
| A — hero animation | `wt/hero` @ `C:\repos\danny\wt-hero` | `components/hero-shader.tsx`, `components/hero-shader-timing.ts`, `tests/hero-shader-timing.test.ts` | `pnpm types:check`, `pnpm lint`, `pnpm test` (unit; the new test), manual browser check (144 Hz feel n/a headless — verify no console errors + canvas draws + tab-switch resume) |
| B — manual install links | `wt/manual` @ `C:\repos\danny\wt-manual` | `components/manual-install.tsx`, `lib/read-registry-item.ts` (path passthrough if needed), `content/docs/installation.mdx`, possibly `lib/shared.ts` (already has `branch`) | `pnpm types:check`, `pnpm lint`, `pnpm build` (docs render), spot-check `/docs/installation` HTML for GitHub links |
| C — version bumps | `wt/upgrades` @ `C:\repos\danny\wt-upgrades` | `package.json`, `pnpm-lock.yaml`, `.github/workflows/ci.yml` | full suite: `pnpm types:check`, `pnpm lint`, `pnpm lint:typed`, `pnpm test`, `pnpm test:compiler`, `pnpm build`, `pnpm registry:build` + `pnpm registry:verify` |
| D — GitHub registry verify | main worktree (read-only + scratch app) | `scripts/` only if a permanent check is warranted (CI already has one — default: none) | verification evidence recorded in this file / CHANGELOG note |

Rules for all agents: no `Co-Authored-By` trailers, conventional small commits scoped to the
lane, no push, no changes outside the lane's file list (if a cross-lane need appears, report it
instead of editing).

## Orchestration

1. `git worktree add` ×3 from `dev`; `pnpm install` in each (shared store).
2. Three `general` task agents in parallel, one per lane A/B/C, each handed this file + its
   lane section + the gate list. Lane D runs in the main worktree concurrently (verification is
   read-only; scratch app lives in `%TEMP%`).
3. Merge `wt/hero`, `wt/manual`, `wt/upgrades` into `dev` sequentially (no expected conflicts —
   disjoint files), then run the **full** gate suite once on `dev`:
   `pnpm types:check && pnpm lint && pnpm lint:typed && pnpm test && pnpm test:compiler && pnpm build && pnpm registry:build && pnpm registry:verify`.
4. If approved: merge `dev` → `main`, push, re-run lane D verification against `main`, and
   re-verify the manual-install links point at real files on `main`.

## Open questions (asked 2026-09-15)

1. Merge + push `dev` → `main` at the end so the GitHub registry serves current code? (Registry
   reads the default branch; main is 65 commits stale.) → **yes** (user, 2026-09-15).
2. Core manual install: GitHub source links (default, light) vs inlining all 89 files as
   copy blocks (heavy page)? → **GitHub source links** (user, 2026-09-15).

## Outcome (2026-09-15, all gates green)

- **A hero animation** — `wt/hero` → dev (merge 637d7f2, commit 638c5bf): dt-based timing via
  `components/hero-shader-timing.ts` (`frameDelta`/`lerpStep`/`decayStep`), unit test
  `tests/hero-shader-timing.test.ts` (7 tests: 60 Hz vs 144 Hz equivalence, cap, edge cases).
  Tab-switch freeze fixed with `state.visible = document.hidden ? false : true` (the
  re-observe no-op bug). `draw` takes `dt = 1/60` as default so the reduced-motion one-shot
  draw is unchanged.
- **B manual install** — `wt/manual` → dev (merge be1dd80, commits 05871b2, bae1549): core file
  tree now links each file to `blob/main/<path>` and each folder to `tree/main/<dir>` (native
  `<details>` collapse — server component, zero JS). Verified on the built site: 91 blob + 12
  tree links on /docs/installation; add-on pages still render per-file code blocks.
- **C version bumps** — `wt/upgrades` → dev (merge 084d95e, commits dfd70b9, 7a20f33, 5ac874f,
  763aaeb): all 19 within-major bumps landed; fumadocs-ui patch re-keyed to 16.15.11 (same hunk,
  not fixed upstream); CI on Node 24. Fallout fixed: `app/llms.txt/route.ts` async/await
  (llms() index became async), streaming.browser.test.tsx timing sample batched (was flaky
  under load — passes in isolation and in the full suite).
- **D GitHub registry verified end-to-end**:
  - `npx shadcn@latest registry validate DammersCode/gridcn#main` → valid, 42 items.
  - Fresh Next.js 16.3.5 app (create-next-app + pnpm): `shadcn init -d`, then
    `shadcn add DammersCode/gridcn/{data-grid,data-grid-fill,data-grid-minimal-demo}` —
    all files + npm deps (zustand, @base-ui/react, class-variance-authority, react-day-picker,
    date-fns, cn, tw-animate-css) installed; minimal demo wired into the home page;
    `next build` (Turbopack) green.
  - Environment notes (not gridcn defects): pnpm 11's fresh node_modules layout left declared
    deps unlinked until a clean reinstall; Turbopack's CSS pipeline needs `picocolors` at the
    root under strict pnpm (scratch-only workaround).
- Full gate suite re-run on dev after the merges: types:check, lint, lint:typed, test
  (1871 passed), test:compiler (1871 passed), build, registry:build + registry:verify — all
  green.
- `dev` → `main` merge + push: done 2026-09-15. origin/main had meanwhile absorbed the old dev
  tip via PR #1 (17edb7c); local main merged dev (2c434ee) + origin/main, pushed as 8bd52c3.
  Post-push: `registry validate #main` → valid (42 items); spot-checked file on main via GitHub
  API (body.tsx, 12359 bytes). Raw.githubusercontent 404s right after the push are edge-cache
  lag, not missing files.
