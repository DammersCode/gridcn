# React Data Grid / Datasheet Landscape Research (July 2026) — Input for gridcn

Data collected 2026-07-03 via library docs, GitHub API, and npm API. Downloads = npm weekly 2026-06-22→28.

## 1. Library profiles

### react-datasheet-grid (nick-keller)
- MIT. v4.11.6 (2026-03), 2.0k stars, 89k dl/wk. Single-maintainer, maintenance mode.
- Rendered, deliberately minimal styling. Closest in spirit to "shadcn datasheet".
- Excel UX: cell editing (Enter/F2/type-to-edit), rectangular range selection, copy/paste to/from Excel/Sheets, "expand selection" (basic fill handle), context menu, Ctrl+D duplicate row, Shift+Enter insert row. **No undo/redo. No column resize/reorder/pin.**
- Own virtualization, rows+columns (@tanstack/react-virtual).
- API: controlled `value`/`onChange(newValue, operations)` where operations = `{type:'UPDATE'|'DELETE'|'CREATE', fromRowIndex, toRowIndex}[]`. Columns via `{...keyColumn('active', checkboxColumn), title:'Active'}` helpers.
- Takeaway: great UX/keyboard model and column-helper API; its gaps (undo, resize/reorder/pin, styling) are gridcn's opportunity.

