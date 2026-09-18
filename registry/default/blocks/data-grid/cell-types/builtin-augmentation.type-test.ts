/**
 * Compile-time-only proof for workplan #61's `BuiltinCellTypeKey` decoupling. No runtime
 * assertions live here; the tsc gate typechecks this file (named so vitest's *.test.ts glob does
 * not pick it up, matching columns/column-helpers.type-test.ts).
 *
 * Two directions, both required by the fix:
 *
 * (a) A REAL consumer-style `declare module` augmentation of `GridCellTypes` compiles alongside
 *     the shipped `cellTypes` object's `satisfies { [K in BuiltinCellTypeKey]: CellTypeFor<K> }`.
 *     Before the fix, this satisfies was keyed on `CellTypeKey` (= `keyof GridCellTypes`), so any
 *     augmentation anywhere in this whole-program tsc run forced `cellTypes` to also provide the
 *     new key — which the shipped file can't. This file's `declare module` below is exactly that
 *     augmentation, proving `cell-types.ts` still compiles with it present.
 *
 * (b) Built-in drift (a missing or mistyped entry for one of the five REAL built-ins) must still
 *     fail. `cellTypes` itself can't be mutated to prove this without breaking the shipped
 *     registry, so a structurally identical mock registry is checked the same way, with
 *     `@ts-expect-error` proving the mistake is still caught.
 */
import type { CellOptionsOf, CellType, CellValueOf } from "../types";
import { textCellType } from "./text";
import { numberCellType } from "./number";
import { checkboxCellType } from "./checkbox";
import { selectCellType } from "./select";
import { dateCellType } from "./date";

// --- (a) real consumer-style augmentation compiles alongside the shipped satisfies ---------

declare module "../types" {
  interface GridCellTypes {
    currency: { value: number | null; options: { currency: string } };
  }
}

// cellTypes (imported from the shipped file) must still typecheck now that GridCellTypes/
// CellTypeKey carry the extra "currency" key — this import alone re-runs cell-types.ts's own
// `satisfies` in this program; a regression back to keying on CellTypeKey would fail HERE.
import { cellTypes } from "./cell-types";
void cellTypes;

// --- (b) built-in drift still errors ------------------------------------------------------

type BuiltinCellTypeKey = "text" | "number" | "checkbox" | "select" | "date";
type CellTypeFor<K extends BuiltinCellTypeKey> = CellType<unknown, CellValueOf<K>, CellOptionsOf<K>>;

const mockMissingBuiltin = {
  text: textCellType,
  number: numberCellType,
  checkbox: checkboxCellType,
  select: selectCellType,
  // @ts-expect-error missing "date" entry must still fail the built-in satisfies check
} satisfies { [K in BuiltinCellTypeKey]: CellTypeFor<K> };
void mockMissingBuiltin;

const mockMistypedBuiltin = {
  text: textCellType,
  // @ts-expect-error mistyped "number" entry (text's CellType instead of number's) must still fail
  number: textCellType,
  checkbox: checkboxCellType,
  select: selectCellType,
  date: dateCellType,
} satisfies { [K in BuiltinCellTypeKey]: CellTypeFor<K> };
void mockMistypedBuiltin;
