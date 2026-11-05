# Docs rewrite plan

Decision record. It plans the rewrite of `content/docs` to fit the new navigation (candidate C19, ruleset in
`research/docs-navigation-ruleset.md` on branch `claude/clever-colden-9f2e91`), defines "done", and names the validators
that prove it. No page moves in this branch. The rewrite starts when the owner approves the final navigation.

Inputs: the ruleset, scoring, migration plan, content map, and candidate file of the navigation branch; `AGENTS.md` (Docs);
the `simple-english` skill; `GLOSSARY.md`; `research/parity-matrix.json`.

## 1. Strategy

Owner decisions that bind this plan: more pages are fine; the glossary stays small; `AGENTS.md` may change; hooks need no
live demo, and trivial hooks get a code sample only.

1. **Rewrite against the code, not against the old text.** A writer reads the source page and the real code. The code wins.
   Every changed claim goes in the writer report with `file:line`.
2. **One page, one writer, one file.** The work list gives each target page to exactly one batch. Batches write disjoint
   files, so they run in parallel and merge in any order.
3. **No page is exempt.** A "move" page still fails today's prose rules (see the baseline), so the action column sets the
   starting point of the writer, not the finish line. Every page meets the whole definition of done.
4. **Machine first, judge second.** `pnpm docs:verify` runs before every verifier. The verifier (a different, stronger model)
   checks what no script can: claim against code, template fit, demo need, wall of text, simple English, parity.
5. **Anchors and links are verified last and by script.** Writers link pages and anchors that exist; the integrator owns
   redirects, `meta.json`, the codemod, skills, and `CHANGELOG.md`.

### Page actions

Counts come from `research/docs-rewrite-worklist.json` (224 pages in 32 batches for C19; regenerate it when the candidate
changes with `node scripts/docs-rewrite-worklist.mjs --candidate <file> --content-map <file>`).

| Action | Pages | What the writer does |
|---|---|---|
| move | 70 | Keeps the text. Sets `type`, `title`, `description`, `aliases`, Related, and fixes whatever the validators flag. Heading text stays, so anchors survive. |
| split | 67 (+9 mixed) | Cuts the old page along the H2 sections of the content map. Adds an intro paragraph and Related. Heading text stays. |
| merge | 4 (+2 mixed) | Combines two sources under one concept, then removes duplicates (rule P6: one fact, one page). |
| rewrite | 3 | New structure from the old facts: Start here, Install, Pagination. |
| new | 70 | Written from the code and the specs. Includes the Server path steps, the contracts, Messages, Task finder, the Learning path steps, and 44 landings (one line per child, generated list). |

New-page families the owner named: the performance chapter (`performance/`, written by the perf-docs session), the three
hook pages, the Server path, the Messages reference, Terms and help, saved views (`remember-view`), and the add-on options
pages (generated from the types with `<AutoTypeTable>`).

### Order

| Wave | Content | Who |
|---|---|---|
| 0 Freeze | Merge the docs-touching branches (section 5). Regenerate the work list, URL map, and anchor map. Skeleton PR: `git mv`, `meta.json`, redirects, codemod, `type` in the schema. | Integrator (navigation session), not the fleet |
| 1 Cut | `move`, `split`, `merge` pages. Mechanical; creates the headings that later pages link. | Sonnet writers, Opus verifiers |
| 2 Write | `new` and `rewrite` pages that need judgment: Learning path, Server path, Extension path, contracts, Messages intro, upgrade, row limits. | Sonnet writers (Opus writes the 6 contract pages), Opus verifiers |
| 3 Generate and link | Generators (finder, Terms alias table, feature matrix, cheatsheets, landing lists, Messages, options pages), landings, skills, README, `llms.txt`, changelog line. | Sonnet coders, Opus reviewer |
| 4 Whole site | Global validators, A10 gate, search test, persona runs (beginner and senior), fix rounds. | Opus reviewers, Haiku for mechanical re-checks |

Waves 1 and 2 may overlap per area once an area's wave-1 batches are accepted.

