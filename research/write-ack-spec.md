# Write acknowledgement

## Problem

`onDataChange` returns `void`. The grid cannot show that a write is pending, failed, or accepted.
The round-trip recipe rolls back the whole array when one request fails, including the requests the
server accepted. A cell error from a 422 stays after a whole-row rollback.

## Contract

`onDataChange` may return a promise of an acknowledgement. A `void` return works as before.

```ts
type WriteRejection = { rowId: string; columnId?: string; message?: string };
type WriteAck = void | { rejected: readonly WriteRejection[] };
onDataChange?: (next, change) => void | Promise<WriteAck>;
onWriteRejected?: (ctx: { change: DataChange; rejected: readonly WriteRejection[] }) => void;
```

- A promise that resolves with `void` or `{ rejected: [] }` accepts the whole change.
- `rejected` names the rows (and, for a cell update, the columns) the server refused. Everything
  else in the change stays accepted. `columnId` omitted rejects every op of the row.
- A promise that rejects refuses the whole change; `message` is the error's `message`.
- The ack is read for every `source` except `"rollback"` (a revert is never acknowledged). `"history"`
  (undo, redo) and `"stream"` are acknowledged like an edit.
- Plugin observers return `void` and never gate.

## Grid behavior

1. At emit, the rows of the change become `saving`: `data-write-status="saving"` on the row element and
   `useDataGridRowWriteStatus(rowId)`. `useDataGridPendingWriteCount()` is the number of unsettled
   acknowledged changes. A row with several pending changes stays `saving` until all settle.
2. At settle, the store is read again. Each rejected op is reverted with the history add-on's
   rollback builder (moved to the core): a cell reverts only while it still holds the rejected
   change's value, so a newer write to the same cell, made while the request was pending, supersedes
   the earlier verdict and survives. The revert is one `commitChange` with `source: "rollback"` and
   `reverts: change` (the `DataChange` it undoes). It runs the normal pipeline: one `onDataChange`
   (never acknowledged), cell errors of the reverted cells clear in the same step, history ignores it
   except that `useDataGridHistory` drops the entry named by `reverts`.
3. The rows of a rejected change are marked `failed` (`data-write-status="failed"`) until the next write
   to the row or `actions.clearWriteStatus()`.
4. `onWriteRejected({ change, rejected })` runs once per rejected change, after the revert, isolated
   with try/catch. It is the place for a toast. The message of a rejection is for that callback.
5. A `readOnly` grid at settle skips the revert (no write path may run) and warns once in development;
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
not acknowledged; `onWriteRejected` and a throwing callback; status map and count; `clearWriteStatus`;
history entry dropped; a promise that resolves after unmount. Browser: row attribute in the demo.
