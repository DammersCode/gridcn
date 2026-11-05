# Docs navigation: migration plan

Plan only. Nothing here is executed. It moves the docs to candidate A, Topics (`candidates/c19-topics-v4.txt`). The
generators read the candidate file. Candidates B and C need their own content-map rows, because the map lists the slugs of the current candidate. Inputs:
[docs-navigation-ruleset.md](docs-navigation-ruleset.md), [docs-navigation-comparison.md](docs-navigation-comparison.md),
`research/docs-navigation/content-map.md`, `url-map.json`, `anchor-map.json`.

## 0. Decisions

The owner decided:

- One navigation: Topics (candidate A). Tasks stay reachable through the task finder and the Learning path. No second
  navigation is kept.
- The page count does not limit the design. A split is fine when the rules say so.
- The glossary stays small. Common words such as keyboard shortcuts get no entry.
- `AGENTS.md` may change. It already points to the ruleset and the audit script. The add-on page structure rule changes in
  the skeleton PR (option tables move to the Add-on options pages).
- Areas: six (Learn, Build, Server, Evaluate, Reference, Examples). The ruleset allows 4 to 6 with a cap of 7. Six keeps
  each area under 10 groups and under 25 visible rows, and the Evaluate tab paid off in the senior reviews.
- The defects of the audit are fixed during the migration (section 9).

## 1. Order of work

Other sessions add server pages to the docs on `release/2.0`. A move while they write causes conflicts. Do the move in
this order:

1. Freeze point. Pick the commit where the 2.0 server docs are complete. Rerun the generators from it.
2. Spike (half a day). Verify the three open points of section 2, then add the `type` field and the moves file.
3. Skeleton PR. `git mv` every page to its new path, write the group folders, `meta.json` files, landings, redirects, and the
   link codemod. No text changes except links. The site builds and every old URL redirects.
4. Split PRs, one per old page that splits (31 pages, listed in `url-map.json`, field `split`). Each PR cuts the text along the content map.
5. New-text PRs: the pages of section 5.
6. Polish PR: lengths, descriptions, Related sections, and the audit gate.

Gates for every PR: the gate list in `AGENTS.md` (types, lint, typed lint, tests, build). `pnpm docs:changes --check` runs
inside `pnpm lint`. The skeleton PR also touches `registry.json`, so it needs the registry steps of that list (section 7).
The audit script (`node scripts/docs-nav-audit.mjs --check`) joins the gates in the polish PR. Before that, a page above its
hard cap would fail every PR.

One defect exists at HEAD: `lib/llms-tasks.ts` points to `#sorting-a-lazy-grid`, but the heading in
`content/docs/lazy-loading.mdx` is "Sorting a scroll grid". The static `llms.txt` route throws on a missing anchor. Fix the
entry in a separate commit before the skeleton PR.

## 2. Folder layout and `meta.json`

The generators give every page the URL `/docs/<group>/<page>`. The area is invisible in the URL. Areas are root folders in
parentheses, which Fumadocs leaves out of the URL. A trial page confirmed that `content/docs/(area)/page.mdx` serves
`/docs/page` and that the area appears as a sidebar tab when its `meta.json` has `"root": true`.

```text
content/docs/
  meta.json                      {"pages": ["(learn)", "(build)", "(server)", "(evaluate)", "(reference)", "(examples)"]}
  (learn)/meta.json              {"title": "Learn", "icon": "Sparkles", "root": true, "pages": ["learning-path", "server-path", "help", "try-automate"]}
  (learn)/learning-path/meta.json  {"title": "Learning path", "pages": ["install-gridcn", "render-first-grid", ...]}
  (build)/sort-filter-search/sorting.mdx   -> /docs/sort-filter-search/sorting
  (server)/pages-mode/load-rows-page.mdx   -> /docs/pages-mode/load-rows-page
  (evaluate)/performance/index.mdx          -> /docs/performance
  (evaluate)/performance/benchmark-results.mdx
  (evaluate)/performance/run-it-yourself.mdx
```

- A group is a folder with `index.mdx` (the landing, first in its sidebar group) and a `meta.json` that lists its pages in
  order. A closed group needs `"defaultOpen": false`, which is the default.
- A group in the Examples area has one landing each. One third-level folder exists: the ORM examples inside "Server and data examples", with its own landing at `/docs/server-data-examples/orm-examples`.
- Page type goes in frontmatter: `type: landing | feature | concept | task | step | reference | example | cheatsheet`.
  `source.config.ts` uses the plain `pageSchema`. It needs `pageSchema.extend({ type: z.enum([...]).optional() })` and a zod
  import, so that Fumadocs accepts the field. The audit script reads `type:` with a regex and works without the schema.
