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

### Page status and "New" badges

Docs follow the same discipline as the changelog: every added or substantively changed section is marked in the same commit, before a task is called done. Deleted pages and sections are not marked (the sidebar shows only new and updated content); a removal gets a `CHANGELOG.md` entry instead.

The sidebar dot comes from `content/docs-changes.json`, not from page frontmatter. `pnpm docs:changes` writes it: a page absent at the baseline is `new`, a page changed in substance is `updated`. The baseline is the last tag of the previous minor version (1.2.x compares with the last 1.1.x tag). Patch releases add to the markers of their series. Page dots appear when `pnpm docs:changes --release <version>` runs for the release, not in the commit that adds a page. `pnpm lint` fails when the committed file disagrees with the tagged release (it never reads the working tree) and on any `status:` line in `content/docs`.

- A section, paragraph, props-table row, or list item added to an existing page gets `<NewBadge />`: on its own line under a heading, after the first inline term of a paragraph or list item, or in the first cell of a table row. A badge inside heading text breaks the table of contents and the anchor. A page new since the baseline needs no section badges.
- Release procedure: before the release commit, run `pnpm docs:changes --release <version>` and commit the result with the release. The command also removes every `<NewBadge />` that was not added since the baseline, so a new minor version starts clean and a patch release keeps its series.

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

## Review lessons

Bugs that shipped or reached review more than once. Check each against your change. `scripts/verify-source-rules.mjs` (run by `pnpm lint`) enforces the ones a pattern can catch.

### Input and gestures

- End a gesture on `pointercancel`, `lostpointercapture`, or blur with teardown only. Commit only on `pointerup`: four drag hooks committed cancelled drags.
- Capture a long drag with `safeSetPointerCapture` on the scroll element. A row that leaves the rendered rows drops its capture, and a refused capture throws.
- Remove every document listener, timer, and deferred retry at gesture end, on a second pointer, and on unmount. Leaked ones fired on dead grids.
- Decide a press at click time: start a drag only after the pointer leaves the pressed target, and cancel the click after a drag or a released modifier. Presses changed the selection and opened links.
- Leave events from inputs, cell editors, portaled popups, and interactive header contents to them, and skip global shortcuts during an edit session. Grid handlers stole their keys, clicks, and clipboard events.
- Scope document-level handlers to the grid that owns the focus or the event. Nested and sibling grids doubled or stole keys, clipboard events, and Mod+F.

### Keyboard and focus

- A removed tab stop gets a keyboard path in the same commit. Taking row marker checkboxes and the header menu trigger out of the Tab order removed their keyboard access.
- Return focus to the grid only when the keyboard opened the thing from the grid, and never over a control the user clicked in the meantime.
- Outside an edit, leave Tab and Shift+Tab to the browser. A Tab commit keeps the browser's focus move: the grid trapped Tab twice.
- Gate a keydown with `isComposingKey`, never with bare `isComposing`. Safari confirms an IME composition with keyCode 229.
- Check a new keyboard chord against browser and OS reservations: Ctrl+Alt is AltGr on Windows, Ctrl+Option+Space is VoiceOver, Ctrl+Shift+E opens DevTools in Firefox and Edge. Give it a docs row.

### State and data

- Honor `sortMode="server"` in every view, row-operation, streaming, and warning path. Read `viewSorts`, not raw `sortState`: three paths reordered or warned on server-sorted data.
- Anchor state that outlives a view rebuild (active cell, checked rows, ranges, edit session, cut, flashes) to row id and column id, never to a view index. Seven fixes moved such state onto other records.
- Change the selection through the compact channel operations, and update every channel that a gesture touches. Never spread or materialize a channel: `Math.min(...rows)` throws at 100k rows.
- Handle lazy holes and band rows in every view-row reader. They have no data index and no row object, and readers threw or passed `undefined` row ids.
- After an `await`, read the store again. Drop the result if a newer request, `readOnly`, or a changed selection or row set replaced it: late parses, cuts, fills, and fetches overwrote newer state.
- Check `readOnly` on every write path: commit, edit start, paste, fill, cut, undo, and redo. Six fixes added the check to paths that lacked it.
- Fire consumer callbacks after the outermost store write, and isolate each call so that one throw cannot drop the rest.
- Skip a controlled-prop sync when the value is unchanged, not only when the reference is. An equal `filterState` rebuilt the view on every sync.
- Warn in development only (`isDev`), once per instance, and only on a proven misuse. False identity and presence warnings took five fixes.
- Render display cells as plain elements with `role` and `aria-*`. A mounted control in every cell doubled the scroll cost.

