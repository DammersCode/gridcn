<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Code Comments

Write a comment only when the code cannot say it. The code says *what*; the comment says the *why* the code cannot express.

- Default: no comment. A good name or structure beats any comment.
- Add a comment only for one of: a non-obvious constraint outside the code (browser quirk, platform limit, an invariant the types cannot express); a workaround for an external bug (name the bug); a deliberate simplification and its ceiling (state the upgrade path); a public API's semantics the signature does not show (JSDoc).
- Delete instead of writing: restatements of the line below; pointers to other code ("memoized like X" — read that code instead); history ("used to ..."); references to external tracking (plan, spec, workplan, advisor, or finding IDs such as "G5", "plan 012", "spec 4b", "workplan #80"); commented-out code; markers that name the obvious.
- One idea per comment, at most 25 words, one line. Short plain English: active voice, condition before statement, no "should", "could", "may".
- JSDoc (`/**`) documents the API for its users; keep it well-formed (tools parse it). The 25-word and one-line caps yield only when the API cannot be stated shorter (complex semantics, an invariant the signature cannot show). `//` comments note implementation details for the file's readers only.
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

## Registry exports (registry/default/blocks/**)

A block's barrel file is the consumer's import surface: what the barrel exports is what a
consumer can import. Keep the surface to the public API.

- Export only what the docs teach the reader to call (for example `useDataGridClipboard`), or
  what IS the add-on's API.
- A hook or utility that only mounts a layer a component already exposes is internal: define it
  next to the component, keep it off the barrel.
- Test: grep `content/docs` for the name. If the docs never tell the reader to call it, do not
  export it. Existing barrel exports are grandfathered; do not add new ones.

## Workflow

### Gates

All green before committing — a red gate gets fixed, not committed around. Run in order:

1. `pnpm types:check`
2. `pnpm lint`
3. `pnpm lint:typed`
4. `npx vitest run registry --exclude "**/*.browser.test.*" --project unit --coverage`
5. `npx vitest run --project browser`

A single failed test: rerun that one file once before debugging (the browser project flakes; see Environment). Still red on the rerun = a real failure.

Before pushing, additionally mirror the remaining `.github/workflows/ci.yml` steps locally: `pnpm test:compiler`, `pnpm build` (stop any running dev server first — shared `.next`), `pnpm registry:build`, then `node scripts/normalize-payload-eol.mjs`, `git add public/r`, and `pnpm registry:verify`. The CI-only steps (`shadcn registry validate`, hosted-registry verify — both need the pushed SHA or the deployment) are the final authority: a push is not done until GitHub CI is green on it.

### Push and commits

- Push only when the user explicitly asks for it.
- Conventional prefixes (`feat:`, `fix:`, `docs:`, `chore:`, `test:`), imperative subject.
- Never add a `Co-Authored-By` trailer.

### Changelog

A user-facing change to the registry (component behavior, props, API, new item) or to the docs examples gets an entry under `## Unreleased` in `CHANGELOG.md` (Keep a Changelog style, `**Breaking:**` marker where applicable) in the same commit. Docs prose edits and internal/test-only changes: no entry.

### Specs and plans

A non-trivial behavior change (cross-file interaction, new gesture or API semantics) gets a short spec in `research/` before implementation; simple fixes skip it. Keep specs short — they are the decision record, not a novel.

### Environment (local dev machine, Windows)

- nvm-windows can resolve `node` to a stale major; if node misbehaves, prepend the pinned dir:
  `$env:PATH = "C:\Users\dahe\AppData\Roaming\nvm\v24.15.0;" + $env:PATH`
- `node_modules/vitest/dist/chunks/constants.-juJ8b_4.js` carries a local port patch (browser project → 45731) because the default port is blocked by the system. Never commit `node_modules`; if `pnpm install` reverts the patch, re-apply it.
- Registry payloads (`public/r/*.json`) stay on the committed EOL convention: after `pnpm registry:build`, always run `node scripts/normalize-payload-eol.mjs` (discards EOL-only drift, keeps real changes) before staging `public/r` — otherwise the diff bloats to every item.