## 2. Definition of done

A page is done when every row passes. The site is done when every row passes site-wide and the persona run passes.
"Run" is `pnpm docs:verify` unless another command is named. Every machine row has zero failures.

| # | Check | How | Pass rule |
|---|---|---|---|
| D1 | No dead link or anchor | `docs:verify --only links` over `content/docs`, `skills/**`, `public/skills/**`, `README.md`, `GLOSSARY.md`, `DEVELOPMENT.md`, `CHANGELOG.md`, `AGENTS.md`, `app`, `components`, `lib`, `registry/default/**` comments, `registry.json`, `research/parity-matrix.json`, `lib/llms-tasks.ts` | 0 dead; 0 links that only work through a redirect (the changelog is exempt) |
| D2 | Redirect coverage | `docs:verify --only links --migration research/docs-navigation` | Every old URL is a page or a redirect; every anchor of `anchor-map.json` resolves to a page and heading; `verify-llms-markdown` (in `pnpm lint`) lists each page once with a 200 |
| D3 | Code samples compile | `docs:verify --only code` extracts every `ts` and `tsx` block and type-checks it against the registry source | 0 failures. The first sample of every page uses no undefined name and is paste-ready (imports, hooks inside a component); the verifier dry-reads it. A block that cannot compile carries `fragment="reason"`. Fragments are at most 20% of a page's blocks, and their imports still resolve. A reviewer samples 10 fragments |
| D4 | Props tables match source | `docs:verify --only props --strict` | Every props table has a `{/* props: Type */}` marker; 0 unknown names, 0 default or required mismatches; options pages use `<AutoTypeTable>` or list every member (`undocumented` is 0) |
| D5 | Named symbols exist | `docs:verify --only symbols` | 0 unknown symbols; every `<AutoTypeTable>` resolves; exceptions live in `scripts/docs-symbols-allow.txt` with a reason |
| D6 | Demos resolve | `docs:verify --only demos` | Every `<ComponentPreview>` is registered and has a file; every `<InstallCommand item>` is in `registry.json`; every registered example is embedded or listed in `scripts/docs-demos-internal.txt` |
| D7 | Demo rule | `demos` warnings plus verifier | A demo only where a code sample cannot show the behavior (visual, interactive, timing). 0 on reference, concept, step, cheatsheet, landing, and hook pages. At most 1 per page, except example pages or `demos: compare` |
| D8 | Budgets and structure | `node scripts/docs-nav-audit.mjs --check` (and `--candidate`, `--queries` on the final navigation) | 0 failures; every page has a `type` (`docs:verify --require-type`) |
| D9 | No wall of text | `prose` rules `long-paragraph` (110 words, 7 sentences) and verifier | 0 hits; no run of prose over 250 words without a heading, list, table, code, or callout |
| D10 | Simple English | `docs:verify --only prose`, then the `simple-english` self-check by the verifier | Hard rules 0 (sentence over 25 words, code line over 80 characters, banned modals, contractions, `;`, filler; late condition and `-ing` clause are soft); passive at most 3 per page; the verifier's self-check finds nothing on the 3 longest sentences and every `if` or `when` sentence |
| D11 | Terms | `pnpm lint` (`verify-vocabulary`), verifier | Words match `GLOSSARY.md`; every uncommon term is defined at first use or links Terms; Terms lists only uncommon terms |
| D12 | AGENTS.md docs rules | `prose` (`timeless`, `toolchain`, `omission-dots`, `intro-colon`, `one-item-list`), `structure` | 0 hits; no `status:` line; `<NewBadge />` never in a heading; `content/docs-changes.json` equals the base branch; phantom contrast reviewed by the verifier |
| D13 | Client and server parity | `docs:verify --only structure --worklist research/docs-rewrite-worklist.json` plus verifier | Every Feature page with `parity` ids has an H2 "Server mode"; the verifier proves each non-`n/a` cell of `research/parity-matrix.json` against the text; `gap` cells read as gaps |
| D14 | Frontmatter | `structure` | `title` at most 60 characters and unique; `description` at most 160; Related has 1 to 5 docs links (landings exempt); aliases have one owner each |
| D15 | Search | `node scripts/docs-nav-audit.mjs --queries research/docs-navigation/reader-queries.txt <candidate>` plus the built-index test | Every query returns its page in the first 3 results |
| D16 | Docs shell accessibility (A10) | The browser gate script of the navigation branch at 1280 and 375 px | All A10 checks pass; results in `gate-results.md` |
| D17 | Skills in sync | `pnpm lint` (`verify-skills`, `sync-skills --check`), `docs:verify --only links`, verifier | Both skill copies link only existing pages and anchors; every "where to look" claim is true |
| D18 | Repo gates | The gate list of `AGENTS.md` | Green. A registry change (new example) rebuilds `public/r` |
| D19 | Changelog and markers | Reviewer | One `CHANGELOG.md` line under Unreleased for the move and each fixed shipped claim; new sections carry `<NewBadge />` as the markers rule says |
| D20 | Whole-site persona run | Beginner and senior reviewers, task battery and dimensions of `docs-navigation-scoring.md` | No task is a miss; every task is answered in at most 3 clicks and 8 screens; D1 to D8 means are at least 8.5 and none is below 7 |

