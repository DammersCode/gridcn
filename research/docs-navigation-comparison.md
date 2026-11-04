# Docs navigation: top three candidates

One page for the decision. Method: [docs-navigation-scoring.md](docs-navigation-scoring.md). Rules:
[docs-navigation-ruleset.md](docs-navigation-ruleset.md). Audit of today's docs:
[docs-navigation-audit.md](docs-navigation-audit.md). Migration: [docs-navigation-migration-plan.md](docs-navigation-migration-plan.md).

## How to view the prototypes

Each prototype is the real docs sidebar and page layout with mock content. The mock pages show the planned word count as
scroll length. The route exists only in development (`app/dev/docs-nav`, hidden in production builds).

Start the dev server on a free port. A worktree needs a `node_modules` junction and one temporary line in
`next.config.mjs`. Never commit that line:

```powershell
cd C:\repos\danny\gridcn\.claude\worktrees\clever-colden-9f2e91
New-Item -ItemType Junction -Path node_modules -Target C:\repos\danny\gridcn\node_modules
```

Add this line inside the `config` object of `next.config.mjs`: `turbopack: { root: "C:/repos/danny/gridcn" },`. Then run:

```bash
npx next dev -p 3471
```

Open these pages:

- Comparison: `http://localhost:3471/dev/docs-nav`
- A, Tasks: `http://localhost:3471/dev/docs-nav/a/learn/learning-path/start-here`
- B, Topics: `http://localhost:3471/dev/docs-nav/b/learn/learning-path/start-here`
- C, Four areas: `http://localhost:3471/dev/docs-nav/c/learn/learning-path/start-here`

When you are done, stop the server and restore the files: `git checkout -- next.config.mjs AGENTS.md`.

## Scores

Opus reviewers, senior and beginner personas, 0 to 10 per dimension. The mid-level persona was dropped after the pilot.

| Navigation | Beginner | Senior | Mean |
|---|---|---|---|
| Today (100 pages) | 5.13 | 5.19 (two runs) | 5.16 |
| A: Tasks (C13) | 8.25 | 7.5 | 7.88 |
| B: Topics (C14) | not run on the final version | 7.75 | 7.75 |
| C: Four areas (C10) | not run | 7.63 | 7.63 |

By dimension (the last run of each persona):

| Dimension | Today | A: Tasks beginner | A: Tasks senior | B: Topics senior | C: Four areas senior |
|---|---|---|---|---|---|
| Findability | 6 | 8 | 7.5 | 8 | 8 |
| Scroll cost | 5.5 | 9 | 8.5 | 8 | 8 |
| Cognitive load | 5 | 7 | 6 | 8 | 7 |
| Learning path | 4.5 | 8 | 7 | 7 | 7 |
| Reference lookup | 5.5 | 9 | 8 | 8 | 8 |
| Consistency | 4 | 8 | 7 | 7 | 7 |
| First success | 7 | 9 | 8.5 | 9 | 9 |
| Growth resilience | 4 | 8 | 7.5 | 7 | 7 |

How reliable are these numbers? The same candidate line scored 8.0 and 7.5 with two senior runs on two versions. Treat a
difference below 0.5 as noise. A and B are not separable on senior scores. A has the better beginner scores.

The iteration history (senior scores unless stated): C1 7.13, C2 7.0, C3 6.75 (round 1); C4 7.25 senior and beginner, C5
7.38 (round 2); C6 7.75 senior and 7.5 beginner, C7 7.88 (round 3); C8 8.0, C9 8.13, C10 7.63 (round 4); C11 8.0 senior
and 8.13 beginner, C12 7.88 (round 5); C13 7.5 senior and 8.25 beginner, C14 7.75 (round 6). Scores rose from 6.75 to
about 8 and then stopped moving. Each new run found new points of the same kind, mostly renames and group moves.

## Why not 10 out of 10

The reviewers marked every remaining gap as closable by the navigation file or not.

Closable only once the pages exist (for every candidate):

- Real page lengths. Planned screens count prose words only. Code-heavy pages (server round trip, custom cell, pagination,
  toolbar, URL state, ORM example) will run 6 to 10 screens until their code is trimmed or split.
- Answers above the fold, a Next link on every page, prerequisites on each step, stable per-symbol anchors.
- Landing pages that route every task of their group in one click.
- Text that does not exist today: save conflicts, plugin contract, server rows contract, install problems, the benchmark
  pages (written by a separate session).
- Template checks by script. The audit script reads `type:` from frontmatter, which the pages do not have yet.

