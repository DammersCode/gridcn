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

Counts come from `research/docs-rewrite-worklist.json` (225 pages for C19, 34 writer batches; regenerate it whenever the candidate changes with
`node scripts/docs-rewrite-worklist.mjs --candidate <file> --content-map <file> --url-map <file>`). One row per target page:
source pages, action, type, word budget, demo need, code need, wave, batch, parity ids. The table
`research/docs-rewrite-worklist.md` is the human view.

| Action | Pages | What the writer does |
|---|---|---|
| move | 71 | Keeps the facts. Sets `type`, `title`, `description`, `aliases`, Related, and fixes whatever the validators flag. A heading keeps its id (`[#old-id]`) unless the writer reports the drop. |
| split | 66 (+9 mixed) | Creates its page from the H2 sections the content map names, copied from the freeze commit (`git show <freeze>:<old page>`). Adds an intro paragraph and Related. |
| merge | 4 (+8 mixed) | Combines two sources under one concept, then removes duplicates (rule P6: one fact, one page). |
| rewrite | 3 | New structure from the old facts: Start here, Install, Pagination. |
| new | 70 | 44 landings (one line per child, generated list) and 26 content pages: Server path steps, contracts, Messages intro, Learning path steps, benchmark pages, and similar. |
| unmapped | 1 | `hooks-az` has no content-map row. The navigation session owns the decision. |

8 pages are generated (task finder, Terms alias table, feature matrix, Messages, cheatsheets): they belong to generator tasks
(batch `G`), not to writers. 3 pages (`performance`, `benchmark-results`, `run-benchmark`) belong to the perf-docs session
(batch `P`): the fleet leaves them out, and the merge takes them from that branch.
New-page families the owner named: the performance chapter (`performance/`, written by the perf-docs session), the three
hook pages, the Server path, the Messages reference, Terms and help, saved views (`remember-view`), and the add-on options
pages (generated from the types with `<AutoTypeTable>`).

### File ownership

- A writer creates or edits only the files of its rows. It reads old pages from the freeze commit, never from the live tree,
  so two split writers can read the same source without touching it. The old file stays until the integrator deletes it after
  the last split from it is accepted.
- The integrator, not a writer, owns inbound link fixes in other pages, dropped-anchor entries in the anchor map, `meta.json`,
  `components/registry-examples.tsx`, `lib/llms-tasks.ts`, `next.config.mjs`, `skills/**`, `public/skills/**`, `README.md`,
  `CHANGELOG.md`, and `content/docs-changes.json`. A writer lists the change it needs in its report.
- Writers share one worktree (the branch of this plan): batches write disjoint files, validators use their own temp
  directories, and the integrator commits per batch with explicit paths. A failure that names another batch's page is not
  the writer's.

### Order

| Wave | Content | Who |
|---|---|---|
| 0 Freeze | Merge the docs-touching branches (section 5). Regenerate the work list, URL map, and anchor map. Skeleton PR: `git mv`, `meta.json`, redirects, codemod, `type` and the other keys in the schema. | Integrator (navigation session), not the fleet |
| 1 Cut | The 148 `move`, `split`, and `merge` pages in 22 batches (Edit cells, Events, Contracts, Upgrade, Row limits, and the other topic groups). Creates the headings that later pages link. | Sonnet writers, Opus verifiers |
| 2 Write | 21 pages in 5 batches: 18 `new` pages (Server path, contracts `ref-server-rows` and `ref-plugin`, store hooks, Learning path steps), 2 `split+new`, 3 `rewrite` (Start here, Install, Pagination). The three contract pages of wave 1 (`ref-celltype`, `ref-style-surface`, `ref-engine`) and these two get a second Opus verifier round. | Sonnet writers, Opus verifiers |
| 3 Generate and link | 7 landing batches (42 landings; they list their children, so they come last) and the generator tasks (batch `G`: finder, Terms alias table, feature matrix, cheatsheets, Messages, options pages, landing lists). Then skills, README, `llms.txt`, changelog line, redirects. | Sonnet writers and coders, Opus reviewer |
| 4 Whole site | `docs:verify --final`, A10 gate, search test, persona runs (beginner and senior), fix rounds. | Opus reviewers, Haiku for mechanical re-checks |

