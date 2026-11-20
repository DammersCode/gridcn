import { describe, expect, it, vi } from "vitest";
import { defineColumnMap } from "./column-map";
import { decimalToString } from "./operands";
import { parseQuery } from "./parse-query";

vi.mock("./operands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./operands")>();
  return { ...actual, decimalToString: vi.fn(actual.decimalToString) };
});

const columns = defineColumnMap({ id: { type: "number", numeric: "int8", primaryKey: true }, ratio: { type: "number", numeric: "float" } });

describe("float filter values", () => {
  it("reads 5,000 exponent values as finite floats without the exact decimal expansion", () => {
    const filters = Array.from({ length: 5 }, (_, n) => ({ columnId: "ratio", operator: "isAnyOf", value: Array.from({ length: 1000 }, (_, i) => `1e${n % 2 === 0 ? "" : "-"}${5000 + n * 1000 + i}`) }));
    const plan = parseQuery({ spec: { sorts: [], filters, searchText: "" }, start: 0, end: 10 }, { columns, request: "rows" });
    const values = JSON.stringify(plan.where).match(/"v":"[^"]*"/g) ?? [];
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) expect(Number.isFinite(Number(value.slice(5, -1)))).toBe(true);
    expect(vi.mocked(decimalToString)).not.toHaveBeenCalled();
  });
});