### Glide Data Grid (glideapps)
- MIT, 5.2k stars, 441k dl/wk. **Semi-stalled:** last stable v6.0.3 Feb 2024, only alphas since; React 19 support unresolved (issue #1021).
- Canvas-rendered; millions of rows. Overlay editors; `onCellsEdited` batch; copy needs `getCellsForSelection`; `onPaste` + `coercePasteValue`; `fillHandle` + `allowedFillDirections` + `onFillPattern`; `rangeSelect` modes incl. multi-rect; configurable `keybindings`. No undo/redo (BYO).
- Column resize/reorder/freeze/group; merged cells; variable row heights. Theme = JS object; not Tailwind-friendly; custom cells need canvas draw code. Heavy peer deps (lodash, marked, react-responsive-carousel).
- Takeaway: gold standard for interaction completeness. Borrow its event/callback contracts, not its rendering.

### AG Grid Community
- Core MIT; Enterprise commercial. v36.0.0 (2026-06), 15.4k stars, 2.8M dl/wk. Very active.
- **Edition split (the market gap):** Community has cell editing + undo/redo (`undoRedoCellEditing`, 10 steps, stacks cleared by sort/filter/group). **Enterprise-only: range/cell selection, fill handle (linear series inference, Alt to increment, shrink-to-clear), full clipboard (`processCellForClipboard`/`processCellFromClipboard`/`processDataFromClipboard`), row grouping.**
- Own virtualization rows+cols. Resize/reorder/pin/groups in Community.
- Takeaway: the Excel trio — range selection, fill handle, clipboard — is paywalled in the most popular grid. That's gridcn's target. Its clipboard/fill callback contracts are the de-facto industry spec.

### Handsontable
- Source-available, NOT OSS (free only non-commercial); ~$1,090/dev/yr. v18 (2026-06), 22k stars, 357k dl/wk.
- The most complete feature set: cell types, copy/paste, autofill, undo/redo, range selection, merged cells, context menu, validation, conditional formatting, Excel-compliant shortcuts, ~400 formulas via HyperFormula (GPLv3+commercial — a trap).
- Takeaway: feature checklist + keyboard-shortcut spec reference. License fuels demand for an OSS alternative.

### TanStack Table
- MIT, 28.2k stars, 14.9M dl/wk. v8.21.3 stable; v9 in beta (July 2026).
- Headless: sorting, filtering, grouping, pagination, row selection, column sizing/order/pin/visibility. **No editing, no range selection, no clipboard, no keyboard nav, no virtualization** (pair @tanstack/react-virtual, 13.8M dl/wk).
- NOTE: gridcn deliberately does NOT build on TanStack Table (user decision: custom DOM engine). Listed for feature parity reference.

### MUI X Data Grid
- Open-core. v9.8.0, 2.9M dl/wk. Cell/row editing MIT; clipboard **copy** MIT (TSV, `clipboardCopyCellDelimiter`); **paste = Premium; range selection = Premium**; pinning Pro; no undo/redo. Confirms the same paywall gap as AG Grid.

### react-data-grid (adazzle)
- MIT, 474k dl/wk. **Perpetual beta** (7.0.0-beta since ~2020; beta.59 Dec 2025, requires React 19.2+).
- Lean deps (clsx only), CSS-variable theming (`--rdg-*`), light/dark via `color-scheme`, RTL.
- Cell editing via `renderEditCell`; single-cell copy/paste + single-cell drag fill; **no range selection**; no undo/redo. Own virtualization rows+cols; resize/reorder/freeze/span; summary rows.
- Takeaway: good lean CSS-var DOM grid; cautionary tale on release management.

### Mantine DataTable
- MIT, 98k dl/wk. Mantine-locked data table (no cell editing/range/clipboard/fill/undo). Only relevant as DX example.

### Others
- **ReactGrid (silevis)**: MIT, spreadsheet UX, v4 stable / v5 alpha, uneven pace.
- **Univer**: Apache-2.0, 13.4k stars — full canvas spreadsheet app framework (formulas, pivot, collab). Not a composable component.
- **jspreadsheet CE** MIT; **fortune-sheet** MIT drifting.
- **Simple Table**: small MIT newcomer marketing against Handsontable/AG pricing — evidence of demand.

## 2. Feature comparison (condensed)

| | License | Cell edit | Range select | Excel copy/paste | Fill handle | Undo/redo | Col resize/reorder/pin |
|---|---|---|---|---|---|---|---|
| react-datasheet-grid | MIT | Yes | Single rect | Yes | Basic (expand down) | No | No |
| Glide | MIT (stalled) | Yes | Multi-rect | Yes | Yes (tiling only) | No | Yes |
| AG Grid | MIT core | Yes | **Enterprise** | **Enterprise** | **Enterprise** | Yes | Yes |
| Handsontable | Proprietary | Yes | Yes | Yes | Yes | Yes | Yes |
| MUI X | Open-core | Yes | **Premium** | Copy only | No | No | Pin=Pro |
| adazzle rdg | MIT (beta) | Yes | No | Single-cell | Single-cell | No | Yes |
| diceui data-grid | MIT | Yes (9 variants) | Yes | Yes | **No** | Yes (hook) | Yes |

## 3. shadcn-ecosystem prior art

1. **Official shadcn data-table** — a docs *guide* (TanStack over `<Table>` primitives), deliberately not a component. gridcn should feel like the natural next step of this philosophy.
2. **diceui Data Grid (sadmann7)** — **closest existing competitor**, late 2025. MIT, `shadcn add "@diceui/data-grid"`. TanStack Table + Virtual; `useDataGrid({data, columns, onDataChange, getRowId})` → `{table, ...props}` into `<DataGrid>`; optional compound parts (FilterMenu, SortMenu, RowHeightMenu, Skeleton); cell variants via `columnDef.meta.cell = {variant:'number', min, max}` (9 variants); Excel keyboard model; TSV clipboard w/ paste row-expansion; undo/redo via `useDataGridUndoRedo` (trackCellsUpdate/trackRowsAdd/trackRowsDelete); Ctrl+F search; context menu; resize/pin/hide/reorder; RTL. **Gaps: no fill handle; admits shadcn CLI install path friction.**
3. **tablecn (sadmann7)** — 6.2k stars; server-side pagination/sorting/filtering reference app.
4. **bazza/ui data-table-filter** — Linear-inspired filter UI, own registry.
5. **Origin UI / Kibo UI / blocks marketplaces** — no Excel-like grid anywhere.

**Conclusion:** nobody in the shadcn ecosystem ships a fill handle, multi-rect selection, or a polished spreadsheet keyboard model. A dedicated gridcn with fill handle + rock-solid clipboard + real docs is differentiated.

## 4. shadcn registry distribution (2026)

- `registry.json` root: `{$schema, name, homepage, items[]}`; item = `registry-item.json` with `name`, `type` (use **registry:block** for multi-file), `dependencies` (npm), `registryDependencies` (other items: bare `button`, `@acme/x`, URL), `files[{path,type,target?}]`, `cssVars{theme/light/dark}`, `css` (Tailwind v4 layers), `docs`, `categories`.
- Multi-file: each file has own type (`registry:component`, `registry:hook`, `registry:lib`…); `target` placeholders `@components/`, `@ui/`, `@lib/`, `@hooks/`, `~/`.
- Authoring: source imports must use `@/registry/...` paths (rewritten on install); cross-item deps in `registryDependencies`.
- Build: `npx shadcn@latest build` → static `public/r/*.json`; or dynamic via `shadcn/registry` `loadRegistry`/`loadRegistryItem`.
- Install: `npx shadcn@latest add https://gridcn.dev/r/data-grid.json`, or namespace: `npx shadcn@latest registry add @gridcn=https://gridcn.dev/r/{name}.json` then `npx shadcn@latest add @gridcn/data-grid`. CLI supports `list`/`search`/`view`.

## 5. Fumadocs for the docs site

- `fumadocs-core` + `fumadocs-ui` (supports Base UI) + `fumadocs-mdx`; scaffold `npm create fumadocs-app` (Node 22+).
- Structure (Next.js): `source.config.ts` → `lib/source.ts` → `app/docs/layout.tsx` (DocsLayout) → `app/docs/[[...slug]]/page.tsx` (DocsPage) → `mdx-components.tsx` (register `<ComponentPreview>` here).
- Built-ins: Tabs (Preview/Code), CodeBlock, Steps, TypeTable, **AutoTypeTable** (from `fumadocs-typescript`, generates prop tables from TS types — use for grid API docs).
- Pattern (shadcn/diceui): `registry/` dir with source + demo files; `<ComponentPreview name="...">` lazy-imports demos; `shadcn build` outputs `public/r/`. Community tool `fumadocs-registry` (decker-dev) automates scaffolding.

## 6. API patterns worth borrowing

1. Hook + compound components over mega-component; expose internal state handle.
2. **Operation-based onChange** (react-datasheet-grid): `onChange(next, ops[])` — makes undo, dirty-tracking, server sync trivial.
3. **Batch edit callback** (Glide `onCellsEdited(edits[])`) — one state update per paste/fill/delete-range.
4. Copy provider contract (Glide `getCellsForSelection`) — clipboard decoupled from rendering.
5. Clipboard interception pipeline (AG `processCellForClipboard` / `processCellFromClipboard` / `processDataFromClipboard`).
6. Fill handle spec (AG): series inference for numbers, Alt to force, shrink-to-clear + suppress option, direction restriction (Glide `allowedFillDirections`).
7. Cell variants via column meta (diceui).
8. Column helpers with spread composition (rdg `{...keyColumn('x', textColumn), title}`).
9. Keybindings as a data prop (Glide).
10. Undo/redo as opt-in hook (diceui) — op-based, id-keyed.
11. CSS-variable theming (adazzle `--rdg-*`; shadcn tokens).
12. TSV `\t`/`\n` + `text/html` table dual clipboard; configurable delimiter.

## 7. Pitfalls to avoid

- Canvas rendering (kills Tailwind theming, a11y, SSR).
- Perpetual beta / stalled stable — ship small, version honestly.
- Registry import-path rewriting friction (diceui's complaint): test installs into next/vite targets with non-default aliases; use `@/registry/...` source paths + correct `target`s.
- Undo stacks invalidated by sort/filter (AG) → key history by row id, never index; `getRowId` everywhere.
- Clipboard: prefer native `copy`/`paste` events + `event.clipboardData`; parse `text/html` first then TSV; handle quoted multi-line cells; async `navigator.clipboard.read()` needs secure context.
- Keyboard/IME: type-to-replace vs F2-append; Enter-down/Tab-right; Esc revert; Delete clears range; **`isComposing` must gate navigation**.
- Focused/edited cells must not unmount when virtualization scrolls them out.
- A11y: `role="grid"`, aria-row/colindex, aria-rowcount, roving tabindex.
- Per-keystroke controlled updates jank at 10k rows — batch, memoize rows by id.
- License contamination: AG Enterprise / Handsontable behaviors are spec-inspiration only; HyperFormula is GPL — no bundled formula engine.
- Registry item granularity: not one 3,000-line file, not 25 files. A handful.

## 8. Recommended feature checklist

### MVP
- Typed rows + `getRowId`; controlled `data`/`onDataChange(next, ops)` with op metadata
- Row virtualization (fixed height first); non-virtualized mode for small data
- Excel keyboard model (full map incl. Ctrl+Home/End, PageUp/Down, Shift-extends, F2, Esc, Delete-clears)
- Single rectangular range selection + header row/column selection
- Cell editing: text, number, select, checkbox, date; per-cell readOnly
- Clipboard: copy/cut/paste; TSV + HTML table write/parse; paste tiling/expansion; process hooks
- Undo/redo opt-in hook, op-based, id-keyed
- Column resize, pin, visibility; client sorting; fill handle with series inference (differentiator!)
- shadcn theming; a11y baseline; registry:block distribution + namespaced registry; Fumadocs site with ComponentPreview + AutoTypeTable

### v2
- Multi-rect selection, column virtualization, variable row heights
- More variants (multi-select, URL, long-text, currency/percent), validation API, batch-edit mode
- Context menu extensions, in-grid find, row drag reorder, column groups, summary rows, cell merging
- Server-side data patterns, collab/presence hooks, RTL, i18n
- Optional formula adapter interface (BYO engine)