A batch never mixes waves. Wave 2 may start in an area once that area's wave-1 batches are accepted.

## 2. Definition of done

A page is done when every row passes. The site is done when every row passes site-wide and the persona run passes.
The machine rows run as one command, `pnpm docs:verify --final` (strict props tables, a `type` and a Related section on every
page, demo warnings as failures, the work list, and the page budgets), plus the commands named in a row. Every machine row
has zero failures. For one page: `pnpm docs:verify --final --files content/docs/<page>.mdx --warnings` and the full
`pnpm docs:verify --only links,demos`.

| # | Check | How | Pass rule |
|---|---|---|---|
| D1 | No dead link or anchor | `--only links` scans `content/docs`, `skills/**`, `public/skills/**` (with the site's absolute URLs), `README.md`, `GLOSSARY.md`, `DEVELOPMENT.md`, `CHANGELOG.md`, `AGENTS.md`, `app`, `components`, `lib`, `registry/default/**` comments, `registry.json`, `research/parity-matrix.json`, `scripts/verify-parity.mjs`, `lib/llms-tasks.ts` | 0 dead; 0 links that only work through a redirect (the changelog is exempt); every redirect destination resolves |
| D2 | Old URLs and anchors survive | `--only links --baseline <last tag> --migration research/docs-navigation` | Every URL of the baseline pages is a page or a redirect; every baseline anchor exists on its page or is mapped in `anchor-map.json`; every mapped target resolves. The build test of rule A12 (every page once in `llms.txt`, every link 200) is a navigation deliverable; `verify-llms-markdown` in `pnpm lint` only checks the converted Markdown |
| D3 | Code samples compile | `--only code` extracts every `ts`, `tsx`, `js`, `jsx` block and type-checks it against the registry source | 0 failures. The first sample of every page uses no undefined name and the verifier dry-reads it (imports, hooks inside a component). A block that cannot compile carries `fragment="reason"`; fragments are at most 20% of a page's blocks and their imports resolve |
| D4 | Props tables match source | `--final` (strict props) | Every props table has a `{/* props: Type */}` marker; 0 unknown names, 0 default or required mismatches; options pages use `<AutoTypeTable>` or the verifier confirms the "members not in the table" list is empty |
| D5 | Named symbols exist | `--only symbols` | 0 unknown symbols; every `<AutoTypeTable>` resolves; exceptions live in `scripts/docs-symbols-allow.txt` with a reason |
| D6 | Demos resolve | `--only demos` | Every `<ComponentPreview>` is registered and has a file; every `<InstallCommand item>` is in `registry.json`; every registered example is embedded or listed in `scripts/docs-demos-internal.txt` |
| D7 | Demo rule | `--final` (demo warnings are failures) plus verifier | A demo only where a code sample cannot show the behavior (visual, interactive, timing). 0 on reference, concept, step, cheatsheet, and landing pages and on hook pages. At most 1 per page, except example pages or `demos: compare`. The verifier states one reason per kept demo |
| D8 | Budgets and structure | `node scripts/docs-nav-audit.mjs --check` (run by `--final`; also `--candidate` and `--queries` on the final navigation) | 0 failures; every page has a `type` |
| D9 | No wall of text | `prose` rule `long-paragraph` (110 words, 7 sentences, table cells included) and the verifier | 0 hits; no run of prose over 250 words without a heading, list, table, code, or callout |
| D10 | Simple English | `--only prose`, then the `simple-english` self-check by the verifier | Hard rules 0: sentence over 25 words, code line over 80 characters, banned modals, contractions, `;`, filler. Passive at most 3 per page. Late condition and `-ing` clause are soft; the verifier applies the self-check to the three longest sentences and every `if` or `when` sentence |
| D11 | Terms | `pnpm lint` (`verify-vocabulary`), verifier | Words match `GLOSSARY.md`; every uncommon term is defined at first use or links Terms; Terms lists only uncommon terms |
| D12 | AGENTS.md docs rules | `prose` (`timeless`, `toolchain`, `omission-dots`, `intro-colon`, `one-item-list` for numbered and bullet lists, `lint-ok-reason`), `structure` | 0 hits; no `status:` line; `<NewBadge />` never in a heading; `content/docs-changes.json` equals the base branch (an unreadable base ref fails in `--final`); the verifier reviews phantom contrasts and every `lint-ok` |
| D13 | Client and server parity | `--final` with `research/docs-rewrite-worklist.json` plus verifier | Every Build Feature page with `parity` ids has an H2 "Server mode". The worklist names the owner page of the other matrix features (`parityOwnerOf`); the verifier proves each non-`n/a` cell on the owner page; `gap` cells read as gaps. Features without a page (`grouping`, `counts`, `row-ids`) are an open question |
| D14 | Frontmatter | `structure` | `title` at most 60 characters and unique; `description` at most 160; Related is the last section with 1 to 5 docs links (landings exempt); aliases have one owner each |
| D15 | Search | `docs-nav-audit.mjs --queries research/docs-navigation/reader-queries.txt <candidate>`, and a test of the built index | Every query returns its page in the first 3 results. Navigation deliverable: `app/api/search/route.ts` indexes `aliases` (it does not today) and the index test exists (it does not today) |
| D16 | Docs shell accessibility (A10) | A browser gate script at 1280 and 375 px | All A10 checks pass. Navigation deliverable: the script is not committed yet (`gate-results.md` records a manual run) |
| D17 | Skills in sync | `pnpm lint` (`verify-skills`, `sync-skills --check`), `--only links`, verifier | Both skill copies link only existing pages and anchors; every "where to look" claim is true |
| D18 | Repo gates | The gate list of `AGENTS.md` | Green. A registry change (new example) rebuilds `public/r` |
| D19 | Changelog | The integrator, checked by the verifier of the last batch | One `CHANGELOG.md` line under Unreleased for the move and each new page family; docs prose edits need none (`AGENTS.md`) |
| D20 | Whole-site persona run | One beginner and two senior reviewers; task battery B1 to B7, E1 to E9, X1 to X5 and the eight scoring dimensions of `docs-navigation-scoring.md` | No task is a miss; every task is answered in at most 3 clicks and 8 screens; every scoring dimension has a mean of at least 8.5 and none is below 7 |

## 3. Validators

All live in `scripts/`, share `docs-verify-lib.mjs`, and print at most 5 failures per check. `pnpm docs:verify` runs them;
`--only a,b` picks checks; `--files p1,p2` limits the report and the compile step to those pages (used per batch; orphan demos and inbound links to a listed page stay visible). `--warnings` prints the warnings. Each compile run uses its own temp directory, so parallel runs do not interfere.

| Script | Check | Notes |
|---|---|---|
| `verify-docs-links.mjs` | D1, D2 | Heading slugs follow the site slugger (a `[#id]` heading has only that id). Reads redirect sources and destinations from `next.config.mjs`. `--baseline <ref>` compares every URL and anchor of the pages at that ref. `--migration <dir>` checks the URL map and the anchor map. |
| `verify-docs-code.mjs` | D3 | Extracts blocks, runs the repo TypeScript. Free names become `any`, so a fragment still checks the API it uses; a gridcn name that the registry does not export fails. A syntax error removes the block from the program first, because `tsc` skips semantic checks while any syntax error exists. |
| `verify-docs-props.mjs` | D4 | Parses `interface` and `type` members with a small tokenizer (the repo's TypeScript 7 has no JS API). Pins by marker, guesses by name overlap otherwise. Defaults compare to `name = literal` and `name ?? literal` in the same block. |
| `verify-docs-symbols.mjs` | D5 | Every inline-code name that looks like a gridcn symbol must appear in the registry source. |
| `verify-docs-demos.mjs` | D6, D7 | Cross-checks `components/registry-examples.tsx`, `registry.json`, and the embeds. |
| `verify-docs-prose.mjs` | D9, D10, D12 | Mechanical subset of the `simple-english` rules and of the AGENTS.md docs rules. `{/* lint-ok: reason */}` above a paragraph skips it (for quoted API text). |
| `verify-docs-structure.mjs` | D13, D14 | Frontmatter, Related, aliases, duplicate titles, the Server mode H2 per work list, `docs-changes.json`. |
| `docs-rewrite-worklist.mjs` | Work list | Candidate plus content map to JSON and a table. Not part of `docs:verify`. |
| `docs-nav-audit.mjs` | D8, D15 | Belongs to the navigation branch. `docs:verify` runs it when the file exists. |

Tests: `tests/docs-verify.test.ts` and `tests/docs-verify-more.test.ts` (fixture sites; a positive and a negative case for the link, code, props, demo, structure, and prose checks; the work list has a wave and URL case).

### Wiring into `pnpm lint`

Not wired yet. The full run takes about 15 s (the compile step is most of it), and today it fails on the current docs by
design. Rule: when `links`, `demos`, `symbols`, and `structure` reach zero (they take about 3 s together), add
`docs-verify.mjs --only links,demos,symbols,structure` to `pnpm lint`. The compile and prose checks stay in `docs:verify`
and in CI as a separate step until the rewrite lands, then join the lint.

## 4. Baseline (current docs, 100 pages, release/2.0 at 257c1976)

| Check | Result |
|---|---|
| links | 8 dead of 887: 5 in `recipes/data-fetching/server-side` and `examples/validation/async-gates` (they point at `/docs/pagination` and server-side headings that no longer exist), `api-reference` and `app/(home)/page.tsx` (`#define-columns`), and `lib/llms-tasks.ts` (`#sorting-a-lazy-grid`; the `llms.txt` route throws on it). 68 absolute site URLs in `skills/**` and `public/skills/**` (plain text and inline code) are checked now (0 dead) |
| code | 245 `js`/`ts`/`tsx` blocks: 74 fail to compile (a syntax error, an undefined name in the first sample, or a real API mismatch such as a `DataChange` that is not generic), 7 need a package the repo lacks (drizzle, prisma, supabase, i18next, a Vite plugin), 164 pass; 0 fragments marked. An earlier run reported 34 because it silently dropped syntax errors |
| props | 16 tables, 67 rows: 0 pinned, 13 guessed, 3 unmatched. In strict mode all 16 fail (unpinned or unmatched). Of 8 guessed-type mismatches, the reviewer found 5 are guesser errors (`blockSize`, `overscan`, three required-looking members); pinning the marker settles them. The API pages already use `<AutoTypeTable>`, which cannot drift |
| symbols | 704 names, 0 unknown (one allow-list entry) |
| demos | 94 embeds, 62 registered, 0 orphans, 0 failures; 16 pages embed several demos |
| prose | 731 hard failures in 100 pages: code lines over 80 characters 212, long sentences 292, `;` 74, long paragraphs 36, one-item lists 20, intro colon 22, banned modals 16, omission dots 11, contractions 10, timeless 10, filler 5; soft: passive 276, late condition 278, `-ing` clause 109, phantom contrast 55 |
| structure | 6 failures: 5 duplicate titles (TanStack Query, SWR, Pinning, Row operations, Custom cell type), 1 Related over 5 links. With `--final`: 148 (100 pages without `type`, 42 without Related). |
| audit (`--check`) | 31 failing pages (20 over the word cap, 14 over the screen cap, 5 over the H2 count, 10 duplicate titles, 1 under 80 words) |

## 5. Merge order and conflict handling

Find the branches that change `content/docs` with this command; the list below is a snapshot, and stale branches show
large counts because their base is old:

```bash
for b in $(git for-each-ref --format='%(refname:short)' refs/heads); do n=$(git diff --name-only origin/release/2.0...$b -- content/docs | wc -l); [ "$n" -gt 0 ] && echo "$n $b"; done | sort -rn
```

Live branches in the last run: `feat/pin-start-end` 31, `feat/sr-announcements` 29, `feat-lazy-paging-gaps` 17,
`w2-write-path` 13, `w4-specs-views` 7, `w3-aggr-lookup` 5, `w2-filters` 5, `w2-io` 3, and single-file branches
(keyboard-pointer findings, `perf-sort-1m`, `angry-robinson`). Landing and performance docs sit in sibling branches too.

1. **Before the freeze.** Merge these into `release/2.0` first, in the order of the most prose changed. The rewrite then
   starts from a docs tree nobody is still editing. The navigation session announces the freeze commit.
2. **After the freeze, nobody edits old paths.** A branch with pending docs edits re-applies them to the new page. The tool
   is a writer batch with the brief "port this diff onto page X" (the diff comes from `git diff <base>..<branch> -- content/docs`);
   renames of moved-only pages follow git's rename detection, splits do not.
3. **Fleet branches.** Each batch works on `docs/rewrite-Bnn` cut from the skeleton commit and changes only its pages. The
   verifier accepts or rejects the branch. Accepted branches merge with `--no-ff` in wave order; because files are disjoint
   the order is free inside a wave.
4. **Shared files and inbound link fixes belong to the integrator** (the list is in section 1, File ownership). A writer
   lists the change it needs in its report.
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
Up to 6 writers run at once (the compile step is CPU heavy). Expected size: 34 batches (22 in wave 1, 5 in wave 2, 7 landing batches), 8
generator tasks, 1 link-sync task, plus fix rounds: about 50 writer runs and 90 verifier runs.

The persona run uses the task battery in `docs-navigation-scoring.md` (B1 to B7, E1 to E9, X1 to X5) on the finished
site, one beginner and two senior runs, scored on the eight scoring dimensions of that file.

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

**Anchors.** The pilot rewrote the H2 text of Fill handle and Open a detail panel, so 12 old anchors are gone (7 and 5).
`--baseline` finds them. They stay unmapped on purpose: the integrator maps them in `anchor-map.json` (D2 fails until then).
The writer brief now says to keep old ids with `[#old-id]` and to report each dropped anchor.

**Changes the pilot forced** (all committed, see the log): syntax errors in samples are reported (the baseline rose from 34 to
81 failing blocks); compile runs use their own directory; hook and lib imports and `Pick<>` option types resolve;
`--files` keeps orphan demos and inbound links visible; `--warnings` prints warnings; the first sample of a page may not use
an undefined name; code lines over 80 characters fail. The briefs gained the truth rules (prove every kept claim, diff the
dropped facts, dry-read samples), the anchor rule, the demo-precedence rule, and the report fields.

**Cost.** One page cost about 3 writer runs and 3 verifier runs. The verifier does the real work: most of the 18 must-fix findings of
round 1 across the three pages were claims against code or samples that the scripts accepted. Plan for 2.5 verifier rounds per
page on average, so about 80 Opus runs for 34 batches of up to 10 pages (a batch is verified as one unit, with one report).
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
11. **Content-map gaps.** 70 target pages have no source text (new). 89 old anchors have no target yet
    (`anchors-needing-review.txt`). Who assigns them: the split writers or the navigation session?
13. **Search and the A10 gate.** D15 and D16 depend on two navigation deliverables that do not exist yet: `aliases` in the search
    index (`app/api/search/route.ts` ignores them) and a committed A10 browser script. Who owns them?
14. **Matrix features without a page.** `grouping`, `counts`, and `row-ids` have no page in C19, so D13 cannot check them.
    Add a page or drop the rows?
15. **`hooks-az`** is in the candidate but has no content-map row (the only unmapped page).
16. **Examples area.** 32 example pages of 100 to 500 words each go through the same checks. Skip the Related rule for them?

## Appendix A: writer brief

Fill the slots (`ROW`, `TARGET_FILES`, `TEMPLATE`, `SERVER_RULE`, `FILES_CSV`, `BASELINE_REF` = the last release tag), then hand it to a Sonnet writer. The orchestrator also gives the worktree path.

Rewrite the pages of ONE batch (one to ten pages, same steps for each) of the gridcn docs (React data grid, shadcn registry, Fumadocs MDX in `content/docs`). Work in the worktree named at the top of your brief; other batches write other files at the same time. No AI attribution anywhere. No competitor or other-product names. English only. Do not commit, do not run pnpm install or a dev server.

Slots the orchestrator fills: `{{ROW}}` (the work-list row: slug, title, type, words, aliases, action, parity ids, sources, carried demos), `{{TARGET_FILES}}`, `{{TEMPLATE}}`, `{{SERVER_RULE}}`, `{{FILES_CSV}}`.

## Files
You may edit only `{{TARGET_FILES}}`. Inbound links in other pages that your heading changes break are the integrator's job: list them in your report. Do not move or rename files. Do not edit `meta.json`, `registry/**`, `components/registry-examples.tsx`, `lib/llms-tasks.ts`, `skills/**`, `README.md`, `CHANGELOG.md`, `content/docs-changes.json`, `next.config.mjs`. Put the change you need in those files into your report.

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
- Keep the id of every old heading you rewrite with `[#old-id]` when its section still exists. If a section goes away or merges, list each dropped anchor with the page that now holds the content (the integrator maps it). `--baseline` finds them.

## Check yourself before you report
From the worktree run `node scripts/docs-verify.mjs --final --files {{FILES_CSV}} --warnings --audit scripts/docs-nav-audit.mjs` and then `node scripts/docs-verify.mjs --only links,demos --baseline {{BASELINE_REF}} --migration research/docs-navigation`. A failure that names another batch's page is not yours; say so in the report. Fix every failure and read every warning for your file. Re-read the page as a beginner: a wall of text? an undefined term? a sample that does not run when pasted?

## Report (return exactly this)
- files changed, word count
- validator summary lines
- claims kept after proof (count) and claims changed or cut because the code disagreed (old, new, `file:line`)
- dropped facts and why
- demo decision and reason; demos left unembedded
- open questions, product bugs found, link targets that do not exist yet, changes needed in files you may not edit

## Appendix B: verifier brief

Fill the slots (`FILES`, `FILES_CSV`, `ROWS`, `REPORT`, `BASELINE_REF`), then hand it to an Opus verifier. The verifier never edits batch pages beyond mechanical fixes.

You verify the work of a docs writer. You did not write it. Default to rejecting when unsure. You may fix mechanical defects yourself (typos, a wrong anchor, a missing `fragment` reason); everything else goes back as a finding. Never edit pages other than the batch pages. No AI attribution anywhere. English only.

Slots the orchestrator fills: `{{FILES}}`, `{{FILES_CSV}}`, `{{ROWS}}` (work-list rows), `{{REPORT}}` (the writer report: treat every claim in it as unproven).

## Step 1: machine checks (do not trust the writer's paste)
Run `node scripts/docs-verify.mjs --final --files {{FILES_CSV}} --warnings --audit scripts/docs-nav-audit.mjs` and the full `node scripts/docs-verify.mjs --only links,demos --baseline {{BASELINE_REF}} --migration research/docs-navigation` (a changed heading breaks inbound links and old anchors; a dropped demo leaves an orphan). A failure blocks. Read every warning that names your files. A failure that names a page outside your batch is not yours; say so in the report.

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
