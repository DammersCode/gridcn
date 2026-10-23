import { describe, expect, it } from "vitest";
import { cellTypes } from "@/registry/default/blocks/data-grid/cell-types/cell-types";
import { CompactSelection } from "@/registry/default/blocks/data-grid/selection/compact-selection";
import { emptySelection as emptySelectionOps } from "@/registry/default/blocks/data-grid/selection/selection-ops";
import type { AnyColumnDef, GridSelection } from "@/registry/default/blocks/data-grid/data-grid";
import { planReplace, type ReplaceState } from "./plan-replace";

const CI_FACTOR = process.env["CI"] ? 2 : 1;

type Row = { id: string; name: string; qty: number | null; tag: string | null };

const columns: AnyColumnDef[] = [
  { id: "name", header: "Name", accessorKey: "name" } as AnyColumnDef,
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number" } as AnyColumnDef,
  {
    id: "tag",
    header: "Tag",
    accessorKey: "tag",
    type: "select",
    options: { choices: [{ value: "r", label: "Red" }, { value: "g", label: "Green" }] },
  } as AnyColumnDef,
];

const emptySelection = (): GridSelection => emptySelectionOps();

function makeState(data: Row[], overrides: Partial<ReplaceState> = {}): ReplaceState {
  return {
    data,
    viewIndex: data.map((_, i) => i),
    visibleColumns: columns,
    cellTypes: cellTypes as unknown as ReplaceState["cellTypes"],
    getRowId: (row) => (row as Row).id,
    selection: emptySelection(),
    ...overrides,
  };
}

const rows = (): Row[] => [
  { id: "a", name: "Foo bar", qty: 5, tag: "r" },
  { id: "b", name: "foo FOO", qty: 15, tag: "g" },
  { id: "c", name: "baz", qty: 7, tag: null },
];

