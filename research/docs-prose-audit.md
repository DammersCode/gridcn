# Docs prose & structure audit (2026-09-22)

Fleet audit (4 parallel agents) over all 27 content pages: word counts, H2/H3 density,
wall-of-text, tab-split opportunities, compression candidates, cross-page duplication.
Feeds plan 013 window 10. Line numbers refer to the pages as of 2026-09-22.

Rules distilled from the findings:

1. **Anchor safety:** Fumadocs Tabs do not auto-expand on hash navigation. Only tab H2
   sections that have **no inbound deep links** (verify per page with
   `grep -rn "docs/<page>#<anchor>" content app registry` before tabbing). `events-state`
   (§1–§9 numbered anchors, linked from 6 pages) and `recipes` (recipe anchors, linked from 4
   pages) stay FLAT.
2. **Canonical copy:** each repeated fact keeps exactly one full copy + one-line links from
   the rest (dedup map below).
3. **Compression cuts** engine internals, "why" digressions, and repetitions — never
   contracts (prop semantics, gotchas, guard conditions, caveats users hit).

## Dedup map (repeated fact → canonical home → copies to trim to links)

| Repeated fact | Canonical | Copies to trim |
|---|---|---|
| Stable-identity rule | performance.mdx | columns, styling-theming, virtualization, custom-cell-types |
| "Search never narrows viewIndex" | sorting-filtering-search.mdx L103–106 | import-export L71–72, lazy-loading L150–152 |
| Lazy vs pagination | lazy-loading.mdx L14–26 | pagination.mdx L18–28 (delete the H2 there) |
| Convenience-wrapper callout | keep once (fill-handle) | pinned-rows L44–47, multiplayer-presence L109–112 |
| cellTypes-replaces-registry callout | editing-cell-types L342–347 | custom-cell-types L305–311 |
| Full labels shape (German example) | api-reference.mdx | i18n.mdx L91–237 → representative groups only |
| "rowHeight wins over density" | styling-theming.mdx (once) | ×3 within the page (L40, L51, L262) |
| View-space `range` caveat under sort/filter | multiplayer-presence §Coordinates | ×3 within the page (L161, L223–224, L277–284) |
| `data`/`defaultData` controlled semantics | events-state.mdx | api-reference L25–30 callout, quick-start (one-liners) |
| Async paste/validation contract | editing-cell-types async section | clipboard.mdx L100–106 |
| Regression-suite verification | performance.mdx | virtualization.mdx L86–91 (delete) |
| "neither add-on for rendering perf / using both unsupported" | lazy-loading.mdx | pagination.mdx L27–28 |

## 1. Feature guides — batch A

### editing-cell-types.mdx — 2330 words, 7 H2 / 5 H3 — SPLIT+COMPRESS
- Split: 2 Tabs → **Basics**: Edit activation, Built-in cell types, Read-only, Display override
  without a new type, Custom cell types; **Validation & errors**: Validation (incl. all 4
  sub-H3s + H4 On bulk paths), Server errors.
- Compress: L44–51 (pipeline contract prose) → 2 sentences, link to
  custom-cell-types#value-pipeline; L251–263 (validateRow prose, ~130 words) → condense the
  "verdict never depends on column order" contrast to 1 sentence; L206–222 (On bulk paths
  bullets) → trim supersede/cell-keying bullets.
- Notes: cellTypes-replaces-registry Callout (L342–347) duplicates custom-cell-types L305–311
  — keep once (here), link from there.

### custom-cell-types.mdx — 2949 words, 5 H2 / 4 H3 — SPLIT+COMPRESS
- Split: 2–3 Tabs → **Contract**: The mental model, The contract member by member;
  **Checklist**: Keypoint checklist (turn its 4 H3s — Value pipeline / Rendering & performance
  / Editor UX / Typing — into an Accordion); **Example**: Worked example currency, Testing.
- Compress: L9–13 (mental model) → 1 line, it restates editing-cell-types L337 and the
  contract header; L74–110 (Value pipeline) → drop select/number/date examples repeated from
  editing-cell-types L55–59 table; L162–168 (focus-discipline bullet) → 1 sentence + link to
  editing-cell-types#edit-activation; L215–219 (BuiltinCellTypeKey internals) → delete;
  L233–235 code comment → cut.
