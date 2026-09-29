# CellType-driven behavior (W5-06)

Decision record for moving grid BEHAVIOR from the type NAME string onto the `CellType` object,
so custom cell types carry their own behavior instead of columns needing per-capability
overrides for every non-builtin type.

## New `CellType` fields (types.ts)

```ts
type CellType<TData, TValue, TOptions> = {
  // ...existing fields unchanged...
  /** Tabular-nums cell rendering (right-aligned digits); number and date declare it. */
  numeric?: boolean;
  /** Quick-search text for a stored value; default is String(value). select declares the choice label. */
  toSearchText?: (value: TValue, options?: TOptions) => string;
  /** Default validation when the column declares none; same shape as ColumnDef.validate. */
  validate?: ((value: TValue, row: TData) => string | null) | StandardSchemaV1<TValue>;
  /** The edit gesture ACTIVATEs this cell instead of opening an editor (checkbox declares (value) => !value). */
  activate?: (value: TValue, options?: TOptions) => TValue;
  /** Filter capabilities; each member is optional and falls back to the name-based default. */
  filter?: {
    operators?: readonly FilterOperator[];
    match?: (value: unknown, filter: FilterSpec) => boolean;
    valueInput?: "text" | "number" | "date" | "boolean" | "choices";
  };
};
```

Builtin declarations (zero behavior change for builtins, except search):

- `number`: `numeric: true`, `filter: { operators: text+comparison, valueInput: "number" }`
- `date`: `numeric: true`, `filter: { operators: text+comparison, valueInput: "date" }`
- `select`: `toSearchText: (value, options) => findChoice(...)?.label ?? String(value)`,
  `filter: { operators: text+isAnyOf, valueInput: "choices" }`
- `checkbox`: `activate: (value) => !value`, `filter: { valueInput: "boolean" }`
- `text`: nothing (all defaults)
- No builtin declares `validate` or `filter.match` — those are extension points; the resolvers
  fall back to the column def / the built-in text matcher.

## Resolution (one capabilities module: `cell-types/capabilities.ts`)

| Capability | Precedence | Replaces |
|---|---|---|
| tabular-nums | `cellType.numeric` | `cell.tsx:139` `isNumberOrDate` |
| edit-key/stationary-click/dblclick activate | `cellType.activate` (absent → open editor) | `isCheckboxCell`/`toggleCheckboxCell` in use-grid-interaction.ts (5 call sites) |
| validation | `column.validate ?? cellType.validate` | every `column.validate` read site (commit.ts ×3, use-async-validate, paste, fill, import) |
| quick-search text | `cellType.toSearchText ?? String(value)` | `textAccessorFor`'s raw `String(value)` (compute.ts) |
| filter operators | `column.filterOperators ?? cellType.filter.operators ?? operatorsForColumnType(name)` | operators-for-column-type.ts call site in filter-menu.tsx (the name table stays as last resort, now only there) |
| filter match | `column.filterMatch ?? cellType.filter.match` (absent → text matcher) | makeFilterTest (build-view-index.ts) |
| filter ValueInput widget | `cellType.filter.valueInput ?? name-based default` | the 4 name checks in filter-value-input.tsx |

`operatorsForColumnType` and the valueInput name default move INTO capabilities.ts (the name
switches are consolidated there and disappear from the four plan-named files).

## Behavior changes

- `select` quick-search now searches the choice LABEL, not the stored value (the filter was
  already label-facing via `isAnyOf`). Documented in the CellType doc and the search page.
- A custom type registered with `activate` gets checkbox gesture semantics for free (edit key,
  stationary click, double-click all commit `activate(value, options)` through
  `commitCellValue` — no edit session, no `onEditStart`/`onEditEnd`).
- A custom type with `validate` validates exactly like a column-level `validate`, including the
  async Standard Schema path (use-async-validate reads the RESOLVED validator).

## Not doing

- No `compare`/sort changes (already type-driven).
- No column-level overrides for `numeric`/`activate`/`toSearchText` (the column already has
  `validate`, `filterMatch`, `filterOperators` where the override matters; a per-column
  `numeric` flag is speculative).
- `filter.match` gets no operator-aware defaults; it replaces the text matcher wholesale, like
  `ColumnDef.filterMatch`.
