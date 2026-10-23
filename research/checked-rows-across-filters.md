# Keep checked rows across filters

Status: proposed. Not implemented. `keepCheckedRows` (shipped) keeps checked rows across cell clicks and outside clicks; a filter still unchecks the rows it hides.

## Goal

With an opt-in option, a row the user checked stays remembered while a filter hides it, and is checked again when the filter no longer hides it. Actions never touch rows the user cannot see.

## Why it is not trivial

- The Row channel of `GridSelection` stores view indexes. A hidden row has no view index, so it leaves the channel when the view rebuilds (`remapRowChannel`).
- Every reader of "checked rows" assumes the rows are visible: delete, duplicate, move, context-menu row items, export scope "selection", clipboard, status bar count, header checkbox tri-state, `setAllRowsSelected`, `getRowIds`, controlled `selection`.
- A destructive action on a checked row the user cannot see is the main risk.

## Design

- New option `keepHiddenCheckedRows?: boolean`, default `false`. It has an effect only when `keepCheckedRows` is `true` and the data is client-side.
- A second store field holds hidden checked rows by row id (`hiddenCheckedRowIds`, a set). The view-index Row channel stays the only source for visible checks.
- On a view rebuild: checked rows that leave the view move into the set; rows in the set that re-enter the view move back into the Row channel.
- Actions read only the Row channel (visible checks). They never read the set. This is the safety rule.
- Display: the selection count shows hidden checks separately, for example `1 selected (+3 hidden)`, through a label and a hook (`useDataGridHiddenCheckedCount`).
- Clearing: Escape, `clearSelection()`, `setSelection(null)` and the header checkbox "uncheck all" clear both. Deleting rows removes their ids from the set. A data swap drops ids that no longer exist.
- Select all stays "all rows of the view". It does not add hidden rows.
- Server and lazy sources: the option is ignored. Ids are not loaded and the total is unknown. Dev warning once per instance.

## Bounds

- Cap the set at 100000 ids. Beyond the cap, new hidden checks are dropped and `onHiddenCheckedOverflow` is not added; the dev warning names the cap.
- Controlled `selection` carries visible rows only. Hidden ids are exposed through a read hook, not through the controlled prop.

## Tests (first)

- Unit: filter hides checked rows -> set holds ids, Row channel empty; filter removed -> rows checked again; sort keeps both; delete of visible check removes only that row; data swap drops stale ids; cap.
- Browser: check A, B, C; filter to D; Delete with no visible check does nothing; the count shows `(+3 hidden)`; clear filter -> A, B, C checked.
- Server and lazy: option ignored, dev warning once.
- Perf: 100000 checks through a filter change stay within the existing selection perf budget.

## Docs

`selection-keyboard.mdx` section "Checked rows" (props row and behavior). `row-operations.mdx` states that actions use visible checks only. `CHANGELOG.md` entry. `GLOSSARY.md`: add "hidden checked row".

## Effort and risk

About 4 to 6 days. Risk is high for destructive paths, so every row action gets a test that hidden checks are untouched.
