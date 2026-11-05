# Docs navigation: top three candidates

One page for the decision. Method: [docs-navigation-scoring.md](docs-navigation-scoring.md). Rules:
[docs-navigation-ruleset.md](docs-navigation-ruleset.md). Audit of today's docs:
[docs-navigation-audit.md](docs-navigation-audit.md). Migration: [docs-navigation-migration-plan.md](docs-navigation-migration-plan.md).
Run files: `research/docs-navigation/scores.json`.

## How to view the prototypes

Each prototype is the real docs sidebar and page layout with mock content. The mock pages show the planned word count as
scroll length, a "Step n of N" chip and the step list on path pages, and a "Where next" block on the last step. The route
exists only in development (`app/dev/docs-nav`, hidden in production builds).

Start the dev server on a free port. A worktree needs a `node_modules` junction and one temporary line in
`next.config.mjs`. Never commit that line. Run the commands from the worktree root (`<worktree>`):

```powershell
New-Item -ItemType Junction -Path node_modules -Target <main checkout>\node_modules
```

Add this line inside the `config` object of `next.config.mjs`: `turbopack: { root: "<main checkout>" },`. Use forward slashes in the path. Then run:

```bash
npx next dev -p 3471
```

Open these pages:

- Comparison: `http://localhost:3471/dev/docs-nav`
- A, Topics: `http://localhost:3471/dev/docs-nav/a/learn/learning-path/start-here`
- B, Tasks: `http://localhost:3471/dev/docs-nav/b/learn/learning-path/start-here`
- C, Four areas: `http://localhost:3471/dev/docs-nav/c/learn/learning-path/start-here`

When you are done, stop the server and remove the `turbopack` line by hand. `next dev` also rewrites `AGENTS.md`. Run
`git diff AGENTS.md` and restore it with `git checkout -- AGENTS.md` only when the diff holds nothing but that rewrite.

## Scores

Reviewers (the strongest available model at high effort), 0 to 10 per dimension. The mid-level persona was dropped after
the pilot. Rows A and B are the final versions of their lines, scored by one beginner run and two senior runs.

| Navigation | Beginner | Senior (mean of runs) | Mean |
|---|---|---|---|
| Today (100 pages) | 5.13 | 5.19 (two runs) | 5.16 |
| A: Topics (C19, last polish not re-scored) | 8.81 | 8.63 (8.75 and 8.5) | 8.72 |
| B: Tasks (C17) | 8.44 | 8.47 (8.44 and 8.5) | 8.46 |
| C: Four areas (C10, one earlier version) | not run | 7.63 | 7.63 |

By dimension:

| Dimension | Today (mean of both) | A: Topics beginner | A: Topics senior | B: Tasks beginner | B: Tasks senior |
|---|---|---|---|---|---|
| Findability | 6 | 8.5 | 8.5 | 8.5 | 8.5 |
| Scroll cost | 5.75 | 8.5 | 8.5 | 8.5 | 8.5 |
| Cognitive load | 4.5 | 9 | 8.75 | 8.5 | 8.5 |
| Learning path | 4.75 | 9.5 | 8.5 | 8.5 | 8.5 |
| Reference lookup | 5.25 | 8.5 | 8.5 | 8.5 | 8.5 |
| Consistency | 4.5 | 8.5 | 8.25 | 8 | 8 |
| First success | 6.5 | 9 | 9 | 9 | 9 |
| Growth resilience | 4 | 9 | 9 | 8 | 8.25 |

No candidate reaches the owner's mean of 9.0. A reaches 8.72, which is 0.28 short. The reviewers' noise is 0.5 on the mean:
two senior runs on the same version of A differed by 0.25, and the senior scores of near-identical versions of a line
differed by 0.5. The gap between A and B (0.26) and the gap between A and 9.0 are inside that noise.

Score history (mean of the runs on each version): C1 7.13, C2 7.0, C3 6.75 (round 1); C4 7.25, C5 7.38 (round 2);
C6 7.63, C7 7.88 (round 3); C8 8.0, C9 8.13, C10 7.63 (round 4); C11 8.07, C12 7.88 (round 5); C13 7.88, C14 7.75 (round 6);
C15 8.33, C16 8.17 (round 7); C17 8.46, C18 8.57 (round 8); C19 8.72 (round 9). The scores rose with every round and
flattened near 8.5 to 8.7. Each new run found new points of the same kind: renames and group moves.

## Why not 9.0

Every reviewer marked each remaining gap as closable by the navigation file or not.

Closable only once the pages exist (for every candidate):

- Real page lengths. Planned screens count prose words only. Code-heavy pages (pagination, URL state, server round trip,
  custom cell, ORM examples) will run 6 to 9 screens until their code is trimmed or split. D2 and D7 stay provisional.
- Step text with prerequisites, answers above the fold, stable per-symbol anchors, landings that route each task of their
  group in one click.
- Text that does not exist today: the plugin contract, the five Server path steps, install problems, and the benchmark
  pages (written by a separate session).
- Template checks by script. The audit script reads `type:` from frontmatter, which the pages do not have yet.

