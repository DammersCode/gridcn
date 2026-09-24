# Plan 014 — Docs nav regrouping, demo install validation, @shadcn/lint, hero mobile

Branch: `docs/improvements` (worktree `C:\Users\dahe\AppData\Local\Temp\opencode\gridcn-docs-improvements`).
Precondition: Plan 013 fully green (at `689a49b`; gates types:check/build/test/lint/registry:verify all exit 0).
All four tasks run in parallel, touch disjoint file areas, and each closes with its own commit.
Push nothing — local until the user asks.

## Shared rules

- Commit style as in the repo (`docs:`, `fix(home):`, `chore(lint):`, `test:`), NO `Co-Authored-By` trailer.
- Gates per task below; at the end of each task block: `pnpm build` green (MDX trap: unclosed component tags are only found by the build).
- PowerShell: git-grep patterns in single quotes; `git grep` output has no `.Line` property.
- Browser tests: the vitest `browser` project, include pattern `registry/**/*.browser.test.{ts,tsx}` — so new browser tests go UNDER `registry/` (or deliberately widen the include pattern).
- node_modules corruption observed in this worktree (missing chunk files): symptom `Cannot find module './<name>.js'` from `.pnpm/<pkg>` → fix: `Remove-Item -Recurse -Force node_modules\.pnpm\<dir>` + `pnpm install`.

## Task 1 — Docs nav regrouping + content moves

Scope (user decision): **grouping + content moves** (no full re-audit of all pages).

1. `content/docs/meta.json`: the flat feature list into subgroups (fumadocs `---[Icon]Title---` sections,
   icons from lucide, check what exists). Target structure (the agent may vary within the principles):
   - **Editing**: editing-cell-types, custom-cell-types, clipboard
   - **Selection & navigation**: selection-keyboard, sorting-filtering-search
   - **Rows & data**: row-operations, streaming-updates, lazy-loading, lazy-loading-advanced, pagination
   - **Columns & layout**: columns, styling-theming, i18n
   - **Architecture**: overlay-plugins, performance, virtualization, accessibility
   Principle: groups by user intent; order within groups by learning path (easy → advanced).
   Slugs/URLs stay UNTOUCHED (only nav order/groups) — except for the Task-2 moves.
2. **Row-markers move**: the H2 `Row markers` + H3 `Custom markers` from `content/docs/columns.mdx` to
   `content/docs/row-operations.mdx` (right spot: after the row-op sections, before the
   pinned-rows cross-link). Example page `content/docs/examples/columns/row-markers.mdx` →
   `content/docs/examples/rows/row-markers.mdx` (file move + adjust the nav groups in
   `content/docs/examples/columns/meta.json` and `rows/meta.json` respectively).
   Find the inbound URLs `docs/examples/columns/row-markers` and the anchors `columns#row-markers` /
   `columns#custom-markers` via `git grep` and move them (content + registry + app).
   The demo `data-grid-row-markers-demo` stays in the registry.
3. Cross-link check afterwards: `git grep -rn "docs/columns#\|docs/row-operations#\|examples/columns/row-markers" content app registry`
   → every link must point at an existing heading/URL (fumadocs slugs: `&` → `--`, em-dash → `--`,
   backticks/dots dropped, `&`-slug example: `keyboard--accessibility`).
4. Gates: `pnpm types:check`, `pnpm build`, link check as in (3). Manual: the nav in `pnpm dev` shows the
   groups in the sidebar; `/docs/columns` and `/docs/row-operations` render; `/docs/examples/rows/row-markers` exists.
5. Commit: `docs: regroup the feature nav and move row markers to the row pages`

## Task 2 — Demo install validation (fleet)

Goal: proof that every registry demo (currently ~20 items in `registry/default/examples/*.tsx` +
`registry.json`) **works immediately after install, without extra configuration**.