- Slugs are the first four words of the kebab-case title without stop words (rule N5). The URL map is generated from the titles.
- Open points for the spike: (a) the home `/docs` is the landing of the Learning path group. The page is `content/docs/index.mdx`, outside the
  area folder. Check that the sidebar places it first in that group, and keep the group landing from needing a second
  `index.mdx`.
  (b) Fumadocs `defaultOpen` and the "current group open" behavior with ten groups per area. (c) The custom sidebar
  components in `components/docs-sidebar.tsx` must show folder landings as links. They already do for folders with an
  `index`.

## 3. Redirects

`next.config.mjs` `redirects()` keeps its two entries (re-pointed to the new URLs) and gains one permanent entry per old
URL that changes: 93 of 100 pages. `/docs`, `/docs/performance`, `/docs/accessibility`, `/docs/columns`, `/docs/events-state`, `/docs/plugins`, and `/docs/data-modes` keep their URLs: the new landing of a group is served there, so these pages must not redirect away. The generator fails when a redirect hides a new page. Generate the list from
`url-map.json`:

```js
{ source: "/docs/editing-cell-types", destination: "/docs/editing-cells", permanent: true },
```

- Split pages redirect to the landing of the new group, or to the page that keeps the old name. Example:
  `/docs/styling-theming` goes to `/docs/theme-style-language`.
- The raw-markdown endpoint `/docs/<page>.md` needs the same redirect list with `.md` appended. The rewrite
  `/docs/:path*.md` stays.
- `app/sitemap.ts` reads the page tree. It needs no change.
- Keep the redirects for at least one major version. They cost nothing and external links outlive the docs.
- Fragments survive a redirect, so `/docs/editing-cell-types#validation` arrives at `/docs/editing-cells#validation`, and the anchor map sends it on to `/docs/editing-cells/validation`. Section 6 covers
  anchors that left the page.

## 4. Pages that split

31 old pages become 2 to 23 new pages each. The full list is in `url-map.json` (field `split`). The largest:

| Old page | Becomes |
|---|---|
| `api-reference` | 15 pages: the props pages (component, provider, column definition, labels), types, engine, store hooks, the CellType contract, a props cheatsheet, and five add-on options pages |
| `events-state` | 10 pages: the events index, four event pages, the shapes concept page, the save page, the presence options, and an events cheatsheet |
| `lazy-loading` | 8 pages: scroll index, usage, errors, retention, sort and filter, no row count, server selection, troubleshooting |
| `styling-theming` | 8 pages: theme landing, tokens, style contract, styling concept, overrides, density, loading, labels |
| `quick-start` | 7 pages: first grid and six learning steps |
| `selection-keyboard` | 7 pages: selection landing, selection model, pointer, checked rows, keyboard, server selection, shortcuts cheatsheet |
| `editing-cell-types` | 6 pages: landing, activation, built-in types, validation, server errors, display override |
| `plugins` | 6 pages: extend landing, plugin contract, shape, overlays, events, example |
| `data-modes` | 6 pages: the matrix, the server index, server row operations, saving, troubleshooting, and the feature matrix; the matrix becomes one data file with generated views |
| `project-status` | 5 pages: version policy and changelog, row limits, browser support, upgrade, security policy |
| `hooks/use-debounce` | 3 pages in Reference > Types and hooks: `useDebounce`, `useDebouncedInput`, `isComposingKey`. The anchors `#usedebouncedinput` and `#iscomposingkey` move to their own pages |

Rules for a split PR:

- Cut along the H2 sections named in the content map. Move text; edit only the links and the first paragraph.
- Keep each H2 heading text unchanged so its anchor survives (section 6).
- Each new page gets `type`, `description`, and a Related section (rules P7, P8).
- Move the `<NewBadge />` with its section.

Pages that merge: `custom-cell-types` (contract goes to the CellType contract page), `i18n` and the i18n section of
`styling-theming`, and the sort-list add-on page keeps its own page.

## 5. New text

8 pages have no source today: the five Server path steps, the two benchmark pages (written by the `perf-docs` session under `content/docs/performance/`), and the plugin contract. 15 landings hold one line per child. Six option pages are built from existing option tables. A page that adds behavior needs a short spec in `research/` (AGENTS.md workflow):

| Page | Note |
|---|---|
| Handle refused saves | The server-round-trip recipe already holds the acknowledge-each-change strategy. The page covers refused saves in that vocabulary and needs a demo or a test |
| Plugin contract | New. `plugins-shape` keeps the model; the contract page lists the API |
| Server rows contract | Has a source (the server-side recipe and the lazy-loading pages) but needs a rewrite as a contract |
| Server path steps | Five short steps that link the Server tasks and do not repeat them |
| Fix install problems | Pulls the Vite alias, Verify, and TooltipProvider text out of `installation` |
| Task finder, Feature matrix | Built from the index pages. The matrix is generated from one data file (see the parity matrix) |
| Benchmark results, Run it yourself | Written by the `perf-docs` session |
| Add-on options pages | Option tables move out of the add-on pages. Generate them from the types |

