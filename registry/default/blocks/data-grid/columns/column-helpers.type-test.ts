/**
 * Compile-time-only assertions for column-helpers' type inference. No
 * runtime assertions live here; the tsc gate typechecks this file (it is
 * intentionally named so vitest's *.test.ts glob does not pick it up).
 */
import { defineColumns, getCellValue, setCellValue } from "./column-helpers";
import type { TypedColumnDef } from "./column-helpers";
import type { CellOptionsOf, CellValueOf, ColumnDef } from "../types";

type Row = {
  id: string;
  name: string;
  age: number;
  nickname: string | null;
  score: number | null;
  active: boolean;
  plan: string | null;
  startDate: string | null;
};

declare const row: Row;

/** Compile-only check: `Actual` must be identical to `Expected` (both directions assignable). */
type Equal<Expected, Actual> = (<T>() => T extends Expected ? 1 : 2) extends <T>() => T extends Actual ? 1 : 2
  ? true
  : false;
function assertEqual<Expected, Actual>(_check: Equal<Expected, Actual>): void {}

// --- options narrowing per type key -----------------------------------

const numberOptions: CellOptionsOf<"number"> = { min: 0, max: 100, step: 1, decimals: 2 };
const selectOptions: CellOptionsOf<"select"> = { choices: [{ value: "a", label: "A" }] };
const textOptions: CellOptionsOf<"text"> = { placeholder: "type here" };
void numberOptions;
void selectOptions;
void textOptions;

const columns = defineColumns<Row>()([
  { id: "name", header: "Name", accessorKey: "name" }, // type omitted = 'text'
  { id: "age", header: "Age", accessorKey: "age", type: "number", options: { min: 0, max: 10 } },
  { id: "active", header: "Active", accessorKey: "active", type: "checkbox" },
  {
    id: "plan",
    header: "Plan",
    accessorKey: "plan",
    type: "select",
    options: { choices: [{ value: "free", label: "Free" }] },
  },
  { id: "startDate", header: "Start", accessorKey: "startDate", type: "date", options: { min: "2020-01-01" } },
]);

// --- defineColumns preserves id literals and tuple order (const type param) --

assertEqual<"name", (typeof columns)[0]["id"]>(true);
assertEqual<"age", (typeof columns)[1]["id"]>(true);
assertEqual<5, (typeof columns)["length"]>(true);

// --- null-widening: number/select/date accessorKey may point at the non-null field ---

const widenedNumber: TypedColumnDef<Row, "number"> = { id: "age", header: "Age", type: "number", accessorKey: "age" };
void widenedNumber;
const nullableNumber: TypedColumnDef<Row, "number"> = {
  id: "score",
  header: "Score",
  type: "number",
  accessorKey: "score",
};
void nullableNumber;
const widenedSelect: TypedColumnDef<Row, "select"> = {
  id: "plan",
  header: "Plan",
  type: "select",
  accessorKey: "plan",
};
void widenedSelect;

// --- omitted `type` type hole: an untyped column literal must be checked as 'text' ---

const omittedTypeOverBoolean: TypedColumnDef<Row, "text"> = {
  id: "active",
  header: "Active",
  // @ts-expect-error - omitted `type` means "text"; boolean accessorKey is incompatible
  accessorKey: "active",
};
void omittedTypeOverBoolean;

// `type` is required for non-text branches — cannot be satisfied by omission
// @ts-expect-error - the number branch requires `type: "number"`, it cannot be omitted
const omittedTypeForNumber: TypedColumnDef<Row, "number"> = {
  id: "age",
  header: "Age",
  accessorKey: "age",
};
void omittedTypeForNumber;

// --- getCellValue / setCellValue: TValue is linked, not just contextually supplied ---

const nameColumn = columns[0];
const nameValue = getCellValue(row, nameColumn);
assertEqual<string, typeof nameValue>(true);
const updatedRow: Row = setCellValue(row, nameColumn, "Bob");
void updatedRow;

// @ts-expect-error - nameColumn's value type is string, not number
setCellValue(row, nameColumn, 42);