1. **Static install check (script, 1× for all)**: NEW `scripts/verify-demo-install.mjs`:
   for every `registry:example` item in `registry.json`: (a) `registryDependencies` +
   `dependencies` references exist as items in `registry.json`; (b) every `files[].content` import
   (from `@/registry/...`, `@/components/ui/...`, `@/lib/...`, and npm packages) resolves:
   payload files of the same + dependent items, `components/ui/**` from the repo, `components.json` aliases,
   or an npm package declared in `package.json` (deps/devDeps). Unresolvable = FAIL with item + import name.
   `package.json`: script `"demo:verify": "node scripts/verify-demo-install.mjs"`.
   Run it; fix all FAILs (registering missing deps in the demos' `package.json` = adding them to
   `registry.json` `dependencies` + `pnpm registry:build`).
2. **Runtime smoke (browser test, 1× for all)**: NEW
   `registry/default/examples/demo-smoke.browser.test.tsx` (pattern: `demo-fit.browser.test.tsx`):
   mounts EVERY demo and asserts: `[role="grid"]` exists, > 0 data rows, and where a demo has a
   documented core access (a button at the top of the demo, e.g. Undo/Move-down/Filter-Add), a generic
   click smoke (element visible and enabled). No demo-specific deep testing — that belongs in the
   existing, demo-own tests. Fix new FAILs in the demo (not by weakening the test).
3. **API cross-check (fleet, read-only)**: per demo with a third-party API, one agent:
   - validation: zod/joi/valibot + Standard Schema (Standard-Schema spec)
   - lazy/server-side: @tanstack/react-query (useQuery/useMutation/onMutate/onError), nuqs
   - recipe examples in the docs: RHF (useForm/register/handleSubmit) — code check only (none is a demo item)
   - fill/pinned/presence/toolbar/sort-list/url-state/keybindings/io: gridcn-own API only (checked against
     `content/docs/api-reference.mdx` + source JSDoc, no external docs)
   Check: the API exists in the installed version (`node_modules/<pkg>/package.json`),
   the signature/usage in the demo code is correct, no stale/removed options, demo deps in
   `package.json` with a compatible version. Result: per item one block in
   `research/demo-validation-report.md` (item, library+version, APIs checked, status OK/FIXED,
   what changed). Fixes directly in the demo code + `pnpm registry:build` + payload commits as in the earlier task windows.
