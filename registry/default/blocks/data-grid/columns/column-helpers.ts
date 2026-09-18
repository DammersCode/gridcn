import type { AccessorKeyOf, CellOptionsOf, CellTypeKey, CellValueOf, ColumnDef } from "../types";
import { isDev } from "../is-dev";

/** Keys of `T` whose value extends `V` (nullable `V` also matches the non-null key type). */
export type KeysMatching<T, V> = {
  [K in keyof T]-?: T[K] extends V
    ? K
    : null extends V
      ? T[K] extends NonNullable<V>
        ? K
        : never
      : never;
}[keyof T] &
  string;

/**
 * A column definition whose `type` selects a {@link CellTypeKey}, narrowing
 * `options` and the inferred value type (and thus `accessorKey`) through
 * the `GridCellTypes` map. Omitting `type` behaves as `"text"`.
 */
export type TypedColumnDef<TData, K extends CellTypeKey> = Omit<
  ColumnDef<TData, CellValueOf<K>>,
  "type" | "options" | "accessorKey"
> & {
  // `type` must be required for non-text branches, else an untyped column literal
  // structurally matches every branch of AnyTypedColumn (and defaults to "text" at runtime).
  type: K;
  options?: CellOptionsOf<K>;
  accessorKey?: KeysMatching<TData, CellValueOf<K>>;
};

/** `TypedColumnDef` for the default "text" branch, where `type` may be omitted. */
export type TypedTextColumnDef<TData> = Omit<TypedColumnDef<TData, "text">, "type"> & {
  type?: "text";
};

/** A `TypedColumnDef` for some cell-type key, used where the specific `K` need not be named. */
export type AnyTypedColumn<TData> =
  | TypedTextColumnDef<TData>
  | { [K in Exclude<CellTypeKey, "text">]: TypedColumnDef<TData, K> }[Exclude<CellTypeKey, "text">];

/** All keys any `AnyTypedColumn<TData>` branch may carry (for excess-property rejection). */
type KnownColumnKey<TData> = keyof AnyTypedColumn<TData>;

/**
 * Rejects excess properties per-element. Generic inference against a union
 * constraint (as `defineColumns` does against `AnyTypedColumn`) skips
 * TypeScript's normal excess-property check on object literals, so this maps
 * each column back onto its own type plus a `never` catch-all for any key
 * outside the known column shape, forcing the check back on.
 */
type RejectExcessColumnKeys<TData, T> = {
  [I in keyof T]: T[I] & { [K in Exclude<keyof T[I], KnownColumnKey<TData>>]: never };
};

/**
 * Identity helper that gives each column literal in the array its own
 * `TValue`/`options` inference (via `type`) while returning `columns`
 * unchanged at runtime. In dev mode it warns on duplicate column ids and on
 * columns missing both `accessorKey` and `accessorFn`.
 */
export function defineColumns<TData>(): <const T extends readonly AnyTypedColumn<TData>[]>(
  columns: T & RejectExcessColumnKeys<TData, T>,
) => T {
  return (columns) => {
    if (isDev()) {
      const seen = new Set<string>();
      for (const column of columns) {
        if (seen.has(column.id)) {
          console.warn(`[data-grid] duplicate column id "${column.id}"`);
        }
        seen.add(column.id);
        if (!column.accessorKey && !column.accessorFn) {
          console.warn(`[data-grid] column "${column.id}" has neither accessorKey nor accessorFn`);
        }
      }
    }
    return columns;
  };
}

/**
 * A minimal column shape covering both plain `ColumnDef` and the narrower
 * per-literal type `defineColumns`'s `const` inference produces (which keeps
 * only the accessor fields actually present in the literal, no TValue-bearing
 * member of its own).
 */
export type AccessorLike<TData> = {
  id: string;
  accessorKey?: AccessorKeyOf<TData>;
  accessorFn?: (row: TData) => unknown;
  setValue?: (row: TData, value: never) => TData;
};

/**
 * Resolves the value type a column reads/writes: `accessorFn`'s return type
 * if present, else the field type at `accessorKey`. Mirrors `getCellValue`'s
 * runtime precedence so it works on the narrow literal types `defineColumns`
 * produces (which carry no explicit TValue-bearing member).
 */
export type InferredValue<TData, TCol> = TCol extends { accessorFn: (row: TData) => infer TValue }
  ? TValue
  : TCol extends { accessorKey: infer K extends keyof TData }
    ? TData[K]
    : unknown;

/** Reads a column's value from `row` via `accessorFn`/`accessorKey`. */
export function getCellValue<TData, const TCol extends AccessorLike<TData>>(
  row: TData,
  column: TCol,
): InferredValue<TData, TCol> {
  if (column.accessorFn) return column.accessorFn(row) as InferredValue<TData, TCol>;
  // row as Record: AccessorKeyOf<TData> degrades to a bare `string` when TData=unknown (the
  // erasure-boundary case, see types.ts), which TS can no longer prove indexes `row` — sound because
  // a real (non-unknown) TData's accessorKey is still `keyof TData & string`, indexable directly.
  if (column.accessorKey) return (row as Record<string, unknown>)[column.accessorKey] as InferredValue<TData, TCol>;
  throw new Error(`[data-grid] column "${column.id}" has no accessorKey or accessorFn to read`);
}

/**
 * Writes `value` back onto `row` immutably: `setValue` if provided, else a
 * spread on `accessorKey`. Throws for accessorFn-only columns with no `setValue`.
 */
export function setCellValue<TData, const TCol extends AccessorLike<TData>>(
  row: TData,
  column: TCol,
  value: InferredValue<TData, TCol>,
): TData {
  // value as never: TCol's setValue is typed per-column, but TS can't unify it with InferredValue<TData, TCol> at this generic call site — safe by TCol's own constraint.
  if (column.setValue) return column.setValue(row, value as never);
  if (column.accessorKey) return { ...row, [column.accessorKey]: value };
  throw new Error(`[data-grid] column "${column.id}" is not writable (no setValue or accessorKey)`);
}