describe("planReplace", () => {
  it("replaces every occurrence, case-insensitive by default", () => {
    const plan = planReplace(makeState(rows()), "foo", "x", {});
    expect(plan.patches).toEqual([
      { rowId: "a", columnId: "name", value: "x bar" },
      { rowId: "b", columnId: "name", value: "x x" },
    ]);
    expect(plan.remaining).toBe(false);
  });

  it("matchCase keeps other casings", () => {
    const plan = planReplace(makeState(rows()), "foo", "x", { matchCase: true });
    expect(plan.patches).toEqual([{ rowId: "b", columnId: "name", value: "x FOO" }]);
  });

  it("wholeCell replaces only cells equal to the find text", () => {
    const data = [{ id: "a", name: "foo", qty: 1, tag: null }, { id: "b", name: "foo bar", qty: 1, tag: null }];
    const plan = planReplace(makeState(data), "FOO", "x", { wholeCell: true });
    expect(plan.patches).toEqual([{ rowId: "a", columnId: "name", value: "x" }]);
  });

  it("maps a select label back to its value", () => {
    const plan = planReplace(makeState(rows()), "Red", "Green", {});
    expect(plan.patches).toEqual([{ rowId: "a", columnId: "tag", value: "g" }]);
  });

  it("reparses a number cell through its type", () => {
    const plan = planReplace(makeState(rows()), "5", "9", { wholeCell: true });
    expect(plan.patches).toEqual([{ rowId: "a", columnId: "qty", value: 9 }]);
  });

  it("skips a result the type cannot parse instead of clearing the cell", () => {
    const plan = planReplace(makeState(rows()), "5", "x", { wholeCell: true });
    expect(plan.patches).toEqual([]);
    expect(plan.skipped).toEqual([{ ref: { rowId: "a", columnId: "qty" }, reason: "unparseable" }]);
  });

  it("skips read-only columns and rows, and reports them", () => {
    const readOnlyColumns = [
      { ...columns[0]!, readOnly: (row: unknown) => (row as Row).id === "a" },
      columns[1]!,
      columns[2]!,
    ] as AnyColumnDef[];
    const plan = planReplace(makeState(rows(), { visibleColumns: readOnlyColumns }), "foo", "x", {});
    expect(plan.patches.map((p) => p.rowId)).toEqual(["b"]);
    expect(plan.skipped).toEqual([{ ref: { rowId: "a", columnId: "name" }, reason: "readonly" }]);
  });

  it("leaves hidden columns and filtered-out rows alone", () => {
    const state = makeState(rows(), { viewIndex: [1], visibleColumns: [columns[1]!, columns[2]!] });
    expect(planReplace(state, "foo", "x", {}).patches).toEqual([]);
    expect(planReplace(makeState(rows(), { viewIndex: [1] }), "foo", "x", {}).patches.map((p) => p.rowId)).toEqual(["b"]);
  });

  it("skips lazy holes", () => {
    const data: (Row | undefined)[] = [undefined, ...rows()];
    const plan = planReplace(makeState(data as Row[]), "foo", "x", {});
    expect(plan.patches.map((p) => p.rowId)).toEqual(["a", "b"]);
  });

  it("skips a cell whose result passes 100,000 characters", () => {
    const data = [{ id: "a", name: "a".repeat(60_000), qty: 1, tag: null }];
    const plan = planReplace(makeState(data), "a", "bb", {});
    expect(plan.patches).toEqual([]);
    expect(plan.skipped).toEqual([{ ref: { rowId: "a", columnId: "name" }, reason: "too-long" }]);
  });

  it("stops at replaceAllLimit and reports remaining", () => {
    const data = Array.from({ length: 5 }, (_, i) => ({ id: String(i), name: "foo", qty: 1, tag: null }));
    const plan = planReplace(makeState(data), "foo", "x", { replaceAllLimit: 3 });
    expect(plan.patches).toHaveLength(3);
    expect(plan.remaining).toBe(true);
    expect(planReplace(makeState(data), "foo", "x", { replaceAllLimit: 5 }).remaining).toBe(false);
  });

  it("selection scope covers only selected cells", () => {
    const selection = {
      current: { cell: { col: 0, row: 1 }, range: { x: 0, y: 1, width: 1, height: 1 }, rangeStack: [] },
      rows: CompactSelection.empty(),
      columns: CompactSelection.empty(),
    } as unknown as GridSelection;
    const plan = planReplace(makeState(rows(), { selection }), "foo", "x", { scope: "selection" });
    expect(plan.patches.map((p) => p.rowId)).toEqual(["b"]);
  });

  it("only targets a single cell", () => {
    const plan = planReplace(makeState(rows()), "foo", "x", { only: { rowId: "b", columnId: "name" } });
    expect(plan.patches).toEqual([{ rowId: "b", columnId: "name", value: "x x" }]);
  });

  it("returns nothing for a blank find text", () => {
    expect(planReplace(makeState(rows()), "  ", "x", {}).patches).toEqual([]);
  });

  it("caps find and replacement at 1,000 characters", () => {
    const data = [{ id: "a", name: "q", qty: 1, tag: null }];
    const plan = planReplace(makeState(data), "q", "z".repeat(5_000), {});
    expect((plan.patches[0]!.value as string).length).toBe(1_000);
  });

  it("does not match across a case-folding length change", () => {
    const data = [{ id: "a", name: "İstanbul foo", qty: 1, tag: null }];
    const plan = planReplace(makeState(data), "foo", "x", {});
    expect(plan.patches[0]!.value).toBe("İstanbul x");
  });

  it("skip leaves out cells so a continuation reaches the rest when the replacement contains the find text", () => {
    const data = Array.from({ length: 3 }, (_, i) => ({ id: String(i), name: "foo", qty: 1, tag: null }));
    const first = planReplace(makeState(data), "foo", "foobar", { replaceAllLimit: 1 });
    expect(first.patches.map((p) => p.rowId)).toEqual(["0"]);
    const replaced = new Set(first.patches.map((p) => p.rowId));
    const second = planReplace(makeState(data), "foo", "foobar", { replaceAllLimit: 1, skip: (ref) => replaced.has(ref.rowId) });
    expect(second.patches.map((p) => p.rowId)).toEqual(["1"]);
    expect(second.remaining).toBe(true);
  });

  it("replaces a needle with a length-changing character in decomposed text", () => {
    const data = [{ id: "a", name: "i̇ and İ", qty: 1, tag: null }];
    const plan = planReplace(makeState(data), "İ", "x", {});
    expect(plan.patches[0]!.value).toBe("x and x");
  });

  it("reports a matched cell whose occurrence cannot be replaced cleanly instead of dropping it", () => {
    const data = [{ id: "a", name: "İ", qty: 1, tag: null }];
    const plan = planReplace(makeState(data), "i", "x", {});
    expect(plan.patches).toEqual([]);
    expect(plan.skipped).toEqual([{ ref: { rowId: "a", columnId: "name" }, reason: "no-occurrence" }]);
  });

  it("scans a 1M character cell with a length-changing needle within budget", () => {
    const data = [{ id: "a", name: "İ".repeat(1_000_000) + "a", qty: 1, tag: null }];
    const needle = "İ".repeat(999) + "a";
    const start = performance.now();
    planReplace(makeState(data), needle, "x", {});
    expect(performance.now() - start).toBeLessThan(500 * CI_FACTOR);
  });
});
