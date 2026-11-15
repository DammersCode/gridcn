# Control the file: export and import hook points

Status: decided for 2.0.0. Source: `research/override-extensibility-review.md` sections 4 to 6,
each gap re-checked against the code at HEAD 23abc822. Vocabulary: `research/api-cohesion-2.0.md`.
Builds on `research/io-server-scope.md`.

Modes: L local, PC client pages, PS server pages, Z scroll rows, C controlled state, SS/FS server
sort and filter, API own data source.

## Verdict per gap

| Gap | Decision | Note |
|---|---|---|
| E1 `output` | built | `exportGrid`, `source` and `buildXlsx` callers share one exit |
| E2 `columns`, `formatCell` | built | `formatCell` is sync (per-cell hot path); async data belongs in `source` |
| E3 typed xlsx cells | built | `formatCell` may return `string \| number \| boolean \| Date \| null`; a string is always a text cell |
| E4 `buildCsv`, `exportRows` | built | `runSourceExport` is renamed `exportRows` and exported; `buildCsv(state, options): Blob` is sync |
| E5 `columnIds` | built | `ExportSourceContext.columnIds` |
| Header override | not built | not in the requested package; `columns` plus `formatCell` cover cells, and a custom header needs `exportRows` |
| I1 `onImport` ctx | built | adds `rejected`, `fileName`, `sheetName`, `mapping`; `ImportRejectedCell.message` |
| I2 import error | built | `onImportError(error)` plus a visible line from `labels.io.importFailedWithMessage` |
| I3 `parseFile`, `accept`, `csvEncoding` | built | parser results pass `ImportLimits` after the hook; encoding from a fixed allow-list |
| I4 header row index | built | `ImportDefaults.defaultHeaderRow` accepts `boolean \| number`; rows above the index are dropped |
| I5 `processImportRows` | built | runs after parse and header choice, before the mapping build; bounds run after it |
| I6 `processCellFromText` | built | falls back to the grid's `processCellFromClipboard`, then `fromText`; result still passes `validate` |
| I8 dialog `file`, hook `build()` | built | `build()` owns the pipeline the dialog's confirm ran |
| F1 `onReplace` | built | pre-hook on the plan; count bound after the hook |
| I7, I9, P1, P2, W1, C1, L1, V1, V2 | not now | other branches or later |

No gap was a false positive: each citation in the review was confirmed at HEAD.

## A. Export freedom

```ts
type ExportCellValue = string | number | boolean | Date | null | undefined;

ExportGridOptions & BuildXlsxOptions & BuildCsvOptions gain:
  columns?: readonly string[];        // column ids, in this order; hidden grid columns allowed; unknown id throws RangeError
  formatCell?: (ctx: { value: unknown; text: string; row: TData; column: ColumnDef }) => ExportCellValue;
  output?: (file: Blob, ctx: { fileName: string; format: "csv" | "xlsx"; signal: AbortSignal }) => void | Promise<void>;

ExportSourceContext gains: columnIds: readonly string[];
buildCsv(state, options): Blob            // loaded rows, no download; sync
exportRows(state, options, onBatch)       // the engine behind a source export; was runSourceExport
```

- `output` replaces the download. Default (absent) calls `downloadBlob`. `fileName` carries the
  extension. The grid never builds a URL from the Blob. A rejection rejects `exportGrid`. The signal
  is checked before `output` runs. Works for loaded rows, `source`, and both formats.
- `formatCell` runs once per exported cell after `cellType.toText` (so `text` is the default).
  Return `undefined`/`null` for an empty cell. CSV: numbers become `String(n)` (non-finite becomes
  empty), booleans `true`/`false`, Dates ISO 8601 (invalid becomes empty), strings are cut at
  `MAX_CELL_TEXT`, then `sanitizeFormulaCell` runs as before. XLSX: number, boolean and Date go to
  the writer typed; non-finite numbers and invalid Dates become empty; a string stays a text cell
  (cut at `MAX_CELL_TEXT`). A throwing `formatCell` rejects the export. `maxBytes` counts the
  string length of each cell (`String(value)` for typed cells).
- `columns` selects and orders by id from all grid columns. Default: visible columns in view order.
  `columnIds` in the source context is the resolved list, so a server can narrow its query.
- `source` rows and loaded rows pass the same mapping, so `columns` and `formatCell` apply to both.

## B. Import pipeline

```
file -> parseFile -> defaultHeaderRow -> processImportRows -> mapping -> processCellFromText -> validate -> onImport
```