## 6. Anchors

Old pages have 537 H2 and H3 anchors. About 100 distinct anchored links exist today (about 175 uses) in `content/docs`, `app`, `lib`,
and the skills. Regenerate these counts at the freeze point. Three layers:

1. Codemod. A script rewrites every internal `/docs/...` link and anchor in `content/docs`, `app`, `components`, `lib`,
   `skills`, `README.md`, `GLOSSARY.md`, `research/parity-matrix.json`, and `registry.json` from the URL map and the anchor
   map. It also rewrites the about 50 same-page links (`](#anchor)`) of split pages. After it runs, no link inside the repo
   needs a runtime redirect (595 links in `content/docs` alone).
2. Anchor map. `anchor-map.json` is keyed by old page URL, then by anchor id, because ids such as `usage` repeat on
   many pages. It uses the site's heading slugger and honors explicit `[#id]` ids. 226 of 537 anchors are mapped by the
   content map. The others fall back to the page target, which is correct for pages that moved whole. 79 anchors of split
   pages have no target yet (`anchors-needing-review.txt`). Assign each by hand in the split PRs.
3. Runtime fallback for outside links. A fragment survives a redirect, but the browser does not send the old path to the
   page. The build flattens the map to `{ <new page path>: { <anchor id>: <target url> } }`. A small client component in
   the docs layout reads `location.hash` and the current path on load. When no element has that id and the flat map has the
   pair, it calls `router.replace(target)`. The map ships as a JSON file of about 25 KB.

Stable-anchor rule: a heading keeps its text in a split, so its anchor does not change. Explicit ids in `events-state` (for example
`#1-ondatachange--the-flagship-shape`) keep their `[#id]` suffix on the new pages.

## 7. Files that reference the old URLs

| File | What to change |
|---|---|
| `lib/llms-tasks.ts` | 12 intents with `slug` and `anchor`. The `llms.txt` route fails the build when a page or anchor is missing. Update each entry to its new page |
| `app/llms.txt/route.ts` | Static lines for add-ons, project status, license |
| `skills/gridcn-addons/SKILL.md` | 19 distinct URL strings (every add-on page, plus placeholders). Rewrite from the URL map |
| `skills/gridcn-performance/SKILL.md` | 6 URLs |
| `skills/gridcn-data-source/SKILL.md` | 8 links to 5 pages; the server pages move most |
| `skills/gridcn-upgrade/SKILL.md` | 2 URLs |
| `skills/gridcn-custom-cell-type/SKILL.md` | 4 links, one with an anchor (`api-reference.md#celltypetdata-tvalue-toptions`), so it needs the anchor map |
| `skills-lock.json` and `public/skills/**` | The skills have a mirror under `public/skills`. `scripts/sync-skills.mjs --check` runs in `pnpm lint` and fails until the mirror and the lock match the edited skills |
| `content/docs/agent-skills.mdx` | Skill descriptions that name docs pages |
| `app/(home)/page.tsx` | Feature card links (performance, quick-start, styling, streaming, i18n, add-ons) |
| `registry.json`, `public/r/registry.json`, `public/r/data-grid.json` | The `docs` field points to `/docs/quick-start`. Changing it is a registry change: `pnpm registry:build`, `node scripts/normalize-payload-eol.mjs`, `pnpm registry:verify`, and `pnpm test:e2e-install` |
| `scripts/verify-parity.mjs` and `research/parity-matrix.json` | The script hard-codes `content/docs/data-modes.mdx`. The matrix holds 78 `content/docs/...` paths. `pnpm lint` fails after the move until both are rewritten from the URL map |
| `GLOSSARY.md` | Names `content/docs/terms.mdx` as the reader-facing subset (line 7). Update the path |
| `components/manual-install.tsx`, `README.md`, `DEVELOPMENT.md` | Install and docs links |
| `app/api/search/route.ts` | Check for hard-coded paths |
| `registry/default/examples/*` | One demo (`data-grid-custom-cell-demo.tsx`) links docs pages in JSDoc, three more name `docs/...` in comments, and `data-grid-presence-demo.tsx` names a page that does not exist. A registry change rebuilds `public/r` and follows the registry rules. Do it in its own commit, never from this plan |
| `AGENTS.md` | "Component and addon page structure" describes one page per add-on with props tables, and line 243 names the generated matrix in `content/docs/data-modes.mdx`. The options move to the Add-on options reference. Amend the rule, add the page types, and fix the path |
| `CHANGELOG.md` | One line under `Unreleased`: docs moved; old URLs redirect |

