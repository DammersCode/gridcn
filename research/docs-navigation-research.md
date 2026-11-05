# Docs navigation research

Findings from usability research, style guides, and the structure of 17 large public docs sites (checked 2026-11-04). Sites
are anonymous here: Site A to Site Q. The full source list with URLs sits outside the repo. The ruleset lists the numbers that
have no external source. Feeds [docs-navigation-ruleset.md](docs-navigation-ruleset.md).

## Principles

**Reading behavior** (usability research):

- Readers read about 20 to 28 percent of the words on a page. The studied pages averaged 593 words.
- 57 percent of viewing time is above the fold, 74 percent in the first two screens, 81 percent in the first three.
- Readers scan an F shape: the first two paragraphs and the first two words of each heading carry most of the weight.
- Conclusion: an answer or demo in the first screen, and a page the reader can finish in a few screens.

**Content types** (the four-type framework: tutorial, how-to, reference, explanation; the style guides of three large
engineering organizations use the same split as enforced page templates):

- Mixing types on one page makes both worse. A guide with a props table inside it is a reference page that no one can
  find.
- Reference mirrors the product. Guides mirror the reader's goals.
- A literal four-box split can over-fragment a small product. Group by topic first, then keep all types inside the
  topic (Site D, Site F).
- Do not create empty boxes for types the product does not need.

**Page length:**

- Long pages suit reference and deep tutorials. Short linked pages suit concepts and how-tos for newcomers (technical-writing
  guidance).
- Paragraphs of 3 to 7 lines. A long page needs an on-page table of contents (a software vendor's style guide).
- No page that is only one or two sentences, and no page that is only links except a landing page (a code-hosting company's style guide).
- A style guide that enforces page templates caps the closing "What's next" list at 5 links (an orchestration project's style guide).

**Navigation shape:**

- Two disclosure levels is the practical maximum. Three click levels usually fail without shortcuts (usability research).
- "Seven items per menu" is a myth, but a shorter list scans faster. Group by meaning, not alphabet, unless the list is
  generated.
- Labels need information scent: the label predicts the page. "Architecture", "Misc", and "Advanced" predict nothing.
- Every page is page one: readers arrive from search, so each page states its own context.
- Breadcrumbs pay off only beyond depth 2. A table of contents is labeled "On this page" and highlights the current
  section.
- Learning paths work at 6 to 15 steps. Completion falls beyond 20 (a training provider's plan guidance).

## Sidebar structure of large sites

| Site | Top-level split | Depth | Group width | Pattern worth copying |
|---|---|---|---|---|
| A (framework docs) | Router switcher plus 3 sections | 4 | up to 83 in config reference | One page per function and option; linear 18-page getting-started path; "Next steps" on every page |
| B (UI library docs) | Learn / Reference | 3 | chapters 3 to 10; hooks 19 | Chapter landing pages with a card per lesson; fixed reference template (Reference, Usage, Troubleshooting) |
| C (book style) | 21 chapters | 2 | 3 to 6 sections, average 3.8 | Capstone project chapters; prev and next everywhere |
| D (web framework docs) | 4 types introduced on the front page, 13 topic groups | 2 to 3 | n/a | Topic first, type second |
| E (orchestration docs) | 6 type-based sections | 3 to 4 | n/a | Enforced templates; 5-link "What's next" |
| F (site generator docs) | 4 tabs: Tutorial, Guide, Reference, Ecosystem | 2 to 3 | guide groups 3 to 8 | Unit-based tutorial of 6 units; recipes as a group |
| G (UI compiler docs) | 4 tabs | 2 | 4 to 20 | Legacy APIs fenced in their own section |
| H (backend framework docs) | Single sidebar, 11 groups | 2 | 3 to 23 | Next steps split by use case |
| I (CSS utility docs) | Single sidebar, 18 headers | 2 | 1 to 31 | A quick-reference table opens each page |
| J (payments docs) | Use-case entry points | deep per product | n/a | Task entry before product entry |
| K (hosting docs) | Intent cards | n/a | 4 to 6 cards | Cards state outcomes, not product names |
| L (web learning path) | Getting started / Core / Extensions | 3 | modules up to about 34 items | Challenges at module end; separate from reference |
| M (data grid) | 7 groups, hundreds of pages | 4 | server rows: 16 pages | One page per server concern; reference split per object |
| N (data grid) | Product switcher, then 6 subgroups | 3 to 4 | 12 to 13 | New, Planned, and Preview badges in the sidebar; "main" vs "advanced" by maturity |
| O (table library) | Framework switcher, 16 sections | 3 | feature guides 19 | Each feature guide pairs with a same-named API page; API sections collapsed |
| P (spreadsheet grid) | 26 groups | 3 | 1 to 15; recipes about 67 | API in only 4 large pages; recipes sub-grouped by task |
| Q (component kit) | One flat alphabetical list of 66 | 1 | 66 | The failure case: no groups, no order, no path |

## How navigation fails

- **Flat component list.** 60 or more peers in one alphabetical list. A comparable library groups about 62 items into 8
  categories of at most 14.
- **Giant mixed pages.** A page of 3,000 to 4,300 words with 13 to 15 H2s mixes concept, how-to, and props. At the
  measured read rates most readers see the first quarter.
- **Single-page API reference.** The strong sites give one page per function, option, or object.
- **Too deep.** Depth 4 works only inside a reference that mirrors the product.
- **Over-fragmentation.** One-sentence pages and link-only pages cost clicks and give nothing.
- **Hidden navigation.** A collapsed group hides the page the reader wants; a hamburger menu on desktop is forgotten.
- **Vague labels.** Weak scent costs a wrong click per guess.

## Ideas used by the candidates

1. Areas as sidebar tabs (the final set is Learn, How-to, Server, Evaluate, Reference, Examples).
2. Topic first, type second, inside each area.
3. Landing page per group with one line per child.
4. A learning path of 6 to 10 steps.
5. A staged Server path, one page per server concern.
6. Fixed page templates per type, checked by a script.
7. Reference split per concern, each feature page paired with its reference page.
8. A quick-reference table at the top of feature pages.
9. Cheatsheets: shortcuts, props A to Z, events.
10. A feature matrix page: core or add-on, client or server, status.
11. A task finder page: "I want to ..." by intent.
12. Persona entry cards on the docs home.
13. Sidebar markers (new, updated, server) as text, not color only.
14. Outcome-named group labels.
15. Prev and next only where order matters.

## Not verified

- The "about 7 items per list" figure comes from mirrors of the framework page, which returned 404.
- A claim of over-fragmentation in one engineering docs set comes from a single forum comment.
- Counts taken from machine-readable indexes may differ from rendered sidebars by index pages.
