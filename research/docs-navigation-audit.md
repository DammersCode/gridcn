# Docs navigation audit (release/2.0, 2026-11-04)

The current docs against [docs-navigation-ruleset.md](docs-navigation-ruleset.md). Re-run with
`node scripts/docs-nav-audit.mjs --check` (pages) and `--sitemap` (tree). Page data: `research/docs-navigation/`.

## Totals

| Measure | Value | Rule |
|---|---|---|
| Pages | 100 (75k words) | |
| Pages failing a page rule | 37 | P1, P2, N2 |
| Pages above 8 screens | 16 (213 screens together) | P1 |
| Pages under 250 words | 46 (mostly example pages) | fine for Example pages |
| Sidebar areas | 1 | S1 wants 4 to 6 |
| Root groups | 10 separators, 45 root pages | S2 wants 4 to 10 groups per area |
| Rows visible at load | about 54 (10 separators, 45 pages, open folders) | S5 allows 25 |
| Largest group | Add-ons, 11 pages | S3 target 7, cap 12 |
| One-page group | Hooks (1 page) | S9, S13 |
| Group labels without scent | "Architecture", "Reference" holding Recipes, Project status, License | S13 |
| Depth | 4 (Examples > Data > Lazy > page) | S4 wants 2, third level only in Reference, Recipes, and Examples |
| Groups with a landing page | 2 of 10 (Examples and Recipes folders) | S7 |
| Duplicate titles | 10 pages (Pinning x2, Row operations x2, Custom cell type x2, TanStack Query x2, SWR x2) | N2 |
| Pages without a Related or Next link | 52 of 100 (pilot count) | P7 |
| Task finder, feature matrix | none; `data-modes` covers only the server matrix | A4, A5 |

## Worst offenders, ranked by screens

| # | Page | Words | Screens | H2 | Rules broken | What the page mixes |
|---|---|---|---|---|---|---|
| 1 | `styling-theming` | 4,162 | 22.7 | 13 | P1 P2 | tokens, density, row height, loading state, i18n, themes in one page; radius not documented |
| 2 | `custom-cell-types` | 3,508 | 19.3 | 5 | P1 P4 | one 850-word run; tutorial, contract, and examples |
| 3 | `events-state` | 3,726 | 17.6 | 15 | P1 P2 | 15 callbacks and state topics; numbered anchors with six inbound links |
| 4 | `editing-cell-types` | 2,701 | 15.9 | 7 | P1 P2 | every built-in type, async paste, bulk paths |
| 5 | `lazy-loading` | 2,733 | 15.8 | 8 | P1 P2 | modes, fetching, failure, 500-word run |
| 6 | `selection-keyboard` | 2,843 | 14.3 | 14 | P1 P2 | selection model, shortcuts, mouse and touch |
| 7 | `columns` | 2,393 | 13.9 | 9 | P1 P2 | definitions, sizing, pinning, reorder, groups, visibility |
| 8 | `addons/import-export` | 2,626 | 13.5 | 7 | P1 P2 | two add-on concerns on one page |
| 9 | `row-operations` | 2,274 | 12.9 | 8 | P1 P2 N2 | insert, delete, reorder, bulk, undo |
| 10 | `api-reference` | 2,937 | 12.5 | 8 | P1 | curated subset; no per-symbol URL |
| 11 | `plugins` | 2,172 | 11.0 | 11 | P1 P2 | |
| 12 | `addons/toolbar` | 1,521 | 9.6 | 5 | P1 P4 | |
| 13 | `sorting-filtering-search` | 1,928 | 9.1 | 6 | P1 | client mode and controlled (server) mode |
| 14 | `pagination` | 1,267 | 9.0 | 1 | P1 P2 | one H2, hand-written fetch, no link to the one-hook path |
| 15 | `accessibility` | 1,865 | 8.1 | 8 | P1 P2 | |
| 16 | `addons/url-state` | 1,380 | 8.1 | 5 | P1 | |

Also failing P2 only: `addons/undo-redo`, `addons/presence`, `addons/context-menu`, `addons/fill`, `streaming-updates`,
`addons/find-replace`, `installation`, `agent-skills`. Task pages over budget: `recipes/data-fetching/server-side`
(13 H2), `recipes/data-fetching/server-round-trip`, `examples/data/server-side`.

## Structure defects (from the pilot and the sitemap)

1. One area holds everything. Learning, task, add-on, and reference pages share one 54-row list (S1, S5).
2. Server data is in four places: Rows & data, Examples > Data & Integrations, Reference > Recipes > Data fetching, and
   the controlled-mode part of Sorting, filtering & search. `pagination` teaches a hand-written fetch while the one-hook
   path sits in Recipes (P6, S10).
3. Groups hide topics: Accessibility and Performance under "Architecture"; Recipes, Project status, License under
   "Reference"; Toolbar and Sort list outside Add-ons; "Search, sort & rows" overlaps "Rows & data" (S13, S10).
4. Start path: Introduction offers Installation and Quick start as equal first steps; prerequisites sit in the third
   H2 of Installation and Quick start omits them (S12, A3).
5. Contradicting facts: row ceiling (about 1M on Performance and Project status, 490k to 930k on Virtualization);
   "pre-1.0" on Introduction against 1.0.0 on Project status with tags at 1.3.0; undo behavior on refused saves differs
   between `data-modes` and `addons/undo-redo`; paste rejection differs between `clipboard` and `editing-cell-types`
   (P6).
6. `/docs/addons` index exists but is not in the sidebar.
7. 2.0 adds server pages to groups that already break their caps (S14).

## Baseline score

Four reviewer runs on the current navigation (run files in `scores.json`, method in the scoring file): beginner 5.13, mid 5.13, senior 5.13 and 5.25.
Baseline overall: 5.16 (beginner 5.13, senior 5.19). Weakest dimensions, mean of the beginner and senior runs: Growth
resilience 4.0, Consistency 4.5, Cognitive load 4.5, Learning path 4.75. Strongest: First-success time 6.5, Findability 6.0.
