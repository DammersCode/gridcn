# Write path for 2.0: conflicts, id swap, write-state a11y, gate abort, history

Scope: save conflicts (S4), server-assigned ids (E), write-state accessibility (SF10), `AbortSignal` and
pending state for async gates (SF9), undo and redo over unloaded, refused, server-changed and swapped
rows (G8), history across dataset swaps (R), warning hygiene (S). Builds on `write-ack-spec.md`
(Decision D) and `api-cohesion-2.0.md` (D4 names: `onSave`, `SaveAck`, `SaveRejection`,
`onSaveRejected`, `RowSaveStatus`).

Modes: every item is store-level, so it holds in local (uncontrolled), controlled `data`, client and
server pagination, lazy and scroll rows, `sortMode` and `filterMode` `"server"`, and own-API mode
(`onSave` is the API). The notes per item say where a mode differs.

## 1. Save conflicts (S4)

`SaveRejection.current` already puts the server's row in place of the refused one. A new prop lets the
app decide:

```ts
resolveSaveConflict?: (ctx: SaveConflictContext<TData>) => SaveResolution<TData> | PromiseLike<SaveResolution<TData>>;
type SaveConflictContext<TData> = {
  rowId: string;
  mine: TData;        // the row in the grid now
  theirs: TData;      // SaveRejection.current
  change: DataChange<TData>; // the refused change
  message?: string;   // SaveRejection.message
  signal: AbortSignal;
};
type SaveResolution<TData> = "theirs" | "mine" | { row: TData } | void;
```

- Called once per refused row that has a usable `current` and exists in `data`. A refused insert or
  delete is not a conflict (the revert removes or restores the row).
- `"theirs"` and `void` are today's behavior: the row becomes `theirs`, as part of the `"rollback"`
  change.
- `"mine"` and `{ row }` keep the user's intent on top of the server's row. The grid commits one
  `"merge"` change: `update` with `prev: theirs` and `row: mine` (or the merged row). `onSave` receives
  it, so the app saves again with the version it now knows. `"merge"` is not recorded by history.
- A returned `row` must have id `rowId`; another id falls back to `"theirs"` with one warning.
- A throw, a rejected promise or any answer that is not `"theirs"`, `"mine"` or `{ row }` falls back to `"theirs"` (a throw and a rejection also log).
- A refused `"merge"` change that carries `current` calls the resolver again, with the merge change as `change`. The resolver stops the loop by answering `"theirs"`. `"mine"` commits the whole row, so it overwrites fields that another user changed; `{ row }` merges field by field.
- While an async resolver is pending the row stays `saving`. If a newer write to the row starts, or
  the grid unmounts, `signal` aborts and the answer is ignored: the plain per-cell revert applies, as
  for any superseded refusal.
- Several writes to one row in flight: only the write that is the latest write of the row, and
  whose settle finds no other pending write of that row, can conflict-resolve. Every other refused
  write reverts per cell and drops `current`. Two refusals to one cell end at the value before the
  first (existing rule).
- `readOnly` at settle: no resolver call, no revert (existing rule).
- `onSaveRejected` runs after all of it and lists every refusal; a resolved conflict is still a
  refusal of the first write.
- A change that took server content carries `serverRowIds` (the ids whose row came from `current` or
  from the resolver). History drops older entry ops for those ids (section 5).

## 2. Server-assigned ids (E)

`actions.replaceRowId(oldId: string, row: TData): void`. `row` is the server's row; `getRowId(row)` is
the new id.

- One write: the data row at the same position becomes `row`. `onDataChange` fires once with
  `source: "id-swap"` and an `update` op (`rowId: oldId`), so a controlled `data` follows. `onSave`
  does not see it (like `"rollback"`, `"stream"`). It is not recorded by history.
- The view does not re-sort: the row keeps its view position, `viewStale` turns on when a sort or
  filter input changed (same rule as `updateCells`). The active cell, the selection and the open edit
  session keep their cells.
- Id-keyed state follows in the same `set`: `editing.rowId`, `cellErrors`, `hiddenCheckedRowIds`,
  `saveStatus`, the pending, failed, latest-write and resolving maps, and the refused-value chains.
  Flashes of the row end. An in-flight `validateRow` verdict of the row is cancelled and `validateRow`
  runs again for the swapped row.
- `actions.replaceRowIds(swaps)` swaps many rows in one write and one `onDataChange`; `replaceRowId` is
  its one-row form. A swap that fails its checks is skipped with a warning; the others apply.
- A swap that keeps the id (the server accepts the client id) replaces the row and changes no bookkeeping.
- A pending gate that waits on the swapped row (an open delete confirmation, `createRow`,
  `duplicateRow` or `onEditStart` on the row) is aborted: the swap changes the id-to-position map.
- A save still in flight for `oldId` settles against the new id: each in-flight write keeps its own alias
  map, so a later row that reuses `oldId` is unaffected. An ack that names either id works. A revert of such a change is per cell; a whole-row `update` revert cannot restore
  an old-id snapshot and is skipped.
