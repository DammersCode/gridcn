# Docs navigation ruleset

These rules say how the docs are split, grouped, named, and ordered. A navigation passes when every rule holds or carries a
written exception (section 8) and passes the gates (section 9). Three modes of `scripts/docs-nav-audit.mjs` test the rules:

- `--check` tests the pages in `content/docs` (page rules P and naming rules N).
- `--candidate <file>` tests a navigation file (sidebar rules S, planned page budgets, titles, slugs).
- `--queries <file>` tests the reader query list against a navigation file (A11).
- `--sitemap` prints the current tree.

The score method is in [docs-navigation-scoring.md](docs-navigation-scoring.md). The sources behind the numbers are in
[docs-navigation-research.md](docs-navigation-research.md). A check of the rules against public docs sites and standards
is in `research/docs-navigation-ruleset-validation.md` on the branch that holds it. Prose rules stay in `AGENTS.md`
(Docs) and the `simple-english` skill. This file adds structure rules only.

Terms:

- **Words** are prose words without fenced code. Tables and the bodies of tabs count.
- A **screen** is 250 prose words or 35 code lines. A live preview counts as 0.6 screen. The audit script computes both.
- A **peer** is a sidebar row visible at the same time.
- Own judgement, with no external source: the page budgets, the 110-word paragraph, the 25-row view, the 160-character
  description, the number of related links, and the task finder size. Observed on public docs sites: group sizes, area counts,
  and depth. Published practice: title length, sentence length, steps per task, learning-path length.

## 1. Page types

Every page has exactly one type. The type decides the budget and the template. A page declares its type in frontmatter
(see N6).

| Type | Answers | Words (target / hard) | Screens (hard) | H2 count | Template |
|---|---|---|---|---|---|
| Landing | Where do I go? | 80 to 350 / 400 | 3 | 0 to 6 | One-paragraph purpose; one line per child page; a task list or a path; no props table |
| Feature | How does this work and how do I use it? | 400 to 1,200 / 1,500 | 8 | 2 to 8 | Problem paragraph; demo; install; behavior; server mode; props tables; Related |
| Concept | Why does it work this way? | 300 to 1,000 / 1,200 | 6 | 2 to 5 | The question the reader has; the model in short sentences; consequences; Related. No props table |
| Task | How do I do X? | 200 to 800 / 1,000 | 6 | 2 to 8 | Goal sentence; prerequisites that are not obvious; numbered steps; result; Related |
| Step | What is the next step of the path? | 200 to 600 / 800 | 5 | 2 to 6 | Before you start (prerequisites); outcome; steps; visible result; Next link, or Where next on the last step |
| Reference | What is the exact contract? | 300 to 1,500 / 2,000 | 14 | 3 to 10 | Summary table; one H3 or table row with an id per symbol; caveats; Related |
| Example | What does a working demo look like? | 100 to 500 / 800 | 6 | 0 to 5 | Live demo; what it shows; Related |
| Cheatsheet | What is the value or key? | tables only / 1,200 | 12 | 2 to 10 | Tables with a one-line purpose each; every row links to its page |

## 2. Page rules (P)

- P1. A page stays at or below its hard word cap and hard screen cap. Above the target is a warning. Above the hard cap is
  a failure.
- P2. A page has the H2 count of its type. Below the lower bound the page merges into its parent (S9). Above the upper
  bound the page splits (S8).
- P3. The answer or the live demo sits in the first screen. A Feature page puts the problem paragraph and
  `<ComponentPreview>` before the first H2. A Reference page puts its summary table there.
- P4. A paragraph has at most 110 words, which is seven lines, and at most 7 sentences. A sentence has at most 25 words.
  The audit reports the longest paragraph and the sentences over the limit.
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
- P13. A Feature page whose behavior differs between client and server mode has an H2 named "Server mode". It states the
  request and the response and links the Server page that owns the detail. The feature list comes from
  `research/parity-matrix.json` (cells that are not `n/a`).
- P14. The bodies of tabs count toward P1 and P4. The audit script counts them.
- P15. A Task page has at most 12 numbered steps, with 7 as the target. A step holds one action.
- P16. A line in a code block has at most 80 characters. An omission is a comment in the language of the sample.

## 3. Sidebar rules (S)

