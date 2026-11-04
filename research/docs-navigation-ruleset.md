# Docs navigation ruleset

The checkable rules for how the docs are split, grouped, named, and ordered. A navigation passes when every rule holds or
carries a written exception. `node scripts/docs-nav-audit.mjs --check` tests the page rules (P) and the naming rules (N)
on the content, and `--sitemap` prints the tree for the sidebar rules (S). The score method is in
[docs-navigation-scoring.md](docs-navigation-scoring.md). The evidence behind the numbers is in
[docs-navigation-research.md](docs-navigation-research.md). Prose rules stay in `AGENTS.md` (Docs) and the `simple-english`
skill; this file adds structure rules only.

Terms: a page's **words** are prose words without fenced code (tables count). A **screen** is 250 words, or 35 code
lines, or 0.6 of a live preview. Both come from the audit script. A **peer** is a sidebar entry visible at the same time.

## 1. Page types

Every page has exactly one type. The type decides the budget and the template. The type follows from the path (see N6).

| Type | Answers | Words (target / hard) | Screens (hard) | H2 count | Template |
|---|---|---|---|---|---|
| Landing | Where do I go? | 80 to 350 / 400 | 3 | 0 to 6 | One-paragraph purpose; one line per child page; a task list or a path; no props table |
| Feature | How does this work and how do I use it? | 400 to 1,200 / 1,500 | 8 | 2 to 6 | Problem paragraph; demo; install; behavior; props tables; Related |
| Task | How do I do X? | 200 to 800 / 1,000 | 6 | 2 to 5 | Goal sentence; numbered steps; result; Related |
| Step | What is the next step of the path? | 200 to 600 / 800 | 5 | 2 to 4 | Outcome first; steps; visible result; Next link |
| Reference | What is the exact contract? | 300 to 1,500 / 2,000 | 14 | 3 to 10 | Summary table; per-concern sections; caveats; Related |
| Cheatsheet | What is the value or key? | tables only / 1,200 | 12 | 2 to 10 | Tables with a one-line purpose each; every row links to its page |

## 2. Page rules (P)

- P1. A page stays at or below its hard word cap and hard screen cap. Above the target is a warning, above the hard cap
  is a failure.
- P2. A page has the H2 count of its type. Below the lower bound the page merges into its parent (see S9). Above the
  upper bound the page splits (see S8).
- P3. The answer or the live demo sits in the first screen. A Feature page puts the problem paragraph and
  `<ComponentPreview>` before the first H2. A Reference page puts its summary table there.
- P4. A paragraph has at most 110 words (about 7 lines). The audit reports the longest paragraph.
- P5. A page has one concept. When two H2 clusters answer different questions for different readers, they are two pages.
- P6. One fact has one canonical page. All other pages link it in one line (the dedup map in `docs-prose-audit.md`
  stays in force). Version facts and size limits live in one page each (`project-status`, `performance`).
- P7. A page ends with a Related section of 1 to 5 links. Landing pages are exempt. A Step page ends with a Next link
  instead.
- P8. Every page has a `description` of at most 160 characters that states what the page lets the reader do.
- P9. Disclosure inside a page has one level: `<Tabs>` or one details block, never nested. A heading that has an inbound
  deep link stays a heading (it is never inside a tab).
- P10. A page of type Feature links its Reference page and the Reference page links back. A Task page links the Feature
  page that explains the concepts it uses.
- P11. No page below 80 words, and no page that is only links, unless it is a Landing page.
- P12. A docs-changes marker (`<NewBadge />`) follows `AGENTS.md`; a moved section keeps its badge.

## 3. Sidebar rules (S)

- S1. The sidebar has 4 to 6 areas. An area is a root folder: its sidebar shows only that area, and a tab switches
  between areas. Areas are parallel sections for the same readers.
- S2. An area has 4 to 8 groups. A group is a folder. The Learn or Start area is exempt: it holds 1 to 3 groups.
- S3. A group has at most 7 pages at target and 12 at the hard cap. A generated list sorted A to Z (props, hooks,
  recipes by name) is exempt.
