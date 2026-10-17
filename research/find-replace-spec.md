# Spec: find and replace (W6-09, FEAT-5)

## Goal

Users replace text across the grid without leaving it: one match at a time or every match in the
view, through each column's text codec and validation, as one undoable change. Find shares the
existing quick search, so highlights and replace targets are always the same cells.

Written against the API after Wave 5 and W6-05: `CellRef`, the imperative handle, commands,
plugins, `commitChange`, and the store-level `readOnly` guard.

## Current state (verified)

- Quick search lives in the store: `searchText` (sync prop, `store/types.ts:153-155`),
  `actions.setSearch` (`store/create-store.ts:606-608`), `computeSearchMatches`
  (`store/compute.ts:616-646`). Matching is case-insensitive substring over
  `toSearchText ?? toText` of the visible columns (`sort-filter/find-search-matches.ts:13-34`).
  Search never narrows `viewIndex` (`store/compute.ts:542`).
- `searchMatches` is capped at `MAX_SEARCH_MATCHES = 1000` (`store/compute.ts:598`); next/prev in
  `data-grid-toolbar/search.tsx` walks that capped list.
- Every write recomputes search matches (`store/data-write.ts:144,160,474,499`).
- `updateCells` is id-keyed, validates, skips read-only and no-op cells, reports a verdict with
  skip reasons, and never moves the selection or the edit session (`store/types.ts:313-411,746-753`).
- `DataChange.source` has no `"replace"` member (`types.ts:186`); history records the sources in
  `DEFAULT_RECORD_SOURCES` (`data-grid-history/use-data-grid-history.ts:44-53`).
- `fromText` never throws and returns the type's empty value for text it cannot parse
  (`cell-types/cell-types.test.tsx:91-94` for `number`). A blind replace could therefore clear a
  number cell.
- `Cmd+H` on macOS hides the application; a page cannot intercept it.

## Decisions

1. **Find is the store's quick search.** The panel's Find field writes `actions.setSearch`. The store
   gains search options, so highlights, next/prev, and replace targets agree. Rejected: a separate
   find state in the add-on — two highlight sets that disagree under `matchCase`.
2. **Literal matching only.** Options: `matchCase` (default `false`) and `wholeCell` (default
   `false`). Rejected: regular expressions — user-typed patterns are a ReDoS vector on 100k-row
   scans, and the decision rule puts security first.
3. **Replace operates on the search text and writes through `fromText`.** For each target cell:
   `text = toSearchText ?? toText`, replace the occurrences, then `fromText(next, options)`. A select
   label maps back to its value; a date or number reparses. Rejected: replacing inside `String(value)`
   — the user sees labels and formatted text, not stored values.
4. **Unparseable results skip.** When `next.trim() !== ""` and the parsed value is empty by the type's
   `isEmpty`, the cell skips with reason `"unparseable"`. Rejected: write the empty value — replacing
   `5` with `x` in a number column would silently clear data.
5. **The write is one `updateCells` batch** with `source: "replace"`, `reorder: "defer"`,
   `skipValidation: false`. It validates, skips read-only cells, keeps rows in place while the panel
   is open (the match cursor stays stable), and returns the verdict the panel reports. Undo goes
   through history's `commitChange` path (W6-05). Rejected: `applyCellUpdates` — it moves the
   selection to the touched rect and takes view coordinates.
6. **Scope is the view.** Visible columns of the rows in `viewIndex`; hidden columns, filtered-out
   rows, pinned rows, and lazy holes never change. Optional `scope: "selection"` limits targets to the
   selected cells. Rejected: whole `data` — it would change rows the user cannot see.
7. **Replace all is bounded.** One action writes at most `replaceAllLimit` cells (default 10,000)
   and reports whether more remain; the next click continues. Rejected: unbounded — one click could
   build a 2M-op `DataChange` and a history entry of the same size.
8. **New add-on `data-grid-find-replace`**, shipped as a W5-13 plugin: a `Mount` renders the panel
   through a portal anchored to the grid root, `commands.openFindReplace` opens it, and
   `keymap.openFindReplace` binds `ctrl+h` and `mod+alt+f`. Rejected: extending
   `data-grid-toolbar` — a toolbar install would carry the replace engine for every consumer;
   rejected: `mod+h` — it is dead on macOS.