- Notes: longest page; "search/filter = raw String(value)" caveat stated 3× here + 1× in
  editing-cell-types — canonical statement belongs here only.

### overlay-plugins.mdx — 1668 words, 6 H2 / 3 H3 — COMPRESS
- Split: n/a (6 H2s scan fine; the L7–88 block with its 3 H3s stays).
- Compress: L45–53 (When it re-renders) → 1–2 sentences: "a plugin's state re-renders only
  the overlay layer, never rows/cells" — drop Zustand fiber/render-count probe internals;
  L16–28 (intro) → cut presence/fill "neither knows the other exists" narrative to 1 line;
  L57–88 (ctx fields) → strip the "each field exists because a built-in overlay needed it"
  why-clauses, keep usage rules only.
- Notes: page is for plugin authors, not general wiring — compress only where it leaks engine
  internals, keep the ctx contract intact.

### selection-keyboard.mdx — 919 words, 7 H2 / 2 H3 — SPLIT
- Split: 2 Tabs → **Mouse**: Selection model, Mouse gestures, Configurability, Header click
  behavior; **Keyboard**: Keyboard map (incl. H3s Show this table at runtime, Remapping),
  Two-stage Ctrl+A.
- Compress: L159–166 (Accessibility H2) → demote to a 1-line Callout after the keyboard tab
  (stub pointer, not a section); L144–150 (editReplace remapping) → condense, type-to-replace
  default already covered in editing-cell-types#edit-activation.
- Notes: "Focus never gets lost when the active cell scrolls out" (L163) repeats
  accessibility.mdx L45–46 — keep in accessibility only.

### row-operations.mdx — 962 words, 5 H2 / 0 H3 — KEEP
- Split: n/a.
- Compress: L54–59 (reorder no-op conditions, ~80 words) → move into a warn Callout;
  L90–93 (surfaces with no menu) → 2 lines.
- Notes: already table-heavy and short; no duplication spotted.

### streaming-updates.mdx — 969 words, 6 H2 / 0 H3 — KEEP
- Split: n/a.
- Compress: L102–104 (demo auto-sort walkthrough) → 1 sentence; L106–108 (defer vs immediate
  guidance) → merge into the reorder table as a third column note.
- Notes: benchmark table (L93–100) is the one concrete asset — keep.

### accessibility.mdx — 1305 words, 5 H2 / 7 H3 — SPLIT+COMPRESS
- Split: inside "What the grid implements" (7 H3s, all prose) → 3 Tabs: **Semantics** (Grid
  semantics, aria index and count model, Roving tabindex); **Selection & editor** (Selection
  announcement, Editor focus, aria-busy and loading); **Live regions** (Toolbar and sort-list
  live regions).
- Compress: L105–112 (test matrix) → drop the quoted test-name strings, one line per area +
  file name; L114–122 (axe Callout) → trim; L96–99 (Keyboard coverage) → 1 sentence, it's a
  stub.
- Notes: no code blocks at all — the 7-H3 prose run is the wall-of-text; the tabs fix it.

## 2. Feature guides — batch B

### clipboard.mdx — 670 words, 5 H2 / 0 H3 — KEEP
- Split: n/a (short page; 5 H2s are each a coherent unit).
- Compress: L31–35 → condense "small state machine, not a naive split(...)" internals to one
  clause ("parses quoted TSV, including tabs/newlines/quotes inside quoted cells");
  L100–106 async-schema callout → 2 sentences (drop "32 cells at a time" and "supersedes" —
  full contract already lives in the linked editing-cell-types page).
- Notes: async-paste contract overlaps editing-cell-types (already cross-referenced; only
  trim the local detail).

