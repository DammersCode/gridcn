# gridcn — Implementation Plan (archived snapshot, 2026-09-18)

> Superseded by the slimmed root `PLAN.md`. This file is the pre-slim full spec kept as
> reference: shipped per-feature detail (§3), the original API sketch (§5), and phase
> history (§11). Not loaded by default — read only when a task needs shipped-detail or
> phase history.

# gridcn — Implementation Plan

An Excel-like, composable data grid for the shadcn ecosystem. Real DOM cells, shadcn styling, Base UI primitives, distributed via the shadcn registry (`npx shadcn add @gridcn/data-grid`), documented on a Fumadocs site.

Companion specs (read these before implementing a subsystem):
- `research/landscape.md` — market, competitors, API patterns, pitfalls
- `research/adazzle-rdg-study.md` — rendering-engine architecture reference
- `research/react-datasheet-grid-study.md` — interaction-layer reference (selection overlay, value pipeline, clipboard)
- `research/glide-behavior-spec.md` — the Excel behavior contract (keyboard/mouse/selection/clipboard/fill)
- `research/registry-mechanics.md` — shadcn registry schemas, build, namespacing
- `research/smart-data-grid-inventory.md` — the author's prior grid; carry-overs and anti-patterns

Audit status: the 2026-09-03 multi-agent audit (features/performance/bugs, read-only)
re-verified the 2026-08-02 findings (all fixed) and found what is new — reports in
`docs/agent-work/2026-09-03-audit-{features,performance,bugs}.md`, the forward fix
queue in `docs/agent-work/plans/2026-09-03-audit-followups.md`, tracking + agent
traces in `.agents/audit/2026-09-03-multi-agent-audit/`.

## 1. Vision & positioning