4. **E2E install spot-check (1×)**: install the `data-grid` item (or `data-grid-fill`) into a fresh,
   minimal Next.js+shadcn project and build + smoke:
   - Local registry hosting: `npx serve` (or a Node inline server) on the worktree root
     (registry.json + public/r/), `components.json` in the test project: `"registry": "http://localhost:<port>/registry.json"`
     (if the shadcn CLI does not accept that: fallback = copy the payload files 1:1 as in the payload JSON —
     equal proof value for "no extra configuration").
   - `npx shadcn@latest add data-grid --cwd <test-project>`, `pnpm build`, screenshot + grid render check
     (node/playwright or agent-browser). Test project under `C:\Users\dahe\AppData\Local\Temp\opencode\e2e-install-check\`.
   - Report + command protocol: `research/demo-e2e-install-report.md`.
   - If the CI gate `shadcn registry validate` (ci.yml) points at the branch state: check locally only,
     no CI change.
5. Gates: `pnpm demo:verify`, `pnpm test` (unit+browser), `pnpm registry:build && pnpm registry:verify`,
   `pnpm build`.
6. Commits (max 2): `test: add demo install and runtime smoke verification` +
   `fix(registry): <listed demo fixes>` (if fixes are needed).

## Task 3 — @shadcn/lint into the oxlint gate

Facts: Oxlint 1.83.0 (≥1.80 ✓), config `.oxlintrc.json`, `pnpm lint` = `oxlint . && verify-import-boundaries`,
the CI step "Lint" calls `pnpm lint` → **no CI change needed**.

1. `pnpm add -D @shadcn/lint`.
2. `.oxlintrc.json`:
   - `"jsPlugins": ["@shadcn/lint"]`
   - settings.shadcn: `ui` to the shadcn alias (`components.json` → `aliases.components`,
     i.e. `@/components/ui`), `componentImports` for `^@/registry(/|$)` (registry components are
     own, className-forwarding designs), `mergeFunctions` stays default (cn/cx/clsx/cva/tv/...).
   - Rules: `shadcn/no-unknown-classes: error`, `shadcn/no-raw-colors: error`,
     `shadcn/no-restyle: ["error", { allow: ["layout"] }]`.
   - **Gridcn components are deliberately className-overridable** (DataGrid & DataGridRoot forward
     `className` via `cn()`, demos use `rounded-none border-none`): per `overrides` (files
     `registry/default/blocks/**` + `app/**`) `no-restyle: off` OR contracts
     `{ pattern: "^(DataGrid|DataGridRoot)$", allow: ["all"] }` — the agent picks what goes green with the least
     noise and documents the choice in a config comment.
   - `components/ui/**` stays under no-restyle (layout-only): Button/Card/Dialog & co. keep
     their own padding/shape.
3. Run `pnpm lint`: FIX the violations (theme tokens instead of raw colors, existing sizes instead of
   restyling). If a rule systematically yields false positives (e.g. `no-unknown-classes` does not know
   Tailwind-v4 generics): lower the rule to `warn` + reason in a config comment, do NOT silently
   switch it off.
4. Gates: `pnpm lint` exit 0, `pnpm build` exit 0, `pnpm lint:typed` exit 0 (the ESLint config stays untouched).
5. Commit: `chore(lint): add @shadcn/lint design-system rules to the oxlint gate`

## Task 4 — Hero page mobile (viewport 375×667)

Scope (user decision): the complete root page `/` at **375×667** (user: "375x667").
Documentation pages are explicitly NOT in scope.

1. Fix `app/(home)/page.tsx:191`: the tagline card
   `mx-6 ... max-w-2xl ... px-10` → `w-full max-w-2xl px-6 sm:px-10` (drop mx-6; otherwise
   width 100% + margins → overflow). The same check for all sections below the hero on the
   page (the comparison table ~L228 ff. among them): every element must stay free of
   document overflow at 375px (wide tables may get a horizontally SCROLLABLE area:
   `overflow-x-auto` on the container, not on the document).
2. NEW `registry/default/examples/home-mobile.browser.test.tsx` (browser project include):
   - Viewport exactly `375x667` (Playwright device "iPhone 8" or manual), `page.goto("/")`
     (the real route incl. layout) — take the pattern from existing browser tests (e.g.
     `tests/compiler-wiring.test.tsx` or `registry/**/…browser.test.tsx` for `page` access).
   - Asserts: `document.documentElement.scrollWidth <= 375`; the hero card
     (the `max-w-2xl` box with the H1 "gridcn") visible (offsetParent != null) and its width <= 375;
     screenshot attachment. If the layout header navigation itself overflows: fix that too.
   - If `page.goto` is not available in the harness (component rendering only): fallback =
     `render(<HomePage/>)` + the layout header component, the same asserts on document.
3. Gates: `pnpm vitest run --project browser registry/default/examples/home-mobile.browser.test.tsx`
   green, `pnpm test` (unit+browser) green, `pnpm build` green.
4. Commit: `fix(home): fit the landing page to a 375px viewport and add the mobile test`

## Order & parallelization

- Tasks 1, 3, 4 are independent → parallel (1 agent each).
- Task 2: parts 1+2 (script+smoke test) FIRST, sequentially, before the fleet, because all fleet agents
  should see the same repo; part 3 (API cross-check) then as a fleet (1 agent per demo cluster,
  read-only + fixes in disjoint demo files); part 4 (e2e) parallel to 3.
- Conflict rule: only ONE agent on `package.json` (Task 3). Task-2 fleet agents may
  change `package.json` only via the Task-2 lead (collect dependency notes, no direct edits).
- After ALL tasks: the final gates `pnpm types:check && pnpm build && pnpm test && pnpm lint && pnpm registry:verify`
   once green, then compare `git log` against this plan file (4–6 commits expected).
