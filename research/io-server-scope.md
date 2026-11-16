# Import, export, print, and find and replace over a server result

Status: decided for 2.0.0. Closes gaps I (export), O (import), P (find and replace) and the print
test gap. Vocabulary: `research/api-cohesion-2.0.md` (`ServerSpec`, `totalRowCount`, `signal`).

Modes: L local, PC client pages, PS server pages, Z scroll rows, C controlled state, SS/FS server
sort and filter, API own data source (`useDataGridServerRows` or hand-rolled).

## Today

- `exportGrid` reads `state.data` through `viewIndex`. Holes are skipped. PC and PS hold one page,
  so the file holds one page. Z holds the loaded blocks.
- `onImport(rows)` is the only exit of the import dialog. The dialog writes nothing.
- Find and replace searches the loaded rows. The panel does not say so.
- The parity matrix rests print for API mode on the export row builder.

## I. Export the whole result

Opus review round 1 changed the first draft: no `extent` option (a `source` means "all"; omit it for
the held rows), hostile-iterable bounds, a cancel path, and an announcement.

`ExportGridOptions` gains:

```ts
source?: ExportSource;              // the rows of the whole result; `scope` and the held rows do not apply
maxRows?: number;                   // existing; with a source the default is 1,000,000
maxBytes?: number;                  // source only; default 256 MiB (CSV: UTF-8 bytes, xlsx: characters)
signal?: AbortSignal;
onProgress?: (progress: { rowCount: number; byteCount: number }) => void;

type ExportSource = (ctx: { spec: ServerSpec; signal: AbortSignal }) =>
  | Promise<readonly TData[]>
  | AsyncIterable<readonly TData[]>;
```

- `ctx.spec` is `{ sorts: sortState, filters: filterState, searchText }` read when the export starts.
  The grid applies nothing; the caller's server does. `ctx.signal` aborts on cancel and on a limit.
- Same pipeline as a loaded export (cell type `toText`, `sanitizeFormulas`, xlsx cell cut). `null`
  and `undefined` rows are skipped.
- Bounds: a non-array batch rejects (`TypeError`). Rows are processed in slices of 1,000 so a huge
  batch overshoots `maxBytes` by one slice at most. The export stops at `maxRows` (xlsx also at the
  Excel sheet limit), detects truncation by seeing one row past the cap, and reports it. Rows
  seen (skipped ones too) above twice `maxRows`, and 1,000 empty batches in a row, reject. The
  iterator `return()` is called without awaiting it. A source that throws rejects; no file.
- `exportGrid` resolves `{ rowCount, truncated }`. The button announces it in a `role="status"` node.
- Races: abort is checked after every batch and before the download (also after the xlsx write).
  Columns and cell types are read once when the export starts.
- Client pages (PC): the grid holds one page, `source: () => allRows` exports the dataset in the
  order the source returns; the page-local sort and filter do not apply.
- `DataGridExportButton`: with `options.source` the menu adds "Export all rows" items (also with a
  single format). The plain items export the held rows. While an all-rows export runs the button is
  `aria-busy`, the all-rows items are disabled, and a "Cancel export" item aborts it. Unmount aborts.
  `options.signal` and the button's own signal combine with `AbortSignal.any`.

Mode table: L/PC loaded or `source: () => data`; PS, Z, SS, FS, API: `source` gets the spec;
C: the controlled `sortState`/`filterState`/`searchText` are the spec.

## O. Import into server grids

The rule: the dialog never writes rows into the grid. `onImport(rows, { signal })` is the single
exit and the save path.

- Local grids (L, PC, C): the consumer replaces or appends through `actions.commitChange` as
  today.
- Server grids (PS, Z, SS, FS, API): `onImport` sends the rows to the server and resolves when
  the server has stored them. The dialog stays pending until then, and stays open on a rejection
  (retry). The server decides where a row lands under the current sort. After `onImport`
  resolves, the consumer calls `server.refresh()`: pages mode refetches the page and reads the new
  `totalRowCount`; scroll mode refetches the rendered blocks and resets on a changed count.
  Appending rows to a grid that holds `totalRowCount` or holes is never right: the array would
  exceed the count and `refresh` would drop the rows.
- `signal` aborts when the user cancels or the dialog closes, so a pending POST can stop.
- Bounds: `importLimits.maxRows` (default 1,000,000) bounds the file. Server grids should lower
  it to what one request accepts. The rows keep `createRow` ids; a server that assigns ids
  replaces them in its answer.
- The dialog guards a late `onImport` answer with a token: after cancel or close it clears no
  selection and closes nothing.
- Test per mode: the grid data, `totalRowCount`, and the server call count stay unchanged until
  `onImport` runs; a rejecting `onImport` keeps the dialog open; cancel aborts the signal.

## P. Find and replace over the result

Decision: loaded rows only, with a visible scope label. A server-backed search source would need
a request contract, paging through hits, and replace over rows the grid does not hold; replace
over unloaded rows has no client write path. The label avoids a wrong "no results".

- The panel shows `labels.findReplace.scopeLoadedRows` ("Searches loaded rows only") in its own
  `<p>`, linked to the Find field with `aria-describedby`, when `totalRowCount` is set (a number or
  `null`) or `sortMode` or `filterMode` is `"server"`. Client pages hold a page without a count, so
  `useDataGridFindReplace({ showScope: true })` shows it there; `false` hides it.
  It is text, not color, and not part of the live status line.
- Parity: find and replace PS/Z are `supported`: the scope is the loaded rows, and the panel says so
  (real-mode parity test plus the scope browser test).

## Print for API mode

`DataGridPrintButton` prints loaded rows by design. A browser test mounts a grid fed by
`useDataGridServerRows`, clicks print, and asserts the print document holds the loaded rows and not
the unloaded ones. The parity cell cites the test.

## Not done

- No server-side import preview, no streaming XLSX writer, no server search source (gap P stays
  a documented scope: server search stays outside the grid's server contract, so the parity matrix has no row for it).