Skills stay in sync: after the skeleton PR, a reviewer opens each skill and checks that every URL resolves and every
claim about "where to look" is still true.

## 8. `content/docs-changes.json`

The file keys are page paths, and the sidebar dots read them. A move changes every path, so against the baseline (the last
1.x tag for 2.0.0) every page looks `new`. A dot on every page tells the reader nothing.

Plan:

- Add `content/docs-moves.json`: `{ "<new path>": ["<old path>", ...] }`, generated from the URL map.
- Teach `scripts/docs-changes.mjs` to compare a moved page with the old sections that the content map assigns to it, not with
  the whole old page. Compared with the whole page, every split page would differ and show `updated`. A page whose text
  changed in substance is `updated`. An unchanged moved page has no marker. A page with no old source is `new`.
- Fix the badge pass in the same change. Today it keeps every `<NewBadge />` in a file that is absent at the baseline, so
  the stale badges on moved files would never go. With the moves file, it removes the badges of sections that exist in the
  old page.
- Keep the key format. With area folders in parentheses, a path key contains the folder, for example
  `(build)/sort-filter-search/sorting.mdx`. The plugin in `lib/source.tsx` removes only the `content/docs/` prefix, and
  `docs-changes.mjs` keys by the raw path, so both already agree. Check in the spike that Fumadocs passes the same path
  string to the plugin.
- `pnpm lint` compares the committed file with the tagged release (`docs:changes --check`). The release commit
  regenerates it (`pnpm docs:changes --release 2.0.0`), as the docs rules say.
- Page dots appear when the release command runs, not in the move commits.

## 9. Defects fixed during the migration

| Defect (from the audit) | Fixed in |
|---|---|
| Row ceiling stated twice with different numbers (Performance, Virtualization, Project status) | The row limits page is the only statement; the other pages link it |
| `index` says pre-1.0 while Project status says 1.0.0 and the tags are at 1.3.0 | The version policy page is the only version statement; the intro links it |
| Undo on refused saves differs between `data-modes` and `addons/undo-redo` | The server undo page owns it |
| Paste rejection differs between `clipboard` and `editing-cell-types` | The validation page owns it; the clipboard page links it |
| Ten duplicate titles (Pinning x2, Row operations x2, Custom cell type x2, TanStack Query x2, SWR x2) | The split PRs rename the second page (rule N2) |
| `/docs/addons` index exists but sits outside the sidebar | The feature matrix page replaces it |
| 52 of 100 pages end without Related or Next links | Each split PR adds them (P7) |
| Server data in four places | The Server area owns it; the recipes fold into its pages |
| `lib/llms-tasks.ts` points to a heading that was renamed | A separate commit before the skeleton PR |
| Gate failures of the docs shell (labelled `nav`, `aria-current`, text on the mobile menu control, area switcher in one tap) | Layout PR (section 9a) |

### 9a. Layout work from the gate

`research/docs-navigation/gate-results.md` lists four failed checks and one partial. The fixes sit in
`components/docs-sidebar.tsx` and the docs layout, not in the content:

- Wrap the sidebar and the "On this page" list in `nav` elements with labels.
- Set `aria-current="page"` on the active sidebar link.
- Build the group rows as a disclosure (a button with `aria-expanded`) next to the landing link.
- Give the mobile menu control a visible text label, and show the area switcher in the first tap.
- Add a browser test for the gate to the polish PR.

## 10. Risks

| Risk | Mitigation |
|---|---|
| 205 pages against 100 double the maintenance | The rules cap page length; add-on options pages are generated; landings are one line per child |
| Link rot inside the repo | The codemod plus the existing build checks (`llms-tasks`, `types:check`); add a link checker to the polish PR |
| Merge conflicts with the 2.0 server wave | Section 1 freeze point; new pages from other sessions get a row in the content map and the generators rerun |
| Reviewer noise in the scores | Runs on near-identical versions differ by 0.5 on the mean; do not tune the tree to a single run |
| Sidebar with ten closed groups feels hidden | The area landing lists groups; test with the Fumadocs sidebar before the skeleton PR |

## 11. Verification checklist

- Every old URL answers 308 with the target in `url-map.json` (script it).
- Every old anchor of a moved section lands on its new page (spot check the 79 manual ones).
- `llms.txt` builds; every task link resolves.
- The audit script passes (`--check`).
- The candidate check passes (`--candidate` on the final file).
- Each skill file reads correctly after the rewrite.
- `docs:changes` shows dots only on pages whose text changed.
