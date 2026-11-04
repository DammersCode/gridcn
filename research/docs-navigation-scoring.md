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

The mid-level persona (has used one grid before, learns by doing) is retired. The [pilot](#persona-pilot) showed no difference from the senior beyond run-to-run noise.

## Dimensions

Every dimension scores 0 to 10 per persona. Anchors apply to the score at that row; use the values between them.

| # | Dimension | 0 | 3 | 5 | 7 | 9 | 10 |
|---|---|---|---|---|---|---|---|
| D1 | Findability: clicks and guesses from a task to the page that answers it | Page not reachable from the sidebar | Needs 3+ wrong guesses; group names hide the topic | 1 to 2 wrong guesses; some names ambiguous | Right page in the first or second click for most tasks | Right page first click, every group name predicts its content | Sidebar plus landing pages answer every task in one click; search is a backup only |
| D2 | Scroll cost: screens a reader scrolls to get the answer | Typical task page above 20 screens | 12 to 20 screens | 8 to 12 screens | Typical task page 5 to 8 screens | Typical task page at or below 5 screens; the answer sits in the first two screens | Every task page at or below 5 screens, answer above the fold or one anchor away |
| D3 | Cognitive load: concepts, choices, and nav items held at once | Sidebar shows 40+ peers in one list | 25+ peers; pages mix 3+ concepts | 15 to 25 peers per view; some mixed pages | Each view shows at most 12 peers; one concept per page, few exceptions | At most 9 peers per view; no page mixes concepts | At most 7 peers per view; progressive disclosure hides what the task does not need |
| D4 | Learning path: a defined order from zero to productive | No order; reader must guess | Order exists in one place only by accident | A "start here" list exists but skips steps | A stepper or path covers the core; branches are unmarked | Paths for the core and for each main goal; every page names its next page | Paths per goal with prerequisites and next page on every page; the sidebar order matches the path |
| D5 | Reference lookup speed: time to a prop, event, option, or limit | Reference is one page above 20 screens | Reference is one page above 12 screens, no per-concern anchors | Reference split by area, but names are not predictable | Tables per concern, stable anchors, lookup in 2 clicks | Reference page per concern, a lookup index, lookup in 1 to 2 clicks | One predictable URL per symbol or concern; an index page; all lookups in at most 2 clicks |
| D6 | Consistency: same names, order, and page shape for the same kind of thing | Every page has its own shape | Add-ons share a shape; the rest vary | Page types exist but are not followed | Page types followed by most pages; naming mostly stable | Every page follows its page-type template; one term per concept | Template and naming checkable by script; zero deviations |
| D7 | First-success time: from the docs home to a running, correct first grid | Cannot succeed without outside help | Needs 5+ pages and 20+ minutes | 3 to 4 pages, about 15 minutes | 2 pages, about 10 minutes | Home to running grid in at most 2 clicks and 5 minutes | One obvious start path, install and first grid on at most 2 short pages, follow-up steps linked |
| D8 | Growth resilience: room for the planned server-side additions without a new rewrite | Each new feature forces a new group | New features land in overloaded groups | Room for some growth; two groups will overflow | Planned features fit; one group needs a split | Planned features fit with at most one new page per feature | Planned features fit; rules say where each new page goes; no group exceeds its cap after growth |

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

Senior tasks:

- S1. Decide which features work when rows load from a server (sort, filter, selection, find, export).
- S2. Look up the exact signature and timing of the cell commit and validation callbacks.
- S3. Write a plugin that reacts to grid events.
- S4. Check the keyboard and screen reader contract for an accessibility review.
- S5. Judge the cost at 1,000,000 rows and what to avoid.
- S6. Wire optimistic edits with a server round trip, rollback, and conflict handling.
- S7. Judge upgrade risk: version policy, breaking changes, how to pull fixes into installed code.
- S8. Add undo and redo that survives server edits.

Shared tasks (both personas, used to compare):

- X1. Persist sort and filter in the URL.
- X2. Paste from a spreadsheet and validate the values.
- X3. Export to CSV safely.
- X4. Load rows page by page from my API.

The task battery needs updating when features ship. Keep each persona at 10 or fewer tasks.

## Review routine

1. Generate the page data: `node scripts/docs-nav-audit.mjs --json` for the current docs. A candidate navigation ships as
   a sitemap file (indented tree: group, page, word budget, H2 list, page type).
2. Give each reviewer: this file, the ruleset, the sitemap, the audit numbers, and read access to the pages it names.
   A reviewer scores one persona. Use the strongest available model at high effort, one fresh agent per persona, no shared
   context between personas.
3. The reviewer traces every task of its persona plus the shared tasks. For each task it records the path, the clicks,
   the screens, and a pass or miss.
4. The reviewer scores D1 to D8 from 0 to 10 and cites at least two concrete pages or sidebar groups per dimension that
   explain the score. A score without a cited page is void.
5. The reviewer returns the JSON below plus the top five defects by impact.
6. The manager merges the runs: the mean of the persona scores is the navigation score. Run each persona twice for a
   final candidate; use the mean and report the spread.
7. A candidate passes at an overall score of at least 9.0, no dimension below 8.0 for any persona, and no missed task.
   The goal is 10.0. Every remaining gap below 10 needs a one-line reason in the candidate's score file.

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
- Count screens with the audit numbers. One screen holds about 250 words, 35 lines of code, or 0.6 of a live preview.
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

- Mean absolute dimension delta, mid vs senior mean: 0.31. Between the two senior runs: 0.38. The mid persona differs from the senior by less than two senior runs differ from each other.
- Largest single-dimension delta: 1.0 (mid vs senior mean, D3) and 1.0 (senior A vs B, D2, D4, D5). Same size.
- Unique defects of the mid run: two (no radius docs, a misleading Pagination path). The beginner run found the first and senior A found the second.
- Task misses: beginner 1, mid 3, senior A 1, senior B 1. The mid misses (B4, S5, S6) are the beginner miss (B4) and the senior miss (S5) plus one conflict-handling gap in S6.

Decision: drop the mid persona. Two personas, beginner and senior, cover the spread. The senior persona runs twice per final candidate (see the routine) so the noise stays visible.

Baseline of the current navigation: beginner 5.13, senior 5.19, overall 5.16.

All four runs agree on the same top defects: no start path that states prerequisites, styling and theming buried under "Columns & layout" at 22.8 screens, server data spread over four places, contradicting row-limit and version facts, about 50 percent of pages without a next step, group names that hide topics (Accessibility and Performance under Architecture, Recipes under Reference, a one-page Hooks group).
