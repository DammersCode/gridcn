# Docs navigation: migration plan

Plan only. Nothing here is executed. It moves the docs to candidate A, Tasks (`candidates/c13-tasks-final.txt`). The
plan holds for B and C with other names, because the generators read the candidate file. Inputs:
[docs-navigation-ruleset.md](docs-navigation-ruleset.md), [docs-navigation-comparison.md](docs-navigation-comparison.md),
`research/docs-navigation/content-map.md`, `url-map-tasks.json`, `anchor-map-tasks.json`.

## 1. Order of work

Other sessions add server pages to the docs on `release/2.0`. A move while they write causes conflicts. Do the move in
this order:

1. Freeze point. Pick the commit where the 2.0 server docs are complete. Rerun the generators from it.
2. Spike (half a day). Verify the three open points of section 2, then add the `type` field and the moves file.
3. Skeleton PR. `git mv` every page to its new path, write the group folders, `meta.json` files, landings, redirects, and the
   link codemod. No text changes except links. The site builds and every old URL redirects.
4. Split PRs, one per old page that splits (29 pages, listed in section 4). Each PR cuts the text along the content map.
5. New-text PRs: the pages of section 5.
6. Polish PR: lengths, descriptions, Related sections, and the audit gate.

Gates for every PR: `pnpm types:check`, `pnpm lint`, `pnpm build`, `pnpm docs:changes --check`, and the audit script
(`node scripts/docs-nav-audit.mjs --check`). A page above its hard cap fails the audit once the gate is on. Turn the gate
on in the polish PR, not before.

## 2. Folder layout and `meta.json`

The generators give every page the URL `/docs/<group>/<page>`. The area is invisible in the URL. Areas are root folders in
parentheses, which Fumadocs leaves out of the URL. A trial page confirmed that `content/docs/(area)/page.mdx` serves
`/docs/page` and that the area appears as a sidebar tab when its `meta.json` has `"root": true`.

```text
content/docs/
  meta.json                      {"pages": ["(learn)", "(how-to)", "(server)", "(evaluate)", "(reference)", "(examples)"]}
  (learn)/meta.json              {"title": "Learn", "icon": "Sparkles", "root": true, "pages": ["learning-path", "look-things-up", "try-and-automate"]}
  (learn)/learning-path/meta.json  {"title": "Learning path", "pages": ["index", "install", "render-your-first-grid", ...]}
  (how-to)/sort-and-filter/sort-rows.mdx
  (server)/pages-mode/load-rows-by-page.mdx
  (evaluate)/performance/index.mdx          -> /docs/performance
  (evaluate)/performance/benchmark-results.mdx
  (evaluate)/performance/run-it-yourself.mdx
```

- A group is a folder with `index.mdx` (the landing, first in its sidebar group) and a `meta.json` that lists its pages in
  order. A closed group needs `"defaultOpen": false`, which is the default.
- A group in the Examples area has one landing each, so third-level folders are not used.
- Page type goes in frontmatter: `type: landing | feature | concept | task | step | reference | example | cheatsheet`.
  `source.config.ts` needs one line in the page schema: `type: z.enum([...]).optional()`. Only then the audit reads it.
- Slugs are the kebab-case of the title (rule N5). The URL map is generated, so this holds.
- Open points for the spike: (a) the home `/docs` is the first page of the Learning path group. The page would be
  `content/docs/index.mdx`, which sits outside the area folder; check that the sidebar still places it first in the group.
  (b) Fumadocs `defaultOpen` and the "current group open" behavior with ten groups per area. (c) The custom sidebar
  components in `components/docs-sidebar.tsx` must show folder landings as links. They already do for folders with an
  `index`.

## 3. Redirects

`next.config.mjs` `redirects()` keeps its two entries (re-pointed to the new URLs) and gains one permanent entry per old
URL that changes: 97 of 100 pages. `/docs`, `/docs/performance`, and `/docs/accessibility` keep their URLs (the home is the landing of the Learning path group). Generate the list from
`url-map-tasks.json`:

```js
{ source: "/docs/editing-cell-types", destination: "/docs/edit-data", permanent: true },
```

