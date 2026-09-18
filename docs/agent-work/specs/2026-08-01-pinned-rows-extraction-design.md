# Pinned-rows extraction → `data-grid-pinned-rows` add-on (workplan #48, cut #3)

Adopted 2026-07-18 (addendum 2): no store state, own render path, zero keymap/interaction
coupling. Reality check (advisor, 2026-08-01): the render path is root-owned — root.tsx
computes band heights (windowing clamp + frozen-edge shadows key off them), aria-rowcount, and
both bands' aria index bases, and renders `DataGridPinnedRowBand` inside the sticky viewport.
That arithmetic stays core; only the pinned-rows SEMANTICS and JSX move.

## Seam: a provider-level row-bands spec (NOT child registration)

Why not a `FillHandleTracker`-style child registration: bands affect layout height and
aria-rowcount, so a mount-effect registration would paint them one frame late and skip them in
SSR — a visible layout shift on every mount. Provider props are available at first render
synchronously (same reason `overlayPlugins` lives there), so:

- `DataGridProvider`/`DataGrid` gain `rowBands?: RowBandsSpec` (identity-guardrailed like
  overlayPlugins). Core type, deliberately generic:
  `RowBandsSpec = { topRows: readonly unknown[]; bottomRows: readonly unknown[]; render: (ctx: RowBandRenderCtx) => ReactNode }`.
- `RowBandRenderCtx` exposes exactly what root already passes the band today: position
  ("top" | "bottom"), rows, windowedColumns, layout, rowHeight, template, headerHeight,
  ariaRowIndexBase.
- root.tsx keeps ALL arithmetic, now keyed off `rowBands` counts: band heights, aria-rowcount
  (`+ topRows.length + bottomRows.length`), body's `ariaRowIndexOffset`, frozen-edge shadow
  wiring. Where it rendered `<DataGridPinnedRowBand ...>` it now calls `rowBands.render(ctx)`.
- Core REMOVES: `pinnedTopRows`/`pinnedBottomRows` props (DataGrid, DataGridProvider,
  DataGridRoot, layout-context), `rows/pinned-row.tsx`, `rows/pinned-row-band.tsx`, their
  barrel exports. `EMPTY_PINNED_ROWS` becomes the empty `rowBands` default handling.

## The add-on: `data-grid-pinned-rows`

- New registry item (registryDependencies: ["@gridcn/data-grid"]): `DataGridPinnedRow` +
  `DataGridPinnedRowBand` (moved verbatim, imports repointed to the core barrel), plus
  `useDataGridPinnedRows({ top?, bottom? })` returning a stable `rowBands` spec whose `render`
  draws the band — mirrors `useDataGridPresence`'s shape.
- Consumer:
  `const { rowBands } = useDataGridPinnedRows({ top: totals });`
  `<DataGridProvider rowBands={rowBands} ...>` — one-line swap from the old props.
- The v1 semantics move with the components and stay unchanged: separate arrays (never members
  of `data`), readOnly, not navigable, excluded from sort/filter/selection, index-keyed.

## Breaking (pre-1.0)

`pinnedTopRows`/`pinnedBottomRows` leave the core surface. Docs: the pinned-rows doc page
becomes the add-on page (install command per the #47 rule); api-reference + CHANGELOG entry
under Changed; `data-grid-pinned-rows-demo` gains the registryDependency + new wiring; README
feature table gains the row.

## Contracts

`pinned-rows.test.tsx` + `pinned-rows.browser.test.tsx` move to the add-on and stay green
(sticky placement, counter-translate, aria index layout header=1/top-next/data/bottom-last,
readOnly, shadow interplay). NEW test: without the add-on — no band DOM, aria-rowcount counts
only header+data, no console errors. a11y.browser.test.tsx's pinned-row assertions move or are
covered by the moved suite. Zero-render probes green. Payload rebuild.

## Sequencing

After the fill extraction (d9f263e). Last core-surgery item before #49/#50.