## 3. Validators

All live in `scripts/`, share `docs-verify-lib.mjs`, and print at most 5 failures per check. `pnpm docs:verify` runs them;
`--only a,b` picks checks; `--files p1,p2` limits the report and the compile step to those pages (used per batch; orphan demos and inbound links to a listed page stay visible). `--warnings` prints the warnings. Each compile run uses its own temp directory, so parallel runs do not interfere.

| Script | Check | Notes |
|---|---|---|
| `verify-docs-links.mjs` | D1, D2 | Heading slugs match the site slugger, honor `[#id]` and `id="..."`. Reads redirect sources from `next.config.mjs`. |
| `verify-docs-code.mjs` | D3 | Extracts blocks, runs the repo TypeScript. Free names become `any`, so a fragment still checks the API it uses; a gridcn name that the registry does not export fails. A syntax error removes the block from the program first, because `tsc` skips semantic checks while any syntax error exists. |
| `verify-docs-props.mjs` | D4 | Parses `interface` and `type` members with a small tokenizer (the repo's TypeScript 7 has no JS API). Pins by marker, guesses by name overlap otherwise. Defaults compare to `name = literal` and `name ?? literal` in the same block. |
| `verify-docs-symbols.mjs` | D5 | Every inline-code name that looks like a gridcn symbol must appear in the registry source. |
| `verify-docs-demos.mjs` | D6, D7 | Cross-checks `components/registry-examples.tsx`, `registry.json`, and the embeds. |
| `verify-docs-prose.mjs` | D9, D10, D12 | Mechanical subset of the `simple-english` rules and of the AGENTS.md docs rules. `{/* lint-ok: reason */}` above a paragraph skips it (for quoted API text). |
| `verify-docs-structure.mjs` | D13, D14 | Frontmatter, Related, aliases, duplicate titles, the Server mode H2 per work list, `docs-changes.json`. |
| `docs-rewrite-worklist.mjs` | Work list | Candidate plus content map to JSON and a table. Not part of `docs:verify`. |
| `docs-nav-audit.mjs` | D8, D15 | Belongs to the navigation branch. `docs:verify` runs it when the file exists. |

Tests: `tests/docs-verify.test.ts` (fixture sites, one case per rule).

### Wiring into `pnpm lint`

Not wired yet. The full run takes about 20 s (the compile step is most of it), and today it fails on the current docs by
design. Rule: when `links`, `demos`, `symbols`, and `structure` reach zero (they take about 1 s together), add
`docs-verify.mjs --only links,demos,symbols,structure` to `pnpm lint`. The compile and prose checks stay in `docs:verify`
and in CI as a separate step until the rewrite lands, then join the lint.

## 4. Baseline (current docs, 100 pages, release/2.0 at 257c1976)

| Check | Result |
|---|---|
| links | 8 dead of 887 (6 anchors in `recipes/data-fetching/server-side` and `async-gates` point at headings that `pagination` and the server page no longer have; `api-reference` points at `#define-columns`; `verify-parity.mjs` was a false hit and is fixed) |
| code | 245 `ts`/`tsx` blocks: 121 fail to compile (a syntax error, an undefined name in the first sample, or a real API mismatch such as a `DataChange` that is not generic), 10 need a package the repo lacks (drizzle, prisma, supabase), 114 pass; 0 fragments marked. An earlier run showed 34 because it silently dropped syntax errors |
| props | 16 tables, 67 rows: 0 pinned, 13 guessed, 3 unmatched. In strict mode 8 mismatches (3 unmatched tables, `blockSize` and `overscan` not in `UseDataGridServerRowsOptions`, 3 `Default` cells for required members). The API pages already use `<AutoTypeTable>`, which cannot drift |
| symbols | 704 names, 0 unknown (one allow-list entry) |
| demos | 94 embeds, 62 registered, 0 orphans, 0 failures; 16 pages embed several demos |
| prose | 690 hard failures in 100 pages: code lines over 80 characters 212, long sentences 281, `;` 68, long paragraphs 34, intro colon 22, banned modals 16, omission dots 11, contractions 10, timeless 8, filler 5; soft: passive 260, late condition 258, `-ing` clause 100, phantom contrast 51 |
| structure | 6 failures: 5 duplicate titles (TanStack Query, SWR, Pinning, Row operations, Custom cell type), 1 Related over 5 links; 42 pages without Related; 100 pages without `type` |
| audit (`--check`) | 31 failing pages (20 over the word cap, 14 over the screen cap, 5 over the H2 count, 10 duplicate titles, 1 under 80 words) |

## 5. Merge order and conflict handling

Branches that change `content/docs` today (files changed against `release/2.0`): `feat/sr-announcements` 29,
`feat-lazy-paging-gaps` 17, `w2-write-path` 13, `w4-specs-views` 7, `w3-aggr-lookup` 5, `w2-filters` 5, `w2-io` 3,
`fix/keyboard-pointer-findings` 1, `perf-sort-1m` 1. Landing and performance docs are in sibling branches too.

1. **Before the freeze.** Merge these into `release/2.0` first, in the order of the most prose changed. The rewrite then
   starts from a docs tree nobody is still editing. The navigation session announces the freeze commit.
2. **After the freeze, nobody edits old paths.** A branch with pending docs edits re-applies them to the new page. The tool
   is a writer batch with the brief "port this diff onto page X" (the diff comes from `git diff <base>..<branch> -- content/docs`);
   renames of moved-only pages follow git's rename detection, splits do not.
3. **Fleet branches.** Each batch works on `docs/rewrite-Bnn` cut from the skeleton commit and changes only its pages. The
   verifier accepts or rejects the branch. Accepted branches merge with `--no-ff` in wave order; because files are disjoint
   the order is free inside a wave.
4. **Shared files belong to the integrator**, never to a writer: `meta.json`, `components/registry-examples.tsx`,
   `lib/llms-tasks.ts`, `next.config.mjs` redirects, `skills/**` and `public/skills/**`, `README.md`, `CHANGELOG.md`,
   `content/docs-changes.json`. A writer lists the change it needs in its report.
5. **A feature branch that lands during the rewrite** adds a work-list row (new page) or a patch task (changed page). The
   work list is regenerated; the batch that owns the page re-runs.

## 6. Fleet design

| Role | Model | Input | Output |
|---|---|---|---|
| Batch writer | Sonnet | Writer brief (appendix A), the batch rows, the source pages | Edited pages and a report |
| Batch verifier | Opus | Verifier brief (appendix B), the writer report | Verdict, claim table, findings |
| Fixer | the writer (same context) | The verifier findings | Fix, second verifier run |
| Link and anchor checker | script | `docs:verify --only links` | Failures |
| Code compiler | script | `docs:verify --only code` | Failures |
| Claim-vs-code checker | Opus (inside the verifier) plus `symbols` and `props` scripts | Pages and source | Claim table |
| Simple-English pass | `prose` script, then the verifier's self-check | Pages | Failures |
| Generator coder | Sonnet, reviewed by Opus | One generator spec each | Script and tests |
| Whole-site reviewer | Opus, two personas | Built site or sources, scoring file | Scores per task and dimension |

Loop per batch: writer, scripts, verifier, fix, verifier again. Two fix rounds at most; then the integrator rewrites the page.
Up to 6 writers run at once (the compile step is CPU heavy). Expected size: 32 content batches in waves 1 and 2, 7
generator tasks, 1 link-sync task, plus fix rounds: about 40 writer runs and 75 verifier runs.

The persona run uses the task battery in `docs-navigation-scoring.md` (B1 to B7, E1 to E9, X1 to X5) on the finished
site, one beginner and two senior runs, scored on D1 to D8 of that file.

## 7. Pilot

Three pages of three types went through the full loop in this branch: Fill handle (Feature, with a Server mode),
Open a detail panel (Task), and useDebounce (Reference, three symbols that later split into three pages). Each had one
Sonnet writer and Opus verifiers. They are committed as pilot pages and keep their current paths.

| Page | Writer passes | Verifier rounds | Outcome |
|---|---|---|---|
| Fill handle | 3 (about 2 min each) | 3 (7 to 10 min each) | Round 3 left 3 must-fix findings. The integrator applied them; no fourth round ran. |
| Open a detail panel | 3 | 3 | Accepted in round 3 (nits only) |
| useDebounce | 2 | 2 | Accepted after round 2 with 2 small term fixes made by the integrator |

**What the machine checks caught** (writer iterations): two long sentences, a banned word, a duplicate-title risk, long code
lines, a broken inbound link after a heading rename, a first sample that used an undefined name.

**What only the verifier caught**, and the scripts missed:

- Wrong server contract. The writer guessed that the server answers with saved rows; the real contract is `onSave` that
  resolves, resolves with `{ rejected }` (which may carry `current`), or rejects.
- False absolutes: "nothing commits during an IME composition", "the browser never reloads on Ctrl+R", "Date series are not
  detected". Each was false on at least one path (blur and flush commit; read-only grid and edit sessions let the key through;
  same-month ISO dates continue as text plus a number).
