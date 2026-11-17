import { compareSelect } from "../cell-types/select";
import type { CellType } from "../types";
import { compareChecked, compareIsoDates, compareLocaleText, compareNumbers } from "./builtin-compare";
import type { SortKeyReader } from "./keyed-sort";

type KeyPlan = { kind: SortKeyReader["kind"]; compare?: (a: string, b: string) => number; value?: (raw: unknown) => unknown };

const checkedNumber = (raw: unknown): unknown => (typeof raw === "boolean" ? Number(raw) : raw);

/** How the keyed sort reads a column whose cell type still has its built-in `compare`; `undefined` for any other. */
export function builtinKeyPlan(cellType: CellType, options: unknown): KeyPlan | undefined {
  const { compare } = cellType;
  if (compare === compareNumbers) return { kind: "number" };
  if (compare === compareLocaleText) return { kind: "text" };
  if (compare === compareIsoDates) return { kind: "ranked", compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0) };
  if (compare === compareChecked) return { kind: "number", value: checkedNumber };
  if (compare === compareSelect) return { kind: "ranked", compare: (a, b) => compareSelect(a, b, options as Parameters<typeof compareSelect>[2]) };
  return undefined;
}
