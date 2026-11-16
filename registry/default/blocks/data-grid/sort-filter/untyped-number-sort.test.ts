import { afterEach, describe, expect, it, vi } from "vitest";
import { cellTypes } from "../cell-types/cell-types";
import { computeViewIndex } from "../store/compute";
import type { AnyColumnDef } from "../store/types";
import { KEYED_SORT_MIN_ROWS } from "./keyed-sort";

type Row = { value: unknown };

const column: AnyColumnDef = { id: "value", header: "Value", accessorKey: "value" };

function sortedValues(values: readonly unknown[], direction: "asc" | "desc" = "asc"): unknown[] {
  const data: Row[] = values.map((value) => ({ value }));
  return computeViewIndex(data, [column], [{ columnId: "value", direction }], [], undefined, cellTypes).map((row) => data[row]!.value);
}

afterEach(() => vi.restoreAllMocks());

describe("an untyped column of numbers", () => {
  const numbers = [-10, -5, 3, 1.5, 1.25, 10];

  it("sorts by numeric value", () => {
    expect(sortedValues(numbers)).toEqual([-10, -5, 1.25, 1.5, 3, 10]);
    expect(sortedValues(numbers, "desc")).toEqual([10, 3, 1.5, 1.25, -5, -10]);
  });

  it("sorts by numeric value on the keyed path, with empty cells last", () => {
    const many = Array.from({ length: KEYED_SORT_MIN_ROWS }, (_, i) => (i === 0 ? null : numbers[i % numbers.length]!));
    const sorted = sortedValues(many);
    expect(sorted.slice(0, 2)).toEqual([-10, -10]);
    expect(sorted.at(-2)).toBe(10);
    expect(sorted.at(-1)).toBe(null);
  });

  it("keeps the text order for strings", () => {
    expect(sortedValues(["b10", "b9", "A"])).toEqual(["A", "b9", "b10"]);
  });

  it("sorts numbers before text in a mixed column, and warns once in development", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(sortedValues(["b", 10, "a", -1])).toEqual([-1, 10, "a", "b"]);
    sortedValues(["b", 10]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('"value"');
  });
});