```ts
parseFile?: (file: File, ctx: { signal: AbortSignal; limits: Required<ImportLimits>; sheetName?: string; csvDelimiter?: CsvDelimiter }) => ParsedImportFile | Promise<ParsedImportFile>;
accept?: DropzoneAccept;                       // default: csv, xlsx, xls
csvEncoding?: string;                          // allow-list of TextDecoder labels; unknown label throws RangeError
ImportDefaults.defaultHeaderRow?: boolean | number;
processImportRows?: (ctx: { rows: string[][]; headers: string[]; mapping: ImportColumnMapping[]; signal: AbortSignal }) => string[][] | false | Promise<string[][] | false>;
processCellFromText?: (text: string, ctx: { row: TData; column: ColumnDef; source: "import"; signal: AbortSignal }) => unknown | Promise<unknown>;
onImport(rows, ctx: { signal; rejected: ImportRejectedCell[]; fileName: string; sheetName?: string; mapping: ImportColumnMapping[] })
onImportError?: (error: unknown) => void;
DataGridImportDialog.file?: File;              // loads this file when the dialog opens
useDataGridImportPreview().build(options)      // runs processImportRows + buildImportedRows; the dialog calls it
```

- `parseFile` replaces the built-in parser for every parse (file load, delimiter, sheet). Its
  result must be `{ rows: string[][] }` (plus optional `delimiter`, `sheetNames`, `sheetName`). The
  shape is checked and the rectangle is checked against `ImportLimits` (rows, columns, cells) after
  the hook; a violation shows `errorTooManyCells`. A non-array result shows `errorParseFailed`.
- `csvEncoding` allow-list: `utf-8`, `utf-16le`, `utf-16be`, `iso-8859-1`, `iso-8859-2`,
  `iso-8859-15`, `windows-1250`, `windows-1251`, `windows-1252`, `windows-1253`, `windows-1254`,
  `windows-1257`, `shift_jis`, `euc-jp`, `euc-kr`, `gb18030`, `big5`. Applies to CSV only.
- `defaultHeaderRow: n` drops rows `0..n-1`, then row `n` is the header. A number at or above the
  row count shows `errorNoRows`. `true` is `0`; `false` keeps all rows as data.
- `processImportRows` gets the data rows (header excluded) and the resolved headers. `false`
  cancels quietly: nothing is built, `onImport` is not called, the dialog stays open. The result is
  checked after the hook: array of arrays of strings (other cell types are rejected), within
  `maxRows` (data rows), `maxColumns`, and `maxCells` of the effective limits. A violation shows
  `errorTooManyCells`.
- `processCellFromText` replaces `cellType.fromText(text)` for a cell. Default: the grid's
  `processCellFromClipboard(text, { row, column })` if set, then `fromText`. The returned value goes
  through `column.validate` like any import value, so the existing validation is the bound. A
  promise makes the build async and chunked.
- `rejected` in the `onImport` ctx lists cleared cells with `message?` (the first validator issue,
  cut at 200 characters).
- `onImport` failure: `onImportError(error)` fires once per failure, isolated. The dialog also shows
  `labels.io.importFailedWithMessage(message)` when the error is an `Error` with a non-empty
  message (cut at 200 characters, a React text node); otherwise the existing generic line.
- `file` prop: when set while the dialog is open and no file was loaded yet, the dialog loads it
  as if it was chosen. A different `file` replaces the preview.
- `build()` result: `{ rows, rejected }` or `null` when `processImportRows` returned `false`.

## F1. Find and replace `onReplace`

`useDataGridFindReplace({ onReplace })`: `(ctx: { plan: ReplacePlan; signal: AbortSignal }) =>
ReplacePlan | false | Promise<ReplacePlan | false>`. Runs after `planReplace`, before
`actions.updateCells`. `false` vetoes: nothing is written, the status line shows the cancelled text.
The returned patches are bounded after the hook by `replaceAllLimit` (more patches is a veto with a
dev warning). Each patch value is written as given, with no `fromText`, and goes through `validate` inside `updateCells`.
A newer replace or closing the panel aborts the signal; a late answer is dropped, and the store is
read again after the `await`.

## Security

Every hook output passes the existing bound after the hook (`ImportLimits`, `MAX_CELL_TEXT`,
`replaceAllLimit`, `maxRows`, `maxBytes`). `formatCell` and `processCellFromText` outputs are
data, never markup. `output` gets a finished Blob. `csvEncoding` comes from a fixed list.
A hook cannot raise a bound.

## Parity per hook point

| Hook point | L | PC | PS | Z | C | SS/FS | API |
|---|---|---|---|---|---|---|---|
| export `output`, `columns`, `formatCell`, `buildCsv` | same | same | same | same | same | same | same |
| export `source` + `columnIds` | n/a | source | source (spec + columns reach the server) | source | source | source | source |
| import hooks | same | same | `onImport` sends to the server | same | same | same | same |
| find-replace `onReplace` | same | loaded page | loaded page | loaded blocks | same | loaded rows | loaded rows |

All hooks run in the browser on rows the grid or the caller holds. Server grids reach the server
through `source` (export) and `onImport` (import); neither hook changes what the server receives
except `columnIds`.

## Not done

Header override, async `formatCell`, import `valueMode: "raw"` (I9), print `source` and `css`
(P1, P2), `validateRow` on import (I7, write-path branch).
