# Keep checked rows across filters

Status: implemented in 1.2.0. `keepCheckedRows` keeps checked rows across cell clicks and outside clicks; `keepHiddenCheckedRows` keeps the rows a filter hides.

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

## Delete confirmation hook (stage 2)

Deleting rows is the destructive path. The grid ships no dialog; the app owns its design.

- New prop `onBeforeDeleteRows?: (ctx: { rowIds: readonly RowId[]; hiddenCount: number }) => boolean | Promise<boolean>`. It runs before every row delete the grid starts: keyboard `deleteRows`, the context-menu row items, and the cut of whole rows if cut ever acts on checked rows. Returning `false` cancels.
- `rowIds` holds the rows the action will remove (visible checks, or the range when none are checked). `hiddenCount` is the number of hidden checked rows that stay untouched, so the dialog can say "Delete 3 rows (2 hidden stay)".
- A pending promise blocks a second delete. After the await the grid reads the store again and drops the result if `readOnly`, the row set, or the checks changed.
- Undo restores a confirmed delete as today.
- Docs recipe: a confirm dialog built with the app's own dialog component.
- Without the prop nothing changes: delete runs at once.

## Open points

- Decided: cut stays a cell-range operation. It never removes whole rows, so it needs no hook.
- Cell-range Delete only clears contents and is covered by undo; it gets no hook.

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