**The gap:** range selection, Excel clipboard paste, and fill handle are Enterprise/Premium-only in AG Grid and MUI X, missing from every MIT grid, and absent from the shadcn ecosystem (diceui's data-grid is the closest but has no fill handle and is TanStack-bound). shadcn itself deliberately ships no installable grid.

**The bet:** an editable grid whose cells are real DOM elements, styled entirely with shadcn tokens, whose source the consumer owns (registry distribution) — with the full Excel trio done right: multi-range selection, dual-format clipboard, and a fill handle with series inference.

**Non-goals (v1):** formulas (=SUM), row grouping/aggregation, cell merging, collaborative editing, million-row datasets (target: smooth at 100k rows), React Native.

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Rendering engine | **Custom DOM engine** — no TanStack Table, no canvas. CSS Grid + subgrid, real browser scroll (adazzle pattern) |
| Virtualization | **Row virtualization always on** — windowed rendering is the only mode (a small dataset's window simply covers all rows, so no toggle exists). Column virtualization deferred to v2 but the layout is designed for it. Sticky header, pinned rows, pinned columns, and custom cells all work with virtualization by construction |
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

## 3. Feature goal list

### v1 — Excel core — ALL SHIPPED (verified 2026-09-03 audit; evidence in `docs/agent-work/2026-09-03-audit-features.md`)
- [x] Typed rows: generic `TData`, `getRowId` required; column defs with stable `id` decoupled from header labels
- [x] Controlled data: `data` + `onDataChange(next, ops)` where ops are id-keyed `{type: 'update'|'insert'|'delete', ...}` deltas; batch semantics (one ops array per user gesture)
- [x] Cell editing: type-to-replace, Enter/F2-to-edit-in-place, Esc cancels, Enter/Tab/Shift variants commit+move, click-away commits; editors render inline in the cell (single-click-never-edits per 2026-07-03 user decision)
- [x] Cell types (pluggable registry): `text`, `number`, `checkbox`, `select`, `date`; per-column and per-cell `readOnly`; each type implements the value pipeline (`toText`, `fromText`, `clearValue`, `isEmpty`, optional `validate`)
- [x] Date type specifics: value + clipboard stay ISO (`yyyy-mm-dd`); display via `options.displayFormat` (`Intl.DateTimeFormatOptions` or a format fn) + `locale` — rendered through the cell's `toDisplayText`; editor is the shadcn date-picker pattern (Popover + Calendar via `calendar`/`popover` registryDependencies, react-day-picker arrives transitively) with typed-input passthrough, Enter commits / Escape cancels; core npm deps still zustand-only (calendar is a registry dependency)
- [x] Selection: anchor cell + rectangular range + range stack (ctrl-click multi-range), full row/column selection channels (RLE CompactSelection); rendered as grid-line-placed overlays (zero cell re-renders — see the `aria-selected` tension in the 2026-09-03 perf audit P4)
- [x] Full keyboard map per `research/glide-behavior-spec.md` §2, with Excel-fidelity upgrades: Ctrl+Arrow jumps to next data boundary; Delete clears range; Shift+arrows extend; PageUp/Down; two-stage Ctrl+A — two spec'd bindings still unbound (Alt+Arrow retain-selection move, primary+Enter scroll-into-view; follow-up workplan N2/N3)
- [x] Clipboard: native copy/cut/paste events; write `text/plain` TSV + `text/html` table with raw-value attributes; parse HTML-first with quoted-TSV state-machine fallback; paste = anchored expand, single-row tiles down selection, optional paste-adds-rows; `processCellForClipboard`/`processCellFromClipboard`/`processPaste` hooks (bulk write paths still unbounded — follow-up workplan 001/002)
- [x] Fill handle: orthogonal drag snap, modulo tiling + **series inference** (arithmetic runs, zero-padded numbers, "Item 1"→"Item 2"), modifier forces plain copy; Ctrl+D/Ctrl+R fill down/right; `onFillPattern` override — shipped as the `data-grid-fill` add-on (user decision 2026-07-18; cut from core)
- [x] Undo/redo: opt-in `useDataGridHistory` hook; op-based, id-keyed (survives sort/filter); Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z; capped stack (scale cost found 2026-09-03 — follow-up workplan N1)
- [x] IME safety (`isComposing`), a11y (`role="grid"`, aria row/col indices+counts, roving tabindex), focus never dies when active cell scrolls out of window (screen-reader manual pass still open — workplan #67)

- [x] **i18n via a labels object (user request 2026-07-03):** every user-facing default string across core AND all add-ons (menu items, tooltips, search placeholder, match counter, filter operators' display names, empty state, keybindings dialog title/categories/action labels, aria-labels, select-all checkbox label, permission hints) lives in one typed `DataGridLabels` interface with English defaults; provider prop `labels?: DeepPartial<DataGridLabels>` deep-merges; public `useDataGridLabels()` hook consumed by core and every add-on — zero hardcoded UI strings outside the defaults object. Interpolated strings are functions (`searchMatches: (current, total) => string`). No i18n library dependency — consumers wire react-i18next/next-intl themselves by passing translated labels (inverts smart-data-grid's hardcoded-i18next mistake).

### v1 — table features — ALL SHIPPED (verified 2026-09-03 audit; evidence in `docs/agent-work/2026-09-03-audit-features.md`)
- [x] Sorting: client-side multi-column (click header cycles, shift-click adds), `localeCompare` numeric-aware per cell type (cell-type `compare` wired into the view pipeline 2026-08 — the 08-02 audit HIGH); controlled `sortState` + `onSortChange` server escape hatch
- [x] Filtering: per-column operators (contains, equals, startsWith, endsWith, empty, notEmpty, gt/lt for numbers/dates, isBetween, isAnyOf for selects), toolbar filter UI, AND/OR join; controlled + server escape hatch
- [x] Search: toolbar quick-search across visible columns with match highlighting + next/prev navigation
- [x] Column resize (pointer capture, double-click autosize via measurement), reorder (drag), pin left/right, visibility toggle
- [x] Pinning UX (user decision 2026-07-03): the PRIMARY pin surface is a per-column **header dropdown menu, diceui-style** — a ghost chevron button appearing on header hover, opening a popover with Sort asc/desc/clear, Pin left/right/unpin, Autosize, Hide. Core exposes a `headerMenu` slot (rendered inline-end in each header cell); the menu component ships in the context-menu add-on (same items as header right-click). The toolbar columns-menu de-emphasizes pin (visibility overview first). `enableColumnPinning` grid prop and per-column `pinnable?: false` to disable; every UI control individually configurable/removable
- [x] Row operations: add, delete, duplicate (default keybindings mod+shift+f / mod+shift+x), row-number/checkbox marker column (outside the data column index space)
- [x] Row markers (like smart-data-grid/glide): `rowMarkers: 'none' | 'number' | 'checkbox' | 'both'` — a pinned-left marker column outside the data index space; checkbox mode drives the rows selection channel + select-all header checkbox; switchable at runtime
- [x] Selection configurability: `enableRowSelection`, `enableColumnSelection`, `enableRangeSelection` (default all true) — disabling removes the header/marker click-select gestures and the corresponding channels; `enableMultiRange` gates ctrl-click ranges
- [x] Mouse-selection hardening (user QA 2026-07-03: drag-select goes into edit mode / plain drag doesn't select): **plain left-button press+drag from ANY cell (active or not) live-paints a rectangular range from the press origin to the hovered cell, any direction — Excel/glide behavior, NOT diceui's shift-only model**; shift+click range extension ALSO works; dedicated browser-test matrix — plain drag from inactive cell selects a range; plain drag from the active cell selects a range and never edits; header press+drag selects a contiguous multi-column range; marker press+drag selects multi-row; click vs drag disambiguation on every surface (cell, active cell, header, marker). **Edit activation (user decision 2026-07-03, supersedes diceui's click-on-focused-cell): single click NEVER edits — double-click, Enter, F2, or typing are the only edit triggers.** This removes the drag/edit gesture conflict entirely. Also: `select-none` on the grid body — native browser text selection (blue highlight) must never appear during shift+click/drag range gestures; editors remain user-selectable
- [x] Context menus (Base UI): cell menu (cut/copy/paste/clear, insert/delete row) and header menu (sort, pin, hide, filter) — pinned-row/marker targets excluded (08-02 audit defect, fixed)
- [x] Sticky header; pinned rows (top/bottom, e.g. totals or frozen leading rows) via the same sticky machinery — shipped as the `data-grid-pinned-rows` add-on (user decision 2026-07-18) with the `rowBands` core seam; frozen-edge shadows (pixel-probe verified, light+dark)
- [x] Validation: per-cell-type + per-column `validate`; invalid cells get `data-invalid` styling; invalid edits can't commit (glide semantics); Standard Schema async validation incl. bulk paths (#79) and per-row cross-field `validateRow` (#101)

### v1 — data IO (separate registry item, keeps core dependency-free) — SHIPPED
- [x] Export xlsx/csv (SheetJS lazily imported; csv delimiter configurable), respects current sort/filter view, full data, or selection scope
- [x] Import xlsx/csv (papaparse; delimiter detection + preview, multi-sheet notice) mapped through cell types' `fromText` (chunked + cancellable for large files)
- [x] IO hook + toolbar Import/Export buttons — the planned `useDataGridIO` split into `useDataGridExport`/`useDataGridImport` + `DataGridExportButton`/`DataGridImportButton`

### v2 roadmap (documented, not built)
Row DOM slot-recycling for extreme-velocity full-window swaps (profiled 2026-07-04: after the subscription-consolidation fix, the remaining full-swap cost is inherent DOM mount/layout ~6ms/frame; recycling row nodes by screen slot would eliminate it but conflicts with the row-identity invariant §4.2 — needs a design that preserves focus/editing identity).
Variable/auto row heights; row grouping + aggregation; summary rows; cell merging; more cell types (multi-select, url, currency, percent, long-text); column groups; row drag reorder; in-grid find panel; formula adapter interface; two-way TanStack Query/DB recipes.
Struck from this list as shipped: column virtualization (built in phase 3b), presence/collab highlight regions (`data-grid-presence` add-on), RTL (2026-08-01), i18n of labels (`DataGridLabels`, 2026-07-03).

## 4. Architecture

### 4.1 Rendering engine (per adazzle study)
- One CSS Grid container = scroll container: `role="grid"`, `display: grid`, `overflow: auto`, `content-visibility: auto`, `contain: content`.
- `grid-template-columns`: every column track in px (resize rewrites the template). `grid-template-rows`: header track + `repeat(N, <rowHeight>px)` — full scroll height with no spacer divs.
- Rows: `display: grid; grid-template-columns: subgrid; grid-column: 1 / -1; grid-row-start: <index>`. Only rows in the overscan window (±4) render. The active row always renders (active column only when off-window) so focus survives.
- Window math: `floor(scrollTop / rowHeight)` (fixed heights v1). Scroll state via `useSyncExternalStore` on the scroll element.
- Sticky: header cells `position: sticky; top: 0`; pinned columns `position: sticky` with cumulative-left CSS vars; z-index ladder cell(0) < pinned(1) < header(2) < pinned-header(3).
- Scroll-into-view: native `scrollIntoView({block:'nearest', inline:'nearest'})` + `scroll-padding` equal to header height / pinned width.
- Browser support: CSS subgrid requires Chrome 117+/FF 71+/Safari 16+ — acceptable for 2026; document it.

### 4.2 State — Zustand, the fifes-web pattern
- `data-grid-store.ts`: a `createDataGridStore(init)` factory using **`createStore` from `zustand/vanilla`**, one instance per `<DataGridProvider>` mount (`useState(() => createDataGridStore(init))`). This is what makes multiple grids on one page work — no module-level singleton.
- State shape: `DataGridState` (`activeCell, selection, editing, fillPreview, lastHighlighted, columnOrder, columnWidths, pinning, visibility, sortState, filterState, searchState`) + `DataGridActions` nested under a single stable `actions` key, defined inline in the factory with `set`/`get`. No immer — manual immutable spreads. Transition logic delegates to the tested pure lib modules.
- **The store is never exported.** The context holds `StoreApi<DataGridStore>`; a module-private bound hook `useDataGridStore(selector)` (React 19 `use()` + `useStore`, throws outside the provider) backs the ONLY public surface:
  - atomic, primitive-returning selector hooks: `useDataGridActiveCell()`, `useDataGridIsCellSelected(coord)`, `useDataGridSortState()`, … — narrow the selector before reaching for `useShallow` (only for genuinely fresh arrays/objects);
  - one `useDataGridActions()` returning the stable `actions` object (never re-renders);
  - internal-only actions prefixed `_`; imperative `getState()` escapes stay internal.
- Live props (`data`, `columns`, callbacks) are synced into the store via `useEffect` + `setState`, never by recreating the store.
- Data itself stays in the consumer (controlled); the grid computes `viewRows` (sorted/filtered index mapping) via memo.
- Dev-mode guardrails (stripped in prod): warn on duplicate column ids, missing `getRowId`, columns array identity changing every render, non-identity-stable `data`.
- Rows memoized by `getRowId`; cells re-render only on their own value change (selection is overlay-rendered).
- All mutations flow through `emitDataChange(ops)` → builds next array + op deltas → `onDataChange`. One gesture = one ops batch (paste, fill, delete-range are single batches).

### 4.3 Selection (per glide spec)
**Coordinate rule (phase-4 obligation):** selection coordinates are data-space, but the user sees view-space (sorted/filtered). The interaction layer translates at the boundary — mouse/keyboard gestures produce view coordinates, which map through `viewIndex` before touching the selection model, so ranges stay display-contiguous under active sort/filter.
`{ current: { cell, range, rangeStack }, rows, cols }` with `CompactSelection` (RLE) for rows/cols. Overlays are grid items placed by grid lines (`grid-column: x+1 / span w`) with `pointer-events: none` — no pixel math, no clip-path: active-cell ring and range fill are separate stacked overlays.

### 4.4 Editing
Inline editor swap (adazzle): the active cell renders the cell type's `Editor` component when `mode === 'edit'`. Editor contract: `{ value, onChange, commit(movement), cancel }` — explicit, no timestamp bookkeeping. Commit-on-outside-click via container-scoped pointerdown capture.

### 4.5 Keyboard & focus
Roving tabindex on the active cell (real DOM focus, ARIA-correct). One keydown handler on the container; keymap as a data table (`keymap.ts`) so consumers can remap/disable. `event.isComposing` gates everything.

### 4.6 Performance (first-class requirement)

Budgets, verified in phase 10 against the docs demo with 100k rows × 20 columns:
- Smooth scroll (no blank flashes at normal wheel speed; overscan tuned, `content-visibility: auto`).
- Keystroke-to-paint < 16ms while editing at 10k+ rows (uncommitted editor state stays local to the editor; commit is one immutable update).
- Selection PAINT re-renders zero cell content — ranges paint through grid-line overlays. The one sanctioned exception is `aria-selected` (WAI-ARIA gridcell requirement): a cell re-renders only when its own selection membership flips, bounded by the flip count and enforced by the render-count tests in `test/data-grid.test.tsx` (2026-09-03 audit P4).
- Paste/fill/delete-range = exactly one `onDataChange` and one commit render (batch invariant).
- Mount cost independent of row count (windowed render; `grid-template-rows` is an RLE string, not N DOM nodes).

Rules that keep it fast: rows memoized by id; cells subscribe only to their own value; interaction state (hover, drag preview) never routed through React state when a CSS var/data-attribute suffices; no document-level listeners except during an active drag or while a non-empty selection exists (the outside-click clear, 2026-09-03 audit N4); sort/filter index maps memoized; no `JSON.stringify` equality anywhere.

**Memory model (informed by TanStack Table V9's shared-prototype refactor, June 2026):** V9's ~90% memory win came from eliminating per-row/cell wrapper objects carrying per-instance closure methods. gridcn never creates such wrappers — consumer row objects are used as-is, values read through column accessors at render time, so the per-row library overhead is a single `viewIndex` number. Rules that keep it that way:
- **Never introduce per-row or per-cell wrapper objects or row-bound closures** in any phase (editing/selection APIs take plain coords + lookups). Reviewers enforce this.
- `viewIndex` as `Uint32Array` instead of `number[]` when we target >1M rows (hardening item; at the 100k comfort target it's <1MB either way).
- Phase 10 perf verification steals their benchmark method: Playwright + CDP `HeapProfiler.collectGarbage` → retained JS heap at 10/1k/100k/1M rows.

### 4.7 Modules (pure TS, unit-tested, UI-independent)
`lib/` — `types.ts`, `compact-selection.ts`, `selection.ts` (range math), `keymap.ts`, `clipboard.ts` (serialize/parse), `fill.ts` (tiling + series inference), `sort-filter.ts`, `history.ts`, `measure.ts`. These are the testable heart; components stay thin.

## 5. Public API

```tsx
// Quick start (uncontrolled: data + history wired internally)
const grid = useDataGridState(initialRows, { getRowId: (r) => r.id })
<DataGrid {...grid} columns={columns} />

// Batteries-included (controlled)
<DataGrid data={rows} columns={columns} getRowId={(r) => r.id}
  onDataChange={(next, ops) => setRows(next)} />

// Composable
const grid = useDataGrid({ data, columns, getRowId, onDataChange })
<DataGridProvider value={grid}>
  <DataGridToolbar>
    <DataGridSearch />
    <DataGridFilterMenu />
    <DataGridColumnsMenu />
    <MyCustomButton />
  </DataGridToolbar>
  <DataGridRoot>        {/* the scroll container / CSS grid */}
    <DataGridHeader />
    <DataGridBody />
    <DataGridOverlays /> {/* selection, fill preview */}
  </DataGridRoot>
  <DataGridContextMenu />
</DataGridProvider>
```

Column definition:
```ts
type ColumnDef<TData, TValue> = {
  id: string                      // stable, never the header label
  header: string | ReactNode
  accessorKey?: keyof TData       // or accessorFn
  accessorFn?: (row: TData) => TValue
  setValue?: (row: TData, value: TValue) => TData   // default: immutable spread on accessorKey
  type?: string                   // cell type registry key, default 'text'
  options?: unknown               // per-type config, narrowed by the type key (select choices, number min/max, date format)
  readOnly?: boolean | ((row: TData) => boolean)
  validate?: (value: TValue, row: TData) => string | null
  width?: number; minWidth?; maxWidth?
  pin?: 'left' | 'right'
  sortable?; filterable?; hidden?
  renderCell?: (ctx) => ReactNode   // display override without a new cell type
}
```

Typed columns: `defineColumns<TData>()` infers `TValue` from `accessorKey`/`accessorFn` per column, and the cell-type key narrows `options`, `validate`, and `setValue` through the **`GridCellTypes` interface map** — consumers augment it when registering custom cell types, getting the same inference as built-ins. Column-id and type-key typos are compile errors.

Cell type contract (registered in `cell-types.tsx`, consumers add their own — it's their code):
```ts
type CellType<TValue> = {
  Cell: FC<CellRenderProps<TValue>>       // display
  Editor: FC<CellEditorProps<TValue>>     // inline editor
  toText(value): string                    // clipboard/export/search
  fromText(text): TValue                   // paste/import/typing
  clearValue(): TValue
  isEmpty(value): boolean
  compare?(a, b): number                   // sort
  align?: 'left' | 'right' | 'center'
}
```

Escape hatches: `processCellForClipboard`, `processCellFromClipboard`, `processPaste`, `onFillPattern`, controlled `sortState`/`filterState`/`searchText` + change callbacks (server-side mode), `keymap` override, `selection`/`onSelectionChange` (controlled selection), imperative ref (`scrollToCell`, `focus`, `getSelection`).

## 6. Styling rules

- shadcn tokens only: `bg-background`, `text-foreground`, `border-border`, `bg-muted`, `accent`, `primary`, `ring`, `destructive`. No hex values, no bespoke palette. Dark mode must need zero extra work.
- State via data attributes, styled in Tailwind: `data-active`, `data-selected`, `data-editing`, `data-pinned="left|right"`, `data-invalid`, `data-readonly`, `data-sorted="asc|desc"`. Consumers restyle with `data-[selected]:...` selectors.
- Selection overlay: `bg-primary/10` fill, `border-primary` active ring; invalid: `data-invalid:ring-destructive`.
- Density: default row height 36px (`--grid-row-height` CSS var, the one grid-specific variable); `tabular-nums` on numeric columns.
- Every part accepts `className`; `cn()` merges. No CSS files — Tailwind utilities only (grid-template values are inline styles).
- Chrome (toolbar, menus, dialogs) uses existing shadcn components via `registryDependencies` — never re-implemented.

**Pretty by default (design-polish step, phase 6):**
- Selected rows/columns (header or marker selection) are visibly highlighted across their FULL extent — `bg-primary/10` tint over the whole row/column band (windowed-clamped overlays like range rects) + accent on the owning header/marker cell (user QA 2026-07-03). Verify the rows/columns channels actually render through the overlay path, not only the range channel.
- **Programmatic style API (user request 2026-07-03):** value-driven styling with a clean pattern — grid props `getRowClassName?: (row, viewRowIndex) => string | undefined` and `getCellClassName?: (ctx {value, row, column, viewRowIndex}) => string | undefined`; per-column `cellClassName?: string | ((ctx) => string)` and `headerClassName?: string`; merged via `cn()` after the built-in classes so consumer styles win. Complements (not replaces) the data-attribute contract (`data-active`, `data-selected`, `data-invalid`, `data-type`, `data-pinned`, …) for state-based styling. Memoization guidance documented (stable function identity; called per rendered cell only — windowed, so cheap).
- Pinned-edge shadows: a soft directional shadow on the *boundary* only — the last left-pinned column casts to the right, the first right-pinned column casts to the left; computed from the pinned group as a whole (3 pinned-left columns = one shadow after the third, not three). Shown only when there is actually content scrolled beneath (hidden at scrollLeft 0 / at max for the right side); must read correctly in light and dark (shadow via `shadow-[...]` with a `--grid-pin-shadow` token, not hardcoded black).
- Visual-default audit against the best-looking grids (Linear/Notion tables, shadcn aesthetics): header weight/height, row hover (`data-[hover]`), border rhythm, selection tint (`bg-primary/10`), focus ring, empty-state, scrollbar styling where the platform allows.
- All of it themeable by consumers through the same tokens/data-attributes — no baked-in magic values.

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
      blocks/data-grid/       # core item — folder-per-component structure
        index.ts              # the ONLY public entry (re-exports)
        root.tsx, header.tsx, body.tsx, row.tsx, cell.tsx, overlays.tsx
        layout-context.ts     # internal shared layout context
        store.tsx, cell-types.tsx, column-helpers.ts
        use-row-window.ts, use-column-window.ts, use-grid-interaction.ts
        lib/ (types, selection, compact-selection, clipboard, fill,
              keymap, sort-filter, history)
        # rule: no component file over ~200 lines — split by component
      blocks/data-grid-history/  # add-on: useDataGridHistory + useDataGridState
      blocks/data-grid-io/    # xlsx/csv item
      examples/               # demo items for docs previews
  components/                 # docs-site-only components (ComponentPreview, ...)
  lib/, public/r/, registry.json, source.config.ts
  research/, PLAN.md
  tests/ or colocated *.test.ts (vitest)
```

## 8. Registry design

**Modularity principle (settled):** the core item contains only what makes it an Excel-like grid — engine, cell types, selection, keyboard, editing, clipboard, fill. Every other feature is a separately installable registry item (shadcn/diceui style): consumers `npx shadcn add @gridcn/<feature>` only what they want. Each add-on lives in its own `registry/default/blocks/<item>/` folder and depends on `@gridcn/data-grid`; implementation phases MUST place add-on code in the item's own folder, and the core must expose the hooks/slots add-ons plug into (no core edits required to install an add-on).

Items:
1. **`data-grid`** — core (engine, cell types, selection/keyboard/editing, clipboard). `dependencies`: `zustand` (only). `registryDependencies`: `button`, `input`, `select`, `checkbox`, `separator`, `tooltip`. (Stale in the original text: the fill handle is NOT in core — it moved to the `data-grid-fill` add-on by user decision 2026-07-18; likewise pinned rows → `data-grid-pinned-rows`, presence → `data-grid-presence`.)
2. **`data-grid-history`** — undo/redo: `useDataGridHistory` + the `useDataGridState` quick-start wrapper.
3. **`data-grid-toolbar`** — toolbar frame + search input + filter menu + column-visibility/pin menu (`dropdown-menu`, `popover`).
4. **`data-grid-context-menu`** — cell + header context menus (`context-menu`).
5. **`data-grid-io`** — import/export. `dependencies`: `xlsx`, `papaparse`. `registryDependencies`: `["@gridcn/data-grid", "dialog", "button"]`.
6. **`data-grid-url-state`** — sort/filter/search in the URL via **nuqs** (router-agnostic adapters). `dependencies`: `nuqs`.
7. **`data-grid-keybindings`** — a shortcuts dialog (`dialog` + `<kbd>` styling, shadcn `kbd` component if available) listing every binding, generated at runtime from the grid's effective keymap (DEFAULT_KEYMAP + consumer overrides — single source of truth, never a hardcoded list), grouped by category (navigation/selection/editing/clipboard), platform-aware labels (⌘ vs Ctrl). Opens via a toolbar slot and the `?` (shift+/) shortcut when installed.
8. **`data-grid-demo`** + per-feature examples — `registry:example`-style items powering docs previews.

Namespace: `@gridcn` → `https://<domain>/r/{name}.json`. Build via `npx shadcn build` → `public/r/`. **Acceptance test:** clean `npx shadcn add` into fresh Next + Vite apps, including non-default aliases (known CLI friction point — test it, document workarounds in the install guide).

## 9. Docs site (Fumadocs)

- Landing page with a hero demo grid (the product sells itself — a live editable sheet).
- Docs sections: Introduction / Installation (namespace setup, per-framework) / Quick start / Editing & cell types / Selection & keyboard (full shortcut table) / Clipboard / Fill handle / Undo & redo / Sorting, filtering, search / Columns (resize, reorder, pin) / Import & export / Styling & theming / API reference (AutoTypeTable from TS types) / Recipes (server-side, custom cell type, controlled selection).
- Every feature page: live `<ComponentPreview>` (Preview/Code tabs) backed by a registry example item — demos are the same code consumers install.
- Keyboard-shortcut reference table generated from `keymap.ts` (single source of truth).

## 10. Testing

- **Vitest + RTL.** Pure lib modules get dense unit tests (selection math, CompactSelection, TSV parser round-trips incl. quoted/multiline cells, fill series inference, history, sort/filter). Interaction tests via RTL: keyboard map, editing lifecycle, clipboard events (jsdom ClipboardEvent), selection gestures.
- Playwright smoke later (post-v1): real-browser scroll/virtualization/clipboard — jsdom can't cover these; verify manually via docs demos until then.
- CI: GitHub Actions — typecheck, lint, test, build, registry build.

## 11. Implementation phases

1. **Scaffold**: Next.js + Fumadocs + Tailwind v4 + shadcn init; registry.json + build wiring; CI; landing stub.
2. **Pure lib layer** (parallelizable per module, test-first): types, compact-selection, selection, keymap, clipboard, fill, sort-filter, history, measure.
3. **Engine**: root/header/body/cell components, virtualization, sticky/pinned, theming, roving tabindex.
3b. **Scroll & wide-grid performance** (before interaction — it reshapes the body rendering): per research/scroll-blanking.md + research/tanstack-virtual-study.md: `isScrolling` tracking + `flushSync` window commits during active scroll + overscan 8–10; **column virtualization** (promoted from v2 — measured 4 FPS at 100 columns vs 32 FPS at 8 in headless Chromium, dev-page probe 2026-07-03); escalate to the sticky-viewport transform layer only if blanks persist after step 1. Verify with the dev-page FPS meter + scripted scroll probe at 8/50/100/200 columns.
4. **Interaction**: reducer, keyboard nav, mouse selection, editing + built-in cell types, overlays.
4b. **Structure refactor** (immediately after phase 4 gate): apply the §12 file-granularity rule to the whole block — split data-grid.tsx into index.ts + root/header/body/row/cell/overlays; split multi-function helper/lib files into one-function-per-file with folder barrels (store and cohesion exceptions stay whole); imports updated everywhere; zero behavior change (all tests pass with only import-path updates). This rule then governs every subsequent phase's new code. NOTE: the 4b landing commit also carried the diceui-editing-spec.md adoption (click-to-edit two-step activation, checkbox direct-toggle with no edit mode, date Popover+Calendar editor) — that is real, intentional, separately-documented behavior change (see research/diceui-editing-spec.md, "user DX decision 2026-07-03"), not part of the zero-behavior-change file move; call it out as such in review/changelog rather than bundling it under the refactor label.
5. **Excel layer**: clipboard wiring, fill handle, undo/redo hook, delete/smart ops.
6c. **UI/UX polish sweep (user QA 2026-07-04)** — two-step: (1) a SCAN pass that walks the live app (agent-browser + screenshots at multiple viewport sizes, incl. large screens) and produces a prioritized issue list for intuitive usage; (2) a FIX pass per issue with browser regression tests. Known seed issues from user QA:
   - Pinned-right position wrong when total column width < viewport: the pinned column floats at the far viewport edge with a dead gap (diceui keeps it flush after the last column until content actually overflows) — pin-right offset must be computed from min(viewport, content) width.
   - Selection/range overlays don't paint over pinned columns (pinned cells sit above the overlay z-order / overlay doesn't account for pinned band) — selecting cells in a pinned column shows no highlight; also the range overlay may extend into the dead gap beyond the last column.
   - Resize handle: must sit at the header's inline-END (currently reads as left of the neighbor), and must highlight on hover (visible affordance, e.g. a 2px accent bar).
   - Column drag-reorder shows two drop-indicator lines — exactly one indicator at the drop position.
   - Checkbox cells: checkbox centered by default (and marker checkboxes aligned consistently).
   - Columns menu (toolbar add-on) redesign (user 2026-07-04): show/hide ONLY — remove pin-left/right controls from it (pinning lives in the header menu/context menu); items rendered as menu rows with a trailing CHECK MARK indicator (DropdownMenuCheckboxItem-style ✓), NOT square checkbox controls.
   - Header context menu (and the upcoming header dropdown menu): every item gets a lucide icon (ArrowUp/ArrowDown/X for sort, Pin/PinOff, EyeOff for hide, MoveHorizontal for autosize, etc.), consistent sizing (size-4, muted).
   - Verify header click-to-sort cycle (headerClickBehavior='sort'): click 1 → asc, 2 → desc, 3 → clear; indicator updates each step; shift+click appends to multi-sort.
   - General pass: hover affordances, cursor shapes, menu item icons/disabled states, focus visibility, empty-gap styling right of the last column, dark-mode contrast of overlays/shadows.
6d. **Search performance**: user reports hard FPS drops typing a search (100k rows) and stepping matches. Investigate: findSearchMatches/viewIndex recompute per keystroke (debounce exists but recompute is O(rows×cols) on commit), per-cell match-highlight selectors, stepping triggering recomputes. Fix to snappy: matches computed ONCE per search-text change into the store (Set/Map keyed lookup for cell highlight, window-clamped), stepping only moves active cell + scrolls (zero recompute), consider chunked/idle search for 100k+ (glide does rAF-chunked search), FPS-probe regression test while typing and stepping.
6. **Table features**: sort/filter/search + toolbar, resize/reorder/pin/visibility, context menus, row ops, validation styling.
7. **IO item**: xlsx/csv import/export + dialogs.
8. **Registry**: item manifests, build, install smoke tests into fresh Next + Vite apps.
9. **Docs**: all feature pages + live demos + API reference + landing.
10. **Hardening**: review passes, a11y audit, perf check at 100k rows, README, LICENSE (MIT), publish checklist. Testing bar (user-confirmed 2026-07-04): lib/ at ~95-100% BRANCH coverage with CI thresholds; components via real-browser acceptance + one regression test per reported bug (line-coverage chasing on React glue explicitly rejected). Plus: **deprecated/legacy-API sweep** (user QA: document.execCommand fallback in clipboard — keep only as guarded last-resort fallback behind navigator.clipboard with a comment, or remove; audit for other deprecated DOM APIs), large-screen + multi-viewport test matrix (issues like the pin-right gap only appear on wide viewports).

Phases 2 is workflow-parallel; 3–6 are sequential-ish with parallel sub-tasks; 7–9 parallel after 6.

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
folders inside each block, the merge-small-files-together rule (replaces the old one-symbol-per-file
rule below phase 4b originally shipped with), domain `index.ts` barrels, and the how-to-add-a-file
guide. `CONTRIBUTING.md` is the source of truth for structure; this section covers everything else.

- Names: `DataGrid*` component prefix; files kebab-case; hooks `use-*`.
- CSS logical properties only (`inset-inline-start`, `padding-inline`, …) so RTL is a v2 flip, not a rewrite.
- TS strict; no `any` in public API; JSDoc on every exported symbol (feeds AutoTypeTable).
- Comments: only non-obvious *why*, one line.
- Commits: conventional (`feat:`, `fix:`, `docs:`, `chore:`), small and phase-scoped.
- The grid never mutates consumer data; all updates immutable + op-described.
- Marker columns (row numbers/checkboxes) live outside the data column index space.
- License: MIT. Behavior specs from AG/Handsontable are inspiration only — no code derivation.