Closable by the navigation file, left for the polish pass (the reviewers' latest list):

- Name one term per concept for keys. "Keys", "shortcuts", "keybindings", and "keyboard" all appear, and the glossary has
  none of them. This needs a glossary entry, which belongs to the repo owner.
- Order two groups by rule S11 (toolbar after its own sections, row operations in code after pinned rows).
- Rename three groups that cost a wrong guess (Import, export, and views; Events and state; Help).
- Make the add-on options a one-page-per-add-on A to Z list. Today six family pages pair add-ons.

A conflict between rubric and ruleset: a 10 on Cognitive load needs at most 15 visible rows and 7 pages per group, while the
ruleset allows 25 rows and 12 pages. The candidates stay at 16 rows and mostly at 7 pages, so they score 9 there, not 10.

Left open on purpose:

- Evaluators have no ordered path. The Evaluate area is a set of reference groups, not a sequence.
- A page reached from a path step has related links only. A back link to the step needs a ruleset change (A7).

## The three candidates

All three share the same decisions: six or four areas as sidebar tabs, a Learning path of 8 steps and a Server path of 5
steps, three persona entries on the docs home, one Server area, an Evaluate area (performance chapter, accessibility,
support and upgrades), a Reference area (plugins, contracts, concepts, events, types and hooks, add-on options,
cheatsheets), and one Examples area with a landing per group. Today's duplicates (recipes repeating how-to pages, matrices
repeated on several pages) are removed in all three. The hooks group has three pages.

### A. Topics (recommended)

| | |
|---|---|
| Shape | Learn, Build (9 topic groups), Server, Evaluate, Reference, Examples. 203 pages, 36 groups, at most 16 rows visible |
| How a reader finds a page | By the feature: "Row operations", "Context menu", "Pinned rows" |
| Pros | Best scores in the last rounds (beginner 8.81, senior 8.63). A feature page keeps concept, options in short, and examples together. The Learning path reached 9.5 with the beginner |
| Cons | Feature pages run 900 to 1,200 words and mix concept and steps. Several groups sit at 7 pages. Server pages stay feature-shaped |
| Fits when | Readers browse by feature name |

### B. Tasks

| | |
|---|---|
| Shape | Learn, How-to (9 task groups), Server, Evaluate, Reference, Examples. 201 pages, 36 groups, at most 17 rows visible |
| How a reader finds a page | By the task: "Sort rows", "Add a context menu", "Handle refused saves" |
| Pros | Every title says what the reader does. Task pages stay at or below 800 words. Lookups live on reference pages |
| Cons | The consistency and growth scores are lowest (8 each). Concepts sit apart from tasks. Option tables move to six reference pages |
| Fits when | Most readers arrive with a job to do |

### C. Four areas

| | |
|---|---|
| Shape | Topics, with Evaluate folded into Learn. Four tabs: Learn, Build, Server, Reference. 183 pages, 28 groups |
| Pros | One tab fewer. A reader who starts at the home page reaches performance and support in two clicks |
| Cons | Learn holds seven groups and hides support and version facts behind the label "Learn". The senior reviewer judged that one fewer tab costs more than it saves (wrong-tab guesses). Cognitive load 7 |
| Fits when | The Evaluate pages are few. They are not: the performance chapter alone has six pages |

## Scroll and sidebar metrics

Planned screens use 250 words per screen and ignore code. Today's numbers come from the audit script and include code.

| Measure | Today | A: Topics | B: Tasks | C: Four areas |
|---|---|---|---|---|
| Pages | 100 | 203 | 201 | 183 |
| Sidebar areas | 1 | 6 | 6 | 4 |
| Groups | 10 | 36 | 36 | 28 |
| Most rows visible at once | 54 | 16 | 17 | 21 |
| Longest page (words) | 4,162 | 1,400 | 1,400 | 1,400 |
| Average page without landings (words; today: all pages) | 746 | 608 | 591 | 610 |
| Pages above 5 screens | 30 | 1 (planned, prose only) | 1 | 1 |

## Recommendation

Take A, Topics. It has the best scores on both personas in the last two rounds, and its three weakest dimensions in B
(consistency, growth, learning path) are its strengths. A and B tie on the senior persona within the noise. Drop C: the
senior review found that a separate Evaluate tab pays off.

The decision that most changes the result is the page type for add-on pages. A keeps the option tables on the feature page
and adds six reference pages for the rest. B moves all options out. Choose by the cost of writing the reference pages.

## Open questions

- Does the team accept 203 pages? The count doubles (100 today). Each new page needs a Related section and a description.
- Who writes the new text? The plugin contract, five Server path steps, install problems, and the six option pages.
- Is a Learn area with four groups acceptable? The ruleset allows 3 to 7 for Learn only.
- Which word does the glossary pick for keys? The candidates use "keys", "shortcuts", and "keybindings".
- `AGENTS.md` describes the add-on page structure as one page with props tables. Option pages in Reference change that rule.
- The benchmark pages are written by another session. Their folder is `content/docs/performance/` with `index.mdx`,
  `benchmark-results.mdx`, and `run-it-yourself.mdx`. Candidates A, B, and C already use these names.
