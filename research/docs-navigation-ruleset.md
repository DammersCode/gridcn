# Docs navigation ruleset

These rules say how the docs are split, grouped, named, and ordered. A navigation passes when every rule holds or carries a
written exception (section 7). Three modes of `scripts/docs-nav-audit.mjs` test the rules:

- `--check` tests the pages in `content/docs` (page rules P and naming rules N).
- `--candidate <file>` tests a navigation file (sidebar rules S, planned page budgets, titles, slugs).
- `--sitemap` prints the current tree.

The score method is in [docs-navigation-scoring.md](docs-navigation-scoring.md). The sources behind the numbers are in
[docs-navigation-research.md](docs-navigation-research.md). Prose rules stay in `AGENTS.md` (Docs) and the `simple-english`
skill. This file adds structure rules only.

Terms:

- **Words** are prose words without fenced code. Tables count.
- A **screen** is 250 prose words or 35 code lines. A live preview counts as 0.6 screen. The audit script computes both.
- A **peer** is a sidebar row visible at the same time.
- Own judgement: the page budgets, the 110-word paragraph, the 25-row view, the 160-character description, and the group
  sizes have no external source. The research file lists what it supports (reading behavior, depth, and learning-path
  length).

## 1. Page types

Every page has exactly one type. The type decides the budget and the template. A page declares its type in frontmatter
(see N6).

| Type | Answers | Words (target / hard) | Screens (hard) | H2 count | Template |
|---|---|---|---|---|---|
| Landing | Where do I go? | 80 to 350 / 400 | 3 | 0 to 6 | One-paragraph purpose; one line per child page; a task list or a path; no props table |
| Feature | How does this work and how do I use it? | 400 to 1,200 / 1,500 | 8 | 2 to 6 | Problem paragraph; demo; install; behavior; props tables; Related |
| Concept | Why does it work this way? | 300 to 1,000 / 1,200 | 6 | 2 to 5 | The question the reader has; the model in short sentences; consequences; Related. No props table |
| Task | How do I do X? | 200 to 800 / 1,000 | 6 | 2 to 5 | Goal sentence; numbered steps; result; Related |
| Step | What is the next step of the path? | 200 to 600 / 800 | 5 | 2 to 4 | Outcome first; steps; visible result; Next link |
| Reference | What is the exact contract? | 300 to 1,500 / 2,000 | 14 | 3 to 10 | Summary table; per-concern sections; caveats; Related |
| Example | What does a working demo look like? | 100 to 500 / 800 | 6 | 0 to 5 | Live demo; what it shows; Related |
| Cheatsheet | What is the value or key? | tables only / 1,200 | 12 | 2 to 10 | Tables with a one-line purpose each; every row links to its page |

## 2. Page rules (P)

- P1. A page stays at or below its hard word cap and hard screen cap. Above the target is a warning. Above the hard cap is
  a failure.
- P2. A page has the H2 count of its type. Below the lower bound the page merges into its parent (S9). Above the upper
  bound the page splits (S8).
- P3. The answer or the live demo sits in the first screen. A Feature page puts the problem paragraph and
  `<ComponentPreview>` before the first H2. A Reference page puts its summary table there.
- P4. A paragraph has at most 110 words, which is seven lines. The audit reports the longest paragraph.
- P5. A page has one concept. When two H2 clusters answer different questions for different readers, they are two pages.
- P6. One fact has one canonical page. All other pages link it in one line. The dedup map in `docs-prose-audit.md` stays in
  force. Version facts live on the version policy page, and the row ceiling lives on the row limits page. A support matrix
  has one data file. Pages may show generated views of it, such as the feature matrix with client and server columns. The
  page that explains each mode owns the prose, and each matrix row links to it.
- P7. A page ends with a Related section of 1 to 5 links. Landing pages are exempt. A Step page ends with a Next link
  instead.
- P8. Every page has a `description` of at most 160 characters. It states what the page lets the reader do.
- P9. Disclosure inside a page has one level: `<Tabs>` or one details block, never nested. A heading that has an inbound
  deep link stays a heading and never sits inside a tab.
- P10. A Feature page links its Reference page, and the Reference page links back. A Task page links the page that explains
  the concepts it uses.
- P11. No page has fewer than 80 words, and no page is only links, unless it is a Landing page.
- P12. A docs-changes marker (`<NewBadge />`) follows `AGENTS.md`. A moved section keeps its badge.

## 3. Sidebar rules (S)

- S1. The sidebar has 4 to 6 areas. An area is a root folder. Its sidebar shows only that area, and a tab switches between
  areas. Areas are parallel sections for the same readers.
- S2. An area has 4 to 10 groups. A group is a folder. The Learn or Start area holds 3 to 7 groups. A closed folder shows
  one row, so ten groups stay scannable (S5).
- S3. A group has at most 7 pages at target and 12 at the hard cap. A group of generated option pages, sorted A to Z by
  visible title, is exempt. A group counts the pages it lists directly. Each third-level subgroup follows the same cap.
  A path group (S12) may hold 12 pages.
- S4. The tree is two levels deep: group, then page. A third level is allowed only inside Reference, Recipes, and Examples
  groups.
- S5. At most 25 sidebar rows are visible at once on any page. The count is the groups of the area, plus the pages of the
  one open group, plus the pages of its open subgroups.
- S6. Groups are collapsible folders. The group of the current page is open. Every other group is closed. A closed group
  opens on its landing page, so no page hides behind a second click.
