# gridcn — Plan

An Excel-like, composable data grid for the shadcn ecosystem. Real DOM cells, shadcn
styling, Base UI primitives, distributed via the shadcn registry (`npx shadcn add @gridcn/data-grid`),
documented on a Fumadocs site.

**Status (2026-09-18): v1 fully shipped** — re-verified by the 2026-09-03 multi-agent
audit (reports: `docs/agent-work/2026-09-03-audit-{features,performance,bugs}.md`).
Open work is tracked in `plans/README.md` (executor plans in `plans/`: 007, 008, 010 TODO;
011 in progress) plus workplan #67 (manual NVDA/VoiceOver pass, user-run; the only
unverified a11y claim, blocks any WCAG statement).
Pre-slim full spec (shipped per-feature detail, API sketch, phase history):
`docs/agent-work/2026-09-18-plan-v1-archive.md`.

Companion specs (read on demand per subsystem, not before every task):
- `research/landscape.md` — market, competitors, API patterns, pitfalls
- `research/adazzle-rdg-study.md` — rendering-engine architecture reference
- `research/react-datasheet-grid-study.md` — interaction-layer reference
- `research/glide-behavior-spec.md` — the Excel behavior contract (keyboard/mouse/selection/clipboard/fill)
- `research/registry-mechanics.md` — shadcn registry schemas, build, namespacing
- `research/smart-data-grid-inventory.md` — the author's prior grid; carry-overs and anti-patterns

## 1. Vision & positioning

**The gap:** range selection, Excel clipboard paste, and fill handle are Enterprise/Premium-only
in AG Grid and MUI X, missing from every MIT grid, and absent from the shadcn ecosystem.

**The bet:** an editable grid whose cells are real DOM elements, styled entirely with shadcn
tokens, whose source the consumer owns (registry distribution) — with the full Excel trio done
right: multi-range selection, dual-format clipboard, and a fill handle with series inference.