- S1. The sidebar has 4 to 6 areas, with 7 as the hard cap. An area is a root folder. Its sidebar shows only that area, and
  a tab switches between areas. Areas are parallel sections for the same readers.
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
- S7. Every group has a Landing page that is the group's first sidebar entry. The landing page lists each child with its
  description, and the list is generated. It may carry the group's overview text within the Landing budget.
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
- S16. A new feature changes at most 3 hand-written places: its page, its options section, and its example page.
  A server mode adds one Server page and one row in the data modes matrix. Everything else is generated: the group landing lists (from page descriptions), the task finder entries (from the `finder`
  frontmatter line), the Terms alias table, the feature matrix, the cheatsheets, the sidebar, and the model index (A12).

## 4. Naming rules (N)

- N1. A sidebar label has 1 to 4 words. A page title has at most 60 characters and starts with the key word.
- N2. Titles are unique across the docs. Two pages never share a title. Qualify the second ("Pinned columns",
  "Pinned rows").
- N3. A label uses one name per concept, taken from `GLOSSARY.md` and `terms`. A concept with two names in the docs is a
  defect. A name a reader uses for the concept goes in the `aliases` list of the page (A11), not in the prose.
- N4. A title is a noun phrase for Feature, Concept, Reference, Landing, and Cheatsheet pages. It is an imperative verb
  phrase for Task and Step pages ("Save edits to a server"). A Landing page uses its group label as its title, and the
  docs home may use its own title. An example page is the exception: its title is the task as a noun phrase plus
  "example" ("Pin rows example").
- N5. A slug is fixed when the page is created. It is the first four words of the kebab-case title after the stop words
  (a, an, the, to, in, of, by, from, with, and, for, on, at) are removed. A camelCase word splits at its capitals
  (`useDebounce` becomes `use-debounce`). A folder name follows the same rule for the group label. Two pages of one group
  never share a slug. A later title edit keeps the slug. A slug change needs a redirect (N8).
- N6. A page declares its type in frontmatter as
  `type: landing | feature | concept | task | step | reference | example | cheatsheet`. The audit script reads it and fails
  on an unknown value. An `index.mdx` without a `type` is a Landing page. A page without a `type` counts as Feature. The
  page schema in `source.config.ts` needs the field.
- N7. An H2 title is front-loaded: the first two words carry the topic. It is not a question and not a sentence.
- N8. An existing anchor never disappears without a redirect (see the migration plan, section 6).
- N9. Every prop, event, option, and command on a Reference page has an anchor: an H3, or a table row with an id. The anchor
  is the symbol name in lower case. The cheatsheets link to it. An anchor is never renamed (N8).

## 5. Reader aids (A)

- A1. Every page has the on-page table of contents ("On this page"). It lists H2 and H3 only.
- A2. Breadcrumbs appear only on pages at depth 3. Every page marks the current item in the sidebar (A10).
- A3. The docs home is the landing of the Learning path group. It shows three entries, one per reader: start with a first
  grid (new to the grid), the server path (building on server data), and the Evaluate area (deciding whether to adopt).
  A link to the task finder sits next to them.
- A4. One task finder page lists "I want to ..." tasks by intent, each one link, at most 40 entries, grouped in at most
  8 intents. A page adds itself to the finder with a `finder` line in its frontmatter, and the page is generated.
- A5. One feature matrix page lists every feature with core or add-on, client or server support, and links to its guide
  and its reference.
- A6. Search stays on. Titles and descriptions are written for it (P8, N1).
- A7. Prev and next links appear only in path groups. Topic groups use Related.
- A8. A Step page shows "Step n of N" and the list of its path group, so the reader sees the whole route.
- A9. The last step of a path group ends with a Where next block of at most 3 links: the next path, the task finder, and the
  area that holds the detail. Pages outside path groups show no prev and next links.
- A10. Navigation accessibility (a gate, section 9): a skip link or landmarks; a labelled `nav` landmark for the sidebar and
  one for "On this page"; the current page marked with `aria-current="page"`; collapsible groups built as a disclosure (a
  button with `aria-expanded`); sidebar links at least 24 by 24 CSS px; no horizontal page scroll at 320 CSS px (code
  blocks and data tables excepted); the same sidebar order on every page of an area; at 375 px the area switcher reachable in
  one tap and the menu control labelled with text.
- A11. Search finds the reader's word. Any page may list `aliases` in frontmatter, such as "frozen" or "infinite scroll".
  An alias has one owner page. Aliases enter the search index. A list of reader queries (`research/docs-navigation/reader-queries.txt`,
  at least 30 lines) names for each query the page that must answer it. The built search index returns that page in the
  first 3 results. The Terms page lists every alias with the page that owns it (generated). A search with no result links the task finder
  and the Terms page.