## API

```ts
// core: types.ts / store/types.ts
type DataChangeSource = DataChange<unknown>["source"]; // gains "replace"
type SearchOptions = { matchCase?: boolean; wholeCell?: boolean };
// DataGridSyncProps: searchOptions?: SearchOptions (controlled with searchText)
// DataGridActions: setSearch(text: string, options?: SearchOptions): void
// DataGridStoreState: searchOptions: Required<SearchOptions>

// data-grid-find-replace
type ReplaceOptions = SearchOptions & {
  scope?: "view" | "selection";   // default "view"
  replaceAllLimit?: number;       // default 10_000, clamped to [1, 100_000]
};
type ReplaceSkip = UpdateCellsSkip["reason"] | "unparseable" | "too-long";
type ReplaceResult = { replaced: number; skipped: { ref: CellRef; reason: ReplaceSkip }[]; remaining: boolean };

function planReplace(state: DataGridReadState, find: string, replacement: string,
  options: ReplaceOptions & { only?: CellRef }): { patches: CellPatch[]; skipped: ReplaceResult["skipped"]; remaining: boolean };

function useDataGridFindReplace<TData>(options?: ReplaceOptions & { labels?: Partial<FindReplaceLabels> }): {
  plugin: DataGridPlugin<TData>;
  open(mode?: "find" | "replace"): void;
  close(): void;
};
```

`planReplace` is a pure function over the read-only state (W5-13 `DataGridReadState`), so the panel,
a consumer button, or a custom command reuse it. The panel calls
`api.actions.updateCells(patches, { source: "replace", reorder: "defer" })`.

## Behavior

- **Panel.** Fields Find and Replace, toggles Match case and Whole cell, buttons Previous, Next,
  Replace, Replace all, and a status line ("3 of 17", "12 replaced, 2 skipped (read-only)").
  `Enter` in Find = Next, `shift+Enter` = Previous, `Enter` in Replace = Replace, `mod+Enter` in
  Replace = Replace all, `Escape` closes and returns focus through `api.focus()`.
- **Replace (one).** Targets the current match; when the active cell is a match, that cell. After the
  write the cursor moves to the next match (`actions.setActiveCell(ref)` + `api.scrollTo(ref)`).
- **Selection and CellRef.** Targets are `CellRef`s from the start, so a view rebuild between plan
  and write never shifts a target (the R-04 cut rule). Replace does not change the selection;
  `onSelectionChange` does not fire.
- **Sort and filter.** `reorder: "defer"` keeps rows in place and flips `viewStale` when a sort or
  filter column changed; the view reconciles on the next sort/filter change or `reconcileView()`.
  The panel shows the existing stale indicator text when `viewStale` is set.
- **Editing.** Replace no-ops while an edit session is open (`editing !== null`). Clicking the panel
  blurs the editor first, which commits it by the existing blur rule.
- **Validation.** Sync `validate` rejects per cell (reason `"invalid"`). `onValidationError` fires
  with `source: "replace"`: R-52 makes `updateCells` fire it, and its source union gains
  `"replace"`. An async schema
  holds the batch (`pending: true`); the status line shows "Validating…" until it settles.
- **readOnly.** A read-only grid disables Replace and Replace all (find still works); read-only
  columns and rows skip with reason `"readonly"`. The store guard backs this up.
- **Clipboard and fill.** Unchanged. Exports and clipboard keep their formula neutralization, so a
  replacement that starts with `=` adds no new injection channel.
- **Plugins and commands.** `openFindReplace` has scope `"grid"`; its bindings never shadow a default
  or consumer binding (W5-13 conflict table). The command's `when` returns `true` in a read-only grid
  (find mode only).
- **History.** One click = one `DataChange` = one undo entry. `"replace"` joins
  `DEFAULT_RECORD_SOURCES`.

## Security

- Find and Replace are capped at 1,000 characters each (input `maxLength` and a clamp in
  `planReplace`).
- A cell whose replaced text exceeds 100,000 characters skips with `"too-long"`, so a short needle with
  many occurrences cannot blow up one cell.