- A dropped true caveat (the echo flicker of the debounce hook) and a dropped fact (what `extrapolate(index)` counts).
- Samples that compile only because the checker turns unknown names into `any`: a missing prop type, unused imports, a sample
  that cannot produce the Result it claims (no close button, so Escape never fires), a date detector that throws on its own
  page's example.
- A removed demo that left an orphan and took the only code that backed three prose claims with it.
- Terms: "commit" and "IME" used without definition.

**Product findings** (not docs defects; the owner decides): `detectSeries` turns two same-month ISO dates into invalid dates
(`2026-01-32`); a fill whose accepted values equal the current values returns early and never reports rejections; with
`disabled: true` the touch context menu still shows Fill down and Fill right; the fill add-on lets Ctrl/Cmd+R and Ctrl/Cmd+D
reach the browser in a read-only grid while the core swallows them without the add-on; a throwing consumer `detectSeries`
is not isolated.

**Changes the pilot forced** (all committed):

- The code check reported nothing for a block with a syntax error. Fixed; the baseline rose from 34 to 121 failing blocks.
- Parallel runs shared one directory. Each run now has its own.
- Imports of hook and lib items (`@/components/gridcn/*`) did not resolve. They do now.
- `Pick<>` option types did not resolve, and tables with fewer than three rows or a `Result` header were skipped.
- `--files` hid orphan demos and inbound links to a changed page. Both now stay visible.
- Warnings were not printed. `--warnings` prints them.
- The first sample of a page may not use an undefined name. Later samples may (free names become `any`).
- A code line over 80 characters fails (imports and comments excepted).
- The one-item-list rule counted a numbered step list with code between steps as several lists. It counts per section now.
- The briefs gained the truth rules (prove every kept claim; diff the dropped facts; dry-read samples), the full links run, the
  demo-precedence rule, and the report fields (kept claims, dropped facts, product bugs).