- Split pages redirect to the landing of the new group, or to the page that keeps the old name. Example:
  `/docs/styling-theming` goes to `/docs/style-and-translate`.
- The raw-markdown endpoint `/docs/<page>.md` needs the same redirect list with `.md` appended. The rewrite
  `/docs/:path*.md` stays.
- `app/sitemap.ts` reads the page tree. It needs no change.
- Keep the redirects for at least one major version. They cost nothing and external links outlive the docs.
- Fragments survive a redirect, so `/docs/columns#reorder` arrives at `/docs/columns-and-layout#reorder`. Section 6 covers
  anchors that left the page.

## 4. Pages that split

29 old pages become 2 to 10 new pages each. The full list is in `url-map-tasks.json` (field `split`). The largest:

| Old page | Becomes |
|---|---|
| `api-reference` | 10 pages: component props, provider, column definition, labels, types, engine, add-on options, store hooks |
| `events-state` | 10 pages: events index and six event pages, the shapes page, the timing table |
| `lazy-loading` | 6 pages: usage, no total, errors, retention, sort and filter, selection and export |
| `selection-keyboard` | 6 pages: selection model, pointer, checked rows, keyboard, server selection |
| `styling-theming` | 6 pages: tokens, class and data surface, overrides, density, loading, labels |
| `data-modes` | the matrix page and the troubleshooting task; the matrix becomes one data file with generated views |
| `editing-cell-types` | 5 pages: activation, built-in types, validation, server errors, display override |
| `quick-start` | 8 pages: first grid and the learning steps |
| `project-status` | version policy, support matrix, upgrade, changelog link, support and security |

Rules for a split PR:

- Cut along the H2 sections named in the content map. Move text; edit only the links and the first paragraph.
- Keep each H2 heading text unchanged so its anchor survives (section 6).
- Each new page gets `type`, `description`, and a Related section (rules P7, P8).
- Move the `<NewBadge />` with its section.

Pages that merge: `custom-cell-types` (contract goes to the CellType contract page), `i18n` and the i18n section of
`styling-theming`, and the sort-list add-on page keeps its own page.

## 5. New text

23 pages have no source today. Each needs a short spec in `research/` when it adds behavior (AGENTS.md workflow):

| Page | Note |
|---|---|
| Resolve save conflicts | Neither the library nor the docs have a conflict feature. Write it as a user-side pattern on `onDataChange`, with a demo or a test |
| Plugin contract, Plugin events, Styling model | Source sections exist inside `plugins` and `styling-theming`; the contract page is new |
| Server rows contract | Draws on the server-side recipe and the lazy-loading pages |
| Fix install problems | Pulls the Vite alias, Verify, and TooltipProvider text out of `installation` |
| Find a task, Feature matrix | The matrix is generated from one data file (see the parity matrix) |
| Changelog, Support and security | Pages that link `CHANGELOG.md` and `SECURITY.md` |
| Benchmark results, Run it yourself | Written by the `perf-docs` session under `content/docs/performance/` |
| 13 Add-on options pages | Option tables move out of the add-on pages; generate them from the types where possible |
| 29 group landings | One sentence per child page |

## 6. Anchors

Old pages have 419 H2 anchors. 103 distinct anchored links exist today (176 uses) in `content/docs`, `app`, `lib`, and the
skills. Three layers:

1. Codemod. A script rewrites every internal `/docs/...` link and anchor in `content/docs`, `app`, `components`, `lib`,
   `skills`, `README.md`, and `registry.json` from the URL map and the anchor map. This removes the need for any runtime
   redirect inside the repo (595 links in `content/docs` alone).
2. Anchor map. `anchor-map-tasks.json` maps each old heading slug to its new URL and anchor: 121 sections are mapped by the
   content map; 298 fall back to the page target and are correct for pages that moved whole. 58 anchors of split pages
   have no target yet (`anchors-needing-review.txt`). Assign each by hand in the split PRs.
3. Runtime fallback for outside links. A small client component in the docs layout reads `location.hash` on load. When no
   element has that id and the anchor map has the hash, it calls `router.replace(newUrl)`. The map ships as a JSON of
   about 20 KB.

