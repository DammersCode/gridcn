/**
 * Compile-time-only pin of the typed streaming patch surface: `CellPatch`/`RowPatch` default to
 * the store's untyped `string` shape (every unannotated patch list keeps compiling), and
 * instantiating them with a columns' `id` union makes a typo'd column id fail to compile instead
 * of skipping silently at runtime. No runtime assertions live here; the tsc gate typechecks this
 * file (named so vitest's *.test.ts glob does not pick it up, matching the repo's other
 * type-test files).
 */
import type { CellPatch, RowPatch } from "./types";
import { defineColumns } from "../columns/column-helpers";

/** Compile-only check: `Actual` must be identical to `Expected` (both directions assignable). */
type Equal<Expected, Actual> = (<T>() => T extends Expected ? 1 : 2) extends <T>() => T extends Actual ? 1 : 2
  ? true
  : false;
function assertEqual<Expected, Actual>(_check: Equal<Expected, Actual>): void {}

type Row = { id: string; name: string; age: number };

// --- default (no type argument): the store's own untyped string shape ---------------------------

assertEqual<string, CellPatch["rowId"]>(true);
assertEqual<string, CellPatch["columnId"]>(true);
assertEqual<unknown, CellPatch["value"]>(true);
assertEqual<unknown, RowPatch["changes"]["price"]>(true);

const defaultPatch: CellPatch = { rowId: "r1", columnId: "price", value: 12.5 };
void defaultPatch;
const defaultRowPatch: RowPatch = { rowId: "r1", changes: { price: 12.5, volume: 900 } };
void defaultRowPatch;

// --- narrowed: a list typed against the columns' id union rejects a typo'd id -------------------

type ColId = "name" | "age";

assertEqual<ColId, CellPatch<ColId>["columnId"]>(true);
assertEqual<ColId, keyof RowPatch<ColId>["changes"] & string>(true);

const typedPatch: CellPatch<ColId> = { rowId: "r1", columnId: "age", value: 42 };
void typedPatch;
const typedRowPatch: RowPatch<ColId> = { rowId: "r1", changes: { name: "Bob", age: 30 } };
void typedRowPatch;

// @ts-expect-error - "agem" is not one of the declared column ids
const typoCell: CellPatch<ColId> = { rowId: "r1", columnId: "agem", value: 1 };
void typoCell;

// @ts-expect-error - "nam" is not one of the declared column ids
const typoRow: RowPatch<ColId> = { rowId: "r1", changes: { nam: 1 } };
void typoRow;

// --- the id union comes from the columns themselves (defineColumns' const output) ---------------

const columns = defineColumns<Row>()([
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "age", header: "Age", accessorKey: "age", type: "number" },
]);

type ColumnsId = (typeof columns)[number]["id"];

assertEqual<"name" | "age", ColumnsId>(true);
const patchFromColumns: CellPatch<ColumnsId> = { rowId: "r1", columnId: columns[1]!.id, value: 42 };
void patchFromColumns;
const rowPatchFromColumns: RowPatch<ColumnsId> = { rowId: "r1", changes: { age: 41 } };
void rowPatchFromColumns;

export {};