- A12. The site serves `/llms.txt`, built from titles and descriptions in sidebar order, and a Markdown copy of each page at
  the page URL plus `.md`. A test checks that every page appears once and every link returns 200.
- A13. One reference page, "Messages", lists every error and warning the library prints or throws. It has one H2 per
  message, headed by the exact text or code, with the cause, the fix, and a link to the guide.
- A14. A page that owns a feature (a Feature or Task page) shows a status line built from frontmatter: kind (core or add-on), modes (client, server), stability,
  and the first version that has it. The keys are `kind`, `modes`, `stability`, and `since`. The feature matrix shows the same four
  columns (generated). The key `status` is not used, because `pnpm lint` rejects it in `content/docs`.

- A15. The Evaluate landing holds an ordered adoption checklist that links fit and features, speed, accessibility, and support.

## 6. Where a new page goes

This table answers S14 before a page is written. A group of 7 pages is at its target (S3): plan the split before the next
page. A page may still land until the group reaches 12 pages. Build holds 9 groups and Reference 8, so each area has room for one
new group before the cap (S2).

| New thing | Hand-written places (S16) | Generated |
|---|---|---|
| Add-on | A page in the group of its topic, its own Add-on options page (one per add-on, A to Z), an example page | Landing lists, task finder entry, feature matrix row, cheatsheet rows, model index, status line |
| Server feature | A page in the Server group of its mode, a row in the data modes matrix | Feature matrix row, a step link in the Server path when it changes the route |
| Event or callback | A section in the matching Events page | Row in the events cheatsheet, anchor (N9) |
| Cell type | A section in the built-in cell types page, an example page | Cheatsheet rows |
| Prop | A row in the matching props page | Props cheatsheet, anchor (N9) |
| Behavior that needs a reason | A Concept page in Reference > Concepts. A topic with its own Reference group (plugins) or Evaluate group (performance, accessibility) keeps its concept pages there | |
| Server feature that works in both modes | A page in Server > Data modes, a row in the data modes matrix, a "Server mode" section on the feature page (P13) | Feature matrix row |
| Library message | none: the Messages page is generated from the source | Messages page, index entry |
| Breaking change | A section in the upgrade page and a line in the version policy and changelog page | |

## 7. Limits that need an owner decision

The table of limits in the validation report lists which numbers are supported, observed, or guessed. No limit is wrong. The
area cap (S1) and the H2 bounds (section 1) were loosened after that check.

## 8. Exceptions

An exception is a line in `research/docs-navigation/exceptions.txt`: rule number, page path, reason. The audit script skips
that rule for that page. A page with `generated: true` in its frontmatter skips P1 and P2. A page with an exception is
reviewed again at the next release.

## 9. Gates

A gate is a pass or fail check that a script runs. A reviewer does not score it. A candidate that fails a gate cannot pass.

| Gate | Check | Run by |
|---|---|---|
| Structure | `--candidate` reports no failure | `docs-nav-audit.mjs` |
| Vocabulary | Every query of the reader list names a page that exists (`--queries`) and the built index returns it in the first 3 results (A11) | `docs-nav-audit.mjs`, then the search test |
| Accessibility and mobile | The A10 checks on a built page at 1280 and 375 px | Browser script |
| Model index | A12: every page once, every link 200 | Build test |
| Links and anchors | No old URL or anchor returns 404 (N8) | Migration check |

Deferred until after launch: an edit link and a last-modified date, localization, a version switcher at the first release
with two lines, and typed deprecation notices in the changelog.

## 10. Check mapping

| Rule | Checked by |
|---|---|
| P1, P2, P4, P8, P11, P14, P15, P16 | `--check` |
| P3, P5, P6, P7, P9, P10, P12 | Reviewer |
| P13, N9, A13 | Planned machine checks (not scripted yet); reviewer until then |
| S1, S2, S3, S4, S5, S7, S12, S13, S15 | `--candidate` |
| S6, S8, S9, S10, S11, S14, S16 | Reviewer |
| N1 (title length), N2 | `--check` for pages, `--candidate` for the planned titles |
| N1 (label word count) | `--candidate` (warning) |
| N1 (key word first), N3, N4, N7, N8 | Reviewer and the redirect map |
| N5 | `--candidate` (slug collision) and the URL map generator |
| N6 | `--check` (unknown type) |
| A11 (query list, vocabulary in the title or aliases) | `--queries` |
| A10, A12 | Gates |
| A1 to A9, A14 | Reviewer |