Stable-anchor rule: a heading keeps its text in a split, so its anchor does not change. Numbered anchors in `events-state`
(`#1-ondatachange--the-flagship-shape` and the other explicit ids) keep their `[#id]` suffix on the new pages.

## 7. Files that reference the old URLs

| File | What to change |
|---|---|
| `lib/llms-tasks.ts` | 12 intents with `slug` and `anchor`. The `llms.txt` route fails the build when a page or anchor is missing. Update each entry to its new page |
| `app/llms.txt/route.ts` | Static lines for add-ons, project status, license |
| `skills/gridcn-addons/SKILL.md` | 11 doc URLs (every add-on page). Rewrite from the URL map |
| `skills/gridcn-performance/SKILL.md` | 6 URLs |
| `skills/gridcn-data-source/SKILL.md` | 4 URLs; the server pages move most |
| `skills/gridcn-upgrade/SKILL.md` | 2 URLs |
| `skills/gridcn-custom-cell-type/SKILL.md` | 1 URL (the worked example) |
| `skills-lock.json` | Hashes of the skills; refresh after the edits |
| `content/docs/agent-skills.mdx` | Skill descriptions that name docs pages |
| `app/(home)/page.tsx` | Feature card links (performance, quick-start, styling, streaming, i18n, add-ons) |
| `registry.json` | The `docs` field points to `/docs/quick-start` |
| `components/manual-install.tsx`, `README.md`, `DEVELOPMENT.md` | Install and docs links |
| `app/api/search/route.ts` | Check for hard-coded paths |
| `registry/default/examples/*` | Two demos link docs pages. A registry change rebuilds `public/r` and follows the registry rules; do it in its own commit, never from this plan |
| `AGENTS.md` | "Component and addon page structure" describes one page per add-on with props tables. In a task-first tree the options move to the Add-on options reference. Amend the rule, add the page types |
| `CHANGELOG.md` | One line under `Unreleased`: docs moved; old URLs redirect |

Skills stay in sync: after the skeleton PR, a reviewer opens each skill and checks that every URL resolves and every
claim about "where to look" is still true.

## 8. `content/docs-changes.json`

The file keys are page paths, and the sidebar dots read them. A move changes every path, so against the baseline (the last
1.x tag for 2.0.0) every page looks `new`. A dot on every page tells the reader nothing.

Plan:

- Add `content/docs-moves.json`: `{ "<new path>": ["<old path>", ...] }`, generated from the URL map.
- Teach `scripts/docs-changes.mjs` to compare a moved page with the concatenated baseline text of its old pages. A page
  whose text changed in substance is `updated`; an unchanged moved page has no marker; a page with no old source is `new`.
- Keep the key format. With area folders in parentheses, a path key contains the folder, for example
  `(how-to)/sort-and-filter/sort-rows.mdx`. The plugin in `lib/source.tsx` must strip the parentheses folder the same way the
  generator does. Check it in the spike.
- `pnpm lint` compares the committed file with the tagged release (`docs:changes --check`). The release commit
  regenerates it (`pnpm docs:changes --release 2.0.0`), as the docs rules say.
- Page dots appear when the release command runs, not in the move commits.

## 9. Risks

| Risk | Mitigation |
|---|---|
| 200 pages roughly double the maintenance | The rules cap page length; add-on options pages are generated; landings are one line per child |
| Link rot inside the repo | The codemod plus the existing build checks (`llms-tasks`, `types:check`); add a link checker to the polish PR |
| Merge conflicts with the 2.0 server wave | Section 1 freeze point; new pages from other sessions get a row in the content map and the generators rerun |
| Reviewer noise in the scores | Scores differ by up to 0.5 for the same candidate; do not tune the tree to a single run |
| Sidebar with ten closed groups feels hidden | The area landing lists groups; test with the Fumadocs sidebar before the skeleton PR |

## 10. Verification checklist

- Every old URL answers 308 with the target in `url-map-tasks.json` (script it).
- Every old anchor of a moved section lands on its new page (spot check the 58 manual ones).
- `llms.txt` builds; every task link resolves.
- The audit script passes (`--check`).
- The candidate check passes (`--candidate` on the final file).
- Each skill file reads correctly after the rewrite.
- `docs:changes` shows dots only on pages whose text changed.
