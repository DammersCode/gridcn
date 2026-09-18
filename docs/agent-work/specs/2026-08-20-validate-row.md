# validateRow — per-row cross-field validation

Status: ACCEPTED (user decision 2026-08-20: per-row, not per-gesture). Workplan #101.

## Problem

Per-column `validate(value, row)` already receives the whole row, so a read-only cross-field
rule works for a single edit. But paste, fill, and bulk updates write several cells of one row
in one gesture, and each cell validates at a different moment against whatever the row looked
like at that instant. Verified by experiment: pasting `price=30, discount=40` with discount
ordered first validates discount against the OLD price (100), passes, then price drops to 30 —
final row violates the rule with no error anywhere. Whether the rule fires depends on column
order inside the pasted block, which the user does not control.

The docs' dialog recipe (recipes.mdx) covers keyboard multi-field editing but cannot cover
paste/fill/bulk — those never open a dialog.

## Decision: per-row

`validateRow` runs once per **touched row** after each write gesture commits. Rejected
alternative (per-gesture: one callback for the whole paste) would enable cross-row rules but
requires reject-the-batch/rollback semantics; per-row can be extended to per-gesture later
without breaking anyone, the reverse is not true.

## API (additive)

```ts
// DataGridProvider / DataGrid
validateRow?: (row: TData, rowId: string) => Record<string, string> | null;
// columnId -> message; null (or {}) = row is fine
```

- Runs on every write path's commit: single edit, paste, fill handle, delete-contents,
  `updateCells` / `updateRows` (both immediate and deferred reorder modes). Runs on single-cell
  edits too — one semantics, no "why didn't my rule fire" split.
- Does NOT run on: row insert/duplicate (a fresh default row is expected to be incomplete),
  row deletion (row is gone), or consumer-side data replacement through the `data` prop
  (import's `onImport` hands rows to the consumer — applying them is the consumer's write).
- Sync only in v1. An async seam would need generation tokens like #79; not designed here.

## Semantics

- **Values still commit.** Same stance as server errors (#80): the value lands, the error
  shows. No rollback machine.
- Returned messages land in `cellErrors` under `cellErrorKey(rowId, columnId)` — same display
  (ring, tint, `aria-invalid`), same tooltip, same `useDataGridRowHasError` as server errors.
- **Ownership tracking.** The store keeps a closure-scoped map of which cellErrors keys each
  row's last `validateRow` run produced. A re-run clears exactly those keys before applying the
  new verdict — so a fixed row's stale messages disappear, while server errors set via
  `setCellErrors` on OTHER cells of the same row are never touched. Stale ownership entries for
  deleted rows are harmless (their keys are already pruned; clearing is a no-op).
- Runs AFTER `clearErrorsForOps` (write-clears-error), so a write that fixes a row first clears
  the old per-cell error, then `validateRow` gets the final say on the new row state.
- Zero cost when the prop is absent: one `if` per commit, same map identity out.
- With the prop set: one rowId-index resolve per gesture (cached via `rowIndexCache`, already
  rebased on the `updateCells` hot path) + one `validateRow` call per touched row.

## Order-independence guarantee (the point of the feature)

For any multi-cell write to one row, `validateRow` sees the row with ALL of the gesture's cells
applied, regardless of patch order. The regression test pastes `price=30, discount=40` in both
orders and asserts the discount error lands in both.

## Docs

- editing-cell-types.mdx validation section: `validateRow` subsection, example first, stating
  the paste/fill motivation and "values still commit".
- recipes.mdx cross-field callout: dialog remains the recipe for multi-field *form* editing;
  `validateRow` is the inline-paths answer.
