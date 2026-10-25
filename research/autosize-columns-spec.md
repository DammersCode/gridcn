# Spec: `autosizeColumns` (W6-02, FEAT-2)

## Goal

One core action sizes columns to their content over the whole view, not only the rows that are
mounted. Today both autosize paths read `textContent` of the rendered cells
(`data-grid-context-menu/autosize-column.ts:7-11`, `columns/use-column-resize.ts:131-135`), and the
docs warn "Autosize measures the visible window only" (`content/docs/columns.mdx:30-31`). The new
action samples view rows, measures with canvas `measureText`, and commits once.

Written against the API after Wave 5: W5-11 `setColumnLayout` (one commit, one event), W5-09
imperative handle, W5-12 sync props, W5-13 internal-actions table.

## Decisions

1. **Core action, one engine.** `actions.autosizeColumns(options)` lives in the store; the header
   double-click and the context-menu item call it with `columnIds: [id]`. Rationale: one
   measurement rule for every entry point. Rejected: keeping the add-on measurer — it stays
   window-bound and duplicates the core query.
2. **Measure the cell type's display text, not the DOM.** Text = `displayText(cellType, value,
   options)` (`cell-types/display-text.ts:4-10`), the string the built-in `Cell` shows. Rationale:
   works for rows that are not mounted, and costs no layout. Rejected: rendering hidden rows
   offscreen — React work per sampled row. Ceiling: a `renderCell` column with richer content
   measures its value's display text; the docs say so.
3. **Bounded, spread sample.** Default `sampleRows: 1000`, at most 10,000: evenly strided across the
   view, plus the rows in the current window. Rationale: 100k-row grids stay under ~50 ms; the
   rows the user sees always fit. Rejected: `"all"` — 2M `measureText` calls at 100k × 20.
4. **One commit.** The action calls `setColumnLayout({ widths: { ...current.widths, ...measured } })`
   (W5-11 decision 11): one `set`, one `onColumnLayoutChange`. Rejected: `commitColumnWidth` per
   column — one event per column.

## API

```ts
type AutosizeOptions = {
  columnIds?: readonly string[];   // default: every visible, resizable column
  sampleRows?: number;             // default 1000, clamped to [1, 10_000]
  includeHeader?: boolean;         // default true
};
// DataGridActions (store/types.ts) and DataGridApi (W5-09 handle)
autosizeColumns(options?: AutosizeOptions): Record<string, number>;  // the committed widths
// DataGridSyncProps
autosizeOnMount?: boolean | AutosizeOptions;                         // default false
```

Internal: the root registers `_registerMeasureFonts(() => { cellFont, headerFont })` (the
`_registerScrollToCell` pattern), reading `getComputedStyle(...).font` from one body cell and one
header cell (`header-cell.tsx:127` adds `font-medium`, the root sets `text-sm`, `root.tsx:504`).
The pure engine `computeAutosizeWidths(state, fonts, options)` lives in
`columns/autosize-columns.ts` and reuses `measureColumnAutosizeWidth`
(`columns/measure-column-text.ts:35-46`).

## Behavior

- **Columns.** Default: every visible column where `enableColumnResize` is on and
  `column.resizable !== false` (the menu item's gate, `menu-items.tsx:193`). A named column that
  is hidden, unknown, or not resizable is skipped (dev warning for unknown ids). Flex columns
  leave flex, as a manual resize does today.
- **Width.** `max(header text + header affordances, widest sampled cell) + the cell's horizontal padding (read from a mounted data cell, 16 at the default scale) + 4`,
  then `clampColumnWidth` (`columns/resolve-column-width.ts:19-21`). Header affordances add a fixed
  width for the sort indicator (when shown) and the header menu trigger (when `renderHeaderMenu`
  is set).
- **Sample.** View rows only, so sort and filter define what is measured; lazy holes are skipped.
  Texts are cut to 1,000 characters and deduped per column before measuring.
- **No root mounted (SSR, no fonts registered).** The action returns `{}` and writes nothing.
- **`autosizeOnMount`.** Runs once, after mount, when the view first has rows (a lazy grid waits
  for its first page). Columns that already have a width from `defaultColumnLayout`, the
  controlled `columnLayout`, or the URL (W6-07) are skipped, so a saved layout wins.
- **readOnly / editing / selection.** Layout is not data: the action runs in a read-only grid and
  during an edit session; it changes no selection.
- **Plugins / commands.** A plugin or command reaches it through `ctx.api.actions.autosizeColumns`.

## Security

No untrusted input beyond cell text. The 10,000-row cap and the 1,000-character cut bound the work
on a hostile dataset (one 10 MB string cell).

## Performance

- Runs only on a gesture or once on mount; nothing on the scroll or render path.
- Budget: 20 columns × 1,000 sampled rows at 100k rows under 50 ms (one shared canvas context,
  `measure-column-text.ts:7-11`; dedupe before `measureText`).

## Accessibility

The header menu gains "Autosize all columns" (`autosize-all`) next to "Autosize". Keyboard users
reach both through the header menu. No new focus behavior.

## Files

- Add: `data-grid/columns/autosize-columns.ts` (+ unit and perf tests).
- Change: `store/create-store.ts` (action, font registration), `store/types.ts`, `root.tsx`
  (register fonts, run `autosizeOnMount`), `columns/use-column-resize.ts` and `header-cell.tsx`
  (double-click calls the action; drop `getRenderedCellTexts`/`fontSourceRef`),
  `data-grid-context-menu/menu-items.tsx` (both items call the action), `labels.ts`
  (`contextMenu.autosizeAll`), `data-grid.tsx` (prop forwarded by the W5-12 spread).
- Delete: `data-grid-context-menu/autosize-column.ts` and its `vitest.config.ts:51` coverage key;
  `readRenderedCellTexts` in `use-column-resize.ts`.

## Docs, registry, CHANGELOG

- `columns.mdx`: replace the "visible window only" callout with the sample rule and the
  `renderCell` ceiling; document `autosizeColumns`, `autosizeOnMount`. `context-menu.mdx`: the
  `autosize-all` item id in the header items table (`:88`). `api-reference.mdx`: action and handle.
- Payloads: `data-grid` and `data-grid-context-menu` change (one file removed from the latter).
- CHANGELOG `### Added` (`autosizeColumns`, `autosizeOnMount`, `autosize-all`); `### Changed`
  (double-click and menu autosize measure the view sample, not the mounted rows).

## Test plan

- Unit engine: a long value in row 90,000 of 100k widens the column (outside the window); header
  wider than cells; `includeHeader: false`; clamp to `minWidth`/`maxWidth`; hidden and
  non-resizable columns skipped; lazy holes skipped; select measures the label; a 10 MB string is
  cut; sample is strided and includes window rows.
- Unit store: one `setColumnLayout` commit and one `onColumnLayoutChange` for 5 columns; no event
  when widths are unchanged; returns `{}` without registered fonts.
- Unit `autosizeOnMount`: runs once when the first rows arrive; skips columns with saved widths.
- Browser: double-click the handle sizes to an off-window long value; the header menu "Autosize all
  columns" commits once.
- Perf: 20 columns × 1,000 samples at 100k rows under the recorded budget.

## Dependencies

W5-11 (`setColumnLayout`), W5-09 (handle), W5-12 (sync prop home), W5-13 (internal `_register*`
table); W6-07 optional (URL widths count as saved).

## Open product questions

1. Should `autosizeOnMount` default to on? Recommendation: no — it changes widths the consumer set
   in `columns` and costs a measure pass on every mount; opt-in keeps current layouts stable.