### columns.mdx — 2050 words, 8 H2 / 3 H3 — SPLIT+COMPRESS
- Split: **Basics** (Resize, Reorder, Visibility) / **Pin & headers** (Pin left/right +
  Persistent pin indicator, Custom headers) / **Row markers** (Row markers + Custom markers) /
  **Layout & state** (Flex fill, Reading column state + Persisting a user's layout).
- Compress: L69–76 → condense shadow mechanics to 1 sentence; L297–301 flex edge-case prose →
  2 sentences; L336–342 → "defaultColumnLayout is not a controlled prop" stated 3×, condense
  to 2 sentences; L344–360 → cut the generic-param note to one line.
- Notes: stable-identity rule restated at L274–276 (canonical copy is performance);
  layout-payload semantics duplicated in events-state (cross-linked, fine).

### styling-theming.mdx — 1912 words, 9 H2 / 3 H3 — SPLIT+COMPRESS
- Split: **CSS** (Data-attribute contract, CSS variables, Custom classes, Styling by state
  with CSS only) / **Programmatic** (Programmatic per-row/per-cell styling + its 3 H3s) /
  **Density & loading** (Density and row height, Loading state) / **Reference** (i18n via
  labels, Visual defaults).
- Compress: L74–78 → precedence explained 3×, keep 1 sentence; L117–131 HR-demo bullets →
  drop the "Reach for this when…" clauses (~halve); L164–177 "Styling whole rows" → delete,
  subsumed by "Fully styling a column or row" (L179–214); L244–245 → delete (repeats section
  intro L218–221).
- Notes: "rowHeight wins over density" ×3 (L40, L51, L262); stable-identity callout
  L133–140 duplicates the performance page's — keep here, cut the engine-memoization detail to
  one line.

### i18n.mdx — 1635 words, 5 H2 / 4 H3 — SPLIT+COMPRESS
- Split: **Getting started** (The labels prop + Deep merging + Reading effective labels,
  Coverage by group) / **Full example** (Full German example) / **Advanced** (Wiring a real
  i18n library, RTL layout + What mirrors + Base UI chrome).
- Compress: L328–336 "Base UI chrome" → 2 sentences; L322–326 bdi paragraph → 1 sentence;
  optionally L91–237 German example → trim to representative groups (toolbar, contextMenu,
  grid) since the API reference holds the full shape.
- Notes: full German example duplicates the field-by-field shape of api-reference (the
  L80–84 callout itself says the API ref is that).

### performance.mdx — 340 words, 3 H2 / 0 H3 — KEEP
- Split: n/a.
- Compress: n/a (page is callout-shaped, all load-bearing).
- Notes: canonical home of the stable-identity rule that columns/styling/i18n/virtualization
  all restate — keep it here, trim the copies.

### virtualization.mdx — 868 words, 7 H2 / 0 H3 — COMPRESS
- Split: no tabs (7 H2s for 868 words = header soup); merge instead: **How it works** (The
  model in consumer terms + Overscan + What's virtualized) / **Guarantees** (Interaction with
  pinned rows and columns + What you get for free + stable-refs callout) / **Beyond rendering**
  (keep as-is).
- Compress: L40–49 velocity-aware overscan internals → 2 sentences; L86–91 "Verified by a
  regression suite" → delete entirely (verbatim cross-reference of performance);
  L59–67 → trim the "viewport bounds shrink" sentence.
- Notes: L86–91 is dead weight on this page.

## 3. Add-ons

### fill-handle.mdx — 783 words, 6 H2 / 0 H3 — KEEP
- Split: n/a (optional: API tab → Wiring it up, Turning fill off, onFill; Basics tab → Tiling
  vs. series inference, Forcing a plain copy, Keyboard fill). Page is short enough that tabs
  are cosmetic, not required.
- Compress: Wiring it up (L23–28) → drop the seam internals sentence, condense to one line +
  the existing link to /docs/overlay-plugins.
- Notes: the "Composing with core's DataGrid convenience wrapper" callout (L57–62) is the 1st
  of 3 near-identical copies (also pinned-rows L44–47, presence L109–112) — pick one
  canonical location.

### pinned-rows.mdx — 1101 words, 6 H2 / 2 H3 — SPLIT+COMPRESS
- Split: **Basics** → Wiring it up, API; **Totals** → Computing a totals row (+ H3s Custom
  reducers, Manual computation); **Details** → Geometry, Frozen-edge shadow, a11y.
- Compress: L113–116 (reporter bridge internals) → 1–2 sentences; Frozen-edge shadow
  (L171–175) → one sentence, merge into Geometry bullet; L29 ("This mirrors the shape of
  useDataGridPresence and useDataGridFill") → delete.
- Notes: same duplicate convenience-wrapper callout (L44–47) as fill-handle/presence.

### multiplayer-presence.mdx — 1774 words, 7 H2 / 0 H3 — SPLIT+COMPRESS
- Split: 2 pages. Cut point after Rendering/Scope cuts (L225): page 1 = receiving remote
  presence (API, Wiring it up, Zero re-render guarantee, Coordinates); page 2
  "Broadcasting your selection" = Demo wiring sketch (real websocket) (L226–284). Tabs within
  page 1: **Basics** → API + Wiring it up; **Coordinate forms** → Coordinates + Scope cuts.
- Compress: Zero re-render guarantee (L114–126) → 2 sentences, drop the test-file pointer;
  Rendering (L193–211) → 2 bullets max, delete clampRectToWindow/splitRectByPinZones/color-mix
  internals; L180–191 (manual rowId→viewRow map + O(n) note) → 1 sentence; Scope cuts bullet 3
  (L220–224) → delete, restates Coordinates.
- Notes: view-space range caveat ×3 — keep once in Coordinates, link elsewhere; 3rd copy of
  the convenience-wrapper callout + "single hook above the provider" boilerplate (L56–68) →
  condense to the once-per-grid warning.

### undo-redo.mdx — 662 words, 5 H2 / 0 H3 — KEEP
- Split: n/a (short, 5 H2s).
- Compress: none needed. Optional: L121–123 "10,000 op wrappers for the life of the stack" →
  "a 10k-op batch is one entry".
- Notes: cleanest of the nine.

### sorting-filtering-search.mdx — 1403 words, 5 H2 / 2 H3 — SPLIT+COMPRESS
- Split: Tabs: **Sorting** → Sorting + Sort list (toolbar add-on) (+ its Keyboard &
  accessibility H3); **Filtering** → Filtering (+ its Keyboard & accessibility H3);
  **Search** → Search; **Controlled mode** → Controlled mode.
- Compress: L129–133 (mod+F behavior prose) → delete, restates the captureFindShortcut callout
  L120–127; L113–118 "Why not Ctrl+F" callout → cut or one line; L71–78 "Standard toolbar
  order" convention callout → condense to 1–2 lines; L182–188 (sort-list keyboard prose) →
  keep table + one line.
- Notes: L103–106 "search never narrows viewIndex" is the canonical statement — keep here,
  make import-export + lazy-loading one-line links.

### import-export.mdx — 1137 words, 4 H2 / 0 H3 — KEEP
- Split: n/a.
- Compress: L148–153 (parseImportFile sheet switching) → 2 sentences; L169–175 (5,000-row
  sync/async split + AbortSignal) → trim to one sentence.
- Notes: L71–72 repeats the "search never narrows" fact (canonical:
  sorting-filtering-search) — one line suffices.

### url-state.mdx — 681 words, 4 H2 / 0 H3 — KEEP
- Split: n/a (short).
- Compress: none. Behavior bullets are crisp.
- Notes: Pagination section mirrors pagination.mdx's Composing with data-grid-url-state
  (same code example) — keep this short version, let pagination.mdx own the
  client-mode-fit explanation.

### lazy-loading.mdx — 2039 words, 8 H2 / 0 H3 — SPLIT+COMPRESS
- Split: too long for tabs alone. Cut point at "Wiring a fetch/cache library (React Query)"
  (L192): new second page (e.g. `lazy-loading-advanced.mdx`, "Data fetching & failure
  recovery") takes the React Query wiring (L192–244) + When a range fails permanently
  (L246–317). Core page tabs: **Basics** → Usage, How it fetches; **Editing & sorting** →
  Editing loaded rows, Sorting a lazy grid; **Errors** → Errors.
- Compress: Lazy loading vs. pagination (L14–26) → 2–3 sentences + link (near-verbatim copy of
  pagination.mdx L18–28); How it fetches (L79–98) → shorten the overscan-batchSize bullet;
  L257–262 (permanent-failure bullets) → 2 sentences; L308–317 (demo-button walkthrough) →
  1 line; L144–147 (toggleSort note) → 1–2 sentences.
- Notes: carries the duplicated "neither add-on / using both unsupported" sentence + the 3rd
  copy of "search never narrows".

### pagination.mdx — 1316 words, 6 H2 / 0 H3 — SPLIT+COMPRESS
- Split: Tabs: **Modes** → Client mode, Server mode; **Footer** → DataGridPaginationBar,
  Composition; **URL state** → Composing with data-grid-url-state. Delete the
  "Lazy loading vs. pagination" H2 (see Notes).
- Compress: Lazy loading vs. pagination (L18–28) → replace with 2 sentences + link to
  /docs/lazy-loading (verbatim duplicate; single copy stays on the lazy page); L219–229
  (why client mode isn't a fit + omission/clamp) → 2–3 sentences, the omission/clamp facts
  duplicate url-state.mdx L130–134 — cross-reference instead.
- Notes: the 4 Client mode warn callouts are real gotchas — keep them; key={pager.page}
  workaround (L68–74) — flag for re-verification if the selection-pruning backlog lands; the
  url-state example stays the detailed copy here.

## 4. Reference

### events-state.mdx — 2549 words, 13 H2 / 3 H3 — COMPRESS
- Split: n/a — the 9 numbered sections are canonical deep-link targets from 6 other pages;
  Tabs won't auto-expand on hash nav, so tabbing breaks every inbound anchor. Keep flat.
- Compress: L93–96 (store-actions-layer/zero-render probes) → delete, duplicates the Zero
  re-render section L321–328; L109–116 ("Extracting the actual cell values used to mean…") →
  2 sentences, drop the history; L279–285 (escape-hatch/design-history rationale) → 2
  sentences; L311–319 (Presence "two-sided contrast") → 2–3 sentences, drops the demo-button
  narrative; L321–328 (Zero re-render guarantee) → 1 sentence; L80–84 (controlled vs
  uncontrolled data) → 1 sentence + existing links.
- Notes: data/defaultData semantics on 3 pages — keep canonical here, one-liners elsewhere.

### api-reference.mdx — 1441 words, 7 H2 / 17 H3 — COMPRESS (light)
- Split: only the 14 H3s under "Add-on option types" (L196–276) — no page links target those
  anchors, so tabs are safe. Mapping: **State & history** → DataGridUrlStateProps,
  UseDataGridStateOptions, UseDataGridHistoryOptions; **Toolbar & menus** →
  DataGridToolbarProps, DataGridSearchProps, DataGridFilterMenuProps,
  DataGridColumnsMenuProps, DataGridSortListProps; **Editing & lazy** →
  DataGridContextMenuProps, DataGridExportButtonProps, UseDataGridLazyRowsOptions;
  **Pagination, fill & pinned** → DataGridPaginationControls/BarProps,
  UseDataGridFillOptions, UseDataGridPinnedRowsOptions. 14 visible headers → 4.
- Compress: L111–128 (validate callout, ~120w — the page's only wall-of-text) → cut the
  "Erasure means…" explanation to one sentence; L193–194 (buildViewIndex internals) → delete;
  L66–69 (Zustand internally) → trim to "hooks only, no exported store".
- Notes: page is mostly generated tables; Hooks list (L71–91) is skimmable, don't touch; deep
  links target H2 anchors only — keep H2s top-level.

### recipes.mdx — 2377 words, 7 H2 / 5 H3 — KEEP
- Split: n/a — it's a jump-to-a-recipe page; each H2 is a self-contained, inbound-linked
  recipe. Tabs would hide the very entries readers navigate to.
- Compress: L157–166 + L227–232 (the two "illustrative snippet" callouts) → one sentence
  each; L484–488 (trailing keypoint-checklist paragraph) → delete, duplicates the callout at
  L388–393; L206–210 → one clause; L148–153 callout → shrink to one line.
- Notes: optimistic/rollback concept explained 3× — fine for a recipe page.

### project-status.mdx — 756 words — KEEP
### license.mdx — 324 words — KEEP
- Static pages, no material compression. L29–31 of license ("incorporating is never
  restricted") is load-bearing legal text — don't cut it.