**Cost.** One page cost about 3 writer runs and 3 verifier runs. The verifier does the real work: most of the 18 must-fix findings of
round 1 across the three pages were claims against code or samples that the scripts accepted. Plan for 2.5 verifier rounds per
page on average, so about 80 Opus runs for 32 batches of up to 10 pages (a batch is verified as one unit, with one report).
Cap at 3 verifier rounds; then the integrator finishes the page and a final verifier reads only the changed lines.

## 8. What waits for the final navigation

- The page list, titles, slugs, URLs, and batches (regenerate the work list from the approved candidate).
- The `type`, `aliases`, `finder`, `kind`, `modes`, `stability`, `since` frontmatter keys and their schema.
- The skeleton PR, redirects, anchor map, and codemod.
- The generators (their inputs are those keys).
- Everything in `content/docs` except the pilot pages.

What is ready now: the validators, the work-list generator, the briefs, and the DoD.

## 9. Open questions for the owner

1. **Product bugs found while verifying.** Five findings (section 7). Should the docs wait for fixes, or document today's
   behavior and note the gap? Default in this plan: document what the code does today.
2. **Strictness of samples.** Only the first sample of a page must be free of undefined names; later samples may use
   placeholders (`data`, `columns`). Accept, or require full samples everywhere (about 120 blocks to rewrite)?