- S7. Every group has a Landing page that is the group's first sidebar entry. The landing page introduces each child in one
  line. It may carry the group's overview text within the Landing budget.
- S8. Split a page when it breaks P1, P2, or P5, or when two thirds of its inbound deep links go to one H2 cluster. Each
  new page gets the type that fits it.
- S9. Merge a page into its parent when it breaks the lower bound of P2 or P11.
- S10. A topic appears once in the sidebar. A page that belongs to two areas lives in one and is linked from the other.
  There are no duplicate entries.
- S11. The order inside a group is: Landing, the shortest path to first use, common tasks, advanced behavior,
  troubleshooting. A group that teaches a skill follows the path order. A Reference group follows the product (the order of
  the options) or A to Z.
- S12. A goal with an ordered route has a path group in the Learn or Start area: a group of 3 to 10 Step pages. The first
  path group is the Learning path with 6 to 10 steps. Other goals, such as server data, get their own path group. A path
  group order is its sidebar order, and each step names the next step. A step links to the task pages that hold the
  detail and does not repeat them. A side page, such as install problems, sits outside the path groups.
- S13. Group labels name the reader's goal or the thing: "Edit data", "Server data". The labels "Architecture", "Advanced",
  "Misc", "Other", and "Utilities" are not used.
- S14. A new feature gets its page in the area where its reader looks. When the group is at its cap, the group splits
  before the page lands.
- S15. A group has at least 2 pages.

## 4. Naming rules (N)

- N1. A sidebar label has 1 to 4 words. A page title has at most 60 characters and starts with the key word.
- N2. Titles are unique across the docs. Two pages never share a title. Qualify the second ("Pinned columns",
  "Pinned rows").
- N3. A label uses one name per concept, taken from `GLOSSARY.md` and `terms`. A concept with two names in the docs is a
  defect.
- N4. A title is a noun phrase for Feature, Concept, Reference, Landing, and Cheatsheet pages. It is an imperative verb
  phrase for Task and Step pages ("Save edits to a server"). A Landing page uses its group label as its title, and the
  docs home may use its own title. An example page is the exception: its title is the task as a noun phrase plus
  "example" ("Pin rows example").
- N5. A slug is the first four words of the kebab-case title. A camelCase word splits at its capitals (`useDebounce`
  becomes `use-debounce`). A folder name is the group label in kebab-case, cut the same
  way. Two pages of one group never share a slug.
- N6. A page declares its type in frontmatter as
  `type: landing | feature | concept | task | step | reference | example | cheatsheet`. The audit script reads it and fails
  on an unknown value. An `index.mdx` without a `type` is a Landing page. A page without a `type` counts as Feature. The
  page schema in `source.config.ts` needs the field.
- N7. An H2 title is front-loaded: the first two words carry the topic. It is not a question and not a sentence.
- N8. An existing anchor never disappears without a redirect (see the migration plan, section 6).

## 5. Reader aids (A)

- A1. Every page has the on-page table of contents ("On this page"). It lists H2 and H3 only.
- A2. Breadcrumbs appear only on pages at depth 3.
- A3. The docs home is the landing of the Learning path group. It shows three entries, one per reader: start with a first
  grid (new to the grid), the server path (building on server data), and the Evaluate area (deciding whether to adopt).
  A link to the task finder sits next to them.
- A4. One task finder page lists "I want to ..." tasks by intent, each one link, at most 40 entries, grouped in at most
  8 intents.
- A5. One feature matrix page lists every feature with core or add-on, client or server support, and links to its guide
  and its reference.
- A6. Search stays on. Titles and descriptions are written for it (P8, N1).
- A7. Prev and next links appear only in path groups. Topic groups use Related.
- A8. A Step page shows "Step n of N" and the list of its path group, so the reader sees the whole route.

## 6. Where a new page goes

This table answers S14 before a page is written. When the target group is at 7 pages, split the group first.

| New thing | Pages it needs |
|---|---|
| Add-on | A task page in the How-to group of its topic, an options section in the matching Add-on options page, an example page, and a row in the feature matrix |
| Server feature | A task page in the Server group of its mode, a row in the data modes matrix, and a step link in the Server path when it changes the route |
| Event or callback | A section in the matching Events page and a row in the events cheatsheet |
| Cell type | A section in the built-in cell types task page and an example page |
| Prop | A row in the matching props page; the props cheatsheet is generated |
| Behavior that needs a reason | A Concept page in Reference > Concepts |
| Breaking change | A section in the upgrade task page and the changelog link |

## 7. Exceptions

An exception is a line in `research/docs-navigation/exceptions.txt`: rule number, page path, reason. The audit script skips
that rule for that page. A page with `generated: true` in its frontmatter skips P1 and P2. A page with an exception is
reviewed again at the next release.

## 8. Check mapping

| Rule | Checked by |
|---|---|
| P1, P2, P4, P8, P11 | `--check` |
| P3, P5, P6, P7, P9, P10, P12 | Reviewer |
| S1, S2, S3, S4, S5, S7, S12, S13, S15 | `--candidate` |
| S6, S8, S9, S10, S11, S14 | Reviewer |
| N1 (length and word count), N2 | `--check` for pages, `--candidate` for the planned titles |
| N1 (key word first), N3, N4, N7, N8 | Reviewer and the redirect map |
| N5 | `--candidate` (slug collision) |
| N6 | `--check` (unknown type) |
| A1 to A7 | Reviewer |
