# Per-cell server-error API (workplan #80)

User go (2026-08-01). Today a post-commit server rejection (422) has no surface — docs
recommend toast+revert or history undo. Goal: paint server errors on cells.

## Design

- Store state: `cellErrors: ReadonlyMap<string, string>` keyed `"rowId:columnId"` → message
  (flat map, cheap lookup, no per-row allocation when empty — EMPTY constant identity).
- Actions:
  `setCellErrors(errors: readonly { rowId; columnId; message }[])` (replaces per-key,
  merges into the map), `clearCellErrors(targets?: readonly { rowId; columnId }[])`
  (no arg = clear all).
- AUTO-CLEAR on successful commit: any commit path (single edit, paste, fill, updateCells)
  that writes a cell clears that cell's error — the user fixed it, the stale error must not
  linger. Server can re-set it if still wrong.
- Display: the cell renders the same error treatment as a sync validate rejection
  (ring/tint + message via title/tooltip, aria-invalid) — one visual language for "this
  value is wrong", regardless of who said so. Editor open on an errored cell shows the
  message like editingError does.
- Zero-render contract: follow the searchMatch pattern — the per-row derived state
  (useDataGridRowCellState) gains the row's errored columns; rows without errors keep
  identity; setting errors re-renders ONLY affected rows. Probe test required.
- Deleted/unknown rowIds in the map: ignored at render, pruned on row deletion (map
  maintenance audited like the rowId-index cache).
- History: setCellErrors is NOT a data change — no DataChange, no history entry, no
  onDataChange echo.
- Consumer story (recipes): mutation fails with a 422 field map → setCellErrors(...); user
  edits the cell → auto-clear; retry succeeds → done. Three lines.

## Tests

Unit: set/merge/clear semantics, auto-clear on every commit path, pruning on deleteRows,
empty-map identity. Browser: error ring + message visible, editing an errored cell shows the
message and commit clears it, zero-render probe (setting an error re-renders only that row).

## Docs

editing-cell-types.mdx gains the server-error section (example first); recipes.mdx
server-round-trip failure path REWRITTEN to use the real API; register row flips; api-reference
entries. NO CHANGELOG (paused).