- History rewrites its entries: every op with `rowId === oldId` gets the new id, and each snapshot of
  that row takes the fields that differ between the old and the new row (plain objects). A snapshot
  that is not a plain object drops the entry.
- No-op on `readOnly`; no-op with one development warning per instance: unknown `oldId`, a `row` whose id is
  held by another row, a throwing `getRowId`.
- Modes: local and controlled as above. Pagination and lazy rows: the row must be in `data` (an
  evicted or other-page row has nothing to swap; the app swaps the id in its own cache and the next
  fetch brings the new id). Server sort and filter: the position never moves until the app refreshes.

## 3. Accessibility of write states (SF10)

- A row with save status `saving` carries `aria-busy="true"` (a skeleton row keeps its own).
- A refused save announces through the live region: kind `saveRejected`, `count` = refused rows.
  Label `labels.grid.saveRejected(count)`; default English text: "{n} row(s) not saved". Only for
  rejections the grid read (ack or thrown), once per settled change. `readOnly` still announces.
- Default look on the row, semantic tokens only: `saving` is `text-muted-foreground`; `failed` is
  `bg-destructive/10`. A consumer overrides it with `getRowClassName` or CSS on
  `[data-save-status]`.
- The attribute stays `data-save-status` (the 2.0 name).

## 4. Async gates: `AbortSignal` and pending state (SF9)

Gates: `processPaste`, `validateRow`, `onEditStart`, `createRow`, `duplicateRow`, `onBeforeDeleteRows`
and the import hooks (`mapColumn`, the import `createRow`).

- Every gate gets `signal` as the last argument: `processPaste({ cells, target, signal })`,
  `validateRow(row, rowId, { signal })`, `onEditStart(cell)` becomes `onEditStart(cell, { signal })`,
  `createRow(index, { signal })`, `duplicateRow(row, index, { signal })`,
  `onBeforeDeleteRows({ rowIds, hiddenCount, signal })`, `mapColumn(header, index, { signal })`.
- The signal aborts when a newer run of the same gate supersedes this one (a `validateRow` of the same
  row, an `onEditStart` after the cursor moved or Escape), when the grid unmounts, and when the
  result can no longer apply (the dataset changed). An aborted gate result is dropped; the store is
  read again after every await, and `readOnly` re-checked.
- Pending state: `useDataGridGatePending()` returns the set of gate names that run now. The
  grid root carries `data-gate-pending` (space separated names) while the set is
  not empty.
- A second request for a latch gate (`createRow`, `duplicateRow`, `processPaste`,
  `onBeforeDeleteRows`) still warns once per instance and is ignored.

## 5. Undo and redo over unloaded, refused and server-changed rows (G8)

Before `undo` or `redo` writes, the plugin checks that every row the change needs is in `data`
(update, delete and move need the row; insert does not).

| Case | Result |
|---|---|
| all needed rows loaded | applied |
| a needed row is a hole (sparse `data`) | not applied, entry stays, `onSkip` with `"rows-not-loaded"` and an announcement; the user loads the rows and retries |
| a needed row is gone (dense `data`) | not applied, entry dropped, `onSkip` with `"rows-gone"` and an announcement |
| `readOnly` | no-op (unchanged) |

- Own-API mode: the plugin learns the verdict of the save of an undo or redo. A refused `"history"`
  change reverts through `"rollback"` and the plugin puts the entry back where it was (an undo that
  failed is on the undo stack again, a redo that failed on the redo stack).
- A refused ordinary change drops its entry (existing).
- A change with `serverRowIds` (the server's content replaced the row) makes older entries stale for
  those rows: the plugin removes their ops on those ids, and an entry left without ops goes.
- Undo of a row with a save in flight is allowed. It is one more write; `onSave` receives it after the
  first one, and the server orders them.

## 6. History across dataset swaps (R)

- A `datasetKey` change clears both stacks without `onSkip`: the swap is the app's own action.
- Without `datasetKey`, `replaceData`, a page change and a `data` prop swap leave entries whose rows
  are gone. The check in section 5 handles them: an undo over such an entry is `"rows-gone"`, never a
  silent no-op. Pagination keeps client pages in one `data` (no swap). Server pagination swaps; pass
  `datasetKey={page}` to clear eagerly, or let the check drop entries one undo at a time.

## 7. Warning hygiene (S)

Module-level `let warned…` flags in the code this change touches move into the instance (history
plugin, store commit helpers) and stay `isDev` only: `warnedSparseData` (history),
`warnedBothDataProps`, `warnedExternalStoreSyncProps`, `warnedBothSelectionProps` (store commit). The
store factory owns the flags and each warns once per grid.

## Tests

Unit (store): conflict resolver (theirs, mine, merged, bad id, throw, async, supersede, unmount,
readOnly, two writes in flight, cell-level `columnId`); `replaceRowId` (state following, controlled
echo, in-flight ack, history rewrite, bad inputs); gate signals (abort on supersede and unmount,
pending set); history checks (unloaded, gone, refused undo, server-changed); warnings once per
instance. Browser: row `aria-busy`, live-region text, `data-gate-pending` on the root. Both client
(local `data`) and server (`onSave` mock) paths.