A conflict between rubric and ruleset: the rubric wants at most 9 peers in a view (Cognitive load 9), while the ruleset caps
a view at 25 rows and a group at 7 to 12 pages. A 200-page product with that many groups cannot reach 9 on Cognitive load
without breaking the ruleset. Cognitive load stays at 7 to 8 by design.

Left open on purpose:

- Evaluators have no ordered path. The Server area is a decision tree (Pages mode or Scroll mode), not a sequence.
- Page and group counts. Navigation moves cannot remove the length of a 200-page product.

## The three candidates

All three share the same decisions: six or four areas as sidebar tabs, a Learning path of 9 steps, one Server area for
all server topics, an Evaluate area (performance chapter, accessibility, support), a Reference area with contracts, events,
add-on options, and cheatsheets, and one Examples area (A and B) with a landing per group. Today's duplicates (recipes
repeating how-to pages, matrices repeated on several pages) are removed in all three.

### A. Tasks (recommended)

| | |
|---|---|
| Shape | Learn, How-to (10 task groups), Server, Evaluate, Reference, Examples. 203 pages, 35 groups |
| How a reader finds a page | By the task: "Sort rows", "Add a context menu", "Resolve save conflicts" |
| Pros | Every title says what the reader does. Task pages stay at or below 800 words. The best beginner scores (D2 9, D5 9, D7 9). The option tables live on their own Reference pages, so a lookup never scrolls through steps |
| Cons | The most pages and one more reference group (Add-on options, 13 pages). Concepts sit apart from their tasks. Cognitive load for the senior persona is 6 |
| Fits when | Most readers arrive with a job to do |

### B. Topics

| | |
|---|---|
| Shape | Learn, Build (9 topic groups with add-ons inside), Server, Evaluate, Reference, Examples. 186 pages, 32 groups |
| How a reader finds a page | By the feature: "Row operations", "Context menu", "Pinned rows" |
| Pros | Fewest rows per view (18). A feature page keeps its concept, props, and examples together. The best senior Cognitive load (8) |
| Cons | Feature pages are long (900 to 1,200 words) and mix concept and steps. Several groups sit at 8 pages. Server pages stay feature-shaped next to task-shaped client pages |
| Fits when | Readers browse by feature name |

### C. Four areas

| | |
|---|---|
| Shape | Topics, with Evaluate folded into Learn. Four tabs: Learn, Build, Server, Reference. 181 pages, 28 groups |
| Pros | One tab fewer. A reader who starts at the home page reaches performance and support in two clicks |
| Cons | Learn holds seven groups and hides support and version facts behind the label "Learn". The senior reviewer judged that one fewer tab costs more than it saves (wrong-tab guesses). Cognitive load 7 |
| Fits when | The Evaluate pages are few. They are not: the performance chapter alone has five pages |

## Scroll and sidebar metrics

Planned screens use 250 words per screen and ignore code. Today's numbers come from the audit script and include code.

| Measure | Today | A: Tasks | B: Topics | C: Four areas |
|---|---|---|---|---|
| Pages | 100 | 203 | 186 | 181 |
| Sidebar areas | 1 | 6 | 6 | 4 |
| Groups | 10 | 35 | 32 | 28 |
| Most rows visible at once | 54 | 21 | 18 | 24 |
| Longest page (words) | 4,186 | 1,400 | 1,400 | 1,400 |
| Average page (words) | 768 | 573 | 613 | 613 |
| Pages above 5 screens | 30 | 1 (planned, prose only) | 1 | 1 |

## Recommendation

Take A, Tasks. It scores best with the beginner, keeps every task page short, and keeps lookups on reference pages. Use two
parts of B where they help: keep the concept pages next to their feature in the Reference concepts group, and keep the
short Learning path as the home page's first group. Drop C: the senior review found that a separate Evaluate tab pays off.

The decision that most changes the result is the page type for add-on pages. If the team does not want to write separate
options pages for each add-on, take B.

## Open questions

- Does the team accept 200 pages? The count roughly doubles. Each new page needs a Related section and a description.
- Who writes the new text? Save conflicts, plugin contract, server rows contract, install problems, and 13 options pages.
- Is a Learn area with three groups acceptable? The ruleset allows it only for Learn.
- `AGENTS.md` describes the add-on page structure as one page with props tables. A task-first tree changes that rule.
- The benchmark pages are written by another session. Their folder is `content/docs/performance/` with `index.mdx`,
  `benchmark-results.mdx`, and `run-it-yourself.mdx`. Candidates A, B, and C already use these names.