3. **Fragments.** At most 20% of a page's blocks may be fragments. Accept?
4. **Verifier rounds.** Cap at 3, then the integrator finishes. Accept?
5. **Lint wiring.** Add `links,demos,symbols,structure` to `pnpm lint` once they are at zero, and the rest to CI only until
   the rewrite lands. Accept?
6. **Quoted API text.** `{/* lint-ok: reason */}` skips a paragraph in the prose check (for example a quoted warning with
   "should"). Accept, with the verifier reading each use?
7. **`"use client"` in samples.** The pilot pages differ. Proposal: a sample that calls a hook starts with `"use client"` only
   when it is a whole file in an App Router project, and never in fragments. Decide, then the briefs say so.
8. **Frontmatter keys** `type`, `aliases`, `finder`, `kind`, `modes`, `stability`, `since`, `demos` need the page schema in
   `source.config.ts`. `demos: compare` and `demos: none` are new keys of this plan. Fold them into the navigation change?
9. **`<NewBadge />` on moved pages.** The plan lets writers badge only new sections of pages that exist at the last release tag;
   the release command prunes the rest. Accept?
10. **Persona run cost.** One beginner and two senior runs on the finished site. Accept the cost, or run one senior?
11. **Content-map gaps.** 70 target pages have no source text (new). 79 old anchors have no target yet
    (`anchors-needing-review.txt`). Who assigns them: the split writers or the navigation session?
12. **Examples area.** 32 example pages of 100 to 500 words each go through the same checks. Skip the Related rule for them?

## Appendix A: writer brief

Fill the slots, then hand it to a Sonnet writer. The orchestrator also gives the worktree path.

Rewrite ONE page of the gridcn docs (React data grid, shadcn registry, Fumadocs MDX in `content/docs`). Work only in your batch branch. No AI attribution anywhere. No competitor or other-product names. English only. Do not commit unless told.

Slots the orchestrator fills: `{{ROW}}` (the work-list row: slug, title, type, words, aliases, action, parity ids, sources, carried demos), `{{TARGET_FILES}}`, `{{TEMPLATE}}`, `{{SERVER_RULE}}`, `{{FILES_CSV}}`.

