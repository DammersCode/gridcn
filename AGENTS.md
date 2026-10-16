<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project

gridcn is a React 19 + TypeScript data grid distributed as a shadcn registry (`npx shadcn add @gridcn/data-grid`) and documented on a Fumadocs site. Real DOM cells, Tailwind v4, Base UI primitives, Zustand store per grid instance, no TanStack Table. Target: smooth at 100k rows.

- `registry/default/blocks/<item>/` — the shipped source; each folder is one registry item. `data-grid` is the core, the other folders are add-ons.
- `registry/default/examples/` — demos the docs embed through `<ComponentPreview>`.
- `content/docs/` — docs pages. `CHANGELOG.md` — user-facing changes.
- `public/r/` — generated registry payloads. Never edit by hand; `pnpm registry:build` writes them.
- `plans/`, `research/`, `PLAN.md` — decision records and specs. Read the one that covers your task before changing behavior.
- `scripts/` — verification scripts that `pnpm lint` and `pnpm registry:verify` run.

## Language

Everything in this repo is written in English: code, comments, docs, plans, research notes,
changelog, commit messages, and PR text. Write new content in English; translate content found
in another language.

## Code Comments

Write a comment only when the code cannot say it. The code says *what*; the comment says the *why* the code cannot express.

- Default: no comment. A good name or structure beats any comment.
- Add a comment only for one of: a non-obvious constraint outside the code (browser quirk, platform limit, an invariant the types cannot express); a workaround for an external bug (name the bug); a deliberate simplification and its ceiling (state the upgrade path); a public API's semantics the signature does not show (JSDoc).
- Delete instead of writing: restatements of the line below; pointers to other code ("memoized like X" — read that code instead); history ("used to ..."); references to external tracking (plan, spec, workplan, advisor, or finding IDs such as "G5", "plan 012", "spec 4b", "workplan #80"); commented-out code; markers that name the obvious.
- One idea per comment. Aim for one line. Use up to three lines (about 60 words) for an invariant, an ordering constraint, or a platform quirk that one line cannot hold. If it needs more, simplify the code or move the text to JSDoc or a spec. Short plain English: active voice, condition before statement, no "should", "could", "may".
- JSDoc (`/**`) documents the API for its users; keep it well-formed (tools parse it). The length caps yield only when the API cannot be stated shorter (complex semantics, an invariant the signature cannot show). `//` comments note implementation details for the file's readers only.
- Test names carry the spec. Comment a test only for non-obvious setup or the reason an assertion exists.
- When you edit a comment that no longer earns its place, delete it.

Examples:

- Before: `// Memoized like the overlay node.` → After: (delete)
- Before: `// Quick-search never narrows viewIndex (PLAN §3, perf spec 6).` → After: `// Quick-search highlights and navigates; it never filters.`

## Docs (content/docs/**)

Write docs prose with the `simple-english` skill (`.agents/skills/simple-english`): short sentences, conditions before commands, one term per concept, no hedges. Run its self-check before delivering.

The reader is external. They never saw our plan, our alternatives, or our IDE:

- State what a prop or feature does, never how its shape was decided. No rejected alternatives or phantom contrasts ("an object, not an array" — the array never existed for them). State properties positively.
- No toolchain-visible behavior: compiler errors for invalid usage and IntelliSense behavior happen in the reader's editor while they type. Cut them.
- JSDoc is exempt: type-level guarantees belong in the IDE, where they show.
- Timeless: no "now", "new", "currently", "latest", "soon", "eventually", "as of this writing". Docs describe the current state; `CHANGELOG.md` is the time-stamped place for "new".
- Reference descriptions state what the thing does ("`onUndo` dispatches the undo entry"), not what the developer uses it to do.
- Introduce a code sample with one sentence ending in a colon. Mark omissions with a comment in the sample's language, never `...`.
- Numbered lists only when item order carries meaning: evaluation order, precedence, display order, or steps the reader runs in sequence. Everything else takes bullets. Never a one-item list — write it as prose.

Component and addon page structure (match the existing pages):

1. One short paragraph: the problem the add-on solves and the API that solves it.
2. `<ComponentPreview name="data-grid-...-demo" />` — the live demo comes first.
3. `<InstallCommand ... />`.
4. Behavior the reader cannot see until the app runs: defaults, gating rules, cross-feature interaction.
5. Props as a markdown table (`| Prop | ... | Default |`), one table per concern.
6. Warnings as `<Callout type="warn">`: command or condition first, then the risk.
7. `## Related` links at the end.

## API design (registry/default/blocks/**)

Design every public hook, function, and component from the caller's side.

- An `options` parameter whose fields are all optional defaults to `{}`: `useX(opts: XOptions = {})`, so `useX()` compiles. `scripts/verify-optional-options.mjs` (run by `pnpm lint`) enforces this; add a `no-arg.type-test.ts` that calls the API with no arguments.
- The common case needs no arguments and no wrapper: a sensible default beats a required field.
- One options object per concern. Positional parameters are for the data a function acts on (`exportGrid(state, options)`), never for settings.
- A callback with several values of equal rank takes one ctx object: `onFoo({ columnId, width })`. The primary value first with trailing extras (`createRow(index)`, `validateRow(row, rowId)`) is fine.
- Controlled pairs follow React: `value` / `onValueChange` plus a one-shot `defaultValue` seed.
- Boolean options are positive and default `false` (`disabled`, `readOnly`); feature gates are `enableX` and default `true`.
- A hook that mounts a grid plugin returns `{ plugin }`; spreadable state hooks return `plugins`. Both work inline in `plugins={[...]}`.
- A common task takes few lines in the docs example. If an example needs boilerplate every time, the library absorbs it.

