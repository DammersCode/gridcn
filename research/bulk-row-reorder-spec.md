# Spec: bulk row reorder (W6-06, API-01)

## Goal

Move several rows at once, in three stages: a batch `reorderRows` (one `move` batch, one undo
entry), a multi-row drag from the grip, and keyboard reorder. Today `reorderRows(from, to)` moves
one row (`store/types.ts:781-792`, `store/data-write.ts:627-669`), a grip press drops a multi-row
check before the drag starts, and the docs state "There is no keyboard reorder."
(`content/docs/row-operations.mdx:80`).

Written against the API after Wave 5: W5-07 data-write module, W5-11 identity-following
selection, W6-05 `commitChange`, W5-10 commands.

## Decisions

1. **One change, one `move` op per moved row, batch index semantics.** Every op has `from` = the
   pre-batch data index and `to` = the distinct final post-batch index. Rationale: `applyChange`
   already deletes all moved ids first and inserts at final slots in ascending order
   (`interaction/history.ts:47-54,86-99,146`), and `invertChange` swaps `from`/`to`
   (`history.ts:22-24`), so apply and undo round-trip exactly. Rejected: a new `moveBlock` op type —
   every consumer op switch and server adapter would need a new case.
2. **Two public shapes on one engine.** `reorderRows(rows, to)` moves a block: the rows land
   contiguous, in their current order, starting at final index `to`. `moveRowsBy(rows, delta)`
   shifts each row by `delta` and keeps the gaps (keyboard). Both build their ops through one
   internal `buildRowMoves(s, finalIndexOf)`. Rejected: keyboard as a block move —
   stepping of rows 1, 3, 7 would collapse them into one block, which the user did not ask for.
3. **Keyboard: `shift+alt+ArrowUp` / `shift+alt+ArrowDown`.** New built-in actions
   `moveRowsUp`/`moveRowsDown`. Rationale: matching is exact on shift, alt, and mod
   (`keyboard/match-keymap.ts:45-60`); plain, `alt`, `mod`, `shift`, and `mod+shift` Arrow are
   taken (`keyboard/default-keymap.ts:10-38`). Rejected: `mod+alt+Arrow` — Ctrl+Alt is AltGr on
   Windows.
4. **A grip press keeps a multi-row check.** A plain press on the grip of a row already in the row
   channel defers `selectRow(i)` to a stationary release; a drag then moves the whole row channel.
   Today the press calls the exclusive `selectRow` at once (`interaction/use-grid-interaction.ts:1041-1045`).

## API

```ts
// DataGridActions (store/types.ts) — Breaking: rows widen from one index to a list
reorderRows(rows: number | readonly number[], to: number): boolean;  // view indices; to = final index of the block's first row
moveRowsBy(rows: readonly number[], delta: number): boolean;          // each row moves by delta; whole batch no-ops at an edge
// GridActions: moveRowsUp, moveRowsDown (default "shift+alt+ArrowUp" / "shift+alt+ArrowDown")
// labels.markers: reorderRowsAnnouncement(count: number, position: number, total: number): string
// labels.keybindings.actions: moveRowsUp, moveRowsDown
```

A single number keeps today's single-row semantics, so `reorderRows(2, 5)` is unchanged.

## Behavior

- **Stage 1 (store).** Duplicate indices are removed; the rows sort ascending. It returns `false`
  (no change, no event) when the block already sits at `to`, the list is empty, or an index is out
  of range. The write goes through W6-05 `commitChange` with `{ source: "row-op", ops }`: one
  `set`, emit after `set` (R-89), one history entry (the history plugin records `"row-op"` by
  default, `data-grid-history/use-data-grid-history.ts:44-53`).
- **Guards (unchanged set).** `enableRowReorder` off, `readOnly`, an open edit session (until
  R-35 lifts it), an active sort or filter (dev warning), lazy holes (dev warning)
  (`data-write.ts:629-649`).
- **Selection.** The batch builds one old→new view-row map and remaps the selection through W5-11
  `remapSelection`: the row channel and the active cell follow their records; a range stays only
  if it covers the same records, else collapses onto the active cell. `reorderSelectionForRow`
  (`selection/reorder-selection-for-row.ts:18-39`) is deleted.