**Non-goals (v1):** formulas, row grouping/aggregation, cell merging, collaborative editing,
million-row datasets (target: smooth at 100k rows), React Native.

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Rendering engine | **Custom DOM engine** — no TanStack Table, no canvas. CSS Grid + subgrid, real browser scroll (adazzle pattern) |
| Virtualization | **Row virtualization always on** — windowed rendering is the only mode (a small dataset's window simply covers all rows, so no toggle exists). Column virtualization built in phase 3b. Sticky header, pinned rows, pinned columns, and custom cells all work with virtualization by construction |
| v1 scope | Excel core + table features + data IO (see §3) |
| Formulas | None in v1; optional adapter interface is a v2 item |
| Distribution | **Registry-only** (`npx shadcn add`), no npm package |
| Primitives | Base UI (menus, popovers, dialogs, selects) via existing shadcn components as registryDependencies |
| Styling | Tailwind v4 + shadcn tokens only; dark mode free |
| Docs | Fumadocs (Next.js), which also hosts/serves the registry |
| Stack | React 19, TypeScript strict, Tailwind v4, pnpm, Node 22+ |
| Repo | Single Next.js app (docs + registry in one), no monorepo |
| Browser floor | Evergreen with CSS subgrid: Chrome 117+, Safari 16+, Firefox 71+; row cap ~1M (Chromium grid-track limit) — documented |
| Interaction state | **Zustand**, per-grid instance: vanilla `createStore` factory + context provider (multiple grids per page is a hard requirement). Store is module-private — consumers get only atomic selector hooks + one actions hook (the author's fifes-web pattern, see §4.2) |
| URL state | **nuqs** in an optional `data-grid-url-state` registry item (syncs sort/filter/search to the URL); core stays router-agnostic |
| Other libs | Considered and rejected for core: immer (manual spreads, matching the store pattern), @tanstack/react-virtual (windowing is tied to our grid tracks), date-fns (Intl suffices), zod (a `validate` fn suffices). Core npm deps: `zustand` only |
| Type safety | Typed cell-type map (`GridCellTypes` interface, consumer-augmentable) + `defineColumns<TData>()` helper with per-column TValue/options inference. Column prop is named `options` (NOT `typeOptions` — user DX decision 2026-07-03) |
| Quick start | Uncontrolled mode `useDataGridState(initialRows)` in v1 (wires data + history + onDataChange); controlled API remains the primary documented path |

## 3. Feature status

### v1 — ALL SHIPPED (verified 2026-09-03 audit; evidence in `docs/agent-work/2026-09-03-audit-features.md`)

Per-feature shipped detail (incl. user decisions): `docs/agent-work/2026-09-18-plan-v1-archive.md` §3.

- Excel core: typed rows, controlled data + op deltas, cell editing (single-click-never-edits),
  cell types (text/number/checkbox/select/date), multi-range selection (RLE CompactSelection,
  overlay-rendered), full keyboard map per `research/glide-behavior-spec.md` §2 with
  Excel-fidelity upgrades (Ctrl+Arrow data-boundary jumps, Delete clears range, Shift+arrows
  extend, two-stage Ctrl+A, Alt+Arrow retain-selection move, mod+Enter scroll-into-view —
  N2/N3 shipped in plan 006), dual-format clipboard (TSV+HTML write, HTML-first parse,
  anchored/tiled paste, paste-adds-rows), fill handle with series inference
  (`data-grid-fill` add-on), undo/redo (`data-grid-history` add-on), IME safety, a11y
  (roving tabindex, ARIA grid roles; manual screen-reader pass still open — workplan #67)
- i18n via a `DataGridLabels` object (deep-merged provider prop, `useDataGridLabels()` hook,
  no i18n library dependency — consumers wire react-i18next/next-intl themselves)
- Table features: multi-column sorting (cell-type `compare` in the view pipeline), per-column
  filtering (operators, AND/OR), toolbar quick-search (match highlighting + next/prev),
  column resize/reorder/pin/visibility, header dropdown menu (primary pin surface,
  diceui-style), row ops (add/delete/duplicate) + row markers (`number`/`checkbox`/`both`),
  selection configurability flags, mouse-selection hardening (plain drag always selects,
  never edits), context menus (Base UI), sticky header + pinned rows
  (`data-grid-pinned-rows` add-on), validation (per-cell-type, per-column, Standard Schema
  async, cross-field `validateRow`)
- Data IO (`data-grid-io` add-on): xlsx/csv export + import with preview, selection-aware

### v2 roadmap (documented, not built)

Row DOM slot-recycling (conflicts with the row-identity invariant §4.2 — needs a design);
variable/auto row heights; row grouping + aggregation; summary rows; cell merging; more cell
types (multi-select, url, currency, percent, long-text); column groups; row drag reorder;
in-grid find panel; formula adapter interface; two-way TanStack Query/DB recipes.
Struck as shipped: column virtualization (phase 3b), presence/collab highlight regions
(`data-grid-presence` add-on), RTL (2026-08-01), i18n labels.

## 4. Architecture

### 4.1 Rendering engine (per adazzle study)
- One CSS Grid container = scroll container: `role="grid"`, `display: grid`, `overflow: auto`, `content-visibility: auto`, `contain: content`.
- `grid-template-columns` per-column px; `grid-template-rows`: header track + `repeat(N, <rowHeight>px)` — full scroll height with no spacer divs.
- Rows: subgrid, `grid-row-start: <index>`. Only the overscan window (±4) renders; the active row always renders so focus survives.
- Window math: `floor(scrollTop / rowHeight)`. Scroll state via `useSyncExternalStore`.
- Sticky: header `position: sticky; top: 0`; pinned columns sticky with cumulative-left CSS vars; z-index ladder cell(0) < pinned(1) < header(2) < pinned-header(3).
- Scroll-into-view: native `scrollIntoView({block:'nearest', inline:'nearest'})` + `scroll-padding`.

### 4.2 State — Zustand, the fifes-web pattern
- `createDataGridStore(init)` factory using **`createStore` from `zustand/vanilla`**, one instance per `<DataGridProvider>` mount (`useState(() => createDataGridStore(init))`). This is what makes multiple grids on one page work — no module-level singleton.
- State: `DataGridState` + `DataGridActions` under a single stable `actions` key. No immer — manual immutable spreads. Transition logic delegates to the tested pure lib modules.
- **The store is never exported.** Public surface: atomic, primitive-returning selector hooks (`useDataGridActiveCell()`, …) + one stable `useDataGridActions()`. Internal actions prefixed `_`.
- Live props (`data`, `columns`, callbacks) sync into the store via `useEffect` + `setState`, never by recreating the store. Data stays in the consumer (controlled); the grid computes `viewRows` via memo.
- Rows memoized by `getRowId`; cells re-render only on their own value change (selection is overlay-rendered).
- All mutations flow through `emitDataChange(ops)` → `onDataChange`. One gesture = one ops batch (paste, fill, delete-range are single batches).
- Dev-mode guardrails (stripped in prod): warn on duplicate column ids, missing `getRowId`, non-stable identities.

### 4.3 Selection (per glide spec)
**Coordinate rule:** selection coordinates are data-space, but the user sees view-space (sorted/filtered). The interaction layer translates at the boundary — gestures produce view coordinates, mapped through `viewIndex` before touching the selection model, so ranges stay display-contiguous under active sort/filter.
`{ current: { cell, range, rangeStack }, rows, cols }` with `CompactSelection` (RLE). Overlays are grid items placed by grid lines with `pointer-events: none`.

### 4.4 Editing
Inline editor swap (adazzle): the active cell renders the cell type's `Editor` when `mode === 'edit'`. Editor contract: `{ value, onChange, commit(movement), cancel }`. Commit-on-outside-click via container-scoped pointerdown capture.

### 4.5 Keyboard & focus
Roving tabindex on the active cell (real DOM focus, ARIA-correct). One keydown handler on the container; keymap as a data table (`keymap.ts`) so consumers can remap/disable. `event.isComposing` gates everything.

### 4.6 Performance (first-class requirement)

Budgets, verified against the docs demo with 100k rows × 20 columns:
- Smooth scroll (no blank flashes at normal wheel speed; overscan tuned, `content-visibility: auto`).
- Keystroke-to-paint < 16ms while editing at 10k+ rows (uncommitted editor state stays local to the editor; commit is one immutable update).
- Selection PAINT re-renders zero cell content — ranges paint through grid-line overlays. The one sanctioned exception is `aria-selected` (WAI-ARIA gridcell requirement): a cell re-renders only when its own selection membership flips, bounded by the flip count and enforced by the render-count tests in `test/data-grid.test.tsx` (2026-09-03 audit P4).
- Paste/fill/delete-range = exactly one `onDataChange` and one commit render (batch invariant).
- Mount cost independent of row count (windowed render; `grid-template-rows` is an RLE string, not N DOM nodes).

Rules that keep it fast: rows memoized by id; cells subscribe only to their own value; interaction state (hover, drag preview) never routed through React state when a CSS var/data-attribute suffices; no document-level listeners except during an active drag or while a non-empty selection exists (the outside-click clear, 2026-09-03 audit N4); sort/filter index maps memoized; no `JSON.stringify` equality anywhere.

**Memory model:** gridcn never creates per-row/cell wrapper objects carrying per-instance closure methods — consumer row objects are used as-is, values read through column accessors at render time, so per-row library overhead is a single `viewIndex` number.
- **Never introduce per-row or per-cell wrapper objects or row-bound closures** in any phase (editing/selection APIs take plain coords + lookups). Reviewers enforce this.
- `viewIndex` as `Uint32Array` instead of `number[]` when targeting >1M rows.

### 4.7 Modules (pure TS, unit-tested, UI-independent)
`lib/` — types, compact-selection, selection (range math), keymap, clipboard (serialize/parse), fill (tiling + series inference), sort-filter, history, measure. The testable heart; components stay thin.

## 5. Public API

**The code is the source of truth for the API** (types + JSDoc in `registry/default/blocks/`;
JSDoc feeds the docs-site AutoTypeTable). This section records decisions about public API
shape; anything touching public API shape → stop, update this section first (WORKFLOW.md).

Quick start (uncontrolled): `useDataGridState(initialRows, { getRowId })` → `<DataGrid {...grid} columns={columns} />`.
Batteries-included (controlled): `<DataGrid data columns getRowId onDataChange={(next, ops) => …} />`.
Composable: `useDataGrid(…)` + `<DataGridProvider>` around `<DataGridToolbar>`, `<DataGridRoot>` (Header/Body/Overlays), `<DataGridContextMenu>`.

Column definition: stable `id` (never the header label), `accessorKey`/`accessorFn`,
`setValue` (default immutable spread), `type` (registry key, default `'text'`), `options`
(per-type config), `readOnly`, `validate`, `width`/`minWidth`/`maxWidth`, `pin`,
`sortable`/`filterable`/`hidden`, `renderCell`. `defineColumns<TData>()` infers `TValue`
per column and narrows `options`/`validate`/`setValue` through the consumer-augmentable
`GridCellTypes` map; column-id and type-key typos are compile errors.

Cell type contract: `{ Cell, Editor, toText, fromText, clearValue, isEmpty, compare?, align? }`
— registered by consumers (their code).

Escape hatches: `processCellForClipboard`, `processCellFromClipboard`, `processPaste`,
`onFillPattern`, controlled `sortState`/`filterState`/`searchText` + change callbacks
(server-side mode), `selection`/`onSelectionChange`, `keymap` override, imperative ref
(`scrollToCell`, `focus`, `getSelection`).

## 6. Styling rules

- shadcn tokens only: `bg-background`, `text-foreground`, `border-border`, `bg-muted`, `accent`, `primary`, `ring`, `destructive`. No hex values, no bespoke palette. Dark mode must need zero extra work.
- State via data attributes, styled in Tailwind: `data-active`, `data-selected`, `data-editing`, `data-pinned="left|right"`, `data-invalid`, `data-readonly`, `data-sorted="asc|desc"`.
- Selection overlay: `bg-primary/10` fill, `border-primary` active ring; invalid: `data-invalid:ring-destructive`.
- Density: default row height 36px (`--grid-row-height`); `tabular-nums` on numeric columns.
- Every part accepts `className`; `cn()` merges. No CSS files — Tailwind utilities only (grid-template values are inline styles).
- Chrome (toolbar, menus, dialogs) uses existing shadcn components via `registryDependencies` — never re-implemented.
- Programmatic styling: `getRowClassName` / `getCellClassName` grid props + per-column `cellClassName` / `headerClassName`, merged via `cn()` after the built-in classes so consumer styles win; complements the data-attribute contract.
- Pinned-edge shadows: boundary-only (whole pinned group casts one shadow), hidden when no content is scrolled beneath, token-driven (`--grid-pin-shadow`), must read correctly in light and dark.

## 7. Repo layout (single Next.js app)

```
gridcn/
  app/                        # Next.js app router (Fumadocs)
    (home)/page.tsx           # landing
    docs/[[...slug]]/page.tsx
    r/                        # (static payloads served from public/r)
  content/docs/               # MDX documentation
  registry/                   # THE product — registry source
    default/
      blocks/data-grid/       # core item (entry: data-grid.tsx; store/, keyboard/,
                              # sort-filter/, interaction/, overlays/, lib/, …)
      blocks/data-grid-history/  # add-on: useDataGridHistory + useDataGridState
      blocks/<other add-on items>/
      examples/               # demo items for docs previews
  components/                 # docs-site-only components
  lib/, public/r/, registry.json, source.config.ts
  research/, PLAN.md, plans/, CONTRIBUTING.md, WORKFLOW.md
  tests/ or colocated *.test.ts (vitest: unit + browser projects)
```

## 8. Registry design

**Modularity principle (settled):** the core item contains only what makes it an Excel-like grid —
engine, cell types, selection, keyboard, editing, clipboard. Every other feature is a separately
installable registry item (shadcn/diceui style): consumers `npx shadcn add @gridcn/<feature>` only
what they want. Each add-on lives in its own `registry/default/blocks/<item>/` folder and depends
on `@gridcn/data-grid`; add-ons plug into core hooks/slots (no core edits required to install).

Items: `data-grid` (core; npm dep: `zustand` only), `data-grid-history`, `data-grid-toolbar`,
`data-grid-context-menu`, `data-grid-io` (`xlsx`, `papaparse`), `data-grid-url-state` (`nuqs`),
`data-grid-keybindings`, `data-grid-presence`, `data-grid-pinned-rows`, `data-grid-demo` +
per-feature examples.

Namespace: `@gridcn` → `https://<domain>/r/{name}.json`. Build via `npx shadcn build` → `public/r/`.
**Acceptance test:** clean `npx shadcn add` into fresh Next + Vite apps, including non-default aliases.

## 9. Docs site (Fumadocs)

Landing hero demo (a live editable sheet); per-feature pages with live `<ComponentPreview>`
(demos are the same registry example items consumers install); API reference via AutoTypeTable;
keyboard-shortcut table generated from `keymap.ts` (single source of truth).

## 10. Testing

- **Vitest + RTL**, two projects: `unit` (jsdom) and `browser` (Playwright Chromium). Pure lib modules get dense unit tests; components get real-browser acceptance + one regression test per reported bug.
- Testing bar (user-confirmed): `lib/` at ~95-100% BRANCH coverage with CI thresholds; line-coverage chasing on React glue explicitly rejected.
- CI: GitHub Actions — typecheck, lint, test, build, registry build.

## 11. Implementation phases

Phases 1–10 (scaffold → lib → engine → interaction → Excel layer → table features → IO →
registry → docs → hardening) are SHIPPED. Original phase specs and history:
`docs/agent-work/2026-09-18-plan-v1-archive.md` §11. Open follow-up work is planned and
tracked in `plans/README.md` (executor-ready plans in `plans/`); the 2026-09-03 audit's
forward queue was `docs/agent-work/plans/2026-09-03-audit-followups.md` (superseded by
`plans/` for execution; kept as reference).

## 11a. Known limitations to document (not bugs — decisions)

- Context-menu paste needs `clipboard-read` permission; degrade to a "press Ctrl+V" hint.
- Real Excel/Sheets/Numbers HTML clipboard is messy — parse defensively; manual paste matrix against the real apps is a release gate.
- History skips ops whose row ids vanished (external data refresh) — silently, by design.
- Registry has no semver: keep `CHANGELOG.md` + `meta.version`, stable file layout, and an upgrade-by-re-add docs page.
- Inline editors are clipped to cell bounds (Base UI popups portal out, so select/date are fine); long-text editors are a v2 popover pattern.
- Desktop-first: touch selection/fill drag is v2; native touch scrolling works.
- Row cap ~1M (Chromium grid-track limit); comfort target is 100k.

## 12. Conventions

**Repository structure & file granularity:** see [CONTRIBUTING.md](./CONTRIBUTING.md) — domain
folders inside each block, the merge-small-files-together rule, domain `index.ts` barrels, and the
how-to-add-a-file guide. `CONTRIBUTING.md` is the source of truth for structure; this section
covers everything else.

- Names: `DataGrid*` component prefix; files kebab-case; hooks `use-*`.
- CSS logical properties only (`inset-inline-start`, `padding-inline`, …) so RTL is a v2 flip, not a rewrite.
- TS strict; no `any` in public API; JSDoc on every exported symbol (feeds AutoTypeTable).
- Comments: only non-obvious *why*, one line.
- Commits: conventional (`feat:`, `fix:`, `docs:`, `chore:`), small and phase-scoped.
- The grid never mutates consumer data; all updates immutable + op-described.
- Marker columns (row numbers/checkboxes) live outside the data column index space.
- License: GridCN Source Available License 1.0 (source-available, not OSI). Behavior specs from AG/Handsontable are inspiration only — no code derivation.