## Registry exports (registry/default/blocks/**)

A block's barrel file is the consumer's import surface: what the barrel exports is what a
consumer can import. Keep the surface to the public API.

- Export only what the docs teach the reader to call (for example `useDataGridClipboard`), or
  what IS the add-on's API.
- A hook or utility that only mounts a layer a component already exposes is internal: define it
  next to the component, keep it off the barrel.
- Test: grep `content/docs` for the name. If the docs never tell the reader to call it, do not
  export it. Existing barrel exports are grandfathered; do not add new ones.

## Security

Grid data and imported files are untrusted input.

- Render values with React text nodes or `textContent`. Never pass a cell value to `innerHTML` or `dangerouslySetInnerHTML`. If markup is required, sanitize it first.
- Links come from `safeHref` (`http`, `https`, `mailto` only). Add no new protocol.
- Bound every parse of imported files (XLSX, XLS, CSV, clipboard) through the library's own options. Do not hand-mirror a library parser; it diverges and gets bypassed.
- Neutralize formula-like text on CSV export.
- Add no dependency without a reason in the commit message. `pnpm audit --prod` must show no HIGH finding.
- Never put secrets, tokens, or personal data into code, tests, fixtures, or docs.

## Workflow

### Gates

All green before committing — a red gate gets fixed, not committed around. Run in order:

1. `pnpm types:check`, then `pnpm types:check:ts5` (consumers run TypeScript 5.9, which infers some types differently from the repo's TypeScript 7)
2. `pnpm lint`
3. `pnpm lint:typed`
4. `npx vitest run registry --exclude "**/*.browser.test.*" --project unit --coverage`
5. `npx vitest run --project browser --bail=1` (about 2 minutes; `--bail=1` stops a failure cascade early)

Fast check while you work: `npx vitest run <file> --project unit` for a unit file, `npx vitest run <file> --project browser` for a browser file. Run the full gates before you commit.

Browser runs share one port. Take the lock before a `--project browser` or `browser-compiled` run: loop `mkdir C:/repos/danny/.review-browser-lock` until it succeeds, run, then `rmdir` it, also on failure. Use `--maxWorkers=3` under load.

A single failed test: rerun that one file once before debugging (timing-budget perf tests flake under machine load; the browser config's `retry: 2` absorbs them). Still red on the rerun = a real failure. Many failures in one file = shared-state pollution, not flake: look for an un-awaited `render()`/`unmount()` (both return Promises; `pnpm lint:typed` enforces `no-floating-promises` on browser tests).

Before pushing, additionally mirror the remaining `.github/workflows/ci.yml` steps locally: `pnpm test:compiler`, `pnpm build` (stop any running dev server first — shared `.next`), `pnpm registry:build`, then `node scripts/normalize-payload-eol.mjs`, `git add public/r`, and `pnpm registry:verify`. When a registry payload changed, also run `pnpm test:e2e-install` (installs the affected demos into a fresh Next.js app, then type-checks, builds, and renders them; about 5–10 minutes). That run also executes the feature smoke suite (`scripts/e2e-smoke.mjs`, 14 scenarios against `next start` of the installed app, about 30 s) when a demo changed or you pass `--smoke`. `pnpm test:e2e-smoke [app dir]` runs only that suite against an app prepared by `pnpm test:e2e-install --reuse` (default `<tmpdir>/gridcn-e2e-scaffold`), and it needs the browser lock like the other browser runs. The CI-only steps (`shadcn registry validate`, hosted-registry verify — both need the pushed SHA or the deployment) are the final authority: a push is not done until GitHub CI is green on it.

### Push and commits

- Push only when the user explicitly asks for it.
- Conventional prefixes (`feat:`, `fix:`, `docs:`, `chore:`, `test:`), imperative subject.
- Never add a `Co-Authored-By` trailer. Once per clone, run `git config core.hooksPath .githooks`: its `commit-msg` hook rejects AI attribution in commit messages. PR and issue text is not checked; keep it free of attribution too.

### Changelog

A user-facing change to the registry (component behavior, props, API, new item) or to the docs examples gets an entry under `## Unreleased` in `CHANGELOG.md` (Keep a Changelog style, `**Breaking:**` marker where applicable) in the same commit. Docs prose edits and internal/test-only changes: no entry.

### Specs and plans

A non-trivial behavior change (cross-file interaction, new gesture or API semantics) gets a short spec in `research/` before implementation; simple fixes skip it. Keep specs short — they are the decision record, not a novel.

### Environment (local dev machine, Windows)

- nvm-windows can resolve `node` to a stale major; if node misbehaves, prepend the pinned dir:
  `$env:PATH = "C:\Users\dahe\AppData\Roaming\nvm\v24.15.0;" + $env:PATH`
- `node_modules/vitest/dist/chunks/constants.-juJ8b_4.js` carries a local port patch (browser project → 45731) because the default port is blocked by the system. Never commit `node_modules`; if `pnpm install` reverts the patch, re-apply it.
- Registry payloads (`public/r/*.json`) stay on the committed EOL convention: after `pnpm registry:build`, always run `node scripts/normalize-payload-eol.mjs` (discards EOL-only drift, keeps real changes) before staging `public/r` — otherwise the diff bloats to every item.