## Files
You may edit only `{{TARGET_FILES}}`, plus single link lines in other pages whose links your heading changes broke. Do not move or rename files. Do not edit `meta.json`, `registry/**`, `components/registry-examples.tsx`, `lib/llms-tasks.ts`, `skills/**`, `README.md`, `CHANGELOG.md`, `content/docs-changes.json`, `next.config.mjs`. Put the change you need in those files into your report.

## Read first
1. `AGENTS.md`, section "Docs (content/docs/**)".
2. `.agents/skills/simple-english/SKILL.md` (self-check section) and `GLOSSARY.md`. Use its words ("scroll mode", "row id", "view index").
3. The ruleset (`research/docs-navigation-ruleset.md`; until it is merged: `C:\repos\danny\gridcn\.claude\worktrees\clever-colden-9f2e91\research\docs-navigation-ruleset.md`), sections 1 and 2, for your page type. Template:
{{TEMPLATE}}
4. The source page(s) of the row and the real code they describe (`registry/default/blocks/**`, `registry/default/hooks`, `registry/default/lib`). The code is the truth. The old page is a lead, not a source.
5. Feature page with parity ids: `research/parity-matrix.json` (cells that are not `n/a`) and the write path (`store/types.ts` `onSave`, `store/write-ack.ts`).

## Truth rules (the verifier checks each)
- Before you keep any behavioral claim of the old page (a default, what a callback receives, when it fires, a limit, what a warning says, a keyboard result), open the code or a test that proves it. A claim you cannot prove is cut or marked as an open question. "Never", "always", and "nothing" need proof for every case.
- Diff your page against the source: every fact you drop is either wrong (cite `file:line`) or stays. A caveat the old page had stays unless the code contradicts it.
- If you remove a demo, remove every claim that only the demo backed, or put the code that backs it in the page.
- Prose that describes a result must match what the page's samples produce. Dry-read each sample.
- Report product bugs you find (a sample or claim that exposes wrong behavior) in the report. Do not hide them in prose.

## Rules the validators enforce
- Frontmatter: `title` (at most 60 characters, key word first, imperative for Task and Step), `description` (at most 160 characters, says what the reader can do), `type`, `aliases` (words a reader types that the page does not use; one owner each), keep `icon`.
- Budget: the row's words as target, the hard cap of the type as limit. Paragraph at most 110 words and 7 sentences, sentence at most 25 words, code line at most 80 characters. No `;`, no should/would/may/might/could, no contractions, no filler words, no "now/currently/latest/soon". Active voice, condition before command. "Most recent" is fine.
- Code: every `ts` and `tsx` block compiles (`@/components/<item>/<file>` for blocks, `@/components/gridcn/<file>` for hook and lib items). The validator turns unknown free names into `any`, so it cannot tell you a sample is paste-ready: give every first sample its imports and wrap hooks in a component. Mark an omission with a comment, never `...`. A block that cannot compile carries `fragment="reason"` in its fence info (imports of a fragment still resolve).
- Props tables: put `{/* props: TypeName */}` on the line above. Every row must be a member of that type and a literal default must equal the source default. Prefer `<AutoTypeTable>` for a full list.
- Demo: the row's demo field is a start, the demo rule decides. A demo only where a behavior cannot be understood from a code sample (visual, interactive, timing). None for a trivial hook, a single option, a reference or concept page. At most one `<ComponentPreview>`. A demo you drop stays registered: say so in the report so the integrator embeds it elsewhere or lists it as internal.
- `## Related` at the end: 1 to 5 links to existing `/docs/...` pages and anchors. Task and Reference pages link the concept page; a Feature page links its Reference (P10).
- Server mode: `{{SERVER_RULE}}`
- `<NewBadge />` only for a section that is new on a page that exists at the last release tag. Never in a heading.
- If you rename or remove a heading, run the full links check and fix the inbound links.

## Check yourself before you report
From the worktree run `node scripts/docs-verify.mjs --only code,prose,structure,demos,symbols,props,links --files {{FILES_CSV}} --warnings` and then `node scripts/docs-verify.mjs --only links`. Fix every failure and read every warning for your file. Re-read the page as a beginner: a wall of text? an undefined term? a sample that does not run when pasted?

