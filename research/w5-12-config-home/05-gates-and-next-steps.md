# W5-12 — gates and next steps

## Gate results

| Gate | Command | Result |
|---|---|---|
| Types (repo TS) | `pnpm types:check` | green |
| Types (consumer TS 5.9) | `pnpm types:check:ts5` | green |
| Lint (payload match, import boundaries, registry deps, compiler bail-out baseline) | `pnpm lint` | green (bail-outs: 243 files, baseline unchanged) |
| Typed lint | `pnpm lint:typed` | green |
| Unit (with coverage thresholds) | `npx vitest run registry --exclude "**/*.browser.test.*" --project unit --coverage` | 2502/2502 tests green; first final run RED on coverage: `default-keymap.ts` branches 75% < 90% bar (the new W5-12 helpers untested) → added branch tests for `mergeKeymap`/`keymapContentEqual` to `keyboard/index.test.ts`; final rerun in progress |
| Browser | `npx vitest run --project browser --bail=1` | 599 passed, 6 skipped (52 files) — a11y, keybindings, context-menu, scroll-drag wasted-render suites green |
| React Compiler behavior | `pnpm test:compiler` | GREEN — all grid tests pass (184/185 files; the one failure was `tests/normalize-payload-eol.test.ts`, a timing-bound script test that flakes under machine load and passes on a standalone rerun: 8/8). Two W5-12 test patterns were compiler-unsound and got fixed test-side; grid source unchanged (see `04-tests.md`) |
| Payload rebuild | `pnpm registry:build` + `node scripts/normalize-payload-eol.mjs` + `pnpm lint` + `pnpm lint:typed` | green after the final source state (283 payload files match source; bail-outs 243, baseline unchanged) |

## Open items before the commit

1. **Final unit+coverage rerun** in progress (after the `keyboard/index.test.ts` branch tests).
   Everything else above is confirmed green.
2. **Commit** (only when every gate is green):
   - `feat: move readOnly, keymap, and click/window callbacks to the provider as sync props (W5-12)`
     — source, tests, examples, payloads, docs, skills, CHANGELOG.
   - `docs: record W5-12 as done in plan 016` — `plans/016-improve-audit-followups.md` status
     table (W5 row; R-93 and R-100 close with it) + this folder.
   - Do not push unless asked.
   - Registry payload changed → `pnpm test:e2e-install` (installs the affected demos into a fresh
     Next.js app, type-checks, builds, renders; 5–10 min) and, before pushing, the remaining CI
     mirror steps (`pnpm test:compiler` — done via gate 7, `pnpm build` with no dev server
     running).

## After the commit

Next queue item per the plan's execution order: **W5-11** — controlled selection and layout
(`selection`/`defaultSelection`/`onSelectionChange(next)`, controlled `columnLayout`, drop
`onSelectionCleared`, absorb `setColumnLayout`), spec `research/controlled-selection-layout-spec.md`.
W5-11 rides the recompute phase of the two-phase sync that W5-12 introduced, and lands before
W6-05 (`commitChange`) and W5-13 (plugins), which both depend on it.