- S4. The tree is two levels deep: group, then page. A third level is allowed only inside Reference and Recipes.
- S5. At most 25 sidebar rows are visible at once on any page: the groups of the area plus the pages of the one open
  group (and the open subgroups of a third level).
- S6. Groups are collapsible folders. The group of the current page is open; every other group is closed. A closed group
  opens on its landing page, so no page hides behind a second click.
- S7. Every group has a Landing page (`index.mdx`) that is the group's first sidebar entry. The landing page introduces
  each child in one line.
- S8. Split a page when it breaks P1, P2, or P5, or when two thirds of its inbound deep links go to one H2 cluster. Each
  new page gets the type that fits it.
- S9. Merge a page into its parent when it breaks the lower bound of P2 or P11.
- S10. A topic appears once in the sidebar. A feature page that belongs to two areas lives in one and is linked from the
  other. No duplicate entries.
- S11. The order inside a group is: Landing, the shortest path to first use, common tasks, advanced behavior,
  troubleshooting. A group that teaches a skill follows the path order. A Reference group is ordered by the product
  (the order of the options) or A to Z.
- S12. The learning path is a Learn area or a group of 6 to 10 Step pages, never more than 12. Its order is the sidebar
  order. Each step names the next step.
- S13. Group labels name the reader's goal or the thing: "Editing cells", "Server data". The labels "Architecture",
  "Advanced", "Misc", "Other", and "Utilities" are not used.
- S14. A new feature gets its page in the area where its reader looks. When the group is at its cap, the group splits
  before the page lands.

## 4. Naming rules (N)

- N1. A sidebar label has 1 to 4 words. A page title has at most 60 characters and starts with the key word.
- N2. Titles are unique across the docs. Two pages never share a title; qualify the second ("Pinned columns",
  "Pinned rows").
- N3. A label uses one name per concept, taken from `GLOSSARY.md` and `terms`. A concept with two names in the docs is
  a defect.
- N4. A title is a noun phrase for Feature, Reference, and Landing pages, and an imperative verb phrase for Task and Step
  pages ("Save edits to a server"). An example page under `examples/` is the exception: its title is the task as a noun phrase plus "example" ("Pin rows example").
- N5. A slug is the kebab-case of the title, at most four words. Folder names are the group names in kebab-case.
- N6. The path gives the type: `index.mdx` is Landing; a file under `reference/` is Reference; under `recipes/` is Task;
  under `learn/` is Step; under `cheatsheets/` is Cheatsheet; every other file is Feature.
- N7. An H2 title is front-loaded: the first two words carry the topic. It is not a question and not a sentence.
- N8. An anchor that exists today never disappears without a redirect (see the migration plan, section 4).

## 5. Reader aids (A)

- A1. Every page has the on-page table of contents ("On this page"). It lists H2 and H3 only.
- A2. Breadcrumbs appear only on pages at depth 3.
- A3. The docs home offers the two entry points, one per persona goal: "Start with a first grid" (Learn) and "Find a
  task or a contract" (task finder and Reference). A third card routes to Server data.
- A4. One task finder page lists "I want to ..." tasks by intent, each one link, at most 40 entries, grouped in at most
  8 intents.
- A5. One feature matrix page lists every feature with core or add-on, client or server support, and links to its guide
  and its reference.
- A6. Search stays on; titles and descriptions are written for it (P8, N1).
- A7. Prev and next links appear only in the Learn path and the Server path. Topic groups use Related.

## 6. Exceptions

An exception is a line at the top of the page's audit entry in the candidate's score file: rule number, page, reason.
A page with an exception is reviewed again at the next release. Generated pages and the changelog link are exempt from
P1 and P2.

## 7. Check mapping

| Rule | Checked by |
|---|---|
| P1, P2, P4, P8, P11 | `docs-nav-audit.mjs --check` |
| P3, P5, P6, P7, P9, P10, P12 | Reviewer or `pnpm lint` once added |
| S1 to S5, S9, S12 | `--sitemap` plus a count |
| S6 to S8, S10, S11, S13, S14 | Reviewer |
| N1, N2, N5, N6 | `--check` |
| N3, N4, N7, N8 | Reviewer and the redirect map |
| A1 to A7 | Reviewer |
