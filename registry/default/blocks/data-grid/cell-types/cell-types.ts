import type { CellOptionsOf, CellType, CellTypeKey, CellValueOf } from "../types";
import { textCellType } from "./text";
import { numberCellType } from "./number";
import { checkboxCellType } from "./checkbox";
import { selectCellType } from "./select";
import { dateCellType } from "./date";

export { textCellType } from "./text";
export { numberCellType } from "./number";
export { checkboxCellType } from "./checkbox";
export { selectCellType } from "./select";
export { dateCellType } from "./date";

/**
 * The five built-in keys, deliberately DECOUPLED from `CellTypeKey` (which is
 * `keyof GridCellTypes` and grows with consumer augmentation). Keeping this
 * union literal means the `satisfies` below only ever checks these five
 * built-in entries — a consumer's `declare module` augmentation adds a key to
 * `GridCellTypes`/`CellTypeKey` without requiring the shipped `cellTypes`
 * object to provide an implementation for it.
 */
type BuiltinCellTypeKey = "text" | "number" | "checkbox" | "select" | "date";

/** A `CellType` for one {@link BuiltinCellTypeKey}, with its exact value/options shape. */
type CellTypeFor<K extends BuiltinCellTypeKey> = CellType<unknown, CellValueOf<K>, CellOptionsOf<K>>;

/** Built-in cell-type registry keyed by {@link BuiltinCellTypeKey}; consumers merge in custom types alongside these. */
export const cellTypes = {
  text: textCellType,
  number: numberCellType,
  checkbox: checkboxCellType,
  select: selectCellType,
  date: dateCellType,
} satisfies { [K in BuiltinCellTypeKey]: CellTypeFor<K> };

/**
 * Defines a custom cell type with the one compile-time check a plain object can't give: `key`
 * must be a registered {@link CellTypeKey} (your `GridCellTypes` module augmentation) and the
 * type's value/options must match that key's declared shape, so a typo in a key or a drifted
 * `GridCellTypes` entry fails at the definition, not at every column that uses the type.
 * Zero runtime cost — the entry is returned as-is, ready for the `cellTypes` registry.
 */
export function defineCellType<K extends CellTypeKey>(
  key: K,
  type: CellType<unknown, CellValueOf<K>, CellOptionsOf<K>>,
): CellType<unknown, CellValueOf<K>, CellOptionsOf<K>> {
  return type;
}
