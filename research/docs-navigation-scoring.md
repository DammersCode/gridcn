# Docs navigation scoring

A repeatable way to score a docs navigation (sitemap, page outlines, sample pages) before anyone writes content. Scores
guide the choice between candidate structures. The rules the structure must obey live in
[docs-navigation-ruleset.md](docs-navigation-ruleset.md).

## What is scored

The unit is a navigation: the sidebar tree, the landing pages, the page outlines (title, word count, H2 list), and a few
full sample pages. Reviewers do not score prose quality or the visual style.

## Personas

| Persona | Knows | Wants | Reads |
|---|---|---|---|
| Beginner | React basics, no data grid experience | A working grid in minutes; names for the parts | Top to bottom, one page at a time |
| Senior | Has built grids, owns the decision to adopt | Exact contracts, limits, server behavior, upgrade risk | Search first, then reference tables |

The mid-level persona (has used one grid before, learns by doing) is retired. The [pilot](#persona-pilot) showed a difference above the noise on one dimension only, and the keep rule needs two.

## Dimensions

Every dimension scores 0 to 10 per persona. Each column is an anchor score. A score between two anchors interpolates.

| # | Dimension | 0 | 3 | 5 | 7 | 9 | 10 |
|---|---|---|---|---|---|---|---|
| D1 | Findability: clicks and guesses from a task to the page that answers it | Page not reachable from the sidebar | Needs 3+ wrong guesses; group names hide the topic | 1 to 2 wrong guesses; some names ambiguous | Right page in the first or second click for most tasks | Right page first click, every group name predicts its content | Every task reaches its page directly (the first click leads toward the answer) and the reader query list passes |
| D2 | Scroll cost: screens a reader scrolls to get the answer | Typical task page above 20 screens | 12 to 20 screens | 8 to 12 screens | Typical task page 5 to 8 screens | Typical task page at or below 5 screens; the answer sits in the first two screens | Every task page at or below 5 screens, answer above the fold or one anchor away |
| D3 | Cognitive load: concepts, choices, and sidebar rows held at once | Sidebar shows 40+ rows in one list | More than 30 rows visible; pages mix 3+ concepts | 26 to 30 rows visible; some mixed pages | At most 30 rows visible and at most 12 pages in the open group; one concept per page, few exceptions | At most 25 rows visible and at most 9 pages in the open group; no page mixes concepts | At most 20 rows visible and at most 7 pages per group; progressive disclosure hides what the task does not need |
| D4 | Learning path: a defined order from zero to productive | No order; reader must guess | Order exists in one place only by accident | A "start here" list exists but skips steps | A stepper or path covers the core; branches are unmarked | Paths for the core and for each main goal; every path step names its next step and every other page links related pages | Paths per goal with prerequisites and a next step on every step; related links on every other page; the sidebar order matches the path |
| D5 | Reference lookup speed: time to a prop, event, option, or limit | Reference is one page above 20 screens | Reference is one page above 12 screens, no per-concern anchors | Reference split by area, but names are not predictable | Tables per concern, stable anchors, lookup in 2 clicks | Reference page per concern, a lookup index, lookup in 1 to 2 clicks | One predictable URL per symbol or concern; an index page; all lookups in at most 2 clicks |
| D6 | Consistency: same names, order, and page shape for the same kind of thing | Every page has its own shape | Add-ons share a shape; the rest vary | Page types exist but are not followed | Page types followed by most pages; naming mostly stable | Every page follows its page-type template; one term per concept | Template and naming checkable by script; zero deviations |
| D7 | First-success path: from the docs home to a running, correct first grid | Cannot succeed without outside help | Needs 5+ pages | 3 to 4 pages | 2 pages and one wrong guess | Home to running grid in at most 2 clicks on 2 pages of at most 6 screens together | One obvious start path, install and first grid on at most 2 short pages, a visible result after each step, follow-up steps linked |
| D8 | Growth resilience: room for the planned server-side additions without a new rewrite | Each new feature forces a new group | New features land in overloaded groups | Room for some growth; two groups will overflow | Planned features fit; one group needs a split | Every planned feature needs at most 3 hand-written places and the rest is generated (S16) | Planned features fit with that rule, and no group exceeds its cap after the planned growth |

## Task battery

Reviewers trace each task in the navigation: the click path, the page reached, the screens scrolled to the answer, and
whether the page fully answers the task. A task that has no page scores a miss.

Beginner tasks:

- B1. Install gridcn and render a first grid.
- B2. Make one column editable and give it a date or select editor.
- B3. Learn what "view index", "range", and "active cell" mean.
- B4. Match the grid to my theme (colors, density, radius).
- B5. Add sorting and a filter UI.
- B6. Find a copy-paste example of an editable grid.
- B7. Find how to freeze columns (the word "frozen" comes from another tool, not from the docs).

Senior tasks (E1 to E8; the review notes called them S1 to S8, which clashes with the sidebar rule numbers):

- E1. Decide which features work when rows load from a server (sort, filter, selection, find, export).
- E2. Look up the exact signature and timing of the cell commit and validation callbacks.
- E3. Write a plugin that reacts to grid events.
- E4. Check the keyboard and screen reader contract for an accessibility review.
- E5. Judge the cost at 1,000,000 rows and what to avoid.
- E6. Wire optimistic edits with a server round trip, rollback, and conflict handling.
- E7. Judge upgrade risk: version policy, breaking changes, how to pull fixes into installed code.
- E8. Add undo and redo that survives server edits.
- E9. Look up a console warning by its exact text.

Shared tasks (both personas, used to compare):

- X1. Persist sort and filter in the URL.
- X2. Paste from a spreadsheet and validate the values.
- X3. Export to CSV safely.
- X4. Load rows page by page from my API.
- X5. Answer "which version added this, and does it work in server mode?" for one feature.

The task battery needs updating when features ship. B7, E9, and X5 test vocabulary, messages, and facts; they came from the
validation report. Reviewers record directness (does the first click lead toward the answer) next to clicks and screens.

## Review routine

1. Generate the page data: `node scripts/docs-nav-audit.mjs --json` for the current docs. A candidate navigation is a
   text file. A `@ Area` line is a tab. A `## Group` line is a folder (`{az}` marks a generated A to Z list). A
   `### Subgroup` line is a third-level folder (`{open}` keeps it open). A `- slug | title | type | planned words | aliases | planned code lines` line is a
   page (the last two columns are optional). A `<< file` line includes another file, and `//` starts a comment. The first page of a group is its landing.
   `node scripts/docs-nav-audit.mjs --candidate <file>` checks the structure rules.
2. Give each reviewer: this file, the ruleset, the sitemap, the audit numbers, and read access to the pages it names.
   A reviewer scores one persona. Use the strongest available model at high effort, one fresh agent per persona, no shared
   context between personas.
3. The reviewer traces every task of its persona plus the shared tasks. For each task it records the path, the clicks,
   the screens, the directness, and a pass or miss.
4. The reviewer scores D1 to D8 from 0 to 10 and cites at least two concrete pages or sidebar groups per dimension that
   explain the score. A score without a cited page is void.
5. The reviewer returns the JSON below plus the top five defects by impact.
6. The manager merges the runs: the mean of the persona scores is the navigation score.
   Token economy: in the pilot the top defects overlapped across personas. A screening round runs one senior reviewer per
   candidate. A finalist also gets a beginner run, because that run adds the learning-path and first-success signal (D4,
   D7). A second run of a persona is spent when a score sits within the noise of a pass line or when a finding would
   change the ranking. A persona whose findings other runs already found for two rounds in a row leaves the loop.
7. A candidate passes at an overall score of at least 9.0, no dimension below 8.0 for any persona, no missed task, and every
   gate of the ruleset (section 9). The finalist gets two runs per persona, and the median of the runs counts.
   Only a round that ran both personas can pass. The goal is 10.0. Every remaining gap below 10 needs a one-line reason in
   the comparison file. Noise: two senior runs on one navigation differed by 0.13 on the mean and up to 1.0 per dimension
   (pilot), and two runs on near-identical versions differed by 0.5 on the mean (final round). Treat a difference below
   0.5 on the mean as noise. The run files are in `research/docs-navigation/scores.json`.

Output schema for one reviewer run:

```json
{
  "persona": "beginner",
  "navigation": "candidate-a",
  "scores": { "D1": 0, "D2": 0, "D3": 0, "D4": 0, "D5": 0, "D6": 0, "D7": 0, "D8": 0 },
  "evidence": { "D1": ["page or group cited", "page or group cited"] },
  "tasks": [{ "id": "B1", "path": ["Getting started", "Installation"], "clicks": 2, "screens": 6, "answered": true }],
  "defects": [{ "impact": 1, "where": "sidebar group or page", "problem": "one sentence", "fix": "one sentence" }]
}
```

## Judging rules for reviewers

- Score the navigation as built, not as intended. A page that does not exist scores as missing.
- Count screens with the audit numbers. One screen is 250 prose words or 35 code lines. A live preview counts as 0.6
  screen. A candidate file lists prose words only. Add one screen per 35 planned code lines when the content map shows a
  code example, or mark D2 as provisional.
- A hidden sidebar group (collapsed) costs one click.
- Do not reward length or coverage. Reward the reader reaching the answer sooner.
- Penalize the same fact on two pages with different words.
- When a rule from the ruleset is broken, name the rule number in the defect.

## Persona pilot

The pilot scores the current navigation to decide whether three personas add information over two.

Method: one beginner run, one mid-level run, two senior runs (S-a and S-b, same prompt, fresh agents). The two senior
runs give the noise floor. The mid-level persona is kept only when its scores differ from the senior mean by more than the
noise, on at least two dimensions, and its unique defects change the ranking of fixes.

Result: see [Pilot result](#pilot-result).

## Pilot result

Current navigation (2.0 docs, 100 pages), 8 dimensions, scores 0 to 10:

| Dimension | Beginner | Mid | Senior A | Senior B | Senior mean | Mid minus senior mean | Senior A minus B (noise) |
|---|---|---|---|---|---|---|---|
| D1 Findability | 6 | 6 | 6 | 6 | 6.0 | 0.0 | 0 |
| D2 Scroll cost | 6 | 5 | 6 | 5 | 5.5 | -0.5 | 1 |
| D3 Cognitive load | 4 | 4 | 5 | 5 | 5.0 | -1.0 | 0 |
| D4 Learning path | 5 | 5 | 4 | 5 | 4.5 | +0.5 | -1 |
| D5 Reference lookup | 5 | 6 | 5 | 6 | 5.5 | +0.5 | -1 |
| D6 Consistency | 5 | 4 | 4 | 4 | 4.0 | 0.0 | 0 |
| D7 First success | 6 | 7 | 7 | 7 | 7.0 | 0.0 | 0 |
| D8 Growth resilience | 4 | 4 | 4 | 4 | 4.0 | 0.0 | 0 |
| Mean | 5.13 | 5.13 | 5.13 | 5.25 | 5.19 | -0.06 | -0.13 |

Measured:

- The keep rule needs a difference above the noise on at least two dimensions. The mid run exceeds the noise on D3 only (1.0 against 0). The D2, D4, and D5 differences (0.5) sit below the senior noise (1.0).
- Mean absolute dimension delta, mid vs senior mean: 0.31. Between the two senior runs: 0.38.
- Unique defects of the mid run: two (no radius docs, a misleading Pagination path). The beginner run found the first and senior A found the second.
- Task misses: beginner 1, mid 3, senior A 1, senior B 1. The mid misses (B4, S5, S6 in the run file) are the beginner miss (B4) and the senior miss (S5) plus one conflict-handling gap in S6.

Decision: drop the mid persona. The keep rule is not met. Two personas, beginner and senior, cover the spread.

Baseline of the current navigation: beginner 5.13, senior 5.19, overall 5.16.

All four runs agree on the same top defects: no start path that states prerequisites, styling and theming buried under "Columns & layout" at 22.8 screens, server data spread over four places, contradicting row-limit and version facts, 52 of 100 pages without a next step, group names that hide topics (Accessibility and Performance under Architecture, Recipes under Reference, a one-page Hooks group).

## Calibration log

A change to the rubric is calibration. It does not count as a gain of the navigation. Compare scores only inside one rubric
version.

| Date | Change | Why | Expected effect |
|---|---|---|---|
| 2026-11-05 | D3 anchors use the ruleset's own limits: 9 at 25 rows and 9 pages, 7 at 30 rows and 12 pages, 10 at 20 rows and 7 pages | The old anchors (9 at 20 rows) contradicted S5 (25 rows) and the public docs sites studied (24 to 40 rows) | D3 up by about 0.5 to 1 for the same tree; mean up by 0.15 to 0.25 |
| 2026-11-05 | D8 anchor 9 counts hand-written places (at most 3, S16) instead of one page per feature | Ruleset section 6 needs several places per feature, so the old anchor could not be met | D8 up by about 0.5; mean up by about 0.1 |
| 2026-11-05 | D1 10 and D7 10 wording made observable (directness, visible result per step) | The old wording ("search is a backup only") could not be observed from a plan | none |
| 2026-11-05 | Task battery extended (B7, E9, X5), directness recorded, gates added, two runs per persona on the finalist | Validation report: make the score harder to game | Scores may fall |

The last navigation score on the old rubric: C19, 8.72 (beginner 8.81, senior 8.63).

## Rubric caps found in rounds 15 to 17 (apply when the written docs are rescored)

No anchor was lowered. The caps below hold for any navigation and need these fixes, which belong in the calibration log when applied.

| Cap | Evidence | Proposed fix |
|---|---|---|
| D3 10 versus S12 | A 10 needs 7 pages per group; the Learning path has 9 steps and Sort, filter, and search has 8 pages | Count path steps apart from group pages, or raise the 10 anchor to 9 pages |
| D4, D7 | Prerequisites, Next links, and a visible result per step show only on written pages | Rescore D4 and D7 on the written Learn pages with the step template check (P15) |
| D2 | About 12 code-heavy pages have no planned code lines | Fill column 6 for every page typed feature or task before the rescore |
| D1 | The built search index top-3 test has not run | Run it once the site builds the new index |
| D6 | N3 and N4 are reviewer-only rules | Add a script check for titles, aliases, and landing titles |

Open work item for the docs rewrite: gate A10 fails on the docs shell (no labelled nav landmark, no aria-current, icon-only menu button, area switcher two taps at 375 px). See gate-results.md.