### Security and untrusted data

- Convert a cell value to text through `toSafeText`, never bare `String(value)`. A null-prototype value crashed display, copy, and export.
- Parse in linear time with anchored regexes, and bound the input length. The number, date, and fill-series parsers froze on hostile digit runs.
- Bound every import, paste, URL value, and export on each dimension before the parse or the build: bytes, rows, cells per row, sheets, list lengths. Each missing dimension shipped as its own fix.
- Validate URL state against the live columns, their visibility, and their choices. Specs for hidden or removed columns reached the view.

### Docs and release

- Put `<NewBadge />` on its own line under a heading, never in the heading text. A badge in a heading broke the build.
- A fix to shipped behavior gets its changelog entry in the fix commit. A fix to unreleased behavior needs none. A release audit found nine fixes without an entry.
- A registry change rebuilds the payloads and declares every import of the item in the same series of commits. A new demo also gets an entry in `components/registry-examples.tsx`.
- Render docs and demos the same on the server and the client: pin locales, read the platform from a server snapshot, and check the server HTML. Hydration mismatches and sidebar flashes took six fixes.

### Process

- Fix a bug class in every sibling in the same series: grep the other drag hooks, cell types, editors, and handlers. Column reorder kept the cancel bug that row reorder had fixed.
- Make sure that each docs and JSDoc claim matches the code or a test. The docs said that a duplicate row id resolves to the last row, but the code takes the first.
- A test that races animation frames dispatches its input synchronously.

## Vocabulary

`GLOSSARY.md` is the source of the ubiquitous language. Use its words in code, comments, docs, skills, messages, and commit messages. Add a new term there before you introduce it. `scripts/verify-vocabulary.mjs` (run by `pnpm lint`) rejects the words the glossary replaces; write identifiers such as `ops` in code spans.

## Optional search tools

No setup is required; grep and glob always work. When the tools are installed, use them for the question they answer best:

- cocoindex-code (MCP tool `search` or the `ccc` skill) for vague questions such as "where is X done?".
- Serena for exact symbol questions such as a definition or its callers.

Setup is in `DEVELOPMENT.md`.

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

A user-facing change to the registry (component behavior, props, API, new item, or a removal or rename) or to the docs examples gets an entry under `## Unreleased` in `CHANGELOG.md` (Keep a Changelog style, `**Breaking:**` marker where applicable) in the same commit. Docs prose edits and internal/test-only changes: no entry.

### Specs and plans

A non-trivial behavior change (cross-file interaction, new gesture or API semantics) gets a short spec in `research/` before implementation; simple fixes skip it. Keep specs short — they are the decision record, not a novel.

### Environment (local dev machine, Windows)

- nvm-windows can resolve `node` to a stale major; if node misbehaves, prepend the pinned dir:
  `$env:PATH = "C:\Users\dahe\AppData\Roaming\nvm\v24.15.0;" + $env:PATH`
- `node_modules/vitest/dist/chunks/constants.-juJ8b_4.js` carries a local port patch (browser project → 45731) because the default port is blocked by the system. Never commit `node_modules`; if `pnpm install` reverts the patch, re-apply it.
- Registry payloads (`public/r/*.json`) stay on the committed EOL convention: after `pnpm registry:build`, always run `node scripts/normalize-payload-eol.mjs` (discards EOL-only drift, keeps real changes) before staging `public/r` — otherwise the diff bloats to every item.
