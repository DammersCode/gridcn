# Docs example expansion — gap plan (workplan #93, phase 1)

Scope: every page in `content/docs/*.mdx`, judged section by section against the 23 existing
`registry:example` items. Phase 2 = builder lanes. This document specs; it writes no
example code.

## 0. Conventions a builder MUST follow

**Four registration points per new example** (all four, or the preview 404s / the payload is
stale):

1. `registry/default/examples/<name>.tsx` — the demo itself.
2. `registry.json` — a `registry:example` item. Copy the shape of an existing entry: `name`,
   `type`, `title`, `description`, `author: "gridcn"`, `registryDependencies` (`@gridcn/data-grid`
   plus every add-on block used, plus bare shadcn item names like `"switch"`, `"select"`,
   `"button"`), `files: [{ path, type: "registry:example", target: "components/<name>.tsx" }]`,
   `categories: ["data"]`. **Per-file `target` is required on every file entry**, including the
   `demo-data.ts` companion when the demo imports it (see `data-grid-demo`'s two-file entry).
3. `components/registry-examples.tsx` — one `dynamic(() => import(...))` line in `EXAMPLES`. The
   map is statically spelled out on purpose; a computed import is not bundleable.
4. `app/dev/examples/page.tsx` — a static import + a `SECTIONS` entry (title + description +
   `<Demo />`), so the advisor's live-check page renders it.

Then the MDX embed: `<ComponentPreview name="<name>" />`, optionally `align="center"`.

**Demo conventions** (from `data-grid-streaming-demo`, `data-grid-styling-patterns-demo`,
`data-grid-events-demo`):

- `"use client"` first line; `export default function X(): ReactNode`.
- Import the grid from `@/registry/default/blocks/data-grid/data-grid` (and add-ons from their own
  block barrels). Never deep-import a block's internal file.
- Shared rows come from `./demo-data` (`generateDemoRows`, `DemoRow`) — it is a seeded LCG so SSR
  and CSR markup match. A demo needing a bespoke dataset defines it module-scope in its own file
  (as the conditional-styling and streaming demos do); do NOT add fields to `demo-data.ts` for one
  demo's sake.
- `columns` module-scope via `defineColumns<T>()([...] as const)`. Callbacks passed to the grid go
  module-scope or in `useCallback` — identity churn trips the dev guardrail.
- Sizing: `<DataGridRoot className="h-[320px]">`, or `height` on the `<DataGrid>` wrapper. Controls
  live above the grid in `<div className="flex flex-col gap-3">` + a
  `<div className="flex flex-wrap items-center gap-4">` control row.
- Toggle control pattern: `useState` + `<Switch checked onCheckedChange>` inside a `<label
  className="flex items-center gap-2 text-sm">`; a 3+-way choice uses `<Select>` (row-markers and
  styling-patterns demos). `components/ui/switch.tsx` and `select.tsx` both exist.
- One short `/** ... */` above the default export saying what the demo shows. No narration inside
  the body. Comments only for a non-obvious *why* (repo comment rules).

**Docs prose rules** (memory: docs-prose-minimal): example first, max one sentence above the
preview, no comparative framing, no meta-narration, no "as you can see". A new embed usually adds
**zero** new prose.

**Payload rebuild** at the very end of phase 2: `pnpm registry:build` (runs `shadcn build` +
`scripts/fix-registry-imports.mjs`), then `node scripts/verify-registry.mjs`. One rebuild for all
lanes, not per lane.

**Reuse rule**: prefer extending an existing demo with a prop/column change over a new file.
Every "extend" verdict below is deliberately cheaper than a new example and must not be upgraded
to a new file without cause.

---

## (a) Gap table

Verdicts: **NEW** = new example warranted · **EXTEND** = fix by editing an existing demo ·
**EMBED** = a demo that already shows this exists, it is just not embedded here · **NO** = no demo
(type signatures, wiring code, install steps, internals prose — example-spam risk).

### editing-cell-types.mdx  — the priority-1 page

| Section | Existing | Verdict | Why (one line) |
|---|---|---|---|
| `## Edit activation` | cell-types-demo | NO | Covered; double-click/Enter/typing all work in the embed. |
| `## Built-in cell types` | cell-types-demo | NO | Covered. |
| `### Date specifics` | cell-types-demo | NO | Date column present in the embed. |
| `## Read-only` | cell-types-demo | NO | Demo already has `readOnly: true` on a column. |
| **`## Validation`** | cell-types-demo has ONE `validate` fn on Age, embedded 65 lines earlier under a different H2 | **NEW** | The rejection *look* (ring/tint/message, editor stays open) is the whole point and no demo is positioned to show it. |
| `### Transforms are committed` | none | EXTEND (same new demo) | A coercing column in the validation demo shows `"42.9"` → `42`. |
| **`### Async schemas`** | none | **NEW** (same file as validation) | Pending `readOnly` input state is invisible in prose; needs a real latency. |
| **`#### On bulk paths`** | none | **NEW** (same file) | "Rejected cell drops silently, the rest commit" must be *seen* on a paste/fill. |
| **`## Server errors`** | none | **NEW** | `setCellErrors` painting a post-commit 422, and self-clearing on next write. |
| `## Display override without a new type` | cell-types-demo has `renderCell` on Score | NO | Covered. |
| `## Custom cell types` | links to custom-cell-types.mdx | NO | Pointer section. |

### i18n.mdx — **zero ComponentPreview on the entire page**

| Section | Existing | Verdict | Why |
|---|---|---|---|
| `## The labels prop` | none | **NEW** (shared w/ RTL) | The payoff — a translated grid — is never shown. |
| `### Deep merging` | none | NO | Type signature. |
| `### Reading effective labels` | none | NO | Hook prose. |
| `## Coverage by group` | none | NO | Reference table. |
| `## Full German example` | none | EXTEND (same new demo) | The locale switch lands here; the long code block stays. |
| `## Wiring a real i18n library` | none | NO | Explicit "wire library X" code. |
| **`## RTL layout` / `### What mirrors`** | none | **NEW** (same file) | Mirrored pin bands + "ArrowRight moves visually, Tab does not flip" is unlearnable from prose. |
| `### Base UI chrome` | none | NO | Setup contract. |

### columns.mdx

| Section | Existing | Verdict | Why |
|---|---|---|---|
| `## Resize` | pinning-demo (resize on by default, nothing staged) | EXTEND | Add a `resizable: false` column + a content-wide column for double-click autosize. |
| `## Reorder` | pinning-demo | EXTEND | Same demo already has left+right pins; the pin-zone constraint is demonstrable, just unstaged. |
| `## Pin left/right` | pinning-demo | NO | Covered. |
| `### Persistent pin indicator` | none | NO | CSS recipe; static screenshot-grade, low value. |
| **`## Visibility`** | none — no `DataGridColumnsMenu` on the page | **EXTEND** | Add `DataGridColumnsMenu` in a toolbar to pinning-demo; hide *and* restore becomes reachable. |
| `## Row markers` | row-markers-demo | NO | Covered by its own demo. |
| **`## Flex fill`** | none (`data-grid-demo` has flex but is on other pages) | **EXTEND** | Give pinning-demo one `flex` column, or embed `data-grid-demo`; cheapest is flex on an existing column. |
| `## Reading column state` / `### Persisting a layout` | none | NO | Hook list + API contract. |

### selection-keyboard.mdx

| Section | Existing | Verdict | Why |
|---|---|---|---|
| `## Selection model` / `## Mouse gestures` | data-grid-demo | EXTEND (playground covers) | Demo has no `rowMarkers`, so the marker-drag bullet is unreachable. |
| `## Configurability` | none | NO | Props. |
| **`## Header click behavior`** | none — embed is default `"select"` | **PLAYGROUND** | Three outcomes of one gesture; a 3-way `Select` in the playground covers it without a new file. |
| `## Keyboard map` | `<KeymapTable />` | NO | Generated reference; keybindings-demo already exists elsewhere. |
| `### Remapping` | none | NO | Code. |
| `## Two-stage Ctrl+A` | none | NO | One callout; the playground grid is a fine place to try it, no dedicated demo. |
| `## Accessibility` | none | NO | Prose + link. |

### fill-handle.mdx

| Section | Existing | Verdict | Why |
|---|---|---|---|
| `## Wiring it up` | data-grid-demo | NO | Composition code. |
| **`## Tiling vs. series inference`** | data-grid-demo, but rows are randomly generated — no `1,2,3` / `001` / `Item 1` series to drag | **NEW** | The doc's central claim is untestable in the current embed. |
| **`## Forcing a plain copy`** | none | NEW (same file) | Alt/Option changes the drag outcome; invisible today. |
| **`## Keyboard fill`** | none | NEW (same file) | Ctrl+D / Ctrl+R. |
| `## onFillPattern` | events-demo logs it | NO | Veto API; events-demo already prints the payload. |

### styling-theming.mdx

| Section | Existing | Verdict | Why |
|---|---|---|---|
| `## Data-attribute contract` | data-grid-demo (no pinned cols, no markers) | NO | The attribute table is the reference; the CSS-only section below is the one worth demoing. |
| `## CSS variables` | none | NO | Token list. |
| `## Custom classes` | none | NO | One-liner. |
| `## Programmatic per-row/per-cell styling` (+3 H3s) | conditional-styling-demo, styling-patterns-demo | NO | Well covered by two dedicated demos. |
| `## Styling by state with CSS only` | none | NO (borderline) | Would need a bespoke CSS demo; the two styling demos already anchor the page — example-spam risk. |
| `## Density and row height` | styling-patterns-demo has the `Select` | NO | Covered. |
| **`## Loading state`** | none — no demo passes `loading` | **NEW (S)** | Three distinct visual states (skeleton / slim bar over existing rows / empty state) all unshown. |
| `## i18n via labels` / `## Visual defaults` | none | NO | Pointer + prose. |

### clipboard.mdx

| Section | Existing | Verdict | Why |
|---|---|---|---|
| `## Copy` / `## Paste` | data-grid-demo | NO | Ctrl+C/V work in the embed; anchored-expand vs tiling is the same gesture family the fill demo will stage. |
| `## Escape hatches` | none | NO | Three function signatures. |
| `## Context menu paste` | none (no context menu on page) | EMBED | `data-grid-context-menu-demo` already exists — embed it here instead of writing anything. |
| `## Known limitations` | none | NO | Callouts. |

### sorting-filtering-search.mdx

| Section | Existing | Verdict | Why |
|---|---|---|---|
| All sorting/filtering/search/sort-list sections | sorting-filtering-demo + sort-list-demo | NO | Two demos already cover click-sort, filter menu, search nav, sort list. |
| `### Keyboard & accessibility` (×2) | demos above | NO | Key tables; behavior is reachable in the embeds. |
| `## Controlled mode` | none | NO | Server-side prop pair. |

### import-export.mdx

| Section | Existing | Verdict | Why |
|---|---|---|---|
| `## Export` / `## Import` | io-demo | NO | Covered. |
| `## Import options` | io-demo + `<AutoTypeTable>` | NO | Options only change the dialog's *starting point*; the dialog itself is already openable in io-demo. |
| `## Lower-level pieces` | none | NO | API. |

### pinned-rows.mdx

| Section | Existing | Verdict | Why |
|---|---|---|---|
| intro / `## API` / `## Geometry` / `## Frozen-edge shadow` | pinned-rows-demo (live averages-top + totals-bottom via `useDataGridAggregate` + `DataGridAggregateSync`) | NO | Aggregate totals are already well demoed. |
| **`## Computing a totals row` / `### Custom reducers`** | pinned-rows-demo, but it mounts **no toolbar/filter menu** | **EXTEND (S)** | The docs' central claim — totals reflect only the filtered view — cannot be exercised; only editing moves the numbers. Add `DataGridToolbar` + `DataGridFilterMenu` + a `filterable` column. |
| `### Manual computation` / `## a11y` | none | NO | Alternative wiring; aria-tree detail. |

### Pages with no gap (verified)
- **streaming-updates.mdx** — streaming-demo's auto-sort `Switch` already shows both `reorder`
  modes and the `viewStale` re-sort bar. NO.
- **undo-redo.mdx** — history-demo covers it; `## Capped stack` is prose. NO.
- **url-state.mdx** — url-state-demo syncs sort/filter/search/pagination live. NO.
- **multiplayer-presence.mdx** — presence-demo animates 3 peers incl. overlap. One soft gap:
  the demo uses only the view-space `range` form, so `## Coordinates: rowId-native, or view-space`
  — the page's honesty argument that a local sort never mispaints a peer — is unexercised.
  **EXTEND (S, optional):** give one simulated peer a `rowId`/`columnId` entry and enable
  `headerClickBehavior="sort"` so a reader can sort and watch it stay put. Low priority.
- **lazy-loading.mdx** — lazy-demo shows skeleton windows; `## Errors`, `## React Query`,
  `## Permanent failure` are wiring code. NO.
- **pagination.mdx** — pagination-demo + the url-state composition. NO.
- **events-state.mdx** — events-demo's inspector prints every documented callback payload. NO.
- **custom-cell-types.mdx** — cell-types-demo + custom-cell-demo (worked currency). NO.
- **virtualization.mdx / performance.mdx** — large-data + performance demos (100k rows, FPS meter).
  NO.
- **overlay-plugins.mdx** — **the only feature page with zero `ComponentPreview`.** The contract,
  `ctx`, identity-stability and SSR sections are all type/internals prose (NO), but
  `## Worked example: highlight a column` is a complete runnable plugin sitting as dead code, and
  `### Layer order` ("local focus always wins") is inherently visual. **NEW (S), stretch goal:**
  `data-grid-overlay-plugin-demo` embedding exactly that worked example, so the layer order is
  visible when the active-cell ring crosses the highlighted band. Ranked below the six specced
  examples; drop it if lane capacity is short.
- **accessibility.mdx / api-reference.mdx / installation.mdx / project-status.mdx / index.mdx /
  quick-start.mdx / recipes.mdx** — conformance matrices, prop tables, install steps, server-wiring
  recipes. NO by policy.

---

## (b) Specced example list

Effort: **S** ≈ one dataset + one grid + minor chrome · **M** ≈ multiple controls, simulated
latency, or many composed add-ons.

### 1. `data-grid-validation-demo` — **M** — user want #1

- **Lands:** `editing-cell-types.mdx`, directly under `## Validation` (the page's first embed;
  the `### Async schemas`, `#### On bulk paths` and `## Server errors` sections all refer back to
  it, so it must sit above them).
- **Shows, in one grid:**
  - **Sync function rejection** — an Age column (`validate: (v) => v < 18 ? "Must be 18 or older"
    : null`). Type `12`, press Enter: editor stays open, cell gets the destructive ring + tint,
    message shows. This is the "how invalid input looks" the user asked for.
  - **Sync Standard Schema rejection** — an Email column with a schema-shaped validator, to show
    the second `validate` form rejects identically. **Verified: the repo has no Zod, Valibot, or
    ArkType dependency.** Hand-roll a minimal `~standard`-conforming object (gridcn detects schemas
    structurally via `"~standard" in validate`, so no library is needed). A builder must **not**
    add a schema library to `package.json` for a demo.
  - **Async pending** — a SKU column whose validator returns a Promise resolving after ~800 ms
    (module-scope fake `isSkuFree`). Commit shows the input in its `readOnly` pending treatment,
    then either commits or paints the rejection. Escape still cancels mid-flight.
  - **Bulk rejection** — a one-sentence hint plus a "Paste sample block" button (or just the
    documented Ctrl+V path) over the Age column with a mixed valid/invalid block: valid cells
    commit, invalid ones drop silently, one `onDataChange`.
  - **Transform** — one coercing column (`"42.9"` → `42`) for `### Transforms are committed`.
- **Composition:** core only + `@gridcn/data-grid-history` (repo convention: nearly every demo
  installs history). No toolbar needed.
- **Notes:** keep it ~8 rows so the rejection ring is visible without scrolling. The rejection
  styling comes from `cell.tsx`'s `aria-invalid:ring-destructive/20` treatment — the demo must not
  restyle it.

### 2. `data-grid-cell-errors-demo` — **S/M** — user want #1 (server-error API)

- **Lands:** `editing-cell-types.mdx`, under `## Server errors`, above the existing code block.
- **Shows:** a fake `saveOrders` that rejects any Quantity over 100 after ~600 ms; the
  `onDataChange` handler calls `actions.setCellErrors([{ rowId, columnId, message }])`. The cell
  paints the *same* ring/tint/`aria-invalid` as a live rejection **after** the value committed.
  Editing that cell again clears the error by itself. A small badge reading the count via
  `useDataGridCellErrors()` makes the map visible, and a "Clear all" button calls
  `clearCellErrors()`.
- **Composition:** core + history. Needs `useDataGridActions` from inside the provider — use the
  same child-component pattern as `TickerFeed` in the streaming demo (actions are only available
  under `DataGridProvider`).
- **Split rationale:** kept separate from #1 because `validate` is pre-commit and `setCellErrors`
  is post-commit — merging them muddies exactly the distinction the docs draw.

### 3. `data-grid-i18n-demo` — **M** — gap: i18n page has no demo at all

- **Lands:** `i18n.mdx`, top of page (example-first), i.e. above `## The labels prop`. The
  `## RTL layout` section links down/up to it rather than getting a second embed.
- **Shows:** a locale `Select` (English / Deutsch / العربية) driving the `labels` prop, **plus** an
  independent RTL `Switch` driving `direction`, to make the doc's "labels translate strings, they
  do not flip layout" callout literally operable. With Arabic + RTL on: mirrored column order,
  mirrored pin band, mirrored resize handles; ArrowRight moves visually.
- **Composition:** core + toolbar (so translated toolbar strings are visible) + a pinned column so
  the mirrored band shows. `direction` is a prop of `DataGrid`/`DataGridRoot`, **not**
  `DataGridProvider` — builders get this wrong.
- **Notes:** partial `labels` overrides only (deep merge is the point); do not restate the whole
  label object. The long German block already in the page stays as-is.

### 4. `data-grid-fill-patterns-demo` — **S** — gap: series inference untestable today

- **Lands:** `fill-handle.mdx`, under `## Tiling vs. series inference`.
- **Shows:** a small staged dataset with a numeric series (`1, 2, 3`), a zero-padded series
  (`001, 002`), a suffix-numbered text series (`Item 1`), and a plain text column that can only
  tile. Drag the handle down each to see series vs. tile. One sentence notes Alt/Option forces a
  plain copy (`## Forcing a plain copy`) and Ctrl+D / Ctrl+R do the same through the keyboard
  (`## Keyboard fill`) — all three sections served by this one demo.
- **Composition:** core + `@gridcn/data-grid-fill` (`useDataGridFill` + `FillHandleTracker`, as in
  `data-grid-demo`).

### 5. `data-grid-loading-demo` — **S** — gap: `loading` never shown

- **Lands:** `styling-theming.mdx`, under `## Loading state`.
- **Shows:** a `Switch` for `loading` and a second control emptying/restoring the rows, so all
  three states are reachable: zero rows + loading = skeleton; rows + loading = slim indeterminate
  bar under the header; zero rows + not loading = empty state.
- **Composition:** core only. Smallest new file in the plan; a good warm-up task for a lane.

### 6. `data-grid-playground-demo` — **M (largest)** — user want #2. See (c).

### Extends (no new files)

| # | File | Change | Effort |
|---|---|---|---|
| E1 | `data-grid-pinning-demo.tsx` | Add `resizable: false` on one column, a long-content column for double-click autosize, one `flex: 1` column, and a `DataGridToolbar` + `DataGridColumnsMenu` so Visibility is show *and* restore. Serves columns.mdx Resize / Reorder / Visibility / Flex fill in one edit. Update its registry.json `description` + `registryDependencies` (`@gridcn/data-grid-toolbar`) and the dev-page description. | S |
| E2 | `clipboard.mdx` | Embed the existing `data-grid-context-menu-demo` under `## Context menu paste`. MDX one-liner, no code. | XS |
| E3 | `data-grid-pinned-rows-demo.tsx` | Add `DataGridToolbar` + `DataGridFilterMenu` and mark one column `filterable`, so the filter-aware totals claim is exercisable. Update registry.json deps (`@gridcn/data-grid-toolbar`) + description. | S |
| E4 | `data-grid-presence-demo.tsx` | Optional: one peer highlight in `rowId`/`columnId` form + `headerClickBehavior="sort"`, proving sort-safe presence. Low priority. | S |

### Stretch (only if lanes finish early)

| # | Item | Lands | Why last |
|---|---|---|---|
| S1 | `data-grid-overlay-plugin-demo` (**S**) | `overlay-plugins.mdx` `## Worked example` | Only feature page with no preview at all, but its audience is small and the page is a contract reference. |

---

## (c) Playground spec — `data-grid-playground-demo`

**Placement recommendation: a new docs page, `content/docs/playground.mdx`**, added to
`content/docs/meta.json` as the last entry of the *Getting Started* group (after `quick-start`), so
it reads "install → quick start → try everything". Reasons over the alternatives:

- The **home page** (`app/(home)/page.tsx`) already imports `DataGridDemo` directly as its hero;
  swapping in a control-heavy playground would bury the product pitch under switches, and the home
  route does not use `ComponentPreview` (so the Preview/Code tabs, which are half the value, would
  be lost).
- **`/dev/examples`** is the internal live-check page, not consumer-facing.
- A docs page gets the `ComponentPreview` Preview/Code tabs, search indexing, `llms.txt` inclusion,
  and a stable anchor other pages can link to (selection-keyboard `## Header click behavior`,
  columns `## Visibility`, and i18n `## RTL layout` should each link to it).

Page body: title + description frontmatter, one sentence, the `<ComponentPreview
name="data-grid-playground-demo" />`, and a short list of what the toggles map to. Nothing else —
prose rules apply.

### Always-on (composed in the base grid)

Core editing + range selection + clipboard; `DataGridToolbar` with `DataGridSearch`,
`DataGridFilterMenu`, `DataGridColumnsMenu`; `DataGridContextMenu` +
`DataGridHeaderDropdown`; `data-grid-fill` (handle + keyboard fill); `data-grid-history` (undo/redo
buttons); `data-grid-keybindings` (dialog button + `?` shortcut); `data-grid-sort-list` in the
toolbar; `data-grid-io` (export + import buttons).

Precedent that this many add-ons compose safely: `data-grid-events-demo` already runs core +
toolbar + context-menu + presence + fill under one provider.

### Independent toggles (`Switch`, all safe together)

| Control | Drives | Notes |
|---|---|---|
| Row markers | `rowMarkers` (`"none"` ↔ `"both"`) | Use a `Select` if all four modes are wanted. |
| Pinned totals row | mounts `useDataGridPinnedRows` + `useDataGridAggregate` band | Aggregate hook reads the store; keep the `DataGridAggregateSync` pattern from pinned-rows-demo. |
| Validation | swaps the columns array for one carrying `validate` on Age | Lets the user see a rejection inside the playground too. |
| Read-only | `readOnly` on the grid | Grid-wide read-only wins over per-column. |
| Loading | `loading` | Reuses demo #5's states. |
| RTL | `direction` on `DataGrid`/`DataGridRoot` | Not a Provider prop. |
| Presence | mounts the simulated-peers effect | Reuse presence-demo's timer approach. |
| Streaming feed | starts an `updateCells` interval | Pair with a `reorder` defer/immediate switch, as streaming-demo does. |
| Density | `density` `Select` | compact / default / comfortable. |
| Header click | `headerClickBehavior` `Select` | select / sort / none — covers selection-keyboard's unshown table rows. |

### XOR group — mutually exclusive row-supply modes

One `Select` (or segmented control) with exactly three options, never two at once:

**`virtualized` (default) · `paginated` · `lazy`**

Documented basis: both `pagination.mdx` (`## Lazy loading vs. pagination`) and `lazy-loading.mdx`
state verbatim that **"Using both together is not supported."** Plain virtualization is the
no-add-on baseline both compare against, so all three belong in one exclusive group.

Additional constraints a builder must honor:

- **`lazy` + streaming feed**: disable the streaming toggle in `lazy` mode — the feed patches rows
  by id, and unloaded windows have no rows to patch.
- **`lazy` + pinned totals**: aggregate over partially-loaded data is misleading; disable or label
  it in `lazy` mode.
- **`lazy` + import**: import replaces `data`, which the lazy add-on owns. Disable import in `lazy`
  mode.
- **`paginated`**: `DataGridPaginationBar` is standalone and does not read the provider store, so it
  composes with everything else freely.
- Switching modes should reset selection to avoid an out-of-range range rect.

Implementation shape: `useState` for each toggle + one `mode` state; the mode drives which of three
thin wrapper subtrees renders around a shared `<GridBody>` child, rather than conditionally calling
hooks (rules of hooks — the lazy hook must not be called in the other two modes).

**Not in the playground:** `url-state` (a playground that rewrites the docs URL on every toggle is
hostile, and the embedded preview shares the page's URL) and `overlay-plugins` (its own contract
page). Note both exclusions in the plan so a builder does not "helpfully" add them.

---

## (d) Suggested lane split — 3 parallel builders, disjoint files

Shared-file hazard: **`registry.json`**, **`components/registry-examples.tsx`**, and
**`app/dev/examples/page.tsx`** are touched by all three lanes. Mitigation: each lane appends its
entries at the **end** of the respective list/map (never reorders), so conflicts are trivial
appends; the advisor merges lane by lane. Alternatively serialize just those three files behind
lane A. Do **not** run `registry:build` per lane — one rebuild after all lanes land.

### Lane A — Validation & cell errors (user priority #1)

- New: `data-grid-validation-demo.tsx`, `data-grid-cell-errors-demo.tsx`.
- Docs: `content/docs/editing-cell-types.mdx` (embeds only; the prose there is already correct and
  recently written — add embeds, do not rewrite sections).
- Highest value, most subtle behavior (async pending, silent bulk drop). Give this lane the strongest
  builder and require a live-app check at `/dev/examples` — a rejection ring that does not paint is
  invisible to unit tests.

### Lane B — i18n/RTL, fill patterns, loading

- New: `data-grid-i18n-demo.tsx`, `data-grid-fill-patterns-demo.tsx`,
  `data-grid-loading-demo.tsx`.
- Edit: E3 (`data-grid-pinned-rows-demo.tsx` filter-aware totals), E4 (presence rowId, optional).
- Docs: `content/docs/i18n.mdx`, `content/docs/fill-handle.mdx`,
  `content/docs/styling-theming.mdx` (embeds only).
- Three self-contained S/M demos on three pages no other lane touches, plus two small demo edits
  whose docs pages need no change at all.

### Lane C — Playground + columns extends

- New: `data-grid-playground-demo.tsx`, `content/docs/playground.mdx`, `meta.json` nav entry.
- Edit: `registry/default/examples/data-grid-pinning-demo.tsx` (E1) + `content/docs/clipboard.mdx`
  (E2 embed) + cross-links from `selection-keyboard.mdx` / `columns.mdx` to the playground page.
- Largest single file in the plan; keep it alone in its lane. Owns `meta.json` exclusively.

**Ordering note:** lanes are independent and can run concurrently. Lane C's playground reuses the
validation column idea from lane A — it should hand-roll its own one-line `validate` rather than
import from lane A's demo, keeping the lanes truly disjoint (registry examples must each stand alone
anyway, since consumers install them individually).

**Definition of done per lane:** demo file + registry.json entry + registry-examples map line +
dev-page section + MDX embed, `pnpm lint` and `tsc` clean, and the demo verified rendering at
`/dev/examples` in a real browser (memory: browser-testing-gate — jsdom missed a real freeze).
Payload rebuild + `verify-registry.mjs` once, after all lanes.
