# Toolchain Speedup — Research and Decisions

Date: 2026-10-13. Request: make the local gates and the e2e install check faster, and adopt the
fastest reliable checker wherever a reliable replacement exists.

## Already fast — no change

- **Lint**: oxlint (Rust) + oxlint-tsgolint for the type-aware pass. Already the fast option.
- **Main typecheck**: `tsc` is TypeScript 7 — the native Go compiler (tsgo). The
  `types:check:ts5` gate stays on JavaScript TypeScript 5.9 by design: consumers run 5.9 and it
  infers differently (the e2e `closest()` failure of 2026-10-13 is a real example of that).
- **Build**: `next build` (16.3.6) already runs Turbopack — stable and the default for production
  builds since Next 16.
- **e2e install** (full 47-item run, measured 2026-10-13): scaffold 7 s, npm install 54 s,
  shadcn init 55 s, shadcn add 49 s, typegen 5 s, tsc 24 s, next build 67 s, start 6 s — about
  3.5 min total. The heavy steps are network/CLI (shadcn); the scaffold build is already
  Turbopack. `--reuse` already skips scaffold + install + init (~115 s) on repeat runs.

## Adopted: vmThreads pool for the jsdom unit projects

Problem: the `unit` and `unit-compiled` projects created a fresh jsdom environment per test file.
Vitest's own diagnostics: "jsdom was created 138 times · 4544 s total, 49% of tracked time."

Change: `pool: "vmThreads"` on both projects (`vitest.config.ts`). The environment is created once
per worker; per-file isolation is kept by the VM context. The bigger alternative
(`isolate: false`, which also shares the module graph) is rejected: shared module state across
files is too risky for a 2600-test suite with module-level stores and singletons.

Measured on this machine, identical gate commands, sequential runs:

| Project (gate command) | forks (before) | vmThreads (after) |
| --- | --- | --- |
| `unit` incl. coverage | 389.3 s | 99 s |
| `unit-compiled` | 369.9 s | 98 s |

Full local gate set (types:check + ts5 + lint + lint:typed + all four test projects): ~16 min
before, ~6.5 min after (2026-10-13 numbers). CI runs the same commands, so it gains the same.

Compatibility fix: under the vm pools a test file's global is the contextified jsdom window
itself, where `document` is a non-configurable own accessor (`navigator` and friends stay
configurable). `vi.stubGlobal("document", ...)` therefore throws
`TypeError: Cannot redefine property: document`. The only test doing that — `printGrid`'s SSR
no-op case — moved to `print-grid-ssr.test.ts` with `@vitest-environment node`, where the
`typeof document === "undefined"` guard is exercised for real instead of through a stub.

Reliability fix: the `normalize-payload-eol` shell-out test (git + node spawn) flaked against the
default 5 s timeout under full-suite load (twice in this work, passing in isolation); it now has
a 15 s budget - the same pattern the heavy `print-grid.test.ts` case uses.

Reliability follow-up (2026-10-14): the 100k-row timing-budget perf tests flake a random
2-5-subset of the full unit suite under load (each passing in isolation; one file even failed
its first retry when the machine stayed loaded through the run) - the vmThreads pool runs
files concurrently, so the budget-sensitive tests contend for CPU with the rest of the suite.
The `unit` and `unit-compiled` projects now retry a failed file twice (matching the browser
projects, which carry `retry: 2` for the same flake class); a real failure fails all retries.

## Considered and rejected

- **bun as package manager**: pnpm carries the `fumadocs-ui` patch, the `overrides`, and the
  lockfile CI caches; gate time is dominated by test runs, not installs. No measurable win,
  migration risk (patch format, lockfile, CI actions).
- **oxfmt (oxc formatter)**: beta (0.72.x) as of 2026-10. The repo has no formatter at all (no
  prettier/biome config, no format script), so adopting it means a new gate plus a whole-repo
  reformat — not a speedup. Revisit at the stable release if a format gate is wanted.
- **Replacing the consumer-facing tsc** (ts5 gate, e2e scaffold tsc) **with tsgo**: that removes
  the thing the checks exist for (5.9 inference differences).
- **fsModuleCache**: transforms are 1–2% of the unit run's time; no win available.
- **pnpm for the e2e scaffold install** (~25 s saved on npm install): changes the consumer realism
  of the check; skipped.