## Report (return exactly this)
- files changed, word count
- validator summary lines
- claims kept after proof (count) and claims changed or cut because the code disagreed (old, new, `file:line`)
- dropped facts and why
- demo decision and reason; demos left unembedded
- open questions, product bugs found, link targets that do not exist yet, changes needed in files you may not edit

## Appendix B: verifier brief

Fill the slots, then hand it to an Opus verifier. The verifier never edits batch pages beyond mechanical fixes.

You verify the work of a docs writer. You did not write it. Default to rejecting when unsure. You may fix mechanical defects yourself (typos, a wrong anchor, a missing `fragment` reason); everything else goes back as a finding. Never edit pages other than the batch pages. No AI attribution anywhere. English only.

Slots the orchestrator fills: `{{FILES}}`, `{{FILES_CSV}}`, `{{ROWS}}` (work-list rows), `{{REPORT}}` (the writer report: treat every claim in it as unproven).

## Step 1: machine checks (do not trust the writer's paste)
Run `node scripts/docs-verify.mjs --files {{FILES_CSV}} --warnings` (add `--audit <path to docs-nav-audit.mjs>` for the budgets until it is in the repo) and the full `node scripts/docs-verify.mjs --only links,demos` (a changed heading breaks inbound links; a dropped demo leaves an orphan). A failure blocks. Read every warning that names your files. Run it twice if a failure names a page that is not yours: parallel runs of other verifiers can interfere.

## Step 2: claims against code
For each page take every behavioral claim (default, what a callback receives, when it fires, server-mode request and response, shortcut, limit, what a warning prints) and open the source or the test that proves it. Record `claim -> file:line -> ok | wrong | unprovable`. At least 10 per page (all under 10). Words "never", "always", "nothing" need proof for every case. Wrong or unprovable blocks.
Then diff against the original (`git show HEAD:<file>`): every dropped fact is wrong (cite code) or must stay. Every kept old claim gets the same proof as a new one.
Dry-read every code sample: does it compile (the validator turns free names into `any`, so it does not prove this), run when pasted with the stated install, and produce what the prose says?

## Step 3: reader checks (named, with pass rules)
- Template and budget: sections in order, first-screen rule, one concept. Pass: nothing missing, nothing extra.
- Demo rule: a demo only where a code sample cannot show the behavior. None on trivial hooks, single options, reference, concept, step. At most one unless variants. Pass: each kept demo has one stated reason; a dropped demo leaves no orphan and no claim that only it backed.
- Samples: imports present, hooks inside components, intro sentence ending with a colon, no `...`. Pass: paste-ready.
- Wall of text: no prose run over 250 words without a heading, list, table, code, or callout.
- Simple English: apply the `.agents/skills/simple-english/SKILL.md` self-check to the three longest sentences and every `if` or `when` sentence; one term per concept (GLOSSARY.md); terms defined at first use or linked.
- External reader: no history, no rejected alternatives, no editor behavior, no plan ids.
- Parity (rows with parity ids): each non-`n/a` cell of `research/parity-matrix.json` is true as written; a `gap` cell reads as a gap; the server-mode request and response are the real ones.
- Links: Related has 1 to 5 working links; P10 links exist; anchors you link exist.
- Search: aliases are words a reader types that the page does not use; the title leads with the key word.

## Step 4: return exactly this
```
verdict: accept | fix | reject
machine: <summary lines>
claims: <n checked, n wrong, n unprovable>   (list the wrong ones with file:line)
findings: [{file, line, rule, problem, suggestedText, mustFix: true|false}]
fixed_by_me: <list>
product_bugs: <behavior that looks wrong in the library, file:line>
process_notes: <what the brief or the validators got wrong or missed>
```
`mustFix` findings block. Nits never block twice. After the writer fixes, you run again; a round with no mustFix is the pass.
