# Server aggregates for pinned rows and the lookup cell (2.0.0, gaps H and J2)

Modes: L local, PC client pages, PS server pages, Z scroll rows, C controlled state, SS server sort,
FS server filter, API own write-through (`research/parity-matrix.json`).

## H. Server aggregates

`useDataGridPinnedRows` takes a band row from the caller. `useDataGridAggregate` fills it from the rows
the grid holds, which is wrong when the grid holds one page or some blocks. The new
`useDataGridServerAggregate` (and `DataGridServerAggregateReporter`, which bridges out of the provider like
`DataGridAggregateReporter`) asks the caller instead.

- Request: `fetchAggregates({ spec, columnIds, signal })` resolves `{ [columnId]: value }` for the whole result
  of `spec`. `spec` is the `ServerSpec` of the grid (`sortState`, `filterState`, `searchText`).
- Refetch key: the filters and the quick-search text. A sort never changes which rows an aggregate covers; a
  server may narrow by `searchText`, so a search change asks again. The request carries the whole spec.
- Race safety: one `AbortController` per request; a new aggregate key, `refresh`, `retry`, and unmount abort it. A
  settled answer applies only when its signal is not aborted. Filter and search bursts wait `debounceMs` (default 150).
- State (adds `stale` to the D3 `loading | error | ready` set because old values stay on screen): `loading` (no values yet), `stale` (old values while a newer request runs), `ready`, `error` (old values
  stay). `useDataGridPinnedRows({ status })` dims the bands and sets `aria-busy` and `data-status`.
- Untrusted answer: not an object is an error; only requested column ids are read through `hasOwnProperty`; text is cut
  at 1000 characters; only text, finite numbers, booleans, and `null` pass. Values then flow through each column's
  cell type like any pinned cell (`toSafeText`).
- Mode table: L and PC keep `useDataGridAggregate` (rows are all there or the page is the intent). PS, Z, C, SS, FS
  and API use `fetchAggregates`; the hook does not read `data`, so it behaves the same in each. The caller decides
  what the server evaluates; the filter tree is sent as is, and the server bounds it (see `server-side.mdx`).
- Out of scope: automatic refetch after a save (`refresh()` is the hook for it); `topRows` status split per band.

## J2. Lookup cell type

A `data-grid-lookup` item with `lookupCellType`. Column options: `fetchOptions({ query, signal })`,
`debounceMs`, `minQueryLength`, `maxResults`, `unresolvedPaste`, `labels`.

- Value: `{ value, label } | null`. A bare string or number reads as an unresolved value (key shown muted, `data-unresolved`).
  No filter-value shape exists in `api-cohesion-2.0.md`, so the pair is defined here.
- Contract: `toText` = label (and remembers the option), `fromText` = remembered label or key, else `null`
  (`unresolvedPaste: "keep"` stores the text as a key with an empty label, shown as unresolved), never throws, input clipped to 256 characters.
  `isEmpty` = no readable key, `clearValue` = `null`, `compare` and `toSearchText` use the label, `filter.match`
  matches the label with the text operators. The remembered options live in a bounded (5000) per-`fetchOptions` map.
- Editor: Base UI popover as in `date`, input debounced with `useDebouncedInput` (`debounceMs` or `inputDebounceMs`;
  IME composition commits at its end), combobox/listbox roles, `aria-activedescendant`, a polite status line.
  ArrowUp/Down move, Enter picks (or flushes a pending search first), Escape cancels; click picks. One request per
  query; typing aborts the older one; a late answer is dropped; errors show a Retry button.
- Answer bounds: array only; entries need a non-empty `value` (text or finite number, stored as text) and a string `label`; an empty label falls back to the key; duplicates dropped; both cut
  at 256; at most `maxResults` (default 50, cap 200). Labels render as text nodes.
- readOnly: the core opens no editor. Fill copies the stored pair. Paste and import go through `fromText`.
- Limits: the server filter value is the label text (a server compares labels); no multi-select; the option cache
  needs a stable `fetchOptions` identity.
