# Save acknowledgement

## Problem

`onDataChange` returns `void`. The grid cannot show that a write is pending, failed, or accepted.
The round-trip recipe rolls back the whole array when one request fails, including the requests the
server accepted. A cell error from a 422 stays after a whole-row rollback.

## Decision D (supersedes the contract below where they differ)

The state channel and the save channel are separate. `onDataChange(next, change)` returns nothing and
carries every change of `data` once, rollbacks included. `onSave(change)` is the only place that returns an
ack; it is never called for `source: "rollback"` or `source: "stream"`. `SaveAck<TData>` and
`SaveRejection<TData>` carry an optional `current` row: the revert puts it in place of the refused row
when no newer write to the row is pending; a refused delete restores it, a refused insert removes the row;
a `current` whose id differs from `rowId` (or whose `getRowId` throws) is dropped with one development warning. `current` applies only while the refused change is the latest write to the row: a newer write, pending or already settled, wins. A refused move keeps its position revert; `current` replaces content only. Order after the
outermost write: `onDataChange`, `onSave`, observers, each isolated. A `readOnly` grid skips the revert and
`current`, warns once, and still calls `onSaveRejected`. Undo and redo (`"history"`) reach `onSave`.

## Contract

`onDataChange` may return a promise of an acknowledgement. A `void` return works as before.

```ts
type SaveRejection = { rowId: string; columnId?: string; message?: string };
type SaveAck = void | { rejected: readonly SaveRejection[] };
onDataChange?: (next, change) => void | Promise<SaveAck>;
onSaveRejected?: (ctx: { change: DataChange; rejected: readonly SaveRejection[] }) => void;
```

- A promise that resolves with `void` or `{ rejected: [] }` accepts the whole change.
- `rejected` names the rows (and, for a cell update, the columns) the server refused. Everything
  else in the change stays accepted. `columnId` omitted rejects every op of the row.
- A promise that rejects refuses the whole change; `message` is the error's `message`.
- The ack is read for every `source` except `"rollback"` (a revert is never acknowledged). `"history"`
  (undo, redo) and `"stream"` are acknowledged like an edit.
- Plugin observers return `void` and never gate.

## Grid behavior

1. At emit, the rows of the change become `saving`: `data-save-status="saving"` on the row element and
   `useDataGridRowSaveStatus(rowId)`. `useDataGridPendingSaveCount()` is the number of unsettled
   acknowledged changes. A row with several pending changes stays `saving` until all settle.
2. At settle, the store is read again. Each rejected op is reverted with the history add-on's
   rollback builder (moved to the core): a cell reverts only while it still holds the rejected
   change's value, so a newer write to the same cell, made while the request was pending, supersedes
   the earlier verdict and survives. The revert is one `commitChange` with `source: "rollback"` and
   `reverts: change` (the `DataChange` it undoes). It runs the normal pipeline: one `onDataChange`
   (never acknowledged), cell errors of the reverted cells clear in the same step, history ignores it
   except that `useDataGridHistory` drops the entry named by `reverts`.
3. The rows of a rejected change are marked `failed` (`data-save-status="failed"`) until the next write
   to the row or `actions.clearSaveStatus()`.
4. `onSaveRejected({ change, rejected })` runs once per rejected change, after the revert, isolated
   with try/catch. It is the place for a toast. The message of a rejection is for that callback.
5. An ack that settles after the grid unmounted does nothing. Two refused writes to one cell end at the value before the first.
6. A `readOnly` grid at settle skips the revert (no write path may run) and warns once in development;
   the rows still turn `failed`.

## Modes

| Mode | Behavior |
|---|---|
| Local array, uncontrolled | the revert changes the store's array and emits a rollback |
| Controlled `data` | the consumer's `onDataChange` receives the rollback and stores it, like any write |
| Client and server pagination | same; a page change before settle keeps working: ops are matched by row id, and a row that left `data` has nothing to revert |
| Lazy rows | same; an evicted row has nothing to revert (the hook's dropped-edit warning applies) |
| `sortMode` and `filterMode` `"server"` | same; the revert never re-sorts |
| Streaming (`updateCells`) | an acknowledged `onDataChange` works; a stream rarely returns a promise |

## Server contract

The consumer maps one change to its requests and answers with the rows the server refused, for
example `{ rejected: results.filter(r => !r.ok).map(r => ({ rowId: r.id, message: r.error })) }`.
The grid never sends anything. A message is display text for the consumer's own UI; the grid does not
render it. Bounds: the grid reads at most 10,000 rejections per ack and ignores the rest.

## Tests

Unit (store): sync void unchanged; pending then success; partial rejection reverts only the named
rows; whole rejection; cell-level `columnId`; superseded write survives; readOnly at settle; rollback is
not acknowledged; `onSaveRejected` and a throwing callback; status map and count; `clearSaveStatus`;
history entry dropped; a promise that resolves after unmount. Browser: row attribute in the demo.
