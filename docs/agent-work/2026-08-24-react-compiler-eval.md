# React Compiler evaluation

Date: 2026-08-24
Branch: `react-compiler-eval`

## Verdict

**Works as-is.** The React Compiler compiles 315/315 components in this repo, the Next
build succeeds, and both vitest projects run compiled output with zero regressions in
real behavior. Two unit tests need adjusting — both assert on render counts/identity that
memoization legitimately changes, and neither indicates a broken component.

Adopting the compiler needs: the wiring in this commit, plus the 2 test edits listed under
[Test adjustments](#test-adjustments).

## Versions

| Package | Version | Note |
| --- | --- | --- |
| `react` / `react-dom` | 19.2.7 | already installed |
| `next` | 16.2.9 | already installed |
| `babel-plugin-react-compiler` | 1.0.0 | `latest` dist-tag — stable, no longer a beta/rc channel |
| `@rolldown/plugin-babel` | 0.2.3 | new dev dep, needed by vitest wiring |
| `@babel/core` | 8.0.1 | new dev dep, peer of the above |
| `vite` (via vitest 4.1.9) | 8.1.3 | satisfies `@rolldown/plugin-babel`'s `vite ^8` peer |
| `rolldown` | 1.1.5 | satisfies its `rolldown ^1.0.0-rc.5` peer |

`babel-plugin-react-compiler` reached 1.0.0, so no channel-matching against a React
prerelease is required. React 19.2 needs no `react-compiler-runtime` shim; the compiler
targets `react/compiler-runtime` directly via `target: "19"`.

## Setup that worked

### Next build

Next 16 graduated `reactCompiler` out of `experimental` — it is **top-level**:

```js
// next.config.mjs
const config = {
  reactStrictMode: true,
  reactCompiler: true,
};
```

Next bundles its own Babel for this; no extra dependency beyond
`babel-plugin-react-compiler`.

### Vitest (unit + browser)

This is the part that is not obvious and where the naive wiring silently does nothing.

`@vitejs/plugin-react` v6 **removed the `babel` option**. It transforms JSX with oxc, not
Babel, so `react({ babel: { plugins: [...] } })` is accepted by TypeScript-free JS and then
ignored at runtime — the suite runs green against *uncompiled* code and the evaluation is
worthless. v6 instead exports `reactCompilerPreset`, fed to `@rolldown/plugin-babel`:

```ts
// vitest.config.ts
import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset({ target: "19" })] }),
  ],
  // ...
});
```

`reactCompilerPreset` also sets a code prefilter (only files that look like they contain
components/hooks reach Babel) and restricts the transform to client environments, so the
Babel cost is not paid on every module.

### Guarding against silent no-ops

Because the failure mode above is invisible, the branch adds two tests — one per vitest
project — asserting the compiler's memo cache is actually emitted:

- `tests/compiler-wiring.test.tsx`
- `registry/default/blocks/data-grid/test/compiler-wiring.browser.test.tsx`

```tsx
expect(Probe.toString()).toMatch(/\$\[\d+\]/);
```

Matching `$[n]` cache slots rather than `_c(` matters: under Vite's SSR transform the
`_c` import is rewritten to a namespaced call, so a `_c(`-based assertion produces a false
negative. If the compiler is ever unwired, these fail loudly instead of the suite quietly
testing the wrong artifact.

## Results

### Test suites

| Suite | Before | After |
| --- | --- | --- |
| unit | 1450 passed / 1 failed (1451) | 1449 passed / 3 failed (1452) |
| browser | 377 passed / 5 skipped (382) | 377 passed / 5 skipped (383) |

Totals shift by one test each because the two wiring tests were added.

The browser suite is **unchanged**: zero regressions across all 377 tests, including the
whole scroll/selection/streaming/overlay surface.

### Failure classification

| Test | Category | Verdict |
| --- | --- | --- |
| `overlays.test.tsx` — pinned overlay zIndex | pre-existing | not compiler-related |
| `store.test.tsx` — columns identity guardrail | (b) memoization | expected; test needs adjusting |
| `data-grid-presence.test.tsx` — highlights render count | (b) memoization | expected; test needs adjusting |
| `streaming.browser.test.tsx` — concurrent scroll cost | (c) load flake | passes in isolation |

**No category (a) failures. Nothing the compiler touched changed real behavior.**

#### Pre-existing: `overlays.test.tsx`

Fails identically on the pre-compiler baseline. Commit `eee54e6`
(*refactor(layers): one named z-index scale*) changed `GRID_LAYER.pinnedCell` from `2` to
`20` and left this one assertion behind:

```
Expected: "2"   Received: "20"
```

A stale assertion on `main`, unrelated to this evaluation, worth fixing separately.

#### Category (b): `store.test.tsx` — "warns when the columns array identity changes every render"

The test's `Harness` builds a fresh array literal every render to trip the dev guardrail
that warns about unstable `columns` identity. The compiler memoizes that literal, identity
becomes stable, and the warning correctly does not fire.

This is the compiler doing exactly its job — it *fixed* the anti-pattern the test was
deliberately staging. The guardrail itself is untouched and still fires for genuinely
unstable input from uncompiled call sites.

Adjustment: make the identity change something the compiler cannot memoize away (e.g.
derive the array from a mutable ref or a changing prop), or mark the harness `"use no memo"`.

#### Category (b): `data-grid-presence.test.tsx` — "re-renders ONLY a component subscribed via useDataGridPresenceHighlights"

The harness assigns a module-scoped `let storeApi` **during render** and gates its child on
it:

```tsx
function PresenceCapture() {
  const presence = useDataGridPresence();
  storeApi = presence.storeApi;      // render-time mutation
  return null;
}

function Harness() {
  return (
    <DataGridProvider ...>
      <PresenceCapture />
      {storeApi && <MemoHighlightsProbe />}   // reads that mutation
    </DataGridProvider>
  );
}
```

It relies on a second `rerender()` observing a side effect written during the first render.
That breaks the rules of React, so the compiler memoizes `Harness`'s output and the second
pass reuses the tree computed while `storeApi` was still null. The probe never mounts, and
`highlightsRenderCount` stays 0 — hence `expected +0 to be 1`.

**The production hook is fine.** I verified this directly with an equivalent test that
passes `storeApi` as a prop and flips the gate in an effect instead of mutating during
render:

```
✓ highlights subscriber re-renders exactly once per set, with no render-time mutation
```

Exactly one re-render per `setPresenceHighlights` call, correct payload lengths on both set
and clear — precisely what the original test intended to assert. Only the harness's
render-time mutation is incompatible.

Adjustment: rewrite the harness to pass `storeApi` down as a prop rather than through a
render-time module variable.

#### Category (c): `streaming.browser.test.tsx`

```
expected 9.306666666517655 to be less than 7.859999999999999
```

A throughput threshold, failed in the full run and **passed cleanly when re-run alone**
(9/9). The full-suite run also reported `idle=154.5fps` against a `183.0fps` idle reading on
the quiet host, confirming the box was loaded during that pass. Load flake, not a
regression.

## Compiler bailouts

The default config skips functions it cannot safely compile, silently and correctly. To get
the full inventory I temporarily set `panicThreshold: 'all_errors'`, which turns every skip
into a hard build error — this is a diagnostic mode, not a viable setting.

Under that mode the build reports 30 files with diagnostics:

| Diagnostic | Count | Meaning |
| --- | --- | --- |
| Cannot access refs during render | 39 | ref reads in render paths |
| ESLint rule suppressed | 12 | `react-hooks/exhaustive-deps` disables (16 in `registry/`) |
| `Todo:` unsupported syntax | 6 | compiler feature gaps, not code faults |
| Cannot access variable before it is declared | 2 | hoisting patterns |
| Use of incompatible library | 1 | returns non-memoizable functions |
| Cannot reassign variables declared outside | 1 | module-scope reassignment |

Concentrated in `registry/default/examples/data-grid-demo.tsx` (28),
`data-grid-sorting-filtering-demo.tsx` (14), `root.tsx` (10), `data-grid.tsx` (10).

These are **not failures**. `react-compiler-healthcheck@1.0.0` — the tool designed to
answer this question — reports:

```
Successfully compiled 315 out of 315 components.
StrictMode usage found.
Found no usage of incompatible libraries.
```

(and 208/208 for `registry/**` alone). The healthcheck counts a component as compiled when
the compiler produces valid output for it; `panicThreshold: all_errors` additionally rejects
anything with a suppression or an unsupported-syntax `Todo`. The gap between the two is
opt-in strictness, not broken code.

The `Todo:` entries are worth noting as genuine compiler limitations rather than repo
issues: `UpdateExpression where argument is a global`, `tagged template where cooked value
is different from raw value`, and a non-reorderable `BinaryExpression`.

## Performance

Taken on a quiet host (idle fps in the healthy 173-193 band, so the reading is meaningful):

| Run | idle | full-swap | ratio |
| --- | --- | --- | --- |
| baseline (loaded host) | 110.2 fps | 24.4 fps | 0.222 |
| compiler on (loaded host) | 154.5 fps | 36.6 fps | 0.237 |
| compiler on (quiet host) | 183.0 fps | 38.5 fps | 0.210 |

The baseline was captured under load, so **these are not a clean before/after comparison**
and no speedup should be read into them. The honest conclusion is only that the compiler
introduces no perf regression — the ratio is stable at ~0.21-0.24 across all runs, and every
throughput assertion in the browser suite passes on a quiet host.

A real perf verdict needs a baseline re-measured on an idle machine. The grid is already
hand-optimized with manual `memo`/`useShallow` throughout, so large compiler gains are not
expected; the plausible win is removing the need to maintain that by hand.

## Registry distribution — a separate question

**This evaluation is app-level only.** It shows the compiler works on *this repo's* build and
tests. It says nothing about consumers who install grid source through the shadcn registry
and compile it with their own toolchain.

That distribution question is genuinely separate, because the registry ships **source, not
built artifacts** — consumer code is compiled by the consumer's compiler, under their config,
their React version, and their bailout thresholds.

What the evidence here does tell a consumer:

- The shipped source is compiler-clean: 208/208 components in `registry/**` compile.
- No incompatible libraries are used.
- Behavior is unchanged under compilation — the full browser suite passes compiled.

What a consumer would need:

1. **React 19** (or 17/18 plus `react-compiler-runtime`, untested here).
2. Their own `babel-plugin-react-compiler` wiring; nothing is inherited from this repo.
3. **Default `panicThreshold`.** A consumer running `all_errors` will hit the diagnostics
   above in installed grid source and their build will fail. This is the most likely
   support issue and is worth documenting.
4. No action for the `react-hooks/exhaustive-deps` suppressions in shipped source — they
   cause per-function skips, not errors, at the default threshold.

Two follow-ups worth considering before claiming compiler support in the docs: reducing the
suppressions in shipped `registry/**` source so consumers on strict thresholds are not
blocked, and testing the 17/18 + `react-compiler-runtime` path if those versions are
supported.

## Reproducing

```sh
git switch react-compiler-eval
pnpm install
npx vitest run --project=unit
npx vitest run --project=browser
npx next build
npx react-compiler-healthcheck@1.0.0 --src "{app,components,registry,lib}/**/*.{ts,tsx}"
```

Perf tests are load-sensitive; re-run a failing one alone before believing it.

## Test adjustments

Neither is a code fix — both are test harnesses relying on behavior the compiler
legitimately changes.

1. `registry/default/blocks/data-grid/test/store.test.tsx` — "warns when the columns array
   identity changes every render". Make the unstable identity non-memoizable, or opt the
   harness out with `"use no memo"`.
2. `registry/default/blocks/data-grid-presence/test/data-grid-presence.test.tsx` —
   "re-renders ONLY a component subscribed via useDataGridPresenceHighlights". Pass
   `storeApi` as a prop instead of assigning a module variable during render.

Separately, `registry/default/blocks/data-grid/overlays.test.tsx` has a stale `zIndex`
assertion that fails on `main` independently of this work.

## Continuous suite

The adjustments above are done, and the compiler now runs as a permanent opt-in suite.

Two projects in `vitest.config.ts` mirror `unit` and `browser` — same includes, same setup
files — plus the compiler. The default projects stay untransformed:

```
pnpm test           # unit + browser, compiler-free
pnpm test:compiler  # unit-compiled + browser-compiled
```

`@vitejs/plugin-react` 6 removed its `babel` option and **ignores it silently**, so a config
that passes `babel: {...}` to it produces a green run with no compiler attached. The compiler
goes through `@rolldown/plugin-babel` + the plugin's exported `reactCompilerPreset` instead,
declared per-project rather than at the top level.

`tests/compiler-wiring.test.tsx` and `compiler-wiring.browser.test.tsx` read the project name
from the worker context (`tests/compiler-mode.ts`) and assert both directions: the memo cache
is present under the compiled projects and absent under the plain ones. Each mode is named in
the test title, so the run output shows which one ran. Asserting only presence would let an
unwired compiler pass as a skip.

Both formerly-incompatible tests now pass under both modes without gating:

- `store.test.tsx` — the columns churn is constructed by the caller, leaving no render-scoped
  expression for the compiler to memoize. Still live: passing a stable array instead makes the
  guardrail fail under the compiler.
- `data-grid-presence.test.tsx` — `useDataGridPresence` mints a store per calling component, so
  the owner passes `storeApi` down as a prop rather than publishing it via a render-time
  mutation read back on a later render.

Browser server ports are pinned (5301/5302). The path-derived default can land inside a Windows
excluded port range and fail to bind with `EACCES`.

## Both paths, or compiler-only? (evaluated 2026-08-25)

The question: should the grid support/test both worlds — with and without the compiler — or
optimize for one?

**Both paths are not a choice; they are the distribution model.** The registry ships SOURCE, and
the consumer's build either has the compiler or does not. gridcn cannot pick for them, so both
paths exist in the wild regardless. The only real decisions are (a) which path the shipped source
is tuned for, and (b) whether both are tested. (b) is this suite.

**(a) stays: tuned for the uncompiled path.** The grid's performance comes from hand memoization
(memo'd rows/cells, zustand selectors, useShallow, identity-stable maps). Deleting that in favor
of the compiler would regress every non-compiler consumer — likely the majority for years. The
compiler on TOP of the hand tuning is redundant but harmless, which the A/B confirms.

**A/B on one box, interleaved rounds (dev server running, load shared by both paths):**

| round | uncompiled (idle / full-swap / ratio) | compiled (idle / full-swap / ratio) |
|---|---|---|
| 1 | 78.9 / 16.7 / 0.212 | 80.0 / 19.5 / 0.244 |
| 2 | 181.6 / 39.8 / 0.219 (quiet moment) | 79.1 / 16.0 / 0.202 |
| 3 | 76.7 / 16.1 / 0.210 | 76.6 / 15.5 / 0.202 |

Ratios sit in the same 0.20-0.24 band both ways; noise dominates. No regression, no measurable
gain — expected, because the compiler's memoization mostly duplicates work the code already does
by hand.

**Verdict: keep both paths exactly as this branch has them.** Source stays hand-tuned
(uncompiled consumers fast), the compiled projects + CI step guard the compiler path, the app
runs compiled as a dogfood. Cost: the compiled CI step's runtime, and dual-mode discipline in
tests (two needed rewrites; both were test anti-patterns worth fixing anyway). Follow-up worth
considering, not done: reducing the ~30 per-function bailouts so strict-panicThreshold consumers
never hit them.