- No regex, no `eval`, no HTML: the panel renders strings as text nodes.
- `replaceAllLimit` bounds work and history size per click.

## Performance

- `planReplace` scans `viewIndex` × visible columns once, stops at `replaceAllLimit` targets, and
  hoists the per-column text reader and lowercase needle out of the loop (the
  `findSearchMatches` pattern). No per-cell work happens on render or scroll.
- Budgets (new `data-grid-find-replace/plan-replace-perf.test.ts`, measured baseline + 20 %):
  full scan with no match at 100k rows × 10 text columns ≤ 250 ms; 10,000 replacements planned
  and written (`updateCells`, `"defer"`) ≤ 150 ms.
- The highlight cap stays at 1,000; Replace all does not depend on it.

## Accessibility

- The panel is a non-modal `role="dialog"` with `aria-label` from labels; it portals out of
  `role="grid"` (the `body.tsx:326-332` portal rule for non-row children).
- The status line is `role="status"`; each Replace / Replace all result is announced once.
- Toggles are `aria-pressed` buttons; all controls have labels in the i18n `labels.findReplace`
  group.

## Files to add or change

- Add `registry/default/blocks/data-grid-find-replace/`: `data-grid-find-replace.ts` (barrel),
  `plan-replace.ts`, `use-data-grid-find-replace.tsx`, `find-replace-panel.tsx`, tests.
- `data-grid/types.ts`: `"replace"` in `DataChange.source`; `SearchOptions`.
- `data-grid/store/types.ts`, `create-store.ts` (`setSearch`, `_syncProps` for `searchOptions`),
  `store/compute.ts` (`computeSearchMatches` takes options), `sort-filter/find-search-matches.ts`
  (case and whole-cell matching).
- `data-grid/labels.ts`: `findReplace` label group.
- `data-grid-history/use-data-grid-history.ts`: `"replace"` in `DEFAULT_RECORD_SOURCES`.
- `data-grid-toolbar/search.tsx`: pass `searchOptions` through unchanged (read-only display).
- `registry.json`: new item; payloads regenerated.

## Docs, registry, CHANGELOG

- New page `content/docs/addons/find-replace.mdx` (structure per AGENTS.md: paragraph, demo
  `data-grid-find-replace-demo`, install, behavior, props tables, warnings, Related).
- `sorting-filtering-search.mdx`: search options; `events-state.mdx`: `"replace"` source;
  `addons/undo-redo.mdx`: default sources list.
- CHANGELOG `### Added` (add-on, `searchOptions`, `"replace"` source). A consumer `switch` on
  `change.source` without a default branch gains a case, so mark it **Breaking:**.

## Test plan

- Unit `plan-replace.test.ts`: case and whole-cell matching; select label → value; number reparse;
  `"unparseable"` skip; read-only column and `readOnly(row)`; hidden column untouched; filtered row
  untouched; lazy hole skipped; `"too-long"`; `replaceAllLimit` with `remaining: true`; selection
  scope; input caps.
- Unit `find-replace.test.tsx`: one undo entry per click; source `"replace"`; no write while
  editing; `readOnly` disables replace; sorted grid keeps row positions (`viewStale`); async schema
  holds the batch; `onValidationError` fires.
- Unit (core): `computeSearchMatches` with `matchCase`/`wholeCell`; controlled `searchOptions`.
- Browser: `ctrl+h` opens the panel with focus in Find; Replace moves to the next match and scrolls
  it into view; Escape returns focus to the active cell; axe clean with the panel open.
- Perf: the two budgets above.

## Dependencies

- W6-05 (`commitChange`: history undo path, emit after set, store `readOnly` guard).
- W4-01 and R-35 (an open editor stays bound to its row while rows change).
- W5-08 (`CellRef`), W5-09/R-47 (handle anywhere under the provider), W5-10 (commands),
  W5-13 (plugins, `DataGridReadState`), R-52 (store-fired `onValidationError`).

## Open product questions

1. Default `replaceAllLimit`. Recommendation: 10,000 per click with a "more remain" status; it
   bounds history memory and keeps each click under one frame budget for the write.
2. Should Replace all also cover filtered-out rows? Recommendation: no; the view is what the user
   reviewed.
