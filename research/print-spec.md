# Spec: print and PDF (W6-03, FEAT-6)

## Goal

`printGrid()` and `<DataGridPrintButton>` in the `data-grid-io` add-on print the grid's rows as a
plain paged table. The browser print dialog also saves it as PDF, so no PDF library is needed (the
plan's Rejected list). The printed table is built from the grid's data, not from the windowed DOM,
so every row in scope prints, not only the mounted ones.

Written against the API after Wave 5: W5-02 sdk barrel, W5-09 handle, W5-12 store-held labels.
The io code is the hucre-based state after R5.

## Decisions

1. **A hidden, sandboxed iframe built with DOM APIs.** `printGrid` appends an `<iframe sandbox="allow-same-origin allow-modals">`
   (no `allow-scripts`), fills its `about:blank` document with `createElement` and `textContent`,
   and calls `iframe.contentWindow.print()`. Rationale: cell text never passes through an HTML
   parser, so no value can inject markup; the sandbox blocks script even if one did. Rejected: an
   escaped `srcdoc` string — one missed escape is an injection. Rejected: `window.open` — popup
   blockers stop it, and it leaks `window.opener`.
2. **Display text, not export text.** Print reads `displayText(cellType, value, options)`
   (`toDisplayText ?? toText`); CSV/XLSX keep `toText`. Rationale: a printed page is for reading
   (formatted dates, W6-04 currency). Rejected: reusing `buildExportRows` as-is — it emits
   `toText` (`export-grid.ts:92`).
3. **Row cap before building.** Default `maxRows` 10,000; a hard ceiling of 500,000 cells cuts rows
   to fit; the table ends with a "Printed N of M rows" note. Rationale: a 2M-cell DOM table hangs
   the print dialog. Rejected: printing everything — the tab freezes on a 100k-row grid.

## API

```ts
// data-grid-io/print-grid.ts
export type PrintGridOptions = {
  scope?: "view" | "all" | "selection";      // default "view" (sort and filter order)
  title?: string;                            // printed heading and document title
  includeHeaders?: boolean;                  // default true
  orientation?: "portrait" | "landscape";    // default: landscape above 6 visible columns
  maxRows?: number;                          // default 10_000
};
export function printGrid(state: DataGridStoreState, options?: PrintGridOptions): void;

// use-data-grid-print.ts — mirrors useDataGridExport (use-data-grid-export.ts:14-23)
export function useDataGridPrint(): { printGrid: (options?: PrintGridOptions) => void };

// print-button.tsx
export type DataGridPrintButtonProps = { className?: string; options?: PrintGridOptions };
```

`buildExportRows(state, scope, { text?: "export" | "display"; maxRows? })` gains the text mode and
the cap. It reads values through `getCellValue` (`columns/column-helpers.ts:110`) instead of its
inline accessor (`export-grid.ts:87-91`), and caps before mapping rows (today `capExportRows`,
`:61-65`, slices after building every row).

Labels under `labels.io`: `print`, `printButtonAriaLabel`, `printTruncated(printed, total)`.

## Behavior

- **Rows and columns.** The scope semantics of `buildExportRows` (`export-grid.ts:67-95`): visible
  columns only, in view order; `"selection"` prints the selected rows; lazy holes are skipped (a
  lazy grid prints its loaded rows only; the docs say so). Hidden columns never print.
- **Document.** `<h1>` title (when given), `<table>` with `<thead>` of `<th scope="col">` and
  `<tbody>`; cell alignment from `cellType.align`. Print CSS: `thead { display:
  table-header-group }` repeats the header on every page, `tr { break-inside: avoid }`, `@page`
  size from `orientation`, 10pt system font, thin borders. A CSP `<meta>` of `default-src 'none';
  style-src 'unsafe-inline'` blocks any network load.
- **Cleanup.** The iframe is removed on the iframe window's `afterprint` event, with a 60 s
  fallback timer. A second `printGrid` while one is open replaces the first iframe.
- **SSR / no DOM.** `printGrid` returns without effect when `document` is undefined.
- **Editing / readOnly / selection.** Print reads committed data (an open draft does not print),
  writes nothing, and runs in a read-only grid. It changes no selection.
- **Commands.** A custom command prints with `printGrid(ctx.api.store.getState())`.

## Security

- No HTML string is built from data: every value, header, and the title go through
  `textContent`. Tests feed `<img src=x onerror=…>`, `</table><script>`, and a `"` in a header.
- `sandbox` without `allow-scripts`; CSP meta as a second layer; no `srcdoc`, no `window.open`.
- The cap bounds DOM size on a hostile dataset; cell text is cut to 32,767 characters (the XLSX
  cell limit, so print and export agree).

## Performance

- Off the hot path: runs on a click. Cost is O(printed cells): one `getCellValue` and one
  `displayText` per cell, then one DOM node per cell in the iframe.
- Budget: 10,000 rows × 20 columns built in under 1 s (perf test with a stubbed `print`).

## Accessibility

The button is a ghost icon `Button` with `aria-label={labels.io.printButtonAriaLabel}` (the export
button pattern, `export-button.tsx:46-53`). The printed table uses `<th scope="col">` so a PDF keeps
its header semantics when the browser tags it.

## Files

- Add: `data-grid-io/print-grid.ts`, `use-data-grid-print.ts`, `print-button.tsx`, tests.
- Change: `data-grid-io/export-grid.ts` (`buildExportRows` text mode, cap, `getCellValue`),
  `data-grid-io/data-grid-io.ts` (barrel: `printGrid`, `useDataGridPrint`, `DataGridPrintButton`,
  `PrintGridOptions`), core `labels.ts` (`labels.io` print strings).
- `registry.json` `data-grid-io` (`:1046-1107`): three new files; add `lucide-react` to
  `dependencies` (`:1031-1034` lists only `hucre@1.1.0` and `papaparse`, but `export-button.tsx:4`
  already imports `Download`, and the print button imports `Printer`).

## Docs, registry, CHANGELOG

- `addons/import-export.mdx`: a `## Print` section after `## Export` (scope, cap, display text, PDF
  through the dialog's "Save as PDF"); a warn callout that a lazy grid prints loaded rows only.
- CHANGELOG `### Added`: `printGrid`, `useDataGridPrint`, `DataGridPrintButton`;
  `### Changed`: `buildExportRows` caps before building rows.

## Test plan

- Unit (jsdom, `print` stubbed): the iframe has `sandbox` without `allow-scripts` and the CSP
  meta; hostile values render as text (no `img`/`script` element in the iframe document); view
  scope follows sort and filter; selection scope; hidden columns excluded; display text for a
  formatted date column; header text from `headerText`; `maxRows` and the 500,000-cell ceiling
  add the truncation note; the iframe is removed after `afterprint` and by the fallback timer;
  no DOM → no throw.
- Unit `export-grid.test.ts`: `buildExportRows` cap builds only `maxRows` rows (spy on the
  accessor); CSV export output is unchanged.
- Browser: the button opens the dialog path (stubbed `contentWindow.print` called once).
- Perf: 10,000 × 20 build under the recorded budget.

## Dependencies

None blocking (plan: "—"). Uses W5-02 (`useDataGridStoreApi` from the sdk) and R5 (io files in
their hucre state). W6-04 formats show in print once it lands.

## Open product questions

1. Should print follow the on-screen column widths? Recommendation: no — automatic table layout
   fits the page; screen widths often overflow a portrait page.
