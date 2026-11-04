# Docs navigation audit (release/2.0, 2026-11-04)

The current docs against [docs-navigation-ruleset.md](docs-navigation-ruleset.md). Re-run with
`node scripts/docs-nav-audit.mjs --check` (pages) and `--sitemap` (tree). Page data: `research/docs-navigation/`.

## Totals

| Measure | Value | Rule |
|---|---|---|
| Pages | 100 (77k words) | |
| Pages failing a page rule | 39 | P1, P2, N2 |
| Pages above 8 screens | 17 (223 screens together) | P1 |
| Pages under 250 words | 44 (mostly example pages) | fine for Task pages |
| Sidebar areas | 1 | S1 wants 4 to 6 |
| Root groups | 10 separators, 45 root pages | S2 wants 4 to 8 groups per area |
| Rows visible at load | about 54 (10 separators, 45 pages, open folders) | S5 allows 35 |
| Largest group | Add-ons, 11 pages | S3 target 7, cap 12 |
| One-page group | Hooks (1 page) | S9, S13 |
| Group labels without scent | "Architecture", "Reference" holding Recipes, Project status, License | S13 |
| Depth | 4 (Examples > Data > Lazy > page) | S4 wants 2, third level only in Reference and Recipes |
| Groups with a landing page | 2 of 10 (Examples and Recipes folders) | S7 |
| Duplicate titles | 10 pages (Pinning x2, Row operations x2, Custom cell type x3, TanStack Query x2, SWR x2) | N2 |
| Pages without a Related or Next link | 52 of 100 (pilot count) | P7 |
| Task finder, feature matrix | none; `data-modes` covers only the server matrix | A4, A5 |

## Worst offenders, ranked by screens

| # | Page | Words | Screens | H2 | Rules broken | What the page mixes |
|---|---|---|---|---|---|---|
| 1 | `styling-theming` | 4,186 | 22.8 | 13 | P1 P2 | tokens, density, row height, loading state, i18n, themes in one page; radius not documented |
| 2 | `custom-cell-types` | 3,541 | 19.4 | 5 | P1 P4 | one 850-word run; tutorial, contract, and examples |
| 3 | `events-state` | 3,745 | 17.6 | 15 | P1 P2 | 15 callbacks and state topics; numbered anchors with six inbound links |
| 4 | `editing-cell-types` | 2,723 | 16.0 | 7 | P1 P2 | every built-in type, async paste, bulk paths |
| 5 | `lazy-loading` | 2,755 | 15.8 | 8 | P1 P2 | modes, fetching, failure, 500-word run |
| 6 | `selection-keyboard` | 2,860 | 14.4 | 14 | P1 P2 | selection model, shortcuts, mouse and touch |
| 7 | `columns` | 2,404 | 14.0 | 9 | P1 P2 | definitions, sizing, pinning, reorder, groups, visibility |
| 8 | `addons/import-export` | 2,644 | 13.6 | 7 | P1 P2 | two add-on concerns on one page |
| 9 | `row-operations` | 2,297 | 13.0 | 8 | P1 P2 N2 | insert, delete, reorder, bulk, undo |
| 10 | `api-reference` | 2,950 | 12.6 | 8 | P1 | curated subset; no per-symbol URL |
| 11 | `plugins` | 2,196 | 11.1 | 11 | P1 P2 | |
| 12 | `addons/toolbar` | 1,547 | 9.7 | 5 | P1 P4 | |
| 13 | `sorting-filtering-search` | 1,956 | 9.2 | 6 | P1 | client mode and controlled (server) mode |
| 14 | `pagination` | 1,267 | 9.0 | 1 | P1 P2 | one H2, hand-written fetch, no link to the one-hook path |
| 15 | `accessibility` | 1,886 | 8.2 | 8 | P1 P2 | |
| 16 | `addons/url-state` | 1,399 | 8.2 | 5 | P1 | |
| 17 | `addons/undo-redo` | 1,389 | 8.1 | 11 | P1 P2 | |

Also failing P2 only: `addons/presence`, `addons/context-menu`, `addons/fill`, `streaming-updates`,
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

Four Opus runs on the current navigation (details in the scoring file): beginner 5.13, mid 5.13, senior 5.13 and 5.25.
Baseline overall: 5.16. Weakest dimensions: Growth resilience 4.0, Consistency 4.0, Learning path 4.5, Cognitive load 5.0.
Strongest: First-success time 7.0, Findability 6.0.