- **Stage 2 (drag).** Rows dragged = the row channel when the pressed row is in it, else the
  pressed row. Dimming covers every dragged row. The drop calls `reorderRows(rows, to)` with `to`
  from `predictReorderTarget` (`rows/use-row-reorder.ts:14-17`), adjusted for the rows removed
  above the target. A stationary press without a drag selects only that row (today's result).
  The body keeps the origin row mounted during a drag (`body.tsx:109-129` adds it like the
  off-window active row), so a touch drag survives autoscroll past the window (fixes R-78).
- **Stage 3 (keyboard).** Target rows: the row channel if non-empty, else the rows of the
  primary range (`getSelectedViewRows`, `selection/selected-view-rows.ts:10-21`), else the active
  cell's row. Each press is one change and one undo entry. At the top or bottom edge the press
  does nothing.
- **Editing / plugins / commands.** The actions are `scope: "grid"`; an open editor owns the key
  (R4 decision). A consumer or plugin command named `moveRowsUp` shadows the built-in with the
  usual dev warning.

## Security

No untrusted input. A forged list (`reorderRows` from app code with 1M indices) is bounded by the
view length after dedupe; out-of-range indices fail the whole call.

## Performance

- One O(n) data rebuild and one O(n) view-row map per gesture or key press; nothing per drag
  frame beyond today's hit test.
- Dimming reads `useDataGridIsRowChannelSelected(viewRow)` (`store/hooks.ts:448`) in the marker
  cell only, behind a "dragging" flag in the reorder context; data cells do no new work.
- Perf test budget: a 1,000-row batch at 100k rows, apply plus selection remap.

## Accessibility

- The live region (`body.tsx:326-332`) announces `reorderRowsAnnouncement(count, position,
  total)` for a batch ("3 rows moved to position 5 of 8") and the existing single-row text for
  one row.
- Keyboard reorder makes the gesture reachable without a pointer; the keybindings dialog lists
  both actions under `"editing"` (`data-grid-keybindings/action-groups.ts:26-80`).

## Files

- Change: `store/data-write.ts`, `store/types.ts`, `types.ts` (`GridActions`), `keyboard/default-keymap.ts`,
  `interaction/use-grid-interaction.ts` (grip press, two action cases), `rows/use-row-reorder.ts`,
  `rows/marker-cell.tsx`, `body.tsx`, `labels.ts`, `data-grid-keybindings/action-groups.ts`.
- Delete: `selection/reorder-selection-for-row.ts` (with its barrel export, `selection/index.ts:15`).
- Fix sequential move handling: `registry/default/examples/fake-remote-server.ts:115-128`
  (apply via `applyChange`), `content/docs/recipes.mdx:61-63`.

## Docs, registry, CHANGELOG

- `row-operations.mdx`: batch and keyboard reorder; drop "There is no keyboard reorder."; a warn
  callout that a server must apply a batch with snapshot semantics, never op by op.
- `examples/rows/drag-reorder.mdx` and the reorder demo: multi-row drag; "Move selection down"
  uses `moveRowsBy`. `events-state.mdx` and `api-reference.mdx`: multi-op `move` batches.
- CHANGELOG: `**Breaking:**` `reorderRows` takes a list; `### Added` `moveRowsBy`, the two keys,
  the batch announcement; `### Fixed` the grip press dropping a multi-row check.

## Test plan

- Unit `history.test.ts`: a multi-move batch (block to end, block to start, disjoint rows) applies
  and inverts back to the original order.
- Unit `row-ops.test.tsx`: block move emits k ops with distinct final `to`; `moveRowsBy` keeps
  gaps; edge press no-ops; every guard; duplicates deduped; one undo restores the order;
  controlled consumer applying via `applyChange` matches the uncontrolled result.
- Browser `row-reorder.browser.test.tsx`: drag three checked rows (contiguous and disjoint);
  stationary press still selects one row (replaces the test at `:296`); touch drag past the window
  with autoscroll; `shift+alt+ArrowDown` moves the row channel; announcement text.
- Perf: 1,000-row batch at 100k rows under the recorded budget.

## Dependencies

W2-09 (done), W5-07, W5-11 (`remapSelection`), W6-05 (`commitChange`), W5-10 (built-in action
labels and dialog); R-78 folds into stage 2.

## Open product questions

1. Should a burst of keyboard moves merge into one undo entry? Recommendation: no — one entry per
   press is predictable, and history capacity (100) covers normal use.
