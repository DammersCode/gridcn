# Grid event API (W5-05)

Decision record for the six new consumer-facing events. All six are new optional props on
`DataGridSyncProps` (store/types.ts), mirrored on `DataGridProps` with JSDoc, and fired from the
store layer or the cell's own DOM handlers — none of them is a veto point except `onEditStart`.

## API surface

| Prop | Signature | Fired from |
|---|---|---|
| `onActiveCellChange` | `(next: CellCoord \| null) => void` | `store.subscribe` on `state.activeCell` (provider.tsx), value-equality on row+col |
| `onEditStart` | `(coord: CellCoord) => boolean \| void` | `startEditing` store action, after the readOnly/unresolvable guards |
| `onEditEnd` | `(event: GridEditEndEvent) => void` | `commitCellEdit`, `cancelEditing`, `setEditingError` (create-store.ts) |
| `onValidationError` | `(event: GridValidationErrorEvent) => void` | paste tail (use-grid-clipboard.ts) and fill tail (data-grid-fill/use-fill-handle.ts) |
| `onCellDoubleClick` | `(ctx: CellClickCtx<TData, unknown>, event: MouseEvent) => void` | cell DOM `onDoubleClick` handler (cell.tsx) |
| `onCellContextMenu` | `(ctx: CellClickCtx<TData, unknown>, event: MouseEvent) => void` | cell DOM `onContextMenu` handler (cell.tsx) |

New payload types in the block-root `types.ts`, next to `CellClickCtx`/`OnCellClick`:

```ts
export type GridEditEndEvent = { coord: CellCoord; result: "commit" | "cancel" | "rejected" };
export type GridBulkValidationError = { viewRow: number; columnId: string; value: unknown; message: string };
export type GridValidationErrorEvent = { source: "paste" | "fill"; rejected: GridBulkValidationError[] };
```

## Firing semantics

- `onEditStart` is the only veto: returning `false` makes `startEditing` a no-op (no state write,
  no `onActiveCellChange`). `undefined`/`true` proceeds. Checkbox cells never call `startEditing`
  (they toggle), so the veto never applies to them.
- `onEditEnd` results:
  - `commit` — after the final `set` that closes the session in `commitCellEdit`, both the write
    and the no-op branches. The committed value is not included: `onDataChange` carries it.
  - `rejected` — a commit attempt was refused by validation and the session stays open: the sync
    error branch of `commitCellEdit` and `setEditingError` (async schemas). Fires alongside the
    `editingRejectionCount` bump, same trigger, same site.
  - `cancel` — `cancelEditing` when a session existed (Escape, blur-after-veto, programmatic).
  - No event for the stale-anchor identity discard in `commitCellEdit`: an internal race where a
    newer session supersedes the old one; the newer session owns the lifecycle. `commitCellValue`
    (checkbox) fires no edit events at all — it has no session.
- `onEditEnd` fires LAST, after the state write it reports: a commit delivers
  `onActiveCellChange` (cursor move) and `onSelectionChange` during the store write, then
  `onDataChange` once the write returns, then `onEditEnd({ result: "commit" })`. The order is
  `onActiveCellChange` → `onDataChange` → `onEditEnd`.
- `onActiveCellChange` uses value equality (row+col), not object identity: re-selecting the same
  cell through a path that allocates a new coord object does not fire. Fires with `null` when the
  active cell is cleared.
- `onValidationError` fires only when at least one cell was rejected, AFTER `applyCellUpdates`
  applied the accepted cells — so the accepted writes' `onDataChange`/`onSelectionChange`
  precede it. Async batches fire when the held batch settles and applies (same guard as the
  writes themselves; a superseded batch fires nothing). `rejected` lists view-space coords:
  `viewRow`/`columnId` match what the candidate would have written.
- `onCellDoubleClick` and `onCellContextMenu` are pure notifications in the `onCellClick`
  sense: they fire from the cell's own DOM handlers regardless of readOnly and regardless of
  whether the gesture does anything else (edit start, checkbox toggle, context menu open).
  Attached for the same cells `onDoubleClick` is attached for today (not pinned rows, not
  skeletons). The context-menu add-on is unaffected: it listens at the root, the cell handler
  only notifies.

## Implementation decisions

- All six live on `DataGridSyncProps` so the store layer can call them (`s.onEditStart?.()` etc.)
  and so the single-config-home direction (W5-12) is already the shape. The DOM events are read
  through `storeApi.getState()` inside the cell's event callbacks (event-time read, no prop
  threading, no re-render sensitivity) — the same pattern the interaction hooks use.
- `resolveBulkWrites` (validation/validate-batch.ts, sdk-exported) changes from
  `BulkWrite[] | Promise<BulkWrite[]>` to `BulkResolution | Promise<BulkResolution>` where
  `BulkResolution = { writes: BulkWrite[]; rejected: GridBulkValidationError[] }`. The sdk barrel
  is new on this unpushed branch, so the reshape breaks no published consumer; the only call
  sites are paste and fill. `keepPassing` collects the rejection list alongside the writes.
- `pasteText`/fill read the callback fresh off `storeApi.getState()` at fire time (async path),
  matching how every other sync-prop callback is read.

## Not doing

- No veto on `onCellDoubleClick`/`onCellContextMenu` (notifications only, same as `onCellClick`).
- No `onValidationError` for single-cell edits — `onEditEnd({ result: "rejected" })` plus the
  existing `editingError` state covers that surface.
- No event for `updateCells`/import rejections — those already report through their return
  values (`UpdateCellsVerdict.skipped`, `BuildImportedRowsResult.rejected`).