const ageColumn = columns[1];
const ageValue = getCellValue(row, ageColumn);
assertEqual<number, typeof ageValue>(true);

// @ts-expect-error - ageColumn's value type is number, not boolean
setCellValue(row, ageColumn, true);

// --- @ts-expect-error: wrong options shape for a type key -------------

const badNumberOptions: TypedColumnDef<Row, "number"> = {
  id: "age",
  header: "Age",
  type: "number",
  accessorKey: "age",
  // @ts-expect-error - number options does not accept `choices`
  options: { choices: [] },
};
void badNumberOptions;

const badSelectOptions: TypedColumnDef<Row, "select"> = {
  id: "plan",
  header: "Plan",
  type: "select",
  accessorKey: "plan",
  // @ts-expect-error - select options requires `choices`, not `min`/`max`
  options: { min: 0, max: 1 },
};
void badSelectOptions;

// --- @ts-expect-error: accessorKey pointing at an incompatible value type --

const badAccessorKeyForNumber: TypedColumnDef<Row, "number"> = {
  id: "name",
  header: "Name",
  type: "number",
  // @ts-expect-error - `name` is a string field, incompatible with the number cell type
  accessorKey: "name",
};
void badAccessorKeyForNumber;

const badAccessorKeyForText: TypedColumnDef<Row, "text"> = {
  id: "active",
  header: "Active",
  // @ts-expect-error - `active` is a boolean field, incompatible with the text cell type
  accessorKey: "active",
};
void badAccessorKeyForText;

// --- excess-property checking survives defineColumns' generic inference ---

defineColumns<Row>()([
  {
    id: "n",
    header: "N",
    accessorKey: "name",
    // @ts-expect-error - `typeOption` is a typo of `options`
    typeOption: { placeholder: "x" },
  },
]);

// --- flex: number accepted, string rejected (ColumnDef-level, not gated by cell type) ---

const flexColumn: TypedColumnDef<Row, "number"> = { id: "age", header: "Age", type: "number", accessorKey: "age", flex: 1 };
void flexColumn;

const badFlex: TypedColumnDef<Row, "text"> = {
  id: "name",
  header: "Name",
  accessorKey: "name",
  // @ts-expect-error - flex must be a number, not a string
  flex: "1",
};
void badFlex;

// --- CellValueOf sanity -----------------------------------------------------

type NumberValue = CellValueOf<"number">;
const numberValueCheck: NumberValue = null;
void numberValueCheck;

// --- method-shorthand variance: a column's own narrow TValue-specific cellClassName stays
// assignable to ColumnDef<Row, unknown> (the array element type every consumer prop uses).
// cellClassName is declared as method-shorthand in ColumnDef (bivariant check) specifically so
// this holds (see types.ts's CellClassNameFnHolder doc comment) — this is a regression test for
// that fix: if it were ever changed to a plain `TValue => ...` property (contravariant check),
// this array literal would stop compiling. `validate` is DIFFERENT: it's a union of a function and
// a non-callable StandardSchemaV1, which can't stay bivariant as a plain property no matter how
// it's declared (proven while implementing #53) — so validate's own value type is `ColumnDef`'s
// separate 3rd param (TValidate), erased to `any` at the array-element type below (documented,
// single-field cast — see types.ts's ColumnDef.validate doc and store.tsx's AnyColumnDef doc).

const withNarrowCallbacks = defineColumns<Row>()([
  {
    id: "age",
    header: "Age",
    accessorKey: "age",
    type: "number",
    // narrow to `number | null`, not `unknown` — validate's own TValidate param erases separately (see above)
    validate: (value) => (value !== null && value < 0 ? "must be non-negative" : null),
    // narrow to `number`, not `unknown` — would reject under a contravariant property check
    cellClassName: (ctx) => (ctx.value !== null && ctx.value < 0 ? "text-destructive" : undefined),
  },
]);
const commonElementColumns: readonly ColumnDef<Row, unknown, any>[] = withNarrowCallbacks; // eslint-disable-line @typescript-eslint/no-explicit-any
void commonElementColumns;

export {};
