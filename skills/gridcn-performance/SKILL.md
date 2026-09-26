---
name: gridcn-performance
description: "gridcn performance audit: finds and fixes what makes a gridcn grid slow. Use when a grid janks on scroll, typing, or edits, or when writing or reviewing code that passes props, callbacks, or data into DataGridProvider or DataGridRoot."
---

Almost every gridcn slowdown traces to one cause: an unstable prop or callback identity defeats row or cell memoization grid-wide, or the grid lacks a bounded height so virtualization never activates. Both fail silently in production — dev-mode console warnings are the only signal. Work the whole checklist top to bottom, cheapest check first; fix every hit, then remeasure.

## 0. Measure first

Before changing anything, capture a baseline so the fix is verifiable:

1. Open the browser console in a dev build (`NODE_ENV !== "production"`) and reproduce the slow interaction (scroll, type, edit). Note every `[data-grid]`-prefixed warning and the `gridcn: the grid viewport shows more than...` warning verbatim.
2. Open React DevTools Profiler, record the same interaction, and note which row/cell components re-render on a single scroll tick or keystroke. A one-row scroll step should re-render only the entering row's cells — anything more is the symptom this checklist explains.

Done when: you have a warning list (possibly empty) and a profiler recording to compare against after the fix.

## 1. Bounded height (cheapest check)

Grep the grid's JSX for the element carrying `className`/`style` on `DataGridRoot` or `DataGrid`. If it has no bounded height (no fixed height, no `h-full` inside a sized parent), the viewport's `clientHeight` covers the whole dataset and virtualization cannot activate — every row renders regardless of dataset size.

- Symptom in console: `gridcn: the grid viewport shows more than {N} rows at once — its height is probably unbounded, which disables virtualization.`
- Fix: give the grid, or a sized parent, an explicit height, e.g. `className="h-150"` or `h-full` inside a container with its own bounded height.

## 2. Unstable `columns`

Grep for where `columns` is built. If it is a literal (`[...]` or `defineColumns(...)`) written inline in a component's render body (not module scope, not memoized), every render gives the grid a new array identity and every row re-renders.

- Symptom: `[data-grid] columns array identity changed since the last render; pass a stable reference (e.g. useMemo) or every row re-renders`
- Fix: move `columns` to module scope, or wrap in `useMemo` with a dependency list that only changes when the schema actually changes.

## 3. Unstable `data`

Grep the `data`/`onDataChange` (controlled mode) call sites. If `data` is rebuilt from scratch every render (e.g. `.map()` over another source with no memoization) even though no row actually changed, row memoization is defeated grid-wide — check this even if the row count did not change.

- Symptom: `[data-grid] data array identity changed with no row changes; pass a stable reference (rebuilding it every render defeats row memoization)`
- Fix: keep row references stable across renders that don't touch them; update immutably (swap only the changed row's reference), don't rebuild the whole array. This warning does not fire in uncontrolled mode (no `data` prop) — the store's own array legitimately gets a new reference on every mutation there.

## 4. Unstable `getRowClassName` / `getCellClassName` / `onCellClick` / `onRowClick`

Grep for these four props on `DataGridRoot`/`DataGrid`. An inline arrow function or closure passed directly in JSX is a fresh identity every render, breaking row/cell memoization the same way unstable `columns` does.

- Symptoms (each independent):
  - `[data-grid] getRowClassName identity changed since the last render; pass a stable reference (e.g. useCallback) or every row re-renders`
  - `[data-grid] getCellClassName identity changed since the last render; pass a stable reference (e.g. useCallback) or every cell re-renders`
  - `[data-grid] onCellClick identity changed since the last render; pass a stable reference (e.g. useCallback) or every cell re-renders`
  - `[data-grid] onRowClick identity changed since the last render; pass a stable reference (e.g. useCallback) or every row re-renders`
- Fix: module scope if the function needs no closure state, otherwise `useCallback` with a stable dependency list.

## 5. Unstable `overlayPlugins` / `rowBands`

Grep any add-on hook output (`useDataGridFill`, `useDataGridPresence`, `useDataGridPinnedRows`) and how its result reaches the provider. Passing `overlayPlugins={[plugin]}` or a `topRows`/`bottomRows` literal inline in JSX allocates a fresh array every render, even though the individual `plugin` or row array inside it is stable.

- Symptoms:
  - `[data-grid] overlayPlugins array identity changed since the last render; pass a stable reference (module scope or useMemo) or DataGridOverlays re-renders every tick`
  - `[data-grid] rowBands identity changed since the last render; pass a stable reference (the add-on's hook already returns one) or every render recomputes band heights/aria-rowcount`
- Fix: wrap the array in `useMemo`, e.g. `useMemo(() => [fill.plugin, presence.plugin], [fill.plugin, presence.plugin])`. `rowBands` from `useDataGridPinnedRows` is already stable — only re-wrapping it in a new literal breaks it.

## 6. Custom `Cell`/`renderCell` allocating per render

Grep any custom cell type or `renderCell` for `new Intl.DateTimeFormat(...)`, `new Intl.NumberFormat(...)`, or any other object/array/closure literal constructed directly inside the render function. `Cell` renders once per visible cell on every window mount, and mounts happen continuously during scroll — an uncached formatter multiplies across every cell that crosses the viewport in a fling.

- Fix: hoist the formatter to module scope for a fixed configuration, or cache it in a `Map` keyed by a serialized options string (`` `${locale}|${JSON.stringify(format)}` ``), never by object identity — a column's `options` literal is commonly re-created every render, so an identity-keyed cache (`Map<object, ...>`) never hits.
- Also flag: any other allocation (object literal, array, closure) inside `Cell` beyond what's unavoidable — treat it like a `shouldComponentUpdate`-sensitive component.
- Note: React Compiler does not fix this. It optimizes gridcn's own compiled components; it cannot memoize a fresh literal a consumer constructs inside their own `Cell`/`renderCell` function on every call.

## 7. High-rate live data replacing `data` wholesale

Grep for a feed/interval/subscription that calls `setData(wholeArrayRebuilt)` or the controlled `onDataChange` path on every tick, rather than patching. Full replacement re-triggers checks 3 and 6 on every tick and puts selection and open-editor state at risk.

- Fix: use `actions.updateCells(patches)` / `actions.updateRows(...)` (writes by row id, doesn't move selection/active cell/open editor) instead of replacing `data`. Add `{ skipValidation: true }` only when the producer already validated the values, to keep a high-rate feed synchronous.

## Done when

Zero `[data-grid]`-prefixed warnings and no `gridcn: the grid viewport shows more than...` warning appear in the dev console while scrolling and editing, every checklist item above is either fixed or confirmed not applicable, and the React DevTools Profiler recording from step 0 now shows only the entering row/cell re-rendering per scroll tick or keystroke.

## Docs

- `https://gridcn.vercel.app/docs/performance.md` — identity-stability rules, scroll model.
- `https://gridcn.vercel.app/docs/virtualization.md` — bounded-height requirement, windowing model.
- `https://gridcn.vercel.app/docs/overlay-plugins.md` — `overlayPlugins`/`rowBands` identity rules.
- `https://gridcn.vercel.app/docs/styling-theming.md` — `getRowClassName`/`getCellClassName` stability.
- `https://gridcn.vercel.app/docs/custom-cell-types.md` — formatter caching, allocation-free `Cell`.
- `https://gridcn.vercel.app/docs/streaming-updates.md` — `updateCells`/`updateRows`, `skipValidation`.
