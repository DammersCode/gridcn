# Pivot 2.1 contracts

This note fixes the contracts that the 2.1 steps share. `research/server-pivot-spec.md` stays the base spec for the server pivot.

## Nested pivot rows (S11-M)

- A pivot request carries one pivot column and 1 to 4 `groupBy` levels. The layer already answers all levels.
- A pivot row at depth `d` opens when `d < groupBy.length - 1`. Opening it lists the child group rows of the next level.
- The innermost pivot row has `childCount` 0 and no toggle. No `childKind: "rows"` list ever leaves a pivot grid.
- Every pivot row at every depth carries its own `pivotCells` (its subtree).
- The generated columns and the held set are the same for all levels. A child answer's `pivotColumns` hold the keys of its subtree only (the layer scopes the key query to the group path), so only a top-level answer sets the held set. Every answer maps its cells into it by generated id.
- Pivot rows stay read-only. Selection, copy, export and find read `pivotCellText`.
- A group row that cannot show a toggle reports `expanded: false`.

## Client pivot (S11-L)

- Props: `pivot`, `defaultPivot`, `onPivotChange`, with the shape `{ columnIds: [id] } | undefined`. They follow the naming and the controlled-pair rules of the existing `groupBy` props.
- Values come from the `aggregate` of each column, as the `groupBy` aggregates do. No aggregate: the pivot has no values and the grid shows the group counts only.
- The grid builds the held set and one `Float64Array` per group row from the client buckets. Key order, the empty key last, and the cap of 200 divided by the value count follow the layer (`pivotOmitted` counts the rest).
- Text keys follow the client collator, as client `groupBy` groups do; the layer follows the database collation. So the cut at 200 divided by the value count can keep other text keys than the layer. Number and checkbox keys order alike.
- The build refuses with `{ tooLarge: true }` when the group rows times the generated columns exceed 1,000,000 cells, the cap of the server pivot store. It allocates no cells then.
- Given the previous held set, a build with equal generated ids returns its `columns` array, so the generated column defs keep their identity.
- Local array and client pagination are supported. A lazy source, `totalRowCount` and `sortMode="server"` keep the grid ungrouped and warn in development.
- In server mode the hook maps the props to `spec.pivot`.
- A write or a streamed row refreshes the cells. The step that wires it measures one edit at 100k rows first. A full rebuild above 16 ms needs an incremental refresh.

## Decimal and string aggregates

- The layer answers a number aggregate as a number. It answers a decimal string when the value has more than 15 significant digits and is not a safe integer. `avg` and a `float` column always answer a number.
- The grid reader accepts a numeric string for a number column and a string for text and date `min` and `max`. A string stays within the 1,024 character bound.
- Pivot cells stay numbers. A value beyond 15 digits loses precision there, and the docs state the limit.

## Prisma (S11-P)

- Object API only, no raw SQL. The adapter pivots when the page times the keys is at most 40,000 cells.
- It ships only if it matches the layer oracle on key order, the empty and `NULL` keys, and the omitted count. Otherwise the adapter keeps declining and S11-P stays a documented gap.

## Saved views (S11-V)

- The view state gains the pivot column id. It is additive and needs no migration.
- Generated column widths restore only for ids in the held set. Widths for an id that has not landed wait for the landing. At most 200 ids are kept.

## Export

- `exportSource` exports the source rows. It does not read the pivot view. The docs say so and a test pins it.
